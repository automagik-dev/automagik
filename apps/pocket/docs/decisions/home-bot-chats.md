---
title: "Home counts the Bots' chats with the terminals"
type: decision
status: Implemented
created: 2026-11-08
updated: 2026-11-08
pr: ""
tags: [decisions, home, bots, chat]
---
# Home counts the Bots' chats with the terminals

Home is the needs-you cockpit, and an Automagik Bot's `dsh:` chat is in it: a chat blocked on a
question or an approval counts, carries the Home badge and is a Needs you row that opens the chat.
Issue #732 (signed four-tab work, part 2).

## Decision

- **A chat is an agent on Home.** Every shown `dsh:` chat of a read machine (the list Team reads,
  `rememberDshChats`) is a Home row beside the terminals, ranked by the same rule (`Cockpit.sections`):
  Needs you, then Done; Working and Idle under Everything else. Its card says the Bot's name, what
  it asks (the row's line when bots-dsh gives one, else the open card's text while the chat is
  open), and "Needs you · question" or "· permission". The count card and the Home badge are the
  sections' Needs you count, so a blocked chat raises both (`Projects.Pulse.needsYou`).
- **The row opens the chat.** Its ref is the `dsh:<sessionId>` chat itself: a tap is
  `selectTerminal` on it, which shows the chat (`MainActivity`, `ChatPane`), scrolled to its end,
  where the open card is. Never the terminal screen.
- **One conversation, one row** (RFC 0015 D29). A Bot with both a chat and a labelled pane (joined
  by registry id as `Teams.bubbles` joins them, else `dsh:<id>` itself) is its pane's row: when the
  chat's word is the more urgent the pane's row takes the chat's word, kind, line, turn and time,
  and its Done is looked at by the chat's key (`Projects.Pulse.seenKey`); it keeps its sub-agents
  and opens the chat (`Teams.paneChats`, #731). Opened from Home, the chat marks the pane's own Done
  looked at too (`PocketState.row`). The chat is no second row (`Cockpit.chats`, `Cockpit.raised`).
- **Done is the phone's own.** bots-dsh words a chat blocked, working or idle, never done. The phone
  remembers what it saw of each chat between readings (`ChatWatch`): a chat that goes quiet after
  being seen blocked or working is Done, until it is looked at (`Cockpit.seenKey`, with the phone's
  own turn count) or starts again. A chat first seen quiet is idle, and so is one the phone left
  while it was blocked or working (bots-dsh lists a chat no phone watches as idle, so that quiet is
  no finish; seen active again, the turn goes on). The Done line is the receipt of
  the request the open chat saw settled ("Answered on the phone (Pixel): Allow"), kept with that
  turn. All of it in memory only, like the chats ([privacy](../privacy.md)).
- **Read only says so.** A blocked chat on a machine whose bridge takes no phone writes (`dshWrite`
  false in the last listing's hello) says "Read only on the phone: answer on the computer" on its
  row; the chat it opens says the same on its bottom line (#731). bots-dsh's own "Answer on the
  computer" (its socket takes no writes) stays as the line.
- **Not shown is no row.** A chat listed `shown: false` opens nothing (Team says "Show in Automagik
  first"), so Home neither lists nor counts it.
- Projects and tasks (Code) stay the terminals': a chat has no folder.

## Current state

- `Cockpit.chats`, `Cockpit.raised`, `Cockpit.addressLabel`, `Cockpit.READ_ONLY`:
  `android/app/src/main/java/ai/namastex/automagik/Cockpit.kt`. `Projects.pulse` takes the
  chats. `ChatWatch`: `android/app/src/main/java/ai/namastex/automagik/ChatWatch.kt`.
  `Chat.Terminal` carries the row's `kind`, `msg` and `turn`; `Chat.withStatus` and `Chat.asked` put
  the open chat's state and card text on its row; `Chat.receiptLine` reads a closed card's receipt.
- `PocketViewModel`: `chatWatch`, `botWrites`; `loadBotChats` feeds the watch and the writes flag,
  `chatEvent` the open chat's status, `chatSubscribe` the receipts; `markSeen` marks a chat's Done.
- Tested in `HomeChatsTest`, one test per acceptance row of #732.

## Open questions

1. bots-dsh's `chat.list` serves a live status only for a Bot some phone is watching
   (`pocket-chat.js` `list`: the followed entry's status, else `statusOf(null)`, idle). With that,
   a chat nobody has open always reads idle, so Home can count it only while some phone has it
   open (the watch does not take the quiet after leaving as a finish). The fix is on the bots-dsh
   side: `list` reads each unwatched Bot's state from DSH, and, with writes on, puts the open
   request's text in `msg`. The lead decides where it lands.
2. The question's text reaches an unopened chat's row only when bots-dsh puts it in the row's
   `msg` (see 1); until then the row says the kind.
3. Team's bubble keeps bots-dsh's word (never Done) for a DSH-only main bot. Whether it should
   take the watch's word too: the owner.

## Related

- [Team bubbles](team-bubbles.md), [DSH chat resume](dsh-chat-resume.md), [Four tabs](four-tabs.md).
