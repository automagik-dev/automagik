//! Issue #1114: fixed-clock, synthetic backfill preservation checks. No live inputs.
mod common;
mod scenes;

use meter::event::Tokens;
use scenes::{H, ROOT, Scene, Usage, at};
use std::collections::BTreeMap;

type Totals = BTreeMap<(String, i64), (Tokens, i64)>;

fn totals(s: &Scene) -> Totals {
    let mut out = BTreeMap::new();
    for r in s.store().rows_since(i64::MIN).unwrap() {
        let key = (r.key.harness, r.key.hour_ms / meter::time::DAY_MS);
        let entry = out.entry(key).or_insert((Tokens::default(), 0));
        entry.0.add(&r.tokens);
        entry.1 += r.events;
    }
    out
}

fn evidence_totals(s: &Scene) -> Totals {
    let mut out = BTreeMap::new();
    for call in meter::evidence::all(&s.store().conn).unwrap() {
        let key = (call.dim.harness, call.ts_ms / meter::time::DAY_MS);
        let entry = out.entry(key).or_insert((Tokens::default(), 0));
        entry.0.add(&call.tokens);
        entry.1 += 1;
    }
    out
}

fn assert_backed_rows_agree(s: &Scene) {
    let store = s.store();
    assert_eq!(
        meter::evidence::stored_rollups(&store.conn, i64::MIN).unwrap(),
        meter::evidence::implied_rollups(&store.conn).unwrap(),
        "each evidence-backed row must agree, even when global totals match"
    );
}

fn fixture(harnesses: &[H], hours: &[&str], descending: bool) -> Scene {
    let mut s = Scene::migrated("2026-11-08T12:00:00Z", &[]);
    let mut splits = [[300, 400, 0, 0, 50, 0], [100, 200, 0, 0, 30, 0]];
    if !descending {
        splits.reverse();
    }
    for &h in harnesses {
        for (i, split) in splits.into_iter().enumerate() {
            s.add(
                Usage::new(h, &format!("synthetic-{h:?}-{i}"), ROOT, None, at(hours))
                    .tokens(split)
                    .model("model-a"),
            );
        }
    }
    s.sync();
    // Use the real retention operation: rollups survive, while these calls lose evidence.
    // Merely setting evidence_from is insufficient: newly imported old calls can have evidence.
    {
        let store = s.store();
        let tx = store.conn.unchecked_transaction().unwrap();
        meter::evidence::prune(&tx, scenes::t(scenes::SYNCED), 1, u64::MAX).unwrap();
        tx.commit().unwrap();
        assert_eq!(store.count("evidence").unwrap(), 0);
    }
    // Learning a launch now gives adoption a different destination rollup. Both calls use the
    // same actor. All rollup-key fields (including the model and clock) are fixed, so their hash
    // ordering is deterministic; the random per-store evidence key is not part of a rollup ID.
    for &h in harnesses {
        let agent = match h {
            H::Claude => "claude",
            H::Dsh => "dsh-tui",
            _ => unreachable!(),
        };
        for i in 0..2 {
            let session = format!("synthetic-{h:?}-{i}");
            let terminal = format!("synthetic-terminal-{h:?}-{i}");
            s.start(scenes::Start {
                session: Some(&session),
                ..scenes::worker(
                    &terminal,
                    "synthetic-worker",
                    "dev",
                    "synthetic-team",
                    agent,
                    ROOT,
                    "synthetic-branch",
                    scenes::t("2026-11-05T00:00:00Z"),
                )
            });
        }
    }
    let before = totals(&s);
    s.sync();
    assert_eq!(
        totals(&s),
        before,
        "plain same-version sync preserves totals"
    );
    assert_eq!(s.store().count("evidence").unwrap(), 0);
    s
}

fn check_preservation(harnesses: &[H], hours: &[&str], descending: bool) {
    let mut s = fixture(harnesses, hours, descending);
    let before = totals(&s);
    let events = (harnesses.len() * hours.len() * 2) as i64;
    assert_eq!(before.len(), harnesses.len() * hours.len());
    assert_eq!(before.values().map(|v| v.1).sum::<i64>(), events);
    let r = s.sync_with(|o| o.evidence_backfill = Some(4));
    let b = r.evidence_backfill.expect("backfill ran");
    assert!(b.done, "{b:?}");
    assert_eq!(b.adopted, events as u64, "every synthetic call adopted");
    let after = totals(&s);
    let evidence = evidence_totals(&s);
    let event_counts = |m: &Totals| {
        m.iter()
            .map(|(k, v)| (k.clone(), v.1))
            .collect::<BTreeMap<_, _>>()
    };
    assert_eq!(event_counts(&after), event_counts(&before));
    assert_eq!(
        evidence, before,
        "retained evidence preserves every input column"
    );
    eprintln!("before={before:?}\nafter={after:?}\nevidence={evidence:?}");
    // These fixtures have complete evidence after backfill: frozen leftovers must not hide a
    // missing evidence-backed contribution. Check all columns, not just Tokens::total().
    assert!(
        after == before && after == evidence,
        "backfill must preserve every token column per harness/day and agree with evidence; \
         before={before:?}; after={after:?}; evidence={evidence:?}"
    );
    assert_backed_rows_agree(&s);
}

#[test]
fn evidence_backfill_preserves_every_token_column_and_event_per_harness_day() {
    check_preservation(
        &[H::Claude, H::Dsh],
        &["2026-11-06T09", "2026-11-07T09"],
        true,
    );
}

#[test]
fn ascending_calls_preserve_totals_as_a_control() {
    check_preservation(
        &[H::Claude, H::Dsh],
        &["2026-11-06T09", "2026-11-07T09"],
        false,
    );
}

#[test]
fn partial_resumed_and_repeated_backfills_preserve_totals_and_evidence() {
    let mut s = fixture(
        &[H::Claude, H::Dsh],
        &["2026-11-06T09", "2026-11-07T09"],
        true,
    );
    let before = totals(&s);
    let first = s.sync_with(|o| {
        o.evidence_backfill = Some(4);
        o.chunk_limit = Some(1);
    });
    assert!(!first.evidence_backfill.unwrap().done);
    assert_eq!(
        totals(&s),
        before,
        "partial backfill preserves every column/event"
    );
    let mut done = false;
    for _ in 0..8 {
        let r = s.sync_with(|o| o.chunk_limit = Some(1));
        assert_eq!(totals(&s), before, "every resumed chunk preserves totals");
        if r.evidence_backfill.is_none_or(|b| b.done) {
            done = true;
            break;
        }
    }
    assert!(done, "bounded fixture must finish its resumed backfill");
    assert_eq!(evidence_totals(&s), before);
    assert_backed_rows_agree(&s);
    let repeated = s.sync_with(|o| o.evidence_backfill = Some(4));
    assert_eq!(repeated.evidence_backfill.unwrap().adopted, 0);
    assert_eq!(totals(&s), before);
    assert_eq!(
        evidence_totals(&s),
        before,
        "repeating a backfill adds no evidence"
    );
    assert_backed_rows_agree(&s);
}

#[test]
fn a_missing_log_keeps_its_legitimate_unbacked_remainder() {
    let mut s = fixture(
        &[H::Claude, H::Dsh],
        &["2026-11-06T09", "2026-11-07T09"],
        true,
    );
    let before = totals(&s);
    // Only this synthetic file disappears; its two counted calls must remain frozen.
    std::fs::remove_file(s.env.claude("-work-widgets/synthetic-Claude-1.jsonl")).unwrap();
    let r = s.sync_with(|o| o.evidence_backfill = Some(4));
    let b = r.evidence_backfill.unwrap();
    assert!(b.done);
    assert_eq!((b.adopted, b.unbacked), (6, 2));
    assert_eq!(totals(&s), before);
    assert_backed_rows_agree(&s);
    let frozen = |s: &Scene| {
        let mut sum = (Tokens::default(), 0);
        for r in s.store().rows_since(i64::MIN).unwrap() {
            if r.key.attr.is_none() {
                sum.0.add(&r.tokens);
                sum.1 += r.events;
            }
        }
        sum
    };
    let expected = (
        Tokens {
            input_uncached: 100,
            cache_read: 200,
            output: 30,
            ..Tokens::default()
        },
        2,
    );
    assert_eq!(
        frozen(&s),
        expected,
        "missing-log history is not a duplicate to discard"
    );
    s.sync_with(|o| o.evidence_backfill = Some(4));
    assert_eq!(totals(&s), before);
    assert_eq!(frozen(&s), expected);
    assert_backed_rows_agree(&s);
}
