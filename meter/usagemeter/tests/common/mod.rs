//! Synthetic fixtures only: every id, path, model and number here is made up.
#![allow(dead_code)]

pub mod schema;

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use meter::event::Tokens;
use meter::store::Store;
use meter::sync::{self, Options, Outcome, Report};

pub const NOW: &str = "2026-01-15T12:00:00Z";

/// One test at a time past this point, within one test binary. Hold it around every process a
/// test spawns and around every sync or lock a test takes ([`Env::run`] takes it itself): std
/// opens files close-on-exec, but a child between its fork and its exec still shares the
/// parent's open lock, so a lock a test dropped can look held to the next sync (see
/// `meter::paths::try_lock`). A thread that already holds it takes it again for free.
static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

thread_local! {
    static HELD: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

pub struct Serial(Option<std::sync::MutexGuard<'static, ()>>);

impl Drop for Serial {
    fn drop(&mut self) {
        HELD.with(|h| h.set(h.get() - 1));
    }
}

pub fn serial() -> Serial {
    let guard = if HELD.with(|h| h.get()) > 0 {
        None
    } else {
        Some(SERIAL.lock().unwrap_or_else(|e| e.into_inner()))
    };
    HELD.with(|h| h.set(h.get() + 1));
    Serial(guard)
}

pub fn now() -> i64 {
    meter::time::parse_rfc3339(NOW).unwrap()
}

pub struct Env {
    pub dir: tempfile::TempDir,
}

impl Env {
    pub fn new() -> Env {
        Env {
            dir: tempfile::tempdir().unwrap(),
        }
    }

    /// An env whose temp folder is inside `parent` (a test of TMPDIR inside a project).
    pub fn new_in(parent: &Path) -> Env {
        Env {
            dir: tempfile::tempdir_in(parent).unwrap(),
        }
    }

    pub fn home(&self) -> PathBuf {
        self.dir.path().join("home")
    }

    pub fn state(&self) -> PathBuf {
        self.dir.path().join("state")
    }

    pub fn claude(&self, rel: &str) -> PathBuf {
        let p = self.home().join(".claude/projects").join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        p
    }

    pub fn omp(&self, rel: &str) -> PathBuf {
        let p = self.home().join(".omp/agent/sessions").join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        p
    }

    pub fn dsh(&self, rel: &str) -> PathBuf {
        let p = self.home().join(".dsh/sessions").join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        p
    }

    /// The binary with an empty environment but PATH, HOME (the temp home) and METER_HC (an
    /// hc that does not exist): no harness home, state directory or ledger of the machine running
    /// the tests (DSH_HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, HERDR_*, AM_HOME, XDG_STATE_HOME,
    /// METER_*) can reach it. Callers add what a test needs, such as METER_STATE_DIR.
    pub fn command(&self) -> Command {
        let mut c = Command::new(env!("CARGO_BIN_EXE_usagemeter"));
        c.env_clear()
            .env("HOME", self.home())
            .env("METER_HC", self.dir.path().join("no-hc"));
        if let Some(path) = std::env::var_os("PATH") {
            c.env("PATH", path);
        }
        c
    }

    /// Options for an in-process sync: every harness root is under the temp home, whatever the
    /// environment of the machine running the tests says.
    pub fn opts(&self) -> Options {
        let mut o = Options::new(self.home(), self.state(), now());
        o.omp_root = self.home().join(".omp/agent/sessions");
        o.claude_root = self.home().join(".claude/projects");
        o.codex_home = self.home().join(".codex");
        o.dsh_root = self.home().join(".dsh/sessions");
        o.app_home = Some(self.home().join(".config/herdr-app"));
        o.workers_ledger = None;
        o.use_hc = false;
        o.resolve_repos = false;
        o.walk_within = Some(self.dir.path().to_path_buf());
        o.publish = false;
        o.force = true;
        o
    }

    /// `o` with every harness root outside this test's temp folder moved under the temp home, as
    /// [`Env::opts`] sets them: an `Options` built by hand (`Options::new` reads `DSH_HOME`,
    /// `CODEX_HOME` and `CLAUDE_CONFIG_DIR`) can never read the machine's own sessions. A root
    /// a test points inside its temp folder on purpose is kept.
    pub fn hermetic(&self, o: &Options) -> Options {
        let mut o = o.clone();
        let inside = |p: &Path| p.starts_with(self.dir.path());
        let home = self.home();
        for (root, default) in [
            (&mut o.omp_root, home.join(".omp/agent/sessions")),
            (&mut o.claude_root, home.join(".claude/projects")),
            (&mut o.codex_home, home.join(".codex")),
            (&mut o.dsh_root, home.join(".dsh/sessions")),
        ] {
            if !inside(root) {
                *root = default;
            }
        }
        // Herdr's ledgers: the temp home's app home, and no ledger named from outside.
        if !o.app_home.as_deref().is_some_and(inside) {
            o.app_home = Some(home.join(".config/herdr-app"));
        }
        if !o.workers_ledger.as_deref().is_some_and(inside) {
            o.workers_ledger = None;
        }
        // The walk for project app homes stays in the test's folder: a temp folder inside a real
        // project (TMPDIR under a repository) never reads that project's ledgers.
        if !o.walk_within.as_deref().is_some_and(inside) {
            o.walk_within = Some(self.dir.path().to_path_buf());
        }
        for p in [&o.state_dir].into_iter().chain(o.migrate_from.as_ref()) {
            assert!(
                inside(p),
                "a test's state stays in its temp folder: {}",
                p.display()
            );
        }
        o
    }

    /// The one way a test syncs in-process: [`Env::hermetic`] options, under [`serial`].
    pub fn sync(&self, o: &Options) -> Outcome {
        let o = self.hermetic(o);
        let _serial = serial();
        sync::run(&o).unwrap()
    }

    pub fn run(&self, o: &Options) -> Report {
        match self.sync(o) {
            Outcome::Ran(r) => *r,
            other => panic!("expected a run, got {other:?}"),
        }
    }

    pub fn store(&self) -> Store {
        Store::open(&self.state().join("meter.db")).unwrap()
    }

    /// Tokens per model across every row.
    pub fn totals(&self) -> BTreeMap<String, Tokens> {
        let mut m: BTreeMap<String, Tokens> = BTreeMap::new();
        for r in self.store().rows_since(i64::MIN).unwrap() {
            m.entry(r.key.model.clone()).or_default().add(&r.tokens);
        }
        m
    }
}

pub struct U {
    pub input: i64,
    pub output: i64,
    pub read: i64,
    pub w5: i64,
    pub w1h: i64,
}

pub const U1: U = U {
    input: 3,
    output: 40,
    read: 1000,
    w5: 100,
    w1h: 200,
};
pub const U2: U = U {
    input: 5,
    output: 70,
    read: 2000,
    w5: 0,
    w1h: 50,
};

impl U {
    pub fn tokens(&self) -> Tokens {
        Tokens {
            input_uncached: self.input,
            cache_read: self.read,
            cache_write_5m: self.w5,
            cache_write_1h: self.w1h,
            output: self.output,
            reasoning: 0,
            unsplit: 0,
        }
    }
}

/// One Claude Code assistant line. `pad` adds content text so tests control line sizes.
pub fn claude_line(msg: &str, req: &str, ts: &str, model: &str, u: &U, pad: usize) -> String {
    format!(
        concat!(
            r#"{{"parentUuid":"p","isSidechain":false,"type":"assistant","requestId":"{req}","timestamp":"{ts}","#,
            r#""sessionId":"sess-1","cwd":"/work/app","gitBranch":"feat/x","version":"1.0.0","#,
            r#""message":{{"id":"{msg}","model":"{model}","role":"assistant","#,
            r#""content":[{{"type":"text","text":"FAKE-PROMPT-TEXT {pad}"}}],"#,
            r#""usage":{{"input_tokens":{i},"output_tokens":{o},"cache_read_input_tokens":{r},"#,
            r#""cache_creation_input_tokens":{w},"cache_creation":{{"ephemeral_5m_input_tokens":{w5},"#,
            r#""ephemeral_1h_input_tokens":{w1h}}}}}}}}}"#
        ),
        req = req,
        ts = ts,
        msg = msg,
        model = model,
        pad = "x".repeat(pad),
        i = u.input,
        o = u.output,
        r = u.read,
        w = u.w5 + u.w1h,
        w5 = u.w5,
        w1h = u.w1h,
    )
}

pub fn user_line(text: &str) -> String {
    format!(
        r#"{{"type":"user","timestamp":"2026-01-15T10:00:00Z","sessionId":"sess-1","cwd":"/work/app","message":{{"role":"user","content":"{text}"}}}}"#
    )
}

pub fn write_lines(p: &Path, lines: &[String]) {
    let mut s = lines.join("\n");
    s.push('\n');
    fs::write(p, s).unwrap();
}

pub fn append(p: &Path, s: &str) {
    let mut f = fs::OpenOptions::new().append(true).open(p).unwrap();
    f.write_all(s.as_bytes()).unwrap();
}

pub fn sum(us: &[&U]) -> Tokens {
    let mut t = Tokens::default();
    for u in us {
        t.add(&u.tokens());
    }
    t
}

pub fn big_fixture(env: &Env, files: usize, lines: usize, ts: &str) -> Tokens {
    let mut want = Tokens::default();
    for f in 0..files {
        let p = env.claude(&format!("-work-app/sess-{f}.jsonl"));
        let mut v = Vec::new();
        for i in 0..lines {
            let u = if i % 3 == 0 { &U2 } else { &U1 };
            let line = claude_line(
                &format!("msg_{f}_{i}"),
                &format!("req_{f}_{i}"),
                ts,
                "model-a",
                u,
                i % 50,
            );
            v.push(line.clone());
            if i % 4 == 0 {
                v.push(line); // a repeat on the next line
            }
            want.add(&u.tokens());
        }
        write_lines(&p, &v);
    }
    want
}
