//! Schema 3 (RFC 0021 delivery 5): per-call evidence, the `launch` and `link` tables, the derived
//! attribution and its rollup cache, and the migration from schema 2 under RFC 0018 (d).
//! Synthetic fixtures only: every id, path, bot and number here is made up.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use common::{Env, U1, claude_line, now, serial, write_lines};
use meter::evidence;
use meter::store::{SCHEMA_VERSION, Store};
use meter::sync::Outcome;
use rusqlite::{Connection, params};

/// A Claude transcript line of `session` in `cwd` at `ts` (its branch logged as `feat/x`).
fn line(msg: &str, session: &str, cwd: &str, ts: i64) -> String {
    let ts = meter::time::format_rfc3339(ts);
    claude_line(msg, &format!("r-{msg}"), &ts, "model-a", &U1, 0)
        .replace(
            r#""sessionId":"sess-1""#,
            &format!(r#""sessionId":"{session}""#),
        )
        .replace(r#""cwd":"/work/app""#, &format!(r#""cwd":"{cwd}""#))
}

/// A worker's start row (RFC 0021 (f)): launched at `created`.
fn worker(terminal: &str, bot: &str, agent: &str, worktree: &str, created: i64) -> String {
    serde_json::json!({
        "event": "start", "kind": "worker", "terminal": terminal, "botId": bot, "task": "gh-45",
        "worktree": worktree, "agent": agent, "role": "dev", "branch": "feat/gh-45-synthetic",
        "project": "/work/app", "lead": "b-leadsynth", "core": "core-synthetic",
        "created_ms": created, "squad": "b-squadsynt", "session": null,
        "at": meter::time::format_rfc3339(created + 5_000)
    })
    .to_string()
}

fn write_ledger(path: &Path, rows: &[String]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, rows.join("\n") + "\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
    }
}

fn evidence_from(store: &Store) -> i64 {
    store.meta_i64(evidence::FROM_META).unwrap().unwrap()
}

/// The rollups agree with the evidence: every schema 3 row of an hour from `evidence_from` holds
/// exactly what its calls hold.
fn assert_rollups_agree(store: &Store) {
    let from = evidence_from(store);
    let implied: BTreeMap<_, _> = evidence::implied_rollups(&store.conn)
        .unwrap()
        .into_iter()
        .collect();
    let stored = evidence::stored_rollups(&store.conn, i64::MIN).unwrap();
    assert_eq!(implied, stored, "rollups and evidence (from {from})");
}

/// (bot, state, basis, branch, branch_basis) of a rollup row.
type Row = (
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    String,
);

/// [`Row`] per rollup row, sorted.
fn rows(store: &Store) -> Vec<Row> {
    let mut v: Vec<_> = store
        .rows_since(i64::MIN)
        .unwrap()
        .into_iter()
        .map(|r| {
            let a = r.key.attr.unwrap_or_default();
            (r.key.bot, a.state, a.basis, r.key.branch, a.branch_basis)
        })
        .collect();
    v.sort();
    v
}

// Check (delivery 5): a launch learned after its usage was ingested moves that usage to its bot
// on the next sync, and the rollups agree with the evidence. The launch is in a project app home
// made after the first sync: no new call comes from there, yet the next sync finds it.
#[test]
fn a_launch_learned_later_moves_its_usage_on_the_next_sync() {
    let env = Env::new();
    let project = env.dir.path().join("project");
    let wt = project.join(".worktrees/gh-45");
    fs::create_dir_all(&wt).unwrap();
    let wt = wt.to_string_lossy().into_owned();
    write_lines(
        &env.claude("-project/s-late.jsonl"),
        &[
            line("m1", "s-late", &wt, now() - 3_600_000),
            line("m2", "s-late", &wt, now() - 3_000_000),
        ],
    );
    let r = env.run(&env.opts());
    assert_eq!(r.health.events, 2);
    let store = env.store();
    assert_eq!(store.count("evidence").unwrap(), 2);
    assert_eq!(
        rows(&store),
        [(
            None,
            "unlinked".into(),
            None,
            Some("feat/x".into()),
            "log".into()
        )]
    );
    assert_rollups_agree(&store);
    let before = env.totals();
    drop(store);

    write_ledger(
        &project.join(".herdr/app-home/automagik-herdr/workers.jsonl"),
        &[worker(
            "t1",
            "b-devsynth1",
            "claude",
            &wt,
            now() - 7_200_000,
        )],
    );
    let r = env.run(&env.opts());
    assert_eq!(r.health.events, 0, "nothing new was read");
    assert_eq!(r.calls_moved, 2);
    assert_eq!(r.attribution_backlog, 0);
    let store = env.store();
    assert_eq!(
        rows(&store),
        [(
            Some("b-devsynth1".into()),
            "attributed".into(),
            Some("worktree".into()),
            Some("feat/x".into()),
            "log".into()
        )]
    );
    assert_rollups_agree(&store);
    assert_eq!(env.totals(), before, "a move never changes a total");
    // The launch and its row are kept: one launch row from the ledger.
    assert_eq!(store.count("launch").unwrap(), 1);
    drop(store);

    // Nothing changed since: the next sync moves nothing.
    let r = env.run(&env.opts());
    assert_eq!((r.calls_moved, r.launches_changed), (0, 0));
}

/// Mutant check: a call whose tokens moved twice in one batch (its session and its start folder
/// both dirty) is moved once.
#[test]
fn a_call_named_by_its_session_and_its_folder_moves_once() {
    let env = Env::new();
    let wt = "/work/app/.worktrees/gh-46";
    let created = now() - 7_200_000;
    write_lines(
        &env.claude("-work-app/s-twice.jsonl"),
        &[line("m1", "s-twice", wt, now() - 3_600_000)],
    );
    env.run(&env.opts());
    let ledger = env
        .home()
        .join(".config/herdr-app/automagik-herdr/workers.jsonl");
    let mut row: serde_json::Value =
        serde_json::from_str(&worker("t1", "b-devsynth1", "claude", wt, created)).unwrap();
    row["session"] = "s-twice".into();
    write_ledger(&ledger, &[row.to_string()]);
    let r = env.run(&env.opts());
    assert_eq!(r.calls_moved, 1);
    let store = env.store();
    assert_eq!(
        rows(&store),
        [(
            Some("b-devsynth1".into()),
            "attributed".into(),
            Some("session".into()),
            Some("feat/x".into()),
            "log".into()
        )]
    );
    assert_rollups_agree(&store);
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

/// (id, branch_basis, actor_state, basis, bot) of a migrated row.
type OldRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// A schema 2 store holding frozen tags: rows a live-terminal rule tagged (a bot, no basis), one
/// with a branch and one without, an untagged row, and a file, keys and a session.
fn v2_store(env: &Env) -> PathBuf {
    let db = meter::paths::prepare(&env.state()).unwrap();
    let c = Connection::open(&db).unwrap();
    c.execute_batch(V2_TABLES).unwrap();
    let hour = meter::time::hour_start(now()) - 5 * 3_600_000;
    for (id, bot, branch, tokens) in [
        ("old-1", Some("b-frozen01"), Some("feat/a"), 100),
        ("old-2", Some("b-frozen01"), None, 20),
        ("old-3", None, Some("main"), 3),
    ] {
        c.execute(
            "INSERT INTO usage(id, hour_ms, bot, role, harness, model, machine, repo, branch,
               input_uncached, precision, events, updated_ms)
             VALUES(?1, ?2, ?3, 'dev', 'claude-code', 'model-a', 'm-synth', 'example.com/acme/app',
               ?4, ?5, 'exact', 1, 0)",
            params![id, hour, bot, branch, tokens],
        )
        .unwrap();
    }
    c.execute_batch(
        "INSERT INTO files(path, source, dev, ino, size, mtime_ms, offset, head_len, head_hash)
           VALUES('/logs/old.jsonl', 'claude-code', 1, 2, 3, 4, 3, 3, 'x');
         INSERT INTO seen(k, seq) VALUES(7, 1), (8, 2);
         INSERT INTO sessions VALUES('claude-code', 's-old', NULL, 0, 0);",
    )
    .unwrap();
    let counted_from = meter::time::day_start(now()) - 40 * meter::time::DAY_MS;
    for (k, v) in [
        ("schema_version", "2".to_string()),
        ("counted_from_ms", counted_from.to_string()),
        ("machine", "m-synth".into()),
    ] {
        c.execute("INSERT INTO meta(k, v) VALUES(?1, ?2)", params![k, v])
            .unwrap();
    }
    drop(c);
    db
}

fn counts(db: &Path) -> BTreeMap<String, i64> {
    let c = meter::query::open_read_only(db, std::time::Duration::from_secs(2)).unwrap();
    meter::store::row_counts(&c).unwrap()
}

// Acceptance: the migration keeps a generation first (opened and row-counted), keeps every row,
// backfills branch_basis on the old rollups, and leaves their tags frozen: never attributed.
#[test]
fn a_schema_2_store_migrates_with_every_row_kept_and_its_tags_frozen() {
    let env = Env::new();
    let db = v2_store(&env);
    let old = counts(&db);
    let r = env.run(&env.opts());
    assert!(r.migrated);
    assert!(!r.reimported, "a schema 2 store is migrated, never reset");
    let g = r
        .generation
        .clone()
        .expect("a generation before the migration");
    let name = g.path.file_name().unwrap().to_string_lossy().into_owned();
    assert!(name.starts_with("meter.db.gen-2-"), "{name}");
    assert_eq!(g.counts, old);
    // The generation restores: opened as a store, it is schema 2 with the old row counts.
    let gen_store = Store::open_read_only(&g.path).unwrap();
    assert_eq!(
        meter::query::schema_version(&gen_store.conn).unwrap(),
        Some(2)
    );
    assert_eq!(meter::store::row_counts(&gen_store.conn).unwrap(), old);
    drop(gen_store);

    let store = env.store();
    assert_eq!(
        store.meta_i64("schema_version").unwrap(),
        Some(SCHEMA_VERSION)
    );
    let new = counts(&db);
    for (table, n) in &old {
        if table != "meta" && table != "health" {
            assert_eq!(new.get(table), Some(n), "{table} keeps its rows");
        }
    }
    // branch_basis: log where a branch is recorded, none where it is null; no state, no basis.
    let mut st = store
        .conn
        .prepare("SELECT id, branch_basis, actor_state, basis, bot FROM usage ORDER BY id")
        .unwrap();
    let got: Vec<OldRow> = st
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    drop(st);
    assert_eq!(
        got,
        [
            (
                "old-1".into(),
                Some("log".into()),
                None,
                None,
                Some("b-frozen01".into())
            ),
            (
                "old-2".into(),
                Some("none".into()),
                None,
                None,
                Some("b-frozen01".into())
            ),
            ("old-3".into(), Some("log".into()), None, None, None),
        ]
    );
    // Frozen tags are never attributed: every old token is before the evidence.
    let totals = evidence::actor_totals(&store.conn, i64::MIN).unwrap();
    let t = totals["claude-code"];
    assert_eq!(t.tokens_attributed, 0);
    assert_eq!(t.tokens_before_evidence, 123);
    assert!(
        evidence_from(&store) > now(),
        "evidence starts after the migration"
    );
    drop(store);
    // The generation stays through the run that made it, and goes after a later success.
    assert_eq!(
        meter::store::generations(&env.state()),
        std::slice::from_ref(&g.path)
    );
    let r = env.run(&env.opts());
    assert!(!r.migrated);
    assert_eq!(r.generations_removed, [g.path]);
}

// The generation is the store as it was: put back, a schema 2 meter reads it, and a new sync
// migrates it again with the same rows.
#[test]
fn the_generation_restores_the_schema_2_store() {
    let env = Env::new();
    let db = v2_store(&env);
    let old = counts(&db);
    let r = env.run(&env.opts());
    let g = r.generation.unwrap();
    for f in ["meter.db", "meter.db-wal", "meter.db-shm"] {
        let _ = fs::remove_file(env.state().join(f));
    }
    fs::copy(&g.path, &db).unwrap();
    fs::remove_file(&g.path).unwrap();
    assert_eq!(counts(&db), old);
    assert_eq!(
        meter::store::peek(&db).unwrap().unwrap().version,
        2,
        "the restored store is schema 2"
    );
    let r = env.run(&env.opts());
    assert!(r.migrated);
    assert_eq!(env.store().count("usage").unwrap(), old["usage"]);
}

// RFC 0018 (d): without twice the store's size free, the migration is refused and nothing changes.
#[test]
fn a_migration_without_room_changes_nothing() {
    let env = Env::new();
    v2_store(&env);
    let before = folder(&env.state());
    let mut o = env.opts();
    o.free_bytes = Some(0);
    assert!(matches!(env.sync(&o), Outcome::NoSpace { .. }));
    // The lock file is made before the check; every other file keeps its bytes.
    let mut after = folder(&env.state());
    after.remove("meter.lock");
    let mut before = before;
    before.remove("meter.lock");
    assert_eq!(after, before);
    assert_eq!(
        meter::store::peek(&env.state().join("meter.db"))
            .unwrap()
            .unwrap()
            .version,
        2
    );
}

/// Every file in `dir` with its bytes, the lock file aside (its bytes never change).
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

// Acceptance: a meter older than the store refuses it (exit 12) and writes nothing, the folder
// byte-identical: a schema 3 store is to a schema 2 meter what this store is to this meter.
#[test]
fn a_store_newer_than_the_meter_is_refused_and_untouched() {
    let env = Env::new();
    write_lines(
        &env.claude("-work-app/s-1.jsonl"),
        &[line("m1", "s-1", "/work/app", now() - 3_600_000)],
    );
    env.run(&env.opts());
    env.store()
        .set_meta("schema_version", &(SCHEMA_VERSION + 1).to_string())
        .unwrap();
    // Close the wal so the folder holds the store alone.
    drop(Store::open(&env.state().join("meter.db")).unwrap());
    let before = folder(&env.state());
    let _serial = serial();
    let out = env
        .command()
        .env("METER_STATE_DIR", env.state())
        .args(["sync", "--force", "--no-publish"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(12));
    assert_eq!(folder(&env.state()), before);
}

// No session id appears in any output: sync's stdout and stderr, status, the query, the doc.
#[test]
fn no_session_id_appears_in_any_output() {
    let env = Env::new();
    let secret = "sess-secret-4f1c";
    let ledger = env
        .home()
        .join(".config/herdr-app/automagik-herdr/workers.jsonl");
    let ts = meter::time::now_ms();
    let mut row: serde_json::Value = serde_json::from_str(&worker(
        "t1",
        "b-devsynth1",
        "claude",
        "/work/app",
        ts - 7_200_000,
    ))
    .unwrap();
    row["session"] = secret.into();
    write_ledger(&ledger, &[row.to_string()]);
    write_lines(
        &env.claude(&format!("-work-app/{secret}.jsonl")),
        &[line("m1", secret, "/work/app", ts - 3_600_000)],
    );
    let _serial = serial();
    let run = |args: &[&str]| {
        let out = env
            .command()
            .env("METER_STATE_DIR", env.state())
            .args(args)
            .output()
            .unwrap();
        format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        )
    };
    let mut all = run(&["sync", "--force", "--no-publish"]);
    all += &run(&["status"]);
    all += &run(&[
        "query",
        "--repo",
        "example.com/acme/app",
        "--branch",
        "main",
        "--json",
    ]);
    let store = Store::open(&env.state().join("meter.db")).unwrap();
    assert_eq!(store.count("evidence").unwrap(), 1);
    let doc = format!("{:?}", store.rows_since(i64::MIN).unwrap());
    all += &doc;
    assert!(all.contains("b-devsynth1"), "the call was tagged: {all}");
    assert!(!all.contains(secret), "{all}");
    // The evidence keeps the keyed hash only.
    let raw: Vec<Vec<u8>> = {
        let mut st = store.conn.prepare("SELECT session FROM evidence").unwrap();
        st.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    assert_eq!(raw[0].len(), 16);
    assert!(!raw[0].windows(secret.len()).any(|w| w == secret.as_bytes()));
}

// Retention (RFC 0018 (b), proposed): evidence older than the day bound or past the byte bound
// goes, oldest whole day first, and evidence_from moves past it; the rollups stay. Closed launches
// and links go after 400 days; open ones stay.
#[test]
fn retention_drops_the_oldest_days_and_moves_evidence_from() {
    let env = Env::new();
    let day = meter::time::DAY_MS;
    let lines: Vec<String> = [100, 50, 3, 1]
        .iter()
        .enumerate()
        .map(|(i, d)| line(&format!("m{i}"), "s-ret", "/work/app", now() - d * day))
        .collect();
    write_lines(&env.claude("-work-app/s-ret.jsonl"), &lines);
    let mut o = env.opts();
    o.backfill = true;
    env.run(&o);
    let mut store = env.store();
    let usage = store.count("usage").unwrap();
    // The day bound already ran in that sync: the 100-day-old call has no evidence.
    assert_eq!(store.count("evidence").unwrap(), 3);
    let cut = meter::time::day_start(now()) - (evidence::EVIDENCE_DAYS - 1) * day;
    assert_eq!(evidence_from(&store), cut);
    store
        .conn
        .execute_batch(
            "INSERT INTO launch(lkey, source, valid_to, updated_ms) VALUES('closed', 'ledger', 0, 0);
             INSERT INTO launch(lkey, source, updated_ms) VALUES('open', 'ledger', 0);",
        )
        .unwrap();
    // A byte bound that one call's evidence passes: whole days go until it holds.
    let tx = store.conn.transaction().unwrap();
    let p = evidence::prune(&tx, now(), evidence::EVIDENCE_DAYS, 1).unwrap();
    tx.commit().unwrap();
    assert_eq!(p.evidence, 3);
    assert_eq!(p.launches, 1, "the closed launch is past 400 days");
    assert_eq!(store.count("launch").unwrap(), 1);
    assert_eq!(store.count("evidence").unwrap(), 0);
    assert_eq!(store.count("usage").unwrap(), usage, "the rollups stay");
    assert!(evidence_from(&store) > meter::time::day_start(now() - day));
}

/// An `hc` that answers `server.status` with a synthetic core id and `terminal.list` with the
/// JSON array in `list` (read on every call, so a test can change it between syncs).
fn fake_hc(env: &Env, list: &Path) -> PathBuf {
    let p = env.dir.path().join("fake-hc");
    let script = format!(
        r#"#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *server.status*) printf '{{"jsonrpc":"2.0","id":%s,"result":{{"core":{{"id":"core-synthetic"}}}}}}\n' "$id" ;;
    *terminal.list*) printf '{{"jsonrpc":"2.0","id":%s,"result":{{"terminals":%s}}}}\n' "$id" "$(cat '{}')" ;;
    *) printf '{{"jsonrpc":"2.0","id":%s,"error":{{"message":"refused"}}}}\n' "$id" ;;
  esac
done
"#,
        list.display()
    );
    fs::write(&p, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&p, fs::Permissions::from_mode(0o700)).unwrap();
    }
    p
}

// The snapshot at sync (RFC 0021 (b)): a session label hc showed at one sync keeps linking the
// session once its terminal is gone, and a launch gone from hc ends between the last sync that saw
// it and the first that did not (end_basis gone, gone_after kept).
#[test]
fn a_label_seen_once_outlives_its_terminal_and_a_gone_launch_ends() {
    let env = Env::new();
    let ts = meter::time::now_ms();
    let created = ts - 3 * 3_600_000;
    // A seat with no session row: only the label ties its session to it.
    let seat = serde_json::json!({
        "event": "start", "kind": "seat", "terminal": "t5", "botId": "b-seatsynth", "task": null,
        "worktree": "/work/app", "agent": "codex", "role": "captain", "branch": null,
        "project": "/work/app", "lead": null, "core": "core-synthetic", "created_ms": created,
        "squad": "b-seatsynth", "session": null,
        "at": meter::time::format_rfc3339(created + 5_000)
    });
    write_ledger(
        &env.home()
            .join(".config/herdr-app/automagik-herdr/workers.jsonl"),
        &[seat.to_string()],
    );
    let list = env.dir.path().join("terminals.json");
    fs::write(
        &list,
        format!(
            r#"[{{"address":"t5","created_ms":{created},"cwd":"/work/app","argv":["claude"],"labels":{{"agent.session":"s-labelled"}}}}]"#
        ),
    )
    .unwrap();
    let hc = fake_hc(&env, &list);
    let _serial = serial();
    let sync = || {
        let out = env
            .command()
            .env("METER_STATE_DIR", env.state())
            .env("METER_HC", &hc)
            .args(["sync", "--force", "--no-publish"])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    };
    // The seat was relaunched by hand as claude: hc shows claude with the session label.
    sync();
    let store = || Store::open(&env.state().join("meter.db")).unwrap();
    let labels: i64 = store()
        .conn
        .query_row(
            "SELECT count(*) FROM link WHERE basis = 'label' AND seen_last IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(labels, 1);
    let seen_last: i64 = store()
        .conn
        .query_row(
            "SELECT seen_last FROM launch WHERE terminal = 't5'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    // The terminal is gone; then a call of the labelled session, made while it ran, is read.
    fs::write(&list, "[]").unwrap();
    write_lines(
        &env.claude("-work-app/s-labelled.jsonl"),
        &[line("m1", "s-labelled", "/work/app", ts - 3_600_000)],
    );
    sync();
    let s = store();
    let (end_basis, gone_after, valid_to): (Option<String>, Option<i64>, Option<i64>) = s
        .conn
        .query_row(
            "SELECT end_basis, gone_after, valid_to FROM launch WHERE terminal = 't5'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(end_basis.as_deref(), Some("gone"));
    assert_eq!(gone_after, Some(seen_last));
    assert!(valid_to.unwrap() >= seen_last);
    let tagged: Vec<(Option<String>, Option<String>)> = s
        .rows_since(i64::MIN)
        .unwrap()
        .into_iter()
        .map(|r| (r.key.bot, r.key.attr.and_then(|a| a.basis)))
        .collect();
    assert_eq!(tagged, [(Some("b-seatsynth".into()), Some("label".into()))]);
    assert_rollups_agree(&s);
}

// A call of a harness that logs a branch keeps its own; usage with no branch and no worker stays
// without one (seat or unlinked): never from today's checkout.
#[test]
fn a_logged_branch_is_never_replaced_and_an_unlinked_call_keeps_none() {
    let env = Env::new();
    let wt = "/work/app/.worktrees/gh-47";
    write_ledger(
        &env.home()
            .join(".config/herdr-app/automagik-herdr/workers.jsonl"),
        &[worker("t1", "b-devsynth1", "claude", wt, now() - 7_200_000)],
    );
    let logged = line("m1", "s-logged", wt, now() - 3_600_000)
        .replace(r#""gitBranch":"feat/x""#, r#""gitBranch":"feat/logged""#);
    write_lines(&env.claude("-work-app/s-logged.jsonl"), &[logged]);
    env.run(&env.opts());
    let store = env.store();
    let r = rows(&store);
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].0.as_deref(), Some("b-devsynth1"));
    assert_eq!(r[0].4, "log");
    assert_eq!(r[0].3.as_deref(), Some("feat/logged"));
}

// A seat's bot is the attach ledger's binding when it has one: a binding learned after the usage
// was read moves that usage on the next sync, as a start row would.
#[test]
fn an_attach_binding_learned_later_moves_a_seats_usage() {
    let env = Env::new();
    let created = now() - 7_200_000;
    let home = env.home().join(".config/herdr-app/automagik-herdr");
    let seat = serde_json::json!({
        "event": "start", "kind": "seat", "terminal": "t7", "botId": "b-seatstart",
        "task": null, "worktree": "/work/app", "agent": "claude", "role": "captain",
        "branch": null, "project": "/work/app", "lead": null, "core": "core-synthetic",
        "created_ms": created, "squad": "b-seatstart", "session": "s-seat",
        "at": meter::time::format_rfc3339(created + 5_000)
    });
    write_ledger(&home.join("workers.jsonl"), &[seat.to_string()]);
    write_lines(
        &env.claude("-work-app/s-seat.jsonl"),
        &[line("m1", "s-seat", "/work/app", now() - 3_600_000)],
    );
    env.run(&env.opts());
    let bots = |env: &Env| -> Vec<Option<String>> {
        env.store()
            .rows_since(i64::MIN)
            .unwrap()
            .into_iter()
            .map(|r| r.key.bot)
            .collect()
    };
    assert_eq!(bots(&env), [Some("b-seatstart".to_string())]);
    let attach = serde_json::json!({
        "v": 1, "event": "attach", "bot": "b-attached1", "core": "core-synthetic",
        "terminal": "t7", "created_ms": created,
        "at": meter::time::format_rfc3339(created + 60_000)
    });
    write_ledger(&home.join("attach.jsonl"), &[attach.to_string()]);
    let r = env.run(&env.opts());
    assert_eq!(r.calls_moved, 1);
    assert_eq!(bots(&env), [Some("b-attached1".to_string())]);
    assert_rollups_agree(&env.store());
}

// RFC 0018 (d): before the migration commits, every table holds the rows it had. A store whose
// backfill would lose a row (a trigger stands in for a faulty migration) is refused, unchanged.
#[test]
fn a_migration_that_would_lose_a_row_is_refused_and_changes_nothing() {
    let env = Env::new();
    let db = v2_store(&env);
    Connection::open(&db)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER lose_a_key AFTER UPDATE ON usage BEGIN DELETE FROM seen WHERE k = 7; END;",
        )
        .unwrap();
    let old = counts(&db);
    let o = env.hermetic(&env.opts());
    let err = {
        let _serial = serial();
        meter::sync::run(&o).unwrap_err()
    };
    assert!(err.0.contains("seen"), "{}", err.0);
    assert_eq!(counts(&db), old);
    assert_eq!(meter::store::peek(&db).unwrap().unwrap().version, 2);
}

/// A store with rows, and `log_bytes` of Claude Code logs written after it (one real line, then
/// filler lines the parser skips) that a backfill would import.
fn store_with_logs(env: &Env, log_bytes: usize) -> u64 {
    write_lines(
        &env.claude("-work-app/s-grow.jsonl"),
        &[line("m1", "s-grow", "/work/app", now() - 3_600_000)],
    );
    env.run(&env.opts());
    drop(Store::open(&env.state().join("meter.db")).unwrap());
    let filler = format!("{{\"type\":\"filler\",\"pad\":\"{}\"}}", "x".repeat(1000));
    let n = log_bytes / (filler.len() + 1);
    write_lines(&env.claude("-work-app/s-big.jsonl"), &vec![filler; n]);
    ["meter.db", "meter.db-wal"]
        .iter()
        .filter_map(|f| env.state().join(f).metadata().ok())
        .map(|m| m.len())
        .sum()
}

// The Meter Captain's ruling on PR 849 (2): a rebuild or backfill checks the free space against
// the store's projected grown size, so a disk that would fill mid-rebuild refuses up front (exit 4,
// nothing changed). Here the disk has room for twice the store, but not for the growth.
#[test]
fn a_backfill_that_would_fill_the_disk_refuses_up_front() {
    let env = Env::new();
    let size = store_with_logs(&env, 4 << 20);
    let before = folder(&env.state());
    let mut o = env.opts();
    o.backfill = true;
    let growth = meter::sync::projected_growth(&env.hermetic(&o), 0, None);
    assert!(
        growth >= (4 << 20) / meter::sync::GROWTH_PER_LOG_BYTE - 4096,
        "{growth}"
    );
    o.free_bytes = Some(2 * size + growth - 1);
    match env.sync(&o) {
        Outcome::NoSpace {
            free,
            needed,
            growth: g,
        } => assert_eq!(
            (free, needed, g),
            (2 * size + growth - 1, 2 * size + growth, growth)
        ),
        other => panic!("expected the up-front refusal, got {other:?}"),
    }
    assert_eq!(folder(&env.state()), before, "nothing changed");
    // With room for the growth it runs.
    o.free_bytes = Some(2 * size + growth);
    let r = env.run(&o);
    assert!(r.reimported && r.generation.is_some());
    // A run that keeps the rows counts only what is past each log's offset.
    let read = meter::store::imported_offsets(&env.state().join("meter.db")).unwrap();
    assert_eq!(
        meter::sync::projected_growth(&env.hermetic(&env.opts()), 0, Some(&read)),
        0
    );
}

// The Reviewer's M2 on PR 849, through the real statvfs and the binary: a widening backfill
// whose logs still to import would grow the store past the free space refuses up front, exit 4,
// before any rebuild starts: no generation, no reset, the folder byte for byte as it was. The log
// is sparse (up to 16 TiB that take no disk), so its projected growth passes any real free space.
#[cfg(unix)]
#[test]
fn a_widening_backfill_refuses_up_front_with_exit_4_and_changes_nothing() {
    let env = Env::new();
    spread_logs(&env, meter::time::now_ms(), 3, 5);
    let _serial = serial();
    let sync = |args: &[&str]| {
        env.command()
            .env("METER_STATE_DIR", env.state())
            .args(args)
            .output()
            .unwrap()
    };
    let out = sync(&["sync", "--force", "--no-publish", "--days", "1"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    // 16 TiB where the filesystem allows it, else 8 or 4 TiB (a CI runner's filesystem refuses a
    // file of 16 TiB with EFBIG): any of them projects more growth than a runner has free.
    let sparse = env.claude("-work-app/s-sparse.jsonl");
    let f = fs::File::create(&sparse).unwrap();
    let len = [1u64 << 44, 1 << 43, 1 << 42]
        .into_iter()
        .find(|&n| f.set_len(n).is_ok())
        .expect("a sparse file of 4 TiB or more");
    drop(f);
    assert!(
        len / meter::sync::GROWTH_PER_LOG_BYTE > meter::paths::free_bytes(&env.state()).unwrap()
    );
    let before = folder(&env.state());
    let out = sync(&["sync", "--force", "--no-publish", "--backfill"]);
    let err = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(4), "{err}");
    assert!(err.contains("the logs still to import may add"), "{err}");
    assert_eq!(folder(&env.state()), before, "nothing changed");
}

/// Every table's rows, the totals and the watermark: what a failed run must leave as it was.
fn snapshot_of(env: &Env) -> (BTreeMap<String, i64>, String, Option<String>) {
    let db = env.state().join("meter.db");
    let c = meter::query::open_read_only(&db, std::time::Duration::from_secs(2)).unwrap();
    let ok: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ok, "ok");
    let last = c
        .query_row("SELECT v FROM meta WHERE k = 'last_success_ms'", [], |r| {
            r.get(0)
        })
        .ok();
    let counts = meter::store::row_counts(&c).unwrap();
    drop(c);
    (counts, format!("{:?}", env.totals()), last)
}

/// Claude Code calls spread over `days` days before `at`, `per_day` a day, in one log.
fn spread_logs(env: &Env, at: i64, days: i64, per_day: i64) {
    let lines: Vec<String> = (0..days * per_day)
        .map(|i| {
            let ts = at - (i / per_day) * meter::time::DAY_MS - (i % per_day) * 60_000 - 60_000;
            line(&format!("m-{i}"), "s-spread", "/work/app", ts)
        })
        .collect();
    write_lines(&env.claude("-work-app/s-spread.jsonl"), &lines);
}

// The Fixer's M3 on PR 849: a disk that fills mid-rebuild fails the run (an error, never an
// unreadable log), and the store is put back from the generation the rebuild kept: every table
// holds the rows it had, and the watermark is the old one, never a fresh claim over fewer rows.
#[test]
fn a_disk_full_mid_rebuild_fails_the_run_and_puts_the_store_back() {
    let env = Env::new();
    spread_logs(&env, now(), 20, 10);
    let mut o = env.opts();
    o.days = Some(5);
    env.run(&o);
    let before = snapshot_of(&env);
    let mut o = env.opts();
    o.backfill = true;
    o.chunk_bytes = 4096;
    o.fail_writes_after = Some(3);
    let reason = match env.sync(&o) {
        Outcome::RanOutOfRoom { reason } => reason,
        other => panic!("expected the run to stop for want of room, got {other:?}"),
    };
    assert!(reason.contains("disk is full"), "{reason}");
    assert!(reason.contains("put back"), "{reason}");
    assert_eq!(snapshot_of(&env), before, "the store is as it was");
    assert!(meter::store::generations(&env.state()).is_empty());
    // A run that keeps its rows fails too, and leaves the old watermark: never fresh and partial.
    let mut o = env.opts();
    o.days = Some(5);
    let r = env.run(&o);
    assert_eq!(r.health.events, 0);
    let mut extra = fs::read_to_string(env.claude("-work-app/s-spread.jsonl")).unwrap();
    for i in 0..50 {
        extra.push_str(&line(
            &format!("x-{i}"),
            "s-spread",
            "/work/app",
            now() - 1_000,
        ));
        extra.push('\n');
    }
    fs::write(env.claude("-work-app/s-spread.jsonl"), extra).unwrap();
    let mut o = env.opts();
    o.days = Some(5);
    o.chunk_bytes = 4096;
    o.fail_writes_after = Some(0);
    let last = snapshot_of(&env).2;
    let reason = match env.sync(&o) {
        Outcome::RanOutOfRoom { reason } => reason,
        other => panic!("expected the run to stop for want of room, got {other:?}"),
    };
    assert!(reason.contains("next sync goes on"), "{reason}");
    assert_eq!(snapshot_of(&env).2, last, "the watermark did not move");
}

// The same through a real write failure: a file-size limit (SIGXFSZ ignored, so the write gets
// EFBIG as on a full disk) under a rebuild that grows the store past it.
#[cfg(unix)]
#[test]
fn a_real_write_failure_mid_rebuild_puts_the_store_back() {
    let env = Env::new();
    spread_logs(&env, meter::time::now_ms(), 25, 60);
    let _serial = serial();
    let sync = |limit: Option<u64>, args: &[&str]| {
        let mut c = std::process::Command::new("sh");
        c.arg("-c")
            .arg(match limit {
                Some(b) => format!("trap '' XFSZ; ulimit -f {b}; exec \"$0\" \"$@\""),
                None => "exec \"$0\" \"$@\"".to_string(),
            })
            .arg(env!("CARGO_BIN_EXE_usagemeter"))
            .args(args)
            .env_clear()
            .env("HOME", env.home())
            .env("METER_HC", env.dir.path().join("no-hc"))
            .env("METER_STATE_DIR", env.state());
        if let Some(p) = std::env::var_os("PATH") {
            c.env("PATH", p);
        }
        c.output().unwrap()
    };
    let out = sync(None, &["sync", "--force", "--no-publish", "--days", "2"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let before = snapshot_of(&env);
    let size = env.state().join("meter.db").metadata().unwrap().len();
    // 512-byte blocks: room for the generation, not for the rebuilt store.
    let blocks = (size + (64 << 10)) / 512;
    let out = sync(
        Some(blocks),
        &["sync", "--force", "--no-publish", "--backfill"],
    );
    let err = String::from_utf8_lossy(&out.stderr);
    // Exit 4, as for the up-front refusal (the Reviewer's M2 on PR 849).
    assert_eq!(out.status.code(), Some(4), "{err}");
    assert!(err.contains("no room to write the store"), "{err}");
    assert!(err.contains("put back"), "{err}");
    assert_eq!(snapshot_of(&env), before, "the store is as it was");
}

// The Fixer's M2 on PR 849: a backfill over logs past the evidence's day bound writes no evidence
// for them, so the store does not grow by pages the same run frees (no evidence row, no freed
// page); their rollups are kept.
#[test]
fn evidence_past_retention_is_never_written() {
    let env = Env::new();
    let old = now() - (evidence::EVIDENCE_DAYS + 30) * meter::time::DAY_MS;
    spread_logs(&env, old, 10, 200);
    let mut o = env.opts();
    o.backfill = true;
    let r = env.run(&o);
    assert_eq!(r.health.events, 2000);
    let store = env.store();
    assert_eq!(store.count("evidence").unwrap(), 0);
    assert!(store.count("usage").unwrap() > 0, "the rollups are kept");
    let free: i64 = store
        .conn
        .query_row("PRAGMA freelist_count", [], |r| r.get(0))
        .unwrap();
    assert!(
        free <= 2,
        "{free} pages freed by evidence written and pruned"
    );
    assert_eq!(evidence_from(&store), evidence::retention_cut(now()));
}

// The Fixer's M4 on PR 849: each store hashes ids with its own random key, kept in its meta, so
// one session's hashes never match across two stores.
#[test]
fn two_stores_hash_one_session_with_their_own_keys() {
    let hashes = |env: &Env| -> (String, Vec<u8>) {
        write_lines(
            &env.claude("-work-app/s-same.jsonl"),
            &[line("m1", "s-same", "/work/app", now() - 3_600_000)],
        );
        env.run(&env.opts());
        let store = env.store();
        let key = store.meta(evidence::KEY_META).unwrap().unwrap();
        assert_eq!(key.len(), 64);
        let h: Vec<u8> = store
            .conn
            .query_row("SELECT session FROM evidence", [], |r| r.get(0))
            .unwrap();
        // The store's key, from its meta, is the one its hashes were made with.
        let k = evidence::SessionKey::from_hex(&key).unwrap();
        assert_eq!(h, k.hash("claude", "s-same").to_vec());
        (key, h)
    };
    let (a, b) = (Env::new(), Env::new());
    let (ka, ha) = hashes(&a);
    let (kb, hb) = hashes(&b);
    assert_ne!(ka, kb, "two stores, two keys");
    assert_ne!(ha, hb, "one session's ids never match across stores");
}

// The Reviewer's L1 on PR 849: a plain sync (no --force) that migrates goes on, so it reports the
// migration and its generation instead of stopping as "fresh".
#[test]
fn a_migration_is_never_cut_short_as_fresh() {
    let env = Env::new();
    let db = v2_store(&env);
    let c = Connection::open(&db).unwrap();
    for (k, v) in [
        ("last_success_ms", (now() - 60_000).to_string()),
        ("last_pending_bytes", "0".to_string()),
    ] {
        c.execute("INSERT INTO meta(k, v) VALUES(?1, ?2)", params![k, v])
            .unwrap();
    }
    drop(c);
    let mut o = env.opts();
    o.force = false;
    match env.sync(&o) {
        Outcome::Ran(r) => assert!(r.migrated && r.generation.is_some()),
        other => panic!("expected the migration to run, got {other:?}"),
    }
}

// The Reviewer's L5 on PR 849: a generation from the same second (or a kill's leftover at that
// name) is never replaced or removed, and a copy's stray journal is not taken for a generation.
#[test]
fn a_generation_never_takes_or_removes_another_files_name() {
    let env = Env::new();
    write_lines(
        &env.claude("-work-app/s-1.jsonl"),
        &[line("m1", "s-1", "/work/app", now() - 3_600_000)],
    );
    env.run(&env.opts());
    let db = env.state().join("meter.db");
    let first = meter::store::write_generation(&db, 3, now()).unwrap();
    let theirs = fs::read(&first.path).unwrap();
    let second = meter::store::write_generation(&db, 3, now()).unwrap();
    assert_ne!(first.path, second.path);
    assert_eq!(
        fs::read(&first.path).unwrap(),
        theirs,
        "the first is untouched"
    );
    let journal = first.path.with_file_name(format!(
        "{}-journal",
        first.path.file_name().unwrap().to_string_lossy()
    ));
    fs::write(&journal, b"left by a kill").unwrap();
    assert_eq!(
        meter::store::generations(&env.state()),
        [first.path.clone(), second.path.clone()]
    );
    meter::store::remove_generation(&first.path).unwrap();
    assert!(!journal.exists() && !first.path.exists());
}
