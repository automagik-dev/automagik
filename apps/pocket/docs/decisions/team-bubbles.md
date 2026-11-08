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
- One identity: the bot's `dsh:<id>` chat on that machine and its pane labelled `bot=<id>` are the
  same bot, by registry id, so they make one bubble. The chat wins the tap (a universal or DSH
  bot, read only); with no chat, the pane's projected chat (the terminal's Chat tab).
- A `dsh:` chat listed `shown: false` (a project with no yes in `shown[]`, RFC 0015 `:751-755`)
  says "Show in Automagik first" and opens nothing. A row with no `shown` field is shown.
- A `dsh:` chat that matches no main bot gets no bubble; it stays in Settings, Bot chats.

## Known gap

The id bots-dsh serves today is a DSH Session id, not the Herdr registry id
([#672](https://github.com/automagik-dev/automagik/issues/672)). Until universal bots run under
their registry id, a bubble opens the main bot's terminal chat.

## Current state

- `Teams.bubbles`, `Teams.lineOf`, `Teams.Opens`:
  `android/app/src/main/java/ai/namastex/automagik/Teams.kt`. Tested in `TeamsTest`.
- `TeamsScreen` and `BubbleRow`: `android/app/src/main/java/ai/namastex/automagik/TeamsScreen.kt`.
- The `dsh:` chat list is read every 30 s while Team shows (`rememberDshChats`).

## Related

- [Four tabs](four-tabs.md), [Teams v1](teams-v1.md).
