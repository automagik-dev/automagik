//! RFC 0026 delivery 2, the bot-tag coverage report: T1 (a class is counted, not hidden), T2
//! (one source of truth with the query's `--by bot` and branch answers, the 50-bot and 50-repo
//! caps), T8 (a report changes nothing), and the verb's exit codes. The (g) ceilings are measured
//! by [`coverage_ceiling`], which runs only on the RFC 0018 reference store (`CEILING_DIR`).
//!
//! Synthetic fixtures only: `example.com` repos, made-up bots, branches and paths.

mod common;
mod scenes;

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::Output;
use std::time::Duration;

use common::serial;
use meter::coverage;
use meter::paths::StateDirs;
use meter::query::{self, Ctx};
use serde_json::{Value, json};

use scenes::{
    COUNTED_FROM, Frozen, H, MACHINE, OTHER_CORE, REPO, ROOT, SYNCED, Scene, Start, Usage, at, t,
    worker, wt,
};

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
    let r = coverage::run(&args(a), &ctx(s));
    assert_eq!(r.code, 0, "{}", r.stderr.unwrap_or_default());
    assert!(r.stdout.ends_with('\n') && !r.stdout[..r.stdout.len() - 1].contains('\n'));
    serde_json::from_str(&r.stdout).unwrap()
}

fn int(v: &Value) -> i64 {
    v.as_i64().unwrap_or_else(|| panic!("not an integer: {v}"))
}

/// The window named `name` of a record.
fn window<'a>(v: &'a Value, name: &str) -> &'a Value {
    v["windows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["window"] == name)
        .unwrap_or_else(|| panic!("no {name} window in {v}"))
}

/// The five classes by reason, tokens and harnesses.
fn parts(w: &Value) -> BTreeMap<String, (i64, Vec<String>)> {
    w["parts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["reason"].as_str().unwrap().to_string(),
                (
                    int(&p["tokens"]),
                    p["harnesses"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|h| h.as_str().unwrap().to_string())
                        .collect(),
                ),
            )
        })
        .collect()
}

/// T1's store: one attributed call and one call in each of the five classes. The attributed call
/// is a worker's named session; the ambiguous one is a session in a worktree two differently
/// tagged workers share; `no_record` is omp usage nothing records; `dsh_tui_seat` a dsh-tui seat
/// in the project root; `other_machine` a Claude session another computer's start row names; and
/// `before_evidence` a frozen schema 2 rollup, still carrying its old bot tag, in the d30 window
/// but before `evidence_from`. Tokens are distinct per class so every sum is checkable.
fn classes() -> Scene {
    let frozen = Frozen {
        bot: Some("frozen-bot"),
        harness: "claude-code",
        model: scenes::OPUS,
        branch: Some("feat/cov-old"),
        hour: t("2026-10-15T10:00:00Z"),
        tokens: [1000, 9000, 0, 0, 1000, 5],
    };
    let mut s = Scene::migrated("2026-10-20T23:30:00Z", &[frozen]);
    let base = t("2026-11-08T09:00:00Z");
    let (w1, wamb) = (wt("cov-1"), wt("cov-amb"));
    // One launch names its session: attributed.
    s.start(Start {
        session: Some("s-att"),
        ..worker(
            "t1",
            "otter",
            "dev",
            "lark",
            "claude",
            &w1,
            "feat/cov-1",
            base,
        )
    });
    // Two bots launch on one worktree: a session no row names that started there is ambiguous.
    s.start(worker(
        "t2",
        "otter",
        "dev",
        "lark",
        "claude",
        &wamb,
        "feat/cov-amb",
        base + 600_000,
    ));
    s.start(worker(
        "t3",
        "heron",
        "review",
        "lark",
        "claude",
        &wamb,
        "feat/cov-amb",
        base + 600_000,
    ));
    // Another computer's start row names this Claude session: other_machine here.
    s.start(Start {
        kind: "seat",
        session: Some("s-away"),
        branch: None,
        core: OTHER_CORE,
        ..worker(
            "t9",
            "swift",
            "captain",
            "swift",
            "claude",
            ROOT,
            "",
            base + 1_200_000,
        )
    });
    s.add(
        Usage::new(
            H::Claude,
            "s-att",
            &w1,
            Some("feat/cov-1"),
            at(&["2026-11-08T10"]),
        )
        .tokens([100, 900, 0, 0, 100, 0]),
    );
    s.add(
        Usage::new(
            H::Claude,
            "s-amb",
            &wamb,
            Some("feat/cov-amb"),
            at(&["2026-11-08T11"]),
        )
        .tokens([200, 1800, 0, 0, 200, 0]),
    );
    s.add(
        Usage::new(H::Omp, "o-root", ROOT, None, at(&["2026-11-08T12"]))
            .tokens([300, 2700, 0, 0, 300, 0]),
    );
    s.add(
        Usage::new(H::Dsh, "d-seat", ROOT, None, at(&["2026-11-08T13"]))
            .tokens([400, 3600, 0, 0, 400, 0]),
    );
    s.add(
        Usage::new(
            H::Claude,
            "s-away",
            ROOT,
            Some("main"),
            at(&["2026-11-08T14"]),
        )
        .tokens([500, 4500, 0, 0, 500, 0]),
    );
    s.sync();
    s
}

/// T1: the parts and the attributed tokens add up to the total, every class prints its tokens and
/// harnesses, and the headline is the attributed share, below 1.
///
/// The two mutations fail here: dropping a class from the denominator changes `bot_coverage`
/// (0.04 in d30 and 0.0667 in d1), and folding `dsh_tui_seat` into `no_record` changes the
/// `no_record` part's tokens (3300 would become 7700) and its harnesses (`[omp]` would gain
/// `dsh-tui`).
#[test]
fn t1_every_class_is_counted_and_none_is_hidden() {
    let s = classes();
    let v = report(&s, &["--json"]);
    println!("{}", serde_json::to_string_pretty(&v).unwrap());
    assert_eq!(v["v"], 1);
    assert_eq!(v["schema_version"], 3);
    assert_eq!(v["machine"], MACHINE);
    assert_eq!(v["counted_from"], COUNTED_FROM);
    // The schema 2 rollup's old tag put evidence from the hour after the migration.
    assert_eq!(v["evidence_from"], "2026-10-21T00:00:00Z");
    // The oldest launch row is the attributed worker's.
    assert_eq!(v["records_from"], "2026-11-08T09:00:00Z");

    let d1 = window(&v, "d1");
    assert_eq!(d1["evidence"], "full");
    // 1100 attributed + 2200 ambiguous + 3300 + 4400 + 5500 unlinked.
    assert_eq!(
        [
            int(&d1["totals"]["attributed"]),
            int(&d1["totals"]["ambiguous"]),
            int(&d1["totals"]["unlinked"]),
            int(&d1["totals"]["before_evidence"]),
            int(&d1["totals"]["total"]),
        ],
        [1100, 2200, 13200, 0, 16500]
    );
    assert_eq!(d1["bot_coverage"], json!(0.0667));
    assert_eq!(d1["inspected"], json!(0.0667));
    assert_eq!(int(&d1["before_evidence_tagged"]), 0);

    let d30 = window(&v, "d30");
    assert_eq!(d30["evidence"], "partial");
    assert_eq!(
        [
            int(&d30["totals"]["attributed"]),
            int(&d30["totals"]["ambiguous"]),
            int(&d30["totals"]["unlinked"]),
            int(&d30["totals"]["before_evidence"]),
            int(&d30["totals"]["total"]),
        ],
        [1100, 2200, 13200, 11000, 27500]
    );
    // 1100 / 27500 = 0.04; 1100 / 16500 = 0.0667 (the part the meter can vouch for).
    assert_eq!(d30["bot_coverage"], json!(0.04));
    assert_eq!(d30["inspected"], json!(0.0667));
    assert_eq!(int(&d30["before_evidence_tagged"]), 11000);
    // The headline is a ratio below 1, never a whole answer.
    assert!(d30["bot_coverage"].as_f64().unwrap() < 1.0);

    // Every class prints its tokens and its harnesses.
    let p = parts(d30);
    assert_eq!(
        p["claimants_differ"],
        (2200, vec!["claude-code".to_string()])
    );
    assert_eq!(p["no_record"], (3300, vec!["omp".to_string()]));
    assert_eq!(p["dsh_tui_seat"], (4400, vec!["dsh-tui".to_string()]));
    assert_eq!(p["other_machine"], (5500, vec!["claude-code".to_string()]));
    assert_eq!(
        p["before_evidence"],
        (11000, vec!["claude-code".to_string()])
    );
    assert_eq!(
        p["claimants_differ"].0
            + p["no_record"].0
            + p["dsh_tui_seat"].0
            + p["other_machine"].0
            + p["before_evidence"].0
            + int(&d30["totals"]["attributed"]),
        int(&d30["totals"]["total"])
    );

    // The repo line is the window, and the bot line is the numerator's split.
    assert_eq!(int(&d30["repos_shown"]), 1);
    assert_eq!(d30["repos"][0]["repo"], REPO);
    assert_eq!(d30["repos"][0]["state"], "measured");
    assert_eq!(int(&d30["repos"][0]["totals"]["total"]), 27500);
    assert_eq!(d30["repos"][0]["bot_coverage"], json!(0.04));
    assert_eq!(int(&d30["bots_shown"]), 1);
    assert_eq!(d30["bots"][0]["bot"], "otter");
    assert_eq!(int(&d30["bots"][0]["tokens"]), 1100);
    assert_eq!(int(&d30["bots"][0]["tokens_by_basis"]["session"]), 1100);
    assert_eq!(d30["bots"][0]["unrecorded"], json!([]));
    let shares: f64 = d30["bots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["share"].as_f64().unwrap())
        .sum();
    assert!((shares - 1100.0 / 27500.0).abs() < 1e-12, "{shares}");
    assert_eq!(int(&d30["no_repo"]["tokens"]), 0);
    assert_eq!(d30["truncated"], false);

    // The text report says the same, and always marks inspected as the diagnostic.
    let r = coverage::run(&args(&["--window", "d30"]), &ctx(&s));
    assert_eq!(r.code, 0, "{:?}", r.stderr);
    let text = r.stdout;
    assert!(text.contains("bot_coverage 0.0400"), "{text}");
    assert!(text.contains("over counted usage"), "{text}");
    assert!(text.contains("inspected 0.0667"), "{text}");
    assert!(text.contains("before_evidence_tagged 11000"), "{text}");
    assert!(text.contains("dsh_tui_seat"), "{text}");
    assert!(text.contains("no_repo 0 tokens"), "{text}");
    assert!(text.contains("outside the denominator"), "{text}");
    assert!(
        text.contains("evidence partial"),
        "the window straddles evidence: {text}"
    );
}

/// T2: for the same store and window the report's counts are the query's `--by bot` answer: the
/// bot rows plus `actor_unattributed`, the parts equal, and every bot line is its bot rows' sum.
#[test]
fn t2_the_by_bot_answer_is_the_same_arithmetic() {
    let s = classes();
    let v = report(&s, &["--json", "--window", "d30"]);
    let d30 = window(&v, "d30");
    let (code, raw) = s.query(&scenes::args(true, &[]));
    assert_eq!(code, 0, "{raw}");
    let q: Value = serde_json::from_str(&raw).unwrap();
    let bot_rows = q["rows"].as_array().unwrap();
    let by_bot: i64 = bot_rows.iter().map(|r| int(&r["tokens"]["total"])).sum();
    let unattributed = int(&q["actor_unattributed"]["tokens_total"]);
    assert_eq!(
        by_bot + unattributed,
        int(&d30["totals"]["total"]),
        "the bot rows plus actor_unattributed are the report's total"
    );
    assert_eq!(by_bot, int(&d30["totals"]["attributed"]));
    for (count, part) in [
        ("ambiguous", "tokens_ambiguous"),
        ("unlinked", "tokens_unlinked"),
        ("before_evidence", "tokens_before_evidence"),
    ] {
        assert_eq!(
            int(&q["actor_unattributed"][part]),
            int(&d30["totals"][count]),
            "{part}"
        );
    }
    // The query's parts are the report's five classes (it prints only the ones it holds).
    let mut q_parts: BTreeMap<String, (i64, Vec<String>)> = BTreeMap::new();
    for p in q["actor_unattributed"]["parts"].as_array().unwrap() {
        q_parts.insert(
            p["reason"].as_str().unwrap().to_string(),
            (
                int(&p["tokens_total"]),
                p["harnesses"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|h| h.as_str().unwrap().to_string())
                    .collect(),
            ),
        );
    }
    let report_parts: BTreeMap<String, (i64, Vec<String>)> = parts(d30)
        .into_iter()
        .filter(|(_, (tokens, _))| *tokens > 0)
        .collect();
    assert_eq!(q_parts, report_parts);

    // Every bot line is the sum of the query's bot-key rows for that bot id.
    let mut by_id: BTreeMap<String, i64> = BTreeMap::new();
    for r in bot_rows {
        *by_id
            .entry(r["bot"].as_str().unwrap().to_string())
            .or_default() += int(&r["tokens"]["total"]);
    }
    let report_bots: BTreeMap<String, i64> = d30["bots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| (b["bot"].as_str().unwrap().to_string(), int(&b["tokens"])))
        .collect();
    assert_eq!(report_bots, by_id);
    assert_eq!(
        report_bots.values().copied().sum::<i64>(),
        int(&d30["totals"]["attributed"])
    );

    // A branch answer: each row's actor counts are part of the report's totals for the repo, and
    // the rows plus the usage with no branch are the report's total.
    let (code, raw) = s.query(&scenes::args(
        false,
        &["feat/cov-1", "feat/cov-amb", "feat/cov-old", "main"],
    ));
    assert_eq!(code, 0, "{raw}");
    let b: Value = serde_json::from_str(&raw).unwrap();
    let rows = b["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 4);
    let mut row_total = 0;
    let mut row_attributed = 0;
    let mut row_ambiguous = 0;
    for r in rows {
        let a = &r["attribution"]["actor"];
        let counts = [
            int(&a["tokens_attributed"]),
            int(&a["tokens_ambiguous"]),
            int(&a["tokens_unlinked"]),
            int(&a["tokens_before_evidence"]),
        ];
        assert_eq!(counts.iter().sum::<i64>(), int(&r["tokens"]["total"]));
        row_total += int(&r["tokens"]["total"]);
        row_attributed += counts[0];
        row_ambiguous += counts[1];
    }
    assert_eq!(
        row_total + int(&b["unattributed"]["tokens_total"]),
        int(&d30["totals"]["total"])
    );
    assert_eq!(row_attributed, int(&d30["totals"]["attributed"]));
    assert_eq!(row_ambiguous, int(&d30["totals"]["ambiguous"]));
}

/// T2's cap: with more than 50 bots the omitted ones are summed into the other line, flagged a
/// lower bound, and every total still includes every bot.
#[test]
fn t2_more_than_50_bots_are_capped_counted_and_summed() {
    let s = many_bots();
    let v = report(&s, &["--json", "--window", "d1"]);
    let d1 = window(&v, "d1");
    assert_eq!(
        int(&d1["totals"]["attributed"]),
        int(&d1["totals"]["total"])
    );
    assert_eq!(d1["bot_coverage"], json!(1.0));
    let (code, raw) = s.query(&scenes::args(true, &[]));
    assert_eq!(code, 0, "{raw}");
    let q: Value = serde_json::from_str(&raw).unwrap();
    let mut by_id: BTreeMap<String, i64> = BTreeMap::new();
    for r in q["rows"].as_array().unwrap() {
        *by_id
            .entry(r["bot"].as_str().unwrap().to_string())
            .or_default() += int(&r["tokens"]["total"]);
    }
    assert_eq!(by_id.len(), 55);

    assert_eq!(int(&d1["bots_shown"]), 50);
    assert_eq!(int(&d1["bots_omitted"]), 5);
    assert_eq!(d1["truncated"], true);
    let shown: BTreeMap<String, i64> = d1["bots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| (b["bot"].as_str().unwrap().to_string(), int(&b["tokens"])))
        .collect();
    assert_eq!(shown.len(), 50);
    let omitted: BTreeMap<String, i64> = by_id
        .iter()
        .filter(|(b, _)| !shown.contains_key(*b))
        .map(|(b, t)| (b.clone(), *t))
        .collect();
    assert_eq!(omitted.len(), 5);
    // The 50 shown are the 50 largest by tokens: the 5 omitted are the smallest.
    let shown_min = *shown.values().min().unwrap();
    assert!(omitted.values().all(|t| *t <= shown_min));
    let other = &d1["bots_other"];
    assert_eq!(other["bot"], "other");
    assert_eq!(other["lower_bound"], true);
    assert_eq!(
        int(&other["tokens"]),
        omitted.values().copied().sum::<i64>()
    );
    // Every total is complete: shown + other is every attributed token, and the bot rows agree.
    assert_eq!(
        shown.values().copied().sum::<i64>() + int(&other["tokens"]),
        int(&d1["totals"]["attributed"])
    );
    assert_eq!(
        int(&d1["totals"]["total"]),
        by_id.values().copied().sum::<i64>()
    );
    // The text report prints the other line with the count, so a reader sees the cap.
    let r = coverage::run(&args(&["--window", "d1"]), &ctx(&s));
    assert_eq!(r.code, 0, "{:?}", r.stderr);
    assert!(r.stdout.contains("5 bots omitted"), "{}", r.stdout);
    // The contract's unrecorded field stays visible on bot-10's line.
    let b10 = shown["bot-10"];
    let line = d1["bots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["bot"] == "bot-10")
        .unwrap();
    assert_eq!(line["unrecorded"], json!(["squad"]));
    assert_eq!(int(&line["tokens_unrecorded"]), b10);
}

/// (g)'s repo cap: 55 repos, 50 shown, the rest summed into the other line, every total complete.
#[test]
fn the_repo_list_is_capped_counted_and_summed() {
    let s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let store = s.store();
    let hour = t("2026-11-08T10:00:00Z");
    let mut expected = 0;
    for i in 0..55i64 {
        let tokens = 1000 * (i + 1);
        expected += tokens;
        store
            .conn
            .execute(
                "INSERT INTO usage(id, hour_ms, harness, model, machine, repo, branch,
                   input_uncached, cache_read, cache_write_5m, cache_write_1h, output, reasoning,
                   unsplit, precision, reported_usd, events, updated_ms, actor_state, bot, role,
                   squad, kind, basis, branch_basis, reason)
                 VALUES(?1, ?2, 'claude-code', 'claude-opus-5-5', ?3, ?4, 'feat/cov-many',
                    ?5, 0, 0, 0, 0, 0, 0, 'exact', NULL, 1, ?6, 'attributed', 'otter', 'dev',
                    'lark', 'worker', 'session', 'log', NULL)",
                rusqlite::params![
                    format!("cov-repo-{i}"),
                    hour,
                    MACHINE,
                    format!("example.com/acme/repo-{i:02}"),
                    tokens,
                    hour
                ],
            )
            .unwrap();
    }
    // The rows are the store's; only the watermark says which hours a window ends at.
    store
        .set_meta("last_run_ms", &t(SYNCED).to_string())
        .unwrap();
    drop(store);
    let v = report(&s, &["--json", "--window", "d1"]);
    let d1 = window(&v, "d1");
    assert_eq!(int(&d1["totals"]["total"]), expected);
    assert_eq!(int(&d1["totals"]["attributed"]), expected);
    assert_eq!(int(&d1["repos_shown"]), 50);
    assert_eq!(int(&d1["repos_omitted"]), 5);
    assert_eq!(d1["truncated"], true);
    let shown: i64 = d1["repos"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| int(&r["totals"]["total"]))
        .sum();
    let other = &d1["repos_other"];
    assert_eq!(other["state"], "other");
    assert_eq!(shown + int(&other["totals"]["total"]), expected);
    // The five smallest repos are the omitted ones, summed.
    let smallest: i64 = (0..5).map(|i| 1000 * (i + 1)).sum();
    assert_eq!(int(&other["totals"]["total"]), smallest);
    // One bot line holds all of it.
    assert_eq!(d1["bots_shown"], 1);
    assert_eq!(int(&d1["bots"][0]["tokens"]), expected);
}

/// A repo named with no counted usage is `no_usage` with a null ratio, never a 0, and the window
/// is null too.
#[test]
fn a_named_repo_with_no_usage_is_no_usage_and_never_a_zero() {
    let s = classes();
    let v = report(
        &s,
        &[
            "--json",
            "--window",
            "d1",
            "--repo",
            "example.com/acme/empty",
        ],
    );
    let d1 = window(&v, "d1");
    assert_eq!(int(&d1["totals"]["total"]), 0);
    assert_eq!(d1["bot_coverage"], Value::Null);
    assert_eq!(d1["inspected"], Value::Null);
    assert_eq!(int(&d1["repos_shown"]), 1);
    assert_eq!(d1["repos"][0]["repo"], "example.com/acme/empty");
    assert_eq!(d1["repos"][0]["state"], "no_usage");
    assert_eq!(d1["repos"][0]["bot_coverage"], Value::Null);
    let r = coverage::run(
        &args(&["--window", "d1", "--repo", "example.com/acme/empty"]),
        &ctx(&s),
    );
    assert!(r.stdout.contains("bot_coverage null"), "{}", r.stdout);
}

/// A window wholly before evidence (or a store that kept none) counts every token as before
/// evidence: bot coverage is a measured 0, never an unknown, and the text says so in words.
#[test]
fn a_window_with_no_evidence_is_a_measured_zero_in_words() {
    let s = scenes::no_evidence();
    let v = report(&s, &["--json", "--window", "d1"]);
    let d1 = window(&v, "d1");
    assert_eq!(d1["evidence"], "none");
    assert_eq!(d1["totals"]["attributed"], 0);
    assert!(int(&d1["totals"]["total"]) > 0);
    assert_eq!(d1["bot_coverage"], json!(0.0));
    assert_eq!(d1["inspected"], Value::Null);
    assert_eq!(d1["bots_shown"], 0);
    let r = coverage::run(&args(&["--window", "d1"]), &ctx(&s));
    assert_eq!(r.code, 0, "{:?}", r.stderr);
    assert!(
        r.stdout.contains("evidence none") && r.stdout.contains("a measured 0, not unknown"),
        "{}",
        r.stdout
    );
}

/// T8: every file of the state folder keeps its bytes (the query's companion rule: SQLite may
/// add an empty -wal and a -shm).
#[test]
fn t8_a_report_never_changes_the_state_folder() {
    let s = classes();
    let before = folder(&s.env.state());
    assert!(before.contains_key("meter.db"), "{:?}", before.keys());
    let _g = serial();
    for a in [vec!["coverage", "--json"], vec!["coverage"]] {
        let out = bin(&s, &a);
        assert_eq!(
            out.status.code(),
            Some(0),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(out.stderr.is_empty());
        same_folder(&folder(&s.env.state()), &before, "coverage");
    }
    // A refusal leaves it as it was too: a newer store says so and writes nothing.
    s.store().set_meta("schema_version", "4").unwrap();
    let before = folder(&s.env.state());
    let out = bin(&s, &["coverage", "--json"]);
    assert_eq!(out.status.code(), Some(12));
    same_folder(&folder(&s.env.state()), &before, "a newer store");
    s.store().set_meta("schema_version", "3").unwrap();
}

/// The verb's exits follow the query's store states: 2 bad request, 10 no store, 12 a newer
/// store, 13 a store only sync can migrate.
#[test]
fn exit_codes_follow_the_query_store_states() {
    let s = classes();
    let r = coverage::run(&args(&["--window", "d2"]), &ctx(&s));
    assert_eq!(r.code, query::exit::USAGE);
    assert!(r.stdout.is_empty());
    assert!(
        r.stderr.unwrap().contains("--window takes d1, d7 or d30"),
        "bad arguments say why"
    );
    let r = coverage::run(&args(&["--bogus"]), &ctx(&s));
    assert_eq!(r.code, query::exit::USAGE);

    let empty = common::Env::new();
    let absent = Ctx {
        state: Some(StateDirs {
            dir: empty.state(),
            legacy: None,
        }),
        overridden: false,
        now_ms: t(scenes::GENERATED),
        busy: Duration::from_secs(2),
        meter_version: scenes::EXAMPLE_VERSION.into(),
    };
    let r = coverage::run(&args(&["--json"]), &absent);
    assert_eq!(r.code, query::exit::ABSENT_STORE);
    assert!(!empty.state().exists(), "nothing is created");

    for (version, code) in [
        ("4", query::exit::NEWER_SCHEMA),
        ("2", query::exit::OUTDATED_STORE),
    ] {
        s.store().set_meta("schema_version", version).unwrap();
        let r = coverage::run(&args(&["--json"]), &ctx(&s));
        assert_eq!(r.code, code, "schema_version {version}");
        assert!(r.stdout.is_empty(), "a refusal prints no report");
    }
    s.store().set_meta("schema_version", "3").unwrap();
}

// ---------------------------------------------------------------------------------------------
// The state folder, compared as the query's test compares it.

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

/// 55 attributed bots, each its own worker, session and worktree: bot-10's start row has no
/// squad, so its line's `unrecorded` stays visible.
fn many_bots() -> Scene {
    let mut s = Scene::migrated("2026-09-11T23:30:00Z", &[]);
    let base = t("2026-11-08T01:00:00Z");
    for i in 0..55i64 {
        let w = wt(&format!("many-{i:02}"));
        let bot = format!("bot-{i:02}");
        let session = format!("s-{i:02}");
        let branch = format!("feat/cov-many-{i:02}");
        s.start(Start {
            session: Some(&session),
            squad: (i != 10).then_some(Some("lark")),
            ..worker(
                &format!("t{i:02}"),
                &bot,
                "dev",
                "",
                "claude",
                &w,
                &branch,
                base + i * 10_000,
            )
        });
        s.add(
            Usage::new(
                H::Claude,
                &session,
                &w,
                Some(&branch),
                at(&["2026-11-08T10"]),
            )
            .tokens([100 + i, 1000 + i, 0, 0, 100, 0]),
        );
    }
    s.sync();
    s
}

// ---------------------------------------------------------------------------------------------
// The (g) ceilings, on the RFC 0018 reference store. Not part of a gate: build the store with
// `CEILING_DIR=<dir> cargo test --test query -- --ignored ceiling_store`, then
// `CEILING_DIR=<dir> cargo test --test coverage -- --ignored coverage_ceiling`. It prints the
// warm report's wall times and output size and asserts only that every total is complete; the
// timing and resource numbers are recorded in the pull request, never asserted here.

/// What the ceiling store holds: 40 repos, 8 bots, two calls in three tied to a bot.
#[test]
#[ignore]
fn coverage_ceiling() {
    let Some(dir) = std::env::var_os("CEILING_DIR").map(std::path::PathBuf::from) else {
        return;
    };
    let state = dir.join("state");
    if !state.join("meter.db").exists() {
        return;
    }
    let run = || {
        let mut c = std::process::Command::new(env!("CARGO_BIN_EXE_usagemeter"));
        c.args(["coverage", "--json"])
            .env_clear()
            .env("METER_STATE_DIR", &state)
            .env("HOME", dir.join("home"));
        c.output().unwrap()
    };
    let warm = run();
    assert_eq!(
        warm.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&warm.stderr)
    );
    assert!(warm.stdout.len() < 64 * 1024, "{} bytes", warm.stdout.len());
    let v: Value = serde_json::from_slice(&warm.stdout).unwrap();
    for w in v["windows"].as_array().unwrap() {
        assert_eq!(w["repos_shown"], 40);
        assert_eq!(w["repos_omitted"], 0);
        assert_eq!(w["bots_shown"], 8);
        assert_eq!(w["bots_omitted"], 0);
        let total = int(&w["totals"]["total"]);
        let attributed = int(&w["totals"]["attributed"]);
        let repos: i64 = w["repos"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| int(&r["totals"]["total"]))
            .sum();
        let bots: i64 = w["bots"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| int(&b["tokens"]))
            .sum();
        assert_eq!(repos, total, "every repo is in the total");
        assert_eq!(bots, attributed, "every bot is in the numerator");
        assert_eq!(
            [
                int(&w["totals"]["ambiguous"]),
                int(&w["totals"]["before_evidence"])
            ],
            [0, 0]
        );
    }
    let mut times: Vec<u128> = Vec::new();
    for _ in 0..20 {
        let t0 = std::time::Instant::now();
        let out = run();
        times.push(t0.elapsed().as_millis());
        assert_eq!(out.status.code(), Some(0));
    }
    times.sort_unstable();
    let p95 = times[(times.len() * 95 / 100).min(times.len() - 1)];
    println!(
        "coverage ceiling: warm p95 {p95} ms, min {} ms, max {} ms, {} bytes out",
        times[0],
        times[times.len() - 1],
        warm.stdout.len()
    );
}
