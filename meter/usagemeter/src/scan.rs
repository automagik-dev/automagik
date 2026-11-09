//! Finds harness logs and reads what is new in them.
//!
//! - Discovery never follows a symlink, so nothing outside the source roots is read.
//! - A file is read from its saved offset in chunks of `chunk_bytes`; only complete lines are
//!   parsed and the offset only moves past complete lines, so a line still being written waits for
//!   the next run.
//! - A file is recognised by device, inode and a hash of its first bytes. If any of them changed,
//!   or the file shrank below the saved offset, it is read again from the start; the dedupe set
//!   absorbs what was counted before.
//! - A line longer than `max_line` is skipped and counted, never buffered whole.
//! - A dsh-tui session is multi-frame zstd: its offset is in the compressed file and always on a
//!   frame boundary. Only whole frames are decoded, so a frame still being written (or cut short)
//!   waits for the next run, like an unfinished line. Frames are decoded line by line: a line
//!   longer than `max_line` is skipped and counted, never the rest of its frame. Bytes that are not
//!   a frame (corruption, or a frame over `max_line` compressed) are skipped, counted once, up to
//!   the next frame start, so one bad frame never drops the rest of the file.

use std::fs::{self, File};
use std::io::{self, BufRead, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Instant;

use sha2::{Digest, Sha256};

use crate::event::{UsageEvent, hex};
use crate::sources::{FileCtx, Line, Source, dsh_tui};
use crate::store::{FileState, Health};

pub const HEAD_BYTES: u64 = 4096;

#[derive(Debug, Clone)]
pub struct Candidate {
    pub path: PathBuf,
    pub source: Source,
    pub dev: u64,
    pub ino: u64,
    pub size: u64,
    pub mtime_ms: i64,
}

#[cfg(unix)]
fn ids(m: &fs::Metadata) -> (u64, u64) {
    use std::os::unix::fs::MetadataExt;
    (m.dev(), m.ino())
}

#[cfg(not(unix))]
fn ids(_: &fs::Metadata) -> (u64, u64) {
    (0, 0)
}

fn mtime_ms(m: &fs::Metadata) -> i64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64)
}

/// Whether `path` is one of `source`'s logs: a `*.jsonl`, or a dsh-tui session file.
fn is_log(source: Source, path: &Path) -> bool {
    match source {
        Source::DshTui => path
            .file_name()
            .is_some_and(|n| dsh_tui::FILE_NAMES.iter().any(|f| n == *f)),
        _ => path.extension().is_some_and(|x| x == "jsonl"),
    }
}

/// Every log of `source` under `root` (depth-limited), skipping symlinks to files and directories.
pub fn discover(root: &Path, source: Source, out: &mut Vec<Candidate>) {
    fn walk(dir: &Path, depth: usize, source: Source, out: &mut Vec<Candidate>) {
        if depth > 8 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            // The entry's own type needs no extra syscall and never follows a symlink.
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let path = e.path();
            if ft.is_dir() {
                walk(&path, depth + 1, source, out);
            } else if ft.is_file() && is_log(source, &path) {
                let Ok(meta) = fs::symlink_metadata(&path) else {
                    continue;
                };
                if !meta.file_type().is_file() {
                    continue;
                }
                let (dev, ino) = ids(&meta);
                out.push(Candidate {
                    path,
                    source,
                    dev,
                    ino,
                    size: meta.len(),
                    mtime_ms: mtime_ms(&meta),
                });
            }
        }
    }
    // The root itself may be a symlink the user set up (a moved config dir); what is under it may not.
    let Ok(meta) = fs::metadata(root) else { return };
    if meta.is_dir() {
        walk(root, 0, source, out);
    }
}

/// A Codex rollout as a candidate, if it is a regular file (never a symlink).
pub fn candidate_of(path: &Path) -> Option<Candidate> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.file_type().is_file() {
        return None;
    }
    let (dev, ino) = ids(&meta);
    Some(Candidate {
        path: path.to_path_buf(),
        source: Source::Codex,
        dev,
        ino,
        size: meta.len(),
        mtime_ms: mtime_ms(&meta),
    })
}

/// The first cwd recorded in the parent transcript of the sub-agent transcript at `path`
/// (`…/<session>/subagents/<agent>.jsonl` → `…/<session>.jsonl`), reading at most 4 MiB of it.
/// None when it cannot be read or records none.
pub fn claude_first_cwd(path: &Path) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct Row {
        cwd: Option<String>,
    }
    let session_dir = path.parent()?.parent()?;
    let parent =
        session_dir.with_file_name(format!("{}.jsonl", session_dir.file_name()?.to_str()?));
    let f = open_nofollow(&parent).ok()?;
    let mut r = io::BufReader::new(f.take(4 << 20));
    let mut line = Vec::new();
    loop {
        line.clear();
        if r.read_until(b'\n', &mut line).ok()? == 0 {
            return None;
        }
        if memchr::memmem::find(&line, b"\"cwd\"").is_none() {
            continue;
        }
        if let Ok(Row { cwd: Some(cwd) }) = serde_json::from_slice::<Row>(&line)
            && !cwd.is_empty()
        {
            return Some(cwd.chars().take(1024).collect());
        }
    }
}

/// `…/<session>/subagents/<agent>.jsonl` belongs to `<session>`.
pub fn parent_session(path: &Path) -> Option<String> {
    let dir = path.parent()?;
    if dir.file_name()? != "subagents" {
        return None;
    }
    let s = dir.parent()?.file_name()?.to_str()?;
    Some(s.chars().take(128).collect())
}

fn head_hash(f: &mut File, skip: u64, len: u64) -> io::Result<String> {
    let mut buf = vec![0u8; len as usize];
    f.seek(SeekFrom::Start(skip))?;
    f.read_exact(&mut buf)?;
    Ok(hex(&Sha256::digest(&buf)[..16]))
}

/// Where the identifying head starts. omp rewrites its first line (a padded title) in place, so its
/// head starts after that line; None while that line is still incomplete.
fn head_skip(f: &mut File, source: Source) -> io::Result<Option<u64>> {
    if source != Source::Omp {
        return Ok(Some(0));
    }
    let mut buf = vec![0u8; 64 * 1024];
    f.seek(SeekFrom::Start(0))?;
    let mut n = 0;
    while n < buf.len() {
        let k = f.read(&mut buf[n..])?;
        if k == 0 {
            break;
        }
        n += k;
    }
    Ok(memchr::memchr(b'\n', &buf[..n]).map(|i| i as u64 + 1))
}

/// What a dsh-tui session's header says about where it came from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DshHeader {
    /// A fork: its first rows are copies of another session's.
    pub seeded: bool,
    /// `createdAt`, epoch ms.
    pub created_at: Option<i64>,
}

/// The header of a dsh-tui session file: its first line, decoded only as far as that line's end
/// (at most 64 KiB of it), however large the frame holding it. None when the file cannot be read
/// or does not start with a header. Used only to order reads, so a parent session is read before
/// its forks.
pub fn dsh_header(path: &Path) -> Option<DshHeader> {
    const MAX: usize = 64 * 1024;
    let f = open_nofollow(path).ok()?;
    let mut line = Vec::new();
    let mut chunk = [0u8; 4096];
    let mut read_line = |r: &mut dyn Read| -> Option<()> {
        while line.len() < MAX {
            let n = r.read(&mut chunk).ok()?;
            if n == 0 {
                return None;
            }
            match memchr::memchr(b'\n', &chunk[..n]) {
                Some(end) => {
                    line.extend_from_slice(&chunk[..end]);
                    return Some(());
                }
                None => line.extend_from_slice(&chunk[..n]),
            }
        }
        None
    };
    if path.to_string_lossy().ends_with(".zstd") {
        let mut d = ruzstd::decoding::StreamingDecoder::new(f).ok()?;
        read_line(&mut d)?;
    } else {
        read_line(&mut io::BufReader::new(f))?;
    }
    let mut ctx = FileCtx::default();
    dsh_tui::parse_line(&line, &mut ctx, &mut Vec::new());
    ctx.session.as_ref()?;
    Some(DshHeader {
        seeded: ctx.seeded,
        created_at: ctx.created_at,
    })
}

fn open_nofollow(p: &Path) -> io::Result<File> {
    let mut o = fs::OpenOptions::new();
    o.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        const O_NOFOLLOW: i32 = if cfg!(target_os = "linux") {
            0o400000
        } else {
            0x0100
        };
        o.custom_flags(O_NOFOLLOW);
    }
    o.open(p)
}

/// Where to resume a candidate, given what the store remembers about its path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Plan {
    /// Nothing new since the last read.
    Unchanged,
    /// Read from `state.offset`; `rewritten` when the old offset was discarded.
    Read {
        state: Box<FileState>,
        rewritten: bool,
    },
}

pub fn plan(c: &Candidate, prev: Option<FileState>) -> io::Result<Plan> {
    let path = c.path.to_string_lossy().into_owned();
    let fresh = |rewrites: i64| FileState {
        path: path.clone(),
        source: c.source.harness().to_string(),
        dev: c.dev,
        ino: c.ino,
        size: 0,
        mtime_ms: c.mtime_ms,
        offset: 0,
        head_skip: 0,
        head_len: 0,
        head_hash: String::new(),
        ctx: match parent_session(&c.path) {
            Some(parent) => FileCtx {
                session: c
                    .path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.chars().take(128).collect()),
                parent_cwd: claude_first_cwd(&c.path),
                parent_session: Some(parent),
                ..FileCtx::default()
            },
            // A dsh-tui session's folder is named for it, in case its header cannot be read.
            None if c.source == Source::DshTui => FileCtx {
                session: c
                    .path
                    .parent()
                    .and_then(|d| d.file_name())
                    .and_then(|s| s.to_str())
                    .map(|s| s.chars().take(128).collect()),
                ..FileCtx::default()
            },
            None => FileCtx::default(),
        },
        rewrites,
    };
    let Some(p) = prev else {
        return Ok(Plan::Read {
            state: Box::new(fresh(0)),
            rewritten: false,
        });
    };
    let same_file = p.dev == c.dev && p.ino == c.ino;
    if same_file && p.size == c.size && p.mtime_ms == c.mtime_ms {
        return Ok(Plan::Unchanged);
    }
    let mut intact = same_file && c.size >= p.offset && c.size >= p.head_skip + p.head_len;
    if intact && p.head_len > 0 {
        let mut f = open_nofollow(&c.path)?;
        intact = head_skip(&mut f, c.source)? == Some(p.head_skip)
            && head_hash(&mut f, p.head_skip, p.head_len)? == p.head_hash;
    }
    if !intact {
        return Ok(Plan::Read {
            state: Box::new(fresh(p.rewrites + 1)),
            rewritten: true,
        });
    }
    Ok(Plan::Read {
        state: Box::new(FileState {
            dev: c.dev,
            ino: c.ino,
            mtime_ms: c.mtime_ms,
            ..p
        }),
        rewritten: false,
    })
}

pub struct ReadLimits {
    pub chunk_bytes: usize,
    pub max_line: usize,
    pub deadline: Instant,
    /// Stop after this many chunks across the run, as if the deadline had passed (tests).
    pub chunks_left: Option<std::cell::Cell<usize>>,
}

impl ReadLimits {
    pub fn exhausted(&self) -> bool {
        Instant::now() >= self.deadline || self.chunks_left.as_ref().is_some_and(|c| c.get() == 0)
    }

    fn spend_chunk(&self) {
        if let Some(c) = &self.chunks_left {
            c.set(c.get().saturating_sub(1));
        }
    }
}

/// What a read did. `stopped` is true when the deadline cut it short.
#[derive(Debug, Default)]
pub struct ReadOutcome {
    pub bytes: u64,
    pub stopped: bool,
}

/// Reads `state.path` from `state.offset`. For every chunk of complete lines it calls `commit`
/// with the events, the parser health and the file state to save (offset already advanced).
/// `commit` must persist all three atomically.
pub fn read_file<F>(
    state: &mut FileState,
    source: Source,
    limits: &ReadLimits,
    mut commit: F,
) -> io::Result<ReadOutcome>
where
    F: FnMut(&FileState, Vec<UsageEvent>, Health) -> io::Result<()>,
{
    let mut f = open_nofollow(Path::new(&state.path))?;
    let size_now = f.metadata()?.len();
    let skip = if state.head_len == 0 {
        head_skip(&mut f, source)?
    } else {
        Some(state.head_skip)
    };
    if let Some(skip) = skip {
        let avail = size_now.saturating_sub(skip);
        if state.head_len < HEAD_BYTES.min(avail) {
            state.head_skip = skip;
            state.head_len = HEAD_BYTES.min(avail);
            state.head_hash = head_hash(&mut f, skip, state.head_len)?;
        }
    }
    f.seek(SeekFrom::Start(state.offset))?;
    if source == Source::DshTui && state.path.ends_with(".zstd") {
        return read_frames(state, &mut f, size_now, source, limits, commit);
    }
    let mut out = ReadOutcome::default();
    let mut buf: Vec<u8> = Vec::new();
    let mut file_pos = state.offset;
    let mut skipping = false;
    let mut eof = false;
    loop {
        if limits.exhausted() {
            out.stopped = true;
            break;
        }
        // Fill up to one chunk past what is already buffered (a partial line).
        // Never more than what is left (plus room for growth): most files have a few KB new.
        let left = size_now.saturating_sub(file_pos) as usize + 64 * 1024;
        let want = limits.chunk_bytes.min(left);
        let start = buf.len();
        buf.resize(start + want, 0);
        let mut filled = start;
        while filled < buf.len() {
            let n = f.read(&mut buf[filled..])?;
            if n == 0 {
                eof = true;
                break;
            }
            filled += n;
            file_pos += n as u64;
        }
        buf.truncate(filled);
        let mut health = Health::default();
        let mut events = Vec::new();
        let mut consumed = 0usize;
        if skipping {
            // The rest of an over-long line: drop bytes up to its newline.
            match memchr::memchr(b'\n', &buf) {
                Some(i) => {
                    consumed = i + 1;
                    skipping = false;
                }
                None => consumed = buf.len(),
            }
        }
        if !skipping {
            if let Some(i) = memchr::memrchr(b'\n', &buf[consumed..]) {
                let end = consumed + i;
                let mut ctx = std::mem::take(&mut state.ctx);
                for line in buf[consumed..end].split(|b| *b == b'\n') {
                    if line.len() > limits.max_line {
                        health.skipped_lines += 1;
                        continue;
                    }
                    match source.parse_line(line, &mut ctx, &mut events) {
                        Line::Ignored => {}
                        Line::Usage => health.usage_lines += 1,
                        Line::Bad => health.skipped_lines += 1,
                    }
                }
                state.ctx = ctx;
                consumed = end + 1;
            } else if buf.len() - consumed >= limits.max_line {
                // A line too long to hold: drop what is buffered and skip to its end.
                health.skipped_lines += 1;
                consumed = buf.len();
                skipping = true;
            }
        }
        if consumed > 0 {
            advance(state, &mut buf, consumed, &mut out);
            commit(state, events, health)?;
            limits.spend_chunk();
        }
        if eof {
            break;
        }
    }
    // Remember the size only when the read reached the end, so an unfinished file is read again.
    state.size = if out.stopped {
        state.offset
    } else {
        state.offset + buf.len() as u64
    };
    Ok(out)
}

/// A zstd frame's first four bytes.
const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];

/// What starts at the front of a buffer of zstd data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Frame {
    /// A whole frame of `len` bytes. A skippable frame holds no data.
    Whole { len: usize, skippable: bool },
    /// The frame does not end within the buffer (yet).
    Partial,
    /// Not a zstd frame.
    Bad,
}

/// Walks the frame header and block headers (RFC 8878, section 3.1) to find where the frame
/// that starts `b` ends, without decoding it.
fn frame_at(b: &[u8]) -> Frame {
    let le = |at: usize, n: usize| {
        b.get(at..at + n).map(|x| {
            x.iter()
                .rev()
                .fold(0u32, |v, byte| (v << 8) | u32::from(*byte))
        })
    };
    let Some(magic) = le(0, 4) else {
        return Frame::Partial;
    };
    if magic & 0xFFFF_FFF0 == 0x184D_2A50 {
        let Some(n) = le(4, 4) else {
            return Frame::Partial;
        };
        let len = 8 + n as usize;
        return if b.len() >= len {
            Frame::Whole {
                len,
                skippable: true,
            }
        } else {
            Frame::Partial
        };
    }
    if magic != u32::from_le_bytes(ZSTD_MAGIC) {
        return Frame::Bad;
    }
    let Some(&fhd) = b.get(4) else {
        return Frame::Partial;
    };
    if fhd & 0x08 != 0 {
        return Frame::Bad; // reserved bit
    }
    let single = fhd & 0x20 != 0;
    let dict = [0, 1, 2, 4][usize::from(fhd & 3)];
    let fcs = [usize::from(single), 2, 4, 8][usize::from(fhd >> 6)];
    let mut at = 5 + usize::from(!single) + dict + fcs;
    loop {
        let Some(h) = le(at, 3) else {
            return Frame::Partial;
        };
        let size = match (h >> 1) & 3 {
            1 => 1, // RLE: one byte repeated
            3 => return Frame::Bad,
            _ => (h >> 3) as usize,
        };
        at += 3 + size;
        if h & 1 != 0 {
            break;
        }
    }
    if fhd & 0x04 != 0 {
        at += 4; // content checksum
    }
    if b.len() >= at {
        Frame::Whole {
            len: at,
            skippable: false,
        }
    } else {
        Frame::Partial
    }
}

/// Parses one decoded line.
fn count_line(
    line: &[u8],
    source: Source,
    ctx: &mut FileCtx,
    events: &mut Vec<UsageEvent>,
    health: &mut Health,
) {
    if line.is_empty() {
        return;
    }
    match source.parse_line(line, ctx, events) {
        Line::Ignored => {}
        Line::Usage => health.usage_lines += 1,
        Line::Bad => health.skipped_lines += 1,
    }
}

/// How a whole frame decoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Decoded {
    /// To its end, and its content checksum (when it has one) matches.
    Whole,
    /// It stopped decoding: its headers may not say where it really ends.
    Broken,
    /// It decoded, but its content is not what its checksum says: nothing it holds is counted.
    BadChecksum,
}

/// Decodes one whole frame and parses its lines as they come out, holding at most one line: a
/// line longer than `max_line` is skipped and counted, as in a JSONL file, and the rest of the
/// frame is still read. A frame that stops decoding is counted as one skipped line; the lines
/// decoded before the error stay counted. A frame with a content checksum (RFC 8878 3.1.1) is
/// checked against it: on a mismatch everything the frame added (events, the file context, the
/// health counts) is taken back and the frame counts as one skipped line.
fn parse_frame(
    frame: &[u8],
    source: Source,
    max_line: usize,
    ctx: &mut FileCtx,
    events: &mut Vec<UsageEvent>,
    health: &mut Health,
) -> Decoded {
    let checksum = (frame.get(4).is_some_and(|fhd| fhd & 0x04 != 0) && frame.len() >= 9)
        .then(|| u32::from_le_bytes(frame[frame.len() - 4..].try_into().unwrap_or([0; 4])));
    let (events_before, ctx_before, health_before) = (events.len(), ctx.clone(), *health);
    let mut hash = crate::xxh64::Xxh64::default();
    let Ok(mut decoder) = ruzstd::decoding::StreamingDecoder::new(frame) else {
        health.skipped_lines += 1;
        return Decoded::Broken;
    };
    let mut chunk = vec![0u8; 64 * 1024];
    let mut line: Vec<u8> = Vec::new();
    let mut too_long = false;
    loop {
        let n = match decoder.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => {
                health.skipped_lines += 1;
                return Decoded::Broken;
            }
        };
        if checksum.is_some() {
            hash.update(&chunk[..n]);
        }
        for piece in chunk[..n].split_inclusive(|b| *b == b'\n') {
            let ends = piece.last() == Some(&b'\n');
            let body = if ends {
                &piece[..piece.len() - 1]
            } else {
                piece
            };
            if !too_long && line.len() + body.len() > max_line {
                health.skipped_lines += 1;
                too_long = true;
                line.clear();
            }
            if !too_long {
                line.extend_from_slice(body);
            }
            if ends {
                if !too_long {
                    count_line(&line, source, ctx, events, health);
                }
                line.clear();
                too_long = false;
            }
        }
    }
    if !too_long {
        count_line(&line, source, ctx, events, health);
    }
    if checksum.is_some_and(|want| want != hash.finish() as u32) {
        events.truncate(events_before);
        *ctx = ctx_before;
        *health = health_before;
        health.skipped_lines += 1;
        return Decoded::BadChecksum;
    }
    Decoded::Whole
}

/// [`read_file`] for a multi-frame zstd file: the same chunks, commits and size rule, over whole
/// frames instead of whole lines.
fn read_frames<F>(
    state: &mut FileState,
    f: &mut File,
    size_now: u64,
    source: Source,
    limits: &ReadLimits,
    mut commit: F,
) -> io::Result<ReadOutcome>
where
    F: FnMut(&FileState, Vec<UsageEvent>, Health) -> io::Result<()>,
{
    let mut out = ReadOutcome::default();
    let mut buf: Vec<u8> = Vec::new();
    let mut file_pos = state.offset;
    // Bytes that are not a frame (or a frame too large to hold) are being skipped, up to the next
    // frame start; they count as one skipped line.
    let mut resync = false;
    let mut eof = false;
    loop {
        if limits.exhausted() {
            out.stopped = true;
            break;
        }
        let left = size_now.saturating_sub(file_pos) as usize + 64 * 1024;
        let start = buf.len();
        buf.resize(start + limits.chunk_bytes.min(left), 0);
        let mut filled = start;
        while filled < buf.len() {
            let n = f.read(&mut buf[filled..])?;
            if n == 0 {
                eof = true;
                break;
            }
            filled += n;
            file_pos += n as u64;
        }
        buf.truncate(filled);
        let mut health = Health::default();
        let mut events = Vec::new();
        let mut consumed = 0usize;
        let mut ctx = std::mem::take(&mut state.ctx);
        while consumed < buf.len() {
            match frame_at(&buf[consumed..]) {
                Frame::Whole { len, skippable } => {
                    let frame = &buf[consumed..consumed + len];
                    let decoded = if skippable {
                        Decoded::Whole
                    } else {
                        parse_frame(
                            frame,
                            source,
                            limits.max_line,
                            &mut ctx,
                            &mut events,
                            &mut health,
                        )
                    };
                    // A frame that does not decode may not end where its headers said (a torn
                    // frame's last block runs into the next frame): go on at the next frame start
                    // inside it, if there is one. A frame with a bad checksum ended where its
                    // headers said: the next frame starts after it.
                    consumed += match decoded {
                        Decoded::Whole | Decoded::BadChecksum => len,
                        Decoded::Broken => {
                            memchr::memmem::find(&frame[1..], &ZSTD_MAGIC).map_or(len, |i| 1 + i)
                        }
                    };
                    resync = false;
                }
                Frame::Partial if buf.len() - consumed < limits.max_line => break,
                Frame::Partial | Frame::Bad => {
                    if !resync {
                        health.skipped_lines += 1;
                        resync = true;
                    }
                    match memchr::memmem::find(&buf[consumed + 1..], &ZSTD_MAGIC) {
                        Some(i) => consumed += 1 + i,
                        None => {
                            // A frame start can straddle the next read: keep its first 3 bytes.
                            let keep = if eof { 0 } else { 3 };
                            consumed = consumed.max(buf.len().saturating_sub(keep));
                            break;
                        }
                    }
                }
            }
        }
        state.ctx = ctx;
        if consumed > 0 {
            advance(state, &mut buf, consumed, &mut out);
            commit(state, events, health)?;
            limits.spend_chunk();
        }
        if eof {
            break;
        }
    }
    state.size = if out.stopped {
        state.offset
    } else {
        state.offset + buf.len() as u64
    };
    Ok(out)
}

fn advance(state: &mut FileState, buf: &mut Vec<u8>, consumed: usize, out: &mut ReadOutcome) {
    state.offset += consumed as u64;
    out.bytes += consumed as u64;
    buf.drain(..consumed);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A frame by hand: single segment, raw and RLE blocks, optional checksum.
    fn frame(blocks: &[(&[u8], bool)], checksum: bool) -> Vec<u8> {
        let mut f = vec![0x28, 0xB5, 0x2F, 0xFD];
        f.push(0x20 | if checksum { 0x04 } else { 0 });
        let content: usize = blocks
            .iter()
            .map(|(b, rle)| if *rle { 3 } else { b.len() })
            .sum();
        f.push(content as u8); // the single-segment content size, one byte
        for (i, (b, rle)) in blocks.iter().enumerate() {
            let last = u32::from(i + 1 == blocks.len());
            let (ty, size) = if *rle { (1, 3) } else { (0, b.len() as u32) };
            let h = last | (ty << 1) | (size << 3);
            f.extend_from_slice(&h.to_le_bytes()[..3]);
            f.extend_from_slice(if *rle { &b[..1] } else { b });
        }
        if checksum {
            f.extend_from_slice(&[0, 0, 0, 0]);
        }
        f
    }

    #[test]
    fn frame_ends_are_found_without_decoding() {
        let f = frame(&[(b"ab\n", false), (b"x", true), (b"\n", false)], true);
        assert_eq!(
            frame_at(&f),
            Frame::Whole {
                len: f.len(),
                skippable: false
            }
        );
        // Any cut is a frame still being written, never a whole one.
        for cut in 0..f.len() {
            assert_eq!(frame_at(&f[..cut]), Frame::Partial, "cut at {cut}");
        }
        // Only the first frame of a buffer is measured.
        let two = [f.as_slice(), &f].concat();
        assert_eq!(
            frame_at(&two),
            Frame::Whole {
                len: f.len(),
                skippable: false
            }
        );
        let skip = [0x50, 0x2A, 0x4D, 0x18, 2, 0, 0, 0, 9, 9];
        assert_eq!(
            frame_at(&skip),
            Frame::Whole {
                len: 10,
                skippable: true
            }
        );
        assert_eq!(frame_at(&skip[..9]), Frame::Partial);
        assert_eq!(frame_at(b"{\"type\""), Frame::Bad);
        let mut reserved = f.clone();
        reserved[4] |= 0x08;
        assert_eq!(frame_at(&reserved), Frame::Bad);
        // The hand-made frame decodes to what it holds.
        let mut ctx = FileCtx::default();
        let (mut ev, mut h) = (Vec::new(), Health::default());
        // The hand-made frame's checksum field is zeros, not its content's: refused whole.
        assert_eq!(
            parse_frame(&f, Source::DshTui, 1 << 20, &mut ctx, &mut ev, &mut h),
            Decoded::BadChecksum
        );
        assert_eq!(h.skipped_lines, 1);
        let f = frame(&[(b"ab\n", false), (b"x", true), (b"\n", false)], false);
        let mut h = Health::default();
        assert_eq!(
            parse_frame(&f, Source::DshTui, 1 << 20, &mut ctx, &mut ev, &mut h),
            Decoded::Whole
        );
        assert_eq!(h, Health::default());
        // A line longer than max_line ("xxx" over 2) is skipped and counted; the frame still
        // decodes to its end.
        assert_eq!(
            parse_frame(&f, Source::DshTui, 2, &mut ctx, &mut ev, &mut h),
            Decoded::Whole
        );
        assert_eq!(h.skipped_lines, 1);
        // Bytes that are not a frame do not decode.
        assert_eq!(
            parse_frame(b"junk", Source::DshTui, 1 << 20, &mut ctx, &mut ev, &mut h),
            Decoded::Broken
        );
        assert_eq!(h.skipped_lines, 2);
        // A frame the zstd CLI wrote for "abc", content checksum on: it decodes and checks; with
        // one content byte changed it is refused whole.
        let cli = [
            0x28, 0xB5, 0x2F, 0xFD, 0x04, 0x58, 0x19, 0x00, 0x00, b'a', b'b', b'c', 0x99, 0x09,
            0x77, 0xAD,
        ];
        let mut h = Health::default();
        assert_eq!(
            parse_frame(&cli, Source::DshTui, 1 << 20, &mut ctx, &mut ev, &mut h),
            Decoded::Whole
        );
        let mut bad = cli;
        bad[10] = b'B';
        assert_eq!(
            parse_frame(&bad, Source::DshTui, 1 << 20, &mut ctx, &mut ev, &mut h),
            Decoded::BadChecksum
        );
        assert_eq!(h.skipped_lines, 1);
    }
}
