//! `usagemeter outcomes`: recorded failures and time to pull request (issues 899 and 1026).
//!
//! One local, read-only, fork-and-exit report on the query's read-only open, like `coverage`: it
//! creates nothing, migrates nothing, writes no `meta`, takes no lock, calls no `hc` and opens no
//! network. It is not contract 1 and adds no query-envelope field (RFC 0018 (c)). It prints text
//! (the default) or one JSON record, per contract 1's `d1`, `d7` and `d30` windows:
//!
//! - **Failures, as raw counts**, per launch tag (bot, kind, role, squad), harness, kind and
//!   source, and the unattributed by reason. Three kinds, each a fact something else recorded:
//!   `tool_error` (`harness_log`: a tool result the harness itself flagged as failed),
//!   `api_error` (`harness_log`: a model call the harness itself flagged as failed after its own
//!   retries, including usage-limit stops) and `run_failed` (a launch whose terminal exited with a
//!   non-zero status or on a signal: `hc_snapshot` when hc's list of finished terminals said so,
//!   `workers_ledger` when an `end` row of Herdr's workers ledger copied it). The counts are of
//!   harness-flagged failures, including expected ones (a red test run while working test-first, a
//!   grep with no match) and usage-limit stops: they are not a quality verdict on their own, and
//!   the report prints no rate, ratio, threshold, label or score. Behaviour scoring stays in
//!   genie.
//! - **Time to pull request**, on two clocks: from the branch's first commit, and from its first
//!   worker launch, to the pull request opened and merged, per branch, and as nearest-rank p50 and
//!   p90 per repo and per (bot, role).
//!
//! Unknown is never 0. A harness whose failure marker no fixture pins is `unsupported`; a window
//! that starts before the failures were recorded is `partial`; a store `sync` has not yet
//! prepared is `not_recorded`; a window with nothing in it is `no_data`, its counts and
//! percentiles null. The output holds no tool name, argument, output, error text, session,
//! folder or terminal, and no pull request's title, author or address.

pub mod record;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt::Write as _;

use rusqlite::Connection;
use serde::Serialize;

use crate::coverage::Reply;
use crate::query::{self, Located, Window, exit};
use crate::sources::Source;
use crate::sources::tool_error;
use crate::store::SCHEMA_VERSION;
use crate::time::format_rfc3339;

/// The JSON record's version.
pub const RECORD_VERSION: u64 = 1;

/// At most this many are shown per window; the rest are counted, so every total stays complete.
const MAX_ROWS: usize = 50;
const MAX_BOTS: usize = 50;
const MAX_REPOS: usize = 50;
const MAX_BRANCHES: usize = 200;
/// The whole output's ceiling: lists are cut further, and counted, until it fits.
pub const OUTPUT_CAP: usize = 64 * 1024;

/// What every count here is, printed with it (RFC 0018 (c)).
pub const NOTE: &str = "raw counts of failures a harness or hc recorded, including expected ones \
     (a red test run while working test-first, a grep with no match) and usage-limit stops \
     (written after a harness's own retries, so a count of model calls that failed for the \
     session, not each retried attempt); not a quality verdict on their own";
const TOOL_ERROR_RULE: &str = "harness-flagged failures, including expected ones";
const API_ERROR_RULE: &str = "harness-flagged model-call failures after the harness's own \
     retries (model calls that failed for the session, not each retried attempt, including \
     usage-limit stops; not a quality verdict on their own)";
const RUN_FAILED_RULE: &str = "a launch whose terminal ended on its own with a non-zero exit \
     status or on a signal, as hc's list of finished terminals gave it (hc_snapshot) or as an end \
     row of the workers ledger copied it (workers_ledger); killed and stopped_by_restart are \
     ends, never errors";
/// A count read from ends of both sources.
const BOTH_END_SOURCES: &str = "hc_snapshot,workers_ledger";
const RUN_FAILED: &str = "run_failed";

const ABSENT: &str = "no meter store on this machine yet; open Herdr or run usagemeter sync";

/// The rule that makes a line of this harness's log a tool failure, when a fixture pins one
/// (`tests/fixtures/tool-errors/`, [`tool_error`]). None is `unsupported`, never 0.
pub fn marker(s: Source) -> Option<&'static str> {
    match s {
        Source::Claude => Some("a tool_result block with is_error: true, once per tool_use_id"),
        Source::Codex => Some(
            "an item_completed event whose item has status \"failed\" or a non-zero exit_code, \
             once per item id",
        ),
        Source::Omp | Source::DshTui | Source::Agy => None,
    }
}

/// The rule that makes a line of this harness's log a failed model call (`api_error`), when a
/// fixture pins one (`tests/fixtures/tool-errors/`, [`tool_error`]). None is `unsupported`, never
/// 0.
pub fn api_error_marker(s: Source) -> Option<&'static str> {
    match s {
        Source::Claude => Some(
            "a type \"assistant\" line with top-level isApiErrorMessage: true (written after \
             Claude Code's own retries, including usage-limit stops), once per line uuid",
        ),
        Source::Codex | Source::Omp | Source::DshTui | Source::Agy => None,
    }
}

fn unsupported_harnesses() -> Vec<&'static str> {
    let mut v: Vec<&'static str> = Source::ALL
        .into_iter()
        .filter(|s| !tool_error::pinned(*s))
        .map(Source::harness)
        .collect();
    v.sort_unstable();
    v
}

fn api_error_unsupported_harnesses() -> Vec<&'static str> {
    let mut v: Vec<&'static str> = Source::ALL
        .into_iter()
        .filter(|s| !tool_error::api_error_pinned(*s))
        .map(Source::harness)
        .collect();
    v.sort_unstable();
    v
}

fn err(code: u8, message: impl Into<String>) -> Reply {
    Reply {
        code,
        stdout: String::new(),
        stderr: Some(format!("meter: outcomes: {}", message.into())),
    }
}

struct Failure {
    code: u8,
    message: String,
}

impl Failure {
    fn new(code: u8, message: impl Into<String>) -> Failure {
        Failure {
            code,
            message: message.into(),
        }
    }

    fn sql(e: rusqlite::Error) -> Failure {
        let code = if query::is_busy(&e) {
            exit::LOCKED
        } else {
            exit::ERROR
        };
        Failure::new(code, format!("the store could not be read: {e}"))
    }
}

// ---------------------------------------------------------------------------------------------
// The request.

struct Request {
    windows: Vec<Window>,
    repos: Vec<String>,
    repo_aliases: Vec<String>,
    json: bool,
}

/// `--window d1|d7|d30 ...`, `--repo host/owner/repo ...`, `--json`, as `coverage` takes them.
fn parse(args: &[String]) -> Result<Request, String> {
    let mut windows: Vec<Window> = Vec::new();
    let mut repos: Vec<String> = Vec::new();
    let mut repo_aliases: Vec<String> = Vec::new();
    let mut json = false;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => json = true,
            "--window" => {
                let v = it.next().ok_or("--window needs a value")?;
                let w = match v.as_str() {
                    "d1" => Window::D1,
                    "d7" => Window::D7,
                    "d30" => Window::D30,
                    _ => {
                        return Err(format!(
                            "--window takes d1, d7 or d30, not {}",
                            query::quoted(v)
                        ));
                    }
                };
                if !windows.contains(&w) {
                    windows.push(w);
                }
            }
            "--repo" => {
                let v = it.next().ok_or("--repo needs a value")?;
                if !query::repo_ok(v) {
                    return Err(format!(
                        "--repo takes host/owner/repo as the meter normalizes a remote, not {}",
                        query::quoted(v)
                    ));
                }
                if v.len() > query::MAX_REPO_BYTES {
                    return Err(format!(
                        "--repo takes {} bytes; the most it takes is {}",
                        v.len(),
                        query::MAX_REPO_BYTES
                    ));
                }
                if !repos.iter().any(|r| r == v) {
                    repos.push(v.clone());
                }
            }
            "--repo-alias" => {
                let v = it.next().ok_or("--repo-alias needs a value")?;
                if !query::repo_ok(v) {
                    return Err(format!(
                        "--repo-alias takes host/owner/repo as the meter normalizes a remote, not {}",
                        query::quoted(v)
                    ));
                }
                if v.len() > query::MAX_REPO_BYTES {
                    return Err(format!(
                        "--repo-alias takes {} bytes; the most it takes is {}",
                        v.len(),
                        query::MAX_REPO_BYTES
                    ));
                }
                if !repo_aliases.contains(v) {
                    repo_aliases.push(v.clone());
                }
            }
            other => {
                return Err(format!(
                    "unknown option {} for outcomes; see usagemeter --help",
                    query::quoted(other)
                ));
            }
        }
    }
    if !repo_aliases.is_empty() {
        if repos.is_empty() {
            return Err("--repo-alias requires --repo".into());
        }
        if repos.len() > 1 {
            return Err("--repo-alias requires a single --repo".into());
        }
        repo_aliases.retain(|a| a != &repos[0]);
        if repo_aliases.len() > query::MAX_REPO_ALIASES {
            return Err("at most 16 --repo-alias values may be given".into());
        }
    }
    if windows.is_empty() {
        windows = Window::ALL.to_vec();
    } else {
        windows.sort_by_key(|w| w.index());
    }
    Ok(Request {
        windows,
        repos,
        repo_aliases,
        json,
    })
}

/// Fold a renamed repository into the primary name before filtering or grouping.
fn canon_repo(repo: Option<String>, req: &Request) -> Option<String> {
    if repo.as_ref().is_some_and(|r| req.repo_aliases.contains(r)) {
        Some(req.repos[0].clone())
    } else {
        repo
    }
}

// ---------------------------------------------------------------------------------------------
// The record.

#[derive(Serialize)]
struct StoreOut {
    schema_version: i64,
    location: &'static str,
}

#[derive(Serialize)]
struct ToolErrorDef {
    source: &'static str,
    rule: &'static str,
    /// Harness to its pinned marker.
    markers: BTreeMap<&'static str, &'static str>,
    /// Harnesses with no pinned marker: their tool failures are unknown, never 0.
    unsupported_harnesses: Vec<&'static str>,
}

#[derive(Serialize)]
struct RunFailedDef {
    source: &'static str,
    rule: &'static str,
}

#[derive(Serialize)]
struct Kinds {
    tool_error: ToolErrorDef,
    api_error: ToolErrorDef,
    run_failed: RunFailedDef,
}

#[derive(Serialize)]
struct Record {
    v: u64,
    generated_at: String,
    meter_version: String,
    schema_version: i64,
    machine: String,
    store: StoreOut,
    counted_from: String,
    /// Whether `sync` has prepared this store for the report. False: every window is
    /// `not_recorded`, and the next `usagemeter sync` starts recording.
    recorded: bool,
    /// The start of the recorded tool failures.
    errors_from: Option<String>,
    /// The start of the recorded model-call failures (`api_error`).
    api_errors_from: Option<String>,
    complete: bool,
    stale: bool,
    note: &'static str,
    error_kinds: Kinds,
    /// A list was cut to its cap or to fit the output: the `*_omitted` counts say by how much.
    truncated: bool,
    windows: Vec<WindowOut>,
}

/// One kind's count in a window: `full`, `partial` (a lower bound), `not_recorded` or `no_data`
/// (the count then null, never 0).
#[derive(Serialize)]
struct KindCount {
    state: &'static str,
    source: &'static str,
    count: Option<i64>,
}

#[derive(Serialize, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct ErrorLine {
    bot: String,
    kind: Option<String>,
    role: Option<String>,
    squad: Option<String>,
    harness: Option<&'static str>,
    error_kind: &'static str,
    source: &'static str,
    count: i64,
}

#[derive(Serialize, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct UnattributedLine {
    state: String,
    reason: Option<String>,
    harness: Option<&'static str>,
    error_kind: &'static str,
    source: &'static str,
    count: i64,
}

#[derive(Serialize, Clone, PartialEq, Eq)]
struct BranchErrorLine {
    repo: Option<String>,
    branch: String,
    tool_error: Option<i64>,
    api_error: Option<i64>,
    run_failed: i64,
    attributed: i64,
    unattributed: i64,
}

impl BranchErrorLine {
    fn count(&self) -> i64 {
        self.attributed + self.unattributed
    }
}

#[derive(Serialize, Clone, PartialEq, Eq)]
struct TaskErrorLine {
    repo: Option<String>,
    task: String,
    tool_error: Option<i64>,
    api_error: Option<i64>,
    run_failed: i64,
}

impl TaskErrorLine {
    fn count(&self) -> i64 {
        self.tool_error.unwrap_or(0) + self.api_error.unwrap_or(0) + self.run_failed
    }
}

#[derive(Serialize)]
struct ErrorsOut {
    tool_error: KindCount,
    api_error: KindCount,
    run_failed: KindCount,
    unsupported_harnesses: Vec<&'static str>,
    api_error_unsupported_harnesses: Vec<&'static str>,
    rows: Vec<ErrorLine>,
    rows_omitted: usize,
    /// The failures the omitted rows hold.
    omitted_count: i64,
    unattributed: Vec<UnattributedLine>,
    by_branch: Vec<BranchErrorLine>,
    by_branch_omitted: usize,
    by_branch_omitted_count: i64,
    by_task: Vec<TaskErrorLine>,
    by_task_omitted: usize,
    by_task_omitted_count: i64,
}

/// How the launches that ended in the window ended. `unknown`: hc no longer listed the terminal
/// when a sync next looked, or it ended before the meter recorded ends.
#[derive(Serialize, Default, Clone, Copy)]
struct RunEnds {
    exited_ok: i64,
    failed: i64,
    killed: i64,
    stopped_by_restart: i64,
    other: i64,
    unknown: i64,
}

/// Nearest-rank percentiles over whole seconds; null when there is no sample.
#[derive(Serialize, Clone, Default)]
struct Stat {
    n: usize,
    /// Of `n`, the samples of branches more than one (bot, role) worked on: groups are views of
    /// the same branches, not a partition.
    #[serde(skip_serializing_if = "Option::is_none")]
    n_shared: Option<usize>,
    p50_s: Option<i64>,
    p90_s: Option<i64>,
}

/// The two clocks, each to the pull request opened and merged.
#[derive(Serialize, Clone, Default)]
struct Clocks {
    /// First commit of the branch to the pull request opened.
    to_open_s: Stat,
    /// First commit to merged.
    to_merge_s: Stat,
    /// The branch's first worker launch to opened.
    launch_to_open_s: Stat,
    /// The branch's first worker launch to merged.
    launch_to_merge_s: Stat,
}

#[derive(Serialize)]
struct RepoLine {
    repo: String,
    #[serde(flatten)]
    clocks: Clocks,
}

#[derive(Serialize)]
struct BotLine {
    bot: String,
    role: String,
    #[serde(flatten)]
    clocks: Clocks,
}

#[derive(Serialize)]
struct BranchLine {
    repo: Option<String>,
    branch: String,
    pr: Option<i64>,
    /// `open`, `merged`, `closed`, or `no_pr`: worker launches in the window and no pull request
    /// recorded.
    state: &'static str,
    to_open_s: Option<i64>,
    to_merge_s: Option<i64>,
    launch_to_open_s: Option<i64>,
    launch_to_merge_s: Option<i64>,
}

#[derive(Serialize)]
struct TimeToPr {
    /// `ok`, `no_data` or `not_recorded`.
    state: &'static str,
    /// Every pull request opened (the `to_open` clocks) or merged (the `to_merge` clocks) in the
    /// window.
    all: Clocks,
    repos: Vec<RepoLine>,
    repos_omitted: usize,
    /// `partial` when a sample has no launch with a bot and a role before it: it is counted
    /// under `unattributed`, never dropped.
    attribution: &'static str,
    bots: Vec<BotLine>,
    bots_omitted: usize,
    unattributed: Clocks,
    branches: Vec<BranchLine>,
    branches_omitted: usize,
    /// Branches with worker launches in the window and no pull request recorded: in no
    /// percentile.
    branches_no_pr: usize,
    /// Pull requests in the window with no first commit recorded at or before them: out of the
    /// first-commit clock's samples.
    no_first_commit: usize,
    /// Pull requests in the window with no worker launch recorded before them: out of the
    /// launch clock's samples.
    no_launch: usize,
}

#[derive(Serialize)]
struct WindowOut {
    window: &'static str,
    start: String,
    end: String,
    requested_start: String,
    clipped: bool,
    /// `ok`, `partial`, `no_data` or `not_recorded`.
    state: &'static str,
    errors: ErrorsOut,
    run_ends: Option<RunEnds>,
    time_to_pr: TimeToPr,
}

// ---------------------------------------------------------------------------------------------
// Reading.

fn read_meta(c: &Connection) -> rusqlite::Result<BTreeMap<String, String>> {
    let mut meta = BTreeMap::new();
    let mut st = c.prepare("SELECT k, v FROM meta")?;
    let mut q = st.query([])?;
    while let Some(r) = q.next()? {
        meta.insert(r.get(0)?, r.get(1)?);
    }
    Ok(meta)
}

/// One launch, as the report reads it. No terminal or folder leaves this struct.
struct Launch {
    key: Option<(String, i64)>,
    worker: bool,
    bot: Option<String>,
    role: Option<String>,
    squad: Option<String>,
    kind: Option<String>,
    harness: Option<&'static str>,
    project: Option<String>,
    branch: Option<String>,
    task: Option<String>,
    repo: Option<String>,
    from: Option<i64>,
    to: Option<i64>,
    end_reason: Option<String>,
    exit_code: Option<i64>,
    signal: Option<String>,
    ended_ms: Option<i64>,
    end_source: Option<String>,
}

impl Launch {
    /// When it ended: hc's own time where it gave one, else when a sync saw it gone.
    fn end(&self) -> Option<i64> {
        self.ended_ms.or(self.to)
    }

    fn overlaps(&self, b: &query::Bounds) -> bool {
        self.from.is_none_or(|f| f < b.end) && self.end().is_none_or(|t| t >= b.start)
    }
}

/// Every launch the store keeps, one per terminal: a terminal that has both a start row and a
/// snapshot row counts once, as the row that names a bot.
fn launches(c: &Connection) -> rusqlite::Result<Vec<Launch>> {
    let mut st = c.prepare(
        "SELECT l.terminal, l.created_ms, l.kind, l.bot, l.role, l.squad, l.agent, l.live_agent,
                l.project, l.branch, l.valid_from, l.valid_to, l.end_reason, l.exit_code,
                l.signal, l.ended_ms, l.end_source,
                (SELECT repo FROM cwd_repo WHERE cwd = l.project),
                (SELECT repo FROM cwd_repo WHERE cwd = l.worktree), l.task
         FROM launch l ORDER BY l.bot IS NULL, l.lkey",
    )?;
    let mut seen: BTreeSet<(String, i64)> = BTreeSet::new();
    let mut out = Vec::new();
    let mut q = st.query([])?;
    while let Some(r) = q.next()? {
        let terminal: Option<String> = r.get(0)?;
        let created: Option<i64> = r.get(1)?;
        let key = terminal.zip(created);
        if let Some(k) = &key
            && !seen.insert(k.clone())
        {
            continue;
        }
        let kind: Option<String> = r.get(2)?;
        let agent: Option<String> = r.get(6)?;
        let live_agent: Option<String> = r.get(7)?;
        let by_project: Option<String> = r.get(17)?;
        let by_worktree: Option<String> = r.get(18)?;
        out.push(Launch {
            key,
            worker: kind.as_deref() == Some("worker"),
            bot: r.get(3)?,
            role: r.get(4)?,
            squad: r.get(5)?,
            kind,
            harness: agent
                .as_deref()
                .or(live_agent.as_deref())
                .and_then(crate::hc::harness_of),
            project: r.get(8)?,
            branch: r.get(9)?,
            task: r.get(19)?,
            repo: by_project.or(by_worktree),
            from: r.get(10)?,
            to: r.get(11)?,
            end_reason: r.get(12)?,
            exit_code: r.get(13)?,
            signal: r.get(14)?,
            ended_ms: r.get(15)?,
            end_source: r.get(16)?,
        });
    }
    Ok(out)
}

struct Pr {
    project: String,
    branch: String,
    pr: i64,
    repo: Option<String>,
    state: String,
    first_commit: Option<i64>,
    opened: Option<i64>,
    merged: Option<i64>,
}

fn prs(c: &Connection) -> rusqlite::Result<Vec<Pr>> {
    let mut st = c.prepare(
        "SELECT project, branch, pr, repo, state, first_commit_ms, opened_ms, merged_ms FROM pr
         ORDER BY project, branch, pr",
    )?;
    st.query_map([], |r| {
        Ok(Pr {
            project: r.get(0)?,
            branch: r.get(1)?,
            pr: r.get(2)?,
            repo: r.get(3)?,
            state: r.get(4)?,
            first_commit: r.get(5)?,
            opened: r.get(6)?,
            merged: r.get(7)?,
        })
    })?
    .collect()
}

/// A branch's pull request: with several on one branch, the earliest opened and the first merge.
struct Branch<'a> {
    repo: Option<String>,
    branch: &'a str,
    pr: i64,
    state: &'static str,
    first_commit: Option<i64>,
    opened: Option<i64>,
    merged: Option<i64>,
    /// The worker launches on (project, branch).
    workers: Vec<&'a Launch>,
}

fn secs(from: Option<i64>, to: Option<i64>) -> Option<i64> {
    let (f, t) = (from?, to?);
    (t >= f).then_some((t - f) / 1000)
}

impl Branch<'_> {
    /// The branch's first worker launch before `at`.
    fn launch_before(&self, at: Option<i64>) -> Option<i64> {
        let at = at?;
        self.workers
            .iter()
            .filter_map(|l| l.from)
            .filter(|f| *f < at)
            .min()
    }

    /// The (bot, role) pairs that launched a worker on the branch before `at`.
    fn actors(&self, at: Option<i64>) -> BTreeSet<(&str, &str)> {
        let Some(at) = at else {
            return BTreeSet::new();
        };
        self.workers
            .iter()
            .filter(|l| l.from.is_some_and(|f| f < at))
            .filter_map(|l| Some((l.bot.as_deref()?, l.role.as_deref()?)))
            .collect()
    }

    fn line(&self) -> BranchLine {
        BranchLine {
            repo: self.repo.clone(),
            branch: self.branch.to_string(),
            pr: Some(self.pr),
            state: self.state,
            to_open_s: secs(self.first_commit, self.opened),
            to_merge_s: secs(self.first_commit, self.merged),
            launch_to_open_s: secs(self.launch_before(self.opened), self.opened),
            launch_to_merge_s: secs(self.launch_before(self.merged), self.merged),
        }
    }
}

fn branches<'a>(prs: &'a [Pr], launches: &'a [Launch]) -> Vec<Branch<'a>> {
    let mut workers: HashMap<(&str, &str), Vec<&Launch>> = HashMap::new();
    for l in launches.iter().filter(|l| l.worker) {
        if let (Some(p), Some(b)) = (l.project.as_deref(), l.branch.as_deref()) {
            workers.entry((p, b)).or_default().push(l);
        }
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i < prs.len() {
        let mut j = i;
        while j < prs.len() && prs[j].project == prs[i].project && prs[j].branch == prs[i].branch {
            j += 1;
        }
        let group = &prs[i..j];
        i = j;
        let Some(first) = group
            .iter()
            .min_by_key(|p| (p.opened.unwrap_or(i64::MAX), p.pr))
        else {
            continue;
        };
        let merged = group
            .iter()
            .filter(|p| p.state == "merged")
            .filter_map(|p| p.merged)
            .min();
        let state = if merged.is_some() {
            "merged"
        } else if group.iter().any(|p| p.state == "open") {
            "open"
        } else {
            "closed"
        };
        out.push(Branch {
            repo: first
                .repo
                .clone()
                .or_else(|| group.iter().find_map(|p| p.repo.clone())),
            branch: &first.branch,
            pr: first.pr,
            state,
            first_commit: first
                .first_commit
                .or_else(|| group.iter().filter_map(|p| p.first_commit).min()),
            opened: first.opened,
            merged,
            workers: workers
                .get(&(first.project.as_str(), first.branch.as_str()))
                .cloned()
                .unwrap_or_default(),
        });
    }
    out
}

/// The samples of one group: the four durations, and how many came from a shared branch.
#[derive(Default)]
struct Samples {
    v: [Vec<i64>; 4],
    shared: [usize; 4],
}

impl Samples {
    fn add(&mut self, i: usize, s: i64, shared: bool) {
        self.v[i].push(s);
        self.shared[i] += usize::from(shared);
    }

    fn is_empty(&self) -> bool {
        self.v.iter().all(Vec::is_empty)
    }

    fn n(&self) -> usize {
        self.v.iter().map(Vec::len).sum()
    }

    fn clocks(mut self, with_shared: bool) -> Clocks {
        let mut stat = |i: usize| {
            let v = &mut self.v[i];
            v.sort_unstable();
            Stat {
                n: v.len(),
                n_shared: with_shared.then_some(self.shared[i]),
                p50_s: nearest_rank(v, 50),
                p90_s: nearest_rank(v, 90),
            }
        };
        Clocks {
            to_open_s: stat(0),
            to_merge_s: stat(1),
            launch_to_open_s: stat(2),
            launch_to_merge_s: stat(3),
        }
    }
}

/// The nearest-rank percentile of a sorted list: the value at rank `ceil(p/100 * n)`. None when
/// the list is empty.
fn nearest_rank(sorted: &[i64], p: usize) -> Option<i64> {
    if sorted.is_empty() {
        return None;
    }
    let rank = (p * sorted.len()).div_ceil(100).max(1);
    sorted.get(rank - 1).copied()
}

fn in_window(t: Option<i64>, b: &query::Bounds) -> bool {
    t.is_some_and(|t| t >= b.start && t < b.end)
}

fn time_to_pr(
    b: &query::Bounds,
    all: &[Branch<'_>],
    launches: &[Launch],
    with_pr: &BTreeSet<(&str, &str)>,
    named: &BTreeSet<&str>,
) -> TimeToPr {
    let wanted = |repo: Option<&str>| named.is_empty() || repo.is_some_and(|r| named.contains(r));
    let mut total = Samples::default();
    let mut unattributed = Samples::default();
    let mut repos: BTreeMap<&str, Samples> = BTreeMap::new();
    let mut bots: BTreeMap<(&str, &str), Samples> = BTreeMap::new();
    let mut lines: Vec<BranchLine> = Vec::new();
    let (mut no_first_commit, mut no_launch) = (0usize, 0usize);
    for br in all {
        if !wanted(br.repo.as_deref()) {
            continue;
        }
        let events = [(0usize, 2usize, br.opened), (1usize, 3usize, br.merged)];
        let mut listed = false;
        let (mut lacks_commit, mut lacks_launch) = (false, false);
        for (commit_i, launch_i, at) in events {
            if !in_window(at, b) {
                continue;
            }
            listed = true;
            let actors = br.actors(at);
            let shared = actors.len() > 1;
            let durations = [
                (commit_i, secs(br.first_commit, at)),
                (launch_i, secs(br.launch_before(at), at)),
            ];
            lacks_commit |= durations[0].1.is_none();
            lacks_launch |= durations[1].1.is_none();
            for (i, d) in durations {
                let Some(d) = d else { continue };
                total.add(i, d, shared);
                if let Some(r) = br.repo.as_deref() {
                    repos.entry(r).or_default().add(i, d, shared);
                }
                if actors.is_empty() {
                    unattributed.add(i, d, false);
                }
                for a in &actors {
                    bots.entry(*a).or_default().add(i, d, shared);
                }
            }
        }
        if listed {
            no_first_commit += usize::from(lacks_commit);
            no_launch += usize::from(lacks_launch);
            lines.push(br.line());
        }
    }
    // Branches worked on in the window with no pull request recorded, ever.
    let mut no_pr: BTreeSet<(Option<&str>, &str)> = BTreeSet::new();
    for l in launches.iter().filter(|l| l.worker && l.overlaps(b)) {
        let (Some(p), Some(branch)) = (l.project.as_deref(), l.branch.as_deref()) else {
            continue;
        };
        if with_pr.contains(&(p, branch)) || !wanted(l.repo.as_deref()) {
            continue;
        }
        no_pr.insert((l.repo.as_deref(), branch));
    }
    let branches_no_pr = no_pr.len();
    lines.extend(no_pr.into_iter().map(|(repo, branch)| BranchLine {
        repo: repo.map(str::to_owned),
        branch: branch.to_string(),
        pr: None,
        state: "no_pr",
        to_open_s: None,
        to_merge_s: None,
        launch_to_open_s: None,
        launch_to_merge_s: None,
    }));
    lines.sort_by(|a, b| (&a.repo, &a.branch).cmp(&(&b.repo, &b.branch)));
    let branches_omitted = lines.len().saturating_sub(MAX_BRANCHES);
    lines.truncate(MAX_BRANCHES);

    let attribution = if unattributed.is_empty() {
        "full"
    } else {
        "partial"
    };
    let mut repo_lines: Vec<(usize, RepoLine)> = repos
        .into_iter()
        .map(|(repo, s)| {
            (
                s.n(),
                RepoLine {
                    repo: repo.to_string(),
                    clocks: s.clocks(false),
                },
            )
        })
        .collect();
    repo_lines.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.repo.cmp(&b.1.repo)));
    let repos_omitted = repo_lines.len().saturating_sub(MAX_REPOS);
    repo_lines.truncate(MAX_REPOS);
    let mut bot_lines: Vec<(usize, BotLine)> = bots
        .into_iter()
        .map(|((bot, role), s)| {
            (
                s.n(),
                BotLine {
                    bot: bot.to_string(),
                    role: role.to_string(),
                    clocks: s.clocks(true),
                },
            )
        })
        .collect();
    bot_lines.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| (&a.1.bot, &a.1.role).cmp(&(&b.1.bot, &b.1.role)))
    });
    let bots_omitted = bot_lines.len().saturating_sub(MAX_BOTS);
    bot_lines.truncate(MAX_BOTS);
    TimeToPr {
        state: if lines.is_empty() && branches_omitted == 0 {
            "no_data"
        } else {
            "ok"
        },
        all: total.clocks(false),
        repos: repo_lines.into_iter().map(|(_, l)| l).collect(),
        repos_omitted,
        attribution,
        bots: bot_lines.into_iter().map(|(_, l)| l).collect(),
        bots_omitted,
        unattributed: unattributed.clocks(false),
        branches: lines,
        branches_omitted,
        branches_no_pr,
        no_first_commit,
        no_launch,
    }
}

fn empty_time_to_pr(state: &'static str) -> TimeToPr {
    TimeToPr {
        state,
        all: Clocks::default(),
        repos: Vec::new(),
        repos_omitted: 0,
        attribution: "full",
        bots: Vec::new(),
        bots_omitted: 0,
        unattributed: Clocks::default(),
        branches: Vec::new(),
        branches_omitted: 0,
        branches_no_pr: 0,
        no_first_commit: 0,
        no_launch: 0,
    }
}

/// The launch tag a failure counts under.
type Tag = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<&'static str>,
    &'static str,
    &'static str,
);
/// What an unattributed failure counts under: state, reason, harness, kind, source.
type NoTag = (
    String,
    Option<String>,
    Option<&'static str>,
    &'static str,
    &'static str,
);

#[derive(Default)]
struct FailureCounts {
    tool_errors: i64,
    api_errors: i64,
    run_failed: i64,
    attributed: i64,
    unattributed: i64,
}

impl FailureCounts {
    fn add_error(&mut self, kind: &str, n: i64) {
        if kind == record::TOOL_ERROR {
            self.tool_errors += n;
        } else {
            self.api_errors += n;
        }
    }

    fn count(&self) -> i64 {
        self.tool_errors + self.api_errors + self.run_failed
    }
}

#[derive(Default)]
struct ErrorAcc {
    rows: BTreeMap<Tag, i64>,
    unattributed: BTreeMap<NoTag, i64>,
    by_branch: BTreeMap<(Option<String>, String), FailureCounts>,
    by_task: BTreeMap<(Option<String>, String), FailureCounts>,
    tool_errors: i64,
    api_errors: i64,
    run_failed: i64,
    /// Where the failed runs' ends came from, and where every end read in the window did.
    failed_from: EndSources,
    ends_from: EndSources,
}

/// Which of the two sources of a launch's end a count was read from.
#[derive(Default, Clone, Copy)]
struct EndSources {
    hc: bool,
    ledger: bool,
}

impl EndSources {
    fn add(&mut self, source: &str) {
        if source == record::WORKERS_LEDGER {
            self.ledger = true;
        } else {
            self.hc = true;
        }
    }

    fn name(self) -> Option<&'static str> {
        match (self.hc, self.ledger) {
            (true, true) => Some(BOTH_END_SOURCES),
            (true, false) => Some(record::HC_SNAPSHOT),
            (false, true) => Some(record::WORKERS_LEDGER),
            (false, false) => None,
        }
    }
}

/// The source a window's `run_failed` total names: where the failed runs it counts ended, as
/// their rows say; with none counted, where the ends it read came from; with no end read at all,
/// hc's list, the first place `sync` asks.
fn run_failed_source(acc: &ErrorAcc) -> &'static str {
    acc.failed_from
        .name()
        .or(acc.ends_from.name())
        .unwrap_or(record::HC_SNAPSHOT)
}

/// The harness-flagged failures (`tool_error` and `api_error`) of one window, grouped as the store
/// interned them.
fn tool_errors(
    c: &Connection,
    b: &query::Bounds,
    rd: &Read<'_>,
    acc: &mut ErrorAcc,
) -> rusqlite::Result<()> {
    let mut st = c.prepare_cached(
        "SELECT d.harness, d.repo, a.state, a.reason, a.bot, a.kind, a.role, a.squad, e.kind,
                e.source, count(*), d.branch, a.filled_branch, a.task, a.project
         FROM ev_error e JOIN ev_dim d ON d.id = e.dim JOIN ev_actor a ON a.id = e.actor
         WHERE e.ts_ms >= ?1 AND e.ts_ms < ?2
         GROUP BY e.dim, e.actor, e.kind, e.source",
    )?;
    let mut q = st.query([b.start, b.end])?;
    while let Some(r) = q.next()? {
        let kind: String = r.get(8)?;
        let source: String = r.get(9)?;
        if source != record::HARNESS_LOG {
            continue;
        }
        // A kind a newer meter wrote, or one whose start this store has not recorded, is not read.
        let error_kind = match kind.as_str() {
            record::TOOL_ERROR if rd.errors_from.is_some() => record::TOOL_ERROR,
            record::API_ERROR if rd.api_errors_from.is_some() => record::API_ERROR,
            _ => continue,
        };
        let repo = canon_repo(r.get(1)?, rd.req);
        if !rd.named.is_empty() && !repo.as_deref().is_some_and(|r| rd.named.contains(r)) {
            continue;
        }
        let harness = Source::from_harness(&r.get::<_, String>(0)?).map(Source::harness);
        let state: String = r.get(2)?;
        let bot: Option<String> = r.get(4)?;
        let n: i64 = r.get(10)?;
        let attributed = state == "attributed" && bot.is_some();
        let branch: Option<String> = r.get(11)?;
        let filled_branch: Option<String> = r.get(12)?;
        let task: Option<String> = r.get(13)?;
        let project: Option<String> = r.get(14)?;
        let actor_kind: Option<String> = r.get(5)?;
        let branch = branch
            .filter(|b| !b.is_empty())
            .or_else(|| filled_branch.filter(|b| attributed && !b.is_empty()));
        if let Some(branch) = branch.filter(|b| query::branch_ok(b)) {
            let entry = acc.by_branch.entry((repo.clone(), branch)).or_default();
            entry.add_error(error_kind, n);
            if attributed {
                entry.attributed += n;
            } else {
                entry.unattributed += n;
            }
        }
        if attributed
            && actor_kind.as_deref() == Some("worker")
            && project.as_deref().is_some_and(|p| !p.is_empty())
            && let Some(task) = task.filter(|t| query::task_id_fits(t))
        {
            acc.by_task
                .entry((repo, task))
                .or_default()
                .add_error(error_kind, n);
        }
        if error_kind == record::TOOL_ERROR {
            acc.tool_errors += n;
        } else {
            acc.api_errors += n;
        }
        match bot.filter(|_| state == "attributed") {
            Some(bot) => {
                *acc.rows
                    .entry((
                        bot,
                        actor_kind,
                        r.get(6)?,
                        r.get(7)?,
                        harness,
                        error_kind,
                        record::HARNESS_LOG,
                    ))
                    .or_default() += n;
            }
            None => {
                *acc.unattributed
                    .entry((state, r.get(3)?, harness, error_kind, record::HARNESS_LOG))
                    .or_default() += n;
            }
        }
    }
    Ok(())
}

/// How a launch ended, as the report counts it.
#[derive(PartialEq, Eq, Clone, Copy)]
enum End {
    Ok,
    Failed,
    Killed,
    Restart,
    Other,
    Unknown,
}

/// `run_failed`: the terminal ended on its own (hc's `exited`, or an `end` row that copied an exit
/// status with no reason) with a non-zero exit status or on a signal. A terminal hc killed or
/// stopped for a restart ended on purpose, whatever status or signal that left: never an error.
fn end_of(l: &Launch) -> End {
    if l.end_source.is_none() {
        return End::Unknown;
    }
    match l.end_reason.as_deref() {
        Some("killed") => End::Killed,
        Some("stopped_by_restart") => End::Restart,
        Some("exited") | None => {
            if l.signal.is_some() || l.exit_code.is_some_and(|c| c != 0) {
                End::Failed
            } else if l.exit_code == Some(0) {
                End::Ok
            } else {
                End::Unknown
            }
        }
        Some(_) => End::Other,
    }
}

fn end_source(l: &Launch) -> &'static str {
    match l.end_source.as_deref() {
        Some(record::WORKERS_LEDGER) => record::WORKERS_LEDGER,
        _ => record::HC_SNAPSHOT,
    }
}

fn run_ends(
    b: &query::Bounds,
    launches: &[Launch],
    named: &BTreeSet<&str>,
    acc: &mut ErrorAcc,
) -> RunEnds {
    let mut ends = RunEnds::default();
    for l in launches {
        if l.key.is_none() || !in_window(l.end(), b) {
            continue;
        }
        if !named.is_empty() && !l.repo.as_deref().is_some_and(|r| named.contains(r)) {
            continue;
        }
        if l.end_source.is_some() {
            acc.ends_from.add(end_source(l));
        }
        match end_of(l) {
            End::Ok => ends.exited_ok += 1,
            End::Killed => ends.killed += 1,
            End::Restart => ends.stopped_by_restart += 1,
            End::Other => ends.other += 1,
            End::Unknown => ends.unknown += 1,
            End::Failed => {
                ends.failed += 1;
                acc.run_failed += 1;
                acc.failed_from.add(end_source(l));
                if let Some(branch) = l.branch.as_ref().filter(|b| query::branch_ok(b)) {
                    let entry = acc
                        .by_branch
                        .entry((l.repo.clone(), branch.clone()))
                        .or_default();
                    entry.run_failed += 1;
                    if l.bot.is_some() {
                        entry.attributed += 1;
                    } else {
                        entry.unattributed += 1;
                    }
                }
                if l.worker
                    && l.bot.is_some()
                    && l.project.as_deref().is_some_and(|p| !p.is_empty())
                    && let Some(task) = l.task.as_ref().filter(|t| query::task_id_fits(t))
                {
                    acc.by_task
                        .entry((l.repo.clone(), task.clone()))
                        .or_default()
                        .run_failed += 1;
                }
                match &l.bot {
                    Some(bot) => {
                        *acc.rows
                            .entry((
                                bot.clone(),
                                l.kind.clone(),
                                l.role.clone(),
                                l.squad.clone(),
                                l.harness,
                                RUN_FAILED,
                                end_source(l),
                            ))
                            .or_default() += 1;
                    }
                    None => {
                        *acc.unattributed
                            .entry((
                                "unlinked".into(),
                                Some("no_record".into()),
                                l.harness,
                                RUN_FAILED,
                                end_source(l),
                            ))
                            .or_default() += 1;
                    }
                }
            }
        }
    }
    ends
}

fn has_usage(c: &Connection, b: &query::Bounds, req: &Request) -> rusqlite::Result<bool> {
    let mut st =
        c.prepare_cached("SELECT DISTINCT repo FROM usage WHERE hour_ms >= ?1 AND hour_ms < ?2")?;
    let mut q = st.query([b.start, b.end])?;
    while let Some(r) = q.next()? {
        let repo: Option<String> = r.get(0)?;
        if req.repos.is_empty()
            || repo
                .as_ref()
                .is_some_and(|r| req.repos.contains(r) || req.repo_aliases.contains(r))
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Whether a window is wholly at or after the start of the recorded tool failures (`full`),
/// starts before it or reads a store with logs still to import (`partial`), or has none recorded.
fn tool_state(b: &query::Bounds, errors_from: Option<i64>, complete: bool) -> &'static str {
    match errors_from {
        None => "not_recorded",
        Some(f) if b.end <= f => "not_recorded",
        Some(f) if b.start < f => "partial",
        Some(_) if !complete => "partial",
        Some(_) => "full",
    }
}

fn not_recorded(window: Window, b: &query::Bounds, state: &'static str) -> WindowOut {
    WindowOut {
        window: window.name(),
        start: format_rfc3339(b.start),
        end: format_rfc3339(b.end),
        requested_start: format_rfc3339(b.requested_start),
        clipped: b.clipped,
        state,
        errors: ErrorsOut {
            tool_error: KindCount {
                state,
                source: record::HARNESS_LOG,
                count: None,
            },
            api_error: KindCount {
                state,
                source: record::HARNESS_LOG,
                count: None,
            },
            run_failed: KindCount {
                state,
                source: record::HC_SNAPSHOT,
                count: None,
            },
            unsupported_harnesses: unsupported_harnesses(),
            api_error_unsupported_harnesses: api_error_unsupported_harnesses(),
            rows: Vec::new(),
            rows_omitted: 0,
            omitted_count: 0,
            unattributed: Vec::new(),
            by_branch: Vec::new(),
            by_branch_omitted: 0,
            by_branch_omitted_count: 0,
            by_task: Vec::new(),
            by_task_omitted: 0,
            by_task_omitted_count: 0,
        },
        run_ends: None,
        time_to_pr: empty_time_to_pr(state),
    }
}

struct Read<'a> {
    launches: &'a [Launch],
    branches: &'a [Branch<'a>],
    with_pr: &'a BTreeSet<(&'a str, &'a str)>,
    named: &'a BTreeSet<&'a str>,
    req: &'a Request,
    errors_from: Option<i64>,
    api_errors_from: Option<i64>,
    complete: bool,
}

fn window_out(
    c: &Connection,
    window: Window,
    b: &query::Bounds,
    rd: &Read<'_>,
) -> rusqlite::Result<WindowOut> {
    let mut acc = ErrorAcc::default();
    let tool = tool_state(b, rd.errors_from, rd.complete);
    let api = tool_state(b, rd.api_errors_from, rd.complete);
    // With no start recorded, the rows are not this store's window's to read (a reset by a meter
    // that does not know them left them behind: `record::COUNTED_META`).
    if rd.errors_from.is_some() || rd.api_errors_from.is_some() {
        tool_errors(c, b, rd, &mut acc)?;
    }
    let ends = run_ends(b, rd.launches, rd.named, &mut acc);
    let ttp = time_to_pr(b, rd.branches, rd.launches, rd.with_pr, rd.named);
    let wanted = |l: &&Launch| {
        rd.named.is_empty() || l.repo.as_deref().is_some_and(|r| rd.named.contains(r))
    };
    let any_launch = rd.launches.iter().filter(wanted).any(|l| l.overlaps(b));
    if acc.tool_errors == 0
        && acc.api_errors == 0
        && !any_launch
        && ttp.state == "no_data"
        && !has_usage(c, b, rd.req)?
    {
        // Nothing ran, failed or opened here, as far as the store knows: no count is a 0.
        return Ok(not_recorded(window, b, "no_data"));
    }
    let run_state = if ends.unknown > 0 { "partial" } else { "full" };
    let run_source = run_failed_source(&acc);
    let mut rows: Vec<ErrorLine> = acc
        .rows
        .into_iter()
        .map(
            |((bot, kind, role, squad, harness, error_kind, source), count)| ErrorLine {
                bot,
                kind,
                role,
                squad,
                harness,
                error_kind,
                source,
                count,
            },
        )
        .collect();
    rows.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.cmp(b)));
    let omitted: Vec<ErrorLine> = if rows.len() > MAX_ROWS {
        rows.split_off(MAX_ROWS)
    } else {
        Vec::new()
    };
    let unattributed = acc
        .unattributed
        .into_iter()
        .map(
            |((state, reason, harness, error_kind, source), count)| UnattributedLine {
                state,
                reason,
                harness,
                error_kind,
                source,
                count,
            },
        )
        .collect();
    let mut by_branch: Vec<BranchErrorLine> = acc
        .by_branch
        .into_iter()
        .filter(|(_, v)| v.count() > 0)
        .map(|((repo, branch), v)| BranchErrorLine {
            repo,
            branch,
            tool_error: (tool != "not_recorded").then_some(v.tool_errors),
            api_error: (api != "not_recorded").then_some(v.api_errors),
            run_failed: v.run_failed,
            attributed: v.attributed,
            unattributed: v.unattributed,
        })
        .collect();
    by_branch.sort_by(|a, b| {
        b.count()
            .cmp(&a.count())
            .then_with(|| (&a.repo, &a.branch).cmp(&(&b.repo, &b.branch)))
    });
    let by_branch_omitted = by_branch.len().saturating_sub(MAX_ROWS);
    let by_branch_omitted_count = by_branch
        .iter()
        .skip(MAX_ROWS)
        .map(BranchErrorLine::count)
        .sum();
    by_branch.truncate(MAX_ROWS);
    let mut by_task: Vec<(i64, TaskErrorLine)> = acc
        .by_task
        .into_iter()
        .filter(|(_, v)| v.count() > 0)
        .map(|((repo, task), v)| {
            (
                v.count(),
                TaskErrorLine {
                    repo,
                    task,
                    tool_error: (tool != "not_recorded").then_some(v.tool_errors),
                    api_error: (api != "not_recorded").then_some(v.api_errors),
                    run_failed: v.run_failed,
                },
            )
        })
        .collect();
    by_task.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| (&a.1.repo, &a.1.task).cmp(&(&b.1.repo, &b.1.task)))
    });
    let by_task_omitted = by_task.len().saturating_sub(MAX_ROWS);
    let by_task_omitted_count = by_task.iter().skip(MAX_ROWS).map(|(n, _)| n).sum();
    by_task.truncate(MAX_ROWS);
    let state = if tool != "full" || api != "full" || run_state != "full" {
        "partial"
    } else {
        "ok"
    };
    Ok(WindowOut {
        window: window.name(),
        start: format_rfc3339(b.start),
        end: format_rfc3339(b.end),
        requested_start: format_rfc3339(b.requested_start),
        clipped: b.clipped,
        state,
        errors: ErrorsOut {
            tool_error: KindCount {
                state: tool,
                source: record::HARNESS_LOG,
                // Rows older than the start of the record may exist (an old line of a log first
                // read later): they are facts, and the state says the count is a lower bound.
                count: (tool != "not_recorded").then_some(acc.tool_errors),
            },
            api_error: KindCount {
                state: api,
                source: record::HARNESS_LOG,
                count: (api != "not_recorded").then_some(acc.api_errors),
            },
            run_failed: KindCount {
                state: run_state,
                source: run_source,
                count: Some(acc.run_failed),
            },
            unsupported_harnesses: unsupported_harnesses(),
            api_error_unsupported_harnesses: api_error_unsupported_harnesses(),
            rows,
            rows_omitted: omitted.len(),
            omitted_count: omitted.iter().map(|r| r.count).sum(),
            unattributed,
            by_branch,
            by_branch_omitted,
            by_branch_omitted_count,
            by_task: by_task.into_iter().map(|(_, l)| l).collect(),
            by_task_omitted,
            by_task_omitted_count,
        },
        run_ends: Some(ends),
        time_to_pr: ttp,
    })
}

fn report(
    c: &Connection,
    req: &Request,
    ctx: &query::Ctx,
    location: query::Location,
) -> Result<Option<Record>, Failure> {
    c.execute_batch("BEGIN").map_err(Failure::sql)?;
    let version = match query::schema_version(c).map_err(Failure::sql)? {
        None => return Ok(None),
        Some(v) => v,
    };
    if version > SCHEMA_VERSION {
        return Err(Failure::new(
            exit::NEWER_SCHEMA,
            "the store was written by a newer usagemeter; update the meter",
        ));
    }
    if version < SCHEMA_VERSION {
        return Err(Failure::new(
            exit::OUTDATED_STORE,
            "the store needs a migration that only usagemeter sync runs",
        ));
    }
    let meta = read_meta(c).map_err(Failure::sql)?;
    if !meta.contains_key("counted_from_ms") {
        return Ok(None);
    }
    let counted_from = query::meta_i64(&meta, "counted_from_ms").unwrap_or(0);
    let watermark = query::watermark(&meta);
    let stale = watermark.is_none_or(|w| ctx.now_ms - w > query::DEFAULT_STALE_AFTER_S * 1000);
    let pending = |k: &str| query::meta_i64(&meta, k).map(|v| v.max(0));
    let complete =
        pending("last_pending_bytes") == Some(0) && pending("last_pending_files") == Some(0);
    // A store no sync of this meter has touched has none of these: the report creates nothing.
    let recorded = record::table_exists(c, "ev_error").map_err(Failure::sql)?
        && record::table_exists(c, "pr").map_err(Failure::sql)?
        && record::column_exists(c, "launch", "end_source").map_err(Failure::sql)?;
    // Failures recorded in another window than the store's (an older meter reset it since) are
    // not read: until the next sync drops them, the window says `not_recorded`.
    let same_window =
        record::same_window(counted_from, query::meta_i64(&meta, record::COUNTED_META));
    let errors_from = query::meta_i64(&meta, record::FROM_META).filter(|_| recorded && same_window);
    let api_errors_from =
        query::meta_i64(&meta, record::API_FROM_META).filter(|_| recorded && same_window);
    let bounds: Vec<(Window, query::Bounds)> = req
        .windows
        .iter()
        .map(|w| (*w, query::bounds(&meta, *w, ctx.now_ms)))
        .collect();
    let windows: Vec<WindowOut> = if recorded {
        let mut launches = launches(c).map_err(Failure::sql)?;
        for l in &mut launches {
            l.repo = canon_repo(l.repo.take(), req);
        }
        let mut prs = prs(c).map_err(Failure::sql)?;
        for p in &mut prs {
            p.repo = canon_repo(p.repo.take(), req);
        }
        let branches = branches(&prs, &launches);
        let with_pr: BTreeSet<(&str, &str)> = prs
            .iter()
            .map(|p| (p.project.as_str(), p.branch.as_str()))
            .collect();
        let named: BTreeSet<&str> = req.repos.iter().map(String::as_str).collect();
        let rd = Read {
            launches: &launches,
            branches: &branches,
            with_pr: &with_pr,
            named: &named,
            req,
            errors_from,
            api_errors_from,
            complete,
        };
        let mut out = Vec::with_capacity(bounds.len());
        for (w, b) in &bounds {
            out.push(window_out(c, *w, b, &rd).map_err(Failure::sql)?);
        }
        out
    } else {
        bounds
            .iter()
            .map(|(w, b)| not_recorded(*w, b, "not_recorded"))
            .collect()
    };
    c.execute_batch("COMMIT").map_err(Failure::sql)?;
    let truncated = windows.iter().any(|w| {
        w.errors.rows_omitted > 0
            || w.errors.by_branch_omitted > 0
            || w.errors.by_task_omitted > 0
            || w.time_to_pr.branches_omitted > 0
            || w.time_to_pr.repos_omitted > 0
            || w.time_to_pr.bots_omitted > 0
    });
    let mut markers = BTreeMap::new();
    let mut api_markers = BTreeMap::new();
    for s in Source::ALL {
        if let Some(m) = marker(s) {
            markers.insert(s.harness(), m);
        }
        if let Some(m) = api_error_marker(s) {
            api_markers.insert(s.harness(), m);
        }
    }
    Ok(Some(Record {
        v: RECORD_VERSION,
        generated_at: format_rfc3339(ctx.now_ms),
        meter_version: ctx.meter_version.clone(),
        schema_version: version,
        machine: query::machine_id(&meta),
        store: StoreOut {
            schema_version: version,
            location: location.as_str(),
        },
        counted_from: format_rfc3339(counted_from),
        recorded,
        errors_from: errors_from.map(format_rfc3339),
        api_errors_from: api_errors_from.map(format_rfc3339),
        complete,
        stale,
        note: NOTE,
        error_kinds: Kinds {
            tool_error: ToolErrorDef {
                source: record::HARNESS_LOG,
                rule: TOOL_ERROR_RULE,
                markers,
                unsupported_harnesses: unsupported_harnesses(),
            },
            api_error: ToolErrorDef {
                source: record::HARNESS_LOG,
                rule: API_ERROR_RULE,
                markers: api_markers,
                unsupported_harnesses: api_error_unsupported_harnesses(),
            },
            run_failed: RunFailedDef {
                source: BOTH_END_SOURCES,
                rule: RUN_FAILED_RULE,
            },
        },
        truncated,
        windows,
    }))
}

/// Cuts the longest lists by half, counting what goes, for an output past [`OUTPUT_CAP`]. False
/// when nothing is left to cut.
fn shrink(r: &mut Record) -> bool {
    fn halve<T>(v: &mut Vec<T>, omitted: &mut usize) -> Vec<T> {
        let keep = v.len() / 2;
        let cut = v.split_off(keep);
        *omitted += cut.len();
        cut
    }
    let mut cut = false;
    for w in &mut r.windows {
        let t = &mut w.time_to_pr;
        if !t.branches.is_empty() {
            halve(&mut t.branches, &mut t.branches_omitted);
            cut = true;
        }
    }
    if !cut {
        for w in &mut r.windows {
            let t = &mut w.time_to_pr;
            let e = &mut w.errors;
            if !t.bots.is_empty()
                || !t.repos.is_empty()
                || !e.rows.is_empty()
                || !e.by_branch.is_empty()
                || !e.by_task.is_empty()
            {
                halve(&mut t.bots, &mut t.bots_omitted);
                halve(&mut t.repos, &mut t.repos_omitted);
                let gone = halve(&mut e.rows, &mut e.rows_omitted);
                e.omitted_count += gone.iter().map(|l| l.count).sum::<i64>();
                let gone = halve(&mut e.by_branch, &mut e.by_branch_omitted);
                e.by_branch_omitted_count += gone.iter().map(BranchErrorLine::count).sum::<i64>();
                let gone = halve(&mut e.by_task, &mut e.by_task_omitted);
                e.by_task_omitted_count += gone.iter().map(TaskErrorLine::count).sum::<i64>();
                cut = true;
            }
        }
    }
    r.truncated |= cut;
    cut
}

/// Runs one report. `args` are the words after `outcomes`.
pub fn run(args: &[String], ctx: &query::Ctx) -> Reply {
    let req = match parse(args) {
        Ok(r) => r,
        Err(m) => return err(exit::USAGE, m),
    };
    let Some(dirs) = &ctx.state else {
        return err(
            exit::ERROR,
            "HOME is not set; set METER_STATE_DIR to choose the state folder",
        );
    };
    let (db, location) = match query::locate(dirs, ctx.overridden) {
        Ok(Located::Store { db, location, .. }) => (db, location),
        Ok(Located::Absent) => return err(exit::ABSENT_STORE, ABSENT),
        Err(m) => return err(exit::ERROR, m),
    };
    if query::read_only_folder(&db) {
        return err(exit::ERROR, query::READ_ONLY_FOLDER);
    }
    let conn = match query::open_read_only(&db, ctx.busy) {
        Ok(c) => c,
        Err(e) => {
            let code = if query::is_busy(&e) {
                exit::LOCKED
            } else {
                exit::ERROR
            };
            return err(code, format!("the store could not be read: {e}"));
        }
    };
    let mut record = match report(&conn, &req, ctx, location) {
        Ok(Some(r)) => r,
        Ok(None) => return err(exit::ABSENT_STORE, ABSENT),
        Err(f) => return err(f.code, f.message),
    };
    drop(conn);
    loop {
        let out = if req.json {
            match serde_json::to_string(&record) {
                Ok(mut s) => {
                    s.push('\n');
                    s
                }
                Err(e) => {
                    return err(exit::ERROR, format!("the report could not be written: {e}"));
                }
            }
        } else {
            text(&record)
        };
        if out.len() <= OUTPUT_CAP || !shrink(&mut record) {
            return Reply {
                code: exit::OK,
                stdout: out,
                stderr: None,
            };
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The text report.

fn or_null(t: &Option<String>) -> &str {
    t.as_deref().unwrap_or("null")
}

fn num(v: Option<i64>) -> String {
    v.map_or_else(|| "null".into(), |n| n.to_string())
}

fn yes(b: bool) -> &'static str {
    if b { "yes" } else { "no" }
}

/// A name for a line of text: nothing that could break the line or pass for another field.
fn name(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_control() { '?' } else { c })
        .collect()
}

fn opt_name(s: &Option<String>) -> String {
    s.as_deref().map_or_else(|| "null".into(), name)
}

fn stat(label: &str, s: &Stat) -> String {
    let shared = s
        .n_shared
        .map_or_else(String::new, |n| format!(" n_shared={n}"));
    format!(
        "{label} n={}{shared} p50={} p90={}",
        s.n,
        num(s.p50_s),
        num(s.p90_s)
    )
}

fn clocks(c: &Clocks) -> String {
    format!(
        "{}; {}; {}; {}",
        stat("to_open_s", &c.to_open_s),
        stat("to_merge_s", &c.to_merge_s),
        stat("launch_to_open_s", &c.launch_to_open_s),
        stat("launch_to_merge_s", &c.launch_to_merge_s)
    )
}

fn text(r: &Record) -> String {
    let mut o = String::new();
    let _ = writeln!(
        o,
        "outcomes: machine {}; schema {} (store {}); meter {}",
        r.machine, r.schema_version, r.store.location, r.meter_version
    );
    let _ = writeln!(
        o,
        "generated {}; counted_from {}; errors_from {}; api_errors_from {}",
        r.generated_at,
        r.counted_from,
        or_null(&r.errors_from),
        or_null(&r.api_errors_from)
    );
    let _ = writeln!(
        o,
        "ingestion complete: {}; stale: {}; {} window(s)",
        yes(r.complete),
        yes(r.stale),
        r.windows.len()
    );
    let _ = writeln!(o, "note: {}", r.note);
    let t = &r.error_kinds.tool_error;
    let _ = writeln!(o, "tool_error ({}): {}", t.source, t.rule);
    for (harness, m) in &t.markers {
        let _ = writeln!(o, "  {harness}: {m}");
    }
    let _ = writeln!(
        o,
        "  unsupported (no pinned marker; unknown, never 0): {}",
        t.unsupported_harnesses.join(", ")
    );
    let a = &r.error_kinds.api_error;
    let _ = writeln!(o, "api_error ({}): {}", a.source, a.rule);
    for (harness, m) in &a.markers {
        let _ = writeln!(o, "  {harness}: {m}");
    }
    let _ = writeln!(
        o,
        "  unsupported (no pinned marker; unknown, never 0): {}",
        a.unsupported_harnesses.join(", ")
    );
    let f = &r.error_kinds.run_failed;
    let _ = writeln!(o, "run_failed ({}): {}", f.source, f.rule);
    let _ = writeln!(
        o,
        "time to PR: seconds from the branch's first commit (to_open_s, to_merge_s) and from its \
         first worker launch (launch_to_open_s, launch_to_merge_s); nearest-rank percentiles"
    );
    if !r.recorded {
        let _ = writeln!(
            o,
            "not_recorded: this store has not been prepared for outcomes yet; the next usagemeter \
             sync starts recording, and nothing before it is known"
        );
    }
    if r.truncated {
        let _ = writeln!(
            o,
            "lists are capped ({MAX_ROWS} rows, {MAX_BOTS} bots, {MAX_REPOS} repos, {MAX_BRANCHES} \
             branches, {OUTPUT_CAP} bytes in all); what is cut is counted as omitted"
        );
    }
    for w in &r.windows {
        let _ = writeln!(o);
        let _ = writeln!(
            o,
            "window {}: {} .. {} (requested start {}{}); state: {}",
            w.window,
            w.start,
            w.end,
            w.requested_start,
            if w.clipped {
                "; clipped to counted_from"
            } else {
                ""
            },
            w.state
        );
        let e = &w.errors;
        let _ = writeln!(
            o,
            "  tool_error ({}): {} [{}]; unsupported: {}",
            e.tool_error.source,
            num(e.tool_error.count),
            e.tool_error.state,
            e.unsupported_harnesses.join(", ")
        );
        let _ = writeln!(
            o,
            "  api_error ({}): {} [{}]; unsupported: {}",
            e.api_error.source,
            num(e.api_error.count),
            e.api_error.state,
            e.api_error_unsupported_harnesses.join(", ")
        );
        let _ = writeln!(
            o,
            "  run_failed ({}): {} [{}]",
            e.run_failed.source,
            num(e.run_failed.count),
            e.run_failed.state
        );
        for l in &e.rows {
            let _ = writeln!(
                o,
                "    bot {} kind {} role {} squad {} harness {} {} {}: {}",
                name(&l.bot),
                opt_name(&l.kind),
                opt_name(&l.role),
                opt_name(&l.squad),
                l.harness.unwrap_or("null"),
                l.error_kind,
                l.source,
                l.count
            );
        }
        if e.rows_omitted > 0 {
            let _ = writeln!(
                o,
                "    rows_omitted: {} (holding {} failures)",
                e.rows_omitted, e.omitted_count
            );
        }
        for l in &e.unattributed {
            let _ = writeln!(
                o,
                "    unattributed {} reason {} harness {} {} {}: {}",
                name(&l.state),
                opt_name(&l.reason),
                l.harness.unwrap_or("null"),
                l.error_kind,
                l.source,
                l.count
            );
        }
        for l in &e.by_branch {
            let _ = writeln!(
                o,
                "    branch {} {}: tool_error {} api_error {} run_failed {} (attributed {}, unattributed {})",
                opt_name(&l.repo),
                name(&l.branch),
                num(l.tool_error),
                num(l.api_error),
                l.run_failed,
                l.attributed,
                l.unattributed
            );
        }
        if e.by_branch_omitted > 0 {
            let _ = writeln!(
                o,
                "    by_branch_omitted: {} (holding {} failures)",
                e.by_branch_omitted, e.by_branch_omitted_count
            );
        }
        for l in &e.by_task {
            let _ = writeln!(
                o,
                "    task {} {}: tool_error {} api_error {} run_failed {}",
                opt_name(&l.repo),
                name(&l.task),
                num(l.tool_error),
                num(l.api_error),
                l.run_failed
            );
        }
        if e.by_task_omitted > 0 {
            let _ = writeln!(
                o,
                "    by_task_omitted: {} (holding {} failures)",
                e.by_task_omitted, e.by_task_omitted_count
            );
        }
        match &w.run_ends {
            Some(n) => {
                let _ = writeln!(
                    o,
                    "  run ends: exited_ok {}, failed {}, killed {}, stopped_by_restart {}, other \
                     {}, unknown {}",
                    n.exited_ok, n.failed, n.killed, n.stopped_by_restart, n.other, n.unknown
                );
            }
            None => {
                let _ = writeln!(o, "  run ends: null");
            }
        }
        let t = &w.time_to_pr;
        let _ = writeln!(
            o,
            "  time to PR: state {}; attribution {}; branches_no_pr {}; no_first_commit {}; \
             no_launch {}",
            t.state, t.attribution, t.branches_no_pr, t.no_first_commit, t.no_launch
        );
        if t.state != "ok" {
            continue;
        }
        let _ = writeln!(o, "    all: {}", clocks(&t.all));
        for l in &t.repos {
            let _ = writeln!(o, "    repo {}: {}", name(&l.repo), clocks(&l.clocks));
        }
        if t.repos_omitted > 0 {
            let _ = writeln!(o, "    repos_omitted: {}", t.repos_omitted);
        }
        for l in &t.bots {
            let _ = writeln!(
                o,
                "    bot {} role {}: {}",
                name(&l.bot),
                name(&l.role),
                clocks(&l.clocks)
            );
        }
        if t.bots_omitted > 0 {
            let _ = writeln!(o, "    bots_omitted: {}", t.bots_omitted);
        }
        if t.attribution == "partial" {
            let _ = writeln!(o, "    unattributed: {}", clocks(&t.unattributed));
        }
        for l in &t.branches {
            let _ = writeln!(
                o,
                "    branch {} {} pr {} {}: to_open_s {} to_merge_s {} launch_to_open_s {} \
                 launch_to_merge_s {}",
                opt_name(&l.repo),
                name(&l.branch),
                num(l.pr),
                l.state,
                num(l.to_open_s),
                num(l.to_merge_s),
                num(l.launch_to_open_s),
                num(l.launch_to_merge_s)
            );
        }
        if t.branches_omitted > 0 {
            let _ = writeln!(o, "    branches_omitted: {}", t.branches_omitted);
        }
    }
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_rank_is_the_value_at_the_ceiling_rank() {
        assert_eq!(nearest_rank(&[], 50), None);
        assert_eq!(nearest_rank(&[7], 50), Some(7));
        assert_eq!(nearest_rank(&[7], 90), Some(7));
        assert_eq!(nearest_rank(&[1, 2, 3, 4], 50), Some(2));
        assert_eq!(nearest_rank(&[1, 2, 3, 4], 90), Some(4));
        let ten: Vec<i64> = (1..=10).collect();
        assert_eq!(nearest_rank(&ten, 50), Some(5));
        assert_eq!(nearest_rank(&ten, 90), Some(9));
    }

    #[test]
    fn a_harness_has_a_marker_exactly_when_a_fixture_pins_it() {
        for s in Source::ALL {
            assert_eq!(
                marker(s).is_some(),
                tool_error::pinned(s),
                "{}",
                s.harness()
            );
            assert_eq!(
                api_error_marker(s).is_some(),
                tool_error::api_error_pinned(s),
                "{}",
                s.harness()
            );
        }
        assert_eq!(unsupported_harnesses(), ["agy", "dsh-tui", "omp"]);
        assert_eq!(
            api_error_unsupported_harnesses(),
            ["agy", "codex", "dsh-tui", "omp"]
        );
    }

    fn launch(reason: Option<&str>, exit_code: Option<i64>, signal: Option<&str>) -> Launch {
        Launch {
            key: Some(("t1".into(), 1)),
            worker: true,
            bot: None,
            role: None,
            squad: None,
            kind: None,
            harness: None,
            project: None,
            branch: None,
            task: None,
            repo: None,
            from: None,
            to: None,
            end_reason: reason.map(str::to_owned),
            exit_code,
            signal: signal.map(str::to_owned),
            ended_ms: None,
            end_source: Some(record::HC_SNAPSHOT.into()),
        }
    }

    #[test]
    fn only_a_terminal_that_ended_on_its_own_badly_is_a_failed_run() {
        assert!(end_of(&launch(Some("exited"), Some(1), None)) == End::Failed);
        assert!(end_of(&launch(Some("exited"), None, Some("9"))) == End::Failed);
        assert!(end_of(&launch(Some("exited"), Some(0), None)) == End::Ok);
        // hc killed it, or stopped it for a restart: on purpose, whatever that left behind.
        assert!(end_of(&launch(Some("killed"), Some(137), Some("9"))) == End::Killed);
        assert!(end_of(&launch(Some("stopped_by_restart"), Some(1), None)) == End::Restart);
        // An exit with no status recorded is unknown, never a success.
        assert!(end_of(&launch(Some("exited"), None, None)) == End::Unknown);
        assert!(end_of(&launch(Some("something_new"), Some(1), None)) == End::Other);
        let mut unseen = launch(Some("exited"), Some(1), None);
        unseen.end_source = None;
        assert!(end_of(&unseen) == End::Unknown);
    }

    #[test]
    fn the_run_failed_total_names_the_sources_its_ends_came_from() {
        let b = query::Bounds {
            start: 0,
            end: 100,
            requested_start: 0,
            clipped: false,
        };
        let ended = |source: &str, exit_code: i64| {
            let mut l = launch(Some("exited"), Some(exit_code), None);
            l.to = Some(50);
            l.end_source = Some(source.into());
            l
        };
        let source_of = |launches: &[Launch]| {
            let mut acc = ErrorAcc::default();
            let ends = run_ends(&b, launches, &BTreeSet::new(), &mut acc);
            (ends.failed, run_failed_source(&acc))
        };
        let (hc, ledger) = (record::HC_SNAPSHOT, record::WORKERS_LEDGER);
        assert_eq!(source_of(&[ended(hc, 1)]), (1, "hc_snapshot"));
        assert_eq!(source_of(&[ended(ledger, 1)]), (1, "workers_ledger"));
        assert_eq!(
            source_of(&[ended(hc, 1), ended(ledger, 2)]),
            (2, "hc_snapshot,workers_ledger")
        );
        // The source is the failed runs', as their rows say: an end that was fine adds none.
        assert_eq!(
            source_of(&[ended(hc, 0), ended(ledger, 1)]),
            (1, "workers_ledger")
        );
        // No failed run: where the ends read came from, and hc's list when none was read.
        assert_eq!(source_of(&[ended(ledger, 0)]), (0, "workers_ledger"));
        assert_eq!(source_of(&[]), (0, "hc_snapshot"));
    }

    #[test]
    fn a_duration_is_null_when_either_end_is_missing_or_they_are_out_of_order() {
        assert_eq!(secs(Some(1_000), Some(61_000)), Some(60));
        assert_eq!(secs(None, Some(61_000)), None);
        assert_eq!(secs(Some(1_000), None), None);
        assert_eq!(secs(Some(61_000), Some(1_000)), None);
    }
}
