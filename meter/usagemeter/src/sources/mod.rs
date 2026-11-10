//! Harness readers. Most turn one JSONL line into zero or more usage events and never keep any text
//! beyond ids, the model name, the cwd and the branch; `agy` reads a conversation database.

pub mod agy;
pub mod claude;
pub mod codex;
pub mod dsh_tui;
pub mod omp;

use serde::{Deserialize, Serialize};

use crate::event::UsageEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Source {
    Claude,
    Omp,
    Codex,
    DshTui,
    Agy,
}

impl Source {
    pub const ALL: [Source; 5] = [
        Source::Omp,
        Source::Claude,
        Source::Codex,
        Source::DshTui,
        Source::Agy,
    ];

    pub fn harness(self) -> &'static str {
        match self {
            Source::Claude => "claude-code",
            Source::Omp => "omp",
            Source::Codex => "codex",
            Source::DshTui => dsh_tui::HARNESS,
            Source::Agy => agy::HARNESS,
        }
    }

    /// Whether the harness logs how much of `output` was reasoning. When it does not (dsh-tui),
    /// a row's `reasoning` of 0 means unknown, and a reader reports it as unknown, never as 0.
    pub fn logs_reasoning(self) -> bool {
        self != Source::DshTui
    }

    pub fn from_harness(s: &str) -> Option<Source> {
        Source::ALL.into_iter().find(|x| x.harness() == s)
    }

    pub fn parse_line(self, line: &[u8], ctx: &mut FileCtx, out: &mut Vec<UsageEvent>) -> Line {
        match self {
            Source::Claude => claude::parse_line(line, ctx, out),
            Source::Omp => omp::parse_line(line, ctx, out),
            Source::Codex => codex::parse_line(line, ctx, out),
            Source::DshTui => dsh_tui::parse_line(line, ctx, out),
            // A conversation database, not a line log: sync reads it with `agy::read`.
            Source::Agy => Line::Ignored,
        }
    }
}

/// What a file's earlier lines told us, persisted with its offset so a read can resume mid-file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileCtx {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_session: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// A Claude sub-agent transcript: the folder its parent session started in (the parent
    /// transcript's first cwd), None when that transcript could not be read. A sub-agent belongs
    /// to its parent's launch, so this, not its own first cwd, is where its session started.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_cwd: Option<String>,
    /// A Codex rollout: the thread it belongs to and its running total.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex: Option<codex::CodexCtx>,
    /// A dsh-tui session: the highest `seq` counted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<i64>,
    /// A dsh-tui session seeded from another (a fork): its first rows are copies.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub seeded: bool,
    /// A dsh-tui session's `createdAt` (epoch ms): in a fork, a call at or before it is a copy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    /// A dsh-tui fork's first `session/end-seed {inherited: true}` has been read: the rows before
    /// it are all copies.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub seed_cut: bool,
    /// A dsh-tui session's header named the terminal it runs in (RFC 0026 (d)): the pane's bare
    /// local address, with `created_at` the session's own start record. None when the header has
    /// no such field, or one that is no bare local address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<String>,
    /// An Antigravity conversation's highest counted `gen_metadata.idx`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agy: Option<agy::AgyCtx>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Line {
    /// Not a usage line (most lines).
    Ignored,
    /// A usage line; events may have been pushed.
    Usage,
    /// Looked like a usage line but did not parse.
    Bad,
}

/// A token count that may be missing, null or written as a float: anything else is 0.
pub(crate) fn lenient_i64<'de, D: serde::Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    let v: Option<f64> = Option::deserialize(d)?;
    Ok(v.filter(|x| x.is_finite() && *x >= 0.0)
        .map_or(0, |x| x as i64))
}

/// Parses a JSON line, repairing lone UTF-16 surrogate escapes (`\ud83d` with no pair), which
/// some logs contain and serde rejects. Only the error path pays for the repair.
pub(crate) fn from_line<T: serde::de::DeserializeOwned>(line: &[u8]) -> Option<T> {
    match serde_json::from_slice(line) {
        Ok(v) => Some(v),
        Err(_) => serde_json::from_slice(&repair_surrogates(line)?).ok(),
    }
}

fn hex4(b: &[u8]) -> Option<u32> {
    let s = std::str::from_utf8(b.get(..4)?).ok()?;
    u32::from_str_radix(s, 16).ok()
}

/// Replaces unpaired `\uD800`–`\uDFFF` escapes with `�`. None when there is nothing to fix.
fn repair_surrogates(line: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(line.len());
    let mut changed = false;
    let mut i = 0;
    while i < line.len() {
        if line[i] != b'\\' || i + 1 >= line.len() {
            out.push(line[i]);
            i += 1;
            continue;
        }
        if line[i + 1] != b'u' {
            out.extend_from_slice(&line[i..(i + 2).min(line.len())]);
            i += 2;
            continue;
        }
        let Some(cp) = hex4(&line[i + 2..]) else {
            out.extend_from_slice(&line[i..i + 2]);
            i += 2;
            continue;
        };
        let is_high = (0xD800..0xDC00).contains(&cp);
        let is_low = (0xDC00..0xE000).contains(&cp);
        let paired = is_high
            && line.get(i + 6) == Some(&b'\\')
            && line.get(i + 7) == Some(&b'u')
            && hex4(&line[(i + 8).min(line.len())..])
                .is_some_and(|lo| (0xDC00..0xE000).contains(&lo));
        if paired {
            out.extend_from_slice(&line[i..i + 12]);
            i += 12;
        } else if is_high || is_low {
            out.extend_from_slice(b"\\uFFFD");
            changed = true;
            i += 6;
        } else {
            out.extend_from_slice(&line[i..i + 6]);
            i += 6;
        }
    }
    changed.then_some(out)
}

/// Ids and labels copied from logs are bounded so a hostile or corrupt line cannot bloat the store.
pub(crate) fn clip(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}
