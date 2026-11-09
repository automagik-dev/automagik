//! `meter sync`: one bounded pass over the harness logs, then the summary doc.

use std::collections::{BTreeSet, HashMap};
use std::io;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::event::{Actor, Precision, RollupKey, Tokens, UsageEvent};
use crate::hc::Hc;
use crate::ledger::{Call, Resolution, Resolver};
use crate::paths;
use crate::prices::PriceTable;
use crate::scan::{self, Candidate, Plan, ReadLimits, ReadOutcome};
use crate::sources::Source;
use crate::sources::codex::{self, State};
use crate::store::{Attributed, FileState, Health, SCHEMA_VERSION, Store};
use crate::summary::{self, SourceHealth};
use crate::time::{DAY_MS, HOUR_MS, day_start};

/// Phase timings on stderr when `METER_TRACE` is set. Durations only, never content.
struct Trace {
    on: bool,
    last: std::cell::Cell<Instant>,
}

impl Trace {
    fn new() -> Trace {
        Trace {
            on: std::env::var_os("METER_TRACE").is_some(),
            last: std::cell::Cell::new(Instant::now()),
        }
    }

    fn mark(&self, phase: &str) {
        if self.on {
            let now = Instant::now();
            eprintln!(
                "meter: {phase} {:.0} ms",
                (now - self.last.get()).as_secs_f64() * 1000.0
            );
            self.last.set(now);
        }
    }
}

pub const DEFAULT_DAYS: i64 = 30;
pub const DEFAULT_BUDGET: Duration = Duration::from_secs(20);
pub const DEFAULT_STALE_MS: i64 = 10 * 60 * 1000;
pub const DEFAULT_DOC: &str = "herdr-meter";
const REPO_RECHECK_MS: i64 = 7 * DAY_MS;
/// Threads are re-listed from a little before the last run's newest `updated_at_ms`, in case
/// Codex stamped a thread before it finished writing the rollout.
const CODEX_SLACK_MS: i64 = 10 * 60 * 1000;
/// A rollout with no running total is counted from `tokens_used` only once its thread has been
/// idle this long (a new thread writes its first total after its first reply).
const CODEX_IDLE_MS: i64 = HOUR_MS;

#[derive(Debug, Clone)]
pub struct Options {
    /// `~/.omp/agent/sessions`.
    pub omp_root: PathBuf,
    /// `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`).
    pub claude_root: PathBuf,
    /// `~/.codex` (or `$CODEX_HOME`).
    pub codex_home: PathBuf,
    /// `~/.dsh/sessions` (or `$DSH_HOME/sessions`).
    pub dsh_root: PathBuf,
    /// Herdr's global app home (`$HERDR_APP_HOME`, else `~/.config/herdr-app`): its workers and
    /// attach ledgers attribute usage. None reads neither.
    pub app_home: Option<PathBuf>,
    /// `$HERDR_WORKERS_LEDGER`, read beside the app home's ledgers when set.
    pub workers_ledger: Option<PathBuf>,
    /// Look for project app homes (`.herdr/app-home`) above each call's cwd.
    pub project_ledgers: bool,
    pub state_dir: PathBuf,
    /// The old default state directory to move the meter's files out of, once, before the first
    /// run in `state_dir` (see [`paths::migrate`]). None when `METER_STATE_DIR` is set.
    pub migrate_from: Option<PathBuf>,
    /// Window for the first import, and for a widening re-import.
    pub days: Option<i64>,
    pub backfill: bool,
    pub force: bool,
    pub budget: Duration,
    pub stale_ms: i64,
    pub publish: bool,
    pub doc_name: String,
    /// Talk to herdr-core (core id, labels, publish). Off in tests.
    pub use_hc: bool,
    /// Ask git for the repo of each cwd. Off in most tests.
    pub resolve_repos: bool,
    pub chunk_bytes: usize,
    pub max_line: usize,
    pub summary_cap: usize,
    pub now_ms: i64,
    /// Stop after this many chunks, as the time budget would (tests).
    #[doc(hidden)]
    pub chunk_limit: Option<usize>,
    /// The free bytes the migration check sees, instead of asking the filesystem (tests).
    #[doc(hidden)]
    pub free_bytes: Option<u64>,
}

impl Options {
    pub fn new(home: PathBuf, state_dir: PathBuf, now_ms: i64) -> Options {
        let claude_root = std::env::var_os("CLAUDE_CONFIG_DIR")
            .filter(|d| !d.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".claude"))
            .join("projects");
        let codex_home = std::env::var_os("CODEX_HOME")
            .filter(|d| !d.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".codex"));
        let dsh_root = std::env::var_os("DSH_HOME")
            .filter(|d| !d.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".dsh"))
            .join("sessions");
        let app_home = crate::ledger::app_home(
            std::env::var_os(crate::ledger::APP_HOME_ENV),
            Some(home.clone()),
        );
        let workers_ledger = std::env::var_os(crate::ledger::LEDGER_ENV)
            .filter(|p| !p.is_empty())
            .map(PathBuf::from);
        Options {
            omp_root: home.join(".omp/agent/sessions"),
            claude_root,
            codex_home,
            dsh_root,
            app_home,
            workers_ledger,
            project_ledgers: true,
            state_dir,
            migrate_from: None,
            days: None,
            backfill: false,
            force: false,
            budget: DEFAULT_BUDGET,
            stale_ms: DEFAULT_STALE_MS,
            publish: true,
            doc_name: DEFAULT_DOC.into(),
            use_hc: true,
            resolve_repos: true,
            chunk_bytes: 8 << 20,
            max_line: 16 << 20,
            summary_cap: summary::DEFAULT_CAP_BYTES,
            now_ms,
            chunk_limit: None,
            free_bytes: None,
        }
    }
}

#[derive(Debug, Default)]
pub struct Report {
    pub files_seen: usize,
    pub files_read: usize,
    pub unreadable: usize,
    pub bytes_read: u64,
    pub health: Health,
    pub pending_bytes: u64,
    pub pending_files: u64,
    pub stopped_by_budget: bool,
    pub elapsed: Duration,
    pub counted_from_ms: i64,
    pub reimported: bool,
    pub machine: String,
    pub summary_bytes: usize,
    pub summary: Option<serde_json::Value>,
    /// None: not attempted. Some(Ok(version)) or Some(Err(reason)).
    pub published: Option<Result<u64, String>>,
    /// The generation this run kept before it reset the store.
    pub generation: Option<crate::store::Generation>,
    /// Generations removed because this run succeeded on the migrated store.
    pub generations_removed: Vec<PathBuf>,
}

#[derive(Debug)]
pub enum Outcome {
    /// Another `meter sync` holds the lock.
    Locked,
    /// The move out of the old state directory is blocked (stderr says why): nothing was
    /// created, opened or synced.
    Blocked,
    /// The last complete sync is younger than the staleness window.
    Fresh {
        age_ms: i64,
    },
    /// The store was written by a newer meter (its `schema_version` is above this binary's):
    /// nothing was read, written or created.
    NewerSchema {
        store: i64,
    },
    /// A destructive migration needs at least twice the store's size free and the filesystem
    /// has less: the store was left as it was, and nothing else changed.
    NoSpace {
        free: u64,
        needed: u64,
    },
    Ran(Box<Report>),
}

#[derive(Debug)]
pub struct Error(pub String);

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Error {
        Error(format!("meter database: {e}"))
    }
}

/// Attribution: machine, repo per cwd (cached), and bot, role and squad from the resolver.
struct Attributor {
    machine: String,
    resolver: Resolver,
    repos: HashMap<String, Option<String>>,
    resolve: bool,
    now_ms: i64,
}

impl Attributor {
    fn repo(&mut self, store: &Store, cwd: Option<&str>) -> rusqlite::Result<Option<String>> {
        let Some(cwd) = cwd else { return Ok(None) };
        if let Some(r) = self.repos.get(cwd) {
            return Ok(r.clone());
        }
        let r = match store.cached_repo(cwd)? {
            Some((r, checked)) if self.now_ms - checked < REPO_RECHECK_MS => r,
            _ => {
                let r = if self.resolve {
                    crate::repo::resolve(cwd)
                } else {
                    None
                };
                store.cache_repo(cwd, r.as_deref(), self.now_ms)?;
                r
            }
        };
        self.repos.insert(cwd.to_string(), r.clone());
        Ok(r)
    }

    /// bot, role and squad from the launch the resolver ties the call to (RFC 0021 (a)). An
    /// ambiguous or unlinked call gives nothing: a bot is never guessed.
    fn actor(&mut self, e: &UsageEvent) -> Actor {
        let r = self.resolver.resolve(&Call {
            harness: e.harness,
            session: e.session.as_deref(),
            parent_session: e.parent_session.as_deref(),
            cwd: e.cwd.as_deref(),
            at_ms: e.ts_ms,
            copied: e.copied,
        });
        match r {
            Resolution::Tag(tag, _) => Actor {
                bot: Some(tag.bot),
                role: tag.role,
                squad: tag.squad,
            },
            Resolution::Ambiguous | Resolution::Unlinked => Actor::default(),
        }
    }

    fn attribute(
        &mut self,
        store: &Store,
        events: Vec<UsageEvent>,
        from_ms: i64,
    ) -> rusqlite::Result<Vec<Attributed>> {
        let mut out = Vec::with_capacity(events.len());
        for e in events {
            if e.ts_ms < from_ms {
                continue;
            }
            let repo = match &e.repo {
                Some(r) => Some(r.clone()),
                None => self.repo(store, e.cwd.as_deref())?,
            };
            let actor = self.actor(&e);
            out.push(Attributed {
                key: RollupKey {
                    bot: actor.bot,
                    role: actor.role,
                    harness: e.harness.to_string(),
                    model: e.model,
                    machine: self.machine.clone(),
                    repo,
                    branch: e.branch,
                    hour_ms: crate::time::hour_start(e.ts_ms),
                },
                squad: actor.squad,
                dedupe_key: e.dedupe_key,
                tokens: e.tokens,
                precision: e.precision,
                reported_usd: e.reported_usd,
                session: e.session,
                parent_session: e.parent_session,
                ts_ms: e.ts_ms,
            });
        }
        Ok(out)
    }
}

fn random_id() -> String {
    use std::io::Read;
    let mut b = [0u8; 12];
    if std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut b))
        .is_err()
    {
        let seed = format!("{}-{}", crate::time::now_ms(), std::process::id());
        b.copy_from_slice(
            &sha2::Digest::finalize(<sha2::Sha256 as sha2::Digest>::new_with_prefix(seed))[..12],
        );
    }
    format!("m-{}", crate::event::hex(&b))
}

/// The machine id: herdr-core's core id, else a random id generated once and kept in the store.
fn machine_id(store: &Store, core: Option<&str>) -> rusqlite::Result<String> {
    if let Some(id) = core {
        store.set_meta("machine", id)?;
        return Ok(id.to_owned());
    }
    if let Some(id) = store.meta("machine")? {
        return Ok(id);
    }
    let id = match store.meta("machine_fallback")? {
        Some(id) => id,
        None => {
            let id = random_id();
            store.set_meta("machine_fallback", &id)?;
            id
        }
    };
    Ok(id)
}

pub fn source_health(store: &Store) -> rusqlite::Result<Vec<SourceHealth>> {
    let mut by: HashMap<String, SourceHealth> = HashMap::new();
    for (src, last, h) in store.health()? {
        by.insert(
            src.clone(),
            SourceHealth {
                harness: src,
                last_success_ms: last,
                usage_lines: h.usage_lines,
                events: h.events,
                duplicates: h.duplicates,
                skipped_lines: h.skipped_lines,
                rewrites: h.rewrites,
                ..Default::default()
            },
        );
    }
    let mut out = Vec::new();
    for s in Source::ALL {
        let mut h = by.remove(s.harness()).unwrap_or(SourceHealth {
            harness: s.harness().into(),
            ..Default::default()
        });
        let (status, reason) = source_status(|k| store.meta(k).ok().flatten(), s);
        h.status = status;
        h.reason = reason;
        if s == Source::Codex {
            h.threads = Some(store.codex_thread_counts()?);
        }
        out.push(h);
    }
    Ok(out)
}

/// One source's status and reason, from the store's `meta`, as `status`, the summary doc and the
/// query all report it: `<harness>_status` and `<harness>_reason`, which every sync writes. A
/// dsh-tui session in a format this meter cannot read makes that source `unsupported`.
pub fn source_status(meta: impl Fn(&str) -> Option<String>, s: Source) -> (String, Option<String>) {
    let h = s.harness();
    if s == Source::DshTui
        && let Some(r) = meta("dsh_unread").filter(|r| !r.is_empty())
    {
        return ("unsupported".into(), Some(r));
    }
    let status = meta(&format!("{h}_status"))
        .filter(|v| matches!(v.as_str(), "ok" | "degraded" | "unsupported" | "absent"))
        .unwrap_or_else(|| "ok".into());
    (
        status,
        meta(&format!("{h}_reason")).filter(|r| !r.is_empty()),
    )
}

/// How long a session file must have been left alone before bytes at its end that are not a whole
/// frame count as unreadable rather than as a frame still being written.
const HELD_AFTER_MS: i64 = 60 * 1000;

/// dsh-tui's health after a run: `absent` with no session folder; `degraded` when any usage line
/// or frame could not be read since the window started (its usage is unknown), or when bytes at
/// the end of a session that stopped growing are not a whole frame (a corrupted block size holds
/// back the rest of the file); else `ok`.
fn dsh_tui_health(store: &Store, root: &std::path::Path, now: i64) -> rusqlite::Result<()> {
    let h = Source::DshTui.harness();
    let (status, reason) = if !root.is_dir() {
        ("absent", String::new())
    } else {
        let skipped = store
            .health()?
            .into_iter()
            .find(|(s, _, _)| s == h)
            .map_or(0, |(_, _, x)| x.skipped_lines);
        let (files, bytes): (i64, i64) = store.conn.query_row(
            "SELECT count(*), coalesce(sum(size - offset), 0) FROM files
             WHERE source = ?1 AND offset < size AND mtime_ms <= ?2",
            rusqlite::params![h, now - HELD_AFTER_MS],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let mut why = Vec::new();
        if skipped > 0 {
            why.push(format!(
                "{skipped} usage lines or frames could not be read, so their usage is unknown"
            ));
        }
        if files > 0 {
            why.push(format!(
                "{bytes} bytes at the end of {files} sessions are not whole frames, so their \
                 usage is unknown"
            ));
        }
        (
            if why.is_empty() { "ok" } else { "degraded" },
            why.join("; "),
        )
    };
    store.set_meta(&format!("{h}_status"), status)?;
    store.set_meta(&format!("{h}_reason"), &reason)
}

/// The version of the store at `db` when it is newer than this meter's. The caller holds the lock
/// of the store's directory, so nothing writes while it reads.
fn newer_version(db: &std::path::Path) -> Result<Option<i64>, Error> {
    Ok(crate::store::peek(db)?
        .map(|p| p.version)
        .filter(|v| *v > SCHEMA_VERSION))
}

/// [`newer_version`] for a directory whose lock is not held, read only while it has no lock file:
/// every meter makes its lock file before it writes, so with none there before and after the
/// read, nothing wrote during it. Anything else (a lock file, an unreadable store) says nothing.
fn newer_unlocked(dir: &std::path::Path) -> Option<i64> {
    let lock = dir.join("meter.lock");
    if lock.symlink_metadata().is_ok() {
        return None;
    }
    let v = newer_version(&dir.join("meter.db")).ok().flatten()?;
    lock.symlink_metadata().is_err().then_some(v)
}

/// [`newer_version`] for the old directory's store: under its lock when it has a lock file (and
/// not at all while an older meter holds it), else as [`newer_unlocked`].
fn newer_in_old_dir(old: &std::path::Path) -> Result<Option<i64>, Error> {
    if old.join("meter.lock").symlink_metadata().is_err() {
        return Ok(newer_unlocked(old));
    }
    match paths::try_lock(old) {
        Ok(Some(_held)) => newer_version(&old.join("meter.db")),
        _ => Ok(None),
    }
}

pub fn run(opts: &Options) -> Result<Outcome, Error> {
    let started = Instant::now();
    let deadline = started + opts.budget;
    let mkdir_err = |e: std::io::Error| {
        Error(format!(
            "cannot create the state directory {}: {e}",
            opts.state_dir.display()
        ))
    };
    paths::ensure_dir(&opts.state_dir).map_err(mkdir_err)?;
    let db_path = opts.state_dir.join("meter.db");
    // A store from a newer meter is refused before anything is made, the lock file included.
    // With no lock file no sync is writing (every meter makes its lock file before it writes): the
    // store is read as it lies, and the answer counts only if no lock file appeared meanwhile.
    if !paths::move_unfinished(&opts.state_dir)
        && let Some(v) = newer_unlocked(&opts.state_dir)
    {
        return Ok(Outcome::NewerSchema { store: v });
    }
    let Some(_lock) = paths::try_lock(&opts.state_dir).map_err(|e| {
        Error(format!(
            "cannot take the lock in {}: {e}",
            opts.state_dir.display()
        ))
    })?
    else {
        return Ok(Outcome::Locked);
    };
    // Under the lock nothing else writes here. A newer store, here or in the old directory, is
    // refused before the move runs: the move can settle markers and copy files.
    if !paths::move_unfinished(&opts.state_dir)
        && let Some(v) = newer_version(&db_path)?
    {
        return Ok(Outcome::NewerSchema { store: v });
    }
    if let Some(old) = &opts.migrate_from
        && !db_path.exists()
        && let Some(v) = newer_in_old_dir(old)?
    {
        return Ok(Outcome::NewerSchema { store: v });
    }
    // The move runs under the lock and before `prepare`, which creates an empty database.
    let mut old_generation = None;
    if let Some(old) = &opts.migrate_from {
        let m = paths::migrate(old, &opts.state_dir).map_err(|e| {
            Error(format!(
                "cannot move the state from {} to {}: {e}; files already moved are in {}, the rest are still in {}",
                old.display(),
                opts.state_dir.display(),
                opts.state_dir.display(),
                old.display()
            ))
        })?;
        if m.busy {
            return Ok(Outcome::Locked);
        }
        // Files the move cannot prove are its own sit in the state directory: creating or
        // opening a store beside them could replay or delete another generation's log.
        if m.stop {
            return Ok(Outcome::Blocked);
        }
        // An earlier run's move left the old copies as the recoverable generation: they go once
        // this sync succeeds, never in the run that copied them.
        old_generation = m.old_generation.then_some(old);
    }
    // Read before anything writes: the version decides whether this run may open the store at
    // all, and whether it must keep a generation first. (A store the move just brought in is read
    // here for the first time.)
    let peek = crate::store::peek(&db_path)?;
    if let Some(p) = &peek
        && p.version > SCHEMA_VERSION
    {
        return Ok(Outcome::NewerSchema { store: p.version });
    }
    let now = opts.now_ms;
    // The import window. Widening it (or --backfill) re-imports: rows are a projection.
    let stored = peek.as_ref().and_then(|p| p.counted_from_ms);
    // A store of an older version (row ids without precision) is rebuilt once over its window.
    // The reset drops every old row in the same transaction, so no doc counts a token twice.
    let outdated = peek.as_ref().is_some_and(|p| p.version < SCHEMA_VERSION);
    // A store that holds less than the default window (one filled when the default was 14 days)
    // widens once on its own: the installed trigger runs a plain `sync`.
    let wanted = if opts.backfill {
        0
    } else {
        let days = opts.days.unwrap_or(DEFAULT_DAYS).max(1);
        day_start(now - days * DAY_MS + DAY_MS)
    };
    let reset_from = match stored {
        None => Some(wanted),
        Some(s) if wanted < s || outdated => Some(wanted.min(s)),
        Some(_) => None,
    };
    // A reset is destructive when the store holds any row, whatever its window says.
    let holds_rows = peek.as_ref().is_some_and(|p| p.has_rows);
    let destructive = reset_from.is_some() && holds_rows;
    let reimported = reset_from.is_some() && (stored.is_some() || holds_rows);
    // Writing to an existing store's schema (a reset, or the index an older store lacks) needs at
    // least twice the store's size free; without it nothing changes.
    let needs_index = peek.as_ref().is_some_and(|p| !p.has_repo_index);
    if destructive || needs_index {
        let size: u64 = ["meter.db", "meter.db-wal"]
            .iter()
            .filter_map(|f| opts.state_dir.join(f).metadata().ok())
            .map(|m| m.len())
            .sum();
        let needed = size.saturating_mul(2);
        let free = match opts.free_bytes {
            Some(f) => f,
            None => paths::free_bytes(&opts.state_dir).map_err(|e| {
                Error(format!(
                    "cannot tell how much space is free in {}, so the store is not migrated: {e}",
                    opts.state_dir.display()
                ))
            })?,
        };
        if free < needed {
            return Ok(Outcome::NoSpace { free, needed });
        }
    }
    // Before a reset drops a store's rows, a generation that holds every row, checked by count.
    let mut generation = None;
    if let (Some(p), true) = (&peek, destructive) {
        let g = crate::store::write_generation(&db_path, p.version, now).map_err(|e| {
            Error(format!(
                "the store was not migrated: its generation could not be kept ({e})"
            ))
        })?;
        // One generation is kept: the newest, now that it is verified.
        for old in crate::store::generations(&opts.state_dir) {
            if old != g.path {
                std::fs::remove_file(&old).map_err(|e| {
                    Error(format!(
                        "cannot remove the older generation {}: {e}",
                        old.display()
                    ))
                })?;
            }
        }
        generation = Some(g);
    }
    let db = paths::prepare(&opts.state_dir).map_err(mkdir_err)?;
    let trace = Trace::new();
    let mut store = Store::open(&db)?;
    let prices = PriceTable::load(&opts.state_dir.join("prices.json")).map_err(Error)?;
    let counted_from = match reset_from {
        Some(from) => {
            store.reset(from)?;
            from
        }
        None => stored.unwrap_or(wanted),
    };

    if !opts.force && !reimported {
        let last = store.meta_i64("last_success_ms")?;
        let pending = store.meta_i64("last_pending_bytes")?.unwrap_or(0);
        if let Some(last) = last
            && pending == 0
            && now - last < opts.stale_ms
            && now >= last
        {
            return Ok(Outcome::Fresh { age_ms: now - last });
        }
    }

    trace.mark("open");
    let mut hc = if opts.use_hc {
        Hc::connect(Duration::from_secs(3))
    } else {
        None
    };
    let core = hc.as_mut().and_then(|h| h.core_id());
    let machine = machine_id(&store, core.as_deref())?;
    let snapshot = hc.as_mut().map(|h| h.terminals()).unwrap_or_default();
    // Rows of another core are skipped: with hc away, the core this store last saw stands in.
    let core = match core {
        Some(c) => Some(c),
        None => store.meta("machine")?,
    };
    let mut attr = Attributor {
        machine: machine.clone(),
        resolver: resolver(opts, core, snapshot),
        repos: HashMap::new(),
        resolve: opts.resolve_repos,
        now_ms: now,
    };

    trace.mark("hc");
    let mut report = Report {
        counted_from_ms: counted_from,
        reimported,
        machine,
        generation,
        ..Report::default()
    };
    let mut pending_sources: BTreeSet<Source> = BTreeSet::new();
    // Codex first, with at most half the budget: once imported, a run reads a few small tails.
    let codex_limits = ReadLimits {
        chunk_bytes: opts.chunk_bytes,
        max_line: opts.max_line,
        deadline: started + opts.budget / 2,
        chunks_left: opts.chunk_limit.map(std::cell::Cell::new),
    };
    let codex_read = codex_pass(
        opts,
        &mut store,
        &mut attr,
        counted_from,
        &codex_limits,
        &mut report,
        &mut pending_sources,
    )?;
    trace.mark("codex");

    let mut candidates: Vec<Candidate> = Vec::new();
    scan::discover(&opts.omp_root, Source::Omp, &mut candidates);
    scan::discover(&opts.claude_root, Source::Claude, &mut candidates);
    scan::discover(&opts.dsh_root, Source::DshTui, &mut candidates);
    let unread = crate::sources::dsh_tui::unread_generations(&opts.dsh_root);
    store.set_meta("dsh_unread", unread.as_deref().unwrap_or(""))?;
    // Newest first: recent usage is what people look at, and an old backlog can wait a run.
    candidates.sort_by(|a, b| {
        b.mtime_ms
            .cmp(&a.mtime_ms)
            .then_with(|| a.path.cmp(&b.path))
    });
    forks_last(&store, &mut candidates)?;

    report.files_seen += candidates.len();
    let limits = ReadLimits {
        chunk_bytes: opts.chunk_bytes,
        max_line: opts.max_line,
        deadline,
        chunks_left: opts.chunk_limit.map(std::cell::Cell::new),
    };
    let mut stopped_at = candidates.len();

    trace.mark("discover");
    for (i, c) in candidates.iter().enumerate() {
        if limits.exhausted() {
            stopped_at = i;
            break;
        }
        let path = c.path.to_string_lossy().into_owned();
        let prev = store.file(&path)?;
        if prev.is_none() && c.mtime_ms < counted_from {
            continue; // older than the window and never read
        }
        let plan = match scan::plan(c, prev) {
            Ok(p) => p,
            Err(_) => {
                report.unreadable += 1;
                continue;
            }
        };
        let (mut state, rewritten) = match plan {
            Plan::Unchanged => continue,
            Plan::Read { state, rewritten } => (*state, rewritten),
        };
        let res = read_into_store(
            &mut store,
            &mut attr,
            &mut state,
            c.source,
            rewritten,
            &limits,
            counted_from,
            now,
            &mut report,
        );
        match res {
            Ok(outcome) => {
                if outcome.stopped {
                    report.stopped_by_budget = true;
                    report.pending_bytes += c.size.saturating_sub(state.offset);
                    report.pending_files += 1;
                    pending_sources.insert(c.source);
                    stopped_at = i + 1;
                    break;
                }
            }
            Err(_) => report.unreadable += 1,
        }
    }
    for c in &candidates[stopped_at..] {
        let prev = store.file(&c.path.to_string_lossy())?;
        let offset = match &prev {
            Some(p)
                if p.dev == c.dev
                    && p.ino == c.ino
                    && p.size == c.size
                    && p.mtime_ms == c.mtime_ms =>
            {
                continue;
            }
            Some(p) if p.dev == c.dev && p.ino == c.ino && c.size >= p.offset => p.offset,
            None if c.mtime_ms < counted_from => continue,
            _ => 0,
        };
        if c.size > offset {
            report.stopped_by_budget = true;
            report.pending_bytes += c.size - offset;
            report.pending_files += 1;
            pending_sources.insert(c.source);
        }
    }

    trace.mark("read");
    for p in attr.resolver.refused() {
        eprintln!(
            "meter: {} is group- or world-writable, so anyone could have written who plays which \
             bot; it was not read. Check its rows, then make it the owner's alone: chmod 600 {}",
            p.display(),
            p.display()
        );
    }
    store.set_meta("last_run_ms", &now.to_string())?;
    store.set_meta("last_pending_bytes", &report.pending_bytes.to_string())?;
    store.set_meta("last_pending_files", &report.pending_files.to_string())?;
    // A harness whose log folder does not exist is absent on this machine: nothing to count, and
    // no success to stamp. (Codex records its own status in `codex_pass`.)
    for (s, root) in [
        (Source::Omp, &opts.omp_root),
        (Source::Claude, &opts.claude_root),
    ] {
        let status = if root.is_dir() { "ok" } else { "absent" };
        store.set_meta(&format!("{}_status", s.harness()), status)?;
    }
    dsh_tui_health(&store, &opts.dsh_root, now)?;
    for s in Source::ALL {
        let absent = match s {
            Source::Omp => !opts.omp_root.is_dir(),
            Source::Claude => !opts.claude_root.is_dir(),
            Source::Codex => !codex_read,
            Source::DshTui => !opts.dsh_root.is_dir(),
        };
        if !pending_sources.contains(&s) && !absent {
            store.mark_success(s.harness(), now)?;
        }
    }
    if report.pending_bytes == 0 {
        store.set_meta("last_success_ms", &now.to_string())?;
        // A later sync that succeeded on the migrated store: its generation has done its job.
        if !reimported {
            for g in crate::store::generations(&opts.state_dir) {
                match std::fs::remove_file(&g) {
                    Ok(()) => report.generations_removed.push(g),
                    Err(e) => eprintln!(
                        "meter: the generation {} was not removed: {e}; the next successful \
                         sync tries again",
                        g.display()
                    ),
                }
            }
        }
        if let Some(old) = old_generation
            && let Err(e) = paths::drop_old_generation(old, &opts.state_dir)
        {
            eprintln!(
                "meter: the old copies in {} were not removed: {e}; the next successful sync \
                 tries again",
                old.display()
            );
        }
    }

    trace.mark("commit");
    let rows = store.rows_since(counted_from)?;
    let sources = source_health(&store)?;
    let (doc, size) = summary::build(
        &summary::Input {
            rows: &rows,
            prices: &prices,
            now_ms: now,
            machine: &report.machine,
            meter_version: env!("CARGO_PKG_VERSION"),
            counted_from_ms: counted_from,
            pending_bytes: report.pending_bytes,
            pending_files: report.pending_files,
            sources: &sources,
        },
        opts.summary_cap,
    );
    trace.mark("summary");
    report.summary_bytes = size;
    if opts.publish {
        report.published = Some(match hc.as_mut() {
            Some(h) => h.doc_put(&opts.doc_name, &doc).map_err(|e| e.to_string()),
            None => Err("hc is not available".into()),
        });
    }
    trace.mark("publish");
    report.summary = Some(doc);
    report.elapsed = started.elapsed();
    Ok(Outcome::Ran(Box::new(report)))
}

/// The resolver for one sync: the global app home's ledgers, `$HERDR_WORKERS_LEDGER`, and the
/// project app homes found above the cwds it is asked about.
fn resolver(opts: &Options, core: Option<String>, snapshot: Vec<crate::hc::Terminal>) -> Resolver {
    let mut r = Resolver::new(core, snapshot).walk(opts.project_ledgers);
    if let Some(home) = &opts.app_home {
        r.load_app_home(home);
    }
    if let Some(p) = &opts.workers_ledger {
        r.load_workers(p);
    }
    r
}

/// Moves dsh-tui forks behind every other log, oldest fork first, keeping the rest in order: a
/// fork's first rows are copies of calls from the session it was seeded from (DSH does not record
/// which), so reading it after every session it could have copied, its own parent forks included,
/// lets each copied call be counted from its own session's read first. The header is read once
/// per file: after a first read, the file context holds it.
fn forks_last(store: &Store, candidates: &mut Vec<Candidate>) -> rusqlite::Result<()> {
    let mut forks: Vec<(i64, Candidate)> = Vec::new();
    let mut rest: Vec<Candidate> = Vec::with_capacity(candidates.len());
    for c in candidates.drain(..) {
        if c.source != Source::DshTui {
            rest.push(c);
            continue;
        }
        let prev = store.file(&c.path.to_string_lossy())?;
        let header = match prev.as_ref().map(|p| &p.ctx) {
            Some(ctx) if ctx.session.is_some() && !ctx.seeded => None,
            Some(ctx) if ctx.seeded && ctx.created_at.is_some() => Some(scan::DshHeader {
                seeded: true,
                created_at: ctx.created_at,
            }),
            _ => scan::dsh_header(&c.path),
        };
        match header {
            Some(h) if h.seeded => forks.push((h.created_at.unwrap_or(i64::MAX), c)),
            _ => rest.push(c),
        }
    }
    forks.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.path.cmp(&b.1.path)));
    rest.extend(forks.into_iter().map(|(_, c)| c));
    *candidates = rest;
    Ok(())
}

/// Reads one file from its saved state, committing each chunk (rows, offset and, for Codex, the
/// thread's running total) in one transaction, then records the file's final state.
#[allow(clippy::too_many_arguments)]
fn read_into_store(
    store: &mut Store,
    attr: &mut Attributor,
    state: &mut FileState,
    source: Source,
    rewritten: bool,
    limits: &ReadLimits,
    counted_from: i64,
    now: i64,
    report: &mut Report,
) -> io::Result<ReadOutcome> {
    let mut first = true;
    let outcome = scan::read_file(
        state,
        source,
        limits,
        |st: &FileState, events, mut health| {
            if first && rewritten {
                health.rewrites += 1;
            }
            first = false;
            let attributed = attr
                .attribute(store, events, counted_from)
                .map_err(io::Error::other)?;
            let applied = store
                .apply_chunk(st, &attributed, health, now)
                .map_err(io::Error::other)?;
            report.health.add(&applied);
            Ok(())
        },
    )?;
    report.files_read += 1;
    report.bytes_read += outcome.bytes;
    if rewritten && first {
        // Nothing was read (an emptied file): still count the rewrite.
        let h = Health {
            rewrites: 1,
            ..Health::default()
        };
        store
            .apply_chunk(state, &[], h, now)
            .map_err(io::Error::other)?;
        report.health.add(&h);
    } else {
        store.put_file(state).map_err(io::Error::other)?;
    }
    Ok(outcome)
}

fn set_codex_status(store: &Store, status: &str, reason: &str) -> rusqlite::Result<()> {
    store.set_meta("codex_status", status)?;
    store.set_meta("codex_reason", reason)
}

/// Codex threads changed since the last run: each rollout from where the last run stopped (its
/// tail, once imported), else the thread's `tokens_used` as `total_only`. Returns whether the
/// thread list could be read.
fn codex_pass(
    opts: &Options,
    store: &mut Store,
    attr: &mut Attributor,
    counted_from: i64,
    limits: &ReadLimits,
    report: &mut Report,
    pending: &mut BTreeSet<Source>,
) -> Result<bool, Error> {
    let now = opts.now_ms;
    let Some(db) = codex::state_db(&opts.codex_home) else {
        set_codex_status(store, "absent", "")?;
        return Ok(false);
    };
    let watermark = store.meta_i64("codex_watermark_ms")?;
    let since = watermark.map_or(counted_from, |w| (w - CODEX_SLACK_MS).max(counted_from));
    let (threads, parents) = match codex::read_state(&db, since) {
        State::Threads { threads, parents } => (threads, parents),
        State::Absent => {
            set_codex_status(store, "absent", "")?;
            return Ok(false);
        }
        State::Unsupported(reason) => {
            set_codex_status(store, "unsupported", &reason)?;
            return Ok(false);
        }
        State::Unreadable(reason) => {
            // Try again next run; what was counted stays.
            set_codex_status(store, "degraded", &reason)?;
            return Ok(false);
        }
    };
    report.files_seen += threads.len();
    let mut mark = watermark.unwrap_or(counted_from);
    let mut blocked = false;
    let (mut bad, mut unreadable, mut cache_writes, mut decreases) = (0i64, 0i64, 0i64, 0i64);
    for t in &threads {
        let rollout = codex::resolve_rollout(&opts.codex_home, t.rollout_path.as_deref());
        let c = rollout.as_deref().and_then(scan::candidate_of);
        if blocked || limits.exhausted() {
            blocked = true;
            report.stopped_by_budget = true;
            if let Some(c) = &c {
                let offset = store
                    .file(&c.path.to_string_lossy())?
                    .map_or(0, |f| f.offset);
                report.pending_bytes += c.size.saturating_sub(offset);
            }
            report.pending_files += 1;
            pending.insert(Source::Codex);
            continue;
        }
        let (old_path, cum, counted) = store.codex_thread(&t.id)?.unwrap_or_default();
        let mut ctx = t.ctx(parents.get(&t.id), cum, counted);
        // `complete`: everything the rollout holds is folded into `ctx`.
        let mut complete = rollout.is_none();
        match &c {
            None if rollout.is_some() => unreadable += 1,
            None => {}
            Some(c) => {
                let key = c.path.to_string_lossy().into_owned();
                let mut prev = store.file(&key)?;
                if prev.is_none()
                    && let Some(op) = old_path.as_deref().filter(|op| *op != key)
                    && let Some(mut o) = store.file(op)?
                    && o.dev == c.dev
                    && o.ino == c.ino
                {
                    // Moved (archived) in place: carry the offset over instead of reading again.
                    o.path = key.clone();
                    prev = Some(o);
                }
                match scan::plan(c, prev) {
                    Err(_) => unreadable += 1,
                    Ok(Plan::Unchanged) => complete = true,
                    Ok(Plan::Read { state, rewritten }) => {
                        let mut state = *state;
                        // The running total belongs to the thread, so a rollout read again from
                        // the start (rewritten or copied elsewhere) counts nothing twice.
                        state.ctx.codex = Some(ctx.clone());
                        match read_into_store(
                            store,
                            attr,
                            &mut state,
                            Source::Codex,
                            rewritten,
                            limits,
                            counted_from,
                            now,
                            report,
                        ) {
                            Ok(outcome) => {
                                if let Some(cx) = state.ctx.codex.take() {
                                    ctx = cx;
                                }
                                if outcome.stopped {
                                    blocked = true;
                                    report.stopped_by_budget = true;
                                    report.pending_bytes += c.size.saturating_sub(state.offset);
                                    report.pending_files += 1;
                                    pending.insert(Source::Codex);
                                } else {
                                    complete = true;
                                }
                            }
                            Err(_) => unreadable += 1,
                        }
                    }
                }
            }
        }
        bad += ctx.bad;
        cache_writes += ctx.cache_writes;
        decreases += ctx.decreases;
        let no_split = rollout.is_none()
            || ctx.bad > 0
            || (ctx.cum.total == 0 && now - t.updated_at_ms > CODEX_IDLE_MS);
        if complete && no_split && t.tokens_used > ctx.counted {
            let tokens = Tokens {
                unsplit: t.tokens_used - ctx.counted,
                ..Tokens::default()
            };
            ctx.counted = t.tokens_used;
            let e = codex::event(&ctx, t.updated_at_ms, tokens, Precision::TotalOnly);
            let attributed = attr.attribute(store, vec![e], counted_from)?;
            let h = Health {
                usage_lines: 1,
                ..Health::default()
            };
            let applied = store.apply_codex(&ctx, &attributed, h, now)?;
            report.health.add(&applied);
        }
        if !blocked {
            mark = mark.max(t.updated_at_ms);
        }
    }
    if Some(mark) != watermark {
        store.set_meta("codex_watermark_ms", &mark.to_string())?;
    }
    let total_bad = store.meta_i64("codex_bad_lines")?.unwrap_or(0) + bad;
    store.set_meta("codex_bad_lines", &total_bad.to_string())?;
    let mut reasons = Vec::new();
    if total_bad > 0 {
        reasons.push(format!(
            "{total_bad} token_count lines in an unknown format; their threads count as total_only"
        ));
    }
    if unreadable > 0 {
        reasons.push(format!("{unreadable} rollouts could not be read"));
    }
    if decreases > 0 {
        reasons.push(format!(
            "{decreases} running totals went down; counted as 0"
        ));
    }
    let degraded = !reasons.is_empty();
    if cache_writes > 0 {
        reasons.push(format!(
            "{cache_writes} lines have cache_write_input_tokens, counted as uncached input"
        ));
    }
    set_codex_status(
        store,
        if degraded { "degraded" } else { "ok" },
        &reasons.join("; "),
    )?;
    Ok(true)
}
