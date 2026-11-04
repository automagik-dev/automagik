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

/// The database and its SQLite sidecars, moved as one unit: every file is placed in the new
/// directory before any old name is removed (sidecars first, the database last).
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
    /// The new directory holds files the move cannot prove are its own and no store beside them
    /// may be opened or created: sync does nothing this run (the stderr line says why).
    pub stop: bool,
}

fn exists(p: &Path) -> bool {
    p.symlink_metadata().is_ok()
}

/// Makes a directory's entries durable. A failure is an error: the move never removes an old
/// name it could not prove is durable in the new directory.
#[cfg(unix)]
fn sync_dir(dir: &Path) -> io::Result<()> {
    File::open(dir)?.sync_all()
}

/// A directory cannot be opened as a file here.
#[cfg(not(unix))]
fn sync_dir(_: &Path) -> io::Result<()> {
    Ok(())
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
    sync_dir(dir)
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

/// Puts `src` at `dst` without ever replacing a file there: a hard link (same filesystem, the
/// same inode so the mode stays), else a verified copy. Returns once `dst` is durable.
fn place(src: &Path, dst: &Path, force_copy: bool) -> io::Result<()> {
    let linked = if force_copy {
        Err(io::Error::from(io::ErrorKind::Unsupported))
    } else {
        fs::hard_link(src, dst)
    };
    match linked {
        Ok(()) => sync_dir(dst.parent().unwrap_or(Path::new("."))),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Err(e),
        // Another filesystem (or one without hard links).
        Err(_) => copy_verified(src, dst),
    }
}

/// Moves `old/name` to `new/name`, never replacing a file there, then removes the old name. A
/// file already at `new/name` is taken as this move's own only when `adopt` (a verified move
/// marker) and it has the same bytes; otherwise the old file stays.
fn move_file(
    old: &Path,
    new: &Path,
    name: &'static str,
    force_copy: bool,
    adopt: bool,
) -> io::Result<Step> {
    let (src, dst) = (old.join(name), new.join(name));
    if !exists(&src) {
        return Ok(Step::Absent);
    }
    if exists(&dst) {
        if !(adopt && same_file(&src, &dst)?) {
            return Ok(Step::Kept);
        }
        // An interrupted run may have placed it and stopped before the fsync.
        File::open(&dst)?.sync_all()?;
        sync_dir(new)?;
    } else {
        match place(&src, &dst, force_copy) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Ok(Step::Kept),
            Err(e) => return Err(e),
        }
    }
    fs::remove_file(&src)?;
    sync_dir(old)?;
    Ok(Step::Moved)
}

/// Moves the meter's own files from the old default directory into `new` (see
/// [`MIGRATED_FILES`]); every other file in `old` is left alone, and `old` itself is never
/// removed. The caller holds `new`'s lock. Idempotent: a finished move finds nothing to do, and a
/// crashed one is finished when its files are still exactly what it started from. When `new`
/// already has a store, or anything the move cannot prove is its own, the old files stay where
/// they are and one line goes to stderr; [`Migration::stop`] says whether `new` is usable.
pub fn migrate(old: &Path, new: &Path) -> io::Result<Migration> {
    migrate_with(old, new, false)
}

/// Written in the new directory (atomically, fsynced) before any file of the database unit moves,
/// and removed once every file moved. It records the length and SHA-256 of each unit file as the
/// move started, so a resumed move finishes only the generation it started.
const MOVING: &str = ".meter-migrating";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct Print {
    len: u64,
    sha256: String,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct Snapshot {
    v: u32,
    files: std::collections::BTreeMap<String, Print>,
}

enum Marker {
    Absent,
    /// Present but not a snapshot this version wrote (empty, truncated, foreign): proves nothing.
    Invalid,
    Valid(Snapshot),
}

/// The length and hash of a regular file; None when absent.
fn print(p: &Path) -> io::Result<Option<Print>> {
    use sha2::Digest;
    let md = match p.symlink_metadata() {
        Ok(md) => md,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    if !md.is_file() {
        return Err(io::Error::other(format!(
            "{} is not a regular file",
            p.display()
        )));
    }
    let (mut f, mut h, mut buf) = (File::open(p)?, sha2::Sha256::new(), vec![0u8; 64 << 10]);
    let mut len = 0u64;
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        len += n as u64;
    }
    Ok(Some(Print {
        len,
        sha256: crate::event::hex(&h.finalize()),
    }))
}

fn snapshot(old: &Path) -> io::Result<Snapshot> {
    let mut files = std::collections::BTreeMap::new();
    for f in DB_UNIT {
        if let Some(p) = print(&old.join(f))? {
            files.insert(f.to_string(), p);
        }
    }
    Ok(Snapshot { v: 1, files })
}

fn read_marker(new: &Path) -> io::Result<Marker> {
    let bytes = match fs::read(new.join(MOVING)) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Marker::Absent),
        Err(e) => return Err(e),
    };
    Ok(match serde_json::from_slice::<Snapshot>(&bytes) {
        Ok(s)
            if s.v == 1
                && s.files.contains_key("meter.db")
                && s.files.keys().all(|k| DB_UNIT.contains(&k.as_str())) =>
        {
            Marker::Valid(s)
        }
        _ => Marker::Invalid,
    })
}

fn write_marker(new: &Path, s: &Snapshot) -> io::Result<()> {
    use std::io::Write;
    let part = new.join(format!("{MOVING}.part"));
    let mut f = File::create(&part)?;
    f.write_all(&serde_json::to_vec(s)?)?;
    f.sync_all()?;
    fs::rename(&part, new.join(MOVING))?;
    sync_dir(new)
}

/// Whether the unit files in `old` and `new` are exactly the snapshot: each recorded file in one
/// directory or both (two copies of the same bytes), and no other unit file in either.
fn unchanged(s: &Snapshot, old: &Path, new: &Path) -> io::Result<bool> {
    for f in DB_UNIT {
        let (src, dst) = (print(&old.join(f))?, print(&new.join(f))?);
        let ok = match s.files.get(f) {
            None => src.is_none() && dst.is_none(),
            Some(want) => {
                (src.is_some() || dst.is_some()) && src.iter().chain(dst.iter()).all(|p| p == want)
            }
        };
        if !ok {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Why the database unit stays in the old directory.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Why {
    /// `new` has a `meter.db` this move did not put there: a store of its own, used as is.
    Store,
    /// `new` has a `meter.db-wal` or `meter.db-shm` but no `meter.db`, and no move marker.
    Sidecars,
    /// An interrupted move's marker no longer matches the files: the old ones changed since.
    Changed,
    /// Unit files sit beside a marker this version cannot read.
    Unproven,
}

/// The same directory under two names (a symlink, a case-insensitive volume).
#[cfg(unix)]
fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.metadata(), b.metadata()) {
        (Ok(ma), Ok(mb)) => same_inode(&ma, &mb),
        _ => false,
    }
}

#[cfg(not(unix))]
fn same_dir(a: &Path, b: &Path) -> bool {
    matches!((a.canonicalize(), b.canonicalize()), (Ok(x), Ok(y)) if x == y)
}

#[doc(hidden)]
pub fn migrate_with(old: &Path, new: &Path, force_copy: bool) -> io::Result<Migration> {
    let mut m = Migration::default();
    if old == new || same_dir(old, new) || !MIGRATED_FILES.iter().any(|f| exists(&old.join(f))) {
        return Ok(m);
    }
    // An older meter may be mid-sync against the old directory. Its lock is taken for the whole
    // move, and created (empty) if missing, so an older meter starting now waits for the next run
    // instead of opening a store that is being moved.
    let had_lock = exists(&old.join("meter.lock"));
    let Some(old_lock) = try_lock(old)? else {
        m.busy = true;
        return Ok(m);
    };

    // A unit file in `new` is this move's own only under a marker whose snapshot still matches
    // every unit file in both directories. Without that proof nothing is moved or deleted: a
    // database put beside another generation's write-ahead log loses rows on its replay.
    let old_db = exists(&old.join("meter.db"));
    let unit_in_new = DB_UNIT.iter().any(|f| exists(&new.join(f)));
    let mut moving = false;
    let why = match read_marker(new)? {
        Marker::Valid(s) if unit_in_new => {
            moving = unchanged(&s, old, new)?;
            (!moving).then_some(Why::Changed)
        }
        Marker::Invalid if unit_in_new => Some(Why::Unproven),
        // No unit file in `new`: a marker there is stale (nothing moved yet) and is replaced.
        _ if !unit_in_new && old_db => {
            write_marker(new, &snapshot(old)?)?;
            moving = true;
            None
        }
        Marker::Absent if old_db => Some(if exists(&new.join("meter.db")) {
            Why::Store
        } else {
            Why::Sidecars
        }),
        // No database to move: `new` holds what it holds.
        _ => None,
    };

    if moving {
        // Every file is durably in `new` before any old name goes, so until then `old` still has
        // the whole generation. Files an interrupted run already put there are fsynced again, with
        // the directory: that run may have stopped before its fsync. Then the old names go,
        // sidecars first, the database last.
        for f in DB_UNIT {
            let (src, dst) = (old.join(f), new.join(f));
            if exists(&dst) {
                File::open(&dst)?.sync_all()?;
            } else if exists(&src) {
                place(&src, &dst, force_copy)?;
            }
        }
        sync_dir(new)?;
        for f in DB_UNIT {
            let src = old.join(f);
            if exists(&src) {
                fs::remove_file(&src)?;
                sync_dir(old)?;
                m.moved.push(f);
            }
        }
    }
    if why.is_some() {
        // Nothing moves while the store is in the way.
        m.kept.extend(
            DB_UNIT
                .iter()
                .chain(LOOSE.iter())
                .filter(|f| exists(&old.join(f))),
        );
    } else {
        for f in LOOSE {
            match move_file(old, new, f, force_copy, moving)? {
                Step::Moved => m.moved.push(f),
                Step::Kept => m.kept.push(f),
                Step::Absent => {}
            }
        }
        if exists(&new.join(MOVING)) {
            fs::remove_file(new.join(MOVING))?;
            sync_dir(new)?;
        }
    }
    m.stop = matches!(why, Some(Why::Sidecars | Why::Changed | Why::Unproven));
    // The lock file is empty and `new` has its own (held by the caller): the old one is removed,
    // never moved onto the held one, once nothing else is left. One this run created never stays.
    // An older meter that starts after this finds no store in the old directory.
    if m.kept.is_empty() || !had_lock {
        fs::remove_file(old.join("meter.lock"))?;
        sync_dir(old)?;
        if had_lock {
            m.moved.push("meter.lock");
        }
    }
    drop(old_lock);

    let (o, n) = (old.display(), new.display());
    if let Some(why) = why {
        let reason = match why {
            Why::Store => format!("{n} already has a meter.db"),
            Why::Sidecars => format!("{n} already has sidecars of another store"),
            Why::Changed => format!(
                "a move to {n} was interrupted and {o} changed since, so {o} has the store to keep"
            ),
            Why::Unproven => {
                format!("{n} has files of an interrupted move that cannot be verified")
            }
        };
        let left = if m.kept.is_empty() {
            String::new()
        } else {
            format!("left {} in {o}: ", m.kept.join(", "))
        };
        let after = if m.stop {
            format!(
                ", and nothing syncs until the meter.db files and {MOVING} in {n} are moved away"
            )
        } else {
            String::new()
        };
        eprintln!("meter: {left}{reason}; nothing was overwritten or deleted{after}");
    } else if !m.kept.is_empty() {
        eprintln!(
            "meter: left {} in {o}: {n} already has different copies; nothing was overwritten or deleted",
            m.kept.join(", ")
        );
    } else if !m.moved.is_empty() {
        eprintln!("meter: moved {} from {o} to {n}", m.moved.join(", "));
        if exists(&old.join("prices.json")) && !exists(&new.join("prices.json")) {
            eprintln!(
                "meter: {} was not moved; copy it to {n} to keep the price override",
                old.join("prices.json").display()
            );
        }
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
        // The crash: the marker is written, the wal moved, the database is linked into place but
        // not yet unlinked.
        write_marker(&new, &snapshot(&old).unwrap()).unwrap();
        fs::rename(old.join("meter.db-wal"), new.join("meter.db-wal")).unwrap();
        fs::hard_link(old.join("meter.db"), new.join("meter.db")).unwrap();
        let m = migrate(&old, &new).unwrap();
        assert_eq!(m.moved, vec!["meter.db"]);
        assert!(m.kept.is_empty());
        assert!(!exists(&old.join("meter.db")));
        assert_eq!(fs::read(new.join("meter.db")).unwrap(), b"db");
        assert_eq!(fs::read(new.join("meter.db-wal")).unwrap(), b"wal");
        assert!(
            !exists(&new.join(MOVING)),
            "the marker goes once the unit moved"
        );
    }

    #[test]
    fn a_wal_in_the_new_dir_without_the_marker_blocks_the_database() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("old"), t.path().join("new"));
        fs::create_dir_all(&old).unwrap();
        ensure_dir(&new).unwrap();
        fs::write(old.join("meter.db"), b"db").unwrap();
        fs::write(old.join("claude-limits.jsonl"), b"l").unwrap();
        fs::write(new.join("meter.db-wal"), b"another store").unwrap();
        let m = migrate(&old, &new).unwrap();
        assert_eq!(m.kept, ["meter.db", "claude-limits.jsonl"]);
        assert!(m.moved.is_empty());
        assert!(!exists(&new.join("meter.db")));
        assert!(!exists(&new.join("claude-limits.jsonl")), "nothing moves");
        assert!(
            !exists(&old.join("meter.lock")),
            "a lock file it created never stays"
        );
        assert_eq!(fs::read(old.join("meter.db")).unwrap(), b"db");
    }

    #[cfg(unix)]
    #[test]
    fn a_new_dir_that_is_the_old_dir_moves_nothing() {
        let t = tempfile::tempdir().unwrap();
        let old = t.path().join("old");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("meter.db"), b"db").unwrap();
        let new = t.path().join("am/meter");
        fs::create_dir_all(new.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&old, &new).unwrap();
        let _held = try_lock(&new).unwrap().unwrap();
        assert_eq!(migrate(&old, &new).unwrap(), Migration::default());
        assert_eq!(fs::read(old.join("meter.db")).unwrap(), b"db");
    }
}
