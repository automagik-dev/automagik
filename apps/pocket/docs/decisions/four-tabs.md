---
title: "Four tabs: Home, Team, Code, Settings"
type: decision
status: Implemented
created: 2026-11-07
updated: 2026-11-07
pr: ""
tags: [decisions, navigation, teams, home]
---
# Four tabs: Home, Team, Code, Settings

The bottom bar has four tabs, Home, Team, Code and Settings, and the app opens on Team. They
replace the five tabs and the Settings gear, and this note replaces [Teams v1](teams-v1.md)'s tab
list, its needs-you deck and its progress strip.

## Decision

- Owner, 2026-11-07 (relayed by t3q1, wish `pocket-four-tabs`, decision D3): the phone has four
  tabs. Team is the default; Home is the needs-you cockpit, with spend as a chip.
- Owner, 2026-11-07 (relayed by the Mobile Captain): this step changes the structure only. The
  bar keeps its current look; no mobile UX guidance is applied until the owner names the guidance.
- What moved, so nothing is lost:

  | Before | Now |
  |---|---|
  | Today | **Home**, unchanged: Needs you, then Done, with Working and Idle under **Everything else**; the counts and the spend tile on top; the needs-you badge |
  | Teams | **Team**, unchanged for now, still the default and where Back goes |
  | Projects, Tasks | **Code**, three views picked with pills: By repository, Spaces, Tasks |
  | Machines, the gear | **Settings**, with the machines and pairing first |

- Replaces in [Teams v1](teams-v1.md):
  - its tab list (five tabs plus a gear);
  - the needs-you deck and the progress strip on Teams. Home takes needs-you. They still show on
    Team until the Team bubbles (wish group 2) remove them.

## Current state

- Tabs, the default and Back: `android/app/src/main/java/ai/namastex/automagik/Nav.kt`
  (`TABS`, `HOME = TEAM`, `back`, `barShown`, `badge`). Tested in `NavTest`.
- The bar: `PocketTabs`, `android/app/src/main/java/ai/namastex/automagik/MainActivity.kt:251`.
  Home carries the agents that need you (Today's badge), Team the bots that need you.
- Home is `OverviewScreen` with no space (`MainActivity.kt:238`), the spend tile `SpendCount`
  (`MainActivity.kt:360`). `ProjectsTest.homeShowsTodaysCountsAndCarriesItsBadge` checks its counts.
- Code: `CodeScreen`, `android/app/src/main/java/ai/namastex/automagik/ProjectScreens.kt:41`.
- Settings: `SettingsScreen` starts with `MachinesSection`
  (`android/app/src/main/java/ai/namastex/automagik/Screens.kt:92`, `:162`). **+** in its top bar
  pairs a machine.

## Open questions

1. Which mobile UX guidance applies to the bar and the tabs (targets, safe areas, the keyboard)?
   — the owner.
2. Code as the desktop's Herdr window (a drawer tree, the terminal, Tasks as a filter) is wish
   group 3; until then Code keeps today's Projects and Tasks screens. — the Mobile Captain.

## Related

- [Teams v1](teams-v1.md), the tab list this replaces.
- [Using Automagik Pocket](../guides/using.md), "Tabs".
