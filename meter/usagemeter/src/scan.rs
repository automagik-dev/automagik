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
//!   waits for the next run, like an unfinished line. A whole frame that does not decode, or
//!   decodes to more than `max_line`, is skipped and counted; so is the rest of a file that stops
//!   looking like zstd.

use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
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
        Source::DshTui => path.file_name().is_some_and(|n| n == dsh_tui::FILE_NAME),
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
    if source == Source::DshTui {
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
    if magic != 0xFD2F_B528 {
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

/// Decodes one whole frame and parses its lines.
fn parse_frame(
    frame: &[u8],
    source: Source,
    max_line: usize,
    ctx: &mut FileCtx,
    events: &mut Vec<UsageEvent>,
    health: &mut Health,
) {
    let mut text = Vec::new();
    let decoded = ruzstd::decoding::StreamingDecoder::new(frame)
        .map_err(io::Error::other)
        .and_then(|d| d.take(max_line as u64 + 1).read_to_end(&mut text));
    if decoded.is_err() || text.len() > max_line {
        health.skipped_lines += 1;
        return;
    }
    for line in text.split(|b| *b == b'\n').filter(|l| !l.is_empty()) {
        match source.parse_line(line, ctx, events) {
            Line::Ignored => {}
            Line::Usage => health.usage_lines += 1,
            Line::Bad => health.skipped_lines += 1,
        }
    }
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
    // The file stopped looking like zstd (or holds a frame too large to buffer): drop the rest.
    let mut junk = false;
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
        while !junk && consumed < buf.len() {
            match frame_at(&buf[consumed..]) {
                Frame::Whole { len, skippable } => {
                    if !skippable {
                        let frame = &buf[consumed..consumed + len];
                        parse_frame(
                            frame,
                            source,
                            limits.max_line,
                            &mut ctx,
                            &mut events,
                            &mut health,
                        );
                    }
                    consumed += len;
                }
                Frame::Partial if buf.len() - consumed < limits.max_line => break,
                Frame::Partial | Frame::Bad => {
                    health.skipped_lines += 1;
                    junk = true;
                }
            }
        }
        state.ctx = ctx;
        if junk {
            consumed = buf.len();
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
        parse_frame(&f, Source::DshTui, 1 << 20, &mut ctx, &mut ev, &mut h);
        assert_eq!(h, Health::default());
        // A frame that decodes to more than max_line is skipped and counted.
        parse_frame(&f, Source::DshTui, 2, &mut ctx, &mut ev, &mut h);
        assert_eq!(h.skipped_lines, 1);
    }
}
