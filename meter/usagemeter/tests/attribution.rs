//! A sync fills bot, role and squad on the rows it writes from Herdr's ledgers (RFC 0021
//! delivery 4). Synthetic fixtures only: every id, path, bot and number here is made up.

mod common;

use std::fs;
use std::path::Path;

use common::{Env, U1, claude_line, now, write_lines};

/// A Claude transcript line of `session` in `cwd`, an hour before the test's now.
fn line(msg: &str, session: &str, cwd: &str) -> String {
    let ts = meter::time::format_rfc3339(now() - 3_600_000);
    claude_line(msg, &format!("r-{msg}"), &ts, "model-a", &U1, 0)
        .replace(
            r#""sessionId":"sess-1""#,
            &format!(r#""sessionId":"{session}""#),
        )
        .replace(r#""cwd":"/work/app""#, &format!(r#""cwd":"{cwd}""#))
}

/// A worker's start row, launched two hours before the test's now.
fn worker(terminal: &str, bot: &str, role: &str, worktree: &str, session: Option<&str>) -> String {
    let created = now() - 7_200_000;
    serde_json::json!({
        "event": "start", "kind": "worker", "terminal": terminal, "botId": bot, "task": "gh-45",
        "worktree": worktree, "agent": "claude", "role": role, "branch": "feat/x",
        "project": "/work/app", "lead": "b-leadsynth", "core": "core-synthetic",
        "created_ms": created, "squad": "b-squadsynt", "session": session,
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

/// (bot, role, squad) per row, sorted.
type Actor = (Option<String>, Option<String>, Option<String>);

fn actors(env: &Env) -> Vec<Actor> {
    let mut v: Vec<Actor> = env
        .store()
        .rows_since(i64::MIN)
        .unwrap()
        .into_iter()
        .map(|r| (r.key.bot, r.key.role, r.squad))
        .collect();
    v.sort();
    v
}

fn some(bot: &str, role: &str, squad: &str) -> Actor {
    (Some(bot.into()), Some(role.into()), Some(squad.into()))
}

#[test]
fn sync_fills_bot_role_and_squad_from_the_ledgers() {
    let env = Env::new();
    // A project folder inside the test's temp folder, its app home holding the ledger.
    let project = env.dir.path().join("project");
    let wt = project.join(".worktrees/gh-45");
    let wt = wt.to_string_lossy().into_owned();
    fs::create_dir_all(&wt).unwrap();
    write_ledger(
        &project.join(".herdr/app-home/automagik-herdr/workers.jsonl"),
        &[
            // A worker whose session Herdr chose: tagged by session.
            worker("t1", "b-devsynth1", "dev", "/work/elsewhere", Some("s-dev")),
            // Two workers on one worktree, no session: ambiguous.
            worker("t2", "b-devsynth2", "dev", &wt, None),
            worker("t3", "b-revsynth3", "review", &wt, None),
        ],
    );
    write_lines(
        &env.claude("-project/s-dev.jsonl"),
        &[line("m1", "s-dev", &wt)],
    );
    write_lines(
        &env.claude("-project/s-other.jsonl"),
        &[line("m2", "s-other", &wt)],
    );
    let r = env.run(&env.opts());
    assert_eq!(r.files_read, 2);
    assert_eq!(
        actors(&env),
        [
            (None, None, None),
            some("b-devsynth1", "dev", "b-squadsynt")
        ]
    );
    // The global app home's ledger counts too: the reviewer's end row there ends its launch, so
    // the dev is the only claimant left for a later call.
    let env2 = Env::new();
    let project = env2.dir.path().join("project");
    let wt = project
        .join(".worktrees/gh-45")
        .to_string_lossy()
        .into_owned();
    write_ledger(
        &project.join(".herdr/app-home/automagik-herdr/workers.jsonl"),
        &[
            worker("t2", "b-devsynth2", "dev", &wt, None),
            worker("t3", "b-revsynth3", "review", &wt, None),
        ],
    );
    let end = serde_json::json!({
        "event": "end", "kind": "worker", "terminal": "t3", "core": "core-synthetic",
        "created_ms": now() - 7_200_000, "reason": "replaced",
        "at": meter::time::format_rfc3339(now() - 5_400_000)
    });
    write_ledger(
        &env2
            .home()
            .join(".config/herdr-app/automagik-herdr/workers.jsonl"),
        &[end.to_string()],
    );
    write_lines(
        &env2.claude("-project/s-other.jsonl"),
        &[line("m2", "s-other", &wt)],
    );
    env2.run(&env2.opts());
    assert_eq!(actors(&env2), [some("b-devsynth2", "dev", "b-squadsynt")]);
}

#[test]
fn no_session_id_reaches_the_doc_or_the_rows() {
    let env = Env::new();
    write_ledger(
        &env.home()
            .join(".config/herdr-app/automagik-herdr/workers.jsonl"),
        &[worker(
            "t1",
            "b-devsynth1",
            "dev",
            "/work/app",
            Some("s-secret-session"),
        )],
    );
    write_lines(
        &env.claude("-work-app/s-secret-session.jsonl"),
        &[line("m1", "s-secret-session", "/work/app")],
    );
    let r = env.run(&env.opts());
    assert_eq!(actors(&env), [some("b-devsynth1", "dev", "b-squadsynt")]);
    let doc = r.summary.unwrap().to_string();
    assert!(!doc.contains("s-secret-session"), "{doc}");
    let rows = format!("{:?}", env.store().rows_since(i64::MIN).unwrap());
    assert!(!rows.contains("s-secret-session"), "{rows}");
}

// Fixer M2 on #835: a refused ledger is said where status, the doc and the query read it, not only
// on stderr, and the usage itself stays complete.
#[test]
fn a_refused_ledger_is_kept_as_every_sources_reason() {
    let env = Env::new();
    let project = env.dir.path().join("project");
    let wt = project
        .join(".worktrees/gh-45")
        .to_string_lossy()
        .into_owned();
    let ledger = project.join(".herdr/app-home/automagik-herdr/workers.jsonl");
    write_ledger(&ledger, &[worker("t2", "b-devsynth2", "dev", &wt, None)]);
    write_lines(
        &env.claude("-project/s-other.jsonl"),
        &[line("m2", "s-other", &wt)],
    );
    let reasons = |env: &Env| -> Vec<(String, String, Option<String>)> {
        meter::sync::source_health(&env.store())
            .unwrap()
            .into_iter()
            .map(|h| (h.harness, h.status, h.reason))
            .collect()
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&ledger, fs::Permissions::from_mode(0o664)).unwrap();
        env.run(&env.opts());
        assert_eq!(actors(&env), [(None, None, None)]);
        for (harness, status, reason) in reasons(&env) {
            if status == "absent" {
                assert_eq!(reason, None, "{harness}");
                continue;
            }
            assert_eq!(status, "ok", "{harness}: the usage is complete");
            let reason = reason.unwrap_or_default();
            assert!(
                reason.contains("1 Herdr ledger(s) not read"),
                "{harness}: {reason}"
            );
        }
        // The summary doc carries it too (the query reads the same `source_status`).
        let doc = env.run(&env.opts()).summary.unwrap();
        assert!(
            doc.to_string().contains("Herdr ledger(s) not read"),
            "{doc}"
        );
        // Fixed: the next sync that reads it drops the reason and tags the usage.
        fs::set_permissions(&ledger, fs::Permissions::from_mode(0o600)).unwrap();
        write_lines(
            &env.claude("-project/s-other.jsonl"),
            &[line("m2", "s-other", &wt), line("m3", "s-other", &wt)],
        );
        env.run(&env.opts());
        assert!(
            reasons(&env)
                .iter()
                .all(|(_, _, r)| !r.as_deref().unwrap_or("").contains("not read"))
        );
    }
}

// Reviewer delta on #835: through a real sync, a Claude session that started in the project root
// and later calls from a worker's worktree, and a sub-agent it spawned there, stay untagged; the
// worker's own session, started in its worktree, is the worker's.
#[test]
fn a_seat_session_and_its_sub_agent_in_a_workers_worktree_stay_untagged() {
    let env = Env::new();
    let project = env.dir.path().join("project");
    let root = project.to_string_lossy().into_owned();
    let wt = project
        .join(".worktrees/gh-45")
        .to_string_lossy()
        .into_owned();
    write_ledger(
        &project.join(".herdr/app-home/automagik-herdr/workers.jsonl"),
        &[worker("t1", "b-devsynth1", "dev", &wt, None)],
    );
    // The seat's session: its first call in the project root, the next ones from the worktree.
    write_lines(
        &env.claude("-project/s-seat.jsonl"),
        &[
            line("m1", "s-seat", &root),
            line("m2", "s-seat", &wt),
            line("m3", "s-seat", &wt),
        ],
    );
    // A sub-agent it spawned there: its own transcript starts in the worktree.
    write_lines(
        &env.claude("-project/s-seat/subagents/agent-1.jsonl"),
        &[line("m4", "s-seat", &wt), line("m5", "s-seat", &wt)],
    );
    // The worker's own session.
    write_lines(
        &env.claude("-project-wt/s-dev.jsonl"),
        &[line("m6", "s-dev", &wt)],
    );
    env.run(&env.opts());
    let mut by_bot: std::collections::BTreeMap<Option<String>, i64> = Default::default();
    for r in env.store().rows_since(i64::MIN).unwrap() {
        *by_bot.entry(r.key.bot).or_default() += r.events;
    }
    let mut want = std::collections::BTreeMap::new();
    want.insert(None, 5);
    want.insert(Some("b-devsynth1".to_owned()), 1);
    assert_eq!(by_bot, want);
}

// Reviewer L2 and the genie note on #835: the harness's own reason first, then the refused-ledger
// note, both within the envelope's 200-character reason.
#[test]
fn a_long_reason_keeps_its_start_and_the_ledger_note_within_the_bound() {
    let own = format!("{} the end", "x".repeat(250));
    let meta = |k: &str| match k {
        "codex_status" => Some("degraded".to_owned()),
        "codex_reason" => Some(own.clone()),
        "ledgers_refused" => Some("1".to_owned()),
        _ => None,
    };
    let (status, reason) = meter::sync::source_status(meta, meter::sources::Source::Codex);
    let reason = reason.unwrap();
    assert_eq!(status, "degraded");
    assert!(reason.chars().count() <= 200, "{}", reason.len());
    assert!(reason.starts_with("xxxx"), "{reason}");
    assert!(
        reason.ends_with("the usage they would tag has no bot"),
        "{reason}"
    );
    // A short own reason is kept whole.
    let meta = |k: &str| match k {
        "codex_reason" => Some("3 rollouts could not be read".to_owned()),
        "ledgers_refused" => Some("2".to_owned()),
        _ => None,
    };
    let (_, reason) = meter::sync::source_status(meta, meter::sources::Source::Codex);
    assert_eq!(
        reason.as_deref(),
        Some(
            "3 rollouts could not be read; 2 Herdr ledger(s) not read (group- or world-writable): \
             the usage they would tag has no bot"
        )
    );
}
