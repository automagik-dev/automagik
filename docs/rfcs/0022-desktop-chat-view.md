# RFC 0022: The desktop chat is a view of the main bot

| Field | Value |
|---|---|
| Status | Queued (answers: Q1-Q8, 2026-11-09: Q2 by the owner, the rest by Chat, Q6 re-decided and Decided 9 (H before phase 1) after review; no question open; only the RFC: #847) |
| Milestone | none (ships outside the five milestones) |
| Lanes | none here (docs); plugin (3.N.P) for bots-dsh; desktop (3.N) for the shell; herdr (3.N.P) for the chat engine |
| Created | 2026-11-09 |

## Summary

The owner talks to Automagik Chat, the main bot, in a terminal: a Claude Code seat in an hc
terminal on the Linux box. Chat runs the team and drives the squads under it. This RFC makes
the desktop app's main chat a second view of that same session, the way Pocket already shows
one agent as a terminal or as a rendered chat. It adds no new bot and no second session, and it
does not change the orchestration. It decides: how the desktop renders an hc agent terminal as
a chat by reusing RFC 0015's engine and Pocket's chat view; how messages from the view reach
the same terminal, and why approvals are shown there but answered in the terminal until
herdr-core can type a key on a condition; the Code mode switch in the view, which flips the
rendered chat to xterm drawing the same hc pane, in place, from phase 1; which bots can be shown
and how the desktop lists them; what the Bot team's own DSH Bots keep; whom the view answers,
how it reaches the Linux box, and the risk that machine link brings; which desktop P0s block
which phase; and the rollout.

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

Decided on this RFC's eight questions, 2026-11-09. Q2 by the owner; the other seven by Chat,
each as this RFC recommended:

1. **Where the main bot is chosen.** Decided by Chat: the home file's `front`, set from the
   desktop's settings, never from a repo file. The owner sets it to Chat once ((d)).
2. **The terminal face.** Decided by the owner, in the owner's own words (cut off at the
   end, kept as given): "the idea is to have that flip switch in the genie chat itself...
   code mode, we see xterm rendering the very same hc pane as the". So the switch is in the chat
   view itself, a **Code mode** switch: it swaps the rendered chat for xterm drawing the very
   same hc pane, in place, both ways, from phase 1. Herdr's own window (RFC 0013's Code) stays
   reachable, but the view never depends on it ((c)).
3. **Allow-always from the view for a remote seat.** Decided by Chat: no. Once the view may
   answer (phase 4, after Decided 6's upstream call), it offers allow and deny only;
   allow-always is given in Code mode, where the whole dialog is on the screen ((b)).
4. **Does Chat become a universal Bot?** Decided by Chat: no. Chat stays a Claude Code seat on
   the Linux box, so the team runs where it runs today and quitting the desktop app never stops
   it. Revisit only after #842.
5. **The team's DSH Main Bot when `front` names a seat.** Decided by Chat: it stays listed,
   below the main bot, unchanged ((e)).
6. **The answer race.** Re-decided by Chat, 2026-11-09, after review found the window is about
   3 s, not narrow (the first answer, accepting a narrow window, rested on that wrong
   description). A safe interim: the rendered view **shows** approval dialogs but **never answers
   them by typing keys**, because a late key can approve the next dialog, which the owner never
   saw. The owner answers in Code mode, the real terminal, where the exact dialog is on the
   screen. This holds until herdr-core has a conditional key call (herdrdev/herdr-core#122);
   then the view may answer, with an "Answered elsewhere" receipt when it did not (phase 4,
   (b)).
7. **Other people in the view** (teams of humans, an instance rail). Decided by Chat: not in
   this RFC. When it comes, its own RFC with Buzz's gate: owner-only by default, an allowlist,
   never "anyone" for the main bot, stop and cancel owner-only ((f)).
8. **A message that begins with an hc tag.** Decided by Chat: refused with a reason, so nothing
   typed in the view reads as a bot's words to Chat ((f)). Review widened the check to a tag
   anywhere in the message, since one in the middle spoofs as well.

Decided by Chat after review, 2026-11-09:

9. **Delivery H comes before phase 1.** The link scoping to the shown seat, a mask on macOS
   (only Linux has one today, bwrap) and ssh coverage land before the view does. The owner is not
   asked to sign off the link's reach as a phase-0 risk ((f), "The link's reach"; Deliveries).

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
  **Code mode** (xterm drawing the pane itself), and a switch in the view flips between them
  (Decided, 2).
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
| Terminal face | the app's terminal view (`TerminalScreen.kt`) | Code mode: xterm.js in the bots-dsh client ((c)) |
| Notifications | Android | the desktop app's own |

**One contract for both renderers.** The two renderers share no code (Kotlin and JavaScript), so
they share test vectors instead, the way the folder rule does: a new
`herdr/test/fixtures/chat-render-cases.json` lists rows and what each renderer must show (an
`<img src=…>` and a `<script>` as text, a link with its target, ANSI removed, a tagged row's
provenance from (f)). bots-dsh's client test reads it, and Pocket's `ChatRenderTest.kt` reads a
byte-equal copy in its test resources, which a script checks the way `am-copies.mjs` does.

### (b) Input and approvals: show the dialog, answer in the terminal

What the person writes in the rendered face is RFC 0015's "Input":

- **Text** goes through the cleaner, then the draft check: a half-typed terminal draft holds the
  message with Send now (Q2), never cleared. Then `terminal.send`, with no caller. Claude takes a
  message mid-turn as a queued prompt; other agents wait for `idle`. `terminal.send` is the one
  herdr-core call with a condition (`if`), so a message never lands on a dialog: a blocked program
  refuses it, and the message waits.
- **Interrupt** is one `terminal.interrupt`, which never escalates.

**Approvals are shown, never answered, from the rendered face** (Decided, 6). An approval card
appears under RFC 0015's guards (herdr-core `blocked` with kind `permission`; the dialog read only
from the bottom of the screen; exactly one open call in the transcript with the dialog's tool, or
the `PermissionRequest` hook's payload where it runs), with the call's input from the transcript
or the hook, never the screen's summary. It has no Allow or Deny button. It has **Answer in Code
mode**, which flips the view to the terminal on that dialog. Questions and pickers follow the
same rule: their answers are the same unconditioned keys (paced digits and Enter,
`question.js`), so a late one can pick an option of the next question. Their card shows the
question and its options read-only, with Answer in Code mode.

**Why: the window is about 3 s, and a late key lands on the next dialog.** herdr-core types a
key only after about 3 s with no other typing, and `terminal.keys` has no condition
(`approve.js:12-16`, `engine.js:363-367`; hc's schema gives `if` to `terminal.send` only).
During that gap the engine's last re-read still passes, because the dialog is still there, and
anyone can answer first: the owner in Herdr, the phone's engine, a second engine, or Code mode in
the same panel, whose raw keys the engine never sees. When that happens, the view's key arrives
after the dialog closed. On Claude Code a late `1` then **approves the next approval dialog**,
which the owner never saw, or picks option 1 of the next question; a late `esc` denies the next
one or interrupts the turn. Any typing in the gap stretches it further. RFC 0015's engine
already says "the key lands on the next dialog" and answers `uncertain` when herdr-core reports
the key went in at another status or turn; that is a report after the fact, not a guard.

**Until herdr-core has a conditional key call** (keys typed only if the screen still shows that
dialog, or the terminal is still blocked on that turn), the rendered face sends no approval or
answer keys. The call is herdrdev/herdr-core#122, "terminal.keys: an atomic precondition (if
blocked, same turn and status_ms) so a client never answers a prompt nobody saw": optional
`if_blocked`, `if_turn` and `if_status_ms` on `terminal.keys`, checked atomically in the core
with the press, and a `precondition_failed` refusal when any no longer holds (Decided, 6). Then
phase 4 lets the view answer: allow and deny only (Decided, 3), through that call, which refuses
when the dialog changed.
The view's receipt then never guesses: "Answered here: Allow, 14:02" when its key went in,
"Answered elsewhere" when the dialog closed without it, whoever answered.

**The phone has the same window today.** Pocket's Chat tab answers approvals with the same engine
(#574, #655). This RFC does not change the phone: #852 ("pocket: a late approval or question
tap can answer the next, unseen dialog") tracks it, as a change under RFC 0015 that the owner
and the Mobile squad decide.

### (c) The Code mode switch: one session, two faces

The switch is in the chat view itself (Decided, 2): a **Code mode** switch in the view's header.
Off, the view is the rendered chat; on, the same place shows xterm drawing the very same hc pane.
It flips in place, both ways, from phase 1. It is the same idea as Pocket's Chat tab over the
terminal's place.

- **Rendered (Code mode off)** shows the chat rows: turns, collapsed tool calls, approval and
  question cards, held messages, status ("working", "needs you", "idle"), receipts, and screen
  rows marked "Live from the screen" when the transcript has nothing yet.
- **Code mode (on)** shows the pane as the terminal draws it and takes keys, for everything the
  rendered face does not do: approvals and questions until phase 4 (Decided, 6), allow-always
  (Decided, 3), TUI menus, `/` pickers, plan toggles, an image paste, a dialog the screen reader
  does not know.

**How Code mode draws the pane.** The bots-dsh host attaches to the same terminal through
herdr-core's `terminal.attach` (on `<machine>/tN` for a remote seat), as Pocket's terminal view
does through `CoreClient.kt`, and streams its bytes to xterm.js in the window. Keys typed there go
back over the same attach, as raw keys, the way any attached terminal takes them: Code mode is
the terminal, so the rendered face's cleaner and draft hold do not apply to it. The attach is
opened when Code mode is switched on and closed when it is switched off or the view closes.
xterm.js is already a dependency of this repository: the welcome plugin pins `@xterm/xterm`
6.0.0 (`apps/welcome-dsh/package.json`) and imports its stylesheet into its client
(`terminal.js`). bots-dsh takes the same pin and bundles both the library and its CSS into its
committed `client.js`, as welcome-dsh does.

**Size: Code mode never resizes the pane.** `terminal.attach` takes the viewer's `cols` and
`rows`, and in hc's schema only an `observe` attach ("never type or resize") leaves the size
alone; Code mode types, so it cannot be `observe`. The view therefore attaches with exactly the
pane's current `cols` and `rows` (the terminal's own fields, from `hc get`) and sends no RESIZE
frame afterwards, whatever the window does: xterm keeps that grid and the panel scrolls or
scales it to fit. So the owner's Herdr and the phone see no reflow, and the rows the
engine's dialog reader takes from the bottom of the screen do not move under it. A window too
small for the grid shows it scrolled, never reflowed.

**Scrollback.** The attach asks for history, as Pocket's does (`CoreClient.kt`, 1000 lines), so
switching Code mode on paints the last screens of the pane, not only the current one. Switching
it off closes the attach and drops that history; switching on again paints it afresh from
herdr-core, at the bottom. The rendered face keeps its own scroll place across switches; Code
mode always reopens at the bottom.

**Switching never forks the session.** Both faces watch the same hc terminal. A switch starts no
agent, resumes no session, creates no DSH Session and sends nothing; switching Code mode on only
opens an attach, which reads. The rendered face's unsent composer text stays the view's draft;
text typed in Code mode and not yet sent is a terminal draft, which the hold rule in (b)
protects when the person flips back and sends from the rendered face.

**Herdr's own window stays one click away.** RFC 0013's Code (herdr-app, focused on the pane)
still opens the whole workspace around the pane. The view never depends on it, so Code mode works
on a computer where herdr-app is not installed or not supported.

### (d) Which bots, and how the desktop lists them

**Any seat with a live hc terminal can be shown.** How much the rendered face shows depends on
the agent:

| Agent | Rendered face | Approvals and questions |
|---|---|---|
| Claude Code | transcript rows (the Claude decoder) | a read-only card under (b)'s guards (the dialog reader; the hook where it runs), with Answer in Code mode |
| Codex, omp | transcript rows (their decoders) | status only ("needs you"), with Answer in Code mode: they have no dialog reader, since they asked for nothing in the recordings (`dialog.js`) |
| dsh-tui | screen rows only | status only, with Answer in Code mode |
| agy, others | screen rows only | status only, with Answer in Code mode |

Phase 4 lets the view answer only where a card is shown, which today means Claude Code.

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

The team's DSH Main Bot stays in the list below the main bot when `front` names a seat (Decided,
5).

### (f) Whom the view answers, and what is data

**Only the person at the desktop.** The engine's send, answer and interrupt are reachable only
from the chat route bots-dsh serves to its own window, for a terminal that window watches (RFC
0015, "Who can call the engine"). They are never a DSH tool, never given to an automation, a
schedule, another plugin or any Bot. Code mode's attach follows the same rule: it is opened
only for the window that switched Code mode on, its keys come only from that window's xterm, and
it is never a tool or an automation's. So no DSH Bot reaches Chat's terminal **through the
view**, whatever a page, a file or a prompt tells it. A test pins this (phase 1). That is a
claim about the view only: the machine link the view needs gives other paths to the same
terminal, below ("The link's reach").

**The desktop has one author today, so it needs no author gate.** When the view is ever shared
with other people (teams of humans, an instance rail), the gate Buzz uses is the model to follow
(Buzz's `buzz-acp` crate, Apache-2.0; read, not copied): a mode per bot, owner-only by
default, an allowlist, or anyone; fail closed when no owner is known; and stop and cancel
owner-only whatever the mode. For the main bot, "anyone" is never offered (Decided, 7).

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

No row's content is ever turned into an action: no button, card or send comes from text in a
row, only from herdr-core's state and the guards in (b). A message the person writes in the
rendered face that holds an hc tag **anywhere** (`<hc` followed by a space or `>`, in any case,
after the cleaner) is refused with a reason ("This looks like a bot's message"), so a paste
cannot pass as a bot's words (Decided, 8). A tag in the middle spoofs as well as one at the
start, so the check is not limited to the start. Code mode is the raw terminal and is not
checked: there the check could only stop an accident, never a person typing on purpose, and the
person is the owner.

**Untagged is not proof.** An untagged row means herdr-core had no caller for it, not that the
owner typed it. Any process that can reach the core with no caller can write one: on the box, a
process with raw access to the core socket; on the owner's computer, any process that can use
the machine link (below). The per-pane hc proxy (#631) closes the first for sandboxed dsh-tui
panes once a bot is opted in; Claude Code seats are not proxied yet. The view says "typed in the
terminal", never "you", for rows it did not send.

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
gives this computer the whole hc API on the box. The view uses only the calls above. Two routes
are not used:

- **Pocket Link.** Its chat route is admitted by a paired phone's key (`devices.json`,
  `guard.mjs`). The desktop is not a phone and does not pair; going through the bridge would add
  a second path to the same terminals.
- **The hc proxy** (#631). It filters what a bot's own pane may do with hc. The desktop host is
  not a bot pane and must never run under a bot's filter, nor be mistaken for one.

**The link's reach: a risk, recorded plainly.** Any process that can reach the box's hc can type
into Chat's terminal: `hc send`, `hc keys` and `hc exec --on <box>` work for every process of the
owner's account on a computer that holds the machine link, with no caller unless it sets one.
On the owner's computer, that includes the shell and command tools of the DSH Bots in the same
desktop app, and the same shells can reach the box over ssh where the account has a key for
it. A page a DSH Bot read can then lead it to type into the bot
that runs the team and merges pull requests, and an untagged message lands as "typed in the
terminal", which Chat may take for the owner's words. `exec` reaches further still: it runs
commands on the box.

- **Today's guards** are the per-team send guard (`hcGuard.mjs`, a guardrail that sits first on
  the PATH of pack-started dsh-tui panes) and the per-pane hc proxy, C2 of #631 (no bot is opted
  in yet). Both sit in bot panes the Herdr pack starts. Neither covers a DSH Bot's shell on the
  owner's computer that reaches the box through the link. Until the hardening item below lands,
  this path is open.
- **The hardening item** (delivery H): the view's link is **send-scoped to the one seat it
  shows**, and **only the owner's desktop holds it**. On the box side, the link the desktop uses
  allows only the view's calls (`events.subscribe`, `terminal.attach`, `terminal.send`,
  `terminal.keys`, `terminal.interrupt` and `terminal.read` on the shown seat's terminal, and
  `file.read` of its transcript under the folder rule), with `exec`, `run` and every other
  terminal refused. No such scoping exists today: a machine link is all or nothing, and #628
  (scope hc send, keys and attach to a sandboxed bot's own team) and #631's proxy method table
  are the work it starts from. On the owner's computer, the link's credential is readable only
  by the desktop app's host process, and DSH Bots' commands run with hc, the core socket, the
  link's credential and `~/.ssh` masked. Only Linux has that mask today (bwrap, #631's DSH-lane
  runner); the owner's desktop runs macOS, so H includes a macOS mask.
- **H comes before phase 1** (Decided, 9). The view never runs on an unscoped link, and the
  owner is not asked to accept the reach as a phase-0 risk.

**What it reads, and keeps.** Transcripts under the folder rule only. Rows live in the host's
memory while a window watches and 10 minutes after (`LINGER_MS`); they are never written to disk
or logged (RFC 0015, Q4). Tool output can hold tokens and keys: the same text Code mode
shows.

**Undo.** Clear `front`; close the view; revert the plugin release (the view goes, DSH Bots stay);
or remove the machine link. Nothing is stored that needs cleaning.

### (g) The desktop P0s

| Issue | What it is | What it blocks |
|---|---|---|
| #842 | A Claude-ACP session can be saved in a shape DSH refuses to load | Phase 3, where DSH Bots on `acp-claude` sit beside seats every day. Not phases 1 and 2: a seat has no DSH Session. It also blocks any move of Chat to a universal Bot (Decided, 4). |
| #843 | Cmd+W quits the app, mid-run and unasked | Phase 1. Code mode puts a terminal that takes keys in the view from phase 1, and a key meant for the pane or a panel must never quit the app. Quitting does not stop Chat (it runs on the box), but it drops held messages, the watch and the attach. |
| #844 | `bot-session-adopt` refuses with no named reason | None of this RFC's phases: a seat never adopts a DSH Session. Fixed in phase 3's window, since phase 3 lists both kinds side by side. |
| #845 | On macOS, top-bar controls cannot be clicked under the drag region | Phase 1 on macOS, the owner's daily window. The Code mode switch sits in the view's own header, not the top bar, but phase 1 sets `front` in settings, and the bar's controls must be reachable. |
| #846 | `browser_screenshot` reaches the model as text only through the ACP bridge | No phase of the view: Chat is the Claude Code CLI and handles images itself. It blocks phase 3's claim that DSH Bots keep their full tool set. |

## Contracts introduced

- **`apps/bots-dsh/src/host/live-chat/`**: the byte-equal copy RFC 0015 named, created here, with
  `LICENSE-upstream` and `UPSTREAM.md`. Both gates check it. A change ships herdr first.
- **`front`** in the home file (`~/.automagik/bots/bots.json`, version 2): `{ machine, project,
  bot }`, or absent. Set only from the desktop's settings. A repo file's `front` is dropped:
  `front` joins `HOME_FIELDS` in `apps/bots-dsh/src/shared/registry.js` (today `projects` and
  `shown`), the top-level fields a repo file may never set, and any byte-equal copy of the
  module the gates check follows it (RFC 0014, Q15: plugin first). Without that, the parser keeps
  an unknown top-level field from a repo file, so a cloned repo could name the main bot. RFC
  0014's readers keep unknown fields, so older plugins and Herdr pass `front` through unchanged,
  and an older plugin opens as it does today.
- **`herdr/test/fixtures/chat-render-cases.json`**, version 1, and its byte-equal copy in
  Pocket's test resources: the cases both renderers pass. A new case is additive; a changed
  expectation is a change to this RFC.
- No new plugin id, route prefix, storage prefix, ALPN, socket or port. `herdr-pocket/chat/1` is
  unchanged.

## Threat model

The view adds one caller of the engine (the bots-dsh window), one attach (Code mode) and one
reader of a remote seat's transcript on the owner's computer, and it needs a machine link from
that computer to the box. (f) gives the detail; in short:

- **Who can reach the view.** Only the person in the desktop app's own window. No DSH tool,
  automation, schedule, plugin or Bot reaches the engine's send or interrupt, or Code mode's
  attach.
- **Who can reach Chat's terminal anyway: anything that can use the link.** The machine link
  gives every process of the owner's account on that computer `hc send`, `hc keys` and
  `hc exec --on <box>`, the shells of DSH Bots in the same app included. Today's guards (the
  per-team send guard and #631's proxy, which no bot is opted into yet) sit in the box's bot
  panes and do not cover this path, nor ssh from the same shells. Delivery H, which lands before
  phase 1 (Decided, 9), scopes the link to the shown seat, keeps it to the owner's desktop and
  masks hc, the link and `~/.ssh` from DSH Bots' commands, on macOS too ((f), "The link's
  reach").
- **What it can send.** From the rendered face: cleaned text under the draft hold, through
  `terminal.send`, whose condition keeps it off a dialog; one interrupt; no approval or answer
  keys until phase 4 (Decided, 6), and then allow and deny only, through the conditional call,
  never allow-always for a remote seat (Decided, 3); never a message that holds an hc tag. From
  Code mode, the keys the person types in its xterm, raw, as any attached terminal takes them,
  and no RESIZE.
- **What it can read.** Transcripts under the folder rule, through the machine link the owner
  made.
- **Provenance.** Tagged rows are a bot's and are data; rows the view sent are the owner's; other
  untagged rows are "typed in the terminal", never claimed as the owner's.
- **The window's other code.** The desktop host runs plugins, tools and automations. They never
  get the engine; a test fails if the engine is reachable as a tool.
- **Undo.** In (f).

## Deliveries

Each phase is one PR per lane. A PR never mixes the plugin and desktop lanes. The order is 0,
H, 1, 2, 3, 4 (Decided, 9).

0. **The prerequisites** (no release). Chat's terminal on the box carries `agent.session` and
   `agent.transcript` (the briefing hook, RFC 0015 delivery 2). *Check:* `hc get` on Chat's
   terminal shows both labels, and the transcript path passes the folder rule's remote check.
   *Rollback:* nothing to undo.

H. **The scoped link** (before phase 1, Decided 9; (f) "The link's reach"). The link the
   desktop uses is send-scoped to the shown seat: on the box, only the view's calls on that
   seat's terminal and the transcript read under the folder rule, with `exec`, `run` and every
   other terminal refused. On the owner's computer, only the desktop app's host can read the
   link's credential, and DSH Bots' commands run with hc, the core socket, the credential and
   `~/.ssh` masked. Its lanes (herdr-core for the link's scope, herdr, the desktop) are set
   when it is filed.
   *Acceptance (from review, required):*
   - Link scoping is built, not assumed: no hc link can be scoped to one terminal today. It
     starts from #628 (scope hc send, keys and attach to a team) and #631's proxy method table,
     and is filed upstream where it needs herdr-core.
   - A macOS mask: only Linux has one today (bwrap, #631's DSH-lane runner). DSH Bots' commands
     on macOS get the same masks.
   - ssh is covered: a DSH Bot's shell cannot reach the box with the account's ssh keys or
     config.

   *Check:* from a DSH Bot's shell in the desktop app, on macOS and on Linux, `hc send`,
   `hc keys` and `hc exec` to the box are refused, and `ssh` to the box finds no key; through the
   view's link, `hc exec` on the box and a send to another terminal are refused; the view's own
   calls still work. *Rollback:* none that reopens the reach while the view is installed: the
   view refuses an unscoped link, and reverting H reverts the view with it.
1. **The view of the main bot, with Code mode** (plugin; after H; the desktop lane for #843 and
   #845, which must merge first; needs RFC 0014 delivery 3 for the listing, or the `front` bot
   alone ahead of it). The `live-chat/` copy and its gate check (new: no such check exists yet); the
   host engine, which spawns the computer's own `hc connect` (`hc.js`); the renderer, with the
   rendered face read-only and approval and question cards that show and never answer (Decided,
   6); `front` read from the home file and set in settings, with `front` added to
   `HOME_FIELDS`; the Code mode switch, its attach and its xterm (the welcome plugin's
   `@xterm/xterm` pin, its CSS bundled into `client.js`), flipping in place both ways (Decided,
   2).
   *Acceptance (from review, required):*
   - Code mode attaches with the pane's own `cols` and `rows` from `hc get` and never sends a
     RESIZE frame: resizing the window or switching faces changes the pane's size for no viewer.
   - Code mode's attach passes `history` (1000 lines, as Pocket), so switching it on paints the
     last screens, and reopens at the bottom; the rendered face keeps its scroll place.
   - A repo file that sets `front` has it dropped by the parser; the home file's is kept.
   - The Codex and omp cards are status only with Answer in Code mode, as (d)'s table says,
     since they have no dialog reader.
   - The host route exposes no answer path before phase 4: the engine's `answer` (and its
     question steps) is not wired to the window's route at all, so no client, request or
     plugin can reach it, not only that the client hides the buttons.
   - The view refuses to start on a link H has not scoped.

   *Check:* the plugin gate; the copy check fails on a one-byte change; with a fake hc and temp
   homes (never a live Herdr), a remote seat's transcript rows render, an `<img>` and a
   `<script>` render as text, a tagged row renders as the bot's; an approval card has no Allow
   or Deny and its Answer in Code mode flips the view, and no approval or answer key is ever
   sent (the fake hc records no `terminal.keys` from the rendered face), and a hand-made answer
   request to the host route is refused as unknown; switching Code mode on
   opens one attach with the pane's size and `history`, switching it off closes it, and neither
   sends anything (no `terminal.send`, no `terminal.keys`, no `run`, no RESIZE); keys typed in
   Code mode reach the attached terminal; the engine and the attach are not callable as a DSH
   tool or by an automation. On the owner's computer: Code mode shows Chat's pane at its size in
   Herdr, and a key typed there lands in Chat's terminal. *Rollback:* revert in a later plugin
   release; `front` stays in the home file and is ignored.
2. **Writes from the rendered face** (plugin). Send with the hold, interrupt, the hc-tag
   refusal. No approval or answer keys (Decided, 6).
   *Acceptance (from review, required):* the hc-tag check matches a tag anywhere in the message,
   not only at its start.

   *Check:* with a fake hc: a held draft is never cleared; a send to a blocked terminal waits and
   is never typed into the dialog; a message holding an hc tag at its start, in its middle or
   at its end, in any case, is refused, and one that only mentions "hc" is not. On the owner's
   computer: a message from the rendered face is answered in Chat's terminal, and both faces show
   the same turn; a draft typed in Code mode holds a message sent from the rendered face.
   *Rollback:* a plugin release that drops the writes; phase 1 stays, Code mode included.
3. **Every shown seat, beside DSH Bots** (plugin; after RFC 0014 deliveries 3 and 8; #842 and
   #846 fixed, #844 in the same window). The kind marks, the seat composer, seats on every
   linked machine, offline rows. This is RFC 0014's delivery 9 for every exposed Bot that has a
   live pane: one conversation, in both windows, here and on linked machines. Delivery 9's other
   half, starting an agent that has no pane, is not here: it waits for #206 ((d)).
   *Check:* RFC 0014 delivery 9's check, less the start of a Bot with no pane; a seat is never
   written to `state.json` and cannot be mentioned into a group; a DSH Bot's chat is unchanged;
   Code mode works on every listed seat. *Rollback:* a plugin release that lists only the
   `front` bot again.
4. **Answers from the view** (herdr, then plugin; after herdr-core ships
   herdrdev/herdr-core#122, Decided 6). The engine answers through `terminal.keys` with
   `if_blocked`, `if_turn` and `if_status_ms` from the card it showed, checked atomically with
   the press; a `precondition_failed` refusal closes the card as "Answered elsewhere". The host
   route gains its answer path only here. The rendered face gets Allow and Deny on Claude
   Code's cards (no allow-always, Decided 3) and the paced answers to questions, each step
   conditional. *Check:* with a fake hc that closes the dialog during the quiet gap: no key is
   typed, and the card closes with "Answered elsewhere"; with the dialog still open, the key
   goes in and the card says "Answered here".
   *Rollback:* a plugin release without the buttons and without the route's answer path; cards
   return to show-only.

The render cases fixture lands with phase 1 (herdr side) and Pocket reads its copy in its next
pocket patch.

## Open questions

None. The eight questions this RFC asked were decided on 2026-11-09 (Decided, 1 to 8): Q2 by the
owner, the rest by Chat as recommended, Q6 re-decided after review. Decided 9 (H before phase
1) came from review the same day.

## Tracking

Ledger pass (2026-11-10): the board links this RFC from its file.

- Open issues: #852.
- Merged changes that cite this RFC: #847, #866 (last merged 2026-11-09).

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
  `apps/pocket/android/app/src/main/java/ai/namastex/automagik/` (`ChatScreen.kt`,
  `ChatClient.kt`, `TerminalScreen.kt`, `CoreClient.kt`); `apps/welcome-dsh/package.json`
  (the `@xterm/xterm` pin); `herdr/mods/am-sidebar/hcProxy.md`.
- Issues and pull requests: #574 and #655 (Pocket's chat view); #206 (remote Bots); #628
  (team-scoped hc); #631 (the per-pane hc proxy); #852 (the same window on the phone); #842,
  #843, #844, #845, #846 (the desktop P0s); herdrdev/herdr-core#122 (the conditional key call).
- Outside projects, read as research and not copied: dsh-herdr-bridge (MIT), a DSH plugin that
  mirrors DSH sessions into hc terminals; Buzz (Apache-2.0), its `buzz-acp` author gate; two
  plugins both named dsh-herdr (one MIT, embedding a terminal in DSH; one Apache-2.0,
  `dsh-plugin-herdr`, reporting DSH session status to herdr-core).
