//! `usagemeter repair` (issue 1126): tops up the rollup totals of a store that lost tokens, from an
//! oracle store a person built from the frozen logs with the existing commands.
//!
//! The repair never reads a log and never subtracts. It compares the two stores' rollups per
//! (harness, hour, model, machine, repo, branch, precision), summed over actor state, and plans
//! `after = max(before, oracle)` column by column. A cell where the store holds more than the
//! oracle is kept and listed. Events never change. The recovered tokens go into the group's
//! before-evidence row when it has one, so an hour's evidence sum stays at or under its rollup.
//!
//! The default is a dry run over two read-only opens, which writes nothing. `--apply` needs a
//! verified copy (`--copy` and `--confirm-copy`), the sync lock, and writes one SQLite
//! transaction per day with a `meta` journal key.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::types::ValueRef;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::sources::Source;
use crate::store::SCHEMA_VERSION;
use crate::time::{DAY_MS, HOUR_MS, format_day, parse_rfc3339};

/// The token columns, in the order every array in this file uses. `unsplit` is last.
pub const COLS: [&str; 7] = [
    "input_uncached",
    "cache_read",
    "cache_write_5m",
    "cache_write_1h",
    "output",
    "reasoning",
    "unsplit",
];

/// `meta` key recording the last day a repair transaction committed. A record only: it never
/// decides which day is planned (the plan is rebuilt from the live rows).
pub const JOURNAL: &str = "repair_1126_done";
pub const DEFAULT_FROM: &str = "2026-11-07";
pub const DEFAULT_UNTIL: &str = "2026-11-10";

/// Index of `reasoning` in [`COLS`]: part of `output`, so never added to a total (crate rule,
/// `event.rs`).
const REASONING: usize = 5;

/// All tokens of a row: the six counted columns; `reasoning` is inside `output`.
fn counted(v: &[i64; 7]) -> i64 {
    v.iter().sum::<i64>() - v[REASONING]
}

pub mod exit {
    pub const OK: u8 = 0;
    pub const CONSERVATION: u8 = 1;
    pub const USAGE: u8 = 2;
    pub const NOTHING: u8 = 3;
    pub const NEWER_SCHEMA: u8 = 12;
}

#[derive(Debug, Clone)]
pub struct Copy {
    pub path: PathBuf,
    pub sha256: String,
}

#[derive(Debug, Clone)]
pub struct Opts {
    /// The store's state directory (holds `meter.db`), from `--store`; never defaulted.
    pub state_dir: PathBuf,
    /// The oracle's state directory.
    pub against: PathBuf,
    /// First hour (inclusive) and end (exclusive) of the range, UTC day boundaries.
    pub from_ms: i64,
    pub until_ms: i64,
    pub json: bool,
    pub apply: Option<Copy>,
    pub now_ms: i64,
}

/// What a run decided; `report` is the dry-run plan whatever the mode.
pub struct Done {
    pub code: u8,
    pub report: Report,
    pub applied_days: Vec<String>,
}

#[derive(Debug, Clone)]
struct Row {
    id: String,
    harness: String,
    hour: i64,
    model: String,
    machine: String,
    repo: Option<String>,
    branch: Option<String>,
    precision: String,
    state: Option<String>,
    v: [i64; 7],
    events: i64,
}

type GKey = (
    String,
    i64,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
);

#[derive(Debug, Clone)]
struct Group {
    /// The evidence-free row that takes a top-up; None when the group has none (every row is
    /// attributed: a top-up there would be tokens attributed to a bot with no call behind them).
    target: Option<String>,
    target_rank: (i64, String),
    v: [i64; 7],
    events: i64,
}

fn gkey(r: &Row) -> GKey {
    (
        r.harness.clone(),
        r.hour,
        r.model.clone(),
        r.machine.clone(),
        r.repo.clone(),
        r.branch.clone(),
        r.precision.clone(),
    )
}

fn group(rows: &[Row]) -> BTreeMap<GKey, Group> {
    let mut m: BTreeMap<GKey, Group> = BTreeMap::new();
    for r in rows {
        // The row that takes a top-up: only a before-evidence row (no actor state); the biggest,
        // then the lowest id, so the choice never depends on read order.
        let rank = (-counted(&r.v), r.id.clone());
        let g = m.entry(gkey(r)).or_insert_with(|| Group {
            target: None,
            target_rank: (i64::MAX, String::new()),
            v: [0; 7],
            events: 0,
        });
        if r.state.is_none() && (g.target.is_none() || rank < g.target_rank) {
            g.target = Some(r.id.clone());
            g.target_rank = rank;
        }
        for (a, b) in g.v.iter_mut().zip(r.v) {
            *a += b;
        }
        g.events += r.events;
    }
    m
}

/// One group's planned top-up.
#[derive(Debug, Clone)]
pub struct Change {
    pub harness: String,
    pub hour: i64,
    pub day: String,
    pub id: String,
    pub before: [i64; 7],
    pub oracle: [i64; 7],
    pub after: [i64; 7],
    pub events_before: i64,
    pub events_oracle: i64,
}

impl Change {
    fn delta(&self) -> [i64; 7] {
        std::array::from_fn(|i| self.after[i] - self.before[i])
    }
}

#[derive(Debug, Clone, Default)]
struct Cell {
    before: [i64; 7],
    change: [i64; 7],
    events: i64,
}

#[derive(Debug, Clone, Default)]
pub struct Report {
    pub from_day: String,
    pub until_day: String,
    pub changes: Vec<Change>,
    cells: BTreeMap<(String, String), Cell>,
    /// (harness, day) -> (hours, tokens) with store rows and no oracle rows.
    unresolved: BTreeMap<(String, String), (BTreeSet<i64>, i64)>,
    /// (harness, day, column index) -> tokens the store holds above the oracle.
    kept: BTreeMap<(String, String, usize), i64>,
    /// harness -> (groups, tokens) short outside the range: reported, never repaired.
    outside: BTreeMap<String, (usize, i64)>,
    /// (harness, day) -> (groups, short tokens): short, but the group has no evidence-free row.
    no_free: BTreeMap<(String, String), (usize, i64)>,
    /// The store this plan is for (a path the person gave).
    pub store: String,
    pub failures: Vec<String>,
}

impl Report {
    pub fn total_change(&self) -> i64 {
        self.cells.values().map(|c| counted(&c.change)).sum()
    }
    pub fn total_before(&self) -> i64 {
        self.cells.values().map(|c| counted(&c.before)).sum()
    }
    pub fn passed(&self) -> bool {
        self.failures.is_empty()
    }
    pub fn unresolved_tokens(&self) -> i64 {
        self.unresolved.values().map(|u| u.1).sum()
    }
    pub fn kept_tokens(&self) -> i64 {
        self.kept
            .iter()
            .filter(|((_, _, c), _)| *c != REASONING)
            .map(|(_, t)| t)
            .sum()
    }

    pub fn to_json(&self, code: u8) -> Value {
        let mut cells = vec![];
        for ((h, d), c) in &self.cells {
            for (i, col) in COLS.iter().enumerate() {
                if c.change[i] != 0 {
                    cells.push(json!({
                        "harness": h, "day": d, "column": col,
                        "before": c.before[i], "after": c.before[i] + c.change[i],
                        "change": c.change[i],
                        "events_before": c.events, "events_after": c.events,
                    }));
                }
            }
        }
        let before = self.total_before();
        let change = self.total_change();
        json!({
            "store": self.store,
            "range": {"from": self.from_day, "until": self.until_day},
            "cells": cells,
            "total": {"before": before, "after": before + change, "change": change,
                      "events_change": 0},
            "unresolved": self.unresolved.iter().map(|((h, d), (hours, t))| json!({
                "harness": h, "day": d, "hours": hours.len(), "tokens": t})).collect::<Vec<_>>(),
            "kept": self.kept.iter().map(|((h, d, c), t)| json!({
                "harness": h, "day": d, "column": COLS[*c], "tokens": t})).collect::<Vec<_>>(),
            "outside_range": self.outside.iter().map(|(h, (g, t))| json!({
                "harness": h, "groups": g, "tokens": t})).collect::<Vec<_>>(),
            "unresolved_groups": self.no_free.iter().map(|((h, d), (g, t))| json!({
                "harness": h, "day": d, "groups": g, "tokens": t,
                "reason": "no_evidence_free_row"})).collect::<Vec<_>>(),
            "targets": {"state": "before_evidence", "rows": self.changes.len()},
            "conservation": {"pass": self.failures.is_empty(), "failures": self.failures},
            "exit": code,
        })
    }

    pub fn to_text(&self, code: u8) -> String {
        let mut s = String::new();
        s.push_str(&format!(
            "repair plan for the store {}, {}..{} (dry run unless --apply)\n\
             top-ups go to the group's before-evidence row\n",
            self.store, self.from_day, self.until_day
        ));
        s.push_str(&format!(
            "{:<12} {:<11} {:<15} {:>16} {:>16} {:>14}  {}\n",
            "harness", "day", "column", "before", "after", "change", "events before/after"
        ));
        for ((h, d), c) in &self.cells {
            for (i, col) in COLS.iter().enumerate() {
                if c.change[i] != 0 {
                    s.push_str(&format!(
                        "{:<12} {:<11} {:<15} {:>16} {:>16} {:>+14}  {} / {}\n",
                        h,
                        d,
                        col,
                        th(c.before[i]),
                        th(c.before[i] + c.change[i]),
                        c.change[i],
                        th(c.events),
                        th(c.events)
                    ));
                }
            }
        }
        let (b, c) = (self.total_before(), self.total_change());
        s.push_str(&format!(
            "TOTAL tokens before {} after {} change {:+} events change 0\n",
            th(b),
            th(b + c),
            c
        ));
        let hours: usize = self.unresolved.values().map(|u| u.0.len()).sum();
        s.push_str(&format!(
            "unresolved: {hours} hours, {} tokens (rows, no oracle rows; not touched)\n",
            th(self.unresolved_tokens())
        ));
        for ((h, d), (hrs, t)) in &self.unresolved {
            s.push_str(&format!(
                "  {h} {d}: {} hours, {} tokens\n",
                hrs.len(),
                th(*t)
            ));
        }
        s.push_str(&format!(
            "kept: {} cells, {} tokens (store above oracle; kept)\n",
            self.kept.len(),
            th(self.kept_tokens())
        ));
        for ((h, d, col), t) in &self.kept {
            s.push_str(&format!("  {h} {d} {}: {}\n", COLS[*col], th(*t)));
        }
        for ((h, d), (g, t)) in &self.no_free {
            s.push_str(&format!(
                "unresolved, no evidence-free row (every row attributed; not touched): {h} {d}: \
                 {g} groups short, {} tokens\n",
                th(*t)
            ));
        }
        for (h, (g, t)) in &self.outside {
            s.push_str(&format!(
                "outside range (reported, not repaired): {h}: {g} rows short, {} tokens\n",
                th(*t)
            ));
        }
        if self.failures.is_empty() {
            s.push_str("conservation: PASS\n");
        } else {
            s.push_str("conservation: FAIL\n");
            for f in &self.failures {
                s.push_str(&format!("  - {f}\n"));
            }
        }
        s.push_str(&format!("exit {code}\n"));
        s
    }
}

fn th(n: i64) -> String {
    let neg = n < 0;
    let digits = n.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    if neg { format!("-{out}") } else { out }
}

fn has_column(c: &Connection, table: &str, col: &str) -> rusqlite::Result<bool> {
    c.query_row(
        "SELECT count(*) FROM pragma_table_info(?1) WHERE name = ?2",
        params![table, col],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n > 0)
}

fn has_table(c: &Connection, table: &str) -> rusqlite::Result<bool> {
    c.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n > 0)
}

/// The store's `schema_version`, if it has one.
fn schema_version(c: &Connection) -> rusqlite::Result<Option<i64>> {
    if !has_table(c, "meta")? {
        return Ok(None);
    }
    let v: Option<String> = c
        .query_row("SELECT v FROM meta WHERE k = 'schema_version'", [], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(v.and_then(|v| v.parse().ok()))
}

/// Every rollup row with an hour in `[lo, hi)`.
fn load(c: &Connection, lo: i64, hi: i64, all: bool) -> rusqlite::Result<Vec<Row>> {
    let state = if has_column(c, "usage", "actor_state")? {
        "actor_state"
    } else {
        "NULL"
    };
    let range = if all {
        ""
    } else {
        "WHERE hour_ms >= ?1 AND hour_ms < ?2"
    };
    let sql = format!(
        "SELECT id, harness, hour_ms, model, machine, repo, branch, precision, {state},
                input_uncached, cache_read, cache_write_5m, cache_write_1h, output, reasoning,
                unsplit, events FROM usage {range} ORDER BY id"
    );
    let mut st = c.prepare(&sql)?;
    let map = |r: &rusqlite::Row| -> rusqlite::Result<Row> {
        let mut v = [0i64; 7];
        for (i, x) in v.iter_mut().enumerate() {
            *x = r.get(9 + i)?;
        }
        Ok(Row {
            id: r.get(0)?,
            harness: r.get(1)?,
            hour: r.get(2)?,
            model: r.get(3)?,
            machine: r.get(4)?,
            repo: r.get(5)?,
            branch: r.get(6)?,
            precision: r.get(7)?,
            state: r.get(8)?,
            v,
            events: r.get(16)?,
        })
    };
    let rows = if all {
        st.query_map([], map)?.collect::<Result<Vec<_>, _>>()?
    } else {
        st.query_map([lo, hi], map)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

/// Per hour, the evidence table's sums, for hours in `[lo, hi)`. Empty when it has no table.
fn evidence_hours(c: &Connection, lo: i64, hi: i64) -> rusqlite::Result<BTreeMap<i64, [i64; 7]>> {
    let mut m = BTreeMap::new();
    if !has_table(c, "evidence")? {
        return Ok(m);
    }
    let sums: Vec<String> = COLS.iter().map(|c| format!("sum({c})")).collect();
    let sql = format!(
        "SELECT ts_ms / {HOUR_MS}, {} FROM evidence WHERE ts_ms >= ?1 AND ts_ms < ?2 GROUP BY 1",
        sums.join(", ")
    );
    let mut st = c.prepare(&sql)?;
    let rows = st.query_map([lo, hi], |r| {
        let h: i64 = r.get(0)?;
        let mut v = [0i64; 7];
        for (i, x) in v.iter_mut().enumerate() {
            *x = r.get(1 + i)?;
        }
        Ok((h * HOUR_MS, v))
    })?;
    for r in rows {
        let (h, v) = r?;
        m.insert(h, v);
    }
    Ok(m)
}

fn is_untouchable(harness: &str) -> bool {
    harness == Source::Codex.harness() || harness == Source::Agy.harness()
}

/// Builds the plan and runs checks 1 to 6 on it. Pure: it reads only the rows it is given.
fn plan(
    store: &[Row],
    oracle: &[Row],
    evidence: &BTreeMap<i64, [i64; 7]>,
    from_ms: i64,
    until_ms: i64,
) -> Report {
    let mut rep = Report {
        from_day: format_day(from_ms),
        until_day: format_day(until_ms - DAY_MS),
        ..Report::default()
    };
    let sg = group(store);
    let og = group(oracle);
    let oracle_hours: BTreeSet<(String, i64)> = og.keys().map(|k| (k.0.clone(), k.1)).collect();
    let in_range = |h: i64| h >= from_ms && h < until_ms;

    // Cell "before" and the unresolved hours come from every store row in range.
    for (k, g) in &sg {
        if !in_range(k.1) {
            continue;
        }
        let day = format_day(k.1);
        let cell = rep.cells.entry((k.0.clone(), day.clone())).or_default();
        for i in 0..7 {
            cell.before[i] += g.v[i];
        }
        cell.events += g.events;
        if !oracle_hours.contains(&(k.0.clone(), k.1)) {
            let u = rep.unresolved.entry((k.0.clone(), day)).or_default();
            u.0.insert(k.1);
            u.1 += counted(&g.v);
        }
    }

    let mut events_bad = 0usize;
    let mut oracle_only = 0usize;
    for (k, o) in &og {
        let s = sg.get(k);
        if !in_range(k.1) {
            // Outside the range: reported, never repaired.
            let before = s.map_or([0; 7], |g| g.v);
            let short: i64 = (0..7)
                .filter(|i| *i != REASONING)
                .map(|i| (o.v[i] - before[i]).max(0))
                .sum();
            if short > 0 {
                let e = rep.outside.entry(k.0.clone()).or_default();
                e.0 += 1;
                e.1 += short;
            }
            continue;
        }
        let Some(s) = s else {
            oracle_only += 1;
            continue;
        };
        let after: [i64; 7] = std::array::from_fn(|i| s.v[i].max(o.v[i]));
        let day = format_day(k.1);
        for i in 0..7 {
            if s.v[i] > o.v[i] {
                *rep.kept.entry((k.0.clone(), day.clone(), i)).or_default() += s.v[i] - o.v[i];
            }
        }
        if after != s.v && s.target.is_none() {
            // Short, and every row of the group is attributed: not repaired, listed.
            let e = rep.no_free.entry((k.0.clone(), day)).or_default();
            e.0 += 1;
            e.1 += (0..7)
                .filter(|i| *i != REASONING)
                .map(|i| (o.v[i] - s.v[i]).max(0))
                .sum::<i64>();
        } else if after != s.v {
            if s.events != o.events {
                events_bad += 1;
            }
            rep.changes.push(Change {
                harness: k.0.clone(),
                hour: k.1,
                day,
                id: s.target.clone().expect("checked above"),
                before: s.v,
                oracle: o.v,
                after,
                events_before: s.events,
                events_oracle: o.events,
            });
        }
    }
    // Store groups with no oracle group in a resolved hour: the store holds tokens the oracle
    // does not (kept, never subtracted).
    for (k, s) in &sg {
        if in_range(k.1) && !og.contains_key(k) && oracle_hours.contains(&(k.0.clone(), k.1)) {
            let day = format_day(k.1);
            for i in 0..7 {
                if s.v[i] > 0 {
                    *rep.kept.entry((k.0.clone(), day.clone(), i)).or_default() += s.v[i];
                }
            }
        }
    }
    for c in &rep.changes {
        let cell = rep
            .cells
            .entry((c.harness.clone(), c.day.clone()))
            .or_default();
        for (i, d) in c.delta().iter().enumerate() {
            cell.change[i] += d;
        }
    }

    // 1. no column or event goes down; events change 0.
    for c in &rep.changes {
        if (0..7).any(|i| c.after[i] < c.before[i]) {
            rep.failures.push(format!(
                "a column goes down: {} {}",
                c.harness,
                format_day(c.hour)
            ));
        }
        // 2. after equals the oracle in each column where it was short.
        if (0..7).any(|i| c.before[i] < c.oracle[i] && c.after[i] != c.oracle[i]) {
            rep.failures.push(format!(
                "a short column does not reach the oracle: {} {}",
                c.harness,
                format_day(c.hour)
            ));
        }
    }
    if events_bad > 0 {
        rep.failures.push(format!(
            "events differ in {events_bad} rows to repair (a different problem; nothing planned)"
        ));
    }
    if oracle_only > 0 {
        rep.failures.push(format!(
            "{oracle_only} oracle rows in range have no store row (events would change)"
        ));
    }
    // 3. the evidence sum stays at or under the rollup, before and after.
    let mut roll: BTreeMap<i64, ([i64; 7], [i64; 7])> = BTreeMap::new();
    for (k, g) in &sg {
        if in_range(k.1) {
            let e = roll.entry(k.1).or_default();
            for i in 0..7 {
                e.0[i] += g.v[i];
                e.1[i] += g.v[i];
            }
        }
    }
    for c in &rep.changes {
        let e = roll.entry(c.hour).or_default();
        for (i, d) in c.delta().iter().enumerate() {
            e.1[i] += d;
        }
    }
    for (hour, ev) in evidence {
        let (b, a) = roll.get(hour).copied().unwrap_or_default();
        if (0..7).any(|i| ev[i] > b[i]) {
            rep.failures.push(format!(
                "evidence above the rollup before the repair in hour {hour}"
            ));
        }
        if (0..7).any(|i| ev[i] > a[i]) {
            rep.failures.push(format!(
                "evidence above the rollup after the repair in hour {hour}"
            ));
        }
    }
    // 4. unresolved hours are untouched.
    if rep.changes.iter().any(|c| {
        rep.unresolved
            .get(&(c.harness.clone(), c.day.clone()))
            .is_some_and(|u| u.0.contains(&c.hour))
    }) {
        rep.failures
            .push("a change falls in an unresolved hour".into());
    }
    // 6. Codex and Antigravity change nothing.
    for ((h, d), c) in &rep.cells {
        if is_untouchable(h) && c.change.iter().any(|x| *x != 0) {
            rep.failures
                .push(format!("{h} {d} has a non-zero change (expected none)"));
        }
    }
    rep
}

fn parse_day(s: &str) -> Result<i64, String> {
    let b = s.as_bytes();
    if b.len() != 10 {
        return Err(format!("{s:?} is not a day (YYYY-MM-DD)"));
    }
    parse_rfc3339(&format!("{s}T00:00:00Z"))
        .ok_or_else(|| format!("{s:?} is not a day (YYYY-MM-DD)"))
}

/// Parses the arguments after `repair`. Returns the options, or the usage error.
pub fn parse(args: &[String], now_ms: i64) -> Result<Opts, String> {
    let (mut store, mut against, mut from, mut until) = (
        None,
        None,
        DEFAULT_FROM.to_string(),
        DEFAULT_UNTIL.to_string(),
    );
    let (mut json, mut dry, mut apply) = (false, false, false);
    let (mut confirm, mut copy) = (None, None);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut val = |f: &str| {
            it.next()
                .cloned()
                .ok_or_else(|| format!("{f} needs a value"))
        };
        match a.as_str() {
            "--store" => store = Some(PathBuf::from(val("--store")?)),
            "--against" => against = Some(PathBuf::from(val("--against")?)),
            "--from" => from = val("--from")?,
            "--until" => until = val("--until")?,
            "--confirm-copy" => confirm = Some(val("--confirm-copy")?),
            "--copy" => copy = Some(PathBuf::from(val("--copy")?)),
            "--json" => json = true,
            "--dry-run" => dry = true,
            "--apply" => apply = true,
            other => return Err(format!("repair: unknown option {other:?}")),
        }
    }
    if dry && apply {
        return Err("repair: --dry-run and --apply exclude each other".into());
    }
    let store =
        store.ok_or("repair needs --store <the store's state dir>: it is never defaulted")?;
    let against = against.ok_or("repair needs --against <oracle state dir>")?;
    let from_ms = parse_day(&from)?;
    let until_ms = parse_day(&until)? + DAY_MS;
    if from_ms >= until_ms {
        return Err("--from must not be after --until".into());
    }
    let apply = if apply {
        let sha = confirm.ok_or("--apply needs --confirm-copy <sha256> and --copy <path>")?;
        let path = copy.ok_or("--apply needs --copy <path> of the verified copy")?;
        let sha = sha.to_ascii_lowercase();
        if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("--confirm-copy takes the copy's sha256 (64 hex digits)".into());
        }
        Some(Copy { path, sha256: sha })
    } else if confirm.is_some() || copy.is_some() {
        return Err("--copy and --confirm-copy belong to --apply".into());
    } else {
        None
    };
    Ok(Opts {
        state_dir: store,
        against,
        from_ms,
        until_ms,
        json,
        apply,
        now_ms,
    })
}

fn sha256_file(p: &Path) -> std::io::Result<String> {
    let mut f = File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(crate::event::hex(&h.finalize()))
}

/// Loads both stores read-only and builds the plan with checks 1 to 6.
fn build_plan(o: &Opts) -> Result<Result<Report, u8>, String> {
    let db = o.state_dir.join("meter.db");
    let odb = o.against.join("meter.db");
    for (what, p) in [("the store", &db), ("the oracle", &odb)] {
        if !p.is_file() {
            return Err(format!("{what} has no meter.db at {}", p.display()));
        }
    }
    let busy = std::time::Duration::from_secs(5);
    let s = crate::query::open_read_only(&db, busy).map_err(|e| format!("the store: {e}"))?;
    let x = crate::query::open_read_only(&odb, busy).map_err(|e| format!("the oracle: {e}"))?;
    for (what, c) in [("store", &s), ("oracle", &x)] {
        match schema_version(c).map_err(|e| format!("the {what}: {e}"))? {
            Some(v) if v > SCHEMA_VERSION => {
                eprintln!(
                    "meter: the {what}'s schema_version is {v}, newer than this meter's \
                     {SCHEMA_VERSION}; update the meter"
                );
                return Ok(Err(exit::NEWER_SCHEMA));
            }
            Some(v) if v == SCHEMA_VERSION => {}
            _ => return Err(format!("the {what} is not at schema {SCHEMA_VERSION}")),
        }
    }
    let err = |what: &'static str| move |e: rusqlite::Error| format!("the {what}: {e}");
    let all_store = load(&s, 0, 0, true).map_err(err("store"))?;
    // The oracle is read whole too, so rows outside the range can be reported.
    let oracle = load(&x, 0, 0, true).map_err(err("oracle"))?;
    let ev = evidence_hours(&s, o.from_ms, o.until_ms).map_err(err("store"))?;
    Ok(Ok(plan(&all_store, &oracle, &ev, o.from_ms, o.until_ms)))
}

pub fn execute(o: &Opts) -> Result<Done, String> {
    let report = match build_plan(o)? {
        Ok(mut r) => {
            r.store = o.state_dir.display().to_string();
            r
        }
        Err(code) => {
            return Ok(Done {
                code,
                report: Report::default(),
                applied_days: vec![],
            });
        }
    };
    let code = if !report.passed() {
        exit::CONSERVATION
    } else if report.changes.is_empty() {
        // Not the counted total: a gap in `reasoning` alone is a change too, printed and applied.
        exit::NOTHING
    } else {
        exit::OK
    };
    let Some(copy) = &o.apply else {
        return Ok(Done {
            code,
            report,
            applied_days: vec![],
        });
    };
    if code != exit::OK {
        return Ok(Done {
            code,
            report,
            applied_days: vec![],
        });
    }
    let days = apply(o, copy, &report, usize::MAX)?;
    // Every day the plan has must be committed: an apply that did less is not a success.
    let planned: BTreeSet<&str> = report.changes.iter().map(|c| c.day.as_str()).collect();
    if days.len() != planned.len() {
        eprintln!(
            "meter: the plan has {} days with a change, {} were committed",
            planned.len(),
            days.len()
        );
        return Ok(Done {
            code: exit::CONSERVATION,
            report,
            applied_days: days,
        });
    }
    Ok(Done {
        code: exit::OK,
        report,
        applied_days: days,
    })
}

/// A copy is accepted only when it is the file whose sha256 was given and passes `quick_check`;
/// [`compare_counts`] then checks it against the store. Needs no lock: it reads the copy only.
fn verify_copy(copy: &Copy) -> Result<Connection, String> {
    let sha = sha256_file(&copy.path).map_err(|e| format!("the copy: {e}"))?;
    if sha != copy.sha256 {
        return Err(format!(
            "the copy's sha256 is {sha}, not the {} given; nothing was written",
            copy.sha256
        ));
    }
    let c = crate::query::open_read_only(&copy.path, std::time::Duration::from_secs(5))
        .map_err(|e| format!("the copy: {e}"))?;
    let qc: String = c
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| format!("the copy: {e}"))?;
    if qc != "ok" {
        return Err(format!(
            "the copy fails quick_check ({qc}); nothing was written"
        ));
    }
    Ok(c)
}

/// The copy holds as many rollup rows and tokens as the store does right now.
fn compare_counts(store: &Connection, c: &Connection, resuming: bool) -> Result<(), String> {
    let sum = "SELECT count(*), coalesce(sum(input_uncached + cache_read + cache_write_5m + \
               cache_write_1h + output + reasoning + unsplit), 0) FROM usage";
    let q =
        |c: &Connection| c.query_row(sum, [], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)));
    let (a, b) = (
        q(store).map_err(|e| e.to_string())?,
        q(c).map_err(|e| e.to_string())?,
    );
    // A copy is of the store before the first day was written: once a journal says some days
    // are done, the store may hold more than the copy, never less.
    if a.0 != b.0 || (a.1 != b.1 && !(resuming && a.1 > b.1)) {
        return Err(format!(
            "the copy holds {} rollup rows and {} tokens, the store {} and {}; make a new copy",
            b.0, b.1, a.0, a.1
        ));
    }
    Ok(())
}

/// The columns to order a table's rows by: its primary key, else `rowid`. A table made `WITHOUT
/// ROWID` (the outcomes `pr` table) has no `rowid` column but always has a primary key.
fn order_by(tx: &Transaction, table: &str) -> rusqlite::Result<String> {
    let pk: Vec<String> = tx
        .prepare("SELECT name FROM pragma_table_info(?1) WHERE pk > 0 ORDER BY pk")?
        .query_map([table], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(if pk.is_empty() {
        "rowid".to_string()
    } else {
        pk.iter()
            .map(|c| format!("\"{c}\""))
            .collect::<Vec<_>>()
            .join(", ")
    })
}

/// The fingerprint of a whole store file (every table whole, the rollup rows outside `[lo,
/// hi)`), for a test to see that every table the schema makes can be hashed.
pub fn fingerprint_file(db: &Path, lo: i64, hi: i64) -> Result<String, String> {
    let mut c = Connection::open(db).map_err(|e| e.to_string())?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    fingerprint(&tx, lo, hi).map_err(|e| e.to_string())
}

/// A hash of every row the repair must leave alone: the rollup rows outside `[lo, hi)`, the
/// `meta` rows but the journal, and every other table whole.
fn fingerprint(tx: &Transaction, lo: i64, hi: i64) -> rusqlite::Result<String> {
    let names: Vec<String> = tx
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name",
        )?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut h = Sha256::new();
    for n in names {
        h.update(n.as_bytes());
        let sql = match n.as_str() {
            "usage" => {
                format!("SELECT * FROM usage WHERE hour_ms < {lo} OR hour_ms >= {hi} ORDER BY id")
            }
            "meta" => format!("SELECT * FROM meta WHERE k != '{JOURNAL}' ORDER BY k"),
            _ => format!("SELECT * FROM \"{n}\" ORDER BY {}", order_by(tx, &n)?),
        };
        let mut st = tx.prepare(&sql)?;
        let cols = st.column_count();
        let mut rows = st.query([])?;
        while let Some(r) = rows.next()? {
            for i in 0..cols {
                match r.get_ref(i)? {
                    ValueRef::Null => h.update([0u8]),
                    ValueRef::Integer(v) => {
                        h.update([1u8]);
                        h.update(v.to_le_bytes());
                    }
                    ValueRef::Real(v) => {
                        h.update([2u8]);
                        h.update(v.to_le_bytes());
                    }
                    ValueRef::Text(t) => {
                        h.update([3u8]);
                        h.update((t.len() as u64).to_le_bytes());
                        h.update(t);
                    }
                    ValueRef::Blob(b) => {
                        h.update([4u8]);
                        h.update((b.len() as u64).to_le_bytes());
                        h.update(b);
                    }
                }
            }
        }
    }
    Ok(crate::event::hex(&h.finalize()))
}

/// The copy must be a separate file: not the store by any spelling, not a symlink, and not the
/// store's own inode (a hard link has the store's bytes and sha256 and would pass as a copy).
fn check_separate(db: &Path, copy: &Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let link = std::fs::symlink_metadata(copy).map_err(|e| format!("the copy: {e}"))?;
    if link.file_type().is_symlink() {
        return Err("the copy is a symbolic link; it must be a separate file".into());
    }
    let (a, b) = (
        std::fs::metadata(db).map_err(|e| format!("the store: {e}"))?,
        std::fs::metadata(copy).map_err(|e| format!("the copy: {e}"))?,
    );
    let same_path = match (std::fs::canonicalize(db), std::fs::canonicalize(copy)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    };
    if same_path || (a.dev() == b.dev() && a.ino() == b.ino()) {
        return Err("the copy is the store itself (same file); it must be a separate file".into());
    }
    Ok(())
}

fn check_schema(c: &Connection) -> Result<(), String> {
    match schema_version(c).map_err(|e| e.to_string())? {
        Some(v) if v > SCHEMA_VERSION => Err(format!(
            "the store's schema_version is {v}, newer than this meter's {SCHEMA_VERSION}; \
             nothing was written"
        )),
        Some(v) if v == SCHEMA_VERSION => Ok(()),
        _ => Err(format!("the store is not at schema {SCHEMA_VERSION}")),
    }
}

fn journal(c: &Connection) -> Result<Option<String>, String> {
    c.query_row("SELECT v FROM meta WHERE k = ?1", [JOURNAL], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())
}

/// Writes the plan, one transaction per day, at most `limit` days (a test's stand-in for a kill
/// between days). Returns the days committed.
///
/// Every refusal that needs no lock comes first (the copy is a separate file, its sha256, its
/// `quick_check`, its counts against the store, the schema), all by read-only opens, so a refused
/// apply creates nothing in the store's folder. The lock file is never removed afterwards: it may
/// be one a sync has opened or locked in the meantime, and the sync lock belongs to the sync.
pub fn apply(o: &Opts, copy: &Copy, rep: &Report, limit: usize) -> Result<Vec<String>, String> {
    let db = o.state_dir.join("meter.db");
    check_separate(&db, &copy.path)?;
    let copy_conn = {
        let ro = crate::query::open_read_only(&db, std::time::Duration::from_secs(5))
            .map_err(|e| format!("the store: {e}"))?;
        check_schema(&ro)?;
        let c = verify_copy(copy)?;
        compare_counts(&ro, &c, journal(&ro)?.is_some())?;
        c
    };
    let _lock = match crate::paths::try_lock(&o.state_dir) {
        Ok(Some(l)) => l,
        Ok(None) => return Err("another sync holds the lock; nothing was written".into()),
        Err(e) => return Err(format!("the lock: {e}")),
    };
    let mut conn = Connection::open(&db).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    // Under the lock: the store may have changed since the checks above.
    check_schema(&conn)?;
    compare_counts(&conn, &copy_conn, journal(&conn)?.is_some())?;
    let mut by_day: BTreeMap<&str, Vec<&Change>> = BTreeMap::new();
    for c in &rep.changes {
        by_day.entry(c.day.as_str()).or_default().push(c);
    }
    let mut committed = vec![];
    for (day, changes) in by_day {
        if committed.len() >= limit {
            break;
        }
        let lo = parse_day(day)?;
        let hi = lo + DAY_MS;
        let tx = Transaction::new(&mut conn, TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        day_tx(&tx, day, lo, hi, &changes, o.now_ms)?; // an Err drops tx: the day rolls back
        tx.commit().map_err(|e| e.to_string())?;
        committed.push(day.to_string());
    }
    Ok(committed)
}

fn day_tx(
    tx: &Transaction,
    day: &str,
    lo: i64,
    hi: i64,
    changes: &[&Change],
    now_ms: i64,
) -> Result<(), String> {
    let e = |e: rusqlite::Error| e.to_string();
    let fp0 = fingerprint(tx, lo, hi).map_err(e)?;
    let before = load(tx, lo, hi, false).map_err(e)?;
    let bg = group(&before);
    let set: Vec<String> = COLS.iter().map(|c| format!("{c} = {c} + ?")).collect();
    let sql = format!(
        "UPDATE usage SET {}, updated_ms = ? WHERE id = ?",
        set.join(", ")
    );
    for c in changes {
        let d = c.delta();
        let mut p: Vec<rusqlite::types::Value> = d.iter().map(|x| (*x).into()).collect();
        p.push(now_ms.into());
        p.push(c.id.clone().into());
        let n = tx.execute(&sql, rusqlite::params_from_iter(p)).map_err(e)?;
        if n != 1 {
            return Err(format!("{day}: the row to top up is gone; day rolled back"));
        }
    }
    // The day's own conservation, on what the transaction now holds.
    let after = group(&load(tx, lo, hi, false).map_err(e)?);
    let mut planned: BTreeMap<GKey, &Change> = BTreeMap::new();
    for c in changes {
        let r = before.iter().find(|r| r.id == c.id).ok_or_else(|| {
            format!("{day}: the row to top up is not in the day; day rolled back")
        })?;
        planned.insert(gkey(r), *c);
    }
    if after.len() != bg.len() {
        return Err(format!(
            "{day}: the set of rollup groups changed; day rolled back"
        ));
    }
    for (k, b) in &bg {
        let a = after
            .get(k)
            .ok_or_else(|| format!("{day}: a group went; day rolled back"))?;
        if a.events != b.events {
            return Err(format!("{day}: events changed; day rolled back"));
        }
        let want = planned.get(k).map_or(b.v, |c| c.after);
        if a.v != want {
            return Err(format!(
                "{day}: a group is not what the plan says; day rolled back"
            ));
        }
    }
    let ev = evidence_hours(tx, lo, hi).map_err(e)?;
    let mut roll: BTreeMap<i64, [i64; 7]> = BTreeMap::new();
    for (k, g) in &after {
        let r = roll.entry(k.1).or_default();
        for (a, b) in r.iter_mut().zip(g.v) {
            *a += b;
        }
    }
    for (hour, s) in &ev {
        let r = roll.get(hour).copied().unwrap_or_default();
        if (0..7).any(|i| s[i] > r[i]) {
            return Err(format!("{day}: evidence above the rollup; day rolled back"));
        }
    }
    if fingerprint(tx, lo, hi).map_err(e)? != fp0 {
        return Err(format!(
            "{day}: a row outside the day changed; day rolled back"
        ));
    }
    tx.execute(
        "INSERT INTO meta(k, v) VALUES(?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        params![JOURNAL, day],
    )
    .map_err(e)?;
    Ok(())
}

/// The `repair` command: prints the plan (table or JSON) and returns the exit code.
pub fn cmd(args: &[String], now_ms: i64) -> u8 {
    let o = match parse(args, now_ms) {
        Ok(o) => o,
        Err(m) => {
            eprintln!("meter: {m}");
            return exit::USAGE;
        }
    };
    match execute(&o) {
        Ok(d) => {
            if d.report.from_day.is_empty() {
                return d.code; // refused before a plan (newer schema); stderr said why
            }
            if o.json {
                let mut j = d.report.to_json(d.code);
                if o.apply.is_some() {
                    j["applied_days"] = json!(d.applied_days);
                }
                println!("{j}");
            } else {
                print!("{}", d.report.to_text(d.code));
                if o.apply.is_some() {
                    println!("applied days: {}", d.applied_days.join(", "));
                }
            }
            d.code
        }
        Err(m) => {
            eprintln!("meter: {m}");
            // A day's own check failed and that day was rolled back: a conservation failure.
            if m.contains("rolled back") {
                exit::CONSERVATION
            } else {
                exit::USAGE
            }
        }
    }
}
