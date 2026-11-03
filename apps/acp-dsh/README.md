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
  agent configured it registers no route.

## Agents

| Route | Agent | Status |
|---|---|---|
| `acp-fake` | `test/fixtures/fake-agent.mjs`, set as `fakeAgent` | tests only |

## Check it

```sh
bun install && bun run harness
bun run test          # the adapter against the fake agent over real stdio
bun run lint
node dev/dsh-check.mjs   # one dsh headless turn on acp-fake in a temporary DSH home
```

`dev/dsh-check.mjs` installs the plugin the way DSH installs any plugin and reads the Session
log: the agent's text, a `tool/call` of `acp_tool` with its `tool/result`, and the
`approval/asked` and `approval/decided` pair for that call.

## Contracts

The plugin id `@automagik/acp-dsh`, the row id and storage prefix `acp-dsh`, the provider ids
`acp-<agent>` (never `claude-code*`, which the Bot team reads as the Claude Code plugin) and the
tool name `acp_tool` are public: Sessions keep them.
