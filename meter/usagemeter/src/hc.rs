//! herdr-core over `hc connect`: JSON-RPC 2.0, one message per line on stdin/stdout. The meter
//! uses it for the core id (`server.status`), the terminals and their labels (`terminal.list`)
//! and the summary doc (`doc.get` / `doc.set`). It is local only; a missing `hc` is not an error.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

pub struct Hc {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<String>,
    next_id: u64,
    timeout: Duration,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RpcError {
    /// The core answered with an error; `kind` is its `data.kind` (`conflict`, `unavailable`, …).
    Remote { kind: String, message: String },
    /// No answer in time, or the connection closed.
    Transport(String),
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RpcError::Remote { kind, message } => write!(f, "herdr-core said {kind}: {message}"),
            RpcError::Transport(m) => write!(f, "herdr-core connection: {m}"),
        }
    }
}

/// The `hc` binary: `METER_HC` if set (for tests), else `hc` on PATH.
fn hc_program() -> String {
    std::env::var("METER_HC")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "hc".into())
}

impl Hc {
    /// Starts `hc connect`. None when `hc` is not installed or cannot start.
    pub fn connect(timeout: Duration) -> Option<Hc> {
        let mut child = Command::new(hc_program())
            .arg("connect")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let stdout = child.stdout.take()?;
        let stdin = child.stdin.take();
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Some(Hc {
            child,
            stdin,
            lines: rx,
            next_id: 0,
            timeout,
        })
    }

    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, RpcError> {
        self.next_id += 1;
        let id = self.next_id;
        let msg = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| RpcError::Transport("closed".into()))?;
        writeln!(stdin, "{msg}")
            .and_then(|_| stdin.flush())
            .map_err(|e| RpcError::Transport(e.to_string()))?;
        let deadline = Instant::now() + self.timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let line = match self.lines.recv_timeout(left) {
                Ok(l) => l,
                Err(RecvTimeoutError::Timeout) => {
                    return Err(RpcError::Transport(format!("{method} timed out")));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(RpcError::Transport("closed".into()));
                }
            };
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if v.get("id").and_then(Value::as_u64) != Some(id) {
                continue; // a notification or an older reply
            }
            if let Some(err) = v.get("error") {
                let kind = err
                    .pointer("/data/kind")
                    .and_then(Value::as_str)
                    .or_else(|| err.get("message").and_then(Value::as_str))
                    .unwrap_or("error");
                let message = err.get("message").and_then(Value::as_str).unwrap_or("");
                return Err(RpcError::Remote {
                    kind: kind.chars().take(64).collect(),
                    message: message.chars().take(200).collect(),
                });
            }
            return Ok(v.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    /// herdr-core's permanent core id.
    pub fn core_id(&mut self) -> Option<String> {
        let r = self.call("server.status", json!({})).ok()?;
        let id = r.pointer("/core/id")?.as_str()?;
        (!id.is_empty() && id.len() <= 128).then(|| id.to_string())
    }

    /// Every terminal hc lists, finished ones included (their end is evidence), with the labels
    /// attribution reads. Empty when hc cannot answer.
    pub fn terminals(&mut self) -> Vec<Terminal> {
        self.terminals_listed().unwrap_or_default()
    }

    /// [`Hc::terminals`], None when hc did not answer with a list (so nothing can be taken as
    /// gone from it).
    pub fn terminals_listed(&mut self) -> Option<Vec<Terminal>> {
        let r = self.call("terminal.list", json!({})).ok()?;
        let list = r.get("terminals").and_then(Value::as_array)?;
        Some(list.iter().filter_map(Terminal::from_json).collect())
    }

    pub fn doc_get(&mut self, name: &str) -> Result<(Value, u64), RpcError> {
        let r = self.call("doc.get", json!({"name": name}))?;
        let version = r.get("version").and_then(Value::as_u64).unwrap_or(0);
        Ok((r.get("value").cloned().unwrap_or(Value::Null), version))
    }

    pub fn doc_set(&mut self, name: &str, value: &Value, version: u64) -> Result<u64, RpcError> {
        let r = self.call(
            "doc.set",
            json!({"name": name, "value": value, "version": version}),
        )?;
        Ok(r.get("version").and_then(Value::as_u64).unwrap_or(0))
    }

    /// Compare-and-set: read the version, write against it, and retry when another writer won.
    pub fn doc_put(&mut self, name: &str, value: &Value) -> Result<u64, RpcError> {
        let mut last = RpcError::Transport("no attempt".into());
        for _ in 0..5 {
            let (_, version) = self.doc_get(name)?;
            match self.doc_set(name, value, version) {
                Ok(v) => return Ok(v),
                Err(RpcError::Remote { kind, message }) if kind == "conflict" => {
                    last = RpcError::Remote { kind, message };
                }
                Err(e) => return Err(e),
            }
        }
        Err(last)
    }
}

impl Drop for Hc {
    fn drop(&mut self) {
        drop(self.stdin.take());
        let deadline = Instant::now() + Duration::from_millis(500);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = self.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// One hc terminal at a sync (RFC 0021 (b), the snapshot), reduced to what attribution needs.
/// Labels are bounded copies; an empty label counts as missing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Terminal {
    /// Its hc address on this machine (`t7`).
    pub terminal: String,
    /// hc's `created_ms`: with the core id and the address, the launch's key.
    pub created_ms: Option<i64>,
    /// Set once the terminal finished: its launch ended then.
    pub finished_ms: Option<i64>,
    /// The harness it runs (`claude-code`, `codex`, `omp`, `dsh-tui`), None for anything else.
    pub harness: Option<&'static str>,
    /// The foreground program's cwd, else the terminal's.
    pub cwd: Option<String>,
    pub labels: Labels,
}

/// The labels Herdr (and an outside reviver) set that attribution reads. Only the session labels
/// tie a call to a launch (the `label` basis); the others are recorded as seen and never tag a
/// call, because the start row outranks them (RFC 0021 (a)).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Labels {
    /// A seat's bot (`bot`).
    pub bot: Option<String>,
    /// A seat's pane role (`role`).
    pub role: Option<String>,
    /// `squad`, a display hint.
    pub squad: Option<String>,
    /// A worker's bot (`worker.of`).
    pub worker_of: Option<String>,
    /// A worker's role (`worker.role`).
    pub worker_role: Option<String>,
    /// The session the pane runs (`agent.session`), set by Herdr.
    pub session: Option<String>,
    /// The session an outside reviver keeps (`revive.session`).
    pub revive_session: Option<String>,
    /// The agent `revive.session` belongs to (`revive.agent`), when the reviver names one.
    pub revive_agent: Option<String>,
}

impl Labels {
    /// The session this pane runs for its harness: `agent.session`, else `revive.session` when
    /// `revive.agent` is unset or names that harness (Herdr's `paneSession` rule).
    pub fn session_for(&self, harness: &str) -> Option<&str> {
        if let Some(s) = self.session.as_deref() {
            return Some(s);
        }
        let agent = self.revive_agent.as_deref();
        if agent.is_some_and(|a| harness_of(a) != Some(harness_name(harness))) {
            return None;
        }
        self.revive_session.as_deref()
    }
}

/// A harness name as [`harness_of`] gives it, for one already in that form.
fn harness_name(h: &str) -> &str {
    harness_of(h).unwrap_or(h)
}

/// `claude` → claude-code, `omp` → omp, `agy` → agy, from the program's basename.
pub fn harness_of(program: &str) -> Option<&'static str> {
    let base = program.rsplit('/').next().unwrap_or(program);
    match base {
        "claude" | "claude-code" => Some("claude-code"),
        "omp" => Some("omp"),
        "codex" => Some("codex"),
        "dsh-tui" => Some("dsh-tui"),
        "agy" | "antigravity" => Some("agy"),
        _ => None,
    }
}

impl Terminal {
    /// None for an entry with no address.
    pub fn from_json(t: &Value) -> Option<Terminal> {
        let terminal = t
            .get("address")
            .or_else(|| t.get("id"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 128)?;
        let fg = t.get("foreground").filter(|v| !v.is_null());
        let program = |v: Option<&Value>| -> Option<&'static str> {
            let v = v?;
            // `claude …`, or an interpreter running it (`bun /…/omp`, `node /…/claude`).
            let argv = v.get("argv").and_then(Value::as_array);
            argv.into_iter()
                .flatten()
                .take(2)
                .filter_map(Value::as_str)
                .find_map(harness_of)
                .or_else(|| v.get("name").and_then(Value::as_str).and_then(harness_of))
        };
        let cwd = fg
            .and_then(|f| f.get("cwd"))
            .and_then(Value::as_str)
            .or_else(|| t.get("cwd").and_then(Value::as_str))
            .map(|s| s.chars().take(1024).collect());
        let label = |k: &str| {
            t.get("labels")
                .and_then(|l| l.get(k))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(|s| s.chars().take(128).collect::<String>())
        };
        Some(Terminal {
            terminal: terminal.to_string(),
            created_ms: t.get("created_ms").and_then(Value::as_i64),
            finished_ms: t.get("finished_ms").and_then(Value::as_i64),
            harness: program(fg).or_else(|| program(Some(t))),
            cwd,
            labels: Labels {
                bot: label("bot"),
                role: label("role"),
                squad: label("squad"),
                worker_of: label("worker.of"),
                worker_role: label("worker.role"),
                session: label("agent.session"),
                revive_session: label("revive.session"),
                revive_agent: label("revive.agent"),
            },
        })
    }

    /// Still running at the sync.
    pub fn live(&self) -> bool {
        self.finished_ms.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_attribution_labels_from_every_terminal() {
        let t = json!({"address": "t1", "cwd": "/w", "created_ms": 5, "argv": ["zsh"],
            "foreground": {"pid": 1, "name": "node", "argv": ["/usr/local/bin/claude", "--x"], "cwd": "/w/app"},
            "labels": {"bot": "b-test000001", "role": "dev", "squad": "b-test000002", "where": "x",
                "worker.of": "b-test000003", "worker.role": "review",
                "agent.session": "sess-synthetic-1", "revive.session": "", "bot2": "x"}});
        let l = Terminal::from_json(&t).unwrap();
        assert_eq!(l.terminal, "t1");
        assert_eq!(l.harness, Some("claude-code"));
        assert_eq!(l.cwd.as_deref(), Some("/w/app"));
        assert_eq!(l.created_ms, Some(5));
        assert!(l.live());
        assert_eq!(l.labels.bot.as_deref(), Some("b-test000001"));
        assert_eq!(l.labels.role.as_deref(), Some("dev"));
        assert_eq!(l.labels.squad.as_deref(), Some("b-test000002"));
        assert_eq!(l.labels.worker_of.as_deref(), Some("b-test000003"));
        assert_eq!(l.labels.worker_role.as_deref(), Some("review"));
        assert_eq!(l.labels.revive_session, None, "an empty label is missing");
        assert_eq!(
            l.labels.session_for("claude-code"),
            Some("sess-synthetic-1")
        );
        // A shell is listed, with no harness; a finished terminal is listed with its end.
        let shell = json!({"address": "t2", "cwd": "/w", "argv": ["zsh"],
            "foreground": {"pid": 1, "name": "zsh", "argv": ["zsh"], "cwd": "/w"}});
        assert_eq!(Terminal::from_json(&shell).unwrap().harness, None);
        let done = json!({"address": "t3", "cwd": "/w", "argv": ["omp"], "finished_ms": 9});
        let done = Terminal::from_json(&done).unwrap();
        assert_eq!((done.harness, done.finished_ms), (Some("omp"), Some(9)));
        assert!(!done.live());
        let dsh = json!({"address": "t4", "cwd": "/w", "argv": ["bun", "/opt/bin/dsh-tui", "-c"]});
        assert_eq!(Terminal::from_json(&dsh).unwrap().harness, Some("dsh-tui"));
        // No address: nothing to key a launch on.
        assert!(Terminal::from_json(&json!({"cwd": "/w", "argv": ["omp"]})).is_none());
    }

    #[test]
    fn a_revived_pane_names_its_session_for_its_own_agent_only() {
        let t = |labels: Value| {
            Terminal::from_json(&json!({"address": "t1", "argv": ["codex"], "labels": labels}))
                .unwrap()
                .labels
        };
        let l = t(json!({"revive.session": "rollout-synthetic"}));
        assert_eq!(l.session_for("codex"), Some("rollout-synthetic"));
        let l = t(json!({"revive.session": "rollout-synthetic", "revive.agent": "codex"}));
        assert_eq!(l.session_for("codex"), Some("rollout-synthetic"));
        let l = t(json!({"revive.session": "rollout-synthetic", "revive.agent": "omp"}));
        assert_eq!(l.session_for("codex"), None);
        // Herdr's own label wins over the reviver's.
        let l = t(json!({"agent.session": "own", "revive.session": "revived"}));
        assert_eq!(l.session_for("codex"), Some("own"));
    }
}
