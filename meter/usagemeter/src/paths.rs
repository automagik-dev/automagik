//! Where the meter keeps its state, the single-flight lock, and the one-time move out of the old
//! default directory.
//!
//! - `METER_STATE_DIR` if set (tests, trials). It wins over everything and turns the move off.
//! - Else `$AM_HOME/meter/` if `AM_HOME` is an absolute path.
//! - Else `~/.automagik/meter/`, on every OS.
//!
//! The directory is created 0700 and the database 0600.
//!
//! Before 0.4.0 the default was `~/Library/Application Support/automagik/` on macOS and
//! `$XDG_STATE_HOME/automagik/` (else `~/.local/state/automagik/`) elsewhere. On a
//! case-insensitive macOS volume that is the same folder as the Automagik desktop app's own data,
//! so wiping the app's local data deleted the store. [`migrate`] moves the meter's own files out
//! of it once, under the new directory's lock.

use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

pub fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
}

/// The state directory, and the old default directory to move files out of (None when
/// `METER_STATE_DIR` chose the directory).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateDirs {
    pub dir: PathBuf,
    pub legacy: Option<PathBuf>,
}

fn absolute(v: Option<OsString>) -> Option<PathBuf> {
    v.filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
}

/// Resolves the state directories from an environment lookup (`std::env::var_os` in the binary).
pub fn state_dirs(var: impl Fn(&str) -> Option<OsString>) -> Option<StateDirs> {
    if let Some(d) = var("METER_STATE_DIR").filter(|d| !d.is_empty()) {
        return Some(StateDirs {
            dir: PathBuf::from(d),
            legacy: None,
        });
    }
    let home = var("HOME").filter(|h| !h.is_empty()).map(PathBuf::from);
    let dir = match absolute(var("AM_HOME")) {
        Some(am) => am.join("meter"),
        None => home.as_ref()?.join(".automagik/meter"),
    };
    let legacy = home
        .map(|h| legacy_state_dir(&h, absolute(var("XDG_STATE_HOME"))))
        .filter(|l| *l != dir);
    Some(StateDirs { dir, legacy })
}

/// The default state directory before 0.4.0.
pub fn legacy_state_dir(home: &Path, xdg_state_home: Option<PathBuf>) -> PathBuf {
    if cfg!(target_os = "macos") {
        return home.join("Library/Application Support/automagik");
    }
    match xdg_state_home {
        Some(x) => x.join("automagik"),
        None => home.join(".local/state/automagik"),
    }
}

pub fn default_state_dir() -> Option<PathBuf> {
    state_dirs(|k| std::env::var_os(k)).map(|d| d.dir)
}

#[cfg(unix)]
fn set_mode(p: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(p, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_mode(_: &Path, _: u32) -> io::Result<()> {
    Ok(())
}

/// Creates the state directory 0700 if missing, and tightens its mode if looser.
pub fn ensure_dir(state_dir: &Path) -> io::Result<()> {
    if let Some(parent) = state_dir.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut b = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    match b.create(state_dir) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists && state_dir.is_dir() => {}
        Err(e) => return Err(e),
    }
    set_mode(state_dir, 0o700)
}

/// Creates the state directory (0700) and the database file (0600) if missing, and tightens the
/// modes if they are looser.
pub fn prepare(state_dir: &Path) -> io::Result<PathBuf> {
    ensure_dir(state_dir)?;
    let db = state_dir.join("meter.db");
    let mut o = OpenOptions::new();
    o.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    drop(o.open(&db)?);
    set_mode(&db, 0o600)?;
    Ok(db)
}

fn lock(f: File) -> io::Result<Option<File>> {
    match f.try_lock() {
        Ok(()) => Ok(Some(f)),
        Err(fs::TryLockError::WouldBlock) => Ok(None),
        Err(fs::TryLockError::Error(e)) => Err(e),
    }
}

/// A non-blocking exclusive lock on `meter.lock`. None means another run holds it.
pub fn try_lock(state_dir: &Path) -> io::Result<Option<File>> {
    let mut o = OpenOptions::new();
    o.create(true).truncate(false).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    lock(o.open(state_dir.join("meter.lock"))?)
}

/// The database and its SQLite sidecars, moved as one unit: sidecars first, the database last,
/// so a crash never leaves a moved database without its write-ahead log.
const DB_UNIT: [&str; 3] = ["meter.db-wal", "meter.db-shm", "meter.db"];
/// Moved one by one.
const LOOSE: [&str; 2] = ["claude-limits.jsonl", "claude-limits.last.json"];
/// Every file the move may touch in the old directory. Nothing else there is opened.
pub const MIGRATED_FILES: [&str; 6] = [
    "meter.db",
    "meter.db-wal",
    "meter.db-shm",
    "meter.lock",
    "claude-limits.jsonl",
    "claude-limits.last.json",
];

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Migration {
    /// An old-version meter holds the old directory's lock: nothing was moved, try next run.
    pub busy: bool,
    /// Files now in the new directory (moved this run, or a crashed run's move finished).
    pub moved: Vec<&'static str>,
    /// Files left in the old directory because the new one already has a different file.
    pub kept: Vec<&'static str>,
}

fn exists(p: &Path) -> bool {
    p.symlink_metadata().is_ok()
}

fn sync_dir(dir: &Path) {
    // Best effort: not every filesystem syncs a directory handle.
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
}

#[cfg(unix)]
fn same_inode(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}

#[cfg(not(unix))]
fn same_inode(_: &fs::Metadata, _: &fs::Metadata) -> bool {
    false
}

/// Byte-for-byte equal regular files (or two names of one file).
fn same_file(a: &Path, b: &Path) -> io::Result<bool> {
    let (ma, mb) = (a.symlink_metadata()?, b.symlink_metadata()?);
    if !ma.is_file() || !mb.is_file() {
        return Ok(false);
    }
    if same_inode(&ma, &mb) {
        return Ok(true);
    }
    if ma.len() != mb.len() {
        return Ok(false);
    }
    let (mut fa, mut fb) = (File::open(a)?, File::open(b)?);
    let (mut ba, mut bb) = (vec![0u8; 64 << 10], vec![0u8; 64 << 10]);
    loop {
        let n = fa.read(&mut ba)?;
        if n == 0 {
            return Ok(fb.read(&mut bb[..1])? == 0);
        }
        fb.read_exact(&mut bb[..n])?;
        if ba[..n] != bb[..n] {
            return Ok(false);
        }
    }
}

/// Copies `src` to `dst` through a temporary file in `dst`'s directory: fsync, compare with the
/// source, then rename into place. The mode is the source's. Refuses to replace `dst`.
pub fn copy_verified(src: &Path, dst: &Path) -> io::Result<()> {
    let dir = dst.parent().unwrap_or(Path::new("."));
    let name = dst.file_name().unwrap_or_default().to_string_lossy();
    let part = dir.join(format!(".{name}.part"));
    fs::copy(src, &part)?;
    File::open(&part)?.sync_all()?;
    set_mode_like(&part, src)?;
    if !same_file(src, &part)? {
        let _ = fs::remove_file(&part);
        return Err(io::Error::other(format!(
            "{} changed while it was copied",
            src.display()
        )));
    }
    if exists(dst) {
        let _ = fs::remove_file(&part);
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("{} appeared during the copy", dst.display()),
        ));
    }
    fs::rename(&part, dst)?;
    sync_dir(dir);
    Ok(())
}

#[cfg(unix)]
fn set_mode_like(p: &Path, like: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    set_mode(p, like.metadata()?.permissions().mode() & 0o7777)
}

#[cfg(not(unix))]
fn set_mode_like(_: &Path, _: &Path) -> io::Result<()> {
    Ok(())
}

enum Step {
    Absent,
    Moved,
    Kept,
}

/// Puts `old/name` at `new/name` without ever replacing a file there: a hard link (same
/// filesystem, the same inode so the mode stays), else a verified copy; then removes the old
/// name. A crash between the two leaves two names of the same bytes, which the next run sees as
/// identical and finishes.
fn move_file(old: &Path, new: &Path, name: &'static str, force_copy: bool) -> io::Result<Step> {
    let (src, dst) = (old.join(name), new.join(name));
    if !exists(&src) {
        return Ok(Step::Absent);
    }
    if exists(&dst) {
        if !same_file(&src, &dst)? {
            return Ok(Step::Kept);
        }
    } else {
        let linked = if force_copy {
            Err(io::Error::from(io::ErrorKind::Unsupported))
        } else {
            fs::hard_link(&src, &dst)
        };
        match linked {
            Ok(()) => sync_dir(new),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Ok(Step::Kept),
            // Another filesystem (or one without hard links).
            Err(_) => copy_verified(&src, &dst)?,
        }
    }
    fs::remove_file(&src)?;
    sync_dir(old);
    Ok(Step::Moved)
}

/// Moves the meter's own files from the old default directory into `new` (see
/// [`MIGRATED_FILES`]); every other file in `old` is left alone, and `old` itself is never
/// removed. The caller holds `new`'s lock. Idempotent: a finished move finds nothing to do, and a
/// crashed one is finished. When `new` already has a different database the old files stay
/// where they are and one line goes to stderr.
pub fn migrate(old: &Path, new: &Path) -> io::Result<Migration> {
    migrate_with(old, new, false)
}

#[doc(hidden)]
pub fn migrate_with(old: &Path, new: &Path, force_copy: bool) -> io::Result<Migration> {
    let mut m = Migration::default();
    if old == new || !MIGRATED_FILES.iter().any(|f| exists(&old.join(f))) {
        return Ok(m);
    }
    // An old-version meter may be mid-sync against the old directory. Its lock file is opened
    // only if it is there; none is created.
    let old_lock = match OpenOptions::new().write(true).open(old.join("meter.lock")) {
        Ok(f) => match lock(f)? {
            Some(l) => Some(l),
            None => {
                m.busy = true;
                return Ok(m);
            }
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };

    // The database unit moves only with its database, and only if no file of the unit is in the
    // way: moving a database next to someone else's write-ahead log would corrupt it.
    if exists(&old.join("meter.db")) {
        let mut blocked = false;
        for f in DB_UNIT {
            let (src, dst) = (old.join(f), new.join(f));
            if exists(&src) && exists(&dst) && !same_file(&src, &dst)? {
                blocked = true;
            }
        }
        if blocked {
            m.kept
                .extend(DB_UNIT.iter().filter(|f| exists(&old.join(f))));
        } else {
            for f in DB_UNIT {
                if let Step::Moved = move_file(old, new, f, force_copy)? {
                    m.moved.push(f);
                }
            }
        }
    }
    for f in LOOSE {
        match move_file(old, new, f, force_copy)? {
            Step::Moved => m.moved.push(f),
            Step::Kept => m.kept.push(f),
            Step::Absent => {}
        }
    }
    // The lock file is empty and `new` has its own (held by the caller): the old one is removed,
    // never moved onto the held one. It stays while anything else stays.
    if m.kept.is_empty() && old_lock.is_some() {
        fs::remove_file(old.join("meter.lock"))?;
        sync_dir(old);
        m.moved.push("meter.lock");
    }
    drop(old_lock);

    if !m.kept.is_empty() {
        let why = if m.kept.contains(&"meter.db") {
            format!("{} already has a meter.db", new.display())
        } else {
            format!("{} already has different copies", new.display())
        };
        eprintln!(
            "meter: left {} in {}: {why}; nothing was overwritten or deleted",
            m.kept.join(", "),
            old.display()
        );
    } else if !m.moved.is_empty() {
        eprintln!(
            "meter: moved {} from {} to {}",
            m.moved.join(", "),
            old.display(),
            new.display()
        );
    }
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |k| {
            pairs
                .iter()
                .find(|(n, _)| *n == k)
                .map(|(_, v)| OsString::from(v))
        }
    }

    #[test]
    fn the_default_is_home_automagik_meter_on_every_os() {
        let d = state_dirs(env(&[("HOME", "/h")])).unwrap();
        assert_eq!(d.dir, PathBuf::from("/h/.automagik/meter"));
        let want = if cfg!(target_os = "macos") {
            "/h/Library/Application Support/automagik"
        } else {
            "/h/.local/state/automagik"
        };
        assert_eq!(d.legacy, Some(PathBuf::from(want)));
        let x = state_dirs(env(&[("HOME", "/h"), ("XDG_STATE_HOME", "/x")])).unwrap();
        assert_eq!(x.dir, PathBuf::from("/h/.automagik/meter"));
        if !cfg!(target_os = "macos") {
            assert_eq!(x.legacy, Some(PathBuf::from("/x/automagik")));
        }
    }

    #[test]
    fn am_home_moves_it_and_meter_state_dir_wins_without_a_migration() {
        let a = state_dirs(env(&[("HOME", "/h"), ("AM_HOME", "/am")])).unwrap();
        assert_eq!(a.dir, PathBuf::from("/am/meter"));
        assert!(a.legacy.is_some(), "AM_HOME still moves the old default");
        let rel = state_dirs(env(&[("HOME", "/h"), ("AM_HOME", "rel")])).unwrap();
        assert_eq!(rel.dir, PathBuf::from("/h/.automagik/meter"));
        let o = state_dirs(env(&[
            ("HOME", "/h"),
            ("AM_HOME", "/am"),
            ("METER_STATE_DIR", "/s"),
        ]))
        .unwrap();
        assert_eq!(
            o,
            StateDirs {
                dir: PathBuf::from("/s"),
                legacy: None
            }
        );
        assert_eq!(state_dirs(env(&[])), None);
        let no_home = state_dirs(env(&[("AM_HOME", "/am")])).unwrap();
        assert_eq!(no_home.legacy, None);
    }

    #[test]
    fn prepares_private_state_and_single_flight_lock() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join("s");
        let db = prepare(&state).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&state).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&db).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let first = try_lock(&state).unwrap();
        assert!(first.is_some());
        assert!(
            try_lock(&state).unwrap().is_none(),
            "second lock must not be granted"
        );
        drop(first);
        assert!(try_lock(&state).unwrap().is_some());
    }

    #[test]
    fn the_copy_fallback_verifies_keeps_the_mode_and_never_replaces() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("old"), t.path().join("new"));
        fs::create_dir_all(&old).unwrap();
        ensure_dir(&new).unwrap();
        fs::write(old.join("meter.db"), b"db").unwrap();
        fs::write(old.join("meter.db-wal"), b"wal").unwrap();
        fs::write(old.join("claude-limits.jsonl"), b"{}\n").unwrap();
        #[cfg(unix)]
        set_mode(&old.join("claude-limits.jsonl"), 0o640).unwrap();
        let m = migrate_with(&old, &new, true).unwrap();
        assert_eq!(
            m.moved,
            vec!["meter.db-wal", "meter.db", "claude-limits.jsonl"]
        );
        assert_eq!(fs::read(new.join("meter.db")).unwrap(), b"db");
        assert_eq!(fs::read(new.join("meter.db-wal")).unwrap(), b"wal");
        assert!(!exists(&old.join("meter.db")));
        assert!(!exists(&new.join(".meter.db.part")));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&new.join("claude-limits.jsonl")), 0o640);
        }
        fs::write(t.path().join("a"), b"a").unwrap();
        fs::write(t.path().join("b"), b"b").unwrap();
        let e = copy_verified(&t.path().join("a"), &t.path().join("b")).unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(t.path().join("b")).unwrap(), b"b");
    }

    #[test]
    fn a_move_interrupted_after_the_link_is_finished() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("old"), t.path().join("new"));
        fs::create_dir_all(&old).unwrap();
        ensure_dir(&new).unwrap();
        fs::write(old.join("meter.db-wal"), b"wal").unwrap();
        fs::write(old.join("meter.db"), b"db").unwrap();
        // The crash: the wal moved, the database is linked into place but not yet unlinked.
        fs::rename(old.join("meter.db-wal"), new.join("meter.db-wal")).unwrap();
        fs::hard_link(old.join("meter.db"), new.join("meter.db")).unwrap();
        let m = migrate(&old, &new).unwrap();
        assert_eq!(m.moved, vec!["meter.db"]);
        assert!(m.kept.is_empty());
        assert!(!exists(&old.join("meter.db")));
        assert_eq!(fs::read(new.join("meter.db")).unwrap(), b"db");
        assert_eq!(fs::read(new.join("meter.db-wal")).unwrap(), b"wal");
    }
}
