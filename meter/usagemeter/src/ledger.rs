//! Read-only tagging from Herdr's worker ledger: which worker, bot and task a session belongs to.
//!
//! Herdr appends one JSON row per event to `workers.jsonl` (`$HERDR_WORKERS_LEDGER`, else
//! `<app home>/automagik-herdr/workers.jsonl`, where the app home is `$HERDR_APP_HOME`, else
//! `~/.config/herdr-app`, the way Herdr resolves it). Two events matter here:
//!
//! - `start`: a worker or seat was launched in a terminal, on a worktree, for a bot.
//! - `session`: a Claude pane in a terminal opened a session id (Claude panes only).
//!
//! The ledger is never written and never required: a missing or unreadable file means no tags,
//! malformed lines are skipped, unknown fields are ignored and any field may be missing in older
//! rows (a field of the wrong type counts as missing).
//!
//! Resolution never guesses. Whenever more than one start row could claim a session the answer is
//! [`Resolution::Unmatched`].
//!
//! The ledger has no end rows, so a launch is only known to be over once another start row names
//! the same terminal: a terminal runs one launch at a time, so the later start replaced it. A
//! launch with no later start on its terminal may still be running, whatever else started since.
//!
//! - Claude sessions resolve through their `session` row to the terminal, then to the launch that
//!   occupied that terminal when the row was written: the latest start on it whose `at` is not
//!   after the row's `at`. A start on that terminal between the row and the query time means the
//!   launch was replaced after it reported the id, so the answer is Unmatched.
//! - Codex and omp sessions resolve by `cwd == worktree`. Every start on the worktree that had
//!   begun by the query time, was not yet replaced on its terminal, and ran the same agent (or an
//!   unrecorded one) is a claimant. A concurrent reviewer, or a second seat in the project folder,
//!   is therefore a second claimant, and the session stays Unmatched.
//!
//! A start row too incomplete to build a [`Tag`] (no `bot`/`botId`, an unknown `kind`, no
//! `terminal`) is still evidence: its terminal and `at` end the launch before it on that terminal,
//! and its terminal and agent still count as a possible claimant. A session it could claim is
//! [`Resolution::Unmatched`], never the tag of an earlier worker. A start row without a usable
//! `at` cannot be placed in time, so it keeps every answer it could change Unmatched.
//!
//! A Claude session id can be reported by more than one terminal: `/resume` in a new pane keeps
//! the id. The session then belongs to the terminal whose `session` row has the latest `at` not
//! after the query time; rows without a usable `at` are not candidates, and when no row is a
//! candidate (or two terminals tie on the latest `at`) the answer is [`Resolution::Unmatched`].
//!
//! The agent, model and effort on a start row are what the launch REQUESTED, not what ran: workers
//! on the default model or on a template have them null, and a swap can change the model later.
//! The [`Tag`] carries them as `requested_*`; the real model comes from the session transcript.
//!
//! Tasks are joined by [`TaskKey`] (project, task), never by the task id alone: two projects can
//! both have a `gh-45`. Seats have no task.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::sources::Source;

pub const LEDGER_ENV: &str = "HERDR_WORKERS_LEDGER";
/// Herdr's app home. Its writers put the ledger under it.
pub const APP_HOME_ENV: &str = "HERDR_APP_HOME";
/// The app home when `HERDR_APP_HOME` is unset, relative to the user's home.
const DEFAULT_APP_HOME: &str = ".config/herdr-app";
/// The ledger, relative to the app home.
const LEDGER_RELATIVE: &str = "automagik-herdr/workers.jsonl";

/// What launched the terminal: a worker on a task, or a long-lived seat (never a task).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    Worker,
    Seat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Dev,
    Test,
    Review,
    Fix,
}

impl Role {
    fn parse(s: &str) -> Option<Role> {
        match s {
            "dev" => Some(Role::Dev),
            "test" => Some(Role::Test),
            "review" => Some(Role::Review),
            "fix" => Some(Role::Fix),
            _ => None,
        }
    }
}

/// The join key for a task: the same short id in two projects is two tasks.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TaskKey {
    pub project: String,
    pub task: String,
}

/// The worker a session belongs to, as its start row recorded it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Tag {
    /// `bot`, else `botId`.
    pub bot: String,
    pub kind: Kind,
    /// Short task id such as `gh-45`. Always None for seats, and for old rows whose `task` field
    /// held the branch.
    pub task: Option<String>,
    /// Absolute path of the main checkout. Missing in older rows.
    pub project: Option<String>,
    pub branch: Option<String>,
    pub role: Option<Role>,
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    Tag(Tag),
    /// No start row claims the session.
    Untagged,
    /// More than one start row could claim it, the only one could not be confirmed, or a row
    /// without a usable time could change the answer.
    Unmatched,
}

/// The session to resolve.
#[derive(Debug, Clone, Copy)]
pub struct Query<'a> {
    pub agent: Source,
    pub session_id: &'a str,
    pub cwd: Option<&'a str>,
    /// The time of the usage being attributed: the timestamp of one call (one transcript or log
    /// event) of the session, in milliseconds since the Unix epoch, UTC. It is compared with the
    /// ledger's `at` values, which Herdr writes with millisecond precision.
    ///
    /// Bounds, all against the same `at_ms`:
    /// - a start row can claim the session from its own `at` on, inclusive (`at <= at_ms`);
    /// - a later start on the same terminal ends that claim at its `at`, exclusive
    ///   (`at_ms < end`), so a launch and its replacement never both own one instant;
    /// - a Claude `session` row counts from its own `at` on, inclusive.
    ///
    /// Any instant at which the session was running gives an answer that is never wrong, because
    /// the owner had started and was not yet replaced at that instant. A later instant can only
    /// add claimants, so the same session may be a Tag for its first call and Unmatched for a call
    /// after a concurrent worker started; a caller tagging a whole Codex or omp session at once may
    /// pass its first call's time. Claude calls should pass their own time: a `/resume` moves
    /// the session id to another terminal from that point on. Rows without a usable time cannot be
    /// placed against `at_ms`, so they never lose to a timed row: they make it Unmatched.
    pub at_ms: i64,
}

/// One `start` row. The boundary and claimant evidence (terminal, worktree, agent, at) is kept
/// even when the row is too incomplete to build a [`Tag`].
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Start {
    terminal: Option<String>,
    worktree: Option<String>,
    agent: Option<String>,
    at_ms: Option<i64>,
    tag: Option<Tag>,
}

/// What other start rows on the same terminal say about a start's end. Derived once after parsing.
#[derive(Debug, Clone, Copy, Default)]
struct Life {
    /// The `at` of the first strictly later start on the same terminal: the launch was replaced
    /// then. None while no later start names the terminal (or the start itself has no time).
    replaced_at: Option<i64>,
    /// Another start on the same terminal has no usable time: it may have replaced this one at
    /// any moment, so this start can never be confirmed as an owner.
    untimed_neighbour: bool,
}

#[derive(Debug, Default)]
pub struct Ledger {
    starts: Vec<Start>,
    /// Parallel to `starts`.
    lives: Vec<Life>,
    /// Normalized worktree to the indexes of the starts on it.
    by_worktree: HashMap<String, Vec<usize>>,
    /// Terminal to the indexes of the starts in it.
    by_terminal: HashMap<String, Vec<usize>>,
    /// Session id to the (terminal, at) rows that reported it (deduped).
    sessions: HashMap<String, BTreeSet<(String, Option<i64>)>>,
}

/// Where the ledger is: `$HERDR_WORKERS_LEDGER` when set and non-empty, else
/// `<app home>/automagik-herdr/workers.jsonl`. The app home is `$HERDR_APP_HOME` when set and
/// non-empty, else `~/.config/herdr-app` under `home`, as Herdr resolves it.
pub fn ledger_path(
    ledger_env: Option<OsString>,
    app_home_env: Option<OsString>,
    home: Option<PathBuf>,
) -> Option<PathBuf> {
    if let Some(p) = ledger_env.filter(|p| !p.is_empty()) {
        return Some(PathBuf::from(p));
    }
    let app_home = match app_home_env.filter(|p| !p.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => home?.join(DEFAULT_APP_HOME),
    };
    Some(app_home.join(LEDGER_RELATIVE))
}

impl Ledger {
    /// Loads the ledger from its usual place. Never fails: no file means no tags.
    pub fn load() -> Ledger {
        let path = ledger_path(
            std::env::var_os(LEDGER_ENV),
            std::env::var_os(APP_HOME_ENV),
            crate::paths::home(),
        );
        match path {
            Some(p) => Ledger::load_from(&p),
            None => Ledger::default(),
        }
    }

    /// Missing or unreadable file gives an empty ledger.
    pub fn load_from(path: &Path) -> Ledger {
        std::fs::read(path)
            .map(|b| Ledger::parse(&b))
            .unwrap_or_default()
    }

    pub fn parse(bytes: &[u8]) -> Ledger {
        let mut ledger = Ledger::default();
        let mut seen = HashSet::new();
        for line in bytes.split(|b| *b == b'\n') {
            let Ok(Value::Object(row)) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            match str_field(&row, "event") {
                Some("start") => {
                    if let Some(s) = parse_start(&row)
                        && seen.insert(s.clone())
                    {
                        ledger.starts.push(s);
                    }
                }
                Some("session") => {
                    if let (Some(t), Some(s)) =
                        (str_field(&row, "terminal"), str_field(&row, "session"))
                    {
                        let at = str_field(&row, "at").and_then(crate::time::parse_rfc3339);
                        ledger
                            .sessions
                            .entry(s.to_owned())
                            .or_default()
                            .insert((t.to_owned(), at));
                    }
                }
                _ => {}
            }
        }
        ledger.index();
        ledger
    }

    /// Builds the worktree and terminal indexes and each start's [`Life`], in one sorted pass per
    /// terminal, so a query only looks at the starts that share its worktree or terminal.
    fn index(&mut self) {
        for (i, s) in self.starts.iter().enumerate() {
            if let Some(w) = &s.worktree {
                self.by_worktree
                    .entry(normalize(w).to_owned())
                    .or_default()
                    .push(i);
            }
            if let Some(t) = &s.terminal {
                self.by_terminal.entry(t.clone()).or_default().push(i);
            }
        }
        self.lives = vec![Life::default(); self.starts.len()];
        for idx in self.by_terminal.values() {
            let mut times: Vec<i64> = idx.iter().filter_map(|&i| self.starts[i].at_ms).collect();
            times.sort_unstable();
            let untimed = idx.len() - times.len();
            for &i in idx {
                let at = self.starts[i].at_ms;
                let others_untimed = untimed - usize::from(at.is_none());
                self.lives[i] = Life {
                    replaced_at: at
                        .and_then(|at| times.get(times.partition_point(|t| *t <= at)).copied()),
                    untimed_neighbour: others_untimed > 0,
                };
            }
        }
    }

    pub fn is_empty(&self) -> bool {
        self.starts.is_empty()
    }

    pub fn resolve(&self, q: &Query) -> Resolution {
        match q.agent {
            Source::Claude => self.resolve_by_session(q.session_id, q.at_ms),
            Source::Codex | Source::Omp => match q.cwd {
                Some(cwd) => self.resolve_by_worktree(ledger_agent(q.agent), cwd, q.at_ms),
                None => Resolution::Untagged,
            },
        }
    }

    fn resolve_by_session(&self, session_id: &str, at_ms: i64) -> Resolution {
        let Some(rows) = self.sessions.get(session_id) else {
            return Resolution::Untagged;
        };
        let terminals: BTreeSet<&str> = rows.iter().map(|(t, _)| t.as_str()).collect();
        let terminal = if terminals.len() > 1 {
            // Resumed in another pane: the latest report not after the query time owns it.
            let Some(latest) = rows
                .iter()
                .filter_map(|(_, at)| *at)
                .filter(|at| *at <= at_ms)
                .max()
            else {
                return Resolution::Unmatched;
            };
            let owners: BTreeSet<&str> = rows
                .iter()
                .filter(|(_, at)| *at == Some(latest))
                .map(|(t, _)| t.as_str())
                .collect();
            let owner = match (owners.first(), owners.len()) {
                (Some(t), 1) => *t,
                _ => return Resolution::Unmatched,
            };
            // Another terminal reported the id at an unknown time: it may be the later resume.
            if rows.iter().any(|(t, at)| at.is_none() && t != owner) {
                return Resolution::Unmatched;
            }
            owner
        } else {
            match terminals.first() {
                Some(t) => *t,
                None => return Resolution::Untagged,
            }
        };
        // The report that ties the session to this launch: the latest timed one not after the
        // query, else the first (the query predates every report), else the query time itself.
        let reported = rows
            .iter()
            .filter(|(t, _)| t == terminal)
            .filter_map(|(_, at)| *at);
        let row_at = reported
            .clone()
            .filter(|at| *at <= at_ms)
            .max()
            .or_else(|| reported.min())
            .unwrap_or(at_ms);
        self.resolve_on_terminal(terminal, row_at, at_ms)
    }

    /// The launch that occupied `terminal` when it reported the session at `row_at`, provided no
    /// other launch replaced it between that report and the query time.
    fn resolve_on_terminal(&self, terminal: &str, row_at: i64, at_ms: i64) -> Resolution {
        let starts: Vec<&Start> = self
            .by_terminal
            .get(terminal)
            .into_iter()
            .flatten()
            .map(|&i| &self.starts[i])
            .collect();
        if starts.is_empty() {
            return Resolution::Untagged;
        }
        // A launch at an unknown time may be the one that held the terminal.
        if starts.iter().any(|s| s.at_ms.is_none()) {
            return Resolution::Unmatched;
        }
        // A launch between the report and the query: whichever side the session ran on is unknown.
        let (lo, hi) = (row_at.min(at_ms), row_at.max(at_ms));
        if starts
            .iter()
            .filter_map(|s| s.at_ms)
            .any(|at| lo < at && at <= hi)
        {
            return Resolution::Unmatched;
        }
        let Some(latest) = starts
            .iter()
            .filter_map(|s| s.at_ms)
            .filter(|at| *at <= row_at)
            .max()
        else {
            // Every launch on the terminal came after the session: none of them opened it.
            return Resolution::Untagged;
        };
        let mut owners = starts.iter().filter(|s| s.at_ms == Some(latest));
        match (owners.next(), owners.next()) {
            (Some(s), None) => s.tag.clone().map_or(Resolution::Unmatched, Resolution::Tag),
            _ => Resolution::Unmatched,
        }
    }

    fn resolve_by_worktree(&self, agent: &str, cwd: &str, at_ms: i64) -> Resolution {
        let on_worktree = self.by_worktree.get(normalize(cwd)).into_iter().flatten();
        let mut confirmed = Vec::new();
        let mut unknown = 0usize;
        for &i in on_worktree {
            let (s, life) = (&self.starts[i], self.lives[i]);
            // A launch of another harness never runs this session.
            if s.agent.as_deref().is_some_and(|a| a != agent) {
                continue;
            }
            // A start without a usable time could sit anywhere, so it may be the owner itself.
            let Some(at) = s.at_ms else {
                unknown += 1;
                continue;
            };
            // Not begun yet, or already replaced on its terminal: it cannot be running the session.
            if at > at_ms || life.replaced_at.is_some_and(|end| end <= at_ms) {
                continue;
            }
            // A claimant that cannot be confirmed (no tag, no recorded agent, or a neighbour that
            // may have replaced it at an unknown time) is uncertainty, not a miss.
            match (&s.tag, &s.agent, life.untimed_neighbour) {
                (Some(t), Some(_), false) => confirmed.push(t),
                _ => unknown += 1,
            }
        }
        match (confirmed.as_slice(), unknown) {
            ([], 0) => Resolution::Untagged,
            ([t], 0) => Resolution::Tag((*t).clone()),
            _ => Resolution::Unmatched,
        }
    }
}

/// The `agent` value Herdr writes for each harness.
fn ledger_agent(s: Source) -> &'static str {
    match s {
        Source::Claude => "claude",
        Source::Codex => "codex",
        Source::Omp => "omp",
    }
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

/// The evidence of a start row, with its tag when the row is complete enough for one. None only
/// for a row with neither a terminal nor a worktree: it cannot claim or bound anything.
fn parse_start(row: &Map<String, Value>) -> Option<Start> {
    let terminal = owned(row, "terminal");
    let worktree = owned(row, "worktree");
    if terminal.is_none() && worktree.is_none() {
        return None;
    }
    Some(Start {
        tag: parse_tag(row),
        terminal,
        worktree,
        agent: owned(row, "agent"),
        at_ms: str_field(row, "at").and_then(crate::time::parse_rfc3339),
    })
}

fn parse_tag(row: &Map<String, Value>) -> Option<Tag> {
    let kind = match str_field(row, "kind")? {
        "worker" => Kind::Worker,
        "seat" => Kind::Seat,
        _ => return None,
    };
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
        task,
        project: owned(row, "project"),
        branch,
        role: str_field(row, "role").and_then(Role::parse),
        lead: owned(row, "lead"),
        requested_agent: owned(row, "agent"),
        requested_model: owned(row, "model"),
        requested_effort: owned(row, "effort"),
        swap: flag(row, "swap"),
        override_: flag(row, "override"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PROJECT_A: &str = "/work/example-project";
    const PROJECT_B: &str = "/work/other-project";
    const WT_A: &str = "/work/example-project/.worktrees/gh-45";
    const WT_B: &str = "/work/other-project/.worktrees/gh-45";

    fn ledger(rows: &[Value]) -> Ledger {
        let text: Vec<String> = rows.iter().map(Value::to_string).collect();
        Ledger::parse(text.join("\n").as_bytes())
    }

    fn start(terminal: &str, worktree: &str, agent: &str, at: &str) -> Value {
        json!({
            "event": "start", "kind": "worker", "terminal": terminal, "pid": 4242,
            "bot": "b-example", "task": "gh-45", "branch": "feat/gh-45-example",
            "project": PROJECT_A, "lead": "b-lead", "worktree": worktree, "base": "dev",
            "created": true, "role": "dev", "swap": false, "override": false,
            "agent": agent, "model": "example-model", "effort": "high", "at": at,
            "someFutureField": {"ignored": true}
        })
    }

    fn session(terminal: &str, id: &str) -> Value {
        session_at(terminal, id, "2026-01-01T09:00:01Z")
    }

    fn session_at(terminal: &str, id: &str, at: &str) -> Value {
        json!({"event": "session", "terminal": terminal, "session": id,
               "transcript": "/work/transcripts/example.jsonl", "at": at})
    }

    /// A Claude call at 09:30, after the usual 09:00 start and 09:00:01 session report.
    fn claude(id: &str) -> Query<'_> {
        Query {
            agent: Source::Claude,
            session_id: id,
            cwd: None,
            at_ms: crate::time::parse_rfc3339("2026-01-01T09:30:00Z").unwrap(),
        }
    }

    fn claude_at<'a>(id: &'a str, at: &str) -> Query<'a> {
        Query {
            at_ms: crate::time::parse_rfc3339(at).unwrap(),
            ..claude(id)
        }
    }

    fn by_cwd<'a>(agent: Source, cwd: &'a str, at: &str) -> Query<'a> {
        Query {
            agent,
            session_id: "rollout-1",
            cwd: Some(cwd),
            at_ms: crate::time::parse_rfc3339(at).unwrap(),
        }
    }

    fn tag(r: Resolution) -> Tag {
        match r {
            Resolution::Tag(t) => t,
            other => panic!("expected a tag, got {other:?}"),
        }
    }

    #[test]
    fn missing_or_unreadable_file_gives_no_tags() {
        let dir = tempfile::tempdir().unwrap();
        for path in [dir.path().join("absent.jsonl"), dir.path().to_path_buf()] {
            let l = Ledger::load_from(&path);
            assert!(l.is_empty());
            assert_eq!(l.resolve(&claude("s-1")), Resolution::Untagged);
            assert_eq!(
                l.resolve(&by_cwd(Source::Codex, WT_A, "2026-01-01T10:00:00Z")),
                Resolution::Untagged
            );
        }
    }

    #[test]
    fn ledger_path_prefers_env_then_home() {
        let home = Some(PathBuf::from("/work/home"));
        let default = Some(PathBuf::from(
            "/work/home/.config/herdr-app/automagik-herdr/workers.jsonl",
        ));
        assert_eq!(
            ledger_path(Some("/work/ledger.jsonl".into()), None, home.clone()),
            Some(PathBuf::from("/work/ledger.jsonl"))
        );
        assert_eq!(ledger_path(Some("".into()), None, home.clone()), default);
        assert_eq!(ledger_path(None, Some("".into()), home.clone()), default);
        assert_eq!(ledger_path(None, None, None), None);
    }

    #[test]
    fn ledger_path_honours_the_herdr_app_home() {
        let home = Some(PathBuf::from("/work/home"));
        let in_app_home = Some(PathBuf::from(
            "/work/app-home/automagik-herdr/workers.jsonl",
        ));
        assert_eq!(
            ledger_path(None, Some("/work/app-home".into()), home.clone()),
            in_app_home
        );
        // No user home is needed once the app home is known.
        assert_eq!(
            ledger_path(None, Some("/work/app-home".into()), None),
            in_app_home
        );
        // An explicit ledger still wins over the app home.
        assert_eq!(
            ledger_path(
                Some("/work/ledger.jsonl".into()),
                Some("/work/app-home".into()),
                home
            ),
            Some(PathBuf::from("/work/ledger.jsonl"))
        );
        // And the resolved path is the one loaded.
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("automagik-herdr/workers.jsonl");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        let rows = [
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            session("t1", "s-1"),
        ];
        let text: Vec<String> = rows.iter().map(Value::to_string).collect();
        std::fs::write(&file, text.join("\n")).unwrap();
        let path = ledger_path(None, Some(dir.path().into()), None).unwrap();
        assert_eq!(path, file);
        assert_eq!(
            tag(Ledger::load_from(&path).resolve(&claude("s-1"))).bot,
            "b-example"
        );
    }

    #[test]
    fn malformed_lines_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workers.jsonl");
        let mut text = Vec::new();
        text.extend_from_slice(b"{not json\n[1,2,3]\n\"start\"\n\xff\xfe\n\n");
        text.extend_from_slice(b"{\"event\":\"start\",\"kind\":\"worker\",\"bot\":\"b-x\"}\n");
        text.extend_from_slice(
            b"{\"event\":\"start\",\"kind\":\"robot\",\"terminal\":\"t9\",\"bot\":\"b-x\"}\n",
        );
        text.extend_from_slice(
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z")
                .to_string()
                .as_bytes(),
        );
        text.extend_from_slice(b"\n{\"event\":\"session\",\"terminal\":\"t1\"}\n");
        text.extend_from_slice(session("t1", "s-1").to_string().as_bytes());
        text.extend_from_slice(b"\n{\"event\":\"start\",\"kind\":\"worker\",\"terminal\":"); // truncated tail
        std::fs::write(&path, &text).unwrap();
        let l = Ledger::load_from(&path);
        // The bot-only row has no terminal or worktree and is dropped; the unknown-kind row on t9
        // stays as evidence but builds no tag.
        assert_eq!(l.starts.len(), 2);
        assert_eq!(l.starts.iter().filter(|s| s.tag.is_some()).count(), 1);
        assert_eq!(tag(l.resolve(&claude("s-1"))).bot, "b-example");
    }

    #[test]
    fn old_row_without_branch_uses_task_as_branch() {
        let l = ledger(&[
            json!({"event": "start", "kind": "worker", "terminal": "t1", "pid": 1,
                   "botId": "b-old", "task": "feat/12-old-style", "agent": null, "model": null,
                   "effort": null, "worktree": WT_A, "at": "2026-01-01T09:00:00Z"}),
            session("t1", "s-old"),
        ]);
        let t = tag(l.resolve(&claude("s-old")));
        assert_eq!(t.bot, "b-old");
        assert_eq!(t.task, None);
        assert_eq!(t.branch.as_deref(), Some("feat/12-old-style"));
        assert_eq!((&t.project, t.role, &t.lead), (&None, None, &None));
        // A default-model launch requested nothing: the requested fields stay empty.
        assert_eq!(
            (&t.requested_agent, &t.requested_model, &t.requested_effort),
            (&None, &None, &None)
        );
        assert!(!t.skip_for_model_eval());
        assert_eq!(t.task_key(), None);
    }

    #[test]
    fn claude_session_matches_through_its_terminal() {
        // Two terminals whose start rows differ in every tag field: picking the wrong terminal
        // fails at least one assertion below.
        let mut other = start("t2", WT_B, "claude", "2026-01-01T09:00:00Z");
        other["bot"] = json!("b-other");
        other["project"] = json!(PROJECT_B);
        other["task"] = json!("gh-77");
        other["branch"] = json!("feat/gh-77-other");
        other["role"] = json!("review");
        other["lead"] = json!("b-lead-other");
        other["model"] = json!("other-model");
        other["effort"] = json!("low");
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            other,
            session("t1", "s-1"),
            session("t2", "s-2"),
        ]);
        let a = tag(l.resolve(&claude("s-1")));
        assert_eq!(a.bot, "b-example");
        assert_eq!(a.kind, Kind::Worker);
        assert_eq!(a.task.as_deref(), Some("gh-45"));
        assert_eq!(a.branch.as_deref(), Some("feat/gh-45-example"));
        assert_eq!(a.role, Some(Role::Dev));
        assert_eq!(a.lead.as_deref(), Some("b-lead"));
        assert_eq!(a.requested_agent.as_deref(), Some("claude"));
        assert_eq!(a.requested_model.as_deref(), Some("example-model"));
        assert_eq!(a.requested_effort.as_deref(), Some("high"));
        assert_eq!(
            a.task_key(),
            Some(TaskKey {
                project: PROJECT_A.into(),
                task: "gh-45".into()
            })
        );
        let b = tag(l.resolve(&claude("s-2")));
        assert_eq!(b.bot, "b-other");
        assert_eq!(b.task.as_deref(), Some("gh-77"));
        assert_eq!(b.branch.as_deref(), Some("feat/gh-77-other"));
        assert_eq!(b.role, Some(Role::Review));
        assert_eq!(b.lead.as_deref(), Some("b-lead-other"));
        assert_eq!(b.requested_model.as_deref(), Some("other-model"));
        assert_eq!(b.requested_effort.as_deref(), Some("low"));
        assert_eq!(
            b.task_key(),
            Some(TaskKey {
                project: PROJECT_B.into(),
                task: "gh-77".into()
            })
        );
        assert_eq!(l.resolve(&claude("s-unknown")), Resolution::Untagged);
        // A session row whose terminal has no start row tags nothing.
        let orphan = ledger(&[session("t7", "s-7")]);
        assert_eq!(orphan.resolve(&claude("s-7")), Resolution::Untagged);
    }

    #[test]
    fn incomplete_start_closes_the_window_and_is_never_a_stale_tag() {
        let codex = |l: &Ledger, at| l.resolve(&by_cwd(Source::Codex, WT_A, at));
        // A later start with no bot and no agent: it may be the codex session's owner.
        let mut blank = start("t2", WT_A, "codex", "2026-01-01T12:00:00Z");
        blank["bot"] = Value::Null;
        blank["agent"] = Value::Null;
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), blank]);
        assert_eq!(tag(codex(&l, "2026-01-01T10:00:00Z")).bot, "b-example");
        assert_eq!(codex(&l, "2026-01-01T13:00:00Z"), Resolution::Unmatched);
        // Same agent but no bot: a claimant that cannot be tagged.
        let mut botless = start("t2", WT_A, "codex", "2026-01-01T12:00:00Z");
        botless.as_object_mut().unwrap().remove("bot");
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), botless]);
        assert_eq!(codex(&l, "2026-01-01T13:00:00Z"), Resolution::Unmatched);
        // An unknown kind in the same terminal still ends the codex launch; it runs omp, so codex
        // has no owner after it.
        let mut robot = start("t1", WT_A, "omp", "2026-01-01T12:00:00Z");
        robot["kind"] = json!("robot");
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), robot]);
        assert_eq!(codex(&l, "2026-01-01T13:00:00Z"), Resolution::Untagged);
        // ... in another terminal it ends nothing, and an omp launch cannot claim codex.
        let mut robot = start("t2", WT_A, "omp", "2026-01-01T12:00:00Z");
        robot["kind"] = json!("robot");
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), robot]);
        assert_eq!(tag(codex(&l, "2026-01-01T13:00:00Z")).bot, "b-example");
        // A start row without a terminal replaces nothing, but a codex one may claim the session.
        let mut headless = start("t2", WT_A, "omp", "2026-01-01T12:00:00Z");
        headless["terminal"] = Value::Null;
        let l = ledger(&[
            start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"),
            headless.clone(),
        ]);
        assert_eq!(tag(codex(&l, "2026-01-01T13:00:00Z")).bot, "b-example");
        headless["agent"] = json!("codex");
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), headless]);
        assert_eq!(codex(&l, "2026-01-01T13:00:00Z"), Resolution::Unmatched);
        // Claude: the only start on the session's terminal has no bot, so it cannot be confirmed.
        let mut botless = start("t1", WT_A, "claude", "2026-01-01T09:00:00Z");
        botless["bot"] = Value::Null;
        let l = ledger(&[botless.clone(), session("t1", "s-1")]);
        assert_eq!(l.resolve(&claude("s-1")), Resolution::Unmatched);
        // ... and a later relaunch on the terminal without a bot, with no new report, makes the
        // calls after it ambiguous; the calls before it still belong to the first launch.
        botless["at"] = json!("2026-01-01T11:00:00Z");
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            botless,
            session("t1", "s-1"),
        ]);
        assert_eq!(tag(l.resolve(&claude("s-1"))).bot, "b-example");
        assert_eq!(
            l.resolve(&claude_at("s-1", "2026-01-01T11:30:00Z")),
            Resolution::Unmatched
        );
    }

    #[test]
    fn resumed_claude_session_resolves_by_time() {
        let mut other = start("t2", WT_B, "claude", "2026-01-01T10:30:00Z");
        other["bot"] = json!("b-resumed");
        let starts = [start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"), other];
        let l = ledger(&[
            starts[0].clone(),
            starts[1].clone(),
            session_at("t1", "s-1", "2026-01-01T09:00:01Z"),
            session_at("t2", "s-1", "2026-01-01T11:00:00Z"),
        ]);
        let at = |when| l.resolve(&claude_at("s-1", when));
        assert_eq!(tag(at("2026-01-01T10:00:00Z")).bot, "b-example");
        assert_eq!(tag(at("2026-01-01T11:00:00Z")).bot, "b-resumed");
        assert_eq!(tag(at("2026-01-01T12:00:00Z")).bot, "b-resumed");
        // Before either pane reported the id: no row qualifies.
        assert_eq!(at("2026-01-01T08:00:00Z"), Resolution::Unmatched);
        // A competing terminal reported the id at an unknown time: it may own the session now.
        let mut untimed = session("t2", "s-1");
        untimed.as_object_mut().unwrap().remove("at");
        let l = ledger(&[
            starts[0].clone(),
            starts[1].clone(),
            session_at("t1", "s-1", "2026-01-01T09:00:01Z"),
            untimed.clone(),
        ]);
        assert_eq!(
            l.resolve(&claude_at("s-1", "2026-01-01T12:00:00Z")),
            Resolution::Unmatched
        );
        // No row has a usable time: stay Unmatched.
        let mut untimed_t1 = session("t1", "s-1");
        untimed_t1["at"] = json!("not a time");
        let l = ledger(&[starts[0].clone(), starts[1].clone(), untimed_t1, untimed]);
        assert_eq!(
            l.resolve(&claude_at("s-1", "2026-01-01T12:00:00Z")),
            Resolution::Unmatched
        );
    }

    #[test]
    fn untimed_session_row_is_uncertainty_only_against_a_competitor() {
        let mut other = start("t2", WT_B, "claude", "2026-01-01T10:30:00Z");
        other["bot"] = json!("b-resumed");
        let untimed = |terminal| {
            let mut row = session(terminal, "s-1");
            row.as_object_mut().unwrap().remove("at");
            row
        };
        let at = |l: &Ledger, when| l.resolve(&claude_at("s-1", when));
        // t2 reported the id at an unknown time: neither terminal can be picked at noon.
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            other.clone(),
            session_at("t1", "s-1", "2026-01-01T09:00:00Z"),
            untimed("t2"),
        ]);
        assert_eq!(at(&l, "2026-01-01T12:00:00Z"), Resolution::Unmatched);
        // An untimed row on the owning terminal competes with nobody.
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            other.clone(),
            session_at("t1", "s-1", "2026-01-01T09:00:00Z"),
            untimed("t1"),
            session_at("t2", "s-1", "2026-01-01T11:00:00Z"),
        ]);
        assert_eq!(tag(at(&l, "2026-01-01T10:00:00Z")).bot, "b-example");
        // ... but once t2 owns it, t1's untimed report may be a later resume back into t1.
        assert_eq!(at(&l, "2026-01-01T12:00:00Z"), Resolution::Unmatched);
        // A single untimed row with no competitor still matches its terminal.
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            untimed("t1"),
        ]);
        assert_eq!(tag(at(&l, "2026-01-01T12:00:00Z")).bot, "b-example");
    }

    #[test]
    fn untimed_start_keeps_its_worktree_uncertain() {
        let codex = |l: &Ledger, cwd, at| l.resolve(&by_cwd(Source::Codex, cwd, at));
        let untimed = |terminal, worktree, agent| {
            let mut row = start(terminal, worktree, agent, "2026-01-01T12:00:00Z");
            row.as_object_mut().unwrap().remove("at");
            row
        };
        // A botless start with no time may have closed the 09:00 codex window before noon.
        let mut botless = untimed("t2", WT_A, "codex");
        botless.as_object_mut().unwrap().remove("bot");
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), botless]);
        assert_eq!(
            codex(&l, WT_A, "2026-01-01T12:00:00Z"),
            Resolution::Unmatched
        );
        assert_eq!(
            codex(&l, WT_A, "2026-01-01T09:30:00Z"),
            Resolution::Unmatched
        );
        // A fully tagged omp start with an unparseable time in the codex terminal: it cannot
        // claim a codex session, but it may have replaced the codex launch at any moment.
        let mut omp = untimed("t1", WT_A, "omp");
        omp["at"] = json!("not a time");
        omp["bot"] = json!("b-omp");
        let l = ledger(&[
            start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"),
            omp.clone(),
        ]);
        assert_eq!(
            codex(&l, WT_A, "2026-01-01T12:00:00Z"),
            Resolution::Unmatched
        );
        // ... in another terminal it replaces nothing and claims nothing.
        omp["terminal"] = json!("t2");
        let l2 = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), omp]);
        assert_eq!(
            tag(codex(&l2, WT_A, "2026-01-01T12:00:00Z")).bot,
            "b-example"
        );
        // Nothing could claim codex there before 09:00, so that stays untagged, not uncertain.
        assert_eq!(
            codex(&l, WT_A, "2026-01-01T08:00:00Z"),
            Resolution::Untagged
        );
        // A lone untimed codex start may be the owner, but its window cannot be placed.
        let l = ledger(&[untimed("t1", WT_A, "codex")]);
        assert_eq!(
            codex(&l, WT_A, "2026-01-01T12:00:00Z"),
            Resolution::Unmatched
        );
        // The uncertainty stays on its own worktree.
        let l = ledger(&[
            start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"),
            untimed("t2", WT_B, "codex"),
        ]);
        assert_eq!(
            tag(codex(&l, WT_A, "2026-01-01T12:00:00Z")).bot,
            "b-example"
        );
        assert_eq!(
            codex(&l, WT_B, "2026-01-01T12:00:00Z"),
            Resolution::Unmatched
        );
    }

    #[test]
    fn codex_and_omp_match_by_cwd_agent_and_time_window() {
        let mut later = start("t2", WT_A, "omp", "2026-01-01T12:00:00Z");
        later["bot"] = json!("b-later");
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), later]);
        let codex = |cwd, at| l.resolve(&by_cwd(Source::Codex, cwd, at));
        assert_eq!(tag(codex(WT_A, "2026-01-01T10:00:00Z")).bot, "b-example");
        assert_eq!(
            tag(codex(
                "/work/example-project/.worktrees/gh-45/",
                "2026-01-01T09:00:00Z"
            ))
            .bot,
            "b-example"
        );
        assert_eq!(codex(WT_A, "2026-01-01T08:59:59Z"), Resolution::Untagged);
        // An omp launch in another terminal neither ends the codex launch nor claims its session.
        assert_eq!(tag(codex(WT_A, "2026-01-01T12:00:00Z")).bot, "b-example");
        assert_eq!(codex(WT_B, "2026-01-01T10:00:00Z"), Resolution::Untagged);
        assert_eq!(
            tag(l.resolve(&by_cwd(Source::Omp, WT_A, "2026-01-02T00:00:00Z"))).bot,
            "b-later"
        );
        assert_eq!(
            l.resolve(&by_cwd(Source::Omp, WT_A, "2026-01-01T10:00:00Z")),
            Resolution::Untagged
        );
        let no_cwd = Query {
            cwd: None,
            ..by_cwd(Source::Codex, WT_A, "2026-01-01T10:00:00Z")
        };
        assert_eq!(l.resolve(&no_cwd), Resolution::Untagged);
    }

    #[test]
    fn concurrent_reviewer_on_the_writers_worktree_is_a_second_claimant() {
        let codex = |l: &Ledger, at| l.resolve(&by_cwd(Source::Codex, WT_A, at));
        let mut reviewer = start("t2", WT_A, "codex", "2026-01-01T10:00:00Z");
        reviewer["bot"] = json!("b-reviewer");
        reviewer["role"] = json!("review");
        let l = ledger(&[
            start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"),
            reviewer.clone(),
        ]);
        // Before the reviewer started, only the writer could run a codex session there.
        let writer = tag(codex(&l, "2026-01-01T09:30:00Z"));
        assert_eq!(
            (writer.bot.as_str(), writer.role),
            ("b-example", Some(Role::Dev))
        );
        // After it, the writer has no end row: either of them may own the session.
        assert_eq!(codex(&l, "2026-01-01T10:30:00Z"), Resolution::Unmatched);
        assert_eq!(codex(&l, "2026-01-02T00:00:00Z"), Resolution::Unmatched);
        // A reviewer on another harness cannot take a codex session.
        reviewer["agent"] = json!("claude");
        let l = ledger(&[
            start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"),
            reviewer.clone(),
        ]);
        assert_eq!(tag(codex(&l, "2026-01-01T10:30:00Z")).bot, "b-example");
        // A codex reviewer launched into the writer's own terminal replaced the writer.
        reviewer["agent"] = json!("codex");
        reviewer["terminal"] = json!("t1");
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), reviewer]);
        assert_eq!(tag(codex(&l, "2026-01-01T09:30:00Z")).bot, "b-example");
        let r = tag(codex(&l, "2026-01-01T10:30:00Z"));
        assert_eq!((r.bot.as_str(), r.role), ("b-reviewer", Some(Role::Review)));
    }

    #[test]
    fn two_seats_in_the_project_folder_never_take_each_others_session() {
        let seat = |terminal, bot, at| {
            let mut row = start(terminal, PROJECT_A, "omp", at);
            row["kind"] = json!("seat");
            row["bot"] = json!(bot);
            row["task"] = Value::Null;
            row["branch"] = Value::Null;
            row
        };
        let l = ledger(&[
            seat("t1", "b-seat-one", "2026-01-01T09:00:00Z"),
            seat("t2", "b-seat-two", "2026-01-01T09:05:00Z"),
        ]);
        let omp = |at| l.resolve(&by_cwd(Source::Omp, PROJECT_A, at));
        let first = tag(omp("2026-01-01T09:02:00Z"));
        assert_eq!((first.bot.as_str(), first.kind), ("b-seat-one", Kind::Seat));
        // Both seats are live at 11:00: the session may be either's.
        assert_eq!(omp("2026-01-01T11:00:00Z"), Resolution::Unmatched);
        // The trailing slash a cwd may carry changes nothing.
        assert_eq!(
            l.resolve(&by_cwd(
                Source::Omp,
                "/work/example-project/",
                "2026-01-01T11:00:00Z"
            )),
            Resolution::Unmatched
        );
    }

    #[test]
    fn query_time_bounds_are_inclusive_at_a_start_and_exclusive_at_its_replacement() {
        let mut relaunch = start("t1", WT_A, "codex", "2026-01-01T10:00:00Z");
        relaunch["bot"] = json!("b-relaunch");
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), relaunch]);
        let ms = |at| crate::time::parse_rfc3339(at).unwrap();
        let codex_ms = |at_ms| {
            l.resolve(&Query {
                agent: Source::Codex,
                session_id: "rollout-1",
                cwd: Some(WT_A),
                at_ms,
            })
        };
        let nine = ms("2026-01-01T09:00:00Z");
        let ten = ms("2026-01-01T10:00:00Z");
        // `at_ms` is in milliseconds: one millisecond either side of a boundary moves the answer.
        assert_eq!(codex_ms(nine - 1), Resolution::Untagged);
        assert_eq!(tag(codex_ms(nine)).bot, "b-example");
        assert_eq!(tag(codex_ms(ten - 1)).bot, "b-example");
        assert_eq!(tag(codex_ms(ten)).bot, "b-relaunch");
        // A Claude session row counts from its own millisecond on.
        let mut resumed = start("t2", WT_B, "claude", "2026-01-01T10:00:00Z");
        resumed["bot"] = json!("b-resumed");
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            resumed,
            session_at("t1", "s-1", "2026-01-01T09:00:01Z"),
            session_at("t2", "s-1", "2026-01-01T10:30:00.250Z"),
        ]);
        let resume = ms("2026-01-01T10:30:00.250Z");
        let claude_ms = |at_ms| {
            l.resolve(&Query {
                at_ms,
                ..claude("s-1")
            })
        };
        assert_eq!(tag(claude_ms(resume - 1)).bot, "b-example");
        assert_eq!(tag(claude_ms(resume)).bot, "b-resumed");
    }

    #[test]
    fn reused_claude_terminal_tags_the_launch_that_held_it_when_the_session_opened() {
        let mut second = start("t1", WT_B, "claude", "2026-01-01T10:00:00Z");
        second["bot"] = json!("b-second");
        let first = start("t1", WT_A, "claude", "2026-01-01T09:00:00Z");
        let at = |l: &Ledger, when| l.resolve(&claude_at("s-1", when));
        // The session opened under the second launch: the first one never had it.
        let l = ledger(&[
            first.clone(),
            second.clone(),
            session_at("t1", "s-1", "2026-01-01T10:00:05Z"),
        ]);
        assert_eq!(tag(at(&l, "2026-01-01T10:30:00Z")).bot, "b-second");
        // It opened under the first launch, and the calls ran before the terminal was reused.
        let l = ledger(&[
            first.clone(),
            second.clone(),
            session_at("t1", "s-1", "2026-01-01T09:00:05Z"),
        ]);
        assert_eq!(tag(at(&l, "2026-01-01T09:30:00Z")).bot, "b-example");
        // A call after the reuse with no new report: the session cannot be placed.
        assert_eq!(at(&l, "2026-01-01T10:30:00Z"), Resolution::Unmatched);
        // The reviewer's probe: the only start on the terminal came after the session opened.
        let l = ledger(&[
            first.clone(),
            session_at("t2", "s-2", "2026-01-01T08:00:00Z"),
            {
                let mut late = start("t2", WT_B, "claude", "2026-01-01T09:00:00Z");
                late["bot"] = json!("b-late");
                late
            },
        ]);
        assert_eq!(
            l.resolve(&claude_at("s-2", "2026-01-01T08:30:00Z")),
            Resolution::Untagged
        );
        // A seat re-attached to another bot on the same terminal resolves by time too.
        let mut reseat = second;
        reseat["kind"] = json!("seat");
        reseat["bot"] = json!("b-reseat");
        let l = ledger(&[
            first,
            reseat,
            session_at("t1", "s-1", "2026-01-01T09:00:05Z"),
            session_at("t1", "s-3", "2026-01-01T10:00:05Z"),
        ]);
        assert_eq!(tag(at(&l, "2026-01-01T09:30:00Z")).bot, "b-example");
        assert_eq!(
            tag(l.resolve(&claude_at("s-3", "2026-01-01T10:30:00Z"))).bot,
            "b-reseat"
        );
        // A launch on the terminal at an unknown time may be the one that held it.
        let mut untimed = start("t1", WT_B, "claude", "2026-01-01T10:00:00Z");
        untimed.as_object_mut().unwrap().remove("at");
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            untimed,
            session_at("t1", "s-1", "2026-01-01T09:00:05Z"),
        ]);
        assert_eq!(at(&l, "2026-01-01T09:30:00Z"), Resolution::Unmatched);
    }

    #[test]
    fn same_task_id_in_two_projects_never_cross_matches() {
        let mut b = start("t2", WT_B, "codex", "2026-01-01T09:00:00Z");
        b["project"] = json!(PROJECT_B);
        b["bot"] = json!("b-other");
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), b]);
        let at = "2026-01-01T10:00:00Z";
        let a = tag(l.resolve(&by_cwd(Source::Codex, WT_A, at)));
        let b = tag(l.resolve(&by_cwd(Source::Codex, WT_B, at)));
        assert_eq!((a.bot.as_str(), b.bot.as_str()), ("b-example", "b-other"));
        assert_eq!(a.task, b.task);
        let (ka, kb) = (a.task_key().unwrap(), b.task_key().unwrap());
        assert_ne!(ka, kb);
        assert_eq!(kb.project, PROJECT_B);
    }

    #[test]
    fn seat_is_never_a_task() {
        let mut seat = start("t1", PROJECT_A, "codex", "2026-01-01T09:00:00Z");
        seat["kind"] = json!("seat");
        let l = ledger(&[seat]);
        let t = tag(l.resolve(&by_cwd(Source::Codex, PROJECT_A, "2026-01-01T10:00:00Z")));
        assert_eq!(t.kind, Kind::Seat);
        assert_eq!(t.task, None);
        assert_eq!(t.task_key(), None);
    }

    #[test]
    fn ambiguous_claims_are_unmatched() {
        let at = "2026-01-01T10:00:00Z";
        // Two codex workers started on the same worktree at the same instant.
        let mut twin = start("t2", WT_A, "codex", "2026-01-01T09:00:00Z");
        twin["bot"] = json!("b-twin");
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), twin]);
        assert_eq!(
            l.resolve(&by_cwd(Source::Codex, WT_A, at)),
            Resolution::Unmatched
        );
        // A row with no recorded agent could be the one: do not pick the codex row.
        let mut unknown = start("t2", WT_A, "codex", "2026-01-01T09:00:00Z");
        unknown["agent"] = Value::Null;
        let l = ledger(&[start("t1", WT_A, "codex", "2026-01-01T09:00:00Z"), unknown]);
        assert_eq!(
            l.resolve(&by_cwd(Source::Codex, WT_A, at)),
            Resolution::Unmatched
        );
        // One Claude session id reported by two terminals at the same instant.
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            start("t2", WT_B, "claude", "2026-01-01T09:00:00Z"),
            session("t1", "s-1"),
            session("t2", "s-1"),
        ]);
        assert_eq!(
            l.resolve(&claude_at("s-1", "2026-01-01T10:00:00Z")),
            Resolution::Unmatched
        );
        // One terminal with two start rows at the same instant.
        let mut twin = start("t1", WT_A, "claude", "2026-01-01T09:00:00Z");
        twin["bot"] = json!("b-twin");
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            twin,
            session("t1", "s-1"),
        ]);
        assert_eq!(l.resolve(&claude("s-1")), Resolution::Unmatched);
    }

    #[test]
    fn duplicate_rows_are_deduped() {
        let row = start("t1", WT_A, "claude", "2026-01-01T09:00:00Z");
        let l = ledger(&[row.clone(), row, session("t1", "s-1"), session("t1", "s-1")]);
        assert_eq!(l.sessions["s-1"].len(), 1);
        assert_eq!(tag(l.resolve(&claude("s-1"))).bot, "b-example");
    }

    #[test]
    fn swap_and_override_rows_are_flagged() {
        let mut swapped = start("t1", WT_A, "codex", "2026-01-01T09:00:00Z");
        swapped["swap"] = json!(true);
        let mut overridden = start("t2", WT_B, "codex", "2026-01-01T09:00:00Z");
        overridden["override"] = json!(true);
        let l = ledger(&[swapped, overridden]);
        let at = "2026-01-01T10:00:00Z";
        let s = tag(l.resolve(&by_cwd(Source::Codex, WT_A, at)));
        let o = tag(l.resolve(&by_cwd(Source::Codex, WT_B, at)));
        assert!(s.swap && !s.override_ && s.skip_for_model_eval());
        assert!(o.override_ && !o.swap && o.skip_for_model_eval());
    }
}
