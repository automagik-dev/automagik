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
  with asks answered by auto-review. A bridge call adds one marked, tool-only assistant block:
  the advertisement the Session format requires before its tool/call row, which the reviewer
  reads too, and which is removed from the surface once the call settles and never replayed to
  another provider; the reviewer sees the bridge tool, its redacted arguments and its schema
  before the body runs. A denial is `AUTO_REVIEW_DENIED`, a failed reviewer refuses with
  `AUTO_REVIEW_FAILED`, a review past its deadline is `AUTO_REVIEW_TIMEOUT`, and the call never
  runs. A Manual or Full call with no open step is `BRIDGE_NO_STEP`; one whose advertisement or
  call row cannot be written is `BRIDGE_RECORD_FAILED`, and the call does not run. The reviewer
  goes to the same non-agent side model as a Session title. Manual asks (one dialog), Full
  access does not. A Session that moves between providers carries its transcript
  redacted at each crossing — the replay out to an agent, and the transcript handed back to a
  native provider — and each crossing writes a provider-boundary row the chat shows,
  "Switching to X": it is written before the reply and claims no answer, since the call can
  still fail after it. An agent whose CLI is signed out (ACP's `auth_required`, when its session
  opens or on a prompt) fails the turn as `MODEL_ACCESS_REQUIRED`, not `ACP_AGENT`. The
  reasoning effort the Session ran on crosses with it, both ways, when the target model offers
  that level (matched by id, else by name), replacing the target default DSH records on a model
  change; an effort DSH itself defaulted is not carried. The agents' levels are their own
  `thought_level` ids: Claude Code lists low, medium, high, xhigh and max, and Codex lists low,
  medium, high, xhigh, max and ultra, per model. A target with no reasoning levels, without
  that one, or whose levels cannot be read writes a notice row saying so and runs on its own.
  A switch back before the agent has answered drops the agent's chosen level; the native
  target's own default applies.
- **Only the chat reaches the agent.** DSH's side requests on an ACP route never become
  prompts. At the `llm/stream` waterfall a Session title (`purpose: session-title`) goes to a
  model that answers on its own, without the agent's effort. That is the first model the team
  can reach: DSH's default model (`agentDefaultModel`) when it is not an agent; else a
  `sideModel` the person chose; else each configured non-agent route in turn (its first model,
  at most eight); and only then the built-in DeepSeek Flash fallback. A credential or
  missing-route failure on one candidate moves to the next, so a team without a DeepSeek key
  reviews and titles on the model it does have; only no answer at all refuses. Auto review
  (`purpose: auto-review`) takes the same route, with its messages redacted first. Every other
  side request on an ACP route, a compaction summary included, is refused (`UNSUPPORTED`): it
  would carry the agent's whole chat to another provider, and the agent manages its own context.
  Sessions on any other route are left alone.
- **A switch onto an agent passes DSH's compaction guard.** `compaction-basic` prices every model
  switch on the destination's context window, which an agent does not declare, so a switch onto
  an agent in a Session with a request header used to fail with `MODEL_SWITCH_COMPACTION_FAILED`.
  This plugin wraps the engine's `compactPressure` (`src/host/pressure.js`, the method's only
  Automagik owner): an agent destination needs no compaction, every other destination goes to the
  engine unchanged. The wrapper is adopted when an agent is created and on its requests (a
  reloaded compaction plugin is a new engine), delegates to whatever is below it at call time, and
  on dispose unwinds only when it is on top. The method is private to `compaction-basic`; a guard
  test pins it, and a DSH flag for it is proposed upstream (RFC 0023). A switch *off* an agent is
  the destination's own business: for a Bot, the Bot team decides before the guard (its README,
  "Long chats").
- **Host only.** No browser half, so the plugin cannot stop the web UI from loading. With no
  agent CLI installed it registers no route. The welcome draws its setup from the `acpAgents`
  service below.
- **The Session's level, as the agent's own mode.** Before each prompt the agent's ACP session
  mode follows the Session: Manual is Claude Code's `default` mode, whatever default mode its
  own settings name; Codex runs in the sandbox that matches DSH's. Auto is Claude Code's `auto`
  and Codex's `agent`; it is the preset's identity, never just its sandbox and ask, so a custom
  preset with the same knobs keeps Manual (and the bridge's own approval). Full access lets every
  call through, as it does DSH's own tools. An agent that does not offer the strict mode fails
  the turn instead of running in its own default.
- **Claude Code keeps the person's own settings.** It loads their Claude Code settings (user,
  project and local) and asks DSH only for what those leave as "ask". A call their allow rules,
  saved "always allow" rules or PreToolUse/PermissionRequest hooks approve runs with no DSH
  dialog. This is the owner's decision (RFC 0003, Decided).

## Agents

| Route | Agent | Runs | Adapter (newest release) |
|---|---|---|---|
| `acp-claude` | Claude Code | managed or existing `claude` (`CLAUDE_CODE_EXECUTABLE`) | `@agentclientprotocol/claude-agent-acp` |
| `acp-codex` | Codex | managed or existing `codex` (`CODEX_PATH`) | `@agentclientprotocol/codex-acp` |
| `acp-fake` | `dev/fake-agent.mjs`, set as `fakeAgent` | Node | none; tests only |

An agent is offered when its managed CLI is ready, or an existing CLI is on PATH or where its
installer puts it (`~/.local/bin`, `/opt/homebrew/bin`, …). The settings `claude: false` or `codex: false` take one away. They are
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
afresh under the new setting. A flip is also announced on the plugin context as
`acp-dsh/dsh-tools-changed` with `{ on }`: DSH delivers `loader/volatile-update` only to the
plugin whose config changed, so another plugin would never see this one. The Bot team watches
that event, so turning the switch off moves its Claude Bots back at once, and turning it on moves
them again. A listener that throws is logged as a warning; the flip itself and its ended sessions
still hold, and the Bot team reverses at its next start (the route reads off or gone). The default
moves Claude Bots once per team to `acp-claude` (the Bot team's README,
"Claude on ACP"); the bridge probe in `bridge()` still gates the move.

The transcript replay is independent of the bridge: only an explicit `false` turns it off.

| `dshTools` | Claude Code: tools | Claude Code: replay | Codex: tools | Codex: replay |
|---|---|---|---|---|
| absent | DSH bridge, its own off | yes | its own only | yes |
| `true` | DSH bridge | yes | DSH bridge and its own | yes |
| `false` | its own only | no | its own only | no |

So with `dshTools` absent Codex sees the chat but not the team's tools; those need an explicit
`true` (two tool sets). A replay reaches an agent in each of these cases, redacted and capped at
120,000 characters, the oldest messages dropped first with a marker: a move from another
provider (with its "Switching to X" row); a new agent session in a chat that already has answers
(after a restart, or a session a crossing or a flip ended), with no row since the chat stayed on
that agent; and a live session resumed after the chat answered elsewhere (a move off Codex keeps
its session), which gets only the turns it missed, from its own last answer on, with the row. A
Bot part's handoff package (a relay marked `handoff`) is carried as the record it is: in the
part's first turn it stays in the prompt beside the person's words, and once the Bot team has
answered that turn itself, the next new session gets it in the replay. Both pass the redactor.
With `false`, an agent sees only its own session, and a new one in a chat with answers writes the
"does not see this chat's earlier messages" row instead.

`sideModel` (`{ provider, model }`, default `deepseek-official/deepseek-flash`, live) is the
model a side request tries after DSH's default model. An explicit value the person chose is tried
before the configured non-agent routes (each in turn, its first model); the default DeepSeek
Flash is tried last, so a team without a DeepSeek key titles and reviews on the model it does
have. An agent route set here is ignored, and a credential or missing-route failure falls
through to the next candidate.

## The `acpAgents` service

A settings page reads the agents through this host service; the plugin stays host only.

| Method | Does |
|---|---|
| `status()` | Each agent: `{ id, key, name, on, cli: { found, installUrl, state, managed, version?, error?, diagnostic?, logPath?, updating? }, connector: { state, version?, error?, updating? }, signedIn?, model: { provider, id, name, listed }, restartNeeded }`. CLI state is `missing`, `installing`, `failed` or `ready`; connector state is `off`, `no-cli`, `installing`, `failed` or `ready`. Errors are redacted. Spawns nothing. |
| `inspect(id)` | One agent's `status()` row with a fresh sign-in check, for a Bot about to be put on it. Asks that CLI's sign-in status only; installs, enables and starts nothing. Simultaneous checks share one probe, and an answer stands for 3 seconds (`refresh()` clears it). Undefined for an id that is no agent here. |
| `refresh()` | Looks for the CLIs again (one installed after DSH started is offered now), then asks each CLI whether it is signed in (`claude auth status --json`, of which only `loggedIn` is read; `codex login status`, by its exit code). No agent turn. |
| `retry(id)` | Retries the required CLI and its connector, and answers at once. Does not turn its model switch on. |
| `loginStart(id, { label? })` | Starts the CLI's own sign-in (`src/host/login.js`), or answers the attempt already at work for that agent. Codex: a device code through `codex app-server`; Claude Code: `claude auth login --claudeai`, whose link must ask for the manual code (`code=true`). Only the official authorization pages are relayed. `label` names the view that opened it (a Bot id), for a cancel confirmation; it is not an access check. |
| `loginCurrent(id)` | The attempt at work for that agent, from any view, or undefined. Never starts or cancels one. |
| `loginStatus(id, attemptId)` / `loginAnswer(id, attemptId, value)` / `loginCancel(id, attemptId)` | Reads an attempt (an ended one stays readable for 60 seconds), sends Claude's pasted `code#state` to the CLI (which then has 90 seconds to confirm), or ends it. |
| `loginTextMatches(text)` | Whether a text carries a Claude sign-in state shown in the last 24 hours. Only a boolean: the states are kept as keyed hashes in memory. |
| `loginActive()` | How many attempts are starting or waiting. |
| `imageAccess()` | `{ ready, signedIn? }`: whether Codex can draw an image now, on its own ChatGPT sign-in (Codex on, its CLI found, its connector installed, `codex login status` says signed in; an unknown sign-in is asked once). Reads no credential and starts no sign-in. |
| `generateImage({ prompt, size?, quality?, background?, signal?, timeoutMs? })` | Draws one image with the Codex CLI (`src/host/image.js`) and resolves `{ base64, mimeType: 'image/png' }`. Refusals carry an `acp/image-*` code (`signed-out`, `usage-limit`, `timeout`, `unavailable`, `failed`, `stopped`, `refused`) and a message to show as it is. |
| `keepImages(keeper)` | Where an image an agent makes in a chat is kept, so the chat can show it (`src/host/agent-image.js`). `keeper` is `{ start?({ callId, sessionId, via }), keep({ callId, sessionId, base64, mimeType, via }) -> Promise<{ file }>, fail?({ callId, sessionId, error }) }`; one at a time, and the call returns its disposer. The Bot team registers its images folder. |
| `bridge()` | `{ on, probesPass }`: whether `dshTools` is on, and whether a real probe on this machine passes — the per-session bridge gets a fresh credential, answers MCP `initialize` and `tools/list`, and lists at least one tool. A success is cached per installed adapter version; a failure is retried after ten minutes or the next app start. A missing adapter or a failed probe says no. The Bot team reads it before its one-time move of Claude Bots onto `acp-claude`, so no Bot moves onto a route whose bridge cannot work. |

**Images through Codex.** `generateImage` is a one-off codex-acp session that asks Codex's
built-in image tool for one picture (owner decision D-g): an empty scratch folder as its working
directory (removed afterwards), the `read-only` mode, no MCP servers and no bridge. The image
feature is turned on, and the person's own MCP servers replaced by none, for that process only,
through codex-acp's `CODEX_CONFIG` override: the person's `config.toml` is never written and
`CODEX_HOME` is never set. Every permission the agent asks is cancelled except the call titled
"Image generation". Codex's `read-only` mode still runs a read command without asking, so the
first call the agent reports that is not the image call (a command, a read, a tool) cancels the
turn and refuses the draw (`refused`): no image from that turn comes back. The person's own
Codex hooks and global instructions still load, as they do for any Codex run of theirs. The PNG is taken from that
call's own content (an ACP image block) or its `rawOutput.result`; the file Codex saves under its
home (`savedPath`) is never opened. The session is closed and the process ended when the image
arrives, the turn ends, the caller stops it, or 120 seconds pass. Neither the prompt nor what the
agent says is logged or kept.

**Images an agent makes in a chat.** A chat on an agent can ask it for a picture, and Codex then
uses its own image tool (an `other` call titled "Image generation"). The mirror call carries
`image: true` from the call's first sight, so the chat draws its image card at once and the
keeper's `start` lets that card count the wait. When the call ends, its PNG is taken from the
call's own update (an ACP image block, or the image call's `rawOutput.result`; the same for any
agent's call that answers with an image block, as Claude Code could) and handed to the keeper;
the call's result names the kept file (`Image generated and saved as <file>.`) and never the
agent's saved path or the image's bytes. The file under the agent's home is never opened. A call
that fails, is stopped, answers with something that is not a PNG, or has no keeper ends with its
reason, and the card says the image was not made. The agent's reply then links the image by the
local path it saved it at; that link (a markdown image or link to a local path in a
`generated_images` folder, or to a path the agent's image call reported) and any bare such path
leave the text as it streams, before DSH writes it, so neither the chat, the stored reply nor a
later replay carries it. Other links are left as the agent wrote them.

**Images in tool results.** A DSH tool that answers with an image (a Bot's `browser_screenshot`,
a read of a picture) keeps it when the bridge hands the call to the agent: the back-channel reads
the durable attachment and answers the agent's MCP call with ACP image content
(`{ type: 'image', data, mimeType }`), beside the text it already carried; an inline image block
passes through as the base64 it already is, never encoded twice, when it is `image/png`,
`image/jpeg`, `image/gif` or `image/webp` and at most 5 MiB decoded; anything else becomes a
one-line text placeholder saying why. The agent's own call that answers with an image keeps the
same picture in its mirror result, stored once in DSH's attachment store as
`{ type: 'image', attachment }`, so the chat's card, the stored result and a later replay show it;
with no attachment store mounted the call keeps its text result rather than writing inline base64
into the log. Text and resource results keep the single text block they had.

The switches are not the service's: a page writes them in the `acp-dsh` settings entry
through DSH's settings service (the welcome does, `src/host/acp.js` there).

**Sign-in attempts.** One per agent, Claude Code and Codex independently, owned by this host; a
page is only a view of one, and reading it (a second window, a reload, another Bot) never cancels
it. Only an explicit cancel, the expiry, a failure or the plugin's disposal ends it. The expiry is
the provider's when its answer reports one (at most an hour), otherwise ten minutes from the link
shown; the CLI has 45 seconds to print its link. The CLI keeps its own credentials: no model,
transcript, tool or credential store is involved, and no link, code or state is logged. A sign-in
the CLI confirms is recorded only for the executable that confirmed it and announced as
`acp-dsh/login-ready` (the Bot team applies the model the person chose); the number at work is
announced as `acp-dsh/login-active` (the welcome's busy file adds it, so the app's automatic
restarts wait). These methods are not tools and not listed by `status()`; the only caller is the
Bot team's owner-only route (its README, "Signing in to Claude Code or Codex").

### Required desktop CLIs

The desktop installs Claude Code and Codex automatically on first startup and after updates,
including in existing profiles and with either model switch off. Five seconds after every ACP
start, it resolves the official packages' stable `latest` releases and installs anything missing
or older. The same check runs after any plugin installation/update and every fifteen minutes,
even when a previous check found no update. Lifecycle checks bypass the recent-check cache;
simultaneous triggers queue one fresh check after an active download. App and desktop plugin-lane
updates restart DSH, so they also perform a fresh check. Standalone DSH keeps using its existing
tools. No login, API key or onboarding reset is part of installation, and no model preference,
setting or credential is rewritten.

The desktop's bundled pnpm installs `@anthropic-ai/claude-code` and `@openai/codex` with their
native platform packages under `$AUTOMAGIK_HOME/acp/clis`. Dependency scripts are disabled,
registry tarball integrity is checked and the binary must pass `--version` before its staging
folder is published. Linux glibc/musl, macOS and Windows x64/ARM64 layouts are supported; an
Apple Silicon Mac running the desktop through Rosetta uses ARM64 binaries.

A current or newer user CLI is reused. An older global installation stays untouched while
Automagik installs its own newer copy. An existing CLI whose version cannot be determined stays
untouched while Automagik selects a verified managed release instead of claiming it is current.
Completed managed versions never downgrade and remain available to sessions already using them.
Managed Claude's own updater is disabled; Automagik owns this copy's updates. Settings,
credentials and global command links remain untouched. Local versions are compared before the
registry request, so an offline restart keeps the newest verified local copy.

A failed download preserves the working version, records a redacted diagnostic in CLI status
and retries at the next check or through the existing `retry(id)` service. Stopping ACP cancels
its downloads and removes incomplete staging folders. Official distribution references:
[Claude Code setup](https://code.claude.com/docs/en/setup),
[Codex CLI](https://developers.openai.com/codex/cli).

The adapters are not pinned (RFC 0003, amended): an adapter that lags its CLI breaks first.
They install in the background at DSH's start and once a day after,
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
