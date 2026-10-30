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

Today there are three ways to reach a model: DSH's own providers, plans through pi-ai, and
Claude through the Claude Code plugin (dsh-oh-my-claude). Each was added on its own, and the
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
| `claude-code-plugin` | The Claude Code plugin (dsh-oh-my-claude) | `claude-code`, `claude-code-<box>` |
| `acp` | An agent over ACP, through our plugin | `acp-<agent>` |

`harness` ids: `dsh`, `claude-code`, `codex`, `gemini`, and later `herdr` (RFC 0006).

- No ACP provider id may start with `claude-code`. The Bot team treats those ids as the Claude
  Code plugin. ACP ids are `acp-claude`, `acp-codex`, `acp-gemini`.
- The descriptor is computed, never stored in place of a Session's model reference.
- The picker (RFC 0004) shows Harness and Connected by as rows under the model.

### The ACP plugin

- **Agents as DSH models.** Each configured agent is a provider route. A Bot or a chat picks it
  like any model. DSH keeps the Session, history and sidebar.
- **DSH tool cards and approvals.** The agent's tool calls render as DSH tool cards. Every tool
  call goes through DSH's approval dialog under the Session's level.
- **The team's tools over MCP.** A Bot's team tools reach the agent through an MCP server the
  plugin hands to the agent per session. It exposes only the tools the Bot's level allows.
- **Pinned adapters.** Each adapter is a pre-installed binary at an exact version with a SHA-256
  check. Nothing is downloaded at spawn: no `npx`, no global install, no self-update.
- **Resume.** Use the agent's own session load when it offers one; otherwise start fresh and say so.

### Decided

- The first ACP delivery carries Claude Code and Codex together (owner, 2026-10-30).

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
- Plugin id `@automagik/acp-dsh` in `apps/acp-dsh`, storage prefix `acp-dsh`. New. It joins the
  one-version list and the release loop.
- Adapter pins: a list of `{ agent, version, sha256 }` in the plugin. A bump is a reviewed PR.

## Threat model

- **Who can reach it.** The agent is third-party code running as the user, with its own tools.
  The MCP bridge hands it the Bot's team tools.
- **What it can do.** Whatever its tools and the Bot's level allow. Every tool call it surfaces
  goes through DSH's approval dialog under the Session's level.
- **Authentication.** The agent command comes only from host-side settings, never from a client
  route. The MCP bridge is stdio, or authenticated per session; it never listens on an open port.
- **Credentials.** Stored with mode 0600 or in the OS keychain. Never returned to the client.
- **Supply chain.** Adapters are pinned by version and SHA-256, with a source review per bump.
- **Undo.** The plugin is off by default. Turning it off removes its routes; Sessions on an ACP
  route fall back to the Bot's previous model.

## Deliveries

1. **Route descriptor.** Lane: plugin. Check: every model in the picker carries a descriptor,
   and existing Sessions resolve unchanged. Rollback: revert; nothing stored.
2. **ACP plugin skeleton.** New plugin, off by default, one fake agent for tests. Lane: plugin
   (not yet in the desktop profile). Check: a Session on the fake agent streams text, shows a
   tool card and asks through DSH's dialog. Rollback: revert.
3. **Claude Code and Codex via ACP, together.** Pinned adapters in the desktop runtime; plugin
   in the profile, off by default. Lane: desktop. Check: a new Claude Code session and a new
   Codex session from the DSH UI each run a tool call after approval. Rollback: the next release
   drops them; the Claude Code plugin route is untouched.
4. **Bots' tools over MCP.** Lane: plugin. Check: a Bot on `acp-claude` posts to its group
   through a team tool, and a tool above its level is not offered. Rollback: revert; the Bot
   is chat-only on ACP.
5. **Gemini.** Pinned adapter. Lane: desktop. Check: one session runs a tool call after
   approval. Rollback: the next release drops it.

Delivery 1 is in milestone 2 (One message box), because the picker needs it. Deliveries 2 to 5
are milestone 3 (Other agents in the same chat).

## Open questions

1. **How are adapters delivered?** Recommended: built into the desktop runtime at an exact
   version with a hash check, and installed the same way by install.sh (RFC 0008).
2. **When is a route retired?** Recommended: after two months with no Session on it in the
   team's own installs and no user report; announce it one release ahead.
3. **Separate plugin or inside the Bot team?** Recommended: a separate plugin, so it can be
   off by default and pinned on its own.

## Links

- #130 per-teammate models (runtime patch)
- [0004](0004-composer-chat-kinds.md) picker, [0006](0006-herdr-terminal-mode.md) Herdr harness
