---
title: "The phone finds a space's Space Row project itself"
type: decision
status: Proposed
created: 2026-11-03
updated: 2026-11-03
pr: ""
tags: [decisions, space-row, meter, pocket-link]
---
# The phone finds a space's Space Row project itself

Pocket maps a space to its `space.projects` entry with the git answer it already reads, and reads
bot names from the project's `.herdr/bots.json` itself. Pocket Link passes the `herdr-meter` doc
through unchanged and adds nothing.

## Decision

- Proposed by a coding agent, 2026-11-03, for the Pocket maintainer and the owner to accept or
  reverse. The task said Pocket Link should resolve each space's project key and bot names, because "the phone can't
  run git" and "can't read `.herdr/bots.json`". The phone already does both over herdr-core:
  - It runs `git rev-parse --path-format=absolute --show-toplevel --git-common-dir` on every
    space (`android/app/src/main/java/ai/namastex/automagik/Git.kt:25`). git prints the common dir
    as a real path (symlinks resolved), so its parent is the rules' project key.
  - It already reads Herdr desktop files with `file.read`, which takes `on` for other machines
    (`PocketViewModel.kt:652`, `hc file read --on`).
- Doing it on the phone needs no new Pocket Link output, so no new contract. Pocket Link pipes
  `hc connect` byte for byte (`desktop/pocket-link/mods/pocket-link/bridge/bridge.mjs:124`).

## Current state

- Project key: `SpaceFeed.projectKey` (`android/app/src/main/java/ai/namastex/automagik/SpaceFeed.kt:51`).
  Rows: `Sidebar.kt:107`; nested worktree rows get no line 2.
- Bot names: `readBots` (`PocketViewModel.kt:564`), only for machines whose doc has a Space Row feed,
  after each meter read and when a new repository's git answer arrives.
- Each machine's spaces read that machine's own `herdr-meter` doc (`PocketViewModel.kt:553`).

## Open questions

1. Does the owner accept this in place of a Pocket Link resolver? — owner.
2. Bots file version: the phone reads `bots[].name` and `categories[].title` and ignores
   `version`. Should it refuse files whose version isn't 1, as the desktop does? — the desktop
   rules' author.
3. This adds a row to [privacy](../privacy.md) (a read of `.herdr/bots.json`). Is a decision note
   enough, or does it need an RFC? — owner.

## Related

- [Privacy](../privacy.md)
- Rendering rules: automagik-herdr `docs/space-row-rendering.md`.
