//! Synthetic ledgers only: every id, path and name here is made up.

use super::*;
use crate::hc::{Labels, Terminal};
use serde_json::{Value, json};

const CORE: &str = "core-synthetic-a";
const PROJECT: &str = "/work/example-project";
const WT: &str = "/work/example-project/.worktrees/gh-45";
const WT_B: &str = "/work/other-project/.worktrees/gh-45";

/// 2026-01-01T09:00:00Z plus `min` minutes.
fn t(min: i64) -> i64 {
    crate::time::parse_rfc3339("2026-01-01T09:00:00Z").unwrap() + min * 60_000
}

fn iso(ms: i64) -> String {
    crate::time::format_rfc3339(ms)
}

/// A worker's start row, as Herdr writes it since RFC 0021: launched `min` minutes in, the row
/// written five seconds after its terminal was created.
fn worker(terminal: &str, min: i64, worktree: &str, agent: &str, bot: &str, role: &str) -> Value {
    json!({
        "event": "start", "kind": "worker", "terminal": terminal, "pid": 4242, "botId": bot,
        "task": "gh-45", "worktree": worktree, "agent": agent, "model": "example-model",
        "effort": "high", "template": null, "role": role, "branch": "feat/gh-45-example",
        "project": PROJECT, "lead": "b-lead", "base": "dev", "created": true, "swap": false,
        "override": false, "override_requested": null, "core": CORE, "created_ms": t(min),
        "squad": "b-squad", "session": null, "at": iso(t(min) + 5_000),
        "someFutureField": {"ignored": true}
    })
}

/// A seat's start row in the project root.
fn seat(terminal: &str, min: i64, agent: &str, bot: &str, role: &str) -> Value {
    json!({
        "event": "start", "kind": "seat", "terminal": terminal, "pid": null, "botId": bot,
        "task": null, "worktree": PROJECT, "agent": agent, "model": null, "effort": null,
        "template": null, "role": role, "branch": null, "project": PROJECT, "lead": "b-lead",
        "base": null, "created": false, "swap": false, "override": false,
        "override_requested": null, "core": CORE, "created_ms": t(min), "squad": "b-squad",
        "session": null, "at": iso(t(min) + 5_000)
    })
}

/// The briefing hook's session row: no agent (Claude's), no launch key.
fn hook_session(terminal: &str, session: &str, at: i64) -> Value {
    json!({"event": "session", "terminal": terminal, "session": session,
           "transcript": "/work/transcripts/example.jsonl", "at": iso(at)})
}

/// The CLI's session row on a restart or resume: its agent and the launch's key.
fn cli_session(terminal: &str, session: &str, agent: &str, created_min: i64, at: i64) -> Value {
    json!({"event": "session", "terminal": terminal, "session": session, "transcript": null,
           "agent": agent, "core": CORE, "created_ms": t(created_min), "at": iso(at)})
}

fn end(terminal: &str, created_min: i64, at: i64) -> Value {
    json!({"event": "end", "kind": "worker", "terminal": terminal, "core": CORE,
           "created_ms": t(created_min), "reason": "replaced", "at": iso(at)})
}

fn with(mut v: Value, key: &str, value: Value) -> Value {
    v[key] = value;
    v
}

fn lines(rows: &[Value]) -> Vec<u8> {
    let text: Vec<String> = rows.iter().map(Value::to_string).collect();
    text.join("\n").into_bytes()
}

fn resolver(rows: &[Value]) -> Resolver {
    resolver_seen(rows, vec![])
}

fn resolver_seen(rows: &[Value], snapshot: Vec<Terminal>) -> Resolver {
    let mut r = Resolver::new(Some(CORE.into()), snapshot);
    r.add_workers(&lines(rows));
    r
}

fn call<'a>(harness: &'a str, session: &'a str, cwd: &'a str, at: i64) -> Call<'a> {
    Call {
        harness,
        session: Some(session),
        parent_session: None,
        cwd: Some(cwd),
        session_cwd: Some(cwd),
        at_ms: at,
        copied: false,
    }
}

fn tag(r: Resolution) -> (Tag, Basis) {
    match r {
        Resolution::Tag(t, b) => (t, b),
        other => panic!("expected a tag, got {other:?}"),
    }
}

/// A terminal hc lists at the sync.
fn live(terminal: &str, created_min: i64, harness: &'static str, cwd: &str) -> Terminal {
    Terminal {
        terminal: terminal.into(),
        created_ms: Some(t(created_min)),
        finished_ms: None,
        harness: Some(harness),
        cwd: Some(cwd.into()),
        labels: Labels::default(),
    }
}

// Check (delivery 4): a dev and a reviewer on one worktree are ambiguous.
#[test]
fn a_dev_and_a_reviewer_on_one_worktree_are_ambiguous() {
    for (agent, harness) in [("codex", "codex"), ("omp", "omp"), ("dsh-tui", "dsh-tui")] {
        let mut r = resolver(&[
            worker("t1", 0, WT, agent, "b-dev", "dev"),
            worker("t2", 30, WT, agent, "b-reviewer", "review"),
        ]);
        // Before the reviewer starts, the dev alone claims the worktree.
        let (dev, basis) = tag(r.resolve(&call(harness, "rollout-1", WT, t(10))));
        assert_eq!((dev.bot.as_str(), basis), ("b-dev", Basis::Worktree));
        assert_eq!(dev.role.as_deref(), Some("dev"));
        assert_eq!(dev.squad.as_deref(), Some("b-squad"));
        // Once both run there, neither is named.
        assert_eq!(
            r.resolve(&call(harness, "rollout-1", WT, t(40))),
            Resolution::Ambiguous,
            "{agent}"
        );
    }
    // A Claude worker that no row names falls back to its worktree, the same way.
    let rows = [
        worker("t1", 0, WT, "claude", "b-dev", "dev"),
        worker("t2", 30, WT, "claude", "b-reviewer", "review"),
    ];
    let mut r = resolver(&rows);
    let (dev, basis) = tag(r.resolve(&call("claude-code", "s-dev", WT, t(10))));
    assert_eq!((dev.bot.as_str(), basis), ("b-dev", Basis::Worktree));
    assert_eq!(
        r.resolve(&call("claude-code", "s-dev", WT, t(40))),
        Resolution::Ambiguous
    );
    // With the session ids Herdr chose in their start rows, each Claude call names its own.
    let mut r = resolver(&[
        with(rows[0].clone(), "session", json!("s-dev")),
        with(rows[1].clone(), "session", json!("s-review")),
    ]);
    let (dev, basis) = tag(r.resolve(&call("claude-code", "s-dev", WT, t(40))));
    assert_eq!((dev.bot.as_str(), basis), ("b-dev", Basis::Session));
    let (rev, _) = tag(r.resolve(&call("claude-code", "s-review", WT, t(40))));
    assert_eq!(rev.role.as_deref(), Some("review"));
}

// Check (delivery 4): a worker restarted on its own worktree keeps its tag.
#[test]
fn a_worker_restarted_on_its_own_worktree_keeps_its_tag() {
    let first = worker("t1", 0, WT, "codex", "b-dev", "dev");
    // The restart is a new terminal; the second launch asked for another model.
    let second = with(
        worker("t2", 30, WT, "codex", "b-dev", "dev"),
        "model",
        json!("other-model"),
    );
    // No end row for the first launch: two claimants with equal tags collapse.
    let mut r = resolver(&[first.clone(), second.clone()]);
    let (got, basis) = tag(r.resolve(&call("codex", "rollout-1", WT, t(40))));
    assert_eq!((got.bot.as_str(), basis), ("b-dev", Basis::Worktree));
    assert_eq!(got.role.as_deref(), Some("dev"));
    assert_eq!(got.branch.as_deref(), Some("feat/gh-45-example"));
    // What the two launches requested differs, so the answer keeps neither.
    assert_eq!(got.requested_model, None);
    assert_eq!(got.requested_effort.as_deref(), Some("high"));
    // With the end row the restart writes, the first launch is over: still the same tag.
    let mut r = resolver(&[first, second, end("t1", 0, t(29))]);
    let (got, _) = tag(r.resolve(&call("codex", "rollout-1", WT, t(40))));
    assert_eq!(got.requested_model.as_deref(), Some("other-model"));
}

// Check (delivery 4): a seat in the project root is unlinked with no session row, and tagged with
// one.
#[test]
fn a_seat_in_the_project_root_is_unlinked_without_a_session_row_and_tagged_with_one() {
    let seats = [
        seat("t1", 0, "claude", "b-captain", "captain"),
        seat("t2", 1, "claude", "b-other", "rank-1"),
    ];
    // Its folder is the project root: that never names a seat, even the only one there.
    for rows in [&seats[..1], &seats[..]] {
        let mut r = resolver(rows);
        assert_eq!(
            r.resolve(&call("claude-code", "s-seat", PROJECT, t(30))),
            Resolution::Unlinked
        );
    }
    // The briefing hook's session row ties the session to the seat's terminal.
    let mut rows = seats.to_vec();
    rows.push(hook_session("t1", "s-seat", t(2)));
    let mut r = resolver(&rows);
    let (got, basis) = tag(r.resolve(&call("claude-code", "s-seat", PROJECT, t(30))));
    assert_eq!(basis, Basis::Session);
    assert_eq!(got.bot, "b-captain");
    assert_eq!(got.kind, Kind::Seat);
    assert_eq!(got.role.as_deref(), Some("captain"));
    assert_eq!(got.squad.as_deref(), Some("b-squad"));
    assert_eq!(got.task_key(), None, "a seat is never a task");
    // The other seat's calls stay unlinked.
    assert_eq!(
        r.resolve(&call("claude-code", "s-other", PROJECT, t(30))),
        Resolution::Unlinked
    );
}

// Check (delivery 4): a session row written before its start row still links.
#[test]
fn a_session_row_written_before_its_start_row_still_links() {
    let start = seat("t1", 0, "claude", "b-captain", "captain");
    // The hook writes its row two seconds in; the CLI's start row lands at five.
    for row in [
        hook_session("t1", "s-seat", t(0) + 2_000),
        cli_session("t1", "s-seat", "claude", 0, t(0) + 2_000),
    ] {
        // Whatever the file order.
        for rows in [[row.clone(), start.clone()], [start.clone(), row.clone()]] {
            let mut r = resolver(&rows);
            // A call between the session row and the start row, and one later.
            for at in [t(0) + 3_000, t(30)] {
                let (got, basis) = tag(r.resolve(&call("claude-code", "s-seat", PROJECT, at)));
                assert_eq!((got.bot.as_str(), basis), ("b-captain", Basis::Session));
            }
            // A session row counts from its own time: a call before it is not tied by it.
            assert_eq!(
                r.resolve(&call("claude-code", "s-seat", PROJECT, t(0) + 1_000)),
                Resolution::Unlinked
            );
        }
    }
}

// Check (delivery 4): an unlogged live terminal in the worktree makes the call ambiguous.
#[test]
fn an_unlogged_live_terminal_in_the_worktree_makes_the_call_ambiguous() {
    let rows = [worker("t1", 0, WT, "codex", "b-dev", "dev")];
    // Alone, the logged worker names the call.
    let mut r = resolver_seen(&rows, vec![live("t1", 0, "codex", WT)]);
    assert_eq!(
        tag(r.resolve(&call("codex", "rollout-1", WT, t(40)))).0.bot,
        "b-dev"
    );
    // A codex the sync sees running there, that no start row records, is a claimant from its
    // creation on.
    let hand_started = live("t7", 20, "codex", WT);
    let mut r = resolver_seen(
        &rows,
        vec![live("t1", 0, "codex", WT), hand_started.clone()],
    );
    assert_eq!(
        r.resolve(&call("codex", "rollout-1", WT, t(40))),
        Resolution::Ambiguous
    );
    assert_eq!(
        tag(r.resolve(&call("codex", "rollout-1", WT, t(10)))).0.bot,
        "b-dev"
    );
    // Another harness's terminal there is no claimant; one that finished before the call is not
    // either.
    let other = live("t8", 20, "claude-code", WT);
    let done = Terminal {
        finished_ms: Some(t(30)),
        ..hand_started
    };
    let mut r = resolver_seen(&rows, vec![other, done]);
    assert_eq!(
        tag(r.resolve(&call("codex", "rollout-1", WT, t(40)))).0.bot,
        "b-dev"
    );
}

// Fixer H1 on #835: a seat session that moved into a worker's worktree is never that worker's.
#[test]
fn a_seat_working_in_a_workers_worktree_is_never_taken_for_the_worker() {
    let rows = [
        worker("t1", 0, WT, "claude", "b-dev", "dev"),
        seat("t2", 0, "claude", "b-captain", "captain"),
    ];
    // The seat's session started in the project root and now calls from the worktree (its
    // process stays where it was started); the sync sees both terminals live, or sees nothing.
    let seen = vec![
        live("t1", 0, "claude-code", WT),
        live("t2", 0, "claude-code", PROJECT),
    ];
    for snapshot in [vec![], seen] {
        let mut r = resolver_seen(&rows, snapshot);
        let moved = Call {
            session_cwd: Some(PROJECT),
            ..call("claude-code", "s-seat-unlinked", WT, t(40))
        };
        assert_eq!(r.resolve(&moved), Resolution::Unlinked);
        // The worker's own session, started in its worktree, is still the worker's, wherever it
        // calls from later.
        let away = Call {
            session_cwd: Some(WT),
            ..call("claude-code", "s-dev", "/work/elsewhere", t(40))
        };
        assert_eq!(tag(r.resolve(&away)).0.bot, "b-dev");
    }
}

// Reviewer delta on #835 (the Fixer's L1): an agent relaunched by hand in a seat's pane, inside a
// worker's worktree, starts its session there; hc shows that logged terminal away from its
// recorded folder, so it competes and the call is ambiguous, never the worker's.
#[test]
fn a_seat_relaunched_by_hand_in_a_workers_worktree_makes_the_call_ambiguous() {
    let rows = [
        worker("t1", 0, WT, "claude", "b-dev", "dev"),
        seat("t2", 0, "claude", "b-captain", "captain"),
    ];
    let relaunched = call("claude-code", "s-relaunched", WT, t(40));
    let mut r = resolver_seen(
        &rows,
        vec![
            live("t1", 0, "claude-code", WT),
            live("t2", 0, "claude-code", WT),
        ],
    );
    assert_eq!(r.resolve(&relaunched), Resolution::Ambiguous);
    // The seat in its own folder competes nowhere else.
    let mut r = resolver_seen(
        &rows,
        vec![
            live("t1", 0, "claude-code", WT),
            live("t2", 0, "claude-code", PROJECT),
        ],
    );
    assert_eq!(tag(r.resolve(&relaunched)).0.bot, "b-dev");
}

// Reviewer Low on #835: the away check reads the harness hc shows running, never the start row's
// agent. A codex seat relaunched by hand as claude inside a worker's worktree runs claude there, so
// a claude call in that worktree is ambiguous; a codex call is not claimed by it.
#[test]
fn a_codex_seat_relaunched_as_claude_competes_by_its_live_harness() {
    let rows = [
        worker("t1", 0, WT, "claude", "b-dev", "dev"),
        worker("t3", 0, WT, "codex", "b-codex-dev", "dev"),
        seat("t2", 0, "codex", "b-captain", "captain"),
    ];
    let snapshot = vec![
        live("t1", 0, "claude-code", WT),
        live("t3", 0, "codex", WT),
        live("t2", 0, "claude-code", WT),
    ];
    let mut r = resolver_seen(&rows, snapshot);
    assert_eq!(
        r.resolve(&call("claude-code", "s-relaunched", WT, t(40))),
        Resolution::Ambiguous
    );
    // The codex worker's own calls: the seat runs claude now, so it does not compete for them.
    assert_eq!(
        tag(r.resolve(&call("codex", "rollout-wt", WT, t(40))))
            .0
            .bot,
        "b-codex-dev"
    );
}

// Reviewer delta on #835: a session whose start folder is unknown is never named by a worktree.
#[test]
fn an_unknown_start_folder_is_unlinked_never_the_worktrees_owner() {
    let mut r = resolver(&[worker("t1", 0, WT, "claude", "b-dev", "dev")]);
    let unknown = Call {
        session_cwd: None,
        ..call("claude-code", "agent-sub", WT, t(40))
    };
    assert_eq!(r.resolve(&unknown), Resolution::Unlinked);
}

// Reviewer M1 on #835: an address now held by a newer terminal, even a shell, ends the old launch.
#[test]
fn a_newer_terminal_at_an_address_ends_the_old_launch_whatever_it_runs() {
    // A seat with no end row (an hc restart reused its address); the hook's row, with no launch
    // key, names a new session on that address later.
    let rows = [
        seat("t1", 0, "claude", "b-captain", "captain"),
        hook_session("t1", "s-new", t(60)),
    ];
    let shell = Terminal {
        harness: None,
        ..live("t1", 50, "claude-code", PROJECT)
    };
    let mut r = resolver_seen(&rows, vec![shell]);
    assert_eq!(
        r.resolve(&call("claude-code", "s-new", PROJECT, t(70))),
        Resolution::Unlinked
    );
    // Before the newer terminal, the seat still held the address.
    let mut r = resolver_seen(
        &[
            seat("t1", 0, "claude", "b-captain", "captain"),
            hook_session("t1", "s-old", t(10)),
        ],
        vec![Terminal {
            harness: None,
            ..live("t1", 50, "claude-code", PROJECT)
        }],
    );
    assert_eq!(
        tag(r.resolve(&call("claude-code", "s-old", PROJECT, t(20))))
            .0
            .bot,
        "b-captain"
    );
}

// RFC 0021 (a): codex and omp seats share the project root, so they link only through a session.
#[test]
fn codex_and_omp_seats_link_only_through_a_session() {
    for agent in ["codex", "omp"] {
        let first = seat("t1", 0, agent, "b-captain", "captain");
        // A fresh seat: no session row, so its calls are unlinked (the accepted gap).
        let mut r = resolver(std::slice::from_ref(&first));
        assert_eq!(
            r.resolve(&call(agent, "rollout-1", PROJECT, t(10))),
            Resolution::Unlinked
        );
        // A sync that saw its revive.session label ties the session to it: label basis.
        let mut seen = live("t1", 0, agent, PROJECT);
        seen.labels.revive_session = Some("rollout-1".into());
        let mut r = resolver_seen(std::slice::from_ref(&first), vec![seen]);
        let (got, basis) = tag(r.resolve(&call(agent, "rollout-1", PROJECT, t(10))));
        assert_eq!((got.bot.as_str(), basis), ("b-captain", Basis::Label));
        // Herdr restarts it (a new terminal, an end row for the old one) carrying the session:
        // the new launch's session row links it from then on.
        let rows = [
            first.clone(),
            end("t1", 0, t(50)),
            seat("t5", 50, agent, "b-captain", "captain"),
            cli_session("t5", "rollout-1", agent, 50, t(50) + 3_000),
        ];
        let mut r = resolver(&rows);
        let (got, basis) = tag(r.resolve(&call(agent, "rollout-1", PROJECT, t(60))));
        assert_eq!((got.bot.as_str(), basis), ("b-captain", Basis::Session));
        // Its calls before the restart stay unlinked: no record ties them to the first launch.
        assert_eq!(
            r.resolve(&call(agent, "rollout-1", PROJECT, t(10))),
            Resolution::Unlinked
        );
        // The session row of another harness never links this one.
        assert_eq!(
            r.resolve(&call("dsh-tui", "rollout-1", PROJECT, t(60))),
            Resolution::Unlinked
        );
    }
}

// RFC 0021 (a): end evidence closes a launch, so a later worker on its worktree is named alone.
#[test]
fn end_evidence_closes_a_launch() {
    let dev = worker("t1", 0, WT, "codex", "b-dev", "dev");
    let review = worker("t2", 30, WT, "codex", "b-reviewer", "review");
    let at = call("codex", "rollout-1", WT, t(40));
    // No end evidence: the dev's launch never ends, and the worktree stays ambiguous.
    let mut r = resolver(&[dev.clone(), review.clone()]);
    assert_eq!(r.resolve(&at), Resolution::Ambiguous);
    // An end row.
    let mut r = resolver(&[dev.clone(), review.clone(), end("t1", 0, t(20))]);
    assert_eq!(tag(r.resolve(&at)).0.bot, "b-reviewer");
    // hc shows the terminal finished.
    let finished = Terminal {
        finished_ms: Some(t(20)),
        ..live("t1", 0, "codex", WT)
    };
    let mut r = resolver_seen(&[dev.clone(), review.clone()], vec![finished]);
    assert_eq!(tag(r.resolve(&at)).0.bot, "b-reviewer");
    // hc shows a newer terminal at the same address (ids are reused): the old one ended.
    let mut r = resolver_seen(
        &[dev.clone(), review.clone()],
        vec![live("t1", 25, "claude-code", "/work/elsewhere")],
    );
    assert_eq!(tag(r.resolve(&at)).0.bot, "b-reviewer");
    // An end row for another launch on that address (another created_ms) ends nothing here.
    let mut r = resolver(&[dev, review, end("t1", 5, t(20))]);
    assert_eq!(r.resolve(&at), Resolution::Ambiguous);
}

// RFC 0021 (b): the ledger and the snapshot never vote.
#[test]
fn a_label_that_disagrees_with_the_ledger_makes_the_call_ambiguous() {
    let rows = [
        with(
            worker("t1", 0, WT, "claude", "b-dev", "dev"),
            "session",
            json!("s-1"),
        ),
        worker("t2", 0, WT_B, "claude", "b-other", "dev"),
    ];
    let mut on_own = live("t1", 0, "claude-code", WT);
    on_own.labels.session = Some("s-1".into());
    let mut r = resolver_seen(&rows, vec![on_own]);
    let (got, basis) = tag(r.resolve(&call("claude-code", "s-1", WT, t(10))));
    assert_eq!((got.bot.as_str(), basis), ("b-dev", Basis::Session));
    let mut elsewhere = live("t2", 0, "claude-code", WT_B);
    elsewhere.labels.session = Some("s-1".into());
    let mut r = resolver_seen(&rows, vec![elsewhere]);
    assert_eq!(
        r.resolve(&call("claude-code", "s-1", WT, t(10))),
        Resolution::Ambiguous
    );
}

#[test]
fn a_resumed_session_moves_to_its_new_launch() {
    let mut r = resolver(&[
        with(
            seat("t1", 0, "claude", "b-captain", "captain"),
            "session",
            json!("s-1"),
        ),
        end("t1", 0, t(29)),
        // Restarted as another bot's seat, resuming the session.
        with(
            seat("t2", 30, "claude", "b-second", "rank-1"),
            "session",
            json!("s-1"),
        ),
    ]);
    let (before, _) = tag(r.resolve(&call("claude-code", "s-1", PROJECT, t(10))));
    let (after, _) = tag(r.resolve(&call("claude-code", "s-1", PROJECT, t(40))));
    assert_eq!(
        (before.bot.as_str(), after.bot.as_str()),
        ("b-captain", "b-second")
    );
    // A /resume in another pane, while the first still runs, moves it from its row's time.
    let mut r = resolver(&[
        with(
            seat("t1", 0, "claude", "b-captain", "captain"),
            "session",
            json!("s-1"),
        ),
        seat("t2", 5, "claude", "b-second", "rank-1"),
        hook_session("t2", "s-1", t(30)),
    ]);
    assert_eq!(
        tag(r.resolve(&call("claude-code", "s-1", PROJECT, t(10))))
            .0
            .bot,
        "b-captain"
    );
    assert_eq!(
        tag(r.resolve(&call("claude-code", "s-1", PROJECT, t(40))))
            .0
            .bot,
        "b-second"
    );
}

#[test]
fn a_session_resumed_into_a_seat_never_claims_its_earlier_calls() {
    // The session ran somewhere no row records until minute 30, when it was resumed in the seat.
    let mut r = resolver(&[
        seat("t1", 0, "claude", "b-captain", "captain"),
        hook_session("t1", "s-old", t(30)),
    ]);
    assert_eq!(
        r.resolve(&call("claude-code", "s-old", PROJECT, t(10))),
        Resolution::Unlinked
    );
    assert_eq!(
        tag(r.resolve(&call("claude-code", "s-old", PROJECT, t(40))))
            .0
            .bot,
        "b-captain"
    );
}

#[test]
fn the_attach_ledger_names_a_seats_bot_and_ends_it() {
    let rows = [with(
        seat("t1", 0, "claude", "b-first", "captain"),
        "session",
        json!("s-1"),
    )];
    let attach = |event: &str, bot: &str, at: i64, machine: Value| {
        json!({"v": 1, "event": event, "bot": bot, "project": PROJECT, "terminal": "t1",
               "core": CORE, "created_ms": t(0), "machine": machine, "at": iso(at),
               "by": "attach"})
    };
    let mut r = resolver(&rows);
    r.add_attach(&lines(&[
        attach("attach", "b-first", t(0) + 5_000, Value::Null),
        // Another bot attached to the same terminal from minute 20.
        attach("attach", "b-second", t(20), Value::Null),
        // A linked machine's row, never this machine's pane.
        attach("attach", "b-third", t(25), json!("linked")),
        attach("detach", "b-second", t(40), Value::Null),
    ]));
    let at = |min| call("claude-code", "s-1", PROJECT, t(min));
    assert_eq!(tag(r.resolve(&at(10))).0.bot, "b-first");
    assert_eq!(tag(r.resolve(&at(30))).0.bot, "b-second");
    // The detach ends the launch for attribution.
    assert_eq!(r.resolve(&at(45)), Resolution::Unlinked);
}

#[test]
fn rows_of_another_machine_are_skipped() {
    let mut r = resolver(&[
        with(
            worker("t1", 0, WT, "codex", "b-dev", "dev"),
            "core",
            json!("core-synthetic-b"),
        ),
        worker("t2", 0, WT, "codex", "b-local", "dev"),
    ]);
    assert_eq!(
        tag(r.resolve(&call("codex", "rollout-1", WT, t(10)))).0.bot,
        "b-local"
    );
    // With no core known, every row counts.
    let mut r = Resolver::new(None, vec![]);
    r.add_workers(&lines(&[
        with(
            worker("t1", 0, WT, "codex", "b-dev", "dev"),
            "core",
            json!("core-synthetic-b"),
        ),
        worker("t2", 0, WT, "codex", "b-local", "dev"),
    ]));
    assert_eq!(
        r.resolve(&call("codex", "rollout-1", WT, t(10))),
        Resolution::Ambiguous
    );
}

#[test]
fn a_copied_call_is_never_attributed() {
    let mut r = resolver(&[worker("t1", 0, WT, "dsh-tui", "b-dev", "dev")]);
    let mut c = call("dsh-tui", "sess-fork", WT, t(10));
    assert!(matches!(r.resolve(&c), Resolution::Tag(..)));
    c.copied = true;
    assert_eq!(r.resolve(&c), Resolution::Unlinked);
}

#[test]
fn a_sub_agent_resolves_through_its_parent_session() {
    let mut r = resolver(&[with(
        seat("t1", 0, "claude", "b-captain", "captain"),
        "session",
        json!("s-1"),
    )]);
    let c = Call {
        session: Some("agent-sub"),
        parent_session: Some("s-1"),
        ..call("claude-code", "x", PROJECT, t(10))
    };
    assert_eq!(tag(r.resolve(&c)).0.bot, "b-captain");
}

#[test]
fn ledgers_are_read_from_the_app_home_and_each_project_above_a_call() {
    let dir = tempfile::tempdir().unwrap();
    let global = dir.path().join("app-home");
    let project = dir.path().join("work/project");
    let wt = project.join(".worktrees/gh-45");
    let ledger = project.join(".herdr/app-home/automagik-herdr/workers.jsonl");
    std::fs::create_dir_all(ledger.parent().unwrap()).unwrap();
    std::fs::create_dir_all(global.join("automagik-herdr")).unwrap();
    let wt_s = wt.to_string_lossy().into_owned();
    std::fs::write(
        &ledger,
        lines(&[worker("t1", 0, &wt_s, "codex", "b-dev", "dev")]),
    )
    .unwrap();
    let mode = |p: &Path, m: u32| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(p, std::fs::Permissions::from_mode(m)).unwrap();
        }
    };
    mode(&ledger, 0o600);
    let at = call("codex", "rollout-1", &wt_s, t(10));
    // Not looked for: nothing names the call.
    let mut r = Resolver::new(Some(CORE.into()), vec![]).walk(false);
    r.load_app_home(&global);
    assert_eq!(r.resolve(&at), Resolution::Unlinked);
    // Found above the call's cwd.
    let mut r = Resolver::new(Some(CORE.into()), vec![]).walk(true);
    r.load_app_home(&global);
    assert_eq!(tag(r.resolve(&at)).0.bot, "b-dev");
    assert!(r.refused().is_empty());
    // A ledger anyone but its owner could write is refused, and said so.
    #[cfg(unix)]
    {
        mode(&ledger, 0o664);
        let mut r = Resolver::new(Some(CORE.into()), vec![]).walk(true);
        assert_eq!(r.resolve(&at), Resolution::Unlinked);
        assert_eq!(r.refused(), std::slice::from_ref(&ledger));
    }
    // Group- or world-writable alone is enough to refuse; readable by others is not.
    #[cfg(unix)]
    for (m, refused) in [(0o602, true), (0o620, true), (0o644, false), (0o600, false)] {
        mode(&ledger, m);
        let mut r = Resolver::new(Some(CORE.into()), vec![]).walk(true);
        let got = r.resolve(&at);
        assert_eq!(r.refused().len(), usize::from(refused), "mode {m:o}");
        assert_eq!(got == Resolution::Unlinked, refused, "mode {m:o}");
    }
    // The global ledger and $HERDR_WORKERS_LEDGER both count; a row in both counts once.
    mode(&ledger, 0o600);
    let named = dir.path().join("named.jsonl");
    std::fs::copy(&ledger, &named).unwrap();
    mode(&named, 0o600);
    std::fs::copy(&ledger, global.join("automagik-herdr/workers.jsonl")).unwrap();
    mode(&global.join("automagik-herdr/workers.jsonl"), 0o600);
    let mut r = Resolver::new(Some(CORE.into()), vec![]).walk(true);
    r.load_app_home(&global);
    r.load_workers(&named);
    assert_eq!(tag(r.resolve(&at)).0.bot, "b-dev");
}

#[test]
fn missing_or_unreadable_ledgers_give_no_tags() {
    let dir = tempfile::tempdir().unwrap();
    let mut r = Resolver::new(Some(CORE.into()), vec![]);
    r.load_workers(&dir.path().join("absent.jsonl"));
    r.load_workers(dir.path());
    r.load_app_home(&dir.path().join("absent"));
    assert_eq!(
        r.resolve(&call("claude-code", "s-1", WT, t(10))),
        Resolution::Unlinked
    );
}

#[test]
fn ledger_and_app_home_paths_follow_herdr() {
    let home = Some(PathBuf::from("/work/user"));
    let default = Some(PathBuf::from(
        "/work/user/.config/herdr-app/automagik-herdr/workers.jsonl",
    ));
    assert_eq!(
        ledger_path(Some("/work/ledger.jsonl".into()), None, home.clone()),
        Some(PathBuf::from("/work/ledger.jsonl"))
    );
    assert_eq!(ledger_path(Some("".into()), None, home.clone()), default);
    assert_eq!(ledger_path(None, Some("".into()), home.clone()), default);
    assert_eq!(ledger_path(None, None, None), None);
    assert_eq!(
        app_home(Some("/work/app-home".into()), None),
        Some(PathBuf::from("/work/app-home"))
    );
    assert_eq!(
        app_home(None, home),
        Some(PathBuf::from("/work/user/.config/herdr-app"))
    );
}

#[test]
fn malformed_lines_are_skipped() {
    let mut text = Vec::new();
    text.extend_from_slice(b"{not json\n[1,2,3]\n\"start\"\n\xff\xfe\n\n");
    text.extend_from_slice(b"{\"event\":\"start\",\"kind\":\"worker\",\"bot\":\"b-x\"}\n");
    text.extend_from_slice(&lines(&[worker("t1", 0, WT, "codex", "b-dev", "dev")]));
    text.extend_from_slice(b"\n{\"event\":\"session\",\"terminal\":\"t1\"}\n");
    text.extend_from_slice(b"{\"event\":\"end\",\"terminal\":\"t1\"}\n");
    text.extend_from_slice(b"{\"event\":\"start\",\"kind\":\"worker\",\"terminal\":"); // torn tail
    let mut r = Resolver::new(Some(CORE.into()), vec![]);
    r.add_workers(&text);
    assert_eq!(
        tag(r.resolve(&call("codex", "rollout-1", WT, t(10)))).0.bot,
        "b-dev"
    );
}

#[test]
fn an_incomplete_or_untimed_start_row_is_uncertainty_never_a_stale_tag() {
    let dev = worker("t1", 0, WT, "codex", "b-dev", "dev");
    // A later start on the same worktree with no bot: a claimant whose tag is unknown.
    let mut no_bot = worker("t2", 30, WT, "codex", "x", "dev");
    no_bot.as_object_mut().unwrap().remove("botId");
    let mut r = resolver(&[dev.clone(), no_bot]);
    assert_eq!(
        r.resolve(&call("codex", "rollout-1", WT, t(40))),
        Resolution::Ambiguous
    );
    // A start row with no time at all, on the dev's terminal: it may have replaced the dev at any
    // moment.
    let mut untimed = worker("t1", 0, WT_B, "codex", "b-other", "dev");
    for k in ["at", "created_ms", "core"] {
        untimed.as_object_mut().unwrap().remove(k);
    }
    let mut r = resolver(&[dev, untimed]);
    assert_eq!(
        r.resolve(&call("codex", "rollout-1", WT, t(10))),
        Resolution::Ambiguous
    );
}

#[test]
fn rows_from_before_rfc_0021_still_resolve() {
    // No core, created_ms, squad or session; the branch in `task`; a session row from the hook.
    let mut old = worker("t1", 0, WT, "claude", "b-dev", "dev");
    for k in ["core", "created_ms", "squad", "session", "branch"] {
        old.as_object_mut().unwrap().remove(k);
    }
    old["task"] = json!("feat/gh-45-example");
    old["at"] = json!(iso(t(0)));
    let mut r = resolver(&[old, hook_session("t1", "s-1", t(1))]);
    let (got, basis) = tag(r.resolve(&call("claude-code", "s-1", WT, t(10))));
    assert_eq!(basis, Basis::Session);
    assert_eq!(got.squad, None);
    assert_eq!(got.task, None);
    assert_eq!(got.branch.as_deref(), Some("feat/gh-45-example"));
}

#[test]
fn the_same_task_id_in_two_projects_never_cross_matches() {
    let mut r = resolver(&[
        worker("t1", 0, WT, "codex", "b-one", "dev"),
        with(
            worker("t2", 0, WT_B, "codex", "b-two", "dev"),
            "project",
            json!("/work/other-project"),
        ),
    ]);
    let (one, _) = tag(r.resolve(&call("codex", "rollout-1", WT, t(10))));
    let (two, _) = tag(r.resolve(&call("codex", "rollout-2", WT_B, t(10))));
    assert_ne!(one.task_key(), two.task_key());
    assert_eq!(one.task_key().unwrap().task, "gh-45");
}

#[test]
fn swap_and_override_rows_are_flagged() {
    let mut r = resolver(&[with(
        worker("t1", 0, WT, "codex", "b-dev", "dev"),
        "swap",
        json!(true),
    )]);
    assert!(
        tag(r.resolve(&call("codex", "rollout-1", WT, t(10))))
            .0
            .skip_for_model_eval()
    );
}

#[test]
fn counts_say_how_many_and_never_which() {
    let mut c = Counts::default();
    let mut r = resolver(&[worker("t1", 0, WT, "codex", "b-dev", "dev")]);
    c.add(&r.resolve(&call("codex", "rollout-1", WT, t(10))));
    c.add(&r.resolve(&call("codex", "rollout-1", PROJECT, t(10))));
    c.add(&Resolution::Ambiguous);
    assert_eq!((c.tagged(), c.ambiguous, c.unlinked), (1, 1, 1));
    assert_eq!(c.by_basis.get("worktree"), Some(&1));
    assert!(!format!("{c:?}").contains("b-dev"));
}

// The Reviewer's Low (a) on PR 875, the parse side alone: a bot, role or squad within both caps
// (64 characters, 96 bytes as JSON) is read as written; past either, a bot leaves the row with no
// tag (its calls are then ambiguous) and a role or squad is unrecorded. Nothing is cut short.
#[test]
fn a_tag_past_either_cap_is_never_read_or_cut_short() {
    let row = |bot: &str, role: &str, squad: &str| -> Option<Tag> {
        let v = with(
            with(
                worker("t1", 0, WT, "claude", bot, role),
                "squad",
                json!(squad),
            ),
            "botId",
            json!(bot),
        );
        parse_tag(v.as_object().unwrap(), Kind::Worker)
    };
    let at_cap = "b".repeat(TAG_CHARS);
    let tag = row(&at_cap, "dev", "b-squad").unwrap();
    assert_eq!(
        (tag.bot.as_str(), tag.role.as_deref(), tag.squad.as_deref()),
        (at_cap.as_str(), Some("dev"), Some("b-squad"))
    );
    assert!(tag.unrecorded.is_empty());
    // Past the characters, or past the bytes as JSON (48 quotes take 96; a control character 6).
    for long in [
        "b".repeat(TAG_CHARS + 1),
        "\"".repeat(49),
        "\u{1}".repeat(17),
    ] {
        assert!(row(&long, "dev", "b-squad").is_none(), "bot {long:?}");
        let tag = row("b-dev", &long, &long).unwrap();
        assert_eq!((tag.role, tag.squad), (None, None), "{long:?}");
        assert_eq!(tag.unrecorded, ["role", "squad"], "{long:?}");
    }
    assert!(row(&"\"".repeat(48), "dev", "b-squad").is_some());
}

// ---- RFC 0026 (c): the label claims -------------------------------------------------------

/// A launch with no start row, as an earlier sync recorded it, for the next sync's read-back.
fn history_of(records: &[LaunchRecord], seen_last: Option<i64>) -> Vec<History> {
    records
        .iter()
        .map(|l| History {
            lkey: l.lkey.clone(),
            core: l.core.clone(),
            terminal: l.terminal.clone().unwrap_or_default(),
            created_ms: l.created_ms.unwrap_or_default(),
            valid_to: l.valid_to,
            end_basis: l.end_basis.clone(),
            source: l.source.clone(),
            worktree: l.worktree.clone(),
            seen_last,
            live_cwd: l.worktree.clone(),
            live_agent: l.agent.clone(),
            kind: l.kind.clone(),
            bot: l.bot.clone(),
            role: l.role.clone(),
            bound: l.bound.clone(),
        })
        .collect()
}

fn launch<'a>(records: &'a [LaunchRecord], terminal: &str) -> &'a LaunchRecord {
    records
        .iter()
        .find(|l| l.terminal.as_deref() == Some(terminal))
        .expect("the launch")
}

fn labelled(terminal: &str, created_min: i64, harness: &'static str, cwd: &str) -> Terminal {
    live(terminal, created_min, harness, cwd)
}

/// Check (T3): a call in an unlogged, labelled worker's worktree is attributed at `label` basis;
/// a call before the first sighting is unlinked.
#[test]
fn a_labelled_unlogged_worker_is_attributed_at_label_basis() {
    let mut t7 = labelled("t7", 20, "codex", WT);
    t7.labels.worker_of = Some("b-hand".into());
    t7.labels.worker_role = Some("dev".into());
    let mut r = resolver_seen(&[], vec![t7]).at(t(30));
    let (got, basis) = tag(r.resolve(&call("codex", "rollout-1", WT, t(40))));
    assert_eq!((got.bot.as_str(), basis), ("b-hand", Basis::Label));
    assert_eq!(got.kind, Kind::Worker);
    assert_eq!(got.role.as_deref(), Some("dev"));
    // The labels fill bot, role and kind only: never the squad, task, project or branch.
    assert_eq!(got.squad, None);
    assert_eq!(got.task, None);
    assert_eq!(got.project, None);
    assert_eq!(got.branch, None);
    assert_eq!(got.unrecorded, ["squad"]);
    // The span starts at the first sync that saw the label: usage before it is never claimed.
    assert_eq!(
        r.resolve(&call("codex", "rollout-1", WT, t(25))),
        Resolution::Unlinked
    );
    // A `worker.role` outside the worker roles names no role, and that is unrecorded, not none.
    let mut t8 = labelled("t8", 20, "codex", WT_B);
    t8.labels.worker_of = Some("b-hand2".into());
    t8.labels.worker_role = Some("captain".into());
    let mut r = resolver_seen(&[], vec![t8]).at(t(30));
    let (got, _) = tag(r.resolve(&call("codex", "rollout-2", WT_B, t(40))));
    assert_eq!(got.role, None);
    assert_eq!(got.unrecorded, ["role", "squad"]);
    // A label that cannot be written in the launch's timeline names no bot, never a mangled one.
    let mut t9 = labelled("t9", 20, "codex", WT_B);
    t9.labels.worker_of = Some("b-one;1-:b-two".into());
    let mut r = resolver_seen(&[], vec![t9]).at(t(30));
    assert_eq!(
        r.resolve(&call("codex", "rollout-3", WT_B, t(40))),
        Resolution::Unlinked
    );
}

/// Check (T3): two differently labelled workers on one worktree are ambiguous, never a guess;
/// equal tags collapse (a restarted worker on its own worktree is still that worker).
#[test]
fn two_labelled_workers_on_one_worktree_are_ambiguous_and_equal_tags_collapse() {
    let mut dev = labelled("t7", 20, "codex", WT);
    dev.labels.worker_of = Some("b-dev".into());
    dev.labels.worker_role = Some("dev".into());
    let mut rev = labelled("t8", 25, "codex", WT);
    rev.labels.worker_of = Some("b-reviewer".into());
    rev.labels.worker_role = Some("review".into());
    let mut r = resolver_seen(&[], vec![dev.clone(), rev]).at(t(30));
    assert_eq!(
        r.resolve(&call("codex", "rollout-1", WT, t(40))),
        Resolution::Ambiguous
    );
    // The same bot and role on a second terminal there: the tags are equal and collapse.
    let mut again = labelled("t9", 35, "codex", WT);
    again.labels.worker_of = Some("b-dev".into());
    again.labels.worker_role = Some("dev".into());
    let mut r = resolver_seen(&[], vec![dev, again]).at(t(30));
    let (got, basis) = tag(r.resolve(&call("codex", "rollout-2", WT, t(40))));
    assert_eq!((got.bot.as_str(), basis), ("b-dev", Basis::Label));
}

/// Check (T3): a worker's label that changes makes the launch's claim empty for its whole span,
/// and its calls unlinked across a recompute, never retagged to the last label seen. The timeline
/// in `bound` is what keeps the fail-closed state.
#[test]
fn a_worker_label_that_changes_claims_nothing_across_a_recompute() {
    let mut first = labelled("t7", 20, "codex", WT);
    first.labels.worker_of = Some("b-one".into());
    first.labels.worker_role = Some("dev".into());
    let mut r = resolver_seen(&[], vec![first]).at(t(30));
    assert_eq!(
        tag(r.resolve(&call("codex", "rollout-1", WT, t(40)))).0.bot,
        "b-one"
    );
    let (before, _) = r.records();
    let row = launch(&before, "t7");
    assert_eq!(row.source, "snapshot");
    assert_eq!(row.bot.as_deref(), Some("b-one"));
    assert_eq!(row.kind.as_deref(), Some("worker"));
    assert_eq!(
        row.bound.as_deref(),
        Some(format!("~{}-:b-one", t(30)).as_str())
    );
    // The next sync sees a different `worker.of` on the same terminal.
    let mut second = labelled("t7", 20, "codex", WT);
    second.labels.worker_of = Some("b-two".into());
    second.labels.worker_role = Some("dev".into());
    let mut r2 = Resolver::new(Some(CORE.into()), vec![second]).at(t(50));
    r2.add_history(&history_of(&before, Some(t(30))), &[], &HashMap::new());
    for at in [t(40), t(55)] {
        assert_eq!(
            r2.resolve(&call("codex", "rollout-1", WT, at)),
            Resolution::Unlinked,
            "minute {}",
            at
        );
    }
    let (after, _) = r2.records();
    let row = launch(&after, "t7");
    // No tag is written back; the timeline holds both bots, and a recompute derives the same.
    assert_eq!(row.bot, None);
    assert_eq!(row.kind.as_deref(), Some("worker"));
    let bound = row.bound.as_deref().unwrap();
    assert!(
        bound.contains("b-one") && bound.contains("b-two"),
        "{bound}"
    );
    let mut r3 = Resolver::new(Some(CORE.into()), vec![]).at(t(60));
    r3.add_history(&history_of(&after, Some(t(50))), &[], &HashMap::new());
    assert_eq!(
        r3.resolve(&call("codex", "rollout-1", WT, t(55))),
        Resolution::Unlinked
    );
}

/// Check (T9): a snapshot seat in the project root with `bot`/`role` and a session label is
/// attributed at `label` basis; with no session record it is unlinked, never named by its cwd.
#[test]
fn a_labelled_seat_is_attributed_only_through_a_session_record() {
    let mut seat = labelled("t2", 0, "claude-code", PROJECT);
    seat.labels.bot = Some("b-captain".into());
    seat.labels.role = Some("captain".into());
    seat.labels.session = Some("s-seat".into());
    let mut r = resolver_seen(&[], vec![seat.clone()]).at(t(10));
    let (got, basis) = tag(r.resolve(&call("claude-code", "s-seat", PROJECT, t(20))));
    assert_eq!((got.bot.as_str(), basis), ("b-captain", Basis::Label));
    assert_eq!(got.kind, Kind::Seat);
    assert_eq!(got.role.as_deref(), Some("captain"));
    assert_eq!(got.unrecorded, ["squad"]);
    // A session row ties the call instead: the tag the label supplied still reports `label`.
    let mut row = seat;
    row.labels.session = None;
    let mut r = resolver_seen(&[hook_session("t2", "s-row", t(5))], vec![row]).at(t(10));
    let (got, basis) = tag(r.resolve(&call("claude-code", "s-row", PROJECT, t(20))));
    assert_eq!((got.bot.as_str(), basis), ("b-captain", Basis::Label));
    // The same labels with no session record: the seat's project-root folder names nothing.
    let mut plain = labelled("t3", 0, "claude-code", PROJECT);
    plain.labels.bot = Some("b-captain".into());
    plain.labels.role = Some("captain".into());
    let mut r = resolver_seen(&[], vec![plain]).at(t(10));
    assert_eq!(
        r.resolve(&call("claude-code", "s-other", PROJECT, t(20))),
        Resolution::Unlinked
    );
}

/// Check (T9): a seat's changed label splits at the interval it was seen; the sync that saw the
/// change moves the later calls, and the `bound` timeline keeps the split.
#[test]
fn a_seats_changed_label_splits_at_the_interval_it_was_seen() {
    let seat = |bot: &str| {
        let mut t = labelled("t2", 0, "claude-code", PROJECT);
        t.labels.bot = Some(bot.into());
        t.labels.role = Some("captain".into());
        t.labels.session = Some("s-seat".into());
        t
    };
    let mut r = resolver_seen(&[], vec![seat("b-first")]).at(t(10));
    let (first, _) = r.records();
    let mut r2 = Resolver::new(Some(CORE.into()), vec![seat("b-second")]).at(t(30));
    r2.add_history(&history_of(&first, Some(t(10))), &[], &HashMap::new());
    let (early, basis) = tag(r2.resolve(&call("claude-code", "s-seat", PROJECT, t(15))));
    assert_eq!((early.bot.as_str(), basis), ("b-first", Basis::Label));
    let (late, basis) = tag(r2.resolve(&call("claude-code", "s-seat", PROJECT, t(35))));
    assert_eq!((late.bot.as_str(), basis), ("b-second", Basis::Label));
    let (after, _) = r2.records();
    assert_eq!(
        launch(&after, "t2").bound.as_deref(),
        Some(format!("~{}-{}:b-first;~{}-:b-second", t(10), t(30), t(30)).as_str())
    );
}

/// Check (T9): a timeline past its cap leaves the call Unknown, never the last bot in it.
#[test]
fn a_timeline_past_its_cap_is_unknown() {
    let mut seat_seen = labelled("t2", 0, "claude-code", PROJECT);
    seat_seen.labels.bot = Some("b-label".into());
    let mut rows = Vec::new();
    for k in 0..=BOUND_INTERVALS {
        rows.push(
            json!({"v": 1, "event": "attach", "bot": format!("b-seat{k:04}"),
               "project": PROJECT, "terminal": "t2", "core": CORE, "created_ms": t(0),
               "machine": Value::Null, "at": iso(t(k as i64 + 1)), "by": "attach"}),
        );
    }
    let mut r = resolver_seen(&[hook_session("t2", "s-seat", t(5))], vec![seat_seen]).at(t(30));
    r.add_attach(&lines(&rows));
    assert_eq!(
        r.resolve(&call("claude-code", "s-seat", PROJECT, t(40))),
        Resolution::Ambiguous
    );
    let (launches, _) = r.records();
    let bound = launch(&launches, "t2").bound.as_deref().unwrap();
    assert!(bound.split(';').count() > BOUND_INTERVALS, "{bound}");
    // A logged seat's binding timeline is capped too: past it its calls are Unknown, never the
    // last binding.
    let mut r = resolver(&[
        seat("t3", 0, "claude", "b-captain", "captain"),
        hook_session("t3", "s-seat", t(5)),
    ]);
    let mut rows = Vec::new();
    for k in 0..=BOUND_INTERVALS {
        rows.push(
            json!({"v": 1, "event": "attach", "bot": format!("b-seat{k:04}"),
               "project": PROJECT, "terminal": "t3", "core": CORE, "created_ms": t(0),
               "machine": Value::Null, "at": iso(t(k as i64 + 1)), "by": "attach"}),
        );
    }
    r.add_attach(&lines(&rows));
    assert_eq!(
        r.resolve(&call("claude-code", "s-seat", PROJECT, t(40))),
        Resolution::Ambiguous
    );
}

/// Check (T9): a start row or an attach binding wins; the label never overwrites what the ledger
/// recorded.
#[test]
fn a_start_row_or_attach_binding_wins_over_the_labels() {
    let mut t1 = labelled("t1", 0, "codex", WT);
    t1.labels.worker_of = Some("b-label".into());
    t1.labels.worker_role = Some("dev".into());
    let mut r =
        resolver_seen(&[worker("t1", 0, WT, "codex", "b-ledger", "dev")], vec![t1]).at(t(10));
    let (got, basis) = tag(r.resolve(&call("codex", "rollout-1", WT, t(20))));
    assert_eq!((got.bot.as_str(), basis), ("b-ledger", Basis::Worktree));
    // A seat bound by the attach ledger takes the binding's bot, not its label's.
    let mut t2 = labelled("t2", 0, "claude-code", PROJECT);
    t2.labels.bot = Some("b-label".into());
    t2.labels.role = Some("captain".into());
    let mut r = resolver_seen(&[hook_session("t2", "s-seat", t(5))], vec![t2]).at(t(10));
    r.add_attach(&lines(&[
        json!({"v": 1, "event": "attach", "bot": "b-bound",
           "project": PROJECT, "terminal": "t2", "core": CORE, "created_ms": t(0),
           "machine": Value::Null, "at": iso(t(2)), "by": "attach"}),
    ]));
    let (got, basis) = tag(r.resolve(&call("claude-code", "s-seat", PROJECT, t(20))));
    assert_eq!((got.bot.as_str(), basis), ("b-bound", Basis::Session));
    assert_eq!(got.kind, Kind::Seat);
}

/// Check (T9): a Claude seat on a linked machine, with the pack's chosen id and its labels, is
/// attributed on its own machine and stays `other_machine` on this one.
#[test]
fn a_linked_machines_seat_is_attributed_on_its_own_machine() {
    let seat = |terminal: &str| {
        let mut t = labelled(terminal, 0, "claude-code", PROJECT);
        t.labels.bot = Some("b-remote".into());
        t.labels.role = Some("captain".into());
        t.labels.session = Some("s-seat-remote".into());
        t
    };
    // As this machine sees the pane: its address carries the machine's name, so it is foreign.
    let mut here = Resolver::new(Some(CORE.into()), vec![seat("peer/t9")]).at(t(10));
    let call_ = call("claude-code", "s-seat-remote", PROJECT, t(20));
    assert_eq!(here.resolve(&call_), Resolution::Unlinked);
    assert!(here.elsewhere(&call_));
    // On its own machine (its core, the bare address) the same labels name the call.
    let mut there = Resolver::new(Some("core-synthetic-b".into()), vec![seat("t9")]).at(t(10));
    let (got, basis) = tag(there.resolve(&call_));
    assert_eq!((got.bot.as_str(), basis), ("b-remote", Basis::Label));
}

/// The merged `bound` layout is stable across syncs: an unchanged label keeps its first sighting,
/// and a change is written once and then re-read as it was.
#[test]
fn the_merged_bound_layout_is_stable_across_syncs() {
    let seat = |bot: &str| {
        let mut t = labelled("t2", 0, "claude-code", PROJECT);
        t.labels.bot = Some(bot.into());
        t.labels.session = Some("s-seat".into());
        t
    };
    let mut r = resolver_seen(&[], vec![seat("b-first")]).at(t(10));
    let (a, _) = r.records();
    let mut r = Resolver::new(Some(CORE.into()), vec![seat("b-first")]).at(t(30));
    r.add_history(&history_of(&a, Some(t(10))), &[], &HashMap::new());
    let (b, _) = r.records();
    assert_eq!(launch(&a, "t2").bound, launch(&b, "t2").bound);
    let mut r = Resolver::new(Some(CORE.into()), vec![seat("b-second")]).at(t(50));
    r.add_history(&history_of(&b, Some(t(30))), &[], &HashMap::new());
    let (c, _) = r.records();
    let mut r = Resolver::new(Some(CORE.into()), vec![seat("b-second")]).at(t(70));
    r.add_history(&history_of(&c, Some(t(50))), &[], &HashMap::new());
    let (d, _) = r.records();
    assert_eq!(launch(&c, "t2").bound, launch(&d, "t2").bound);
    assert_eq!(
        launch(&d, "t2").bound.as_deref(),
        Some(format!("~{}-{}:b-first;~{}-:b-second", t(10), t(50), t(50)).as_str())
    );
}
