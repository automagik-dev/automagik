# ACP adapters: DSH tools over MCP (spike)

Date: **2026-11-06**. For the [RFC 0003](../rfcs/0003-model-routes-and-acp.md) amendment (tracker
#516). Scratch client and servers in `/tmp`, no product code touched.

**Question.** Can a per-session MCP server carry DSH's tool set to an ACP agent, and can the tool
list change mid-session (a preset or level change) without restarting the agent? Two claims to
prove per adapter: `session/new`'s `mcpServers` is honoured **per session**, and MCP's
`notifications/tools/list_changed` reaches the agent's tool list.

## What ran

| | claude-agent-acp | codex-acp |
|---|---|---|
| Adapter | `@agentclientprotocol/claude-agent-acp` | `@agentclientprotocol/codex-acp` |
| Adapter version | 0.100.0 | 2.5.0 |
| Agent CLI | `claude` 2.1.319 | `codex-cli` 0.166.0 |
| ACP protocol | 1 (`initialize` → `protocolVersion: 1`) | 1 |
| MCP client (`clientInfo`) | `claude-code` 2.1.319 | `codex-mcp-client` |
| MCP protocol its client speaks | `2025-11-25` | `2025-06-18` |
| Host | macOS 25.5, arm64, Node 24.13.1 | same |

Method: a scratch ACP client over stdio (newline-delimited JSON-RPC) opened two ACP sessions in
one adapter process, each with its own stdio MCP server; a scratch MCP server offered
`spike_echo` from the first `tools/list` and added `spike_late` **after** the session started,
announcing it with `notifications/tools/list_changed`. Every line in both directions was recorded.
Prompts asked the agent to call the tool and to echo its text.

The options the build will use, verbatim from the wire:

```json
{"jsonrpc":"2.0","id":2,"method":"session/new","params":{
  "cwd":"/tmp/acp-spike/run-claude/project",
  "mcpServers":[{"name":"spike-A","command":"<node>","args":[".../mcp-server.mjs"],
    "env":[{"name":"MCP_TAG","value":"A"},{"name":"MCP_TRACE","value":"..."}]}]}}
```

stdio server objects are `{ name, command, args, env }` with `env` a list of `{name, value}`; http
and sse carry `{ type: "http" | "sse", url, headers }` and codex-acp also accepts an `acp` type.

## claude-agent-acp 0.100.0

**Per-session `mcpServers`: yes.** Session A's server (tag `A`) and session B's (tag `B`) were each
started by the adapter with their own env; A's call returned `echo:alpha:A`, B's `echo:beta:B`,
and neither session's agent saw the other's tool.

**`tools/list_changed`: yes, once the adapter's MCP client has settled.**

| Notification at | Re-list (`tools/list`) |
|---|---|
| 2 s after the server started | none |
| 3 s | none |
| 4 s | `tools/list` at 4004 ms |
| 5 s | 5005 ms |
| 6 s | 6004 ms |
| 8 s | 8003 ms |
| 12 s | 12004 ms |

At 5 s the late tool was then called and returned `late-ok:A` in the same session
(`tools/call {"name":"spike_late"}`). The adapter's client sends a `server/discover` probe
(MCP draft `2026-07-28`) before `initialize`; a server that answers `-32601` is served the
`2025-11-25` handshake, which is what the bridge must speak.

**Refresh with a new server list: yes.** `session/resume` with a different `mcpServers` array
returned the same session id and started the new server (`initialize` → `tools/list`), and
`session/fork` with a different array returned a **new** session id and started the new server.

**The agent's own tools can be turned off.** `session/new` `_meta.disableBuiltInTools: true`
(the adapter's comment: a legacy shorthand for `_meta.claudeCode.options.tools: []`) removed the
built-in file tools: the same session could still call the MCP tool, yet answered `NO_WRITE_TOOL`
to a request to write a file, and no file appeared. ToolSearch stayed available, which the SDK
needs to load deferred MCP tools. The full options live at
`_meta.claudeCode.options` (`tools`, `allowedTools`, `disallowedTools`, …); changing one of them
on resume is in the adapter's `OPTION_REBUILDS_SESSION` set, so it tears the session down and
recreates it. Only `disableBuiltInTools` was exercised in this spike; every other option name in
that list is unverified here.

**Approval is the agent's, and its mode decides.** Started as-is, the session came up in Claude
Code's `auto` mode (`modes.currentModeId: "auto"`) and the MCP tool call ran with **no**
`session/request_permission`. After `session/set_mode` to `default` (Manual), the same call asked:
`session/request_permission` for `mcp__spike-A__spike_echo`, option `allow-once`. So an approval
dialog exists at the ACP layer, but the agent's own mode and saved rules can answer it without
DSH; a DSH-side approval cannot be built on it.

## codex-acp 2.5.0

**Per-session `mcpServers`: yes.** Both sessions' servers were started and called with their own
env (`echo:alpha:A`, `echo:beta:B`); the adapter writes each session's list into the Codex thread
config as `mcp_servers` (`{"<name>": {…}}`), merged over the person's own Codex config.

**`tools/list_changed`: no.** Notified at 4 s, 8 s and 15 s: no second `tools/list` in any run.
In the run that asked for the late tool, the agent answered "spike_late is not available from
server spike-A in this session".

**Refresh with a new server list: fork only.** `session/resume` with a different `mcpServers`
array returned the session but started **no** new MCP server (the thread keeps its config).
`session/fork` with a different array returned a new session id and started the new server
(`initialize` → `tools/list`).

**The agent's own tools cannot be turned off.** No `tools`, `allowedTools` or
`disableBuiltInTools` exists in the adapter's session handling (searched its bundle); its only
lever is the Codex sandbox mode. In the spike the agent used its own file and shell tools, and its
own skills from `~/.codex`, in the same session it used the MCP tool.

**Approval: none observed.** No `session/request_permission` arrived for the MCP call; Codex ran
its own "Guardian Review" tool call around it instead.

**Name collisions are skipped, not merged.** codex-acp reads the person's own
`mcp_servers` names and drops a requested server whose name is already defined there
(`skippedMcpServers`); a bridge that shares a name with a person's server would silently not be
the one the agent uses.

**Environment.** The adapters drive the person's CLI and need that path: `CLAUDE_CODE_EXECUTABLE`
for claude-agent-acp (without it, it looks for the CLI in its own SDK and fails), `CODEX_PATH` for
codex-acp. claude-agent-acp also reads `CLAUDE_AGENT_ACP_PROTOCOL` (`auto` | `v1` | `v2`).

## What this means for the amendment

- The bridge is feasible for both adapters: one stdio MCP server per ACP session, decided by the
  session, never a port.
- A tool-list refresh is **not uniform**: Claude Code re-lists from `tools/list_changed` (after a
  ~4 s settle) and honours a new list on resume; Codex re-lists never and ignores a new list on
  resume, so a preset or level change on `acp-codex` needs `session/fork` with the new server set
  (a new thread that continues the same conversation).
- Turning the agent's built-in tools off is possible on `acp-claude` and not on `acp-codex`. On
  Codex the "one tool set" is therefore a DSH-tools-plus-Codex-tools session, and the approval
  path is still DSH's for DSH's tools only.
- DSH's approval cannot ride on `session/request_permission`: the agent's own mode decides there.
  The approval must be asked by the bridge itself, inside the DSH Session, before the tool runs.
