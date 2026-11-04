# am-footer

The sidebar's footer as a rail of tabs instead of a stack of rows — robot **Bots** (first), puzzle
**Mods**, clock **Automations**, layers **Accounts** (while am-quota is on), gear **Settings**, plus **Add machine** — and the brand bar above it. Derived from
Herdr's shipped `workspace-chrome` 0.1.11.

## What you see

A 42 px strip at the bottom of the sidebar, `chrome` background with a top border: four 28 × 28
icon buttons, `selected` when their view is open, `muted` otherwise, hover filling them. Collapsed
into the rail, the same icons; Herdr's update dot still rides the gear. Above, the unchanged brand
row (Herdr mark, search, sidebar toggle) with the traffic-light padding macOS needs.

## How it behaves

- **Bots** (tab id `bots`, first in the rail): shown while `<app home>/mods/am-sidebar/mod.json`
  exists (looked up with Pocket Link's, every 30 s). It opens a popup (this mod, props
  `{botsMenu: true}`; Esc closes it) with **New bot** and **Bot settings**: `openOverlay` of
  `am-sidebar` as a modal dialog with `props.form` `"create"` (1000 × 840) or `"pick"` (560 ×
  0.85). While the sidebar's shared `bots.defined` is `false` (no bot on this computer) the popup
  shows only New bot. No bot code lives here: the forms are the sidebar mod's own.
- **Mods**: focuses the tab already showing the mod manager (`panes()` → `mod === "am-mods"`),
  else `tab.new {name: "Mods", mod: "am-mods"}`.
- **Work** (tab id `work`, after Mods; tooltip "Open Automagik"): the way back to the Automagik
  app (RFC 0013 delivery 6). `work.js` hands `automagik://open` to the OS's link opener through
  `exec` with argv: `open` (macOS), `cmd /c start "" <url>` (Windows), `xdg-open` (else). An
  opener that can't start or exits non-zero posts one notice, "Automagik isn't installed or
  didn't register automagik://"; never an exception. `workUrl()` is where delivery 8 (RFC 0014)
  adds `?bot=<id>`.
- **Automations** (clock icon, the am-automations mod) and **Accounts** (layers icon, the am-quota
  mod), `PANELS` in `main.js`: each shown only while `<app home>/mods/<mod>/mod.json` exists. The
  Mods panel turns a mod off by moving its folder to `mods-disabled/`, and then there is no tab at
  all (not a dimmed one). Looked up on the 30 s look and again on a `watchFolder` batch under
  `mods/`. A press toggles the mod's block (`automations-panel`, `am-quota-panel`) when the shown
  layout has one (`layout.toggle`), else opens the mod as a popup (`PANEL_POPUP`: 320 px wide,
  0.6 of the window high). The tab is `selected` only while that block is in the layout and not
  hidden: a block that isn't there is never active. While a mod is off, a block of it left
  showing is hidden (`layout.hide`), so the panel does not outlive the mod.
- **Settings** / **Add machine**: `app.settings`, `mod.open:machine-add`.
- **Other mods' buttons** (`contributions.js`): a mod's `mod.json` can declare
  `automagik.footer` entries (`id`, `label`, `command`, optional `args`, `icon`, `badge`; README,
  "Add a sidebar button from your mod"). The footer lists `<app home>/mods` with `find` (as
  am-mods does), reads each `mod.json`, keeps at most 4 valid entries in mod-name order and draws
  them after Accounts and Pocket Link, before the rule, in their own group that shrinks and clips
  first (`min_w(0)`, `overflow_hidden`): same tab, same hover name, `run(command, args)`
  on press, and a count while `shared(badge)` is a number above 0. A missing or invalid icon draws
  `circle.svg`. Rescanned on the 30 s look and on a `watchFolder` batch that touches a `mod.json`, a
  mod folder or an SVG (the batch runs the whole look, so Bots and Accounts follow too); Pocket Link's folder is never read by this scan.
- **Rail**: follows the sidebar's width (`layout()`'s `sidebar.size.px < 160`), not a flag; labels
  are tooltips, so a fifth tab costs no height.

## Built from

`mods/am-footer/main.js`, `mod.json` (`place: none`; the lineage is this file's, not a `cloned_from`), `puzzle.svg`
(Lucide's puzzle, `stroke-width 2`, `currentColor`), Herdr's other icons reused from
`mods/workspace-chrome/`. Herdr API: `theme`, `run`, `props`, `window`, `layout`, `panes`,
`updates`, `shared`, `setShared`, `readTextFile`, `appHome`, `exec`, `notify`, `watchFolder`,
`openOverlay`, `closeOverlay`. `briefcase.svg` is Lucide's briefcase, the Work tab's icon. `circle.svg` is Lucide's circle, the contributed buttons' fallback glyph.
`bot.svg` is Lucide's bot, as Herdr ships it in `frame/welcome/`. Layout: the `sidebar-footer` block's `content.mod` is
`am-footer` with `props: {footer: true}`, and its `size.px` is 42.

## Watch out

- **Clone, not extension**: Herdr's updates to `workspace-chrome` don't reach it; only the footer
  copy is replaced by this mod — the brand block still uses Herdr's own.
- The footer's height is part of the layout (`size.px: 42`); a fifth tab still fits, a bigger row
  would not. Width too: every built-in tab plus 4 contributed ones (about 340 px) is wider than the
  268 px sidebar; the contributed group clips, the built-in tabs keep their place.
- The pack's layout names neither panel block. Herdr shows plain Herdr instead of a layout that
  names a mod missing from `mods/` ("needs mods that aren't here. Showing Herdr instead."), even
  in a hidden block, and both mods can be off (am-quota ships off). `test/am-footer.test.mjs`
  fails if the layout names a mod in `OFF_BY_DEFAULT` or either panel.

## Done when

`herdr-app check mods/am-footer` passes; the footer shows Bots first, then the other tabs, in one row; Bots' popup opens the
Create form and the bot list, and with no bot defined offers New bot alone; Mods opens
or focuses the Mods tab; Work brings the Automagik app forward; the clock and Accounts tabs open their panel, and show only while their mod is on.
