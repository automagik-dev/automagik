# RFC 0009: Personal customization

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | after 2. One message box (proposed name: Make it yours) |
| Lanes | plugin (3.N.P), desktop (3.N) for the window shot |
| Created | 2026-10-30 |

## Summary

Anyone can change how Automagik looks and where its pieces sit, on the fly, by asking a Bot or
a Genie. Changes are personal files in one folder. They apply live, with no rebuild, no restart
and no new version. A reset always works.

## Motivation

People want small changes that no release should impose on everyone: the composer's ＋ next to
the text instead of in the controls row, or the Live rail inside a sidebar section instead of a
bar of its own. Today each one needs a code change and a release. Herdr's desktop app shows
another way (Apache-2.0): its interface is files, the app redraws from them while it runs, and
it writes a guide into that folder so an agent can make the change when asked. This RFC adapts
that idea to Automagik, whose interface is DSH's React web UI plus our plugin clients.

## Design

### The customization home

`<Automagik home>/custom/`, by default `~/.automagik/custom/`:

| File | What it decides |
|---|---|
| `theme.json` | clay tokens: colors, radii, shadows, fonts |
| `layout.json` | placement of our own pieces: where the composer's ＋ goes, which strips and bars show, the order and position of sidebar sections and of the Live rail |
| `keys.json` | key bindings for our own commands |
| `styles.css` | a user stylesheet, applied in its own layer |
| `mods/<name>/` | small client modules (later delivery, see below) |
| `defaults/` | the shipped versions, read-only |
| `AGENTS.md`, `*.schema.json`, `automagik.d.ts` | the agent guide, rewritten on every start |

`layout.json` only places pieces we own. It does not reach into DSH's own components.

### Hot apply

- The host watches the folder. When a file changes, it validates it and pushes a new revision
  over the plugin's existing authenticated route.
- The client re-applies theme, CSS and layout in place. No page reload, no DSH restart, and the
  plugin is not rebuilt.
- A file that fails to parse or validate is not applied. The last good version stays, and an
  error is written to `<name>.error`. Settings lists every current error.

### Shipped defaults

- `defaults/` is written by Automagik on every start and is read-only.
- To change one, clone it into the folder and edit the copy. Clones are never updated.
- If a shipped file was edited anyway, the next start moves it to `<name>-edited`, restores the
  shipped one, and shows a notice.

### Escape hatch

Three ways back, none of which can be customized away:

- a key chord, which sets the current files aside as `<name>.reset-<time>` and reloads defaults;
- starting with `?safe`, which loads no customization for that session;
- "Reset customizations" in Settings.

The approval card, the reset button and the error list are protected pieces: `layout.json`
cannot move or hide them, and `styles.css` does not apply to them.

### By asking

- On every start Automagik writes `AGENTS.md`, the JSON schemas and `automagik.d.ts` into the
  folder. The guide explains each file, the escape hatch and the clone rule.
- A built-in "Customize" skill lets any Bot or Genie edit the files when the user asks. It runs
  `check`, which validates the files and reports errors, and `shot`, which captures the window
  so the agent can look at the result.
- The desktop app captures its own window. On a web instance there is no `shot` yet.

### Mods (later)

`mods/<name>/` holds client modules that register through our existing extension points:
composer packs (`registerComposerPack`), navigation, header buttons, Bot settings, chat
suggestions and tool cards. Mods are code, so they come in their own delivery, gated.

## Contracts introduced

- The folder `<Automagik home>/custom/` and its file names. Compatibility: new; an install with
  no folder looks exactly as today.
- File schemas, each with a `version` field. A newer app reads older versions; an unknown
  newer version is not applied and is reported.
- Skill name `customize`, and the `check` and `shot` actions. New.
- The `?safe` start and the reset chord. New.

## Threat model

- **Data files.** Theme, layout, keys and CSS are data. They cannot run code. Two risks remain:
  a stylesheet that loads remote content, and one that disguises a control. So `check` refuses
  remote URLs in `styles.css` and the client strips them, and protected pieces ignore the
  stylesheet and the layout.
- **Who edits.** The owner, or a Bot or Genie the owner asked. Writes to the folder go through
  the Bot's level, as any file write does.
- **Mods.** JS mods run with the page's full power: they can do anything the signed-in user
  can. They stay out of the first deliveries. When they come, they are off by default, each
  one is turned on by the owner's click in Settings, and a Bot can draft one but not turn it on.
- **Web instances.** Customizations are per user and never shared with other users.
- **Undo.** The escape hatch above. Deleting the folder returns everything to the defaults.

## Deliveries

1. **theme.json and styles.css hot apply, with the escape hatch.** Lane: plugin. Check: an edit
   applies with no reload; a broken file keeps the last good look and shows its error; the chord,
   `?safe` and the Settings button each restore the defaults. Rollback: revert; files stay
   unused on disk.
2. **layout.json for our own pieces.** Composer ＋ position and sidebar order first. Lane:
   plugin. Check: both owner examples (＋ beside the text, Live rail inside a sidebar section)
   apply live, and protected pieces cannot be hidden. Rollback: revert.
3. **Agent guide and Customize skill with `check`.** Lane: plugin. Check: asked in plain words,
   a Bot moves the ＋ and `check` passes. Rollback: revert.
4. **Window `shot`.** Lane: desktop. Check: the skill gets a PNG of the current window.
   Rollback: the next release drops it; the skill works without it.
5. **JS mods, gated.** Lane: plugin. Not scheduled until deliveries 1-4 have shipped. Check: a
   mod registers a composer pack, is off until the owner turns it on, and a broken mod keeps
   the page working. Rollback: revert; mods are ignored.

## Open questions

1. **Sync customizations across devices?** Recommended: no. Keep them local to each install.
2. **May Bots edit them without asking?** Recommended: no. Each change shows a confirmation
   card with a before/after summary, and applies only after the owner's click.
3. **Which key chord?** Recommended: Ctrl+Alt+Shift+Escape, reserved and never rebindable.
4. **Does `styles.css` reach DSH's own UI?** Recommended: yes, the whole page except the
   protected pieces, and the guide says DSH's class names may change between versions.

## Links

- [0004](0004-composer-chat-kinds.md) composer pieces that `layout.json` places
- [0008](0008-platform-and-web-instances.md) web instances
- Herdr app layouts and mods (Apache-2.0), the reference design
