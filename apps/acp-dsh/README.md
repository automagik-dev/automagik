# @automagik/acp-dsh

Agents other than DSH's own, as DeepSeek Harness models, over the
[Agent Client Protocol](https://agentclientprotocol.com) (ACP). The design is
[RFC 0003](../../docs/rfcs/0003-model-routes-and-acp.md).

- **Agents as DSH models.** Each agent is a provider route (`acp-<agent>`) whose models are the
  agent's own (Claude Code's Opus, Sonnet, Haiku…; Codex's GPT models), each with the reasoning
  efforts the agent offers for it. A chat or a Bot picks one like any model. DSH keeps the
  Session, its history and the sidebar.
- **The agent's own models and efforts.** They are read from the agent over ACP: its session
  config options of category `model` and `thought_level`. A probe starts the adapter, opens a
  session it never prompts (no turn, no tokens), reads the models, then picks each one to read
  its efforts, since an agent rebuilds that list per model. The result is kept in
  `$AUTOMAGIK_HOME/acp/catalog/<route>.json`, so the next start lists it at once while a new probe
  runs; a new adapter release probes again. Before any probe has answered, a short list stands
  in (Claude Code: `default`, `opus`, `sonnet`, `haiku` at low, medium or high effort; Codex:
  `default`). The model `default` is always listed: it is whatever the agent's own settings
  choose. An effort's default is the person's own setting for that model.
- **The Session's model and effort, before each prompt.** The agent's session is put on the
  Session's model, then its effort (the model first: the efforts are that model's). No effort
  leaves the agent's own. A model or effort the agent does not offer fails the turn, naming what
  it offers.
- **DSH tool cards and approvals.** With `dshTools` off (the kill switch), the agent runs its own
  tools. Each tool call it makes ends the model step with a call to `acp_tool`, a tool registered
  in that agent's scope only. DSH writes the `tool/call` and `tool/result` rows and draws the
  card (a terminal for a command, a diff for an edit, the generic card otherwise). When the agent
  asks permission for the call, `acp_tool` asks DSH's approval service
  (`approval/asked`, `approval/decided`) and gives the agent DSH's answer.
- **DSH's own tools over the bridge (`dshTools`).** On, the agent gets the Session's preset tool
  set (standard, or cordis in creator mode) over one stdio MCP server per ACP session, named
  `dsh` and spawned by the adapter with that session's arguments. The bridge has no port; it
  reaches this plugin over a loopback back-channel with a per-session credential
  (`DSH_BRIDGE_CREDENTIAL`), which binds a request to its Session and is revoked with the
  bridge. Every DSH tool call is approved in DSH under the Session's level before it runs,
  whatever the agent's own allow rules or hooks say, and the bridge writes the `tool/call` and
  `tool/result` rows the chat shows. `acp-claude` runs with its built-in tools off
  (`_meta.disableBuiltInTools`); a structured call that is not an MCP name is recorded as
  `plugin:acp-dsh/toolset-drift` and its turn is cancelled — the detector runs at every session
  start, and it detects and cancels because the update arrives after the call began.
  `acp-codex` has no such switch, so it is bridged only with an explicit `dshTools: true`;
  absent or `false` means no bridge and its built-ins stay its own tool set. Until a structured
  name is proven in its tool calls, it draws no ACP card for an MCP call. The person's
  own MCP servers load beside the bridge with their own tools and sign-ins: DSH hands the session
  only the `dsh` bridge, so any other `mcp__<server>__<tool>` is the CLI's own user-scope config
  (claude-agent-acp merges the person's settings MCP servers into the session), it passes the
  drift allowlist by design, and DSH's Auto review does not gate it: the agent's own rules and
  sign-in govern that call. A tool-list change
  (a preset or level change) is announced on `acp-claude` and arrives through `session/fork`
  plus `session/close` on `acp-codex`; a bridge that never lists its tools fails the turn
  (`acp_bridge_missing`) before the prompt. **Auto:** DSH's Auto preset is full access's sandbox
  with asks answered by auto-review. A bridge call adds one marked, tool-only assistant block
  for the reviewer, removes it from the surface once the call settles, and never replays it to
  another provider; the reviewer sees the bridge tool, its redacted arguments and its schema
  before the body runs. A denial is `AUTO_REVIEW_DENIED`, a failed reviewer refuses with
  `AUTO_REVIEW_FAILED`, a review past its deadline is `AUTO_REVIEW_TIMEOUT`, and the call never
  runs. The reviewer goes to the same non-agent side model as a Session title. Manual asks (one
  dialog), Full access does not. A Session that moves between providers carries its transcript
  redacted at each crossing — the replay out to an agent, and the transcript handed back to a
  native provider — and each crossing writes a provider-boundary row the chat shows. The
  reasoning effort the Session ran on crosses with it, both ways, when the target model offers
  that level (matched by id, else by name), replacing the target default DSH records on a model
  change; an effort DSH itself defaulted is not carried. A target with no reasoning levels,
  without that one, or whose levels cannot be read writes a notice row saying so and runs on its
  own. A switch back before the agent has answered drops the agent's chosen level; the native
  target's own default applies.
- **Only the chat reaches the agent.** DSH's side requests on an ACP route never become
  prompts. At the `llm/stream` waterfall a Session title (`purpose: session-title`) goes to a
  model that answers on its own, without the agent's effort. That is the first model the team
  can reach: DSH's default model (`agentDefaultModel`) when it is not an agent; else a
  `sideModel` the person chose; else the first configured non-agent route; and only then the
  built-in DeepSeek Flash fallback. A credential or missing-route failure on one candidate moves
  to the next, so a team without a DeepSeek key reviews and titles on the model it does have;
  only no answer at all refuses. Auto review (`purpose: auto-review`) takes the same route, with
  its messages redacted first. Every other side request on an ACP route, a compaction summary
  included, is refused (`UNSUPPORTED`): it would carry the agent's whole chat to another
  provider, and the agent manages its own context. Sessions on any other route are left alone.
- **Host only.** No browser half, so the plugin cannot stop the web UI from loading. With no
  agent CLI installed it registers no route. The welcome draws its setup from the `acpAgents`
  service below.
- **The Session's level, as the agent's own mode.** Before each prompt the agent's ACP session
  mode follows the Session: Manual is Claude Code's `default` mode, whatever default mode its
  own settings name; Codex runs in the sandbox that matches DSH's. Auto is Claude Code's `auto`
  and Codex's `agent`; it is the preset's identity, never just its sandbox and ask, so a custom
  preset with the same knobs keeps Manual (and the bridge's own approval). Full access lets every
  call through, as it does DSH's own tools. An agent
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
| `acp-fake` | `dev/fake-agent.mjs`, set as `fakeAgent` | Node | none; tests only |

An agent is offered only when its CLI is on PATH or where its installer puts it (`~/.local/bin`,
`/opt/homebrew/bin`, …). The settings `claude: false` or `codex: false` take one away. They are
live settings: switching one (from the welcome's Connect AI, its Settings page *Claude Code and
Codex*, or the plugin's own settings form) offers or withdraws the agent at once, with no
restart, and a connector that lands puts its model in the picker the same way
(`llm/adapters-updated`).

`dshTools` (live, no schema default) is the bridge, its DSH approval, the drift detector and live
switching above. Absent means the per-agent default: `acp-claude` bridges because its adapter can
drop its own built-in tools; `acp-codex` does not, because it cannot. Codex is bridged only with
an explicit `true`; absent or `false` means no bridge, and Codex keeps its own built-in tools as
its only tool set. An explicit `false` is the kill switch for Claude too: the 2026-11-03
behaviour, where each agent keeps its own tools and its own approvals. The key is public and
stays writable through
DSH's settings service or the profile patch, but it is hidden from settings forms (`.hidden()`):
it is a rollback lever, not a preference. Flipping it either way ends the running agent sessions
and revokes their bridges at once; the DSH Session keeps its transcript and the next turn starts
afresh under the new setting. The default moves Claude Bots once per team to
`acp-claude` (the Bot team's README, "Claude on ACP"); the bridge probe in `bridge()` still gates
the move.

`sideModel` (`{ provider, model }`, default `deepseek-official/deepseek-flash`, live) is the
model a side request tries after DSH's default model and before the first configured non-agent
route. An explicit value the person chose is tried first; the default DeepSeek Flash comes last,
so a team without a DeepSeek key titles and reviews on the model it does have. An agent route set
here is ignored, and a credential or missing-route failure falls through to the next candidate.

## The `acpAgents` service

A settings page reads the agents through this host service; the plugin stays host only.

| Method | Does |
|---|---|
| `status()` | Each agent: `{ id, key, name, on, cli: { found, installUrl }, connector: { state, version?, error?, updating? }, signedIn?, model: { provider, id, name, listed }, restartNeeded }`. `state` is `off`, `no-cli`, `installing`, `failed` (with the last install error) or `ready`. Spawns nothing. |
| `refresh()` | Looks for the CLIs again (one installed after DSH started is offered now), then asks each CLI whether it is signed in (`claude auth status --json`, of which only `loggedIn` is read; `codex login status`, by its exit code). No agent turn. |
| `retry(id)` | Starts the connector's install again, and answers at once. |
| `bridge()` | `{ on, probesPass }`: whether `dshTools` is on, and whether a real probe on this machine passes — the per-session bridge gets a fresh credential, answers MCP `initialize` and `tools/list`, and lists at least one tool. A success is cached per installed adapter version; a failure is retried after ten minutes or the next app start. A missing adapter or a failed probe says no. The Bot team reads it before its one-time move of Claude Bots onto `acp-claude`, so no Bot moves onto a route whose bridge cannot work. |

The switches are not the service's: a page writes them in the `acp-dsh` settings entry
through DSH's settings service (the welcome does, `src/host/acp.js` there).

The adapters are not pinned (RFC 0003, amended): the CLIs update themselves, and an adapter that
lags its CLI breaks first. They install in the background at DSH's start and once a day after,
with the desktop app's own pnpm (`AUTOMAGIK_PNPM`, never the person's) or else npm, into
`$AUTOMAGIK_HOME/acp/adapters/<package>/<version>`. An install goes to a fresh folder renamed into
place when complete, without install scripts or optional dependencies (the CLIs the adapters
bundle); an install that pulls in a bundled CLI's platform package anyway is refused. The
previous version stays for a Session still on it. Nothing is downloaded when a Session starts.
An install still running when DSH quits is killed with everything it started and its folder
removed; one a killed DSH left behind is removed at the next start.
Until the first install lands, the agent lists no model; a Session already on it says the
adapter is being installed, with the last install error.

## Check it

```sh
bun install && bun run harness
bun run test          # the adapter against the fake agent over real stdio
bun run lint
node dev/dsh-check.mjs   # one dsh headless turn on acp-fake (fake-small, high effort) in a temporary DSH home
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
