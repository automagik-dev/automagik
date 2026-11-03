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
  agent CLI installed it registers no route. The welcome draws its setup from the `acpAgents`
  service below.
- **The Session's level, as the agent's own mode.** Before each prompt the agent's ACP session
  mode follows the Session: Manual is Claude Code's `default` mode, whatever default mode its
  own settings name; Codex runs in the sandbox that matches DSH's. Auto is Claude Code's `auto`
  and Codex's `agent`. Full access lets every call through, as it does DSH's own tools. An agent
  that does not offer the strict mode fails the turn instead of running in its own default.
- **Claude Code keeps the person's own settings.** It loads their Claude Code settings (user,
  project and local) and asks DSH only for what those leave as "ask". A call their allow rules,
  saved "always allow" rules or PreToolUse/PermissionRequest hooks approve runs with no DSH
  dialog. This is the owner's decision (RFC 0003, Decided).

## Agents

| Route | Agent | Runs | Adapter (newest release) |
|---|---|---|---|
| `acp-claude` | Claude Code | the person's `claude` (`CLAUDE_CODE_EXECUTABLE`) | `@agentclientprotocol/claude-agent-acp` |
| `acp-codex` | Codex | the person's `codex` (`CODEX_PATH`) | `@agentclientprotocol/codex-acp` |
| `acp-fake` | `test/fixtures/fake-agent.mjs`, set as `fakeAgent` | Node | none; tests only |

An agent is offered only when its CLI is on PATH or where its installer puts it (`~/.local/bin`,
`/opt/homebrew/bin`, …). The settings `claude: false` or `codex: false` take one away. They are
live settings: switching one (from the welcome's Connect AI, its Settings page *Claude Code and
Codex*, or the plugin's own settings form) offers or withdraws the agent at once, with no
restart, and a connector that lands puts its model in the picker the same way
(`llm/adapters-updated`).

## The `acpAgents` service

A settings page reads the agents through this host service; the plugin stays host only.

| Method | Does |
|---|---|
| `status()` | Each agent: `{ id, key, name, on, cli: { found, installUrl }, connector: { state, version?, error?, updating? }, signedIn?, model: { provider, id, name, listed }, restartNeeded }`. `state` is `off`, `no-cli`, `installing`, `failed` (with the last install error) or `ready`. Spawns nothing. |
| `refresh()` | Looks for the CLIs again (one installed after DSH started is offered now), then asks each CLI whether it is signed in (`claude auth status --json`, of which only `loggedIn` is read; `codex login status`, by its exit code). No agent turn. |
| `retry(id)` | Starts the connector's install again, and answers at once. |

The switches are not the service's: a page writes them in the `acp-dsh` settings entry
through DSH's settings service (the welcome does, `src/host/acp.js` there).

The adapters are not pinned (RFC 0003, amended): the CLIs update themselves, and an adapter that
lags its CLI breaks first. They install in the background at DSH's start and once a day after,
with the desktop app's own pnpm (`AUTOMAGIK_PNPM`, never the person's) or else npm, into
`$AUTOMAGIK_HOME/acp/adapters/<package>/<version>`. An install goes to a fresh folder renamed into
place when complete, without install scripts or optional dependencies (the CLIs the adapters
bundle); an install that pulls in a bundled CLI's platform package anyway is refused. The
previous version stays for a Session still on it. Nothing is downloaded when a Session starts.
Until the first install lands, the agent lists no model; a Session already on it says the
adapter is being installed, with the last install error.

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
