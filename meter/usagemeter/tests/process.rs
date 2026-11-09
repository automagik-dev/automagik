//! Spawns processes, so it runs in its own test binary: a child forked while another test
//! thread holds the sync lock would inherit it for a moment.

mod common;

use std::fs;
use std::time::Duration;

use common::*;

const TS: &str = "2026-01-15T10:15:00.000Z";

#[test]
fn a_killed_run_resumes_without_double_counting() {
    let env = Env::new();
    let ts = meter::time::format_rfc3339(meter::time::now_ms() - 3_600_000);
    let want = big_fixture(&env, 6, 3000, &ts);
    let spawn = || {
        env.command()
            .args(["sync", "--force", "--no-publish"])
            .env("METER_STATE_DIR", env.state())
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap()
    };
    // Kill one run right after its first commit, mid-import (SIGKILL: no cleanup runs).
    let mut child = spawn();
    let db = env.state().join("meter.db");
    let started = std::time::Instant::now();
    while child.try_wait().unwrap().is_none() && started.elapsed() < Duration::from_secs(60) {
        let committed = db.exists()
            && meter::store::Store::open(&db).is_ok_and(|s| s.count("files").unwrap_or(0) > 0);
        if committed {
            break;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    let _ = child.kill();
    let _ = child.wait();
    let partial = env.totals().get("model-a").copied().unwrap_or_default();
    assert_ne!(partial, want, "the kill should land mid-import");
    assert!(spawn().wait().unwrap().success());
    assert_eq!(env.totals()["model-a"], want);
}

#[test]
fn sync_exits_0_when_there_is_nothing_new_to_read() {
    let env = Env::new();
    // The binary runs at the real time: an hour ago is inside the import window.
    let ts = meter::time::format_rfc3339(meter::time::now_ms() - 3_600_000);
    let f = env.claude("-work-app/sess-1.jsonl");
    write_lines(&f, &[claude_line("msg_1", "req_1", &ts, "model-a", &U1, 0)]);
    let sync = |args: &[&str]| {
        let out = env
            .command()
            .arg("sync")
            .args(args)
            .arg("--no-publish")
            .env("METER_STATE_DIR", env.state())
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        assert!(
            out.status.success(),
            "sync {args:?} exited {:?}: {stdout}{}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        );
        stdout
    };
    let first = sync(&[]);
    assert!(first.contains(" 1 new usage events"), "{first}");
    let totals = env.totals();
    // Fresh: the last sync is younger than the staleness window.
    let fresh = sync(&[]);
    assert!(fresh.contains("nothing to do"), "{fresh}");
    // Forced over unchanged files: a run that reads nothing new.
    let again = sync(&["--force"]);
    assert!(again.contains(" 0 new usage events"), "{again}");
    assert_eq!(env.totals(), totals);
}

#[test]
fn repo_key_strips_credentials_and_collapses_worktrees() {
    let git = |dir: &std::path::Path, args: &[&str]| {
        std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    let env = Env::new();
    let repo = env.dir.path().join("src/app");
    fs::create_dir_all(repo.join("sub")).unwrap();
    if !git(&repo, &["init", "-q"]) {
        eprintln!("git not available; skipping");
        return;
    }
    assert!(git(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            "https://someone:FAKE-TOKEN-123@Git.Example.com/acme/app.git?x=FAKE#y"
        ]
    ));
    let f = env.claude("-src-app/sess-1.jsonl");
    let gone = repo.join(".claude/worktrees/agent-1"); // a deleted worktree inside the repo
    let mut lines = Vec::new();
    for (i, cwd) in [repo.join("sub"), gone].iter().enumerate() {
        let l = claude_line(
            &format!("msg_{i}"),
            &format!("req_{i}"),
            TS,
            "model-a",
            &U1,
            0,
        )
        .replace(
            "\"cwd\":\"/work/app\"",
            &format!(
                "\"cwd\":{}",
                serde_json::to_string(&cwd.to_string_lossy()).unwrap()
            ),
        );
        lines.push(l);
    }
    write_lines(&f, &lines);
    let mut o = env.opts();
    o.resolve_repos = true;
    env.run(&o);
    let rows = env.store().rows_since(i64::MIN).unwrap();
    assert_eq!(
        rows.len(),
        1,
        "a subdirectory and a worktree resolve to one repo"
    );
    assert_eq!(
        rows[0].key.repo.as_deref(),
        Some("git.example.com/acme/app")
    );
    let db = fs::read(env.state().join("meter.db")).unwrap();
    assert!(!String::from_utf8_lossy(&db).contains("FAKE-TOKEN-123"));
}

/// The Reviewer's H1: a sync killed (SIGKILL) during a reset's re-import leaves a store whose
/// rows are partial. The query must say so: no watermark, an unknown backlog, not complete, and
/// stale; never the partial count passed off as complete and fresh.
#[test]
fn a_reimport_killed_partway_is_reported_incomplete() {
    let env = Env::new();
    let ts = meter::time::format_rfc3339(meter::time::now_ms() - 3_600_000);
    big_fixture(&env, 8, 4000, &ts);
    let spawn = || {
        env.command()
            .args(["sync", "--force", "--no-publish"])
            .env("METER_STATE_DIR", env.state())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap()
    };
    assert!(spawn().wait().unwrap().success());
    let db = env.state().join("meter.db");
    let ctx = || meter::query::Ctx {
        state: Some(meter::paths::StateDirs {
            dir: env.state(),
            legacy: None,
        }),
        overridden: true,
        now_ms: meter::time::now_ms(),
        busy: Duration::from_secs(2),
        meter_version: "0.0.0".into(),
    };
    let ask = || -> serde_json::Value {
        let args: Vec<String> = [
            "--repo",
            "example.com/acme/app",
            "--branch",
            "feat/x",
            "--json",
        ]
        .map(String::from)
        .to_vec();
        serde_json::from_str(&meter::query::run(&args, &ctx()).stdout).unwrap()
    };
    assert_eq!(ask()["ingestion"]["complete"], true);
    // An older meter's store: the next sync keeps a generation, resets, and re-imports.
    rusqlite::Connection::open(&db)
        .unwrap()
        .execute("UPDATE meta SET v = '1' WHERE k = 'schema_version'", [])
        .unwrap();
    let read = |sql: &str| -> Option<String> {
        let c = meter::store::Store::open_read_only(&db).ok()?;
        c.conn.query_row(sql, [], |r| r.get::<_, String>(0)).ok()
    };
    let mut child = spawn();
    let started = std::time::Instant::now();
    while child.try_wait().unwrap().is_none() && started.elapsed() < Duration::from_secs(60) {
        let reset = read("SELECT v FROM meta WHERE k = 'schema_version'").as_deref() == Some("2");
        let some = read("SELECT CAST(count(*) AS TEXT) FROM files").is_some_and(|n| n != "0");
        if reset && some {
            break;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    let _ = child.kill();
    let _ = child.wait();
    assert_eq!(
        read("SELECT v FROM meta WHERE k = 'last_run_ms'"),
        None,
        "the kill should land after the reset and before the run ends"
    );
    let v = ask();
    let ing = &v["ingestion"];
    assert_eq!(v["status"], "ok", "{v}");
    assert_eq!(ing["complete"], false, "{ing}");
    assert_eq!(ing["stale"], true, "{ing}");
    assert!(ing["watermark"].is_null(), "{ing}");
    assert!(ing["backlog"]["bytes"].is_null(), "{ing}");
    assert_ne!(v["rows"][0]["state"], "measured", "{v}");
    assert_ne!(v["rows"][0]["state"], "zero", "{v}");
    // The next sync finishes the re-import and the answer is complete again.
    assert!(spawn().wait().unwrap().success());
    assert_eq!(ask()["ingestion"]["complete"], true);
}
