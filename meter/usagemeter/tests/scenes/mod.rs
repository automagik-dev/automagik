//! Stores for the attribution examples (RFC 0021 delivery 6), each built from synthetic logs,
//! Herdr ledgers and an hc snapshot, then synced and queried as genie would. Every id, bot, path,
//! model and number here is made up.
//!
//! A scene's store starts as an empty schema 2 store (the meter before evidence) whose window
//! began on `counted_from`; a sync migrates it to schema 3, so evidence starts at the next hour,
//! as it does on a machine that takes the meter release. Then the logs, the ledgers and the
//! snapshot are written, and the last sync reads them at the examples' clock.
//!
//! The examples' costs were set by hand when the contract was written, before any meter answered
//! them. A row's usage is therefore spread over two bundled models: most of its calls on one, and
//! one call on a cheaper one, sized so that the estimate lands on the example's amount. The models
//! never show in an answer.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::fs;
use std::time::Duration;

use meter::event::{Precision, RollupKey};
use meter::hc::{Labels, Terminal};
use meter::paths::StateDirs;
use meter::query::{self, Ctx};
use meter::store::Store;
use meter::sync::Report;
use meter::time::{HOUR_MS, format_rfc3339, parse_rfc3339};
use rusqlite::{Connection, params};

use crate::common::{self, Env, serial};

pub const REPO: &str = "example.com/acme/widgets";
pub const ROOT: &str = "/work/widgets";
pub const REMOTE: &str = "https://example.com/acme/widgets.git";
pub const MACHINE: &str = "machine-a1b2c3";
/// A linked computer's core: its rows in this machine's ledgers name sessions run there.
pub const OTHER_CORE: &str = "machine-z9y8x7";
pub const SYNCED: &str = "2026-11-08T19:52:41Z";
pub const GENERATED: &str = "2026-11-08T20:00:05Z";
pub const EXAMPLE_VERSION: &str = "3.107.0";
pub const COUNTED_FROM: &str = "2026-09-10T00:00:00Z";

pub const OPUS: &str = "claude-opus-5-5";
pub const HAIKU: &str = "claude-haiku-5-5";
pub const SONNET: &str = "claude-sonnet-5-5";
pub const SOL: &str = "gpt-6.1-sol";
pub const TERRA: &str = "gpt-6.1-terra";

/// Tokens of one kind each: input (uncached), cache read, cache write 5m and 1h, output, and
/// reasoning (inside output).
pub type Split = [i64; 6];

pub fn t(s: &str) -> i64 {
    parse_rfc3339(s).unwrap_or_else(|| panic!("bad time {s}"))
}

pub fn wt(name: &str) -> String {
    format!("{ROOT}/.worktrees/{name}")
}

/// `n` distinct hours from `first` to `last`, both included.
pub fn hours(first: &str, last: &str, n: usize) -> Vec<i64> {
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

/// The hours named, each `YYYY-MM-DDTHH`.
pub fn at(hs: &[&str]) -> Vec<i64> {
    hs.iter().map(|h| t(&format!("{h}:00:00Z"))).collect()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum H {
    Claude,
    Codex,
    Dsh,
    Omp,
}

/// One session's usage: `total` over one call per hour, on model `a`; with `b`, the last hour's
/// call is `b`'s model with its own tokens, and the rest of `total` is spread over the others
/// (the first hour takes the remainder).
#[derive(Clone)]
pub struct Usage {
    pub h: H,
    pub session: String,
    pub cwd: String,
    pub branch: Option<String>,
    pub hours: Vec<i64>,
    pub total: Split,
    pub a: &'static str,
    pub b: Option<(&'static str, Split)>,
}

impl Usage {
    pub fn new(h: H, session: &str, cwd: &str, branch: Option<&str>, hours: Vec<i64>) -> Usage {
        Usage {
            h,
            session: session.into(),
            cwd: cwd.into(),
            branch: branch.map(Into::into),
            hours,
            total: [0; 6],
            a: match h {
                H::Claude | H::Omp => OPUS,
                H::Codex | H::Dsh => TERRA,
            },
            b: None,
        }
    }

    pub fn tokens(mut self, total: Split) -> Usage {
        self.total = total;
        self
    }

    pub fn model(mut self, a: &'static str) -> Usage {
        self.a = a;
        self
    }

    pub fn cheap(mut self, b: &'static str, s: Split) -> Usage {
        self.b = Some((b, s));
        self
    }

    /// (hour, model, tokens) of each call.
    fn calls(&self) -> Vec<(i64, &'static str, Split)> {
        let (spread, last) = match self.b {
            Some((m, s)) => {
                let mut rest = self.total;
                for k in 0..6 {
                    rest[k] -= s[k];
                    assert!(
                        rest[k] >= 0,
                        "{}: the cheap call takes more than the total",
                        self.session
                    );
                }
                (rest, Some((m, s)))
            }
            None => (self.total, None),
        };
        let n = self.hours.len() - usize::from(last.is_some());
        let mut out = Vec::new();
        for (i, h) in self.hours[..n].iter().enumerate() {
            let mut s = [0; 6];
            for k in 0..6 {
                s[k] = spread[k] / n as i64 + if i == 0 { spread[k] % n as i64 } else { 0 };
            }
            out.push((*h, self.a, s));
        }
        if let Some((m, s)) = last {
            out.push((*self.hours.last().unwrap(), m, s));
        }
        out
    }
}

/// A Herdr start row (RFC 0021 (f)). `role` and `squad`: None leaves the field out (a row from
/// before RFC 0021 delivery 3, so it is unrecorded), Some(None) records a null.
pub struct Start<'a> {
    pub kind: &'a str,
    pub terminal: &'a str,
    pub bot: &'a str,
    pub role: Option<Option<&'a str>>,
    pub squad: Option<Option<&'a str>>,
    pub agent: &'a str,
    pub worktree: &'a str,
    pub branch: Option<&'a str>,
    /// Genie's short task id (`--task`), else None; a seat never records one.
    pub task: Option<&'a str>,
    /// The main checkout the launch recorded: the task key's second half. None: [`ROOT`].
    pub project: Option<&'a str>,
    pub created: i64,
    pub session: Option<&'a str>,
    pub core: &'a str,
}

impl Start<'_> {
    pub fn row(&self) -> String {
        let mut v = serde_json::json!({
            "event": "start", "kind": self.kind, "terminal": self.terminal, "botId": self.bot,
            "worktree": self.worktree, "agent": self.agent, "branch": self.branch,
            "project": self.project.unwrap_or(ROOT), "lead": null, "core": self.core,
            "created_ms": self.created, "session": self.session,
            "at": format_rfc3339(self.created + 5_000)
        });
        if self.kind == "worker" {
            v["task"] = serde_json::json!(self.task);
        }
        if let Some(r) = self.role {
            v["role"] = serde_json::json!(r);
        }
        if let Some(s) = self.squad {
            v["squad"] = serde_json::json!(s);
        }
        v.to_string()
    }
}

/// A worker's start row on this machine, with every field RFC 0021 delivery 3 records.
#[allow(clippy::too_many_arguments)]
pub fn worker<'a>(
    terminal: &'a str,
    bot: &'a str,
    role: &'a str,
    squad: &'a str,
    agent: &'a str,
    worktree: &'a str,
    branch: &'a str,
    created: i64,
) -> Start<'a> {
    Start {
        kind: "worker",
        terminal,
        bot,
        role: Some(Some(role)),
        squad: Some(Some(squad)),
        agent,
        worktree,
        branch: Some(branch),
        task: None,
        project: None,
        created,
        session: None,
        core: MACHINE,
    }
}

/// A `session` row: the session ran in the launch keyed (this core, `terminal`, `created`).
pub fn session_row(terminal: &str, created: i64, session: &str, agent: &str, at_ms: i64) -> String {
    serde_json::json!({
        "event": "session", "terminal": terminal, "created_ms": created, "core": MACHINE,
        "session": session, "agent": agent, "at": format_rfc3339(at_ms)
    })
    .to_string()
}

/// A live terminal hc lists, with a session label.
pub fn labelled(
    terminal: &str,
    created: i64,
    harness: &'static str,
    cwd: &str,
    session: &str,
) -> Terminal {
    Terminal {
        terminal: terminal.into(),
        created_ms: Some(created),
        finished_ms: None,
        harness: Some(harness),
        cwd: Some(cwd.into()),
        labels: Labels {
            session: Some(session.into()),
            ..Labels::default()
        },
    }
}

/// Schema 2's tables, as a 3.108 meter made them.
const V2_TABLES: &str = "
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE usage (
  id TEXT PRIMARY KEY, hour_ms INTEGER NOT NULL, bot TEXT, role TEXT, squad TEXT,
  harness TEXT NOT NULL, model TEXT NOT NULL, machine TEXT NOT NULL, repo TEXT, branch TEXT,
  input_uncached INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write_5m INTEGER NOT NULL DEFAULT 0, cache_write_1h INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0, reasoning INTEGER NOT NULL DEFAULT 0,
  unsplit INTEGER NOT NULL DEFAULT 0, precision TEXT NOT NULL, reported_usd REAL,
  events INTEGER NOT NULL DEFAULT 0, updated_ms INTEGER NOT NULL
);
CREATE INDEX usage_hour ON usage(hour_ms);
CREATE INDEX usage_repo_branch ON usage(repo, branch, hour_ms);
CREATE TABLE files (
  path TEXT PRIMARY KEY, source TEXT NOT NULL,
  dev INTEGER NOT NULL, ino INTEGER NOT NULL, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL,
  offset INTEGER NOT NULL, head_skip INTEGER NOT NULL DEFAULT 0,
  head_len INTEGER NOT NULL, head_hash TEXT NOT NULL,
  ctx TEXT NOT NULL DEFAULT '{}', rewrites INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE seen (k INTEGER PRIMARY KEY, seq INTEGER NOT NULL);
CREATE INDEX seen_seq ON seen(seq);
CREATE TABLE sessions (
  harness TEXT NOT NULL, session TEXT NOT NULL, parent_session TEXT,
  first_ms INTEGER NOT NULL, last_ms INTEGER NOT NULL, PRIMARY KEY (harness, session)
);
CREATE TABLE cwd_repo (cwd TEXT PRIMARY KEY, repo TEXT, checked_ms INTEGER NOT NULL);
CREATE TABLE health (
  source TEXT PRIMARY KEY, last_success_ms INTEGER,
  usage_lines INTEGER NOT NULL DEFAULT 0, events INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0, skipped_lines INTEGER NOT NULL DEFAULT 0,
  rewrites INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE codex_threads (id TEXT PRIMARY KEY, path TEXT, cum TEXT NOT NULL, counted INTEGER NOT NULL);
";

/// A rollup row a schema 2 meter wrote: its bot and role, if any, are frozen tags.
pub struct Frozen<'a> {
    pub bot: Option<&'a str>,
    pub harness: &'a str,
    pub model: &'a str,
    pub branch: Option<&'a str>,
    pub hour: i64,
    pub tokens: Split,
}

pub struct Scene {
    pub env: Env,
    usage: Vec<Usage>,
    ledger: Vec<String>,
    pub snapshot: Vec<Terminal>,
    n: usize,
}

impl Scene {
    /// A store whose window began on [`COUNTED_FROM`], holding `frozen` rows a schema 2 meter
    /// wrote, migrated to schema 3 by a sync at `migrated` (evidence from the next hour). Every
    /// harness's log folder is on this machine.
    pub fn migrated(migrated: &str, frozen: &[Frozen<'_>]) -> Scene {
        let env = Env::new();
        let db = meter::paths::prepare(&env.state()).unwrap();
        let c = Connection::open(&db).unwrap();
        c.execute_batch(V2_TABLES).unwrap();
        for (k, v) in [
            ("schema_version", "2".to_string()),
            ("counted_from_ms", t(COUNTED_FROM).to_string()),
            ("machine", MACHINE.into()),
        ] {
            c.execute("INSERT INTO meta(k, v) VALUES(?1, ?2)", params![k, v])
                .unwrap();
        }
        for f in frozen {
            let key = RollupKey {
                bot: f.bot.map(Into::into),
                role: f.bot.map(|_| "dev".to_string()),
                harness: f.harness.into(),
                model: f.model.into(),
                machine: MACHINE.into(),
                repo: Some(REPO.into()),
                branch: f.branch.map(Into::into),
                hour_ms: f.hour,
                ..RollupKey::default()
            };
            let s = f.tokens;
            c.execute(
                "INSERT INTO usage(id, hour_ms, bot, role, harness, model, machine, repo, branch,
                   input_uncached, cache_read, cache_write_5m, cache_write_1h, output, reasoning,
                   precision, events, updated_ms)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'exact',
                   1, 0)",
                params![
                    key.id(Precision::Exact),
                    f.hour,
                    key.bot,
                    key.role,
                    key.harness,
                    key.model,
                    MACHINE,
                    REPO,
                    key.branch,
                    s[0],
                    s[1],
                    s[2],
                    s[3],
                    s[4],
                    s[5]
                ],
            )
            .unwrap();
        }
        drop(c);
        let home = env.home();
        for d in [
            ".omp/agent/sessions",
            ".claude/projects",
            ".dsh/sessions",
            ".config/herdr-app/automagik-herdr",
        ] {
            fs::create_dir_all(home.join(d)).unwrap();
        }
        codex_db(&env);
        let scene = Scene {
            env,
            usage: Vec::new(),
            ledger: Vec::new(),
            snapshot: Vec::new(),
            n: 0,
        };
        // A window no wider than the stored one, so the sync migrates and never resets.
        let days = (t(migrated) - t(COUNTED_FROM)) / meter::time::DAY_MS + 1;
        let r = scene.sync_at(migrated, days, None);
        assert!(r.migrated && !r.reimported, "{r:?}");
        scene
    }

    pub fn add(&mut self, u: Usage) {
        self.usage.push(u);
    }

    pub fn start(&mut self, s: Start<'_>) {
        self.ledger.push(s.row());
    }

    pub fn ledger_row(&mut self, row: String) {
        self.ledger.push(row);
    }

    /// Writes every log and the ledger, then syncs at [`SYNCED`] over 60 days, as the examples'
    /// stores were.
    pub fn sync(&mut self) -> Report {
        self.write();
        self.sync_at(SYNCED, 60, None)
    }

    /// Writes what was added since, then syncs at [`SYNCED`] with `f`'s options.
    pub fn sync_with(&mut self, f: impl FnOnce(&mut meter::sync::Options)) -> Report {
        self.write();
        let _g = serial();
        let mut o = self.env.opts();
        o.now_ms = t(SYNCED);
        o.days = Some(60);
        o.snapshot = Some(self.snapshot.clone());
        f(&mut o);
        self.env.run(&o)
    }

    pub fn sync_at(&self, at: &str, days: i64, chunks: Option<usize>) -> Report {
        let _g = serial();
        let mut o = self.env.opts();
        o.now_ms = t(at);
        o.days = Some(days);
        o.chunk_limit = chunks;
        o.snapshot = Some(self.snapshot.clone());
        self.env.run(&o)
    }

    pub fn store(&self) -> Store {
        Store::open(&self.env.state().join("meter.db")).unwrap()
    }

    /// The query's answer, as the meter wrote it.
    pub fn query(&self, args: &[String]) -> (u8, String) {
        let ctx = Ctx {
            state: Some(StateDirs {
                dir: self.env.state(),
                legacy: None,
            }),
            overridden: false,
            now_ms: t(GENERATED),
            busy: Duration::from_secs(2),
            meter_version: EXAMPLE_VERSION.into(),
        };
        let a = query::run(args, &ctx);
        (a.code, a.stdout)
    }

    fn write(&mut self) {
        let ledger = self
            .env
            .home()
            .join(".config/herdr-app/automagik-herdr/workers.jsonl");
        if !self.ledger.is_empty() {
            fs::write(&ledger, self.ledger.join("\n") + "\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&ledger, fs::Permissions::from_mode(0o600)).unwrap();
            }
        }
        let store = self.store();
        for u in &self.usage {
            store.cache_repo(&u.cwd, Some(REPO), t(SYNCED)).unwrap();
        }
        drop(store);
        let mut claude: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut dsh: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut omp: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let codex = Connection::open(self.env.home().join(".codex/state_5.sqlite")).unwrap();
        let usage = std::mem::take(&mut self.usage);
        for u in &usage {
            match u.h {
                H::Claude => {
                    for (h, m, s) in u.calls() {
                        let line = self.claude_line(u, h, m, s);
                        claude.entry(u.session.clone()).or_default().push(line);
                    }
                }
                H::Dsh => {
                    let lines = dsh.entry(u.session.clone()).or_default();
                    if lines.is_empty() {
                        lines.push(format!(
                            r#"{{"type":"session","version":4,"id":"{}","createdAt":{},"cwd":"{}","isSeeded":false,"delegationDepth":0}}"#,
                            u.session,
                            u.hours[0] - 60_000,
                            u.cwd
                        ));
                    }
                    for (h, m, s) in u.calls() {
                        self.n += 1;
                        let n = self.n;
                        lines.push(format!(
                            concat!(
                                r#"{{"type":"assistant/message","seq":{n},"time":{ts},"surfaceOp":"append","#,
                                r#""data":{{"turn":1,"step":{n},"message":{{"role":"assistant","#,
                                r#""content":[{{"type":"text","text":"FAKE-ANSWER"}}],"#,
                                r#""source":{{"kind":"llm","provider":"example","model":"{m}"}},"#,
                                r#""id":"{sess}-m{n}"}},"usage":{{"inputTokens":{i},"outputTokens":{o},"#,
                                r#""cacheReadTokens":{r},"cacheWriteTokens":0,"totalTokens":{tt}}},"stream":[]}}}}"#
                            ),
                            n = n,
                            ts = h + 20 * 60_000,
                            m = m,
                            sess = u.session,
                            i = s[0],
                            o = s[4],
                            r = s[1],
                            tt = s[0] + s[1] + s[4],
                        ));
                    }
                }
                H::Omp => {
                    let lines = omp.entry(u.session.clone()).or_default();
                    if lines.is_empty() {
                        lines.push(format!(
                            r#"{{"type":"session","version":3,"id":"{}","timestamp":"{}","cwd":"{}"}}"#,
                            u.session,
                            format_rfc3339(u.hours[0]),
                            u.cwd
                        ));
                    }
                    for (h, m, s) in u.calls() {
                        self.n += 1;
                        lines.push(format!(
                            concat!(
                                r#"{{"type":"message","id":"e{n}","timestamp":"{ts}","message":{{"role":"assistant","#,
                                r#""model":"{m}","content":[{{"type":"text","text":"FAKE"}}],"usage":{{"input":{i},"#,
                                r#""output":{o},"cacheRead":{r},"cacheWrite":0,"totalTokens":{tt}}}}}}}"#
                            ),
                            n = self.n,
                            ts = format_rfc3339(h + 10 * 60_000),
                            m = m,
                            i = s[0],
                            o = s[4],
                            r = s[1],
                            tt = s[0] + s[1] + s[4],
                        ));
                    }
                }
                H::Codex => self.codex_thread(&codex, u),
            }
        }
        for (session, lines) in claude {
            common::write_lines(
                &self.env.claude(&format!("-work-widgets/{session}.jsonl")),
                &lines,
            );
        }
        for (session, lines) in dsh {
            let p = self
                .env
                .dsh(&format!("-work-widgets/{session}/session.v4.jsonl.zstd"));
            let mut s = lines.join("\n");
            s.push('\n');
            let bytes = ruzstd::encoding::compress_to_vec(
                s.as_bytes(),
                ruzstd::encoding::CompressionLevel::Fastest,
            );
            fs::write(p, bytes).unwrap();
        }
        for (session, lines) in omp {
            common::write_lines(
                &self.env.omp(&format!("-work-widgets/{session}.jsonl")),
                &lines,
            );
        }
    }

    fn claude_line(&mut self, u: &Usage, h: i64, model: &str, s: Split) -> String {
        self.n += 1;
        let n = self.n;
        format!(
            concat!(
                r#"{{"type":"assistant","requestId":"req_s{n}","timestamp":"{ts}","#,
                r#""sessionId":"{sess}","cwd":"{cwd}","gitBranch":"{branch}","#,
                r#""message":{{"id":"msg_s{n}","model":"{model}","role":"assistant","#,
                r#""content":[{{"type":"text","text":"FAKE-TEXT"}}],"#,
                r#""usage":{{"input_tokens":{i},"output_tokens":{o},"#,
                r#""cache_read_input_tokens":{r},"cache_creation_input_tokens":{w},"#,
                r#""cache_creation":{{"ephemeral_5m_input_tokens":{w5},"#,
                r#""ephemeral_1h_input_tokens":{w1}}},"#,
                r#""output_tokens_details":{{"thinking_tokens":{rs}}}}}}}}}"#
            ),
            n = n,
            ts = format_rfc3339(h + 15 * 60_000),
            sess = u.session,
            cwd = u.cwd,
            branch = u.branch.as_deref().unwrap_or(""),
            model = model,
            i = s[0],
            r = s[1],
            w = s[2] + s[3],
            w5 = s[2],
            w1 = s[3],
            o = s[4],
            rs = s[5],
        )
    }

    /// A Codex thread per model: its rollout holds a running total after each call.
    fn codex_thread(&self, db: &Connection, u: &Usage) {
        let mut by_model: BTreeMap<&str, Vec<(i64, Split)>> = BTreeMap::new();
        for (h, m, s) in u.calls() {
            by_model.entry(m).or_default().push((h, s));
        }
        for (k, (model, calls)) in by_model.into_iter().enumerate() {
            let id = if k == 0 {
                u.session.clone()
            } else {
                format!("{}-{k}", u.session)
            };
            let rollout = self
                .env
                .home()
                .join(".codex/sessions/2026/11/01")
                .join(format!("rollout-2026-11-01T00-00-00-{id}.jsonl"));
            fs::create_dir_all(rollout.parent().unwrap()).unwrap();
            let (mut input, mut cached, mut output, mut reasoning) = (0i64, 0i64, 0i64, 0i64);
            let mut lines = Vec::new();
            for (h, s) in &calls {
                input += s[0] + s[1];
                cached += s[1];
                output += s[4];
                reasoning += s[5];
                lines.push(format!(
                    concat!(
                        r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","#,
                        r#""info":{{"total_token_usage":{{"input_tokens":{i},"cached_input_tokens":{c},"#,
                        r#""output_tokens":{o},"reasoning_output_tokens":{r},"total_tokens":{tt}}}}}}}}}"#
                    ),
                    ts = format_rfc3339(h + 20 * 60_000),
                    i = input,
                    c = cached,
                    o = output,
                    r = reasoning,
                    tt = input + output,
                ));
            }
            common::write_lines(&rollout, &lines);
            let last = calls.last().unwrap().0;
            db.execute(
                "INSERT INTO threads(id, rollout_path, cwd, tokens_used, git_branch, git_origin_url,
                   model, updated_at_ms) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    rollout.to_string_lossy(),
                    u.cwd,
                    input + output,
                    u.branch,
                    REMOTE,
                    model,
                    last + 30 * 60_000
                ],
            )
            .unwrap();
        }
    }
}

fn codex_db(env: &Env) {
    let home = env.home().join(".codex");
    fs::create_dir_all(&home).unwrap();
    let c = Connection::open(home.join("state_5.sqlite")).unwrap();
    c.execute_batch(
        "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL,
           tokens_used INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
           git_branch TEXT, git_origin_url TEXT, model TEXT, updated_at_ms INTEGER);
         CREATE TABLE thread_spawn_edges (parent_thread_id TEXT NOT NULL,
           child_thread_id TEXT NOT NULL PRIMARY KEY, status TEXT NOT NULL);",
    )
    .unwrap();
}

// ---------------------------------------------------------------------------------------------
// The examples' stores.

/// The request: `--by bot` when `by_bot`, each branch named, `--json`.
pub fn args(by_bot: bool, branches: &[&str]) -> Vec<String> {
    let mut v = vec!["--repo".to_string(), REPO.to_string()];
    if by_bot {
        v.extend(["--by".to_string(), "bot".to_string()]);
    }
    for b in branches {
        v.extend(["--branch".to_string(), b.to_string()]);
    }
    v.push("--json".into());
    v
}

/// The request: `--by task`, each branch named, `--json`.
pub fn task_args(branches: &[&str]) -> Vec<String> {
    let mut v = vec!["--repo".to_string(), REPO.to_string()];
    v.extend(["--by".to_string(), "task".to_string()]);
    for b in branches {
        v.extend(["--branch".to_string(), b.to_string()]);
    }
    v.push("--json".into());
    v
}

/// `idx` of `all`.
fn pick(all: &[i64], idx: &[usize]) -> Vec<i64> {
    idx.iter().map(|&i| all[i]).collect()
}

/// `by-bot.json`: a dev bot (otter) on Claude Code, named by its session, and on dsh-tui, found by
/// its worktree with its branch from the start row; a reviewer (heron) on Codex, re-led within the
/// window (squad lark, then wren), found by its worktree and once by a session label; and a
/// captain seat (lark) on Claude Code, named by its session. Everything is attributed.
pub fn bots() -> Scene {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let (c11, c12) = (t("2026-10-13T09:00:00Z"), t("2026-11-01T09:00:00Z"));
    let (c13, c14, c15) = (
        t("2026-10-09T08:00:00Z"),
        t("2026-10-19T09:00:00Z"),
        t("2026-10-21T10:00:00Z"),
    );
    let (w20, w24, w31, w33) = (wt("gn-20"), wt("gn-24"), wt("gn-31"), wt("gn-33"));
    s.start(worker(
        "t11",
        "heron",
        "review",
        "lark",
        "codex",
        &w20,
        "feat/gn-20-review",
        c11,
    ));
    s.start(worker(
        "t12",
        "heron",
        "review",
        "wren",
        "codex",
        &w24,
        "feat/gn-24-audit",
        c12,
    ));
    s.start(Start {
        kind: "seat",
        session: Some("s-lark"),
        branch: None,
        ..worker("t13", "lark", "captain", "lark", "claude", ROOT, "", c13)
    });
    s.start(Start {
        session: Some("s-otter"),
        ..worker(
            "t14",
            "otter",
            "dev",
            "lark",
            "claude",
            &w31,
            "feat/gn-31-sync",
            c14,
        )
    });
    s.start(worker(
        "t15",
        "otter",
        "dev",
        "lark",
        "dsh-tui",
        &w33,
        "feat/gn-33-tui",
        c15,
    ));
    s.snapshot
        .push(labelled("t12", c12, "codex", &w24, "th-heron-2l"));
    s.add(
        Usage::new(
            H::Codex,
            "th-heron-1",
            &w20,
            Some("feat/gn-20-review"),
            hours("2026-10-14T10:00:00Z", "2026-10-30T16:00:00Z", 7),
        )
        .model(SOL)
        .tokens([40000, 300000, 0, 0, 22000, 9000])
        .cheap(TERRA, [4200, 0, 0, 0, 0, 0]),
    );
    let h = hours("2026-11-02T09:00:00Z", "2026-11-08T11:00:00Z", 4);
    s.add(
        Usage::new(
            H::Codex,
            "th-heron-2l",
            &w24,
            Some("feat/gn-24-audit"),
            pick(&h, &[1]),
        )
        .model(TERRA)
        .tokens([7474, 50526, 0, 0, 2000, 1000]),
    );
    s.add(
        Usage::new(
            H::Codex,
            "th-heron-2",
            &w24,
            Some("feat/gn-24-audit"),
            pick(&h, &[0, 2, 3]),
        )
        .model(SOL)
        .tokens([17526, 129474, 0, 0, 13000, 5000]),
    );
    s.add(
        Usage::new(
            H::Claude,
            "s-lark",
            ROOT,
            Some("main"),
            hours("2026-10-10T08:00:00Z", "2026-11-08T19:00:00Z", 41),
        )
        .tokens([90000, 1600000, 120000, 0, 48000, 9000])
        .cheap(HAIKU, [2, 14, 0, 0, 10061, 0]),
    );
    s.add(
        Usage::new(
            H::Claude,
            "s-otter",
            &w31,
            Some("feat/gn-31-sync"),
            hours("2026-10-20T09:00:00Z", "2026-11-08T18:00:00Z", 23),
        )
        .tokens([120000, 2400000, 180000, 0, 64000, 12000])
        .cheap(HAIKU, [3, 9, 0, 0, 5107, 0]),
    );
    s.add(
        Usage::new(
            H::Dsh,
            "d-otter",
            &w33,
            None,
            hours("2026-10-22T10:00:00Z", "2026-11-07T15:00:00Z", 12),
        )
        .tokens([210000, 1900000, 0, 0, 70000, 0])
        .cheap(HAIKU, [1111, 2, 0, 0, 0, 0]),
    );
    s.sync();
    s
}

/// `by-bot-backlog.json`: [`bots`], then a sync at the same clock stopped by its budget before it
/// read anything new: a Claude log no run has read, and the Codex thread written last, which the
/// stopped run lists as left (with no new bytes). Nothing is given to no bot, yet an absent bot is
/// unknown and every row a lower bound.
pub fn bots_backlog() -> Scene {
    let s = bots();
    let p = s.env.claude("-work-widgets/s-unread.jsonl");
    let head = r#"{"type":"user","timestamp":"2026-11-08T19:55:00Z","sessionId":"s-unread","cwd":"/work/widgets","message":{"role":"user","content":""#;
    let tail = "\"}}\n";
    let pad = 524_288 - head.len() - tail.len();
    fs::write(&p, format!("{head}{}{tail}", "x".repeat(pad))).unwrap();
    let r = s.sync_at(SYNCED, 60, Some(0));
    assert_eq!((r.pending_bytes, r.pending_files), (524_288, 2), "{r:?}");
    s
}

/// `by-bot-lower-bound.json`, filtered by one branch: a reviewer whose start row recorded no squad
/// (written before RFC 0021 delivery 3), a dev bot on Claude Code (its session) and on dsh-tui (a
/// session row, and its worktree); and, given to no bot, a dev and a reviewer claiming one
/// worktree, an omp session nothing records, a dsh-tui seat in the project root, and a Claude
/// session another computer's start row names.
pub fn bots_lower_bound() -> Scene {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let b = "feat/gn-31-sync";
    let (w31r, w31, w31d, w35) = (wt("gn-31r"), wt("gn-31"), wt("gn-31d"), wt("gn-35"));
    let c = |d: &str| t(&format!("{d}T08:00:00Z"));
    s.start(Start {
        squad: None,
        ..worker(
            "t11",
            "heron",
            "review",
            "",
            "codex",
            &w31r,
            b,
            c("2026-10-14"),
        )
    });
    s.start(Start {
        session: Some("s-otter"),
        ..worker(
            "t14",
            "otter",
            "dev",
            "lark",
            "claude",
            &w31,
            b,
            c("2026-10-27"),
        )
    });
    s.start(worker(
        "t16",
        "otter",
        "dev",
        "lark",
        "dsh-tui",
        &w31d,
        b,
        c("2026-10-28"),
    ));
    s.ledger_row(session_row(
        "t16",
        c("2026-10-28"),
        "d-otter-s",
        "dsh-tui",
        c("2026-10-28") + 60_000,
    ));
    s.start(worker(
        "t17",
        "kite",
        "dev",
        "lark",
        "claude",
        &w35,
        "fix/gn-35-lock",
        c("2026-11-01"),
    ));
    s.start(worker(
        "t18",
        "heron",
        "review",
        "lark",
        "claude",
        &w35,
        "fix/gn-35-lock",
        c("2026-11-01"),
    ));
    s.start(Start {
        kind: "seat",
        session: Some("s-away"),
        branch: None,
        core: OTHER_CORE,
        ..worker(
            "t3",
            "swift",
            "captain",
            "swift",
            "claude",
            ROOT,
            "",
            c("2026-10-01"),
        )
    });
    s.add(
        Usage::new(
            H::Codex,
            "th-heron",
            &w31r,
            Some(b),
            hours("2026-10-15T10:00:00Z", "2026-10-21T17:00:00Z", 5),
        )
        .model(SOL)
        .tokens([30000, 240000, 0, 0, 18000, 7000])
        .cheap(TERRA, [4800, 0, 0, 0, 0, 0]),
    );
    s.add(
        Usage::new(
            H::Claude,
            "s-otter",
            &w31,
            Some(b),
            hours("2026-10-28T09:00:00Z", "2026-11-08T18:00:00Z", 14),
        )
        .tokens([80000, 1500000, 110000, 0, 41000, 8000])
        .cheap(HAIKU, [0, 13, 0, 0, 4405, 0]),
    );
    let h = hours("2026-10-29T10:00:00Z", "2026-11-07T15:00:00Z", 9);
    s.add(
        Usage::new(H::Dsh, "d-otter-s", &w31d, None, pick(&h, &[0, 3, 6]))
            .tokens([40000, 350000, 0, 0, 10000, 0]),
    );
    s.add(
        Usage::new(
            H::Dsh,
            "d-otter-w",
            &w31d,
            None,
            pick(&h, &[1, 2, 4, 5, 7, 8]),
        )
        .tokens([110000, 950000, 0, 0, 42000, 0])
        .cheap(HAIKU, [1, 2, 0, 0, 5422, 0]),
    );
    s.add(
        Usage::new(
            H::Claude,
            "s-amb",
            &w35,
            Some("fix/gn-35-lock"),
            at(&["2026-11-02T10", "2026-11-03T10"]),
        )
        .tokens([4000, 70000, 5000, 0, 5000, 1000]),
    );
    s.add(
        Usage::new(
            H::Omp,
            "o-root",
            ROOT,
            None,
            at(&["2026-11-04T10", "2026-11-04T11"]),
        )
        .tokens([2000, 48000, 0, 0, 2000, 0]),
    );
    s.add(
        Usage::new(
            H::Dsh,
            "d-seat",
            ROOT,
            None,
            at(&["2026-11-05T10", "2026-11-06T10"]),
        )
        .tokens([10000, 215000, 0, 0, 5000, 0]),
    );
    s.add(
        Usage::new(
            H::Claude,
            "s-away",
            ROOT,
            Some("main"),
            at(&["2026-11-07T10"]),
        )
        .tokens([1000, 38000, 1000, 0, 1000, 0]),
    );
    s.sync();
    s
}

/// `by-bot-unfiltered.json`: a bot query naming no branch beside usage with no branch: an omp
/// seat's, tied by its session label, counts in its own row with its branch basis `none`, and a
/// dsh-tui seat's is given to no bot.
pub fn bots_unfiltered() -> Scene {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let w31 = wt("gn-31");
    let (c14, c19) = (t("2026-10-29T08:00:00Z"), t("2026-11-02T08:00:00Z"));
    s.start(Start {
        session: Some("s-otter"),
        ..worker(
            "t14",
            "otter",
            "dev",
            "lark",
            "claude",
            &w31,
            "feat/gn-31-sync",
            c14,
        )
    });
    s.start(Start {
        kind: "seat",
        branch: None,
        ..worker("t19", "wren", "captain", "wren", "omp", ROOT, "", c19)
    });
    s.snapshot.push(labelled("t19", c19, "omp", ROOT, "o-wren"));
    s.add(otter_claude(&w31));
    s.add(
        Usage::new(
            H::Omp,
            "o-wren",
            ROOT,
            None,
            hours("2026-11-03T08:00:00Z", "2026-11-08T19:00:00Z", 8),
        )
        .tokens([30000, 250000, 0, 0, 20000, 0])
        .cheap(SONNET, [20000, 0, 0, 0, 20000, 0]),
    );
    s.add(
        Usage::new(
            H::Dsh,
            "d-seat",
            ROOT,
            None,
            at(&["2026-11-05T10", "2026-11-06T10"]),
        )
        .tokens([10000, 215000, 0, 0, 5000, 0]),
    );
    s.sync();
    s
}

/// otter's Claude Code session on `feat/gn-31-sync`, as `by-bot-unfiltered.json` and
/// `actor-ledger-branch.json` both hold it.
fn otter_claude(cwd: &str) -> Usage {
    Usage::new(
        H::Claude,
        "s-otter",
        cwd,
        Some("feat/gn-31-sync"),
        hours("2026-10-30T09:00:00Z", "2026-11-08T17:00:00Z", 11),
    )
    .tokens([70000, 900000, 60000, 0, 30000, 5000])
    .cheap(HAIKU, [3, 12, 0, 0, 9948, 0])
}

/// `actor-ledger-branch.json`: one branch, a Claude worker's logged usage (its session) beside a
/// dsh-tui worker's, whose branch comes from its start row (its worktree).
pub fn ledger_branch() -> Scene {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let (w31, w31d) = (wt("gn-31"), wt("gn-31d"));
    let b = "feat/gn-31-sync";
    let (c14, c16) = (t("2026-10-29T08:00:00Z"), t("2026-10-29T09:00:00Z"));
    s.start(Start {
        session: Some("s-otter"),
        ..worker("t14", "otter", "dev", "lark", "claude", &w31, b, c14)
    });
    s.start(worker(
        "t16", "otter", "dev", "lark", "dsh-tui", &w31d, b, c16,
    ));
    s.add(otter_claude(&w31));
    s.add(
        Usage::new(
            H::Dsh,
            "d-otter-w",
            &w31d,
            None,
            at(&[
                "2026-10-30T12",
                "2026-11-01T12",
                "2026-11-03T12",
                "2026-11-05T12",
                "2026-11-07T12",
            ]),
        )
        .tokens([180000, 1400000, 0, 0, 61000, 0])
        .cheap(HAIKU, [1, 14, 0, 0, 13933, 0]),
    );
    s.sync();
    s
}

/// `actor-ambiguous.json`: on one branch, a dev and a reviewer launched on one worktree, so a
/// session no row names that started there is ambiguous; a session the dev's start row names is
/// its; and a lone worker's worktree elsewhere. On the other branch, a worker's named session.
pub fn ambiguous() -> Scene {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let (w12, w12b, w14) = (wt("gn-12"), wt("gn-12b"), wt("gn-14"));
    let (b12, b14) = ("feat/gn-12-cache", "fix/gn-14-retry");
    let c = t("2026-11-04T08:00:00Z");
    s.start(Start {
        session: Some("s-x"),
        ..worker("t21", "otter", "dev", "lark", "claude", &w12, b12, c)
    });
    s.start(worker(
        "t22", "heron", "review", "lark", "claude", &w12, b12, c,
    ));
    s.start(worker(
        "t23", "kite", "dev", "lark", "claude", &w12b, b12, c,
    ));
    s.start(Start {
        session: Some("s-r"),
        ..worker("t24", "kite", "fix", "lark", "claude", &w14, b14, c)
    });
    for u in feat_12(&w12, &w12, &w12b) {
        s.add(u);
    }
    s.add(
        Usage::new(
            H::Claude,
            "s-r",
            &w14,
            Some(b14),
            at(&[
                "2026-11-06T13",
                "2026-11-06T18",
                "2026-11-07T15",
                "2026-11-08T09",
                "2026-11-08T11",
            ]),
        )
        .tokens([20000, 300000, 20000, 10000, 10000, 0])
        .cheap(HAIKU, [4, 17, 0, 0, 6358, 0]),
    );
    s.sync();
    s
}

/// The usage `actor-ambiguous.json` and `actor-no-evidence.json` hold on `feat/gn-12-cache`: three
/// Claude Code sessions (s-x, s-y, s-z) over nine hours, in the folders given.
fn feat_12(x: &str, y: &str, z: &str) -> Vec<Usage> {
    let b = Some("feat/gn-12-cache");
    let h = hours("2026-11-05T09:00:00Z", "2026-11-08T18:00:00Z", 9);
    vec![
        Usage::new(H::Claude, "s-x", x, b, pick(&h, &[0, 3, 6, 8]))
            .tokens([30000, 600000, 50000, 0, 20000, 4000]),
        Usage::new(H::Claude, "s-z", z, b, pick(&h, &[1, 4]))
            .tokens([10000, 180000, 0, 0, 10000, 1000]),
        Usage::new(H::Claude, "s-y", y, b, pick(&h, &[2, 5, 7]))
            .tokens([20000, 320000, 40000, 0, 1000, 1000])
            .cheap(HAIKU, [15410, 320000, 0, 0, 0, 0]),
    ]
}

/// `actor-straddling-evidence.json`: a store migrated on 2026-10-24, so evidence starts on 10-25.
/// Before it, rollups a schema 2 meter wrote (one with a frozen tag) on this branch and another;
/// after it, a worker's named session and another worker's worktree.
pub fn straddling() -> Scene {
    let b = Some("feat/gn-12-cache");
    let f1 = hours("2026-10-12T09:00:00Z", "2026-10-24T15:00:00Z", 6);
    let mut frozen = Vec::new();
    let total: Split = [40000, 700000, 50000, 0, 20000, 5000];
    for (i, h) in f1.iter().enumerate() {
        let mut s = [0; 6];
        for k in 0..6 {
            s[k] = total[k] / 6 + if i == 0 { total[k] % 6 } else { 0 };
        }
        frozen.push(Frozen {
            bot: Some("otter"),
            harness: "claude-code",
            model: OPUS,
            branch: b,
            hour: *h,
            tokens: s,
        });
    }
    frozen.push(Frozen {
        bot: None,
        harness: "codex",
        model: SOL,
        branch: b,
        hour: t("2026-10-18T10:00:00Z"),
        tokens: [10000, 115000, 0, 0, 5000, 2000],
    });
    frozen.push(Frozen {
        bot: None,
        harness: "claude-code",
        model: OPUS,
        branch: Some("feat/gn-13-index"),
        hour: t("2026-10-20T10:00:00Z"),
        tokens: [10000, 130000, 0, 0, 10000, 0],
    });
    let mut s = Scene::migrated("2026-10-24T23:30:00Z", &frozen);
    let (w12, w12c) = (wt("gn-12"), wt("gn-12c"));
    let c = t("2026-10-25T08:00:00Z");
    s.start(Start {
        session: Some("s-a"),
        ..worker(
            "t31",
            "otter",
            "dev",
            "lark",
            "claude",
            &w12,
            "feat/gn-12-cache",
            c,
        )
    });
    s.start(worker(
        "t32",
        "heron",
        "review",
        "lark",
        "codex",
        &w12c,
        "feat/gn-12-cache",
        c,
    ));
    let h = hours("2026-10-25T09:00:00Z", "2026-11-08T18:00:00Z", 20);
    s.add(
        Usage::new(H::Claude, "s-a", &w12, b, h[..18].to_vec())
            .tokens([80000, 1275000, 100000, 0, 45000, 9000])
            .cheap(HAIKU, [0, 7, 0, 0, 15523, 0]),
    );
    s.add(
        Usage::new(H::Codex, "th-heron", &w12c, b, h[18..].to_vec())
            .model(SOL)
            .tokens([10000, 160000, 0, 0, 8000, 3000]),
    );
    s.sync();
    s
}

/// `actor-no-evidence.json` and `by-bot-no-evidence.json`: a schema 3 store that has kept no
/// evidence yet (`evidence_from` unset), holding Claude Code usage on one branch and Codex usage on
/// another.
pub fn no_evidence() -> Scene {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    for u in feat_12(ROOT, ROOT, ROOT) {
        s.add(u);
    }
    s.add(
        Usage::new(
            H::Codex,
            "th-main",
            ROOT,
            Some("main"),
            at(&["2026-11-01T10", "2026-11-02T10"]),
        )
        .model(SOL)
        .tokens([20000, 330000, 0, 0, 10000, 2000]),
    );
    s.sync();
    s.store()
        .conn
        .execute(
            "DELETE FROM meta WHERE k = ?1",
            [meter::evidence::FROM_META],
        )
        .unwrap();
    s
}

/// `task-rows.json`: one task worked by two bots and roles (a dev on Claude Code, named by its
/// session, and a reviewer on Codex, found by its worktree), and a second task worked by the dev
/// bot alone. Every id, bot, path and number here is made up.
pub fn tasks() -> Scene {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let (c1, c2, c3) = (
        t("2026-10-20T09:00:00Z"),
        t("2026-10-21T09:00:00Z"),
        t("2026-10-22T09:00:00Z"),
    );
    let (d41, r41, d42) = (wt("gn-41"), wt("gn-41-review"), wt("gn-42"));
    s.start(Start {
        task: Some("gn-41"),
        session: Some("s-kite-41"),
        ..worker(
            "t41",
            "kite",
            "dev",
            "lark",
            "claude",
            &d41,
            "feat/gn-41-pager",
            c1,
        )
    });
    s.start(Start {
        task: Some("gn-41"),
        ..worker(
            "t42",
            "heron",
            "review",
            "lark",
            "codex",
            &r41,
            "feat/gn-41-pager",
            c2,
        )
    });
    s.start(Start {
        task: Some("gn-42"),
        session: Some("s-kite-42"),
        ..worker(
            "t43",
            "kite",
            "dev",
            "lark",
            "claude",
            &d42,
            "feat/gn-42-cache",
            c3,
        )
    });
    s.add(
        Usage::new(
            H::Claude,
            "s-kite-41",
            &d41,
            Some("feat/gn-41-pager"),
            hours("2026-10-22T09:00:00Z", "2026-11-06T18:00:00Z", 5),
        )
        .tokens([100000, 2000000, 150000, 0, 50000, 10000])
        .cheap(HAIKU, [10, 100, 0, 0, 500, 0]),
    );
    s.add(
        Usage::new(
            H::Codex,
            "th-heron-41",
            &r41,
            Some("feat/gn-41-pager"),
            hours("2026-10-25T09:00:00Z", "2026-11-05T18:00:00Z", 4),
        )
        .model(SOL)
        .tokens([30000, 250000, 0, 0, 15000, 5000])
        .cheap(TERRA, [3000, 0, 0, 0, 0, 0]),
    );
    s.add(
        Usage::new(
            H::Claude,
            "s-kite-42",
            &d42,
            Some("feat/gn-42-cache"),
            hours("2026-10-27T09:00:00Z", "2026-11-07T18:00:00Z", 3),
        )
        .tokens([50000, 900000, 60000, 0, 25000, 4000]),
    );
    s.sync();
    s
}

/// `task-ambiguous.json`: the same short task id minted in two checkouts of one repository. The
/// meter can tell them apart only by the launch's project, never prints either path, and never
/// sums them: the row is missing with task_ambiguous (RFC 0021 D4).
pub fn tasks_ambiguous() -> Scene {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let other = format!("{ROOT}-copy");
    let a = wt("gn-51");
    let b = format!("{other}/.worktrees/gn-51");
    let (c1, c2) = (t("2026-10-24T09:00:00Z"), t("2026-10-25T09:00:00Z"));
    s.start(Start {
        task: Some("gn-51"),
        project: Some(ROOT),
        session: Some("s-kite-51a"),
        ..worker(
            "t51",
            "kite",
            "dev",
            "lark",
            "claude",
            &a,
            "feat/gn-51-a",
            c1,
        )
    });
    s.start(Start {
        task: Some("gn-51"),
        project: Some(&other),
        session: Some("s-kite-51b"),
        ..worker(
            "t52",
            "kite",
            "dev",
            "lark",
            "claude",
            &b,
            "feat/gn-51-b",
            c2,
        )
    });
    s.add(
        Usage::new(
            H::Claude,
            "s-kite-51a",
            &a,
            Some("feat/gn-51-a"),
            hours("2026-10-28T09:00:00Z", "2026-11-05T18:00:00Z", 3),
        )
        .tokens([40000, 600000, 30000, 0, 20000, 3000]),
    );
    s.add(
        Usage::new(
            H::Claude,
            "s-kite-51b",
            &b,
            Some("feat/gn-51-b"),
            hours("2026-10-29T09:00:00Z", "2026-11-06T18:00:00Z", 3),
        )
        .tokens([30000, 500000, 20000, 0, 15000, 2000]),
    );
    s.sync();
    s
}

/// One worker in one worktree with one call, the same store whichever way: the branch answer
/// must not move when the worker records a task. `None` is `task-no-labels.json`.
pub fn task_fallback(task: Option<&str>) -> Scene {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let w = wt("gn-60");
    let c = t("2026-10-26T09:00:00Z");
    s.start(Start {
        task,
        session: Some("s-kite-60"),
        ..worker(
            "t60",
            "kite",
            "dev",
            "lark",
            "claude",
            &w,
            "feat/gn-60-plain",
            c,
        )
    });
    s.add(
        Usage::new(
            H::Claude,
            "s-kite-60",
            &w,
            Some("feat/gn-60-plain"),
            hours("2026-10-28T09:00:00Z", "2026-11-06T18:00:00Z", 4),
        )
        .tokens([40000, 700000, 50000, 0, 20000, 4000]),
    );
    s.sync();
    s
}

/// `task-no-labels.json`: usage attributed to a bot whose worker recorded no task.
pub fn tasks_no_labels() -> Scene {
    task_fallback(None)
}

/// The example `name`'s answer, from its store; None for an example no scene builds.
pub fn answer(name: &str) -> Option<(u8, String)> {
    Some(match name {
        "by-bot" => bots().query(&args(true, &[])),
        "by-bot-backlog" => bots_backlog().query(&args(true, &[])),
        "by-bot-lower-bound" => bots_lower_bound().query(&args(true, &["feat/gn-31-sync"])),
        "by-bot-unfiltered" => bots_unfiltered().query(&args(true, &[])),
        "by-bot-no-evidence" => no_evidence().query(&args(true, &[])),
        "actor-ambiguous" => {
            ambiguous().query(&args(false, &["feat/gn-12-cache", "fix/gn-14-retry"]))
        }
        "actor-ledger-branch" => ledger_branch().query(&args(false, &["feat/gn-31-sync"])),
        "actor-straddling-evidence" => straddling().query(&args(false, &["feat/gn-12-cache"])),
        "actor-no-evidence" => {
            no_evidence().query(&args(false, &["feat/gn-12-cache", "docs/gn-90-readme"]))
        }
        "task-rows" => tasks().query(&task_args(&["feat/gn-41-pager", "feat/gn-42-cache"])),
        "task-ambiguous" => tasks_ambiguous().query(&task_args(&["feat/gn-51-a", "feat/gn-51-b"])),
        "task-no-labels" => tasks_no_labels().query(&task_args(&["feat/gn-60-plain"])),
        _ => return None,
    })
}
