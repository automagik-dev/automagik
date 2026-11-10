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
//!   started in the project root, so it is never taken for that worker, and a Claude sub-agent's
//!   start folder is its parent session's. A session whose start folder is unknown is never
//!   named this way. A logged launch hc shows running in a folder other than its recorded
//!   worktree (an agent relaunched by hand in a seat's pane) competes there. Seats are never found this way (their
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
//! **The label claims** (RFC 0026 (c)). A launch the snapshot shows with no start row takes its
//! tag from the terminal's labels: `worker.of` and `worker.role` (a worker role only) make a
//! worker, else `bot` and `role` make a seat. Labels fill only bot, kind and role: `squad` is
//! unrecorded, and `task`, `project` and `branch` are never taken from them. The tag is written on
//! the launch row at sync (`source = snapshot` says the labels supplied it), and the bot intervals
//! the labels named live in the row's `bound` column beside the attach ledger's bindings, each
//! label interval marked with `~` (`~@` when the sync that opened it found the worker in a task
//! worktree); a later sync reads that timeline back and merges into it, never replacing it. A
//! worker's claim runs from the first sync that saw its label to the launch's end:
//! usage before it stays unlinked. A worker's label is set at launch and never rewritten, so a
//! second bot in its timeline makes the claim empty for the whole span (fail-closed, derived from
//! the column); a seat's `bot` may change with a reattach, and its claim follows each interval.
//! A tag a label supplied is reported at [`Basis::Label`], whatever tied the call to the launch
//! (a session row included). The timeline keeps at most [`BOUND_INTERVALS`] intervals; past that
//! the call is Unknown.
//!
//! Whoever can label a terminal chooses those labels, so a label reaches no further than the
//! terminal could. A worker known only by its label names a call by folder only from a task
//! worktree (a linked git worktree, checked when its interval opens, never the main checkout or a
//! folder that is no worktree), only while hc shows it in that folder (a move clears every
//! worktree mark in the timeline, with or without a label at that sync, so the folder claim is
//! void for the whole span and stays void), and never where a seat sits; elsewhere only its own session names
//! it. A launch the attach ledger bound is a seat whatever its labels say. A label's bot is
//! shape-checked (the printed caps, no control character) before it is stored or names anything;
//! one that fails is ignored. An interval never opens or closes before the last sync that saw the
//! launch, so a clock that steps back re-tags nothing.
//!
//! **dsh-tui seats** (RFC 0026 (d)). A dsh-tui session is found by its worker's worktree; a seat's
//! folder is the project root, which names no launch. Two records tie such a session to its
//! terminal, and both give `session` links:
//!
//! - The session's own header may name the terminal it runs in ([`Resolver::witness`]): the pane's
//!   bare local address, with the session's start. Its launch is the one on that address, on this
//!   machine's core, whose span covers that start. The link runs from the start to that launch's
//!   end, or to the session's next link in another launch (a resume). Two launches on the address
//!   that both cover the start name no launch: the session's calls are ambiguous from then on,
//!   never a guess between them, whatever their tags. An address no launch covers ties nothing:
//!   the call is found as before, and when nothing names it, it is unlinked with `no_record`
//!   (a record exists, its launch does not), never `dsh_tui_seat`.
//! - The pane's `agent.session` label, and a `session` row, as for every harness. For dsh-tui the
//!   label is a start-time record of the session like the header's, so its link is a `session`
//!   link too; it stays the second witness, holding over its launch's life: a launch it names
//!   beside the header's, or a row's, with a different tag makes the call ambiguous, while a
//!   launch that began after a header or row link did is a resume and closes that link.
//!
//! The tag is the launch's as everywhere: its start row's, the attach ledger's binding, else the
//! seat's `bot` label, which keeps the answer at `label` basis. A session none of these records
//! names stays `dsh_tui_seat`. The links are kept in the `link` table; a later sync replays them
//! ([`Resolver::add_session_links`]) with no log re-read and no live label.
//!
//! **Fields**, from the launch's start row, frozen at launch: `bot` (`bot`, else `botId`; for a
//! seat, the attach ledger's binding for the launch at the call's time when there is one), `kind`,
//! `role`, `squad`, `task` with `project` (workers only), `branch`, `lead` and what the launch
//! requested (`agent`, `model`, `effort`). A start row or binding always wins: every field the
//! ledger recorded is left alone, and the labels never overwrite it.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::evidence::{History, LaunchRecord, LinkRecord, SessionKey};
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
/// A ledger larger than this is not read (RFC 0021 delivery 5: ledgers are read whole each sync,
/// so their size is bounded).
pub const LEDGER_CAP: u64 = 16 << 20;

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
    /// `bot`, else `botId`; for a seat, the attach ledger's binding when it has one; for a launch
    /// with no start row, the snapshot's labels (RFC 0026 (c)).
    pub bot: String,
    pub kind: Kind,
    /// A worker's role (`dev`, `test`, `review`, `fix`), or a seat's pane role at launch (`main`,
    /// `captain`, a rank). None when the row did not record one.
    pub role: Option<String>,
    /// The head of the launching bot's lead chain, frozen at launch; None for the main bot and
    /// for rows written before RFC 0021.
    pub squad: Option<String>,
    /// The key fields the start row did not record at all (`role`, `squad`): a row written before
    /// RFC 0021 delivery 3. Such a field is None and unknown, never "none".
    pub unrecorded: Vec<&'static str>,
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
    /// The snapshot's labels supplied this tag, not a start row (RFC 0026 (c)): reported at
    /// `label` basis, whatever tied the call to the launch.
    pub label: bool,
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
            && self.unrecorded == o.unrecorded
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
    /// A start-time record names the session: a Herdr row (a start row's `session`, or a
    /// `session` row), or a dsh-tui session's own terminal record (its header, or its pane's
    /// session label; RFC 0026 (d)).
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

/// The roles a worker's `worker.role` label may carry (`workers.js` `ROLES`). Any other value is
/// no role, never a role the query would print as one.
const WORKER_ROLES: [&str; 4] = ["dev", "test", "review", "fix"];

/// The most intervals a launch's `bound` timeline keeps and is still read: past it the launch's
/// calls are Unknown, as they are for a tag past its cap ([`tag_fits`]).
pub const BOUND_INTERVALS: usize = 16;

/// One interval of a launch's bot timeline over `[from, to)` (`to` empty while open): the bot the
/// attach ledger bound its pane to, or the bot a snapshot's labels named (RFC 0026 (c)).
#[derive(Debug, Clone, PartialEq, Eq)]
struct Interval {
    from: i64,
    to: Option<i64>,
    bot: String,
    /// The snapshot's labels named this bot; the attach ledger writes the others.
    label: bool,
    /// A worker's label interval opened while its terminal sat in a task worktree (a linked git
    /// worktree, never the main checkout): only then may the label name calls by that folder.
    /// Checked once, when the interval opens, so a worktree removed later replays the same answer.
    folder: bool,
}

impl Interval {
    fn covers(&self, t: i64) -> bool {
        self.from <= t && self.to.is_none_or(|e| t < e)
    }
}

/// The tag a launch's snapshot labels supply (RFC 0026 (c)): `bot`, `kind` and `role`, never the
/// task, project or branch. Its bot is the first the labels named; a seat's later bots live in the
/// launch's timeline.
#[derive(Debug, Clone, PartialEq, Eq)]
struct LabelTag {
    /// The first bot the labels named; None once a worker's changed label emptied the claim (the
    /// timeline still holds the bots that make it fail-closed).
    bot: Option<String>,
    kind: Kind,
    role: Option<String>,
}

impl LabelTag {
    /// The tag the claim reports. Labels fill only bot, kind and role: squad is unrecorded,
    /// as is a role the label did not carry (or carried past its cap, or not as a worker role).
    /// `label` is false for the seat tag the attach ledger's binding supplies.
    fn tag(&self, bot: &str, label: bool) -> Tag {
        let mut unrecorded = Vec::new();
        if self.role.is_none() {
            unrecorded.push("role");
        }
        unrecorded.push("squad");
        Tag {
            bot: bot.to_owned(),
            kind: self.kind,
            role: self.role.clone(),
            squad: None,
            unrecorded,
            task: None,
            project: None,
            branch: None,
            lead: None,
            requested_agent: None,
            requested_model: None,
            requested_effort: None,
            swap: false,
            override_: false,
            label,
        }
    }
}

/// What an earlier sync persisted of a launch with no start row (RFC 0026 (c)), read back from its
/// `launch` row: the label tag's fields, and the `bound` timeline (label sightings and attach
/// bindings) that sync recorded.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct StoredClaim {
    kind: Option<Kind>,
    bot: Option<String>,
    role: Option<String>,
    /// Every interval the `bound` column holds, label sightings and attach bindings.
    timeline: Vec<Interval>,
    /// The stored timeline was past [`BOUND_INTERVALS`]: its calls are Unknown, never guessed.
    over_cap: bool,
    /// The folder the row recorded the launch in, when its label intervals were written.
    worktree: Option<String>,
    /// The last sync that saw the launch: a label interval never closes or opens before it, so a
    /// sync whose clock stepped back cannot re-tag calls an earlier sync already answered.
    seen_last: Option<i64>,
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
        "agy" | "antigravity" => Some("agy"),
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
    /// Where the row is: a hash of its ledger's path and its byte offset.
    src: Option<String>,
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
    /// `end_row`, or, read back from the store, the basis an earlier sync recorded.
    basis: &'static str,
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
    /// What ended it first: `end_row`, `replaced`, `finished`, `detached` or `gone`.
    end_basis: Option<&'static str>,
    /// Its first start row's place in its ledger.
    src: Option<String>,
    /// The tag the snapshot's labels supply for a launch with no start row (RFC 0026 (c)).
    label: Option<LabelTag>,
    /// The bot timeline the `bound` column keeps: attach bindings and the label sightings earlier
    /// syncs persisted, read back and merged.
    timeline: Vec<Interval>,
    /// The timeline is past [`BOUND_INTERVALS`]: the launch's calls are Unknown.
    over_cap: bool,
    /// A worker's label changed: two bots in its timeline make its claim empty for its whole span.
    fail_closed: bool,
    /// A worker the labels tagged may name calls by its folder: every label interval opened in a
    /// task worktree and still carries its mark (a terminal seen in another folder loses them
    /// all, for good). False for everything else.
    folder: bool,
    /// The label claim this sync's snapshot shows: (kind, bot, role), merged into the timeline.
    sighting: Option<(Kind, String, Option<String>)>,
}

impl Launch {
    fn covers(&self, t: i64) -> bool {
        self.from.is_none_or(|f| f <= t) && self.to.is_none_or(|e| t < e)
    }

    /// Ends it at `at` when that is earlier than what ended it so far.
    fn end(&mut self, at: i64, basis: &'static str) {
        if self.to.is_none_or(|e| at < e) {
            self.to = Some(at);
            self.end_basis = Some(basis);
        }
    }

    /// The `launch` table's key: `(core, terminal, created_ms)`, or the start row's place for a
    /// row written before RFC 0021 (no `created_ms`).
    fn lkey(&self) -> Option<String> {
        match (&self.key, &self.src) {
            (Some((core, t, c)), _) => Some(launch_key(core.as_deref(), t, *c)),
            (None, Some(src)) => Some(format!("row\x1f{src}")),
            _ => None,
        }
    }
}

/// The `launch` table's key of a keyed launch.
pub fn launch_key(core: Option<&str>, terminal: &str, created_ms: i64) -> String {
    format!(
        "key\x1f{}\x1f{terminal}\x1f{created_ms}",
        core.unwrap_or("")
    )
}

/// The end bases the store records, as the resolver names them.
fn end_basis(s: Option<&str>) -> &'static str {
    match s {
        Some("replaced") => "replaced",
        Some("finished") => "finished",
        Some("detached") => "detached",
        Some("gone") => "gone",
        _ => "end_row",
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
    /// A session label a snapshot showed made it: the second witness, which holds over its
    /// launch's life instead of from a row's time. For every harness but dsh-tui this is the
    /// `label` basis; a dsh-tui label gives a `session` link (RFC 0026 (d)).
    sighted: bool,
    /// For a link whose launch is not known here (`launch` None): the end an earlier sync
    /// recorded for it, when it is one the store replayed.
    until: Option<i64>,
    /// A dsh-tui header whose terminal two or more launches cover at the session's start: it
    /// names no launch, so a call it covers is ambiguous, never a guess (RFC 0026 (d)).
    overlap: bool,
}

/// The ledger's agent name of dsh-tui, the one harness whose sessions carry a terminal record.
const DSH_AGENT: &str = "dsh-tui";

/// A dsh-tui session's own start record (RFC 0026 (d)): the terminal its header names (the
/// pane's bare local address) and when the session started.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Header {
    terminal: String,
    /// The header's `createdAt`. None: the record names a terminal, but no launch can be said to
    /// cover a start that is not known.
    at: Option<i64>,
}

/// A dsh-tui session's link as an earlier sync kept it in the `link` table
/// ([`crate::evidence::session_links`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionLink {
    /// The ledger's agent name.
    pub agent: String,
    /// The session's keyed hash, hex.
    pub session: String,
    pub lkey: String,
    pub valid_from: Option<i64>,
    pub valid_to: Option<i64>,
    /// A session label made it ([`crate::evidence::LinkRecord::sighted`]).
    pub sighted: bool,
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
    /// The folder hc shows a logged launch running in, when it is not the worktree its start row
    /// recorded, to the launches there, each with the harness hc shows it running now: an agent
    /// relaunched by hand may not be the one the start row recorded.
    away: HashMap<String, Vec<(usize, &'static str)>>,
    /// agent, then session, to the links that tie it to launches.
    links: HashMap<String, HashMap<String, Vec<Link>>>,
    bindings: Bindings,
    /// (agent, session) that a record of another machine names: a start or session row of
    /// another core, or a session label on a linked machine's pane. Such a session's launch row
    /// is in that computer's ledger, so a call of it that nothing here claims is `other_machine`
    /// (RFC 0021 Decided 6, delivery 2 D5), never given a bot.
    foreign: HashSet<(String, String)>,
    /// The folders a seat sits in: a logged seat's (its start row's folder, and the one hc shows it
    /// running in), a seat the attach ledger bound, a seat the labels named. A worker known only
    /// by its label never names a call by such a folder (RFC 0026 (c), (e)).
    seated: HashSet<String>,
    /// The launches on each terminal address: where a dsh-tui header's terminal is looked up.
    by_terminal: HashMap<String, Vec<usize>>,
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
    /// The panes hc lists on a linked machine (an address with a `/`): never claimants, but a
    /// session label on one says the session ran on another computer.
    linked: Vec<Terminal>,
    rows: Rows,
    files: HashSet<PathBuf>,
    checked: HashSet<PathBuf>,
    refused: Vec<PathBuf>,
    walk: bool,
    index: Option<Index>,
    resolved: u64,
    /// Sessions are hashed with this key as they are read, so the index holds no raw id.
    key: Option<SessionKey>,
    /// Session labels earlier snapshots saw: (agent, session hash, launch key).
    label_history: Vec<(String, String, String)>,
    /// The dsh-tui session links earlier syncs kept (RFC 0026 (d)).
    session_history: Vec<SessionLink>,
    /// dsh-tui sessions whose header names a terminal, by session (hashed as the calls' are).
    /// Kept beside the index, never in it: a header is learned as its log is read, and joining
    /// it to the launches when a call asks costs no rebuild.
    headers: HashMap<String, Header>,
    /// What earlier syncs persisted of launches with no start row, by launch key: the label tag
    /// and the `bound` timeline (RFC 0026 (c)).
    claims: HashMap<String, StoredClaim>,
    /// When this sync reads the snapshot: the first moment a label it saw can claim usage. None
    /// until [`Resolver::at`] is called, so a resolver built without a sync time adds no sighting
    /// to a launch (the persisted ones still apply).
    now: Option<i64>,
    /// Tests: stands in for [`task_worktree`], so a synthetic path needs no folder on disk.
    probe: Option<fn(&str) -> bool>,
    oversized: Vec<PathBuf>,
    homes: Vec<PathBuf>,
    bytes_read: u64,
    /// The walk for project app homes stays inside this folder (tests: their own temp folder).
    walk_stop: Option<PathBuf>,
}

impl Resolver {
    /// `core`: this machine's hc core id, when known (rows of other cores are then skipped).
    /// `snapshot`: the terminals hc listed at this sync; those of a linked machine (an address
    /// with a `/`) are left out.
    pub fn new(core: Option<String>, snapshot: Vec<Terminal>) -> Resolver {
        let (linked, snapshot) = snapshot
            .into_iter()
            .partition(|t: &Terminal| t.terminal.contains('/'));
        Resolver {
            core,
            snapshot,
            linked,
            ..Resolver::default()
        }
    }

    /// Whether project app homes are looked for above each call's cwd.
    pub fn walk(mut self, on: bool) -> Resolver {
        self.walk = on;
        self
    }

    /// When this sync reads hc's snapshot: a label it shows can claim usage from then on, never
    /// earlier (RFC 0026 (c)'s span: "from the first sync that saw the label").
    pub fn at(mut self, now_ms: i64) -> Resolver {
        self.now = Some(now_ms);
        self
    }

    /// Tests: decides which folders are task worktrees instead of reading the disk.
    #[cfg(test)]
    fn probe(mut self, probe: fn(&str) -> bool) -> Resolver {
        self.probe = Some(probe);
        self
    }

    /// Keeps the walk for project app homes inside `stop` (tests: so a temp folder inside a real
    /// project never reads that project's ledgers).
    pub fn walk_within(mut self, stop: Option<PathBuf>) -> Resolver {
        self.walk_stop = stop;
        self
    }

    /// Hashes every session id it reads (ledger rows, the snapshot's labels) with `key`, so the
    /// index holds keyed hashes only, as the evidence does: a call is then resolved by its
    /// session's hash ([`SessionKey::hex`] with [`crate::evidence::scope`]). Call it before any
    /// ledger is added.
    pub fn keyed(mut self, key: SessionKey) -> Resolver {
        for t in self.snapshot.iter_mut().chain(self.linked.iter_mut()) {
            let Some(h) = t.harness else { continue };
            let agent = agent_of(h).unwrap_or(h);
            let s = t.labels.session_for(h).map(|s| key.hex(agent, s));
            t.labels.session = s;
            t.labels.revive_session = None;
            t.labels.revive_agent = None;
        }
        self.key = Some(key);
        self
    }

    /// Adds what earlier syncs recorded (RFC 0021 (b)): the ends they derived, launches the hc
    /// snapshot showed then (unlogged ones, and the folder and harness hc showed a launch in),
    /// session labels they saw, and launches gone since (`gone`: launch key to this sync's time,
    /// for a launch an earlier sync saw live that hc no longer lists).
    pub fn add_history(
        &mut self,
        launches: &[History],
        labels: &[(String, String, String)],
        gone: &HashMap<String, i64>,
    ) {
        for h in launches {
            let key = (h.core.clone(), h.terminal.clone(), h.created_ms);
            if let Some(at) = h.valid_to {
                self.rows.ends.push(EndRow {
                    key: key.clone(),
                    at_ms: at,
                    basis: end_basis(h.end_basis.as_deref()),
                });
            }
            if let Some(&at) = gone.get(&h.lkey) {
                self.rows.ends.push(EndRow {
                    key: key.clone(),
                    at_ms: at,
                    basis: "gone",
                });
            }
            let shown = self
                .snapshot
                .iter()
                .any(|t| t.terminal == h.terminal && t.created_ms == Some(h.created_ms));
            if h.seen_last.is_none() || shown {
                continue;
            }
            // A launch hc showed at an earlier sync: as that sync saw it, its end aside.
            let harness = h.live_agent.as_deref().and_then(crate::hc::harness_of);
            self.snapshot.push(Terminal {
                terminal: h.terminal.clone(),
                created_ms: Some(h.created_ms),
                finished_ms: None,
                harness,
                cwd: h.live_cwd.clone().or_else(|| h.worktree.clone()),
                labels: crate::hc::Labels::default(),
            });
        }
        self.label_history.extend(labels.iter().cloned());
        // What an earlier sync persisted of a launch with no start row: its label tag's fields and
        // its `bound` timeline, so a recompute replays the same answer (RFC 0026 (c)).
        for h in launches {
            let (timeline, over_cap) = match h.bound.as_deref() {
                Some(v) => parse_bound(v),
                None => (Vec::new(), false),
            };
            let kind = match h.kind.as_deref() {
                Some("worker") => Some(Kind::Worker),
                Some("seat") => Some(Kind::Seat),
                _ => None,
            };
            self.claims.insert(
                h.lkey.clone(),
                StoredClaim {
                    kind,
                    bot: h.bot.clone(),
                    role: h.role.clone(),
                    timeline,
                    over_cap,
                    worktree: h.worktree.as_deref().map(|w| normalize(w).to_owned()),
                    seen_last: h.seen_last,
                },
            );
        }
        self.index = None;
    }

    /// Adds the dsh-tui session links earlier syncs kept (RFC 0026 (d)): a session its header, a
    /// `session` row or its pane's label tied to a launch stays tied when a later sync reads no
    /// log and sees no label, so a recompute replays the same answer.
    pub fn add_session_links(&mut self, links: &[SessionLink]) {
        self.session_history.extend(links.iter().cloned());
        self.index = None;
    }

    /// A dsh-tui session's own start record (RFC 0026 (d)): its header names `terminal`, the
    /// address of the pane it runs in, and the session started at `started_ms`. `session` is the
    /// session as calls name it (its keyed hash when the resolver is keyed). An address with a
    /// `/` is another machine's view of a pane and is never used.
    pub fn witness(&mut self, session: &str, terminal: &str, started_ms: Option<i64>) {
        if terminal.is_empty() || terminal.contains('/') {
            return;
        }
        self.headers.insert(
            session.to_owned(),
            Header {
                terminal: terminal.to_owned(),
                at: started_ms,
            },
        );
    }

    /// A fingerprint of the header records known ([`Resolver::witness`]): empty for none, so a
    /// store with no such record fingerprints as it did before they existed.
    pub fn witness_print(&self) -> String {
        if self.headers.is_empty() {
            return String::new();
        }
        let mut all: Vec<(&String, &Header)> = self.headers.iter().collect();
        all.sort_by(|a, b| a.0.cmp(b.0));
        let mut print = <sha2::Sha256 as sha2::Digest>::new();
        for (session, h) in all {
            sha2::Digest::update(
                &mut print,
                format!("{session}\x1f{}\x1f{:?}\x1e", h.terminal, h.at),
            );
        }
        crate::event::hex(&sha2::Digest::finalize(print))
    }

    /// Whether a start-time record names the call's session (or its parent's): a dsh-tui header
    /// with a terminal, a `session` row, a session label, or a link an earlier sync kept. Asked
    /// of a dsh-tui call [`Resolver::resolve`] left unlinked: with such a record the reason is
    /// `no_record` (its launch is missing, ended or names no bot), without one `dsh_tui_seat`.
    pub fn witnessed(&mut self, call: &Call) -> bool {
        let Some(agent) = agent_of(call.harness) else {
            return false;
        };
        self.index();
        let links = self.index.as_ref().and_then(|ix| ix.links.get(agent));
        [call.session, call.parent_session]
            .into_iter()
            .flatten()
            .any(|s| {
                (agent == DSH_AGENT && self.headers.contains_key(s))
                    || links.is_some_and(|m| m.get(s).is_some_and(|l| !l.is_empty()))
            })
    }

    /// Ledgers not read because they are larger than [`LEDGER_CAP`].
    pub fn oversized(&self) -> &[PathBuf] {
        &self.oversized
    }

    /// The project app homes found so far (walked up to, or loaded with
    /// [`Resolver::load_project_home`]).
    pub fn homes(&self) -> &[PathBuf] {
        &self.homes
    }

    /// The ledger bytes read so far.
    pub fn bytes_read(&self) -> u64 {
        self.bytes_read
    }

    /// Every ledger file read so far, sorted.
    pub fn files(&self) -> Vec<PathBuf> {
        let mut v: Vec<PathBuf> = self.files.iter().cloned().collect();
        v.sort();
        v
    }

    /// Reads a project app home an earlier sync found, when it is still there.
    pub fn load_project_home(&mut self, home: &Path) {
        if home.is_dir() {
            if !self.homes.iter().any(|h| h == home) {
                self.homes.push(home.to_path_buf());
            }
            self.load_app_home(home);
        }
    }

    /// The index of launches and links, built once from what has been read, the claims earlier
    /// syncs persisted and this sync's snapshot time.
    fn index(&mut self) -> Option<&Index> {
        if self.index.is_none() {
            self.index = Some(build(
                &self.rows,
                self.core.as_deref(),
                &self.snapshot,
                &self.linked,
                Kept {
                    labels: &self.label_history,
                    sessions: &self.session_history,
                    claims: &self.claims,
                },
                Sighted {
                    now: self.now,
                    probe: self.probe.unwrap_or(task_worktree),
                },
            ));
        }
        self.index.as_ref()
    }

    /// The launches and links this resolver derives, as the `launch` and `link` tables keep them.
    /// Links of a launch no start row records, and of a launch with no key, are left out.
    pub fn records(&mut self) -> (Vec<LaunchRecord>, Vec<LinkRecord>) {
        self.index();
        let Some(ix) = self.index.as_ref() else {
            return (Vec::new(), Vec::new());
        };
        let core = self.core.as_deref();
        let mut launches = Vec::new();
        let keys: Vec<Option<String>> = ix.launches.iter().map(Launch::lkey).collect();
        for (l, lkey) in ix.launches.iter().zip(&keys) {
            let Some(lkey) = lkey else { continue };
            // A worker's changed label empties the claim and writes no tag back: the timeline in
            // `bound` is what keeps it fail-closed across a recompute.
            let tag = l.tags.first().filter(|_| !l.fail_closed);
            launches.push(LaunchRecord {
                lkey: lkey.clone(),
                core: l.core.clone(),
                terminal: l.terminal.clone(),
                created_ms: l.key.as_ref().map(|k| k.2),
                kind: l.kind.map(|k| match k {
                    Kind::Worker => "worker".to_string(),
                    Kind::Seat => "seat".to_string(),
                }),
                bot: tag.map(|t| t.bot.clone()),
                role: tag.and_then(|t| t.role.clone()),
                squad: tag.and_then(|t| t.squad.clone()),
                lead: tag.and_then(|t| t.lead.clone()),
                task: tag.and_then(|t| t.task.clone()),
                project: tag.and_then(|t| t.project.clone()),
                branch: tag.and_then(|t| t.branch.clone()),
                worktree: l.worktree.clone(),
                agent: l.agent.clone(),
                valid_from: l.from,
                valid_to: l.to,
                end_basis: l.end_basis.map(str::to_owned),
                source: if l.logged { "ledger" } else { "snapshot" }.into(),
                source_ref: l.src.clone(),
                bound: render_bound(&l.timeline),
            });
        }
        let mut links = Vec::new();
        let mut keep = |agent: &str, session: &str, ls: &[Link]| {
            for k in ls {
                let Some(Some(lkey)) = k.launch.map(|i| &keys[i]) else {
                    continue;
                };
                links.push(LinkRecord {
                    harness: agent.to_owned(),
                    session: session.to_owned(),
                    lkey: lkey.clone(),
                    basis: k.basis.as_str().into(),
                    valid_from: k.from,
                    valid_to: k.to,
                    sighted: k.sighted,
                });
            }
        };
        for (agent, by) in &ix.links {
            for session in by.keys() {
                let header = self.headers.get(session).filter(|_| agent == DSH_AGENT);
                if let Some(ls) = ix.session_links(agent, session, header, core) {
                    keep(agent, session, &ls);
                }
            }
        }
        // The sessions only their header names.
        let linked = ix.links.get(DSH_AGENT);
        for (session, h) in &self.headers {
            if linked.is_some_and(|m| m.contains_key(session)) {
                continue;
            }
            if let Some(ls) = ix.session_links(DSH_AGENT, session, Some(h), core) {
                keep(DSH_AGENT, session, &ls);
            }
        }
        links.sort_by(|a, b| {
            (&a.harness, &a.session, &a.lkey, &a.basis)
                .cmp(&(&b.harness, &b.session, &b.lkey, &b.basis))
        });
        (launches, one_per_launch(links))
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
            let src = crate::event::hex(
                &sha2::Digest::finalize(<sha2::Sha256 as sha2::Digest>::new_with_prefix(
                    path.to_string_lossy().as_bytes(),
                ))[..8],
            );
            self.add_workers_from(&b, Some(&src));
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
        if meta.len() > LEDGER_CAP {
            self.oversized.push(path.to_path_buf());
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
        let b = std::fs::read(path).ok()?;
        self.bytes_read += b.len() as u64;
        Some(b)
    }

    /// Adds a workers ledger's rows (`start`, `session`, `end`).
    pub fn add_workers(&mut self, bytes: &[u8]) {
        self.add_workers_from(bytes, None);
    }

    /// [`Resolver::add_workers`], recording each start row's place as `<src>:<offset>`.
    fn add_workers_from(&mut self, bytes: &[u8], src: Option<&str>) {
        let mut offset = 0usize;
        for line in bytes.split(|b| *b == b'\n') {
            let at = offset;
            offset += line.len() + 1;
            let Ok(Value::Object(row)) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            let parsed = match str_field(&row, "event") {
                Some("start") => parse_start(&row).map(|mut r| {
                    r.src = src.map(|s| format!("{s}:{at}"));
                    Parsed::Start(r)
                }),
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
            Parsed::Start(mut r) => {
                if let (Some(k), Some(s)) = (&self.key, &r.session) {
                    let agent = r.agent.as_deref().unwrap_or("claude");
                    r.session = Some(k.hex(agent_of(agent).unwrap_or(agent), s));
                }
                self.rows.starts.push(r)
            }
            Parsed::Session(mut r) => {
                if let Some(k) = &self.key {
                    r.session = k.hex(agent_of(&r.agent).unwrap_or(&r.agent), &r.session);
                }
                self.rows.sessions.push(r)
            }
            Parsed::End(r) => self.rows.ends.push(r),
            Parsed::Attach(r) => self.rows.attach.push(r),
        }
        self.index = None;
    }

    /// Looks for project app homes above each folder a stored call ran in or started in, when
    /// walking is on: a project app home made after its usage was read is found by the next sync
    /// even when no new call comes from there. Only those folders' ancestry, never a scan.
    pub fn look_above<'a>(&mut self, cwds: impl IntoIterator<Item = &'a str>) {
        if self.walk {
            for c in cwds {
                self.discover(c);
            }
        }
    }

    /// Looks for project app homes in `cwd` and every folder above it, each folder once.
    fn discover(&mut self, cwd: &str) {
        let p = Path::new(cwd);
        if !p.is_absolute() {
            return;
        }
        for dir in p.ancestors() {
            if self.walk_stop.as_ref().is_some_and(|s| !dir.starts_with(s)) {
                break;
            }
            // Every folder above one already looked at was looked at with it.
            if !self.checked.insert(dir.to_path_buf()) {
                break;
            }
            let home = dir.join(PROJECT_APP_HOME);
            if home.is_dir() {
                if !self.homes.contains(&home) {
                    self.homes.push(home.clone());
                }
                self.load_app_home(&home);
            }
        }
    }

    /// How many calls were resolved: 0 means no project app home was looked for.
    pub fn resolved(&self) -> u64 {
        self.resolved
    }

    pub fn resolve(&mut self, call: &Call) -> Resolution {
        self.resolved += 1;
        if call.copied {
            return Resolution::Unlinked;
        }
        if self.walk {
            for cwd in [call.session_cwd, call.cwd].into_iter().flatten() {
                self.discover(cwd);
            }
        }
        self.index();
        let Some(ix) = self.index.as_ref() else {
            return Resolution::Unlinked;
        };
        ix.resolve(call, &self.headers, self.core.as_deref())
    }

    /// Whether a record of another machine names the call's session (or its parent's): its
    /// launch is that computer's, so the meter here cannot tie it to a bot (RFC 0021 Decided 6).
    /// Asked of a call [`Resolver::resolve`] left unlinked, to say why.
    pub fn elsewhere(&mut self, call: &Call) -> bool {
        let (Some(ix), Some(agent)) = (self.index(), agent_of(call.harness)) else {
            return false;
        };
        [call.session, call.parent_session]
            .into_iter()
            .flatten()
            .any(|s| ix.foreign.contains(&(agent.to_owned(), s.to_owned())))
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
    /// The link a dsh-tui session's header gives (RFC 0026 (d)): to the launch on the address the
    /// header names, on this machine's core, whose span covers the session's start. Two or more
    /// such launches name none ([`Link::overlap`]); no such launch, or a start that is not known,
    /// gives no link at all.
    fn header_link(&self, h: &Header, core: Option<&str>) -> Option<Link> {
        let at = h.at?;
        let on: Vec<usize> = self
            .by_terminal
            .get(&h.terminal)
            .into_iter()
            .flatten()
            .copied()
            .filter(|&i| {
                let l = &self.launches[i];
                on_this_core(l.core.as_deref(), core) && l.covers(at)
            })
            .collect();
        let (launch, overlap) = match on[..] {
            [] => return None,
            [i] => (Some(i), false),
            _ => (None, true),
        };
        Some(Link {
            launch,
            at: Some(at),
            from: None,
            to: None,
            basis: Basis::Session,
            sighted: false,
            until: None,
            overlap,
        })
    }

    /// A session's links, placed: the index's own, and for a dsh-tui session whose header names a
    /// terminal, that record's link among them. None when nothing links the session.
    fn session_links(
        &self,
        agent: &str,
        session: &str,
        header: Option<&Header>,
        core: Option<&str>,
    ) -> Option<std::borrow::Cow<'_, [Link]>> {
        let kept = self.links.get(agent).and_then(|m| m.get(session));
        match (kept, header.and_then(|h| self.header_link(h, core))) {
            (None, None) => None,
            (Some(kept), None) => Some(std::borrow::Cow::Borrowed(kept)),
            (kept, Some(link)) => {
                let mut all = kept.cloned().unwrap_or_default();
                all.push(link);
                place(&mut all, &self.launches, agent == DSH_AGENT);
                Some(std::borrow::Cow::Owned(all))
            }
        }
    }

    fn resolve(
        &self,
        call: &Call,
        headers: &HashMap<String, Header>,
        core: Option<&str>,
    ) -> Resolution {
        let Some(agent) = agent_of(call.harness) else {
            return Resolution::Unlinked;
        };
        let t = call.at_ms;
        for s in [call.session, call.parent_session].into_iter().flatten() {
            let header = headers.get(s).filter(|_| agent == DSH_AGENT);
            let Some(links) = self.session_links(agent, s, header, core) else {
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
                // Two launches on the header's terminal: no launch is named, never one guessed.
                _ if l.overlap => Claim::Unknown,
                (Some(i), Some(_)) => self.claim(i, t),
                (Some(_), None) => Claim::Unknown,
                (None, _) => Claim::Unrecorded,
            });
            return judge(claims, basis);
        }
        // Where the session started; with no start known, no worktree can be said to own it.
        let Some(cwd) = call.session_cwd else {
            return Resolution::Unlinked;
        };
        let cwd = normalize(cwd);
        let on = self.by_worktree.get(cwd).into_iter().flatten();
        // A logged launch hc shows running here, away from the folder its start row recorded (an
        // agent relaunched by hand in a seat's pane): it competes, so the call is ambiguous. The
        // harness is the one hc shows running now, never the start row's: a codex seat relaunched
        // by hand as claude runs claude.
        let away = self
            .away
            .get(cwd)
            .into_iter()
            .flatten()
            .filter_map(|&(i, live)| {
                (self.launches[i].covers(t) && live == agent).then_some(Claim::Unrecorded)
            });
        let claims = on.filter_map(|&i| {
            let l = &self.launches[i];
            if l.agent.as_deref().is_some_and(|a| a != agent) || !l.covers(t) {
                return None;
            }
            // A seat, or a terminal with no start row and no label claim, competes but never
            // names the call by its folder; a worker the snapshot's labels tagged may be this
            // call's (RFC 0026 (c)), from the sync that saw the label on.
            if l.kind != Some(Kind::Worker) || (!l.logged && l.label.is_none()) {
                return Some(Claim::Unrecorded);
            }
            // A worker known only by its label names a call by folder only from a task worktree
            // it never left, and never where a seat sits: the project root, a folder that is no
            // worktree and a seat's folder stay what they were without the label (RFC 0026 (e)).
            // Its own session still names it, through a link.
            if !l.logged && (!l.folder || self.seated.contains(cwd)) {
                return Some(Claim::Unrecorded);
            }
            if l.agent.is_none() {
                return Some(Claim::Unknown);
            }
            Some(self.claim(i, t))
        });
        judge(claims.chain(away), Basis::Worktree)
    }

    /// What launch `i` says about a call at `t`.
    fn claim(&self, i: usize, t: i64) -> Claim {
        let l = &self.launches[i];
        if !l.logged {
            return self.label_claim(l, t);
        }
        if l.over_cap || !l.complete || l.unsure || l.from.is_none() || l.tags.is_empty() {
            return Claim::Unknown;
        }
        let bound = l
            .timeline
            .iter()
            .find(|iv| !iv.label && iv.covers(t))
            .map(|iv| iv.bot.clone());
        // A binding to a bot past the cap cannot be read: the seat's call is Unknown, never the
        // start row's bot or a shortened name.
        if bound.as_deref().is_some_and(|b| !readable(b)) {
            return Claim::Unknown;
        }
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

    /// What a launch with no start row says at `t` (RFC 0026 (c)): the attach ledger's binding
    /// names a seat's bot over its interval; with no binding, the snapshot's labels name the tag
    /// from the first sync that saw them. A tag past its cap, a timeline past [`BOUND_INTERVALS`],
    /// or a worker whose label changed is never a guess: the first two are Unknown, the last
    /// claims nothing.
    fn label_claim(&self, l: &Launch, t: i64) -> Claim {
        if l.from.is_some_and(|f| t < f) || l.to.is_some_and(|e| t >= e) {
            return Claim::Unrecorded;
        }
        if l.over_cap {
            return Claim::Unknown;
        }
        let bindings: Vec<&Interval> = l.timeline.iter().filter(|i| !i.label).collect();
        if !bindings.is_empty() {
            let Some(iv) = bindings.iter().find(|i| i.covers(t)) else {
                return Claim::Unrecorded;
            };
            if !readable(&iv.bot) {
                return Claim::Unknown;
            }
            // The attach ledger's own answer, not a label's: a launch with a binding is a seat,
            // whatever its labels say, so this tag is reached only through a session record.
            let seat = LabelTag {
                bot: None,
                kind: Kind::Seat,
                role: None,
            };
            return Claim::Tags(vec![seat.tag(&iv.bot, false)]);
        }
        let Some(tag) = &l.label else {
            return Claim::Unrecorded;
        };
        if l.fail_closed {
            return Claim::Unrecorded;
        }
        match tag.kind {
            Kind::Worker => {
                // A worker's label runs from the first sync that saw it to the launch's end;
                // usage before that sync stays unlinked (RFC 0026 (c)'s span).
                let Some(from) = l.timeline.iter().filter(|i| i.label).map(|i| i.from).min() else {
                    return Claim::Unrecorded;
                };
                if t < from {
                    return Claim::Unrecorded;
                }
                let Some(bot) = tag.bot.as_deref() else {
                    return Claim::Unrecorded;
                };
                if !fits(bot) {
                    return Claim::Unknown;
                }
                Claim::Tags(vec![tag.tag(bot, true)])
            }
            Kind::Seat => {
                // A seat's tag is used only where a session record ties the call here; its bot
                // follows each interval the labels named, so a reattach moves the later calls.
                let Some(iv) = l
                    .timeline
                    .iter()
                    .filter(|i| i.label && i.covers(t))
                    .max_by_key(|i| i.from)
                else {
                    return Claim::Unrecorded;
                };
                if !fits(&iv.bot) {
                    return Claim::Unknown;
                }
                Claim::Tags(vec![tag.tag(&iv.bot, true)])
            }
        }
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
    // A tag a snapshot's label supplied is reported at `label` basis, whatever tied the call to
    // the launch: the label is the weakest link in the answer (RFC 0026 (c)).
    let label = tags.iter().any(|t| t.label);
    out.label = label;
    Resolution::Tag(out, if label { Basis::Label } else { basis })
}

/// What earlier syncs kept, read back for this sync's index: the session labels they saw (agent,
/// session, launch key), the dsh-tui session links, and each unlogged launch's stored claim.
#[derive(Clone, Copy)]
struct Kept<'a> {
    labels: &'a [(String, String, String)],
    sessions: &'a [SessionLink],
    claims: &'a HashMap<String, StoredClaim>,
}

/// How this sync's label sightings are read: when the snapshot was taken (None: no sighting is
/// added), and what says a folder is a task worktree.
#[derive(Clone, Copy)]
struct Sighted {
    now: Option<i64>,
    probe: fn(&str) -> bool,
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

/// Whether a launch that recorded `launch` as its core ran on this machine (`core`), for a join
/// by terminal address alone (a dsh-tui header's): its core is this one, or it recorded none (a
/// row written before RFC 0021). With this machine's core unknown, a launch that names a core
/// may be another machine's at the same address, so it is never matched.
fn on_this_core(launch: Option<&str>, core: Option<&str>) -> bool {
    match (launch, core) {
        (Some(l), Some(c)) => l == c,
        (Some(_), None) => false,
        (None, _) => true,
    }
}

fn build(
    rows: &Rows,
    core: Option<&str>,
    snapshot: &[Terminal],
    linked: &[Terminal],
    kept: Kept<'_>,
    sighted: Sighted,
) -> Index {
    let Sighted { now, probe } = sighted;
    let Kept {
        labels: label_history,
        sessions: session_history,
        claims,
    } = kept;
    let foreign = |c: &Option<String>| !same_core(c.as_deref(), core);
    let mut ix = Index::default();
    // Sessions another machine's records name: never claimants here, only the reason why not.
    for s in rows.starts.iter().filter(|s| foreign(&s.core)) {
        if let Some(session) = &s.session {
            let agent = s.agent.as_deref().unwrap_or("claude");
            let agent = agent_of(agent).unwrap_or(agent);
            ix.foreign.insert((agent.to_owned(), session.clone()));
        }
    }
    for r in rows.sessions.iter().filter(|r| foreign(&r.core)) {
        let agent = agent_of(&r.agent).unwrap_or(&r.agent);
        ix.foreign.insert((agent.to_owned(), r.session.clone()));
    }
    for t in linked {
        let Some(h) = t.harness else { continue };
        if let (Some(s), Some(agent)) = (t.labels.session_for(h), agent_of(h)) {
            ix.foreign.insert((agent.to_owned(), s.to_owned()));
        }
    }
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
            end_basis: None,
            src: group.iter().find_map(|s| s.src.clone()),
            label: None,
            timeline: Vec::new(),
            over_cap: false,
            fail_closed: false,
            folder: false,
            sighting: None,
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
            end_basis: t.finished_ms.map(|_| "finished"),
            src: None,
            label: None,
            timeline: Vec::new(),
            over_cap: false,
            fail_closed: false,
            folder: false,
            sighting: label_sighting(t),
        });
    }
    // Ends: end rows, and the attach ledger's end and detach rows.
    let end_at = |key: &Key, at: i64, basis: &'static str, launches: &mut Vec<Launch>| {
        if let Some(i) = find(&by_tc, launches, key.0.as_deref(), &key.1, key.2) {
            launches[i].end(at, basis);
        }
    };
    for e in &rows.ends {
        if !foreign(&e.key.0) {
            end_at(&e.key, e.at_ms, e.basis, &mut ix.launches);
        }
    }
    for a in &rows.attach {
        if !foreign(&a.key.0) && matches!(a.event, AttachEvent::Detach | AttachEvent::End) {
            end_at(&a.key, a.at_ms, "detached", &mut ix.launches);
        }
    }
    // The snapshot: a terminal that finished ends its launch (a newer terminal at its address
    // ends it too, below, whatever that terminal runs).
    for t in snapshot {
        let (Some(created), Some(done)) = (t.created_ms, t.finished_ms) else {
            continue;
        };
        if let Some(i) = find(&by_tc, &ix.launches, core, &t.terminal, created) {
            ix.launches[i].end(done, "finished");
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
            l.end(n, "replaced");
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
                l.end(created, "replaced");
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
    for t in snapshot {
        let (Some(created), Some(cwd), true) = (t.created_ms, t.cwd.as_deref(), t.live()) else {
            continue;
        };
        let Some(live) = t.harness.and_then(agent_of) else {
            continue;
        };
        if let Some(i) = find(&by_tc, &ix.launches, core, &t.terminal, created) {
            let l = &ix.launches[i];
            if l.logged && l.worktree.as_deref() != Some(normalize(cwd)) {
                ix.away
                    .entry(normalize(cwd).to_owned())
                    .or_default()
                    .push((i, live));
            }
        }
    }
    ix.bindings = fold_attach(rows.attach.iter().filter(|a| !foreign(&a.key.0)));
    // The bot timeline each launch's `bound` column keeps: the attach ledger's bindings, and for a
    // launch with no start row the label sightings earlier syncs persisted, read back and merged
    // (RFC 0026 (c)). A start row outranks both: its tags stand, and only its bindings show.
    for l in &mut ix.launches {
        let bound = l.key.as_ref().and_then(|k| ix.bindings.get(k));
        l.timeline = capped(bound.map(|b| intervals(b)).unwrap_or_default());
        l.over_cap = l.timeline.len() > BOUND_INTERVALS;
    }
    for l in &mut ix.launches {
        if l.logged {
            continue;
        }
        let Some(lkey) = l.lkey() else { continue };
        let stored = claims.get(&lkey);
        // A stored timeline past the cap cannot be read: keep it as it was, so the launch's calls
        // stay Unknown and a recompute keeps that answer.
        if stored.is_some_and(|s| s.over_cap) {
            l.over_cap = true;
            if let Some(s) = stored {
                l.timeline = s.timeline.clone();
                l.label = s.kind.map(|kind| LabelTag {
                    bot: s.bot.clone(),
                    kind,
                    role: s.role.clone(),
                });
            }
            l.fail_closed = l
                .label
                .as_ref()
                .is_some_and(|t| t.kind == Kind::Worker && distinct_label_bots(&l.timeline) > 1);
            continue;
        }
        // The attach ledger is the authority for the panes it binds; when it names none (an
        // app home not read on this machine), the bindings an earlier sync persisted stand.
        if l.timeline.is_empty() {
            l.timeline = stored
                .map(|s| s.timeline.iter().filter(|i| !i.label).cloned().collect())
                .unwrap_or_default();
        }
        let mut labels: Vec<Interval> = stored
            .map(|s| s.timeline.iter().filter(|i| i.label).cloned().collect())
            .unwrap_or_default();
        // The terminal is no longer in the folder its label intervals were written in: whatever
        // it claimed by folder there is void, for its whole span. The timeline itself records it
        // (every worktree mark is cleared, and none is given again), whether or not this sync
        // sees a label: the row's folder is rewritten to the new one below, so a later sync
        // could not tell the launch had ever moved.
        let moved = !labels.is_empty() && stored.is_some_and(|s| s.worktree != l.worktree);
        if moved {
            for i in &mut labels {
                i.folder = false;
            }
        }
        // An attach binding always wins: the launch is a seat, its kind the binding's and never
        // the labels', so a `worker.of` added to a bound seat makes no worker of it and its
        // project-root folder names nothing. The label intervals an earlier sync wrote are kept
        // as they were read; no label is merged in and no label tag is derived.
        if !l.timeline.is_empty() {
            l.kind = Some(Kind::Seat);
            labels.append(&mut l.timeline);
            l.timeline = capped(labels);
            l.over_cap = l.timeline.len() > BOUND_INTERVALS;
            continue;
        }
        let mut label = stored.and_then(|s| {
            s.kind.map(|kind| LabelTag {
                bot: s.bot.clone(),
                kind,
                role: s.role.clone(),
            })
        });
        if let (Some((kind, bot, role)), Some(at)) = (&l.sighting, now) {
            // Never before the last sync that saw the launch: a clock that stepped back must not
            // move a label's start, or a seat's split, over calls already answered.
            let at = at.max(stored.and_then(|s| s.seen_last).unwrap_or(at));
            let worktree = l.worktree.as_deref();
            let in_worktree = || *kind == Kind::Worker && worktree.is_some_and(probe);
            see_label(&mut labels, at, bot, in_worktree);
            // A row whose worker label changed has no tag to seed from: the fresh sighting only
            // restores the claim's shape, and the timeline (two bots) keeps it fail-closed.
            if label.is_none() {
                label = Some(LabelTag {
                    bot: Some(bot.clone()),
                    kind: *kind,
                    role: role.clone(),
                });
            }
        }
        l.timeline = capped(labels);
        l.over_cap = l.timeline.len() > BOUND_INTERVALS;
        l.fail_closed = label
            .as_ref()
            .is_some_and(|t| t.kind == Kind::Worker && distinct_label_bots(&l.timeline) > 1);
        if let Some(t) = &label {
            l.kind = Some(t.kind);
            l.folder = t.kind == Kind::Worker
                && !l.timeline.is_empty()
                && l.timeline.iter().all(|i| i.folder);
            // A worker's changed label makes the claim empty for its whole span: no tag is
            // written back, only the timeline that derives the fail-closed state.
            if !l.fail_closed
                && let Some(bot) = t.bot.as_deref()
            {
                l.tags = vec![t.tag(bot, true)];
            }
        }
        l.label = label;
    }
    for l in &ix.launches {
        if let (Some(Kind::Seat), Some(w)) = (l.kind, &l.worktree) {
            ix.seated.insert(normalize(w).to_owned());
        }
    }
    for (cwd, there) in &ix.away {
        if there
            .iter()
            .any(|&(i, _)| ix.launches[i].kind == Some(Kind::Seat))
        {
            ix.seated.insert(cwd.clone());
        }
    }
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
                    sighted: false,
                    until: None,
                    overlap: false,
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
                    sighted: false,
                    until: None,
                    overlap: false,
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
                basis: label_basis(agent),
                sighted: true,
                until: None,
                overlap: false,
            });
    }
    // Session labels earlier syncs saw: the same second witness, for launches since gone.
    let by_lkey: HashMap<String, usize> = ix
        .launches
        .iter()
        .enumerate()
        .filter_map(|(i, l)| Some((l.lkey()?, i)))
        .collect();
    for (agent, session, lkey) in label_history {
        let Some(&i) = by_lkey.get(lkey) else {
            continue;
        };
        let links = raw.entry((agent.clone(), session.clone())).or_default();
        if links.iter().any(|l| l.sighted && l.launch == Some(i)) {
            continue;
        }
        links.push(Link {
            launch: Some(i),
            at: ix.launches[i].from,
            from: None,
            to: None,
            basis: label_basis(agent),
            sighted: true,
            until: None,
            overlap: false,
        });
    }
    // The dsh-tui session links earlier syncs kept (RFC 0026 (d)): the header's, a row's and a
    // label's, for a sync that reads no log and sees no label. One whose launch is not known here
    // (its ledger is not read now) still stands for the span the store recorded: it names no
    // bot, and it is never dropped for the folder to name another.
    for s in session_history {
        let launch = by_lkey.get(&s.lkey).copied();
        let links = raw.entry((s.agent.clone(), s.session.clone())).or_default();
        let link = match launch {
            Some(i) if s.sighted => {
                if links.iter().any(|l| l.sighted && l.launch == Some(i)) {
                    continue;
                }
                Link {
                    launch: Some(i),
                    at: ix.launches[i].from,
                    from: None,
                    to: None,
                    basis: Basis::Session,
                    sighted: true,
                    until: None,
                    overlap: false,
                }
            }
            _ => {
                // The ledger, read again, gave this very link: once is enough.
                if launch.is_some()
                    && links
                        .iter()
                        .any(|l| !l.sighted && l.launch == launch && l.at == s.valid_from)
                {
                    continue;
                }
                Link {
                    launch,
                    at: s.valid_from,
                    from: None,
                    to: None,
                    basis: Basis::Session,
                    sighted: false,
                    until: s.valid_to,
                    overlap: false,
                }
            }
        };
        links.push(link);
    }
    for ((agent, session), mut links) in raw {
        place(&mut links, &ix.launches, agent == DSH_AGENT);
        ix.links.entry(agent).or_default().insert(session, links);
    }
    ix.by_terminal = by_terminal;
    ix
}

/// The basis of a link a session label made: `label`, and for dsh-tui `session`, whose label is
/// a start-time record of the session like its header's (RFC 0026 (d)).
fn label_basis(agent: &str) -> Basis {
    if agent == DSH_AGENT {
        Basis::Session
    } else {
        Basis::Label
    }
}

/// One record per session, launch and basis, as the `link` table keys them. A dsh-tui session
/// can be tied to one launch by several records at once (its header, a row, its pane's label);
/// they are one link there: the rows' and header's span when there is one (it starts when the
/// session entered the launch), else the label's.
fn one_per_launch(links: Vec<LinkRecord>) -> Vec<LinkRecord> {
    let mut out: Vec<LinkRecord> = Vec::with_capacity(links.len());
    for l in links {
        let same = |o: &LinkRecord| {
            o.harness == DSH_AGENT
                && o.harness == l.harness
                && o.session == l.session
                && o.lkey == l.lkey
                && o.basis == l.basis
        };
        let Some(kept) = out
            .iter_mut()
            .rev()
            .take_while(|o| o.harness == l.harness)
            .find(|o| same(o))
        else {
            out.push(l);
            continue;
        };
        match (kept.sighted, l.sighted) {
            (true, false) => *kept = l,
            (false, true) => {}
            _ => {
                kept.valid_from = match (kept.valid_from, l.valid_from) {
                    (Some(a), Some(b)) => Some(a.min(b)),
                    _ => None,
                };
                kept.valid_to = match (kept.valid_to, l.valid_to) {
                    (Some(a), Some(b)) => Some(a.max(b)),
                    _ => None,
                };
            }
        }
    }
    out
}

/// Sets each link's interval. A ledger link (a row's, a dsh-tui header's, or one of those the
/// store replayed) holds from its record's time (a start row's: its launch's start), never before
/// its launch began, until its launch ends or the session's next ledger link elsewhere begins. A
/// label link holds over its launch's life: it is a second witness, never closed by the ledger,
/// so where the two disagree the call is ambiguous.
///
/// `resumes` (dsh-tui, RFC 0026 (d)): a label link on a launch that began after a ledger link did
/// is the session resumed there, and closes that ledger link; one on a launch that was already
/// running is a second witness of the same span and closes nothing.
fn place(links: &mut [Link], launches: &[Launch], resumes: bool) {
    let launch_from = |l: &Link| l.launch.and_then(|i| launches[i].from);
    links.sort_by_key(|l| (l.sighted, l.at.or_else(|| launch_from(l)), l.launch));
    let ledger = links.iter().filter(|l| !l.sighted).count();
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
            let end = match l.launch {
                Some(j) => launches[j].to,
                None => l.until,
            };
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
    for l in label_links.iter_mut() {
        if let Some(j) = l.launch {
            l.from = launches[j].from;
            l.to = launches[j].to;
        }
    }
    if !resumes {
        return;
    }
    for l in ledger_links.iter_mut() {
        let Some(from) = l.from else { continue };
        let resumed = label_links
            .iter()
            .filter(|s| s.launch != l.launch)
            .filter_map(|s| s.from)
            .filter(|at| *at > from)
            .min();
        if let Some(at) = resumed {
            l.to = Some(l.to.map_or(at, |e| e.min(at)));
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

/// A path compared as a string: no `.` or `..` resolution, no opening, only a trailing slash
/// removed, as the resolver and the query compare them.
pub(crate) fn normalize(p: &str) -> &str {
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
        src: None,
    })
}

/// The intervals a launch's `bound` column holds, as the attach ledger's fold gives them. A bot
/// the column cannot hold (one with a separator in it) keeps its interval and loses its name: an
/// empty bot is a binding that cannot be read, so a call it covers is Unknown, never the bot
/// bound before it and never a mangled one.
fn intervals(b: &[(i64, Option<i64>, String)]) -> Vec<Interval> {
    b.iter()
        .map(|(from, to, bot)| Interval {
            from: *from,
            to: *to,
            bot: if column_safe(bot) {
                bot.clone()
            } else {
                String::new()
            },
            label: false,
            folder: false,
        })
        .collect()
}

/// The label claim a snapshot terminal shows, when its labels carry one (RFC 0026 (c)): a
/// worker's `worker.of` and `worker.role` (a role only when it is one of [`WORKER_ROLES`]), else a
/// seat's `bot` and `role`. A bot that fails [`label_safe`] is ignored: the terminal then carries
/// no claim at all, and nothing of it is stored. A role that fails it is no role.
fn label_sighting(t: &Terminal) -> Option<(Kind, String, Option<String>)> {
    if let Some(bot) = &t.labels.worker_of {
        if !label_safe(bot) {
            return None;
        }
        let role = t
            .labels
            .worker_role
            .clone()
            .filter(|r| WORKER_ROLES.contains(&r.as_str()));
        return Some((Kind::Worker, bot.clone(), role));
    }
    let bot = t.labels.bot.as_ref()?;
    if !label_safe(bot) {
        return None;
    }
    let role = t
        .labels
        .role
        .clone()
        .filter(|r| fits(r) && !r.chars().any(char::is_control));
    Some((Kind::Seat, bot.clone(), role))
}

/// Whether a bot can be written in the `bound` timeline, whose intervals are `;`-separated and
/// `:`-split: a bot holding one would read back as another interval. Such a label names no bot,
/// rather than a mangled one.
pub(crate) fn column_safe(bot: &str) -> bool {
    !bot.contains([';', ':', '\n', '\r'])
}

/// The shape a label's bot must have to be stored or to name a call: writable in the
/// `bound` timeline, within the printed caps ([`tag_fits`]) and free of control characters. Anyone
/// who can label a terminal chooses this text, so one that fails is dropped, never stored or cut.
fn label_safe(s: &str) -> bool {
    column_safe(s) && fits(s) && !s.chars().any(char::is_control)
}

/// Whether `cwd` is the root of a task worktree: a linked git worktree, whose `.git` is a file
/// naming a folder under the repository's `worktrees/`. The main checkout (the project root, whose
/// `.git` is a folder), a submodule and a folder that is no worktree root are not. Read-only: one
/// small file, never followed through a link.
fn task_worktree(cwd: &str) -> bool {
    let dot = Path::new(cwd).join(".git");
    if !dot.is_absolute() {
        return false;
    }
    match std::fs::symlink_metadata(&dot) {
        Ok(m) if m.is_file() && m.len() <= 4096 => {}
        _ => return false,
    }
    let Ok(text) = std::fs::read_to_string(&dot) else {
        return false;
    };
    let Some(gitdir) = text.lines().next().and_then(|l| l.strip_prefix("gitdir:")) else {
        return false;
    };
    Path::new(gitdir.trim())
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|n| n == "worktrees")
}

/// Merges one sync's label sighting into the label intervals: the same bot keeps the interval from
/// the first sync that saw it; a different bot closes the interval before this sync and opens the
/// next (a seat's reattach moves the later calls). A worker's second bot is kept too: the timeline
/// is its fail-closed state, two bots and no claim. An interval never closes, and the next never
/// opens, before the open one began: a sync whose clock stepped back changes no earlier answer.
///
/// `in_worktree` is asked only when an interval opens, and its answer is kept with the interval
/// ([`Interval::folder`]).
fn see_label(timeline: &mut Vec<Interval>, at: i64, bot: &str, in_worktree: impl FnOnce() -> bool) {
    // The open interval wins a tie on `from` (one closed as it opened, by a clamped clock).
    let last = timeline
        .iter_mut()
        .filter(|i| i.label)
        .max_by_key(|i| (i.from, i.to.is_none()));
    let mut at = at;
    if let Some(iv) = last {
        if iv.bot == bot {
            return;
        }
        at = at.max(iv.from);
        if iv.to.is_none() {
            iv.to = Some(at);
        }
    }
    timeline.push(Interval {
        from: at,
        to: None,
        bot: bot.to_owned(),
        label: true,
        folder: in_worktree(),
    });
}

/// The bots a worker's label timeline names.
fn distinct_label_bots(timeline: &[Interval]) -> usize {
    let mut bots: Vec<&str> = timeline
        .iter()
        .filter(|i| i.label)
        .map(|i| i.bot.as_str())
        .collect();
    bots.sort_unstable();
    bots.dedup();
    bots.len()
}

/// The timeline as the `bound` column keeps it: canonical order, one interval per span and bot, and
/// at most [`BOUND_INTERVALS`] + 1 intervals, so a timeline past the cap still reads as such
/// instead of looking like a short one.
fn capped(mut timeline: Vec<Interval>) -> Vec<Interval> {
    timeline.sort_by(|a, b| {
        (a.from, a.to, &a.bot, a.label, a.folder).cmp(&(b.from, b.to, &b.bot, b.label, b.folder))
    });
    timeline.dedup();
    timeline.truncate(BOUND_INTERVALS + 1);
    timeline
}

/// The `bound` column's value: intervals joined by `;`, each `[~[@]]from-[to]:bot` (an empty `to`
/// while open), `~` marking the interval a label named and `~@` one that opened in a task
/// worktree. The attach ledger's intervals keep the shape the column always had. None for no
/// intervals.
fn render_bound(timeline: &[Interval]) -> Option<String> {
    if timeline.is_empty() {
        return None;
    }
    Some(
        timeline
            .iter()
            .map(|i| {
                format!(
                    "{}{}-{}:{}",
                    match (i.label, i.folder) {
                        (true, true) => "~@",
                        (true, false) => "~",
                        (false, _) => "",
                    },
                    i.from,
                    i.to.map_or(String::new(), |t| t.to_string()),
                    i.bot
                )
            })
            .collect::<Vec<_>>()
            .join(";"),
    )
}

/// Reads a `bound` column's intervals, and whether it was past [`BOUND_INTERVALS`]. A value the
/// format cannot read is treated as no timeline: it names no bot, never a guessed one.
fn parse_bound(v: &str) -> (Vec<Interval>, bool) {
    let mut out = Vec::new();
    for part in v.split(';').filter(|p| !p.is_empty()) {
        let (label, folder, rest) = match (part.strip_prefix("~@"), part.strip_prefix('~')) {
            (Some(r), _) => (true, true, r),
            (None, Some(r)) => (true, false, r),
            (None, None) => (false, false, part),
        };
        let Some((range, bot)) = rest.split_once(':') else {
            return (Vec::new(), false);
        };
        let Some((from, to)) = range.rsplit_once('-') else {
            return (Vec::new(), false);
        };
        let Ok(from) = from.parse::<i64>() else {
            return (Vec::new(), false);
        };
        let to = if to.is_empty() {
            None
        } else {
            match to.parse::<i64>() {
                Ok(t) => Some(t),
                Err(_) => return (Vec::new(), false),
            }
        };
        out.push(Interval {
            from,
            to,
            bot: bot.to_owned(),
            label,
            folder,
        });
    }
    let over = out.len() > BOUND_INTERVALS;
    (out, over)
}

/// The most characters a bot, role or squad may have: the query contract prints each, capped at
/// 64 (`envelope.schema.json`), and RFC 0018 bounds every printed string.
pub const TAG_CHARS: usize = 64;
/// The most bytes one takes as JSON, its escapes included (quotes aside): a control character
/// takes 6 and a `"` 2, so the cap in characters alone could push a bot row past its 2,304-byte
/// bound (RFC 0018). Three of them at this cap keep the worst bot row within it.
pub const TAG_JSON_BYTES: usize = 96;

/// Whether a bot, role or squad is printable: within both caps. One past them is never cut short
/// (that could make two bots one): the caller treats it as unread or unrecorded.
pub fn tag_fits(s: &str) -> bool {
    s.chars().count() <= TAG_CHARS
        && serde_json::to_string(s).is_ok_and(|j| j.len() - 2 <= TAG_JSON_BYTES)
}

fn fits(s: &str) -> bool {
    tag_fits(s)
}

/// Whether a binding's bot can be read: named (an empty one stands for a bot the `bound` column
/// could not hold) and within the printed caps.
fn readable(bot: &str) -> bool {
    !bot.is_empty() && fits(bot)
}

fn parse_tag(row: &Map<String, Value>, kind: Kind) -> Option<Tag> {
    str_field(row, "terminal")?;
    let bot = owned(row, "bot").or_else(|| owned(row, "botId"))?;
    // A bot past the cap is a record that cannot be read: the launch then claims its calls as
    // Unknown (ambiguous), never under a shortened name another bot could share.
    if !fits(&bot) {
        return None;
    }
    // Rows written before `branch` existed carried the branch in `task`.
    let (task, branch) = if row.contains_key("branch") {
        (owned(row, "task"), owned(row, "branch"))
    } else {
        (None, owned(row, "task"))
    };
    let task = if kind == Kind::Seat { None } else { task };
    // A role or squad past the cap is unrecorded: null and unknown, never cut short.
    let long = |k: &str| str_field(row, k).is_some_and(|v| !fits(v));
    let unrecorded = ["role", "squad"]
        .into_iter()
        .filter(|k| !row.contains_key(*k) || long(k))
        .collect();
    let field = |k: &str| owned(row, k).filter(|v| fits(v));
    Some(Tag {
        bot,
        kind,
        role: field("role"),
        squad: field("squad"),
        unrecorded,
        task,
        project: owned(row, "project"),
        branch,
        lead: owned(row, "lead"),
        requested_agent: owned(row, "agent"),
        requested_model: owned(row, "model"),
        requested_effort: owned(row, "effort"),
        swap: flag(row, "swap"),
        override_: flag(row, "override"),
        label: false,
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
        basis: "end_row",
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
    // A bot the `bound` column cannot hold still binds: the row stays in the fold, where it ends
    // the binding before it, and its own interval names no bot ([`intervals`]).
    let bot = owned(row, "bot")?;
    Some(AttachRow {
        event,
        bot,
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
