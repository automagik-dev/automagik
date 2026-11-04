---
title: "Teams tab v1: home tab, Room cache, Genie bundled at build time"
type: decision
status: Accepted
created: 2026-11-03
updated: 2026-11-03
pr: "automagik-dev/automagik#242"
tags: [decisions, teams, pets, room, bots]
---
# Teams tab v1: home tab, Room cache, Genie bundled at build time

Pocket gets a Teams tab: one circle per Herdr space (a project), the project's bots with their pets
in the pose for their state, a needs-you swipe deck and a small progress strip. Chat, dictation,
attachments and voice come in a later version.

## Decision

All taken by the Pocket orchestrator on 2026-11-03, from the owner's answers.

- **The app opens on Teams, in its All view.** Back from any other tab returns to Teams
  (`android/app/src/main/java/ai/namastex/automagik/Nav.kt`).
- **Local cache: Room (SQLite)**, with KSP to generate it. Room's DAO tests run under Robolectric,
  because the gate runs unit tests only.
- **Genie (`genie-clay`) is bundled at build time** from the Bot team's one pet source,
  `apps/bots-dsh/src/host/pets/genie-clay`, by the `bundleGeniePet` task
  (`android/app/build.gradle.kts`). Nothing is copied into git.
  - Trade-off: `scripts/lane.ts` doesn't watch that folder, so a change to Genie's art reaches
    phones with the next Pocket release, not by itself.
  - `ci.yml` now runs Pocket's build and tests when that folder, `pet.js` or `pet-poses.js` changes.
- **One project is one space.** The project's icon is its space's Herdr icon, else its letter. Two
  spaces that map to one project key (a worktree opened as a space of its own) are not expected.
  If it happens, the first space in Herdr's order gives the name and icon, with no extra UI.
- **A bot's own pet is fetched from the desktop** (`~/.automagik/bots/pets/<id>/`, RFC 0014) and
  kept on the phone. Until then, and for bots on other machines, the bot wears Genie. The phone
  never bakes a pet.

## Current state

- Model, pure and unit-tested: `Teams.kt`.
  - Poses are a port of the desktop's `herdr/mods/am-sidebar/rows.js` `poseOf`.
  - The pet rows mirror `STATE_ROWS` and `EVENT_ROWS` in `apps/bots-dsh/src/client/pet.js`.
    `TeamsTest` parses that file and `pet-poses.js`, so the two can't drift apart unnoticed.
- The bot registry sits behind one interface, `Teams.BotRegistry`. Today it reads
  `.herdr/bots.json`. The shared registry (RFC 0014) is a new reader.
- Icons and colours come from `shared.json`: `am.sidebar.icons` and `am.space.colors`, else the
  keys from before the pack's rename. Images are copied from Herdr's `space-icons/` folder.
- Cache: `TeamsDb.kt`, written only by `TeamsSync`.
  - Each machine counts on its own: a saved machine's own core and every machine it links to
    (`Teams.scope`). One counts as read once this session has read its terminals and its spaces,
    and git has answered for each of its spaces (`Teams.ready`, or 30 s after its spaces were
    first read). Its rows are then replaced, even with no project left, while a machine still
    being read (or one whose layout timed out) keeps its cached rows. Nothing is written when
    the rows didn't change.
  - Removing a machine purges its rows, and a reading taken before the removal never writes them
    back. Once a saved machine's own core is read, the rows of machines it no longer links to go.
    Cached rows of a machine that is saved but not read show as last known. They can't be opened
    or answered, and the deck says "Offline: can't answer".
  - A bot celebrates a merge only when its own feed newly lists it. Each feed keeps its own
    baseline.
- Reads (`HostBatch`): git for every folder of a machine is one `machine.exec`, as is every
  project registry there (re-read every 5 minutes). Linked machines are read at once, at most six
  (the core's own machine outside that pool), each time-boxed (layouts 8 s, batches 15 s remote
  and 20 s on the core's own machine); one that doesn't answer is given up for that pass after
  one wait. A refresh lands the core's own terminals, spaces, alerts and git at once; the linked
  layouts are read in the background, one reading at a time, each landing as it answers. Before,
  there was one call per folder and command, one machine after another. On a desktop with 19
  spaces on 7 machines that took about a minute (~280-320 calls); now it fills in within ~10 s
  (~50-70 calls, the refreshes meanwhile included).
- Strip, with "–" for a missing value:
  - **Tasks done:** the feed's `merges.n` (a rolling 24 h).
  - **Agent time:** the feed's `tasks[].bots[].work_min` (merged tasks only).
  - **Peak agents:** the most working bots the phone saw today, kept in Room. No other source
    exists.
- Celebration: a bot that newly appears in a feed's merged `tasks[].bots` jumps once.

## Open questions

- Spaces on a linked machine that is down don't show live; its cached rows stay, stale, until it
  is read again.

- Linked machines: their projects show the letter, and their bots wear Genie. Reading their
  `shared.json` and pets is not built.
- A bot with no stored look wears Genie. Herdr's own default look (`defaultLook` in
  `herdr/mods/am-sidebar/model.js`) is not ported.
