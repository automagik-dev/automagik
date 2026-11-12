//! Harness-flagged tool and model-call failures as each harness itself records them (issues 899
//! and 1026, RFC 0018 (c)): one fact per failed tool result (`tool_error`) or failed model call
//! (`api_error`), for `usagemeter outcomes`. A harness-flagged failure, never a judgment: it
//! includes the expected ones (a red test run while working test-first, a grep with no match) and
//! usage-limit stops written after a harness's own retries.
//!
//! One marker per harness and failure kind, each pinned by a fixture in
//! `tests/fixtures/tool-errors/`, and never reinterpreted:
//!
//! - **Claude Code (`tool_error`)**: a `type: "user"` line whose `message.content` holds a
//!   `tool_result` block with `is_error: true`. Its identity is the block's `tool_use_id`.
//! - **Claude Code (`api_error`)**: a `type: "assistant"` line whose top-level
//!   `isApiErrorMessage` is the JSON boolean `true` (written after Claude Code's own retries, so
//!   it counts model calls that failed for the session, not each retried attempt). Its identity is
//!   the line's top-level `uuid`.
//! - **Codex (`tool_error`)**: an `event_msg` line whose payload is `item_completed` and whose
//!   item has `status: "failed"` or an `exit_code` that is a non-zero integer. Its identity is the
//!   item's `id` within the thread, so an item that holds both counts once. (Codex records no exit
//!   status on `function_call_output`, and no `api_error` marker in rollout JSONL.)
//!
//! A harness with no pinned marker for a failure kind has none here, and the report says
//! `unsupported` for it, never 0.
//!
//! Nothing but the kind, the identity, the time and what the line says of its session is kept: no
//! tool name, no arguments, no output, no error status and no error text. The store keeps the
//! identity as a keyed hash.

use memchr::memmem;
use serde::Deserialize;

use super::{FileCtx, Source, clip, from_line};
use crate::time::parse_rfc3339;

pub const TOOL_ERROR: &str = "tool_error";
pub const API_ERROR: &str = "api_error";

/// The harnesses whose `tool_error` marker a fixture pins.
pub const PINNED: [Source; 2] = [Source::Claude, Source::Codex];

/// The harnesses whose `api_error` marker a fixture pins.
pub const API_ERROR_PINNED: [Source; 1] = [Source::Claude];

/// Whether the meter can tell a tool failure in this harness's log.
pub fn pinned(s: Source) -> bool {
    PINNED.contains(&s)
}

/// Whether the meter can tell a failed model call (`api_error`) in this harness's log.
pub fn api_error_pinned(s: Source) -> bool {
    API_ERROR_PINNED.contains(&s)
}

/// One tool result (`tool_error`) or model call (`api_error`) its harness flagged as failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolError {
    /// [`TOOL_ERROR`] or [`API_ERROR`].
    pub kind: &'static str,
    /// Stable per failure, across copies of the line in other files: the dedupe key.
    pub ident: String,
    pub ts_ms: i64,
    pub harness: &'static str,
    pub session: Option<String>,
    pub parent_session: Option<String>,
    pub cwd: Option<String>,
    /// Where the session started, as a usage event of the same session has it.
    pub session_cwd: Option<String>,
    pub branch: Option<String>,
    /// `host/owner/repo` when the harness recorded the remote itself (Codex); else from `cwd`.
    pub repo: Option<String>,
}

/// Pushes the harness-flagged failures `line` records, if its harness has a pinned marker. `ctx`
/// is the file's context after the usage parser saw the line.
pub fn scan_line(source: Source, line: &[u8], ctx: &FileCtx, out: &mut Vec<ToolError>) {
    match source {
        Source::Claude => claude(line, ctx, out),
        Source::Codex => codex(line, ctx, out),
        Source::Omp | Source::DshTui | Source::Agy => {}
    }
}

#[derive(Deserialize)]
struct ClaudeRow {
    #[serde(rename = "type")]
    ty: Option<String>,
    uuid: Option<serde_json::Value>,
    #[serde(rename = "isApiErrorMessage")]
    is_api_error_message: Option<serde_json::Value>,
    message: Option<ClaudeMessage>,
    timestamp: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    cwd: Option<String>,
    #[serde(rename = "gitBranch")]
    git_branch: Option<String>,
}

#[derive(Deserialize)]
struct ClaudeMessage {
    content: Option<ClaudeContent>,
}

/// A user message's content: tool results come as blocks; a typed prompt is a string.
#[derive(Deserialize)]
#[serde(untagged)]
enum ClaudeContent {
    Blocks(Vec<ClaudeBlock>),
    Other(serde::de::IgnoredAny),
}

/// One content block, read as far as its type, its id and its flag: the result's text is skipped.
#[derive(Deserialize)]
#[serde(untagged)]
enum ClaudeBlock {
    Known {
        #[serde(rename = "type")]
        ty: Option<String>,
        tool_use_id: Option<serde_json::Value>,
        is_error: Option<serde_json::Value>,
    },
    Other(serde::de::IgnoredAny),
}

fn claude(line: &[u8], ctx: &FileCtx, out: &mut Vec<ToolError>) {
    let has_tool_err = memmem::find(line, b"\"tool_result\"").is_some()
        && memmem::find(line, b"\"is_error\"").is_some();
    let has_api_err = memmem::find(line, b"\"isApiErrorMessage\"").is_some();
    if !has_tool_err && !has_api_err {
        return;
    }
    let Some(row) = from_line::<ClaudeRow>(line) else {
        return;
    };
    let Some(ts_ms) = row.timestamp.as_deref().and_then(parse_rfc3339) else {
        return;
    };
    // The same session rule as a usage line: a sub-agent transcript repeats its parent's
    // sessionId, and its own id is the file's.
    let session = if ctx.parent_session.is_some() {
        ctx.session
            .clone()
            .or_else(|| row.session_id.as_deref().map(|s| clip(s, 128)))
    } else {
        row.session_id
            .as_deref()
            .map(|s| clip(s, 128))
            .or_else(|| ctx.session.clone())
    };
    let cwd = row
        .cwd
        .as_deref()
        .map(|c| clip(c, 1024))
        .or_else(|| ctx.cwd.clone());
    let session_cwd = if ctx.parent_session.is_some() {
        ctx.parent_cwd.clone()
    } else {
        // A failure before the session's first usage line: its own cwd is the first recorded.
        ctx.cwd.clone().or_else(|| cwd.clone())
    };
    let branch = row
        .git_branch
        .as_deref()
        .filter(|b| !b.is_empty())
        .map(|b| clip(b, 256));
    if row.ty.as_deref() == Some("assistant") {
        // The flag as Claude Code writes it after its own retries: the JSON boolean true on a
        // top-level assistant line, counted once per top-level uuid.
        if row.is_api_error_message != Some(serde_json::Value::Bool(true)) {
            return;
        }
        let Some(id) = row
            .uuid
            .as_ref()
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        else {
            return;
        };
        out.push(ToolError {
            kind: API_ERROR,
            ident: format!("api_err|claude|{}", clip(id, 128)),
            ts_ms,
            harness: "claude-code",
            session,
            parent_session: ctx.parent_session.clone(),
            cwd,
            session_cwd,
            branch,
            repo: None,
        });
        return;
    }
    if row.ty.as_deref() != Some("user") {
        return;
    }
    let Some(ClaudeContent::Blocks(blocks)) = row.message.and_then(|m| m.content) else {
        return;
    };
    for b in blocks {
        let ClaudeBlock::Known {
            ty,
            tool_use_id,
            is_error,
        } = b
        else {
            continue;
        };
        // The flag as Claude Code writes it: the JSON boolean true, nothing else.
        if ty.as_deref() != Some("tool_result") || is_error != Some(serde_json::Value::Bool(true)) {
            continue;
        }
        let Some(id) = tool_use_id
            .as_ref()
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        out.push(ToolError {
            kind: TOOL_ERROR,
            ident: format!("err|claude|{}", clip(id, 128)),
            ts_ms,
            harness: "claude-code",
            session: session.clone(),
            parent_session: ctx.parent_session.clone(),
            cwd: cwd.clone(),
            session_cwd: session_cwd.clone(),
            branch: branch.clone(),
            repo: None,
        });
    }
}

#[derive(Deserialize)]
struct CodexRow {
    timestamp: Option<String>,
    #[serde(rename = "type")]
    ty: Option<String>,
    payload: Option<CodexPayload>,
}

#[derive(Deserialize)]
struct CodexPayload {
    #[serde(rename = "type")]
    ty: Option<String>,
    item: Option<CodexItem>,
}

/// A completed item, read as far as its id, status and exit status: its output is skipped.
#[derive(Deserialize)]
struct CodexItem {
    id: Option<serde_json::Value>,
    status: Option<serde_json::Value>,
    exit_code: Option<serde_json::Value>,
}

fn codex(line: &[u8], ctx: &FileCtx, out: &mut Vec<ToolError>) {
    if memmem::find(line, b"\"item_completed\"").is_none()
        || (memmem::find(line, b"\"failed\"").is_none()
            && memmem::find(line, b"\"exit_code\"").is_none())
    {
        return;
    }
    let Some(c) = ctx.codex.as_ref() else {
        return;
    };
    let Some(row) = from_line::<CodexRow>(line) else {
        return;
    };
    let Some(p) = row.payload else {
        return;
    };
    if row.ty.as_deref() != Some("event_msg") || p.ty.as_deref() != Some("item_completed") {
        return;
    }
    let Some(item) = p.item else {
        return;
    };
    // Codex's own flag, or the exit status it recorded: either one, the item counted once.
    let failed = item.status.as_ref().and_then(|v| v.as_str()) == Some("failed");
    let nonzero = item
        .exit_code
        .as_ref()
        .and_then(|v| v.as_i64())
        .is_some_and(|n| n != 0);
    if !failed && !nonzero {
        return;
    }
    let Some(id) = item
        .id
        .as_ref()
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    else {
        return;
    };
    let Some(ts_ms) = row.timestamp.as_deref().and_then(parse_rfc3339) else {
        return;
    };
    out.push(ToolError {
        kind: TOOL_ERROR,
        ident: format!("err|codex|{}|{}", clip(&c.thread, 128), clip(id, 128)),
        ts_ms,
        harness: "codex",
        session: Some(c.thread.clone()),
        parent_session: c.parent.clone(),
        cwd: c.cwd.clone(),
        session_cwd: c.cwd.clone(),
        branch: c.branch.clone(),
        repo: c.repo.clone(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::codex::CodexCtx;

    fn fixture(name: &str) -> String {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/tool-errors")
            .join(name);
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
    }

    /// The ids the fixtures' own answer sheet expects, in file order.
    fn expected(name: &str) -> Vec<String> {
        let v: serde_json::Value = serde_json::from_str(&fixture("expected.json")).unwrap();
        v[name]["tool_errors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect()
    }

    fn expected_api_errors(name: &str) -> Option<Vec<String>> {
        let v: serde_json::Value = serde_json::from_str(&fixture("expected.json")).unwrap();
        v[name]["api_errors"]
            .as_array()
            .map(|a| a.iter().map(|s| s.as_str().unwrap().to_string()).collect())
    }

    fn scan(source: Source, name: &str, ctx: &FileCtx) -> Vec<ToolError> {
        let mut out = Vec::new();
        for line in fixture(name).lines() {
            scan_line(source, line.as_bytes(), ctx, &mut out);
        }
        out
    }

    /// The distinct identities of `kind`, in first-seen order: what the store's dedupe keeps.
    fn distinct(found: &[ToolError], kind: &str, prefix: &str) -> Vec<String> {
        let mut ids: Vec<String> = Vec::new();
        for e in found.iter().filter(|e| e.kind == kind) {
            let id = e.ident.strip_prefix(prefix).unwrap().to_string();
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        ids
    }

    #[test]
    fn claude_counts_a_tool_result_flagged_is_error_true_once_per_tool_use_id() {
        let found: Vec<ToolError> = scan(Source::Claude, "claude.jsonl", &FileCtx::default())
            .into_iter()
            .filter(|e| e.kind == TOOL_ERROR)
            .collect();
        // The fixture repeats one failed result (a resumed session's copy): two lines, one id.
        assert_eq!(found.len(), expected("claude.jsonl").len() + 1);
        assert_eq!(
            distinct(&found, TOOL_ERROR, "err|claude|"),
            expected("claude.jsonl")
        );
        let e = &found[0];
        assert_eq!(e.harness, "claude-code");
        assert_eq!(e.session.as_deref(), Some("sess-fixture-1"));
        assert_eq!(e.cwd.as_deref(), Some("/work/app"));
        assert_eq!(e.session_cwd.as_deref(), Some("/work/app"));
        assert_eq!(e.branch.as_deref(), Some("feat/x"));
        assert_eq!(e.ts_ms, parse_rfc3339("2026-01-15T10:00:05Z").unwrap());
    }

    #[test]
    fn claude_counts_an_assistant_is_api_error_message_true_once_per_uuid_and_adds_zero_tokens() {
        let all = scan(Source::Claude, "claude.jsonl", &FileCtx::default());
        let api: Vec<ToolError> = all
            .iter()
            .filter(|e| e.kind == API_ERROR)
            .cloned()
            .collect();
        let want = expected_api_errors("claude.jsonl").unwrap();
        // The fixture repeats the api_error uuid once, and includes false, "true" and a user
        // prompt quoting "isApiErrorMessage": true: two positive lines, one distinct uuid.
        assert_eq!(api.len(), want.len() + 1);
        assert_eq!(distinct(&api, API_ERROR, "api_err|claude|"), want);
        let e = &api[0];
        assert_eq!(e.harness, "claude-code");
        assert_eq!(e.session.as_deref(), Some("sess-fixture-1"));
        assert_eq!(e.cwd.as_deref(), Some("/work/app"));
        assert_eq!(e.session_cwd.as_deref(), Some("/work/app"));
        assert_eq!(e.branch.as_deref(), Some("feat/x"));
        assert_eq!(e.ts_ms, parse_rfc3339("2026-01-15T10:00:10Z").unwrap());
        // Adds 0 tokens to usage (a `<synthetic>` line, which `claude.rs` already ignores)
        // and is never counted as a `tool_error`.
        assert_eq!(
            distinct(&all, TOOL_ERROR, "err|claude|"),
            expected("claude.jsonl")
        );
        let mut ctx = FileCtx::default();
        let mut usage = Vec::new();
        for line in fixture("claude.jsonl").lines() {
            crate::sources::claude::parse_line(line.as_bytes(), &mut ctx, &mut usage);
        }
        assert_eq!(
            usage.len(),
            2,
            "only the two real assistant calls emit usage"
        );
        assert!(usage.iter().all(|u| u.model == "claude-opus-5-5"));
        // Codex has no pinned api_error marker: expected.json records null.
        assert_eq!(expected_api_errors("codex.jsonl"), None);
        assert!(!api_error_pinned(Source::Codex));
        assert!(api_error_pinned(Source::Claude));
    }

    #[test]
    fn a_claude_sub_agent_failure_keeps_its_parents_session_and_start_folder() {
        let ctx = FileCtx {
            session: Some("agent-fixture".into()),
            parent_session: Some("sess-fixture-1".into()),
            parent_cwd: Some("/work/app".into()),
            ..FileCtx::default()
        };
        let found = scan(Source::Claude, "claude.jsonl", &ctx);
        for e in &found {
            assert_eq!(e.session.as_deref(), Some("agent-fixture"));
            assert_eq!(e.parent_session.as_deref(), Some("sess-fixture-1"));
            assert_eq!(e.session_cwd.as_deref(), Some("/work/app"));
        }
    }

    #[test]
    fn codex_counts_a_failed_status_or_a_non_zero_exit_code_once_per_item() {
        let ctx = FileCtx {
            codex: Some(CodexCtx {
                thread: "thread-fixture".into(),
                cwd: Some("/work/app".into()),
                branch: Some("feat/x".into()),
                ..CodexCtx::default()
            }),
            ..FileCtx::default()
        };
        let found = scan(Source::Codex, "codex.jsonl", &ctx);
        // (a) failed with a non-zero exit code is one fact, (b) failed with none is one, and
        // (c) completed with 0, (d) a non-tool item and (e) an unknown status are none.
        let ids: Vec<String> = found
            .iter()
            .map(|e| {
                e.ident
                    .strip_prefix("err|codex|thread-fixture|")
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(ids, expected("codex.jsonl"));
        assert_eq!(found[0].session.as_deref(), Some("thread-fixture"));
        assert_eq!(found[0].session_cwd.as_deref(), Some("/work/app"));
        // Without the thread's context there is no session to tie a failure to: none is taken.
        assert!(scan(Source::Codex, "codex.jsonl", &FileCtx::default()).is_empty());
    }

    #[test]
    fn a_harness_with_no_pinned_marker_yields_nothing() {
        for s in [Source::Omp, Source::DshTui, Source::Agy] {
            assert!(!pinned(s));
            assert!(!api_error_pinned(s));
            assert!(scan(s, "claude.jsonl", &FileCtx::default()).is_empty());
        }
        assert!(pinned(Source::Claude) && pinned(Source::Codex));
        assert!(api_error_pinned(Source::Claude) && !api_error_pinned(Source::Codex));
    }

    #[test]
    fn a_fact_keeps_no_text_of_the_result() {
        let found = scan(Source::Claude, "claude.jsonl", &FileCtx::default());
        let dump = format!("{found:?}");
        for leak in [
            "FAKE-TOOL-OUTPUT",
            "FAKE-ERROR-TEXT",
            "FAKE-API-ERROR-TEXT",
            "rate_limit",
            "429",
            "Bash",
            "FAKE-COMMAND",
        ] {
            assert!(
                fixture("claude.jsonl").contains(leak),
                "{leak} is in the fixture"
            );
            assert!(!dump.contains(leak), "{leak} was kept");
        }
    }
}
