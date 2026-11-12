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

/// The tests' task worktrees: a folder under a project's `.worktrees`, with no disk behind it.
fn worktrees(cwd: &str) -> bool {
    cwd.contains("/.worktrees/")
}

/// A resolver on this machine's core with hc's snapshot as given.
fn seen(snapshot: Vec<Terminal>) -> Resolver {
    Resolver::new(Some(CORE.into()), snapshot).probe(worktrees)
}

fn resolver_seen(rows: &[Value], snapshot: Vec<Terminal>) -> Resolver {
    let mut r = seen(snapshot);
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
        Some(format!("~@{}-:b-one", t(30)).as_str())
    );
    // The next sync sees a different `worker.of` on the same terminal.
    let mut second = labelled("t7", 20, "codex", WT);
    second.labels.worker_of = Some("b-two".into());
    second.labels.worker_role = Some("dev".into());
    let mut r2 = seen(vec![second]).at(t(50));
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
    let mut r3 = seen(vec![]).at(t(60));
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
    let mut r2 = seen(vec![seat("b-second")]).at(t(30));
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
    let mut r = seen(vec![seat("b-first")]).at(t(30));
    r.add_history(&history_of(&a, Some(t(10))), &[], &HashMap::new());
    let (b, _) = r.records();
    assert_eq!(launch(&a, "t2").bound, launch(&b, "t2").bound);
    let mut r = seen(vec![seat("b-second")]).at(t(50));
    r.add_history(&history_of(&b, Some(t(30))), &[], &HashMap::new());
    let (c, _) = r.records();
    let mut r = seen(vec![seat("b-second")]).at(t(70));
    r.add_history(&history_of(&c, Some(t(50))), &[], &HashMap::new());
    let (d, _) = r.records();
    assert_eq!(launch(&c, "t2").bound, launch(&d, "t2").bound);
    assert_eq!(
        launch(&d, "t2").bound.as_deref(),
        Some(format!("~{}-{}:b-first;~{}-:b-second", t(10), t(50), t(50)).as_str())
    );
}

// ---- Fixer on #949: what a label may never claim -------------------------------------------

fn worker_label(terminal: &str, created_min: i64, cwd: &str, bot: &str) -> Terminal {
    let mut t = labelled(terminal, created_min, "claude-code", cwd);
    t.labels.worker_of = Some(bot.into());
    t.labels.worker_role = Some("dev".into());
    t
}

fn attach(terminal: &str, bot: &str, at: i64) -> Value {
    json!({"v": 1, "event": "attach", "bot": bot, "project": PROJECT, "terminal": terminal,
           "core": CORE, "created_ms": t(0), "machine": Value::Null, "at": iso(at),
           "by": "attach"})
}

/// C1: a terminal in the project root that carries `worker.of` names no call by that folder. An
/// unrelated session there stays unlinked, as it was without the label; with a live logged seat
/// in the root the seat's answer stands, never ambiguous. Its own session still names it.
#[test]
fn a_label_only_worker_in_the_project_root_claims_nothing_by_folder() {
    let mut claimer = worker_label("t7", 20, PROJECT, "b-claimer");
    claimer.labels.session = Some("s-own".into());
    let other = call("claude-code", "s-unrelated", PROJECT, t(40));
    let mut r = resolver_seen(&[], vec![claimer.clone()]).at(t(30));
    assert_eq!(r.resolve(&other), Resolution::Unlinked);
    // The control: the same terminal with no label leaves the same answer.
    let mut r = resolver_seen(&[], vec![labelled("t7", 20, "claude-code", PROJECT)]).at(t(30));
    assert_eq!(r.resolve(&other), Resolution::Unlinked);
    // Its own session, which a session label ties to the launch, is the label's to name.
    let mut r = resolver_seen(&[], vec![claimer.clone()]).at(t(30));
    let (got, basis) = tag(r.resolve(&call("claude-code", "s-own", PROJECT, t(40))));
    assert_eq!((got.bot.as_str(), basis), ("b-claimer", Basis::Label));
    // A live logged seat in the root: its own session is its own, and the unrelated session is
    // what it was beside the seat alone (unlinked), not ambiguous.
    let rows = [
        seat("t1", 0, "claude", "b-captain", "captain"),
        hook_session("t1", "s-seat", t(5)),
    ];
    let live_seat = labelled("t1", 0, "claude-code", PROJECT);
    let mut alone = resolver_seen(&rows, vec![live_seat.clone()]).at(t(30));
    let mut beside = resolver_seen(&rows, vec![live_seat, claimer]).at(t(30));
    assert_eq!(alone.resolve(&other), Resolution::Unlinked);
    assert_eq!(beside.resolve(&other), Resolution::Unlinked);
    let own = call("claude-code", "s-seat", PROJECT, t(40));
    assert_eq!(tag(beside.resolve(&own)), tag(alone.resolve(&own)));
    assert_eq!(tag(beside.resolve(&own)).0.bot, "b-captain");
    // Nothing in the row says the folder is the label's: the interval carries no worktree mark.
    let (rows, _) = beside.records();
    assert_eq!(
        launch(&rows, "t7").bound.as_deref(),
        Some(format!("~{}-:b-claimer", t(30)).as_str())
    );
}

/// C1: a folder that is no task worktree is never the label's, and neither is a task worktree a
/// seat sits in (logged, or bound by the attach ledger).
#[test]
fn a_label_only_worker_claims_no_folder_that_is_not_its_task_worktree() {
    const PLAIN: &str = "/work/scratch/notes";
    let mut r = resolver_seen(&[], vec![worker_label("t7", 20, PLAIN, "b-claimer")]).at(t(30));
    assert_eq!(
        r.resolve(&call("claude-code", "s-unrelated", PLAIN, t(40))),
        Resolution::Unlinked
    );
    // A logged seat whose start row names the worktree.
    let rows = [with(
        seat("t1", 0, "claude", "b-captain", "captain"),
        "worktree",
        json!(WT),
    )];
    let claimer = worker_label("t7", 20, WT, "b-claimer");
    let other = call("claude-code", "s-unrelated", WT, t(40));
    let mut r = resolver_seen(&rows, vec![claimer.clone()]).at(t(30));
    assert_eq!(r.resolve(&other), Resolution::Unlinked);
    // A logged seat hc shows running there, away from its start row's folder.
    let rows = [seat("t1", 0, "codex", "b-captain", "captain")];
    let away = labelled("t1", 0, "codex", WT);
    let mut r = resolver_seen(&rows, vec![away, claimer.clone()]).at(t(30));
    assert_eq!(r.resolve(&other), Resolution::Unlinked);
    // A seat with no start row that the attach ledger bound, sitting in the worktree.
    let bound = labelled("t2", 0, "claude-code", WT);
    let mut r = resolver_seen(&[], vec![bound, claimer.clone()]).at(t(30));
    r.add_attach(&lines(&[attach("t2", "b-bound", t(2))]));
    assert_eq!(r.resolve(&other), Resolution::Unlinked);
    // The control: alone in its task worktree, the label names the call.
    let mut r = resolver_seen(&[], vec![claimer]).at(t(30));
    assert_eq!(tag(r.resolve(&other)).0.bot, "b-claimer");
}

/// C1: the folder is hc's live cwd, so a labelled worker that leaves its task worktree for the
/// project root takes no claim with it: its folder claim is void for its whole span, in both
/// folders, and stays void across a recompute. A worktree removed after the task is no such move.
#[test]
fn a_label_only_worker_that_leaves_its_worktree_loses_its_folder_claim() {
    let mut r = resolver_seen(&[], vec![worker_label("t7", 20, WT, "b-hand")]).at(t(30));
    assert_eq!(
        tag(r.resolve(&call("claude-code", "s-1", WT, t(40)))).0.bot,
        "b-hand"
    );
    let (first, _) = r.records();
    // The worktree is gone from the disk at the next sync (nothing is a task worktree now), and
    // the terminal is still there: the answer the first sync wrote replays.
    let mut kept = Resolver::new(
        Some(CORE.into()),
        vec![worker_label("t7", 20, WT, "b-hand")],
    )
    .probe(|_| false)
    .at(t(50));
    kept.add_history(&history_of(&first, Some(t(30))), &[], &HashMap::new());
    assert_eq!(
        tag(kept.resolve(&call("claude-code", "s-1", WT, t(40))))
            .0
            .bot,
        "b-hand"
    );
    assert_eq!(
        launch(&kept.records().0, "t7").bound,
        launch(&first, "t7").bound
    );
    // hc shows the terminal in the project root instead.
    let mut moved = seen(vec![worker_label("t7", 20, PROJECT, "b-hand")]).at(t(50));
    moved.add_history(&history_of(&first, Some(t(30))), &[], &HashMap::new());
    for (cwd, at) in [(PROJECT, t(40)), (PROJECT, t(55)), (WT, t(40)), (WT, t(55))] {
        assert_eq!(
            moved.resolve(&call("claude-code", "s-unrelated", cwd, at)),
            Resolution::Unlinked,
            "{cwd} at {at}"
        );
    }
    let (after, _) = moved.records();
    assert_eq!(
        launch(&after, "t7").bound.as_deref(),
        Some(format!("~{}-:b-hand", t(30)).as_str())
    );
    // Back in the worktree, or gone: the interval lost its mark, and the claim stays void.
    let mut back = seen(vec![worker_label("t7", 20, WT, "b-hand")]).at(t(70));
    back.add_history(&history_of(&after, Some(t(50))), &[], &HashMap::new());
    let mut gone = seen(vec![]).at(t(70));
    gone.add_history(&history_of(&after, Some(t(50))), &[], &HashMap::new());
    for r in [&mut back, &mut gone] {
        for cwd in [PROJECT, WT] {
            assert_eq!(
                r.resolve(&call("claude-code", "s-unrelated", cwd, t(60))),
                Resolution::Unlinked,
                "{cwd}"
            );
        }
    }
    assert_eq!(
        launch(&back.records().0, "t7").bound,
        launch(&after, "t7").bound
    );
}

/// C2: a seat with no start row that the attach ledger bound stays a seat when `worker.of` is
/// added to its terminal. It never names a call by its project-root folder, and the binding's
/// answer is the attach ledger's, reached only through a session record.
#[test]
fn a_bound_seat_that_adds_a_worker_label_stays_a_seat() {
    let other = call("claude-code", "s-unrelated", PROJECT, t(40));
    let own = call("claude-code", "s-seat", PROJECT, t(40));
    let rows = [hook_session("t2", "s-seat", t(5))];
    let binding = lines(&[attach("t2", "b-bound", t(2))]);
    // The control: bound, no label.
    let mut plain = resolver_seen(&rows, vec![labelled("t2", 0, "claude-code", PROJECT)]).at(t(10));
    plain.add_attach(&binding);
    assert_eq!(plain.resolve(&other), Resolution::Unlinked);
    let control = tag(plain.resolve(&own));
    assert_eq!(
        (control.0.bot.as_str(), control.0.kind, control.1),
        ("b-bound", Kind::Seat, Basis::Session)
    );
    // The same seat with `worker.of` (and a worker role) on its terminal.
    for cwd in [PROJECT, WT] {
        let labelled_seat = worker_label("t2", 0, cwd, "b-claimer");
        let mut r = resolver_seen(&rows, vec![labelled_seat]).at(t(10));
        r.add_attach(&binding);
        assert_eq!(
            r.resolve(&call("claude-code", "s-unrelated", cwd, t(40))),
            Resolution::Unlinked,
            "{cwd}"
        );
        // Its own session keeps the binding's answer, with no field from the label.
        let got = tag(r.resolve(&own));
        assert_eq!(got, control, "{cwd}");
        assert!(!got.0.label);
        // The row: a seat, no label tag, the attach ledger's interval alone.
        let (records, _) = r.records();
        let row = launch(&records, "t2");
        assert_eq!(row.kind.as_deref(), Some("seat"));
        assert_eq!((row.bot.as_deref(), row.role.as_deref()), (None, None));
        assert_eq!(
            row.bound.as_deref(),
            Some(format!("{}-:b-bound", t(2)).as_str())
        );
    }
    // A label seen before the binding existed: the binding still wins from the sync that reads it,
    // and the row's kind becomes the binding's.
    let mut r = resolver_seen(&rows, vec![worker_label("t2", 0, WT, "b-claimer")]).at(t(1));
    let (before, _) = r.records();
    assert_eq!(launch(&before, "t2").kind.as_deref(), Some("worker"));
    let mut r2 = seen(vec![worker_label("t2", 0, WT, "b-claimer")]).at(t(10));
    r2.add_workers(&lines(&rows));
    r2.add_attach(&binding);
    r2.add_history(&history_of(&before, Some(t(1))), &[], &HashMap::new());
    assert_eq!(
        r2.resolve(&call("claude-code", "s-unrelated", WT, t(40))),
        Resolution::Unlinked
    );
    assert_eq!(tag(r2.resolve(&own)), control);
    assert_eq!(launch(&r2.records().0, "t2").kind.as_deref(), Some("seat"));
}

/// A sync whose clock stepped back never re-tags a call an earlier sync answered: the interval it
/// closes ends no earlier than the last sync that saw the launch.
#[test]
fn a_clock_that_steps_back_never_retags_earlier_calls() {
    let seat = |bot: &str| {
        let mut t = labelled("t2", 0, "claude-code", PROJECT);
        t.labels.bot = Some(bot.into());
        t.labels.session = Some("s-seat".into());
        t
    };
    let at = |min| call("claude-code", "s-seat", PROJECT, t(min));
    let mut r = resolver_seen(&[], vec![seat("b-a")]).at(t(10));
    let (a, _) = r.records();
    let mut r = seen(vec![seat("b-a")]).at(t(50));
    r.add_history(&history_of(&a, Some(t(10))), &[], &HashMap::new());
    assert_eq!(tag(r.resolve(&at(30))).0.bot, "b-a");
    let (b, _) = r.records();
    // The third sync reads an earlier clock, and a different bot.
    let mut r = seen(vec![seat("b-b")]).at(t(20));
    r.add_history(&history_of(&b, Some(t(50))), &[], &HashMap::new());
    assert_eq!(tag(r.resolve(&at(30))).0.bot, "b-a");
    assert_eq!(tag(r.resolve(&at(45))).0.bot, "b-a");
    assert_eq!(tag(r.resolve(&at(55))).0.bot, "b-b");
    let (c, _) = r.records();
    assert_eq!(
        launch(&c, "t2").bound.as_deref(),
        Some(format!("~{}-{}:b-a;~{}-:b-b", t(10), t(50), t(50)).as_str())
    );
    // The store now says the launch was last seen at minute 20, and the clock is still behind
    // the open interval: a third bot opens where that interval began, never before it.
    let mut r = seen(vec![seat("b-c")]).at(t(25));
    r.add_history(&history_of(&c, Some(t(20))), &[], &HashMap::new());
    assert_eq!(tag(r.resolve(&at(30))).0.bot, "b-a");
    assert_eq!(tag(r.resolve(&at(55))).0.bot, "b-c");
    // A worker's first sighting follows the same rule: never before the launch was last seen.
    let mut r = resolver_seen(&[], vec![labelled("t7", 20, "claude-code", WT)]).at(t(50));
    let (plain, _) = r.records();
    let mut r = seen(vec![worker_label("t7", 20, WT, "b-hand")]).at(t(30));
    r.add_history(&history_of(&plain, Some(t(50))), &[], &HashMap::new());
    assert_eq!(
        r.resolve(&call("claude-code", "s-1", WT, t(40))),
        Resolution::Unlinked
    );
    assert_eq!(
        tag(r.resolve(&call("claude-code", "s-1", WT, t(55)))).0.bot,
        "b-hand"
    );
}

/// A label's bot is shape-checked before it is stored or names a call: within the printed caps
/// and with no control character. One that fails is ignored: no claim, and nothing of it in the
/// launch row.
#[test]
fn a_label_bot_with_a_bad_shape_is_ignored_and_never_stored() {
    let bad = [
        "/work/secret/key\u{1b}[2J".to_owned(),
        "b-line\u{7}".to_owned(),
        "b".repeat(TAG_CHARS + 1),
        "b".repeat(100),
        "\"".repeat(49),
    ];
    for bot in &bad {
        // As a worker in its task worktree.
        let mut r = resolver_seen(&[], vec![worker_label("t7", 20, WT, bot)]).at(t(30));
        assert_eq!(
            r.resolve(&call("claude-code", "s-1", WT, t(40))),
            Resolution::Unlinked,
            "{bot:?}"
        );
        // As a seat, through its own session label.
        let mut seat = labelled("t2", 0, "claude-code", PROJECT);
        seat.labels.bot = Some(bot.clone());
        seat.labels.session = Some("s-seat".into());
        let mut s = resolver_seen(&[], vec![seat]).at(t(30));
        assert_eq!(
            s.resolve(&call("claude-code", "s-seat", PROJECT, t(40))),
            Resolution::Unlinked,
            "{bot:?}"
        );
        for (records, terminal) in [(r.records().0, "t7"), (s.records().0, "t2")] {
            let row = launch(&records, terminal);
            assert_eq!(
                (
                    row.kind.as_deref(),
                    row.bot.as_deref(),
                    row.bound.as_deref()
                ),
                (None, None, None),
                "{bot:?}"
            );
        }
    }
    // At the cap it is a bot like any other.
    let at_cap = "b".repeat(TAG_CHARS);
    let mut r = resolver_seen(&[], vec![worker_label("t7", 20, WT, &at_cap)]).at(t(30));
    assert_eq!(
        tag(r.resolve(&call("claude-code", "s-1", WT, t(40)))).0.bot,
        at_cap
    );
    // A seat's role with a control character is no role; the bot still stands.
    let mut seat = labelled("t2", 0, "claude-code", PROJECT);
    seat.labels.bot = Some("b-captain".into());
    seat.labels.role = Some("cap\u{1b}tain".into());
    seat.labels.session = Some("s-seat".into());
    let mut r = resolver_seen(&[], vec![seat]).at(t(30));
    let (got, _) = tag(r.resolve(&call("claude-code", "s-seat", PROJECT, t(40))));
    assert_eq!((got.bot.as_str(), got.role), ("b-captain", None));
    assert_eq!(got.unrecorded, ["role", "squad"]);
}

/// What the disk says a task worktree is: a linked git worktree's root, never the main checkout,
/// a submodule, a plain folder, or a `.git` reached through a link.
#[test]
fn only_a_linked_worktree_root_is_a_task_worktree() {
    let dir = tempfile::tempdir().unwrap();
    let at = |name: &str| dir.path().join(name);
    let text = |p: &std::path::Path| p.to_string_lossy().into_owned();
    // The main checkout: `.git` is a folder.
    std::fs::create_dir_all(at("project/.git/worktrees/gh-45")).unwrap();
    assert!(!task_worktree(&text(&at("project"))));
    // A linked worktree: `.git` is a file naming a folder under the repository's `worktrees/`.
    let linked = at("project/.worktrees/gh-45");
    std::fs::create_dir_all(&linked).unwrap();
    let gitdir = format!("gitdir: {}\n", text(&at("project/.git/worktrees/gh-45")));
    std::fs::write(linked.join(".git"), &gitdir).unwrap();
    assert!(task_worktree(&text(&linked)));
    assert!(task_worktree(&format!("{}/", text(&linked))));
    // A folder inside it is not its root, and a plain folder is nothing.
    std::fs::create_dir_all(linked.join("src")).unwrap();
    assert!(!task_worktree(&text(&linked.join("src"))));
    std::fs::create_dir_all(at("plain")).unwrap();
    assert!(!task_worktree(&text(&at("plain"))));
    assert!(!task_worktree(&text(&at("missing"))));
    // A submodule's `.git` file names a folder under `modules/`.
    std::fs::create_dir_all(at("sub")).unwrap();
    std::fs::write(at("sub/.git"), "gitdir: ../.git/modules/sub\n").unwrap();
    assert!(!task_worktree(&text(&at("sub"))));
    // Not a `gitdir:` file, and a relative folder.
    std::fs::create_dir_all(at("odd")).unwrap();
    std::fs::write(at("odd/.git"), "worktrees\n").unwrap();
    assert!(!task_worktree(&text(&at("odd"))));
    assert!(!task_worktree("project/.worktrees/gh-45"));
    // A `.git` that is a link to a worktree's file is not read.
    #[cfg(unix)]
    {
        std::fs::create_dir_all(at("linked")).unwrap();
        std::os::unix::fs::symlink(linked.join(".git"), at("linked/.git")).unwrap();
        assert!(!task_worktree(&text(&at("linked"))));
    }
}

// ---- Reviewer on #949: a move no label saw, and an attach row the column cannot hold --------

const PLAIN: &str = "/work/scratch/notes";

/// The move is recorded whether or not the sync that sees it sees a label. A labelled worker in
/// its task worktree whose terminal is then shown elsewhere with `sync2` (no label, or one that
/// fails the shape check) has lost its folder claim for good: with the label back, in the new
/// folder or in the worktree again, an unrelated session is unlinked at every time, and a
/// recompute from the rows alone says the same.
fn a_move_seen_with(sync2: impl Fn(&str) -> Terminal) {
    let unrelated = |cwd, min| call("claude-code", "s-unrelated", cwd, t(min));
    let mut r1 = resolver_seen(&[], vec![worker_label("t7", 20, WT, "b-hand")]).at(t(30));
    assert_eq!(tag(r1.resolve(&unrelated(WT, 40))).0.bot, "b-hand");
    let (first, _) = r1.records();
    assert_eq!(
        launch(&first, "t7").bound.as_deref(),
        Some(format!("~@{}-:b-hand", t(30)).as_str())
    );
    // Sync 2: hc shows the terminal in a folder that is no worktree, with no usable label.
    let mut r2 = seen(vec![sync2(PLAIN)]).at(t(50));
    r2.add_history(&history_of(&first, Some(t(30))), &[], &HashMap::new());
    for (cwd, min) in [(PLAIN, 40), (PLAIN, 55), (WT, 40)] {
        assert_eq!(
            r2.resolve(&unrelated(cwd, min)),
            Resolution::Unlinked,
            "sync 2, {cwd} at {min}"
        );
    }
    let (second, _) = r2.records();
    let row = launch(&second, "t7");
    assert_eq!(row.worktree.as_deref(), Some(PLAIN));
    // The row itself says the launch left: the interval is kept, its worktree mark is gone.
    assert_eq!(
        row.bound.as_deref(),
        Some(format!("~{}-:b-hand", t(30)).as_str())
    );
    // Sync 3: the label is back, in the new folder or in the worktree again.
    for back_in in [PLAIN, WT] {
        let mut r3 = seen(vec![worker_label("t7", 20, back_in, "b-hand")]).at(t(70));
        r3.add_history(&history_of(&second, Some(t(50))), &[], &HashMap::new());
        for cwd in [PLAIN, WT] {
            for min in [40, 55, 75] {
                assert_eq!(
                    r3.resolve(&unrelated(cwd, min)),
                    Resolution::Unlinked,
                    "sync 3 in {back_in}: {cwd} at {min}"
                );
            }
        }
        let (third, _) = r3.records();
        assert_eq!(launch(&third, "t7").bound, row.bound, "{back_in}");
        // A recompute once the terminal is gone, from the rows alone.
        let mut r4 = seen(vec![]).at(t(90));
        r4.add_history(&history_of(&third, Some(t(70))), &[], &HashMap::new());
        for cwd in [PLAIN, WT] {
            for min in [55, 75] {
                assert_eq!(
                    r4.resolve(&unrelated(cwd, min)),
                    Resolution::Unlinked,
                    "recompute after {back_in}: {cwd} at {min}"
                );
            }
        }
        assert_eq!(launch(&r4.records().0, "t7").bound, row.bound);
    }
}

#[test]
fn a_move_seen_without_a_label_voids_the_folder_claim_for_good() {
    a_move_seen_with(|cwd| labelled("t7", 20, "claude-code", cwd));
}

#[test]
fn a_move_seen_with_an_unsafe_label_voids_the_folder_claim_for_good() {
    a_move_seen_with(|cwd| worker_label("t7", 20, cwd, "b:x"));
    a_move_seen_with(|cwd| worker_label("t7", 20, cwd, "b-esc\u{1b}[2J"));
}

/// An attach row whose bot the `bound` column cannot hold still binds: it ends the binding
/// before it, and a call under it is Unknown (ambiguous), never the earlier bot and never the
/// malformed one. The row never reaches the column with its separator.
#[test]
fn an_attach_row_with_an_unwritable_bot_ends_the_earlier_binding_and_names_no_one() {
    let binding = lines(&[
        attach("t1", "b-a", t(2)),
        attach("t1", "b:x", t(10)),
        attach("t1", "b-c", t(30)),
    ]);
    let at = |min| call("claude-code", "s-seat", PROJECT, t(min));
    // A logged seat, and a seat with no start row: the same answers.
    let logged = [
        seat("t1", 0, "claude", "b-captain", "captain"),
        hook_session("t1", "s-seat", t(1)),
    ];
    let unlogged = [hook_session("t1", "s-seat", t(1))];
    let shown = || vec![labelled("t1", 0, "claude-code", PROJECT)];
    for (name, rows) in [("logged", &logged[..]), ("unlogged", &unlogged[..])] {
        let mut r = resolver_seen(rows, shown()).at(t(50));
        r.add_attach(&binding);
        assert_eq!(tag(r.resolve(&at(5))).0.bot, "b-a", "{name}");
        assert_eq!(r.resolve(&at(20)), Resolution::Ambiguous, "{name}");
        assert_eq!(tag(r.resolve(&at(40))).0.bot, "b-c", "{name}");
        let (records, _) = r.records();
        let bound = launch(&records, "t1").bound.clone().unwrap();
        assert_eq!(
            bound,
            format!("{}-{}:b-a;{}-{}:;{}-:b-c", t(2), t(10), t(10), t(30), t(30)),
            "{name}"
        );
        // Read back from the row alone (no attach ledger at this sync), the nameless interval
        // is still a binding that cannot be read.
        if name == "unlogged" {
            let mut again = seen(shown()).at(t(60));
            again.add_workers(&lines(rows));
            again.add_history(&history_of(&records, Some(t(50))), &[], &HashMap::new());
            assert_eq!(again.resolve(&at(20)), Resolution::Ambiguous);
            assert_eq!(tag(again.resolve(&at(5))).0.bot, "b-a");
            assert_eq!(
                launch(&again.records().0, "t1").bound.as_deref(),
                Some(bound.as_str())
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Issue 899: `pr` rows and how a terminal ended.

fn pr(branch: &str, number: i64, state: &str, at_min: i64) -> Value {
    json!({
        "event": "pr", "project": PROJECT, "branch": branch, "task": "gh-45", "pr": number,
        "state": state, "first_commit_at": iso(t(10)), "opened_at": iso(t(30)),
        "merged_at": null, "closed_at": null, "core": CORE, "at": iso(t(at_min))
    })
}

#[test]
fn a_pr_row_is_read_beside_the_launches_and_moves_no_attribution() {
    let rows = [
        worker("t1", 0, WT, "claude", "b-dev", "dev"),
        pr("feat/gh-45-example", 45, "open", 31),
        // Times as milliseconds, and fields the meter never reads.
        with(
            with(
                with(
                    pr("feat/gh-45-example", 45, "merged", 90),
                    "merged_at",
                    json!(t(80)),
                ),
                "title",
                json!("made-up title"),
            ),
            "url",
            json!("https://example.com/acme/widgets/pull/45"),
        ),
    ];
    let mut with_pr = resolver(&rows);
    let mut without = resolver(&rows[..1]);
    assert_eq!(
        with_pr.records(),
        without.records(),
        "a pr row is no launch and no link"
    );
    let c = call("claude-code", "sess-1", WT, t(5));
    assert_eq!(with_pr.resolve(&c), without.resolve(&c));

    let got = with_pr.pr_rows();
    assert_eq!(got.len(), 2);
    assert_eq!(
        got[0],
        PrRow {
            project: PROJECT.into(),
            branch: "feat/gh-45-example".into(),
            task: Some("gh-45".into()),
            pr: 45,
            state: "open",
            first_commit_ms: Some(t(10)),
            opened_ms: Some(t(30)),
            merged_ms: None,
            closed_ms: None,
            core: Some(CORE.into()),
            at_ms: t(31),
        }
    );
    assert_eq!(
        (got[1].state, got[1].merged_ms, got[1].at_ms),
        ("merged", Some(t(80)), t(90))
    );
    assert!(without.pr_rows().is_empty());
}

#[test]
fn a_pr_row_the_meter_cannot_trust_is_refused_whole() {
    let good = pr("feat/x", 7, "open", 31);
    let long = "x".repeat(300);
    let bad = [
        ("no number", with(good.clone(), "pr", Value::Null)),
        ("a number below 1", with(good.clone(), "pr", json!(0))),
        ("a number as text", with(good.clone(), "pr", json!("7"))),
        (
            "an unknown state",
            with(good.clone(), "state", json!("draft")),
        ),
        ("no state", with(good.clone(), "state", Value::Null)),
        ("no project", with(good.clone(), "project", Value::Null)),
        ("no branch", with(good.clone(), "branch", json!(""))),
        (
            "a branch past 255 bytes",
            with(good.clone(), "branch", json!(long)),
        ),
        (
            "a branch with a line break",
            with(good.clone(), "branch", json!("feat/x\nstate: merged")),
        ),
        (
            "an unreadable opened_at",
            with(good.clone(), "opened_at", json!("yesterday")),
        ),
        (
            "a time out of range",
            with(good.clone(), "first_commit_at", json!(12)),
        ),
        (
            "a time as an object",
            with(good.clone(), "closed_at", json!({"at": 1})),
        ),
        ("no at", with(good.clone(), "at", Value::Null)),
        (
            "a merge with no time",
            with(good.clone(), "state", json!("merged")),
        ),
        (
            "another machine's row",
            with(good.clone(), "core", json!("core-synthetic-b")),
        ),
    ];
    for (what, row) in bad {
        let r = resolver(&[row]);
        assert!(r.pr_rows().is_empty(), "{what} was read: {:?}", r.pr_rows());
    }
    // A task id the store cannot hold is dropped; the row is still a pull request.
    let r = resolver(&[with(good.clone(), "task", json!("a;b"))]);
    assert_eq!(r.pr_rows().len(), 1);
    assert_eq!(r.pr_rows()[0].task, None);
    // A row that names no core is this machine's, as a start row is.
    let r = resolver(&[with(good, "core", Value::Null)]);
    assert_eq!(r.pr_rows().len(), 1);
}

#[test]
fn an_end_row_that_copied_hc_s_status_says_how_the_terminal_ended() {
    let plain = end("t1", 0, t(60));
    let copied = with(
        with(end("t2", 0, t(60)), "hc_reason", json!("exited")),
        "exit_code",
        json!(2),
    );
    let signalled = with(end("t3", 0, t(60)), "signal", json!(9));
    let elsewhere = with(
        with(end("t4", 0, t(60)), "exit_code", json!(1)),
        "core",
        json!("core-synthetic-b"),
    );
    // A reason that is not a short word is dropped, never stored: with nothing else, no detail.
    let odd = with(end("t5", 0, t(60)), "hc_reason", json!("exited; rm -rf"));
    let r = resolver(&[plain, copied, signalled, elsewhere, odd]);
    assert_eq!(
        r.end_details(),
        [
            EndDetail {
                core: Some(CORE.into()),
                terminal: "t2".into(),
                created_ms: t(0),
                reason: Some("exited".into()),
                exit_code: Some(2),
                signal: None,
            },
            EndDetail {
                core: Some(CORE.into()),
                terminal: "t3".into(),
                created_ms: t(0),
                reason: None,
                exit_code: None,
                signal: Some("9".into()),
            },
        ]
    );
}

// ---- RFC 0026 (d): the dsh-tui seat --------------------------------------------------------

const DSH: &str = "dsh-tui";

fn dsh_seat(terminal: &str, min: i64, bot: &str) -> Value {
    seat(terminal, min, DSH, bot, "captain")
}

fn dsh_call(session: &str, min: i64) -> Call<'_> {
    call(DSH, session, PROJECT, t(min))
}

/// A dsh-tui pane hc lists, with its `agent.session` label.
fn dsh_pane(terminal: &str, created_min: i64, session: Option<&str>) -> Terminal {
    let mut pane = live(terminal, created_min, DSH, PROJECT);
    pane.labels.session = session.map(str::to_owned);
    pane
}

/// The dsh-tui session links of `records`, as the next sync reads them back from the store.
fn kept(links: &[LinkRecord]) -> Vec<SessionLink> {
    links
        .iter()
        .filter(|l| l.harness == DSH && l.basis == "session")
        .map(|l| SessionLink {
            agent: l.harness.clone(),
            session: l.session.clone(),
            lkey: l.lkey.clone(),
            valid_from: l.valid_from,
            valid_to: l.valid_to,
            sighted: l.sighted,
        })
        .collect()
}

/// T4 (a), (c): the header's terminal ties a dsh-tui session to the seat launched there, at
/// `session` basis, from the session's start. A session run by hand in the same root has no such
/// record: it stays unlinked and unwitnessed (`dsh_tui_seat`).
#[test]
fn a_dsh_tui_headers_terminal_ties_the_session_to_its_seat() {
    let mut r = resolver(&[dsh_seat("t1", 0, "b-captain")]);
    // No record yet: the project root names no seat.
    assert_eq!(r.resolve(&dsh_call("s-seat", 20)), Resolution::Unlinked);
    assert!(!r.witnessed(&dsh_call("s-seat", 20)));
    r.witness("s-seat", "t1", Some(t(10)));
    let (got, basis) = tag(r.resolve(&dsh_call("s-seat", 20)));
    assert_eq!((got.bot.as_str(), basis), ("b-captain", Basis::Session));
    assert_eq!(got.kind, Kind::Seat);
    assert_eq!(got.role.as_deref(), Some("captain"));
    assert!(r.witnessed(&dsh_call("s-seat", 20)));
    // The link starts at the session's start: nothing earlier is claimed.
    assert_eq!(r.resolve(&dsh_call("s-seat", 5)), Resolution::Unlinked);
    // The session run by hand in the same root.
    assert_eq!(r.resolve(&dsh_call("s-hand", 20)), Resolution::Unlinked);
    assert!(!r.witnessed(&dsh_call("s-hand", 20)));
    // A sub-agent's calls follow its parent session.
    let mut child = dsh_call("s-child", 20);
    child.parent_session = Some("s-seat");
    assert_eq!(tag(r.resolve(&child)).0.bot, "b-captain");
    // The record is dsh-tui's own: another harness's session of that name is not tied by it.
    assert_eq!(
        r.resolve(&call("claude-code", "s-seat", PROJECT, t(20))),
        Resolution::Unlinked
    );
    assert!(!r.witnessed(&call("claude-code", "s-seat", PROJECT, t(20))));
}

/// The header names a worker's terminal: its session is the worker's at `session` basis, even
/// where a second worker on the worktree leaves the folder ambiguous.
#[test]
fn a_dsh_tui_header_names_one_of_two_workers_on_a_worktree() {
    let mut r = resolver(&[
        worker("t1", 0, WT, DSH, "b-dev", "dev"),
        worker("t2", 30, WT, DSH, "b-reviewer", "review"),
    ]);
    assert_eq!(
        r.resolve(&call(DSH, "s-dev", WT, t(40))),
        Resolution::Ambiguous
    );
    r.witness("s-dev", "t1", Some(t(1)));
    r.witness("s-review", "t2", Some(t(31)));
    let (dev, basis) = tag(r.resolve(&call(DSH, "s-dev", WT, t(40))));
    assert_eq!((dev.bot.as_str(), basis), ("b-dev", Basis::Session));
    let (review, basis) = tag(r.resolve(&call(DSH, "s-review", WT, t(40))));
    assert_eq!((review.bot.as_str(), basis), ("b-reviewer", Basis::Session));
    // A header whose terminal matches no launch leaves the worktree's answer as it was.
    let mut r = resolver(&[worker("t1", 0, WT, DSH, "b-dev", "dev")]);
    r.witness("s-dev", "t9", Some(t(1)));
    let (dev, basis) = tag(r.resolve(&call(DSH, "s-dev", WT, t(10))));
    assert_eq!((dev.bot.as_str(), basis), ("b-dev", Basis::Worktree));
}

/// T4 (a), (b): the tag's source sets the basis. A start row or an attach binding reports
/// `session`; a seat known only by its `bot` label reports `label`, from the sync that saw it.
#[test]
fn a_dsh_tui_seat_tagged_only_by_its_label_reports_label_basis() {
    let label_only = |session: Option<&str>| {
        let mut pane = dsh_pane("t2", 0, session);
        pane.labels.bot = Some("b-label".into());
        pane.labels.role = Some("captain".into());
        pane
    };
    // Through the header.
    let mut r = resolver_seen(&[], vec![label_only(None)]).at(t(10));
    r.witness("s-seat", "t2", Some(t(5)));
    let (got, basis) = tag(r.resolve(&dsh_call("s-seat", 20)));
    assert_eq!((got.bot.as_str(), basis), ("b-label", Basis::Label));
    assert_eq!(got.kind, Kind::Seat);
    // Before the sync that saw the label the launch names no bot: unlinked, with a record.
    assert_eq!(r.resolve(&dsh_call("s-seat", 7)), Resolution::Unlinked);
    assert!(r.witnessed(&dsh_call("s-seat", 7)));
    // Through the pane's `agent.session` label.
    let mut r = resolver_seen(&[], vec![label_only(Some("s-seat"))]).at(t(10));
    let (got, basis) = tag(r.resolve(&dsh_call("s-seat", 20)));
    assert_eq!((got.bot.as_str(), basis), ("b-label", Basis::Label));
    // An attach binding names the seat's bot, not its label: `session` basis.
    let mut r = resolver_seen(&[], vec![label_only(None)]).at(t(10));
    r.add_attach(&lines(&[attach("t2", "b-bound", t(2))]));
    r.witness("s-seat", "t2", Some(t(5)));
    let (got, basis) = tag(r.resolve(&dsh_call("s-seat", 20)));
    assert_eq!((got.bot.as_str(), basis), ("b-bound", Basis::Session));
    // A logged seat's `agent.session` label: the start row's tag, at `session` basis (for every
    // other harness a session label reports `label`).
    let mut r = resolver_seen(
        &[dsh_seat("t1", 0, "b-captain")],
        vec![dsh_pane("t1", 0, Some("s-seat"))],
    )
    .at(t(10));
    let (got, basis) = tag(r.resolve(&dsh_call("s-seat", 20)));
    assert_eq!((got.bot.as_str(), basis), ("b-captain", Basis::Session));
    // The label is a witness over the launch's life, not from the sync that saw it.
    assert_eq!(tag(r.resolve(&dsh_call("s-seat", 3))).0.bot, "b-captain");
}

/// T4 (d): an address with a `/` is another machine's view of a pane, and an empty one names
/// nothing: neither is a record.
#[test]
fn a_dsh_tui_header_naming_another_machines_view_is_no_record() {
    for terminal in ["/mac/t1", "mac/t1", ""] {
        let mut r = resolver(&[dsh_seat("t1", 0, "b-captain")]);
        r.witness("s-seat", terminal, Some(t(10)));
        assert_eq!(r.resolve(&dsh_call("s-seat", 20)), Resolution::Unlinked);
        assert!(!r.witnessed(&dsh_call("s-seat", 20)), "{terminal:?}");
        assert_eq!(r.witness_print(), "", "{terminal:?}");
    }
}

/// T4 (e): a record that reaches no launch, or a launch that names no bot, leaves the call
/// unlinked with a record behind it (`no_record`), never `dsh_tui_seat`.
#[test]
fn a_dsh_tui_record_that_names_no_bot_is_unlinked_but_witnessed() {
    let at = dsh_call("s-seat", 20);
    // No launch on the terminal.
    let mut r = resolver(&[dsh_seat("t1", 0, "b-captain")]);
    r.witness("s-seat", "t9", Some(t(10)));
    assert_eq!(r.resolve(&at), Resolution::Unlinked);
    assert!(r.witnessed(&at));
    // The launch there ended before the session started.
    let mut r = resolver(&[dsh_seat("t1", 0, "b-captain"), end("t1", 0, t(5))]);
    r.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(r.resolve(&at), Resolution::Unlinked);
    assert!(r.witnessed(&at));
    // The launch there began after the session started.
    let mut r = resolver(&[dsh_seat("t1", 15, "b-captain")]);
    r.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(r.resolve(&at), Resolution::Unlinked);
    assert!(r.witnessed(&at));
    // A session whose start is not known: no launch can be said to cover it.
    let mut r = resolver(&[dsh_seat("t1", 0, "b-captain")]);
    r.witness("s-seat", "t1", None);
    assert_eq!(r.resolve(&at), Resolution::Unlinked);
    assert!(r.witnessed(&at));
    // A launch with no start row, no binding and no label: by the header and by its own label.
    let mut r = resolver_seen(&[], vec![dsh_pane("t3", 0, None)]).at(t(10));
    r.witness("s-seat", "t3", Some(t(5)));
    assert_eq!(r.resolve(&at), Resolution::Unlinked);
    assert!(r.witnessed(&at));
    let mut r = resolver_seen(&[], vec![dsh_pane("t3", 0, Some("s-seat"))]).at(t(10));
    assert_eq!(r.resolve(&at), Resolution::Unlinked);
    assert!(r.witnessed(&at));
}

/// T4 (f): two launches on the header's terminal that both cover the session's start name no
/// launch. The call is ambiguous even where their tags are equal and would collapse.
#[test]
fn two_launches_covering_a_dsh_tui_sessions_start_are_ambiguous() {
    // The same pane recorded twice: once with this machine's core, once by a row with none.
    let rows = [
        dsh_seat("t1", 0, "b-captain"),
        with(dsh_seat("t1", 0, "b-captain"), "core", Value::Null),
        with(hook_session("t1", "s-row", t(10)), "agent", json!(DSH)),
    ];
    let mut r = resolver(&rows);
    // The control: a session row with no launch key reaches both, and their equal tags collapse.
    assert_eq!(tag(r.resolve(&dsh_call("s-row", 20))).0.bot, "b-captain");
    // The header: never a guess, whatever the tags.
    r.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(r.resolve(&dsh_call("s-seat", 20)), Resolution::Ambiguous);
    assert!(r.witnessed(&dsh_call("s-seat", 20)));
    // It names no launch, so no link is kept for it.
    let (_, links) = r.records();
    assert!(links.iter().all(|l| l.session != "s-seat"));
    // One of the two ended before the session started: the other is named.
    let mut r = resolver(&[
        rows[0].clone(),
        rows[1].clone(),
        with(end("t1", 0, t(5)), "core", Value::Null),
    ]);
    r.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(tag(r.resolve(&dsh_call("s-seat", 20))).0.bot, "b-captain");
}

/// T4 (g): the header and the pane's `agent.session` label are two witnesses. Naming one launch
/// they collapse; naming two launches with different bots the call is ambiguous.
#[test]
fn a_dsh_tui_header_and_label_that_disagree_are_ambiguous() {
    let rows = [
        dsh_seat("t1", 0, "b-captain"),
        dsh_seat("t2", 1, "b-second"),
    ];
    let mut r = resolver_seen(&rows, vec![dsh_pane("t1", 0, Some("s-seat"))]).at(t(15));
    r.witness("s-seat", "t1", Some(t(10)));
    let (got, basis) = tag(r.resolve(&dsh_call("s-seat", 20)));
    assert_eq!((got.bot.as_str(), basis), ("b-captain", Basis::Session));
    // The label is on the other seat's pane, which was already running when the session started.
    let mut r = resolver_seen(&rows, vec![dsh_pane("t2", 1, Some("s-seat"))]).at(t(15));
    r.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(r.resolve(&dsh_call("s-seat", 20)), Resolution::Ambiguous);
    // The same bot on both panes: equal tags collapse.
    let same = [
        dsh_seat("t1", 0, "b-captain"),
        dsh_seat("t2", 1, "b-captain"),
    ];
    let mut r = resolver_seen(&same, vec![dsh_pane("t2", 1, Some("s-seat"))]).at(t(15));
    r.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(tag(r.resolve(&dsh_call("s-seat", 20))).0.bot, "b-captain");
}

/// T4 (h): the header ties the session to the launch it started in, and only over that span. A
/// later `session` row, or the label of a pane launched later, moves the calls from then on.
#[test]
fn a_dsh_tui_session_resumed_in_another_launch_moves_from_the_resume() {
    let seats = [
        dsh_seat("t1", 0, "b-captain"),
        dsh_seat("t2", 30, "b-second"),
    ];
    // Through a session row at minute 40.
    let mut rows = seats.to_vec();
    rows.push(cli_session("t2", "s-seat", DSH, 30, t(40)));
    let mut r = resolver(&rows);
    r.witness("s-seat", "t1", Some(t(10)));
    let bot = |r: &mut Resolver, min| tag(r.resolve(&dsh_call("s-seat", min))).0.bot;
    assert_eq!(bot(&mut r, 20), "b-captain");
    assert_eq!(bot(&mut r, 39), "b-captain");
    assert_eq!(bot(&mut r, 40), "b-second");
    assert_eq!(bot(&mut r, 50), "b-second");
    let (_, links) = r.records();
    let spans: Vec<(Option<i64>, Option<i64>)> = links
        .iter()
        .filter(|l| l.session == "s-seat")
        .map(|l| (l.valid_from, l.valid_to))
        .collect();
    assert_eq!(spans.len(), 2);
    assert!(spans.contains(&(Some(t(10)), Some(t(40)))));
    assert!(spans.contains(&(Some(t(40)), None)));
    // Through the label of the pane launched at minute 30: the session entered that launch.
    let mut r = resolver_seen(&seats, vec![dsh_pane("t2", 30, Some("s-seat"))]).at(t(45));
    r.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(bot(&mut r, 20), "b-captain");
    assert_eq!(bot(&mut r, 29), "b-captain");
    assert_eq!(bot(&mut r, 30), "b-second");
    assert_eq!(bot(&mut r, 50), "b-second");
    // The first launch ended: the header's link ends with it.
    let mut r = resolver(&[seats[0].clone(), end("t1", 0, t(25))]);
    r.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(bot(&mut r, 20), "b-captain");
    assert_eq!(r.resolve(&dsh_call("s-seat", 26)), Resolution::Unlinked);
    assert!(r.witnessed(&dsh_call("s-seat", 26)));
}

/// T4 (b), replay: the links a sync kept are read back by the next, which sees no label and reads
/// no log, and give the same answers and the same records.
#[test]
fn kept_dsh_tui_session_links_replay_without_the_label_or_the_log() {
    let rows = [dsh_seat("t1", 0, "b-captain")];
    // A label link.
    let mut first = resolver_seen(&rows, vec![dsh_pane("t1", 0, Some("s-seat"))]).at(t(10));
    let (_, links) = first.records();
    let label = kept(&links);
    assert_eq!(label.len(), 1);
    assert!(label[0].sighted);
    let mut later = resolver(&rows);
    assert_eq!(later.resolve(&dsh_call("s-seat", 20)), Resolution::Unlinked);
    later.add_session_links(&label);
    let (got, basis) = tag(later.resolve(&dsh_call("s-seat", 20)));
    assert_eq!((got.bot.as_str(), basis), ("b-captain", Basis::Session));
    assert_eq!(kept(&later.records().1), label);
    // A header link.
    let mut first = resolver(&rows);
    first.witness("s-seat", "t1", Some(t(10)));
    let header = kept(&first.records().1);
    assert_eq!(header.len(), 1);
    assert!(!header[0].sighted);
    assert_eq!(
        (header[0].valid_from, header[0].valid_to),
        (Some(t(10)), None)
    );
    let mut later = resolver(&rows);
    later.add_session_links(&header);
    assert_eq!(
        tag(later.resolve(&dsh_call("s-seat", 20))).0.bot,
        "b-captain"
    );
    assert_eq!(later.resolve(&dsh_call("s-seat", 5)), Resolution::Unlinked);
    assert_eq!(kept(&later.records().1), header);
    // With the header read again beside the kept link: one link, the same one.
    later.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(
        tag(later.resolve(&dsh_call("s-seat", 20))).0.bot,
        "b-captain"
    );
    assert_eq!(kept(&later.records().1), header);
}

/// A kept link whose launch this sync does not know (its ledger is not read now) names no bot,
/// and still stands over the span the store recorded: the folder never names another bot there.
#[test]
fn a_kept_dsh_tui_link_to_an_unknown_launch_is_never_dropped_for_the_folder() {
    let mut r = resolver(&[worker("t7", 0, WT, DSH, "b-dev", "dev")]);
    r.add_session_links(&[SessionLink {
        agent: DSH.into(),
        session: "s-seat".into(),
        lkey: "a-launch-not-read-now".into(),
        valid_from: Some(t(10)),
        valid_to: Some(t(30)),
        sighted: false,
    }]);
    let at = |min| call(DSH, "s-seat", WT, t(min));
    assert_eq!(r.resolve(&at(20)), Resolution::Unlinked);
    assert!(r.witnessed(&at(20)));
    // Outside the recorded span the link says nothing.
    assert_eq!(tag(r.resolve(&at(40))).0.bot, "b-dev");
    // And it is not written again as a link of a launch that is not known.
    assert!(kept(&r.records().1).is_empty());
}

/// A dsh-tui session tied to one launch by its header, a row and its pane's label is one link in
/// the table: the rows' span, starting where the session entered the launch.
#[test]
fn a_dsh_tui_session_is_one_link_per_launch() {
    let rows = [
        dsh_seat("t1", 0, "b-captain"),
        cli_session("t1", "s-seat", DSH, 0, t(12)),
    ];
    let mut r = resolver_seen(&rows, vec![dsh_pane("t1", 0, Some("s-seat"))]).at(t(15));
    r.witness("s-seat", "t1", Some(t(10)));
    let links = kept(&r.records().1);
    assert_eq!(links.len(), 1);
    assert!(!links[0].sighted);
    assert_eq!(
        (links[0].valid_from, links[0].valid_to),
        (Some(t(10)), None)
    );
    // The label alone: its link, over the launch's life.
    let mut r = resolver_seen(&rows[..1], vec![dsh_pane("t1", 0, Some("s-seat"))]).at(t(15));
    let links = kept(&r.records().1);
    assert_eq!(links.len(), 1);
    assert!(links[0].sighted);
    assert_eq!((links[0].valid_from, links[0].valid_to), (Some(t(0)), None));
}

/// The header is joined by terminal address alone, so only to a launch of this machine: one that
/// recorded this core, or none. With this machine's core unknown, a launch that names a core may
/// be another machine's at the same address.
#[test]
fn a_dsh_tui_header_joins_only_launches_of_this_machine() {
    assert!(on_this_core(Some(CORE), Some(CORE)));
    assert!(on_this_core(None, Some(CORE)));
    assert!(on_this_core(None, None));
    assert!(!on_this_core(Some(CORE), None));
    assert!(!on_this_core(Some("core-synthetic-b"), Some(CORE)));
    let rows = [dsh_seat("t1", 0, "b-captain")];
    let mut unknown = Resolver::new(None, vec![]);
    unknown.add_workers(&lines(&rows));
    unknown.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(
        unknown.resolve(&dsh_call("s-seat", 20)),
        Resolution::Unlinked
    );
    assert!(unknown.witnessed(&dsh_call("s-seat", 20)));
    // A row written before launches recorded their core.
    let old = [with(dsh_seat("t1", 0, "b-captain"), "core", Value::Null)];
    let mut unknown = Resolver::new(None, vec![]);
    unknown.add_workers(&lines(&old));
    unknown.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(
        tag(unknown.resolve(&dsh_call("s-seat", 20))).0.bot,
        "b-captain"
    );
    // Another machine's launch at the same address is not this machine's pane.
    let other = [with(
        dsh_seat("t1", 0, "b-remote"),
        "core",
        json!("core-synthetic-b"),
    )];
    let mut r = resolver(&other);
    r.witness("s-seat", "t1", Some(t(10)));
    assert_eq!(r.resolve(&dsh_call("s-seat", 20)), Resolution::Unlinked);
}

/// The fingerprint of the header records: empty with none (a store with no such record
/// fingerprints as it did before), the same whatever order they were read in, and different for
/// another terminal or start.
#[test]
fn the_header_fingerprint_follows_the_records() {
    let print = |records: &[(&str, &str, Option<i64>)]| {
        let mut r = resolver(&[]);
        for (session, terminal, at) in records {
            r.witness(session, terminal, *at);
        }
        r.witness_print()
    };
    assert_eq!(print(&[]), "");
    let a = ("s-a", "t1", Some(t(1)));
    let b = ("s-b", "t2", Some(t(2)));
    assert_ne!(print(&[a]), "");
    assert_eq!(print(&[a, b]), print(&[b, a]));
    assert_ne!(print(&[a]), print(&[a, b]));
    assert_ne!(print(&[a]), print(&[("s-a", "t2", Some(t(1)))]));
    assert_ne!(print(&[a]), print(&[("s-a", "t1", Some(t(2)))]));
    assert_ne!(print(&[a]), print(&[("s-a", "t1", None)]));
}
