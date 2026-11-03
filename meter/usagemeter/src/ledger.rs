//! Read-only tagging from Herdr's worker ledger: which worker, bot and task a session belongs to.
//!
//! Herdr appends one JSON row per event to `workers.jsonl` (`$HERDR_WORKERS_LEDGER`, else
//! `~/.config/herdr-app/automagik-herdr/workers.jsonl`). Two events matter here:
//!
//! - `start`: a worker or seat was launched in a terminal, on a worktree, for a bot.
//! - `session`: a Claude pane in a terminal opened a session id (Claude panes only).
//!
//! The ledger is never written and never required: a missing or unreadable file means no tags,
//! malformed lines are skipped, unknown fields are ignored and any field may be missing in older
//! rows (a field of the wrong type counts as missing).
//!
//! Resolution never guesses. Claude sessions resolve through their `session` row to the `start`
//! row of the same terminal. Codex and omp sessions resolve by `cwd == worktree`, the agent, and a
//! time window opened by the start row's `at` and closed by the next start row on the same
//! worktree. Whenever more than one start row could claim a session the answer is
//! [`Resolution::Unmatched`].
//!
//! Tasks are joined by [`TaskKey`] (project, task), never by the task id alone: two projects can
//! both have a `gh-45`. Seats have no task.

use std::collections::{BTreeSet, HashMap};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::sources::Source;

pub const LEDGER_ENV: &str = "HERDR_WORKERS_LEDGER";
const DEFAULT_RELATIVE: &str = ".config/herdr-app/automagik-herdr/workers.jsonl";

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
#[derive(Debug, Clone, PartialEq, Eq)]
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
    pub model: Option<String>,
    pub effort: Option<String>,
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
    /// More than one start row could claim it, or the only one could not be confirmed.
    Unmatched,
}

/// The session to resolve.
#[derive(Debug, Clone, Copy)]
pub struct Query<'a> {
    pub agent: Source,
    pub session_id: &'a str,
    pub cwd: Option<&'a str>,
    /// When the session ran (ms since the epoch); used for Codex and omp only.
    pub at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Start {
    terminal: String,
    worktree: Option<String>,
    agent: Option<String>,
    at_ms: Option<i64>,
    tag: Tag,
}

#[derive(Debug, Default)]
pub struct Ledger {
    starts: Vec<Start>,
    /// Session id to the terminals that reported it (deduped).
    sessions: HashMap<String, BTreeSet<String>>,
}

/// `$HERDR_WORKERS_LEDGER` when set and non-empty, else the default under `home`.
pub fn ledger_path(env: Option<OsString>, home: Option<PathBuf>) -> Option<PathBuf> {
    match env.filter(|p| !p.is_empty()) {
        Some(p) => Some(PathBuf::from(p)),
        None => home.map(|h| h.join(DEFAULT_RELATIVE)),
    }
}

impl Ledger {
    /// Loads the ledger from its usual place. Never fails: no file means no tags.
    pub fn load() -> Ledger {
        match ledger_path(std::env::var_os(LEDGER_ENV), crate::paths::home()) {
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
        for line in bytes.split(|b| *b == b'\n') {
            let Ok(Value::Object(row)) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            match str_field(&row, "event") {
                Some("start") => {
                    if let Some(s) = parse_start(&row)
                        && !ledger.starts.contains(&s)
                    {
                        ledger.starts.push(s);
                    }
                }
                Some("session") => {
                    if let (Some(t), Some(s)) =
                        (str_field(&row, "terminal"), str_field(&row, "session"))
                    {
                        ledger
                            .sessions
                            .entry(s.to_owned())
                            .or_default()
                            .insert(t.to_owned());
                    }
                }
                _ => {}
            }
        }
        ledger
    }

    pub fn is_empty(&self) -> bool {
        self.starts.is_empty()
    }

    pub fn resolve(&self, q: &Query) -> Resolution {
        match q.agent {
            Source::Claude => self.resolve_by_session(q.session_id),
            Source::Codex | Source::Omp => match q.cwd {
                Some(cwd) => self.resolve_by_worktree(ledger_agent(q.agent), cwd, q.at_ms),
                None => Resolution::Untagged,
            },
        }
    }

    fn resolve_by_session(&self, session_id: &str) -> Resolution {
        let Some(terminals) = self.sessions.get(session_id) else {
            return Resolution::Untagged;
        };
        if terminals.len() > 1 {
            return Resolution::Unmatched;
        }
        let Some(terminal) = terminals.first() else {
            return Resolution::Untagged;
        };
        let mut claims = self.starts.iter().filter(|s| &s.terminal == terminal);
        match (claims.next(), claims.next()) {
            (None, _) => Resolution::Untagged,
            (Some(s), None) => Resolution::Tag(s.tag.clone()),
            (Some(_), Some(_)) => Resolution::Unmatched,
        }
    }

    fn resolve_by_worktree(&self, agent: &str, cwd: &str, at_ms: i64) -> Resolution {
        let cwd = normalize(cwd);
        let opens: Vec<(i64, &Start)> = self
            .starts
            .iter()
            .filter(|s| s.worktree.as_deref().map(normalize) == Some(cwd))
            .filter_map(|s| Some((s.at_ms?, s)))
            .collect();
        // The window of a start row closes at the first later start on the same worktree; rows
        // sharing an `at` keep each other's window open, so both stay candidates.
        let closes_after = |at: i64| opens.iter().map(|(t, _)| *t).filter(|t| *t > at).min();
        let mut confirmed = Vec::new();
        let mut unknown = 0usize;
        for (at, s) in &opens {
            let in_window = *at <= at_ms && closes_after(*at).is_none_or(|end| at_ms < end);
            if !in_window {
                continue;
            }
            match s.agent.as_deref() {
                Some(a) if a == agent => confirmed.push(s),
                Some(_) => {}
                None => unknown += 1,
            }
        }
        match (confirmed.as_slice(), unknown) {
            ([], 0) => Resolution::Untagged,
            ([s], 0) => Resolution::Tag(s.tag.clone()),
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

fn parse_start(row: &Map<String, Value>) -> Option<Start> {
    let kind = match str_field(row, "kind")? {
        "worker" => Kind::Worker,
        "seat" => Kind::Seat,
        _ => return None,
    };
    let terminal = owned(row, "terminal")?;
    let bot = owned(row, "bot").or_else(|| owned(row, "botId"))?;
    // Rows written before `branch` existed carried the branch in `task`.
    let (task, branch) = if row.contains_key("branch") {
        (owned(row, "task"), owned(row, "branch"))
    } else {
        (None, owned(row, "task"))
    };
    let task = if kind == Kind::Seat { None } else { task };
    Some(Start {
        terminal,
        worktree: owned(row, "worktree"),
        agent: owned(row, "agent"),
        at_ms: str_field(row, "at").and_then(crate::time::parse_rfc3339),
        tag: Tag {
            bot,
            kind,
            task,
            project: owned(row, "project"),
            branch,
            role: str_field(row, "role").and_then(Role::parse),
            lead: owned(row, "lead"),
            model: owned(row, "model"),
            effort: owned(row, "effort"),
            swap: flag(row, "swap"),
            override_: flag(row, "override"),
        },
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
        json!({"event": "session", "terminal": terminal, "session": id,
               "transcript": "/work/transcripts/example.jsonl", "at": "2026-01-01T09:00:01Z"})
    }

    fn claude(id: &str) -> Query<'_> {
        Query {
            agent: Source::Claude,
            session_id: id,
            cwd: None,
            at_ms: 0,
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
        assert_eq!(
            ledger_path(Some("/work/ledger.jsonl".into()), home.clone()),
            Some(PathBuf::from("/work/ledger.jsonl"))
        );
        assert_eq!(
            ledger_path(Some("".into()), home.clone()),
            Some(PathBuf::from(
                "/work/home/.config/herdr-app/automagik-herdr/workers.jsonl"
            ))
        );
        assert_eq!(ledger_path(None, None), None);
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
        assert_eq!(l.starts.len(), 1);
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
        assert_eq!(
            (&t.project, t.role, &t.lead, &t.model),
            (&None, None, &None, &None)
        );
        assert!(!t.skip_for_model_eval());
        assert_eq!(t.task_key(), None);
    }

    #[test]
    fn claude_session_matches_through_its_terminal() {
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            start("t2", WT_B, "claude", "2026-01-01T09:00:00Z"),
            session("t1", "s-1"),
        ]);
        let t = tag(l.resolve(&claude("s-1")));
        assert_eq!(t.kind, Kind::Worker);
        assert_eq!(t.task.as_deref(), Some("gh-45"));
        assert_eq!(t.branch.as_deref(), Some("feat/gh-45-example"));
        assert_eq!(t.role, Some(Role::Dev));
        assert_eq!(t.lead.as_deref(), Some("b-lead"));
        assert_eq!(t.model.as_deref(), Some("example-model"));
        assert_eq!(t.effort.as_deref(), Some("high"));
        assert_eq!(
            t.task_key(),
            Some(TaskKey {
                project: PROJECT_A.into(),
                task: "gh-45".into()
            })
        );
        assert_eq!(l.resolve(&claude("s-unknown")), Resolution::Untagged);
        // A session row whose terminal has no start row tags nothing.
        let orphan = ledger(&[session("t7", "s-7")]);
        assert_eq!(orphan.resolve(&claude("s-7")), Resolution::Untagged);
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
        // The next start on the worktree closes the codex window.
        assert_eq!(codex(WT_A, "2026-01-01T12:00:00Z"), Resolution::Untagged);
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
        // One Claude session id reported by two terminals.
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            start("t2", WT_B, "claude", "2026-01-01T09:00:00Z"),
            session("t1", "s-1"),
            session("t2", "s-1"),
        ]);
        assert_eq!(l.resolve(&claude("s-1")), Resolution::Unmatched);
        // One terminal with two different start rows.
        let mut relaunch = start("t1", WT_A, "claude", "2026-01-01T11:00:00Z");
        relaunch["bot"] = json!("b-relaunch");
        let l = ledger(&[
            start("t1", WT_A, "claude", "2026-01-01T09:00:00Z"),
            relaunch,
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
