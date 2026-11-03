# @automagik/acp-dsh

Agents other than DSH's own, as DeepSeek Harness models, over the
[Agent Client Protocol](https://agentclientprotocol.com) (ACP). The design is
[RFC 0003](../../docs/rfcs/0003-model-routes-and-acp.md).

- **Agents as DSH models.** Each agent is a provider route with one model (`acp-<agent>`). A
  chat or a Bot picks it like any model. DSH keeps the Session, its history and the sidebar.
- **DSH tool cards and approvals.** The agent runs its own tools. Each tool call it makes ends
  the model step with a call to `acp_tool`, a tool registered in that agent's scope only. DSH
  writes the `tool/call` and `tool/result` rows and draws the card (a terminal for a command, a
  diff for an edit, the generic card otherwise). When the agent asks permission for the call,
  `acp_tool` asks DSH's approval service (`approval/asked`, `approval/decided`) and gives the
  agent DSH's answer.
- **Only the chat reaches the agent.** DSH's side requests (a Session title, a summary) on an
  ACP route are refused at the `llm/stream` waterfall, so they never become prompts.
- **Host only.** No browser half, so the plugin cannot stop the web UI from loading. With no
  agent CLI installed it registers no route.
- **The Session's level, as the agent's own mode.** Before each prompt the agent's ACP session
  mode follows the Session: Claude Code in Manual, so it asks (through DSH) before any write or
  command whatever its own settings say; Codex in the sandbox that matches DSH's. Full access
  lets every call through, as it does DSH's own tools.

## Agents

| Route | Agent | Runs | Adapter (newest release) |
|---|---|---|---|
| `acp-claude` | Claude Code | the person's `claude` (`CLAUDE_CODE_EXECUTABLE`) | `@agentclientprotocol/claude-agent-acp` |
| `acp-codex` | Codex | the person's `codex` (`CODEX_PATH`) | `@agentclientprotocol/codex-acp` |
| `acp-fake` | `test/fixtures/fake-agent.mjs`, set as `fakeAgent` | Node | none; tests only |

An agent is offered only when its CLI is on PATH or where its installer puts it (`~/.local/bin`,
`/opt/homebrew/bin`, …). The settings `claude: false` or `codex: false` take one away.

The adapters are not pinned (RFC 0003, amended): the CLIs update themselves, and an adapter that
lags its CLI breaks first. They install in the background at DSH's start and once a day after,
with the pnpm on DSH's PATH (the desktop app's own) or else npm, into
`$AUTOMAGIK_HOME/acp/adapters/<package>/<version>`. An install goes to a fresh folder renamed into
place when complete, without install scripts or optional dependencies (the CLIs the adapters
bundle); the previous version stays for a Session still on it. Nothing is downloaded when a
Session starts. Until the first install lands, a turn on the agent says so.

## Check it

```sh
bun install && bun run harness
bun run test          # the adapter against the fake agent over real stdio
bun run lint
node dev/dsh-check.mjs   # one dsh headless turn on acp-fake in a temporary DSH home
node dev/dsh-check.mjs --agent claude   # the same on your own Claude Code (a few tokens)
node dev/dsh-check.mjs --agent codex    # the same on your own Codex (a few tokens)
```

`dev/dsh-check.mjs` installs the plugin the way DSH installs any plugin and reads the Session
log: the agent's text, a `tool/call` of `acp_tool` with its `tool/result`, and the
`approval/asked` and `approval/decided` pair for that call.

## Contracts

The plugin id `@automagik/acp-dsh`, the row id and storage prefix `acp-dsh`, the provider ids
`acp-<agent>` (never `claude-code*`, which the Bot team reads as the Claude Code plugin) and the
tool name `acp_tool` are public: Sessions keep them.
