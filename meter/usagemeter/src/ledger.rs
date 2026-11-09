//! Attribution from Herdr's ledgers (RFC 0021 (a), delivery 4): which launch a call belongs to,
//! and so its bot, role and squad. Read only: nothing here writes, and a missing or unreadable
//! ledger means fewer answers, never an error.
//!
//! **What is read.** Herdr appends one JSON row per event to `workers.jsonl` and `attach.jsonl`
//! under an app home's `automagik-herdr/` folder. The resolver reads the global app home's
//! (`$HERDR_APP_HOME`, else `~/.config/herdr-app`), `$HERDR_WORKERS_LEDGER` when set, and each
//! project app home (`<folder>/.herdr/app-home`) found by walking up from the cwd of a call it is
//! asked about: only that ancestry, never a scan of the disk. A ledger that is group- or
//! world-writable is not read (the rule `attach.js` applies) and is listed in
//! [`Resolver::refused`]. Malformed lines are skipped, unknown fields ignored, and a field of the
//! wrong type counts as missing. Paths inside rows are compared as strings, never opened.
//!
//! **Launches.** A launch is one agent Herdr started in one terminal, keyed by `(core, terminal,
//! created_ms)` because hc reuses terminal ids. Its start rows give its fields; several start rows
//! with one key are one launch. It is valid from its terminal's `created_ms` (a row written before
//! RFC 0021 has none: its own `at`), to the first end the evidence shows: an `end` row, the attach
//! ledger's `end` or `detach` for its key, a later launch on the same terminal, or the hc snapshot
//! (a terminal that finished, or an address now held by a newer terminal). A terminal that is gone
//! from the snapshot gives no end: without the last sync that saw it (delivery 5), it stays a
//! claimant, so a call in that gap with another claimant stays ambiguous. Rows of another machine
//! (a `core` other than this one's, an attach row with `machine` set) are skipped: their usage is
//! in that machine's logs.
//!
//! **Finding the launch, per call**, strongest basis first:
//!
//! - `session`: a start row's `session`, or a `session` row (any harness: `agent`, absent for
//!   Claude's), ties the session to a launch. A session row with the launch's key names it
//!   outright; an older one names the launch on its terminal that was valid at its `at`. A launch
//!   counts from its `created_ms`, so a session row written before its start row still links,
//!   whatever the file order. A start row's session holds from its launch's start (Herdr chose
//!   the id at launch); a session row's from its own `at`. A later link elsewhere (a `/resume` in
//!   another pane) closes the one before it.
//! - `label`: an `agent.session` (or `revive.session`) label the hc snapshot shows on a terminal
//!   ties the session to that terminal's launch. Labels are the second witness: when they and the
//!   ledger name launches with different tags at one time, the call is ambiguous.
//! - `worktree`: every worker launch of the call's harness whose worktree is the folder the
//!   call's session started in, and that was valid at the call's time, is a claimant. The start
//!   folder, not the call's own cwd: a seat session that later works in a worker's worktree
//!   started in the project root, so it is never taken for that worker. Seats are never found this way (their
//!   folder is the project root, shared by every seat), but a seat there still competes, and so
//!   does a live harness terminal the snapshot shows in that cwd with no start row (an unlogged
//!   launch). This is new for Claude: a Claude worker that no row names falls back to it.
//!
//! **Never a guess.** A call no recorded launch claims is [`Resolution::Unlinked`] (a lone seat
//! found by its folder, or a lone unlogged terminal, names nothing). One whose claimants carry
//! different tags, include a launch whose start row cannot be read or placed in time, or set a
//! tag beside an unlogged launch, is [`Resolution::Ambiguous`]. Claimants whose attribution
//! fields are equal (bot, kind, role, squad, task, project, branch) collapse to that tag, so a
//! worker restarted on its own worktree keeps it; requested fields (agent, model, effort, lead)
//! that differ are dropped from the answer.
//!
//! **"Never wrong" holds only for logged launches.** A launch with no start row (a hand-started
//! `hc run`, a start whose ledger append failed, a ledger that is not read) is invisible here
//! unless a sync sees its terminal live, when it is a claimant with no tag. An unlogged launch that
//! ended before any sync saw it can still let the worktree path name the wrong worker; RFC 0021
//! accepts that and every answer carries its [`Basis`], so `worktree` is never read as strongly
//! as `session`.
//!
//! **Fields**, from the launch's start row, frozen at launch: `bot` (`bot`, else `botId`; for a
//! seat, the attach ledger's binding for the launch at the call's time when there is one), `kind`,
//! `role`, `squad`, `task` with `project` (workers only), `branch`, `lead` and what the launch
//! requested (`agent`, `model`, `effort`). Labels never overwrite them.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::hc::Terminal;

pub const LEDGER_ENV: &str = "HERDR_WORKERS_LEDGER";
/// Herdr's app home. Its writers put the ledgers under it.
pub const APP_HOME_ENV: &str = "HERDR_APP_HOME";
/// The app home when `HERDR_APP_HOME` is unset, relative to the user's home.
const DEFAULT_APP_HOME: &str = ".config/herdr-app";
/// The workers ledger, relative to an app home.
const LEDGER_RELATIVE: &str = "automagik-herdr/workers.jsonl";
/// The attach ledger, relative to an app home.
const ATTACH_RELATIVE: &str = "automagik-herdr/attach.jsonl";
/// A project's app home, relative to the project folder.
pub const PROJECT_APP_HOME: &str = ".herdr/app-home";

/// What launched the terminal: a worker on a task, or a long-lived seat (never a task).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Kind {
    Worker,
    Seat,
}

/// The join key for a task: the same short id in two projects is two tasks.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TaskKey {
    pub project: String,
    pub task: String,
}

/// The launch a call belongs to, as its start row recorded it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Tag {
    /// `bot`, else `botId`; for a seat, the attach ledger's binding when it has one.
    pub bot: String,
    pub kind: Kind,
    /// A worker's role (`dev`, `test`, `review`, `fix`), or a seat's pane role at launch (`main`,
    /// `captain`, a rank). None when the row did not record one.
    pub role: Option<String>,
    /// The head of the launching bot's lead chain, frozen at launch; None for the main bot and
    /// for rows written before RFC 0021.
    pub squad: Option<String>,
    /// Short task id such as `gh-45`. Always None for seats, and for old rows whose `task` field
    /// held the branch.
    pub task: Option<String>,
    /// Absolute path of the main checkout. Missing in older rows.
    pub project: Option<String>,
    pub branch: Option<String>,
    pub lead: Option<String>,
    /// The harness the launch asked for (`agent`). Requested, not observed.
    pub requested_agent: Option<String>,
    /// The model the launch asked for. Null for default-model and template workers; the model that
    /// actually ran comes from the transcript.
    pub requested_model: Option<String>,
    /// The reasoning effort the launch asked for. Requested, not observed.
    pub requested_effort: Option<String>,
    /// The model was swapped mid-task: skip it in model evaluation.
    pub swap: bool,
    /// The launch overrode the template's model: skip it in model evaluation.
    pub override_: bool,
}

impl Tag {
    /// The task this session counts toward. None for seats, rows without a task id, and rows
    /// without a project (the task id alone is not a key).
    pub fn task_key(&self) -> Option<TaskKey> {
        if self.kind != Kind::Worker {
            return None;
        }
        Some(TaskKey {
            project: self.project.clone()?,
            task: self.task.clone()?,
        })
    }

    /// True when model evaluation must leave this session out.
    pub fn skip_for_model_eval(&self) -> bool {
        self.swap || self.override_
    }

    /// The fields that must agree for two claimants to collapse into one tag.
    fn same_attribution(&self, o: &Tag) -> bool {
        self.bot == o.bot
            && self.kind == o.kind
            && self.role == o.role
            && self.squad == o.squad
            && self.task == o.task
            && self.project == o.project
            && self.branch == o.branch
    }

    /// Folds an equal claimant in: a requested field they disagree on is dropped, and either
    /// one's swap or override marks the answer.
    fn merge(&mut self, o: &Tag) {
        for (mine, theirs) in [
            (&mut self.lead, &o.lead),
            (&mut self.requested_agent, &o.requested_agent),
            (&mut self.requested_model, &o.requested_model),
            (&mut self.requested_effort, &o.requested_effort),
        ] {
            if mine != theirs {
                *mine = None;
            }
        }
        self.swap |= o.swap;
        self.override_ |= o.override_;
    }
}

/// How a call was tied to its launch, strongest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Basis {
    /// A Herdr row (a start row's `session`, or a `session` row) names the session.
    Session,
    /// A session label the hc snapshot showed on the launch's terminal names it.
    Label,
    /// The call's cwd is the worktree of the one worker that claims it.
    Worktree,
}

impl Basis {
    pub fn as_str(self) -> &'static str {
        match self {
            Basis::Session => "session",
            Basis::Label => "label",
            Basis::Worktree => "worktree",
        }
    }
}

// One per call, consumed at once: boxing the tag would cost an allocation per call.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    Tag(Tag, Basis),
    /// Claimants that differ, or one that cannot be read: never given a bot.
    Ambiguous,
    /// No claimant with a record.
    Unlinked,
}

/// One call to attribute.
#[derive(Debug, Clone, Copy)]
pub struct Call<'a> {
    /// The event's harness (`claude-code`, `codex`, `omp`, `dsh-tui`).
    pub harness: &'a str,
    pub session: Option<&'a str>,
    /// A sub-agent's parent session: it runs in its parent's terminal.
    pub parent_session: Option<&'a str>,
    pub cwd: Option<&'a str>,
    /// The cwd the session started in. The worktree basis looks up this one, not the call's own
    /// cwd: a session belongs to the worker whose worktree it started in, wherever it works later,
    /// and a seat session that moved into a worker's worktree is never that worker's.
    pub session_cwd: Option<&'a str>,
    /// The call's time, in milliseconds since the Unix epoch, UTC. A launch claims it when
    /// `valid_from <= at_ms < valid_to`.
    pub at_ms: i64,
    /// A dsh-tui fork's copy of its parent's call: its session is not the one it is read under,
    /// so it is never attributed from here ([`crate::sources::dsh_tui`]).
    pub copied: bool,
}

/// The ledger's `agent` for a harness.
pub fn agent_of(harness: &str) -> Option<&'static str> {
    match harness {
        "claude-code" | "claude" => Some("claude"),
        "codex" => Some("codex"),
        "omp" => Some("omp"),
        "dsh-tui" => Some("dsh-tui"),
        _ => None,
    }
}

/// Where the global ledger is: `$HERDR_WORKERS_LEDGER` when set and non-empty, else
/// `<app home>/automagik-herdr/workers.jsonl`.
pub fn ledger_path(
    ledger_env: Option<OsString>,
    app_home_env: Option<OsString>,
    home: Option<PathBuf>,
) -> Option<PathBuf> {
    if let Some(p) = ledger_env.filter(|p| !p.is_empty()) {
        return Some(PathBuf::from(p));
    }
    Some(app_home(app_home_env, home)?.join(LEDGER_RELATIVE))
}

/// The global app home: `$HERDR_APP_HOME` when set and non-empty, else `~/.config/herdr-app`
/// under `home`, as Herdr resolves it.
pub fn app_home(app_home_env: Option<OsString>, home: Option<PathBuf>) -> Option<PathBuf> {
    match app_home_env.filter(|p| !p.is_empty()) {
        Some(p) => Some(PathBuf::from(p)),
        None => Some(home?.join(DEFAULT_APP_HOME)),
    }
}

/// A launch's key: `(core, terminal, created_ms)`.
type Key = (Option<String>, String, i64);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct StartRow {
    terminal: Option<String>,
    core: Option<String>,
    created_ms: Option<i64>,
    at_ms: Option<i64>,
    worktree: Option<String>,
    agent: Option<String>,
    kind: Option<Kind>,
    session: Option<String>,
    tag: Option<Tag>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SessionRow {
    terminal: String,
    session: String,
    agent: String,
    core: Option<String>,
    created_ms: Option<i64>,
    at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct EndRow {
    key: Key,
    at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum AttachEvent {
    Attach,
    Detach,
    End,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct AttachRow {
    event: AttachEvent,
    bot: String,
    key: Key,
    at_ms: i64,
}

/// Every row read so far, deduplicated (a row may be in more than one ledger).
#[derive(Debug, Default)]
struct Rows {
    starts: Vec<StartRow>,
    sessions: Vec<SessionRow>,
    ends: Vec<EndRow>,
    /// In the order read: the attach fold is ordered.
    attach: Vec<AttachRow>,
    seen: HashSet<String>,
}

#[derive(Debug, Clone)]
struct Launch {
    key: Option<Key>,
    terminal: Option<String>,
    core: Option<String>,
    from: Option<i64>,
    to: Option<i64>,
    worktree: Option<String>,
    agent: Option<String>,
    kind: Option<Kind>,
    tags: Vec<Tag>,
    /// Every start row built a tag, and they agree on the launch's worktree and agent.
    complete: bool,
    /// Seen by the snapshot with no start row.
    logged: bool,
    /// A launch with no usable time shares its terminal: it may have replaced this one at any
    /// moment.
    unsure: bool,
}

impl Launch {
    fn covers(&self, t: i64) -> bool {
        self.from.is_none_or(|f| f <= t) && self.to.is_none_or(|e| t < e)
    }
}

#[derive(Debug, Clone)]
struct Link {
    /// None: the row names a launch no start row records.
    launch: Option<usize>,
    /// When the row that made it was written (a start row's link: its launch's start).
    at: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
    basis: Basis,
}

impl Link {
    fn covers(&self, t: i64) -> bool {
        self.from.is_none_or(|f| f <= t) && self.to.is_none_or(|e| t < e)
    }
}

/// A seat's bot per launch key, over `[from, to)`.
type Bindings = HashMap<Key, Vec<(i64, Option<i64>, String)>>;

#[derive(Debug, Default)]
struct Index {
    launches: Vec<Launch>,
    by_worktree: HashMap<String, Vec<usize>>,
    /// agent, then session, to the links that tie it to launches.
    links: HashMap<String, HashMap<String, Vec<Link>>>,
    bindings: Bindings,
}

/// What one claimant says about a call.
enum Claim {
    Tags(Vec<Tag>),
    /// A launch with a record that cannot be read: no tag, no usable time, or a neighbour that
    /// may have replaced it. Alone, it still makes the call ambiguous.
    Unknown,
    /// A launch no start row records (an unlogged terminal, a row naming a launch the ledgers do
    /// not hold), or a seat found by its folder: it competes with a tag, but alone it names
    /// nothing, so the call is unlinked.
    Unrecorded,
}

/// The resolver: the ledgers read so far, this machine's core id and the hc snapshot of this
/// sync. Ledgers are added with [`Resolver::load_app_home`] and [`Resolver::load_workers`], and
/// project app homes are found on their own (when [`Resolver::walk`] is on) from the cwd of each
/// call resolved.
#[derive(Debug, Default)]
pub struct Resolver {
    core: Option<String>,
    snapshot: Vec<Terminal>,
    rows: Rows,
    files: HashSet<PathBuf>,
    checked: HashSet<PathBuf>,
    refused: Vec<PathBuf>,
    walk: bool,
    index: Option<Index>,
}

impl Resolver {
    /// `core`: this machine's hc core id, when known (rows of other cores are then skipped).
    /// `snapshot`: the terminals hc listed at this sync; those of a linked machine (an address
    /// with a `/`) are left out.
    pub fn new(core: Option<String>, snapshot: Vec<Terminal>) -> Resolver {
        Resolver {
            core,
            snapshot: snapshot
                .into_iter()
                .filter(|t| !t.terminal.contains('/'))
                .collect(),
            ..Resolver::default()
        }
    }

    /// Whether project app homes are looked for above each call's cwd.
    pub fn walk(mut self, on: bool) -> Resolver {
        self.walk = on;
        self
    }

    /// Ledgers not read because anyone but their owner could write them.
    pub fn refused(&self) -> &[PathBuf] {
        &self.refused
    }

    /// Reads an app home's workers and attach ledgers, once each.
    pub fn load_app_home(&mut self, app_home: &Path) {
        self.load_workers(&app_home.join(LEDGER_RELATIVE));
        if let Some(b) = self.read_file(&app_home.join(ATTACH_RELATIVE)) {
            self.add_attach(&b);
        }
    }

    /// Reads one workers ledger, once.
    pub fn load_workers(&mut self, path: &Path) {
        if let Some(b) = self.read_file(path) {
            self.add_workers(&b);
        }
    }

    fn read_file(&mut self, path: &Path) -> Option<Vec<u8>> {
        if !self.files.insert(path.to_path_buf()) {
            return None;
        }
        let meta = std::fs::metadata(path).ok()?;
        if !meta.is_file() {
            return None;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if meta.permissions().mode() & 0o022 != 0 {
                self.refused.push(path.to_path_buf());
                return None;
            }
        }
        std::fs::read(path).ok()
    }

    /// Adds a workers ledger's rows (`start`, `session`, `end`).
    pub fn add_workers(&mut self, bytes: &[u8]) {
        for line in bytes.split(|b| *b == b'\n') {
            let Ok(Value::Object(row)) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            let parsed = match str_field(&row, "event") {
                Some("start") => parse_start(&row).map(Parsed::Start),
                Some("session") => parse_session(&row).map(Parsed::Session),
                Some("end") => parse_end(&row).map(Parsed::End),
                _ => None,
            };
            if let Some(p) = parsed {
                self.add(p, line);
            }
        }
    }

    /// Adds an attach ledger's rows. A row of another machine (`machine` set) is skipped.
    pub fn add_attach(&mut self, bytes: &[u8]) {
        for line in bytes.split(|b| *b == b'\n') {
            let Ok(Value::Object(row)) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            if let Some(r) = parse_attach(&row) {
                self.add(Parsed::Attach(r), line);
            }
        }
    }

    fn add(&mut self, p: Parsed, line: &[u8]) {
        if !self
            .rows
            .seen
            .insert(String::from_utf8_lossy(line).trim().to_owned())
        {
            return;
        }
        match p {
            Parsed::Start(r) => self.rows.starts.push(r),
            Parsed::Session(r) => self.rows.sessions.push(r),
            Parsed::End(r) => self.rows.ends.push(r),
            Parsed::Attach(r) => self.rows.attach.push(r),
        }
        self.index = None;
    }

    /// Looks for project app homes in `cwd` and every folder above it, each folder once.
    fn discover(&mut self, cwd: &str) {
        let p = Path::new(cwd);
        if !p.is_absolute() {
            return;
        }
        for dir in p.ancestors() {
            // Every folder above one already looked at was looked at with it.
            if !self.checked.insert(dir.to_path_buf()) {
                break;
            }
            let home = dir.join(PROJECT_APP_HOME);
            if home.is_dir() {
                self.load_app_home(&home);
            }
        }
    }

    pub fn resolve(&mut self, call: &Call) -> Resolution {
        if call.copied {
            return Resolution::Unlinked;
        }
        if self.walk {
            for cwd in [call.session_cwd, call.cwd].into_iter().flatten() {
                self.discover(cwd);
            }
        }
        if self.index.is_none() {
            self.index = Some(build(&self.rows, self.core.as_deref(), &self.snapshot));
        }
        let Some(ix) = self.index.as_ref() else {
            return Resolution::Unlinked;
        };
        ix.resolve(call)
    }
}

// One per row, moved straight into its table.
#[allow(clippy::large_enum_variant)]
enum Parsed {
    Start(StartRow),
    Session(SessionRow),
    End(EndRow),
    Attach(AttachRow),
}

impl Index {
    fn resolve(&self, call: &Call) -> Resolution {
        let Some(agent) = agent_of(call.harness) else {
            return Resolution::Unlinked;
        };
        let t = call.at_ms;
        let by_session = self.links.get(agent);
        for s in [call.session, call.parent_session].into_iter().flatten() {
            let Some(links) = by_session.and_then(|m| m.get(s)) else {
                continue;
            };
            let covering: Vec<&Link> = links.iter().filter(|l| l.covers(t)).collect();
            if covering.is_empty() {
                continue;
            }
            let basis = if covering.iter().any(|l| l.basis == Basis::Session) {
                Basis::Session
            } else {
                Basis::Label
            };
            let claims = covering.iter().map(|l| match (l.launch, l.from) {
                (Some(i), Some(_)) => self.claim(i, t),
                (Some(_), None) => Claim::Unknown,
                (None, _) => Claim::Unrecorded,
            });
            return judge(claims, basis);
        }
        let Some(cwd) = call.session_cwd.or(call.cwd) else {
            return Resolution::Unlinked;
        };
        let Some(on) = self.by_worktree.get(normalize(cwd)) else {
            return Resolution::Unlinked;
        };
        let claims = on.iter().filter_map(|&i| {
            let l = &self.launches[i];
            if l.agent.as_deref().is_some_and(|a| a != agent) || !l.covers(t) {
                return None;
            }
            // A seat, or a terminal with no start row, competes but never names the call by its
            // folder; a worker of an unrecorded harness may be this call's.
            if l.kind != Some(Kind::Worker) || !l.logged {
                return Some(Claim::Unrecorded);
            }
            if l.agent.is_none() {
                return Some(Claim::Unknown);
            }
            Some(self.claim(i, t))
        });
        judge(claims, Basis::Worktree)
    }

    /// What launch `i` says about a call at `t`.
    fn claim(&self, i: usize, t: i64) -> Claim {
        let l = &self.launches[i];
        if !l.logged {
            return Claim::Unrecorded;
        }
        if !l.complete || l.unsure || l.from.is_none() || l.tags.is_empty() {
            return Claim::Unknown;
        }
        let bound = l
            .key
            .as_ref()
            .filter(|_| l.kind == Some(Kind::Seat))
            .and_then(|k| self.bindings.get(k))
            .and_then(|b| {
                b.iter()
                    .find(|(from, to, _)| *from <= t && to.is_none_or(|e| t < e))
            })
            .map(|(_, _, bot)| bot.clone());
        Claim::Tags(
            l.tags
                .iter()
                .map(|tag| match &bound {
                    Some(bot) => Tag {
                        bot: bot.clone(),
                        ..tag.clone()
                    },
                    None => tag.clone(),
                })
                .collect(),
        )
    }
}

/// The answer from every claimant of a call: a record that cannot be read, a tag beside an
/// unrecorded claimant, or tags that differ are Ambiguous; no record at all is Unlinked; else the
/// collapsed tag.
fn judge(claims: impl Iterator<Item = Claim>, basis: Basis) -> Resolution {
    let mut tags: Vec<Tag> = Vec::new();
    let (mut unknown, mut unrecorded) = (false, false);
    for c in claims {
        match c {
            Claim::Tags(t) => tags.extend(t),
            Claim::Unknown => unknown = true,
            Claim::Unrecorded => unrecorded = true,
        }
    }
    if unknown {
        return Resolution::Ambiguous;
    }
    let Some(first) = tags.first() else {
        return Resolution::Unlinked;
    };
    if unrecorded || tags.iter().any(|t| !t.same_attribution(first)) {
        return Resolution::Ambiguous;
    }
    let mut out = first.clone();
    for t in &tags[1..] {
        out.merge(t);
    }
    Resolution::Tag(out, basis)
}

/// The launch keyed `(core, terminal, created)`, where a row with no `core` matches any core.
fn find(
    by_tc: &HashMap<(String, i64), Vec<usize>>,
    launches: &[Launch],
    core: Option<&str>,
    terminal: &str,
    created: i64,
) -> Option<usize> {
    by_tc
        .get(&(terminal.to_owned(), created))?
        .iter()
        .copied()
        .find(|&i| same_core(launches[i].core.as_deref(), core))
}

/// Whether two cores can be the same machine: equal, or either unknown.
fn same_core(a: Option<&str>, b: Option<&str>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => a == b,
        _ => true,
    }
}

fn build(rows: &Rows, core: Option<&str>, snapshot: &[Terminal]) -> Index {
    let foreign = |c: &Option<String>| !same_core(c.as_deref(), core);
    let mut ix = Index::default();
    // Launches: start rows grouped by key; a row with no key (written before RFC 0021) is its own.
    let mut by_key: HashMap<Key, usize> = HashMap::new();
    let mut members: Vec<Vec<&StartRow>> = Vec::new();
    for s in &rows.starts {
        if foreign(&s.core) {
            continue;
        }
        let key = match (&s.terminal, s.created_ms) {
            (Some(t), Some(c)) => Some((s.core.clone(), t.clone(), c)),
            _ => None,
        };
        if let Some(&i) = key.as_ref().and_then(|k| by_key.get(k)) {
            members[i].push(s);
            continue;
        }
        if let Some(k) = key {
            by_key.insert(k, members.len());
        }
        members.push(vec![s]);
    }
    for group in &members {
        let first = group[0];
        let key = match (&first.terminal, first.created_ms) {
            (Some(t), Some(c)) => Some((first.core.clone(), t.clone(), c)),
            _ => None,
        };
        let mut tags: Vec<Tag> = Vec::new();
        let mut complete = true;
        for s in group {
            match &s.tag {
                Some(t) if !tags.contains(t) => tags.push(t.clone()),
                Some(_) => {}
                None => complete = false,
            }
            complete &= s.worktree == first.worktree && s.agent == first.agent;
            complete &= s.kind == first.kind;
        }
        let from = first
            .created_ms
            .or_else(|| group.iter().filter_map(|s| s.at_ms).min());
        ix.launches.push(Launch {
            key,
            terminal: first.terminal.clone(),
            core: first.core.clone(),
            from,
            to: None,
            worktree: first.worktree.clone(),
            agent: first.agent.clone(),
            kind: first.kind,
            tags,
            complete,
            logged: true,
            unsure: false,
        });
    }
    let mut by_tc: HashMap<(String, i64), Vec<usize>> = HashMap::new();
    for (i, l) in ix.launches.iter().enumerate() {
        if let Some((_, t, c)) = &l.key {
            by_tc.entry((t.clone(), *c)).or_default().push(i);
        }
    }
    // Terminals the snapshot shows running a harness, with no start row: unlogged launches. A
    // start row with no key on that terminal inside the terminal's life may be its own, so it
    // takes that place.
    for t in snapshot {
        let (Some(created), Some(harness)) = (t.created_ms, t.harness) else {
            continue;
        };
        if core.is_none() || find(&by_tc, &ix.launches, core, &t.terminal, created).is_some() {
            continue;
        }
        let key = (core.map(str::to_owned), t.terminal.clone(), created);
        let keyless = ix.launches.iter().any(|l| {
            l.key.is_none()
                && l.terminal.as_deref() == Some(t.terminal.as_str())
                && l.from
                    .is_none_or(|f| f >= created && t.finished_ms.is_none_or(|e| f < e))
        });
        if keyless {
            continue;
        }
        by_tc
            .entry((t.terminal.clone(), created))
            .or_default()
            .push(ix.launches.len());
        ix.launches.push(Launch {
            key: Some(key),
            terminal: Some(t.terminal.clone()),
            core: core.map(str::to_owned),
            from: Some(created),
            to: t.finished_ms,
            worktree: t.cwd.as_deref().map(|c| normalize(c).to_owned()),
            agent: agent_of(harness).map(str::to_owned),
            kind: None,
            tags: Vec::new(),
            complete: false,
            logged: false,
            unsure: false,
        });
    }
    // Ends: end rows, and the attach ledger's end and detach rows.
    let end_at = |key: &Key, at: i64, launches: &mut Vec<Launch>| {
        if let Some(i) = find(&by_tc, launches, key.0.as_deref(), &key.1, key.2) {
            let l = &mut launches[i];
            l.to = Some(l.to.map_or(at, |e| e.min(at)));
        }
    };
    for e in &rows.ends {
        if !foreign(&e.key.0) {
            end_at(&e.key, e.at_ms, &mut ix.launches);
        }
    }
    for a in &rows.attach {
        if !foreign(&a.key.0) && matches!(a.event, AttachEvent::Detach | AttachEvent::End) {
            end_at(&a.key, a.at_ms, &mut ix.launches);
        }
    }
    // The snapshot: a terminal that finished ends its launch (a newer terminal at its address
    // ends it too, below, whatever that terminal runs).
    for t in snapshot {
        let (Some(created), Some(done)) = (t.created_ms, t.finished_ms) else {
            continue;
        };
        if let Some(i) = find(&by_tc, &ix.launches, core, &t.terminal, created) {
            let l = &mut ix.launches[i];
            l.to = Some(l.to.map_or(done, |e| e.min(done)));
        }
    }
    // A terminal runs one launch at a time: a later launch on it ended the one before.
    let mut by_terminal: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, l) in ix.launches.iter().enumerate() {
        if let Some(t) = &l.terminal {
            by_terminal.entry(t.clone()).or_default().push(i);
        }
    }
    let mut ends: Vec<(usize, Option<i64>, bool)> = Vec::new();
    for idx in by_terminal.values() {
        for &i in idx {
            let l = &ix.launches[i];
            let mut next: Option<i64> = None;
            let mut unsure = false;
            for &j in idx {
                let m = &ix.launches[j];
                if i == j || !same_core(l.core.as_deref(), m.core.as_deref()) {
                    continue;
                }
                match (l.from, m.from) {
                    (Some(a), Some(b)) if b > a => next = Some(next.map_or(b, |n| n.min(b))),
                    (_, None) => unsure = true,
                    _ => {}
                }
            }
            ends.push((i, next, unsure));
        }
    }
    for (i, next, unsure) in ends {
        let l = &mut ix.launches[i];
        if let Some(n) = next {
            l.to = Some(l.to.map_or(n, |e| e.min(n)));
        }
        l.unsure |= unsure;
    }
    // Whatever runs in it now, a newer terminal at an address ends every older launch of this
    // machine there: hc reuses addresses, and a shell is no launch of its own.
    for t in snapshot {
        let Some(created) = t.created_ms else {
            continue;
        };
        for &i in by_terminal.get(&t.terminal).into_iter().flatten() {
            let l = &mut ix.launches[i];
            if same_core(l.core.as_deref(), core) && l.from.is_some_and(|f| f < created) {
                l.to = Some(l.to.map_or(created, |e| e.min(created)));
            }
        }
    }
    for (i, l) in ix.launches.iter().enumerate() {
        if let Some(w) = &l.worktree {
            ix.by_worktree
                .entry(normalize(w).to_owned())
                .or_default()
                .push(i);
        }
    }
    ix.bindings = fold_attach(rows.attach.iter().filter(|a| !foreign(&a.key.0)));
    // Links, per agent and session.
    let mut raw: HashMap<(String, String), Vec<Link>> = HashMap::new();
    for (i, l) in ix.launches.iter().enumerate() {
        if !l.logged {
            continue;
        }
        for s in &members[i] {
            if let Some(session) = &s.session {
                let agent = s.agent.clone().unwrap_or_else(|| "claude".into());
                raw.entry((agent, session.clone())).or_default().push(Link {
                    launch: Some(i),
                    at: l.from,
                    from: None,
                    to: None,
                    basis: Basis::Session,
                });
            }
        }
    }
    for r in &rows.sessions {
        if foreign(&r.core) {
            continue;
        }
        let targets: Vec<Option<usize>> = match r.created_ms {
            Some(c) => vec![find(
                &by_tc,
                &ix.launches,
                r.core.as_deref(),
                &r.terminal,
                c,
            )],
            None => {
                let on: Vec<Option<usize>> = by_terminal
                    .get(r.terminal.as_str())
                    .into_iter()
                    .flatten()
                    .copied()
                    .filter(|&i| {
                        let l = &ix.launches[i];
                        same_core(l.core.as_deref(), r.core.as_deref())
                            && r.at_ms.is_some_and(|at| l.covers(at))
                    })
                    .map(Some)
                    .collect();
                if on.is_empty() { vec![None] } else { on }
            }
        };
        for target in targets {
            raw.entry((r.agent.clone(), r.session.clone()))
                .or_default()
                .push(Link {
                    launch: target,
                    at: r.at_ms,
                    from: None,
                    to: None,
                    basis: Basis::Session,
                });
        }
    }
    for t in snapshot {
        let (Some(created), Some(harness)) = (t.created_ms, t.harness) else {
            continue;
        };
        let (Some(session), Some(agent)) = (t.labels.session_for(harness), agent_of(harness))
        else {
            continue;
        };
        let Some(i) = find(&by_tc, &ix.launches, core, &t.terminal, created) else {
            continue;
        };
        raw.entry((agent.to_owned(), session.to_owned()))
            .or_default()
            .push(Link {
                launch: Some(i),
                at: Some(created),
                from: None,
                to: None,
                basis: Basis::Label,
            });
    }
    for ((agent, session), mut links) in raw {
        place(&mut links, &ix.launches);
        ix.links.entry(agent).or_default().insert(session, links);
    }
    ix
}

/// Sets each link's interval. A ledger link holds from its row's time (a start row's: its launch's
/// start), never before its launch began, until its launch ends or the session's next ledger link
/// elsewhere begins. A label link holds over its launch's life: it is a second witness,
/// never closed by the ledger, so where the two disagree the call is ambiguous.
fn place(links: &mut [Link], launches: &[Launch]) {
    let launch_from = |l: &Link| l.launch.and_then(|i| launches[i].from);
    links.sort_by_key(|l| (l.basis, l.at.or_else(|| launch_from(l)), l.launch));
    let ledger = links.iter().filter(|l| l.basis == Basis::Session).count();
    let (ledger_links, label_links) = links.split_at_mut(ledger);
    for l in ledger_links.iter_mut() {
        l.from = match (l.launch, launch_from(l), l.at) {
            (Some(_), Some(s), Some(a)) => Some(s.max(a)),
            (Some(_), _, _) => None,
            (None, _, a) => a,
        };
    }
    let ends: Vec<Option<i64>> = ledger_links
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let end = l.launch.and_then(|j| launches[j].to);
            let next = ledger_links[i + 1..]
                .iter()
                .filter(|n| n.launch != l.launch)
                .find_map(|n| n.from);
            match (end, next) {
                (Some(e), Some(n)) => Some(e.min(n)),
                (e, n) => e.or(n),
            }
        })
        .collect();
    for (l, to) in ledger_links.iter_mut().zip(ends) {
        l.to = to;
    }
    for l in label_links {
        if let Some(j) = l.launch {
            l.from = launches[j].from;
            l.to = launches[j].to;
        }
    }
}

/// The attach ledger's bindings per launch key, over time, by its fold (`attach.js`
/// `foldAttach`): an attach ends the bot's binding elsewhere and the key's binding, then binds the
/// key; a detach unbinds the key from that bot; an end unbinds the key.
fn fold_attach<'a>(rows: impl Iterator<Item = &'a AttachRow>) -> Bindings {
    let mut out: Bindings = HashMap::new();
    let mut open: HashMap<Key, (i64, String)> = HashMap::new();
    let mut held: HashMap<String, Key> = HashMap::new();
    let mut close = |key: &Key, at: i64, open: &mut HashMap<Key, (i64, String)>| {
        if let Some((from, bot)) = open.remove(key) {
            out.entry(key.clone())
                .or_default()
                .push((from, Some(at), bot));
        }
    };
    let mut ordered: Vec<&AttachRow> = rows.collect();
    ordered.sort_by_key(|r| r.at_ms);
    for r in ordered {
        match r.event {
            AttachEvent::Attach => {
                if let Some(k) = held.remove(&r.bot) {
                    close(&k, r.at_ms, &mut open);
                }
                close(&r.key, r.at_ms, &mut open);
                open.insert(r.key.clone(), (r.at_ms, r.bot.clone()));
                held.insert(r.bot.clone(), r.key.clone());
            }
            AttachEvent::Detach => {
                if open.get(&r.key).is_some_and(|(_, b)| *b == r.bot) {
                    close(&r.key, r.at_ms, &mut open);
                    held.remove(&r.bot);
                }
            }
            AttachEvent::End => {
                if let Some((_, b)) = open.get(&r.key) {
                    held.remove(b);
                }
                close(&r.key, r.at_ms, &mut open);
            }
        }
    }
    for (key, (from, bot)) in open {
        out.entry(key).or_default().push((from, None, bot));
    }
    out
}

fn normalize(p: &str) -> &str {
    let t = p.trim_end_matches('/');
    if t.is_empty() && p.starts_with('/') {
        "/"
    } else {
        t
    }
}

fn str_field<'a>(row: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    row.get(key)?.as_str().filter(|s| !s.is_empty())
}

fn owned(row: &Map<String, Value>, key: &str) -> Option<String> {
    str_field(row, key).map(str::to_owned)
}

fn flag(row: &Map<String, Value>, key: &str) -> bool {
    row.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn at(row: &Map<String, Value>) -> Option<i64> {
    str_field(row, "at").and_then(crate::time::parse_rfc3339)
}

fn created(row: &Map<String, Value>) -> Option<i64> {
    row.get("created_ms").and_then(Value::as_i64)
}

/// A start row's evidence, with its tag when the row is complete enough for one. None only for a
/// row with neither a terminal nor a worktree: it cannot claim or bound anything.
fn parse_start(row: &Map<String, Value>) -> Option<StartRow> {
    let terminal = owned(row, "terminal");
    let worktree = owned(row, "worktree").map(|w| normalize(&w).to_owned());
    if terminal.is_none() && worktree.is_none() {
        return None;
    }
    let kind = match str_field(row, "kind") {
        Some("worker") => Some(Kind::Worker),
        Some("seat") => Some(Kind::Seat),
        _ => None,
    };
    Some(StartRow {
        tag: kind.and_then(|k| parse_tag(row, k)),
        terminal,
        core: owned(row, "core"),
        created_ms: created(row),
        at_ms: at(row),
        worktree,
        agent: owned(row, "agent"),
        kind,
        session: owned(row, "session"),
    })
}

fn parse_tag(row: &Map<String, Value>, kind: Kind) -> Option<Tag> {
    str_field(row, "terminal")?;
    let bot = owned(row, "bot").or_else(|| owned(row, "botId"))?;
    // Rows written before `branch` existed carried the branch in `task`.
    let (task, branch) = if row.contains_key("branch") {
        (owned(row, "task"), owned(row, "branch"))
    } else {
        (None, owned(row, "task"))
    };
    let task = if kind == Kind::Seat { None } else { task };
    Some(Tag {
        bot,
        kind,
        role: owned(row, "role"),
        squad: owned(row, "squad"),
        task,
        project: owned(row, "project"),
        branch,
        lead: owned(row, "lead"),
        requested_agent: owned(row, "agent"),
        requested_model: owned(row, "model"),
        requested_effort: owned(row, "effort"),
        swap: flag(row, "swap"),
        override_: flag(row, "override"),
    })
}

fn parse_session(row: &Map<String, Value>) -> Option<SessionRow> {
    Some(SessionRow {
        terminal: owned(row, "terminal")?,
        session: owned(row, "session")?,
        // The briefing hook's rows name no agent: they are Claude's.
        agent: owned(row, "agent").unwrap_or_else(|| "claude".into()),
        core: owned(row, "core"),
        created_ms: created(row),
        at_ms: at(row),
    })
}

fn parse_end(row: &Map<String, Value>) -> Option<EndRow> {
    Some(EndRow {
        key: (owned(row, "core"), owned(row, "terminal")?, created(row)?),
        at_ms: at(row)?,
    })
}

fn parse_attach(row: &Map<String, Value>) -> Option<AttachRow> {
    if row.get("v").and_then(Value::as_i64) != Some(1) {
        return None;
    }
    // Another machine's pane: its usage is in that machine's logs.
    if row.get("machine").is_some_and(|m| !m.is_null()) {
        return None;
    }
    let event = match str_field(row, "event")? {
        "attach" => AttachEvent::Attach,
        "detach" => AttachEvent::Detach,
        "end" => AttachEvent::End,
        _ => return None,
    };
    Some(AttachRow {
        event,
        bot: owned(row, "bot")?,
        key: (
            Some(owned(row, "core")?),
            owned(row, "terminal")?,
            created(row)?,
        ),
        at_ms: at(row)?,
    })
}

/// Counts of one sync's answers, per harness (no ids, no names): what a reader of the meter's
/// own diagnostics may see.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Counts {
    pub by_basis: BTreeMap<&'static str, u64>,
    pub ambiguous: u64,
    pub unlinked: u64,
}

impl Counts {
    pub fn add(&mut self, r: &Resolution) {
        match r {
            Resolution::Tag(_, b) => *self.by_basis.entry(b.as_str()).or_default() += 1,
            Resolution::Ambiguous => self.ambiguous += 1,
            Resolution::Unlinked => self.unlinked += 1,
        }
    }

    pub fn tagged(&self) -> u64 {
        self.by_basis.values().sum()
    }
}

#[cfg(test)]
mod tests;
