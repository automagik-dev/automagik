//! The dsh-tui seat (RFC 0026 (d), T4): a session's header names the terminal it runs in, a
//! `session` row or the pane's `agent.session` label names its launch, and the meter ties the
//! session to that launch instead of leaving every session in a shared checkout `dsh_tui_seat`.
//! Each case runs through whole syncs and reads back what the store kept. Synthetic fixtures
//! only: every id, bot, path, model and number here is made up.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use common::{Env, now};
use meter::evidence;
use meter::hc::{Labels, Terminal};
use meter::sources::dsh_tui::SESSION_TERMINAL_KEY;
use serde_json::{Value, json};

const CORE: &str = "core-synthetic";
/// The project root the seats and the sessions run by hand share.
const ROOT: &str = "/work/app";

/// `min` minutes before the tests' now, in epoch ms.
fn ago(min: i64) -> i64 {
    now() - min * 60_000
}

/// A store on a machine whose core is [`CORE`], as a sync that reached hc would leave it.
fn env() -> Env {
    let env = Env::new();
    fs::create_dir_all(env.state()).unwrap();
    env.store().set_meta("machine", CORE).unwrap();
    env
}

fn log_path(env: &Env, session: &str) -> PathBuf {
    env.dsh(&format!("-work-app/{session}/session.v4.jsonl"))
}

/// One call of `session` at `at`, known in the answers by its `input` tokens.
fn call(session: &str, at: i64, input: i64) -> String {
    format!(
        r#"{{"type":"assistant/message","seq":{input},"time":{at},"surfaceOp":"append","data":{{"turn":1,"step":{input},"message":{{"role":"assistant","content":[{{"type":"text","text":"FAKE-ANSWER"}}],"source":{{"kind":"llm","provider":"example","model":"model-d"}},"id":"{session}-m{input}"}},"usage":{{"inputTokens":{input},"outputTokens":0,"cacheReadTokens":0,"cacheWriteTokens":0,"totalTokens":{input}}},"stream":[]}}}}"#
    )
}

/// Writes a session's log: its header, with `terminal` (a JSON value, as text) under the field's
/// one name when given, then one call per `(at, input)`.
fn log(env: &Env, session: &str, terminal: Option<&str>, created: i64, calls: &[(i64, i64)]) {
    let field = terminal
        .map(|t| format!(r#""{SESSION_TERMINAL_KEY}":{t},"#))
        .unwrap_or_default();
    let mut lines = vec![format!(
        r#"{{"type":"session","version":4,"id":"{session}","createdAt":{created},{field}"cwd":"{ROOT}","isSeeded":false,"delegationDepth":0}}"#
    )];
    lines.extend(calls.iter().map(|(at, input)| call(session, *at, *input)));
    common::write_lines(&log_path(env, session), &lines);
}

/// A dsh-tui seat's start row in the project root.
fn seat(terminal: &str, bot: &str, created: i64) -> Value {
    json!({
        "event": "start", "kind": "seat", "terminal": terminal, "botId": bot, "task": null,
        "worktree": ROOT, "agent": "dsh-tui", "role": "captain", "branch": null,
        "project": ROOT, "lead": null, "core": CORE, "created_ms": created, "squad": "b-squad",
        "session": null, "at": meter::time::format_rfc3339(created + 5_000)
    })
}

/// The CLI's `session` row: the session ran in the launch keyed (this core, terminal, created).
fn session_row(terminal: &str, created: i64, session: &str, at: i64) -> Value {
    json!({
        "event": "session", "terminal": terminal, "session": session, "transcript": null,
        "agent": "dsh-tui", "core": CORE, "created_ms": created,
        "at": meter::time::format_rfc3339(at)
    })
}

fn ledger(env: &Env, rows: &[Value]) {
    let p = env
        .home()
        .join(".config/herdr-app/automagik-herdr/workers.jsonl");
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    let text: Vec<String> = rows.iter().map(Value::to_string).collect();
    fs::write(&p, text.join("\n") + "\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).unwrap();
    }
}

/// A dsh-tui pane hc lists in the project root.
fn pane(terminal: &str, created: i64, labels: Labels) -> Terminal {
    Terminal {
        terminal: terminal.into(),
        created_ms: Some(created),
        finished_ms: None,
        harness: Some("dsh-tui"),
        cwd: Some(ROOT.into()),
        labels,
    }
}

fn session_label(session: &str) -> Labels {
    Labels {
        session: Some(session.into()),
        ..Labels::default()
    }
}

/// A sync at `at` that sees `snapshot` (what hc lists).
fn sync(env: &Env, at: i64, snapshot: &[Terminal]) -> meter::sync::Report {
    let mut o = env.opts();
    o.now_ms = at;
    o.snapshot = Some(snapshot.to_vec());
    env.run(&o)
}

/// What the store says of one call: state, basis, reason and bot ("-" for none).
type Said = (String, String, String, String);

fn said(state: &str, basis: &str, reason: &str, bot: &str) -> Said {
    (state.into(), basis.into(), reason.into(), bot.into())
}

fn attributed(basis: &str, bot: &str) -> Said {
    said("attributed", basis, "-", bot)
}

fn unlinked(reason: &str) -> Said {
    said("unlinked", "-", reason, "-")
}

fn ambiguous() -> Said {
    said("ambiguous", "-", "claimants_differ", "-")
}

/// Every stored call by its input tokens, and the rollups agreeing with them: a call's tokens are
/// in the row its attribution names, and nowhere else.
fn calls(env: &Env) -> BTreeMap<i64, Said> {
    let store = env.store();
    let or_dash = |v: &Option<String>| v.clone().unwrap_or_else(|| "-".into());
    let out = evidence::all(&store.conn)
        .unwrap()
        .iter()
        .map(|c| {
            let a = &c.actor;
            (
                c.tokens.input_uncached,
                (
                    a.state.clone(),
                    or_dash(&a.basis),
                    or_dash(&a.reason),
                    or_dash(&a.bot),
                ),
            )
        })
        .collect();
    let from = store.meta_i64(evidence::FROM_META).unwrap().unwrap();
    let stored: BTreeMap<_, _> = evidence::stored_rollups(&store.conn, from)
        .unwrap()
        .into_iter()
        .collect();
    assert_eq!(evidence::implied_rollups(&store.conn).unwrap(), stored);
    out
}

/// The active links of dsh-tui sessions: (basis, valid_from, valid_to, a session label made it).
fn links(env: &Env) -> Vec<(String, Option<i64>, Option<i64>, bool)> {
    let store = env.store();
    let mut st = store
        .conn
        .prepare(
            "SELECT basis, valid_from, valid_to, seen_first IS NOT NULL FROM link
             WHERE harness = 'dsh-tui' AND superseded_by IS NULL ORDER BY valid_from, id",
        )
        .unwrap();
    st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// Input tokens per bot in the rollups (None: no bot).
fn by_bot(env: &Env) -> BTreeMap<Option<String>, i64> {
    let mut m = BTreeMap::new();
    for r in env.store().rows_since(i64::MIN).unwrap() {
        *m.entry(r.key.bot.clone()).or_default() += r.tokens.input_uncached;
    }
    m
}

// (a), (c): the header's terminal ties the seat's session to its launch at `session` basis; a
// session run by hand in the same root, whose header names no terminal, stays `dsh_tui_seat`.
#[test]
fn a_seats_session_is_attributed_through_its_headers_terminal() {
    let env = env();
    ledger(&env, &[seat("t1", "b-captain", ago(180))]);
    log(
        &env,
        "sess-seat",
        Some(r#""t1""#),
        ago(120),
        &[(ago(110), 10), (ago(20), 11)],
    );
    log(&env, "sess-hand", None, ago(100), &[(ago(90), 20)]);
    sync(&env, now(), &[]);
    let got = calls(&env);
    assert_eq!(got[&10], attributed("session", "b-captain"));
    assert_eq!(got[&11], attributed("session", "b-captain"));
    assert_eq!(got[&20], unlinked("dsh_tui_seat"));
    // The link is kept as any other: from the session's start, open while the launch runs.
    assert_eq!(
        links(&env),
        [("session".into(), Some(ago(120)), None, false)]
    );
    let mut want = BTreeMap::new();
    want.insert(Some("b-captain".to_owned()), 21);
    want.insert(None, 20);
    assert_eq!(by_bot(&env), want);
    // A later sync with nothing new changes nothing.
    let r = sync(&env, now() + 60_000, &[]);
    assert_eq!((r.links_changed, r.calls_moved), (0, 0));
    assert_eq!(calls(&env), got);
}

// (a): a seat with no start row, known only by its pane's `bot` label, names the session at
// `label` basis, from the sync that first saw the label.
#[test]
fn a_seat_known_only_by_its_label_is_attributed_at_label_basis() {
    let env = env();
    let seat_pane = pane(
        "t2",
        ago(200),
        Labels {
            bot: Some("b-label".into()),
            role: Some("captain".into()),
            ..Labels::default()
        },
    );
    // The sync that first sees the label, before the session has logged anything.
    sync(&env, ago(180), std::slice::from_ref(&seat_pane));
    log(
        &env,
        "sess-seat",
        Some(r#""t2""#),
        ago(190),
        &[(ago(185), 9), (ago(110), 10)],
    );
    log(&env, "sess-hand", None, ago(100), &[(ago(90), 20)]);
    sync(&env, now(), std::slice::from_ref(&seat_pane));
    let got = calls(&env);
    assert_eq!(got[&10], attributed("label", "b-label"));
    assert_eq!(got[&20], unlinked("dsh_tui_seat"));
    // Before the label was seen the launch names no bot: a record, and no bot behind it.
    assert_eq!(got[&9], unlinked("no_record"));
}

// (b): the pane's `agent.session` label ties the session to a logged seat at `session` basis,
// and the link is kept: with the pane gone, a new call and a recompute of the old ones give the
// same answer from the store alone.
#[test]
fn a_session_label_links_a_logged_seat_and_replays_after_the_label_is_gone() {
    let env = env();
    ledger(&env, &[seat("t1", "b-captain", ago(180))]);
    log(&env, "sess-seat", None, ago(120), &[(ago(110), 10)]);
    log(&env, "sess-hand", None, ago(100), &[(ago(90), 20)]);
    let labelled = pane("t1", ago(180), session_label("sess-seat"));
    sync(&env, ago(60), std::slice::from_ref(&labelled));
    let got = calls(&env);
    assert_eq!(got[&10], attributed("session", "b-captain"));
    assert_eq!(got[&20], unlinked("dsh_tui_seat"));
    assert_eq!(
        links(&env),
        [("session".into(), Some(ago(180)), None, true)]
    );
    // The pane is gone (hc lists nothing), and the session logged one more call before it went.
    common::append(
        &log_path(&env, "sess-seat"),
        &format!("{}\n", call("sess-seat", ago(45), 11)),
    );
    sync(&env, ago(30), &[]);
    let got = calls(&env);
    assert_eq!(got[&10], attributed("session", "b-captain"));
    assert_eq!(got[&11], attributed("session", "b-captain"));
    // Every call recomputed, with no label and no log read: the kept link answers.
    let store = env.store();
    let tx = store.conn.unchecked_transaction().unwrap();
    assert!(evidence::queue_since(&tx, i64::MIN).unwrap() > 0);
    tx.commit().unwrap();
    drop(store);
    let r = sync(&env, now(), &[]);
    assert_eq!((r.files_read, r.calls_moved), (0, 0));
    let again = calls(&env);
    assert_eq!(again, got);
    assert_eq!(again[&20], unlinked("dsh_tui_seat"));
    let kept = links(&env);
    assert_eq!(kept.len(), 1);
    assert_eq!((kept[0].0.as_str(), kept[0].3), ("session", true));
}

// (b): the same through a seat known only by its labels: `label` basis, and it replays too.
#[test]
fn a_session_label_on_a_label_only_seat_reports_label_basis_and_replays() {
    let env = env();
    let seat_pane = pane(
        "t2",
        ago(200),
        Labels {
            bot: Some("b-label".into()),
            role: Some("captain".into()),
            session: Some("sess-seat".into()),
            ..Labels::default()
        },
    );
    sync(&env, ago(180), std::slice::from_ref(&seat_pane));
    log(&env, "sess-seat", None, ago(120), &[(ago(110), 10)]);
    sync(&env, ago(60), std::slice::from_ref(&seat_pane));
    assert_eq!(calls(&env)[&10], attributed("label", "b-label"));
    // The pane is gone; a call it logged before that, and a recompute of everything.
    common::append(
        &log_path(&env, "sess-seat"),
        &format!("{}\n", call("sess-seat", ago(45), 11)),
    );
    sync(&env, ago(30), &[]);
    let store = env.store();
    let tx = store.conn.unchecked_transaction().unwrap();
    evidence::queue_since(&tx, i64::MIN).unwrap();
    tx.commit().unwrap();
    drop(store);
    sync(&env, now(), &[]);
    let got = calls(&env);
    assert_eq!(got[&10], attributed("label", "b-label"));
    assert_eq!(got[&11], attributed("label", "b-label"));
}

// (d): a terminal that is no bare local address is no record: another machine's view of a pane
// (an address with a `/`), a control character, an empty or over-long value, anything that is not
// a string. The session stays `dsh_tui_seat`, whatever seat runs on `t1`.
#[test]
fn a_header_terminal_that_is_no_local_address_is_ignored() {
    let env = env();
    ledger(&env, &[seat("t1", "b-captain", ago(180))]);
    let long = format!(r#""{}""#, "t".repeat(200));
    let values = [
        r#""/mac/t1""#,
        r#""mac/t1""#,
        r#""t1\u0007""#,
        r#""t1;""#,
        r#""""#,
        "7",
        "null",
        r#"["t1"]"#,
        long.as_str(),
    ];
    for (i, value) in values.iter().enumerate() {
        let input = 30 + i as i64;
        log(
            &env,
            &format!("sess-{i}"),
            Some(value),
            ago(120),
            &[(ago(110), input)],
        );
    }
    sync(&env, now(), &[]);
    let got = calls(&env);
    assert_eq!(got.len(), values.len());
    for (i, value) in values.iter().enumerate() {
        assert_eq!(got[&(30 + i as i64)], unlinked("dsh_tui_seat"), "{value}");
    }
    assert_eq!(links(&env), []);
}

// (e): a record that reaches no launch, or a launch that names no bot, is `no_record`: the
// session has its record, so it is never counted as a seat no record could name.
#[test]
fn a_record_with_no_bot_behind_it_is_no_record_never_dsh_tui_seat() {
    let env = env();
    ledger(&env, &[seat("t1", "b-captain", ago(180))]);
    // No launch on the header's terminal.
    log(
        &env,
        "sess-none",
        Some(r#""t9""#),
        ago(120),
        &[(ago(110), 10)],
    );
    // A pane with no start row, no binding and no label: by the header, and by its own label.
    log(
        &env,
        "sess-bare",
        Some(r#""t3""#),
        ago(120),
        &[(ago(110), 20)],
    );
    log(&env, "sess-label", None, ago(120), &[(ago(110), 30)]);
    // The seat's launch began after this session started.
    log(
        &env,
        "sess-early",
        Some(r#""t1""#),
        ago(240),
        &[(ago(110), 40)],
    );
    let panes = [
        pane("t3", ago(200), Labels::default()),
        pane("t4", ago(200), session_label("sess-label")),
    ];
    sync(&env, now(), &panes);
    let got = calls(&env);
    for input in [10, 20, 30, 40] {
        assert_eq!(got[&input], unlinked("no_record"), "{input}");
    }
    assert_eq!(by_bot(&env).get(&Some("b-captain".to_owned())), None);
}

// (f): two launches on the header's terminal that both cover the session's start name no launch:
// ambiguous, never a guess, even though both rows name the same bot.
#[test]
fn two_launches_covering_the_sessions_start_are_ambiguous() {
    let env = env();
    let mut uncored = seat("t1", "b-captain", ago(180));
    uncored["core"] = Value::Null;
    ledger(&env, &[seat("t1", "b-captain", ago(180)), uncored]);
    log(
        &env,
        "sess-seat",
        Some(r#""t1""#),
        ago(120),
        &[(ago(110), 10)],
    );
    sync(&env, now(), &[]);
    assert_eq!(calls(&env)[&10], ambiguous());
    assert_eq!(links(&env), [], "no launch is named, so no link is kept");
    assert_eq!(by_bot(&env).get(&Some("b-captain".to_owned())), None);
}

// (g): the header names one seat's terminal and the `agent.session` label is on another seat's
// pane, which was already running when the session started: two witnesses, two bots, ambiguous.
// On one pane, or with one bot on both, they collapse.
#[test]
fn a_header_and_a_label_naming_different_bots_are_ambiguous() {
    let rows = |second: &str| {
        [
            seat("t1", "b-captain", ago(180)),
            seat("t2", second, ago(170)),
        ]
    };
    let run = |second: &str, labelled: &str, created: i64| {
        let env = env();
        ledger(&env, &rows(second));
        log(
            &env,
            "sess-seat",
            Some(r#""t1""#),
            ago(120),
            &[(ago(110), 10)],
        );
        let panes = [pane(labelled, created, session_label("sess-seat"))];
        sync(&env, now(), &panes);
        calls(&env)[&10].clone()
    };
    assert_eq!(run("b-second", "t2", ago(170)), ambiguous());
    assert_eq!(
        run("b-second", "t1", ago(180)),
        attributed("session", "b-captain")
    );
    assert_eq!(
        run("b-captain", "t2", ago(170)),
        attributed("session", "b-captain")
    );
}

// (h): a session started in one launch and resumed in another: the header's link covers the
// first launch's span only, and the calls from the resume on are the second launch's. The resume
// is a `session` row, or the label of a pane launched after the session started.
#[test]
fn a_resumed_session_moves_to_its_second_launch_at_the_resume() {
    let seats = [
        seat("t1", "b-captain", ago(180)),
        seat("t2", "b-second", ago(60)),
    ];
    let session = |env: &Env| {
        log(
            env,
            "sess-seat",
            Some(r#""t1""#),
            ago(120),
            &[(ago(110), 10), (ago(55), 11), (ago(40), 12)],
        );
    };
    // A `session` row at minute -50.
    let env_row = env();
    let mut rows = seats.to_vec();
    rows.push(session_row("t2", ago(60), "sess-seat", ago(50)));
    ledger(&env_row, &rows);
    session(&env_row);
    sync(&env_row, now(), &[]);
    let got = calls(&env_row);
    assert_eq!(got[&10], attributed("session", "b-captain"));
    assert_eq!(got[&11], attributed("session", "b-captain"));
    assert_eq!(got[&12], attributed("session", "b-second"));
    assert_eq!(
        links(&env_row),
        [
            ("session".into(), Some(ago(120)), Some(ago(50)), false),
            ("session".into(), Some(ago(50)), None, false),
        ]
    );
    // The label of the pane launched at minute -60: the session entered that launch.
    let env_label = env();
    ledger(&env_label, &seats);
    session(&env_label);
    let panes = [pane("t2", ago(60), session_label("sess-seat"))];
    sync(&env_label, now(), &panes);
    let got = calls(&env_label);
    assert_eq!(got[&10], attributed("session", "b-captain"));
    assert_eq!(got[&11], attributed("session", "b-second"));
    assert_eq!(got[&12], attributed("session", "b-second"));
    assert_eq!(
        links(&env_label),
        [
            ("session".into(), Some(ago(120)), Some(ago(60)), false),
            ("session".into(), Some(ago(60)), None, true),
        ]
    );
}

// (i): the evidence backfill re-reads the log from its start, so the header's record comes from
// the log alone. The store is as a meter before this delivery left it: the call counted with no
// bot, no terminal kept from the header, no link, and its evidence since pruned.
#[test]
fn the_evidence_backfill_links_a_session_from_its_log_alone() {
    let env = env();
    // Yesterday's session, read while no ledger named its seat.
    let (created, at) = (ago(20 * 60), ago(19 * 60));
    log(&env, "sess-seat", Some(r#""t1""#), created, &[(at, 10)]);
    let run = |backfill: Option<i64>| {
        let mut o = env.opts();
        o.days = Some(7);
        o.snapshot = Some(Vec::new());
        o.evidence_backfill = backfill;
        env.run(&o)
    };
    run(None);
    assert_eq!(calls(&env)[&10], unlinked("no_record"));
    let store = env.store();
    let tx = store.conn.unchecked_transaction().unwrap();
    evidence::prune(&tx, now(), 1, u64::MAX).unwrap();
    tx.execute(
        "UPDATE files SET ctx = json_remove(ctx, '$.terminal') WHERE source = 'dsh-tui'",
        [],
    )
    .unwrap();
    tx.commit().unwrap();
    assert_eq!(store.count("evidence").unwrap(), 0);
    assert!(store.meta_i64(evidence::FROM_META).unwrap().unwrap() > at);
    drop(store);
    // The seat's start row is learned now. A plain sync reads nothing of the log again and has
    // no evidence to recompute: the call stays with no bot.
    ledger(&env, &[seat("t1", "b-captain", ago(30 * 60))]);
    let r = run(None);
    assert_eq!(r.files_read, 0);
    let mut none = BTreeMap::new();
    none.insert(None, 10);
    assert_eq!(by_bot(&env), none);
    assert_eq!(links(&env), []);
    // The backfill.
    let r = run(Some(7));
    let b = r.evidence_backfill.expect("a backfill ran");
    assert!(b.done, "{b:?}");
    assert_eq!((b.adopted, b.left_alone), (1, 0));
    assert_eq!(calls(&env)[&10], attributed("session", "b-captain"));
    // The row that counted it with no bot may stay, emptied: the call moved, its total did not.
    let got: BTreeMap<_, _> = by_bot(&env).into_iter().filter(|(_, n)| *n != 0).collect();
    let mut want = BTreeMap::new();
    want.insert(Some("b-captain".to_owned()), 10);
    assert_eq!(got, want);
    assert_eq!(
        links(&env),
        [("session".into(), Some(created), None, false)]
    );
}
