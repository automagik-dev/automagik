# RFC 0003: Model routes and ACP

| Field | Value |
|---|---|
| Status | Accepted |
| Milestone | 2. One message box (route descriptor); 3. Other agents in the same chat (ACP) |
| Lanes | plugin (3.N.P), desktop (3.N) |
| Created | 2026-10-30 |

## Summary

A model choice has two parts: the **Harness** that runs the loop, and how it is **Connected by**.
This RFC fixes the ids for both as a public contract, and adds our own lean ACP plugin as the
official way to run agents other than DeepSeek. Every route is an equal choice. Routes nobody
picks are retired later.

## Motivation

Today there are two ways to reach a model: DSH's own providers, and plans and keys through
pi-ai, Claude among them (a Claude Pro or Max sign-in, or an Anthropic API key). A third, Claude
through the Claude Code plugin (dsh-oh-my-claude), was removed (see Retired below). Each was added on its own, and the
picker shows provider ids, not what runs the work. ACP (Agent Client Protocol) is one protocol
for many agents. Community ACP plugins were reviewed; none passes DSH's own tools to the agent,
so a Bot on one would lose its team tools.

## Design

### Route descriptor

Every model entry gets a descriptor `{ harness, connectedBy }`, derived from its provider id.

| `connectedBy` id | Meaning | Provider ids today |
|---|---|---|
| `native` | DSH's own provider, signed in with a key or DSH's own sign-in | DSH's built-in ids |
| `pi-ai` | A plan through pi-ai (dsh-subscriptions) | pi-ai route ids |
| `claude-code-plugin` | Retired: the Claude Code plugin (dsh-oh-my-claude), no longer shipped | `claude-code`, `claude-code-<box>` (none served) |
| `acp` | An agent over ACP, through our plugin | `acp-<agent>` |

`harness` ids: `dsh`, `claude-code`, `codex`, `gemini`, and later `herdr` (RFC 0006).

- No ACP provider id may start with `claude-code`. The Bot team reads those ids as the retired
  Claude Code plugin's and moves them (below). ACP ids are `acp-claude`, `acp-codex`, `acp-gemini`.
- The descriptor is computed, never stored in place of a Session's model reference.
- The picker (RFC 0004) shows Harness and Connected by as rows under the model.

### The ACP plugin

- **Agents as DSH models.** Each configured agent is a provider route. A Bot or a chat picks it
  like any model. DSH keeps the Session, history and sidebar.
- **DSH tool cards and approvals.** The agent's tool calls render as DSH tool cards. Every call
  the agent asks permission for goes through DSH's approval dialog under the Session's level
  (what the agent's own settings already allow does not ask; see the Session's level below). How: the agent runs its own
  tools, and each call it makes ends the model step with a call to `acp_tool`, a mirror tool
  registered in that agent's scope only. DSH writes the `tool/call` and `tool/result` rows and
  draws the card from the call's ACP kind (terminal, diff, generic). The mirror tool waits for
  the agent's call to finish and, when the agent asks permission, asks DSH's approval service and
  hands the agent the answer. DSH's side requests on an ACP route (a title, a summary) are refused
  at the `llm/stream` waterfall, so they never reach the agent as prompts.
- **The team's tools over MCP.** A Bot's team tools reach the agent through an MCP server the
  plugin hands to the agent per session. It exposes only the tools the Bot's level allows.
- **The person's own CLI, the newest adapter.** (Amended, owner decision D17.) An agent is offered
  only when its CLI is installed (`claude`, `codex`, found on PATH or where their installers put
  them); it runs that CLI, which the person signs in to and which updates itself. Between DSH and
  the CLI sits the agent's ACP adapter (`@agentclientprotocol/claude-agent-acp`,
  `@agentclientprotocol/codex-acp`; the `@zed-industries` names are deprecated), at its newest
  npm release: installed in the background at DSH's start and once a day after, into
  `$AUTOMAGIK_HOME/acp/adapters`, into a fresh folder renamed into place only when complete,
  without install scripts or optional dependencies (the CLIs the adapters bundle). The install
  uses the desktop app's own pnpm 10 (`AUTOMAGIK_PNPM`), never a newer pnpm the person has
  (pnpm 12 installs the bundled CLIs anyway: about 700 MB for the two), else npm; an install
  that still pulls in a bundled CLI's platform package is refused. Nothing is downloaded when a
  Session starts: no `npx`. An agent lists its model only once its adapter is installed, so
  nothing can pick it before it can answer; a Session already on it says the adapter is being
  installed, with the last install error when there is one.
- **The Session's level, as the agent's own mode.** Before each prompt the plugin sets the agent's
  ACP session mode from the Session's level (its sandbox as DSH's sandbox-policy service resolves
  it, the deployment default included): Claude Code in Manual is Claude Code's `default` mode,
  whatever default mode the person's own Claude Code settings name; Codex in its sandbox matching
  DSH's (`read-only`, `workspace-write`). DSH's Auto is Claude Code's `auto` and Codex's `agent`.
  Full access is `bypassPermissions` and `agent-full-access`, and any ask that still comes is
  allowed, as DSH allows its own tools there. An agent that does not offer the strict mode
  (`default`; `read-only` or `workspace-write`) fails the turn; one that lacks a permissive mode
  gets the strict one instead.
- **Claude Code keeps the person's own settings.** (Owner decision, 2026-11-03.) The Claude
  adapter loads the person's Claude Code settings (user, project and local), and Claude Code asks
  DSH only for what those leave as "ask". So in Manual, a call the person's allow rules or saved
  "always allow" rules permit, or a PreToolUse or PermissionRequest hook approves, runs with no
  DSH dialog; a call they deny is denied. Their CLAUDE.md, MCP servers and hooks keep working
  too.
- **Resume.** Use the agent's own session load when it offers one; otherwise start fresh and say so.

### Retired: the Claude Code plugin

The desktop profile no longer ships dsh-oh-my-claude or pins its fork (owner, 2026-11-02, D16
and D17). Claude runs on pi-ai's `anthropic` route until `acp-claude` ships.

- **Profiles.** An app update takes the plugin out of a profile an earlier build installed
  (`RETIRED` in `apps/desktop/src/dsh.js`): its folder, dependency, bundle and patch rows.
- **Bots.** Once per team (`claudeCodeMoved` in state.json), a Bot on a `claude-code*` model
  moves to the closest pi-ai Claude model (`apps/bots-dsh/src/host/claude-models.js`): an alias
  to its family's newest, a version to the nearest one pi-ai serves, `default` to Opus. The old
  ref stays on the Bot as `claudeCodeModel`. Sessions and their history stay. Moving those Bots
  on to `acp-claude` waits for delivery 4: until the team's tools reach the agent over MCP, a Bot
  on `acp-claude` would lose them (posting to its group, reading the group chat, recall).
- **Auto.** The fork's last build started a new Claude session in Claude Code's own `auto`
  mode; it shipped only in the broken 3.53.0 to 3.54.1, and the team's Claude Bots ran on full
  access, so nobody depends on it. On pi-ai, a Bot's level is DSH's preset, Auto included. The
  ACP Claude adapter should map a Session's Auto to Claude Code's `auto` permission mode, never
  to `bypassPermissions`.

### Decided

- The first ACP delivery carries Claude Code and Codex together (owner, 2026-10-30).
- Adapters are not pinned: always the newest release, running the person's own CLI (owner, D17,
  2026-11). This replaces the pinned-adapter rule and answers open question 1.
- acp-dsh is on by default in the desktop profile (owner, D17, 2026-11).
- Claude Code over ACP keeps the person's own Claude Code settings, allow rules and hooks
  included (owner, 2026-11-03).

### Per-teammate models (status note)

Agent Teams teammates can run on their own model. The runtime patch shipped in #130: it is
applied at build time, checked against an exact DSH version and file hashes, and stops the build
on a mismatch. A follow-up adds a check that no profile-local copy shadows the patched one. A
proposal to DeepSeek is drafted and waits for the owner's approval before it is posted. The
patch is removed in the release whose DSH carries the change.

## Contracts introduced

- `connectedBy` and `harness` ids above. Compatibility: derived from existing provider ids, so
  every existing Session and Bot keeps its model.
- Provider ids `acp-<agent>`. New; no collision with `claude-code*`.
- Tool name `acp_tool` and its arguments `{ id, title, kind, input, locations?, diffs? }`. New;
  Session logs keep them.
- Plugin id `@automagik/acp-dsh` in `apps/acp-dsh`, storage prefix `acp-dsh`. New. It joins the
  one-version list and the release loop.
- The adapter packages by exact name, `@agentclientprotocol/claude-agent-acp` and
  `@agentclientprotocol/codex-acp`, at their newest release (no pin list; amended, D17).
- Settings `claude` and `codex` (on unless set off) and the install folder
  `$AUTOMAGIK_HOME/acp/adapters`.

## Threat model

- **Who can reach it.** The agent is third-party code running as the user, with its own tools.
  The MCP bridge hands it the Bot's team tools.
- **What it can do.** Whatever its tools and the Bot's level allow, and what the agent's own
  settings allow: every call the agent asks permission for goes through DSH's approval dialog
  under the Session's level, but Claude Code does not ask for what the person's Claude Code
  allow rules or hooks approve (decided, above). If the agent offers no strict mode, the turn
  fails rather than run in the agent's own default.
- **Authentication.** The agent command comes only from host-side settings, never from a client
  route. The MCP bridge is stdio, or authenticated per session; it never listens on an open port.
- **Credentials.** Stored with mode 0600 or in the OS keychain. Never returned to the client.
- **Supply chain (amended, D17).** Adapters are not pinned. What that costs: a second publisher,
  the `@agentclientprotocol` npm organisation, joins a boundary that already holds Anthropic's and
  OpenAI's own CLI update channels, and its releases reach installed apps within a day with no
  review of ours. A bad or hijacked publish runs as the person, with what the agent CLI can
  already reach (their files, their sign-ins). What still holds: the exact package names, npm's
  integrity check of every tarball, no install scripts, no optional dependencies, nothing fetched
  at spawn, and an install that fails leaves the previous adapter in place. The exact names cover
  only the two adapters: their dependency tree (the agent SDKs, JSON-RPC and process helpers) is
  resolved fresh at each install, with no lockfile. Also new: the adapter
  carries its own copy of the agent's SDK (`claude-agent-acp` pins `@anthropic-ai/claude-agent-sdk`)
  and drives whatever CLI the person has, so the two can drift apart; nobody owns that pairing,
  and a mismatch shows as a failed turn, not a silent one. Turning `claude` or `codex` off in the
  plugin's settings removes that agent and its updates.
- **Undo.** The plugin is on by default in the desktop profile and offers an agent only when its
  CLI is installed. Turning it off removes its routes; Sessions on an ACP route fall back to the
  Bot's previous model.

## Deliveries

1. **Route descriptor.** Lane: plugin. Check: every model in the picker carries a descriptor,
   and existing Sessions resolve unchanged. Rollback: revert; nothing stored.
2. **ACP plugin skeleton.** New plugin, off by default, one fake agent for tests. Lane: plugin
   (not yet in the desktop profile). Check: a Session on the fake agent streams text, shows a
   tool card and asks through DSH's dialog. Rollback: revert.
3. **Claude Code and Codex via ACP, together.** The person's own CLIs through the newest
   adapters, installed in the background; plugin in the profile, on by default. Lane: desktop.
   Check: a new Claude Code session and a new Codex session from the DSH UI each run a tool call
   after approval (`apps/acp-dsh/dev/dsh-check.mjs --agent claude|codex` runs the same on a real
   DSH, headless). Rollback: the next
   release drops them; the Claude Code plugin route is untouched.
4. **Bots' tools over MCP.** Lane: plugin. Check: a Bot on `acp-claude` posts to its group
   through a team tool, and a tool above its level is not offered. With it, once per team, a Bot
   that ran on the Claude Code plugin (`claudeCodeModel`) and is still on the pi-ai model it was
   moved to goes to `acp-claude`, only where that route lists its model (adapter installed).
   Rollback: revert; the Bot is chat-only on ACP.
5. **Gemini.** The newest adapter, the person's own CLI. Lane: desktop. Check: one session runs a tool call after
   approval. Rollback: the next release drops it.

Delivery 1 is in milestone 2 (One message box), because the picker needs it. Deliveries 2 to 5
are milestone 3 (Other agents in the same chat).

## Open questions

1. **How are adapters delivered?** Decided (D17): not pinned; the newest release, installed in the
   background into Automagik's home, running the person's own CLI. install.sh (RFC 0008) needs
   nothing for it.
2. **When is a route retired?** Recommended: after two months with no Session on it in the
   team's own installs and no user report; announce it one release ahead.
3. **Separate plugin or inside the Bot team?** Decided: a separate plugin, `@automagik/acp-dsh`
   (D17), on by default in the desktop profile.

## Links

- #130 per-teammate models (runtime patch)
- [0004](0004-composer-chat-kinds.md) picker, [0006](0006-herdr-terminal-mode.md) Herdr harness
