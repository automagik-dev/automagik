//! The state directory default and the one-time move out of the pre-0.4.0 default. Spawns the
//! binary with a synthetic HOME in a temp dir, so it runs in its own test binary (see
//! process.rs). No real home path is read or written.

mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Output;

use common::*;

struct Home {
    env: Env,
}

impl Home {
    fn new() -> Home {
        let h = Home { env: Env::new() };
        fs::create_dir_all(h.home()).unwrap();
        h
    }

    fn home(&self) -> PathBuf {
        self.env.home()
    }

    fn new_dir(&self) -> PathBuf {
        self.home().join(".automagik/meter")
    }

    fn old_dir(&self) -> PathBuf {
        meter::paths::legacy_state_dir(&self.home(), None)
    }

    /// One recent Claude Code line, so a sync has something to store.
    fn log(&self) {
        let ts = meter::time::format_rfc3339(meter::time::now_ms() - 3_600_000);
        let f = self.env.claude("-work-app/sess-1.jsonl");
        write_lines(&f, &[claude_line("msg_1", "req_1", &ts, "model-a", &U1, 0)]);
    }

    fn run(&self, args: &[&str], state_dir: Option<&Path>) -> Output {
        let mut c = std::process::Command::new(env!("CARGO_BIN_EXE_usagemeter"));
        c.args(args)
            .env("HOME", self.home())
            .env("METER_HC", self.env.dir.path().join("no-hc"))
            .env_remove("METER_STATE_DIR")
            .env_remove("METER_TRACE")
            .env_remove("AM_HOME")
            .env_remove("XDG_STATE_HOME")
            .env_remove("CLAUDE_CONFIG_DIR")
            .env_remove("CODEX_HOME");
        if let Some(d) = state_dir {
            c.env("METER_STATE_DIR", d);
        }
        let out = c.output().unwrap();
        assert!(
            out.status.success(),
            "{args:?} exited {:?}: {}{}",
            out.status,
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        out
    }

    fn sync(&self, state_dir: Option<&Path>) -> Output {
        self.run(&["sync", "--force", "--no-publish"], state_dir)
    }

    fn rows(&self, dir: &Path) -> i64 {
        let out = self.run(&["status"], Some(dir));
        let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        v["rows"].as_i64().unwrap_or(0)
    }

    /// A store made by syncing into the old directory, as a pre-0.4.0 meter would have.
    fn old_store(&self) -> i64 {
        self.log();
        self.sync(Some(&self.old_dir()));
        let rows = self.rows(&self.old_dir());
        assert!(rows > 0);
        rows
    }
}

fn stderr(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[cfg(unix)]
fn mode(p: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(p).unwrap().permissions().mode() & 0o777
}

/// A foreign file of the app that shares the old folder: never opened, moved or removed.
fn foreign(old: &Path) -> PathBuf {
    let f = old.join("Local Storage/leveldb/000003.log");
    fs::create_dir_all(f.parent().unwrap()).unwrap();
    fs::write(&f, b"FAKE-APP-DATA").unwrap();
    fs::write(old.join("Preferences"), b"{}").unwrap();
    f
}

#[test]
fn a_fresh_install_uses_home_automagik_meter() {
    let h = Home::new();
    h.log();
    let out = h.sync(None);
    assert!(stderr(&out).is_empty(), "{}", stderr(&out));
    assert!(h.new_dir().join("meter.db").is_file());
    #[cfg(unix)]
    assert_eq!(mode(&h.new_dir()), 0o700);
    assert!(
        !h.old_dir().exists(),
        "nothing is created in the old default"
    );
    let st: serde_json::Value = serde_json::from_slice(&h.run(&["status"], None).stdout).unwrap();
    assert_eq!(st["state_dir"], h.new_dir().to_string_lossy().as_ref());
    assert!(st["rows"].as_i64().unwrap() > 0);
}

#[test]
fn the_first_sync_moves_exactly_the_meter_files_and_keeps_the_store() {
    let h = Home::new();
    let rows = h.old_store();
    let old = h.old_dir();
    fs::write(old.join("claude-limits.jsonl"), b"{\"n\":1}\n").unwrap();
    fs::write(old.join("claude-limits.last.json"), b"{\"n\":1}").unwrap();
    let app = foreign(&old);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let p = old.join("claude-limits.jsonl");
        fs::set_permissions(&p, fs::Permissions::from_mode(0o640)).unwrap();
    }

    let out = h.sync(None);
    let err = stderr(&out);
    assert_eq!(err.lines().count(), 1, "{err}");
    assert!(err.starts_with("meter: moved "), "{err}");

    assert_eq!(names(&old), ["Local Storage", "Preferences"]);
    assert_eq!(fs::read(&app).unwrap(), b"FAKE-APP-DATA");
    let new = h.new_dir();
    for f in [
        "meter.db",
        "meter.lock",
        "claude-limits.jsonl",
        "claude-limits.last.json",
    ] {
        assert!(new.join(f).is_file(), "{f} in the new dir");
    }
    assert_eq!(
        fs::read(new.join("claude-limits.jsonl")).unwrap(),
        b"{\"n\":1}\n"
    );
    #[cfg(unix)]
    {
        assert_eq!(mode(&new), 0o700);
        assert_eq!(mode(&new.join("meter.db")), 0o600);
        assert_eq!(mode(&new.join("claude-limits.jsonl")), 0o640);
    }
    assert_eq!(h.rows(&new), rows, "the moved store is the same store");

    // Idempotent: a second run finds nothing to move and says nothing.
    let again = h.sync(None);
    assert!(stderr(&again).is_empty(), "{}", stderr(&again));
    assert_eq!(names(&old), ["Local Storage", "Preferences"]);
    assert_eq!(h.rows(&new), rows);
}

#[test]
fn an_existing_new_store_is_never_overwritten() {
    let h = Home::new();
    h.old_store();
    let old = h.old_dir();
    let old_db = fs::read(old.join("meter.db")).unwrap();
    fs::write(old.join("claude-limits.jsonl"), b"old\n").unwrap();
    // A store already in the new directory.
    h.sync(Some(&h.new_dir()));
    let new_rows = h.rows(&h.new_dir());
    fs::write(h.new_dir().join("claude-limits.jsonl"), b"new\n").unwrap();

    for _ in 0..2 {
        let out = h.sync(None);
        let err = stderr(&out);
        assert_eq!(err.lines().count(), 1, "{err}");
        assert!(err.contains("already has a meter.db"), "{err}");
        assert!(err.contains("nothing was overwritten or deleted"), "{err}");
    }
    assert_eq!(fs::read(old.join("meter.db")).unwrap(), old_db);
    assert!(old.join("meter.lock").exists(), "the old files all stay");
    assert_eq!(fs::read(old.join("claude-limits.jsonl")).unwrap(), b"old\n");
    assert_eq!(
        fs::read(h.new_dir().join("claude-limits.jsonl")).unwrap(),
        b"new\n"
    );
    assert_eq!(h.rows(&h.new_dir()), new_rows);
}

#[test]
fn meter_state_dir_turns_the_move_off() {
    let h = Home::new();
    h.old_store();
    let before = names(&h.old_dir());
    let custom = h.env.dir.path().join("custom");
    let out = h.sync(Some(&custom));
    assert!(stderr(&out).is_empty(), "{}", stderr(&out));
    assert!(custom.join("meter.db").is_file());
    assert!(
        !h.home().join(".automagik").exists(),
        "no new dir is created"
    );
    assert_eq!(names(&h.old_dir()), before);
}

#[test]
fn a_held_lock_skips_the_move_and_exits_0() {
    let h = Home::new();
    h.old_store();
    let old = h.old_dir();
    let before = names(&old);

    // Another new-version run holds the new directory's lock.
    meter::paths::ensure_dir(&h.new_dir()).unwrap();
    let held = meter::paths::try_lock(&h.new_dir()).unwrap().unwrap();
    let out = h.sync(None);
    assert!(String::from_utf8_lossy(&out.stdout).contains("another sync is running"));
    assert!(stderr(&out).is_empty(), "{}", stderr(&out));
    assert_eq!(names(&old), before);
    assert!(!h.new_dir().join("meter.db").exists());
    drop(held);

    // An old-version run holds the old directory's lock.
    let held = meter::paths::try_lock(&old).unwrap().unwrap();
    let out = h.sync(None);
    assert!(String::from_utf8_lossy(&out.stdout).contains("another sync is running"));
    assert_eq!(names(&old), before);
    assert!(!h.new_dir().join("meter.db").exists(), "no empty store");
    drop(held);

    let out = h.sync(None);
    assert!(
        stderr(&out).starts_with("meter: moved "),
        "{}",
        stderr(&out)
    );
    assert!(h.new_dir().join("meter.db").is_file());
}

#[test]
fn migrate_moves_the_sidecars_with_the_database_and_nothing_else() {
    let t = tempfile::tempdir().unwrap();
    let (old, new) = (t.path().join("old"), t.path().join("new"));
    fs::create_dir_all(&old).unwrap();
    meter::paths::ensure_dir(&new).unwrap();
    for f in meter::paths::MIGRATED_FILES {
        fs::write(old.join(f), f.as_bytes()).unwrap();
    }
    fs::write(old.join("meter.db.bak"), b"not ours").unwrap();
    fs::write(old.join("prices.json"), b"{}").unwrap();
    let app = foreign(&old);
    let _held = meter::paths::try_lock(&new).unwrap().unwrap();

    let m = meter::paths::migrate(&old, &new).unwrap();
    assert!(!m.busy && m.kept.is_empty(), "{m:?}");
    let mut moved = m.moved.clone();
    moved.sort();
    let mut want = meter::paths::MIGRATED_FILES.to_vec();
    want.sort();
    assert_eq!(moved, want);
    assert_eq!(
        names(&old),
        [
            "Local Storage",
            "Preferences",
            "meter.db.bak",
            "prices.json"
        ]
    );
    assert_eq!(fs::read(&app).unwrap(), b"FAKE-APP-DATA");
    for f in [
        "meter.db",
        "meter.db-wal",
        "meter.db-shm",
        "claude-limits.jsonl",
    ] {
        assert_eq!(fs::read(new.join(f)).unwrap(), f.as_bytes());
    }
    assert_eq!(
        meter::paths::migrate(&old, &new).unwrap(),
        meter::paths::Migration::default(),
        "a second run has nothing to do"
    );
}

#[test]
fn migrate_never_puts_a_database_beside_a_different_wal() {
    let t = tempfile::tempdir().unwrap();
    let (old, new) = (t.path().join("old"), t.path().join("new"));
    fs::create_dir_all(&old).unwrap();
    meter::paths::ensure_dir(&new).unwrap();
    fs::write(old.join("meter.db"), b"db").unwrap();
    fs::write(old.join("meter.db-wal"), b"wal-old").unwrap();
    fs::write(new.join("meter.db-wal"), b"wal-new").unwrap();
    let m = meter::paths::migrate(&old, &new).unwrap();
    assert_eq!(m.kept, ["meter.db-wal", "meter.db"]);
    assert!(m.moved.is_empty());
    assert!(!new.join("meter.db").exists());
    assert_eq!(fs::read(old.join("meter.db")).unwrap(), b"db");
}
