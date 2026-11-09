//! The crate's contract test for `usagemeter query`, contract 1 (RFC 0018, slice M1).
//!
//! - Every example in `meter/schema/query/v1/examples/` validates against the schema.
//! - Each example's store is built from synthetic logs by a real `sync`, the query runs at the
//!   example's `generated_at`, and its answer must equal the example. Only `meter_version` is
//!   set to the example's: the timestamps match too, because every sync and query runs at the
//!   example's clock. `UPDATE_QUERY_EXAMPLES=1` rewrites the examples from the meter instead.
//! - `repo-normalization.json` matches the meter's remote normalization.
//! - The byte budget, the refusals' nulls, and the rules that keep unknown apart from zero.
//!
//! Synthetic data only: `example.com` repos, made-up branches, session and thread ids.
//! Spawns the binary, so every spawn and every sync runs under [`serial`] (a child between its
//! fork and its exec would share a sync's lock).

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::time::Duration;

use common::schema::{Schema, same};
use common::{Env, serial};
use meter::paths::StateDirs;
use meter::query::{self, Ctx};
use meter::store::Store;
use meter::sync::{Outcome, Report};
use meter::time::{HOUR_MS, format_rfc3339, parse_rfc3339};
use rusqlite::{Connection, params};
use serde_json::{Value, json};

const REPO: &str = "example.com/acme/widgets";
const CWD: &str = "/work/widgets";
const REMOTE: &str = "https://example.com/acme/widgets.git";
const MACHINE: &str = "machine-a1b2c3";
const GENERATED: &str = "2026-11-08T20:00:05Z";
const SYNCED: &str = "2026-11-08T19:52:41Z";
const EXAMPLE_VERSION: &str = "3.107.0";
const CLAUDE_MODEL: &str = "claude-opus-5-5";
const CODEX_MODEL: &str = "gpt-6.1-sol";

fn t(s: &str) -> i64 {
    parse_rfc3339(s).unwrap_or_else(|| panic!("bad time {s}"))
}

fn v1() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../schema/query/v1")
}

fn schema() -> Schema {
    let text = fs::read_to_string(v1().join("envelope.schema.json")).unwrap();
    Schema::new(serde_json::from_str(&text).unwrap())
}

fn example_names() -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(v1().join("examples"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .map(|n| n.trim_end_matches(".json").to_string())
        .collect();
    v.sort();
    v
}

fn example(name: &str) -> Value {
    let p = v1().join("examples").join(format!("{name}.json"));
    serde_json::from_str(&fs::read_to_string(&p).unwrap()).unwrap()
}

// ---------------------------------------------------------------------------------------------
// Fixtures.

/// Tokens of one kind each: input, cache read, cache write 5m and 1h, output, reasoning.
type Split = [i64; 6];

struct Fx {
    env: Env,
    legacy: Option<PathBuf>,
    lines: Vec<String>,
    omp_lines: Vec<String>,
    n: usize,
}

impl Fx {
    /// A store made ready for its first sync at `first_sync`: this machine's id, and the repo of
    /// the synthetic checkout, as the git lookup would have cached it.
    fn new(first_sync: &str) -> Fx {
        let env = Env::new();
        let db = meter::paths::prepare(&env.state()).unwrap();
        let s = Store::open(&db).unwrap();
        s.set_meta("machine", MACHINE).unwrap();
        s.cache_repo(CWD, Some(REPO), t(first_sync)).unwrap();
        drop(s);
        Fx {
            env,
            legacy: None,
            lines: Vec::new(),
            omp_lines: Vec::new(),
            n: 0,
        }
    }

    fn home(&self) -> PathBuf {
        self.env.home()
    }

    fn omp_root(&self) {
        fs::create_dir_all(self.home().join(".omp/agent/sessions")).unwrap();
    }

    fn claude_root(&self) {
        fs::create_dir_all(self.home().join(".claude/projects")).unwrap();
    }

    /// A Codex state database with every column the meter needs, or without `drop` columns.
    fn codex_db(&self, drop: &[&str]) -> Connection {
        let home = self.home().join(".codex");
        fs::create_dir_all(&home).unwrap();
        let mut cols = vec![
            "id TEXT PRIMARY KEY",
            "rollout_path TEXT NOT NULL",
            "cwd TEXT NOT NULL",
            "tokens_used INTEGER NOT NULL DEFAULT 0",
            "archived INTEGER NOT NULL DEFAULT 0",
            "git_branch TEXT",
            "git_origin_url TEXT",
            "model TEXT",
            "updated_at_ms INTEGER",
        ];
        cols.retain(|c| !drop.iter().any(|d| c.starts_with(d)));
        let c = Connection::open(home.join("state_5.sqlite")).unwrap();
        c.execute_batch(&format!(
            "CREATE TABLE threads ({});
             CREATE TABLE thread_spawn_edges (parent_thread_id TEXT NOT NULL,
               child_thread_id TEXT NOT NULL PRIMARY KEY, status TEXT NOT NULL);",
            cols.join(", ")
        ))
        .unwrap();
        c
    }

    /// One Claude Code call on `branch` at `at`.
    fn claude(&mut self, branch: &str, model: &str, at: i64, s: Split) {
        self.n += 1;
        let n = self.n;
        self.lines.push(format!(
            concat!(
                r#"{{"type":"assistant","requestId":"req_q{n}","timestamp":"{ts}","#,
                r#""sessionId":"sess-q","cwd":"{cwd}","gitBranch":"{branch}","#,
                r#""message":{{"id":"msg_q{n}","model":"{model}","role":"assistant","#,
                r#""content":[{{"type":"text","text":"FAKE-TEXT"}}],"#,
                r#""usage":{{"input_tokens":{i},"output_tokens":{o},"#,
                r#""cache_read_input_tokens":{r},"cache_creation_input_tokens":{w},"#,
                r#""cache_creation":{{"ephemeral_5m_input_tokens":{w5},"#,
                r#""ephemeral_1h_input_tokens":{w1}}},"#,
                r#""output_tokens_details":{{"thinking_tokens":{rs}}}}}}}}}"#
            ),
            n = n,
            ts = format_rfc3339(at + 15 * 60 * 1000),
            cwd = CWD,
            branch = branch.replace('"', "\\\""),
            model = model,
            i = s[0],
            r = s[1],
            w = s[2] + s[3],
            w5 = s[2],
            w1 = s[3],
            o = s[4],
            rs = s[5],
        ));
    }

    /// `total` spread over one call per hour; the first hour takes the remainder.
    fn claude_spread(&mut self, branch: &str, model: &str, hours: &[i64], total: Split) {
        let n = hours.len() as i64;
        for (k, h) in hours.iter().enumerate() {
            let mut s = [0; 6];
            for i in 0..6 {
                s[i] = total[i] / n + if k == 0 { total[i] % n } else { 0 };
            }
            self.claude(branch, model, *h, s);
        }
    }

    fn write_claude(&self) {
        if self.lines.is_empty() {
            return;
        }
        let p = self.env.claude("-work-widgets/sess-q.jsonl");
        common::write_lines(&p, &self.lines);
    }

    /// One OMP call with no branch (OMP logs none).
    fn omp(&mut self, at: i64, input: i64, output: i64, cache_read: i64) {
        self.n += 1;
        if self.omp_lines.is_empty() {
            self.omp_lines.push(format!(
                r#"{{"type":"session","version":3,"id":"omp-sess-q","timestamp":"{}","cwd":"{CWD}"}}"#,
                format_rfc3339(at)
            ));
        }
        self.omp_lines.push(format!(
            concat!(
                r#"{{"type":"message","id":"e{n}","timestamp":"{ts}","message":{{"role":"assistant","#,
                r#""model":"{m}","content":[{{"type":"text","text":"FAKE"}}],"usage":{{"input":{i},"#,
                r#""output":{o},"cacheRead":{r},"cacheWrite":0,"totalTokens":{tt}}}}}}}"#
            ),
            n = self.n,
            ts = format_rfc3339(at + 10 * 60 * 1000),
            m = CLAUDE_MODEL,
            i = input,
            o = output,
            r = cache_read,
            tt = input + output + cache_read,
        ));
        let p = self.env.omp("-work-widgets/2026-11-08_sess.jsonl");
        common::write_lines(&p, &self.omp_lines);
    }

    /// A Codex thread on `branch` whose rollout holds one running total at `at` (exact), or with
    /// no rollout at all, so its `tokens_used` is counted as `total_only` at `at`.
    #[allow(clippy::too_many_arguments)]
    fn codex(
        &self,
        db: &Connection,
        id: &str,
        branch: &str,
        at: i64,
        exact: Option<(i64, i64, i64, i64)>,
        tokens_used: i64,
    ) {
        let rollout = self
            .home()
            .join(".codex/sessions/2026/11/01")
            .join(format!("rollout-2026-11-01T00-00-00-{id}.jsonl"));
        if let Some((uncached, cached, output, reasoning)) = exact {
            fs::create_dir_all(rollout.parent().unwrap()).unwrap();
            let input = uncached + cached;
            let line = format!(
                concat!(
                    r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","#,
                    r#""info":{{"total_token_usage":{{"input_tokens":{i},"cached_input_tokens":{c},"#,
                    r#""output_tokens":{o},"reasoning_output_tokens":{r},"total_tokens":{tt}}}}}}}}}"#
                ),
                ts = format_rfc3339(at + 20 * 60 * 1000),
                i = input,
                c = cached,
                o = output,
                r = reasoning,
                tt = input + output,
            );
            common::write_lines(&rollout, &[line]);
        }
        db.execute(
            "INSERT INTO threads(id, rollout_path, cwd, tokens_used, git_branch, git_origin_url,
               model, updated_at_ms) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                rollout.to_string_lossy(),
                CWD,
                tokens_used,
                branch,
                REMOTE,
                CODEX_MODEL,
                at + 30 * 60 * 1000
            ],
        )
        .unwrap();
    }

    fn sync(&self, at: &str, days: i64) -> Report {
        self.write_claude();
        let _g = serial();
        let mut o = self.env.opts();
        o.now_ms = t(at);
        o.days = Some(days);
        self.env.run(&o)
    }

    fn ctx(&self, at: &str) -> Ctx {
        Ctx {
            state: Some(StateDirs {
                dir: self.env.state(),
                legacy: self.legacy.clone(),
            }),
            overridden: false,
            now_ms: t(at),
            busy: Duration::from_secs(2),
            meter_version: EXAMPLE_VERSION.into(),
        }
    }

    fn query(&self, args: &[String]) -> (u8, Value) {
        let (code, raw) = self.query_raw(args);
        (code, serde_json::from_str(&raw).unwrap())
    }

    /// The exit code and stdout as the meter wrote it: one line of compact JSON.
    fn query_raw(&self, args: &[String]) -> (u8, String) {
        let a = query::run(args, &self.ctx(GENERATED));
        assert!(a.stdout.ends_with('\n') && !a.stdout[..a.stdout.len() - 1].contains('\n'));
        (a.code, a.stdout)
    }

    fn db(&self) -> PathBuf {
        self.env.state().join("meter.db")
    }
}

fn args(branches: &[&str]) -> Vec<String> {
    let mut v = vec!["--repo".to_string(), REPO.to_string()];
    for b in branches {
        v.push("--branch".into());
        v.push(b.to_string());
    }
    v.push("--json".into());
    v
}

fn owned(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

/// `n` distinct hours from `first` to `last`, both included.
fn hours(first: &str, last: &str, n: usize) -> Vec<i64> {
    let (a, b) = (t(first), t(last));
    if n == 1 {
        return vec![a];
    }
    let step = ((b - a) / HOUR_MS) / (n as i64 - 1);
    assert!(step >= 1);
    let mut v: Vec<i64> = (0..n as i64 - 1).map(|k| a + k * step * HOUR_MS).collect();
    v.push(b);
    v
}

/// A store with every source healthy (OMP's folder and Codex's database exist).
fn healthy(fx: &Fx) -> Connection {
    fx.omp_root();
    fx.claude_root();
    fx.codex_db(&[])
}

/// The many names of `request-too-large.json`: 500 of 203 bytes each.
fn big_names() -> Vec<String> {
    (0..500)
        .map(|i| format!("feat/gn-{}-{}", 1000 + i, "données-de-mesure-".repeat(10)))
        .collect()
}

/// The names of `too-large.json`: 500 of 128 bytes each.
fn wide_names() -> Vec<String> {
    (0..500)
        .map(|i| {
            let mut s = format!("feat/gn-{}-", 2000 + i);
            while s.len() < 128 {
                s.push_str("widget-pipeline-stage-");
            }
            s.truncate(128);
            s
        })
        .collect()
}

/// A store at the examples' clock with one measured branch, for the refusal examples.
fn plain_store() -> Fx {
    let mut fx = Fx::new(SYNCED);
    healthy(&fx);
    fx.claude(
        "feat/gn-12-cache",
        CLAUDE_MODEL,
        t("2026-11-08T10:00:00Z"),
        [100, 1000, 10, 0, 50, 0],
    );
    fx.sync(SYNCED, 60);
    fx
}

/// Builds the example's store and returns the query's answer as the meter wrote it.
fn scenario_raw(name: &str) -> (u8, String) {
    let d = 60;
    match name {
        "priced" => {
            let mut fx = Fx::new(SYNCED);
            let codex = healthy(&fx);
            let h = hours("2026-11-02T09:00:00Z", "2026-11-08T19:00:00Z", 17);
            fx.claude_spread(
                "feat/gn-12-cache",
                CLAUDE_MODEL,
                &h,
                [120000, 2400000, 180000, 0, 64000, 12000],
            );
            let h2: Vec<i64> = [
                "2026-11-06T13:00:00Z",
                "2026-11-06T18:00:00Z",
                "2026-11-07T15:00:00Z",
                "2026-11-08T09:00:00Z",
                "2026-11-08T11:00:00Z",
            ]
            .iter()
            .map(|s| t(s))
            .collect();
            fx.claude_spread(
                "fix/gn-14-retry",
                CLAUDE_MODEL,
                &h2,
                [20000, 300000, 20000, 10000, 10000, 0],
            );
            fx.codex(
                &codex,
                "t-q14",
                "fix/gn-14-retry",
                t("2026-11-07T10:00:00Z"),
                Some((10000, 100000, 5000, 0)),
                115000,
            );
            fx.sync(SYNCED, d);
            fx.query_raw(&args(&["feat/gn-12-cache", "fix/gn-14-retry"]))
        }
        "partial-priced" => {
            let mut fx = Fx::new(SYNCED);
            let codex = healthy(&fx);
            let h = hours("2026-10-30T08:00:00Z", "2026-11-08T18:00:00Z", 23);
            let priced: Vec<i64> = h
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != 1 && *i != 11)
                .map(|(_, h)| *h)
                .collect();
            fx.claude_spread(
                "feat/gn-21-parser",
                CLAUDE_MODEL,
                &priced,
                [45000, 885000, 40000, 0, 30000, 5000],
            );
            fx.claude(
                "feat/gn-21-parser",
                "acme-local-7b",
                h[1],
                [5000, 15000, 0, 0, 0, 0],
            );
            fx.codex(&codex, "t-q21", "feat/gn-21-parser", h[11], None, 260000);
            fx.sync(SYNCED, d);
            fx.query_raw(&args(&["feat/gn-21-parser"]))
        }
        "missing-branch" => {
            let mut fx = Fx::new(SYNCED);
            healthy(&fx);
            let h = hours("2026-11-07T10:00:00Z", "2026-11-08T16:00:00Z", 4);
            fx.claude_spread(
                "feat/gn-77-export",
                CLAUDE_MODEL,
                &h,
                [8000, 150000, 12000, 0, 6000, 1000],
            );
            fx.sync(SYNCED, 15);
            fx.query_raw(&args(&["feat/gn-77-export", "fix/gn-78-typo"]))
        }
        "stale-source" => {
            // Codex was read last on 11-05; the last sync (11-07 14:10) found its database
            // unreadable; nothing synced since, 30 hours ago. OMP is not on this machine.
            let mut fx = Fx::new("2026-11-05T09:00:00Z");
            fx.codex_db(&[]);
            fx.sync("2026-11-05T09:00:00Z", 57);
            fs::write(
                fx.home().join(".codex/state_5.sqlite"),
                b"not a database, not even close",
            )
            .unwrap();
            let h = hours("2026-11-01T09:00:00Z", "2026-11-07T13:00:00Z", 12);
            fx.claude_spread(
                "feat/gn-55-sync",
                CLAUDE_MODEL,
                &h,
                [25000, 500000, 30000, 0, 12000, 2000],
            );
            fx.sync("2026-11-07T14:10:00Z", 59);
            // A stale row with nothing found carries no number at all.
            fx.query_raw(&args(&["feat/gn-55-sync", "fix/gn-56-idle"]))
        }
        "ambiguous-branch" => {
            let mut fx = Fx::new(SYNCED);
            let codex = healthy(&fx);
            let h = hours("2026-11-03T08:00:00Z", "2026-11-08T17:00:00Z", 15);
            let claude: Vec<i64> = h
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != 7)
                .map(|(_, h)| *h)
                .collect();
            fx.claude_spread(
                "feat/gn-31-search",
                CLAUDE_MODEL,
                &claude,
                [30000, 600000, 60000, 0, 20000, 4000],
            );
            fx.codex(
                &codex,
                "t-q31",
                "feat/gn-31-search",
                h[7],
                Some((10000, 200000, 2000, 0)),
                212000,
            );
            let h2: Vec<i64> = [
                "2026-11-08T09:00:00Z",
                "2026-11-08T10:00:00Z",
                "2026-11-08T12:00:00Z",
            ]
            .iter()
            .map(|s| t(s))
            .collect();
            fx.claude_spread(
                "fix/gn-40-login",
                CLAUDE_MODEL,
                &h2,
                [10000, 200000, 15000, 0, 5000, 0],
            );
            fx.sync(SYNCED, d);
            fx.query_raw(&args(&[
                "feat/gn-31-search",
                "feat/gn-31-search",
                "fix/gn-40-login",
            ]))
        }
        "zero-usage" => {
            let mut fx = Fx::new(SYNCED);
            healthy(&fx);
            fx.claude(
                "main",
                CLAUDE_MODEL,
                t("2026-11-08T08:00:00Z"),
                [100, 2000, 0, 0, 300, 0],
            );
            fx.sync(SYNCED, d);
            fx.query_raw(&args(&["docs/gn-90-readme"]))
        }
        "unsupported-source" => {
            let mut fx = Fx::new(SYNCED);
            fx.omp_root();
            fx.codex_db(&["git_origin_url"]);
            let h = hours("2026-11-04T10:00:00Z", "2026-11-08T15:00:00Z", 8);
            fx.claude_spread(
                "feat/gn-60-ui",
                CLAUDE_MODEL,
                &h,
                [15000, 300000, 20000, 0, 9000, 0],
            );
            fx.sync(SYNCED, d);
            fx.query_raw(&args(&["feat/gn-60-ui", "chore/gn-61-deps"]))
        }
        "unattributed-branch" => {
            let mut fx = Fx::new(SYNCED);
            healthy(&fx);
            let h = hours("2026-11-05T09:00:00Z", "2026-11-08T18:00:00Z", 9);
            fx.claude_spread(
                "feat/gn-12-cache",
                CLAUDE_MODEL,
                &h,
                [60000, 1100000, 90000, 0, 31000, 6000],
            );
            fx.omp(t("2026-11-07T11:00:00Z"), 12000, 20000, 380000);
            fx.sync(SYNCED, d);
            fx.query_raw(&args(&["feat/gn-12-cache", "docs/gn-90-readme"]))
        }
        "unpriced-cost" => {
            // The row's only model has no price: its amount is unknown, never 0.
            let mut fx = Fx::new(SYNCED);
            healthy(&fx);
            let h = hours("2026-11-06T10:00:00Z", "2026-11-08T14:00:00Z", 5);
            fx.claude_spread(
                "feat/gn-70-local",
                "acme-local-7b",
                &h,
                [40000, 600000, 25000, 0, 18000, 3000],
            );
            fx.sync(SYNCED, d);
            fx.query_raw(&args(&["feat/gn-70-local"]))
        }
        "legacy-store" => {
            // The store before the move stays in the old folder, written by an older meter: its
            // usage never reaches the query, and the answer says so.
            let mut fx = Fx::new(SYNCED);
            healthy(&fx);
            let old = fx.env.dir.path().join("old-state");
            fs::create_dir_all(&old).unwrap();
            fs::write(old.join("meter.db"), b"an older meter's store").unwrap();
            fx.legacy = Some(old);
            let h = hours("2026-11-05T09:00:00Z", "2026-11-08T18:00:00Z", 9);
            fx.claude_spread(
                "feat/gn-12-cache",
                CLAUDE_MODEL,
                &h,
                [60000, 1100000, 90000, 0, 31000, 6000],
            );
            fx.sync(SYNCED, d);
            fx.query_raw(&args(&["feat/gn-12-cache", "docs/gn-90-readme"]))
        }
        "usage" => {
            let fx = plain_store();
            let mut a = args(&["feat/gn-12-cache"]);
            a.pop();
            fx.query_raw(&a)
        }
        "request-too-large" => {
            let fx = plain_store();
            let names = big_names();
            fx.query_raw(&args(&owned(&names)))
        }
        "absent-store" => {
            let fx = Fx {
                env: Env::new(),
                legacy: None,
                lines: Vec::new(),
                omp_lines: Vec::new(),
                n: 0,
            };
            let out = fx.query_raw(&args(&["feat/gn-12-cache"]));
            assert!(!fx.env.state().exists(), "the state folder is not created");
            out
        }
        "locked" => {
            let fx = plain_store();
            let c = Connection::open(fx.db()).unwrap();
            c.pragma_update(None, "locking_mode", "EXCLUSIVE").unwrap();
            c.execute_batch("BEGIN EXCLUSIVE; UPDATE meta SET v = v WHERE k = 'machine';")
                .unwrap();
            let out = fx.query_raw(&args(&["feat/gn-12-cache"]));
            c.execute_batch("ROLLBACK").unwrap();
            out
        }
        "newer-schema" | "outdated-store" => {
            let fx = plain_store();
            let v = if name == "newer-schema" { "3" } else { "1" };
            Store::open(&fx.db())
                .unwrap()
                .set_meta("schema_version", v)
                .unwrap();
            fx.query_raw(&args(&["feat/gn-12-cache"]))
        }
        "unsupported-contract" => {
            let fx = plain_store();
            let mut a = args(&["feat/gn-12-cache"]);
            a.extend(["--contract".to_string(), "2".to_string()]);
            fx.query_raw(&a)
        }
        "too-large" => {
            let mut fx = Fx::new(SYNCED);
            let codex = healthy(&fx);
            let names = wide_names();
            // Rows as wide as real ones get: two harnesses, mixed precision and a model with no
            // price, so 500 of them pass the output cap.
            let codex = &codex;
            for (i, n) in names.iter().enumerate() {
                let h = t("2026-11-01T00:00:00Z") + (i as i64 % 150) * HOUR_MS;
                fx.claude(
                    n,
                    CLAUDE_MODEL,
                    h,
                    [
                        1_234_567, 98_765_432, 1_234_567, 7_654_321, 3_456_789, 123_456,
                    ],
                );
                fx.claude(
                    n,
                    "acme-local-7b",
                    h + HOUR_MS,
                    [12_345, 67_890, 0, 0, 1_234, 0],
                );
                fx.codex(
                    codex,
                    &format!("t-w{i}"),
                    n,
                    h + 2 * HOUR_MS,
                    None,
                    4_567_890,
                );
            }
            fx.sync(SYNCED, d);
            fx.query_raw(&args(&owned(&names)))
        }
        "error" => {
            let fx = plain_store();
            corrupt_usage(&fx.db());
            fx.query_raw(&args(&["feat/gn-12-cache"]))
        }
        "read-only-folder" => {
            // A state folder the reader cannot write, and a store with no -wal or -shm beside it.
            let fx = plain_store();
            assert!(
                !fx.env.state().join("meter.db-shm").exists(),
                "the store is at rest"
            );
            read_only(&fx.env.state(), || {
                fx.query_raw(&args(&["feat/gn-12-cache"]))
            })
        }
        other => panic!("no scenario builds the example {other}: add one"),
    }
}

/// Whether a folder's mode binds this process: on Unix and not as root.
fn permissions_bind() -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::geteuid() != 0 }
    }
    #[cfg(not(unix))]
    {
        false
    }
}

/// Runs `f` with `dir` at mode 0500 (readable, not writable), then gives the mode back.
fn read_only<T>(dir: &Path, f: impl FnOnce() -> T) -> T {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |m: u32| fs::set_permissions(dir, fs::Permissions::from_mode(m)).unwrap();
        mode(0o500);
        let out = f();
        mode(0o700);
        out
    }
    #[cfg(not(unix))]
    {
        let _ = (dir, f);
        panic!("a read-only folder needs Unix permissions")
    }
}

fn scenario(name: &str) -> (u8, Value) {
    let (code, raw) = scenario_raw(name);
    (code, serde_json::from_str(&raw).unwrap())
}

/// Overwrites the `usage` table's root page, leaving `meta` readable: the store says its version,
/// then fails to read.
fn corrupt_usage(db: &Path) {
    let (root, page): (i64, i64) = {
        let c = Connection::open(db).unwrap();
        let root = c
            .query_row(
                "SELECT rootpage FROM sqlite_master WHERE name = 'usage'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let page = c.query_row("PRAGMA page_size", [], |r| r.get(0)).unwrap();
        (root, page)
    };
    assert!(!db.with_extension("db-wal").exists());
    let mut bytes = fs::read(db).unwrap();
    let at = ((root - 1) * page) as usize;
    for b in &mut bytes[at..at + page as usize] {
        *b = 0xA5;
    }
    fs::write(db, bytes).unwrap();
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap()
}

/// Pretty-prints compact JSON as the examples are written (two spaces, `"key": value`), keeping
/// the meter's field order, which a parsed `Value` would sort.
fn pretty_in_order(compact: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    let mut chars = compact.chars().peekable();
    let nl = |out: &mut String, depth: usize| {
        out.push('\n');
        out.push_str(&"  ".repeat(depth));
    };
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                out.push('"');
                while let Some(c) = chars.next() {
                    out.push(c);
                    match c {
                        '\\' => out.push(chars.next().unwrap()),
                        '"' => break,
                        _ => {}
                    }
                }
            }
            '{' | '[' => {
                let close = if c == '{' { '}' } else { ']' };
                if chars.peek() == Some(&close) {
                    chars.next();
                    out.push(c);
                    out.push(close);
                } else {
                    out.push(c);
                    depth += 1;
                    nl(&mut out, depth);
                }
            }
            '}' | ']' => {
                depth -= 1;
                nl(&mut out, depth);
                out.push(c);
            }
            ',' => {
                out.push(',');
                nl(&mut out, depth);
            }
            ':' => out.push_str(": "),
            c => out.push(c),
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------
// The examples.

#[test]
fn every_example_validates_against_the_schema() {
    let s = schema();
    let names = example_names();
    assert!(names.len() >= 20, "{names:?}");
    for n in names {
        let e = s.errors(&example(&n));
        assert!(e.is_empty(), "{n}: {e:#?}");
    }
}

#[test]
fn each_example_is_what_the_meter_answers() {
    let s = schema();
    let update = std::env::var_os("UPDATE_QUERY_EXAMPLES").is_some();
    for name in example_names() {
        if name == "read-only-folder" && !permissions_bind() {
            eprintln!("{name}: skipped, a folder's mode does not bind root");
            continue;
        }
        if SCHEMA_ONLY.contains(&name.as_str()) {
            eprintln!("{name}: schema-only until RFC 0021 delivery 6, no meter answer to compare");
            continue;
        }
        let want = example(&name);
        let (code, raw) = scenario_raw(&name);
        let got: Value = serde_json::from_str(&raw).unwrap();
        let e = s.errors(&got);
        assert!(
            e.is_empty(),
            "{name}: the meter's answer breaks the schema: {e:#?}"
        );
        let status = got["status"].as_str().unwrap().to_string();
        assert_eq!(code, exit_of(&status), "{name}: exit {code} for {status}");
        if update {
            let p = v1().join("examples").join(format!("{name}.json"));
            fs::write(p, pretty_in_order(raw.trim_end()) + "\n").unwrap();
            continue;
        }
        assert!(
            same(&got, &want),
            "{name}: the meter answers\n{}\nthe example says\n{}",
            pretty(&got),
            pretty(&want)
        );
    }
}

fn exit_of(status: &str) -> u8 {
    match status {
        "ok" => 0,
        "error" => 1,
        "usage" => 2,
        "absent_store" => 10,
        "locked" => 11,
        "newer_schema" => 12,
        "outdated_store" => 13,
        "unsupported_contract" => 14,
        "too_large" => 15,
        other => panic!("unknown status {other}"),
    }
}

#[test]
fn repo_normalization_matches_the_meter() {
    let text = fs::read_to_string(v1().join("repo-normalization.json")).unwrap();
    let cases: Value = serde_json::from_str(&text).unwrap();
    let cases = cases["cases"].as_array().unwrap();
    assert!(cases.len() >= 10);
    for c in cases {
        let remote = c["remote"].as_str().unwrap();
        let want = c["repo"].as_str();
        let got = meter::repo::normalize_remote(remote);
        assert_eq!(got.as_deref(), want, "{remote}");
        if let Some(r) = &got {
            assert!(query::repo_ok(r), "{r} is a --repo value");
            assert!(!r.contains("FAKE-TOKEN") && !r.contains('@'), "{r}");
        }
    }
}

/// The RFC's refusal rule (RFC 0018 (a), under the envelope table): `rows` and `sources` are
/// empty and `as_of`, `ingestion`, `window`, `unattributed` and `pricing` are null; `store` is
/// filled only once its `schema_version` was read (exit 12, 13, 15, and 1 after the read);
/// `machine` only on exit 15; `query` is null only when the arguments do not parse.
fn check_refusal_nulls(name: &str, v: &Value) {
    let status = v["status"].as_str().unwrap();
    if status == "ok" {
        return;
    }
    for k in [
        "as_of",
        "ingestion",
        "window",
        "unattributed",
        "actor_unattributed",
        "pricing",
    ] {
        assert!(v[k].is_null(), "{name}: {k} on a refusal");
    }
    for k in ["rows", "sources"] {
        assert_eq!(v[k], json!([]), "{name}: {k} on a refusal");
    }
    let store = !v["store"].is_null();
    match status {
        "newer_schema" | "outdated_store" | "too_large" => assert!(store, "{name}: store"),
        "error" => {}
        _ => assert!(!store, "{name}: store on {status}"),
    }
    assert_eq!(
        !v["machine"].is_null(),
        status == "too_large",
        "{name}: machine on {status}"
    );
    let parsed = !v["query"].is_null();
    if status != "usage" {
        assert!(parsed, "{name}: query on {status}");
    }
    if parsed {
        let q = &v["query"];
        let echo: usize = q["branches"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| serde_json::to_string(b).unwrap().len() + 1)
            .sum();
        assert!(echo <= query::REFUSAL_ECHO_BYTES, "{name}: echo {echo}");
        let complete =
            q["branches"].as_array().unwrap().len() as u64 == q["branch_count"].as_u64().unwrap();
        assert_eq!(q["branches_complete"], complete, "{name}");
    }
    let n = serde_json::to_string(v).unwrap().len() + 1;
    assert!(n <= query::REFUSAL_BYTES, "{name}: a refusal of {n} bytes");
}

#[test]
fn refusals_carry_nulls_exactly_where_the_rfc_says() {
    for name in example_names() {
        check_refusal_nulls(&name, &example(&name));
    }
}

// ---------------------------------------------------------------------------------------------
// The schema's own rules, by counter-example.

fn priced_row() -> Value {
    example("priced")["rows"][0].clone()
}

#[test]
fn the_schema_refuses_what_the_contract_forbids() {
    let s = schema();
    let base = example("zero-usage");
    assert!(s.valid(&base));
    let mut bad: Vec<(&str, Value)> = Vec::new();

    // 764 Low: a zero row cannot claim a reported (or estimated) amount, or a model.
    let mut v = base.clone();
    v["rows"][0]["cost"]["usd_reported"] = json!(0.5);
    bad.push(("zero row with usd_reported", v));
    let mut v = base.clone();
    v["rows"][0]["cost"]["usd_estimated"] = json!(0.25);
    bad.push(("zero row with usd_estimated", v));
    let mut v = base.clone();
    v["rows"][0]["cost"]["unpriced_models"] = json!(["acme-local-7b"]);
    bad.push(("zero row with an unpriced model", v));
    let mut v = base.clone();
    v["rows"][0]["tokens"]["total"] = json!(3);
    bad.push(("zero row with tokens", v));

    // D1: request_too_large names its bytes.
    for k in ["limit_bytes", "needed_bytes"] {
        let mut v = example("request-too-large");
        v["error"].as_object_mut().unwrap().remove(k);
        bad.push(("request_too_large without its bytes", v));
    }
    // D1: unpriced_models is bounded.
    let mut v = example("partial-priced");
    v["rows"][0]["cost"]["unpriced_models"] =
        json!((0..9).map(|i| format!("model-{i}")).collect::<Vec<_>>());
    bad.push(("nine unpriced models", v));
    let mut v = example("partial-priced");
    v["rows"][0]["cost"]["unpriced_models"] = json!(["m".repeat(65)]);
    bad.push(("an unpriced model name past 64 characters", v));

    // Unknown is never 0: an unpriced row has no amount at all (genie's L1), a missing row no
    // numbers, an unknown backlog is not a complete one, and a zero row's reasoning is a real 0.
    let mut v = example("priced");
    v["rows"][0]["cost"]["state"] = json!("unpriced");
    bad.push(("unpriced row with usd", v));
    for k in ["usd_reported", "usd_estimated"] {
        let mut v = example("unpriced-cost");
        v["rows"][0]["cost"][k] = json!(0);
        bad.push(("unpriced row with a 0 part", v));
    }
    let mut v = example("priced");
    v["ingestion"]["backlog"]["bytes"] = json!(null);
    bad.push(("an unknown backlog called complete", v));
    let mut v = base.clone();
    v["rows"][0]["tokens"]["reasoning"] = json!(null);
    bad.push(("a zero row with unknown reasoning", v));
    let mut v = example("zero-usage");
    v["rows"][0]["cost"]["unpriced_models_omitted"] = json!(1);
    bad.push(("a zero row that left models out", v));
    // genie's re-check of M1: unpriced_models_omitted is always there, and above 0 the list holds
    // all 8 names.
    let mut v = example("priced");
    v["rows"][0]["cost"]
        .as_object_mut()
        .unwrap()
        .remove("unpriced_models_omitted");
    bad.push(("a cost without unpriced_models_omitted", v));
    let mut v = example("partial-priced");
    v["rows"][0]["cost"]["unpriced_models_omitted"] = json!(1);
    bad.push(("models left out of a list that is not full", v));
    let mut full = example("partial-priced");
    full["rows"][0]["cost"]["unpriced_models"] =
        json!((0..8).map(|i| format!("model-{i}")).collect::<Vec<_>>());
    full["rows"][0]["cost"]["unpriced_models_omitted"] = json!(3);
    assert!(s.valid(&full), "{:#?}", s.errors(&full));
    let mut v = example("missing-branch");
    v["rows"][1]["tokens"] = priced_row()["tokens"].clone();
    bad.push(("missing row with tokens", v));
    let mut v = example("unattributed-branch");
    v["rows"][1]["state"] = json!("zero");
    bad.push(("a zero beside unattributed usage", v));

    // The refusal rule.
    let mut v = example("absent-store");
    v["ingestion"] = example("priced")["ingestion"].clone();
    bad.push(("absent store with ingestion", v));
    let mut v = example("too-large");
    v["sources"] = example("priced")["sources"].clone();
    bad.push(("too_large with sources", v));
    let mut v = example("locked");
    v["machine"] = json!({"id": MACHINE, "scope": "local"});
    bad.push(("locked with a machine", v));
    let mut v = example("unsupported-contract");
    v["store"] = json!({"schema_version": 2, "location": "current"});
    bad.push(("unsupported_contract with a store", v));

    for (what, v) in bad {
        assert!(!s.valid(&v), "the schema accepts {what}");
    }
}

/// genie's re-check of M1: every cost the meter writes says how many unpriced models it left out,
/// 0 included, so a reader never has to treat an absent count as unknown.
#[test]
fn every_cost_says_how_many_unpriced_models_it_left_out() {
    for name in ["priced", "partial-priced", "zero-usage", "unpriced-cost"] {
        let (code, v) = scenario(name);
        assert_eq!(code, 0, "{name}: {v}");
        for r in rows_of(&v) {
            let cost = r["cost"].as_object().unwrap();
            assert_eq!(
                cost.get("unpriced_models_omitted"),
                Some(&json!(0)),
                "{name}: {r}"
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The rules that keep unknown apart from zero, at the meter.

fn rows_of(v: &Value) -> &Vec<Value> {
    v["rows"].as_array().unwrap()
}

#[test]
fn a_zero_is_vouched_for_only_when_every_condition_holds() {
    // Each failed condition turns the zero into `missing` with its reason, never into 0.
    let build = |f: &dyn Fn(&mut Fx, &Connection)| -> Value {
        let mut fx = Fx::new(SYNCED);
        let codex = healthy(&fx);
        fx.claude(
            "main",
            CLAUDE_MODEL,
            t("2026-11-08T08:00:00Z"),
            [100, 2000, 0, 0, 300, 0],
        );
        f(&mut fx, &codex);
        fx.sync(SYNCED, 60);
        let (code, v) = fx.query(&args(&["docs/gn-90-readme"]));
        assert_eq!(code, 0, "{v}");
        assert!(schema().valid(&v), "{v}");
        v
    };
    let zero = build(&|_, _| {});
    assert_eq!(rows_of(&zero)[0]["state"], "zero");
    assert_eq!(rows_of(&zero)[0]["cost"]["usd_reported"], 0);

    let unattributed = build(&|fx, _| fx.omp(t("2026-11-08T07:00:00Z"), 10, 20, 30));
    let r = &rows_of(&unattributed)[0];
    assert_eq!(
        (r["state"].as_str(), r["reason"].as_str()),
        (Some("missing"), Some("branch_unattributed"))
    );
    assert_eq!(r["attribution"]["coverage"], "partial");
    assert!(r["tokens"].is_null() && r["cost"].is_null());
    assert_eq!(unattributed["unattributed"]["tokens_total"], 60);
    assert_eq!(unattributed["unattributed"]["harnesses"], json!(["omp"]));

    let degraded = build(&|fx, _| {
        fs::write(fx.home().join(".codex/state_5.sqlite"), b"not a database").unwrap();
    });
    let r = &rows_of(&degraded)[0];
    assert_eq!(
        (r["state"].as_str(), r["reason"].as_str()),
        (Some("missing"), Some("source_incomplete"))
    );
    assert_eq!(r["incomplete_sources"], json!(["codex"]));

    // A repo the store never saw.
    let fx = Fx::new(SYNCED);
    healthy(&fx);
    fx.sync(SYNCED, 60);
    let mut a = args(&["docs/gn-90-readme"]);
    a[1] = "example.org/nobody/never".into();
    let (_, v) = fx.query(&a);
    assert_eq!(rows_of(&v)[0]["reason"], "repo_not_seen");

    // A backlog left by a sync that stopped at its budget.
    let mut fx = Fx::new(SYNCED);
    healthy(&fx);
    fx.claude(
        "main",
        CLAUDE_MODEL,
        t("2026-11-08T08:00:00Z"),
        [1, 2, 0, 0, 3, 0],
    );
    fx.sync(SYNCED, 60);
    for f in ["a", "b"] {
        let line = common::claude_line(f, f, "2026-11-08T09:30:00Z", CLAUDE_MODEL, &common::U1, 0);
        fs::write(
            fx.env.claude(&format!("-work-widgets/{f}.jsonl")),
            line + "\n",
        )
        .unwrap();
    }
    {
        let _g = serial();
        let mut o = fx.env.opts();
        o.now_ms = t(SYNCED);
        o.days = Some(60);
        o.chunk_limit = Some(1);
        let r = fx.env.run(&o);
        assert!(r.pending_bytes > 0);
    }
    let (_, v) = fx.query(&args(&["docs/gn-90-readme"]));
    assert_eq!(rows_of(&v)[0]["reason"], "backlog");
    assert_eq!(v["ingestion"]["complete"], false);
}

#[test]
fn every_measured_row_keeps_three_questions_apart() {
    let (_, v) = scenario("partial-priced");
    let r = &rows_of(&v)[0];
    let c = &r["cost"];
    let sum = c["tokens_priced"].as_i64().unwrap()
        + c["tokens_reported"].as_i64().unwrap()
        + c["tokens_unpriced"].as_i64().unwrap();
    assert_eq!(sum, r["tokens"]["total"].as_i64().unwrap(), "{r}");
    assert_eq!(c["state"], "partial");
    assert_eq!(r["token_precision"], "mixed");
    assert_eq!(r["incomplete_sources"], json!([]));
    assert_eq!(r["attribution"]["coverage"], "complete");

    // Nothing priced at all: the amount is unknown (null), never 0.
    let mut fx = Fx::new(SYNCED);
    healthy(&fx);
    fx.claude(
        "feat/x",
        "acme-local-7b",
        t("2026-11-08T08:00:00Z"),
        [10, 20, 0, 0, 30, 0],
    );
    fx.sync(SYNCED, 60);
    let (_, v) = fx.query(&args(&["feat/x"]));
    let c = &rows_of(&v)[0]["cost"];
    assert_eq!(c["state"], "unpriced");
    assert!(c["usd"].is_null() && c["usd_estimated"].is_null() && c["usd_reported"].is_null());
    assert_eq!(c["tokens_unpriced"], 60);

    // OMP's reported amount wins over the table and is counted as reported.
    let mut fx = Fx::new(SYNCED);
    healthy(&fx);
    fx.omp_lines.push(format!(
        r#"{{"type":"session","version":3,"id":"omp-sess-r","timestamp":"2026-11-08T08:00:00Z","cwd":"{CWD}"}}"#
    ));
    fx.omp_lines.push(
        r#"{"type":"message","id":"r1","timestamp":"2026-11-08T08:01:00Z","message":{"role":"assistant","model":"claude-opus-5-5","content":[],"usage":{"input":100,"output":200,"cacheRead":0,"cacheWrite":0,"totalTokens":300,"cost":{"total":0.5}}}}"#
            .into(),
    );
    common::write_lines(&fx.env.omp("-work-widgets/s.jsonl"), &fx.omp_lines);
    fx.sync(SYNCED, 60);
    let (_, v) = fx.query(&args(&["feat/none"]));
    assert_eq!(v["unattributed"]["tokens_total"], 300);
    assert_eq!(rows_of(&v)[0]["state"], "missing");
}

// ---------------------------------------------------------------------------------------------
// The attribution contract (RFC 0021 delivery 2).

/// RFC 0021 delivery 2's examples. The meter writes none of their fields until RFC 0021 delivery
/// 6 (the query), so until then they are schema-only: they validate against the schema and pass
/// the sum checks below, but no store is built for them and no meter answer is compared with
/// them. Delivery 6 empties this list and adds a scenario for each.
const SCHEMA_ONLY: [&str; 9] = [
    "actor-ambiguous",
    "actor-ledger-branch",
    "actor-no-evidence",
    "actor-straddling-evidence",
    "by-bot",
    "by-bot-backlog",
    "by-bot-lower-bound",
    "by-bot-no-evidence",
    "by-bot-unfiltered",
];

/// Whether an answer carries any field of the attribution contract.
fn reports_actors(v: &Value) -> bool {
    v.get("actor_unattributed").is_some()
        || v["query"].get("by").is_some()
        || v["rows"]
            .as_array()
            .is_some_and(|r| r.iter().any(|r| r["attribution"].get("actor").is_some()))
}

#[test]
fn schema_only_examples_are_exactly_the_attribution_ones() {
    // No attribution example is compared with a meter that cannot write it, and no example the
    // meter answers today can hide behind the list.
    let names = example_names();
    for n in SCHEMA_ONLY {
        assert!(names.iter().any(|x| x == n), "{n} is not an example");
    }
    for n in &names {
        assert_eq!(
            reports_actors(&example(n)),
            SCHEMA_ONLY.contains(&n.as_str()),
            "{n}"
        );
    }
}

/// RFC 0021 delivery 2's order item: contract 1 carries the attribution contract before any
/// release ships the meter (RFC 0017 delivery 4). This fails on a schema whose
/// `attribution.precision` lacks `actor_interval`, or that drops `--by bot` or
/// `actor_unattributed`, so the contract cannot be dropped from contract 1 unnoticed.
#[test]
fn contract_1_carries_the_attribution_contract() {
    let text = fs::read_to_string(v1().join("envelope.schema.json")).unwrap();
    let s: Value = serde_json::from_str(&text).unwrap();
    let precision = s["$defs"]["attribution"]["properties"]["precision"]["enum"]
        .as_array()
        .expect("attribution.precision is an enum");
    for p in ["branch_window", "task_interval", "actor_interval"] {
        assert!(precision.contains(&json!(p)), "precision lacks {p}");
    }
    assert_eq!(
        s["properties"]["query"]["oneOf"][1]["properties"]["by"]["enum"],
        json!(["bot"])
    );
    assert!(s["$defs"]["botRow"].is_object());
    assert!(s["properties"]["actor_unattributed"].is_object());
}

fn int(v: &Value) -> i64 {
    v.as_i64().unwrap_or_else(|| panic!("not an integer: {v}"))
}

/// The reasons of `actor_unattributed`, in the schema's order.
fn actor_reasons() -> Vec<String> {
    let text = fs::read_to_string(v1().join("envelope.schema.json")).unwrap();
    let s: Value = serde_json::from_str(&text).unwrap();
    s["$defs"]["actorUnattributed"]["properties"]["parts"]["items"]["properties"]["reason"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r.as_str().unwrap().to_string())
        .collect()
}

/// The rules of RFC 0021 (d) a schema cannot check, since it cannot add: every violation in `v`.
/// - On a row, the four counts add up to `tokens.total`, `tokens_by_basis` to
///   `tokens_attributed`, and `tokens_by_branch_basis` to `tokens.total`.
/// - `tokens_before_evidence` is all of the tokens while `evidence_from` is null or the window
///   ends by it, and 0 when the window starts at or after it.
/// - In `actor_unattributed`, the three counts add up to `tokens_total`, the parts come one per
///   reason in the schema's order, and add up, by state, to the count of that name; branch rows,
///   which never overlap, hold no more of each than the repo does.
/// - A bot row's activity names its own harness alone, and bot rows come in strict key order
///   (bot, kind, role, squad, unrecorded, harness; byte order, null first), so no key repeats.
fn actor_errors(v: &Value) -> Vec<String> {
    let mut e = Vec::new();
    let evidence = v["ingestion"]["evidence_from"].as_str();
    let (start, end) = (v["window"]["start"].as_str(), v["window"]["end"].as_str());
    // RFC 3339 UTC times of one shape compare as strings.
    let fixed_before = |total: i64| -> Option<i64> {
        if !v["ingestion"].is_object() {
            return None;
        }
        match (evidence, start, end) {
            (None, _, _) => Some(total),
            (Some(ev), Some(s), _) if s >= ev => Some(0),
            (Some(ev), _, Some(en)) if en <= ev => Some(total),
            _ => None,
        }
    };
    let unrecorded = [
        json!([]),
        json!(["role"]),
        json!(["squad"]),
        json!(["role", "squad"]),
    ];
    let text = |x: &Value| x.as_str().map(String::from);
    let key = |r: &Value| {
        (
            text(&r["bot"]),
            text(&r["kind"]),
            text(&r["role"]),
            text(&r["squad"]),
            unrecorded.iter().position(|u| *u == r["unrecorded"]),
            text(&r["harness"]),
        )
    };
    let mut last_key = None;
    let mut in_rows = [0i64; 3];
    let rows = v["rows"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    for (i, r) in rows.iter().enumerate() {
        if let Some(h) = r.get("harness")
            && r["activity"]["harnesses"] != json!([h])
        {
            e.push(format!(
                "rows[{i}]: a bot row on {h} with activity on others"
            ));
        }
        if r.get("bot").is_some() {
            let k = key(r);
            if last_key.as_ref().is_some_and(|l| *l >= k) {
                e.push(format!("rows[{i}]: a bot key out of order or repeated"));
            }
            last_key = Some(k);
        }
        let Some(a) = r["attribution"].get("actor") else {
            continue;
        };
        let total = int(&r["tokens"]["total"]);
        let c = [
            "tokens_attributed",
            "tokens_ambiguous",
            "tokens_unlinked",
            "tokens_before_evidence",
        ]
        .map(|k| int(&a[k]));
        if c.iter().sum::<i64>() != total {
            e.push(format!(
                "rows[{i}]: the counts {c:?} do not add up to {total}"
            ));
        }
        let basis: i64 = ["session", "label", "worktree"]
            .iter()
            .map(|k| int(&a["tokens_by_basis"][k]))
            .sum();
        if basis != c[0] {
            e.push(format!(
                "rows[{i}]: tokens_by_basis adds up to {basis}, not {}",
                c[0]
            ));
        }
        let branch: i64 = ["log", "ledger", "none"]
            .iter()
            .map(|k| int(&a["tokens_by_branch_basis"][k]))
            .sum();
        if branch != total {
            e.push(format!(
                "rows[{i}]: tokens_by_branch_basis adds up to {branch}, not {total}"
            ));
        }
        if let Some(want) = fixed_before(total)
            && c[3] != want
        {
            e.push(format!(
                "rows[{i}]: {} before evidence where the window fixes {want}",
                c[3]
            ));
        }
        if r.get("branch").is_some() {
            for k in 0..3 {
                in_rows[k] += c[k + 1];
            }
        }
    }
    let u = &v["actor_unattributed"];
    if !u.is_object() {
        return e;
    }
    let total = int(&u["tokens_total"]);
    let c = [
        "tokens_ambiguous",
        "tokens_unlinked",
        "tokens_before_evidence",
    ]
    .map(|k| int(&u[k]));
    if c.iter().sum::<i64>() != total {
        e.push(format!(
            "actor_unattributed: {c:?} does not add up to {total}"
        ));
    }
    if let Some(want) = fixed_before(total)
        && c[2] != want
    {
        e.push(format!(
            "actor_unattributed: {} before evidence, not {want}",
            c[2]
        ));
    }
    let reasons = actor_reasons();
    let mut last = None;
    let mut by_state = [0i64; 3];
    for (i, p) in u["parts"].as_array().unwrap().iter().enumerate() {
        let at = reasons.iter().position(|r| p["reason"] == r.as_str());
        if at.is_none() || at <= last {
            e.push(format!(
                "actor_unattributed.parts[{i}]: repeated, unknown or out of order"
            ));
        }
        last = at;
        let s = ["ambiguous", "unlinked", "before_evidence"]
            .iter()
            .position(|s| p["state"] == *s)
            .unwrap_or_else(|| panic!("a part's state: {p}"));
        by_state[s] += int(&p["tokens_total"]);
    }
    if by_state != c {
        e.push(format!(
            "actor_unattributed: the parts add up to {by_state:?}, not {c:?}"
        ));
    }
    for k in 0..3 {
        if in_rows[k] > c[k] {
            e.push(format!(
                "branch rows hold {} of count {k}, the repo {}",
                in_rows[k], c[k]
            ));
        }
    }
    e
}

#[test]
fn actor_counts_add_up_on_every_example() {
    let mut checked = 0;
    for n in example_names() {
        let v = example(&n);
        let e = actor_errors(&v);
        assert!(e.is_empty(), "{n}: {e:#?}");
        checked += usize::from(reports_actors(&v));
    }
    assert_eq!(checked, SCHEMA_ONLY.len());
}

#[test]
fn the_sum_check_refuses_counts_that_do_not_add_up() {
    // Each of these passes the schema, so only the sum check stands between it and a reader.
    let s = schema();
    let mut bad: Vec<(&str, Value)> = Vec::new();
    let mut v = example("actor-straddling-evidence");
    v["rows"][0]["attribution"]["actor"]["tokens_before_evidence"] = json!(940001);
    bad.push(("four counts past tokens.total", v));
    let mut v = example("actor-ambiguous");
    v["rows"][0]["attribution"]["actor"]["tokens_by_basis"]["session"] = json!(699999);
    bad.push(("tokens_by_basis short of tokens_attributed", v));
    let mut v = example("actor-ledger-branch");
    v["rows"][0]["attribution"]["actor"]["tokens_by_branch_basis"]["ledger"] = json!(1640000);
    bad.push(("tokens_by_branch_basis short of tokens.total", v));
    let mut v = example("actor-ambiguous");
    let a = &mut v["rows"][1]["attribution"]["actor"];
    a["tokens_attributed"] = json!(359000);
    a["tokens_by_basis"]["session"] = json!(359000);
    a["tokens_before_evidence"] = json!(1000);
    bad.push(("usage before evidence in a window after evidence_from", v));
    let mut v = example("actor-no-evidence");
    v["actor_unattributed"]["tokens_total"] = json!(1641001);
    bad.push(("actor_unattributed past its counts", v));
    let mut v = example("by-bot-lower-bound");
    v["actor_unattributed"]["parts"][1]["tokens_total"] = json!(52001);
    bad.push(("parts past their count", v));
    let mut v = example("by-bot-lower-bound");
    let first = v["actor_unattributed"]["parts"][0].clone();
    v["actor_unattributed"]["parts"][1] = first;
    v["actor_unattributed"]["tokens_total"] = json!(439000);
    v["actor_unattributed"]["tokens_ambiguous"] = json!(168000);
    v["actor_unattributed"]["tokens_unlinked"] = json!(271000);
    bad.push(("a reason given twice", v));
    let mut v = example("actor-ambiguous");
    let u = &mut v["actor_unattributed"];
    u["tokens_total"] = json!(1000);
    u["tokens_ambiguous"] = json!(1000);
    u["parts"][0]["tokens_total"] = json!(1000);
    bad.push(("branch rows holding more ambiguous usage than the repo", v));
    let mut v = example("by-bot");
    v["rows"][0]["activity"]["harnesses"] = json!(["codex", "omp"]);
    bad.push(("a bot row with activity on another harness", v));
    let mut v = example("by-bot");
    v["rows"].as_array_mut().unwrap().swap(0, 1);
    bad.push(("bot rows out of key order", v));
    let mut v = example("by-bot-lower-bound");
    let row = v["rows"][1].clone();
    v["rows"].as_array_mut().unwrap().insert(1, row);
    bad.push(("a bot key given twice", v));
    for (what, v) in bad {
        assert!(s.valid(&v), "{what}: {:#?}", s.errors(&v));
        assert!(!actor_errors(&v).is_empty(), "the sum check accepts {what}");
    }
}

#[test]
fn request_sha256_covers_by_on_every_example() {
    // A branch request hashes as before by existed; a bot request adds the line `by bot`, which
    // no branch can be, after the window.
    use sha2::Digest;
    let mut by = 0;
    for n in example_names() {
        let v = example(&n);
        let q = &v["query"];
        if !q.is_object() || q["branches_complete"] != true || q.get("repo_complete").is_some() {
            continue;
        }
        let mut lines = vec![
            q["repo"].as_str().unwrap().to_string(),
            q["window"].as_str().unwrap().to_string(),
        ];
        if let Some(b) = q.get("by") {
            lines.push(format!("by {}", b.as_str().unwrap()));
            by += 1;
        }
        for b in q["branches"].as_array().unwrap() {
            lines.push(b.as_str().unwrap().to_string());
        }
        let mut h = sha2::Sha256::new();
        for l in &lines {
            h.update(l.as_bytes());
            h.update(b"\n");
        }
        assert_eq!(q["request_sha256"], meter::event::hex(&h.finalize()), "{n}");
    }
    assert_eq!(by, 5, "the bot examples");
}

#[test]
fn the_schema_refuses_what_the_attribution_contract_forbids() {
    let s = schema();
    let mut bad: Vec<(&str, Value)> = Vec::new();
    let remove = |v: &mut Value, k: &str| {
        v.as_object_mut().unwrap().remove(k);
    };

    // D1 and D2: a row's kind is its precision, and an answer holds one kind of row.
    let mut v = example("actor-ambiguous");
    v["rows"][0]["attribution"]["precision"] = json!("actor_interval");
    bad.push(("a branch row at actor_interval", v));
    let mut v = example("actor-ambiguous");
    v["rows"][0]["attribution"]["precision"] = json!("task_interval");
    bad.push(("a branch row at task_interval", v));
    let mut v = example("by-bot");
    v["rows"][0]["attribution"]["precision"] = json!("branch_window");
    bad.push(("a bot row at branch_window", v));
    let mut v = example("actor-ambiguous");
    v["rows"][1] = example("by-bot")["rows"][0].clone();
    bad.push(("a bot row in a branch answer", v));
    let mut v = example("by-bot");
    v["rows"][1] = example("actor-ambiguous")["rows"][0].clone();
    bad.push(("a branch row in a bot answer", v));
    let mut v = example("priced");
    v["query"]["branches"] = json!([]);
    bad.push(("a branch answer that names no branch", v));
    let mut v = example("by-bot");
    v["query"]["by"] = json!("branch");
    bad.push(("by branch echoed", v));

    // A bot row holds attributed usage only, keyed in full.
    for k in [
        "tokens_ambiguous",
        "tokens_unlinked",
        "tokens_before_evidence",
    ] {
        let mut v = example("by-bot");
        v["rows"][0]["attribution"]["actor"][k] = json!(1);
        bad.push(("a bot row holding usage no bot is given", v));
    }
    let mut v = example("by-bot");
    remove(&mut v["rows"][0]["attribution"], "actor");
    bad.push(("a bot row without actor", v));
    let mut v = example("by-bot");
    v["rows"][0]["attribution"]["shared"] = json!(true);
    bad.push(("a shared bot row", v));
    let mut v = example("by-bot-lower-bound");
    v["rows"][0]["attribution"]["actor"]["tokens_by_branch_basis"]["none"] = json!(5);
    bad.push((
        "a bot row filtered by branch holding usage with no branch",
        v,
    ));
    let mut v = example("actor-ambiguous");
    v["rows"][0]["attribution"]["actor"]["tokens_by_branch_basis"]["none"] = json!(5);
    bad.push(("a branch row holding usage with no branch", v));
    let mut v = example("by-bot");
    v["rows"][0]["role"] = json!(null);
    bad.push(("a recorded role that is null", v));
    let mut v = example("by-bot-lower-bound");
    v["rows"][0]["squad"] = json!("lark");
    bad.push(("an unrecorded squad with a value", v));
    let mut v = example("by-bot");
    v["rows"][0]["unrecorded"] = json!(["squad", "role"]);
    bad.push(("unrecorded out of order", v));
    let mut v = example("by-bot");
    v["rows"][0]["kind"] = json!("lead");
    bad.push(("a bot row of an unknown kind", v));
    let mut v = example("by-bot");
    remove(&mut v["rows"][0], "squad");
    bad.push(("a bot row without squad", v));
    let mut v = example("by-bot");
    v["rows"][0]["state"] = json!("zero");
    bad.push(("a zero bot row", v));

    // Coverage (genie's F1): a bot query that names no branch counts usage with no branch in its
    // rows itself, so they are complete beside it; filtered by branch, they are partial.
    let mut v = example("by-bot-unfiltered");
    v["rows"][1]["attribution"]["coverage"] = json!("partial");
    bad.push(("a partial row in a bot answer that names no branch", v));
    let mut v = example("by-bot-lower-bound");
    v["rows"][0]["attribution"]["coverage"] = json!("complete");
    bad.push((
        "a complete row in a filtered bot answer beside usage with no branch",
        v,
    ));
    let mut v = example("actor-ledger-branch");
    v["unattributed"] = json!({"tokens_total": 1, "harnesses": ["omp"]});
    bad.push(("a complete branch row beside usage with no branch", v));

    // actor_unattributed: present with actors, on every row with tokens, and nowhere else.
    let mut v = example("by-bot");
    remove(&mut v, "actor_unattributed");
    bad.push(("a bot answer without actor_unattributed", v));
    // With no bot row, actor_unattributed is all that says why: an empty answer is not 0.
    let mut v = example("by-bot-no-evidence");
    remove(&mut v, "actor_unattributed");
    bad.push(("a bot answer with no row and no actor_unattributed", v));
    let mut v = example("actor-ambiguous");
    remove(&mut v, "actor_unattributed");
    bad.push(("actor on rows without actor_unattributed", v));
    let mut v = example("actor-ambiguous");
    remove(&mut v["rows"][1]["attribution"], "actor");
    bad.push((
        "a row with tokens and no actor beside actor_unattributed",
        v,
    ));
    let mut v = example("actor-ambiguous");
    for (k, x) in [
        ("state", json!("missing")),
        ("reason", json!("backlog")),
        ("tokens", json!(null)),
        ("cost", json!(null)),
        ("token_precision", json!(null)),
        ("activity", json!(null)),
    ] {
        v["rows"][1][k] = x;
    }
    bad.push(("a row with no tokens carrying actor", v));
    let mut v = example("locked");
    v["actor_unattributed"] = example("by-bot")["actor_unattributed"].clone();
    bad.push(("actor_unattributed on a refusal", v));
    let mut v = example("by-bot-lower-bound");
    v["actor_unattributed"]["parts"][0]["state"] = json!("unlinked");
    bad.push(("claimants_differ counted as unlinked", v));
    let mut v = example("by-bot-lower-bound");
    v["actor_unattributed"]["parts"][2]["state"] = json!("ambiguous");
    bad.push(("dsh_tui_seat counted as ambiguous", v));
    let mut v = example("by-bot-lower-bound");
    v["actor_unattributed"]["parts"][3]["state"] = json!("before_evidence");
    bad.push(("other_machine counted as before evidence", v));
    let mut v = example("by-bot-lower-bound");
    v["actor_unattributed"]["parts"][1]["reason"] = json!("guessed");
    bad.push(("an unknown reason", v));
    let mut v = example("by-bot");
    v["actor_unattributed"]["parts"] =
        example("by-bot-lower-bound")["actor_unattributed"]["parts"].clone();
    bad.push(("parts beside a zero total", v));
    let mut v = example("by-bot-lower-bound");
    v["actor_unattributed"]["parts"] = json!([]);
    bad.push(("a total above zero with no parts", v));
    let mut v = example("by-bot-lower-bound");
    v["actor_unattributed"]["parts"][1]["harnesses"] = json!([]);
    bad.push(("a part on no harness", v));
    let mut v = example("by-bot-lower-bound");
    v["actor_unattributed"]["parts"][1]["tokens_total"] = json!(0);
    bad.push(("an empty part", v));

    // A bot with no row is 0 only when nothing is unattributed and RFC 0018's zero conditions hold
    // for the whole answer (the Fixer's M1): otherwise absent_bot_is_zero is false, and it is
    // unknown.
    let mut v = example("by-bot");
    v["ingestion"]["complete"] = json!(false);
    v["ingestion"]["backlog"] = json!({"bytes": null, "files": null});
    bad.push(("an absent bot as 0 beside an unknown backlog", v));
    let mut v = example("by-bot-backlog");
    v["actor_unattributed"]["absent_bot_is_zero"] = json!(true);
    bad.push(("an absent bot as 0 beside a backlog", v));
    let mut v = example("by-bot");
    v["ingestion"]["stale"] = json!(true);
    v["rows"].as_array_mut().unwrap().iter_mut().for_each(|r| {
        r["state"] = json!("stale");
        r["reason"] = json!("ingestion_stale");
    });
    bad.push(("an absent bot as 0 while ingestion is stale", v));
    let mut v = example("by-bot");
    v["window"]["clipped"] = json!(true);
    bad.push(("an absent bot as 0 in a clipped window", v));
    let mut v = example("by-bot");
    v["sources"][1]["status"] = json!("degraded");
    bad.push(("an absent bot as 0 beside a degraded source", v));
    // Unfiltered, so only the rule that the flag needs tokens_total 0 refuses this one.
    let mut v = example("by-bot-unfiltered");
    v["actor_unattributed"]["absent_bot_is_zero"] = json!(true);
    bad.push(("an absent bot as 0 beside unattributed usage", v));
    let mut v = example("by-bot");
    remove(&mut v["actor_unattributed"], "absent_bot_is_zero");
    bad.push((
        "actor_unattributed that does not say what an absent bot is",
        v,
    ));
    // genie's A1: under a branch filter, usage with no branch could be an absent bot's on a
    // branch named, so the flag also needs unattributed at 0. The second case has nothing
    // unattributed to any bot, so only that rule refuses it.
    let mut v = example("by-bot-lower-bound");
    v["actor_unattributed"]["absent_bot_is_zero"] = json!(true);
    bad.push((
        "an absent bot as 0 in a filtered answer beside unattributed usage",
        v,
    ));
    let mut v = example("by-bot-lower-bound");
    v["actor_unattributed"] = example("by-bot")["actor_unattributed"].clone();
    assert_eq!(v["actor_unattributed"]["absent_bot_is_zero"], true);
    bad.push((
        "an absent bot as 0 in a filtered answer beside usage with no branch",
        v,
    ));
    // The Reviewer's L1 on 198cdd00: complete ingestion means an empty backlog.
    let mut v = example("priced");
    v["ingestion"]["backlog"]["bytes"] = json!(5);
    bad.push(("complete ingestion with backlog bytes", v));
    let mut v = example("priced");
    v["ingestion"]["backlog"]["files"] = json!(1);
    bad.push(("complete ingestion with a backlog file", v));
    // genie's A2: only a bot answer has bot rows to be absent from.
    let mut v = example("actor-ledger-branch");
    v["actor_unattributed"]["absent_bot_is_zero"] = json!(true);
    bad.push(("an absent bot as 0 in a branch answer", v));

    // While evidence_from is null, every token is before evidence (RFC 0021 (d)).
    for k in ["tokens_attributed", "tokens_ambiguous", "tokens_unlinked"] {
        let mut v = example("actor-no-evidence");
        let a = &mut v["rows"][0]["attribution"]["actor"];
        a[k] = json!(1281000);
        a["tokens_before_evidence"] = json!(0);
        if k == "tokens_attributed" {
            a["tokens_by_basis"]["session"] = json!(1281000);
        }
        bad.push((
            "a row with evidence-backed counts while evidence_from is null",
            v,
        ));
    }
    let mut v = example("by-bot");
    v["ingestion"]["evidence_from"] = json!(null);
    bad.push(("bot rows while evidence_from is null", v));
    for (state, reason) in [("unlinked", "no_record"), ("ambiguous", "claimants_differ")] {
        let mut v = example("by-bot-no-evidence");
        let u = &mut v["actor_unattributed"];
        u[format!("tokens_{state}")] = json!(1641000);
        u["tokens_before_evidence"] = json!(0);
        u["parts"][0]["state"] = json!(state);
        u["parts"][0]["reason"] = json!(reason);
        bad.push((
            "evidence-backed unattributed usage while evidence_from is null",
            v,
        ));
    }

    for (what, v) in bad {
        assert!(!s.valid(&v), "the schema accepts {what}");
    }

    // The fields stay optional: an answer without them is the meter's answer today.
    assert!(s.valid(&example("priced")));
    assert!(!reports_actors(&example("priced")));
}

// ---------------------------------------------------------------------------------------------
// The byte budget (genie's D1).

/// A branch of `n` bytes, mostly `"`, which JSON doubles.
fn quoted_branch(i: usize, n: usize) -> String {
    let mut s = format!("q{i}-");
    while s.len() < n {
        s.push('"');
    }
    s
}

/// A store written directly: every requested branch measured, with eight long unpriced model
/// names full of quotes, a reported and an estimated amount, both precisions and three harnesses;
/// the sources' reasons and the machine id at their longest.
fn worst_store(fx: &Fx, branches: &[String]) {
    let c = Connection::open(fx.db()).unwrap();
    let h = t("2026-11-08T10:00:00Z");
    let big = i64::MAX / 16;
    let mut st = c
        .prepare(
            "INSERT INTO usage(id, hour_ms, harness, model, machine, repo, branch, input_uncached,
               cache_read, cache_write_5m, cache_write_1h, output, reasoning, unsplit, precision,
               reported_usd, events, updated_ms) VALUES(?1, ?2, ?3, ?4, 'm', ?5, ?6, ?7, ?7, ?7, ?7,
               ?7, ?7, ?8, ?9, ?10, 1, 0)",
        )
        .unwrap();
    for b in branches {
        for (k, harness) in ["claude-code", "codex", "omp"].iter().enumerate() {
            st.execute(params![
                format!("{b}|{harness}"),
                h - k as i64 * HOUR_MS,
                harness,
                CLAUDE_MODEL,
                REPO,
                b,
                big,
                if k == 1 { big } else { 0 },
                if k == 1 { "total_only" } else { "exact" },
                if k == 2 { Some(1.0e12) } else { None },
            ])
            .unwrap();
        }
        for m in 0..10 {
            st.execute(params![
                format!("{b}|m{m}"),
                h,
                "claude-code",
                format!("model-{m}-{}", "\"".repeat(60)),
                REPO,
                b,
                big,
                0,
                "exact",
                None::<f64>
            ])
            .unwrap();
        }
    }
    let reason: String = "\u{1}\"é".repeat(300);
    for (k, v) in [
        ("codex_status", "degraded"),
        ("codex_reason", reason.as_str()),
        ("machine", &"\"".repeat(400)),
    ] {
        c.execute(
            "INSERT INTO meta(k, v) VALUES(?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            [k, v],
        )
        .unwrap();
    }
}

fn len(v: &Value) -> usize {
    serde_json::to_string(v).unwrap().len()
}

#[test]
fn rows_metadata_and_refusals_stay_within_the_budget_table() {
    let fx = plain_store();
    let one = vec![quoted_branch(0, query::MAX_BRANCH_BYTES)];
    worst_store(&fx, &one);
    let old = fx.env.dir.path().join("old");
    fs::create_dir_all(&old).unwrap();
    let mut fx = fx;
    fs::write(old.join("meter.db"), b"x").unwrap();
    fx.legacy = Some(old);
    let (code, v) = fx.query(&args(&owned(&one)));
    assert_eq!(code, 0, "{v}");
    assert!(schema().valid(&v), "{:#?}", schema().errors(&v));
    let row = &rows_of(&v)[0];
    assert_eq!(row["state"], "measured");
    assert_eq!(
        row["cost"]["unpriced_models"].as_array().unwrap().len(),
        query::UNPRICED_MODELS_MAX
    );
    // Ten unpriced models: two are left out of the list, and the row says so.
    assert_eq!(row["cost"]["unpriced_models_omitted"], 2);
    // genie's I4: a name takes at most 40 bytes as JSON, its quotes and escapes included, and a
    // cut name ends with the 3-byte ellipsis inside those 40.
    for m in row["cost"]["unpriced_models"].as_array().unwrap() {
        let json = serde_json::to_string(m).unwrap();
        assert!(
            json.len() <= query::MODEL_NAME_BYTES,
            "{json} takes {}",
            json.len()
        );
        assert!(
            m.as_str().unwrap().ends_with('…'),
            "{m}: a cut name says so"
        );
    }
    assert_eq!(row["token_precision"], "mixed");
    assert!(len(row) <= query::ROW_BYTES, "a row of {} bytes", len(row));
    let mut meta = v.clone();
    meta["rows"] = json!([]);
    meta["query"]["branches"] = json!([]);
    assert!(
        len(&meta) <= query::METADATA_BYTES,
        "metadata of {} bytes",
        len(&meta)
    );
    assert_eq!(
        v["sources"].as_array().unwrap().len(),
        5,
        "{}",
        v["sources"]
    );

    // The largest request the bound allows: its echo stays within 2 x 64 KiB plus 3 bytes a
    // name, and with the metadata under 150 KiB, which leaves room for 149 rows.
    let n = query::MAX_BRANCHES;
    let names: Vec<String> = (0..n)
        .map(|i| quoted_branch(i, query::MAX_NAMES_BYTES / n))
        .collect();
    assert!(names.iter().map(String::len).sum::<usize>() <= query::MAX_NAMES_BYTES);
    worst_store(&fx, &names);
    let (code, v) = fx.query(&args(&owned(&names)));
    assert_eq!(
        code,
        query::exit::TOO_LARGE,
        "{}",
        &serde_json::to_string(&v).unwrap()[..300]
    );
    let rows_fit = v["error"]["rows_fit"].as_u64().unwrap();
    assert!(rows_fit >= 149, "only {rows_fit} rows fit");
    check_refusal_nulls("worst too_large", &v);
    let echo: usize = names
        .iter()
        .map(|b| serde_json::to_string(b).unwrap().len() + 1)
        .sum();
    assert!(echo <= 2 * query::MAX_NAMES_BYTES + 3 * n, "echo {echo}");
    assert!(echo + query::METADATA_BYTES < 150 * 1024, "echo {echo}");

    // Refusals: past the request bound with every name doubled by escaping, a too-long name, an
    // option and a value whose message needs escaping (quotes and control characters).
    let mut refusals: Vec<(&str, Vec<String>)> = Vec::new();
    let many: Vec<String> = (0..n).map(|i| quoted_branch(i, 200)).collect();
    refusals.push(("request_too_large", args(&owned(&many))));
    let mut too_many: Vec<String> = (0..n + 1).map(|i| format!("b-{i}")).collect();
    too_many.push("x".into());
    refusals.push(("too_many_branches", args(&owned(&too_many))));
    refusals.push((
        "a name past 255 bytes",
        args(&[&quoted_branch(1, 300), "short"]),
    ));
    let weird = format!("--x\"{}\u{1}\u{2}", "\"\\".repeat(500));
    let mut a = args(&["b"]);
    a.insert(0, weird.clone());
    refusals.push(("unknown option", a));
    let mut a = args(&["b"]);
    a.extend(["--window".into(), weird.clone()]);
    refusals.push(("a bad window", a));
    let mut a = args(&["b"]);
    a.extend(["--stale-after".into(), weird]);
    refusals.push(("a bad stale-after", a));
    for (what, a) in refusals {
        let (code, v) = fx.query(&a);
        assert_eq!(code, query::exit::USAGE, "{what}: {v}");
        assert!(schema().valid(&v), "{what}: {:#?}", schema().errors(&v));
        check_refusal_nulls(what, &v);
        let msg = v["error"]["message"].as_str().unwrap();
        assert!(msg.chars().count() <= query::MESSAGE_CHARS, "{what}");
        if what.starts_with("a bad") || what == "unknown option" {
            assert!(
                msg.contains('"'),
                "{what}: the message needs escaping: {msg}"
            );
        }
    }
}

#[test]
fn request_too_large_says_its_bytes_and_echoes_a_capped_request() {
    let fx = plain_store();
    let names = big_names();
    let (code, v) = fx.query(&args(&owned(&names)));
    assert_eq!(code, 2);
    assert_eq!(v["error"]["code"], "request_too_large");
    assert_eq!(v["error"]["limit_bytes"], 65536);
    assert_eq!(v["error"]["needed_bytes"], 500 * 203);
    let q = &v["query"];
    assert_eq!(q["branch_count"], 500);
    assert_eq!(q["branches_complete"], false);
    assert_eq!(q["branches"].as_array().unwrap().len(), 19);
    use sha2::Digest;
    let mut h = sha2::Sha256::new();
    for p in std::iter::once(REPO)
        .chain(["d30"])
        .chain(names.iter().map(String::as_str))
    {
        h.update(p.as_bytes());
        h.update(b"\n");
    }
    assert_eq!(q["request_sha256"], meter::event::hex(&h.finalize()));
}

// ---------------------------------------------------------------------------------------------
// A true read-only open.

/// Asserts a read left the folder as it was, naming what differs. RFC 0018 (a): `meter.db` and
/// every other file keep their bytes; the only files a read may cause are SQLite's own
/// companions, an empty `meter.db-wal` and the `meter.db-shm` index, which a reader of a WAL
/// store needs. A wal that was there keeps its bytes (no checkpoint on close).
#[track_caller]
fn same_folder(after: &BTreeMap<String, Vec<u8>>, before: &BTreeMap<String, Vec<u8>>, what: &str) {
    folder_diff(after, before, what, true)
}

/// Every file, companions included, keeps its bytes and nothing appears.
#[track_caller]
fn strictly_same_folder(
    after: &BTreeMap<String, Vec<u8>>,
    before: &BTreeMap<String, Vec<u8>>,
    what: &str,
) {
    folder_diff(after, before, what, false)
}

#[track_caller]
fn folder_diff(
    after: &BTreeMap<String, Vec<u8>>,
    before: &BTreeMap<String, Vec<u8>>,
    what: &str,
    companions: bool,
) {
    let diff: Vec<String> = before
        .keys()
        .chain(after.keys())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .filter(|k| before.get(*k) != after.get(*k))
        .filter(|k| match (k.as_str(), before.get(*k), after.get(*k)) {
            _ if !companions => true,
            ("meter.db-shm", _, Some(_)) => false,
            ("meter.db-wal", None, Some(b)) => !b.is_empty(),
            _ => true,
        })
        .map(|k| {
            format!(
                "{k}: {:?} -> {:?} bytes",
                before.get(k).map(Vec::len),
                after.get(k).map(Vec::len)
            )
        })
        .collect();
    assert!(diff.is_empty(), "{what} changed the state folder: {diff:?}");
}

/// Every file in the folder, by name, with its bytes.
fn folder(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut m = BTreeMap::new();
    for e in fs::read_dir(dir).unwrap() {
        let e = e.unwrap();
        m.insert(
            e.file_name().to_string_lossy().into_owned(),
            fs::read(e.path()).unwrap_or_default(),
        );
    }
    m
}

fn bin(fx: &Fx, a: &[&str]) -> Output {
    let _g = serial();
    // Env::command: an empty environment but PATH, HOME (the temp home) and METER_HC.
    fx.env
        .command()
        .args(a)
        .env("METER_STATE_DIR", fx.env.state())
        .output()
        .unwrap()
}

#[test]
fn query_and_status_never_change_the_store_and_add_only_sqlite_companions() {
    let fx = plain_store();
    let before = folder(&fx.env.state());
    assert!(before.contains_key("meter.db"), "{:?}", before.keys());
    let mut a = vec!["query"];
    let qa = args(&["feat/gn-12-cache", "nobody/else"]);
    a.extend(owned(&qa));
    let out = bin(&fx, &a);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(schema().valid(&v), "{:#?}", schema().errors(&v));
    assert_eq!(v["meter_version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(v["store"]["location"], "override");
    assert!(out.stderr.is_empty());
    same_folder(&folder(&fx.env.state()), &before, "query");

    let out = bin(&fx, &["status"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let st: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(st["rows"].as_i64().unwrap() > 0);
    assert_eq!(st["schema_version"], 2);
    same_folder(&folder(&fx.env.state()), &before, "status");

    // A sync that stopped without closing left a row in the wal: the query counts it, and the
    // database and the wal keep their bytes (a read-only open never checkpoints).
    {
        let c = Connection::open(fx.db()).unwrap();
        c.set_db_config(
            rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE,
            true,
        )
        .unwrap();
        c.execute(
            "UPDATE usage SET output = output + 1000000 WHERE branch = 'feat/gn-12-cache'",
            [],
        )
        .unwrap();
    }
    let with_wal = folder(&fx.env.state());
    assert!(
        !with_wal["meter.db-wal"].is_empty(),
        "the row is in the wal"
    );
    let out = bin(&fx, &a);
    assert_eq!(out.status.code(), Some(0));
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(
        rows_of(&v)[0]["tokens"]["output"].as_i64().unwrap() >= 1_000_000,
        "{v}"
    );
    same_folder(&folder(&fx.env.state()), &with_wal, "query beside a wal");
    let out = bin(&fx, &["status"]);
    assert_eq!(out.status.code(), Some(0));
    same_folder(&folder(&fx.env.state()), &with_wal, "status beside a wal");
    Store::open(&fx.db()).unwrap();

    // Every refusal leaves it as it was too, a newer and an outdated store included.
    for v in ["3", "1"] {
        Store::open(&fx.db())
            .unwrap()
            .set_meta("schema_version", v)
            .unwrap();
        let before = folder(&fx.env.state());
        let out = bin(&fx, &a);
        assert_eq!(out.status.code(), Some(if v == "3" { 12 } else { 13 }));
        let out = bin(&fx, &["status"]);
        assert_eq!(
            out.status.code(),
            Some(0),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        same_folder(
            &folder(&fx.env.state()),
            &before,
            &format!("schema_version {v}"),
        );
    }
}

#[test]
fn query_and_status_read_while_a_sync_holds_the_lock_and_create_nothing() {
    let fx = plain_store();
    let _held = {
        let _g = serial();
        meter::paths::try_lock(&fx.env.state()).unwrap().unwrap()
    };
    let (code, v) = fx.query(&args(&["feat/gn-12-cache"]));
    assert_eq!(code, 0, "{v}");
    assert_eq!(rows_of(&v)[0]["state"], "measured");

    let empty = Env::new();
    let ctx = Ctx {
        state: Some(StateDirs {
            dir: empty.state(),
            legacy: Some(empty.dir.path().join("old")),
        }),
        overridden: false,
        now_ms: t(GENERATED),
        busy: Duration::from_secs(2),
        meter_version: EXAMPLE_VERSION.into(),
    };
    let a = query::run(&args(&["b"]), &ctx);
    assert_eq!(a.code, query::exit::ABSENT_STORE);
    assert!(!empty.state().exists() && !empty.dir.path().join("old").exists());
}

#[test]
fn the_query_falls_back_to_the_folder_before_the_move_and_says_so() {
    let fx = plain_store();
    let home = Env::new();
    let old = home.dir.path().join("old");
    fs::create_dir_all(&old).unwrap();
    fs::copy(fx.db(), old.join("meter.db")).unwrap();
    let ctx = Ctx {
        state: Some(StateDirs {
            dir: home.dir.path().join("new"),
            legacy: Some(old.clone()),
        }),
        overridden: false,
        now_ms: t(GENERATED),
        busy: Duration::from_secs(2),
        meter_version: EXAMPLE_VERSION.into(),
    };
    let before = folder(&old);
    let a = query::run(&args(&["feat/gn-12-cache"]), &ctx);
    assert_eq!(a.code, 0, "{}", a.stdout);
    let v: Value = serde_json::from_str(&a.stdout).unwrap();
    assert_eq!(v["store"]["location"], "legacy");
    assert!(
        v["sources"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["harness"] != query::LEGACY_STORE)
    );
    same_folder(&folder(&old), &before, "a legacy query");
    assert!(!home.dir.path().join("new").exists(), "nothing is created");
}

/// genie's Low on PR 783: an older meter that writes to the generation the move left behind
/// never reaches the query. The answer names it as a degraded source, so no row is a zero and
/// every row lists it among the sources that may undercount; nothing is folded in.
#[test]
fn writes_an_older_meter_made_after_the_move_are_signalled_not_folded_in() {
    let fx = plain_store();
    let home = Env::new();
    let (old, new) = (home.dir.path().join("old"), home.dir.path().join("new"));
    fs::create_dir_all(&old).unwrap();
    fs::copy(fx.db(), old.join("meter.db")).unwrap();
    meter::paths::ensure_dir(&new).unwrap();
    {
        let _g = serial();
        let _l = meter::paths::try_lock(&new).unwrap().unwrap();
        let m = meter::paths::migrate(&old, &new).unwrap();
        assert_eq!(m.copied, ["meter.db"]);
    }
    let ctx = Ctx {
        state: Some(StateDirs {
            dir: new.clone(),
            legacy: Some(old.clone()),
        }),
        overridden: false,
        now_ms: t(GENERATED),
        busy: Duration::from_secs(2),
        meter_version: EXAMPLE_VERSION.into(),
    };
    let ask = |b: &str| -> Value {
        let a = query::run(&args(&[b]), &ctx);
        serde_json::from_str(&a.stdout).unwrap()
    };
    let legacy = |v: &Value| {
        v["sources"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["harness"] == query::LEGACY_STORE)
            .cloned()
    };
    // The kept generation, untouched: nothing to signal.
    let v = ask("docs/none");
    assert_eq!(legacy(&v), None, "{}", v["sources"]);
    assert_eq!(rows_of(&v)[0]["state"], "zero");

    // An older meter writes a row into it.
    std::thread::sleep(Duration::from_millis(20));
    {
        let c = Connection::open(old.join("meter.db")).unwrap();
        c.execute(
            "INSERT INTO meta(k, v) VALUES('later', '1') ON CONFLICT(k) DO UPDATE SET v = '2'",
            [],
        )
        .unwrap();
    }
    let v = ask("docs/none");
    let s = legacy(&v).expect("the legacy store is reported");
    assert_eq!(s["status"], "degraded");
    assert!(
        s["reason"].as_str().unwrap().contains("after the move"),
        "{s}"
    );
    let r = &rows_of(&v)[0];
    assert_eq!(
        (r["state"].as_str(), r["reason"].as_str()),
        (Some("missing"), Some("source_incomplete"))
    );
    assert_eq!(r["incomplete_sources"], json!([query::LEGACY_STORE]));
    let v = ask("feat/gn-12-cache");
    let r = &rows_of(&v)[0];
    assert_eq!(r["state"], "measured");
    assert_eq!(r["incomplete_sources"], json!([query::LEGACY_STORE]));
    assert!(schema().valid(&v));

    // status says it too.
    let out = {
        let _g = serial();
        home.command()
            .arg("status")
            .env("HOME", home.dir.path().join("h"))
            .env("AM_HOME", home.dir.path().join("am"))
            .output()
            .unwrap()
    };
    assert_eq!(out.status.code(), Some(0));
}

// ---------------------------------------------------------------------------------------------
// The query never pages, and duplicates are answered once.

#[test]
fn a_branch_named_twice_is_one_shared_row_and_order_is_kept() {
    let (_, v) = scenario("ambiguous-branch");
    let rows = rows_of(&v);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["requested"], 2);
    assert_eq!(rows[0]["attribution"]["shared"], true);
    assert_eq!(rows[1]["attribution"]["shared"], false);
    assert_eq!(v["query"]["branch_count"], 3);
}

#[test]
fn the_binary_prints_an_envelope_for_every_refusal() {
    let fx = Fx::new(SYNCED);
    for (a, code) in [
        (vec!["query"], 2),
        (vec!["query", "--repo", REPO, "--branch", "b"], 2),
        (
            vec![
                "query",
                "--repo",
                REPO,
                "--branch",
                "b",
                "--json",
                "--contract",
                "2",
            ],
            14,
        ),
        (vec!["query", "--repo", REPO, "--branch", "b", "--json"], 10),
    ] {
        let out = bin(&fx, &a);
        assert_eq!(out.status.code(), Some(code), "{a:?}");
        let v: Value = serde_json::from_slice(&out.stdout).unwrap();
        assert!(schema().valid(&v), "{a:?}: {:#?}", schema().errors(&v));
        check_refusal_nulls(&format!("{a:?}"), &v);
    }
}

// ---------------------------------------------------------------------------------------------
// sync's migration safety (RFC 0018 (d)).

fn sync_opts(fx: &Fx, at: i64) -> meter::sync::Options {
    let mut o = fx.env.opts();
    o.now_ms = at;
    o.days = Some(60);
    o
}

fn set_version(fx: &Fx, v: &str) {
    Store::open(&fx.db())
        .unwrap()
        .set_meta("schema_version", v)
        .unwrap();
    assert!(!fx.env.state().join("meter.db-wal").exists());
}

#[test]
fn sync_refuses_a_newer_store_and_writes_nothing() {
    let fx = plain_store();
    set_version(&fx, "3");
    let state = fx.env.state();
    let before = folder(&state);
    {
        let _g = serial();
        let o = sync_opts(&fx, t(GENERATED));
        assert!(matches!(fx.env.sync(&o), Outcome::NewerSchema { store: 3 }));
    }
    strictly_same_folder(&folder(&state), &before, "sync on a newer store");

    let out = bin(&fx, &["sync", "--force", "--no-publish"]);
    assert_eq!(
        out.status.code(),
        Some(12),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stderr).contains("newer usagemeter"));
    strictly_same_folder(
        &folder(&state),
        &before,
        "the binary's sync on a newer store",
    );

    // A store copied in with no lock file: not even the lock file is made.
    fs::remove_file(state.join("meter.lock")).unwrap();
    let before = folder(&state);
    let out = bin(&fx, &["sync", "--force", "--no-publish"]);
    assert_eq!(out.status.code(), Some(12));
    strictly_same_folder(&folder(&state), &before, "sync with no lock file");
}

fn store_counts(db: &Path) -> BTreeMap<String, i64> {
    meter::store::row_counts(&Connection::open(db).unwrap()).unwrap()
}

fn ids(db: &Path) -> Vec<String> {
    let c = Connection::open(db).unwrap();
    let mut st = c.prepare("SELECT id FROM usage ORDER BY id").unwrap();
    st.query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn before_a_reset_sync_keeps_a_generation_whose_row_counts_match() {
    let fx = plain_store();
    // What an older meter left: version 1 and ids of its own.
    set_version(&fx, "1");
    Connection::open(fx.db())
        .unwrap()
        .execute_batch("UPDATE usage SET id = 'old-' || id")
        .unwrap();
    let old_counts = store_counts(&fx.db());
    let old_ids = ids(&fx.db());
    assert!(
        old_counts["usage"] > 0 && old_counts["seen"] > 0,
        "{old_counts:?}"
    );

    let r = {
        let _g = serial();
        fx.env.run(&sync_opts(&fx, t(GENERATED)))
    };
    assert!(r.reimported);
    let g = r.generation.expect("a generation is kept before the reset");
    assert_eq!(
        g.counts, old_counts,
        "the generation holds every row of the old store"
    );
    let name = g.path.file_name().unwrap().to_string_lossy().into_owned();
    assert!(
        name.starts_with("meter.db.gen-1-20261108T200005Z"),
        "{name}"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&g.path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    assert_eq!(
        store_counts(&g.path),
        old_counts,
        "opened and counted again"
    );
    assert_eq!(
        ids(&g.path),
        old_ids,
        "the copy is the store from before the reset"
    );
    let c = Connection::open(&g.path).unwrap();
    let v: String = c
        .query_row("SELECT v FROM meta WHERE k = 'schema_version'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(v, "1");
    assert!(
        ids(&fx.db()).iter().all(|i| !i.starts_with("old-")),
        "the store was rebuilt"
    );
    assert_eq!(
        Store::open(&fx.db())
            .unwrap()
            .meta("schema_version")
            .unwrap()
            .as_deref(),
        Some("2")
    );
    assert_eq!(
        meter::store::generations(&fx.env.state()),
        vec![g.path.clone()]
    );

    // A later sync that succeeds on the migrated store removes it; one generation at most.
    let r = {
        let _g = serial();
        fx.env.run(&sync_opts(&fx, t(GENERATED) + 60_000))
    };
    assert_eq!(r.generations_removed, vec![g.path.clone()]);
    assert!(!g.path.exists());

    // A widening re-import is a reset too, and keeps one.
    let mut o = sync_opts(&fx, t(GENERATED) + 120_000);
    o.backfill = true;
    let r = {
        let _g = serial();
        fx.env.run(&o)
    };
    assert!(r.reimported && r.generation.is_some());
}

#[test]
fn a_migration_without_twice_the_store_free_refuses_and_changes_nothing() {
    let fx = plain_store();
    set_version(&fx, "1");
    let state = fx.env.state();
    let size = fs::metadata(fx.db()).unwrap().len();
    let before = folder(&state);
    let mut o = sync_opts(&fx, t(GENERATED));
    o.free_bytes = Some(2 * size - 1);
    let out = fx.env.sync(&o);
    match out {
        Outcome::NoSpace { free, needed } => {
            assert_eq!((free, needed), (2 * size - 1, 2 * size));
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    strictly_same_folder(&folder(&state), &before, "a refused migration");
    assert_eq!(
        Store::open_read_only(&fx.db())
            .unwrap()
            .meta("schema_version")
            .unwrap()
            .as_deref(),
        Some("1"),
        "the old store keeps working as it was"
    );

    o.free_bytes = Some(2 * size);
    let r = {
        let _g = serial();
        fx.env.run(&o)
    };
    assert!(r.reimported && r.generation.is_some());
}

/// `Store::open` (sync's open) on a store already at this version writes nothing: no DDL, no
/// `meta` row, no journal-mode change. Only what a store lacks is created.
#[test]
fn opening_a_current_store_for_sync_writes_nothing() {
    let fx = plain_store();
    let state = fx.env.state();
    let before = folder(&state);
    for _ in 0..2 {
        drop(Store::open(&fx.db()).unwrap());
    }
    strictly_same_folder(&folder(&state), &before, "Store::open on a current store");
    // An older store without a version is left without one, for sync to see it is outdated.
    let c = Connection::open(fx.db()).unwrap();
    c.execute("DELETE FROM meta WHERE k = 'schema_version'", [])
        .unwrap();
    drop(c);
    drop(Store::open(&fx.db()).unwrap());
    let peek = meter::store::peek(&fx.db()).unwrap().unwrap();
    assert_eq!(peek.version, 0, "{peek:?}");
}

// ---------------------------------------------------------------------------------------------
// The ceilings' reference store (RFC 0018 (e)), for the measurement in the pull request. Not
// part of a gate: `CEILING_DIR=<dir> cargo test --test query -- --ignored ceiling_store` writes
// `<dir>/state` (90 days of hourly rows for 40 repos and 1,500 branches, three harnesses,
// 1,000,000 dedupe keys) and `<dir>/home` (about 5 MiB of new Claude Code logs for the sync
// that runs beside the concurrent queries). Synthetic data only.

/// The repos and branches of the reference store: repo 0 holds 500 branches, the 39 others share
/// the remaining 1,000.
pub fn ceiling_branches() -> Vec<(String, String)> {
    let mut v = Vec::new();
    for j in 0..500 {
        v.push((
            "example.com/ceiling/repo-00".to_string(),
            format!("feat/c-0-{j}"),
        ));
    }
    for k in 0..1000 {
        let i = 1 + k % 39;
        v.push((
            format!("example.com/ceiling/repo-{i:02}"),
            format!("feat/c-{i}-{k}"),
        ));
    }
    v
}

#[test]
#[ignore]
fn ceiling_store() {
    let Some(dir) = std::env::var_os("CEILING_DIR").map(PathBuf::from) else {
        return;
    };
    let state = dir.join("state");
    let db = meter::paths::prepare(&state).unwrap();
    let now = meter::time::now_ms();
    let hour = meter::time::hour_start(now);
    drop(Store::open(&db).unwrap());
    let c = Connection::open(&db).unwrap();
    c.execute_batch("BEGIN").unwrap();
    let harnesses = ["claude-code", "codex", "omp"];
    {
        let mut st = c
            .prepare(
                "INSERT INTO usage(id, hour_ms, harness, model, machine, repo, branch,
                   input_uncached, cache_read, cache_write_5m, cache_write_1h, output, reasoning,
                   unsplit, precision, reported_usd, events, updated_ms)
                 VALUES(?1, ?2, ?3, ?4, 'machine-ceiling', ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, 0,
                   'exact', NULL, 7, ?12)",
            )
            .unwrap();
        let mut n = 0u64;
        for (b, (repo, branch)) in ceiling_branches().iter().enumerate() {
            // About 100 rollup rows per branch over 90 days, about a third in the d30 window.
            for r in 0..100u64 {
                n += 1;
                let h = hour - ((r * 21 + b as u64 * 7) % (90 * 24)) as i64 * HOUR_MS;
                let harness = harnesses[(r % 3) as usize];
                let model = if r % 3 == 1 {
                    CODEX_MODEL
                } else {
                    CLAUDE_MODEL
                };
                let branch = if harness == "omp" && r % 9 == 2 {
                    None
                } else {
                    Some(branch.as_str())
                };
                st.execute(params![
                    format!("c{n}"),
                    h,
                    harness,
                    model,
                    repo,
                    branch,
                    1000 + r as i64,
                    50_000 + r as i64,
                    2_000,
                    3_000,
                    400,
                    now
                ])
                .unwrap();
            }
        }
        let mut seen = c
            .prepare("INSERT INTO seen(k, seq) VALUES(?1, ?2)")
            .unwrap();
        for k in 0..1_000_000i64 {
            seen.execute(params![k * 7919 + 13, k]).unwrap();
        }
        let mut sess = c
            .prepare(
                "INSERT INTO sessions(harness, session, parent_session, first_ms, last_ms)
                 VALUES('claude-code', ?1, NULL, ?2, ?2)",
            )
            .unwrap();
        for s in 0..10_000i64 {
            sess.execute(params![format!("sess-ceiling-{s}"), now])
                .unwrap();
        }
    }
    let counted_from = meter::time::day_start(now) - 89 * meter::time::DAY_MS;
    for (k, v) in [
        ("counted_from_ms", counted_from.to_string()),
        ("last_run_ms", (now - 300_000).to_string()),
        ("last_success_ms", (now - 300_000).to_string()),
        ("last_pending_bytes", "0".into()),
        ("last_pending_files", "0".into()),
        ("machine", "machine-ceiling".into()),
        ("codex_status", "ok".into()),
        ("codex_reason", String::new()),
        ("omp_status", "ok".into()),
        ("claude-code_status", "ok".into()),
    ] {
        c.execute(
            "INSERT INTO meta(k, v) VALUES(?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![k, v],
        )
        .unwrap();
    }
    for h in harnesses {
        c.execute(
            "INSERT INTO health(source, last_success_ms) VALUES(?1, ?2)",
            params![h, now - 300_000],
        )
        .unwrap();
    }
    c.execute_batch("COMMIT").unwrap();
    drop(c);

    // New logs for the sync that runs beside the concurrent queries: about 5 MiB in 50 files.
    let home = dir.join("home");
    for f in 0..50 {
        let p = home.join(format!(".claude/projects/-work-ceiling/sess-{f}.jsonl"));
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        let ts = format_rfc3339(now - 600_000);
        let lines: Vec<String> = (0..80)
            .map(|i| {
                common::claude_line(
                    &format!("msg_c{f}_{i}"),
                    &format!("req_c{f}_{i}"),
                    &ts,
                    CLAUDE_MODEL,
                    &common::U1,
                    1200,
                )
            })
            .collect();
        common::write_lines(&p, &lines);
    }
}

// ---------------------------------------------------------------------------------------------
// The fix round on PR 806.

/// The Reviewer's H1: a reset drops every row and the re-import commits chunk by chunk. Until a
/// run over the new window ends, the answer has no watermark and an unknown backlog: never a
/// partial re-import called complete and fresh, never a zero.
#[test]
fn a_reset_in_progress_is_never_complete_or_fresh() {
    let fx = plain_store();
    let (code, v) = fx.query(&args(&["feat/gn-12-cache"]));
    assert_eq!(code, 0);
    assert_eq!(v["ingestion"]["complete"], true);
    // What sync does first: the reset, committed on its own.
    let counted_from = Store::open(&fx.db())
        .unwrap()
        .meta_i64("counted_from_ms")
        .unwrap()
        .unwrap();
    Store::open(&fx.db()).unwrap().reset(counted_from).unwrap();
    let (code, v) = fx.query(&args(&["feat/gn-12-cache", "docs/none"]));
    assert_eq!(code, 0, "{v}");
    assert!(schema().valid(&v), "{:#?}", schema().errors(&v));
    let ing = &v["ingestion"];
    assert!(ing["watermark"].is_null(), "{ing}");
    assert_eq!(ing["complete"], false, "{ing}");
    assert_eq!(ing["stale"], true, "{ing}");
    assert!(
        ing["backlog"]["bytes"].is_null() && ing["backlog"]["files"].is_null(),
        "{ing}"
    );
    for r in rows_of(&v) {
        assert_eq!(r["state"], "stale", "{r}");
        assert!(
            r["tokens"].is_null(),
            "nothing re-imported yet: no number at all: {r}"
        );
    }
}

/// PR 802's review: dsh-tui logs no reasoning split, so a row it counted toward has reasoning
/// null (unknown), never 0; a row of harnesses that log it keeps its number.
#[test]
fn reasoning_is_null_when_a_harness_that_counted_logs_none() {
    let fx = plain_store();
    let c = Connection::open(fx.db()).unwrap();
    c.execute(
        "INSERT INTO usage(id, hour_ms, harness, model, machine, repo, branch, input_uncached,
           cache_read, cache_write_5m, cache_write_1h, output, reasoning, unsplit, precision,
           events, updated_ms) VALUES('dsh-1', ?1, 'dsh-tui', 'model-d', 'm', ?2,
           'feat/gn-12-cache', 10, 20, 0, 0, 30, 0, 0, 'exact', 1, 0)",
        params![t("2026-11-08T11:00:00Z"), REPO],
    )
    .unwrap();
    drop(c);
    let (_, v) = fx.query(&args(&["feat/gn-12-cache"]));
    assert!(schema().valid(&v), "{:#?}", schema().errors(&v));
    let tk = &rows_of(&v)[0]["tokens"];
    assert!(tk["reasoning"].is_null(), "{tk}");
    assert_eq!(tk["output"], 80, "the counts themselves stay known: {tk}");
    let (_, v) = scenario("priced");
    assert_eq!(rows_of(&v)[0]["tokens"]["reasoning"], 12000);
}

/// The team decision under RFC 0018 (a): in a state folder the meter cannot write, a store whose
/// `-wal` and `-shm` already exist is read as usual; one without them is refused by name
/// (`read_only_folder`, exit 1), with nothing created and no `immutable` open.
#[cfg(unix)]
#[test]
fn a_read_only_state_folder_is_read_with_companions_and_refused_without() {
    use std::os::unix::fs::PermissionsExt;
    if unsafe { libc::geteuid() } == 0 {
        eprintln!("skipped: permissions do not bind root");
        return;
    }
    let fx = plain_store();
    let state = fx.env.state();
    let mode = |m: u32| fs::set_permissions(&state, fs::Permissions::from_mode(m)).unwrap();
    assert!(!state.join("meter.db-shm").exists(), "the store is at rest");
    let before = folder(&state);
    mode(0o500);
    let (code, v) = fx.query(&args(&["feat/gn-12-cache"]));
    let out = bin(&fx, &["status"]);
    mode(0o700);
    assert_eq!(code, query::exit::ERROR, "{v}");
    assert_eq!(v["error"]["code"], "read_only_folder");
    assert!(schema().valid(&v));
    check_refusal_nulls("read_only_folder", &v);
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("read_only_folder"));
    strictly_same_folder(&folder(&state), &before, "a refused read-only folder");

    // A reader left the companions: the read-only folder is read.
    assert_eq!(fx.query(&args(&["feat/gn-12-cache"])).0, 0);
    assert!(state.join("meter.db-shm").exists() && state.join("meter.db-wal").exists());
    mode(0o500);
    let (code, v) = fx.query(&args(&["feat/gn-12-cache"]));
    let out = bin(&fx, &["status"]);
    mode(0o700);
    assert_eq!(code, 0, "{v}");
    assert_eq!(rows_of(&v)[0]["state"], "measured");
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// The Fixer's L1: a newer store is refused before the state move runs, so nothing in either
/// folder changes (not even the old folder's lock file the move would make).
#[test]
fn a_newer_store_is_refused_before_the_move_runs() {
    let fx = plain_store();
    set_version(&fx, "3");
    let old = fx.env.dir.path().join("old-state");
    fs::create_dir_all(&old).unwrap();
    fs::copy(fx.db(), old.join("meter.db")).unwrap();
    let (before_new, before_old) = (folder(&fx.env.state()), folder(&old));
    let mut o = sync_opts(&fx, t(GENERATED));
    o.migrate_from = Some(old.clone());
    let out = fx.env.sync(&o);
    assert!(matches!(out, Outcome::NewerSchema { store: 3 }), "{out:?}");
    strictly_same_folder(&folder(&fx.env.state()), &before_new, "the state folder");
    strictly_same_folder(&folder(&old), &before_old, "the old folder");

    // Only the old folder holds a store, a newer one: it is not moved in.
    let fresh = Env::new();
    let new = fresh.state();
    meter::paths::ensure_dir(&new).unwrap();
    let old = fresh.dir.path().join("old-state");
    fs::create_dir_all(&old).unwrap();
    fs::copy(fx.db(), old.join("meter.db")).unwrap();
    let before_old = folder(&old);
    let mut o = fresh.opts();
    o.now_ms = t(GENERATED);
    o.migrate_from = Some(old.clone());
    let out = fresh.sync(&o);
    assert!(matches!(out, Outcome::NewerSchema { store: 3 }), "{out:?}");
    strictly_same_folder(&folder(&old), &before_old, "the old folder");
    assert!(!new.join("meter.db").exists() && !new.join(".meter-moved").exists());
}

/// The Fixer's L2: the generation is guarded by whether the store holds rows, not by whether its
/// window is recorded.
#[test]
fn a_store_with_rows_but_no_window_keeps_a_generation_before_its_reset() {
    let fx = plain_store();
    Connection::open(fx.db())
        .unwrap()
        .execute("DELETE FROM meta WHERE k = 'counted_from_ms'", [])
        .unwrap();
    let old_counts = store_counts(&fx.db());
    let r = fx.env.run(&sync_opts(&fx, t(GENERATED)));
    assert!(r.reimported);
    let g = r.generation.expect("a generation before the reset");
    assert_eq!(g.counts, old_counts);
}

/// The Fixer's L3: a priced amount above 0 never prints as 0 after rounding.
#[test]
fn a_tiny_priced_cost_is_never_shown_as_0() {
    let mut fx = Fx::new(SYNCED);
    healthy(&fx);
    fx.claude(
        "feat/tiny",
        "claude-haiku-5-5",
        t("2026-11-08T08:00:00Z"),
        [1, 0, 0, 0, 0, 0],
    );
    fx.sync(SYNCED, 60);
    let (_, v) = fx.query(&args(&["feat/tiny"]));
    let c = &rows_of(&v)[0]["cost"];
    assert_eq!(c["state"], "priced", "{c}");
    for k in ["usd", "usd_estimated"] {
        assert!(c[k].as_f64().unwrap() > 0.0, "{k}: {c}");
    }
    assert_eq!(c["usd_reported"], 0, "nothing reported is a real 0");
}

/// The Fixer's L4: a repo past 512 bytes gets the defined refusal (exit 2, request_too_large)
/// with its echo, the repo cut to fit and marked so, never a null query.
#[test]
fn a_repo_past_its_bound_is_refused_with_a_marked_echo() {
    let fx = plain_store();
    let repo = format!("example.com/acme/{}", "w".repeat(600));
    let a = vec![
        "--repo".to_string(),
        repo.clone(),
        "--branch".into(),
        "feat/x".into(),
        "--json".into(),
    ];
    let (code, v) = fx.query(&a);
    assert_eq!(code, query::exit::USAGE, "{v}");
    assert!(schema().valid(&v), "{:#?}", schema().errors(&v));
    check_refusal_nulls("repo past its bound", &v);
    assert_eq!(v["error"]["code"], "request_too_large");
    assert_eq!(v["error"]["limit_bytes"], 512);
    assert_eq!(v["error"]["needed_bytes"], repo.len());
    let q = &v["query"];
    assert_eq!(q["repo_complete"], false);
    let echoed = q["repo"].as_str().unwrap();
    assert!(echoed.len() <= 512 && repo.starts_with(echoed), "{echoed}");
    // An answer that fits never carries the field.
    let (_, ok) = fx.query(&args(&["feat/gn-12-cache"]));
    assert!(ok["query"].get("repo_complete").is_none());
}

/// The Fixer's L6: adding the query's index to an older store follows the same free-space rule
/// as any write to an existing store's schema.
#[test]
fn adding_the_index_to_an_older_store_needs_twice_its_size_free() {
    let fx = plain_store();
    Connection::open(fx.db())
        .unwrap()
        .execute_batch("DROP INDEX usage_repo_branch")
        .unwrap();
    let state = fx.env.state();
    let size = fs::metadata(fx.db()).unwrap().len();
    let before = folder(&state);
    let mut o = sync_opts(&fx, t(GENERATED));
    o.free_bytes = Some(2 * size - 1);
    let out = fx.env.sync(&o);
    assert!(matches!(out, Outcome::NoSpace { .. }), "{out:?}");
    strictly_same_folder(&folder(&state), &before, "a refused index");
    o.free_bytes = Some(2 * size);
    fx.env.run(&o);
    assert!(
        meter::store::peek(&fx.db())
            .unwrap()
            .unwrap()
            .has_repo_index
    );
}

/// The Reviewer's L2: the free-space refusal through the real statvfs, not the test hook. The
/// store is made larger than the free space by a sparse tail (SQLite reads its own size from the
/// header, and a hole takes no disk), so twice its size cannot be free.
#[cfg(unix)]
#[test]
fn a_real_free_space_refusal_reads_the_filesystem() {
    let fx = plain_store();
    set_version(&fx, "1");
    let state = fx.env.state();
    let free = meter::paths::free_bytes(&state).unwrap();
    let head = |p: &Path| {
        use std::io::Read;
        let mut b = vec![0u8; 64 << 10];
        let n = fs::File::open(p).unwrap().read(&mut b).unwrap();
        b.truncate(n);
        b
    };
    let len = fs::metadata(fx.db()).unwrap().len();
    fs::OpenOptions::new()
        .write(true)
        .open(fx.db())
        .unwrap()
        .set_len(len.max(free) + (1 << 20))
        .unwrap();
    let names = |d: &Path| -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(d)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    };
    let (len_before, head_before, names_before) = (
        fs::metadata(fx.db()).unwrap().len(),
        head(&fx.db()),
        names(&state),
    );
    let o = sync_opts(&fx, t(GENERATED));
    assert_eq!(o.free_bytes, None, "the real filesystem is asked");
    let out = fx.env.sync(&o);
    match out {
        Outcome::NoSpace { free: f, needed } => {
            assert_eq!(needed, 2 * len_before, "{f}");
            assert!(f < needed);
        }
        other => panic!("expected the real refusal, got {other:?}"),
    }
    assert_eq!(fs::metadata(fx.db()).unwrap().len(), len_before);
    assert_eq!(head(&fx.db()), head_before);
    assert_eq!(names(&state), names_before, "no generation, no companion");
}
