//! The query's actors (RFC 0021 delivery 6): `--by bot`, `attribution.actor`,
//! `actor_unattributed` with `absent_bot_is_zero`, and the evidence backfill that recomputes
//! attribution. The examples themselves are compared in `tests/query.rs`; these are the delivery's
//! Check and the rules around it. Synthetic fixtures only: every id, bot, path and number is made
//! up.

mod common;
mod scenes;

use common::serial;
use meter::evidence;
use scenes::{
    H, MACHINE, OTHER_CORE, ROOT, SYNCED, Scene, Start, Usage, args, at, hours, labelled,
    session_row, t, worker, wt,
};
use serde_json::Value;

fn answer(s: &Scene, by_bot: bool, branches: &[&str]) -> Value {
    let (code, raw) = s.query(&args(by_bot, branches));
    assert_eq!(code, 0, "{raw}");
    serde_json::from_str(&raw).unwrap()
}

fn int(v: &Value) -> i64 {
    v.as_i64().unwrap_or_else(|| panic!("not an integer: {v}"))
}

fn counts(row: &Value) -> [i64; 4] {
    let a = &row["attribution"]["actor"];
    [
        "tokens_attributed",
        "tokens_ambiguous",
        "tokens_unlinked",
        "tokens_before_evidence",
    ]
    .map(|k| int(&a[k]))
}

fn reasons(v: &Value) -> Vec<(String, String, i64)> {
    v["actor_unattributed"]["parts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["reason"].as_str().unwrap().to_string(),
                p["state"].as_str().unwrap().to_string(),
                int(&p["tokens_total"]),
            )
        })
        .collect()
}

// Check (delivery 6): a window straddling evidence_from puts the part before it in
// tokens_before_evidence, and the four counts add up to tokens.total. The part before is never
// attributed, even where a frozen rollup names a bot.
#[test]
fn a_window_straddling_evidence_from_counts_the_part_before_it_and_the_counts_add_up() {
    let s = scenes::straddling();
    let v = answer(&s, false, &["feat/gn-12-cache"]);
    assert_eq!(v["ingestion"]["evidence_from"], "2026-10-25T00:00:00Z");
    assert!(v["window"]["start"].as_str().unwrap() < "2026-10-25");
    let row = &v["rows"][0];
    let c = counts(row);
    assert_eq!(c, [1_678_000, 0, 0, 940_000]);
    assert_eq!(c.iter().sum::<i64>(), int(&row["tokens"]["total"]));
    // The frozen rows name otter; none of their tokens is in otter's bot row.
    let bots = answer(&s, true, &[]);
    let otter: i64 = bots["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["bot"] == "otter")
        .map(|r| int(&r["tokens"]["total"]))
        .sum();
    assert_eq!(otter, 1_500_000, "only the evidence-backed session");
    assert_eq!(
        int(&bots["actor_unattributed"]["tokens_before_evidence"]),
        1_090_000
    );
}

// Check (delivery 6): a dsh-tui worker's filled branch counts under ledger, a Claude worker's
// logged branch under log, on the branch row and on each bot row.
#[test]
fn a_dsh_tui_workers_filled_branch_is_ledger_and_a_claude_workers_logged_one_is_log() {
    let s = scenes::ledger_branch();
    let v = answer(&s, false, &["feat/gn-31-sync"]);
    let b = &v["rows"][0]["attribution"]["actor"]["tokens_by_branch_basis"];
    assert_eq!(
        (int(&b["log"]), int(&b["ledger"]), int(&b["none"])),
        (1_060_000, 1_641_000, 0)
    );
    let bots = answer(&s, true, &["feat/gn-31-sync"]);
    for r in bots["rows"].as_array().unwrap() {
        let b = &r["attribution"]["actor"]["tokens_by_branch_basis"];
        let total = int(&r["tokens"]["total"]);
        match r["harness"].as_str().unwrap() {
            "claude-code" => assert_eq!(int(&b["log"]), total),
            "dsh-tui" => assert_eq!(int(&b["ledger"]), total),
            h => panic!("no row expected for {h}"),
        }
    }
    assert_eq!(bots["rows"].as_array().unwrap().len(), 2);
}

// Check (delivery 6): a store before evidence_from (none kept yet) gives no attributed count and
// no bot: every token is before evidence, an absent bot is unknown (never a 0), and a store from
// before schema 3 is refused with no actor field at all.
#[test]
fn a_store_before_evidence_names_no_bot_and_never_vouches_for_an_absent_one() {
    let s = scenes::no_evidence();
    let v = answer(&s, false, &["feat/gn-12-cache"]);
    assert_eq!(v["ingestion"]["evidence_from"], Value::Null);
    let row = &v["rows"][0];
    assert_eq!(counts(row), [0, 0, 0, int(&row["tokens"]["total"])]);
    let bots = answer(&s, true, &[]);
    assert_eq!(bots["rows"], serde_json::json!([]));
    assert_eq!(bots["actor_unattributed"]["absent_bot_is_zero"], false);
    assert_eq!(
        int(&bots["actor_unattributed"]["tokens_before_evidence"]),
        int(&bots["actor_unattributed"]["tokens_total"])
    );
    // A schema 2 store: the query refuses it (only sync migrates), with no actor field.
    let old = scenes::Scene::migrated("2026-09-11T23:30:00Z", &[]);
    old.store().set_meta("schema_version", "2").unwrap();
    let (code, raw) = old.query(&args(true, &[]));
    assert_eq!(code, 13, "{raw}");
    let v: Value = serde_json::from_str(&raw).unwrap();
    assert!(v.get("actor_unattributed").is_none() && v["rows"] == serde_json::json!([]));
}

// absent_bot_is_zero: true only in a bot answer with nothing given to no bot and every zero
// condition of the whole answer; under a branch filter, usage with no branch (which could be an
// absent bot's on a branch named) makes it false even when every token has a bot.
#[test]
fn an_absent_bot_is_zero_only_in_a_bot_answer_where_every_condition_holds() {
    let s = scenes::bots();
    let flag = |v: &Value| v["actor_unattributed"]["absent_bot_is_zero"].clone();
    assert_eq!(flag(&answer(&s, true, &[])), true);
    assert_eq!(flag(&answer(&s, true, &["feat/gn-31-sync"])), true);
    assert_eq!(
        flag(&answer(&s, false, &["feat/gn-31-sync"])),
        false,
        "a branch answer"
    );
    // Every token has a bot, but an omp seat's has no branch.
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let c19 = t("2026-11-02T08:00:00Z");
    s.start(Start {
        kind: "seat",
        branch: None,
        ..worker("t19", "wren", "captain", "wren", "omp", ROOT, "", c19)
    });
    s.snapshot.push(labelled("t19", c19, "omp", ROOT, "o-wren"));
    s.add(
        Usage::new(
            H::Omp,
            "o-wren",
            ROOT,
            None,
            at(&["2026-11-03T08", "2026-11-04T08"]),
        )
        .tokens([3000, 25000, 0, 0, 2000, 0]),
    );
    s.add(
        Usage::new(
            H::Claude,
            "s-wren",
            ROOT,
            Some("main"),
            at(&["2026-11-03T09"]),
        )
        .tokens([1000, 9000, 0, 0, 500, 0]),
    );
    s.ledger_row(session_row("t19", c19, "s-wren", "claude", c19 + 60_000));
    s.sync();
    let all = answer(&s, true, &[]);
    assert_eq!(int(&all["actor_unattributed"]["tokens_total"]), 0);
    assert_eq!(flag(&all), true);
    let filtered = answer(&s, true, &["main"]);
    assert!(int(&filtered["unattributed"]["tokens_total"]) > 0);
    assert_eq!(flag(&filtered), false);
    for r in filtered["rows"].as_array().unwrap() {
        assert_eq!(r["attribution"]["coverage"], "partial");
    }
    // A stopped sync's backlog: unknown, never 0.
    let b = scenes::bots_backlog();
    assert_eq!(flag(&answer(&b, true, &[])), false);
}

// D5's reasons: a session that another computer's records name is other_machine, whether a
// start row of another core or a session label on a linked machine's pane says so; a dsh-tui
// session nothing claims is dsh_tui_seat; anything else no_record.
#[test]
fn usage_given_to_no_bot_says_why() {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let c = t("2026-11-01T08:00:00Z");
    s.start(Start {
        kind: "seat",
        session: Some("s-ledger-away"),
        branch: None,
        core: OTHER_CORE,
        ..worker("t3", "swift", "captain", "swift", "claude", ROOT, "", c)
    });
    // A pane hc lists on a linked machine (its address holds a `/`).
    s.snapshot
        .push(labelled("peer/t4", c, "claude-code", ROOT, "s-label-away"));
    for (h, session, tokens) in [
        (H::Claude, "s-ledger-away", 1000),
        (H::Claude, "s-label-away", 2000),
        (H::Claude, "s-nobody", 4000),
        (H::Dsh, "d-root", 8000),
        (H::Omp, "o-root", 16000),
    ] {
        let branch = (h == H::Claude).then_some("main");
        s.add(
            Usage::new(h, session, ROOT, branch, at(&["2026-11-02T10"]))
                .tokens([tokens, 0, 0, 0, 0, 0]),
        );
    }
    s.sync();
    let v = answer(&s, true, &[]);
    assert_eq!(
        reasons(&v),
        [
            ("no_record".into(), "unlinked".into(), 20000),
            ("dsh_tui_seat".into(), "unlinked".into(), 8000),
            ("other_machine".into(), "unlinked".into(), 3000),
        ]
    );
    assert_eq!(v["rows"], serde_json::json!([]));
    // The machine's own core stays this machine's.
    assert_eq!(v["machine"]["id"], MACHINE);
}

/// otter's Claude Code session on `feat/gn-40-old`, run before 10-25 and again after, with no
/// ledger yet: its calls are unlinked. Then the retention bound drops the evidence before 10-25,
/// as the size bound would, so those hours are before evidence.
fn pruned() -> Scene {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let w = wt("gn-40");
    s.add(
        Usage::new(
            H::Claude,
            "s-old",
            &w,
            Some("feat/gn-40-old"),
            hours("2026-10-12T10:00:00Z", "2026-10-20T10:00:00Z", 5),
        )
        .tokens([5000, 50000, 1000, 0, 2000, 100]),
    );
    s.add(
        Usage::new(
            H::Dsh,
            "d-old",
            &w,
            None,
            at(&["2026-10-15T09", "2026-11-03T09"]),
        )
        .tokens([7000, 70000, 0, 0, 3000, 0]),
    );
    s.add(
        Usage::new(
            H::Claude,
            "s-new",
            &w,
            Some("feat/gn-40-old"),
            hours("2026-11-01T10:00:00Z", "2026-11-05T10:00:00Z", 3),
        )
        .tokens([3000, 30000, 0, 0, 1000, 0]),
    );
    s.sync();
    let store = s.store();
    let tx = store.conn.unchecked_transaction().unwrap();
    evidence::prune(&tx, t(SYNCED), 15, u64::MAX).unwrap();
    tx.commit().unwrap();
    assert_eq!(
        store.meta_i64(evidence::FROM_META).unwrap(),
        Some(t("2026-10-25T00:00:00Z"))
    );
    drop(store);
    // The worker's start row is learned now: its sessions and its worktree.
    s.start(Start {
        session: Some("s-old"),
        ..worker(
            "t40",
            "otter",
            "dev",
            "lark",
            "claude",
            &w,
            "feat/gn-40-old",
            t("2026-10-01T08:00:00Z"),
        )
    });
    s.start(worker(
        "t41",
        "otter",
        "dev",
        "lark",
        "dsh-tui",
        &w,
        "feat/gn-40-old",
        t("2026-10-01T09:00:00Z"),
    ));
    s.ledger_row(session_row(
        "t40",
        t("2026-10-01T08:00:00Z"),
        "s-new",
        "claude",
        t("2026-10-31T08:00:00Z"),
    ));
    s
}

fn totals(s: &Scene) -> meter::event::Tokens {
    let mut sum = meter::event::Tokens::default();
    for r in s.store().rows_since(i64::MIN).unwrap() {
        sum.add(&r.tokens);
    }
    sum
}

fn assert_rollups_agree(s: &Scene) {
    let store = s.store();
    let from = store.meta_i64(evidence::FROM_META).unwrap().unwrap();
    let implied = evidence::implied_rollups(&store.conn).unwrap();
    let stored: std::collections::BTreeMap<_, _> = evidence::stored_rollups(&store.conn, from)
        .unwrap()
        .into_iter()
        .collect();
    assert_eq!(implied, stored);
}

// The backfill (RFC 0021 (c), operator-run): it gives the hours before evidence_from their
// evidence from the logs still on disk, recomputes the attribution of every call from its start,
// and never changes a total; actor_unattributed falls for the backfilled hours.
#[test]
fn the_evidence_backfill_recomputes_attribution_and_keeps_every_total() {
    let mut s = pruned();
    let before = totals(&s);
    // The ledger alone moves only the calls with evidence.
    s.sync();
    let v = answer(&s, true, &[]);
    // s-old's five calls, and the first of d-old's two (the other is after 10-25).
    let old_part = 58000 + 40000;
    assert_eq!(
        int(&v["actor_unattributed"]["tokens_before_evidence"]),
        old_part
    );
    assert_eq!(totals(&s), before);

    let r = s.sync_with(|o| o.evidence_backfill = Some(30));
    let b = r.evidence_backfill.expect("a backfill ran");
    assert!(b.done, "{b:?}");
    assert_eq!(b.from_ms, t("2026-10-10T00:00:00Z"));
    assert_eq!((b.adopted, b.left_alone), (6, 0));
    assert_eq!(totals(&s), before, "a backfill never changes a total");
    assert_rollups_agree(&s);
    let store = s.store();
    assert_eq!(
        store.meta_i64(evidence::FROM_META).unwrap(),
        Some(b.from_ms)
    );
    assert_eq!(store.meta(evidence::BACKFILL_META).unwrap(), None);
    assert_eq!(store.count("evidence").unwrap(), 5 + 2 + 3);
    drop(store);
    let v = answer(&s, true, &[]);
    assert_eq!(int(&v["actor_unattributed"]["tokens_total"]), 0);
    assert_eq!(v["actor_unattributed"]["absent_bot_is_zero"], true);
    let by: Vec<(String, i64)> = v["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["harness"].as_str().unwrap().into(),
                int(&r["tokens"]["total"]),
            )
        })
        .collect();
    assert_eq!(
        by,
        [
            ("claude-code".into(), 58000 + 34000),
            ("dsh-tui".into(), 80000)
        ]
    );
    // dsh-tui's old call takes its worker's branch too, now that it has a launch.
    let row = answer(&s, false, &["feat/gn-40-old"]);
    assert_eq!(int(&row["unattributed"]["tokens_total"]), 0);

    // Done: a later sync does nothing more of it.
    let r = s.sync_with(|_| {});
    assert!(r.evidence_backfill.is_none());
}

// Chunked and resumable: a backfill stopped by the budget goes on at the next sync from where it
// stopped, and ends where one run would have.
#[test]
fn a_backfill_stopped_by_its_budget_resumes_on_the_next_sync() {
    let mut once = pruned();
    once.sync_with(|o| o.evidence_backfill = Some(30));
    let want = answer(&once, true, &[]);

    let mut s = pruned();
    let before = totals(&s);
    let r = s.sync_with(|o| {
        o.evidence_backfill = Some(30);
        o.chunk_limit = Some(1);
    });
    let b = r.evidence_backfill.unwrap();
    assert!(!b.done, "{b:?}");
    assert!(s.store().meta(evidence::BACKFILL_META).unwrap().is_some());
    assert_eq!(totals(&s), before);
    let mut runs = 1;
    loop {
        let r = s.sync_with(|o| o.chunk_limit = Some(1));
        runs += 1;
        if r.evidence_backfill.is_none_or(|b| b.done) {
            break;
        }
        assert!(runs < 10);
    }
    assert!(runs >= 2);
    assert_eq!(totals(&s), before);
    assert_rollups_agree(&s);
    let mut got = answer(&s, true, &[]);
    let mut want = want;
    for v in [&mut got, &mut want] {
        v["as_of"] = Value::Null;
    }
    assert_eq!(got["rows"], want["rows"]);
    assert_eq!(got["actor_unattributed"], want["actor_unattributed"]);
}

// Frozen rollups (written before schema 3, a bot in their tag and no state) have no log to
// re-read: a backfill leaves them as they are, and they stay before evidence, never attributed.
#[test]
fn a_backfill_never_attributes_a_frozen_row() {
    let mut s = scenes::straddling();
    let before = totals(&s);
    let r = s.sync_with(|o| o.evidence_backfill = Some(30));
    assert!(r.evidence_backfill.unwrap().done);
    assert_eq!(totals(&s), before);
    let v = answer(&s, false, &["feat/gn-12-cache"]);
    assert_eq!(v["ingestion"]["evidence_from"], "2026-10-10T00:00:00Z");
    assert_eq!(counts(&v["rows"][0]), [1_678_000, 0, 0, 940_000]);
}

// --days never asks past the retention bound (RFC 0021 delivery 8's Acceptance), and the backfill
// always says how far back it goes.
#[test]
fn the_backfill_asks_no_further_back_than_the_retention() {
    let env = common::Env::new();
    let _g = serial();
    for (a, ok) in [
        (vec!["--evidence-backfill", "--days", "91"], false),
        (vec!["--evidence-backfill"], false),
        (
            vec!["--evidence-backfill", "--days", "30", "--backfill"],
            false,
        ),
    ] {
        let out = env
            .command()
            .env("METER_STATE_DIR", env.state())
            .arg("sync")
            .args(&a)
            .arg("--no-publish")
            .output()
            .unwrap();
        assert_eq!(out.status.success(), ok, "{a:?}");
        assert_eq!(out.status.code(), Some(2), "{a:?}");
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(
            err.contains("--days") || err.contains("--backfill"),
            "{err}"
        );
    }
    let out = env
        .command()
        .env("METER_STATE_DIR", env.state())
        .args([
            "sync",
            "--evidence-backfill",
            "--days",
            "90",
            "--no-publish",
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("evidence backfill from"));
}
