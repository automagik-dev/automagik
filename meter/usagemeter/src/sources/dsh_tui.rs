//! dsh-tui sessions (DeepSeek Harness):
//! `$DSH_HOME/sessions/<cwd key>/<session>/session.v4.jsonl.zstd`, `$DSH_HOME` being `~/.dsh`
//! when unset.
//!
//! - The file is append-only zstd: each write adds one or more whole frames, and every frame ends
//!   on a line end. [`crate::scan`] decodes complete frames only and keeps the file offset on a
//!   frame boundary, so a frame still being written is left for the next run.
//! - The first line (`type: "session"`, the only line with no `seq`) carries the session `id` (also
//!   the folder name), the `cwd` and, for a sub-agent, its `parentSession`. Every other line has a
//!   `seq` that counts up by one from 0, and a `time` in epoch milliseconds. The highest `seq`
//!   counted is kept in the file context: a line at or below it is never counted again, and the
//!   dedupe key is `dsh-tui|<session>|<seq>`.
//! - Two line types carry `data.usage` = {inputTokens, outputTokens, cacheReadTokens,
//!   cacheWriteTokens, totalTokens}; `inputTokens` is already uncached (`totalTokens` is the sum of
//!   the other four):
//!   - `assistant/message`: one model call, the model in `data.message.source.model`. An
//!     interrupted message can have no `usage`: no call is counted for it.
//!   - `compaction/summary`: the call that wrote a compaction summary, the model in `data.model`.
//!     It is a call of its own, counted once: its usage is not a sum of the messages it shadows
//!     (`shadowedSeqs`), and those messages keep their own usage. `compaction/prune` and the other
//!     compaction lines carry no usage. Usage on any other line type is ignored, so a later line
//!     that totals a turn can never count its calls twice.
//! - A missing count is 0 when the counts present add up to `totalTokens`. When `totalTokens` is
//!   larger, the rest is of an unknown kind: it is counted as `unsplit` in a `total_only` event of
//!   its own (`…|rest`), never guessed into a kind.
//! - dsh-tui logs no reasoning split (the reasoning is inside `outputTokens`), so `reasoning` is
//!   unknown, not 0: see [`super::Source::logs_reasoning`]. It logs no cost and no git branch:
//!   the tokens are priced only if the price table has the model, and `branch` is null. The repo
//!   comes from the header's `cwd`, like omp's.

use memchr::memmem;
use serde::Deserialize;

use super::{FileCtx, Line, clip, from_line};
use crate::event::{Precision, Tokens, UsageEvent};

pub const HARNESS: &str = "dsh-tui";
/// The one session file name read.
pub const FILE_NAME: &str = "session.v4.jsonl.zstd";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    #[serde(rename = "type")]
    ty: Option<String>,
    seq: Option<i64>,
    time: Option<f64>,
    id: Option<String>,
    cwd: Option<String>,
    parent_session: Option<String>,
    data: Option<Data>,
}

#[derive(Deserialize)]
struct Data {
    usage: Option<Usage>,
    model: Option<String>,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    source: Option<MessageSource>,
}

#[derive(Deserialize)]
struct MessageSource {
    model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Usage {
    #[serde(default, deserialize_with = "count")]
    input_tokens: i64,
    #[serde(default, deserialize_with = "count")]
    output_tokens: i64,
    #[serde(default, deserialize_with = "count")]
    cache_read_tokens: i64,
    #[serde(default, deserialize_with = "count")]
    cache_write_tokens: i64,
    #[serde(default, deserialize_with = "count")]
    total_tokens: i64,
}

/// A count that may be missing, null, a float or not a number at all: anything but a finite,
/// non-negative number is 0, and `totalTokens` then shows what is missing.
fn count<'de, D: serde::Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(v.as_f64()
        .filter(|x| x.is_finite() && *x >= 0.0)
        .map_or(0, |x| x as i64))
}

pub fn parse_line(line: &[u8], ctx: &mut FileCtx, out: &mut Vec<UsageEvent>) -> Line {
    let is_session = memmem::find(line, b"\"type\":\"session\"").is_some();
    if !is_session && memmem::find(line, b"\"usage\"").is_none() {
        return Line::Ignored;
    }
    let Some(row) = from_line::<Row>(line) else {
        let usage_type = memmem::find(line, b"\"type\":\"assistant/message\"").is_some()
            || memmem::find(line, b"\"type\":\"compaction/summary\"").is_some();
        return if usage_type { Line::Bad } else { Line::Ignored };
    };
    let Some(data) = row.data else {
        if row.ty.as_deref() == Some("session") && row.seq.is_none() {
            if let Some(id) = row.id.as_deref() {
                ctx.session = Some(clip(id, 128));
            }
            if let Some(cwd) = row.cwd.as_deref() {
                ctx.cwd = Some(clip(cwd, 1024));
            }
            if let Some(p) = row.parent_session.as_deref() {
                ctx.parent_session = Some(clip(p, 128));
            }
        }
        return Line::Ignored;
    };
    let model = match row.ty.as_deref() {
        Some("assistant/message") => data.message.and_then(|m| m.source).and_then(|s| s.model),
        Some("compaction/summary") => data.model,
        _ => return Line::Ignored,
    };
    let Some(usage) = data.usage else {
        return Line::Ignored;
    };
    let Some(seq) = row.seq.filter(|s| *s >= 0) else {
        return Line::Bad;
    };
    if ctx.seq.is_some_and(|last| seq <= last) {
        return Line::Ignored; // counted before
    }
    let Some(ts_ms) = row.time.filter(|t| t.is_finite() && *t > 0.0) else {
        return Line::Bad;
    };
    ctx.seq = Some(seq);
    let split = Tokens {
        input_uncached: usage.input_tokens,
        cache_read: usage.cache_read_tokens,
        cache_write_5m: usage.cache_write_tokens,
        cache_write_1h: 0,
        output: usage.output_tokens,
        reasoning: 0,
        unsplit: 0,
    };
    let rest = usage.total_tokens - split.split_total();
    let session = ctx.session.clone();
    let key = format!("{HARNESS}|{}|{seq}", session.as_deref().unwrap_or("?"));
    let base = UsageEvent {
        dedupe_key: key.clone(),
        ts_ms: ts_ms as i64,
        harness: HARNESS,
        model: clip(model.as_deref().unwrap_or("unknown"), 128),
        session,
        parent_session: ctx.parent_session.clone(),
        cwd: ctx.cwd.clone(),
        branch: None,
        repo: None,
        tokens: split,
        precision: Precision::Exact,
        reported_usd: None,
    };
    if rest > 0 {
        out.push(UsageEvent {
            dedupe_key: format!("{key}|rest"),
            tokens: Tokens {
                unsplit: rest,
                ..Tokens::default()
            },
            precision: Precision::TotalOnly,
            ..base.clone()
        });
    }
    if !split.is_zero() {
        out.push(base);
    }
    Line::Usage
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = r#"{"type":"session","version":4,"id":"sess-a","createdAt":1767261600000,"cwd":"/work/app","isSeeded":false,"delegationDepth":0}"#;

    fn msg(seq: i64, usage: &str) -> String {
        format!(
            r#"{{"type":"assistant/message","seq":{seq},"time":1767261660000,"data":{{"turn":1,"step":1,"message":{{"role":"assistant","content":[{{"type":"text","text":"SECRET"}}],"source":{{"kind":"llm","provider":"example","model":"model-d"}},"id":"m{seq}"}},"usage":{usage},"stream":[]}}}}"#
        )
    }

    fn run(lines: &[&str], ctx: &mut FileCtx) -> (Vec<Line>, Vec<UsageEvent>) {
        let mut out = Vec::new();
        let r = lines
            .iter()
            .map(|l| parse_line(l.as_bytes(), ctx, &mut out))
            .collect();
        (r, out)
    }

    #[test]
    fn header_then_messages_and_compaction() {
        let m0 = msg(
            0,
            r#"{"inputTokens":10,"outputTokens":20,"cacheReadTokens":300,"cacheWriteTokens":0,"totalTokens":330}"#,
        );
        let comp = r#"{"type":"compaction/summary","seq":1,"time":1767261720000,"data":{"compactionId":"c1","summary":[{"text":"SECRET"}],"shadowedSeqs":[0],"shadowedTokenCount":330,"provider":"example","model":"model-e","usage":{"inputTokens":400,"outputTokens":50,"cacheReadTokens":0,"cacheWriteTokens":0,"totalTokens":450}}}"#;
        let prune = r#"{"type":"compaction/prune","seq":2,"time":1767261720000,"data":{"shadowedSeqs":[0],"shadowedTokenCount":330}}"#;
        let user = r#"{"type":"user/message","seq":3,"time":1767261780000,"data":{"role":"user","content":[{"text":"usage"}]}}"#;
        let mut ctx = FileCtx::default();
        let (r, ev) = run(&[HEADER, &m0, comp, prune, user], &mut ctx);
        assert_eq!(
            r,
            [
                Line::Ignored,
                Line::Usage,
                Line::Usage,
                Line::Ignored,
                Line::Ignored
            ]
        );
        assert_eq!(ev.len(), 2);
        assert_eq!(ev[0].dedupe_key, "dsh-tui|sess-a|0");
        assert_eq!(ev[0].model, "model-d");
        assert_eq!(ev[0].cwd.as_deref(), Some("/work/app"));
        assert_eq!(ev[0].ts_ms, 1_767_261_660_000);
        assert_eq!(
            ev[0].tokens,
            Tokens {
                input_uncached: 10,
                cache_read: 300,
                output: 20,
                ..Tokens::default()
            }
        );
        assert_eq!(ev[0].reported_usd, None);
        assert_eq!(ev[0].branch, None);
        // The compaction call counts once, under its own model, apart from what it shadows.
        assert_eq!(ev[1].dedupe_key, "dsh-tui|sess-a|1");
        assert_eq!(ev[1].model, "model-e");
        assert_eq!(ev[1].tokens.total(), 450);
        assert_eq!(ctx.seq, Some(1));
        assert!(!format!("{ev:?}").contains("SECRET"));
    }

    #[test]
    fn a_seq_already_counted_is_skipped() {
        let mut ctx = FileCtx {
            seq: Some(5),
            session: Some("sess-a".into()),
            ..FileCtx::default()
        };
        let u = r#"{"inputTokens":1,"outputTokens":1,"totalTokens":2}"#;
        let (r, ev) = run(&[&msg(4, u), &msg(5, u), &msg(6, u)], &mut ctx);
        assert_eq!(r, [Line::Ignored, Line::Ignored, Line::Usage]);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].dedupe_key, "dsh-tui|sess-a|6");
    }

    #[test]
    fn sub_agent_header_names_its_parent() {
        let h = r#"{"type":"session","version":4,"id":"sess-child","createdAt":1,"cwd":"/work/app","parentSession":"sess-a","origin":"subagent","delegationDepth":1}"#;
        let mut ctx = FileCtx::default();
        let (_, ev) = run(
            &[h, &msg(0, r#"{"inputTokens":3,"totalTokens":3}"#)],
            &mut ctx,
        );
        assert_eq!(ev[0].session.as_deref(), Some("sess-child"));
        assert_eq!(ev[0].parent_session.as_deref(), Some("sess-a"));
    }

    #[test]
    fn missing_and_unknown_usage_fields() {
        let mut ctx = FileCtx::default();
        run(&[HEADER], &mut ctx);
        // Counts that add up to totalTokens: the missing ones are 0.
        let (_, ev) = run(
            &[&msg(
                0,
                r#"{"inputTokens":5,"outputTokens":7,"totalTokens":12}"#,
            )],
            &mut ctx,
        );
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].precision, Precision::Exact);
        assert_eq!(ev[0].tokens.total(), 12);
        // A count of a kind the meter does not know (or not a number): the rest is total_only.
        let (r, ev) = run(
            &[&msg(
                1,
                r#"{"inputTokens":5,"outputTokens":"many","futureTokens":40,"totalTokens":52}"#,
            )],
            &mut ctx,
        );
        assert_eq!(r, [Line::Usage]);
        assert_eq!(ev.len(), 2);
        assert_eq!(ev[0].dedupe_key, "dsh-tui|sess-a|1|rest");
        assert_eq!(ev[0].precision, Precision::TotalOnly);
        assert_eq!(ev[0].tokens.unsplit, 47);
        assert_eq!(ev[1].precision, Precision::Exact);
        assert_eq!(ev[1].tokens.input_uncached, 5);
        assert_eq!(ev[1].tokens.output, 0);
        // No usage at all (an interrupted message), or a null one: no call is counted.
        let interrupted = r#"{"type":"assistant/message","seq":2,"time":1767261660000,"data":{"interrupted":true,"message":{"source":{"model":"model-d"}},"stream":[],"note":"usage"}}"#;
        let null = msg(3, "null");
        let (r, ev) = run(&[interrupted, &null], &mut ctx);
        assert_eq!(r, [Line::Ignored, Line::Ignored]);
        assert!(ev.is_empty());
        // A usage line that cannot be read, or has no seq or time, is a skipped line.
        let (r, _) = run(
            &[
                r#"{"type":"assistant/message","seq":4,"data":{"usage":{"#,
                r#"{"type":"assistant/message","time":1,"data":{"usage":{"inputTokens":1}}}"#,
                r#"{"type":"assistant/message","seq":5,"data":{"usage":{"inputTokens":1}}}"#,
            ],
            &mut ctx,
        );
        assert_eq!(r, [Line::Bad, Line::Bad, Line::Bad]);
        // Usage on any other line type is not a call.
        let (r, ev) = run(
            &[
                r#"{"type":"turn/end","seq":6,"time":1,"data":{"usage":{"inputTokens":99,"totalTokens":99}}}"#,
            ],
            &mut ctx,
        );
        assert_eq!(r, [Line::Ignored]);
        assert!(ev.is_empty());
    }
}
