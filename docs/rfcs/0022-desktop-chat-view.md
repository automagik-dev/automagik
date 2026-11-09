# RFC 0022: The desktop chat is a view of the main bot

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | none (ships outside the five milestones) |
| Lanes | none here (docs); plugin (3.N.P) for bots-dsh; desktop (3.N) for the shell; herdr (3.N.P) for the chat engine |
| Created | 2026-11-09 |

## Summary

The owner talks to Automagik Chat, the main bot, in a terminal: a Claude Code seat in an hc
terminal on the Linux box. Chat runs the team and drives the squads under it. This RFC makes
the desktop app's main chat a second view of that same session, the way Pocket already shows
one agent as a terminal or as a rendered chat. It adds no new bot and no second session, and it
does not change the orchestration. It decides: how the desktop renders an hc agent terminal as
a chat by reusing RFC 0015's engine and Pocket's chat view; how input and approvals from the
view reach the same terminal; the toggle between the terminal and the rendered view; which
bots can be shown and how the desktop lists them; what the Bot team's own DSH Bots keep; whom
the view answers and how it reaches the Linux box; which desktop P0s block which phase; and the
rollout.

## Motivation

Owner decision (2026-11-09, verbatim), correcting a first reading that a separate DSH Genie bot
would replace Chat and reach it through hc: "i didn say that, youre the chat, you will live
inside dsh, or here.. see on the mobile app how we have the option to see the terminal, or
render in the ui? its the same."

So Chat is one agent with one session. Today:

- **The phone has this already.** Pocket's Chat tab (#574, RFC 0015 delivery 5) shows an agent
  terminal as rows, approvals, held drafts and receipts, and toggles back to the terminal in
  the same place (`TerminalScreen.kt`: "the same agent as a chat, over the terminal's place;
  Show terminal comes back"). Answers to Claude Code questions followed (#655). Its engine is
  `herdr/mods/pocket-link/chat/` (RFC 0015 deliveries 1 to 4, all merged), served to the phone
  by Pocket Link's `herdr-pocket/chat/1` route.
- **The desktop does not.** The desktop app's chat shows only the Bot team's DSH Bots (DSH
  Sessions, mostly on the `acp-claude` route). RFC 0014's "Herdr Bots in Automagik" and its
  delivery 9 ("One conversation") planned the window's half of the projection, and RFC 0015
  named its home, `apps/bots-dsh/src/host/live-chat/`, a byte-equal copy of the engine. Neither
  exists yet: bots-dsh does not call hc, and no folder `live-chat/` is in the tree.
- **The main bot is on another computer.** Since 2026-11-08 every Automagik bot runs on the
  Linux box, and the desktop app runs on the owner's computer. So the first bot this view must
  show is a remote one. RFC 0014 ("Other machines") and RFC 0015 (deliveries 3 and 7) already
  read a linked machine's transcript with `hc file read --on`, and type with `terminal.send` on
  `<machine>/tN`.
- **Four desktop P0s are open** (#842 to #846, listed in (g)). Some sit on this view's path.

## Decided

Carried, not new:

- From RFC 0014: D29 (one live agent, every window); D30 (two backends: Herdr code Bots are
  projected terminals, Automagik work Bots are structured DSH Sessions); Q19 (a half-typed
  terminal draft is never wiped); Q12 (remote Bots in the list); Q17 and `shown[]` (a project's
  Bots appear only after the person's yes, kept in the home file); the universal Bot amendment
  (2026-11-07) for Bots whose runtime is a DSH Session.
- From RFC 0015: D31 and D32 (the engine is JavaScript beside Pocket Link; the window imports
  the same module); Q1 (source in `herdr/mods/pocket-link/chat/`, a byte-equal copy in
  `apps/bots-dsh/src/host/live-chat/`, checked by both gates, herdr first); Q2 to Q5; its
  Input rules, folder rule, rendering rules and threat model; its amendment's race rule for
  DSH chats (the first answer wins, the other side closes with a receipt).
- From the owner, 2026-11-09 (above): the desktop chat is a view of Chat's own session. The
  orchestration (Chat and the squads under it) is unchanged.

Rejected, recorded so it is not proposed again:

- **A separate DSH Genie bot as the owner's interface, delegating to Chat through hc.** It was
  the first brief for this RFC. The owner's correction rules it out. It would also put a second
  agent, with its own context and its own reading of the owner's words, between the owner and
  the bot that runs the team.

Proposed here: everything else.

## Design

### Words

- **The main bot**: the bot the desktop app opens as its main chat. For the owner it is Chat.
- **A seat**: a bot's long-lived agent in an hc terminal (RFC 0021's word), on this computer or
  on a linked machine (`<machine>/tN`). Workers are not seats.
- **The view**: the desktop's panel on one seat. It has two faces, **rendered** (chat rows) and
  **terminal** (the screen), and toggles between them.
- **The engine**: RFC 0015's `createEngine` (`chat/engine.js`): one projection per watched
  terminal, the input, approval and question rules, and herdr-core reached with no caller.
- **A DSH Bot**: a Bot the Bot team plugin runs as a DSH Session (`state.json`), the
  universal Bots included.

### (a) Rendering a seat as a chat: reuse, do not rebuild

Nothing new reads a transcript. The desktop runs the same engine the phone's bridge runs.

**Shared, as it is today (one source, `herdr/mods/pocket-link/chat/`):** transcript finding
(`find.js`) and the folder rule (`folder-rule.js`, its cases in
`herdr/test/fixtures/transcript-folder-rule.json`); tailing here and through `hc file read --on`
(`tail.js`); the Claude, Codex and omp decoders; herdr-core status (`status.js`); the screen
reader (`screen.js`, `dialog.js`); the row model (`rows.js`, `projection.js`); the cleaner and
the draft hold (`input.js`, `paste.js`); approvals and questions (`approve.js`, `question.js`,
`answer.js`). None of it moves. It is already plain JavaScript with no dependencies, which the
bots-dsh host runs as it is.

**What this RFC adds:**

1. **The copy.** `apps/bots-dsh/src/host/live-chat/`, byte-equal to the engine's source files
   (not its tests, fixtures or `package.json`), with `LICENSE-upstream` and `UPSTREAM.md`
   (Orca's MIT notice travels with the code it covers). A check in both gates fails when a file
   differs, the pattern RFC 0014's Q15 set for `registry.js` and `am-copies.mjs` keeps for am. A
   change ships herdr first, then the plugin (RFC 0015, Q1).
2. **The host side** (bots-dsh, plugin lane). One engine per host process, with `hcPath` set to
   the computer's own `hc` and `chatEnv` as it is (no `HC_TERMINAL_ID`, so the engine is never a
   caller). It is served to the plugin's own window through the plugin's existing routes, as the
   window's other chats are. No new plugin id, route prefix or storage prefix.
3. **The renderer** (bots-dsh client, committed `client.js`). It draws the engine's rows with
   RFC 0015's rendering rules: text or sanitized markdown, no raw HTML, no remote load by
   itself, links that show their target, control characters and ANSI removed, tool output
   collapsed and monospace. It reuses the client's existing chat parts where a row maps onto
   them (text, tool call, approval card), and gives the rest (screen rows, held messages,
   receipts, provenance in (f)) their own small parts.

**What stays per platform:**

| | Phone (Pocket) | Desktop (bots-dsh) |
|---|---|---|
| Where the engine runs | Pocket Link's bridge, on the paired computer | the bots-dsh host, in the desktop app |
| Transport to the client | `herdr-pocket/chat/1` over the paired link | the plugin's own window route, same process |
| Renderer | Kotlin (`ChatScreen.kt`) | the bots-dsh client (JavaScript) |
| Terminal face | the app's terminal view (`TerminalScreen.kt`) | (c) |
| Notifications | Android | the desktop app's own |

**One contract for both renderers.** The two renderers share no code (Kotlin and JavaScript), so
they share test vectors instead, the way the folder rule does: a new
`herdr/test/fixtures/chat-render-cases.json` lists rows and what each renderer must show (an
`<img src=…>` and a `<script>` as text, a link with its target, ANSI removed, a tagged row's
provenance from (f)). bots-dsh's client test reads it, and Pocket's `ChatRenderTest.kt` reads a
byte-equal copy in its test resources, which a script checks the way `am-copies.mjs` does.

### (b) Input and approvals: the same keys, the first answer wins

Everything the person does in the view is RFC 0015's "Input", unchanged:

- **Text** goes through the cleaner, then the draft check: a half-typed terminal draft holds the
  message with Send now (Q2), never cleared. Then `terminal.send`, with no caller. Claude takes a
  message mid-turn as a queued prompt; other agents wait for `idle`.
- **Approvals** get buttons only under RFC 0015's three guards (herdr-core `blocked` with kind
  `permission`; the dialog read only around the cursor; exactly one open call in the transcript
  with the dialog's tool, or the `PermissionRequest` hook's payload where it runs). The row shows
  the call's input from the transcript or the hook, never the screen's summary. The keys are the
  agent's own (allow `1`, deny `esc` for Claude and Codex). An agent or dialog the screen reader
  does not recognize gets "Answer in the terminal" and no buttons.
- **Questions** are paced key steps with a screen check before each (`question.js`).
- **Interrupt** is one `terminal.interrupt`, which never escalates.

**The first answer wins.** For a terminal agent the answer is the keys, so the terminal itself
settles the race: the dialog closes on the first answer, from wherever it came. Just before
pressing, the engine checks the three guards again; if the dialog is gone or changed, it presses
nothing and the row closes with a receipt. The receipt never guesses: "Answered in the terminal"
when the view did not press, read by elimination as the phone does; "Answered here: Allow,
14:02" when it did. The terminal shows the answer because the answer was real keys in it.

**The residual window.** The view and the phone run two engines in two processes. Between one
engine's last check and its key press, the other's press can land. A late allow (`1`) then lands
in the input row as a draft, which is never sent by itself; a late deny (`esc`) on a Claude or
Codex agent that has resumed work interrupts its turn. The phone has the same window today. The
proper close is upstream: a herdr-core key call that applies only while the terminal is still
`blocked` on the same turn. Until then (Open question 6), the view sends deny only while
herdr-core still reports that exact dialog, and says so in the row's receipt when its press found
the dialog gone.

**Allow-always** is not offered in the view for a remote seat (Open question 3). It grants every
later matching call; the owner gives that in the terminal face, where the whole dialog is in
front of them.

### (c) The toggle: one session, two faces

The view has a two-way toggle in its own header: **Chat** and **Terminal**, in that order, as
Pocket has it.

- **Chat** shows the rendered rows: turns, collapsed tool calls, approval and question cards,
  held messages, status ("working", "needs you", "idle"), receipts, and screen rows marked "Live
  from the screen" when the transcript has nothing yet.
- **Terminal** shows the agent's screen and takes keys, for everything the rendered face cannot
  do: TUI menus, `/` pickers, plan toggles, an image paste, a dialog the screen reader does not
  know. Phase 2 opens it through Code (RFC 0013: herdr-app, focused on the pane); phase 4 draws it
  in place over `terminal.attach`, as Pocket's terminal view does (Open question 2).

**Switching never forks the session.** Both faces watch the same hc terminal. A switch starts no
agent, resumes no session, creates no DSH Session and sends nothing. The rendered face's
unsent composer text stays the view's draft; text typed in the terminal face is a terminal draft,
which the hold rule in (b) protects. Each face keeps its own scroll place.

### (d) Which bots, and how the desktop lists them

**Any seat with a live hc terminal can be shown.** How much the rendered face shows depends on
the agent:

| Agent | Rendered face | Approvals |
|---|---|---|
| Claude Code | transcript rows (the Claude decoder) | buttons under (b)'s guards; the hook where it runs |
| Codex, omp | transcript rows (their decoders) | buttons under the guards; omp questions "Answer in the terminal" |
| dsh-tui | screen rows only | "Answer in the terminal" |
| agy, others | screen rows only | "Answer in the terminal" |

No record ties a dsh-tui seat to its DSH session, and DSH's live session index is a private
file whose format may change (RFC 0021, Decided 5). A dsh-tui decoder is a later change to RFC
0015's engine, not this RFC's.

**The list is RFC 0014's registry.** The desktop lists a seat only when the registry lists its
bot and the person said yes: global Bots from the home file, and a project's Bots from its repo
file under the `shown[]` yes for that machine and project. This is RFC 0014's delivery 3, which
this RFC needs for its listing. `shown.js` already reads `shown[]` for Pocket. Workers,
helpers and plain terminals no bot names are not listed (D29); they stay in Herdr and on the
phone.

**The main bot** is the one the home file names in a new field, `front`: `{ machine, project,
bot }` (Contracts introduced). The desktop opens it as its main chat, at the top of the list, and
`front` is set only from the desktop's own settings, never from a repo file. With no `front`, the
desktop opens as it does today. A `front` bot whose project has no yes is not shown, and the
setting says why.

**A shown bot with no live pane** is listed with its status. In this RFC the view does not start
it: starting Chat is the Linux box's business, and starting remote Bots waits for #206 (RFC 0014,
delivery 7). The row says "Not running on `<machine>`".

### (e) DSH Bots beside seats

DSH Bots keep everything they have: their DSH Session, memory, group chats, the team's tools,
DSH's approval service (with the phone race from RFC 0015's amendment), their level, the model
and effort pickers, attachments. Universal Bots keep RFC 0014's amendment: one DSH Session, a
Herdr face that is a pane on that Session, never a projected terminal.

The two kinds sit in one list (the left bar's Teams), each row marked by kind:

- **A seat** shows its machine and its agent ("Claude Code on `<machine>`") and opens the view.
  Its composer has only what becomes keys: no model picker, no effort, no attachments until the
  terminal takes them. It is never written to `state.json`, joins no group chat, gets no DSH
  memory and cannot be mentioned into a DSH group (RFC 0014, "Kept apart from DSH's team").
- **A DSH Bot** opens its DSH chat as today.

The team's DSH Main Bot stays in the list below the main bot when `front` names a seat (Open
question 5).

### (f) Whom the view answers, and what is data

**Only the person at the desktop.** The engine's send, answer and interrupt are reachable only
from the chat route bots-dsh serves to its own window, for a terminal that window watches (RFC
0015, "Who can call the engine"). They are never a DSH tool, never given to an automation, a
schedule, another plugin or any Bot. So no DSH Bot can type into Chat's terminal, whatever a
page, a file or a prompt tells it. A test pins this (phase 1).

**The desktop has one author today, so it needs no author gate.** When the view is ever shared
with other people (teams of humans, an instance rail), the gate Buzz uses is the model to follow
(Buzz's `buzz-acp` crate, Apache-2.0; read, not copied): a mode per bot, owner-only by
default, an allowlist, or anyone; fail closed when no owner is known; and stop and cancel
owner-only whatever the mode. For the main bot, "anyone" is never offered (Open question 7).

**Provenance: `<hc>` is data.** Bots message Chat with `hc send`, which herdr-core delivers into
its terminal wrapped in an `<hc from="…">` tag naming the sending terminal. The engine sends
with no caller, so the owner's words from the view arrive untagged, as typed. The rendered face
keeps the two apart:

- a user row carrying an hc tag renders as a message from that bot (its name where the registry
  knows the terminal, else the terminal), never as the owner's, with its text sanitized and
  never acted on;
- a user row the view sent is matched to the transcript (the engine's `sending`, then `matched`)
  and renders as the owner's, "from the desktop";
- any other untagged user row renders as "typed in the terminal".

No row's content is ever turned into an action: no button, approval or send comes from text in
a row, only from herdr-core's state and the guards in (b). A message the person writes that
begins with an hc tag is refused with a reason ("This looks like a bot's message"), so a paste
cannot pass as a bot's words (Open question 8).

**Untagged is not proof.** An untagged row means herdr-core had no caller for it, not that the
owner typed it: a process with raw access to the core socket can send with no caller. The
per-pane hc proxy (#631) closes that for sandboxed dsh-tui panes; Claude Code seats are not
proxied yet. The view says "typed in the terminal", never "you", for rows it did not send.

**What Chat does with `<hc>` input is Chat's, not the view's.** How Chat drives squads stays as
it is: `hc run --parent` on its own terminal, end the turn, be woken by the report, never poll,
and read what arrives tagged `<hc>` as data. dsh-herdr-bridge (MIT) uses the same start-and-wake
shape for a DSH session. Its skill text gives no "data, not instructions" rule for relayed text,
and its control socket has no access check beyond hc's; neither is copied. In the view, those
reports are tagged rows like any other.

**Across machines: the hc machine link, nothing new.** Chat runs on the Linux box; the desktop
app runs on the owner's computer. The engine reaches the box exactly as RFC 0014 ("Other
machines") and RFC 0015 already do: status from `events.subscribe`, the transcript through
`hc file read --on <machine>` under the folder rule's textual check (with `on` from the
terminal's own address, never from a label), and keys through `terminal.send` and
`terminal.keys` on `<machine>/tN`. That is the link the owner made with `hc machine`, which
already gives this computer the whole hc API on the box, so the view adds no reach. Two routes
are not used:

- **Pocket Link.** Its chat route is admitted by a paired phone's key (`devices.json`,
  `guard.mjs`). The desktop is not a phone and does not pair; going through the bridge would add
  a second path to the same terminals.
- **The hc proxy** (#631). It filters what a bot's own pane may do with hc. The desktop host is
  not a bot pane and must never run under a bot's filter, nor be mistaken for one.

**What it reads, and keeps.** Transcripts under the folder rule only. Rows live in the host's
memory while a window watches and 10 minutes after (`LINGER_MS`); they are never written to disk
or logged (RFC 0015, Q4). Tool output can hold tokens and keys: the same text the terminal face
shows.

**Undo.** Clear `front`; close the view; revert the plugin release (the view goes, DSH Bots stay);
or remove the machine link. Nothing is stored that needs cleaning.

### (g) The desktop P0s

| Issue | What it is | What it blocks |
|---|---|---|
| #842 | A Claude-ACP session can be saved in a shape DSH refuses to load | Phase 3, where DSH Bots on `acp-claude` sit beside seats every day. Not phases 1 and 2: a seat has no DSH Session. It also blocks any move of Chat to a universal Bot (Open question 4). |
| #843 | Cmd+W quits the app, mid-run and unasked | Phase 2. The view adds closable panels; Cmd+W must close the panel. Quitting does not stop Chat (it runs on the box), but it drops held messages and the watch. |
| #844 | `bot-session-adopt` refuses with no named reason | None of this RFC's phases: a seat never adopts a DSH Session. Fixed in phase 3's window, since phase 3 lists both kinds side by side. |
| #845 | On macOS, top-bar controls cannot be clicked under the drag region | Phase 2 on macOS, the owner's daily window. The view's toggle sits in its own header, not the top bar, but the settings that set `front` and the bar's controls must be reachable. |
| #846 | `browser_screenshot` reaches the model as text only through the ACP bridge | No phase of the view: Chat is the Claude Code CLI and handles images itself. It blocks phase 3's claim that DSH Bots keep their full tool set. |

## Contracts introduced

- **`apps/bots-dsh/src/host/live-chat/`**: the byte-equal copy RFC 0015 named, created here, with
  `LICENSE-upstream` and `UPSTREAM.md`. Both gates check it. A change ships herdr first.
- **`front`** in the home file (`~/.automagik/bots/bots.json`, version 2): `{ machine, project,
  bot }`, or absent. Set only from the desktop's settings; a repo file's `front` is ignored. RFC
  0014's readers keep unknown fields (Q15), so Herdr and older plugins pass it through unchanged
  and an older plugin opens as it does today.
- **`herdr/test/fixtures/chat-render-cases.json`**, version 1, and its byte-equal copy in
  Pocket's test resources: the cases both renderers pass. A new case is additive; a changed
  expectation is a change to this RFC.
- No new plugin id, route prefix, storage prefix, ALPN, socket or port. `herdr-pocket/chat/1` is
  unchanged.

## Threat model

The view adds one caller of the engine (the bots-dsh window) and one reader of a remote seat's
transcript on the owner's computer. (f) gives the detail; in short:

- **Who can reach it.** Only the person in the desktop app's own window. No DSH tool,
  automation, schedule, plugin or Bot reaches send, answer or interrupt.
- **What it can send.** RFC 0015's set: cleaned text under the draft hold, mapped approval and
  answer keys under the guards, one interrupt. Never allow-always for a remote seat. Never a
  message that begins with an hc tag.
- **What it can read.** Transcripts under the folder rule, through the machine link the owner
  made; nothing that link did not already give this computer.
- **Provenance.** Tagged rows are a bot's and are data; rows the view sent are the owner's; other
  untagged rows are "typed in the terminal", never claimed as the owner's.
- **The window's other code.** The desktop host runs plugins, tools and automations. They never
  get the engine; a test fails if the engine is reachable as a tool.
- **Undo.** In (f).

## Deliveries

Each phase is one PR per lane. A PR never mixes the plugin and desktop lanes.

0. **The prerequisites** (no release). Chat's terminal on the box carries `agent.session` and
   `agent.transcript` (the briefing hook, RFC 0015 delivery 2), and the owner's computer reaches
   the box with `hc machine`. *Check:* `hc get` on Chat's terminal, from the owner's computer,
   shows both labels and the transcript path passes the folder rule's remote check. *Rollback:*
   nothing to undo.
1. **The read-only view of the main bot** (plugin; needs RFC 0014 delivery 3 for the listing,
   or the `front` bot alone ahead of it). The `live-chat/` copy and its gate check; the host
   engine; the renderer; `front` read from the home file and set in settings; the rendered face
   only, with Show terminal opening Code. No send yet. *Check:* the plugin gate; the copy check
   fails on a one-byte change; with a fake hc and temp homes (never a live Herdr), a remote
   seat's transcript rows render, an `<img>` and a `<script>` render as text, a tagged row
   renders as the bot's; the engine is not callable as a DSH tool or by an automation.
   *Rollback:* revert in a later plugin release; `front` stays in the home file and is ignored.
2. **Writes and the toggle** (plugin; the desktop lane for #843 and #845, which must merge
   first). Send with the hold, approvals and questions under the guards, interrupt, receipts, the
   Chat and Terminal toggle (Terminal through Code), the hc-tag refusal. *Check:* with a fake hc:
   a held draft is never cleared; an approval answered in the terminal first presses nothing in
   the view and shows "Answered in the terminal"; a stale dialog presses nothing; a deny press
   that finds the dialog gone sends nothing; a message beginning with an hc tag is refused. On
   the owner's computer: a message from the view is answered in Chat's terminal, and both faces
   show the same turn. *Rollback:* a plugin release that drops the writes; phase 1 stays.
3. **Every shown seat, beside DSH Bots** (plugin; after RFC 0014 delivery 3 and 8; #842 and
   #846 fixed, #844 in the same window). The kind marks, the seat composer, seats on every
   linked machine, offline rows. This is RFC 0014's delivery 9 for every exposed Bot. *Check:*
   RFC 0014 delivery 9's check; a seat is never written to `state.json` and cannot be mentioned
   into a group; a DSH Bot's chat is unchanged. *Rollback:* a plugin release that lists only the
   `front` bot again.
4. **The terminal face in place** (plugin, and the desktop lane if the shell needs a change).
   A terminal drawn in the view over `terminal.attach`, as Pocket's. *Check:* switching faces
   sends nothing and starts nothing (a fake hc records no `terminal.send`, no `run`); keys typed
   in the terminal face reach the terminal. *Rollback:* a release that opens Code again.

The render cases fixture lands with phase 1 (herdr side) and Pocket reads its copy in its next
pocket patch.

## Open questions

Each has a recommended answer for the owner.

1. **Where the main bot is chosen.** *Recommended:* the home file's `front`, set from the
   desktop's settings, never from a repo file. The owner sets it to Chat once.
2. **The terminal face: in place, or Code?** *Recommended:* in place, as on the phone (phase 4),
   with Code until then. Code switches the whole window to herdr-app, which is the wrong size for
   a glance at the screen.
3. **Allow-always from the view for a remote seat.** *Recommended:* no. Allow and deny only;
   allow-always in the terminal face, as the phone keeps allow-for-session on the computer.
4. **Does Chat become a universal Bot** (a DSH Session served by the desktop host)?
   *Recommended:* no. Chat stays a Claude Code seat on the Linux box, so the team runs where it
   runs today and the desktop app's quitting never stops it. Revisit only after #842.
5. **The team's DSH Main Bot when `front` names a seat.** *Recommended:* keep it listed, below
   the main bot. Nothing of it changes.
6. **The residual answer race between two engines.** *Recommended:* file the conditional key
   call upstream with herdr-core (keys that apply only while the terminal is still blocked on
   the same turn) and accept today's narrow window meanwhile, as the phone does.
7. **Other people in the view** (teams of humans, an instance rail). *Recommended:* not in this
   RFC. When it comes, its own RFC with Buzz's gate: owner-only by default, an allowlist, never
   "anyone" for the main bot, stop and cancel owner-only.
8. **A message that begins with an hc tag.** *Recommended:* refuse it with a reason, so nothing
   typed in the view reads as a bot's words to Chat.

## Links

- RFCs: [0014](0014-shared-bot-registry.md) ("Herdr Bots in Automagik", "Other machines",
  deliveries 3, 7, 8 and 9, the universal Bot amendment);
  [0015](0015-live-chat-projection.md) (the engine, Input, the folder rule, the threat model,
  the amendment's race rule); [0013](0013-work-code-switch.md) (Code on a pane);
  [0021](0021-meter-attribution.md) (seats, and Decided 5 on dsh-tui sessions);
  [0011](0011-monorepo-parts-and-releases.md) (the lanes).
- Code: `herdr/mods/pocket-link/chat/` (`engine.js`, `find.js`, `folder-rule.js`, `input.js`,
  `approve.js`, `question.js`); `herdr/test/fixtures/transcript-folder-rule.json`;
  `herdr/mods/pocket-link/bridge/` (`chat.mjs`, `guard.mjs`, `dsh-source.mjs`);
  `apps/bots-dsh/src/host/` (`shown.js`, `pocket-chat.js`, `pocket-socket.js`);
  `apps/bots-dsh/src/shared/registry.js`;
  `apps/pocket/android/app/src/main/java/ai/namastex/automagik/` (`ChatScreen.kt`, `ChatClient.kt`, `TerminalScreen.kt`); `herdr/mods/am-sidebar/hcProxy.md`.
- Issues and pull requests: #574 and #655 (Pocket's chat view); #206 (remote Bots); #631 (the
  per-pane hc proxy); #842, #843, #844, #845, #846 (the desktop P0s).
- Outside projects, read as research and not copied: dsh-herdr-bridge (MIT), a DSH plugin that
  mirrors DSH sessions into hc terminals; Buzz (Apache-2.0), its `buzz-acp` author gate; two
  plugins both named dsh-herdr (one MIT, embedding a terminal in DSH; one Apache-2.0,
  `dsh-plugin-herdr`, reporting DSH session status to herdr-core).
