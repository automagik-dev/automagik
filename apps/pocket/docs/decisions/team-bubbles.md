---
title: "Team: one bubble per project, keyed by registry bot id"
type: decision
status: Implemented
created: 2026-11-07
updated: 2026-11-07
pr: "automagik-dev/automagik#674"
tags: [decisions, teams, bots, chat]
---
# Team: one bubble per project, keyed by registry bot id

Team shows one bubble per project: the project's main bot, with its pet, its needs-you mark and
its last line. A tap opens that bot's chat. The bot list, the needs-you deck and the progress strip
are gone from Team ([Four tabs](four-tabs.md): Home has needs-you).

## Decision

- Owner, 2026-11-07 (wish `pocket-four-tabs`, Group 2): one bubble per project, the project's
  orchestration chat on tap. Structure only; the bubble keeps the bot row's current look.
- A project is what Team already groups by: the spaces of one repository on one machine (the
  Space Row key). The main bot is the registry's `kind: "main"` bot (RFC 0014 `:145`). With none,
  the bubble says "No main bot in this project", the desktop's words (`create.js:991`).
- One identity: the bot's `dsh:` chat on that machine and its pane labelled `bot=<id>` are the
  same bot, by registry id, so they make one bubble. A chat is the bot's by the `registryId`
  bots-dsh serves on its row; a row without one only when it is `dsh:<id>` itself. The chat wins
  the tap (a universal or DSH bot, read only), under its own `dsh:<sessionId>`; with no chat, the
  pane's projected chat (the terminal's Chat tab).
- A `dsh:` chat listed `shown: false` (a project with no yes in `shown[]`, RFC 0015 `:751-755`)
  says "Show in Automagik first" and opens nothing. A row with no `shown` field is shown.
- A `dsh:` chat that matches no main bot gets no bubble; it stays in Settings, Bot chats.

## Registry id match (#672)

Closed by [#672](https://github.com/automagik-dev/automagik/issues/672): a `dsh:` row's id is a
DSH Session id, not the Herdr registry id, so bots-dsh serves the registry Bot's `b-...` id beside
it as `registryId` (automagik-dev/automagik#684) and Team matches on that, on the same machine
only. A row whose `registryId` is null (bots-dsh found no registry Bot) or absent (a bots-dsh
before #684) keeps the old match, so a universal bot's bubble still opens its terminal chat.

## Current state

- `Teams.bubbles`, `Teams.lineOf`, `Teams.Opens`:
  `android/app/src/main/java/ai/namastex/automagik/Teams.kt`. Tested in `TeamsTest`.
- `TeamsScreen` and `BubbleRow`: `android/app/src/main/java/ai/namastex/automagik/TeamsScreen.kt`.
- The `dsh:` chat list is read every 30 s while Team shows (`rememberDshChats`).

## Related

- [Four tabs](four-tabs.md), [Teams v1](teams-v1.md).
