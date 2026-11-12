//! Offline reductions of already collected query/outcomes JSON. No store is opened, refreshed,
//! or migrated here. Collection and transport (including reporting missing machines) belong to
//! the caller. Unknown counters and prices stay unknown.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::{Value, json};

use crate::{query::Answer, time};

/// A machine for which collection produced no usable envelope.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MissingStore {
    pub machine: String,
    pub reason: String,
    pub message: String,
}

fn array(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn number(v: &Value) -> u64 {
    v.as_u64().unwrap_or(0)
}

fn sum(v: &[&Value], field: &str) -> u64 {
    v.iter().map(|v| number(&v[field])).sum()
}

fn values<'a>(v: &[&'a Value], field: &str) -> Vec<&'a Value> {
    v.iter().map(|v| &v[field]).collect()
}

fn union(v: &[&Value], field: &str) -> Value {
    let set: BTreeSet<&str> = v
        .iter()
        .flat_map(|v| array(&v[field]))
        .filter_map(Value::as_str)
        .collect();
    json!(set)
}

fn extreme(v: &[&Value], field: &str, min: bool) -> Value {
    let mut v: Vec<&str> = v.iter().filter_map(|v| v[field].as_str()).collect();
    v.sort_unstable();
    json!(if min { v.first() } else { v.last() })
}

/// Canonical tuple order, with null before strings and arrays ordered element by element.
fn key(v: &Value, fields: &[&str]) -> String {
    fields
        .iter()
        .map(|f| match &v[f] {
            Value::Array(a) if *f == "unrecorded" => {
                let rank = u8::from(a.iter().any(|v| v == "role"))
                    + 2 * u8::from(a.iter().any(|v| v == "squad"));
                format!("2{rank}")
            }
            Value::Null => "0".into(),
            Value::String(s) => format!("1{s}\0"),
            a => format!("2{a}\0"),
        })
        .collect::<Vec<_>>()
        .join("\0")
}

const BOT_KEY: &[&str] = &["bot", "kind", "role", "squad", "unrecorded", "harness"];
const CLOCKS: [&str; 4] = [
    "to_open_s",
    "to_merge_s",
    "launch_to_open_s",
    "launch_to_merge_s",
];

fn groups<'a>(rows: impl Iterator<Item = &'a Value>, fields: &[&str]) -> Vec<Vec<&'a Value>> {
    let mut out: BTreeMap<String, Vec<&Value>> = BTreeMap::new();
    for row in rows {
        out.entry(key(row, fields)).or_default().push(row);
    }
    out.into_values().collect()
}

fn envelope(kind: &str, now_ms: i64, version: &str) -> Value {
    let mut v = json!({
        "contract": format!("usagemeter.fleet.{kind}"), "contract_version": 1,
        "capability": format!("meter.fleet.{kind}@1"), "meter_version": version,
        "status": "partial", "error": null, "generated_at": time::format_rfc3339(now_ms),
        "machines": [], "missing": []
    });
    if kind == "outcomes" {
        v["windows"] = json!([]);
    } else {
        v["as_of"] = Value::Null;
        v["query"] = Value::Null;
        v["unattributed"] = Value::Null;
        v["actor_unattributed"] = Value::Null;
        v["rows"] = json!([]);
    }
    v
}

fn answer(v: Value) -> Answer {
    Answer {
        code: match v["status"].as_str() {
            Some("ok" | "partial") => 0,
            Some("usage") => 2,
            _ => 1,
        },
        stdout: format!("{}\n", serde_json::to_string(&v).expect("JSON value")),
    }
}

fn refuse(mut v: Value, status: &str, code: &str, message: &str) -> Answer {
    v["status"] = json!(status);
    v["error"] = json!({"code": code, "message": message});
    answer(v)
}

fn missing_values(missing: &[MissingStore]) -> Value {
    let mut missing = missing.to_vec();
    missing.sort_by(|a, b| {
        (&a.machine, &a.reason, &a.message).cmp(&(&b.machine, &b.reason, &b.message))
    });
    missing.dedup();
    json!(missing)
}

fn valid_missing(missing: &[MissingStore]) -> bool {
    missing
        .iter()
        .all(|m| !m.machine.is_empty() && !m.reason.is_empty() && !m.message.is_empty())
}

fn valid_usage_row(row: &Value) -> bool {
    row.is_object()
        && ["branch", "bot", "task"].iter().any(|k| row[k].is_string())
        && row["state"].is_string()
        && row["attribution"].is_object()
        && row["models"].is_array()
        && array(&row["models"])
            .iter()
            .all(|m| m.is_object() && m["model"].is_string() && m["tokens"].is_object())
        && (row["tokens"].is_null()
            || (row["tokens"].is_object()
                && row["cost"].is_object()
                && row["activity"].is_object()))
}

/// Reject arithmetic too large to represent instead of panicking (debug) or wrapping (release).
/// Every integer reduction adds a subset of these nonnegative input counters.
fn numeric_budget(inputs: &[Value]) -> bool {
    fn visit(v: &Value, integers: &mut u64, floats: &mut f64) -> bool {
        match v {
            Value::Array(a) => a.iter().all(|v| visit(v, integers, floats)),
            Value::Object(o) => o.values().all(|v| visit(v, integers, floats)),
            Value::Number(n) => {
                if let Some(n) = n.as_u64() {
                    let Some(next) = integers.checked_add(n) else {
                        return false;
                    };
                    *integers = next;
                } else if let Some(n) = n.as_f64() {
                    *floats += n.abs();
                    if !floats.is_finite() {
                        return false;
                    }
                }
                true
            }
            _ => true,
        }
    }
    let (mut integers, mut floats) = (0, 0.0);
    inputs.iter().all(|v| visit(v, &mut integers, &mut floats))
}

/// Reduce local `usagemeter query --json` envelopes. Non-ok envelopes become missing machines;
/// mismatched requests are refused rather than added across unrelated queries.
pub fn reduce_usage(
    inputs: &[Value],
    missing: &[MissingStore],
    now_ms: i64,
    version: &str,
) -> Answer {
    let mut out = envelope("usage", now_ms, version);
    if !numeric_budget(inputs) {
        return refuse(
            out,
            "error",
            "numeric_overflow",
            "input counters exceed the reducer arithmetic range",
        );
    }
    if !valid_missing(missing) {
        return refuse(
            out,
            "usage",
            "invalid_missing",
            "missing fields must be nonempty",
        );
    }
    let mut missing = missing.to_vec();
    let mut ok = Vec::new();
    for v in inputs {
        if v["contract"] != "usagemeter.query" || v["contract_version"] != 1 {
            return refuse(
                out,
                "error",
                "invalid_envelope",
                "expected usagemeter.query contract 1",
            );
        }
        let Some(status) = v["status"].as_str().filter(|s| !s.is_empty()) else {
            return refuse(out, "error", "invalid_envelope", "query status is missing");
        };
        if status != "ok" {
            missing.push(MissingStore {
                machine: v["machine"]["id"].as_str().unwrap_or("unknown").into(),
                reason: status.into(),
                message: v["error"]["message"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(status)
                    .into(),
            });
            continue;
        }
        if !v["query"]["repo"].is_string()
            || !v["query"]["window"].is_string()
            || !v["query"]["branches"].is_array()
            || !v["rows"].is_array()
            || array(&v["rows"]).iter().any(|row| !valid_usage_row(row))
            || v["query"]["by"]
                .as_str()
                .is_some_and(|by| !["bot", "task", "branch"].contains(&by))
            || v["machine"]["id"].as_str().is_none_or(|s| s.is_empty())
            || !v["store"]["schema_version"].is_u64()
            || !v["ingestion"]["complete"].is_boolean()
            || !v["ingestion"]["stale"].is_boolean()
            || !v["window"]["clipped"].is_boolean()
            || !v["unattributed"].is_object()
            || !v["actor_unattributed"].is_object()
        {
            return refuse(
                out,
                "error",
                "invalid_envelope",
                "incomplete query envelope",
            );
        }
        ok.push(v);
    }
    if ok.is_empty() && missing.is_empty() {
        return refuse(
            out,
            "usage",
            "no_inputs",
            "provide at least one envelope or missing machine",
        );
    }
    let fields = [
        "repo",
        "repo_aliases",
        "window",
        "since",
        "until",
        "by",
        "branches",
    ];
    if let Some(first) = ok.first() {
        if ok
            .iter()
            .any(|v| fields.iter().any(|f| v["query"][f] != first["query"][f]))
        {
            return refuse(
                out,
                "error",
                "incompatible_queries",
                "query repo, aliases, window, interval, grouping and branches must match",
            );
        }
        let mut q = json!({});
        for f in fields.into_iter().chain(["branch_count"]) {
            if let Some(value) = first["query"].get(f) {
                q[f] = value.clone();
            }
        }
        out["query"] = q;
    }
    ok.sort_by_key(|v| v["machine"]["id"].as_str().unwrap());
    if ok
        .windows(2)
        .any(|v| v[0]["machine"]["id"] == v[1]["machine"]["id"])
    {
        return refuse(
            out,
            "error",
            "duplicate_machine",
            "provide only one envelope per machine",
        );
    }
    let machines: Vec<Value> = ok
        .iter()
        .map(|v| {
            json!({
                "id": v["machine"]["id"], "scope": "local",
                "store_schema_version": v["store"]["schema_version"], "as_of": v["as_of"],
                "complete": v["ingestion"]["complete"], "stale": v["ingestion"]["stale"],
                "clipped": v["window"]["clipped"]
            })
        })
        .collect();
    let healthy = !machines.is_empty()
        && missing.is_empty()
        && machines
            .iter()
            .all(|m| m["complete"] == true && m["stale"] == false && m["clipped"] == false);
    out["status"] = json!(if healthy { "ok" } else { "partial" });
    if !ok.is_empty() && missing.is_empty() && ok.iter().all(|v| v["as_of"].is_string()) {
        out["as_of"] = extreme(&ok, "as_of", true);
    }
    out["machines"] = json!(machines);
    out["missing"] = missing_values(&missing);
    if ok.is_empty() {
        return answer(out);
    }
    let unattributed = values(&ok, "unattributed");
    out["unattributed"] = json!({"tokens_total": sum(&unattributed, "tokens_total"), "harnesses": union(&unattributed, "harnesses")});
    let actors = values(&ok, "actor_unattributed");
    let mut actor = json!({});
    for f in [
        "tokens_total",
        "tokens_ambiguous",
        "tokens_unlinked",
        "tokens_before_evidence",
    ] {
        actor[f] = json!(sum(&actors, f));
    }
    let mut parts = Vec::new();
    for reason in [
        "claimants_differ",
        "no_record",
        "dsh_tui_seat",
        "other_machine",
        "before_evidence",
    ] {
        let p: Vec<&Value> = actors
            .iter()
            .flat_map(|v| array(&v["parts"]))
            .filter(|p| p["reason"] == reason)
            .collect();
        if let Some(first) = p.first() {
            parts.push(json!({"state": first["state"], "reason": reason, "tokens_total": sum(&p, "tokens_total"), "harnesses": union(&p, "harnesses")}));
        }
    }
    actor["parts"] = json!(parts);
    actor["absent_bot_is_zero"] = json!(
        healthy
            && out["query"]["by"] == "bot"
            && actor["tokens_total"] == 0
            && out["unattributed"]["tokens_total"] == 0
            && actors.iter().all(|v| v["absent_bot_is_zero"] == true)
    );
    out["actor_unattributed"] = actor;
    let by = out["query"]["by"].as_str().unwrap_or("branch");
    let fields = match by {
        "bot" => BOT_KEY,
        "task" => &["task"],
        _ => &["branch"],
    };
    let coverage_partial = out["unattributed"]["tokens_total"] != 0
        && (by == "branch" || !array(&out["query"]["branches"]).is_empty());
    let rows: Vec<Value> = groups(ok.iter().flat_map(|v| array(&v["rows"])), fields)
        .iter()
        .map(|rows| merge_usage_row(rows, by, healthy, ok.len(), coverage_partial))
        .collect();
    out["rows"] = json!(rows);
    answer(out)
}

fn tokens(rows: &[&Value]) -> Value {
    let mut out = json!({});
    for f in [
        "input",
        "cache_read",
        "cache_write_5m",
        "cache_write_1h",
        "output",
        "unsplit",
        "total",
    ] {
        out[f] = json!(sum(rows, f));
    }
    out["reasoning"] = if rows.iter().all(|v| v["reasoning"].is_u64()) {
        json!(sum(rows, "reasoning"))
    } else {
        Value::Null
    };
    out
}

fn sum_objects(rows: &[&Value]) -> Value {
    let mut out = json!({});
    let fields: BTreeSet<&str> = rows
        .iter()
        .filter_map(|v| v.as_object())
        .flat_map(|v| v.keys().map(String::as_str))
        .collect();
    for f in fields {
        let v = values(rows, f);
        if v.iter().any(|v| v.is_object()) {
            out[f] = sum_objects(&v);
        } else if v.iter().any(|v| v.is_number()) {
            out[f] = json!(sum(rows, f));
        }
    }
    out
}

fn cost(rows: &[&Value]) -> Value {
    let priced = sum(rows, "tokens_priced");
    let reported = sum(rows, "tokens_reported");
    let unpriced = sum(rows, "tokens_unpriced");
    let known = priced + reported > 0;
    let reported_usd: f64 = rows.iter().filter_map(|v| v["usd_reported"].as_f64()).sum();
    let estimated_usd: f64 = rows
        .iter()
        .filter_map(|v| v["usd_estimated"].as_f64())
        .sum();
    let names = union(rows, "unpriced_models");
    let omitted = sum(rows, "unpriced_models_omitted")
        + array(&names).len().saturating_sub(query_models_max()) as u64;
    json!({"state": if !known {"unpriced"} else if unpriced == 0 {"priced"} else {"partial"},
        "usd": known.then_some(reported_usd + estimated_usd),
        "usd_reported": known.then_some(reported_usd), "usd_estimated": known.then_some(estimated_usd),
        "tokens_priced": priced, "tokens_reported": reported, "tokens_unpriced": unpriced,
        "unpriced_models": array(&names).iter().take(query_models_max()).collect::<Vec<_>>(), "unpriced_models_omitted": omitted})
}

fn query_models_max() -> usize {
    crate::query::MODELS_MAX
}

fn merge_usage_row(
    rows: &[&Value],
    by: &str,
    healthy: bool,
    stores: usize,
    coverage_partial: bool,
) -> Value {
    let mut out = rows[0].clone();
    let contributing: Vec<&Value> = rows
        .iter()
        .copied()
        .filter(|v| number(&v["tokens"]["total"]) > 0)
        .collect();
    out["incomplete_sources"] = union(rows, "incomplete_sources");
    out["attribution"]["coverage"] = json!(if coverage_partial {
        "partial"
    } else {
        "complete"
    });
    if by == "task" && rows.iter().any(|v| v["reason"] == "task_ambiguous") {
        out["actors"] = json!([]);
        out["actors_omitted"] = json!(0);
        clear_row(&mut out, "missing", "task_ambiguous");
        return out;
    }
    if by == "branch" && contributing.is_empty() {
        if healthy
            && !coverage_partial
            && rows.len() == stores
            && rows.iter().all(|v| v["state"] == "zero")
        {
            return out;
        }
        let (state, reason) = if rows.iter().any(|v| v["state"] == "unsupported") {
            ("unsupported", "source_unsupported")
        } else if rows.iter().any(|v| v["state"] == "stale") {
            ("stale", "ingestion_stale")
        } else {
            ("missing", "source_incomplete")
        };
        clear_row(&mut out, state, reason);
        return out;
    }
    let stale = rows.iter().any(|v| v["state"] == "stale");
    out["state"] = json!(if stale { "stale" } else { "measured" });
    out["reason"] = if stale {
        json!("ingestion_stale")
    } else {
        Value::Null
    };
    out["tokens"] = tokens(&values(&contributing, "tokens"));
    out["cost"] = cost(&values(&contributing, "cost"));
    let mut models: Vec<Value> = groups(contributing.iter().flat_map(|v| array(&v["models"])), &["model"]).iter().map(|m| {
        let costs: Vec<f64> = m.iter().filter_map(|v| v["cost_usd"].as_f64()).collect();
        json!({"model": m[0]["model"], "calls": sum(m, "calls"), "tokens": tokens(&values(m, "tokens")), "cost_usd": if costs.is_empty() {None} else {Some(costs.iter().sum::<f64>())}})
    }).collect();
    models.sort_by(|a, b| {
        number(&b["tokens"]["total"])
            .cmp(&number(&a["tokens"]["total"]))
            .then_with(|| a["model"].as_str().cmp(&b["model"].as_str()))
    });
    out["models_omitted"] = json!(
        sum(&contributing, "models_omitted")
            + models.len().saturating_sub(query_models_max()) as u64
    );
    models.truncate(query_models_max());
    out["models"] = json!(models);
    let precision: BTreeSet<&str> = contributing
        .iter()
        .filter_map(|v| v["token_precision"].as_str())
        .collect();
    out["token_precision"] = json!(if precision.len() == 1 {
        *precision.first().unwrap()
    } else {
        "mixed"
    });
    let attribution = values(&contributing, "attribution");
    let actor = values(&attribution, "actor");
    if actor.iter().all(|v| v.is_object()) {
        out["attribution"]["actor"] = sum_objects(&actor);
    } else {
        out["attribution"].as_object_mut().unwrap().remove("actor");
    }
    out["attribution"]["shared"] = json!(rows.iter().any(|v| v["attribution"]["shared"] == true));
    let activity = values(&contributing, "activity");
    out["activity"] = json!({"first_hour": extreme(&activity, "first_hour", true), "last_hour": extreme(&activity, "last_hour", false), "hours": sum(&activity, "hours"), "harnesses": union(&activity, "harnesses")});
    if by == "task" {
        let actors: Vec<Value> = groups(rows.iter().flat_map(|v| array(&v["actors"])), BOT_KEY)
            .iter()
            .map(|v| v[0].clone())
            .collect();
        out["actors"] = json!(actors);
        out["actors_omitted"] = json!(sum(rows, "actors_omitted"));
    }
    out
}

fn clear_row(out: &mut Value, state: &str, reason: &str) {
    out["state"] = json!(state);
    out["reason"] = json!(reason);
    for f in ["tokens", "cost", "activity", "token_precision"] {
        out[f] = Value::Null;
    }
    out["models"] = json!([]);
    out["models_omitted"] = json!(0);
    out["attribution"].as_object_mut().unwrap().remove("actor");
}

/// Reduce `usagemeter outcomes --json` records. The local v1 spellings (`count`/`full`,
/// `branches`/`all`/`repos`) are normalized to fleet `total`/`ok`, `by_branch`/`overall`/`by_repo`.
/// Detailed lists are lower bounds when source records already omitted entries.
pub fn reduce_outcomes(
    inputs: &[Value],
    missing: &[MissingStore],
    now_ms: i64,
    version: &str,
) -> Answer {
    let mut out = envelope("outcomes", now_ms, version);
    if !numeric_budget(inputs) {
        return refuse(
            out,
            "error",
            "numeric_overflow",
            "input counters exceed the reducer arithmetic range",
        );
    }
    if !valid_missing(missing) {
        return refuse(
            out,
            "usage",
            "invalid_missing",
            "missing fields must be nonempty",
        );
    }
    if inputs.is_empty() && missing.is_empty() {
        return refuse(
            out,
            "usage",
            "no_inputs",
            "provide at least one envelope or missing machine",
        );
    }
    let mut records: Vec<&Value> = inputs.iter().collect();
    for v in &records {
        if v["v"] != 1
            || !v["windows"].is_array()
            || v["machine"].as_str().is_none_or(|s| s.is_empty())
            || !v["store"]["schema_version"].is_u64()
            || !["recorded", "complete", "stale"]
                .iter()
                .all(|f| v[f].is_boolean())
            || array(&v["windows"]).iter().any(|w| {
                !["d1", "d7", "d30"].contains(&w["window"].as_str().unwrap_or(""))
                    || !w["errors"].is_object()
                    || !w["time_to_pr"].is_object()
            })
        {
            return refuse(
                out,
                "error",
                "invalid_envelope",
                "expected an outcomes v1 record with machine, store, health and windows",
            );
        }
    }
    records.sort_by_key(|v| v["machine"].as_str().unwrap());
    if records
        .windows(2)
        .any(|v| v[0]["machine"] == v[1]["machine"])
    {
        return refuse(
            out,
            "error",
            "duplicate_machine",
            "provide only one envelope per machine",
        );
    }
    let healthy = !records.is_empty()
        && missing.is_empty()
        && records
            .iter()
            .all(|v| v["recorded"] == true && v["complete"] == true && v["stale"] == false);
    out["status"] = json!(if healthy { "ok" } else { "partial" });
    out["missing"] = missing_values(missing);
    out["machines"] = json!(records.iter().map(|v| json!({"id": v["machine"], "store_schema_version": v["store"]["schema_version"], "recorded": v["recorded"], "complete": v["complete"], "stale": v["stale"]})).collect::<Vec<_>>());
    let mut windows = Vec::new();
    for name in ["d1", "d7", "d30"] {
        let rows: Vec<&Value> = records
            .iter()
            .flat_map(|v| array(&v["windows"]))
            .filter(|v| v["window"] == name)
            .collect();
        if !rows.is_empty() {
            windows.push(merge_window(
                &rows,
                !missing.is_empty() || rows.len() != records.len(),
            ));
        }
    }
    out["windows"] = json!(windows);
    answer(out)
}

/// Merge a bounded grouping. Carry the input's omissions as well as both the number of newly
/// omitted groups and the event counts in them. Keys are sorted before applying the cap.
fn bounded_groups(
    rows: &[&Value],
    field: &str,
    keys: &[&str],
    cap: usize,
    counts: &[&str],
) -> (Value, u64, u64) {
    let merged: Vec<Value> = groups(rows.iter().flat_map(|v| array(&v[field])), keys)
        .iter()
        .map(|g| {
            let mut v = g[0].clone();
            for c in counts {
                v[c] = json!(sum(g, c));
            }
            for c in ["attributed", "unattributed"] {
                if v[c].is_number() {
                    v[c] = json!(sum(g, c));
                }
            }
            v
        })
        .collect();
    let omitted = sum(rows, &format!("{field}_omitted")) + merged.len().saturating_sub(cap) as u64;
    let omitted_count = sum(rows, &format!("{field}_omitted_count"))
        + merged
            .iter()
            .skip(cap)
            .map(|v| counts.iter().map(|c| number(&v[c])).sum::<u64>())
            .sum::<u64>();
    (
        json!(merged.iter().take(cap).collect::<Vec<_>>()),
        omitted,
        omitted_count,
    )
}

fn merge_window(rows: &[&Value], missing: bool) -> Value {
    let state = if !missing && rows.iter().all(|v| v["state"] == "no_data") {
        "no_data"
    } else if !missing && rows.iter().all(|v| v["state"] == "ok") {
        "ok"
    } else {
        "partial"
    };
    let mut out = json!({"window": rows[0]["window"], "start": extreme(rows, "start", true), "end": extreme(rows, "end", false),
        "clipped": rows.iter().any(|v| v["clipped"] == true), "state": state});
    // Older local records have no launches summary. Do not invent seven zero counters for them.
    out["launches"] = if rows.iter().all(|v| v["launches"].is_object()) {
        sum_objects(&values(rows, "launches"))
    } else {
        Value::Null
    };
    out["run_ends"] = if state == "no_data" || rows.iter().all(|v| v["run_ends"].is_null()) {
        Value::Null
    } else {
        let ends = values(rows, "run_ends");
        let mut ends_out = sum_objects(&ends);
        let (bots, omitted, _) = bounded_groups(
            &ends,
            "by_bot",
            &["bot", "kind", "role", "squad", "unrecorded", "agent"],
            50,
            &["clean", "failed", "unclassified"],
        );
        ends_out["by_bot"] = bots;
        ends_out["by_bot_omitted"] = json!(omitted);
        ends_out
    };
    let times = values(rows, "time_to_pr");
    let mut normalized = Vec::new();
    for v in &times {
        let mut v = (*v).clone();
        if v.get("by_branch").is_none() {
            v["by_branch"] = v["branches"].clone();
        }
        if v.get("by_branch_omitted").is_none() {
            v["by_branch_omitted"] = v["branches_omitted"].clone();
        }
        normalized.push(v);
    }
    let normalized: Vec<&Value> = normalized.iter().collect();
    let prs = groups(
        normalized.iter().flat_map(|v| array(&v["by_branch"])),
        &["repo", "branch", "pr"],
    );
    let dedup: Vec<Value> = prs.iter().map(|v| merge_pr(v)).collect();
    let dedup_refs: Vec<&Value> = dedup.iter().filter(|v| !v["pr"].is_null()).collect();
    let mut t = json!({"overall": clocks(&dedup_refs), "by_branch": dedup.iter().take(50).collect::<Vec<_>>(),
        "by_branch_omitted": sum(&normalized, "by_branch_omitted") + dedup.len().saturating_sub(50) as u64});
    let repos: Vec<Value> = groups(dedup_refs.iter().copied(), &["repo"])
        .iter()
        .map(|r| {
            let mut v = clocks(r);
            v["repo"] = r[0]["repo"].clone();
            v
        })
        .collect();
    t["by_repo_omitted"] = json!(repos.len().saturating_sub(50));
    t["by_repo"] = json!(repos.iter().take(50).collect::<Vec<_>>());
    out["time_to_pr"] = t;
    let summaries = values(rows, "prs");
    let mut summary = json!({});
    for f in [
        "opened",
        "merged",
        "closed_unmerged",
        "open",
        "not_recorded",
    ] {
        let count = if summaries.iter().all(|v| v.is_object()) {
            let duplicates: u64 = prs
                .iter()
                .map(|g| {
                    let n = g.iter().filter(|v| pr_has(v, f)).count();
                    n.saturating_sub(1) as u64
                })
                .sum();
            sum(&summaries, f).saturating_sub(duplicates)
        } else {
            dedup_refs.iter().filter(|v| pr_has(v, f)).count() as u64
        };
        summary[f] = json!(count);
    }
    // Missing summary fields in local v1 are derived from visible PRs only; omissions remain
    // visible in time_to_pr and never enter a percentile as fabricated samples.
    out["prs"] = summary;
    let abandoned = values(rows, "abandoned_branches");
    let branches: Vec<Value> = groups(
        abandoned.iter().flat_map(|v| array(&v["branches"])),
        &["repo", "branch"],
    )
    .iter()
    .map(|g| {
        let mut v = g[0].clone();
        v["launches"] = json!(sum(g, "launches"));
        v
    })
    .collect();
    let mut repo_inputs = Vec::new();
    for source in &abandoned {
        if source["by_repo"].is_array() {
            repo_inputs.extend(array(&source["by_repo"]).iter().cloned());
        } else {
            for g in groups(array(&source["branches"]).iter(), &["repo"]) {
                repo_inputs.push(json!({"repo": g[0]["repo"], "branches": g.len(), "launches": sum(&g, "launches")}));
            }
        }
    }
    let by_repo: Vec<Value> = groups(repo_inputs.iter(), &["repo"])
        .iter()
        .map(|g| {
            let duplicates: u64 = groups(abandoned.iter().flat_map(|v| array(&v["branches"])).filter(|v| v["repo"] == g[0]["repo"]), &["repo", "branch"])
                .iter().map(|b| b.len().saturating_sub(1) as u64).sum();
            json!({"repo": g[0]["repo"], "branches": sum(g, "branches").saturating_sub(duplicates), "launches": sum(g, "launches")})
        })
        .collect();
    out["abandoned_branches"] = json!({"branches": branches.iter().take(50).collect::<Vec<_>>(),
        "branches_omitted": sum(&abandoned, "branches_omitted") + branches.len().saturating_sub(50) as u64,
        "by_repo": by_repo.iter().take(50).collect::<Vec<_>>(), "by_repo_omitted": sum(&abandoned, "by_repo_omitted") + by_repo.len().saturating_sub(50) as u64});
    out["errors"] = merge_errors(&values(rows, "errors"), missing);
    out
}

fn pr_has(v: &Value, field: &str) -> bool {
    if v["pr"].is_null() {
        return false;
    }
    match field {
        "opened" => true,
        "merged" => v["state"] == "merged" || v["merged_at"].is_string(),
        "open" => v["state"] == "open",
        "closed_unmerged" => v["state"] == "closed" || v["state"] == "closed_unmerged",
        _ => false,
    }
}

fn merge_pr(rows: &[&Value]) -> Value {
    let mut v = rows[0].clone();
    for f in [
        "first_commit_at",
        "pr_created_at",
        "merged_at",
        "first_launch_at",
    ] {
        if rows.iter().any(|v| v.get(f).is_some()) {
            v[f] = extreme(rows, f, true);
        }
    }
    if rows.iter().any(|v| pr_has(v, "merged")) {
        v["state"] = json!("merged");
    }
    if rows.iter().any(|v| v.get("launches").is_some()) {
        v["launches"] = json!(
            rows.iter()
                .map(|v| number(&v["launches"]))
                .max()
                .unwrap_or(0)
        );
    }
    v["shared"] = json!(rows.iter().any(|v| v["shared"] == true));
    for (clock, from, to) in [
        ("to_open_s", "first_commit_at", "pr_created_at"),
        ("to_merge_s", "first_commit_at", "merged_at"),
        ("launch_to_open_s", "first_launch_at", "pr_created_at"),
        ("launch_to_merge_s", "first_launch_at", "merged_at"),
    ] {
        let parsed = v[from]
            .as_str()
            .and_then(time::parse_rfc3339)
            .zip(v[to].as_str().and_then(time::parse_rfc3339));
        v[clock] = match parsed {
            Some((from, to)) if to >= from => json!((to - from) / 1000),
            _ => json!(rows.iter().filter_map(|v| v[clock].as_u64()).min()),
        };
    }
    v
}

fn clocks(rows: &[&Value]) -> Value {
    let mut out = json!({});
    for c in CLOCKS {
        let mut samples: Vec<u64> = rows.iter().filter_map(|v| v[c].as_u64()).collect();
        samples.sort_unstable();
        let percentile = |p: usize| -> Option<u64> {
            if samples.is_empty() {
                None
            } else {
                samples.get((p * samples.len()).div_ceil(100) - 1).copied()
            }
        };
        out[c] = json!({"n": samples.len(), "n_shared": rows.iter().filter(|v| v[c].is_u64() && v["shared"] == true).count(), "p50_s": percentile(50), "p90_s": percentile(90)});
    }
    out
}

fn merge_errors(rows: &[&Value], missing: bool) -> Value {
    let mut out = json!({});
    for kind in ["tool_error", "api_error", "run_failed"] {
        let kinds = values(rows, kind);
        let total = |v: &&Value| {
            v.get("total")
                .or_else(|| v.get("count"))
                .unwrap_or(&Value::Null)
                .as_u64()
        };
        let recorded: Vec<u64> = kinds.iter().filter_map(total).collect();
        let all_ok = !missing
            && kinds
                .iter()
                .all(|v| v["state"] == "ok" || v["state"] == "full");
        let state = if recorded.is_empty() && kind != "run_failed" {
            "not_recorded"
        } else if all_ok {
            "ok"
        } else {
            "partial"
        };
        out[kind] = json!({"state": state, "total": if recorded.is_empty() && kind != "run_failed" { None } else { Some(recorded.iter().sum::<u64>()) }});
    }
    for field in ["by_harness", "by_bot", "by_branch", "by_task"] {
        let keys: &[&str] = match field {
            "by_harness" => &["harness"],
            "by_bot" => BOT_KEY,
            "by_branch" => &["repo", "branch"],
            _ => &["repo", "task"],
        };
        // The local format's per-bot error rows are pivoted below; explicit fleet-shaped input
        // breakdowns are merged directly. Null is controlled by the kind's fleet total.
        let mut normalized = Vec::new();
        for r in rows {
            let mut r = (*r).clone();
            if (field == "by_bot" || field == "by_harness") && r.get(field).is_none() {
                let mut pivot = Vec::new();
                for e in array(&r["rows"]).iter().chain(if field == "by_harness" {
                    array(&r["unattributed"])
                } else {
                    &[]
                }) {
                    let Some(kind) = e["error_kind"].as_str() else {
                        continue;
                    };
                    let mut e = e.clone();
                    e[kind] = e["count"].clone();
                    for k in ["error_kind", "source", "count", "state", "reason"] {
                        e.as_object_mut().unwrap().remove(k);
                    }
                    if field == "by_harness" {
                        e.as_object_mut().unwrap().retain(|k, _| {
                            ["harness", "tool_error", "api_error", "run_failed"]
                                .contains(&k.as_str())
                        });
                    }
                    pivot.push(e);
                }
                r[field] = json!(pivot);
                r[format!("{field}_omitted")] = r["rows_omitted"].clone();
                r[format!("{field}_omitted_count")] = r["omitted_count"].clone();
            }
            normalized.push(r);
        }
        let refs: Vec<&Value> = normalized.iter().collect();
        let (mut merged, omitted, omitted_count) = bounded_groups(
            &refs,
            field,
            keys,
            50,
            &["tool_error", "api_error", "run_failed"],
        );
        for v in merged.as_array_mut().unwrap() {
            for kind in ["tool_error", "api_error"] {
                if out[kind]["total"].is_null() {
                    v[kind] = Value::Null;
                }
            }
        }
        out[field] = merged;
        out[format!("{field}_omitted")] = json!(omitted);
        out[format!("{field}_omitted_count")] = json!(omitted_count);
    }
    out
}

/// CLI entry point: read local JSON files only. A failed collection should be supplied as a
/// non-ok query envelope or `--missing`, while unreadable/malformed input is a command error.
pub fn run(args: &[String], now_ms: i64, version: &str) -> Answer {
    let kind = args.first().map(String::as_str).unwrap_or("usage");
    let kind = if kind == "outcomes" {
        "outcomes"
    } else {
        "usage"
    };
    let out = envelope(kind, now_ms, version);
    if !args
        .first()
        .is_some_and(|s| s == "usage" || s == "outcomes")
    {
        return refuse(
            out,
            "usage",
            "invalid_arguments",
            "expected fleet usage|outcomes --json [--missing MACHINE:REASON[:MESSAGE] ...] FILE ...",
        );
    }
    let mut missing = Vec::new();
    let mut files = Vec::new();
    let mut json = false;
    let mut positional = false;
    let mut args = args[1..].iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--" if !positional => positional = true,
            "--json" if !positional => json = true,
            "--missing" if !positional => {
                let Some(m) = args.next() else {
                    return refuse(
                        out,
                        "usage",
                        "invalid_missing",
                        "--missing needs MACHINE:REASON[:MESSAGE]",
                    );
                };
                let mut parts = m.splitn(3, ':');
                let machine = parts.next().unwrap_or("");
                let reason = parts.next().unwrap_or("");
                let message = parts.next().unwrap_or(reason);
                if machine.is_empty() || reason.is_empty() || message.is_empty() {
                    return refuse(
                        out,
                        "usage",
                        "invalid_missing",
                        "--missing needs nonempty MACHINE:REASON[:MESSAGE]",
                    );
                }
                missing.push(MissingStore {
                    machine: machine.into(),
                    reason: reason.into(),
                    message: message.into(),
                });
            }
            s if s.starts_with('-') && !positional => {
                return refuse(out, "usage", "invalid_arguments", "unknown fleet option");
            }
            _ => files.push(arg),
        }
    }
    if !json {
        return refuse(out, "usage", "json_required", "fleet requires --json");
    }
    let mut inputs = Vec::new();
    for file in files {
        let text = match std::fs::read_to_string(file) {
            Ok(text) => text,
            Err(_) => {
                return refuse(
                    out,
                    "error",
                    "read_failed",
                    "cannot read a fleet input file",
                );
            }
        };
        match serde_json::from_str::<Value>(&text) {
            Ok(mut v) => {
                // A refusal often has no machine object. The caller's file label identifies
                // it without exposing a folder path in fleet output.
                if v.is_object()
                    && kind == "usage"
                    && v["status"] != "ok"
                    && !v["machine"]["id"].is_string()
                {
                    let label = std::path::Path::new(file)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("unknown");
                    v["machine"] = json!({"id": label, "scope": "local"});
                }
                inputs.push(v);
            }
            Err(_) => {
                return refuse(
                    out,
                    "error",
                    "invalid_json",
                    "a fleet input is not one JSON envelope",
                );
            }
        }
    }
    if kind == "outcomes" {
        reduce_outcomes(&inputs, &missing, now_ms, version)
    } else {
        reduce_usage(&inputs, &missing, now_ms, version)
    }
}
