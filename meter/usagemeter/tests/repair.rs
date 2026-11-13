//! `usagemeter repair` (issue 1126) on fixture stores in temp dirs. Synthetic rows only.

use std::fs;
use std::path::{Path, PathBuf};

use meter::repair::{self, Copy, Opts, exit};
use meter::store::Store;
use meter::time::{HOUR_MS, parse_rfc3339};
use rusqlite::Connection;
use sha2::{Digest, Sha256};

const NOW: i64 = 1_800_000_000_000;
const CR: usize = 1; // cache_read
const IN: usize = 0; // input_uncached

fn hour(s: &str) -> i64 {
    parse_rfc3339(s).unwrap()
}

struct Fx {
    _dir: tempfile::TempDir,
    store: PathBuf,
    oracle: PathBuf,
    scratch: PathBuf,
}

impl Fx {
    fn new() -> Fx {
        let dir = tempfile::tempdir().unwrap();
        let mk = |n: &str| {
            let p = dir.path().join(n);
            fs::create_dir_all(&p).unwrap();
            drop(Store::open(&p.join("meter.db")).unwrap());
            p
        };
        let (store, oracle, scratch) = (mk("store"), mk("oracle"), dir.path().join("scratch"));
        fs::create_dir_all(&scratch).unwrap();
        Fx {
            _dir: dir,
            store,
            oracle,
            scratch,
        }
    }
    fn conn(dir: &Path) -> Connection {
        Connection::open(dir.join("meter.db")).unwrap()
    }
    fn put(
        dir: &Path,
        id: &str,
        harness: &str,
        h: &str,
        v: [i64; 7],
        events: i64,
        state: Option<&str>,
    ) {
        Fx::conn(dir)
            .execute(
                "INSERT INTO usage(id, hour_ms, harness, model, machine, precision, events,
                   updated_ms, actor_state, input_uncached, cache_read, cache_write_5m,
                   cache_write_1h, output, reasoning, unsplit)
                 VALUES (?1, ?2, ?3, 'm', 'mach', 'exact', ?4, 1, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                rusqlite::params![
                    id,
                    hour(h),
                    harness,
                    events,
                    state,
                    v[0],
                    v[1],
                    v[2],
                    v[3],
                    v[4],
                    v[5],
                    v[6]
                ],
            )
            .unwrap();
    }
    fn s(&self, id: &str, harness: &str, h: &str, v: [i64; 7], ev: i64) {
        Fx::put(&self.store, id, harness, h, v, ev, None);
    }
    fn o(&self, id: &str, harness: &str, h: &str, v: [i64; 7], ev: i64) {
        Fx::put(&self.oracle, id, harness, h, v, ev, None);
    }
    fn opts(&self, extra: &[&str]) -> Opts {
        let mut a: Vec<String> = vec!["--against".into(), self.oracle.display().to_string()];
        a.extend(extra.iter().map(|s| s.to_string()));
        repair::parse(&a, &self.store, NOW).unwrap()
    }
    /// A copy of the store as `VACUUM INTO` makes it, with its sha256.
    fn copy(&self, name: &str) -> Copy {
        let path = self.scratch.join(name);
        Fx::conn(&self.store)
            .execute("VACUUM INTO ?1", [path.display().to_string()])
            .unwrap();
        let sha = meter::event::hex(&Sha256::digest(fs::read(&path).unwrap()));
        Copy { path, sha256: sha }
    }
    fn apply_opts(&self, extra: &[&str], c: &Copy) -> Opts {
        let mut o = self.opts(extra);
        o.apply = Some(c.clone());
        o
    }
    fn col(dir: &Path, harness: &str, h: &str, c: usize) -> i64 {
        let name = repair::COLS[c];
        Fx::conn(dir)
            .query_row(
                &format!(
                    "SELECT coalesce(sum({name}), 0) FROM usage WHERE harness = ?1 AND hour_ms = ?2"
                ),
                rusqlite::params![harness, hour(h)],
                |r| r.get(0),
            )
            .unwrap()
    }
    fn events(dir: &Path) -> i64 {
        Fx::conn(dir)
            .query_row("SELECT coalesce(sum(events), 0) FROM usage", [], |r| {
                r.get(0)
            })
            .unwrap()
    }
    fn db_hash(dir: &Path) -> String {
        meter::event::hex(&Sha256::digest(fs::read(dir.join("meter.db")).unwrap()))
    }
    fn journal(&self) -> Option<String> {
        Fx::conn(&self.store)
            .query_row("SELECT v FROM meta WHERE k = ?1", [repair::JOURNAL], |r| {
                r.get(0)
            })
            .ok()
    }
}

fn cols(i: usize, n: i64) -> [i64; 7] {
    let mut v = [0; 7];
    v[i] = n;
    v
}

const H8: &str = "2026-11-08T10:00:00Z";
const H9: &str = "2026-11-09T11:00:00Z";

#[test]
fn short_cell_top_up_then_idempotent_second_apply() {
    let _g = common_serial();
    let fx = Fx::new();
    fx.s("a", "dsh-tui", H8, cols(CR, 100), 5);
    fx.o("a", "dsh-tui", H8, cols(CR, 160), 5);
    let d = repair::execute(&fx.opts(&[])).unwrap();
    assert_eq!(d.code, exit::OK);
    assert_eq!(d.report.total_change(), 60);
    assert!(d.report.passed());
    let j = d.report.to_json(d.code);
    assert_eq!(j["cells"][0]["column"], "cache_read");
    assert_eq!(j["cells"][0]["before"], 100);
    assert_eq!(j["cells"][0]["after"], 160);
    assert_eq!(j["total"]["events_change"], 0);

    let c = fx.copy("copy.db");
    let d = repair::execute(&fx.apply_opts(&[], &c)).unwrap();
    assert_eq!(d.code, exit::OK);
    assert_eq!(d.applied_days, vec!["2026-11-08"]);
    assert_eq!(Fx::col(&fx.store, "dsh-tui", H8, CR), 160);
    assert_eq!(Fx::events(&fx.store), 5);
    assert_eq!(fx.journal().as_deref(), Some("2026-11-08"));

    // Second apply: the plan is empty, exit 3, nothing is written.
    let h = Fx::db_hash(&fx.store);
    let d = repair::execute(&fx.apply_opts(&[], &c)).unwrap();
    assert_eq!(d.code, exit::NOTHING);
    assert!(d.applied_days.is_empty());
    assert_eq!(Fx::db_hash(&fx.store), h);
}

#[test]
fn kept_cell_keeps_evidence_free_tokens() {
    let _g = common_serial();
    let fx = Fx::new();
    // Mixed history: 50 evidence-free + 100 attributed in one group; the oracle has 100.
    Fx::put(&fx.store, "free", "claude-code", H8, cols(CR, 50), 2, None);
    Fx::put(
        &fx.store,
        "att",
        "claude-code",
        H8,
        cols(CR, 100),
        3,
        Some("attributed"),
    );
    let mut o = cols(CR, 100);
    o[IN] = 30;
    fx.o("a", "claude-code", H8, o, 5);
    let mut s = [0; 7];
    s[IN] = 10;
    Fx::put(&fx.store, "in", "claude-code", H8, s, 0, None);
    let d = repair::execute(&fx.opts(&[])).unwrap();
    assert_eq!(d.code, exit::OK, "{}", d.report.to_text(d.code));
    assert_eq!(d.report.total_change(), 20);
    assert_eq!(d.report.kept_tokens(), 50);
    let j = d.report.to_json(d.code);
    assert_eq!(j["kept"][0]["column"], "cache_read");
    assert_eq!(j["kept"][0]["tokens"], 50);
    let c = fx.copy("c.db");
    repair::execute(&fx.apply_opts(&[], &c)).unwrap();
    // Nothing subtracted, the top-up went to the evidence-free row, the attributed row is as it was.
    assert_eq!(Fx::col(&fx.store, "claude-code", H8, CR), 150);
    assert_eq!(Fx::col(&fx.store, "claude-code", H8, IN), 30);
    let att: i64 = Fx::conn(&fx.store)
        .query_row("SELECT cache_read FROM usage WHERE id = 'att'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(att, 100);
}

#[test]
fn unresolved_hour_is_listed_and_untouched() {
    let _g = common_serial();
    let fx = Fx::new();
    fx.s("a", "dsh-tui", H8, cols(CR, 100), 1);
    fx.s("b", "dsh-tui", H9, cols(CR, 70), 1);
    fx.o("b", "dsh-tui", H9, cols(CR, 70), 1);
    let d = repair::execute(&fx.opts(&[])).unwrap();
    assert_eq!(d.code, exit::NOTHING);
    assert_eq!(d.report.unresolved_tokens(), 100);
    let j = d.report.to_json(d.code);
    assert_eq!(j["unresolved"][0]["hours"], 1);
    assert_eq!(j["unresolved"][0]["day"], "2026-11-08");
    assert!(d.report.passed());
    // Both a short hour and an unresolved one: only the short one is planned.
    fx.o("c", "dsh-tui", "2026-11-09T12:00:00Z", cols(CR, 9), 1);
    fx.s("c", "dsh-tui", "2026-11-09T12:00:00Z", cols(CR, 4), 1);
    let d = repair::execute(&fx.opts(&[])).unwrap();
    assert_eq!(d.code, exit::OK);
    assert_eq!(d.report.changes.len(), 1);
    assert_eq!(d.report.unresolved_tokens(), 100);
}

#[test]
fn events_differ_fails_and_apply_writes_nothing() {
    let _g = common_serial();
    let fx = Fx::new();
    fx.s("a", "dsh-tui", H8, cols(CR, 100), 5);
    fx.o("a", "dsh-tui", H8, cols(CR, 160), 6);
    let c = fx.copy("c.db");
    let h = Fx::db_hash(&fx.store);
    let d = repair::execute(&fx.apply_opts(&[], &c)).unwrap();
    assert_eq!(d.code, exit::CONSERVATION);
    assert!(
        d.report
            .failures
            .iter()
            .any(|f| f.contains("events differ"))
    );
    assert!(d.applied_days.is_empty());
    assert_eq!(Fx::db_hash(&fx.store), h);
}

#[test]
fn codex_and_antigravity_change_fails() {
    let _g = common_serial();
    for harness in ["codex", meter::sources::Source::Agy.harness()] {
        let fx = Fx::new();
        fx.s("a", harness, H8, cols(CR, 100), 5);
        fx.o("a", harness, H8, cols(CR, 101), 5);
        let d = repair::execute(&fx.opts(&[])).unwrap();
        assert_eq!(d.code, exit::CONSERVATION, "{harness}");
        assert!(d.report.failures.iter().any(|f| f.contains(harness)));
    }
}

#[test]
fn range_limit_reports_outside_and_from_until_narrow() {
    let _g = common_serial();
    let fx = Fx::new();
    let before = "2026-11-06T10:00:00Z";
    fx.s("o", "dsh-tui", before, cols(CR, 10), 1);
    fx.o("o", "dsh-tui", before, cols(CR, 90), 1);
    fx.s("a", "dsh-tui", H8, cols(CR, 10), 1);
    fx.o("a", "dsh-tui", H8, cols(CR, 20), 1);
    fx.s("b", "dsh-tui", H9, cols(CR, 10), 1);
    fx.o("b", "dsh-tui", H9, cols(CR, 30), 1);
    let d = repair::execute(&fx.opts(&[])).unwrap();
    assert_eq!(d.report.total_change(), 10 + 20);
    let j = d.report.to_json(d.code);
    assert_eq!(j["outside_range"][0]["tokens"], 80);
    let d = repair::execute(&fx.opts(&["--from", "2026-11-09", "--until", "2026-11-09"])).unwrap();
    assert_eq!(d.report.total_change(), 20);
    assert_eq!(d.report.changes[0].day, "2026-11-09");
    // Apply leaves the day outside the range as it was.
    let c = fx.copy("c.db");
    repair::execute(&fx.apply_opts(&[], &c)).unwrap();
    assert_eq!(Fx::col(&fx.store, "dsh-tui", before, CR), 10);
    assert_eq!(Fx::col(&fx.store, "dsh-tui", H8, CR), 20);
    assert_eq!(Fx::col(&fx.store, "dsh-tui", H9, CR), 30);
}

#[test]
fn kill_between_days_leaves_whole_days() {
    let _g = common_serial();
    let fx = Fx::new();
    for (i, h) in [H8, H9, "2026-11-10T01:00:00Z"].iter().enumerate() {
        let id = format!("r{i}");
        fx.s(&id, "dsh-tui", h, cols(CR, 10), 1);
        fx.o(&id, "dsh-tui", h, cols(CR, 25), 1);
    }
    let c = fx.copy("c.db");
    let o = fx.apply_opts(&[], &c);
    let rep = repair::execute(&fx.opts(&[])).unwrap().report;
    let done = repair::apply(&o, &c, &rep, 1).unwrap();
    assert_eq!(done, vec!["2026-11-08"]);
    assert_eq!(Fx::col(&fx.store, "dsh-tui", H8, CR), 25);
    assert_eq!(Fx::col(&fx.store, "dsh-tui", H9, CR), 10);
    assert_eq!(fx.journal().as_deref(), Some("2026-11-08"));
    // A rerun with the same copy finishes the rest and skips the done day.
    let d = repair::execute(&o).unwrap();
    assert_eq!(d.code, exit::OK);
    assert_eq!(d.applied_days, vec!["2026-11-09", "2026-11-10"]);
    assert_eq!(
        Fx::col(&fx.store, "dsh-tui", "2026-11-10T01:00:00Z", CR),
        25
    );
    assert_eq!(repair::execute(&o).unwrap().code, exit::NOTHING);
}

#[test]
fn failed_day_check_rolls_the_day_back() {
    let _g = common_serial();
    let fx = Fx::new();
    fx.s("a", "dsh-tui", H8, cols(CR, 10), 1);
    fx.o("a", "dsh-tui", H8, cols(CR, 25), 1);
    let c = fx.copy("c.db");
    let o = fx.apply_opts(&[], &c);
    let mut rep = repair::execute(&fx.opts(&[])).unwrap().report;
    rep.changes[0].id = "no-such-row".into();
    let h = Fx::db_hash(&fx.store);
    let e = repair::apply(&o, &c, &rep, usize::MAX).unwrap_err();
    assert!(e.contains("rolled back"), "{e}");
    assert_eq!(Fx::db_hash(&fx.store), h);
    assert_eq!(fx.journal(), None);
}

#[test]
fn dry_run_writes_nothing() {
    let _g = common_serial();
    let fx = Fx::new();
    fx.s("a", "dsh-tui", H8, cols(CR, 100), 5);
    fx.o("a", "dsh-tui", H8, cols(CR, 160), 5);
    let (hs, ho) = (Fx::db_hash(&fx.store), Fx::db_hash(&fx.oracle));
    let d = repair::execute(&fx.opts(&["--dry-run"])).unwrap();
    assert_eq!(d.code, exit::OK);
    assert_eq!(Fx::db_hash(&fx.store), hs);
    assert_eq!(Fx::db_hash(&fx.oracle), ho);
    assert!(!fx.store.join("meter.lock").exists());
    assert!(fx.journal().is_none());
}

#[test]
fn evidence_sum_stays_under_the_rollup() {
    let _g = common_serial();
    let ev = |fx: &Fx, n: i64| {
        Fx::conn(&fx.store)
            .execute(
                "INSERT INTO evidence(ts_ms, dim, actor, cache_read) VALUES (?1, 0, 0, ?2)",
                rusqlite::params![hour(H8) + 5, n],
            )
            .unwrap();
    };
    let fx = Fx::new();
    fx.s("a", "dsh-tui", H8, cols(CR, 100), 5);
    fx.o("a", "dsh-tui", H8, cols(CR, 160), 5);
    ev(&fx, 90);
    let d = repair::execute(&fx.opts(&[])).unwrap();
    assert_eq!(d.code, exit::OK, "{}", d.report.to_text(d.code));
    // Evidence above the rollup already: the invariant is broken before the repair, so it fails.
    let fx = Fx::new();
    fx.s("a", "dsh-tui", H8, cols(CR, 100), 5);
    fx.o("a", "dsh-tui", H8, cols(CR, 160), 5);
    ev(&fx, 120);
    let d = repair::execute(&fx.opts(&[])).unwrap();
    assert_eq!(d.code, exit::CONSERVATION);
    assert!(
        d.report
            .failures
            .iter()
            .any(|f| f.contains("evidence above"))
    );
    let _ = HOUR_MS;
}

#[test]
fn apply_refused_without_the_matching_copy_and_on_a_newer_schema() {
    let _g = common_serial();
    let fx = Fx::new();
    fx.s("a", "dsh-tui", H8, cols(CR, 100), 5);
    fx.o("a", "dsh-tui", H8, cols(CR, 160), 5);
    // No --copy / --confirm-copy at all.
    let a: Vec<String> = ["--against", fx.oracle.to_str().unwrap(), "--apply"]
        .map(String::from)
        .to_vec();
    assert!(repair::parse(&a, &fx.store, NOW).is_err());
    // A wrong sha256.
    let mut c = fx.copy("c.db");
    c.sha256 = "0".repeat(64);
    let h = Fx::db_hash(&fx.store);
    let e = match repair::execute(&fx.apply_opts(&[], &c)) {
        Err(e) => e,
        Ok(_) => panic!("applied with a wrong sha256"),
    };
    assert!(e.contains("sha256"), "{e}");
    assert_eq!(Fx::db_hash(&fx.store), h);
    // A copy that no longer matches the store.
    let c = fx.copy("d.db");
    fx.s("x", "omp", H9, cols(IN, 1), 1);
    assert!(repair::execute(&fx.apply_opts(&[], &c)).is_err());
    // A newer schema.
    Fx::conn(&fx.store)
        .execute("UPDATE meta SET v = '99' WHERE k = 'schema_version'", [])
        .unwrap();
    assert_eq!(
        repair::execute(&fx.opts(&[])).unwrap().code,
        exit::NEWER_SCHEMA
    );
}

#[test]
fn cli_dry_run_exit_codes_and_json() {
    let _g = common_serial();
    let fx = Fx::new();
    fx.s("a", "dsh-tui", H8, cols(CR, 100), 5);
    fx.o("a", "dsh-tui", H8, cols(CR, 160), 5);
    let run = |extra: &[&str]| {
        std::process::Command::new(env!("CARGO_BIN_EXE_usagemeter"))
            .arg("repair")
            .arg("--against")
            .arg(&fx.oracle)
            .args(extra)
            .env("METER_STATE_DIR", &fx.store)
            .output()
            .unwrap()
    };
    let out = run(&["--json"]);
    assert_eq!(out.status.code(), Some(0));
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["total"]["change"], 60);
    assert_eq!(v["conservation"]["pass"], true);
    assert_eq!(run(&[]).status.code(), Some(0));
    assert_eq!(run(&["--from", "2026-11-09"]).status.code(), Some(3));
    assert_eq!(run(&["--from", "nonsense"]).status.code(), Some(2));
    assert_eq!(run(&["--apply"]).status.code(), Some(2));
}

fn common_serial() -> impl Drop {
    // One lock-taking test at a time: the apply tests take the store's sync lock.
    static M: std::sync::Mutex<()> = std::sync::Mutex::new(());
    M.lock().unwrap_or_else(|e| e.into_inner())
}
