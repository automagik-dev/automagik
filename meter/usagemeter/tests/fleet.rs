//! #1100: fleet contracts, cross-machine arithmetic and unknown-is-never-zero regressions.
//! Fixtures contain only synthetic machines, repos, bots, tasks and models.
mod common;

use std::{fs, path::PathBuf};

use common::{Env, schema::Schema, serial};
use meter::{
    fleet::{self, MissingStore},
    query::Answer,
    time,
};
use serde_json::{Value, json};

const VERSION: &str = "1.2.3";
const NOW: &str = "2026-11-08T20:00:05Z";

fn now() -> i64 {
    time::parse_rfc3339(NOW).unwrap()
}
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../schema")
}
fn read(path: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(root().join(path)).unwrap()).unwrap()
}
fn schema(kind: &str) -> Schema {
    Schema::new(read(&format!("fleet/v1/fleet-{kind}.schema.json")))
}
fn checked(a: Answer, kind: &str, code: u8) -> Value {
    assert_eq!(a.code, code, "{}", a.stdout);
    assert!(a.stdout.ends_with('\n'));
    assert_eq!(a.stdout.lines().count(), 1);
    let v = serde_json::from_str(&a.stdout).unwrap();
    assert!(
        schema(kind).valid(&v),
        "{:#?}\n{v}",
        schema(kind).errors(&v)
    );
    v
}
fn usage(inputs: &[Value], missing: &[MissingStore]) -> Value {
    checked(
        fleet::reduce_usage(inputs, missing, now(), VERSION),
        "usage",
        0,
    )
}
fn outcomes(inputs: &[Value], missing: &[MissingStore]) -> Value {
    checked(
        fleet::reduce_outcomes(inputs, missing, now(), VERSION),
        "outcomes",
        0,
    )
}
fn unreachable() -> MissingStore {
    MissingStore {
        machine: "machine-z9y8x7".into(),
        reason: "unreachable".into(),
        message: "ssh_timeout".into(),
    }
}

fn usage_input(mode: &str, machine: &str) -> Value {
    let file = match mode {
        "bot" => "by-bot",
        "task" => "task-rows",
        _ => "priced",
    };
    let mut v = read(&format!("query/v1/examples/{file}.json"));
    v["machine"]["id"] = json!(machine);
    for row in v["rows"].as_array_mut().unwrap() {
        for (i, model) in row["models"].as_array_mut().unwrap().iter_mut().enumerate() {
            model["model"] = json!(format!("model-{i}"));
        }
    }
    v
}
fn branch_input(machine: &str) -> Value {
    let mut v = usage_input("branch", machine);
    let zero = read("query/v1/examples/zero-usage.json")["rows"][0].clone();
    v["query"]["branches"]
        .as_array_mut()
        .unwrap()
        .push(zero["branch"].clone());
    v["query"]["branch_count"] = json!(3);
    v["rows"].as_array_mut().unwrap().push(zero);
    v
}

/// Requested outcomes shape, built from the live local example to exercise the adapter too.
fn outcome_input(machine: &str, second: bool, not_recorded: bool) -> Value {
    let mut v = read("outcomes/v1/examples/recorded.json");
    v["machine"] = json!(machine);
    v["windows"].as_array_mut().unwrap().truncate(1);
    let w = &mut v["windows"][0];
    w["launches"] = json!({"total": 3, "worker": 2, "seat": 1, "running": 0, "ended": 3, "recorded": 3, "unrecorded": 0});
    w["run_ends"] = json!({"clean": 2, "failed": 1, "unclassified": 0, "by_bot": [{"bot": "heron", "kind": "worker", "role": "dev", "squad": "lark", "unrecorded": [], "agent": "model-0", "clean": 2, "failed": 1, "unclassified": 0}], "by_bot_omitted": 0});
    let mut branches = w["time_to_pr"]["branches"].clone();
    let p = &mut branches[0];
    p["first_commit_at"] = json!("2026-11-08T10:00:00Z");
    p["pr_created_at"] = json!("2026-11-08T11:00:00Z");
    p["merged_at"] = json!("2026-11-08T12:00:00Z");
    p["first_launch_at"] = json!("2026-11-08T10:30:00Z");
    p["launches"] = json!(2);
    p["shared"] = json!(second);
    if second {
        let mut distinct = p.clone();
        distinct["branch"] = json!("feat/second");
        distinct["pr"] = json!(43);
        distinct["state"] = json!("open");
        distinct["pr_created_at"] = json!("2026-11-08T10:30:00Z");
        distinct["merged_at"] = Value::Null;
        distinct["to_open_s"] = json!(1800);
        distinct["to_merge_s"] = Value::Null;
        distinct["launch_to_merge_s"] = Value::Null;
        distinct["shared"] = json!(false);
        branches.as_array_mut().unwrap().push(distinct);
    }
    w["time_to_pr"] = json!({"by_branch": branches, "by_branch_omitted": 0});
    w["prs"] = json!({"opened": if second {2} else {1}, "merged": 1, "closed_unmerged": 0, "open": if second {1} else {0}, "not_recorded": 0});
    w["abandoned_branches"] = json!({"branches": [{"repo": "example.com/acme/widgets", "branch": "feat/abandoned", "launches": 2}], "branches_omitted": 0, "by_repo": [{"repo": "example.com/acme/widgets", "branches": 1, "launches": 2}], "by_repo_omitted": 0});
    for kind in ["tool_error", "api_error", "run_failed"] {
        let count = w["errors"][kind]["count"].clone();
        w["errors"][kind] = json!({"state": "ok", "total": count});
    }
    if not_recorded {
        w["errors"]["api_error"] = json!({"state": "not_recorded", "total": null});
        w["errors"]["tool_error"] = json!({"state": "not_recorded", "total": null});
        for f in ["by_branch", "by_task"] {
            for r in w["errors"][f].as_array_mut().unwrap() {
                r["api_error"] = Value::Null;
                r["tool_error"] = Value::Null;
            }
        }
        w["errors"]["rows"] = json!([]);
    }
    v
}

#[test]
fn examples_are_reproduced_and_validate() {
    let a = branch_input("machine-a1b2c3");
    let b = branch_input("machine-d4e5f6");
    let oa = outcome_input("machine-a1b2c3", false, false);
    let ob = outcome_input("machine-d4e5f6", true, false);
    for (name, v) in [
        ("fleet-usage", usage(&[a.clone(), b], &[])),
        ("fleet-usage-partial", usage(&[a], &[unreachable()])),
        ("fleet-outcomes", outcomes(&[oa, ob], &[])),
        (
            "fleet-outcomes-partial",
            outcomes(
                &[outcome_input("machine-a1b2c3", false, true)],
                &[unreachable()],
            ),
        ),
    ] {
        let path = root().join(format!("fleet/v1/examples/{name}.json"));
        if std::env::var_os("UPDATE_FLEET_EXAMPLES").is_some() {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(
                &path,
                format!("{}\n", serde_json::to_string_pretty(&v).unwrap()),
            )
            .unwrap();
        }
        let expected: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(v, expected, "{name}");
    }
}

#[test]
fn schemas_reject_false_ok_and_refusal_payloads() {
    for kind in ["usage", "outcomes"] {
        let v = if kind == "usage" {
            usage(&[branch_input("machine-a1b2c3")], &[])
        } else {
            outcomes(&[outcome_input("machine-a1b2c3", false, false)], &[])
        };
        for field in ["missing", "stale", "complete"] {
            let mut bad = v.clone();
            match field {
                "missing" => bad["missing"] = json!([unreachable()]),
                "stale" => bad["machines"][0]["stale"] = json!(true),
                _ => bad["machines"][0]["complete"] = json!(false),
            }
            assert!(!schema(kind).valid(&bad), "{kind} {field}");
        }
        let mut bad = v.clone();
        bad["status"] = json!("partial");
        bad["missing"] = json!([unreachable()]);
        assert!(schema(kind).valid(&bad));
        bad["status"] = json!("error");
        bad["error"] = json!({"code":"bad", "message":"bad input"});
        assert!(!schema(kind).valid(&bad));
        if kind == "outcomes" {
            bad = v;
            bad["machines"][0]["recorded"] = json!(false);
            assert!(!schema(kind).valid(&bad));
        }
    }
}

#[test]
fn m1_usage_sums_all_three_groupings() {
    for mode in ["branch", "bot", "task"] {
        let a = usage_input(mode, "machine-a1b2c3");
        let b = usage_input(mode, "machine-d4e5f6");
        let v = usage(&[b.clone(), a.clone()], &[]);
        assert_eq!(v["status"], "ok");
        assert_eq!(v["machines"][0]["id"], "machine-a1b2c3");
        for (i, r) in a["rows"].as_array().unwrap().iter().enumerate() {
            let merged = &v["rows"][i];
            for f in [
                "input",
                "cache_read",
                "cache_write_5m",
                "cache_write_1h",
                "output",
                "unsplit",
                "total",
            ] {
                assert_eq!(
                    merged["tokens"][f].as_u64().unwrap(),
                    2 * r["tokens"][f].as_u64().unwrap(),
                    "{mode}: {f}"
                );
            }
            assert!(
                (merged["cost"]["usd"].as_f64().unwrap()
                    - 2.0 * r["cost"]["usd"].as_f64().unwrap())
                .abs()
                    < 1e-9
            );
            assert_eq!(
                merged["attribution"]["actor"]["tokens_attributed"]
                    .as_u64()
                    .unwrap(),
                2 * r["attribution"]["actor"]["tokens_attributed"]
                    .as_u64()
                    .unwrap()
            );
            for (j, model) in r["models"].as_array().unwrap().iter().enumerate() {
                assert_eq!(
                    merged["models"][j]["calls"].as_u64().unwrap(),
                    2 * model["calls"].as_u64().unwrap()
                );
                assert_eq!(
                    merged["models"][j]["tokens"]["total"].as_u64().unwrap(),
                    2 * model["tokens"]["total"].as_u64().unwrap()
                );
                assert!(
                    (merged["models"][j]["cost_usd"].as_f64().unwrap()
                        - 2.0 * model["cost_usd"].as_f64().unwrap())
                    .abs()
                        < 1e-9
                );
            }
        }
        assert_eq!(v, usage(&[a, b], &[]), "input order must not matter");
    }
}

#[test]
fn m1_unpriced_cost_model_and_reasoning_remain_null() {
    for mode in ["branch", "bot", "task"] {
        let mut a = usage_input(mode, "machine-a1b2c3");
        for r in a["rows"].as_array_mut().unwrap() {
            let total = r["tokens"]["total"].clone();
            r["cost"] = json!({"state":"unpriced", "usd":null, "usd_reported":null, "usd_estimated":null, "tokens_priced":0, "tokens_reported":0, "tokens_unpriced":total, "unpriced_models":["model-0"], "unpriced_models_omitted":0});
            r["tokens"]["reasoning"] = Value::Null;
            for m in r["models"].as_array_mut().unwrap() {
                m["cost_usd"] = Value::Null;
            }
        }
        let mut b = a.clone();
        b["machine"]["id"] = json!("machine-d4e5f6");
        let v = usage(&[a, b], &[]);
        for r in v["rows"].as_array().unwrap() {
            assert_eq!(r["cost"]["state"], "unpriced");
            assert!(r["cost"]["usd"].is_null());
            assert!(r["cost"]["usd_reported"].is_null());
            assert!(r["cost"]["usd_estimated"].is_null());
            assert!(r["tokens"]["reasoning"].is_null());
            for m in r["models"].as_array().unwrap() {
                assert!(m["cost_usd"].is_null());
            }
        }
    }
}

#[test]
fn m2_non_ok_and_missing_stores_downgrade_zero() {
    let a = branch_input("machine-a1b2c3");
    let mut locked = read("query/v1/examples/locked.json");
    locked["machine"] = json!({"id":"machine-d4e5f6", "scope":"local"});
    for (inputs, absent, expected) in [
        (vec![a.clone(), locked.clone()], vec![], 1),
        (vec![a.clone()], vec![unreachable()], 1),
        (vec![a, locked], vec![unreachable()], 2),
    ] {
        let v = usage(&inputs, &absent);
        assert_eq!(v["status"], "partial");
        assert!(v["as_of"].is_null());
        assert_eq!(v["missing"].as_array().unwrap().len(), expected);
        let zero = v["rows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["branch"] == "docs/gn-90-readme")
            .unwrap();
        assert_eq!(zero["state"], "missing");
        assert!(zero["tokens"].is_null());
        assert!(zero["cost"].is_null());
        assert!(zero["activity"].is_null());
    }
    let mut incomplete = branch_input("machine-a1b2c3");
    incomplete["ingestion"]["complete"] = json!(false);
    assert_eq!(usage(&[incomplete], &[])["rows"][0]["state"], "missing");
}

#[test]
fn m3_deduplicates_pr_summaries_and_recomputes_percentiles() {
    let a = outcome_input("machine-a1b2c3", false, false);
    let b = outcome_input("machine-d4e5f6", true, false);
    let v = outcomes(&[a.clone(), b.clone()], &[]);
    let w = &v["windows"][0];
    assert_eq!(w["time_to_pr"]["by_branch"].as_array().unwrap().len(), 2);
    assert_eq!(
        w["time_to_pr"]["overall"]["to_open_s"],
        json!({"n":2,"n_shared":1,"p50_s":1800,"p90_s":3600})
    );
    assert_eq!(w["time_to_pr"]["by_repo"][0]["to_open_s"]["n"], 2);
    assert_eq!(w["prs"]["opened"], 2);
    assert_eq!(w["prs"]["merged"], 1);
    assert_eq!(w["prs"]["open"], 1);
    assert_eq!(w["launches"]["total"], 6);
    assert_eq!(w["run_ends"]["by_bot"][0]["clean"], 4);
    assert_eq!(
        w["abandoned_branches"]["branches"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(w["abandoned_branches"]["branches"][0]["launches"], 4);
    assert_eq!(v, outcomes(&[b, a], &[]));
}

#[test]
fn m3_not_recorded_failure_totals_and_breakdowns_stay_null() {
    let a = outcome_input("machine-a1b2c3", false, true);
    let b = outcome_input("machine-d4e5f6", true, true);
    for absent in [vec![], vec![unreachable()]] {
        let v = outcomes(&[a.clone(), b.clone()], &absent);
        let e = &v["windows"][0]["errors"];
        for kind in ["tool_error", "api_error"] {
            assert_eq!(e[kind]["state"], "not_recorded");
            assert!(e[kind]["total"].is_null());
            for field in ["by_branch", "by_task"] {
                assert!(e[field][0][kind].is_null());
            }
        }
    }
    let recorded = outcome_input("machine-d4e5f6", false, false);
    let v = outcomes(&[a, recorded], &[]);
    assert_eq!(
        v["windows"][0]["errors"]["tool_error"],
        json!({"state":"partial","total":2})
    );
}

#[test]
fn live_outcomes_adapter_preserves_counts_and_no_data() {
    let a = read("outcomes/v1/examples/recorded.json");
    let mut b = a.clone();
    b["machine"] = json!("machine-d4e5f6");
    let v = outcomes(&[a, b], &[]);
    let w = &v["windows"][0];
    assert_eq!(w["errors"]["tool_error"]["total"], 4);
    assert_eq!(w["errors"]["by_bot"][0]["tool_error"], 4);
    assert_eq!(w["errors"]["by_branch"][0]["attributed"], 4);
    assert_eq!(w["prs"]["opened"], 1);
    assert_eq!(w["time_to_pr"]["overall"]["to_open_s"]["n"], 1);
    assert!(w["launches"].is_null());
    let empty = outcomes(&[read("outcomes/v1/examples/no-data.json")], &[]);
    assert_eq!(empty["windows"][0]["state"], "no_data");
    assert!(empty["windows"][0]["run_ends"].is_null());
    outcomes(&[read("outcomes/v1/examples/not-recorded.json")], &[]);
}

#[test]
fn task_ambiguity_wins_and_models_are_bounded() {
    let a = usage_input("task", "machine-a1b2c3");
    let mut b = a.clone();
    b["machine"]["id"] = json!("machine-d4e5f6");
    b["rows"][0]["reason"] = json!("task_ambiguous");
    let v = usage(&[a, b], &[]);
    assert_eq!(v["rows"][0]["state"], "missing");
    assert!(v["rows"][0]["tokens"].is_null());
    let mut a = usage_input("branch", "machine-a1b2c3");
    let model = a["rows"][0]["models"][0].clone();
    a["rows"][0]["models"] = json!(
        (0..10)
            .map(|i| {
                let mut m = model.clone();
                m["model"] = json!(format!("model-{i:02}"));
                m
            })
            .collect::<Vec<_>>()
    );
    a["rows"][0]["models_omitted"] = json!(3);
    let v = usage(&[a], &[]);
    assert_eq!(v["rows"][0]["models"].as_array().unwrap().len(), 8);
    assert_eq!(v["rows"][0]["models_omitted"], 5);
}

#[test]
fn refusals_and_empty_missing_only_reports_are_schema_valid() {
    checked(fleet::reduce_usage(&[], &[], now(), VERSION), "usage", 2);
    checked(
        fleet::reduce_outcomes(&[], &[], now(), VERSION),
        "outcomes",
        2,
    );
    assert_eq!(usage(&[], &[unreachable()])["status"], "partial");
    assert_eq!(outcomes(&[], &[unreachable()])["status"], "partial");
    for field in [
        "repo",
        "repo_aliases",
        "window",
        "by",
        "since",
        "until",
        "branches",
    ] {
        let a = usage_input("branch", "machine-a1b2c3");
        let mut b = a.clone();
        b["machine"]["id"] = json!("machine-d4e5f6");
        b["query"][field] = if field == "branches" || field == "repo_aliases" {
            json!(["different"])
        } else if field == "by" {
            json!("bot")
        } else {
            json!("different")
        };
        let v = checked(
            fleet::reduce_usage(&[a, b], &[], now(), VERSION),
            "usage",
            1,
        );
        assert_eq!(v["error"]["code"], "incompatible_queries");
    }
}

#[test]
fn cli_reads_only_local_files_and_reports_missing_and_bad_inputs() {
    let _guard = serial();
    let env = Env::new();
    let a = branch_input("machine-a1b2c3");
    let b = branch_input("machine-d4e5f6");
    let pa = env.dir.path().join("machine-a1b2c3.json");
    let pb = env.dir.path().join("machine-d4e5f6.json");
    fs::write(&pa, serde_json::to_vec(&a).unwrap()).unwrap();
    fs::write(&pb, serde_json::to_vec(&b).unwrap()).unwrap();
    let before = fs::read(&pa).unwrap();
    let result = env
        .command()
        .args(["fleet", "usage", "--json"])
        .arg(&pa)
        .arg(&pb)
        .output()
        .unwrap();
    let v = checked(
        Answer {
            code: result.status.code().unwrap() as u8,
            stdout: String::from_utf8(result.stdout).unwrap(),
        },
        "usage",
        0,
    );
    assert_eq!(v["status"], "ok");
    assert!(result.stderr.is_empty());
    let result = env
        .command()
        .args([
            "fleet",
            "usage",
            "--json",
            "--missing",
            "machine-z9y8x7:unreachable:ssh_timeout",
        ])
        .arg(&pa)
        .output()
        .unwrap();
    let v = checked(
        Answer {
            code: result.status.code().unwrap() as u8,
            stdout: String::from_utf8(result.stdout).unwrap(),
        },
        "usage",
        0,
    );
    assert_eq!(v["missing"][0], json!(unreachable()));
    assert_eq!(v["status"], "partial");
    assert_eq!(fs::read(&pa).unwrap(), before);
    assert!(!env.state().exists());
    assert!(!env.home().exists());
    for (args, code) in [
        (vec!["usage"], 2),
        (vec!["outcomes", "--json", "--missing", "bad"], 2),
        (vec!["outcomes", "--json", "absent.json"], 1),
    ] {
        checked(
            fleet::run(
                &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                now(),
                VERSION,
            ),
            if args[0] == "usage" {
                "usage"
            } else {
                "outcomes"
            },
            code,
        );
    }
    fs::write(&pa, "false").unwrap();
    checked(
        fleet::run(
            &["usage".into(), "--json".into(), pa.to_str().unwrap().into()],
            now(),
            VERSION,
        ),
        "usage",
        1,
    );
}

#[test]
fn cli_supports_bot_task_and_outcomes_and_non_ok_files() {
    let _guard = serial();
    let env = Env::new();
    let pa = env.dir.path().join("machine-a1b2c3.json");
    let pb = env.dir.path().join("machine-d4e5f6.json");
    for mode in ["branch", "bot", "task", "outcomes"] {
        let (a, b, kind) = if mode == "outcomes" {
            (
                outcome_input("machine-a1b2c3", false, true),
                outcome_input("machine-d4e5f6", true, true),
                "outcomes",
            )
        } else {
            (
                usage_input(mode, "machine-a1b2c3"),
                usage_input(mode, "machine-d4e5f6"),
                "usage",
            )
        };
        fs::write(&pa, serde_json::to_vec(&a).unwrap()).unwrap();
        fs::write(&pb, serde_json::to_vec(&b).unwrap()).unwrap();
        let result = env
            .command()
            .args(["fleet", kind, "--json"])
            .arg(&pa)
            .arg(&pb)
            .output()
            .unwrap();
        let mut v = checked(
            Answer {
                code: result.status.code().unwrap() as u8,
                stdout: String::from_utf8(result.stdout).unwrap(),
            },
            kind,
            0,
        );
        let mut expected = if kind == "outcomes" {
            outcomes(&[a, b], &[])
        } else {
            usage(&[a, b], &[])
        };
        v["generated_at"] = Value::Null;
        expected["generated_at"] = Value::Null;
        v["meter_version"] = Value::Null;
        expected["meter_version"] = Value::Null;
        assert_eq!(v, expected);
    }
    fs::write(
        &pa,
        serde_json::to_vec(&branch_input("machine-a1b2c3")).unwrap(),
    )
    .unwrap();
    fs::write(
        &pb,
        serde_json::to_vec(&read("query/v1/examples/locked.json")).unwrap(),
    )
    .unwrap();
    let result = env
        .command()
        .args([
            "fleet",
            "usage",
            "--json",
            "--missing",
            "machine-z9y8x7:unreachable:ssh_timeout",
        ])
        .arg(&pa)
        .arg(&pb)
        .output()
        .unwrap();
    let v = checked(
        Answer {
            code: result.status.code().unwrap() as u8,
            stdout: String::from_utf8(result.stdout).unwrap(),
        },
        "usage",
        0,
    );
    assert_eq!(v["status"], "partial");
    assert_eq!(v["missing"][0]["machine"], "machine-d4e5f6");
    assert_eq!(v["missing"][0]["reason"], "locked");
    assert_eq!(v["missing"].as_array().unwrap().len(), 2);
}

#[test]
fn bounds_unknown_reasoning_watermarks_and_canonical_bot_keys() {
    let a = usage_input("bot", "machine-a1b2c3");
    let mut b = a.clone();
    b["machine"]["id"] = json!("machine-d4e5f6");
    b["as_of"] = json!("2026-11-08T18:00:00Z");
    b["rows"][0]["tokens"]["reasoning"] = Value::Null;
    let v = usage(&[a.clone(), b.clone()], &[]);
    assert!(v["rows"][0]["tokens"]["reasoning"].is_null());
    assert_eq!(v["as_of"], "2026-11-08T18:00:00Z");
    assert_eq!(v["actor_unattributed"]["absent_bot_is_zero"], true);
    b["as_of"] = Value::Null;
    assert!(usage(&[a, b], &[])["as_of"].is_null());
    let mut huge = branch_input("machine-a1b2c3");
    huge["rows"][0]["tokens"]["total"] = json!(u64::MAX);
    let v = checked(
        fleet::reduce_usage(&[huge], &[], now(), VERSION),
        "usage",
        1,
    );
    assert_eq!(v["error"]["code"], "numeric_overflow");

    let mut v = usage_input("bot", "machine-a1b2c3");
    let row = v["rows"][0].clone();
    v["rows"] = json!(
        (0..4)
            .rev()
            .map(|i| {
                let mut r = row.clone();
                r["role"] = if i == 0 || i == 2 {
                    json!("dev")
                } else {
                    Value::Null
                };
                r["squad"] = Value::Null;
                r["unrecorded"] = match i {
                    0 => json!([]),
                    1 => json!(["role"]),
                    2 => json!(["squad"]),
                    _ => json!(["role", "squad"]),
                };
                r
            })
            .collect::<Vec<_>>()
    );
    let result = usage(&[v], &[]);
    assert_eq!(
        result["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["unrecorded"].clone())
            .collect::<Vec<_>>(),
        vec![
            json!(["role"]),
            json!(["role", "squad"]),
            json!([]),
            json!(["squad"])
        ]
    );
}

#[test]
fn error_caps_carry_omitted_group_counts_and_event_counts() {
    let mut a = outcome_input("machine-a1b2c3", false, false);
    let errors = &mut a["windows"][0]["errors"];
    errors["by_task"] = json!((0..52).map(|i| json!({"repo":"example.com/acme/widgets", "task":format!("task-{i:02}"), "tool_error":1,"api_error":0,"run_failed":2})).collect::<Vec<_>>());
    errors["by_task_omitted"] = json!(3);
    errors["by_task_omitted_count"] = json!(9);
    let v = outcomes(&[a], &[unreachable()]);
    let e = &v["windows"][0]["errors"];
    assert_eq!(e["by_task"].as_array().unwrap().len(), 50);
    assert_eq!(e["by_task_omitted"], 5);
    assert_eq!(e["by_task_omitted_count"], 15);
    assert_eq!(e["run_failed"]["state"], "partial");
}
