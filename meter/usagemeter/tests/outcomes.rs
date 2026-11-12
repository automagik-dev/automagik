//! Issue 899, `usagemeter outcomes`: recorded failures (`run_failed` from hc's finished terminals,
//! `tool_error` from the harness logs) and time to pull request on two clocks, per window, bot
//! and role; what is unknown is never a 0; a report changes nothing and prints nothing private.
//!
//! Synthetic fixtures only: `example.com` repos, made-up bots, branches, sessions, terminals and
//! paths. Every time is relative to the scenes' clock.

mod common;
mod scenes;

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::Output;
use std::time::Duration;

use common::serial;
use meter::hc::TerminalEnd;
use meter::outcomes;
use meter::paths::StateDirs;
use meter::query::{self, Ctx};
use rusqlite::params;
use serde_json::{Value, json};

use scenes::{MACHINE, REPO, ROOT, SYNCED, Scene, Start, t, worker, wt};

const MIGRATED: &str = "2026-10-01T00:00:00Z";
const SQUAD: &str = "b-squad";

fn args(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn ctx(s: &Scene) -> Ctx {
    Ctx {
        state: Some(StateDirs {
            dir: s.env.state(),
            legacy: None,
        }),
        overridden: false,
        now_ms: t(scenes::GENERATED),
        busy: Duration::from_secs(2),
        meter_version: scenes::EXAMPLE_VERSION.into(),
    }
}

/// Runs the report in memory at the example clock and parses its one JSON record.
fn report(s: &Scene, a: &[&str]) -> Value {
    let mut a = args(a);
    a.push("--json".into());
    let r = outcomes::run(&a, &ctx(s));
    assert_eq!(r.code, 0, "{}", r.stderr.unwrap_or_default());
    assert!(r.stdout.ends_with('\n') && !r.stdout[..r.stdout.len() - 1].contains('\n'));
    assert!(r.stdout.len() <= outcomes::OUTPUT_CAP);
    serde_json::from_str(&r.stdout).unwrap()
}

fn text(s: &Scene, a: &[&str]) -> String {
    let r = outcomes::run(&args(a), &ctx(s));
    assert_eq!(r.code, 0, "{}", r.stderr.unwrap_or_default());
    assert!(r.stdout.len() <= outcomes::OUTPUT_CAP);
    r.stdout
}

fn window<'a>(v: &'a Value, name: &str) -> &'a Value {
    v["windows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["window"] == name)
        .unwrap_or_else(|| panic!("no window {name}"))
}

// ---------------------------------------------------------------------------------------------
// Fixture lines.

/// A Claude Code call: the session's usage line, with a tool call whose name and input must
/// never reach a report.
fn claude_call(session: &str, cwd: &str, branch: &str, ts: &str, n: usize) -> String {
    json!({
        "type": "assistant", "requestId": format!("req_{session}_{n}"), "timestamp": ts,
        "sessionId": session, "cwd": cwd, "gitBranch": branch,
        "message": {
            "id": format!("msg_{session}_{n}"), "model": scenes::OPUS, "role": "assistant",
            "content": [{"type": "tool_use", "id": format!("tu-{session}-{n}"),
                         "name": "FAKE-TOOL-NAME", "input": {"command": "FAKE-COMMAND"}}],
            "usage": {"input_tokens": 10, "output_tokens": 20}
        }
    })
    .to_string()
}

/// A Claude Code tool result, flagged as failed or not.
fn claude_result(
    session: &str,
    cwd: &str,
    branch: &str,
    ts: &str,
    id: &str,
    failed: bool,
) -> String {
    json!({
        "type": "user", "timestamp": ts, "sessionId": session, "cwd": cwd, "gitBranch": branch,
        "message": {"role": "user", "content": [{
            "tool_use_id": id, "type": "tool_result", "content": "FAKE-ERROR-TEXT exit 1",
            "is_error": failed
        }]},
        "toolUseResult": "Error: FAKE-ERROR-TEXT exit 1"
    })
    .to_string()
}

/// A Claude Code model-call failure line, written after Claude Code's own retries.
fn claude_api_error(
    session: &str,
    cwd: &str,
    branch: &str,
    ts: &str,
    uuid: &str,
    flag: Value,
) -> String {
    json!({
        "type": "assistant", "uuid": uuid, "timestamp": ts,
        "sessionId": session, "cwd": cwd, "gitBranch": branch,
        "isApiErrorMessage": flag, "apiErrorStatus": 429, "error": "rate_limit",
        "message": {
            "id": format!("msg_api_{uuid}"), "model": "<synthetic>", "role": "assistant",
            "content": [{"type": "text", "text": "FAKE-API-ERROR-TEXT Rate limit reached"}],
            "usage": {"input_tokens": 0, "output_tokens": 0}
        }
    })
    .to_string()
}

fn write_claude(s: &Scene, file: &str, lines: &[String]) {
    common::write_lines(&s.env.claude(&format!("-work-widgets/{file}.jsonl")), lines);
}

/// A Codex completed item.
fn codex_item(ts: &str, id: &str, kind: &str, status: &str, exit_code: Option<i64>) -> String {
    let mut item = json!({"type": kind, "id": id, "status": status,
                          "command": ["FAKE-COMMAND"], "aggregated_output": "FAKE-ERROR-TEXT"});
    if let Some(c) = exit_code {
        item["exit_code"] = json!(c);
    }
    json!({"timestamp": ts, "type": "event_msg",
           "payload": {"type": "item_completed", "thread_id": "thread", "item": item}})
    .to_string()
}

/// A Codex thread with one counted call and `items` after it.
fn write_codex(s: &Scene, thread: &str, cwd: &str, branch: &str, ts: &str, items: &[String]) {
    let rollout = s
        .env
        .home()
        .join(".codex/sessions/2026/11/01")
        .join(format!("rollout-2026-11-01T00-00-00-{thread}.jsonl"));
    fs::create_dir_all(rollout.parent().unwrap()).unwrap();
    let mut lines = vec![
        json!({"timestamp": ts, "type": "event_msg", "payload": {"type": "token_count",
               "info": {"total_token_usage": {"input_tokens": 100, "cached_input_tokens": 0,
                        "output_tokens": 50, "reasoning_output_tokens": 0, "total_tokens": 150}}}})
        .to_string(),
    ];
    lines.extend_from_slice(items);
    common::write_lines(&rollout, &lines);
    let db = rusqlite::Connection::open(s.env.home().join(".codex/state_5.sqlite")).unwrap();
    db.execute(
        "INSERT INTO threads(id, rollout_path, cwd, tokens_used, git_branch, git_origin_url, model,
           updated_at_ms) VALUES(?1, ?2, ?3, 150, ?4, ?5, ?6, ?7)",
        params![
            thread,
            rollout.to_string_lossy(),
            cwd,
            branch,
            scenes::REMOTE,
            scenes::SOL,
            t(ts) + 60_000
        ],
    )
    .unwrap();
}

/// A `pr` row as Herdr's sweep writes it, with the fields a report must never print.
fn pr_row(
    branch: &str,
    pr: i64,
    state: &str,
    first_commit: Option<&str>,
    opened: Option<&str>,
    merged: Option<&str>,
    at: &str,
) -> String {
    json!({
        "event": "pr", "project": ROOT, "branch": branch, "task": null, "pr": pr, "state": state,
        "first_commit_at": first_commit, "opened_at": opened, "merged_at": merged,
        "closed_at": null, "core": MACHINE, "at": at,
        "title": "FAKE-PR-TITLE", "author": "fake-author",
        "url": format!("https://example.com/acme/widgets/pull/{pr}")
    })
    .to_string()
}

fn ended(
    terminal: &str,
    created: &str,
    finished: &str,
    reason: &str,
    code: Option<i64>,
) -> TerminalEnd {
    TerminalEnd {
        terminal: terminal.into(),
        created_ms: t(created),
        finished_ms: t(finished),
        reason: Some(reason.into()),
        exit_code: code,
        signal: None,
    }
}

#[allow(clippy::too_many_arguments)]
fn start<'a>(
    terminal: &'a str,
    bot: &'a str,
    role: &'a str,
    agent: &'a str,
    worktree: &'a str,
    branch: &'a str,
    created: &str,
    session: Option<&'a str>,
) -> Start<'a> {
    Start {
        session,
        ..worker(
            terminal,
            bot,
            role,
            SQUAD,
            agent,
            worktree,
            branch,
            t(created),
        )
    }
}

/// The acceptance scene. On the last day: a Claude Code dev and a Codex fixer on one branch whose
/// pull request merged; a reviewer on a branch with no pull request; a worker with no recorded
/// role on a branch with an open one; a pull request no launch explains. Earlier in the week: an
/// omp worker whose branch opened, and a tool failure of a session nothing links.
fn fleet() -> (Scene, Vec<TerminalEnd>) {
    let mut s = Scene::migrated(MIGRATED, &[]);
    let (gh1, gh2, gh3, gh5) = (wt("gh-1"), wt("gh-2"), wt("gh-3"), wt("gh-5"));
    for cwd in [ROOT, &gh1, &gh2, &gh3, &gh5] {
        s.store().cache_repo(cwd, Some(REPO), t(SYNCED)).unwrap();
    }
    s.start(start(
        "t7711",
        "b-dev",
        "dev",
        "claude",
        &gh1,
        "feat/gh-1",
        "2026-11-08T10:00:00Z",
        Some("sess-dev"),
    ));
    s.start(start(
        "t7712",
        "b-fix",
        "fix",
        "codex",
        &gh1,
        "feat/gh-1",
        "2026-11-08T12:00:00Z",
        Some("thr-fix"),
    ));
    s.start(start(
        "t7713",
        "b-rev",
        "review",
        "claude",
        &gh2,
        "feat/gh-2",
        "2026-11-08T11:00:00Z",
        Some("sess-rev"),
    ));
    s.start(start(
        "t7714",
        "b-omp",
        "dev",
        "omp",
        &gh3,
        "feat/gh-3",
        "2026-11-05T09:00:00Z",
        None,
    ));
    // A start row from before roles were recorded: its branch's pull request has no (bot, role).
    s.start(Start {
        role: None,
        ..start(
            "t7715",
            "b-old",
            "dev",
            "claude",
            &gh5,
            "feat/gh-5",
            "2026-11-08T07:00:00Z",
            None,
        )
    });
    // The omp worker's end, as an `end` row that copied hc's reason and exit status.
    s.ledger_row(
        json!({"event": "end", "terminal": "t7714", "created_ms": t("2026-11-05T09:00:00Z"),
               "core": MACHINE, "reason": "finished", "hc_reason": "exited", "exit_code": 3,
               "at": "2026-11-05T12:00:00Z"})
        .to_string(),
    );
    s.ledger_row(pr_row(
        "feat/gh-1",
        101,
        "open",
        Some("2026-11-08T10:30:00Z"),
        Some("2026-11-08T11:00:00Z"),
        None,
        "2026-11-08T11:05:00Z",
    ));
    // The merge row comes after the branch is gone: it no longer knows the first commit.
    s.ledger_row(pr_row(
        "feat/gh-1",
        101,
        "merged",
        None,
        Some("2026-11-08T11:00:00Z"),
        Some("2026-11-08T16:00:00Z"),
        "2026-11-08T16:05:00Z",
    ));
    s.ledger_row(pr_row(
        "feat/gh-3",
        103,
        "open",
        Some("2026-11-05T09:30:00Z"),
        Some("2026-11-05T10:30:00Z"),
        None,
        "2026-11-05T10:35:00Z",
    ));
    s.ledger_row(pr_row(
        "feat/gh-4",
        104,
        "merged",
        Some("2026-11-08T08:00:00Z"),
        Some("2026-11-08T09:00:00Z"),
        Some("2026-11-08T09:30:00Z"),
        "2026-11-08T09:35:00Z",
    ));
    s.ledger_row(pr_row(
        "feat/gh-5",
        105,
        "open",
        None,
        Some("2026-11-08T08:00:00Z"),
        None,
        "2026-11-08T08:05:00Z",
    ));

    let dev = |ts: &str, id: &str, failed: bool| {
        claude_result("sess-dev", &gh1, "feat/gh-1", ts, id, failed)
    };
    let dev_api = |ts: &str, uuid: &str, flag: Value| {
        claude_api_error("sess-dev", &gh1, "feat/gh-1", ts, uuid, flag)
    };
    write_claude(
        &s,
        "sess-dev",
        &[
            claude_call("sess-dev", &gh1, "feat/gh-1", "2026-11-08T10:10:00Z", 1),
            dev("2026-11-08T10:11:00Z", "tu-1", true),
            dev("2026-11-08T10:12:00Z", "tu-2", true),
            // The same result written twice, and one that did not fail.
            dev("2026-11-08T10:12:00Z", "tu-2", true),
            dev("2026-11-08T10:13:00Z", "tu-3", false),
            // A failed model call, repeated once, plus negative controls (false, string, user).
            dev_api("2026-11-08T10:14:00Z", "uuid-api-1", json!(true)),
            dev_api("2026-11-08T10:14:00Z", "uuid-api-1", json!(true)),
            dev_api("2026-11-08T10:15:00Z", "uuid-api-2", json!(false)),
            dev_api("2026-11-08T10:16:00Z", "uuid-api-3", json!("true")),
            json!({
                "type": "user", "uuid": "uuid-api-4", "timestamp": "2026-11-08T10:17:00Z",
                "sessionId": "sess-dev", "cwd": gh1, "gitBranch": "feat/gh-1",
                "isApiErrorMessage": true,
                "message": {"role": "user", "content": "prompt quoting \"isApiErrorMessage\": true"}
            })
            .to_string(),
        ],
    );
    // A copy of a counted line in another file (a resumed session): the same failure.
    write_claude(
        &s,
        "sess-dev-resumed",
        &[
            dev("2026-11-08T10:11:00Z", "tu-1", true),
            dev_api("2026-11-08T10:14:00Z", "uuid-api-1", json!(true)),
        ],
    );
    write_claude(
        &s,
        "sess-none",
        &[
            claude_call(
                "sess-none",
                "/work/elsewhere",
                "main",
                "2026-11-04T10:00:00Z",
                1,
            ),
            claude_result(
                "sess-none",
                "/work/elsewhere",
                "main",
                "2026-11-04T10:01:00Z",
                "tu-9",
                true,
            ),
            claude_api_error(
                "sess-none",
                "/work/elsewhere",
                "main",
                "2026-11-04T10:02:00Z",
                "uuid-api-9",
                json!(true),
            ),
        ],
    );
    s.store()
        .cache_repo("/work/elsewhere", Some(REPO), t(SYNCED))
        .unwrap();
    write_codex(
        &s,
        "thr-fix",
        &gh1,
        "feat/gh-1",
        "2026-11-08T12:10:00Z",
        &[
            codex_item(
                "2026-11-08T12:11:00Z",
                "item-1",
                "CommandExecution",
                "failed",
                Some(1),
            ),
            codex_item(
                "2026-11-08T12:12:00Z",
                "item-2",
                "McpToolCall",
                "failed",
                None,
            ),
            codex_item(
                "2026-11-08T12:13:00Z",
                "item-3",
                "CommandExecution",
                "completed",
                Some(0),
            ),
        ],
    );
    let ends = vec![
        ended(
            "t7711",
            "2026-11-08T10:00:00Z",
            "2026-11-08T17:00:00Z",
            "exited",
            Some(1),
        ),
        // Killed and stopped for a restart: ends, whatever status they left.
        ended(
            "t7712",
            "2026-11-08T12:00:00Z",
            "2026-11-08T17:10:00Z",
            "killed",
            Some(137),
        ),
        ended(
            "t7713",
            "2026-11-08T11:00:00Z",
            "2026-11-08T17:20:00Z",
            "stopped_by_restart",
            Some(1),
        ),
        ended(
            "t7715",
            "2026-11-08T07:00:00Z",
            "2026-11-08T09:00:00Z",
            "exited",
            Some(0),
        ),
    ];
    let e = ends.clone();
    s.sync_with(move |o| o.ends = Some(e));
    (s, ends)
}

fn row<'a>(w: &'a Value, bot: &str, error_kind: &str) -> &'a Value {
    w["errors"]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["bot"] == bot && r["error_kind"] == error_kind)
        .unwrap_or_else(|| panic!("no {error_kind} row for {bot}: {}", w["errors"]["rows"]))
}

// ---------------------------------------------------------------------------------------------
// Failures.

#[test]
fn failures_are_counted_per_window_bot_and_role_with_their_source() {
    let (s, _) = fleet();
    let v = report(&s, &[]);
    assert_eq!(v["v"], 1);
    assert_eq!(v["recorded"], true);
    assert_eq!(v["complete"], true);

    let d1 = window(&v, "d1");
    assert_eq!(d1["state"], "ok", "{d1}");
    assert_eq!(
        d1["errors"]["tool_error"],
        json!({"state": "full", "source": "harness_log", "count": 4})
    );
    assert_eq!(
        d1["errors"]["api_error"],
        json!({"state": "full", "source": "harness_log", "count": 1})
    );
    assert_eq!(
        d1["errors"]["run_failed"],
        json!({"state": "full", "source": "hc_snapshot", "count": 1})
    );
    // Claude Code: two flagged results, the repeated line and the resumed copy counted once.
    assert_eq!(
        *row(d1, "b-dev", "tool_error"),
        json!({"bot": "b-dev", "kind": "worker", "role": "dev", "squad": SQUAD,
               "harness": "claude-code", "error_kind": "tool_error", "source": "harness_log",
               "count": 2})
    );
    assert_eq!(
        *row(d1, "b-dev", "api_error"),
        json!({"bot": "b-dev", "kind": "worker", "role": "dev", "squad": SQUAD,
               "harness": "claude-code", "error_kind": "api_error", "source": "harness_log",
               "count": 1})
    );
    // Codex: a failed item with an exit status counts once, a failed one without counts, a
    // completed one does not.
    assert_eq!(
        *row(d1, "b-fix", "tool_error"),
        json!({"bot": "b-fix", "kind": "worker", "role": "fix", "squad": SQUAD,
               "harness": "codex", "error_kind": "tool_error", "source": "harness_log",
               "count": 2})
    );
    assert_eq!(
        *row(d1, "b-dev", "run_failed"),
        json!({"bot": "b-dev", "kind": "worker", "role": "dev", "squad": SQUAD,
               "harness": "claude-code", "error_kind": "run_failed", "source": "hc_snapshot",
               "count": 1})
    );
    assert_eq!(d1["errors"]["rows"].as_array().unwrap().len(), 4, "{d1}");
    assert_eq!(d1["errors"]["unattributed"], json!([]));
    // A killed terminal and one stopped for a restart are ends, never errors.
    assert_eq!(
        d1["run_ends"],
        json!({"exited_ok": 1, "failed": 1, "killed": 1, "stopped_by_restart": 1, "other": 0,
               "unknown": 0})
    );

    // The week adds the unlinked session's failures, by reason, and the omp worker's failed run
    // from its end row.
    let d7 = window(&v, "d7");
    assert_eq!(d7["errors"]["tool_error"]["count"], 5);
    assert_eq!(d7["errors"]["api_error"]["count"], 2);
    // One failed run from hc's list, one from an end row: the total names both sources.
    assert_eq!(
        d7["errors"]["run_failed"],
        json!({"state": "full", "source": "hc_snapshot,workers_ledger", "count": 2})
    );
    assert_eq!(
        d7["errors"]["unattributed"],
        json!([
            {"state": "unlinked", "reason": "no_record", "harness": "claude-code",
             "error_kind": "api_error", "source": "harness_log", "count": 1},
            {"state": "unlinked", "reason": "no_record", "harness": "claude-code",
             "error_kind": "tool_error", "source": "harness_log", "count": 1}
        ])
    );
    assert_eq!(
        *row(d7, "b-omp", "run_failed"),
        json!({"bot": "b-omp", "kind": "worker", "role": "dev", "squad": SQUAD, "harness": "omp",
               "error_kind": "run_failed", "source": "workers_ledger", "count": 1})
    );
    assert_eq!(d7["run_ends"]["failed"], 2);
    assert_eq!(window(&v, "d30")["errors"]["tool_error"]["count"], 5);
    assert_eq!(window(&v, "d30")["errors"]["api_error"]["count"], 2);
}

#[test]
fn a_harness_with_no_pinned_marker_is_unsupported_never_zero() {
    let (s, _) = fleet();
    let v = report(&s, &["--window", "d7"]);
    let unsupported = json!(["agy", "dsh-tui", "omp"]);
    let api_unsupported = json!(["agy", "codex", "dsh-tui", "omp"]);
    assert_eq!(
        v["error_kinds"]["tool_error"]["unsupported_harnesses"],
        unsupported
    );
    assert_eq!(
        v["error_kinds"]["api_error"]["unsupported_harnesses"],
        api_unsupported
    );
    let d7 = window(&v, "d7");
    assert_eq!(d7["errors"]["unsupported_harnesses"], unsupported);
    assert_eq!(
        d7["errors"]["api_error_unsupported_harnesses"],
        api_unsupported
    );
    // The omp worker and the Codex fixer ran in the window: neither gets an unsupported count of
    // any size.
    for (harness, kind) in [
        ("omp", "tool_error"),
        ("omp", "api_error"),
        ("codex", "api_error"),
    ] {
        assert!(
            d7["errors"]["rows"]
                .as_array()
                .unwrap()
                .iter()
                .all(|r| !(r["harness"] == harness && r["error_kind"] == kind)),
            "{d7}"
        );
    }
    let markers = v["error_kinds"]["tool_error"]["markers"]
        .as_object()
        .unwrap();
    assert_eq!(
        markers.keys().collect::<Vec<_>>(),
        ["claude-code", "codex"],
        "one rule per pinned harness"
    );
    let api_markers = v["error_kinds"]["api_error"]["markers"]
        .as_object()
        .unwrap();
    assert_eq!(
        api_markers.keys().collect::<Vec<_>>(),
        ["claude-code"],
        "only Claude Code has a pinned api_error marker"
    );
    let t = text(&s, &["--window", "d7"]);
    assert!(
        t.contains("unsupported (no pinned marker; unknown, never 0): agy, dsh-tui, omp"),
        "{t}"
    );
    assert!(
        t.contains("unsupported (no pinned marker; unknown, never 0): agy, codex, dsh-tui, omp"),
        "{t}"
    );
}

#[test]
fn the_count_is_named_as_a_fact_and_carries_no_rate_or_label() {
    let (s, _) = fleet();
    let v = report(&s, &[]);
    let note = v["note"].as_str().unwrap();
    assert!(note.contains("including expected ones"), "{note}");
    assert!(
        note.contains("a red test run while working test-first"),
        "{note}"
    );
    assert!(note.contains("a grep with no match"), "{note}");
    assert!(note.contains("usage-limit stops"), "{note}");
    assert!(
        note.contains("model calls that failed for the session, not each retried attempt"),
        "{note}"
    );
    assert!(note.contains("not a quality verdict"), "{note}");
    assert_eq!(
        v["error_kinds"]["tool_error"]["rule"],
        "harness-flagged failures, including expected ones"
    );
    assert_eq!(
        v["error_kinds"]["api_error"]["rule"],
        "harness-flagged model-call failures after the harness's own retries \
         (model calls that failed for the session, not each retried attempt, including \
         usage-limit stops; not a quality verdict on their own)"
    );
    let t = text(&s, &[]);
    assert!(t.contains(note), "{t}");
    // Counts only: no rate, ratio, threshold, label or score, as a key, a value or a word of text.
    let json = serde_json::to_string(&v).unwrap();
    for out in [&json, &t] {
        let words: std::collections::BTreeSet<&str> = out
            .split(|c: char| !c.is_ascii_alphabetic())
            .filter(|w| !w.is_empty())
            .collect();
        for word in [
            "rate",
            "ratio",
            "threshold",
            "score",
            "label",
            "high",
            "low",
            "percent",
            "share",
        ] {
            assert!(!words.contains(word), "the output says {word}");
        }
        assert!(!out.contains('%'), "the output holds a percentage");
    }
}

#[test]
fn a_failure_follows_its_session_when_a_later_record_links_it() {
    let mut s = Scene::migrated(MIGRATED, &[]);
    let cwd = "/work/elsewhere";
    s.store().cache_repo(cwd, Some(REPO), t(SYNCED)).unwrap();
    write_claude(
        &s,
        "sess-late",
        &[
            claude_call("sess-late", cwd, "main", "2026-11-08T10:00:00Z", 1),
            claude_result(
                "sess-late",
                cwd,
                "main",
                "2026-11-08T10:01:00Z",
                "tu-1",
                true,
            ),
            // Same raw id string as the tool_result above: kind-prefixed idents never collide.
            claude_api_error(
                "sess-late",
                cwd,
                "main",
                "2026-11-08T10:02:00Z",
                "tu-1",
                json!(true),
            ),
        ],
    );
    s.sync();
    let d1 = report(&s, &["--window", "d1"]);
    let d1 = window(&d1, "d1");
    assert_eq!(
        d1["errors"]["unattributed"][0]["reason"], "no_record",
        "{d1}"
    );
    assert_eq!(d1["errors"]["rows"], json!([]));

    // Herdr records the seat that ran it: the failure moves with the session's calls.
    s.start(Start {
        kind: "seat",
        branch: None,
        ..start(
            "t7720",
            "b-seat",
            "lead",
            "claude",
            ROOT,
            "main",
            "2026-11-08T09:00:00Z",
            None,
        )
    });
    s.ledger_row(scenes::session_row(
        "t7720",
        t("2026-11-08T09:00:00Z"),
        "sess-late",
        "claude",
        t("2026-11-08T09:59:00Z"),
    ));
    s.sync();
    let v = report(&s, &["--window", "d1"]);
    let d1 = window(&v, "d1");
    assert_eq!(d1["errors"]["unattributed"], json!([]), "{d1}");
    let r = row(d1, "b-seat", "tool_error");
    assert_eq!(
        (&r["kind"], &r["role"], &r["count"]),
        (&json!("seat"), &json!("lead"), &json!(1))
    );
    let r_api = row(d1, "b-seat", "api_error");
    assert_eq!(
        (&r_api["kind"], &r_api["role"], &r_api["count"]),
        (&json!("seat"), &json!("lead"), &json!(1))
    );
}

// ---------------------------------------------------------------------------------------------
// Time to pull request.

fn stat(n: u64, p50: Option<i64>, p90: Option<i64>) -> Value {
    json!({"n": n, "p50_s": p50, "p90_s": p90})
}

fn shared(n: u64, n_shared: u64, p50: Option<i64>, p90: Option<i64>) -> Value {
    json!({"n": n, "n_shared": n_shared, "p50_s": p50, "p90_s": p90})
}

#[test]
fn time_to_pr_is_reported_on_both_clocks_per_branch_repo_and_bot_role() {
    let (s, _) = fleet();
    let v = report(&s, &[]);
    let d1 = &window(&v, "d1")["time_to_pr"];
    assert_eq!(d1["state"], "ok");
    // Per branch: both clocks, to the pull request opened and merged.
    assert_eq!(
        d1["branches"],
        json!([
            {"repo": REPO, "branch": "feat/gh-1", "pr": 101, "state": "merged",
             "to_open_s": 1800, "to_merge_s": 19800, "launch_to_open_s": 3600,
             "launch_to_merge_s": 21600},
            // Worker launches in the window and no pull request recorded.
            {"repo": REPO, "branch": "feat/gh-2", "pr": null, "state": "no_pr",
             "to_open_s": null, "to_merge_s": null, "launch_to_open_s": null,
             "launch_to_merge_s": null},
            {"repo": REPO, "branch": "feat/gh-4", "pr": 104, "state": "merged",
             "to_open_s": 3600, "to_merge_s": 5400, "launch_to_open_s": null,
             "launch_to_merge_s": null},
            {"repo": REPO, "branch": "feat/gh-5", "pr": 105, "state": "open",
             "to_open_s": null, "to_merge_s": null, "launch_to_open_s": 3600,
             "launch_to_merge_s": null},
        ]),
        "{d1}"
    );
    assert_eq!(d1["branches_no_pr"], 1);
    assert_eq!(d1["no_first_commit"], 1, "feat/gh-5");
    assert_eq!(d1["no_launch"], 1, "feat/gh-4");
    // Nearest rank: of two samples p50 is the first and p90 the second.
    let all = json!({
        "to_open_s": stat(2, Some(1800), Some(3600)),
        "to_merge_s": stat(2, Some(5400), Some(19800)),
        "launch_to_open_s": stat(2, Some(3600), Some(3600)),
        "launch_to_merge_s": stat(1, Some(21600), Some(21600)),
    });
    assert_eq!(d1["all"], all);
    let mut repo = all.clone();
    repo["repo"] = json!(REPO);
    assert_eq!(d1["repos"], json!([repo]));
    // Per (bot, role): the dev opened the pull request alone; by the merge the fixer had worked
    // on the branch too, so that sample is shared by both.
    assert_eq!(
        d1["bots"],
        json!([
            {"bot": "b-dev", "role": "dev",
             "to_open_s": shared(1, 0, Some(1800), Some(1800)),
             "to_merge_s": shared(1, 1, Some(19800), Some(19800)),
             "launch_to_open_s": shared(1, 0, Some(3600), Some(3600)),
             "launch_to_merge_s": shared(1, 1, Some(21600), Some(21600))},
            {"bot": "b-fix", "role": "fix",
             "to_open_s": shared(0, 0, None, None),
             "to_merge_s": shared(1, 1, Some(19800), Some(19800)),
             "launch_to_open_s": shared(0, 0, None, None),
             "launch_to_merge_s": shared(1, 1, Some(21600), Some(21600))},
        ]),
        "{d1}"
    );
    // No launch (feat/gh-4) and a launch with no recorded role (feat/gh-5): counted, apart.
    assert_eq!(d1["attribution"], "partial");
    assert_eq!(
        d1["unattributed"],
        json!({
            "to_open_s": stat(1, Some(3600), Some(3600)),
            "to_merge_s": stat(1, Some(5400), Some(5400)),
            "launch_to_open_s": stat(1, Some(3600), Some(3600)),
            "launch_to_merge_s": stat(0, None, None),
        })
    );

    // The week adds the omp worker's branch, opened on the 5th.
    let d7 = &window(&v, "d7")["time_to_pr"];
    assert_eq!(d7["all"]["to_open_s"], stat(3, Some(3600), Some(3600)));
    assert_eq!(
        d7["all"]["launch_to_open_s"],
        stat(3, Some(3600), Some(5400))
    );
    let omp = d7["bots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["bot"] == "b-omp")
        .unwrap();
    assert_eq!(omp["role"], "dev");
    assert_eq!(
        omp["launch_to_open_s"],
        shared(1, 0, Some(5400), Some(5400))
    );
    assert!(
        d7["branches"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["branch"] == "feat/gh-3" && b["state"] == "open" && b["to_open_s"] == 3600),
        "{d7}"
    );
}

#[test]
fn a_repo_filter_keeps_only_that_repo() {
    let (s, _) = fleet();
    let v = report(&s, &["--window", "d7", "--repo", "example.com/acme/other"]);
    let d7 = window(&v, "d7");
    // Nothing of that repo ran: no count is a 0.
    assert_eq!(d7["state"], "no_data", "{d7}");
    assert_eq!(d7["errors"]["tool_error"]["count"], Value::Null);
    assert_eq!(d7["errors"]["api_error"]["count"], Value::Null);
    let v = report(&s, &["--window", "d7", "--repo", REPO]);
    assert_eq!(window(&v, "d7")["errors"]["tool_error"]["count"], 5);
    assert_eq!(window(&v, "d7")["errors"]["api_error"]["count"], 2);
}

#[test]
fn the_newest_pr_row_wins_and_an_unreadable_one_is_refused() {
    let mut s = Scene::migrated(MIGRATED, &[]);
    s.store().cache_repo(ROOT, Some(REPO), t(SYNCED)).unwrap();
    let gh = wt("gh-8");
    s.start(start(
        "t7781",
        "b-dev",
        "dev",
        "claude",
        &gh,
        "feat/gh-8",
        "2026-11-08T10:00:00Z",
        None,
    ));
    // Out of order in the file: the row Herdr wrote last is the one that counts.
    s.ledger_row(pr_row(
        "feat/gh-8",
        108,
        "merged",
        None,
        None,
        Some("2026-11-08T15:00:00Z"),
        "2026-11-08T15:05:00Z",
    ));
    s.ledger_row(pr_row(
        "feat/gh-8",
        108,
        "open",
        Some("2026-11-08T10:30:00Z"),
        Some("2026-11-08T11:00:00Z"),
        None,
        "2026-11-08T11:05:00Z",
    ));
    // Refused whole: no number, a state the meter does not know, a time it cannot read, a merge
    // with no time, and another machine's row.
    for bad in [
        json!({"event": "pr", "project": ROOT, "branch": "feat/bad-1", "pr": 0, "state": "open",
               "opened_at": "2026-11-08T11:00:00Z", "at": "2026-11-08T11:05:00Z"}),
        json!({"event": "pr", "project": ROOT, "branch": "feat/bad-2", "pr": 2, "state": "draft",
               "opened_at": "2026-11-08T11:00:00Z", "at": "2026-11-08T11:05:00Z"}),
        json!({"event": "pr", "project": ROOT, "branch": "feat/bad-3", "pr": 3, "state": "open",
               "opened_at": "yesterday", "at": "2026-11-08T11:05:00Z"}),
        json!({"event": "pr", "project": ROOT, "branch": "feat/bad-4", "pr": 4, "state": "merged",
               "opened_at": "2026-11-08T11:00:00Z", "at": "2026-11-08T11:05:00Z"}),
        json!({"event": "pr", "project": ROOT, "branch": "feat/bad-5", "pr": 5, "state": "open",
               "opened_at": "2026-11-08T11:00:00Z", "at": "2026-11-08T11:05:00Z",
               "core": scenes::OTHER_CORE}),
    ] {
        s.ledger_row(bad.to_string());
    }
    s.sync();
    let v = report(&s, &["--window", "d1"]);
    let t = &window(&v, "d1")["time_to_pr"];
    assert_eq!(
        t["branches"],
        json!([{"repo": REPO, "branch": "feat/gh-8", "pr": 108, "state": "merged",
                "to_open_s": 1800, "to_merge_s": 16200, "launch_to_open_s": 3600,
                "launch_to_merge_s": 18000}]),
        "{t}"
    );
    assert_eq!(t["attribution"], "full");
    let n: i64 = s
        .store()
        .conn
        .query_row("SELECT count(*) FROM pr", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);
    // The store keeps the repo, never an address a row carried.
    let cols: String = s
        .store()
        .conn
        .query_row(
            "SELECT group_concat(name) FROM pragma_table_info('pr')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        !cols.contains("url") && !cols.contains("title") && !cols.contains("author"),
        "{cols}"
    );
}

// ---------------------------------------------------------------------------------------------
// Unknown is never 0.

#[test]
fn a_window_with_no_data_is_no_data_with_null_counts_and_percentiles() {
    let s = Scene::migrated(MIGRATED, &[]);
    let v = report(&s, &[]);
    assert_eq!(v["recorded"], true);
    for name in ["d1", "d7", "d30"] {
        let w = window(&v, name);
        assert_eq!(w["state"], "no_data", "{w}");
        assert_eq!(w["errors"]["tool_error"]["state"], "no_data");
        assert_eq!(w["errors"]["tool_error"]["count"], Value::Null);
        assert_eq!(w["errors"]["api_error"]["state"], "no_data");
        assert_eq!(w["errors"]["api_error"]["count"], Value::Null);
        assert_eq!(w["errors"]["run_failed"]["count"], Value::Null);
        assert_eq!(w["run_ends"], Value::Null);
        let t = &w["time_to_pr"];
        assert_eq!(t["state"], "no_data");
        for clock in [
            "to_open_s",
            "to_merge_s",
            "launch_to_open_s",
            "launch_to_merge_s",
        ] {
            assert_eq!(t["all"][clock], stat(0, None, None), "{name} {clock}");
        }
        assert_eq!(t["branches"], json!([]));
    }
    // Never a 0 for a count or a percentile, in either form.
    let json = serde_json::to_string(&v).unwrap();
    assert!(!json.contains("\"count\":0"), "{json}");
    assert!(
        !json.contains("\"p50_s\":0") && !json.contains("\"p90_s\":0"),
        "{json}"
    );
    let t = text(&s, &[]);
    assert!(t.contains("state: no_data"), "{t}");
    assert!(
        t.contains("tool_error (harness_log): null [no_data]"),
        "{t}"
    );
    assert!(t.contains("api_error (harness_log): null [no_data]"), "{t}");
    assert!(
        t.contains("run_failed (hc_snapshot): null [no_data]"),
        "{t}"
    );
}

#[test]
fn a_store_no_sync_has_prepared_is_not_recorded_and_stays_untouched() {
    let (s, _) = fleet();
    // The store as a meter before issue 899 left it.
    {
        let st = s.store();
        st.conn
            .execute_batch(
                "DROP TABLE ev_error; DROP TABLE pr;
         DELETE FROM meta WHERE k IN ('errors_from_ms', 'errors_through_ms', 'errors_files',
           'api_errors_from_ms', 'api_errors_through_ms', 'api_errors_files');
         PRAGMA wal_checkpoint(TRUNCATE);",
            )
            .unwrap();
    }
    let before = folder(&s.env.state());
    let v = report(&s, &[]);
    assert_eq!(v["recorded"], false);
    assert_eq!(v["errors_from"], Value::Null);
    assert_eq!(v["api_errors_from"], Value::Null);
    for w in v["windows"].as_array().unwrap() {
        assert_eq!(w["state"], "not_recorded", "{w}");
        assert_eq!(
            w["errors"]["tool_error"],
            json!({"state": "not_recorded", "source": "harness_log", "count": null})
        );
        assert_eq!(
            w["errors"]["api_error"],
            json!({"state": "not_recorded", "source": "harness_log", "count": null})
        );
        assert_eq!(w["errors"]["run_failed"]["count"], Value::Null);
        assert_eq!(w["time_to_pr"]["state"], "not_recorded");
    }
    assert!(text(&s, &[]).contains("not_recorded: this store has not been prepared"));
    // A read makes no table.
    same_folder(
        &folder(&s.env.state()),
        &before,
        "outcomes on an unprepared store",
    );
    let tables: i64 = s
        .store()
        .conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name IN ('ev_error', 'pr')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tables, 0);
}

#[test]
fn failures_start_at_errors_from_on_a_store_that_had_read_logs() {
    let mut s = Scene::migrated(MIGRATED, &[]);
    let cwd = wt("gh-1");
    s.store().cache_repo(&cwd, Some(REPO), t(SYNCED)).unwrap();
    write_claude(
        &s,
        "sess-a",
        &[
            claude_call("sess-a", &cwd, "feat/gh-1", "2026-11-08T10:00:00Z", 1),
            claude_result(
                "sess-a",
                &cwd,
                "feat/gh-1",
                "2026-11-08T10:01:00Z",
                "tu-1",
                true,
            ),
        ],
    );
    s.sync();
    // As a meter before issue 899 would have left it: the log read, its failure skipped.
    {
        let st = s.store();
        st.conn
            .execute_batch(
                "DROP TABLE ev_error; DROP TABLE pr;
         DELETE FROM meta WHERE k IN ('errors_from_ms', 'errors_through_ms', 'errors_files',
           'api_errors_from_ms', 'api_errors_through_ms', 'api_errors_files');",
            )
            .unwrap();
    }
    s.sync_at("2026-11-08T19:55:00Z", 60, None);
    let v = report(&s, &["--window", "d1"]);
    assert_eq!(v["errors_from"], "2026-11-08T19:55:00Z");
    assert_eq!(v["api_errors_from"], "2026-11-08T19:55:00Z");
    let d1 = window(&v, "d1");
    // The failure before it was never recorded: the window is partial, its count a lower bound.
    assert_eq!(d1["state"], "partial");
    assert_eq!(
        d1["errors"]["tool_error"],
        json!({"state": "partial", "source": "harness_log", "count": 0})
    );
    assert_eq!(
        d1["errors"]["api_error"],
        json!({"state": "partial", "source": "harness_log", "count": 0})
    );
}

#[test]
fn an_upgrade_from_issue_899_keeps_tool_error_full_and_marks_api_error_not_recorded_then_partial() {
    let (s, ends) = fleet();
    // Strip the issue-1026 meta stamps: even if an api_error row is in ev_error, a report with
    // no api_errors_from_ms reads none of it and reports not_recorded (null, never 0).
    {
        let st = s.store();
        st.conn
            .execute_batch(
                "DELETE FROM meta WHERE k IN ('api_errors_from_ms', 'api_errors_through_ms',
                   'api_errors_files');",
            )
            .unwrap();
    }
    // Before sync: tool_error is full, api_error is not_recorded (null, never 0, and no row).
    let before = report(&s, &["--window", "d1"]);
    assert_eq!(before["errors_from"], scenes::COUNTED_FROM);
    assert_eq!(before["api_errors_from"], Value::Null);
    let d1 = window(&before, "d1");
    assert_eq!(d1["state"], "partial");
    assert_eq!(
        d1["errors"]["tool_error"],
        json!({"state": "full", "source": "harness_log", "count": 4})
    );
    assert_eq!(
        d1["errors"]["api_error"],
        json!({"state": "not_recorded", "source": "harness_log", "count": null})
    );
    assert!(
        d1["errors"]["rows"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["error_kind"] != "api_error"),
        "{d1}"
    );
    s.store()
        .conn
        .execute("DELETE FROM ev_error WHERE kind = 'api_error'", [])
        .unwrap();

    // After sync on the already-read logs: tool_error stays full, api_error starts now (partial).
    let gh1 = wt("gh-1");
    let log = s.env.claude("-work-widgets/sess-dev.jsonl");
    let fresh = claude_api_error(
        "sess-dev",
        &gh1,
        "feat/gh-1",
        "2026-11-08T19:54:00Z",
        "uuid-api-after",
        json!(true),
    );
    common::append(&log, &format!("{fresh}\n"));
    let mut o = s.env.opts();
    o.now_ms = t("2026-11-08T19:55:00Z");
    o.days = Some(60);
    o.ends = Some(ends);
    s.env.run(&o);
    let after = report(&s, &["--window", "d1"]);
    assert_eq!(after["errors_from"], scenes::COUNTED_FROM);
    assert_eq!(after["api_errors_from"], "2026-11-08T19:55:00Z");
    let d1 = window(&after, "d1");
    assert_eq!(d1["state"], "partial");
    assert_eq!(
        d1["errors"]["tool_error"],
        json!({"state": "full", "source": "harness_log", "count": 4})
    );
    assert_eq!(
        d1["errors"]["api_error"],
        json!({"state": "partial", "source": "harness_log", "count": 1})
    );
}

#[test]
fn a_sync_by_an_older_meter_moves_errors_from_and_the_window_is_partial() {
    let (s, ends) = fleet();
    let before = report(&s, &["--window", "d1"]);
    assert_eq!(
        window(&before, "d1")["errors"]["tool_error"]["state"],
        "full"
    );
    assert_eq!(before["errors_from"], scenes::COUNTED_FROM);

    // A rollback: an older meter syncs. It reads a log's new lines, moves its offset and its
    // watermark, and records no failure.
    let gh1 = wt("gh-1");
    let log = s.env.claude("-work-widgets/sess-dev.jsonl");
    let skipped = claude_result(
        "sess-dev",
        &gh1,
        "feat/gh-1",
        "2026-11-08T19:53:00Z",
        "tu-7",
        true,
    );
    common::append(&log, &format!("{skipped}\n"));
    {
        let st = s.store();
        st.conn
            .execute(
                "UPDATE files SET offset = ?1, size = ?1 WHERE path = ?2",
                params![
                    fs::metadata(&log).unwrap().len() as i64,
                    log.to_string_lossy()
                ],
            )
            .unwrap();
        st.set_meta("last_run_ms", &t("2026-11-08T19:54:00Z").to_string())
            .unwrap();
    }
    // This meter again: the gap is unknown, so the failures start from now.
    let mut o = s.env.opts();
    o.now_ms = t("2026-11-08T19:56:00Z");
    o.days = Some(60);
    o.ends = Some(ends);
    s.env.run(&o);
    let v = report(&s, &["--window", "d1"]);
    assert_eq!(v["errors_from"], "2026-11-08T19:56:00Z");
    assert_eq!(v["api_errors_from"], "2026-11-08T19:56:00Z");
    let d1 = window(&v, "d1");
    assert_eq!(d1["state"], "partial", "{d1}");
    // What was recorded before the gap still counts, as a lower bound: never a full count.
    assert_eq!(
        d1["errors"]["tool_error"],
        json!({"state": "partial", "source": "harness_log", "count": 4})
    );
    assert_eq!(
        d1["errors"]["api_error"],
        json!({"state": "partial", "source": "harness_log", "count": 1})
    );
    let t = text(&s, &["--window", "d1"]);
    assert!(t.contains("tool_error (harness_log): 4 [partial]"), "{t}");
    assert!(t.contains("api_error (harness_log): 1 [partial]"), "{t}");
}

/// What the reset of a meter from before issue 899 does to a store, statement for statement
/// (v3.125.0's `reset_at`): every row, offset and piece of evidence goes, the tables a failure's
/// ids point into are emptied (their ids then start again from 1), and the window moves. That
/// meter does not know `ev_error`, so the failures stay.
fn reset_by_an_older_meter(s: &Scene, counted_from: &str) {
    let st = s.store();
    st.conn
        .execute_batch(
            "DELETE FROM usage; DELETE FROM files; DELETE FROM seen; DELETE FROM sessions;
             DELETE FROM health; DELETE FROM codex_threads;
             DELETE FROM evidence; DELETE FROM ev_dirty; DELETE FROM ev_dim; DELETE FROM ev_actor;
             DELETE FROM ev_cwd;
             DELETE FROM meta WHERE k IN ('last_success_ms', 'last_run_ms', 'last_pending_bytes',
               'last_pending_files', 'codex_watermark_ms', 'codex_bad_lines');",
        )
        .unwrap();
    let from = t(counted_from).to_string();
    st.set_meta("counted_from_ms", &from).unwrap();
    st.set_meta("evidence_from_ms", &from).unwrap();
}

/// The tool failures the report attributes, as (bot, count), and those the store holds.
fn tool_failures(w: &Value) -> Vec<(String, i64)> {
    w["errors"]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["error_kind"] == "tool_error")
        .map(|r| {
            (
                r["bot"].as_str().unwrap().to_owned(),
                r["count"].as_i64().unwrap(),
            )
        })
        .collect()
}

fn stored_failures(s: &Scene) -> Vec<(Option<String>, i64)> {
    let st = s.store();
    let mut q = st
        .conn
        .prepare(
            "SELECT a.bot, count(*) FROM ev_error e LEFT JOIN ev_actor a ON a.id = e.actor
             GROUP BY a.bot ORDER BY a.bot",
        )
        .unwrap();
    q.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn a_reset_by_an_older_meter_never_leaves_a_failure_under_another_bot() {
    let mut s = Scene::migrated(MIGRATED, &[]);
    let (gh1, gh2, gh3) = (wt("gh-1"), wt("gh-2"), wt("gh-3"));
    for cwd in [&gh1, &gh2, &gh3] {
        s.store().cache_repo(cwd, Some(REPO), t(SYNCED)).unwrap();
    }
    let at = "2026-11-08T10:00:00Z";
    s.start(start(
        "t7711",
        "b-dev",
        "dev",
        "claude",
        &gh1,
        "feat/gh-1",
        at,
        Some("sess-dev"),
    ));
    s.start(start(
        "t7712",
        "b-gone",
        "fix",
        "claude",
        &gh2,
        "feat/gh-2",
        at,
        Some("sess-gone"),
    ));
    let failed = |session: &str, cwd: &str, branch: &str, ts: &str, id: &str| {
        claude_result(session, cwd, branch, ts, id, true)
    };
    write_claude(
        &s,
        "sess-dev",
        &[
            claude_call("sess-dev", &gh1, "feat/gh-1", "2026-11-08T10:10:00Z", 1),
            failed(
                "sess-dev",
                &gh1,
                "feat/gh-1",
                "2026-11-08T10:11:00Z",
                "tu-1",
            ),
            failed(
                "sess-dev",
                &gh1,
                "feat/gh-1",
                "2026-11-08T10:12:00Z",
                "tu-2",
            ),
            claude_api_error(
                "sess-dev",
                &gh1,
                "feat/gh-1",
                "2026-11-08T10:13:00Z",
                "uuid-dev-1",
                json!(true),
            ),
        ],
    );
    write_claude(
        &s,
        "sess-gone",
        &[
            claude_call("sess-gone", &gh2, "feat/gh-2", "2026-11-08T10:20:00Z", 1),
            failed(
                "sess-gone",
                &gh2,
                "feat/gh-2",
                "2026-11-08T10:21:00Z",
                "tu-9",
            ),
            claude_api_error(
                "sess-gone",
                &gh2,
                "feat/gh-2",
                "2026-11-08T10:22:00Z",
                "uuid-gone-1",
                json!(true),
            ),
        ],
    );
    s.sync();
    let before = report(&s, &["--window", "d1"]);
    assert_eq!(
        tool_failures(window(&before, "d1")),
        [("b-dev".to_owned(), 2), ("b-gone".to_owned(), 1)]
    );

    // A rollback: the older meter widens the window, which resets the store. One session's log
    // is gone by then, and a bot that never failed has started: its log is read first, so it and
    // its branch take the ids the reset freed.
    reset_by_an_older_meter(&s, "2026-08-26T00:00:00Z");
    assert_eq!(stored_failures(&s), [(None, 5)], "that meter leaves them");
    fs::remove_file(s.env.claude("-work-widgets/sess-gone.jsonl")).unwrap();
    s.start(start(
        "t7713",
        "b-new",
        "review",
        "claude",
        &gh3,
        "feat/gh-3",
        "2026-11-08T12:00:00Z",
        Some("sess-a-new"),
    ));
    write_claude(
        &s,
        "sess-a-new",
        &[claude_call(
            "sess-a-new",
            &gh3,
            "feat/gh-3",
            "2026-11-08T12:10:00Z",
            1,
        )],
    );

    // Until this meter syncs again, a report reads none of the failures left behind: no count,
    // and never a 0.
    let v = report(&s, &["--window", "d1"]);
    assert_eq!(v["errors_from"], Value::Null);
    assert_eq!(v["api_errors_from"], Value::Null);
    let d1 = window(&v, "d1");
    assert_eq!(
        d1["errors"]["tool_error"],
        json!({"state": "not_recorded", "source": "harness_log", "count": null})
    );
    assert_eq!(
        d1["errors"]["api_error"],
        json!({"state": "not_recorded", "source": "harness_log", "count": null})
    );
    assert_eq!(tool_failures(d1), []);

    // This meter again: it drops them before it reads a log, and starts the failures from now.
    s.sync_with(|o| o.now_ms = t("2026-11-08T19:56:00Z"));
    let v = report(&s, &["--window", "d1"]);
    assert_eq!(v["errors_from"], "2026-11-08T19:56:00Z");
    assert_eq!(v["api_errors_from"], "2026-11-08T19:56:00Z");
    // Only what the logs still hold is there, read again: the lost session's failure is gone,
    // and nothing sits under the bot that took the freed ids.
    assert_eq!(stored_failures(&s), [(Some("b-dev".to_owned()), 3)]);
    let d1 = window(&v, "d1");
    assert_eq!(
        d1["errors"]["tool_error"],
        json!({"state": "partial", "source": "harness_log", "count": 2})
    );
    assert_eq!(
        d1["errors"]["api_error"],
        json!({"state": "partial", "source": "harness_log", "count": 1})
    );
    assert_eq!(tool_failures(d1), [("b-dev".to_owned(), 2)]);

    // The next sync of this meter keeps them: the window is the one they were recorded in.
    s.sync_with(|o| o.now_ms = t("2026-11-08T19:58:00Z"));
    let v = report(&s, &["--window", "d1"]);
    assert_eq!(v["errors_from"], "2026-11-08T19:56:00Z");
    assert_eq!(v["api_errors_from"], "2026-11-08T19:56:00Z");
    assert_eq!(tool_failures(window(&v, "d1")), [("b-dev".to_owned(), 2)]);
}

#[test]
fn a_launch_whose_end_no_one_recorded_makes_run_failed_partial() {
    let mut s = Scene::migrated(MIGRATED, &[]);
    let gh = wt("gh-6");
    s.store().cache_repo(&gh, Some(REPO), t(SYNCED)).unwrap();
    s.start(start(
        "t7761",
        "b-dev",
        "dev",
        "claude",
        &gh,
        "feat/gh-6",
        "2026-11-08T10:00:00Z",
        None,
    ));
    // Herdr saw it end; hc had already forgotten the terminal, so no status is known.
    s.ledger_row(
        json!({"event": "end", "terminal": "t7761", "created_ms": t("2026-11-08T10:00:00Z"),
               "core": MACHINE, "reason": "finished", "at": "2026-11-08T12:00:00Z"})
        .to_string(),
    );
    s.sync_with(|o| o.ends = Some(Vec::new()));
    let v = report(&s, &["--window", "d1"]);
    let d1 = window(&v, "d1");
    assert_eq!(d1["state"], "partial", "{d1}");
    assert_eq!(
        d1["errors"]["run_failed"],
        json!({"state": "partial", "source": "hc_snapshot", "count": 0})
    );
    assert_eq!(d1["run_ends"]["unknown"], 1);
}

// ---------------------------------------------------------------------------------------------
// Bounds, privacy and the read-only rule.

#[test]
fn lists_are_capped_and_counted_and_the_output_stays_under_64_kib() {
    let mut s = Scene::migrated(MIGRATED, &[]);
    s.store().cache_repo(ROOT, Some(REPO), t(SYNCED)).unwrap();
    let long = "x".repeat(180);
    for i in 0..450 {
        s.ledger_row(pr_row(
            &format!("feat/{long}-{i:03}"),
            1000 + i,
            "open",
            Some("2026-11-08T10:00:00Z"),
            Some("2026-11-08T11:00:00Z"),
            None,
            "2026-11-08T11:05:00Z",
        ));
    }
    s.sync();
    for a in [vec![], vec!["--window", "d1"]] {
        let v = report(&s, &a);
        assert_eq!(v["truncated"], true);
        for w in v["windows"].as_array().unwrap() {
            let t = &w["time_to_pr"];
            let shown = t["branches"].as_array().unwrap().len() as u64;
            assert!(shown <= 200, "{shown}");
            assert_eq!(shown + t["branches_omitted"].as_u64().unwrap(), 450);
            // Every total still includes every branch.
            assert_eq!(t["all"]["to_open_s"], stat(450, Some(3600), Some(3600)));
        }
        let text = text(&s, &a);
        assert!(text.contains("branches_omitted: "), "{}", &text[..400]);
    }
}

#[test]
fn nothing_private_reaches_the_json_or_the_text() {
    let (s, _) = fleet();
    let json = serde_json::to_string(&report(&s, &[])).unwrap();
    let text = text(&s, &[]);
    for out in [&json, &text] {
        for (what, needle) in [
            ("a session id", "sess-"),
            ("a session id", "thr-fix"),
            ("a terminal", "t771"),
            ("a tool-use id", "tu-"),
            ("an item id", "item-"),
            ("an api-error uuid", "uuid-api-"),
            ("a folder", "/work"),
            ("a folder", ".worktrees"),
            ("a home", "/home/"),
            ("a tool name", "FAKE-TOOL-NAME"),
            ("a tool's arguments", "FAKE-COMMAND"),
            ("an error text", "FAKE-ERROR-TEXT"),
            ("an api-error text", "FAKE-API-ERROR-TEXT"),
            ("an api-error status", "429"),
            ("an api-error code", "rate_limit"),
            ("a user prompt", "prompt quoting"),
            ("a pull request's title", "FAKE-PR-TITLE"),
            ("a pull request's author", "fake-author"),
            ("a pull request's address", "/pull/"),
            ("an address", "https://"),
        ] {
            assert!(!out.contains(needle), "the output holds {what} ({needle})");
        }
    }
    // The store itself keeps no text of a failure either: only ids and a keyed hash.
    let st = s.store();
    let cols: String = st
        .conn
        .query_row(
            "SELECT group_concat(name) FROM pragma_table_info('ev_error')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        cols,
        "id,ts_ms,kind,source,dim,actor,session,parent,cwd,session_cwd,ident"
    );
    let raw: i64 = st
        .conn
        .query_row(
            "SELECT count(*) FROM ev_error WHERE length(ident) != 16 OR typeof(ident) != 'blob'
               OR (session IS NOT NULL AND typeof(session) != 'blob')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(raw, 0);
}

#[test]
fn a_report_never_changes_the_state_folder() {
    let (s, _) = fleet();
    let before = folder(&s.env.state());
    assert!(before.contains_key("meter.db"), "{:?}", before.keys());
    let _g = serial();
    for a in [
        vec!["outcomes", "--json"],
        vec!["outcomes"],
        vec!["outcomes", "--window", "d7"],
    ] {
        let out = bin(&s, &a);
        assert_eq!(
            out.status.code(),
            Some(0),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(out.stderr.is_empty());
        assert!(!out.stdout.is_empty());
        same_folder(&folder(&s.env.state()), &before, "outcomes");
    }
    // A refusal leaves it as it was too.
    s.store().set_meta("schema_version", "4").unwrap();
    let before = folder(&s.env.state());
    let out = bin(&s, &["outcomes", "--json"]);
    assert_eq!(out.status.code(), Some(12));
    assert!(out.stdout.is_empty());
    same_folder(&folder(&s.env.state()), &before, "a newer store");
}

#[test]
fn exit_codes_follow_the_query_store_states() {
    let s = Scene::migrated(MIGRATED, &[]);
    let r = outcomes::run(&args(&["--window", "d2"]), &ctx(&s));
    assert_eq!(r.code, query::exit::USAGE);
    assert!(r.stdout.is_empty());
    assert!(r.stderr.unwrap().contains("--window takes d1, d7 or d30"));
    assert_eq!(
        outcomes::run(&args(&["--bogus"]), &ctx(&s)).code,
        query::exit::USAGE
    );
    assert_eq!(
        outcomes::run(&args(&["--repo", "not a repo"]), &ctx(&s)).code,
        query::exit::USAGE
    );
    let empty = common::Env::new();
    let absent = Ctx {
        state: Some(StateDirs {
            dir: empty.state(),
            legacy: None,
        }),
        ..ctx(&s)
    };
    assert_eq!(outcomes::run(&[], &absent).code, query::exit::ABSENT_STORE);
    s.store().set_meta("schema_version", "2").unwrap();
    assert_eq!(
        outcomes::run(&[], &ctx(&s)).code,
        query::exit::OUTDATED_STORE
    );
    s.store().set_meta("schema_version", "4").unwrap();
    assert_eq!(outcomes::run(&[], &ctx(&s)).code, query::exit::NEWER_SCHEMA);
}

#[test]
fn the_help_names_the_verb_and_what_its_counts_are() {
    let s = Scene::migrated(MIGRATED, &[]);
    let out = bin(&s, &["--help"]);
    let help = String::from_utf8(out.stdout).unwrap();
    for needle in [
        "usagemeter outcomes [--window d1|d7|d30 ...] [--repo HOST/OWNER/REPO ...] [--json]",
        "harness-flagged failures,",
        "including expected ones (a red test run while working test-first, a grep with no",
        "not a quality verdict on their own",
        "a tool_result block with is_error: true, once per tool_use_id",
        "an item_completed event whose item has status failed or a non-zero",
        "api_error (harness_log)",
        "isApiErrorMessage: true, once per line uuid",
        "usage-limit stops",
        "listed as unsupported, never counted as 0",
        "run_failed (hc_snapshot, workers_ledger)",
        "workers_ledger when an end row of Herdr's",
    ] {
        assert!(help.contains(needle), "--help lacks: {needle}");
    }
}

// ---------------------------------------------------------------------------------------------
// The state folder, compared as the query's and coverage's tests compare it.

#[track_caller]
fn same_folder(after: &BTreeMap<String, Vec<u8>>, before: &BTreeMap<String, Vec<u8>>, what: &str) {
    let diff: Vec<String> = before
        .keys()
        .chain(after.keys())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .filter(|k| before.get(*k) != after.get(*k))
        .filter(|k| match (k.as_str(), before.get(*k), after.get(*k)) {
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

fn bin(s: &Scene, a: &[&str]) -> Output {
    s.env
        .command()
        .args(a)
        .env("METER_STATE_DIR", s.env.state())
        .output()
        .unwrap()
}

// ---------------------------------------------------------------------------------------------
// The ceilings (300 ms p95, 250 ms CPU, 64 MiB RSS, 64 KiB out), on a store sized past a busy
// fleet's retention. Not part of a gate: `cargo test --test outcomes -- --ignored
// outcomes_ceiling --nocapture` prints the warm report's wall times, CPU, peak memory and output
// size; the numbers are recorded in the pull request, never asserted here.

/// 180,000 tool failures over 90 days (40 repos, 50 bots, two harnesses), 3,000 launches and
/// 3,000 pull requests over 300 days.
#[test]
#[ignore]
fn outcomes_ceiling() {
    let s = Scene::migrated(MIGRATED, &[]);
    let now = t(SYNCED);
    {
        let mut st = s.store();
        let tx = st.conn.transaction().unwrap();
        for d in 0..80i64 {
            tx.execute(
                "INSERT INTO ev_dim(id, harness, model, machine, repo, branch, precision)
                 VALUES(?1, ?2, '', ?3, ?4, ?5, '')",
                params![
                    1000 + d,
                    if d % 2 == 0 { "claude-code" } else { "codex" },
                    MACHINE,
                    format!("example.com/acme/repo-{:02}", d / 2),
                    format!("feat/branch-{d}")
                ],
            )
            .unwrap();
        }
        for a in 0..50i64 {
            tx.execute(
                "INSERT INTO ev_actor(id, state, bot, kind, role, squad, basis)
                 VALUES(?1, 'attributed', ?2, 'worker', ?3, 'b-squad', 'session')",
                params![
                    1000 + a,
                    format!("b-bot-{a:02}"),
                    ["dev", "fix", "review"][a as usize % 3]
                ],
            )
            .unwrap();
        }
        tx.execute(
            "INSERT INTO ev_actor(id, state, reason) VALUES(999, 'unlinked', 'no_record')",
            [],
        )
        .unwrap();
        {
            let mut ins = tx
                .prepare(
                    "INSERT INTO ev_error(ts_ms, kind, source, dim, actor, session, ident)
                     VALUES(?1, 'tool_error', 'harness_log', ?2, ?3, ?4, ?5)",
                )
                .unwrap();
            for i in 0..180_000i64 {
                let actor = if i % 17 == 0 { 999 } else { 1000 + i % 50 };
                let mut ident = [0u8; 16];
                ident[..8].copy_from_slice(&i.to_be_bytes());
                ins.execute(params![
                    now - (i % 129_600) * 60_000,
                    1000 + i % 80,
                    actor,
                    vec![(i % 251) as u8; 16],
                    ident.to_vec()
                ])
                .unwrap();
            }
            let mut launch = tx
                .prepare(
                    "INSERT INTO launch(lkey, core, terminal, created_ms, kind, bot, role, squad,
                       project, branch, worktree, agent, valid_from, valid_to, source, updated_ms,
                       end_reason, exit_code, end_source, ended_ms)
                     VALUES(?1, ?2, ?3, ?4, 'worker', ?5, ?6, 'b-squad', ?7, ?8, ?9, ?10, ?4, ?11,
                       'ledger', ?4, ?12, ?13, 'hc_snapshot', ?11)",
                )
                .unwrap();
            let mut pr = tx
                .prepare(
                    "INSERT INTO pr(project, branch, pr, repo, state, first_commit_ms, opened_ms,
                       merged_ms, at_ms) VALUES(?1, ?2, ?3, ?4, 'merged', ?5, ?6, ?7, ?7)",
                )
                .unwrap();
            for i in 0..3_000i64 {
                let created = now - i * 144 * 60_000;
                let project = format!("/work/repo-{:02}", i % 40);
                let branch = format!("feat/branch-{i}");
                launch
                    .execute(params![
                        format!("key\x1f{MACHINE}\x1ft{i}\x1f{created}"),
                        MACHINE,
                        format!("t{i}"),
                        created,
                        format!("b-bot-{:02}", i % 50),
                        ["dev", "fix", "review"][i as usize % 3],
                        project,
                        branch,
                        format!("{project}/.worktrees/w{i}"),
                        if i % 2 == 0 { "claude" } else { "codex" },
                        created + 3_600_000,
                        if i % 9 == 0 { "killed" } else { "exited" },
                        i % 5
                    ])
                    .unwrap();
                pr.execute(params![
                    project,
                    branch,
                    i + 1,
                    format!("example.com/acme/repo-{:02}", i % 40),
                    created + 600_000,
                    created + 1_800_000 + (i % 13) * 60_000,
                    created + 3_000_000 + (i % 7) * 600_000
                ])
                .unwrap();
            }
        }
        tx.commit().unwrap();
        // As a sync at the scenes' clock left it, so the windows end there.
        st.set_meta("last_run_ms", &now.to_string()).unwrap();
        st.conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
    }
    let _g = serial();
    for form in [vec!["outcomes", "--json"], vec!["outcomes"]] {
        let warm = bin(&s, &form);
        assert_eq!(
            warm.status.code(),
            Some(0),
            "{}",
            String::from_utf8_lossy(&warm.stderr)
        );
        assert!(
            warm.stdout.len() <= outcomes::OUTPUT_CAP,
            "{} bytes",
            warm.stdout.len()
        );
        let mut times: Vec<u128> = Vec::new();
        for _ in 0..20 {
            let t0 = std::time::Instant::now();
            let out = bin(&s, &form);
            times.push(t0.elapsed().as_millis());
            assert_eq!(out.status.code(), Some(0));
        }
        times.sort_unstable();
        let p95 = times[(times.len() * 95 / 100).min(times.len() - 1)];
        println!(
            "outcomes ceiling {form:?}: warm p95 {p95} ms, min {} ms, max {} ms, {} bytes out",
            times[0],
            times[times.len() - 1],
            warm.stdout.len()
        );
    }
    // CPU and peak memory, where GNU time is installed.
    let gnu_time = Path::new("/usr/bin/time");
    if gnu_time.exists() {
        let out = std::process::Command::new(gnu_time)
            .args(["-f", "user %U s, system %S s, peak %M KiB"])
            .arg(env!("CARGO_BIN_EXE_usagemeter"))
            .args(["outcomes", "--json"])
            .env_clear()
            .env("HOME", s.env.home())
            .env("METER_STATE_DIR", s.env.state())
            .output()
            .unwrap();
        println!(
            "outcomes ceiling: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let v = report(&s, &["--window", "d30"]);
    let d30 = window(&v, "d30");
    // Every total holds what the lists were cut to fit.
    assert_eq!(d30["errors"]["tool_error"]["state"], "full");
    assert!(
        d30["errors"]["tool_error"]["count"].as_i64().unwrap() > 50_000,
        "{}",
        d30["errors"]
    );
    assert_eq!(v["truncated"], true);
}
