# RFC 0023: DSH upstream: agent context, a chat tail slot and a draft hook

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | none (a proposal to DSH; nothing ships here) |
| Lanes | none for this RFC (docs only); plugin (3.N.P) for each removal once DSH ships the piece |
| Created | 2026-11-09 |

## Summary

Three small extension points we would ask DeepSeek Harness (DSH) to add, so the Automagik plugins
can drop three workarounds they carry today on DSH 0.2.2-rc.1:

1. **A provider-managed context flag** on a model, so DSH's compaction guard skips a model that
   keeps its own context (an agent over ACP) instead of failing the switch.
2. **A `conversation.chat.tail` slot**, so a plugin can put a transient client row at the end of a
   conversation without leaning on DSH's rendered attributes.
3. **A hook before a composer draft is persisted**, so a plugin can keep a value it recognises (a
   pasted sign-in code) out of the saved draft.

Each workaround is in RFC 0003's 2026-11-09 amendment. This RFC is the proposal only: it names
the DSH code it would touch, what we would remove when each piece lands, and the questions for
DSH's maintainers. It sets no Automagik contract.

## Motivation

All three come from putting Claude Code and Codex (acp-dsh's `acp-claude`, `acp-codex`) under the
Bot team, and from signing in to their CLIs from a Bot's chat.

**1. The compaction guard on an agent.** `compaction-basic` prepends an `agent/request` listener
that, whenever the request model differs from the previous request header's, calls
`compactPressure(agent, header, signal, true)` on the destination header and turns any error into
`MODEL_SWITCH_COMPACTION_FAILED` (`@deepseek-ai/dsh-compaction-basic` 0.2.2-rc.1, `lib/index.js`,
around lines 856-873). `compactPressure` throws "no context capacity" when the destination model's
info has no `context` (same file, around line 958). An agent over ACP declares no context window,
because it manages its own context and receives the chat as a bounded replay, so every switch onto
an agent in a Session that already had a request header failed before any threshold was read.
acp-dsh works around it by wrapping the engine's private `compactPressure` method on each engine it
reaches (`apps/acp-dsh/src/host/pressure.js`): an agent destination answers `null` (no compaction
needed), everything else goes to the method below. That depends on a private method name, on
adopting every engine instance (a reloaded compaction plugin makes a new one), and on chain-safe
unwinding; a guard test pins the method so a DSH change fails loudly.

**2. A client row at the end of the transcript.** The Bot team's sign-in row
(`apps/bots-dsh/src/client/cli-login.js`) must sit at the end of the conversation shown, keep its
own field's value and focus while a turn starts and ends, show in a blank conversation, and stay
out while another View is on top. DSH 0.2.2 declares slots inside messages and around the
composer (`conversation.chat.flow`, `conversation.chat.node`, `conversation.chat.user.before`,
`conversation.composer.dock`, `conversation.input.*` and others) but none for a client row after
the last message. The row therefore finds its seat from rendered attributes:
`[data-conversation-content][data-conversation-session]` for the occurrence shown, its outermost
`[data-chat-flow]` (never one inside `[data-chat-running]`, which is removed at the end of a turn),
`:scope > [data-text-interaction-surface]` to insert before, and `[data-composer-seat]` in a blank
conversation. One element, owned by the plugin, is moved between those parents so React's portal
never changes container. Any rename in DSH's markup breaks it silently, short of the plugin's own
browser tests.

**3. A value that must never reach a saved draft.** While Claude's code step shows, the native
editor takes no edit (capture-phase handlers on `beforeinput`, edit keys, paste, drop and IME), and
afterwards a paste, a drop or a send that carries `#<state>` of a Claude state the page showed is
refused; when the step ends, a draft that holds one is cleared with `inputActions.setDraft('')`.
DSH's `SessionInputShell` writes the draft to the conversation store on every editor commit through
a private `persistDraft` (`@deepseek-ai/dsh-client-ui-conversation` 0.2.2-rc.1,
`lib/types/client/input/facade.d.ts`), and offers no way for a plugin to look at a draft before it
is stored. So the plugin blocks input instead of filtering it, and a value that reached the editor
by a path the plugin did not foresee would be persisted.

The same gap reaches past the draft. A send from the native composer goes through the session
controller's `prompt` (`@deepseek-ai/dsh-api-session-controller` 0.2.2-rc.1, `lib/index.js`,
`agent.followup` or `steer`), and the agent loop's inbox splice appends `agent/inbox/spliced` with
the whole message (`@deepseek-ai/dsh-agent-loop`, `lib/index.js`, `send` and `inbox.splice`): a
durable event, written before any plugin hook runs. The Bot team's `agent/pre-step` guard drops a
pasted code before a model call or a transcript row, but the inserted event stays in the Session's
file. The page's own refusal knows only the states that page showed, so after a reload, or in a
window that never showed the link, a pasted code is recorded there. This is the one accepted
residual risk of the sign-in row (RFC 0003's amendment); the team's own send endpoints, its
deliveries, a group's running round and Pocket refuse such a text before anything records it.

## Design

Each proposal is the smallest addition that removes one workaround. Names are suggestions for
DSH's maintainers to change.

### 1. Provider-managed context

A model (or a provider) may say that it manages its own context:

```ts
// The model info DSH already resolves (resolveModelInfo), one optional field more.
interface ModelInfo {
  context?: number
  /** The provider keeps its own context; DSH never condenses a Session for it. */
  contextManagedByProvider?: true
}
```

- `compaction-basic`'s switch guard returns the header unchanged when the destination's info has
  `contextManagedByProvider`, before reading `context`; its pressure path and `/compact` refuse
  for such a destination with a clear code (or skip, as DSH prefers), never "no context capacity".
- A provider registers the flag with its models (acp-dsh's adapter would set it in
  `resolveModel`).
- A switch *off* such a model is unchanged: the destination's own window and threshold apply.

**What we remove.** `apps/acp-dsh/src/host/pressure.js`, its adoption in `apps/acp-dsh/index.js`
(`agent/created` and `agent/request` listeners) and its guard test. The Bot team's own threshold
measurement for a switch off an agent stays: it decides between a checkpoint and a new part, which
is the Bot team's policy, not DSH's.

### 2. `conversation.chat.tail`

A list slot, scoped to one conversation occurrence, rendered after the last message and before the
text interaction surface; in a blank conversation, in the scroller before the composer seat.

```ts
'conversation.chat.tail': {
  kind: 'list'
  scope: 'conversation'
  owner: { sessionId: string; occurrence: string; visible: boolean }
}
```

- One stable container per occurrence for the life of the conversation view: it does not move or
  remount when a turn starts or ends, so an entry keeps its DOM, value and focus.
- Rendered only for the occurrence shown; `visible` is false while another View is on top.
- Never inside the running turn's row.

**What we remove.** The seat code in `apps/bots-dsh/src/client/cli-login.js` (finding the
occurrence, the outermost flow and the insertion point, and moving the plugin's own element); the
row registers on the slot instead. The browser tests for mounting stay, against the slot.

### 3. A hook before a draft is persisted

A filter the input shell runs on the draft it is about to write to the conversation store, and on
the text it is about to submit:

```ts
// Registered through ctx, one per plugin; each returns the text to keep.
type DraftFilter = (draft: { sessionId: string; text: string; reason: 'persist' | 'submit' }) => string | { refuse: string }
```

- `persist`: the returned text is what is stored (the editor keeps showing what the person typed
  until the next edit, or is reset to the returned text, as DSH prefers).
- `submit`: `{ refuse }` stops the send with that notice, as the plugin's capture-phase guard does
  today.
- Filters run in registration order, synchronously, and must not see attachments' bytes.
- The same `submit` refusal, or a host-side admission hook the session controller runs before
  `followup`/`steer` splice a prompt into the inbox, closes the residual risk above: a refused
  prompt never reaches `agent/inbox/spliced`. A host hook would cover every window and remote
  client at once, without the page knowing the state.

**What we remove.** The persisted-draft half of the known-state guard and the clear on step end in
`apps/bots-dsh/src/client/cli-login.js`; the send refusal moves from capture-phase listeners to
`submit`. Whether the editor lock during Claude's code step (decision D18 of the plan behind RFC
0003's amendment) can be dropped too is a product question, not part of this proposal: the lock
also keeps the code off DSH's input triggers and its undo history.

## What does not change

- Agents keep receiving the chat as acp-dsh's redacted, capped replay (RFC 0003).
- The sign-in attempt stays in acp-dsh's host and its routes stay owner-only.
- Nothing here asks DSH to know about sign-ins, Bots or ACP.

## Open questions

1. Does DSH want the context flag on the model or on the provider, and should `/compact` on such a
   model refuse or be a no-op?
2. Would DSH accept a conversation-scoped list slot with a stable container, or prefer a single
   occupant per plugin?
3. Is a synchronous filter acceptable on the input shell's commit path, or should `persist` be
   debounced like the store write?
4. Would DSH rather add the host-side admission hook (before `agent/inbox/spliced`) than a
   client `submit` filter, since only the host sees every client's prompt?
5. Where does this go first: an issue on DSH's tracker, a patch in the desktop's runtime patches
   (which would make it a desktop release, RFC 0011), or both?

## Links

- [0003](0003-model-routes-and-acp.md), amendment of 2026-11-09: the workarounds this would remove.
- `apps/acp-dsh/src/host/pressure.js`, `apps/bots-dsh/src/client/cli-login.js`.
