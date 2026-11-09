//! The state directory default and the one-time move out of the pre-0.5.0 default. Spawns the
//! binary with a synthetic HOME in a temp dir, so it runs in its own test binary (see
//! process.rs). No real home path is read or written.

mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::{Mutex, MutexGuard};

use common::*;

/// Every test here takes this first, so they run one at a time. A test that drops a lock and takes
/// it again would otherwise find it still held: a sibling test's child shares every open file of
/// this process between its fork and its exec (see `meter::paths::try_lock`).
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

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
        let out = self.output(args, state_dir);
        assert!(
            out.status.success(),
            "{args:?} exited {:?}: {}{}",
            out.status,
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        out
    }

    /// Runs the binary and returns what it printed and its exit status, success or not.
    fn output(&self, args: &[&str], state_dir: Option<&Path>) -> Output {
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
        c.output().unwrap()
    }

    fn sync(&self, state_dir: Option<&Path>) -> Output {
        self.run(&["sync", "--force", "--no-publish"], state_dir)
    }

    /// A default sync the move blocks: exit 3, nothing on stdout, and its stderr.
    fn blocked(&self) -> String {
        let out = self.output(&["sync", "--force", "--no-publish"], None);
        let err = stderr(&out);
        assert_eq!(out.status.code(), Some(3), "{err}");
        assert!(
            out.stdout.is_empty(),
            "{}",
            String::from_utf8_lossy(&out.stdout)
        );
        err
    }

    fn rows(&self, dir: &Path) -> i64 {
        let out = self.run(&["status"], Some(dir));
        let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        v["rows"].as_i64().unwrap_or(0)
    }

    /// A store made by syncing into the old directory, as a pre-0.5.0 meter would have.
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
    let _serial = serial();
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
    let _serial = serial();
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
    assert!(err.starts_with("meter: copied meter.db"), "{err}");
    assert!(
        err.contains("stay in") && err.contains("until the next successful sync"),
        "{err}"
    );
    assert!(
        err.lines()
            .nth(1)
            .unwrap()
            .contains("prices.json was not moved"),
        "{err}"
    );

    // The old store stays as the recoverable generation until a later sync succeeds.
    let not_unit = |v: Vec<String>| -> Vec<String> {
        v.into_iter()
            .filter(|n| !n.starts_with("meter.db"))
            .collect()
    };
    assert!(old.join("meter.db").is_file());
    assert_eq!(
        not_unit(names(&old)),
        ["Local Storage", "Preferences", "prices.json"]
    );
    assert_eq!(h.rows(&old), rows, "the old store still reads back");
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

    // The next successful sync removes the old copies, and says so.
    let second = stderr(&h.sync(None));
    assert_eq!(second.lines().count(), 1, "{second}");
    assert!(
        second.starts_with("meter: removed the old copies of meter.db"),
        "{second}"
    );
    assert_eq!(names(&old), ["Local Storage", "Preferences", "prices.json"]);
    assert!(!new.join(".meter-moved").exists());

    // Idempotent: a third run finds nothing to move and says nothing.
    let again = h.sync(None);
    assert!(stderr(&again).is_empty(), "{}", stderr(&again));
    assert_eq!(names(&old), ["Local Storage", "Preferences", "prices.json"]);
    assert_eq!(h.rows(&new), rows);
}

/// RFC 0018 (d): the old folder keeps the recoverable generation until the next successful sync.
/// A sync that fails, or one that finds the last sync recent and does nothing, leaves it.
#[test]
fn the_old_copies_stay_until_a_later_sync_succeeds() {
    let _serial = serial();
    let h = Home::new();
    let rows = h.old_store();
    let (old, new) = (h.old_dir(), h.new_dir());
    let old_db = fs::read(old.join("meter.db")).unwrap();

    h.sync(None);
    assert_eq!(
        fs::read(old.join("meter.db")).unwrap(),
        old_db,
        "kept after the move"
    );
    assert!(new.join(".meter-moved").is_file());
    assert_eq!(h.rows(&new), rows);

    // A sync that fails after it opened the new store.
    fs::write(new.join("prices.json"), b"not json").unwrap();
    let out = h.output(&["sync", "--force", "--no-publish"], None);
    assert_eq!(out.status.code(), Some(2), "{}", stderr(&out));
    assert!(stderr(&out).contains("price override"), "{}", stderr(&out));
    assert_eq!(
        fs::read(old.join("meter.db")).unwrap(),
        old_db,
        "kept after a failed sync"
    );
    assert!(new.join(".meter-moved").is_file());
    fs::remove_file(new.join("prices.json")).unwrap();

    // A sync that finds the last one recent syncs nothing.
    let fresh = h.run(&["sync", "--no-publish"], None);
    assert!(
        String::from_utf8_lossy(&fresh.stdout).contains("nothing to do"),
        "{}",
        String::from_utf8_lossy(&fresh.stdout)
    );
    assert_eq!(
        fs::read(old.join("meter.db")).unwrap(),
        old_db,
        "kept after a skipped sync"
    );

    let err = stderr(&h.sync(None));
    assert!(err.starts_with("meter: removed the old copies"), "{err}");
    assert!(
        !old.join("meter.db").exists(),
        "removed by the next successful sync"
    );
    assert!(!old.join("meter.lock").exists());
    assert!(!new.join(".meter-moved").exists());
    assert_eq!(h.rows(&new), rows);
}

/// An older meter that syncs into the old copies before they go makes them a store of its own:
/// kept, never merged or deleted, and named on stderr from then on.
#[test]
fn old_copies_an_older_meter_wrote_to_are_kept_as_a_store() {
    let _serial = serial();
    let h = Home::new();
    let rows = h.old_store();
    let (old, new) = (h.old_dir(), h.new_dir());
    h.sync(None);
    {
        let _held = meter::paths::try_lock(&old).unwrap().unwrap();
        let c = rusqlite::Connection::open(old.join("meter.db")).unwrap();
        insert_row(&c, "later");
    }

    let err = stderr(&h.sync(None));
    assert_eq!(err.lines().count(), 1, "{err}");
    assert!(err.contains("changed after its move"), "{err}");
    assert!(err.contains("nothing was merged or deleted"), "{err}");
    assert!(
        later_row(&old.join("meter.db"), "later"),
        "the later row is kept"
    );
    assert!(!new.join(".meter-moved").exists());
    assert_eq!(h.rows(&new), rows, "the new store is the one in use");

    let err = stderr(&h.sync(None));
    assert!(err.contains("already has a meter.db"), "{err}");
    assert!(later_row(&old.join("meter.db"), "later"));
}

#[test]
fn an_existing_new_store_is_never_overwritten() {
    let _serial = serial();
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
    let _serial = serial();
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
    let _serial = serial();
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
        stderr(&out).starts_with("meter: copied "),
        "{}",
        stderr(&out)
    );
    assert!(h.new_dir().join("meter.db").is_file());
}

#[test]
fn migrate_moves_the_sidecars_with_the_database_and_nothing_else() {
    let _serial = serial();
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
    assert_eq!(m.copied, ["meter.db-wal", "meter.db-shm", "meter.db"]);
    let mut moved = m.moved.clone();
    moved.sort();
    assert_eq!(
        moved,
        [
            "claude-limits.jsonl",
            "claude-limits.last.json",
            "meter.lock"
        ]
    );
    let foreign_only = [
        "Local Storage",
        "Preferences",
        "meter.db.bak",
        "prices.json",
    ];
    let mut with_unit = foreign_only.to_vec();
    with_unit.extend(["meter.db", "meter.db-shm", "meter.db-wal"]);
    with_unit.sort();
    assert_eq!(
        names(&old),
        with_unit,
        "the old unit stays until a sync succeeds"
    );

    let again = meter::paths::migrate(&old, &new).unwrap();
    assert_eq!(
        again,
        meter::paths::Migration {
            old_generation: true,
            ..Default::default()
        },
        "a second run only finds the old generation"
    );
    meter::paths::drop_old_generation(&old, &new).unwrap();
    assert_eq!(names(&old), foreign_only);
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
/// sync before a store is created: exit 3, one stderr line, nothing created or deleted.
#[test]
fn a_foreign_wal_in_the_new_dir_stops_sync_before_a_store_is_made() {
    let _serial = serial();
    let h = Home::new();
    let rows = h.old_store();
    let old = h.old_dir();
    let old_db = fs::read(old.join("meter.db")).unwrap();
    let new = h.new_dir();
    meter::paths::ensure_dir(&new).unwrap();
    fs::write(new.join("meter.db-wal"), b"another store").unwrap();

    for _ in 0..2 {
        let err = h.blocked();
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
    let _serial = serial();
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
    let _serial = serial();
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
            let err = h.blocked();
            assert_eq!(err.lines().count(), 1, "marker valid={valid_marker}: {err}");
            assert!(
                err.contains("nothing was overwritten or deleted"),
                "marker valid={valid_marker}: {err}"
            );
            // A recorded snapshot is read and found stale; an empty marker proves nothing.
            let why = if valid_marker {
                "changed since, so each may hold rows the other lacks"
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
    let _serial = serial();
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

/// A move marker recording these unit files, as `migrate` writes it.
fn marker_of(files: &[(&str, &[u8])]) -> Vec<u8> {
    let files: serde_json::Map<String, serde_json::Value> = files
        .iter()
        .map(|(f, b)| {
            let print = serde_json::json!({"len": b.len(), "sha256": sha256_hex(b)});
            (f.to_string(), print)
        })
        .collect();
    serde_json::to_vec(&serde_json::json!({"v": 1, "files": files})).unwrap()
}

/// Round 2, finding 1: a resumed move adopts the files an earlier run already linked into the new
/// directory. It fsyncs them and the directory before it removes an old name, so a directory that
/// cannot be fsynced stops the run with the source database still in place.
#[cfg(unix)]
#[test]
fn a_resumed_move_fsyncs_what_it_adopts_before_removing_the_source() {
    let _serial = serial();
    use std::os::unix::fs::PermissionsExt;
    let t = tempfile::tempdir().unwrap();
    let (old, new) = (t.path().join("old"), t.path().join("new"));
    fs::create_dir_all(&old).unwrap();
    meter::paths::ensure_dir(&new).unwrap();
    let db = old.join("meter.db");
    {
        let c = rusqlite::Connection::open(&db).unwrap();
        c.execute_batch(
            "CREATE TABLE usage (id TEXT PRIMARY KEY); INSERT INTO usage VALUES('base');",
        )
        .unwrap();
    }
    assert!(
        !old.join("meter.db-wal").exists(),
        "a rollback journal leaves no wal"
    );
    // The earlier run wrote its marker and linked the database, then stopped before the fsync.
    let bytes = fs::read(&db).unwrap();
    fs::write(
        new.join(".meter-migrating"),
        marker_of(&[("meter.db", &bytes)]),
    )
    .unwrap();
    fs::hard_link(&db, new.join("meter.db")).unwrap();
    // Writable and searchable but not readable: the files inside open, the directory does not.
    fs::set_permissions(&new, fs::Permissions::from_mode(0o300)).unwrap();
    if fs::File::open(&new).is_ok() {
        // Running as root: the mode does not stop the open.
        fs::set_permissions(&new, fs::Permissions::from_mode(0o700)).unwrap();
        return;
    }
    let r = meter::paths::migrate(&old, &new);
    fs::set_permissions(&new, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(r.is_err(), "{r:?}");
    assert!(db.exists(), "the source database stays");
    assert!(later_row(&db, "base"), "with its row");
}

fn ids(db: &Path) -> Vec<String> {
    let c = rusqlite::Connection::open(db).unwrap();
    let mut st = c.prepare("SELECT id FROM usage ORDER BY id").unwrap();
    st.query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

/// Round 2, finding 2: an interrupted move left a whole copied generation in the new directory
/// (its database and the wal holding a committed row), the old sidecars were gone, and an older
/// meter then committed another row to the old database. Old: base + later. New: base +
/// in-the-wal. The meter cannot tell which to keep, so it keeps both exactly as they are, uses
/// neither, and says so; all three rows survive every sync.
#[test]
fn two_stores_that_grew_apart_are_both_kept_and_neither_is_used() {
    let _serial = serial();
    let h = Home::new();
    h.old_store();
    let (old, new) = (h.old_dir(), h.new_dir());
    let db = old.join("meter.db");
    let base = ids(&db);
    assert!(!base.is_empty());
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

    // The crash: every unit file was copied into the new dir and the old sidecars were removed;
    // the old database was not.
    meter::paths::ensure_dir(&new).unwrap();
    let marker = marker_of(&snap.iter().map(|(f, b)| (*f, &b[..])).collect::<Vec<_>>());
    fs::write(new.join(".meter-migrating"), &marker).unwrap();
    fs::write(&db, &snap[0].1).unwrap();
    for (f, b) in &snap {
        fs::write(new.join(f), b).unwrap();
    }
    for (f, _) in &snap[1..] {
        let _ = fs::remove_file(old.join(f));
    }
    {
        let _held = meter::paths::try_lock(&old).unwrap().unwrap();
        let c = rusqlite::Connection::open(&db).unwrap();
        insert_row(&c, "later");
    }
    let old_db = fs::read(&db).unwrap();

    for _ in 0..2 {
        let err = h.blocked();
        assert_eq!(err.lines().count(), 1, "{err}");
        for want in [
            "each may hold rows the other lacks",
            "nothing was overwritten or deleted",
            "neither store is used",
            "nothing syncs until both are saved and one is chosen",
        ] {
            assert!(err.contains(want), "{want}: {err}");
        }
        assert!(!err.contains("store to keep"), "{err}");
        assert_eq!(fs::read(&db).unwrap(), old_db, "the old store stays");
        for (f, b) in &snap {
            assert_eq!(&fs::read(new.join(f)).unwrap(), b, "{f} stays as it was");
        }
        assert_eq!(fs::read(new.join(".meter-migrating")).unwrap(), marker);
    }

    // Read the new generation from a copy: opening it in place would replay and remove its wal.
    let saved = tempfile::tempdir().unwrap();
    for (f, _) in &snap {
        fs::copy(new.join(f), saved.path().join(f)).unwrap();
    }
    let with = |extra: &str| {
        let mut v = base.clone();
        v.push(extra.to_string());
        v.sort();
        v
    };
    assert_eq!(ids(&db), with("later"), "old: base and later");
    assert_eq!(
        ids(&saved.path().join("meter.db")),
        with("in-the-wal"),
        "new: base and in-the-wal"
    );
}

/// The old database's three unit files as they are while a reader keeps its wal open: `base`
/// plus a row committed only to the wal. Puts them back in `old` and returns their bytes.
fn wal_generation(old: &Path) -> Vec<(&'static str, Vec<u8>)> {
    let db = old.join("meter.db");
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
    for (f, b) in &snap {
        fs::write(old.join(f), b).unwrap();
    }
    snap
}

/// An older meter's write: many wide rows, then a close that checkpoints into the database file.
fn later_rows(db: &Path, n: usize) -> Vec<String> {
    let c = rusqlite::Connection::open(db).unwrap();
    let hour = meter::time::now_ms() / 3_600_000 * 3_600_000;
    let ids: Vec<String> = (0..n).map(|i| format!("later-{i:04}")).collect();
    for id in &ids {
        c.execute(
            "INSERT INTO usage (id, hour_ms, harness, model, machine, precision, output, events, \
             updated_ms) VALUES (?1, ?2, 'claude', ?3, 'm-1', 'exact', 7, 1, ?2)",
            rusqlite::params![id, hour, "m".repeat(1000)],
        )
        .unwrap();
    }
    ids
}

fn integrity_ok(db: &Path) -> bool {
    let c = rusqlite::Connection::open(db).unwrap();
    c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
        .map(|v| v == "ok")
        .unwrap_or(false)
}

/// Round 3, finding 1: a move interrupted after it placed the database unit, then an older meter
/// writes and checkpoints into the old database. The new dir's copy must be a file of its own:
/// a hard link would share the inode the older meter just rewrote, and the new generation (its
/// database and the wal holding a committed row) would no longer read back.
#[cfg(unix)]
#[test]
fn the_database_unit_is_copied_so_an_older_meter_cannot_rewrite_the_new_copy() {
    let _serial = serial();
    use std::os::unix::fs::MetadataExt;
    let h = Home::new();
    h.old_store();
    let (old, new) = (h.old_dir(), h.new_dir());
    let db = old.join("meter.db");
    let mut base = ids(&db);
    fs::write(old.join("meter.lock"), b"").unwrap();
    let snap = wal_generation(&old);
    meter::paths::ensure_dir(&new).unwrap();

    let m = meter::paths::migrate(&old, &new).unwrap();
    assert_eq!(m.copied, ["meter.db-wal", "meter.db-shm", "meter.db"]);
    for (f, b) in &snap {
        let (o, n) = (old.join(f), new.join(f));
        assert_eq!(&fs::read(&n).unwrap(), b, "{f} was placed");
        assert_ne!(
            o.metadata().unwrap().ino(),
            n.metadata().unwrap().ino(),
            "{f} in the new dir is a file of its own"
        );
    }

    // The interruption, as an earlier build could leave it: the move had not finished (its marker
    // still says moving) and the old sidecars were gone. An older meter then writes under the old
    // lock.
    fs::rename(new.join(".meter-moved"), new.join(".meter-migrating")).unwrap();
    for (f, _) in &snap[1..] {
        fs::remove_file(old.join(f)).unwrap();
    }
    let later = {
        let _held = meter::paths::try_lock(&old).unwrap().unwrap();
        later_rows(&db, 100)
    };
    for _ in 0..2 {
        let err = h.blocked();
        assert!(err.contains("neither store is used"), "{err}");
        for (f, b) in &snap {
            assert_eq!(&fs::read(new.join(f)).unwrap(), b, "{f} stays as it was");
        }
    }

    let saved = tempfile::tempdir().unwrap();
    for (f, _) in &snap {
        fs::copy(new.join(f), saved.path().join(f)).unwrap();
    }
    let saved_db = saved.path().join("meter.db");
    assert!(integrity_ok(&saved_db), "the new generation reads back");
    let mut want_new = base.clone();
    want_new.push("in-the-wal".into());
    want_new.sort();
    assert_eq!(ids(&saved_db), want_new, "new: base and in-the-wal");
    assert!(integrity_ok(&db));
    base.extend(later);
    base.sort();
    assert_eq!(ids(&db), base, "old: base and the later rows");
}

fn unit_bytes(dirs: &[&Path]) -> Vec<Option<Vec<u8>>> {
    dirs.iter()
        .flat_map(|d| {
            [
                "meter.db",
                "meter.db-wal",
                "meter.db-shm",
                ".meter-migrating",
            ]
            .map(|f| d.join(f))
        })
        .map(|p| fs::read(p).ok())
        .collect()
}

/// Round 3, finding 2: the reviewer's layout. An earlier build hard-linked the unit into the new
/// dir, the old sidecars went, and an older meter committed a row to the shared database. `status`
/// must open nothing while the move is unfinished: replaying the new dir's wal would write into
/// the database file both directories share.
#[test]
fn status_opens_nothing_while_a_move_is_unfinished() {
    let _serial = serial();
    let h = Home::new();
    h.old_store();
    let (old, new) = (h.old_dir(), h.new_dir());
    let db = old.join("meter.db");
    let snap = wal_generation(&old);
    meter::paths::ensure_dir(&new).unwrap();
    let files: Vec<(&str, &[u8])> = snap.iter().map(|(f, b)| (*f, &b[..])).collect();
    fs::write(new.join(".meter-migrating"), marker_of(&files)).unwrap();
    for (f, _) in &snap {
        fs::hard_link(old.join(f), new.join(f)).unwrap();
    }
    for (f, _) in &snap[1..] {
        fs::remove_file(old.join(f)).unwrap();
    }
    {
        let _held = meter::paths::try_lock(&old).unwrap().unwrap();
        let c = rusqlite::Connection::open(&db).unwrap();
        insert_row(&c, "later");
    }
    let before = unit_bytes(&[&old, &new]);

    for _ in 0..2 {
        let out = h.output(&["status"], None);
        let err = stderr(&out);
        assert_eq!(out.status.code(), Some(2), "{err}");
        assert!(
            err.contains("has not finished, so status opens nothing"),
            "{err}"
        );
        assert!(out.stdout.is_empty());
        assert_eq!(
            unit_bytes(&[&old, &new]),
            before,
            "no byte of either store changed"
        );
    }
    let saved = tempfile::tempdir().unwrap();
    fs::copy(&db, saved.path().join("meter.db")).unwrap();
    assert!(
        later_row(&saved.path().join("meter.db"), "later"),
        "the later row is kept"
    );
}

/// Round 3, finding 2: `status` reads a store without writing it. A row committed only to the wal
/// is counted, and the database and the wal keep their bytes (no checkpoint on close). It waits
/// for nobody: while a sync holds the lock it says so and opens nothing.
#[test]
fn status_reads_the_store_without_checkpointing_it() {
    let _serial = serial();
    let h = Home::new();
    let rows = h.old_store();
    let dir = h.old_dir();
    wal_generation(&dir);
    let (db, wal) = (
        fs::read(dir.join("meter.db")).unwrap(),
        fs::read(dir.join("meter.db-wal")).unwrap(),
    );

    assert_eq!(h.rows(&dir), rows + 1, "the wal's row is counted");
    assert_eq!(
        fs::read(dir.join("meter.db")).unwrap(),
        db,
        "the database is not written"
    );
    assert_eq!(
        fs::read(dir.join("meter.db-wal")).unwrap(),
        wal,
        "the wal is not checkpointed"
    );

    let _held = meter::paths::try_lock(&dir).unwrap().unwrap();
    let out = h.output(&["status"], Some(&dir));
    assert_eq!(out.status.code(), Some(2));
    assert!(
        stderr(&out).contains("another sync is running"),
        "{}",
        stderr(&out)
    );
}
