# RFC 0015: Live chat projection

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | not scheduled |
| Lanes | herdr (3.N.P, Pocket Link included), plugin (3.N.P), pocket (3.N.P, [RFC 0011](0011-monorepo-parts-and-releases.md)) |
| Created | 2026-11-03 |

## Summary

A Herdr code Bot is one live agent in a terminal. This RFC makes that same agent a chat in every
other window: the Automagik window and the phone show its turns, approvals and status, and what
the person types there goes into the terminal as keys. Nothing new runs the agent; the chat is a
projection of the terminal, read from the agent's own transcript first, then herdr-core's
status, then the screen. It decides where the projection's code lives (JavaScript beside Pocket
Link, D32), what we take from Orca (MIT, D31) and how it is credited, how a transcript is found
and kept inside the agent's own folders, how text, approvals and interrupts are typed, and the
phone's new Pocket Link route. RFC 0014's deliveries 8 and 9 build on it.

## Motivation

Felipe decided one conversation per Bot, seen from every window (D29), and two chat backends
(D30): work Bots keep DSH's structured (ACP) sessions; Herdr's code Bots stay terminal agents
and get a live chat view. Today:

- The Automagik window cannot show a Herdr agent at all; RFC 0014 lists exposed Bots but leaves
  their chat to this RFC ([0014](0014-shared-bot-registry.md) "Herdr Bots in Automagik").
- The phone shows a Herdr terminal as a terminal. Pocket Link pipes each paired phone's stream
  straight into `hc connect` (`herdr/mods/pocket-link/bridge/bridge.mjs:102-132`), and the app
  speaks herdr-core's API through it (`apps/pocket/.../CoreClient.kt:27-100`: `terminal.attach`,
  `terminal.send`, `terminal.keys`, `terminal.read`, `file.read`). A long agent turn on a phone is
  a small screen of scrolling text.
- Herdr already ties a Claude session to its terminal, but only for panes it briefs. The briefing
  hook reads `session_id` and `transcript_path` from Claude Code's hook input, appends a
  `session` row with both to `<app home>/automagik-herdr/workers.jsonl`, and sets the terminal's
  `agent.session` label (`herdr/mods/am-sidebar/briefing.mjs:182-200`, `workers.js:304-334`). The
  transcript path never leaves this computer's ledger, and the hook runs only in panes Start or
  Attach set up, on the one Mac that has the pack's hooks (t22n's note; #206).

Orca (`github.com/stablyai/orca` at `ec3a707`, MIT, © 2026 Lovecast Inc.) already shows terminal
agents as chat. The research note (`bot-chat-backend/orca-research-2026-11-03.md`) cites its
files; this RFC cites them again where it takes from them.

## Decided and proposed

Decided by Felipe (handoff `bot-system-unification.md`):

- **D29: one live agent, every window.** An exposed Bot's chat in Automagik is the same live
  Herdr agent the terminal shows; Code shows the same session as a terminal.
- **Q19 (D29): Orca's way, drafts held.** The transcript file, found through our own briefing
  hook's `transcript_path`, is the source of truth; hc gives status and does the sends (a
  bracketed paste, then Enter as its own write). A half-typed terminal draft is never wiped: the
  message is held, with Send now. Not Orca's hook format or server, not ACP.
- **D30: two backends.** Herdr code Bots: the live projection, transcript tail > hooks > screen
  text; input and approvals as terminal keys; "user won't even know"; show terminal is always
  available. Automagik work Bots: structured DSH (ACP) sessions, unchanged by this RFC.
- **D31: vendor Orca's MIT code with attribution.** Its transcript decoders, the paste and Enter
  sequence, the approval envelope and key map, and the types. We own the copies afterwards.
- **D32: where it lives.** JavaScript in `herdr/`, next to Pocket Link (Node); the Automagik
  window imports the same module; the phone (Kotlin) only renders. Not usagemeter, not a new Rust
  daemon.

Required by t2x5's review of RFC 0014 (its Threat model, "The chat projection"): rows render as
text or sanitized markdown only; `transcript_path` is accepted only inside the agent's own
transcript folders, here and through `hc file read --on`; pasted text loses `ESC[200~`,
`ESC[201~` and every other control sequence; the briefing hook passes the transcript path on.

Everything in Design is this RFC's proposal. Open questions 1-4 wait for Felipe.

## Design

### One agent, three windows

The agent runs in a herdr-core terminal, as today. Three windows look at it:

- **The terminal** (Herdr, or `hc attach`): the agent itself. Nothing changes there.
- **The Automagik window**: the bots-dsh host imports the projection module and serves the chat
  to its client (RFC 0014 delivery 9).
- **The phone**: Pocket Link's bridge runs the same module and serves the chat over a new route
  (below). The app renders rows and sends the person's actions; it parses no transcript.

The module is one engine per watched terminal, shared by every client that watches it in that
process. It holds no state on disk: everything it shows can be read again from the transcript,
herdr-core and the screen.

### Where the code lives

The module is plain JavaScript (ES modules, no dependencies, no build), so it runs as it is in
the bridge and in the DSH host. Its floor is the bridge's Node (`bridge/package.json`, `>=20.3`).

- **Source:** `herdr/mods/pocket-link/chat/`, beside the bridge, so a copied Pocket Link carries
  it (Pocket Link ships as its folder; README "Update"). It is Pocket's, like the rest of the
  folder: on the herdr lane, never in the pack's `PACK_MODS`, tested by `ci.yml`'s `pocket-link`
  job. The folder has no `main.js` or `layouts/`, so it is not a Herdr entry
  (`scripts/entries.mjs --check`).
- **The Automagik window's copy:** `apps/bots-dsh/src/host/live-chat/`, byte-equal, checked by
  both gates (the pattern 0014 Q15 set for `registry.js`). A change ships herdr first, then the
  plugin. Open question 1.

### What we take from Orca (D31)

Ported from TypeScript to JavaScript with JSDoc types, behaviour unchanged, each file's header
naming its upstream path:

| Ours (`chat/`) | Orca at `ec3a707` |
|---|---|
| `decode-claude.js`, `decode-codex.js`, `decode-omp.js` | `src/main/native-chat/transcript-line-decoders-{claude,codex,omp}.ts` |
| `types.js` (rows, turn lifecycle, session status, sources) | `src/shared/native-chat/native-chat-types.ts`, `src/shared/agent-status-types.ts` (the parts used) |
| `paste.js` (sanitize, bracket framing, separate submit) | `src/shared/native-chat/input/native-chat-paste-bytes.ts` |
| `answer.js` (approval envelope, key map, paced steps) | `src/shared/native-chat/input/native-chat-{approval-envelope,answer-stepping}.ts`, `native-chat-agent-support.ts` |
| `screen.js` (ANSI-free screen reading) | `src/renderer/src/components/native-chat/native-chat-scrape-fallback.ts` |

Their tests come too, as `node --test` fixtures. Not taken: Orca's hook server and its hook
event format (D31; `main/devin/hook-service.ts`), its Electron and React code, its mobile app and
relay, and its structured-session runtime.

- **Credit.** Orca's MIT copyright and permission notice go verbatim in
  `chat/LICENSE-upstream`; the folder stays Apache-2.0 as a derived work, as `herdr/NOTICE`
  already does for other vendored mods. `herdr/NOTICE` gains an entry naming the files and the
  commit; `apps/bots-dsh/NOTICE` gains the same for its copy.
- **Upstream.** `chat/UPSTREAM.md` keeps the commit and, per file, the upstream path and blob id
  it came from. We own the copies (D31): an upstream fix is pulled by hand, as a herdr patch, when
  a decoder breaks on a new agent version or Orca fixes something we hit. Nothing fetches Orca in
  CI.

### Finding a terminal's transcript

The engine picks the agent from `hc get`'s `status.app` (Claude Code reports `claude-code`), else
the program in `argv`. Claude, Codex and omp have decoders; any other agent is screen only.

The transcript of terminal `t`, first match wins:

1. **The `agent.transcript` label** (new; delivery 2). The briefing hook already holds
   `transcript_path` when it ties the session; it sets this label beside `agent.session`. Today
   it ties only when the session id changes (`workers.js:324-334`), so the rule widens: it also
   ties when `agent.transcript` is missing or differs, and a pane labelled before the update gets
   the new label at its next prompt. A label is readable through `hc get` on any machine, which
   the ledger is not.
2. **The workers ledger's last `session` row** for `t` with a `transcript`, on this computer
   (`inspect.js:43` reads it the same way).
3. **Derived from `agent.session`.** Claude: `.claude/projects/<cwd slug>/<session>.jsonl`.
   Codex and omp name files by date, so they need 1 or 2.
4. **Discovered, this computer only.** A pane with no label (t22n: plain `hc run … claude` panes
   have none): the newest transcript in the agent's folder for the pane's `cwd`, written after the
   pane started. Used only when exactly one candidate fits; two panes in one folder are never
   guessed between. Orca looks in the same folders
   (`src/main/native-chat/session-file-resolver.ts:35-40`).
5. **None.** The chat is screen only (see "Unlabeled panes and other machines").

**The folder rule** (t2x5). A path from any of these is used only if it is inside the agent's own
transcript folder: `.claude/projects/`, `.codex/sessions/` or `.omp/agent/sessions/` (omp's
default, `omp-session-root.ts` in Orca), under the
home of the machine the terminal runs on, and ends in `.jsonl`. On this computer the path is
resolved (`realpath`) before the check, so a symlink out of the folder is refused. For a terminal
on another machine the path is made home-relative, must have no `..` or empty segment, and is
read as that relative path with `hc file read --on <machine>`, which starts relative paths at
that machine's home. `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and omp's XDG folder are not followed in
this RFC; such a pane is screen only. A refused path is logged once, by its folder, never its contents.

### Tailing

- **This computer:** `fs.watch` on the file plus a one-second poll, reading from the last byte
  offset, holding a partial last line until its newline. Orca does the same
  (`transcript-watch.ts:48,66`).
- **Another machine:** `file.read` with `offset` (lines) while a client watches: every 2 s while
  the agent is working, every 10 s when idle. `file.read` stops at 8 MB, so a backfill reads by
  `limit` pages.
- **A new session in the same pane** (the label changes, or `/clear`): the old transcript's rows
  stay, a divider says "new session", and tailing moves to the new file.
- **The first write can lag** (Orca, `transcript-watch.ts:48`: "First flush may take minutes").
  Until rows arrive, the screen and status fill the turn.

### Status and hooks

Orca's middle source is its own hook server. We have herdr-core instead, which every machine
runs: `events.subscribe` on the terminal gives `status.state` (`working`, `idle`), `status.msg`
and `turn`, and `terminal.send` answers `blocked` when the program sits in a dialog. That is the
status row, the "working" indicator and the turn boundary. The briefing hook's facts (session,
transcript) arrive as labels. No new hook is added in this RFC; a Claude hook that names a
pending approval's tool is a possible later step if screen reading proves too weak.

### Screen fallback

`terminal.read` gives the screen as text. The per-agent screen reader finds three things:

- **the input row**, to see whether a half-typed draft sits there (see "Input");
- **a dialog** (an approval, a question, a picker), with its options;
- **the visible turn**, when there is no transcript yet.

Screen rows are marked "from the screen", are replaced as the screen changes rather than
appended, and are dropped once transcript rows cover their turn. They are never kept.

### Ranking and dedupe

Sources rank transcript 3, status 2, screen 1 (Orca, `native-chat-types.ts:24-32`). Within one
turn (a user message to the next `idle`), a row from a higher source replaces a lower one of the
same kind. A message sent from a chat shows at once as "sending" and is matched to the
transcript's user row by its sanitized text in that turn; if none comes, it stays marked "not in
the transcript yet".

### The row model

Every row: `id` (stable: the transcript's own id, else `<file>:<line>`), `turn`, `at`, `source`
(`transcript`, `status`, `screen`), `kind`, and the kind's fields:

- `text`: `role` (`user` or `assistant`), `text` (markdown);
- `tool-call`: `tool`, `summary`, `input` (a short preview);
- `tool-result`: `call` (the tool-call row's id), `ok`, `output` (a preview);
- `approval`: `tool`, `summary`, `choices` (`allow`, `allow-always` when the dialog shows it,
  `deny`), `open` (still on screen);
- `question`: `prompt`, `options`, `multi`, `answerable` (false where the agent cannot be answered
  by keys, below);
- `status`: `state`, `msg`;
- `tokens`: `input`, `output`, `cache`, `context` when the transcript records them (Orca's
  `AgentSessionTokenUsage`, no prices).

**Rendering, both clients** (t2x5). Text is shown as text or as markdown through a sanitizer:
raw HTML is shown as text, never rendered; no image or other remote resource loads by itself (an
image is a link the person taps); links show their target. Control characters and ANSI codes are
removed before display. Tool output is monospace and collapsed.

### Input

What the person does in a chat becomes keys in the same terminal. The engine never answers
anything on its own (0014 Threat model).

- **Text.** First the text is cleaned (t2x5): `ESC[200~` and `ESC[201~` removed, then every
  other escape sequence, every C0 control but newline and tab, DEL and C1 controls; CRLF becomes
  LF. Empty after cleaning: refused. Then:
  1. **Draft check** (Q19). The screen's input row is read. If it holds text the person typed in
     the terminal, the message is **held**: the chat shows it with "The terminal has a half-typed
     message" and **Send now**. A held message goes by itself once the input row is empty. The
     draft is never cleared, unlike Orca. What Send now does to the draft is open question 2.
  2. **Send.** `terminal.send`: herdr-core pastes the text, waits until nobody has typed for about
     3 s (keys pressed meanwhile are held, then delivered), and presses Enter. Where an agent
     needs Orca's framing instead (a bracketed paste for multi-line text, Enter as its own write
     500 ms later, `native-chat-paste-bytes.ts:20-33`, `native-chat-answer-stepping.ts:1`),
     `paste.js` writes those bytes on an attached stream; delivery 3's checks decide per agent.
  3. **While working.** Claude takes a message mid-turn as a queued prompt (Orca decodes it,
     `transcript-line-decoders-claude-queued-prompt.test.ts`); it shows as "queued". Other agents'
     messages wait for `idle` unless delivery 3's checks show they queue too.
  4. **Blocked.** A send that herdr-core answers `blocked` (a dialog is open) is not forced: the
     message waits, and the dialog shows as an approval or question row.
- **Approvals.** The key map comes from Orca: allow is `1` for Claude and Codex, deny is `esc`
  (`native-chat-approval-envelope.ts:38-45`, `native-chat-agent-support.ts:66`); allow-always is
  the dialog's own number, read from the screen. Just before pressing, the screen is read again:
  if the same dialog (tool and summary) is no longer there, nothing is pressed and the chat says
  the question changed.
- **Questions and pickers.** Paced key steps, one body and one Enter per answer, 500 ms apart
  plus 500 ms to let the next question draw (`native-chat-answer-stepping.ts`). Each step checks
  the screen first and stops at a mismatch with "Finish in the terminal". omp's questions cannot
  be answered by keys (`native-chat-agent-support.ts:41`): the row shows the question with "Answer
  in the terminal".
- **Interrupt.** `terminal.interrupt`: esc when the program reports status, else ctrl+c, and it
  never escalates. Never a second esc for Claude or Codex, which read esc esc as rewind
  (`native-chat-agent-support.ts:46`).
- **Show terminal.** Always one tap away, in both clients: the Automagik window opens Code on the
  pane (RFC 0013), the phone opens its terminal view on the same terminal.

### The phone: a chat route in Pocket Link

herdr-core is upstream Rust; chat methods cannot go into it. The bridge serves them itself, on a
second ALPN beside the session one:

- **`herdr-pocket/chat/1`**, in `bridge.mjs`'s `routes`, admitted by the same paired-key check as
  `herdr-pocket/1` (`devices.json`, `guard.mjs:acceptOne`), untimed once its header is in. Before
  pairing it is refused before anything is read, like the session route. A removed phone's chat
  sessions end with its terminal ones (`revoke`).
- **Wire.** The same framing the app already speaks to herdr-core (`hello` with
  `generation: 1, framed: true`, JSON-RPC on channel 0, streams on their own channels with
  credit), so `CoreClient.kt` is reused. `hello` also answers `chat: 1`.
- **Methods.** `chat.list` (live terminals with a decoder or a screen reader: terminal, machine,
  agent, title, status, and whether the chat is from the transcript or the screen);
  `chat.subscribe {terminal, after?}` (a stream of row, status, draft and dialog events);
  `chat.backfill {terminal, before, limit}`; `chat.send {terminal, text, id}` (answers `sent`,
  `queued`, `held` or `refused` with a reason); `chat.sendHeld` and `chat.cancelHeld`
  `{terminal, id}`; `chat.answer {terminal, row, choice}`; `chat.interrupt {terminal}`.
- **Limits.** A row's text is cut at 64 KiB and a tool output preview at 8 KiB, each with "open
  in terminal"; a backfill page is at most 200 rows and 1 MiB; a send at most 32 KiB; at most 8
  subscriptions per connection. The connection caps in `guard.mjs` (`MAX_OPEN`, `MAX_PENDING`,
  `HANDSHAKE_MS`, `MAX_LINE`) apply unchanged.
- **Reconnect.** A cursor names the segment and the row. The bridge keeps the last 500 rows of
  each watched terminal in memory, while a phone watches and 10 minutes after. A resubscribe with
  `after` gets what it missed; a cursor the bridge no longer has (it restarted) gets `reset` and
  the latest page. A message the phone sent and did not see answered is never sent again
  silently: the phone shows it as "maybe not sent" with Retry.
- **An older bridge** refuses the ALPN: the phone shows "Update Pocket Link on this computer for
  chat" and the terminal view as today. Nothing updates Pocket Link by itself (its README,
  "Update"), so this case lasts.
- **Other machines.** The phone pairs with one computer's bridge; that bridge reaches linked
  machines through hc, as the terminal view does.

### Unlabeled panes and other machines (t22n)

Two gaps today: plain `hc run … claude` panes have no `agent.session` label, and the hook that
sets it runs only on the computer with the pack's hooks.

- **This computer, unlabeled.** Discovery (step 4 above). When discovery cannot decide, the chat
  is screen only. Open question 3 proposes closing the gap with a small hook for every Claude
  pane.
- **Linked machines, until #206 installs the pack there.** A pane with both labels (set by
  something else, such as a Bot started from here) is tailed through `hc file read --on`. A pane
  without them is screen only: discovery needs a folder listing, and `file.read` cannot list,
  and the module runs no programs on other machines.
- **What the chat shows meanwhile.** The turns the screen shows, marked "live from the screen",
  a line saying "History appears when this pane's transcript is found", status from herdr-core,
  approvals and questions from the screen, and Show terminal. Sending, approving and interrupting
  work the same.

### What stays different from the terminal

Orca's own list of gaps (research note, "Parity gaps") and our answer:

| Gap | Our answer |
|---|---|
| The first transcript write can lag minutes | Screen and status fill the turn; a sent message shows at once as "sending" |
| omp questions cannot be answered by keys | Shown with "Answer in the terminal" |
| Pickers are paced key steps, timing-sensitive | Orca's pacing, a screen check before each step, stop at a mismatch |
| esc esc rewinds Claude and Codex | Interrupt sends one esc; `terminal.interrupt` never escalates |
| Key maps follow each agent's TUI version | A dialog the screen reader does not recognize gets no buttons, only "Answer in the terminal" |
| TUI-only screens (menus, `/` pickers, plan toggles) | Typed commands go as text; interactive menus open the terminal |
| Image paste | Not in this RFC; `terminal.put` can carry it later |
| Unlabeled and remote panes | Screen only until labelled (above) |
| Orca moved new chats to structured sessions | Our work Bots already are (D30); code Bots stay live by decision |

## Contracts introduced

- **`agent.transcript`**, a new terminal label, set by the briefing hook next to `agent.session`.
  Old packs never set it; readers fall back to the ledger. The attach ledger and
  `whois --json` (`bots.attach-ledger@1`, `bots.whois-json@1`) do not change; the workers
  ledger's `session` row already carries `transcript` and does not change.
- **`herdr-pocket/chat/1`**, a new ALPN on Pocket Link's endpoint, with `chat.*` methods and
  wire version 1. Older phones never dial it; older bridges refuse it and the phone falls back.
  A change to its methods' meaning is a new ALPN version.
- **`herdr/mods/pocket-link/chat/`** and its copy **`apps/bots-dsh/src/host/live-chat/`**, with
  `LICENSE-upstream` and `UPSTREAM.md`. New.
- **The transcript folders**: `.claude/projects/`, `.codex/sessions/`, `.omp/agent/sessions/`
  under a machine's home. Widening the list is a change to this RFC.
- **`docs/privacy.md` in Pocket**: the app now receives agent transcripts (delivery 5).

## Threat model

- **Who can reach it.** Only paired phones, through Pocket Link's existing gate (pairing code,
  `devices.json`, `guard.mjs`); unchanged. In the Automagik window, only the person's own DSH
  host. A paired phone already has the whole `hc connect` API, including `terminal.attach`,
  `terminal.keys` and `file.read`: the chat route gives it a better view of what it can already
  read and type, and no new reach.
- **What it can read.** Transcripts of live terminals' agents, through the folder rule. The rule
  is against a bad label, hook payload or ledger row pointing a chat at another file (`~/.ssh`),
  not against the phone. Labels are free-form and any program in a terminal can set them, so the
  label is never trusted more than the rule allows.
- **What it can send.** Text, through the cleaner and the draft check; mapped approval and answer
  keys after a screen check; interrupt. Only on the person's action in a client.
- **Rendering.** Transcript text is written by the agent and by whatever it read (web pages,
  files, tool output). It is shown as text or sanitized markdown, with no HTML and no remote load
  by itself, so a page the agent read cannot run in, or call home from, either window.
- **Secrets in transcripts.** Tool output can hold tokens and keys. The phone keeps rows in
  memory only, never on disk; the bridge and the DSH host never log row text. Redaction is open
  question 4.
- **Undo.** Remove the phone in Pocket Link (its sessions end within 2 s), turn the bridge off,
  or revert the deliveries; nothing is stored that needs cleaning.

## Failure modes

- A transcript line that does not parse is skipped; the turn falls back to the screen.
- A decoder that falls behind a new agent version shows screen rows and keeps Show terminal; the
  fix is a herdr patch.
- A machine that stops answering: the chat keeps the last rows, greyed, says the machine is
  offline (as 0014 "Other machines"), and refuses to send. Nothing is queued for later.
- The bridge restarts: phones reconnect with their cursor and get `reset` and the latest page.

## Deliveries

1. **The module: decoders, types, cleaner, folder rule** (herdr). `chat/` with the Orca ports
   and their tests, `LICENSE-upstream`, `UPSTREAM.md`, the `herdr/NOTICE` entry, and the
   `pocket-link` job running `chat/*.test.mjs`. Nothing imports it yet. *Check:* the job; Claude,
   Codex and omp fixture lines decode to rows; `ESC[200~` inside a message is gone after
   cleaning; `~/.ssh/id_ed25519`, `../` and a symlink out of `.claude/projects` are refused.
   *Rollback:* revert in a later herdr patch; nothing uses it.
2. **The transcript label** (herdr, t22n; RFC 0014 delivery 8's "the briefing hook passes the
   agent's `transcript_path` on"). `joinSession` also sets `agent.transcript`, only for a path
   the folder rule accepts, and `sessionChange` also fires when that label is missing or stale.
   One PR with 0014's delivery 8, or before it. *Check:* the herdr gate; after one prompt in a
   new bot pane, `hc get` shows both labels; a pane that had `agent.session` before the update
   gets `agent.transcript` at its next prompt, with no second ledger row for the same session; a
   hook input naming a path outside the folders sets no `agent.transcript`. *Rollback:* a reverting pack (the pointer never
   downgrades); labels already set stay and are harmless.
3. **The engine** (herdr). Transcript finding, tailing (here and `--on`), status, screen reading,
   ranking, the row model, input with the draft hold, approvals, pickers, interrupt, all behind
   one API both clients call. *Check:* tests against a fake `hc` and temp homes (never a live
   Herdr): a held draft is never cleared; a stale approval presses nothing; a remote tail reads by
   offset; per agent, a multi-line message arrives as one message in a recorded fake terminal.
   *Rollback:* revert; nothing calls it until 4 or 0014's 9.
4. **The chat route** (herdr, Pocket Link). `herdr-pocket/chat/1` in `bridge.mjs`, the limits,
   cursors, and README's "Update" note. *Check:* `guard.test.mjs` gains: an unpaired key is closed
   before its header is read, a removed phone's chat session ends; a fake hc behind the route
   answers `chat.list` and streams rows. *Rollback:* copy the older mod (nothing updates Pocket
   Link by itself); phones fall back to the terminal view.
5. **The phone's chat view** (pocket, after 4). A Chat tab on an agent terminal: rows, approvals,
   held messages with Send now, interrupt, Show terminal; `docs/privacy.md` says transcripts now
   reach the phone and stay in memory, and Pocket's RFC index (`apps/pocket/docs/rfcs/README.md`)
   links this RFC, as Pocket's AGENTS.md asks for a contract change. *Check:* the Gradle gate; unit tests render `<img
   src=…>` and `<script>` as text and load nothing; on a paired phone, a Claude pane's turn shows
   as chat and an approval answered there lands in the terminal. *Rollback:* a later release
   hides the tab (never a lower versionCode); the terminal view is unchanged.
6. **Every Claude pane on this computer** (herdr, t22n, if open question 3 says yes). *Check:* a
   plain `hc run … claude` pane gets both labels after its first prompt; saying no installs
   nothing. *Rollback:* a reverting pack removes the hook it added and nothing else.
7. **Linked machines** (herdr, after #206). Where the pack's hooks run on a linked machine, its
   panes get both labels and are tailed through `hc file read --on`. *Check:* a labelled remote
   pane's chat shows transcript rows; a remote path outside the folders is refused. *Rollback:* a
   reverting pack; remote panes go back to screen only.

**With RFC 0014.** 0014's delivery 8 carries this RFC's delivery 2 (or follows it). 0014's
delivery 9 (one conversation in the Automagik window) needs deliveries 1-3 here, not 4-5, and
copies the module into bots-dsh. The phone (5) needs 4. Linked machines (7) need #206, as 0014's
delivery 7 does.

## Open questions

1. **Where the module sits, and how the Automagik window gets it.** *Recommended:* source in
   `herdr/mods/pocket-link/chat/` (it ships with a copied Pocket Link, which the bridge needs),
   a byte-equal copy in `apps/bots-dsh/src/host/live-chat/` checked by both gates, herdr first.
   The other way, a folder of its own such as `herdr/live-chat/`, needs a second copy inside
   Pocket Link for the bridge to run it.
2. **What Send now does with the terminal's draft** (Q19 says held and never wiped).
   *Recommended:* the message is pasted after the draft and both are sent as one message; the
   chat says so before the tap ("Sends your half-typed terminal text with it"). Nothing is
   cleared or retyped. Without a tap, the held message goes once the input row is empty.
3. **Plain Claude panes.** *Recommended:* the pack offers once, in Herdr, "Show every Claude
   pane as a chat", and on yes adds a small hook to the person's Claude user settings that only
   sets `agent.session` and `agent.transcript` (no briefing, no output, fail-open). Until then,
   such panes use discovery or the screen.
4. **Secrets in transcripts.** *Recommended:* no redaction in this RFC. The rows are the same
   text a paired phone can already read from the terminal; they are never written to disk on the
   phone or logged by the bridge or the host. Revisit if chat rows are ever stored or sent
   anywhere new.

## Links

- Handoff: `bot-system-unification.md` (D29-D32);
  `bot-chat-backend/orca-research-2026-11-03.md` (Orca, with file and line evidence); t22n's note
  on the label and the hook (`t22n-note-d30-chat-projection.md`).
- RFCs: [0014](0014-shared-bot-registry.md) Herdr Bots in Automagik, Threat model, deliveries 8
  and 9 (draft PR #236); [0013](0013-work-code-switch.md) Code on a pane;
  [0011](0011-monorepo-parts-and-releases.md) the herdr and pocket lanes;
  [0003](0003-model-routes-and-acp.md) the structured (ACP) chats work Bots keep.
- Code: `herdr/mods/pocket-link/bridge/{bridge,guard,pairing}.mjs`, `README.md`;
  `herdr/mods/am-sidebar/{briefing.mjs,workers.js,inspect.js,restart.js}`;
  `apps/pocket/android/app/src/main/java/ai/namastex/automagik/CoreClient.kt`; herdr-core's API
  (`hc schema`: `terminal.send`, `terminal.keys`, `terminal.interrupt`, `terminal.read`,
  `file.read`, `events.subscribe`).
- Orca: `github.com/stablyai/orca` at `ec3a707` (MIT, © 2026 Lovecast Inc.).
- Issues: #206 (linked machines).
