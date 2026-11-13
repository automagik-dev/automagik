//! `usagemeter repair` (issue 1126) on fixture stores in temp dirs. Synthetic rows only.

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use meter::repair::{self, Copy, Opts, exit};
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
    _envs: [common::Env; 2],
    store: PathBuf,
    oracle: PathBuf,
    scratch: PathBuf,
}

impl Fx {
    fn new() -> Fx {
        let dir = tempfile::tempdir().unwrap();
        // The real schema path: a sync of an empty home, so every table sync makes (the outcomes
        // `pr` table, `WITHOUT ROWID`, included) is in the fixture store.
        let mk = || {
            let env = common::Env::new();
            env.run(&env.opts());
            env
        };
        let envs = [mk(), mk()];
        let (store, oracle) = (envs[0].state(), envs[1].state());
        let scratch = dir.path().join("scratch");
        fs::create_dir_all(&scratch).unwrap();
        Fx {
            _dir: dir,
            _envs: envs,
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
        let mut a: Vec<String> = vec![
            "--store".into(),
            self.store.display().to_string(),
            "--against".into(),
            self.oracle.display().to_string(),
        ];
        a.extend(extra.iter().map(|s| s.to_string()));
        repair::parse(&a, NOW).unwrap()
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
    // The attributed row is unchanged in every column and in events.
    let row = |id: &str| -> ([i64; 7], i64) {
        let names = repair::COLS.join(", ");
        Fx::conn(&fx.store)
            .query_row(
                &format!("SELECT {names}, events FROM usage WHERE id = ?1"),
                [id],
                |r| {
                    let mut v = [0i64; 7];
                    for (i, x) in v.iter_mut().enumerate() {
                        *x = r.get(i)?;
                    }
                    Ok((v, r.get(7)?))
                },
            )
            .unwrap()
    };
    assert_eq!(row("att"), (cols(CR, 100), 3));
    // The recovered tokens (30 input_uncached: 10 held, 20 recovered) sit in the evidence-free
    // rows, taken together: the top-up goes to the largest of them.
    let (free, in_row) = (row("free"), row("in"));
    let both: [i64; 7] = std::array::from_fn(|i| free.0[i] + in_row.0[i]);
    let mut want = cols(CR, 50);
    want[IN] = 30;
    assert_eq!(both, want);
    assert_eq!(free.1 + in_row.1, 2);
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
    // A second group in the same day: a change that tops up the wrong group's row writes the
    // row, but the day's own group comparison catches it and rolls the day back.
    fx.s("other", "dsh-tui", "2026-11-08T14:00:00Z", cols(CR, 40), 1);
    fx.o("other", "dsh-tui", "2026-11-08T14:00:00Z", cols(CR, 40), 1);
    let c = fx.copy("c.db");
    let o = fx.apply_opts(&[], &c);
    let mut rep = repair::execute(&fx.opts(&[])).unwrap().report;
    assert_eq!(rep.changes.len(), 1);
    rep.changes[0].id = "other".into();
    let h = Fx::db_hash(&fx.store);
    match repair::apply(&o, &c, &rep, usize::MAX) {
        Err(e) => {
            assert!(e.contains("not what the plan says"), "{e}");
            assert!(e.contains("rolled back"), "{e}");
        }
        Ok(days) => panic!("the day was committed: {days:?}"),
    }
    assert_eq!(Fx::db_hash(&fx.store), h);
    assert_eq!(fx.journal(), None);
    // A change whose row is gone is refused the same way.
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
    let files_before = {
        let mut v: Vec<String> = fs::read_dir(&fx.store)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| !n.ends_with("-wal") && !n.ends_with("-shm"))
            .collect();
        v.sort();
        v
    };
    let d = repair::execute(&fx.opts(&["--dry-run"])).unwrap();
    assert_eq!(d.code, exit::OK);
    assert_eq!(Fx::db_hash(&fx.store), hs);
    assert_eq!(Fx::db_hash(&fx.oracle), ho);
    // No file is added to the store's folder but SQLite's own read-only companions.
    let files = |d: &Path| -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(d)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| !n.ends_with("-wal") && !n.ends_with("-shm"))
            .collect();
        v.sort();
        v
    };
    assert_eq!(files(&fx.store), files_before);
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
    let a: Vec<String> = [
        "--store",
        fx.store.to_str().unwrap(),
        "--against",
        fx.oracle.to_str().unwrap(),
        "--apply",
    ]
    .map(String::from)
    .to_vec();
    assert!(repair::parse(&a, NOW).is_err());
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
            .arg("--store")
            .arg(&fx.store)
            .arg("--against")
            .arg(&fx.oracle)
            .args(extra)
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
    // The plan names the store.
    assert_eq!(v["store"], fx.store.display().to_string());
    let text = String::from_utf8(run(&[]).stdout).unwrap();
    assert!(text.contains(&fx.store.display().to_string()), "{text}");
    // No --store: a usage error, even with METER_STATE_DIR set to a real store.
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_usagemeter"))
        .arg("repair")
        .arg("--against")
        .arg(&fx.oracle)
        .env("METER_STATE_DIR", &fx.store)
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("--store"));
}

#[test]
fn the_store_is_an_explicit_argument() {
    let a: Vec<String> = ["--against", "oracle"].map(String::from).to_vec();
    let e = repair::parse(&a, NOW).unwrap_err();
    assert!(e.contains("--store"), "{e}");
}

#[test]
fn a_narrowed_apply_does_not_lock_out_the_earlier_days() {
    let _g = common_serial();
    let fx = Fx::new();
    fx.s("a", "dsh-tui", H8, cols(CR, 10), 1);
    fx.o("a", "dsh-tui", H8, cols(CR, 25), 1);
    fx.s("b", "dsh-tui", H9, cols(CR, 10), 1);
    fx.o("b", "dsh-tui", H9, cols(CR, 25), 1);
    let c = fx.copy("c.db");
    // The later day first, as a careful operator would.
    let d = repair::execute(&fx.apply_opts(&["--from", "2026-11-09", "--until", "2026-11-09"], &c))
        .unwrap();
    assert_eq!(
        (d.code, d.applied_days),
        (exit::OK, vec!["2026-11-09".to_string()])
    );
    assert_eq!(Fx::col(&fx.store, "dsh-tui", H8, CR), 10);
    // Then the default range: the earlier day is still planned, written and reported.
    let d = repair::execute(&fx.apply_opts(&[], &c)).unwrap();
    assert_eq!(d.code, exit::OK);
    assert_eq!(d.report.total_change(), 15);
    assert_eq!(d.applied_days, vec!["2026-11-08"]);
    assert_eq!(Fx::col(&fx.store, "dsh-tui", H8, CR), 25);
    assert_eq!(Fx::col(&fx.store, "dsh-tui", H9, CR), 25);
    assert_eq!(
        repair::execute(&fx.apply_opts(&[], &c)).unwrap().code,
        exit::NOTHING
    );
}

#[test]
fn a_short_group_with_no_evidence_free_row_is_unresolved_not_topped_up() {
    let _g = common_serial();
    let fx = Fx::new();
    // Two attributed rows, none evidence-free: 100 + 40 against 200.
    Fx::put(
        &fx.store,
        "t1",
        "claude-code",
        H8,
        cols(CR, 100),
        3,
        Some("attributed"),
    );
    Fx::put(
        &fx.store,
        "t2",
        "claude-code",
        H8,
        cols(CR, 40),
        2,
        Some("attributed"),
    );
    fx.o("o1", "claude-code", H8, cols(CR, 200), 5);
    // And a normal short group beside it.
    fx.s("n", "dsh-tui", H9, cols(CR, 10), 1);
    fx.o("n", "dsh-tui", H9, cols(CR, 30), 1);
    let d = repair::execute(&fx.opts(&[])).unwrap();
    assert_eq!(d.code, exit::OK, "{}", d.report.to_text(d.code));
    assert_eq!(d.report.total_change(), 20, "the 60 are not in the change");
    let j = d.report.to_json(d.code);
    assert_eq!(j["unresolved_groups"][0]["tokens"], 60);
    assert_eq!(j["unresolved_groups"][0]["reason"], "no_evidence_free_row");
    assert_eq!(j["targets"]["state"], "before_evidence");
    assert!(d.report.to_text(d.code).contains("no evidence-free row"));
    let c = fx.copy("c.db");
    repair::execute(&fx.apply_opts(&[], &c)).unwrap();
    // The attributed rows are as they were; the other group was topped up.
    let all = |id: &str| -> i64 {
        Fx::conn(&fx.store)
            .query_row("SELECT cache_read FROM usage WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap()
    };
    assert_eq!((all("t1"), all("t2")), (100, 40));
    assert_eq!(Fx::col(&fx.store, "dsh-tui", H9, CR), 30);
    // Alone, the group is nothing to repair.
    let fx = Fx::new();
    Fx::put(
        &fx.store,
        "t1",
        "claude-code",
        H8,
        cols(CR, 100),
        3,
        Some("attributed"),
    );
    fx.o("o1", "claude-code", H8, cols(CR, 200), 3);
    assert_eq!(repair::execute(&fx.opts(&[])).unwrap().code, exit::NOTHING);
}

#[test]
fn totals_add_the_six_counted_columns_and_never_reasoning() {
    let _g = common_serial();
    let fx = Fx::new();
    let mut s = [0; 7];
    s[4] = 100; // output
    s[5] = 40; // reasoning, inside output
    let mut o = [0; 7];
    o[4] = 150;
    o[5] = 60;
    fx.s("a", "claude-code", H8, s, 1);
    fx.o("a", "claude-code", H8, o, 1);
    // An unresolved hour holding output 10, reasoning 5: 10 tokens, not 15.
    let mut u = [0; 7];
    u[4] = 10;
    u[5] = 5;
    fx.s("u", "claude-code", H9, u, 1);
    // Kept: the store's reasoning (30) is above the oracle's (0), its output is equal: 0 counted.
    let mut k = [0; 7];
    k[4] = 5;
    k[5] = 30;
    fx.s("k", "omp", H8, k, 1);
    let mut k0 = [0; 7];
    k0[4] = 5;
    fx.o("k", "omp", H8, k0, 1);
    // Outside the range: the oracle's reasoning is above the store's (20), output equal: 0 counted.
    let out = "2026-11-01T10:00:00Z";
    fx.s("x", "omp", out, cols(4, 7), 1);
    let mut x = cols(4, 7);
    x[5] = 20;
    fx.o("x", "omp", out, x, 1);
    let d = repair::execute(&fx.opts(&[])).unwrap();
    assert_eq!(d.report.kept_tokens(), 0);
    assert!(
        d.report.to_json(d.code)["outside_range"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(d.report.total_change(), 50);
    assert_eq!(d.report.total_before(), 115);
    assert_eq!(d.report.unresolved_tokens(), 10);
    let j = d.report.to_json(d.code);
    assert_eq!(j["total"]["change"], 50);
    assert_eq!(j["total"]["before"], 115);
    // Reasoning is still a repaired column in the per-column lines.
    let cells = j["cells"].as_array().unwrap();
    let r = cells.iter().find(|c| c["column"] == "reasoning").unwrap();
    assert_eq!(r["change"], 20);
}

fn common_serial() -> impl Drop {
    // One lock-taking test at a time: the apply tests take the store's sync lock.
    static M: std::sync::Mutex<()> = std::sync::Mutex::new(());
    M.lock().unwrap_or_else(|e| e.into_inner())
}

#[test]
fn a_store_made_by_sync_applies_end_to_end_and_every_table_hashes() {
    let _g = common_serial();
    let fx = Fx::new();
    // What sync made: every table the real schema path creates, `pr` (WITHOUT ROWID) included.
    let tables: Vec<String> = Fx::conn(&fx.store)
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    for t in [
        "pr",
        "ev_error",
        "evidence",
        "launch",
        "link",
        "ev_dim",
        "ev_actor",
        "ev_cwd",
        "ledgers",
        "meta",
        "usage",
        "files",
        "seen",
        "sessions",
        "cwd_repo",
        "health",
        "codex_threads",
    ] {
        assert!(tables.iter().any(|x| x == t), "{t} missing from {tables:?}");
    }
    let c = Fx::conn(&fx.store);
    c.execute(
        "INSERT INTO pr(project, branch, pr, state, at_ms) VALUES ('p', 'b', 1, 'open', 1)",
        [],
    )
    .unwrap();
    drop(c);
    // Every table hashes, the hash is stable, and a change to a `pr` row changes it.
    let db = fx.store.join("meter.db");
    let h = repair::fingerprint_file(&db, 0, 1).unwrap();
    assert_eq!(repair::fingerprint_file(&db, 0, 1).unwrap(), h);
    Fx::conn(&fx.store)
        .execute("UPDATE pr SET state = 'merged'", [])
        .unwrap();
    assert_ne!(repair::fingerprint_file(&db, 0, 1).unwrap(), h);
    // And a repair runs on it.
    fx.s("a", "dsh-tui", H8, cols(CR, 100), 5);
    fx.o("a", "dsh-tui", H8, cols(CR, 160), 5);
    let c = fx.copy("c.db");
    let d = repair::execute(&fx.apply_opts(&[], &c)).unwrap();
    assert_eq!(d.code, exit::OK);
    assert_eq!(d.applied_days, vec!["2026-11-08"]);
    assert_eq!(Fx::col(&fx.store, "dsh-tui", H8, CR), 160);
}

#[test]
fn the_copy_must_be_a_separate_file() {
    let _g = common_serial();
    let fx = Fx::new();
    fx.s("a", "dsh-tui", H8, cols(CR, 100), 5);
    fx.o("a", "dsh-tui", H8, cols(CR, 160), 5);
    let db = fx.store.join("meter.db");
    let sha = meter::event::hex(&Sha256::digest(fs::read(&db).unwrap()));
    let h = Fx::db_hash(&fx.store);
    let refused = |path: PathBuf, what: &str| {
        let c = Copy {
            path,
            sha256: sha.clone(),
        };
        match repair::execute(&fx.apply_opts(&[], &c)) {
            Err(e) => assert!(e.contains("copy"), "{what}: {e}"),
            Ok(d) => panic!("{what}: applied, code {}", d.code),
        }
        assert_eq!(Fx::db_hash(&fx.store), h, "{what}");
    };
    // The same bytes and sha256, by every way a path can name the store.
    let sym = fx.scratch.join("sym.db");
    std::os::unix::fs::symlink(&db, &sym).unwrap();
    refused(sym, "symlink");
    let hard = fx.scratch.join("hard.db");
    fs::hard_link(&db, &hard).unwrap();
    refused(hard, "hard link");
    refused(fx.store.join(".").join("meter.db"), "./ spelling");
    refused(db.clone(), "the store itself");
    // A real, separate copy passes.
    let c = fx.copy("real.db");
    assert_eq!(
        repair::execute(&fx.apply_opts(&[], &c)).unwrap().code,
        exit::OK
    );
}

#[test]
fn a_reasoning_only_gap_is_printed_and_applied_not_dropped() {
    let _g = common_serial();
    let fx = Fx::new();
    let mut s = [0; 7];
    s[4] = 100;
    s[5] = 10;
    let mut o = s;
    o[5] = 40;
    fx.s("a", "claude-code", H8, s, 1);
    fx.o("a", "claude-code", H8, o, 1);
    // The dry run prints the change and its exit agrees: a plan (0), not "nothing to repair" (3).
    let d = repair::execute(&fx.opts(&[])).unwrap();
    assert_eq!(d.code, exit::OK, "{}", d.report.to_text(d.code));
    assert_eq!(d.report.total_change(), 0, "reasoning is never in a total");
    let j = d.report.to_json(d.code);
    assert_eq!(j["cells"][0]["column"], "reasoning");
    assert_eq!(j["cells"][0]["change"], 30);
    // The apply writes it.
    let c = fx.copy("c.db");
    let d = repair::execute(&fx.apply_opts(&[], &c)).unwrap();
    assert_eq!(d.code, exit::OK);
    assert_eq!(d.applied_days, vec!["2026-11-08"]);
    assert_eq!(Fx::col(&fx.store, "claude-code", H8, 5), 40);
    assert_eq!(Fx::col(&fx.store, "claude-code", H8, 4), 100);
    // Then nothing is left.
    assert_eq!(
        repair::execute(&fx.apply_opts(&[], &c)).unwrap().code,
        exit::NOTHING
    );
}

/// What a refused apply must not change in the store's folder: every file but the database and
/// SQLite's own companions, by name, size and mtime.
fn listing(dir: &Path) -> Vec<(String, u64, std::time::SystemTime)> {
    let mut v: Vec<_> = fs::read_dir(dir)
        .unwrap()
        .map(|e| {
            let e = e.unwrap();
            let m = e.metadata().unwrap();
            (
                e.file_name().to_string_lossy().into_owned(),
                m.len(),
                m.modified().unwrap(),
            )
        })
        .filter(|(n, _, _)| !n.starts_with("meter.db"))
        .collect();
    v.sort();
    v
}

#[test]
fn a_refused_apply_leaves_nothing_behind_in_the_store_folder() {
    let _g = common_serial();
    // Each refusal path, on a store with its lock file (a synced store has one) and on one
    // without: the folder listing is identical before and after, and the store is unchanged.
    for with_lock in [true, false] {
        let fx = Fx::new();
        fx.s("a", "dsh-tui", H8, cols(CR, 100), 5);
        fx.o("a", "dsh-tui", H8, cols(CR, 160), 5);
        let good = fx.copy("good.db");
        if !with_lock {
            fs::remove_file(fx.store.join("meter.lock")).unwrap();
        }
        let db = fx.store.join("meter.db");
        let sha = |p: &Path| meter::event::hex(&Sha256::digest(fs::read(p).unwrap()));
        let notdb = fx.scratch.join("notdb.db");
        fs::write(&notdb, b"not a database").unwrap();
        let hard = fx.scratch.join("hard.db");
        fs::hard_link(&db, &hard).unwrap();
        let copies: Vec<(&str, Copy)> = vec![
            (
                "wrong sha",
                Copy {
                    path: good.path.clone(),
                    sha256: "0".repeat(64),
                },
            ),
            (
                "missing copy",
                Copy {
                    path: fx.scratch.join("nope.db"),
                    sha256: good.sha256.clone(),
                },
            ),
            (
                "not a database",
                Copy {
                    sha256: sha(&notdb),
                    path: notdb,
                },
            ),
            (
                "hard link",
                Copy {
                    sha256: sha(&hard),
                    path: hard,
                },
            ),
        ];
        let (before, h) = (listing(&fx.store), Fx::db_hash(&fx.store));
        for (what, c) in copies {
            assert!(repair::execute(&fx.apply_opts(&[], &c)).is_err(), "{what}");
            assert_eq!(listing(&fx.store), before, "{what} (lock file {with_lock})");
            assert_eq!(Fx::db_hash(&fx.store), h, "{what}");
        }
        // A copy that no longer matches the store's rows (taken, then the store grew).
        let stale = fx.copy("stale.db");
        fx.s("x", "omp", H9, cols(IN, 1), 1);
        let (before, h) = (listing(&fx.store), Fx::db_hash(&fx.store));
        assert!(
            repair::execute(&fx.apply_opts(&[], &stale)).is_err(),
            "stale"
        );
        assert_eq!(listing(&fx.store), before, "stale (lock file {with_lock})");
        assert_eq!(Fx::db_hash(&fx.store), h);
        // Conservation fails (events differ): refused before any lock.
        fx.o("e", "dsh-tui", H9, cols(CR, 9), 2);
        fx.s("e", "dsh-tui", H9, cols(CR, 3), 1);
        let (before, h) = (listing(&fx.store), Fx::db_hash(&fx.store));
        let d = repair::execute(&fx.apply_opts(&[], &good)).unwrap();
        assert_eq!(d.code, exit::CONSERVATION);
        assert_eq!(
            listing(&fx.store),
            before,
            "conservation (lock file {with_lock})"
        );
        assert_eq!(Fx::db_hash(&fx.store), h);
        // A newer store: refused before any lock.
        Fx::conn(&fx.store)
            .execute("UPDATE meta SET v = '99' WHERE k = 'schema_version'", [])
            .unwrap();
        let (before, h) = (listing(&fx.store), Fx::db_hash(&fx.store));
        let d = repair::execute(&fx.apply_opts(&[], &good)).unwrap();
        assert_eq!(d.code, exit::NEWER_SCHEMA);
        assert_eq!(
            listing(&fx.store),
            before,
            "newer schema (lock file {with_lock})"
        );
        assert_eq!(Fx::db_hash(&fx.store), h);
    }
}
