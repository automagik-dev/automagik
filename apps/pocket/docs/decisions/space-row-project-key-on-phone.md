---
title: "The phone finds a space's Space Row project itself"
type: decision
status: Accepted
created: 2026-11-03
updated: 2026-11-03
pr: "#45"
tags: [decisions, space-row, meter, pocket-link]
---
# The phone finds a space's Space Row project itself

Pocket maps a space to its `space.projects` entry with the git answer it already reads, and reads
bot names from the project's `.herdr/bots.json` itself. Pocket Link passes the `herdr-meter` doc
through unchanged and adds nothing.

## Decision

- Owner, 2026-11-03: accepted. The phone resolves the project key and reads `.herdr/bots.json`
  itself, re-reading it every 5 minutes with the meter, as built. No Pocket Link change.
- Owner, 2026-11-03: a decision note is enough, no RFC; the [privacy](../privacy.md) row ships in
  the same pull request (#45).
- Why it was proposed (by a coding agent, 2026-11-03): the task said Pocket Link should resolve
  each space's project key and bot names, because "the phone can't run git" and "can't read
  `.herdr/bots.json`". The phone already does both over herdr-core:
  - It runs `git rev-parse --path-format=absolute --show-toplevel --git-common-dir` on every
    space (`android/app/src/main/java/ai/namastex/automagik/Git.kt:25`). git prints the common dir
    as a real path (symlinks resolved), so its parent is the rules' project key.
  - It already reads Herdr desktop files with `file.read`, which takes `on` for other machines
    (`PocketViewModel.kt:657`, `hc file read --on`).
- Doing it on the phone needs no new Pocket Link output, so no new contract. Pocket Link pipes
  `hc connect` byte for byte (`desktop/pocket-link/mods/pocket-link/bridge/bridge.mjs:124`).

## Current state

- Project key: `SpaceFeed.projectKey` (`android/app/src/main/java/ai/namastex/automagik/SpaceFeed.kt:51`).
  Rows: `Sidebar.kt:107`; nested worktree rows get no line 2.
- Bot names: `readBots` (`PocketViewModel.kt:568`), only for machines whose doc has a Space Row feed,
  after each meter read (every 5 minutes) and once for a project first seen between reads; a
  project with no file is stored with empty names, so it isn't re-read until the next meter read.
- Each machine's spaces read that machine's own `herdr-meter` doc (`PocketViewModel.kt:555`).

## Open questions

1. Bots file version: the phone reads `bots[].name` and `categories[].title` and ignores
   `version`. Should it refuse files whose version isn't 1, as the desktop does? — the desktop
   rules' author (asked 2026-11-03).

## Related

- [Privacy](../privacy.md)
- Rendering rules: automagik-herdr `docs/space-row-rendering.md`.
