//! Antigravity (`agy`) conversations: `~/.gemini/antigravity-cli/conversations/<id>.db`.
//!
//! One SQLite database per conversation. `gen_metadata.data` is an `exa.cortex_pb`
//! `CortexStepGeneratorMetadata` blob whose `chat_model.usage` carries the provider's own token
//! counts (input, cache read and write, output, and the part of output spent thinking). The row has
//! no time: `gen_metadata` names the `steps` it covers, and each step's metadata carries the call's
//! timestamp. `trajectory_metadata_blob` carries the conversation's folder, repository and branch.
//!
//! The blobs are decoded here with a small protobuf reader rather than a schema compiler: the
//! format is private, changes with the CLI, and a field the meter does not know is skipped. An
//! unknown shape is refused: it makes the source `unsupported` with a named reason instead of
//! counting zero.
//!
//! Nothing here writes the conversation database: it is opened read-only with a busy timeout, and
//! one query reads the rows. A database in WAL mode may have its `-shm` sidecar created, as any
//! read-only SQLite open may; no data is written.

use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::event::{Precision, Tokens, UsageEvent};
use crate::sources::clip;
use crate::time::DAY_MS;

pub const HARNESS: &str = "agy";

/// How far a conversation's time may be from the sync and still be counted (a clock skew guard).
const MAX_SKEW_MS: i64 = 2 * DAY_MS;

/// A conversation's read cursor, kept in the file row's JSON context.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgyCtx {
    /// The highest `gen_metadata.idx` counted. Later runs read only rows above it.
    #[serde(default = "no_generation")]
    pub max_gen: i64,
}

/// Before the first read nothing is counted, and the first row is index 0.
fn no_generation() -> i64 {
    -1
}

impl Default for AgyCtx {
    fn default() -> AgyCtx {
        AgyCtx {
            max_gen: no_generation(),
        }
    }
}

/// Why a transcript was not read. The message never names a path, account or machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failure {
    /// The database's shape is not one this meter knows: its usage is unknown, never zero.
    Shape(String),
    /// The database could not be opened or read this time; retry on the next sync.
    Unreadable(String),
}

/// What one read of a conversation database produced.
#[derive(Debug, Default)]
pub struct Read {
    pub events: Vec<UsageEvent>,
    /// Rows that carried usage, zero-token rows included.
    pub usage_lines: i64,
    /// Rows whose shape could not be read.
    pub skipped_lines: i64,
    /// The highest `gen_metadata.idx` processed.
    pub max_gen: i64,
    /// The deadline cut the read short; the next sync continues above [`Read::max_gen`].
    pub stopped: bool,
    /// A row or the file had an unknown shape. The rows already read still count.
    pub shape: Option<String>,
}

/// One protobuf field. Only the wire types the agy blobs use are kept.
struct Field<'a> {
    no: u64,
    wire: u8,
    varint: u64,
    bytes: &'a [u8],
}

fn varint(b: &[u8], at: &mut usize) -> Option<u64> {
    let mut v = 0u64;
    let mut shift = 0u32;
    loop {
        let c = *b.get(*at)?;
        *at += 1;
        v |= u64::from(c & 0x7f) << shift;
        if c & 0x80 == 0 {
            return Some(v);
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
}

/// A protobuf message as its fields, in wire order. Groups and field 0 are refused: the agy
/// descriptors use neither.
fn fields(b: &[u8]) -> Option<Vec<Field<'_>>> {
    let mut out = Vec::with_capacity(8);
    let mut at = 0usize;
    while at < b.len() {
        let key = varint(b, &mut at)?;
        let no = key >> 3;
        let wire = (key & 7) as u8;
        if no == 0 || no > 100_000 {
            return None;
        }
        let mut f = Field {
            no,
            wire,
            varint: 0,
            bytes: &[],
        };
        match wire {
            0 => f.varint = varint(b, &mut at)?,
            1 => {
                let end = at.checked_add(8)?;
                f.bytes = b.get(at..end)?;
                at = end;
            }
            2 => {
                let n = varint(b, &mut at)?;
                let end = at.checked_add(usize::try_from(n).ok()?)?;
                f.bytes = b.get(at..end)?;
                at = end;
            }
            5 => {
                let end = at.checked_add(4)?;
                f.bytes = b.get(at..end)?;
                at = end;
            }
            _ => return None,
        }
        out.push(f);
        if out.len() > 100_000 {
            return None;
        }
    }
    Some(out)
}

fn sub<'a>(fs: &'a [Field<'a>], no: u64) -> Option<&'a [u8]> {
    fs.iter()
        .find(|f| f.no == no && f.wire == 2)
        .map(|f| f.bytes)
}

fn subs<'a>(fs: &'a [Field<'a>], no: u64) -> impl Iterator<Item = &'a [u8]> + 'a {
    fs.iter()
        .filter(move |f| f.no == no && f.wire == 2)
        .map(|f| f.bytes)
}

fn text(b: &[u8]) -> Option<String> {
    let s = std::str::from_utf8(b).ok()?.trim();
    if s.is_empty() {
        return None;
    }
    Some(clip(s, 512))
}

fn uint(fs: &[Field<'_>], no: u64) -> u64 {
    fs.iter()
        .filter(|f| f.no == no && f.wire == 0)
        .map(|f| f.varint)
        .next()
        .unwrap_or(0)
}

/// A timestamp message (`seconds`, `nanos`): epoch ms, or None when it is not one.
fn timestamp(b: &[u8]) -> Option<i64> {
    let fs = fields(b)?;
    let secs = fs
        .iter()
        .find(|f| f.no == 1 && f.wire == 0)
        .map(|f| f.varint)?;
    let nanos = fs
        .iter()
        .find(|f| f.no == 2 && f.wire == 0)
        .map_or(0, |f| f.varint.min(999_999_999));
    let secs = i64::try_from(secs).ok()?;
    if secs <= 0 {
        return None;
    }
    Some(secs.saturating_mul(1000) + (nanos / 1_000_000) as i64)
}

/// `file:///work/app` → `/work/app`, percent escapes decoded. None for a non-file URI.
fn file_path(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    if !rest.starts_with('/') {
        return None;
    }
    let bytes = rest.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(hex) = bytes.get(i + 1..i + 3)
            && let Ok(s) = std::str::from_utf8(hex)
            && let Ok(v) = u8::from_str_radix(s, 16)
        {
            out.push(v);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    let s = String::from_utf8(out).ok()?;
    (!s.is_empty()).then_some(clip(&s, 1024))
}

/// Where a conversation ran: folder, repo and branch, from `workspaces[0]`.
#[derive(Debug, Default)]
struct Workspace {
    cwd: Option<String>,
    repo: Option<String>,
    branch: Option<String>,
}

fn trajectory(blob: &[u8]) -> Option<Workspace> {
    let fs = fields(blob)?;
    let Some(ws) = sub(&fs, 1) else {
        // A conversation outside a project has no workspace: still a known shape.
        return Some(Workspace::default());
    };
    let wf = fields(ws)?;
    let cwd = sub(&wf, 1)
        .and_then(text)
        .as_deref()
        .and_then(file_path)
        .or_else(|| sub(&wf, 2).and_then(text).as_deref().and_then(file_path));
    let branch = sub(&wf, 4).and_then(text);
    // repository: 1 name (`owner/repo`), 2 URL. Only the URL names a host.
    let repo = sub(&wf, 3)
        .and_then(fields)
        .and_then(|rf| sub(&rf, 2).and_then(text))
        .and_then(|url| crate::repo::normalize_remote(&url));
    Some(Workspace { cwd, repo, branch })
}

/// `chat_model.usage` and the model strings of one generation.
#[derive(Debug, Default)]
struct Generation {
    model: Option<String>,
    tokens: Tokens,
    steps: Vec<i64>,
}

/// `ModelUsageStats` inside `ChatModelMetadata.usage`. Input excludes cache reads (the real rows
/// show a cache read larger than input, so input cannot include it) and output includes thinking.
fn usage(b: &[u8]) -> Option<Tokens> {
    let fs = fields(b)?;
    let count = |no| i64::try_from(uint(&fs, no)).unwrap_or(i64::MAX);
    let output = count(3);
    Some(Tokens {
        input_uncached: count(2),
        cache_read: count(5),
        cache_write_5m: count(4),
        cache_write_1h: 0,
        output,
        // Thinking is part of output. Never let a bad row make it larger than the output.
        reasoning: count(9).min(output),
        unsplit: 0,
    })
}

/// The model a `ChatModelMetadata` names: response model, full response model, then display name.
fn model_of(fs: &[Field<'_>]) -> Option<String> {
    [19u64, 22, 21]
        .into_iter()
        .find_map(|no| subs(fs, no).next())
        .and_then(text)
}

/// One `gen_metadata.data` row. None when the row has no usage block (a generation that failed
/// before a model call). Err when it has a usage block of an unknown shape.
fn generation(data: &[u8]) -> Result<Option<Generation>, String> {
    let fs = fields(data).ok_or("an agy generation blob is not the shape this meter reads")?;
    let mut steps = Vec::new();
    for f in &fs {
        match (f.no, f.wire) {
            (2, 2) => {
                let mut at = 0usize;
                while at < f.bytes.len() {
                    let Some(v) = varint(f.bytes, &mut at) else {
                        return Err("an agy generation names steps this meter cannot read".into());
                    };
                    steps.push(i64::try_from(v).unwrap_or(i64::MAX));
                }
            }
            (2, 0) => steps.push(i64::try_from(f.varint).unwrap_or(i64::MAX)),
            _ => {}
        }
    }
    let mut found: Option<Generation> = None;
    for cm in subs(&fs, 1) {
        let Some(cf) = fields(cm) else {
            continue;
        };
        let Some(u) = sub(&cf, 4) else {
            continue;
        };
        let Some(tokens) = usage(u) else {
            return Err("an agy usage block is not the shape this meter reads".into());
        };
        if found.is_none() {
            found = Some(Generation {
                model: model_of(&cf),
                tokens,
                steps: std::mem::take(&mut steps),
            });
        }
    }
    Ok(found)
}

/// A step's metadata: field 1 is the time it started.
fn step_time(metadata: &[u8]) -> Option<i64> {
    let fs = fields(metadata)?;
    let t = sub(&fs, 1)?;
    timestamp(t)
}

fn table_columns(conn: &Connection, table: &str) -> Result<HashSet<String>, Failure> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|_| Failure::Unreadable("an agy transcript could not be read this time".into()))?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|_| Failure::Unreadable("an agy transcript could not be read this time".into()))?;
    let mut out = HashSet::new();
    for c in rows {
        out.insert(c.map_err(|_| {
            Failure::Unreadable("an agy transcript could not be read this time".into())
        })?);
    }
    Ok(out)
}

/// Checks the tables and columns the reader needs. An old or a newer shape is refused by name.
fn check_shape(conn: &Connection) -> Result<(), Failure> {
    for (table, columns) in [
        ("trajectory_metadata_blob", &["data"][..]),
        ("steps", &["idx", "metadata"][..]),
        ("gen_metadata", &["idx", "data"][..]),
    ] {
        let cols = table_columns(conn, table)?;
        if cols.is_empty() {
            return Err(Failure::Shape(format!(
                "the agy transcript schema is not the one this meter reads: no {table} table"
            )));
        }
        for c in columns {
            if !cols.contains(*c) {
                return Err(Failure::Shape(format!(
                    "the agy transcript schema is not the one this meter reads: {table}.{c} is \
                     missing"
                )));
            }
        }
    }
    Ok(())
}

/// Reads every generation above `cursor` from one conversation database. The file is never
/// written; `deadline` stops the read between rows.
pub fn read(path: &Path, cursor: i64, deadline: Instant) -> Result<Read, Failure> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| Failure::Unreadable("an agy transcript could not be opened this time".into()))?;
    conn.busy_timeout(std::time::Duration::from_secs(2))
        .map_err(|_| Failure::Unreadable("an agy transcript could not be read this time".into()))?;
    conn.pragma_update(None, "query_only", "ON")
        .map_err(|_| Failure::Unreadable("an agy transcript could not be read this time".into()))?;
    check_shape(&conn)?;
    let blob: Vec<u8> = conn
        .query_row(
            "SELECT data FROM trajectory_metadata_blob WHERE id = 'main'",
            [],
            |r| r.get(0),
        )
        .or_else(|_| {
            conn.query_row(
                "SELECT data FROM trajectory_metadata_blob LIMIT 1",
                [],
                |r| r.get(0),
            )
        })
        .map_err(|_| Failure::Shape("an agy transcript has no trajectory metadata".into()))?;
    let workspace = trajectory(&blob).ok_or_else(|| {
        Failure::Shape(
            "an agy transcript's trajectory metadata is not the shape this meter reads".into(),
        )
    })?;
    let conversation = path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| clip(s, 128))
        .filter(|s| !s.is_empty());
    let max_db: i64 = conn
        .query_row("SELECT coalesce(max(idx), -1) FROM gen_metadata", [], |r| {
            r.get(0)
        })
        .map_err(|_| Failure::Unreadable("an agy transcript could not be read this time".into()))?;
    // A conversation that was reset or compacted can reuse lower indices: read from the start
    // again and let the dedupe set absorb what was counted before.
    let mut from = cursor;
    if max_db < cursor {
        from = 0;
    }
    let mut stmt = conn
        .prepare("SELECT idx, data FROM gen_metadata WHERE idx > ?1 ORDER BY idx")
        .map_err(|_| Failure::Unreadable("an agy transcript could not be read this time".into()))?;
    let mut rows = stmt
        .query([from])
        .map_err(|_| Failure::Unreadable("an agy transcript could not be read this time".into()))?;
    let mut gens: Vec<(i64, Vec<u8>)> = Vec::new();
    let mut stopped = false;
    while let Some(r) = rows
        .next()
        .map_err(|_| Failure::Unreadable("an agy transcript could not be read this time".into()))?
    {
        let (idx, data): (i64, Vec<u8>) =
            r.get(0)
                .and_then(|i| r.get(1).map(|d| (i, d)))
                .map_err(|_| {
                    Failure::Unreadable("an agy transcript could not be read this time".into())
                })?;
        gens.push((idx, data));
        if Instant::now() >= deadline {
            stopped = true;
            break;
        }
    }
    drop(rows);
    let mut out = Read {
        max_gen: from,
        ..Read::default()
    };
    let mut decoded = Vec::with_capacity(gens.len());
    let mut wanted: HashSet<i64> = HashSet::new();
    for (idx, data) in gens {
        match generation(&data) {
            Ok(Some(g)) => {
                wanted.extend(g.steps.iter().copied());
                decoded.push((idx, g));
            }
            Ok(None) => {
                out.usage_lines += 1;
                out.max_gen = out.max_gen.max(idx);
            }
            Err(why) => {
                out.skipped_lines += 1;
                out.shape.get_or_insert(why);
                out.max_gen = out.max_gen.max(idx);
            }
        }
    }
    let mut times: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    if !wanted.is_empty() {
        let mut stmt = conn
            .prepare("SELECT idx, metadata FROM steps")
            .map_err(|_| {
                Failure::Unreadable("an agy transcript could not be read this time".into())
            })?;
        let mut rows = stmt.query([]).map_err(|_| {
            Failure::Unreadable("an agy transcript could not be read this time".into())
        })?;
        while let Some(r) = rows.next().map_err(|_| {
            Failure::Unreadable("an agy transcript could not be read this time".into())
        })? {
            let Ok(idx) = r.get::<_, i64>(0) else {
                continue;
            };
            if !wanted.contains(&idx) {
                continue;
            }
            let Ok(md) = r.get::<_, Vec<u8>>(1) else {
                continue;
            };
            if let Some(t) = step_time(&md) {
                times.insert(idx, t);
            }
        }
    }
    let now = crate::time::now_ms();
    for (idx, g) in decoded {
        out.usage_lines += 1;
        out.max_gen = out.max_gen.max(idx);
        if g.tokens.is_zero() {
            continue;
        }
        let Some(ts) = g.steps.iter().filter_map(|i| times.get(i)).min().copied() else {
            out.skipped_lines += 1;
            out.shape
                .get_or_insert("an agy usage row has no step time, so its hour is unknown".into());
            continue;
        };
        if ts > now + MAX_SKEW_MS {
            out.skipped_lines += 1;
            out.shape
                .get_or_insert("an agy usage row is dated in the future".into());
            continue;
        }
        let Some(model) = g.model else {
            out.skipped_lines += 1;
            out.shape
                .get_or_insert("an agy usage row names no model".into());
            continue;
        };
        let Some(session) = conversation.as_deref() else {
            out.skipped_lines += 1;
            out.shape
                .get_or_insert("an agy transcript has no conversation id".into());
            continue;
        };
        // The execution id is shared by every generation of a conversation, so it cannot tell
        // two calls apart. The conversation id and the generation index do.
        let dedupe = format!("agy|{session}|{idx}");
        out.events.push(UsageEvent {
            dedupe_key: dedupe,
            ts_ms: ts,
            harness: HARNESS,
            model: clip(&model, 128),
            session: Some(session.to_string()),
            parent_session: None,
            cwd: workspace.cwd.clone(),
            session_cwd: workspace.cwd.clone(),
            branch: workspace.branch.clone(),
            repo: workspace.repo.clone(),
            tokens: g.tokens,
            precision: Precision::Exact,
            reported_usd: None,
            copied: false,
        });
    }
    out.stopped = stopped;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_varint(mut v: u64, out: &mut Vec<u8>) {
        while v >= 0x80 {
            out.push((v as u8) | 0x80);
            v >>= 7;
        }
        out.push(v as u8);
    }

    fn field(no: u64, wire: u8, b: &[u8]) -> Vec<u8> {
        assert_eq!(wire, 2);
        let mut out = Vec::new();
        put_varint((no << 3) | 2, &mut out);
        put_varint(b.len() as u64, &mut out);
        out.extend_from_slice(b);
        out
    }

    fn text_field(no: u64, s: &str) -> Vec<u8> {
        field(no, 2, s.as_bytes())
    }

    fn uint_field(no: u64, v: u64) -> Vec<u8> {
        let mut out = Vec::new();
        put_varint(no << 3, &mut out);
        put_varint(v, &mut out);
        out
    }

    fn timestamp(secs: u64, nanos: u64) -> Vec<u8> {
        [uint_field(1, secs), uint_field(2, nanos)].concat()
    }

    fn usage_blob(
        input: u64,
        cache_read: u64,
        cache_write: u64,
        output: u64,
        thinking: u64,
    ) -> Vec<u8> {
        [
            uint_field(2, input),
            uint_field(3, output),
            uint_field(4, cache_write),
            uint_field(5, cache_read),
            uint_field(9, thinking),
            uint_field(10, output.saturating_sub(thinking)),
        ]
        .concat()
    }

    fn chat_model(u: &[u8], model: &str, display: &str) -> Vec<u8> {
        [
            uint_field(3, 1417),
            field(4, 2, u),
            text_field(19, model),
            text_field(21, display),
        ]
        .concat()
    }

    #[test]
    fn reads_the_real_field_numbers() {
        let ws = [
            text_field(1, "file:///work/example-project/.worktrees/915"),
            text_field(2, "file:///work/example-project"),
            field(
                3,
                2,
                &[
                    text_field(1, "acme/example-project"),
                    text_field(2, "https://example.com/acme/example-project.git"),
                ]
                .concat(),
            ),
            text_field(4, "feat/915-agy-transcripts"),
        ]
        .concat();
        let blob = [field(1, 2, &ws), field(2, 2, &timestamp(1_800_000_000, 0))].concat();
        let w = trajectory(&blob).unwrap();
        assert_eq!(
            w.cwd.as_deref(),
            Some("/work/example-project/.worktrees/915")
        );
        assert_eq!(w.repo.as_deref(), Some("example.com/acme/example-project"));
        assert_eq!(w.branch.as_deref(), Some("feat/915-agy-transcripts"));
        let u = usage_blob(1000, 4000, 50, 200, 120);
        let t = super::usage(&u).unwrap();
        assert_eq!(
            t,
            Tokens {
                input_uncached: 1000,
                cache_read: 4000,
                cache_write_5m: 50,
                output: 200,
                reasoning: 120,
                ..Tokens::default()
            }
        );
        let cm = chat_model(&u, "gemini-4-argon", "Gemini 4 Argon (High)");
        assert_eq!(
            generation(&[field(1, 2, &cm), field(2, 2, &[1, 2])].concat())
                .unwrap()
                .unwrap()
                .model
                .as_deref(),
            Some("gemini-4-argon")
        );
    }

    #[test]
    fn refuses_a_usage_row_without_a_step_time() {
        let u = usage_blob(10, 0, 0, 5, 0);
        let cm = chat_model(&u, "gemini-4-argon", "Gemini 4 Argon (High)");
        let g = [
            field(1, 2, &cm),
            field(2, 2, &[1, 2]),
            text_field(4, "exec-1"),
        ]
        .concat();
        let parsed = generation(&g).unwrap().unwrap();
        assert_eq!(parsed.steps, [1, 2]);
        assert_eq!(parsed.model.as_deref(), Some("gemini-4-argon"));
        let empty = [field(1, 2, &cm), field(2, 2, &[])].concat();
        assert!(generation(&empty).unwrap().unwrap().steps.is_empty());
    }

    #[test]
    fn a_zero_usage_row_is_not_an_event_and_a_garbage_blob_is_refused() {
        let u = usage_blob(0, 0, 0, 0, 0);
        let cm = chat_model(&u, "gemini-4-argon", "Gemini 4 Argon (High)");
        let g = [field(1, 2, &cm), field(2, 2, &[1])].concat();
        let parsed = generation(&g).unwrap().unwrap();
        assert!(parsed.tokens.is_zero());
        assert!(generation(b"not a protobuf").is_err());
    }

    #[test]
    fn the_source_is_known_and_logs_reasoning() {
        assert_eq!(
            crate::sources::Source::from_harness(HARNESS),
            Some(crate::sources::Source::Agy)
        );
        assert!(crate::sources::Source::Agy.logs_reasoning());
    }

    #[test]
    fn maps_file_uris_and_refuses_other_schemes() {
        assert_eq!(file_path("file:///work/a%20b"), Some("/work/a b".into()));
        assert_eq!(file_path("file://localhost/work/a"), Some("/work/a".into()));
        assert_eq!(file_path("https://example.com/a"), None);
        assert_eq!(file_path("file://relative/a"), None);
    }

    #[test]
    fn a_trajectory_without_a_workspace_is_known() {
        let blob = field(2, 2, &timestamp(1_800_000_000, 0));
        let w = trajectory(&blob).unwrap();
        assert!(w.cwd.is_none() && w.repo.is_none() && w.branch.is_none());
    }
}
