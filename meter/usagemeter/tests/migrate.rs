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
    fs::write(old.join("prices.json"), b"{}").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let p = old.join("claude-limits.jsonl");
        fs::set_permissions(&p, fs::Permissions::from_mode(0o640)).unwrap();
    }

    let out = h.sync(None);
    let err = stderr(&out);
    assert_eq!(err.lines().count(), 2, "{err}");
    assert!(err.starts_with("meter: moved "), "{err}");
    assert!(
        err.lines()
            .nth(1)
            .unwrap()
            .contains("prices.json was not moved"),
        "{err}"
    );

    assert_eq!(names(&old), ["Local Storage", "Preferences", "prices.json"]);
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
    assert_eq!(names(&old), ["Local Storage", "Preferences", "prices.json"]);
    assert_eq!(h.rows(&new), rows);
}

#[test]
fn an_existing_new_store_is_never_overwritten() {
    let h = Home::new();
    h.old_store();
    let old = h.old_dir();
    let old_db = fs::read(old.join("meter.db")).unwrap();
    fs::write(old.join("claude-limits.jsonl"), b"old\n").unwrap();
    fs::write(old.join("claude-limits.last.json"), b"{}").unwrap();
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
    assert!(old.join("claude-limits.last.json").exists());
    assert!(
        !h.new_dir().join("claude-limits.last.json").exists(),
        "nothing moves while the store is in the way"
    );
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

/// Finding 2: a `meter.db-wal` in the new dir that the move did not put there stops the whole
/// sync before a store is created: exit 0, one stderr line, nothing created or deleted.
#[test]
fn a_foreign_wal_in_the_new_dir_stops_sync_before_a_store_is_made() {
    let h = Home::new();
    let rows = h.old_store();
    let old = h.old_dir();
    let old_db = fs::read(old.join("meter.db")).unwrap();
    let new = h.new_dir();
    meter::paths::ensure_dir(&new).unwrap();
    fs::write(new.join("meter.db-wal"), b"another store").unwrap();

    for _ in 0..2 {
        let out = h.sync(None);
        let err = stderr(&out);
        assert_eq!(err.lines().count(), 1, "{err}");
        assert!(err.contains("sidecars of another store"), "{err}");
        assert!(err.contains("nothing was overwritten or deleted"), "{err}");
        assert!(!new.join("meter.db").exists(), "no store beside the wal");
        assert_eq!(
            fs::read(new.join("meter.db-wal")).unwrap(),
            b"another store"
        );
        assert_eq!(fs::read(old.join("meter.db")).unwrap(), old_db);
    }
    assert_eq!(h.rows(&old), rows);
}

/// Finding 3: a byte-identical `meter.db` in the new dir with no move marker is another store,
/// not an interrupted move: the old files all stay.
#[test]
fn an_identical_store_without_the_marker_leaves_the_old_files_alone() {
    let h = Home::new();
    let rows = h.old_store();
    let old = h.old_dir();
    fs::write(old.join("claude-limits.jsonl"), b"old\n").unwrap();
    let before = names(&old);
    let old_db = fs::read(old.join("meter.db")).unwrap();
    let new = h.new_dir();
    meter::paths::ensure_dir(&new).unwrap();
    fs::copy(old.join("meter.db"), new.join("meter.db")).unwrap();

    let out = h.sync(None);
    let err = stderr(&out);
    assert_eq!(err.lines().count(), 1, "{err}");
    assert!(err.contains("already has a meter.db"), "{err}");
    assert_eq!(names(&old), before, "the old files all stay");
    assert_eq!(fs::read(old.join("meter.db")).unwrap(), old_db);
    assert!(!new.join("claude-limits.jsonl").exists());
    assert_eq!(h.rows(&old), rows);
}

fn sha256_hex(b: &[u8]) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(b)
        .iter()
        .map(|x| format!("{x:02x}"))
        .collect()
}

fn later_row(db: &Path, id: &str) -> bool {
    let c = rusqlite::Connection::open(db).unwrap();
    c.query_row("SELECT count(*) FROM usage WHERE id = ?1", [id], |r| {
        r.get::<_, i64>(0)
    })
    .unwrap()
        == 1
}

fn insert_row(c: &rusqlite::Connection, id: &str) {
    let hour = meter::time::now_ms() / 3_600_000 * 3_600_000;
    c.execute(
        "INSERT INTO usage (id, hour_ms, harness, model, machine, precision, output, events, updated_ms) \
         VALUES (?1, ?2, 'claude', 'model-z', 'm-1', 'exact', 7, 1, ?2)",
        rusqlite::params![id, hour],
    )
    .unwrap();
}

/// Finding 1: the sidecars moved, the run crashed, and an older meter then committed another row
/// to the old database (holding the old lock). The next sync must not finish the move: the old
/// database with the later row stays, the moved sidecars stay, and nothing is opened beside them.
/// Run with the marker a pre-fix build wrote (empty) and with one that records the snapshot.
#[test]
fn a_source_changed_after_an_interrupted_move_is_never_deleted() {
    for valid_marker in [false, true] {
        let h = Home::new();
        h.old_store();
        let old = h.old_dir();
        let db = old.join("meter.db");
        // A real WAL generation: a reader stays open so the writer's close leaves its WAL.
        let reader = rusqlite::Connection::open(&db).unwrap();
        reader
            .query_row("SELECT count(*) FROM usage", [], |r| r.get::<_, i64>(0))
            .unwrap();
        let writer = rusqlite::Connection::open(&db).unwrap();
        insert_row(&writer, "in-the-wal");
        drop(writer);
        let snap: Vec<(&str, Vec<u8>)> = ["meter.db", "meter.db-wal", "meter.db-shm"]
            .into_iter()
            .map(|f| (f, fs::read(old.join(f)).unwrap()))
            .collect();
        assert!(!snap[1].1.is_empty(), "the row is in the wal");
        drop(reader);

        // The crash: the marker is written and the sidecars moved; the database is not.
        let new = h.new_dir();
        meter::paths::ensure_dir(&new).unwrap();
        let marker = if valid_marker {
            let files: serde_json::Map<String, serde_json::Value> = snap
                .iter()
                .map(|(f, b)| {
                    (
                        f.to_string(),
                        serde_json::json!({"len": b.len(), "sha256": sha256_hex(b)}),
                    )
                })
                .collect();
            serde_json::to_vec(&serde_json::json!({"v": 1, "files": files})).unwrap()
        } else {
            Vec::new()
        };
        fs::write(new.join(".meter-migrating"), &marker).unwrap();
        fs::write(&db, &snap[0].1).unwrap();
        for (f, b) in &snap[1..] {
            let _ = fs::remove_file(old.join(f));
            fs::write(new.join(f), b).unwrap();
        }

        // An older meter commits another row to the old database while holding the old lock.
        {
            let _held = meter::paths::try_lock(&old).unwrap().unwrap();
            let c = rusqlite::Connection::open(&db).unwrap();
            insert_row(&c, "later");
        }
        assert!(later_row(&db, "later"));
        let old_db = fs::read(&db).unwrap();

        for _ in 0..2 {
            let out = h.sync(None);
            let err = stderr(&out);
            assert_eq!(err.lines().count(), 1, "marker valid={valid_marker}: {err}");
            assert!(
                err.contains("nothing was overwritten or deleted"),
                "marker valid={valid_marker}: {err}"
            );
            // A recorded snapshot is read and found stale; an empty marker proves nothing.
            let why = if valid_marker {
                "changed since, so"
            } else {
                "cannot be verified"
            };
            assert!(err.contains(why), "marker valid={valid_marker}: {err}");
            assert!(err.contains("nothing syncs until"), "{err}");
            assert_eq!(fs::read(&db).unwrap(), old_db, "the old database stays");
            assert!(
                !new.join("meter.db").exists(),
                "no database beside the moved wal"
            );
            for (f, b) in &snap[1..] {
                assert_eq!(&fs::read(new.join(f)).unwrap(), b, "{f} stays as it was");
            }
            assert_eq!(fs::read(new.join(".meter-migrating")).unwrap(), marker);
        }
        assert!(later_row(&db, "later"), "the later row is still there");
    }
}

/// Finding 4: a directory fsync that fails is an error, and the source stays.
#[cfg(unix)]
#[test]
fn a_failed_directory_fsync_keeps_the_source() {
    use std::os::unix::fs::PermissionsExt;
    let t = tempfile::tempdir().unwrap();
    let (old, new) = (t.path().join("old"), t.path().join("new"));
    fs::create_dir_all(&old).unwrap();
    meter::paths::ensure_dir(&new).unwrap();
    fs::write(old.join("meter.db"), b"db").unwrap();
    fs::write(old.join("meter.db-wal"), b"wal").unwrap();
    // Writable and searchable but not readable: links and renames work, opening the directory
    // to fsync it does not.
    fs::set_permissions(&new, fs::Permissions::from_mode(0o300)).unwrap();
    if fs::File::open(&new).is_ok() {
        // Running as root: the mode does not stop the open.
        fs::set_permissions(&new, fs::Permissions::from_mode(0o700)).unwrap();
        return;
    }
    let r = meter::paths::migrate(&old, &new);
    fs::set_permissions(&new, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(r.is_err(), "{r:?}");
    assert_eq!(fs::read(old.join("meter.db")).unwrap(), b"db");
    assert_eq!(fs::read(old.join("meter.db-wal")).unwrap(), b"wal");
}
