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
//! of it once, under the new directory's lock, and keeps the old database files until a later
//! sync succeeds.

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
///
/// std opens every file close-on-exec (`O_CLOEXEC`), so a program the meter starts (`hc`, `git`)
/// never keeps the lock after its `exec`. Between its `fork` and its `exec` a child still shares
/// the open file, and with it the lock: tests that drop a lock and take it again must not run
/// beside a test that starts a process.
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
    /// Database unit files copied into the new directory this run (or a crashed run's copy
    /// finished). Their old copies stay in the old directory as the recoverable generation until
    /// a later sync succeeds (see [`drop_old_generation`]).
    pub copied: Vec<&'static str>,
    /// Other files now in the new directory, their old names removed (moved this run, or a
    /// crashed run's move finished), and the old lock file once it was removed.
    pub moved: Vec<&'static str>,
    /// Files left in the old directory because the new one already has a different file.
    pub kept: Vec<&'static str>,
    /// The new directory holds files the move cannot prove are its own and no store beside them
    /// may be opened or created: sync does nothing this run (the stderr line says why).
    pub stop: bool,
    /// The old directory still holds the generation an earlier run copied: sync removes it with
    /// [`drop_old_generation`] once this run's sync succeeds.
    pub old_generation: bool,
}

fn exists(p: &Path) -> bool {
    p.symlink_metadata().is_ok()
}

// Test instrumentation: each durable step of a move and of dropping the old generation, in
// order. Set by the unit tests below; does nothing in a build.
#[cfg(test)]
type StepHook = fn(&str, &Path);

#[cfg(test)]
thread_local! {
    static STEP: std::cell::Cell<Option<StepHook>> = const { std::cell::Cell::new(None) };
}

fn step(_what: &str, _p: &Path) {
    #[cfg(test)]
    if let Some(f) = STEP.with(|s| s.get()) {
        f(_what, _p)
    }
}

/// Makes a file's bytes durable.
fn fsync(p: &Path) -> io::Result<()> {
    File::open(p)?.sync_all()?;
    step("fsync", p);
    Ok(())
}

/// Makes a directory's entries durable. A failure is an error: the move never removes an old
/// name it could not prove is durable in the new directory.
#[cfg(unix)]
fn sync_dir(dir: &Path) -> io::Result<()> {
    File::open(dir)?.sync_all()?;
    step("fsync-dir", dir);
    Ok(())
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
/// source, then rename into place. The mode is the source's. Refuses to replace `dst`. On any
/// error (a full disk, a short read) the temporary file is removed.
pub fn copy_verified(src: &Path, dst: &Path) -> io::Result<()> {
    let dir = dst.parent().unwrap_or(Path::new("."));
    let name = dst.file_name().unwrap_or_default().to_string_lossy();
    let part = dir.join(format!(".{name}.part"));
    let placed = (|| {
        fs::copy(src, &part)?;
        fsync(&part)?;
        set_mode_like(&part, src)?;
        if !same_file(src, &part)? {
            return Err(io::Error::other(format!(
                "{} changed while it was copied",
                src.display()
            )));
        }
        if exists(dst) {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("{} appeared during the copy", dst.display()),
            ));
        }
        fs::rename(&part, dst)
    })();
    if let Err(e) = placed {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
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
/// removed. The database unit is copied, and its old copies stay as the recoverable generation
/// until [`drop_old_generation`] runs after a later successful sync. The caller holds `new`'s
/// lock. Idempotent: a finished move only reports [`Migration::old_generation`], and a crashed one
/// is finished when its files are still exactly what it started from. When `new`
/// already has a store, or anything the move cannot prove is its own, the old files stay where
/// they are and one line goes to stderr; [`Migration::stop`] says whether `new` is usable.
pub fn migrate(old: &Path, new: &Path) -> io::Result<Migration> {
    migrate_with(old, new, false)
}

/// Written in the new directory (atomically, fsynced) before any file of the database unit moves,
/// and renamed to [`MOVED`] once every file is durably in the new directory. It records the length
/// and SHA-256 of each unit file as the move started, so a resumed move finishes only the
/// generation it started.
const MOVING: &str = ".meter-migrating";

/// The finished move's marker: the same snapshot, now naming the old directory's unit files as
/// the recoverable generation. The first sync that succeeds after the move removes those files
/// (only if they are still exactly the snapshot) and then this marker.
const MOVED: &str = ".meter-moved";

/// Whether `dir` holds the marker of a move that has not finished: its database files may be
/// another generation's, and nothing may open them until the move is finished or resolved.
pub fn move_unfinished(dir: &Path) -> bool {
    exists(&dir.join(MOVING))
}

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
    read_snapshot(&new.join(MOVING))
}

fn read_snapshot(path: &Path) -> io::Result<Marker> {
    let bytes = match fs::read(path) {
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

fn remove(p: &Path) -> io::Result<()> {
    fs::remove_file(p)?;
    sync_dir(p.parent().unwrap_or(Path::new(".")))
}

/// Settles the markers in `new` when `old` holds none of the meter's files any more (removed by
/// hand, or the old directory is gone). A [`MOVED`] marker has nothing left to drop. A [`MOVING`]
/// marker is stale when no unit file reached `new`, and finished when `new` holds exactly the
/// generation it recorded; otherwise `new` may hold half a store and nothing may open it.
fn settle_orphan_markers(old: &Path, new: &Path) -> io::Result<Migration> {
    let mut m = Migration::default();
    if exists(&new.join(MOVED)) {
        remove(&new.join(MOVED))?;
    }
    let marker = read_marker(new)?;
    if matches!(marker, Marker::Absent) {
        return Ok(m);
    }
    let finished = match &marker {
        _ if !DB_UNIT.iter().any(|f| exists(&new.join(f))) => true,
        Marker::Valid(s) => unchanged(s, old, new)?,
        _ => false,
    };
    if finished {
        for f in DB_UNIT {
            let dst = new.join(f);
            if exists(&dst) {
                fsync(&dst)?;
            }
        }
        remove(&new.join(MOVING))?;
        return Ok(m);
    }
    m.stop = true;
    eprintln!(
        "meter: {} has files of an interrupted move and {} no longer has the rest, so the store \
         may be incomplete; nothing was overwritten or deleted, and nothing syncs until it is \
         saved and {MOVING} is removed (README: \"An interrupted move\")",
        new.display(),
        old.display()
    );
    Ok(m)
}

/// Removes the old directory's database unit, the recoverable generation a finished move left
/// there, and its [`MOVED`] marker. Sync calls it, under the new directory's lock, after a sync
/// into the new store succeeded. Only files still exactly what the move copied go: an older meter
/// that wrote to them since made them a store of its own, which stays (never merged, never
/// deleted). Does nothing while an older meter holds the old lock; the next successful sync tries
/// again.
pub fn drop_old_generation(old: &Path, new: &Path) -> io::Result<()> {
    let Marker::Valid(s) = read_snapshot(&new.join(MOVED))? else {
        return Ok(());
    };
    let had_lock = exists(&old.join("meter.lock"));
    let Some(old_lock) = try_lock(old)? else {
        return Ok(());
    };
    let mut same = true;
    for f in DB_UNIT {
        same &= match (print(&old.join(f))?, s.files.get(f)) {
            (None, _) => true,
            (Some(p), Some(want)) => p == *want,
            (Some(_), None) => false,
        };
    }
    let mut removed = Vec::new();
    if same {
        for f in DB_UNIT {
            let src = old.join(f);
            if exists(&src) {
                step("remove", &src);
                remove(&src)?;
                removed.push(f);
            }
        }
    }
    remove(&new.join(MOVED))?;
    if (same || !had_lock) && exists(&old.join("meter.lock")) {
        remove(&old.join("meter.lock"))?;
    }
    drop(old_lock);
    let (o, n) = (old.display(), new.display());
    if !same {
        eprintln!(
            "meter: the meter.db in {o} changed after its move to {n} (an older meter wrote to \
             it), so it is kept as a store of its own; {n} is the store in use, and nothing was \
             merged or deleted"
        );
    } else if !removed.is_empty() {
        eprintln!(
            "meter: removed the old copies of {} from {o}; the store is in {n}",
            removed.join(", ")
        );
    }
    Ok(())
}

#[doc(hidden)]
pub fn migrate_with(old: &Path, new: &Path, force_copy: bool) -> io::Result<Migration> {
    let mut m = Migration::default();
    if old == new || same_dir(old, new) {
        return Ok(m);
    }
    if !MIGRATED_FILES.iter().any(|f| exists(&old.join(f))) {
        return settle_orphan_markers(old, new);
    }
    // An older meter may be mid-sync against the old directory. Its lock is taken for the whole
    // move, and created (empty) if missing, so an older meter starting now finds it held and exits
    // (it runs again on its next trigger) instead of opening a store that is being moved.
    let had_lock = exists(&old.join("meter.lock"));
    let Some(old_lock) = try_lock(old)? else {
        m.busy = true;
        return Ok(m);
    };
    // An older meter creates an empty `meter.db` before it takes its lock. One left behind (no
    // bytes, no sidecars) holds nothing and is no store of its own.
    let old_db_path = old.join("meter.db");
    if old_db_path
        .symlink_metadata()
        .is_ok_and(|md| md.is_file() && md.len() == 0)
        && !DB_UNIT[..2].iter().any(|f| exists(&old.join(f)))
    {
        remove(&old_db_path)?;
    }
    // A finished move: the old unit is the recoverable generation, dropped after the next
    // successful sync. A marker that cannot be read, or one whose store in `new` is gone, proves
    // nothing, and the old unit is a store again.
    if exists(&new.join(MOVED)) {
        match read_snapshot(&new.join(MOVED))? {
            Marker::Valid(_) if exists(&new.join("meter.db")) => m.old_generation = true,
            _ => remove(&new.join(MOVED))?,
        }
    }

    // A unit file in `new` is this move's own only under a marker whose snapshot still matches
    // every unit file in both directories. Without that proof nothing is moved or deleted: a
    // database put beside another generation's write-ahead log loses rows on its replay.
    let old_db = exists(&old_db_path);
    let unit_in_new = DB_UNIT.iter().any(|f| exists(&new.join(f)));
    let mut moving = false;
    let why = match read_marker(new)? {
        _ if m.old_generation => None,
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
        // Every file is copied and durable in `new` before the move counts as finished. Files an
        // interrupted run already put there are fsynced again, with the directory: that run may
        // have stopped before its fsync. The old names all stay: `old` keeps the whole generation
        // until a later sync succeeds.
        for f in DB_UNIT {
            let (src, dst) = (old.join(f), new.join(f));
            if exists(&dst) {
                fsync(&dst)?;
            } else if exists(&src) {
                // Always a copy: a hard link would let an older meter that writes to `old`
                // rewrite the very file this generation is in.
                copy_verified(&src, &dst)?;
            }
        }
        sync_dir(new)?;
        // A build before the copy-only fix hard-linked the unit. An old name that is the new file
        // under another name keeps no generation of its own, and an older meter writing to it
        // would rewrite the new store: it goes, now that the new name is durable.
        for f in DB_UNIT {
            let (src, dst) = (old.join(f), new.join(f));
            if let (Ok(a), Ok(b)) = (src.symlink_metadata(), dst.symlink_metadata())
                && same_inode(&a, &b)
            {
                remove(&src)?;
            }
        }
        m.copied
            .extend(DB_UNIT.iter().filter(|f| exists(&new.join(f))));
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
        if moving {
            step("finished", old);
            fs::rename(new.join(MOVING), new.join(MOVED))?;
            sync_dir(new)?;
        } else if exists(&new.join(MOVING)) {
            remove(&new.join(MOVING))?;
        }
    }
    m.stop = matches!(why, Some(Why::Sidecars | Why::Changed | Why::Unproven));
    // The lock file is empty and `new` has its own (held by the caller): the old one is removed,
    // never moved onto the held one, once nothing else is left. One this run created never stays.
    // Beside an old generation it stays until that generation goes.
    if (m.kept.is_empty() && !m.old_generation) || !had_lock {
        remove(&old.join("meter.lock"))?;
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
                "a move to {n} was interrupted and {o} changed since, so each may hold rows the \
                 other lacks"
            ),
            Why::Unproven => format!(
                "{n} has files of an interrupted move that cannot be verified, so each may hold \
                 rows the other lacks"
            ),
        };
        let left = if m.kept.is_empty() {
            String::new()
        } else {
            format!("left {} in {o}: ", m.kept.join(", "))
        };
        // Two generations cannot be merged (rows are rollups that grew apart) and neither is
        // known to be complete, so the meter picks neither: the person saves both and chooses.
        let after = match why {
            Why::Sidecars => format!(
                ", and nothing syncs until the meter.db files and {MOVING} in {n} are moved away"
            ),
            Why::Changed | Why::Unproven => "; neither store is used, and nothing syncs until \
                                             both are saved and one is chosen \
                                             (README: \"An interrupted move\")"
                .to_string(),
            Why::Store => String::new(),
        };
        eprintln!("meter: {left}{reason}; nothing was overwritten or deleted{after}");
    } else if !m.kept.is_empty() {
        eprintln!(
            "meter: left {} in {o}: {n} already has different copies; nothing was overwritten or deleted",
            m.kept.join(", ")
        );
    } else if !m.moved.is_empty() || !m.copied.is_empty() {
        let mut what = Vec::new();
        if !m.copied.is_empty() {
            what.push(format!("copied {}", m.copied.join(", ")));
        }
        if !m.moved.is_empty() {
            what.push(format!("moved {}", m.moved.join(", ")));
        }
        let kept = if m.copied.is_empty() {
            String::new()
        } else {
            format!("; the old meter.db files stay in {o} until the next successful sync")
        };
        eprintln!("meter: {} from {o} to {n}{kept}", what.join(" and "));
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

    /// A child process never keeps the lock after its exec: the descriptor is close-on-exec.
    #[cfg(target_os = "linux")]
    #[test]
    fn the_lock_is_opened_close_on_exec() {
        use std::os::fd::AsRawFd;
        let dir = tempfile::tempdir().unwrap();
        let held = try_lock(dir.path()).unwrap().unwrap();
        let info = fs::read_to_string(format!("/proc/self/fdinfo/{}", held.as_raw_fd())).unwrap();
        let flags = info
            .lines()
            .find_map(|l| l.strip_prefix("flags:"))
            .map(|v| u32::from_str_radix(v.trim(), 8).unwrap())
            .unwrap();
        const O_CLOEXEC: u32 = 0o2000000;
        assert_ne!(flags & O_CLOEXEC, 0, "flags {flags:o}");
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
        assert_eq!(m.copied, vec!["meter.db-wal", "meter.db"]);
        assert_eq!(m.moved, vec!["claude-limits.jsonl"]);
        assert_eq!(fs::read(new.join("meter.db")).unwrap(), b"db");
        assert_eq!(fs::read(new.join("meter.db-wal")).unwrap(), b"wal");
        assert_eq!(
            fs::read(old.join("meter.db")).unwrap(),
            b"db",
            "the old copy stays as the recoverable generation"
        );
        assert!(exists(&new.join(MOVED)) && !exists(&new.join(MOVING)));
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
        assert_eq!(m.copied, vec!["meter.db-wal", "meter.db"]);
        assert!(m.kept.is_empty());
        assert!(
            !exists(&old.join("meter.db")),
            "a hard-linked old name keeps no generation of its own"
        );
        assert_eq!(fs::read(new.join("meter.db")).unwrap(), b"db");
        assert_eq!(fs::read(new.join("meter.db-wal")).unwrap(), b"wal");
        assert!(
            !exists(&new.join(MOVING)) && exists(&new.join(MOVED)),
            "the marker says the move finished once the unit is in place"
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

    thread_local! {
        static SEEN: std::cell::RefCell<Vec<(String, PathBuf)>> =
            const { std::cell::RefCell::new(Vec::new()) };
        static VICTIM: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
    }

    /// Runs `f` with `hook` called at every step, and returns the steps seen, in order.
    fn with_steps<T>(hook: fn(&str, &Path), f: impl FnOnce() -> T) -> (T, Vec<(String, PathBuf)>) {
        SEEN.with(|s| s.borrow_mut().clear());
        STEP.with(|s| s.set(Some(hook)));
        let r = f();
        STEP.with(|s| s.set(None));
        (r, SEEN.with(|s| s.take()))
    }

    fn record(what: &str, p: &Path) {
        SEEN.with(|s| s.borrow_mut().push((what.to_string(), p.to_path_buf())));
    }

    /// At the steps that end the move and that remove the old copies, an older meter must find
    /// the old lock held.
    fn old_lock_is_held(what: &str, p: &Path) {
        let old = match what {
            "finished" => p,
            "remove" => p.parent().unwrap(),
            _ => return,
        };
        let free = try_lock(old).unwrap().is_some();
        record(&format!("{what} free={free}"), p);
    }

    #[test]
    fn the_old_lock_is_held_while_the_move_finishes_and_while_the_old_copies_go() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("old"), t.path().join("new"));
        fs::create_dir_all(&old).unwrap();
        ensure_dir(&new).unwrap();
        fs::write(old.join("meter.db"), b"db").unwrap();
        fs::write(old.join("meter.db-wal"), b"wal").unwrap();
        let (m, seen) = with_steps(old_lock_is_held, || migrate(&old, &new).unwrap());
        assert_eq!(m.copied, ["meter.db-wal", "meter.db"]);
        let names: Vec<&str> = seen.iter().map(|(w, _)| w.as_str()).collect();
        assert_eq!(names, ["finished free=false"]);

        let again = migrate(&old, &new).unwrap();
        assert!(again.old_generation, "{again:?}");
        let ((), seen) = with_steps(old_lock_is_held, || {
            drop_old_generation(&old, &new).unwrap()
        });
        let names: Vec<&str> = seen.iter().map(|(w, _)| w.as_str()).collect();
        assert_eq!(names, ["remove free=false", "remove free=false"]);
        assert!(!exists(&old.join("meter.db")) && !exists(&old.join("meter.db-wal")));
        assert!(!exists(&new.join(MOVED)) && !exists(&old.join("meter.lock")));
    }

    #[test]
    fn the_old_copies_stay_while_an_older_meter_holds_the_old_lock() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("old"), t.path().join("new"));
        fs::create_dir_all(&old).unwrap();
        ensure_dir(&new).unwrap();
        fs::write(old.join("meter.db"), b"db").unwrap();
        migrate(&old, &new).unwrap();
        let held = try_lock(&old).unwrap().unwrap();
        drop_old_generation(&old, &new).unwrap();
        assert_eq!(fs::read(old.join("meter.db")).unwrap(), b"db");
        assert!(
            exists(&new.join(MOVED)),
            "the next successful sync tries again"
        );
        drop(held);
        drop_old_generation(&old, &new).unwrap();
        assert!(!exists(&old.join("meter.db")) && !exists(&new.join(MOVED)));
    }

    #[test]
    fn old_copies_an_older_meter_wrote_to_are_kept() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("old"), t.path().join("new"));
        fs::create_dir_all(&old).unwrap();
        ensure_dir(&new).unwrap();
        fs::write(old.join("meter.db"), b"db").unwrap();
        migrate(&old, &new).unwrap();
        fs::write(old.join("meter.db"), b"db and a later row").unwrap();
        drop_old_generation(&old, &new).unwrap();
        assert_eq!(
            fs::read(old.join("meter.db")).unwrap(),
            b"db and a later row"
        );
        assert!(!exists(&new.join(MOVED)), "it is a store of its own now");
    }

    #[test]
    fn a_resumed_move_fsyncs_each_file_it_adopts_before_it_finishes() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("old"), t.path().join("new"));
        fs::create_dir_all(&old).unwrap();
        ensure_dir(&new).unwrap();
        fs::write(old.join("meter.db-wal"), b"wal").unwrap();
        fs::write(old.join("meter.db"), b"db").unwrap();
        // The crash: the marker is written and both files are copied, maybe not yet durable.
        write_marker(&new, &snapshot(&old).unwrap()).unwrap();
        for f in ["meter.db-wal", "meter.db"] {
            fs::copy(old.join(f), new.join(f)).unwrap();
        }
        let (m, seen) = with_steps(record, || migrate(&old, &new).unwrap());
        assert_eq!(m.copied, ["meter.db-wal", "meter.db"]);
        let at = |what: &str, p: &Path| {
            seen.iter()
                .position(|(w, q)| w == what && q == p)
                .unwrap_or_else(|| panic!("no {what} of {}: {seen:?}", p.display()))
        };
        let finished = at("finished", &old);
        for f in ["meter.db-wal", "meter.db"] {
            assert!(at("fsync", &new.join(f)) < finished, "{f}: {seen:?}");
        }
        assert!(at("fsync-dir", &new) < finished, "{seen:?}");
        assert_eq!(fs::read(old.join("meter.db")).unwrap(), b"db");
    }

    /// Removes the copy's source as soon as its temporary file is written, so the copy fails
    /// after the temporary file exists.
    #[cfg(unix)]
    fn lose_the_source(what: &str, p: &Path) {
        if what == "fsync"
            && p.to_string_lossy().ends_with(".part")
            && let Some(src) = VICTIM.with(|v| v.borrow_mut().take())
        {
            fs::remove_file(src).unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_copy_leaves_no_temporary_file() {
        let t = tempfile::tempdir().unwrap();
        let (src, dst) = (t.path().join("a"), t.path().join("d/b"));
        fs::create_dir_all(dst.parent().unwrap()).unwrap();
        fs::write(&src, b"a").unwrap();
        VICTIM.with(|v| *v.borrow_mut() = Some(src.clone()));
        let (r, _) = with_steps(lose_the_source, || copy_verified(&src, &dst));
        assert!(r.is_err(), "{r:?}");
        assert!(!exists(&dst));
        assert_eq!(names(dst.parent().unwrap()), Vec::<String>::new());

        fs::write(&src, b"a").unwrap();
        fs::write(&dst, b"b").unwrap();
        let e = copy_verified(&src, &dst).unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(names(dst.parent().unwrap()), ["b"]);
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn an_orphaned_marker_is_cleared_when_the_move_provably_finished() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("old"), t.path().join("new"));
        fs::create_dir_all(&old).unwrap();
        ensure_dir(&new).unwrap();
        fs::write(old.join("meter.db"), b"db").unwrap();
        write_marker(&new, &snapshot(&old).unwrap()).unwrap();
        fs::rename(old.join("meter.db"), new.join("meter.db")).unwrap();
        assert!(move_unfinished(&new));
        let m = migrate(&old, &new).unwrap();
        assert_eq!(m, Migration::default());
        assert!(!move_unfinished(&new), "status can read the store again");
        assert_eq!(fs::read(new.join("meter.db")).unwrap(), b"db");

        // A finished move's marker whose old copies were removed by hand.
        fs::write(new.join(MOVED), b"{}").unwrap();
        assert_eq!(migrate(&old, &new).unwrap(), Migration::default());
        assert!(!exists(&new.join(MOVED)));
    }

    #[test]
    fn an_orphaned_marker_beside_half_a_store_stops_sync() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("old"), t.path().join("new"));
        fs::create_dir_all(&old).unwrap();
        ensure_dir(&new).unwrap();
        fs::write(old.join("meter.db"), b"db").unwrap();
        fs::write(old.join("meter.db-wal"), b"wal").unwrap();
        write_marker(&new, &snapshot(&old).unwrap()).unwrap();
        fs::rename(old.join("meter.db-wal"), new.join("meter.db-wal")).unwrap();
        fs::remove_file(old.join("meter.db")).unwrap();
        let m = migrate(&old, &new).unwrap();
        assert!(m.stop, "{m:?}");
        assert!(move_unfinished(&new), "the marker stays");
        assert!(!exists(&new.join("meter.db")), "no store beside the wal");

        // A stale marker: nothing of the unit reached the new directory.
        fs::remove_file(new.join("meter.db-wal")).unwrap();
        assert_eq!(migrate(&old, &new).unwrap(), Migration::default());
        assert!(!move_unfinished(&new));
    }

    #[test]
    fn an_empty_old_database_an_older_meter_left_is_removed() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("old"), t.path().join("new"));
        fs::create_dir_all(&old).unwrap();
        ensure_dir(&new).unwrap();
        fs::write(new.join("meter.db"), b"the store").unwrap();
        fs::write(old.join("meter.db"), b"").unwrap();
        fs::write(old.join("meter.lock"), b"").unwrap();
        let m = migrate(&old, &new).unwrap();
        assert!(m.kept.is_empty() && !m.stop, "{m:?}");
        assert!(!exists(&old.join("meter.db")) && !exists(&old.join("meter.lock")));
        assert_eq!(fs::read(new.join("meter.db")).unwrap(), b"the store");
    }
}
