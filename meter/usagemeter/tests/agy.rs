//! Antigravity (`agy`) conversations: the reader's fixture, its 7-day answer and its refusal of
//! an unknown shape. Synthetic fixtures only: every id, path, model and number here is made up.

mod common;

use std::fs;
use std::path::Path;

use common::{Env, serial};
use meter::evidence::SessionKey;
use meter::hc::{Labels, Terminal};
use meter::time::{format_rfc3339, parse_rfc3339};
use rusqlite::{Connection, params};

const CONV: &str = "conv-915-fixture";
const PROJECT: &str = "/work/example-project";
const CWD: &str = "/work/example-project/.worktrees/915";
const REPO: &str = "example.com/acme/example-project";
const BRANCH: &str = "feat/915-agy-transcripts";
const BOT: &str = "wren";
const TASK: &str = "915";

fn at(s: &str) -> i64 {
    parse_rfc3339(s).unwrap()
}

fn put_varint(mut v: u64, out: &mut Vec<u8>) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

/// A length-delimited protobuf field, the only wire type the fixture's messages use.
fn bytes(no: u64, b: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    put_varint((no << 3) | 2, &mut out);
    put_varint(b.len() as u64, &mut out);
    out.extend_from_slice(b);
    out
}

fn uint(no: u64, v: u64) -> Vec<u8> {
    let mut out = Vec::new();
    put_varint(no << 3, &mut out);
    put_varint(v, &mut out);
    out
}

fn text(no: u64, s: &str) -> Vec<u8> {
    bytes(no, s.as_bytes())
}

fn timestamp(secs: i64, nanos: u64) -> Vec<u8> {
    [uint(1, secs as u64), uint(2, nanos)].concat()
}

fn step_metadata(secs: i64) -> Vec<u8> {
    bytes(1, &timestamp(secs, 250_000_000))
}

fn trajectory(created: i64) -> Vec<u8> {
    let workspace = [
        text(1, &format!("file://{CWD}")),
        text(2, &format!("file://{PROJECT}")),
        bytes(
            3,
            &[
                text(1, "acme/example-project"),
                text(2, "https://example.com/acme/example-project.git"),
            ]
            .concat(),
        ),
        text(4, BRANCH),
    ]
    .concat();
    [bytes(1, &workspace), bytes(2, &timestamp(created, 0))].concat()
}

/// `ModelUsageStats`: input excludes a cache read, output includes thinking.
fn usage(input: u64, cache_read: u64, cache_write: u64, output: u64, thinking: u64) -> Vec<u8> {
    [
        uint(2, input),
        uint(3, output),
        uint(4, cache_write),
        uint(5, cache_read),
        uint(9, thinking),
        uint(10, output - thinking),
    ]
    .concat()
}

/// `ChatModelMetadata`: the model strings sit beside `usage`, not inside it.
fn chat_model(model: &str, display: &str, usage: &[u8]) -> Vec<u8> {
    [
        uint(3, 1417),
        bytes(4, usage),
        text(19, model),
        text(21, display),
    ]
    .concat()
}

fn generation(steps: &[u64], exec: &str, model: &str, display: &str, usage: &[u8]) -> Vec<u8> {
    let mut packed = Vec::new();
    for s in steps {
        put_varint(*s, &mut packed);
    }
    [
        bytes(1, &chat_model(model, display, usage)),
        bytes(2, &packed),
        text(4, exec),
    ]
    .concat()
}

const DDL: &str = "
CREATE TABLE trajectory_meta (
  trajectory_id text, cascade_id text, trajectory_type integer, source integer,
  PRIMARY KEY (trajectory_id)
);
CREATE TABLE steps (
  idx integer, step_type integer NOT NULL DEFAULT 0, status integer NOT NULL DEFAULT 0,
  has_subtrajectory numeric NOT NULL DEFAULT false, metadata blob, PRIMARY KEY (idx)
);
CREATE TABLE gen_metadata (idx integer, data blob, size integer NOT NULL DEFAULT 0, PRIMARY KEY (idx));
CREATE TABLE trajectory_metadata_blob (id text DEFAULT 'main', data blob, PRIMARY KEY (id));
";

fn write_db(path: &Path, created: i64) {
    let c = Connection::open(path).unwrap();
    c.execute_batch(DDL).unwrap();
    c.execute(
        "INSERT INTO trajectory_meta VALUES('traj-915', ?1, 4, 17)",
        [CONV],
    )
    .unwrap();
    c.execute(
        "INSERT INTO trajectory_metadata_blob VALUES('main', ?1)",
        [trajectory(created)],
    )
    .unwrap();
    for (i, secs) in [
        (0, at("2026-01-15T10:00:00Z") / 1000),
        (1, at("2026-01-15T10:01:00Z") / 1000),
        (2, at("2026-01-15T10:02:00Z") / 1000),
        (3, at("2026-01-15T10:03:00Z") / 1000),
    ] {
        c.execute(
            "INSERT INTO steps(idx, step_type, status, metadata) VALUES(?1, 15, 3, ?2)",
            params![i, step_metadata(secs)],
        )
        .unwrap();
    }
    let gemini = usage(1000, 4000, 50, 200, 120);
    let opus = usage(500, 6000, 0, 100, 60);
    for (idx, data) in [
        (
            0,
            generation(
                &[1, 2],
                "exec-1",
                "gemini-4-argon",
                "Gemini 4 Argon (High)",
                &gemini,
            ),
        ),
        (
            1,
            generation(
                &[3],
                "exec-2",
                "claude-opus-5-5",
                "Claude Opus 5.5 (High)",
                &opus,
            ),
        ),
    ] {
        c.execute(
            "INSERT INTO gen_metadata(idx, data, size) VALUES(?1, ?2, ?3)",
            params![idx, data, data.len() as i64],
        )
        .unwrap();
    }
}

fn ledger(env: &Env, created: i64) {
    let dir = env.home().join(".config/herdr-app/automagik-herdr");
    fs::create_dir_all(&dir).unwrap();
    let row = serde_json::json!({
        "event": "start", "kind": "worker", "terminal": "t915", "botId": BOT,
        "role": "dev", "squad": "meter", "worktree": CWD, "agent": "agy",
        "branch": BRANCH, "project": PROJECT, "task": TASK, "lead": null,
        "created_ms": created, "at": format_rfc3339(created + 5_000)
    });
    let p = dir.join("workers.jsonl");
    fs::write(&p, row.to_string() + "\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).unwrap();
    }
}

fn snapshot(created: i64) -> Terminal {
    Terminal {
        terminal: "t915".into(),
        created_ms: Some(created),
        finished_ms: None,
        harness: Some("agy"),
        cwd: Some(CWD.into()),
        labels: Labels::default(),
    }
}

#[test]
fn a_fixture_conversation_counts_gemini_and_opus_with_a_bot_and_a_session_key() {
    let env = Env::new();
    let path = env.agy(&format!("{CONV}.db"));
    let created = at("2026-01-15T09:55:00Z");
    write_db(&path, created);
    ledger(&env, created);
    let mut o = env.opts();
    o.snapshot = Some(vec![snapshot(created)]);
    let r = env.run(&o);
    assert_eq!(r.health.usage_lines, 2, "{r:?}");

    let totals = env.totals();
    assert_eq!(
        totals["gemini-4-argon"].total(),
        1000 + 4000 + 50 + 200,
        "Gemini input, cache read, cache write and output"
    );
    assert_eq!(totals["gemini-4-argon"].reasoning, 120);
    assert_eq!(
        totals["claude-opus-5-5"].total(),
        500 + 6000 + 100,
        "Antigravity-hosted Opus is not zero"
    );

    // The evidence keeps the same attribution the other harnesses use: bot, role, squad, task,
    // branch and a keyed hash of the conversation id as the session.
    let store = env.store();
    let key =
        SessionKey::from_hex(store.meta("evidence_key").unwrap().as_deref().unwrap()).unwrap();
    let want = key.hex("agy", CONV);
    let mut stmt = store
        .conn
        .prepare(
            "SELECT e.session, a.bot, a.role, a.squad, a.task, d.branch
             FROM evidence e JOIN ev_dim d ON d.id = e.dim JOIN ev_actor a ON a.id = e.actor
             WHERE d.harness = 'agy' ORDER BY e.ts_ms",
        )
        .unwrap();
    let rows: Vec<(Vec<u8>, String, String, String, String, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(rows.len(), 2);
    for (session, bot, role, squad, task, branch) in rows {
        assert_eq!(meter::event::hex(&session), want);
        assert_eq!((bot.as_str(), role.as_str()), (BOT, "dev"));
        assert_eq!((squad.as_str(), task.as_str()), ("meter", TASK));
        assert_eq!(branch, BRANCH);
    }

    // A 7-day bot query shows the usage and its coverage.
    let out = env
        .command()
        .env("METER_STATE_DIR", env.state())
        .args([
            "query", "--repo", REPO, "--by", "bot", "--window", "d7", "--json",
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let agy = v["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["harness"] == "agy")
        .expect("agy has a source health row");
    assert_eq!(agy["status"], "ok", "{agy}");
    let rows = v["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 1, "{v}");
    let row = &rows[0];
    assert_eq!(row["bot"], BOT);
    assert_eq!(row["role"], "dev");
    assert_eq!(row["squad"], "meter");
    assert_eq!(row["harness"], "agy");
    assert_eq!(row["tokens"]["total"], 11_850);
    assert_eq!(row["tokens"]["reasoning"], 180);
    let a = &row["attribution"]["actor"];
    assert_eq!(a["tokens_attributed"], 11_850);
    assert_eq!(a["tokens_unlinked"], 0);
    assert_eq!(row["attribution"]["coverage"], "complete");

    // A branch row names the branch the conversation recorded.
    let out = env
        .command()
        .env("METER_STATE_DIR", env.state())
        .args([
            "query", "--repo", REPO, "--branch", BRANCH, "--window", "d7", "--json",
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["rows"][0]["branch"], BRANCH);
    assert_eq!(v["rows"][0]["tokens"]["total"], 11_850);

    // The next sync reads nothing new: the generation cursor is the file's.
    let r = env.run(&env.opts());
    assert_eq!(r.health.events, 0);
    assert_eq!(
        env.totals()["gemini-4-argon"].total(),
        1000 + 4000 + 50 + 200
    );
}

#[test]
fn an_unknown_transcript_schema_is_refused_by_name() {
    let env = Env::new();
    let path = env.agy("conv-old.db");
    let c = Connection::open(&path).unwrap();
    c.execute_batch("CREATE TABLE gen_metadata (idx integer, data blob);")
        .unwrap();
    drop(c);
    let r = env.run(&env.opts());
    let doc = r.summary.expect("a summary");
    assert_eq!(doc["sources"]["agy"]["status"], "unsupported", "{doc}");
    let reason = doc["sources"]["agy"]["reason"].as_str().unwrap();
    assert!(reason.contains("schema"), "{reason}");
    assert_eq!(env.store().rows_since(i64::MIN).unwrap().len(), 0);
}

#[test]
fn a_usage_row_without_a_step_time_is_refused_by_name() {
    let env = Env::new();
    let path = env.agy("conv-no-time.db");
    let created = at("2026-01-15T09:00:00Z");
    write_db(&path, created);
    // Keep the tables and the trajectory, drop every timestamp the generation needs.
    let c = Connection::open(&path).unwrap();
    c.execute("DELETE FROM steps", []).unwrap();
    drop(c);
    let r = env.run(&env.opts());
    let doc = r.summary.expect("a summary");
    assert_eq!(doc["sources"]["agy"]["status"], "unsupported", "{doc}");
    let reason = doc["sources"]["agy"]["reason"].as_str().unwrap();
    assert!(reason.contains("step time"), "{reason}");
    assert!(
        env.store()
            .rows_since(i64::MIN)
            .unwrap()
            .iter()
            .all(|r| r.key.harness != "agy"),
        "an unknown shape must not become a zero row"
    );
    assert_eq!(env.totals().len(), 0);
}

#[test]
fn a_full_read_does_not_leave_a_backlog() {
    let env = Env::new();
    let path = env.agy(&format!("{CONV}.db"));
    write_db(&path, at("2026-01-15T09:55:00Z"));
    let _g = serial();
    let r = env.run(&env.opts());
    assert_eq!(r.pending_files, 0, "{r:?}");
    assert!(!r.stopped_by_budget);
}
