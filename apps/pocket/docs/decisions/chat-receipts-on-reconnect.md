---
title: "A card that closed while the phone was away comes back as a receipt"
type: decision
status: Implemented
created: 2026-11-08
updated: 2026-11-08
tags: [decisions, chat, bots]
---
# A card that closed while the phone was away comes back as a receipt

A DSH chat's approval or question card that is answered while the phone's link is down used to
vanish on reconnect with no word. Now the reconnect shows one receipt card per request that
settled meanwhile, from bots-dsh's `settled[]` in the `subscribe` snapshot
([RFC 0015](../../../docs/rfcs/0015-live-chat-projection.md), "Settled requests on reconnect").
Issue #733, left over from #680.

## Decision

- **A settled entry is only ever a receipt.** `settled[]` carries `{id, by, name?, outcome, at}`
  (bots-dsh `pocket-chat.js` `hold`, 16 per Session). The phone never makes a card from it: the
  snapshot's `approval` and `question` alone open cards, and an entry for the card the snapshot
  shows open is ignored. The receipt names the Bot, the kind of card, when it settled (bots-dsh's
  clock), what the card asked when the phone had shown it, and how it ended as the entry says,
  never more ("Answered on the computer while you were away: Allow", "No longer needed").
- **Receipted once.** The phone keeps the ids it knows ended (`Chat.State.done`, 64): closed in
  view, receipted, or settled before the chat was first opened. The first snapshot of a chat
  takes `settled[]` as history and shows nothing; every later snapshot is a reconnect, and an
  entry the phone has not seen end gets one receipt, however many reconnects or `slow`
  resubscribes follow. Dismissing removes the receipt; its id stays known, so it does not come
  back. At most 16 receipts stay (oldest dropped), all in memory, dropped with the chat
  ([privacy](../privacy.md)).
- **No entry, no outcome.** A card the phone had open that is neither open nor in `settled[]`
  on reconnect (older than the 16 kept, or bots-dsh restarted) closes as "Closed while you were
  away", with no outcome claimed. The cards the phone showed (`Chat.State.cards`), its receipts
  and the known ids are carried across the reconnect (`Chat.carry`), as the unknown messages are.
- **Nothing added to the bridge or bots-dsh.** `settled[]` is used as it is; the kind of a card
  the phone never saw is read from bots-dsh's row id (`…#approval-<call>`, `…#question-<call>`).
- **No receipt for a finished turn (decided, not left out).** `settled[]` carries answered
  requests only (approvals and questions), so a turn that finished while the phone was away shows
  as the chat's idle status line and gets no receipt. A turn-finished receipt would need something
  the snapshot does not carry today; it is a follow-up, not part of this change.
- **"Away" is the link dropping while the chat screen stays open** (the screen off, the app in
  the background, Pocket Link or bots-dsh restarting). Leaving the chat drops its state, receipts
  included, as [privacy](../privacy.md) says; coming back to it later is a first snapshot again.

## Current state

- `Chat.reduce` (`snapshot`, `approval`, `question`), `Chat.carry`, `Chat.dismissReceipt`,
  `Chat.receiptText`: `android/app/src/main/java/ai/namastex/automagik/Chat.kt`. Tested in
  `ChatTest` (one test per acceptance row of #733).
- `PocketViewModel.openChat` carries the state; `dismissReceipt` dismisses; `chatSubscribe` puts
  the newest settled receipt on Home's Done line. `ChatScreen.ReceiptCard` draws it.

## Related

- [A DSH chat reconnects by itself](dsh-chat-resume.md)
- [Home counts the Bots' chats with the terminals](home-bot-chats.md)
