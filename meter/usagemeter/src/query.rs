//! `usagemeter query`: the meter's answer for genie, contract 1 (RFC 0018 (a)). The schema is
//! `meter/schema/query/v1/envelope.schema.json`, and its examples are this module's fixtures.
//!
//! It is fork-and-exit and truly read-only: it opens an existing store with
//! `SQLITE_OPEN_READ_ONLY`, reads one snapshot in one read transaction and prints one envelope on
//! stdout. No store or folder is created, nothing is migrated or synced, `meter.lock` is never
//! taken, and there is no `hc` call, no git call and no network. Every exit the contract defines
//! prints an envelope, refusals included, and the request is checked against the byte budget
//! before the store is opened.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, ErrorCode, OpenFlags, OptionalExtension};
use serde::{Serialize, Serializer};
use sha2::{Digest, Sha256};

use crate::paths::{self, StateDirs};
use crate::prices::PriceTable;
use crate::sources::Source;
use crate::store::SCHEMA_VERSION;
use crate::time::{DAY_MS, HOUR_MS, format_rfc3339, hour_start};

pub const CONTRACT: &str = "usagemeter.query";
pub const CONTRACT_VERSION: u64 = 1;
pub const CAPABILITY: &str = "meter.usage@1";
pub const SUPPORTED_CONTRACTS: [u64; 1] = [1];

/// The byte budget (RFC 0018 (a), "The byte budget").
pub const MAX_BRANCHES: usize = 500;
pub const MAX_BRANCH_BYTES: usize = 255;
pub const MAX_NAMES_BYTES: usize = 65_536;
pub const MAX_REPO_BYTES: usize = 512;
/// The whole envelope as written to stdout, its line feed included.
pub const OUTPUT_CAP: usize = 458_752;
/// A refusal keeps the leading names whose echo fits here.
pub const REFUSAL_ECHO_BYTES: usize = 4096;
pub const ROW_BYTES: usize = 2048;
pub const METADATA_BYTES: usize = 16_384;
pub const REFUSAL_BYTES: usize = 8192;
pub const MESSAGE_CHARS: usize = 1000;
pub const LABEL_CHARS: usize = 200;
/// `unpriced_models` keeps the models with the most unpriced tokens, each name cut to this many
/// bytes as JSON; `tokens_unpriced` still counts every one.
pub const UNPRICED_MODELS_MAX: usize = 8;
pub const MODEL_NAME_BYTES: usize = 40;
/// A user's string quoted in an error message is cut to this many characters.
const QUOTED_CHARS: usize = 64;
pub const MACHINE_ID_CHARS: usize = 128;

pub const DEFAULT_STALE_AFTER_S: i64 = 7200;
pub const MIN_STALE_AFTER_S: i64 = 60;
pub const MAX_STALE_AFTER_S: i64 = 30 * 24 * 3600;
/// How long the query waits for a consistent snapshot (exit 11 past it).
pub const BUSY_BUDGET: Duration = Duration::from_secs(2);
pub const RETRY_AFTER_S: i64 = 5;

/// The source entry that reports usage an older meter wrote to the old state folder after the
/// move: it never reaches the query, so no row may claim to be complete beside it.
pub const LEGACY_STORE: &str = "legacy-store";

/// Exit codes (RFC 0018 (a), "Exit codes").
pub mod exit {
    pub const OK: u8 = 0;
    pub const ERROR: u8 = 1;
    pub const USAGE: u8 = 2;
    pub const ABSENT_STORE: u8 = 10;
    pub const LOCKED: u8 = 11;
    pub const NEWER_SCHEMA: u8 = 12;
    pub const OUTDATED_STORE: u8 = 13;
    pub const UNSUPPORTED_CONTRACT: u8 = 14;
    pub const TOO_LARGE: u8 = 15;
}

/// What the query needs from its surroundings; the binary fills it from the environment.
#[derive(Debug, Clone)]
pub struct Ctx {
    /// None when neither `METER_STATE_DIR` nor `HOME` is set.
    pub state: Option<StateDirs>,
    /// `METER_STATE_DIR` chose `state.dir`: it is the only place looked at.
    pub overridden: bool,
    pub now_ms: i64,
    pub busy: Duration,
    pub meter_version: String,
}

impl Ctx {
    pub fn from_env() -> Ctx {
        let var = |k: &str| std::env::var_os(k);
        Ctx {
            state: paths::state_dirs(var),
            overridden: var("METER_STATE_DIR").is_some_and(|v| !v.is_empty()),
            now_ms: crate::time::now_ms(),
            busy: BUSY_BUDGET,
            meter_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

/// One call's result: the exit code and everything for stdout (one line of compact JSON).
#[derive(Debug, Clone)]
pub struct Answer {
    pub code: u8,
    pub stdout: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Window {
    D1,
    D7,
    D30,
}

impl Window {
    fn name(self) -> &'static str {
        match self {
            Window::D1 => "d1",
            Window::D7 => "d7",
            Window::D30 => "d30",
        }
    }

    fn days(self) -> i64 {
        match self {
            Window::D1 => 1,
            Window::D7 => 7,
            Window::D30 => 30,
        }
    }
}

#[derive(Debug, Clone)]
struct Request {
    repo: String,
    window: Window,
    branches: Vec<String>,
    stale_after_s: i64,
}

// ---------------------------------------------------------------------------------------------
// The envelope. Field order follows the schema; `Option` serializes as null.

#[derive(Serialize)]
struct Envelope {
    contract: &'static str,
    contract_version: u64,
    capability: &'static str,
    meter_version: String,
    status: &'static str,
    error: Option<ErrorObj>,
    generated_at: String,
    as_of: Option<String>,
    machine: Option<Machine>,
    store: Option<StoreInfo>,
    ingestion: Option<Ingestion>,
    window: Option<WindowInfo>,
    sources: Vec<SourceInfo>,
    unattributed: Option<Unattributed>,
    pricing: Option<Pricing>,
    query: Option<Echo>,
    rows: Vec<Row>,
}

#[derive(Serialize, Clone, Default)]
struct ErrorObj {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_s: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    store_schema_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    supported_schema_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    supported_contracts: Option<Vec<u64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit_bytes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    needed_bytes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rows_fit: Option<usize>,
}

impl ErrorObj {
    fn new(code: &'static str, message: impl Into<String>) -> ErrorObj {
        ErrorObj {
            code,
            message: chars(&message.into(), MESSAGE_CHARS),
            ..ErrorObj::default()
        }
    }
}

#[derive(Serialize, Clone)]
struct Machine {
    id: String,
    scope: &'static str,
}

#[derive(Serialize, Clone)]
struct StoreInfo {
    schema_version: i64,
    location: &'static str,
}

#[derive(Serialize)]
struct Ingestion {
    watermark: Option<String>,
    counted_from: String,
    evidence_from: Option<String>,
    complete: bool,
    backlog: Backlog,
    stale: bool,
    stale_after_s: i64,
}

#[derive(Serialize)]
struct Backlog {
    bytes: i64,
    files: i64,
}

#[derive(Serialize)]
struct WindowInfo {
    name: &'static str,
    requested_start: String,
    start: String,
    end: String,
    clipped: bool,
}

#[derive(Serialize, Clone)]
struct SourceInfo {
    harness: String,
    status: String,
    reason: Option<String>,
    last_success: Option<String>,
    stale: bool,
}

#[derive(Serialize)]
struct Unattributed {
    tokens_total: i64,
    harnesses: Vec<String>,
}

#[derive(Serialize)]
struct Pricing {
    table: PriceInfo,
    reported_wins: bool,
    long_prompt_tiers: bool,
}

#[derive(Serialize)]
struct PriceInfo {
    origin: &'static str,
    date: String,
    source: &'static str,
    label: &'static str,
    sha256: Option<String>,
}

#[derive(Serialize, Clone)]
struct Echo {
    repo: String,
    window: &'static str,
    branch_count: usize,
    branches: Vec<String>,
    branches_complete: bool,
    request_sha256: String,
}

#[derive(Serialize)]
struct Row {
    branch: String,
    requested: usize,
    state: &'static str,
    reason: Option<&'static str>,
    tokens: Option<TokensOut>,
    cost: Option<Cost>,
    token_precision: Option<&'static str>,
    attribution: Attribution,
    activity: Option<Activity>,
    incomplete_sources: Vec<String>,
}

#[derive(Serialize, Clone, Copy, Default)]
struct TokensOut {
    input: i64,
    cache_read: i64,
    cache_write_5m: i64,
    cache_write_1h: i64,
    output: i64,
    reasoning: i64,
    unsplit: i64,
    total: i64,
}

#[derive(Serialize)]
struct Cost {
    state: &'static str,
    #[serde(serialize_with = "usd")]
    usd: Option<f64>,
    #[serde(serialize_with = "usd")]
    usd_reported: Option<f64>,
    #[serde(serialize_with = "usd")]
    usd_estimated: Option<f64>,
    tokens_priced: i64,
    tokens_reported: i64,
    tokens_unpriced: i64,
    unpriced_models: Vec<String>,
}

#[derive(Serialize)]
struct Attribution {
    precision: &'static str,
    exclusive: bool,
    shared: bool,
    coverage: &'static str,
}

#[derive(Serialize)]
struct Activity {
    first_hour: Option<String>,
    last_hour: Option<String>,
    hours: usize,
    harnesses: Vec<String>,
}

/// USD to four decimals, written as an integer when it is whole (`0`, not `0.0`).
fn usd<S: Serializer>(v: &Option<f64>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        None => s.serialize_none(),
        Some(v) => {
            let r = round_usd(*v);
            if r.fract() == 0.0 && r.abs() < 9.0e15 {
                s.serialize_i64(r as i64)
            } else {
                s.serialize_f64(r)
            }
        }
    }
}

fn round_usd(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

// ---------------------------------------------------------------------------------------------
// Bounded strings.

/// At most `n` characters.
fn chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// The bytes `s` takes as a JSON string, quotes included (serde_json's escaping).
fn json_len(s: &str) -> usize {
    2 + s
        .chars()
        .map(|c| match c {
            '"' | '\\' | '\n' | '\r' | '\t' | '\u{8}' | '\u{c}' => 2,
            c if (c as u32) < 0x20 => 6,
            c => c.len_utf8(),
        })
        .sum::<usize>()
}

/// `s` cut, at a whole character, so that it takes at most `max` bytes as a JSON string; a cut
/// name ends in `…` so a reader never takes it for a whole one.
fn json_bounded(s: &str, max: usize) -> String {
    if json_len(s) <= max {
        return s.to_string();
    }
    let mut out = String::new();
    for c in s.chars() {
        let mut next = out.clone();
        next.push(c);
        if json_len(&next) + '…'.len_utf8() > max {
            break;
        }
        out = next;
    }
    out.push('…');
    out
}

fn quoted(s: &str) -> String {
    let cut: String = s.chars().take(QUOTED_CHARS).collect();
    if cut.len() < s.len() {
        format!("\"{cut}…\"")
    } else {
        format!("\"{cut}\"")
    }
}

// ---------------------------------------------------------------------------------------------
// The request.

/// A refusal before or instead of an answer.
struct Refusal {
    code: u8,
    status: &'static str,
    error: ErrorObj,
    echo: Option<Echo>,
    store: Option<StoreInfo>,
    machine: Option<Machine>,
}

impl Refusal {
    fn usage(message: impl Into<String>) -> Refusal {
        Refusal {
            code: exit::USAGE,
            status: "usage",
            error: ErrorObj::new("usage", message),
            echo: None,
            store: None,
            machine: None,
        }
    }
}

/// Git and the meter refuse a branch holding a space, a backslash or a control character (the
/// schema's `\s` includes U+FEFF), so `"` is the only character escaping can grow.
pub fn branch_ok(b: &str) -> bool {
    !b.is_empty()
        && !b
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '\\' || c == '\u{feff}')
}

/// The schema's repo form: `host/owner/repo`, host lower-case, every segment non-empty.
pub fn repo_ok(r: &str) -> bool {
    let mut parts = r.split('/');
    let host = parts.next().unwrap_or("");
    let rest: Vec<&str> = parts.collect();
    !host.is_empty()
        && host
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
        && !rest.is_empty()
        && rest
            .iter()
            .all(|s| !s.is_empty() && !s.chars().any(|c| c.is_whitespace() || c == '\u{feff}'))
}

fn request_sha256(repo: &str, window: &str, branches: &[String]) -> String {
    let mut h = Sha256::new();
    for part in std::iter::once(repo)
        .chain(std::iter::once(window))
        .chain(branches.iter().map(String::as_str))
    {
        h.update(part.as_bytes());
        h.update(b"\n");
    }
    crate::event::hex(&h.finalize())
}

/// The request echoed back. A refusal keeps the leading names that fit in 4 KiB (each name
/// counted as its JSON bytes plus a comma), cut at a whole name: at most 500, none past 255 bytes.
fn echo(repo: &str, window: Window, branches: &[String], capped: bool) -> Echo {
    let mut kept = Vec::new();
    let mut used = 0;
    for b in branches {
        let cost = json_len(b) + 1;
        if capped
            && (used + cost > REFUSAL_ECHO_BYTES
                || b.len() > MAX_BRANCH_BYTES
                || kept.len() == MAX_BRANCHES)
        {
            break;
        }
        used += cost;
        kept.push(b.clone());
    }
    Echo {
        repo: repo.to_string(),
        window: window.name(),
        branch_count: branches.len(),
        branches_complete: kept.len() == branches.len(),
        branches: kept,
        request_sha256: request_sha256(repo, window.name(), branches),
    }
}

fn too_large_request(
    repo: &str,
    window: Window,
    branches: &[String],
    message: String,
    limit: usize,
    needed: usize,
) -> Refusal {
    let mut e = ErrorObj::new("request_too_large", message);
    e.limit_bytes = Some(limit);
    e.needed_bytes = Some(needed);
    Refusal {
        code: exit::USAGE,
        status: "usage",
        error: e,
        echo: Some(echo(repo, window, branches, true)),
        store: None,
        machine: None,
    }
}

fn parse(args: &[String]) -> Result<Request, Box<Refusal>> {
    let mut repo: Option<String> = None;
    let mut window: Option<Window> = None;
    let mut contract: Option<u64> = None;
    let mut stale: Option<i64> = None;
    let mut branches: Vec<String> = Vec::new();
    let mut json = false;
    let mut it = args.iter();
    let value = |flag: &str, v: Option<&String>| -> Result<String, Refusal> {
        v.cloned()
            .ok_or_else(|| Refusal::usage(format!("{flag} needs a value")))
    };
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => json = true,
            "--repo" => {
                let v = value("--repo", it.next())?;
                if repo.replace(v).is_some() {
                    return Err(Box::new(Refusal::usage(
                        "--repo is given twice: one call per project",
                    )));
                }
            }
            "--branch" => branches.push(value("--branch", it.next())?),
            "--window" => {
                let v = value("--window", it.next())?;
                let w = match v.as_str() {
                    "d1" => Window::D1,
                    "d7" => Window::D7,
                    "d30" => Window::D30,
                    _ => {
                        return Err(Box::new(Refusal::usage(format!(
                            "--window takes d1, d7 or d30, not {}",
                            quoted(&v)
                        ))));
                    }
                };
                if window.replace(w).is_some() {
                    return Err(Box::new(Refusal::usage("--window is given twice")));
                }
            }
            "--contract" => {
                let v = value("--contract", it.next())?;
                let n = v.parse::<u64>().map_err(|_| {
                    Refusal::usage(format!(
                        "--contract takes a whole number, not {}",
                        quoted(&v)
                    ))
                })?;
                if contract.replace(n).is_some() {
                    return Err(Box::new(Refusal::usage("--contract is given twice")));
                }
            }
            "--stale-after" => {
                let v = value("--stale-after", it.next())?;
                let n = v
                    .parse::<i64>()
                    .ok()
                    .filter(|n| (MIN_STALE_AFTER_S..=MAX_STALE_AFTER_S).contains(n))
                    .ok_or_else(|| {
                        Refusal::usage(format!(
                            "--stale-after takes seconds from {MIN_STALE_AFTER_S} to \
                             {MAX_STALE_AFTER_S}, not {}",
                            quoted(&v)
                        ))
                    })?;
                if stale.replace(n).is_some() {
                    return Err(Box::new(Refusal::usage("--stale-after is given twice")));
                }
            }
            other => {
                return Err(Box::new(Refusal::usage(format!(
                    "unknown option {} for query; see usagemeter --help",
                    quoted(other)
                ))));
            }
        }
    }
    if !json {
        return Err(Box::new(Refusal::usage(
            "--json is required: query contract 1 has no text output",
        )));
    }
    let repo = repo.ok_or_else(|| Refusal::usage("--repo is required"))?;
    if branches.is_empty() {
        return Err(Box::new(Refusal::usage(
            "at least one --branch is required",
        )));
    }
    if let Some(i) = branches.iter().position(|b| !branch_ok(b)) {
        return Err(Box::new(Refusal::usage(format!(
            "branch {} is empty or holds a space, a backslash or a control character",
            i + 1
        ))));
    }
    let window = window.unwrap_or(Window::D30);
    if repo.len() > MAX_REPO_BYTES {
        let mut e = ErrorObj::new(
            "request_too_large",
            format!(
                "--repo takes {} bytes; the most it takes is {MAX_REPO_BYTES}",
                repo.len()
            ),
        );
        e.limit_bytes = Some(MAX_REPO_BYTES);
        e.needed_bytes = Some(repo.len());
        return Err(Box::new(Refusal {
            code: exit::USAGE,
            status: "usage",
            error: e,
            echo: None,
            store: None,
            machine: None,
        }));
    }
    if !repo_ok(&repo) {
        return Err(Box::new(Refusal::usage(format!(
            "--repo takes host/owner/repo as the meter normalizes a remote, not {}",
            quoted(&repo)
        ))));
    }
    if branches.len() > MAX_BRANCHES {
        let mut r = Refusal::usage(format!(
            "{} branches were named; the most one call takes is {MAX_BRANCHES}",
            branches.len()
        ));
        r.error.code = "too_many_branches";
        r.echo = Some(echo(&repo, window, &branches, true));
        return Err(Box::new(r));
    }
    if let Some(long) = branches.iter().map(String::len).max()
        && long > MAX_BRANCH_BYTES
    {
        return Err(Box::new(too_large_request(
            &repo,
            window,
            &branches,
            format!("a branch name takes {long} bytes; the most one takes is {MAX_BRANCH_BYTES}"),
            MAX_BRANCH_BYTES,
            long,
        )));
    }
    let names: usize = branches.iter().map(String::len).sum();
    if names > MAX_NAMES_BYTES {
        return Err(Box::new(too_large_request(
            &repo,
            window,
            &branches,
            format!(
                "the branch names take {names} bytes; the most one call takes is \
                 {MAX_NAMES_BYTES}"
            ),
            MAX_NAMES_BYTES,
            names,
        )));
    }
    let contract = contract.unwrap_or(CONTRACT_VERSION);
    if !SUPPORTED_CONTRACTS.contains(&contract) {
        let mut e = ErrorObj::new(
            "unsupported_contract",
            format!("this meter serves query contract 1 only; --contract {contract} was asked"),
        );
        e.supported_contracts = Some(SUPPORTED_CONTRACTS.to_vec());
        return Err(Box::new(Refusal {
            code: exit::UNSUPPORTED_CONTRACT,
            status: "unsupported_contract",
            error: e,
            echo: Some(echo(&repo, window, &branches, true)),
            store: None,
            machine: None,
        }));
    }
    Ok(Request {
        repo,
        window,
        branches,
        stale_after_s: stale.unwrap_or(DEFAULT_STALE_AFTER_S),
    })
}

// ---------------------------------------------------------------------------------------------
// Finding and opening the store.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Location {
    Current,
    Legacy,
    Override,
}

impl Location {
    pub fn as_str(self) -> &'static str {
        match self {
            Location::Current => "current",
            Location::Legacy => "legacy",
            Location::Override => "override",
        }
    }
}

#[derive(Debug, Clone)]
pub enum Located {
    /// No store anywhere the meter looks: never synced on this machine.
    Absent,
    Store {
        db: PathBuf,
        dir: PathBuf,
        location: Location,
        /// Why usage in the old state folder does not reach this store, if it does not.
        stray: Option<&'static str>,
    },
}

/// A store is a non-empty `meter.db` (an empty file is what a sync makes before its first run).
fn is_store(db: &Path) -> bool {
    db.metadata().is_ok_and(|m| m.is_file() && m.len() > 0)
}

/// Where the store is: `METER_STATE_DIR` alone when set; else the current folder, then the
/// folder before the move. Looks only; opens and creates nothing. An unfinished move is an error:
/// its files may be two generations, and nothing may open them until a sync settles it.
pub fn locate(dirs: &StateDirs, overridden: bool) -> Result<Located, String> {
    if overridden {
        let db = dirs.dir.join("meter.db");
        return Ok(if is_store(&db) {
            Located::Store {
                db,
                dir: dirs.dir.clone(),
                location: Location::Override,
                stray: None,
            }
        } else {
            Located::Absent
        });
    }
    if paths::move_unfinished(&dirs.dir) {
        return Err(
            "a move into the state folder has not finished, so nothing there is opened; the next \
             usagemeter sync says why (README: \"An interrupted move\")"
                .into(),
        );
    }
    let db = dirs.dir.join("meter.db");
    if is_store(&db) {
        let stray = dirs
            .legacy
            .as_deref()
            .and_then(|old| paths::stray_legacy_store(old, &dirs.dir));
        return Ok(Located::Store {
            db,
            dir: dirs.dir.clone(),
            location: Location::Current,
            stray,
        });
    }
    if let Some(old) = &dirs.legacy {
        let db = old.join("meter.db");
        if is_store(&db) {
            return Ok(Located::Store {
                db,
                dir: old.clone(),
                location: Location::Legacy,
                stray: None,
            });
        }
    }
    Ok(Located::Absent)
}

/// `SQLITE_OPEN_READ_ONLY`, no checkpoint on close, a bounded busy timeout: the database and its
/// wal keep exactly the bytes they had.
pub fn open_read_only(db: &Path, busy: Duration) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(
        db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.set_db_config(
        rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE,
        true,
    )?;
    conn.busy_timeout(busy)?;
    Ok(conn)
}

fn is_busy(e: &rusqlite::Error) -> bool {
    matches!(e, rusqlite::Error::SqliteFailure(f, _)
        if matches!(f.code, ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked))
}

// ---------------------------------------------------------------------------------------------
// Reading the snapshot.

/// One hourly usage row of the repo, as the query reads it.
struct UsageRead {
    branch: Option<String>,
    harness: String,
    model: String,
    hour_ms: i64,
    tokens: TokensOut,
    total_only: bool,
    reported_usd: Option<f64>,
}

struct Snapshot {
    version: i64,
    meta: BTreeMap<String, String>,
    health: BTreeMap<String, Option<i64>>,
    rows: Vec<UsageRead>,
    repo_seen: bool,
}

enum Read {
    /// No tables, or a store whose first sync never got as far as its window.
    Absent,
    Version(i64),
    Snapshot(Box<Snapshot>),
}

fn table_exists(c: &Connection, name: &str) -> rusqlite::Result<bool> {
    c.query_row(
        "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |r| r.get(0),
    )
}

/// The store's `schema_version`: None when it has no table at all (an empty database). A store
/// with tables but no version is older than versioning (0).
pub fn schema_version(c: &Connection) -> rusqlite::Result<Option<i64>> {
    let tables: i64 = c.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table'",
        [],
        |r| r.get(0),
    )?;
    if tables == 0 {
        return Ok(None);
    }
    if !table_exists(c, "meta")? {
        return Ok(Some(0));
    }
    let v: Option<String> = c
        .query_row("SELECT v FROM meta WHERE k = 'schema_version'", [], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(Some(v.and_then(|v| v.trim().parse().ok()).unwrap_or(0)))
}

fn nonneg(v: Option<i64>) -> i64 {
    v.unwrap_or(0).max(0)
}

/// Reads everything the answer needs in one read transaction, so it is one snapshot.
fn read(
    c: &Connection,
    repo: &str,
    start: impl Fn(&BTreeMap<String, String>) -> (i64, i64),
) -> rusqlite::Result<Read> {
    c.execute_batch("BEGIN")?;
    let version = match schema_version(c)? {
        None => return Ok(Read::Absent),
        Some(v) => v,
    };
    if version != SCHEMA_VERSION {
        return Ok(Read::Version(version));
    }
    let mut meta = BTreeMap::new();
    {
        let mut st = c.prepare("SELECT k, v FROM meta")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (k, v) = row?;
            meta.insert(k, v);
        }
    }
    if !meta.contains_key("counted_from_ms") {
        return Ok(Read::Absent);
    }
    let mut health = BTreeMap::new();
    {
        let mut st = c.prepare("SELECT source, last_success_ms FROM health")?;
        let rows = st.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?))
        })?;
        for row in rows {
            let (k, v) = row?;
            health.insert(k, v);
        }
    }
    let (from, to) = start(&meta);
    let mut rows = Vec::new();
    {
        let mut st = c.prepare(
            "SELECT branch, harness, model, hour_ms, input_uncached, cache_read, cache_write_5m,
                    cache_write_1h, output, reasoning, unsplit, precision, reported_usd
             FROM usage WHERE repo = ?1 AND hour_ms >= ?2 AND hour_ms < ?3",
        )?;
        let it = st.query_map(rusqlite::params![repo, from, to], |r| {
            let t = TokensOut {
                input: nonneg(r.get(4)?),
                cache_read: nonneg(r.get(5)?),
                cache_write_5m: nonneg(r.get(6)?),
                cache_write_1h: nonneg(r.get(7)?),
                output: nonneg(r.get(8)?),
                reasoning: nonneg(r.get(9)?),
                unsplit: nonneg(r.get(10)?),
                total: 0,
            };
            Ok(UsageRead {
                branch: r.get(0)?,
                harness: r.get(1)?,
                model: r.get(2)?,
                hour_ms: r.get(3)?,
                tokens: t,
                total_only: r.get::<_, String>(11)? == "total_only",
                reported_usd: r
                    .get::<_, Option<f64>>(12)?
                    .filter(|u| u.is_finite() && *u >= 0.0),
            })
        })?;
        for row in it {
            let mut row = row?;
            row.tokens.total = split_total(&row.tokens).saturating_add(row.tokens.unsplit);
            rows.push(row);
        }
    }
    let repo_seen = rows.iter().any(|r| r.tokens.total > 0)
        || c.query_row(
            "SELECT EXISTS(SELECT 1 FROM usage WHERE repo = ?1)",
            [repo],
            |r| r.get::<_, bool>(0),
        )?;
    c.execute_batch("COMMIT")?;
    Ok(Read::Snapshot(Box::new(Snapshot {
        version,
        meta,
        health,
        rows,
        repo_seen,
    })))
}

fn split_total(t: &TokensOut) -> i64 {
    t.input
        .saturating_add(t.cache_read)
        .saturating_add(t.cache_write_5m)
        .saturating_add(t.cache_write_1h)
        .saturating_add(t.output)
}

impl TokensOut {
    fn add(&mut self, o: &TokensOut) {
        self.input = self.input.saturating_add(o.input);
        self.cache_read = self.cache_read.saturating_add(o.cache_read);
        self.cache_write_5m = self.cache_write_5m.saturating_add(o.cache_write_5m);
        self.cache_write_1h = self.cache_write_1h.saturating_add(o.cache_write_1h);
        self.output = self.output.saturating_add(o.output);
        self.reasoning = self.reasoning.saturating_add(o.reasoning);
        self.unsplit = self.unsplit.saturating_add(o.unsplit);
        self.total = self.total.saturating_add(o.total);
    }

    fn as_event_tokens(&self) -> crate::event::Tokens {
        crate::event::Tokens {
            input_uncached: self.input,
            cache_read: self.cache_read,
            cache_write_5m: self.cache_write_5m,
            cache_write_1h: self.cache_write_1h,
            output: self.output,
            reasoning: self.reasoning,
            unsplit: self.unsplit,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The answer.

/// What a branch's usage in the window adds up to.
#[derive(Default)]
struct Acc {
    tokens: TokensOut,
    hours: BTreeSet<i64>,
    harnesses: BTreeSet<String>,
    exact: bool,
    total_only: bool,
    usd_reported: f64,
    usd_estimated: f64,
    tokens_priced: i64,
    tokens_reported: i64,
    tokens_unpriced: i64,
    unpriced: BTreeMap<String, i64>,
}

impl Acc {
    /// A row with no tokens adds nothing, not even a reported amount: a branch is found only by
    /// its tokens, and a row that is not found never carries a cost.
    fn add(&mut self, r: &UsageRead, prices: &PriceTable) {
        let t = &r.tokens;
        if t.total == 0 {
            return;
        }
        self.tokens.add(t);
        self.hours.insert(r.hour_ms);
        self.harnesses.insert(r.harness.clone());
        if r.total_only {
            self.total_only = true;
        } else {
            self.exact = true;
        }
        if let Some(u) = r.reported_usd {
            self.usd_reported += u;
            self.tokens_reported = self.tokens_reported.saturating_add(t.total);
        } else if let Some(p) = prices.get(&r.model) {
            let split = split_total(t);
            if split > 0 {
                self.usd_estimated += p.cost(&t.as_event_tokens());
                self.tokens_priced = self.tokens_priced.saturating_add(split);
            }
            self.tokens_unpriced = self.tokens_unpriced.saturating_add(t.unsplit);
        } else {
            self.tokens_unpriced = self.tokens_unpriced.saturating_add(t.total);
            let n = self.unpriced.entry(r.model.clone()).or_default();
            *n = n.saturating_add(t.total);
        }
    }

    fn cost(&self) -> Cost {
        let known = self.tokens_priced.saturating_add(self.tokens_reported);
        let state = if self.tokens_unpriced == 0 {
            "priced"
        } else if known > 0 {
            "partial"
        } else {
            "unpriced"
        };
        let mut models: Vec<(&String, &i64)> = self.unpriced.iter().collect();
        models.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
        let unpriced_models = models
            .into_iter()
            .take(UNPRICED_MODELS_MAX)
            .map(|(m, _)| json_bounded(m, MODEL_NAME_BYTES))
            .collect();
        let (usd, rep, est) = if state == "unpriced" {
            (None, None, None)
        } else {
            (
                Some(self.usd_reported + self.usd_estimated),
                Some(self.usd_reported),
                Some(self.usd_estimated),
            )
        };
        Cost {
            state,
            usd,
            usd_reported: rep,
            usd_estimated: est,
            tokens_priced: self.tokens_priced,
            tokens_reported: self.tokens_reported,
            tokens_unpriced: self.tokens_unpriced,
            unpriced_models,
        }
    }

    fn precision(&self) -> &'static str {
        match (self.exact, self.total_only) {
            (true, true) => "mixed",
            (false, true) => "total_only",
            _ => "exact",
        }
    }

    fn activity(&self) -> Activity {
        Activity {
            first_hour: self.hours.first().map(|h| format_rfc3339(*h)),
            last_hour: self.hours.last().map(|h| format_rfc3339(*h)),
            hours: self.hours.len(),
            harnesses: self.harnesses.iter().cloned().collect(),
        }
    }
}

fn machine_of(meta: &BTreeMap<String, String>) -> Machine {
    let id = meta
        .get("machine")
        .or_else(|| meta.get("machine_fallback"))
        .map(|s| chars(s, MACHINE_ID_CHARS))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into());
    Machine { id, scope: "local" }
}

fn meta_i64(meta: &BTreeMap<String, String>, k: &str) -> Option<i64> {
    meta.get(k).and_then(|v| v.trim().parse().ok())
}

/// Source health, one entry per harness (by name), then the old folder's store if it holds usage
/// this store does not.
fn sources(
    snap: &Snapshot,
    stray: Option<&'static str>,
    now: i64,
    stale_ms: i64,
) -> Vec<SourceInfo> {
    let mut harnesses: Vec<Source> = Source::ALL.to_vec();
    harnesses.sort_by_key(|s| s.harness());
    let mut out: Vec<SourceInfo> = harnesses
        .into_iter()
        .map(|s| {
            let h = s.harness();
            let status = snap
                .meta
                .get(&format!("{h}_status"))
                .map(String::as_str)
                .filter(|v| matches!(*v, "ok" | "degraded" | "unsupported" | "absent"))
                .unwrap_or("ok")
                .to_string();
            let reason = snap
                .meta
                .get(&format!("{h}_reason"))
                .filter(|r| !r.is_empty())
                .map(|r| chars(r, LABEL_CHARS));
            let last = snap.health.get(h).copied().flatten();
            let counts = matches!(status.as_str(), "ok" | "degraded");
            let stale = counts && last.is_none_or(|t| now - t > stale_ms);
            SourceInfo {
                harness: h.to_string(),
                status,
                reason,
                last_success: last.map(format_rfc3339),
                stale,
            }
        })
        .collect();
    if let Some(why) = stray {
        out.push(SourceInfo {
            harness: LEGACY_STORE.into(),
            status: "degraded".into(),
            reason: Some(chars(why, LABEL_CHARS)),
            last_success: None,
            stale: false,
        });
    }
    out
}

fn pricing(dir: &Path) -> Result<(PriceTable, Pricing), String> {
    let path = dir.join("prices.json");
    let (table, origin, sha) = match std::fs::read(&path) {
        Ok(bytes) => {
            let text = String::from_utf8(bytes.clone())
                .map_err(|_| "the price override prices.json is not UTF-8".to_string())?;
            let t = PriceTable::with_override(&text)
                .map_err(|e| format!("the price override prices.json is not valid: {e}"))?;
            let sha = crate::event::hex(&Sha256::digest(&bytes));
            (t, "override", Some(sha))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            (PriceTable::bundled(), "bundled", None)
        }
        Err(e) => {
            return Err(format!(
                "the price override prices.json cannot be read: {e}"
            ));
        }
    };
    if !is_date(&table.date) {
        return Err(format!(
            "the price override's date {} is not YYYY-MM-DD",
            quoted(&table.date)
        ));
    }
    let info = PriceInfo {
        origin,
        date: table.date.clone(),
        source: if sha.is_some() {
            "usagemeter bundled list prices, with the prices.json override"
        } else {
            "usagemeter bundled list prices"
        },
        label: "list prices, an estimate",
        sha256: sha,
    };
    Ok((
        table,
        Pricing {
            table: info,
            reported_wins: true,
            long_prompt_tiers: false,
        },
    ))
}

fn is_date(d: &str) -> bool {
    let b = d.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
}

/// Runs one query. `args` are the words after `query`.
pub fn run(args: &[String], ctx: &Ctx) -> Answer {
    let generated_at = format_rfc3339(ctx.now_ms);
    let refuse = |r: Refusal| -> Answer {
        let env = Envelope {
            contract: CONTRACT,
            contract_version: CONTRACT_VERSION,
            capability: CAPABILITY,
            meter_version: ctx.meter_version.clone(),
            status: r.status,
            error: Some(r.error),
            generated_at: generated_at.clone(),
            as_of: None,
            machine: r.machine,
            store: r.store,
            ingestion: None,
            window: None,
            sources: Vec::new(),
            unattributed: None,
            pricing: None,
            query: r.echo,
            rows: Vec::new(),
        };
        Answer {
            code: r.code,
            stdout: line(&env),
        }
    };
    let req = match parse(args) {
        Ok(r) => r,
        Err(r) => return refuse(*r),
    };
    let echo_capped = || Some(echo(&req.repo, req.window, &req.branches, true));
    let failure = |code: u8,
                   status: &'static str,
                   error: ErrorObj,
                   store: Option<StoreInfo>,
                   machine: Option<Machine>| Refusal {
        code,
        status,
        error,
        echo: echo_capped(),
        store,
        machine,
    };
    let Some(dirs) = &ctx.state else {
        return refuse(failure(
            exit::ERROR,
            "error",
            ErrorObj::new(
                "no_state_dir",
                "HOME is not set; set METER_STATE_DIR to choose the state folder",
            ),
            None,
            None,
        ));
    };
    let (db, dir, location, stray) = match locate(dirs, ctx.overridden) {
        Err(m) => {
            return refuse(failure(
                exit::ERROR,
                "error",
                ErrorObj::new("move_unfinished", m),
                None,
                None,
            ));
        }
        Ok(Located::Absent) => return refuse(absent(failure)),
        Ok(Located::Store {
            db,
            dir,
            location,
            stray,
        }) => (db, dir, location, stray),
    };
    let unreadable = |e: &rusqlite::Error, store: Option<StoreInfo>| -> Refusal {
        if is_busy(e) {
            let mut err = ErrorObj::new(
                "locked",
                format!(
                    "no consistent snapshot of the store within {} s",
                    ctx.busy.as_secs_f64()
                ),
            );
            err.retry_after_s = Some(RETRY_AFTER_S);
            failure(exit::LOCKED, "locked", err, None, None)
        } else {
            failure(
                exit::ERROR,
                "error",
                ErrorObj::new(
                    "store_unreadable",
                    format!("the store could not be read: {e}"),
                ),
                store,
                None,
            )
        }
    };
    let conn = match open_read_only(&db, ctx.busy) {
        Ok(c) => c,
        Err(e) => return refuse(unreadable(&e, None)),
    };
    let stale_ms = req.stale_after_s * 1000;
    let window_of = |meta: &BTreeMap<String, String>| -> (i64, i64) {
        let w = watermark(meta);
        let end = hour_start(w.unwrap_or(ctx.now_ms)) + HOUR_MS;
        let requested = end - req.window.days() * DAY_MS;
        let counted_from = meta_i64(meta, "counted_from_ms").unwrap_or(requested);
        (requested.max(counted_from), end)
    };
    let snap = match read(&conn, &req.repo, window_of) {
        Ok(Read::Snapshot(s)) => s,
        Ok(Read::Absent) => return refuse(absent(failure)),
        Ok(Read::Version(v)) => {
            let store = Some(StoreInfo {
                schema_version: v,
                location: location.as_str(),
            });
            let (code, status, msg) = if v > SCHEMA_VERSION {
                (
                    exit::NEWER_SCHEMA,
                    "newer_schema",
                    "the store was written by a newer usagemeter; update the meter",
                )
            } else {
                (
                    exit::OUTDATED_STORE,
                    "outdated_store",
                    "the store needs a migration that only usagemeter sync runs",
                )
            };
            let mut e = ErrorObj::new(status, msg);
            e.store_schema_version = Some(v);
            e.supported_schema_version = Some(SCHEMA_VERSION);
            return refuse(failure(code, status, e, store, None));
        }
        Err(e) => {
            // The version is known only when reading it worked; a busy store is not asked twice.
            let v = if is_busy(&e) {
                None
            } else {
                schema_version(&conn).ok().flatten()
            };
            let store = v.map(|v| StoreInfo {
                schema_version: v,
                location: location.as_str(),
            });
            return refuse(unreadable(&e, store));
        }
    };
    drop(conn);
    let store_info = StoreInfo {
        schema_version: snap.version,
        location: location.as_str(),
    };
    let machine = machine_of(&snap.meta);
    let (table, pricing) = match pricing(&dir) {
        Ok(p) => p,
        Err(m) => {
            return refuse(failure(
                exit::ERROR,
                "error",
                ErrorObj::new("prices_unreadable", m),
                Some(store_info),
                None,
            ));
        }
    };

    let now = ctx.now_ms;
    let meta = &snap.meta;
    let w = watermark(meta);
    let counted_from = meta_i64(meta, "counted_from_ms").unwrap_or(0);
    let (start, end) = window_of(meta);
    let requested_start = end - req.window.days() * DAY_MS;
    let clipped = start > requested_start;
    let window_info = WindowInfo {
        name: req.window.name(),
        requested_start: format_rfc3339(requested_start),
        start: format_rfc3339(start),
        end: format_rfc3339(end),
        clipped,
    };
    let backlog = Backlog {
        bytes: nonneg(meta_i64(meta, "last_pending_bytes")),
        files: nonneg(meta_i64(meta, "last_pending_files")),
    };
    let stale = w.is_none_or(|w| now - w > stale_ms);
    let complete = backlog.bytes == 0 && backlog.files == 0;
    let srcs = sources(&snap, stray, now, stale_ms);
    let harness_sources: Vec<&SourceInfo> =
        srcs.iter().filter(|s| s.harness != LEGACY_STORE).collect();
    let counting: Vec<&&SourceInfo> = harness_sources
        .iter()
        .filter(|s| matches!(s.status.as_str(), "ok" | "degraded"))
        .collect();
    let as_of = if counting.iter().all(|s| s.last_success.is_some()) {
        counting
            .iter()
            .filter_map(|s| snap.health.get(&s.harness).copied().flatten())
            .min()
            .map(format_rfc3339)
    } else {
        None
    };
    let incomplete: Vec<String> = srcs
        .iter()
        .filter(|s| matches!(s.status.as_str(), "degraded" | "unsupported"))
        .map(|s| s.harness.clone())
        .collect();
    let any_unsupported = srcs.iter().any(|s| s.status == "unsupported");
    let all_vouch = srcs
        .iter()
        .all(|s| matches!(s.status.as_str(), "ok" | "absent"));

    // Usage with no recorded branch (OMP logs none): it could belong to any branch named.
    let mut unattributed = 0i64;
    let mut unattributed_by: BTreeSet<String> = BTreeSet::new();
    let mut by_branch: BTreeMap<&str, Acc> = BTreeMap::new();
    for b in &req.branches {
        by_branch.entry(b.as_str()).or_default();
    }
    for r in &snap.rows {
        match r.branch.as_deref() {
            None | Some("") => {
                if r.tokens.total > 0 {
                    unattributed = unattributed.saturating_add(r.tokens.total);
                    unattributed_by.insert(r.harness.clone());
                }
            }
            Some(b) => {
                if let Some(acc) = by_branch.get_mut(b) {
                    acc.add(r, &table);
                }
            }
        }
    }
    let coverage = if unattributed > 0 {
        "partial"
    } else {
        "complete"
    };

    // One row per distinct branch, in the order first named.
    let mut order: Vec<(&str, usize)> = Vec::new();
    for b in &req.branches {
        match order.iter_mut().find(|(n, _)| *n == b.as_str()) {
            Some(e) => e.1 += 1,
            None => order.push((b.as_str(), 1)),
        }
    }
    let rows: Vec<Row> = order
        .into_iter()
        .map(|(branch, requested)| {
            let acc = &by_branch[branch];
            let found = acc.tokens.total > 0;
            let missing_reason = if !snap.repo_seen {
                Some("repo_not_seen")
            } else if clipped {
                Some("window_before_counted_from")
            } else if !complete {
                Some("backlog")
            } else if !all_vouch {
                Some("source_incomplete")
            } else if unattributed > 0 {
                Some("branch_unattributed")
            } else {
                None
            };
            let numbers = |acc: &Acc| {
                (
                    Some(acc.tokens),
                    Some(acc.cost()),
                    Some(acc.precision()),
                    Some(acc.activity()),
                )
            };
            let none = (None, None, None, None);
            let (state, reason, (tokens, cost, precision, activity)) = if stale {
                (
                    "stale",
                    Some("ingestion_stale"),
                    if found { numbers(acc) } else { none },
                )
            } else if found {
                ("measured", None, numbers(acc))
            } else if any_unsupported {
                ("unsupported", Some("source_unsupported"), none)
            } else if let Some(why) = missing_reason {
                ("missing", Some(why), none)
            } else {
                (
                    "zero",
                    None,
                    (
                        Some(TokensOut::default()),
                        Some(Cost {
                            state: "zero",
                            usd: Some(0.0),
                            usd_reported: Some(0.0),
                            usd_estimated: Some(0.0),
                            tokens_priced: 0,
                            tokens_reported: 0,
                            tokens_unpriced: 0,
                            unpriced_models: Vec::new(),
                        }),
                        None,
                        Some(Activity {
                            first_hour: None,
                            last_hour: None,
                            hours: 0,
                            harnesses: Vec::new(),
                        }),
                    ),
                )
            };
            Row {
                branch: branch.to_string(),
                requested,
                state,
                reason,
                tokens,
                cost,
                token_precision: precision,
                attribution: Attribution {
                    precision: "branch_window",
                    exclusive: false,
                    shared: requested > 1,
                    coverage,
                },
                activity,
                incomplete_sources: incomplete.clone(),
            }
        })
        .collect();

    let env = Envelope {
        contract: CONTRACT,
        contract_version: CONTRACT_VERSION,
        capability: CAPABILITY,
        meter_version: ctx.meter_version.clone(),
        status: "ok",
        error: None,
        generated_at: generated_at.clone(),
        as_of,
        machine: Some(machine.clone()),
        store: Some(store_info.clone()),
        ingestion: Some(Ingestion {
            watermark: w.map(format_rfc3339),
            counted_from: format_rfc3339(counted_from),
            evidence_from: None,
            complete,
            backlog,
            stale,
            stale_after_s: req.stale_after_s,
        }),
        window: Some(window_info),
        sources: srcs,
        unattributed: Some(Unattributed {
            tokens_total: unattributed,
            harnesses: unattributed_by.into_iter().collect(),
        }),
        pricing: Some(pricing),
        query: Some(echo(&req.repo, req.window, &req.branches, false)),
        rows,
    };

    // The output cap: refused whole, never truncated, with how many rows would have fit.
    let full = line(&env);
    if full.len() <= OUTPUT_CAP {
        return Answer {
            code: exit::OK,
            stdout: full,
        };
    }
    let row_lens: Vec<usize> = env.rows.iter().map(|r| json(r).len()).collect();
    let base = Envelope {
        rows: Vec::new(),
        ..env
    };
    let base_len = line(&base).len();
    let mut used = base_len;
    let mut rows_fit = 0;
    for (i, n) in row_lens.iter().enumerate() {
        let add = n + usize::from(i > 0);
        if used + add > OUTPUT_CAP {
            break;
        }
        used += add;
        rows_fit += 1;
    }
    let mut e = ErrorObj::new(
        "too_large",
        format!(
            "the answer would take {} bytes; the most one answer takes is {OUTPUT_CAP}",
            full.len()
        ),
    );
    e.limit_bytes = Some(OUTPUT_CAP);
    e.needed_bytes = Some(full.len());
    e.rows_fit = Some(rows_fit);
    refuse(failure(
        exit::TOO_LARGE,
        "too_large",
        e,
        Some(store_info),
        Some(machine),
    ))
}

fn absent(
    failure: impl Fn(u8, &'static str, ErrorObj, Option<StoreInfo>, Option<Machine>) -> Refusal,
) -> Refusal {
    failure(
        exit::ABSENT_STORE,
        "absent_store",
        ErrorObj::new(
            "absent_store",
            "no meter store on this machine yet; open Herdr or run usagemeter sync",
        ),
        None,
        None,
    )
}

/// When the last sync finished its pass (a run that stopped at its time budget still finished;
/// `ingestion.complete` and `backlog` say what it left).
fn watermark(meta: &BTreeMap<String, String>) -> Option<i64> {
    meta_i64(meta, "last_run_ms").or_else(|| meta_i64(meta, "last_success_ms"))
}

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

fn line<T: Serialize>(v: &T) -> String {
    let mut s = json(v);
    s.push('\n');
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_len_matches_serde() {
        for s in [
            "plain",
            "a\"b",
            "back\\slash",
            "tab\there",
            "\u{1}ctl",
            "données",
            "é\"\u{7f}",
        ] {
            assert_eq!(
                json_len(s),
                serde_json::to_string(s).unwrap().len(),
                "{s:?}"
            );
        }
    }

    #[test]
    fn bounded_names_fit_and_say_they_were_cut() {
        let long = "m\"".repeat(100);
        let b = json_bounded(&long, MODEL_NAME_BYTES);
        assert!(json_len(&b) <= MODEL_NAME_BYTES, "{b}");
        assert!(b.ends_with('…'));
        assert_eq!(json_bounded("short", MODEL_NAME_BYTES), "short");
    }

    #[test]
    fn branch_and_repo_forms() {
        assert!(branch_ok("feat/gn-12-cache"));
        assert!(branch_ok("quote\"d"));
        for bad in [
            "",
            "a b",
            "a\\b",
            "a\u{1}",
            "a\u{7f}",
            "a\u{a0}",
            "a\u{feff}",
        ] {
            assert!(!branch_ok(bad), "{bad:?}");
        }
        assert!(repo_ok("example.com/acme/widgets"));
        assert!(repo_ok("example.org/group/sub/project"));
        for bad in [
            "Example.com/a/b",
            "example.com",
            "example.com/",
            "example.com//b",
            "e.com/a b",
        ] {
            assert!(!repo_ok(bad), "{bad:?}");
        }
    }
}
