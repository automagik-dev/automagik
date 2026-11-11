# RFC 0031: Auto, a permission level where a model decides each step

| Field | Value |
|---|---|
| Status | Queued |
| Milestone | none (ships outside the five milestones) |
| Lanes | plugin (3.N.P) |
| Created | 2026-11-11 |

## Summary

A Bot gets one more permission level, between Workspace and Full access: **Auto**. It works as
Workspace does, and at the steps where Workspace would ask the person, a model decides first: run
the step, refuse it and tell the Bot why, or ask the person. This RFC schedules it for Bots on
Codex, where Codex's own reviewer decides: Automagik asks Codex for its `agent` mode and adds no
review of its own. Only the person chooses it, for one Bot, in that Bot's own chat. Whose turns
it covers is the owner's first question. A judge for Bots on a provider's model, and Claude Code,
are open questions, not deliveries. It amends [RFC 0003](0003-model-routes-and-acp.md): the
Session's level alone no longer sets an agent's mode.

## Motivation

#1035 showed Full access as "Auto" on a CLI Bot; #1074 took that back. What was asked for on
2026-11-11 is a different level: at each step that needs a decision, leaving the file sandbox
included, a model decides whether to allow it, refuse it, or ask the person. Today a Bot has two
choices: Workspace, which asks the person for every write outside its folder, and Full access,
which never asks and has no sandbox.

DSH's own level `auto` ("Auto review", `@deepseek-ai/dsh-experimental-auto-review`, off by
default) is not this level: it has no file sandbox, and where the person can be asked a refusal
becomes a question and the model is not told the reason. On a Codex Bot it already asks Codex for
its `agent` mode (RFC 0003), but only while that experimental plugin is on, and it takes the
Session's own DSH tools out of the file sandbox. It stays as it is.

Both CLIs have the mode asked for. Codex's auto-review sends each sandbox escalation to a
reviewer and returns its reason to the agent; Claude Code's `auto` mode sends each action through
a classifier. Over ACP they are the modes `agent` and `auto`. The repository holds one capture of
Codex 0.167.0 in `agent` mode, where a write outside the workspace went through on its own
reviewer's approval with no question (`apps/acp-dsh/test/fixtures/permission-payloads/README.md`),
and none of Claude Code.

## Decided and proposed

Decided when the level was asked for (2026-11-11):

- **D1.** "Full access" names the level that allows everything. "Auto" is another level.
- **D2.** Three answers: allow, refuse, ask the person. A refusal reaches the Bot with its reason.
- **D3.** The judge is the model the Session talks to, for CLI Bots and for Bots on a provider's
  model: a Codex Bot is judged by Codex.
- **D4.** The file sandbox stays on. Leaving it is one of the decisions.
- **D5.** Judging runs in the background: it is never a turn in the chat.
- **D6.** Refusals that repeat in one turn become a question. Steps that are hard to undo always
  go to the person.
- **D7.** Only the person picks a level, and nothing becomes more permissive by itself.

Proposed here, for the owner. Two of them deliver less than what was decided, and say so:

- **P1.** Auto is stored as Workspace plus a mark on the Bot, not as a new level name.
- **P2.** The delivery is Codex only. There D2 and D6 are Codex's own: its reviewer picks what
  runs, what is refused and what is asked; it stops the turn after repeated refusals where D6
  asks for a question; and no list of ours sends a step to the person.
- **P3.** D3 is half met: a Bot on a provider's model is not offered Auto (question 4).
- **P4.** Ending Auto ends that Bot's agent session at once.

## Design

### Stored as Workspace plus a mark

A plugin cannot add a DSH preset: the table belongs to the profile, and the one programmatic
entry is DSH's own `auto`. A new level name would also have to be taught to every rule in
`apps/bots-dsh/src/host/permissions.js` that ranks, narrows, inherits or holds a level, or it
would read there as a level DSH no longer offers.

So an Auto Bot keeps `permission: 'workspace-write'` and gains `permissionAuto: 'acp-codex'`, the
route the person confirmed it on. Its Sessions stay at DSH's `workspace-write` preset. Every rule
that does not know the mark treats the Bot as Workspace, which is never wider: ranking, tasks, a
Bot made by this Bot, a group's level, an older app, another plugin.

- **Written only by the person.** One endpoint of the window, `set-bot-auto`, writes it after
  the question, together with `permission: 'workspace-write'`, in one write, from whatever level
  the question showed (none included); "Cleared first" does not count that write as a level save,
  and the question names the level it replaces. It writes nothing unless the Bot is still as the
  question showed it: the window sends the Bot's `permissionRev`, a new counter that every save of
  the Bot's level, route or deny list moves, and the endpoint compares it before it writes.
  `updateBot` refuses the key from any other caller, a new Bot never gets it (`buildBot`,
  `duplicateBot`, adoption), and the key joins `NEVER_FIELDS` of the shared registry.
- **On only once it is on disk.** The write that carries the mark is made from a copy of the
  team; the mark is put on the Bot in memory, and shown to a window, only after that write
  landed. A write that fails leaves nothing a later save could carry.
- **Cleared first, and for good.** Any save of a level, the same level included, any save that
  moves the Bot to another route, and any save that gives it a tool deny list, whoever made it,
  removes the mark as the request's first write, saved before anything else is applied; a later
  step that fails does not bring it back. Undoing the change does not bring it back either.
- **An older app cannot bring it back.** An older host ignores the mark and does not clear it
  when a level is picked there. Each save by a host that knows the mark records the file's
  revision beside it (`autoStamp`); every adoption of the file (`store.js` `adopt`) drops every
  mark when the two differ, before any migration or save. A host that finds it does not hold the
  lock drops every mark it has in memory.

### Where the mark counts

All of these, read when acp-dsh asks:

1. This host holds the team's lock, read from the lock itself, not from the store's last
   answer. A host whose lock could not be made counts no mark.
2. The Bot's saved level is exactly `workspace-write`, with a mark, and the Bot has no tool deny
   list.
3. The Session is the current part of that Bot's own chat. Not a group, a task, an earlier part,
   a subagent child, or a Session another plugin made.
4. DSH reads the Session's preset as `workspace-write` now, that name still means the file
   sandbox with approval `ask` in this profile, and the Session is not held for a level that
   could not be set.
5. The route the Session runs on now is the one in the mark.
6. acp-dsh reports that this Session's agent would take its own mode: no tool bridge (an explicit
   `dshTools: true` bridges every Codex session), the Bot team's answerer registered, and the
   mode offered.

Where the mark is saved and does not count, the window says so wherever it names the level, the
composer's chip included, with the line it already has ("Runs as Workspace here"). The host
computes that line for the view as it does `permissionFallback`, from the rules that need no open
Session; a chat that is not open is shown as it will run when it opens.

### What acp-dsh does

acp-dsh picks an agent's mode from the Session's level before each prompt
(`apps/acp-dsh/src/host/adapter.js`, the `setMode` call; `agents.js` `modeFor`) and learns
nothing about a Bot.

- **A separate question, never part of the level.** acp-dsh gains one registrar on `acpAgents`,
  `ownMode(answer)`, holding one answerer; a second registration leaves none. Before each
  prompt, and again right before sending it, it asks `{ sessionId, agent, provider }`. Only the
  exact answer `true`, in time, counts, and only when the level just read is `workspace-write`
  with `ask`, the agent session has no tool bridge, and the agent has an own mode. Then Codex is
  asked for `agent`. `levelOf`, the bridge and the mirror never read the answer: folding it into
  `levelOf().auto` would let a bridged call run with neither a dialog nor a review.
- **The strict mode is confirmed, not assumed.** When the answer is not `true`, when it changes
  between the two asks, or when Codex refuses `agent`, acp-dsh sends `workspace-write`, even when
  its last known mode is already that one, and waits for Codex to take it before the prompt
  goes out. A mode request Codex does not answer, or a
  strict mode it will not take, ends the agent session and fails the turn, as today. A session
  forked for a changed tool list is a bridged one and stays strict.
- **Ending Auto ends the agent session**, running or idle (`acpAgents.endSession`), as for a
  level that could not be set: when the mark is cleared, a level is saved, the route changes, a
  tool deny list is added, the chat moves to a new part, or the Bot is deleted. acp-dsh also ends
  it by itself when the turn whose prompt took the own mode ends, a Stop included, while Codex is
  still on that prompt, and when the Session's DSH agent is disposed. A mode cannot be taken back
  in the middle of a prompt.

### What the person sees

- One more row, "Auto", after Workspace, where a Bot's level is chosen (the select in Details,
  the card in the chat, the composer's menu), only for a Bot on Codex without a tool deny list
  whose sessions acp-dsh reports unbridged.
  Not in Settings and not in a group's settings.
- It is asked once more before it is saved. The question names Codex and says what is true
  there: Codex decides by itself, with its own reviewer, which steps it runs, refuses or asks
  about; it may change files outside the Bot's folder without asking; Automagik does not review
  those steps; and whose messages can lead to such a step (question 2).
- While a mark is saved, the pickers show Auto as the saved choice, with "Runs as Workspace
  here" when it does not count, and a pick of Workspace there always clears it. The diagnostics
  page shows the mode asked of Codex and the one it is in.

## Contracts introduced

| Contract | Rule for existing installs |
|---|---|
| Bot record: `permissionAuto` (`acp-codex`); state: `autoStamp` | Absent means no Auto. An older app reads the Bot as Workspace. |
| The window's endpoint `set-bot-auto`; Bot record: `permissionRev` | New; `update-bot` never takes the key. A Bot without the counter counts as 0. |
| `acpAgents.ownMode(answer)` and the own mode each provider reports | New. An acp-dsh without them gives the strict modes; a Bot team without them never asks. |
| Permission diagnostics: the mark and the own mode | The version of both diagnostics shapes goes up. |
| RFC 0003, "the level becomes the agent's mode" | Amended with delivery 2: the level, and for a Session whose Bot is on Auto the answer above. Auto never maps to `bypassPermissions` or `agent-full-access`. |
| `apps/bots-dsh/README.md` ("each Bot runs with its own dsh permission preset"), `apps/acp-dsh/README.md`, RFC 0003's mode table (Workspace is Codex's `workspace-write`) | Amended with delivery 2: the level list, the `acpAgents` table and the mode table name Auto. |

## Threat model

- **Who turns it on.** The person, in the window, for one Bot, after a question. No Bot's tool,
  default, inheritance, group or older app writes the mark. This RFC adds no new way to reach
  the window or to answer a card; what can already do either is outside it.
- **What the own mode does.** Codex runs its own tools on its own reviewer's word, and that
  reviewer reads the agent's thread, where every prompt reads as the person's. Automagik's
  refusals (a tool deny list, a guard) cannot stop a call the mode lets through, so a Bot with a
  deny list is not offered Auto. What the reviewer allows is Codex's rule and changes with
  Codex: the question and the README cite the capture they rest on.
- **Who can ask an Auto Bot.** Question 2 decides it. Under its answer (b), anything that
  reaches the Bot's chat can lead to a step Codex's reviewer allows; the reviewer is the one
  check, and the person is told so before saving.
- **A route change** clears the mark for good. **The bridge:** a bridged call keeps its dialog.
- **Undo.** Picking any level clears the mark and ends the agent session. Removing either
  plugin leaves Workspace. Files an agent changed while on Auto stay changed.

## Failure modes

- acp-dsh reaches a prompt before the Bot team has registered its answer, or the answer is late
  or throws: strict mode.
- A host that loses the team's lock in the middle of a prompt finishes that prompt; the next
  one is strict.
- DSH's own `/permission` command does not know the mark: it reads Workspace for an Auto Bot.
  Another level picked there turns Auto off for that Session (rule 4) only until the Bot team
  next sets the saved level on it, as when the Session opens again. Auto is turned off in the
  window.

## Deliveries

1. **This RFC.** Docs only. Acceptance: its file and its row in the index. Rollback: remove both.
2. **Auto on Codex.** The mark and its endpoint, `autoStamp`, the clearing rules, `ownMode`, the
   confirmed strict mode, the end of the agent session, the row in the three pickers with its
   question, the in-force line, the diagnostics lines, the amended documents, and the rule of
   question 2 as answered. Lane: plugin. Acceptance: Auto turned on from the card for a Codex
   Bot with no saved level, and from Read only, is on; a Codex Bot at Auto sends its prompt in
   `agent`, and at Workspace in `workspace-write`; the strict mode is set and confirmed before
   the prompt for a bridged session, a group or task Session, an earlier part, a late or missing
   answer, an answer that changes between the two asks, and a mode Codex refuses; each change
   under "Ending Auto" ends the agent session; `update-bot` with the key, from the window or
   from a Bot, writes nothing; an enable that arrives after a later level save writes nothing;
   a mark whose save did not land, or that an older app's save passed over, is not on.
   Rollback: an older plugin reads the Bot as Workspace; what an agent did while on Auto is not
   undone.

Not scheduled: a provider's model (question 4), Claude Code (question 5), bridged CLI Bots,
groups, tasks, the team default.

## Open questions

1. **Workspace plus a mark, or a level of its own?** Recommended: the mark. Nothing that already
   reasons about levels can read it as wider than Workspace.
2. **Whose turns Auto covers.** A Bot's chat also takes other Bots' messages, schedules, task
   reports, card answers and prompts from Pocket, and acp-dsh sends each of them to Codex as a
   prompt.
   (a) *Only what the person typed.* Auto is in force in a part of the chat where, from its
   first message on, every message a turn claimed is one typed in the chat's composer (read
   from DSH's `agent/inbox/claimed`: `source.kind` `user` with an `rpcId` that neither Pocket
   nor the Bot team minted, and no `principal` other than the owner's). One message of another
   sender and that part is plain Workspace for good, since Codex's reviewer reads the whole
   thread. It would also need a prefix on the
   request id of the team's own send call (a canvas button, the new-chat box and voice use it),
   a part's handoff package counted as another sender, and the question naming the messages
   each prompt is made of. Safe, and rarely in force in a team whose Bots talk to each other: an
   orchestrated Bot's chat is mixed after its first relay.
   (b) *Every turn of the Bot's own chat.* What every level does today: a Bot acts at its own
   level on whatever it is asked. Then any message that reaches the chat can lead to a step
   Codex's reviewer allows, and to that reviewer a relay reads as the person's words.
   Recommended: (b), said in plain words in the question before saving. It is what the level
   was asked to be, it sits between Workspace (the person is the check) and Full access (no
   check), and it needs none of (a)'s machinery. Choose (a) if another Bot's message must never
   lead to a step outside the folder without the person.
3. **Ending Auto ends the agent session.** Recommended: yes.
4. **A Bot on a provider's model.** Three ways, none scheduled. (a) A judge of the Bot team's
   own: a side request to the Session's own model at `tools/pre-execute`, for file writes only.
   Review found it must also resolve every path through links, send every delete, move and
   protected place to the person, bind each grant to one execution, name the exact model in the
   mark, count refusals per turn, and keep shell commands out, since files the Bot writes
   unasked decide what a command does. (b) DSH's Auto review as it is, with no sandbox. (c) Wait
   for a reviewer in DSH that keeps the sandbox. Recommended: decide after delivery 2; until
   then Auto is not offered there.
5. **Claude Code.** It is bridged by default, so its own tools are off and every call keeps its
   dialog: Auto would run there exactly as Workspace. Recommended: not offered until its `auto`
   mode is captured from a signed-in CLI and the bridge's part is designed.
6. **Two names, "Auto" and DSH's "Auto review",** in one list when that plugin is on.
   Recommended: keep both; they are different levels and the second is marked Experimental.

## Links

- #1035 (the label this replaces), #1074 (Full access named again), #972 and #1077 (the level
  choice).
- [RFC 0003](0003-model-routes-and-acp.md) (levels and agent modes).
- Research: [the Auto bridge review](../research/acp-dsh-auto-bridge-review.md),
  [the ACP tools spike](../research/acp-dsh-tools-spike.md).
- Claude Code's permission modes: <https://code.claude.com/docs/en/permission-modes>. Codex's
  auto-review: <https://learn.chatgpt.com/codex/sandboxing/auto-review>.
