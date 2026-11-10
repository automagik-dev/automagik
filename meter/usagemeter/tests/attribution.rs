//! A sync fills bot, role and squad on the rows it writes from Herdr's ledgers (RFC 0021
//! delivery 4). Synthetic fixtures only: every id, path, bot and number here is made up.

mod common;

use std::fs;
use std::path::Path;

use common::{Env, U1, append, claude_line, now, write_lines};
use meter::hc::{Labels, Terminal};

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

// ---- RFC 0026 (c): the label claims, through a sync ------------------------------------------

/// A sync at `at` with hc's snapshot as given (the tests' own synthetic terminals).
fn sync_at(env: &Env, at: i64, snapshot: Vec<Terminal>) -> meter::sync::Report {
    let mut o = env.opts();
    o.now_ms = at;
    o.snapshot = Some(snapshot);
    env.run(&o)
}

/// Gives the store this machine's core before the first sync: the in-process sync is handed the
/// snapshot instead of hc's `server.status`, and a launch with no start row is keyed by this core.
fn synthetic_core(env: &Env) {
    fs::create_dir_all(env.state()).unwrap();
    env.store().set_meta("machine", "core-synthetic").unwrap();
}

/// A live terminal the snapshot shows, with the labels the pack sets.
fn terminal(
    terminal: &str,
    created: i64,
    harness: &'static str,
    cwd: &str,
    labels: Labels,
) -> Terminal {
    Terminal {
        terminal: terminal.into(),
        created_ms: Some(created),
        finished_ms: None,
        harness: Some(harness),
        cwd: Some(cwd.into()),
        labels,
    }
}

/// Makes `wt` a task worktree of `project` as git lays one out: the project's `.git` is a folder,
/// the worktree's a file naming its folder under the repository's `worktrees/`.
fn linked_worktree(project: &Path, wt: &str) {
    let name = Path::new(wt).file_name().unwrap();
    let gitdir = project.join(".git/worktrees").join(name);
    fs::create_dir_all(&gitdir).unwrap();
    fs::create_dir_all(wt).unwrap();
    fs::write(
        Path::new(wt).join(".git"),
        format!("gitdir: {}\n", gitdir.to_string_lossy()),
    )
    .unwrap();
}

/// A live Claude terminal created two hours before `t0`.
fn terminal_at(name: &str, t0: i64, cwd: &str, labels: Labels) -> Terminal {
    terminal(name, t0 - 7_200_000, "claude-code", cwd, labels)
}

/// A Claude transcript line at `at`.
fn claude_at(msg: &str, session: &str, cwd: &str, at: i64) -> String {
    claude_line(
        msg,
        &format!("r-{msg}"),
        &meter::time::format_rfc3339(at),
        "model-a",
        &U1,
        0,
    )
    .replace(
        r#""sessionId":"sess-1""#,
        &format!(r#""sessionId":"{session}""#),
    )
    .replace(r#""cwd":"/work/app""#, &format!(r#""cwd":"{cwd}""#))
}

/// The store's one rollup row for the hour `at` falls in.
fn row_at(env: &Env, at: i64) -> meter::store::UsageRow {
    let hour = meter::time::hour_start(at);
    let mut rows: Vec<_> = env
        .store()
        .rows_since(0)
        .unwrap()
        .into_iter()
        .filter(|r| r.key.hour_ms == hour)
        .collect();
    assert_eq!(rows.len(), 1, "one row for {hour}: {rows:?}");
    rows.remove(0)
}

/// Check (T3): a call in an unlogged, labelled worker's worktree is attributed at `label` basis
/// from the first sync that saw the label; a call before that sync stays unlinked.
#[test]
fn a_labelled_unlogged_worker_is_attributed_at_label_basis_only_after_its_sighting() {
    let env = Env::new();
    let project = env.dir.path().join("project");
    let wt = project
        .join(".worktrees/gh-45")
        .to_string_lossy()
        .into_owned();
    linked_worktree(&project, &wt);
    let t0 = now();
    synthetic_core(&env);
    let log = env.claude("-project-wt/s-hand.jsonl");
    write_lines(&log, &[claude_at("m1", "s-hand", &wt, t0 - 3_600_000)]);
    let seen = terminal(
        "t7",
        t0 - 7_200_000,
        "claude-code",
        &wt,
        Labels {
            worker_of: Some("b-hand".into()),
            worker_role: Some("dev".into()),
            ..Labels::default()
        },
    );
    sync_at(&env, t0, vec![seen.clone()]);
    // The call is before the first sighting: the meter claims only what it saw.
    let early = row_at(&env, t0 - 3_600_000);
    assert_eq!(
        (early.key.bot, early.key.attr.unwrap().state.as_str()),
        (None, "unlinked")
    );
    // A call after the sighting arrives next sync: the label claims it, at `label` basis.
    append(&log, &(claude_at("m2", "s-hand", &wt, t0 + 600_000) + "\n"));
    sync_at(&env, t0 + 1_800_000, vec![seen]);
    let late = row_at(&env, t0 + 600_000);
    assert_eq!(late.key.bot.as_deref(), Some("b-hand"));
    assert_eq!(late.key.role.as_deref(), Some("dev"));
    assert_eq!(late.key.squad, None);
    assert_eq!(late.key.branch.as_deref(), Some("feat/x"));
    let a = late.key.attr.unwrap();
    assert_eq!(a.state, "attributed");
    assert_eq!(a.kind.as_deref(), Some("worker"));
    assert_eq!(a.basis.as_deref(), Some("label"));
    assert_eq!(a.branch_basis, "log");
    assert_eq!(a.unrecorded.as_deref(), Some("squad"));
}

/// Check (T9): a label-tagged worker whose harness logs no branch keeps it null: attributed and
/// branch-unattributed at once.
#[test]
fn a_labelled_unlogged_omp_worker_keeps_its_branch_null() {
    let env = Env::new();
    let project = env.dir.path().join("project");
    let wt = project
        .join(".worktrees/gh-46")
        .to_string_lossy()
        .into_owned();
    linked_worktree(&project, &wt);
    let t0 = now();
    synthetic_core(&env);
    let log = env.omp("-project/o-hand.jsonl");
    write_lines(
        &log,
        &[format!(
            r#"{{"type":"session","version":3,"id":"o-hand","timestamp":"{}","cwd":"{wt}"}}"#,
            meter::time::format_rfc3339(t0 - 3_600_000)
        )],
    );
    let seen = terminal(
        "t8",
        t0 - 7_200_000,
        "omp",
        &wt,
        Labels {
            worker_of: Some("b-omp".into()),
            worker_role: Some("test".into()),
            ..Labels::default()
        },
    );
    sync_at(&env, t0, vec![seen.clone()]);
    let mut message = format!(
        concat!(
            r#"{{"type":"message","id":"e1","timestamp":"{ts}","message":{{"role":"assistant","#,
            r#""model":"model-a","content":[{{"type":"text","text":"FAKE"}}],"#,
            r#""usage":{{"input":100,"output":20,"cacheRead":300,"cacheWrite":0,"#,
            r#""totalTokens":420}}}}}}"#
        ),
        ts = meter::time::format_rfc3339(t0 + 600_000),
    );
    message.push('\n');
    append(&log, &message);
    sync_at(&env, t0 + 1_800_000, vec![seen]);
    let row = row_at(&env, t0 + 600_000);
    assert_eq!(row.key.bot.as_deref(), Some("b-omp"));
    assert_eq!(row.key.role.as_deref(), Some("test"));
    assert_eq!(row.key.branch, None);
    let a = row.key.attr.unwrap();
    assert_eq!(a.basis.as_deref(), Some("label"));
    assert_eq!(a.branch_basis, "none");
}

/// Check (T3): a worker's label that changes empties the launch's claim for its whole span, and a
/// recompute moves its calls to unlinked, never retags them.
#[test]
fn a_changed_worker_label_leaves_the_launchs_calls_unlinked_across_a_recompute() {
    let env = Env::new();
    let project = env.dir.path().join("project");
    let wt = project
        .join(".worktrees/gh-45")
        .to_string_lossy()
        .into_owned();
    linked_worktree(&project, &wt);
    let t0 = now();
    synthetic_core(&env);
    let log = env.claude("-project-wt/s-hand.jsonl");
    write_lines(&log, &[]);
    let labels = |bot: &str| Labels {
        worker_of: Some(bot.into()),
        worker_role: Some("dev".into()),
        ..Labels::default()
    };
    let first = terminal("t7", t0 - 7_200_000, "claude-code", &wt, labels("b-one"));
    sync_at(&env, t0, vec![first.clone()]);
    append(&log, &(claude_at("m1", "s-hand", &wt, t0 + 600_000) + "\n"));
    sync_at(&env, t0 + 1_800_000, vec![first.clone()]);
    assert_eq!(row_at(&env, t0 + 600_000).key.bot.as_deref(), Some("b-one"));
    // The next sync sees a different worker.of on the same terminal.
    let second = terminal("t7", t0 - 7_200_000, "claude-code", &wt, labels("b-two"));
    let r = sync_at(&env, t0 + 2_700_000, vec![second.clone()]);
    assert!(r.calls_moved > 0, "{r:?}");
    let moved = row_at(&env, t0 + 600_000);
    assert_eq!(
        (moved.key.bot, moved.key.attr.unwrap().state.as_str()),
        (None, "unlinked")
    );
    // A later call is unlinked too, never given the last label seen.
    append(
        &log,
        &(claude_at("m2", "s-hand", &wt, t0 + 2_100_000) + "\n"),
    );
    sync_at(&env, t0 + 3_600_000, vec![second]);
    let later = row_at(&env, t0 + 2_100_000);
    assert_eq!(
        (later.key.bot, later.key.attr.unwrap().state.as_str()),
        (None, "unlinked")
    );
}

/// Check (T9): a seat's changed label splits at the sync that saw it; the recompute keeps the
/// earlier calls on the first bot and moves the later ones to the second, at `label` basis.
#[test]
fn a_seats_changed_label_splits_its_calls_at_the_sync_that_saw_it() {
    let env = Env::new();
    let project = env.dir.path().join("project");
    let root = project.to_string_lossy().into_owned();
    fs::create_dir_all(&root).unwrap();
    let t0 = now();
    synthetic_core(&env);
    let log = env.claude("-project/s-seat.jsonl");
    write_lines(&log, &[]);
    let seat = |bot: &str| {
        terminal(
            "t2",
            t0 - 7_200_000,
            "claude-code",
            &root,
            Labels {
                bot: Some(bot.into()),
                role: Some("captain".into()),
                session: Some("s-seat".into()),
                ..Labels::default()
            },
        )
    };
    sync_at(&env, t0, vec![seat("b-first")]);
    append(
        &log,
        &(claude_at("m1", "s-seat", &root, t0 + 600_000) + "\n"),
    );
    sync_at(&env, t0 + 1_800_000, vec![seat("b-first")]);
    assert_eq!(
        row_at(&env, t0 + 600_000).key.bot.as_deref(),
        Some("b-first")
    );
    // The reattach changes the seat's bot label; a call before the sync that saw it keeps the
    // first bot, one after it takes the second.
    append(
        &log,
        &(claude_at("m2", "s-seat", &root, t0 + 4_200_000) + "\n"),
    );
    sync_at(&env, t0 + 5_400_000, vec![seat("b-second")]);
    append(
        &log,
        &(claude_at("m3", "s-seat", &root, t0 + 7_800_000) + "\n"),
    );
    sync_at(&env, t0 + 9_000_000, vec![seat("b-second")]);
    let (early, middle, late) = (
        row_at(&env, t0 + 600_000),
        row_at(&env, t0 + 4_200_000),
        row_at(&env, t0 + 7_800_000),
    );
    assert_eq!(early.key.bot.as_deref(), Some("b-first"));
    assert_eq!(middle.key.bot.as_deref(), Some("b-first"));
    assert_eq!(late.key.bot.as_deref(), Some("b-second"));
    for row in [&early, &middle, &late] {
        assert_eq!(
            row.key.attr.as_ref().unwrap().basis.as_deref(),
            Some("label")
        );
        assert_eq!(row.key.attr.as_ref().unwrap().kind.as_deref(), Some("seat"));
        assert_eq!(row.key.attr.as_ref().unwrap().state, "attributed");
    }
}

/// Check (T3): the launch row's `source = snapshot` marker replays the claim once the terminal is
/// gone: the sync that ends it keeps the calls attributed, never back to unlinked.
#[test]
fn a_label_claim_replays_from_the_launch_rows_source_marker() {
    let env = Env::new();
    let project = env.dir.path().join("project");
    let wt = project
        .join(".worktrees/gh-45")
        .to_string_lossy()
        .into_owned();
    linked_worktree(&project, &wt);
    let t0 = now();
    synthetic_core(&env);
    let log = env.claude("-project-wt/s-hand.jsonl");
    write_lines(&log, &[]);
    let seen = terminal(
        "t7",
        t0 - 7_200_000,
        "claude-code",
        &wt,
        Labels {
            worker_of: Some("b-hand".into()),
            worker_role: Some("dev".into()),
            ..Labels::default()
        },
    );
    sync_at(&env, t0, vec![seen.clone()]);
    append(&log, &(claude_at("m1", "s-hand", &wt, t0 + 600_000) + "\n"));
    sync_at(&env, t0 + 1_800_000, vec![seen]);
    assert_eq!(
        row_at(&env, t0 + 600_000).key.bot.as_deref(),
        Some("b-hand")
    );
    // Its row says the labels supplied the tag, and keeps the timeline.
    let (source, bound): (String, Option<String>) = env
        .store()
        .conn
        .query_row(
            "SELECT source, bound FROM launch WHERE terminal = 't7'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(source, "snapshot");
    let bound = bound.unwrap();
    assert!(bound.starts_with("~@"), "{bound}");
    assert!(bound.contains("b-hand"), "{bound}");
    // hc no longer lists the terminal: the launch ends and is re-derived from its row alone. The
    // call stays attributed; without the replay it would move to unlinked.
    let r = sync_at(&env, t0 + 3_600_000, vec![]);
    assert!(r.launches_changed > 0, "{r:?}");
    // The merged timeline is written exactly as it was read: the end went to `valid_to`.
    let again: Option<String> = env
        .store()
        .conn
        .query_row("SELECT bound FROM launch WHERE terminal = 't7'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(again.as_deref(), Some(bound.as_str()));
    let row = row_at(&env, t0 + 600_000);
    assert_eq!(row.key.bot.as_deref(), Some("b-hand"));
    let a = row.key.attr.unwrap();
    assert_eq!(a.state, "attributed");
    assert_eq!(a.basis.as_deref(), Some("label"));
}

/// Fixer C1 on #949, through a sync: a terminal labelled `worker.of` in the project root (the main
/// checkout), or in a folder that is no task worktree, names no call by that folder. An unrelated
/// session that started there stays unlinked, as it was before the label claims.
#[test]
fn a_labelled_terminal_outside_a_task_worktree_claims_no_call_by_its_folder() {
    let env = Env::new();
    let project = env.dir.path().join("project");
    let root = project.to_string_lossy().into_owned();
    let wt = project
        .join(".worktrees/gh-45")
        .to_string_lossy()
        .into_owned();
    linked_worktree(&project, &wt);
    // A folder under the project with no `.git` of its own.
    let plain = project.join("notes").to_string_lossy().into_owned();
    fs::create_dir_all(&plain).unwrap();
    let t0 = now();
    synthetic_core(&env);
    let logs = [
        (env.claude("-project/s-root.jsonl"), "s-root", &root),
        (
            env.claude("-project-notes/s-plain.jsonl"),
            "s-plain",
            &plain,
        ),
        (env.claude("-project-wt/s-wt.jsonl"), "s-wt", &wt),
    ];
    for (log, _, _) in &logs {
        write_lines(log, &[]);
    }
    let claimer = |terminal: &str, cwd: &str, bot: &str| {
        terminal_at(
            terminal,
            t0,
            cwd,
            Labels {
                worker_of: Some(bot.into()),
                worker_role: Some("dev".into()),
                ..Labels::default()
            },
        )
    };
    let seen = vec![
        claimer("t7", &root, "b-root"),
        claimer("t8", &plain, "b-plain"),
        claimer("t9", &wt, "b-wt"),
    ];
    sync_at(&env, t0, seen.clone());
    // One call per folder, each in its own hour, after the labels were seen.
    for (k, (log, session, cwd)) in logs.iter().enumerate() {
        let at = t0 + 600_000 + k as i64 * 3_600_000;
        append(log, &(claude_at(&format!("m{k}"), session, cwd, at) + "\n"));
    }
    sync_at(&env, t0 + 10_800_000, seen);
    for k in 0..2 {
        let row = row_at(&env, t0 + 600_000 + k * 3_600_000);
        assert_eq!(
            (row.key.bot, row.key.attr.unwrap().state.as_str()),
            (None, "unlinked"),
            "folder {k}"
        );
    }
    // The control: the same label in a task worktree names its call.
    let row = row_at(&env, t0 + 600_000 + 2 * 3_600_000);
    assert_eq!(row.key.bot.as_deref(), Some("b-wt"));
    assert_eq!(row.key.attr.unwrap().basis.as_deref(), Some("label"));
}

/// Fixer C2 on #949, through a sync: a seat with no start row that the attach ledger bound, with
/// `worker.of` added to its terminal, stays a seat. An unrelated session in its project root is
/// unlinked, never the binding's bot on the `worktree` basis.
#[test]
fn a_bound_seat_with_a_worker_label_never_names_its_project_root() {
    let env = Env::new();
    let project = env.dir.path().join("project");
    let root = project.to_string_lossy().into_owned();
    fs::create_dir_all(&root).unwrap();
    let t0 = now();
    synthetic_core(&env);
    let attach = serde_json::json!({
        "v": 1, "event": "attach", "bot": "b-bound", "project": root, "terminal": "t2",
        "core": "core-synthetic", "created_ms": t0 - 7_200_000, "machine": null,
        "at": meter::time::format_rfc3339(t0 - 7_000_000), "by": "attach"
    });
    write_ledger(
        &env.home()
            .join(".config/herdr-app/automagik-herdr/attach.jsonl"),
        &[attach.to_string()],
    );
    let log = env.claude("-project/s-unrelated.jsonl");
    write_lines(&log, &[]);
    let seat = terminal_at(
        "t2",
        t0,
        &root,
        Labels {
            worker_of: Some("b-claimer".into()),
            worker_role: Some("dev".into()),
            ..Labels::default()
        },
    );
    sync_at(&env, t0, vec![seat.clone()]);
    append(
        &log,
        &(claude_at("m1", "s-unrelated", &root, t0 + 600_000) + "\n"),
    );
    sync_at(&env, t0 + 1_800_000, vec![seat]);
    let row = row_at(&env, t0 + 600_000);
    assert_eq!(
        (row.key.bot, row.key.attr.unwrap().state.as_str()),
        (None, "unlinked")
    );
    let (kind, bot, bound): (Option<String>, Option<String>, Option<String>) = env
        .store()
        .conn
        .query_row(
            "SELECT kind, bot, bound FROM launch WHERE terminal = 't2'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!((kind.as_deref(), bot), (Some("seat"), None));
    assert!(!bound.unwrap().contains('~'));
}
