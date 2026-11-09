---
title: "A DSH chat reconnects by itself; the phone needs no dedupe flag"
type: decision
status: Implemented
created: 2026-11-08
updated: 2026-11-08
tags: [decisions, chat, bots]
---
# A DSH chat reconnects by itself; the phone needs no dedupe flag

A Main Bot's DSH chat (`dsh:<sessionId>`) survives a bots-dsh restart: the phone connects again by
itself and shows the same chat. Issue #731.

## Decision

- **Resume.** When the bridge loses the bots-dsh socket, every DSH subscription gets
  `{type: "gone", reason: "unavailable"}` (`herdr/mods/pocket-link/bridge/dsh-source.mjs`
  `onClose`); a bots-dsh shutdown sends `closed`, a Bot that moved to a new Session `moved`, a
  follow that ended `ended`. On a DSH chat these keep the chat (`Chat.RESUMABLE`): the open card
  closes (it is never answered blind), a send in flight becomes "Maybe not sent", and the phone
  opens a new chat connection after 1, 2, 4, 8, 15 and 30 s (`Chat.RESUME_DELAYS_MS`), then shows
  Reconnect. A new connection makes the bridge greet the socket again, so `dshWrite` is read afresh.
  The `dsh:` terminal names the Bot, so the new subscribe follows its current Session.
- **Refusals end the chat with a reason.** `not-shown`, `not-found` and `too-many` from the socket's
  subscribe end it, in words; a terminal's chat that went away ends as before.
- **No `dedupe` on the phone.** bots-dsh's hello says `dedupe: "log"`; the bridge does not forward
  it, and the phone does not need it. Retry always sends the same id. bots-dsh answers a known id
  `sent` with `repeat: true` from its memory, from the Session log it follows, and DSH skips a
  prompt whose request id is in its inbox or log, so a Retry after a bots-dsh restart prompts once.
  The flag could only gate a "this may send it twice" warning that this makes false. A phone
  restart loses its unknown messages (they live in memory only, [privacy](../privacy.md)), so
  nothing is retried after one. If a socket ever answers without log dedupe, forwarding the flag
  and warning before Retry is the change; the bridge protocol stays as it is until then.
- **Never silent.** A chat without a message box always says why on its bottom line
  (`ChatActions.whyNoSend`): read only (Pocket Link or Automagik takes no phone writes), ended,
  offline, reconnecting or not connected. A send the chat cannot take shows that line as a notice.

## Current state

- `Chat.reduce` (`gone`), `Chat.resumeDelayMs`, `ChatActions.whyNoSend`, `Chat.withStatus`:
  `android/app/src/main/java/ai/namastex/automagik/Chat.kt`. Tested in `ChatTest`.
- `PocketViewModel.resumeLater` and `chatEvent` drive the reconnects.

## Related

- [Team bubbles](team-bubbles.md), RFC 0015 (writes amendment).
- [A card that closed while the phone was away comes back as a receipt](chat-receipts-on-reconnect.md)
