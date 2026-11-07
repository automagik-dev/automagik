# Automagik Herdr

Autonomous teams of coding agents across harnesses (Claude Code, Codex, Antigravity, Kimi, Oh My Pi…)
with a main bot, captains and members, running in [Herdr](https://dev.herdr.app).

The pack lives in the [Automagik monorepo](https://github.com/automagik-dev/automagik) under
`herdr/`, and ships on its releases with its one version (`v3.x`): a release carries the pack
(`automagik-herdr-pack-<v>.tgz`) when `herdr/` changed since the release before. v0.14.x was the
last release line from the old `automagik-dev/automagik-herdr` repository.

<!-- hero: docs/hero.png, a sidebar screenshot with a team running -->

## Install

On macOS or Linux with Node 22.7 or later:

```bash
curl -fsSL https://raw.githubusercontent.com/automagik-dev/automagik/main/herdr/install.sh | bash
```

The installer checks Node and [Herdr](https://dev.herdr.app) (herdrdev's app, bundle id
`dev.herdr.app`; another app named Herdr, penso/herdr-gpui, is a different app and does not load this pack).
If Herdr is missing, it asks before running Herdr's own installer,
`curl -fsSL https://releases.herdr.dev/app/install.sh | sh`, which needs no root: on macOS (Apple
silicon) it puts `Herdr.app` in `~/Applications`; on Linux (x86_64 or ARM64) the app in
`~/.local/share/herdr-app`. Both link `herdr-app` into `~/.local/bin` and add `herdr-core` and
`hc` when there are none. Install Node from [nodejs.org](https://nodejs.org) first on Linux;
Node installation through Homebrew is offered only on macOS.
It reads the signed pack pointer (the `herdr-lane` release's `pack.json`,
checked against the keys the installer carries), downloads the pack it names
(`automagik-herdr-pack-<v>.tgz`: every mod below and the `automagik` layout; a desktop-only release
has none), checks it against the sha256 the pointer names before writing
anything, and installs every mod into `~/.config/herdr-app/mods/` as one unit. It links the
`automagik-herdr` command into `~/.local/bin`, merges the pack's keys where they are free (a key
you already use stays yours), points the mod manager at the pack's catalog (`herdr/catalog/` here), and runs
`herdr-app check` on each mod.

On a machine where Herdr has never opened, the installer leaves `keys.json` absent so
Herdr can create its native shortcuts, including terminal copy/paste. Open Herdr once,
then rerun the installer to add the pack's free shortcuts. The Mods button in the footer
works before its shortcut is added. Existing key files and personal bindings are preserved;
a `keys.json` that is a link (your own file) is left as it is, and the installer names the
pack's shortcuts for you to add there.

**What a release contains.** From v0.5.0, every release is one pack: `automagik-herdr-pack-<v>.tgz`
holds nine mod folders and one layout, and nothing else:

| Folder | What you get |
|---|---|
| `am-sidebar` | the sidebar: spaces, bots, workers, the Create form, the `automagik-herdr` command |
| `am-footer` | the footer rail (Bots, Mods, Automations, Accounts, Settings, Add machine) |
| `am-status` | the bottom status bar, with the pack's version and its update check |
| `am-tabs` | the tab bar |
| `am-new-menu` | the `+` menu (a space row's `+` and the tab bar's `+`) |
| `am-markdown` | the terminal's right-click menu with its Markdown files |
| `am-mods` | the mod manager (`⌘⇧M`) |
| `am-automations` | the automations panel; installed switched off (it needs the `herdr-automations` scheduler, which the pack does not install: the panel shows the command that does), turn it on in the Mods panel |
| `am-quota` | the Accounts panel (your own CLIProxyAPI's accounts); installed switched off, turn it on in the Mods panel |
| `../herdr-layout/layouts/automagik.json` | the layout that shows all of the above (its own folder: herdr.dev skips a pack folder that holds `layouts/`) |

Releases up to v0.4.x shipped `automagik-herdr-<v>.tgz` instead: the sidebar alone (under its
old folder name, see [From v0.2 to v0.4.x](#from-v02-to-v04x)), with no footer, tab bar, `+` menu, Markdown menu, mod manager, automations or quota. A
checksum and a version number don't tell the two apart; the folder list does. After installing,
the installer prints `Installed the pack <v> in <mods>: <folders>`; that list must name all
nine. To check an install later:

```bash
sed -n 's/^mods=//p' ~/.config/herdr-app/automagik-herdr/installed-by-install.sh
# am-automations,am-footer,am-markdown,am-mods,am-new-menu,am-quota,am-sidebar,am-status,am-tabs
```

It never touches anything it did not install:

- its record (`~/.config/herdr-app/automagik-herdr/installed-by-install.sh`) lists every folder
  it put in `mods/`, and only those are ever replaced, updated or rolled back;
- a folder of the same name that you installed yourself (say your own `am-footer`, or one under
  its name from before v0.5.0) is reported and left alone; `--adopt` takes it over, after moving it to
  `automagik-herdr/backup/<mod>-<date>/`, where it stays until `--uninstall` puts it back;
- the folders an install or update replaces are kept together in `automagik-herdr/.prev/`;
- each mod's `.state/`, other dot paths and `node_modules` move into its new copy (a linked
  `.state` stays a link), and Pocket Link (`mods/pocket-link`) is never read, written or moved
  (`--uninstall` only checks that it is there, to leave the usagemeter it shares).

It adds the `automagik` layout (Herdr's main layout with the whole pack in place) when you have
none, and replaces it only while it is the unchanged copy v0.2 to v0.4 shipped. The pack shows
only in a layout that names it, so while Herdr shows another one the installer asks before
switching (or prints the `herdr-app do layout.switch` command when it can't ask). A layout of
your own that shows the sidebar keeps its blocks: the installer only renames the pack mods it
names (from v0.4.x, below), lists the pack pieces it lacks and points at the pack's copy to take
their blocks from (see [Wiring](#wiring-your-layout)); or switch to the `automagik` layout. Running it again is safe.
Add options after `bash -s --`: `--yes` answers every question, `--version 3.58.0` installs that
Automagik release (one that carries the pack), `--adopt` takes over same-named mods,
`--uninstall` moves the pack out of `mods/`, puts back what it adopted and removes the layout if
the installer added it and you haven't changed it. It is refused, with nothing moved, while the
layout Herdr shows uses a pack mod or is that layout: switch layouts first (ctrl-shift-l, or
`herdr-app do layout.switch '{"name":"main"}'`). A layout inside a linked `layouts/` folder is
yours and stays. With Node, the layout and the folders leave through the installed pack's
updater (`update.mjs pack-out`, one move that fails undoes the others); without Node, or with an
older pack, through the installer itself, and it says which. If the updater stops partway, nothing
more moves and the record stays: it says which folders are already in the kept set and which are
still in place.

It also installs [usagemeter](https://github.com/automagik-dev/usagemeter) 0.3.0, the token
meter, to `~/.local/bin/usagemeter`: that release's build for your OS and architecture, checked against its
`SHA256SUMS` and against the sha256 the pack pins for that build, written atomically. It skips the download when that version is already there and
never replaces a newer one (Pocket Link installs the same binary). While Herdr is open, the
sidebar runs `usagemeter sync` 30 seconds after it loads and then every 10 minutes, one run at a
time; there is no LaunchAgent and no daemon. A dev build counts by its version number, so
`0.3.0-dev` stays, and a file there that reports no version is left with a warning.
`--no-usagemeter` leaves the binary alone, on install and on `--uninstall`; a failed install is
only a warning. `--uninstall` removes the binary only when this installer put it there, it is still
that version and Pocket Link is not installed; usagemeter's data is kept.

The phone reads each machine's own usage summary there (the `herdr-meter` document in that
machine's herdr-core), so usagemeter runs on every linked machine too: the installer installs the
same pinned build on each connected machine in `hc machine ls` (each machine downloads it and checks
both hashes itself; one that fails is a warning naming it), and the sidebar's 10-minute run syncs
each connected machine after this computer, one at a time. `automagik-herdr meter install
[--machine M]` does it again, for example for a machine linked later. `--usagemeter-local-only`
keeps it to this computer, and `--no-usagemeter` covers the linked machines too; both are
remembered.

**Updating to this release from an earlier one:** the update is run by the earlier release's
command, which has no usagemeter step, so run `automagik-herdr meter install` once afterwards. It
installs the pinned usagemeter on this computer and every connected linked machine, and records
that you asked for it. From then on, `automagik-herdr update` keeps them on the pack's pin within
what you chose. An earlier install's record is never read as a yes for the linked machines: if
that installer put usagemeter on this computer, `update` keeps it there only; if it recorded
nothing (an earlier `install.sh --no-usagemeter` recorded nothing), `update` installs nowhere and
prints that command instead. Either way the sidebar syncs only this computer until you run it. `--uninstall` removes it
from a linked machine only where the install record says the pack put it and it is still that
version.

### DSH as a Herdr agent (dsh-TUI)

DSH, the DeepSeek Harness, is an agent in Herdr's `+` menu through
[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI), in its own DSH profile. The installer asks
once; `--dsh-tui` takes it without asking and `--no-dsh-tui` leaves DSH alone. `--yes` never
installs it: a third-party package is opt-in by its own flag or an explicit answer. The command does
the same later:

```bash
automagik-herdr dsh-tui install   # install, or update to the pack's pin
automagik-herdr dsh-tui doctor    # what is there: dsh, the dsh-tui profile, the shim, the guide
automagik-herdr dsh-tui uninstall # the plugin and the shim away; sessions and state stay
```

- **DSH first.** It assumes `dsh` is on PATH (DSH Desktop, or `npm install -g @deepseek-ai/dsh`).
  With none, install prints one line saying how to get it and changes nothing. **herdr-app
  v0.1.13 or later** is what ships the built-in `dsh-tui` program entry this shim lights up.
- **The exact pin.** `@deepseek-harness-tui/dsh-tui` **0.19.0**, built for DSH 0.2.2-rc.1. The
  profile's `package.json` pins the exact version and its `pnpm-lock.yaml` must record the
  registry integrity this pack carries (`sha512-4TAP…`); an install that lands on another
  version or integrity fails and takes back what it added. The install records that *it* added
  the pin in `~/.dsh/profiles/dsh-tui/.automagik-herdr-dsh-tui.json`; a pin already there is the
  person's, and uninstall leaves it. A pin the pack did not record is never written over—not even
  at the pinned version—because `dsh plugin add` rewrites the person's lockfile: the install skips
  it and says how to remove it or hand it over. The record names the package and the version it
  set, so a pack-owned older pin is still the pack's after a bump.
- **Its own profile, `dsh-tui`.** `dsh plugin --profile dsh-tui add …` writes
  `<DSH_HOME>/profiles/dsh-tui` only (DSH's home is `~/.dsh` unless `DSH_HOME` says otherwise).
  That is the profile dsh-TUI creates for itself (`bin/dsh-tui.js`'s `PROFILE`, where
  `dsh-tui` and `dsh --profile dsh-tui` are equivalent), mounted as base + the TUI bundle.
  Never `tui`: a profile with that name can have been initialized from the web template, which
  boots the web app, and the web app rejects `--resume`, `-c` and `-p`. A `tui` profile an
  earlier pack release created is left alone (nothing uses it now): remove its pin with
  `dsh plugin --profile tui remove @deepseek-harness-tui/dsh-tui` if you want it gone. The
  reserved `desktop` profile, its settings and `~/.dsh/.credentials.yaml` are never written; the
  install checks their fingerprints after the plugin step and fails rather than claim success if
  DSH changed them. The install writes `package.json`, the lockfile and the pnpm workspace file;
  it never writes the profile's generated `cordis.yml` (DSH rewrites that root on every boot).
  Machine or sandbox settings belong in the profile's `cordis.patch.yml`, the documented user
  layer.
- **pnpm's release-age gate.** pnpm 11's `minimumReleaseAge` (1440 minutes by default) refuses a
  version published hours ago, so the profile's `pnpm-workspace.yaml` carries
  `minimumReleaseAgeExclude` for exactly `@deepseek-harness-tui/dsh-tui@0.19.0` — never the bare
  package name. Once that version is older than the profile's threshold, install/update removes
  that exact entry; uninstall removes it only for a pin this installer added. Other packages'
  entries are left alone.
- **The shim.** `~/.local/bin/dsh-tui` is a shell script that checks `dsh` is on PATH (a clear
  line and exit 127 when it isn't) and then runs `exec dsh --profile dsh-tui "$@"`, with the env
  it was started in. No separator of its own: DSH's launcher takes its own flags first and the
  first token it does not recognize starts the app's arguments, so `--resume <id>`, `-c` and
  `--continue` reach dsh-TUI. `--backend` is **not supported through the shim**: the package's
  own launcher maps it to `DSH_TUI_BACKEND`, but dsh passes it to the app, which reads it as
  prompt text. A literal `-- <text>` is not a safe escape for text that starts with a flag: DSH
  drops the bare `--`, so `-- --resume=<id>` resumes that session instead of sending text.
  Herdr's built-in `dsh-tui` program entry (its `programs.json`) checks that the first word
  resolves on its PATH, so the built-in DSH menu entry works with no per-user `programs.json`.
- **Provider keys (optional).** The shim sources an optional `0600` env file at
  `~/.dsh/deepseek.env` (or `$DSH_HOME/deepseek.env`) so panes and workers get provider keys set
  outside DSH; you can still use `/auth` or the credential store. Quote values so a space cannot
  change the assignment:

  ```sh
  # ~/.dsh/deepseek.env, mode 0600
  DEEPSEEK_API_KEY="your-key"
  OTHER_KEY='your-value'
  ```

  Only a readable regular file you own with **mode 0600 or stricter** (no group or other
  read/write), in a folder you own that is not group- or world-writable, with valid shell, is
  sourced; anything else is skipped with one fixed line.
  The shell's own syntax error (which can quote the offending line) is discarded, so the file's
  content or values never reach stderr. Checking and sourcing are separate opens, which is why
  the parent folder is checked too (another user who can write it could swap the file between
  them). The installer writes no secret.
- **Sandbox and permissions (`cordis.patch.yml`).** The installer writes no config and no policy.
  Settings belong in the profile's `cordis.patch.yml` (the documented user layer), never the
  generated `cordis.yml`, which DSH rewrites on every boot. A concrete example:

  ```yaml
  - id: sandbox-policy
    config:
      mode: workspace-write
      workspaceRoot: !!js process.cwd()
      additionalWritableRoots:
        - /path/to/main-checkout/.git   # replace with your checkout's .git
  - id: approval
    config:
      policy: never
  - id: permission
    config:
      defaultPreset: unattended
      presets:
        read-only:
          sandbox: read-only
          approval: ask
        workspace-write:
          sandbox: workspace-write
          approval: ask
        danger-full-access:
          sandbox: danger-full-access
          approval: never
        unattended:
          sandbox: workspace-write
          approval: never
  ```

  `defaultPreset` is only inferred when it is **unset**: the composed sandbox/approval defaults
  must then match one of `presets`; if they match none, `dsh-permission-presets` refuses boot
  ("composed sandbox and approval defaults match no preset; configure defaultPreset
  explicitly"). Setting `defaultPreset` names a configured preset instead (an unknown name also
  refuses boot). The `unattended` preset is workspace-write + approval never. Interactive
  dsh-TUI takes no permission, add-dir or approval flags (they become prompt text); the profile
  supplies them.
- **Automation.** dsh-TUI's `-p`/`run` automation exits 3 `ADAPTER_UNAVAILABLE` on DSH
  0.2.2-rc.1. Use `dsh --profile headless` for headless work.
- **PATH.** The doctor checks `~/.local/bin` on the PATH Herdr **panes** get (an interactive login
  shell's, the way herdr-core starts a program) and names the file to edit for that shell
  (`~/.zshrc`, `~/.bash_profile`, `~/.config/fish/config.fish`, `~/.profile`). Herdr's `+` menu
  checks its own PATH; restart Herdr after changing the file so its dot sees the shim too.
- **First launch.** Sign in in dsh-TUI with `/model` → **DeepSeek Account**, or `/auth`; a key
  already in DSH's credential store or `DEEPSEEK_API_KEY` in the environment works too. No key is
  stored by this installer and no BWS launcher ships. The four-step first-run guide is marked
  done before the first pane: the install writes dsh-TUI's own record
  `~/.dsh-tui/onboarding.json` with `{"completed": true, "version": 1}` (its `DATA_DIR`,
  `ONBOARDING_VERSION` in `lib/types/onboardingPrefs.js`) only when that file is absent, so a
  fresh pane starts clean and never blocks. A person completing the guide writes the same file;
  an existing one is left byte for byte, and `/setup` opens it later.
- **Sessions.** They land in DSH's home (usually `~/.dsh`) and appear in DSH Desktop's history
  after Desktop is quit and reopened: Desktop has no live refresh. One writer per session applies:
  don't continue the same session from Desktop and dsh-TUI at once.
- **Uninstall.** `dsh plugin --profile dsh-tui remove` takes out the pin this installer added, the
  release-age entry that came with it, and the shim (only when it is the pack's). A pin the person
  added, a foreign shim, a dangling link and DSH's sessions are left alone. `--uninstall` of the
  pack does the same while its command is still in place. `~/.dsh-tui` state and the `dsh-tui`
  profile stay.

### From v0.2 to v0.4.x

Rerun the one-liner above. Their own `automagik-herdr update` finds nothing newer, because the
pack ships under a new name. v0.5.0 also renames every mod folder (there are no aliases):

| Before v0.5.0 | From v0.5.0 |
|---|---|
| `spaces-agents` | `am-sidebar` |
| `sidebar-chrome` | `am-footer` |
| `auto-tabs` | `am-tabs` |
| `new-menu-tui` | `am-new-menu` |
| `md-menu` (with `markdown-browser`) | `am-markdown` |
| `mod-manager` | `am-mods` |
| `automations` | `am-automations` |
| `space-icon` | inside `am-sidebar` |

The installer:

- replaces the sidebar-only folder with `am-sidebar` (the old one is kept in
  `automagik-herdr/.prev/`, its `.state` carried over) and adds the other seven mods;
- replaces the `automagik` layout while it is the unchanged one those releases shipped;
- renames the pack mods your own layouts and `keys.json` name, each file backed up first in
  `automagik-herdr/backup/layouts-<date>/` (a mod you installed yourself keeps its name until
  `--adopt`), and prints what a layout of yours still lacks. A layout it cannot rewrite (a link,
  whose target is yours, or a shape it does not read) keeps its old folder in `mods/` beside the
  new one, said on every run, until you name the new folder in it or take the block out; the next
  update then retires the old folder;
- points the `automagik-herdr` link at `am-sidebar`'s command;
- moves the bots' briefing hooks to a fixed path and lists, at the end of its run, every file it
  rewrote. A Claude session already running in one of those projects keeps the old hook and gets
  no briefing until it is restarted: `automagik-herdr restart <bot>` (or the bot row's Restart). A project the installer doesn't
  know about keeps the old hook: `automagik-herdr start` or `attach` its bot, or open it as a
  space in Herdr and run the installer again.

`automagik-herdr update --rollback` returns to the release before, the old names included.

### Paste this to your agent

Or let a coding agent do it. The prompt lives in [docs/agent-install.md](docs/agent-install.md):

```text
Install Automagik Herdr on this macOS or Linux machine and set up my first bot.

1. Run: curl -fsSL https://raw.githubusercontent.com/automagik-dev/automagik/main/herdr/install.sh | bash
   If it stops to ask something (install Node or Herdr), ask me; if I say yes, run it again
   with: ... | bash -s -- --yes. If it stops for anything else, tell me what it printed and stop.
   If the output has a layout.switch command, ask me before running that exact command. If
   it names a layout of mine that lacks pack pieces, tell me which; edit it only if I ask.
2. Verify, don't assume: a version and a checksum don't say what was installed. All must hold:
   automagik-herdr --version prints 0.5.0 or later (0.4.x and older are the sidebar alone);
   sed -n 's/^mods=//p' ~/.config/herdr-app/automagik-herdr/installed-by-install.sh prints
   am-automations,am-footer,am-markdown,am-mods,am-new-menu,am-quota,am-sidebar,am-status,am-tabs;
   herdr-app check ~/.config/herdr-app/mods/<mod> succeeds for each on (am-automations, am-quota ship off).
   If anything is missing or fails, report the install as incomplete. If automagik-herdr is not
   found, use ~/.local/bin/automagik-herdr and tell me to add ~/.local/bin to my PATH.
3. Ask me for: the project folder, and the main bot's name, character and coding agent
   (claude, codex, antigravity…). Characters: whale, octopus, star, moon, wave, squircle, zed,
   hex, gumdrop, peanut, saucer, bunny, kitty, beacon, plus, magnet, acorn, pebbles, cushion,
   ring, gem. If I don't pick a character, use --omni (the octopus); never guess the folder,
   name or agent.
4. In that folder, create and start it:
   automagik-herdr create --kind=main --name=<name> --agent=<agent> --character=<character>
   automagik-herdr start <name>
5. Report back: the installed version and mods, the output of automagik-herdr ls, and what failed.
Do not edit files under ~/.config/herdr-app by hand.
```

## Why a team

One agent in one terminal forgets what the others are doing. Automagik Herdr gives each agent
a place in a team, and keeps that team in front of every agent and of you.

- **A role and a lead.** Every bot has a name, a role, instructions and a lead. The project has
  one main bot; captains lead squads; members report to their captain or to the main bot.
  The team lives in `.herdr/bots.json`, committed with the project.
- **A briefing at launch.** Start and Restart hand a bot its name, role, instructions, lead and
  team as part of its agent's system prompt (Claude Code, Codex, Oh My Pi, Pi, Grok, Hermes),
  once, never again each turn. Its team's live state, each member's status and latest report,
  is `automagik-herdr brief <bot>`. A Claude pane attached while running gets the briefing
  once, from its hook, on its first turn and again after an edit or a compaction. An edit to a
  bot's instructions reaches it at its next `automagik-herdr restart`. Claude Code's `/restart`
  refuses a session started with that briefing (`--append-system-prompt-file`), so the briefing
  tells every bot, whatever its agent, to point you to `automagik-herdr restart <bot>` (run in
  the project's folder, or with `--project`; it keeps the bot's agent and model) or the bot's
  Restart instead of its agent's own restart command.
- **Typed notes when blocked.** A member started under its lead's pane makes herdr-core type
  its `blocked`, `error` and exit notes into the lead's pane, so the lead wakes up.
- **Any harness.** Bots run Claude Code, Codex, Antigravity, Kimi, Oh My Pi or any agent Herdr
  knows, side by side in the same team.
- **A detected model.** The sidebar shows the model a bot's pane really runs, read from its
  command line, else the agent's own default. A model can be pinned from the agent's known
  list; it is never typed.

## The team in the sidebar

The pack replaces Herdr's `spaces` sidebar with one that draws each project's team under its
space: the main bot as a card, categories as headers, captains with their members folded
under them, planned bots dimmed with their wave. Each bot shows its character, its role and
model, its agent's icon and its status. Right-click a bot for its menu: Configure opens the edit
form (name, agent, model, role, category, lead, worker defaults); Prompt edits its instructions
in place and saves them as the form does; Run starts it, or focuses its pane when it has one,
restarts it (Restart runs `automagik-herdr restart`; Restart on… restarts it on another installed
agent, a new conversation, the bot's definition keeping its agent), attaches it to the focused
pane or detaches it; What happened shows `automagik-herdr history` for it (its panes, starts,
sessions, the newest transcript, which a click copies, its workers) and the helpers its pane runs
now. A planned bot's menu has no Run items. A restart refused because the bot is mid-turn offers
"Restart anyway". The Bots list and the Attach picker open on the bots the sidebar already
knows and refresh behind.

A project on a linked machine (`hc machine ls`) is managed from here too. Its bots' menu has
Configure, Prompt and Run (Start, Focus, Restart, Attach to a focused pane of that machine,
Detach). The Bots list names the project with its machine, and New bot on a focused space of
that machine creates the bot in that machine's project. The file is read and written on that
machine through herdr-core (`hc file edit` with the text read, an exclusive create for a new
file), so an edit made there since the form opened is refused, never overwritten. Its panes run
there (`hc run --on`, addressed `machine/tN`) and show in this window, in a space of that
machine on the project. The command a bot starts with is built here, from Herdr's agent table
and your `programs.json`. A bot there gets the briefing a local start gives, written on that
machine through herdr-core, in its app home: a Claude bot's briefing file (private, 0600) and,
once automagik-herdr is installed there, its per-turn hook in that project's
`.claude/settings.local.json` (until then it starts with a warning and no hook); an omp, pi or grok
bot gets the briefing as text. A start never creates an app home on another machine, which may be
shared: when that app home isn't a folder there, a Claude bot starts with one warning and no
briefing file or hook. Codex and Hermes bots start there without it, since their own
config, which may hold a prompt the briefing would replace, is only read on this computer. What
happened isn't shown for those bots yet. A machine that isn't answering shows its bots as last
seen, dimmed, and its menu says so.

A project there can carry a pane-env file, `<project>/.herdr/pane-env` on that machine, for its
bots' panes only: other panes there never read it. It takes two keys, one per line:

```text
PATH_PREPEND=/opt/node-22/bin:/opt/tools/bin
HERDR_APP_HOME=/srv/bots/herdr-app
```

`PATH_PREPEND` puts those folders first on the PATH the agent is checked and started with (a
chosen Node, say). `HERDR_APP_HOME` is the app home the pane gets (`HERDR_APP_HOME=` in its
`/usr/bin/env` words) and the one its briefing file and hook use; without it, that machine's
`~/.config/herdr-app`, either way only while that folder is there. Every folder is absolute, with
no space at its start or end; blank lines and `#` comments are skipped. Another key, a relative
folder or a line that isn't `KEY=value` leaves the whole file out with one warning, and the bot
starts as it would without it, with no briefing file or hook: a file left out never falls back to
the default app home. With no file, nothing changes.

pane-env belongs to that machine: keep it out of git (add `.herdr/pane-env` to the checkout's
`.git/info/exclude` there), since a committed one would apply on every machine the project is
checked out on. A start on this computer never reads it.

To move a project's bots onto a shared machine:

1. Write `<project>/.herdr/pane-env` there, with `HERDR_APP_HOME` naming an app home that is
   already there (yours, not the machine user's), and `PATH_PREPEND` if your bots need their own
   Node.
2. Start one bot: `automagik-herdr start <bot> --machine <machine> --project <folder there> --json`.
3. Read its `warnings`: they should be empty. A `pane-env ... was left out` or `without its
   briefing` warning names what to fix; fix it and restart the bot.

Start and Restart there can take minutes when the machine answers slowly (every question to it
has its own bound; the CLI's worst case is about 6 min for a start and 9.5 min for a restart), so
the sidebar runs them with Herdr's longest exec timeout, 10 min. A Herdr that doesn't take an exec
timeout ends a mod's programs at 30 s, which could land after the new pane started: a pane with no
attach row, or after a restart two panes on one session. On such a Herdr, or one that can't say,
Start still runs, with that 30 s as its deadline: just before it would ask for a new space, and
again just before `hc run`, it checks what is left, and starts nothing when too little is left to
finish (20 s and 16 s; the calls after `hc run` then get 5 s each). A space made for it stays.
Restart isn't run there: after `hc run` it can still wait 30 s for the agent. Either way the
sidebar names the command to run from a terminal instead
(`automagik-herdr start <bot> --project <folder> --machine <machine>`, or `restart`), where
no limit applies. When Herdr ends the CLI anyway, the sidebar says it may have stopped part-way and
what to check (`automagik-herdr whois --bot`, `hc ls`).

On its first load the pack switches Herdr to the Automagik theme, light or dark following the
system. Both halves are listed in Herdr's Settings, and a theme you pick later stays: the pack
switches it once and never again. The theme files it copies into Herdr's `themes/` folder are
never overwritten, so a later release does not update a theme file already there; a theme file
you delete is copied back on the next load (pick another theme in Settings to stop using it).

## The command line

`automagik-herdr` does everything the sidebar does, without a Herdr window. Agents use it to
build and run their own teams.

```text
automagik-herdr ls [--all]                 bots: kind, lead, category, rank, planned, agent, model, pane, status
automagik-herdr show <bot>                 one bot in full
automagik-herdr create --name N --agent A [--kind main|member] [--role R]
       [--instructions TEXT | --instructions-file F|-] [--lead BOT] [--category ID]
       [--character C --colour K | --omni] [--model M] [--rank R]
       [--planned-wave N [--planned-note T]] [--worker-agent A] [--worker-model M] [--worker-effort E]
       [--worker-template T]
automagik-herdr edit <bot> [the create options] [--unplanned] [--no-model] [--no-category] [--rank=]
automagik-herdr rm <bot>
automagik-herdr category ls | add --title T [--sub S] [--id ID] | edit <id> | rm <id> | order <id>...
automagik-herdr start <bot> [--space ID] [--tab ID]
automagik-herdr restart <bot> [--fresh] [--agent A] [--model M [--save]] [--force]
automagik-herdr attach <bot> <terminal> [--move]
automagik-herdr detach <bot>
automagik-herdr import --from-hc [--squad-label L] [--apply]
automagik-herdr whois <terminal> | whois --bot <bot>
automagik-herdr history <bot>
automagik-herdr brief <bot>
automagik-herdr forget <project>
automagik-herdr worker "<task>" (--branch B [--base REF] | --worktree DIR)
       [[--agent A] [--model M] [--effort E] | --template T] [--name N] [--role dev|test|review|fix]
       [--task ID [--lead BOT]]
automagik-herdr update [--check | --rollback]
automagik-herdr meter install [--machine M | --linked | --local] | meter uninstall
automagik-herdr dsh-tui install | update | uninstall | doctor
```

- `forget <project>` takes a project's folder off this CLI's project list (#229): only that
  entry, under the list's lock. Its folder, worktrees, bots file and panes stay as they are; a
  project not on the list is refused and the list left as it was. `ls --all` and the sidebar
  also show the sidebar's own remembered projects (each one it started a bot or wrote bots in),
  which only the sidebar changes: it forgets one once its `.herdr/bots.json` is gone. When the
  sidebar remembers the project too, `forget` still takes it off its own list and says on stderr
  that it stays shown until then (`--json`: `sidebar_remembers`). `start`, `restart`, `attach`
  and `create` already take off an entry whose folder is gone (tidy's registry prune) and say
  so in one line when the command succeeds.
- `import --from-hc` turns a running hc team into bots (#232): each live pane on this computer
  labelled `squad=` (or `--squad-label L`) with an hc name and an agent in front becomes a bot of
  that name, attached to that pane. Per squad, the captain (the pane labelled `role=captain`, else
  the one whose name or template is the squad's name, a separator and `cap` or `captain`, as
  `web-cap` or `web_captain`; `escape-cap` is not web's captain, and a pane whose `role=` is
  another rank is never one by name) reports to the main bot and the rest to their captain; the
  plan says which rule picked it. Without `--apply` it prints the plan and writes nothing: no
  bot, no label, and no attach ledger row (on a first run it works out the ledger's one-time
  import from `bot=` labels without saving it, and writes no end row for a pane hc no longer
  confirms). With `--apply` it prints the plan, writes every new bot at once and attaches each
  seat as `attach` does, never with `--move`. So besides `bots.json` and the attach ledger, it
  writes what `attach` and `create` write: the pane labels (`bot=`, `role=`, `category=`, a
  copied `squad=`), one workers-ledger seat row per attach, the Claude briefing hook and its git
  exclude line, the projects list, tidy's registry prune, and new `role=` labels on the panes of bots already there
  whose role changes (a captain whose members are made in this run). A pane already playing its
  bot gets back the labels `attach` sets that it has lost, with no ledger row, so a second run
  changes nothing; a bot defined but attached nowhere (a run cut short) is only attached. Any
  conflict refuses the whole import, nothing written: a pane playing or labelled for another bot,
  a bot of the seat's name attached elsewhere, under another lead or defined with another agent
  than the pane runs, a squad without exactly one captain, a Claude session outside the project,
  or no main bot. It never starts, moves or restarts a pane.
- Every command takes `--json` and `--project <folder>`. Without `--project`, the project is
  the one the current folder belongs to: its git main checkout, or outside git the nearest
  folder at or above it holding `.herdr/bots.json`. A folder named with `--project` is the
  project itself outside git, never a parent folder's project; in git it is still the main
  checkout. A `--project` folder that isn't there is a usage mistake.
- An edit (`create`, `edit`, `rm`, `category`, `restart --save`) run in a git worktree, or with
  `--project` naming one, is written in that worktree's `.herdr/bots.json` (from the main
  checkout's when the worktree has none yet), so the main checkout stays clean for the merge's
  `git pull`. Reads stay on the main checkout: `ls`, `show`, `whois`, Start and the sidebar show
  the change once it is merged there (RFC 0014 Q16); a bot one of them can't find in its file is
  named with the other file when that one has it. When the main checkout's `bots.json` was never
  committed, or has local changes, the note warns that pulling would stop on it: git won't
  overwrite it. When it was committed and is deleted in the working tree (not staged), the note
  says so: the pull brings it back with the worktree's version.
- `ls`, `show`, `create`, `edit`, `rm` and `category` also take `--machine M --project <folder>`:
  the project on linked machine M (`hc machine ls`), `--project` an absolute folder there, keyed
  there by the same rule. The file is read and written there through hc by the same
  compare-and-swap rule, and the `--json` answers carry `machine`. A write whose answer is lost
  (a timeout, or the link dropping, which hc reports as `unavailable`) is read back: saved if the file holds it, else `State unknown`, so check the file
  before trying again. One write carries at most 96 KiB.
- `start`, `restart`, `attach`, `detach` and `whois` take `--machine` too: the pane runs on that
  machine (`attach <bot> M/tN`, or a bare `tN` with `--machine`). The attach ledger's row keeps
  the bare `tN`, `machine` and that machine's core id. `whois --json` keeps its shape: its
  `terminal` is the bare `tN` and `core` that machine's, never `M/tN`. While the machine isn't
  connected, its rows stay as they were (`status` `unknown`), never ended. A project's checkouts on two
  machines share their bots' ids, so a bot is per machine: `--machine` acts only on that machine's
  pane in that project, never on this computer's same-id bot, and `whois --bot <bot>` answers for
  this computer unless given `--machine M`. The pane's PATH comes from that machine's login shell,
  asked once with a 10 s bound (herdr-core may run as a service that never read `~/.profile`), plus
  the PATH hc runs programs with, `~/.local/bin` and `~/.bun/bin`. When the PATH hc runs programs
  with already finds the agent, that PATH goes first, so a working machine keeps the same agent and
  interpreter; otherwise the login shell's goes first. The agent and the interpreter on
  its `#!/usr/bin/env` line are checked under that same PATH before anything starts. A broken
  copy on the PATH hc runs programs with (one whose interpreter isn't there) still goes first and
  is refused by name, even when the login shell's PATH holds a working copy: remove or fix that
  copy. A login shell
  that is slow or prints no PATH leaves a warning, not a refusal; profile output is only ever read as
  text. A session id the pane carries is resumed by id
  (`--resume`); with none, `restart` refuses unless `--force`, as the agent's own "latest" may be a
  conversation started there by hand. A pane that reports
  no status to hc (Hermes) can't say whether it is waiting for an approval, so `restart` refuses
  it unless `--force`. No command ever sends a pane keys: `--force` starts the new pane and ends
  the old one only once the new one is up. `worker`, `brief`, `history` and `tidy` stay this
  computer's.
- A bot is named by its id or by its name. A refusal exits 1, a usage mistake (such as a
  missing `--project` folder) exits 2, and nothing is written.
- `start` runs the bot's agent in a new pane with `hc run`, labelled `bot=<id>`, and records it
  in the [attach ledger](#the-attach-ledger). A member whose lead is running gets the lead's
  pane as its parent. A running bot is not started twice.
  The pane opens in a tab of its own in the space showing the project, never in another
  pane's tab; with none open, `start` opens one on the project folder (`--space` picks the
  space instead, `--tab` a tab in it). The sidebar's Start passes the space only. A space
  opened this way (by `start` or the sidebar's Start) comes with a shell in its first tab:
  that tab is closed (`tab.close`, not `confirmed`: Herdr asks the person only before it
  closes a space's last tab, and the bot's tab is always left) once the bot shows in its own
  tab there, and only while that shell is known to be the tab's one pane (a mod pane counts)
  with the shell itself in front, idle, and no job of its own running (`sleep 99 &` left at
  the prompt keeps it: its child processes are asked with `pgrep -P`, and an answer that
  can't be read keeps it too), so the space is never left empty and nothing else is closed.
  The sidebar's Start knows the panes. `start` from the command line, `--machine` too, reads
  them from `herdr-app ls`, which counts no mod pane: it closes the tab only when it saw that
  shell, right after its own `space.new`, as the new space's one tab and that tab's one
  terminal. `AUTOMAGIK_HERDR_TAB_WAIT_MS` sets how long `start` and `worker` wait for Herdr to show
  the new pane (5000 by default); `0` turns this tab setup off.
- `restart` runs the bot's agent again in its pane's place: the new pane starts in the same
  space, tab and folder with the same labels, and the old one is ended (`hc kill`) only once the
  new one has kept its agent in front at every check for 5 seconds (1.5 once the agent reports
  its status to hc), so an agent that exits at startup (a stale resume, a failed swap) never
  leaves the space empty. A replacement that doesn't make it is ended, and the old pane keeps
  running. The launch is rebuilt from its current source — a live hc template's current command,
  else the bot's agent row and model pin, plus the agent's own resume words — never copied from
  the old pane, so a flag the source no longer names (a retired proxy, say) doesn't survive.
  When the pane's command differs, one line names the flag names only, their values masked
  (#597); a template hc no longer lists falls back to the agent row, and the line names it.
  It resumes the conversation by its session id, for every agent that resumes one: the
  id on the pane (`agent.session`, carried to the new pane, or a reviver's `revive.session`),
  else the workers ledger's last session row for that terminal (`claude --resume <id>`,
  `codex resume <id>`, `omp --resume=<id>`, `pi --session <id>`, `kimi --session=<id>`,
  `agy --conversation <id>`, `hermes --resume <id>`). With no id it takes the latest
  conversation in the bot's folder (`--continue`, `codex resume --last`), which could be a
  teammate's: while another pane or bot on that agent is in that folder (a live pane, a bot's or
  one started by hand, or another bot's last seat row in the workers ledger, its pane ended or
  not; for agy, whose `--continue` isn't limited to a folder, any folder), the restart starts a
  new conversation instead and says why (#328; the quota panel's restart lists those too). Only
  Claude's hook records an id today; on another agent, set the pane's `agent.session` label to
  keep its own conversation in a shared folder. An agent with no resume here starts fresh, and
  says so.
  `--fresh` starts a new conversation. `--agent` / `--model` swap the agent or model (always a new
  conversation: they don't cross agents); `bots.json` keeps the old ones unless `--save` is given.
  A bot that isn't running is started. It is refused while the bot is working (it would cut the
  turn in half) or has helpers, such as workers, that hc would end with its pane; `--force`
  restarts anyway. The old pane is found in the attach ledger; once the new pane has stayed up,
  the ledger moves the bot to it (the old binding detached, by `start`, reason `moved`; the new
  terminal attached, by `start`), and a replacement that didn't make it writes no rows. A bot
  restarting itself writes and prints everything before the kill that ends its own pane. It
  prints the new terminal.
- `attach` ties a running pane to a bot. A Claude pane whose session runs outside the bot's
  project is refused, and so are a pane another bot plays and a bot another pane plays; the
  refusal names the holder. `attach --move` moves a bot from its pane to this one.
- `detach` unties a bot from its pane. `whois` says which bot a pane plays, or which pane a
  bot plays.
- `history` reads the two ledgers for a bot: its attach, detach and end rows, its starts, the
  Claude sessions of the panes it played, matched by terminal id and time, with the newest
  transcript, and the workers it started. The match is exact once a pane's detach or end row is
  written; a terminal id hc reused before then can briefly show the new pane's session. It
  writes nothing; a removed bot is named by its id.

## The attach ledger

Which pane plays which bot is recorded in one file, `<app home>/automagik-herdr/attach.jsonl`
(beside the workers ledger), and nowhere else. Only `automagik-herdr` writes it: `start`,
`attach` and `detach`, and any run that reads it and finds a pane ended. The sidebar's Start
and Attach run the command line too. The `bot` label is a display hint: `hc label` changes
no row, so relabelling a pane moves no bot.

The file is made with mode 0600; one that is group- or world-writable is refused (every
command that reads it exits 1, naming the fix: `chmod 600`). Each row is one line, written
with one append, under the file's lock (`attach.jsonl.lock`), so two runs never attach one bot:

```json
{ "v": 1, "event": "attach", "bot": "b-…", "project": "/abs/main/checkout", "terminal": "t7",
  "core": "<hc core id>", "created_ms": 1762100000000, "machine": null,
  "at": "2026-11-02T10:00:00.000Z", "by": "start" }
```

- `event`: `attach`, `detach` or `end`. `bot`: a bot id (`b-…`) or a session (`session-…`).
- `core`: `hc server status`'s `core.id`, the core's permanent id (reset only when hc's state is
  wiped). `created_ms`: the terminal's, from `hc get`. A terminal is the triple
  (`core`, `terminal`, `created_ms`), so an id hc hands out again is another terminal.
- `by`: `start`, `attach`, `detach`, `sweep` (an end row) or `import` (see below). `reason`, on
  some rows: `moved` (the detach of `attach --move`, written before its attach, in the same
  run), `finished` (hc says the terminal finished, or doesn't know it) or `replaced` (its id
  now has another `created_ms`). `machine` is `null`: every row is this computer's.

**The fold.** Read the rows in order, skipping any line that isn't a well-formed row:

1. `attach`: end any earlier binding of the same bot and of the same terminal, then bind the
   terminal to the bot.
2. `detach`: unbind the terminal if it is bound to that bot (a detach naming another bot does
   nothing).
3. `end`: unbind the terminal, whatever bot it holds.

What is left binds each bot to at most one terminal. A binding counts only when hc confirms
it: its `core` is this computer's, and `hc get <terminal>` says `live` with the same
`created_ms`. Anything else reads as ended at once; the next command that reads the file
appends its `end` row.

**Looking it up** (the interface for other tools):

```text
automagik-herdr whois <terminal> --json
  { "terminal", "core", "created_ms", "bot", "project", "since" }   or   { "terminal", "core", "created_ms", "bot": null }
automagik-herdr whois --bot <bot> --json
  the same, or { "terminal": null, "core", "created_ms": null, "bot", "project": null, "since": null }
```

`since` is the attach row's `at`; `created_ms` is hc's. Both forms fold and confirm with hc first.

**The first run.** With no file yet, the first command that reads it imports today's labels
once: each live pane on this computer carrying `bot=<id>` of a bot some project here defines
becomes an attach row with `by: "import"` (one pane per bot: an agent in front, then the
newest). The file is then made, even empty, so this happens once. The briefing hook reads the
file and never writes it; before the file exists it goes by the label.

## Workers

A bot manages its lane and writes no code. For each task it starts one worker, from its own
pane:

```bash
automagik-herdr worker "Fix the login redirect loop" --branch fix/login-loop --effort high
automagik-herdr worker "Fix the login redirect loop" --task gl-231 --worktree ../proj-gl-231
```

- **Who:** the calling bot is read from `HC_TERMINAL_ID` and that terminal's `bot` label.
  Anywhere else the command is refused.
- **Where:** `--worktree DIR` uses an existing worktree of the bot's project. `--branch B`
  reuses the worktree already on `B`, or makes `<main checkout>/.claude/worktrees/<slug>`
  with `git worktree add -b B`. After a fetch, a new branch starts from `--base`, else
  `origin/B`, else origin/HEAD's branch, else `dev`, else `main`, else `master`. It tracks
  `origin/B` when it starts there and nothing otherwise, so the first push is
  `git push -u origin B` and a plain `git push` never lands on the base. The main
  checkout is never a worker's folder, and its HEAD is never moved. `/.claude/worktrees/` goes
  into the clone's own git exclude, so `git add -A` in the main checkout never picks a
  worktree up.
- **Task (Genie's task contract):** `--task ID` is Genie's short task id, `^[a-z0-9][a-z0-9-]{0,40}$`
  (`gn-42`, `gh-1415`, `gl-231`). An internal `t_…` id is refused with `internal Genie id; pass
  the short id gn-N, gh-N or gl-N`; any other bad shape exits 2. With `--branch`, the branch
  must contain the id as a whole token (`fix/gl-231-login` names `gl-231`, not `gl-23`); with
  `--worktree`, Genie's flow, it isn't checked. The worker is named exactly `<id>-<role>`
  (`gl-231-dev`, `gl-231-review`): a live terminal on this computer already named that is
  refused and named, never suffixed; `--name` doesn't go with `--task`, and a name over hc's
  32 characters is refused. Without `--task`, the worker is named after its branch.
- **Lead:** `--lead BOT` is the task's lead bot, a bot id (`b-` plus 10 base32 characters) or a
  Genie session (`session-<uuid>`), checked by shape only; it defaults to the calling bot. A
  `reviewer` or `fixer` bot passing `--task` must pass `--lead`.
- **Planned swaps:** a bot's `worker.swap` in `.herdr/bots.json` (`{ agent?, model?, effort? }`)
  is the other arm its workers run on about one task in three, picked by rule: the first byte
  of sha256(`<bot id>:<project>:<task id>`) mod 3 is 0. Only with `--task`, never for a template
  worker, and the same for every worker of that bot on that task. On a swap task the arm
  replaces the bot's worker defaults; a per-task `--agent`, `--model` or `--effort` is recorded
  in the ledger (`override_requested`), not used, with one warning. Off a swap task they work
  as below and the row says `override: true`. `show <bot>` prints the worker defaults and the
  swap.
- **Role:** `--role dev|test|review|fix` says what the worker does. Without it the role comes
  from the bot's rank: `tester` runs `test`, `reviewer` runs `review`, `fixer` runs `fix`,
  any other rank (or none) runs `dev`. A captain passes `--role`. Another value exits 2.
- **One writer per worktree:** `dev`, `test` and `fix` write to the worktree; `review`
  never does. A writer is refused while any live worker of any bot on this computer is in the
  same worktree (its cwd, as a real path) with a writer role; a worker with no `worker.role`
  label (started before roles) counts as a writer. Reviewers start alongside a writer, and
  several may run at once; one bot's second reviewer on the same branch is refused, while its
  reviewers on other branches run in parallel. A refusal names the live worker, to check with
  `hc read` or end with `hc kill`. The check and the start run under one lock per worktree
  (`<app home>/automagik-herdr/worktree-<hash of its real path>.lock`); the lock and the check
  are local, so workers on other machines are not counted. The check comes first: a refused
  call, `hc ls` failing included, makes no worktree and writes no hook; so does a live
  terminal in the worktree that `hc get` doesn't answer for within 5 s. The lock is kept
  fresh while held, so a slow `hc` never lets a second call take it. A second call waits up
  to 75 s for it, saying on stderr after 3 s which lock it waits for and its holder's pid.
  A `--task` worker first takes a lock for its name (`task-<hash of its name>.lock`, the
  same 75 s in all): a second call for that task on another branch waits for the first's
  start, then is refused by the name check before it makes a worktree or a hook. A call
  waiting for a lock keeps refreshing the one it holds, and a refusal for a wait that ran out
  names the task or worktree it waited for.
- **Warnings:** `worker` prints the bots file's warnings about the calling bot on stderr
  first (a bad `worker` field is dropped, and its defaults with it); `--json` lists them.
- **What runs:** `--agent`, `--model` and `--effort` for this task, else the bot's `worker`
  defaults in `.herdr/bots.json`, else the bot's own agent with that agent's defaults. A
  default model belongs to the default worker agent, so a task that picks another agent
  runs that agent's own default model. Effort goes to `claude --effort`, codex
  `-c model_reasoning_effort`, and pi or omp `--thinking`; other agents get none, with a
  warning.
- **Templates:** `--template T` runs the hc template `T` (`hc templates` lists them)
  instead of an agent, for seats whose command sets more than a model: a custom model
  provider, keys, flags. A template owns its command, so `--template` with `--agent`,
  `--model` or `--effort` is refused. A bot's `worker.template` default wins over its
  `worker` agent, model and effort defaults, with a warning; any per-task `--agent`,
  `--model` or `--effort` sets the default template aside, so a captain whose workers run
  `dev-sol` can still start a Claude reviewer. A template hc doesn't list is refused before
  any worktree is made, and so is any template when `hc templates` gives no list (`hc run`
  would start an unlisted name as a program). An empty `--template=` is refused. A template
  whose command runs `claude` gets the session hook; when
  the command names no agent Herdr knows, the hook is skipped with a warning.
- **Spawn:** `hc run --bg --parent <bot pane> --cwd <worktree>`, labelled `worker.of=<bot id>`,
  `branch=<branch>`, `worker.role=<role>` (a template too), `worker.model` and `worker.effort`;
  with `--task`, also `task=<id>`, `task.project=<main checkout>` and `task.lead=<lead>`
  (without it, no `task` label at all). When the bot's pane is in a Herdr space, also
  `herdr.space=<that space>` and no `herdr.tab`, so the worker opens in a tab of its own there
  as it starts: the space where the window shows the bot's pane, else its pane's
  `herdr.space` label while the window still has that space (none once it was closed).
  Once Herdr shows the worker (within 5 seconds), its tab is moved right after the bot's
  tab and named after its branch, as a click on its row does; it is never focused.
  A worker started before this release has no `branch`
  label: its `task` label holds the branch, and Herdr's readers fall back to it. Then
  `-- /usr/bin/env PATH=<the calling pane's PATH> <agent argv> <task text>`. The agent gets the
  bot's pane's PATH, not herdr-core's, so programs in `~/.bun/bin` (omp, and the `bun` it runs
  on) start. An npm agent such as codex is a `#!/usr/bin/env node` script: when that PATH has
  the agent but no `node`, the folder of one is put first (the one beside the agent's link,
  else what `bin/run.sh` picks: nvm's newest 22.7+, then Homebrew's), with one line saying so.
  A template runs in hc's template form, `<template> <task text>` after the
  options, labelled `worker.template=<name>` and without the PATH: the template sets its own
  command. The task text is always one argument, never part of a shell string. The worker has
  no `bot` label, so the sidebar folds it under its bot as a helper row showing its template,
  or its model and effort. Clicking that row focuses the worker's pane; without one, the
  worker opens as a tab right after its bot's tab, named after its branch. A bot with no
  pane, or a worker on another machine, is peeked instead.
- **Output:** the worker's terminal, then its role, worktree, branch, and agent, model and
  effort, or its template (`--json`: the same as data, with `role` and `template`).
- **Lifecycle:** the bot checks the worker's result, and ends it with `hc kill <terminal>`
  once the task merges. The bot's briefing says so. As an hc child, a worker
  also ends when its bot's program ends; its branch stays.
- **Cleanup (#567):** a worktree this command made (`created` in the ledger) is removed
  (`git worktree remove`, no `--force`, then `git worktree prune`) once every worker that ran
  in it has ended, done or killed, at least 15 minutes ago (hc's `finished_ms`: restart
  `--tree` runs a bot's workers again one at a time, about 1 + 2k minutes at worst for the k-th),
  and no live terminal works in it. Each `worker` call does
  it after its own start, newest first, at most 5 worktrees, and starts no new check after
  about 20 s; one slow check and one large remove (up to 120 s) can still run past that.
  `automagik-herdr reap` does all of them at once.
  - An open pull request's worktree is removed once its workers end, if it is pushed and
    clean. The branch is always kept: only the folder goes.
  - The first sweep after this release covers every older `created: true` row in the
    ledger: 5 per worker call, or all of them with `reap`.
  - Kept, with one line naming the path and why: uncommitted changes (untracked files
    included); a tree no longer on the worker's branch; a detached HEAD with commits on no
    remote; commits on no remote branch, unless `gh pr list --head <branch>` shows the
    branch's pull requests all merged or closed (a squash merge). gh missing or failing keeps
    it. Ignored files (`.env`, build output) do not keep it: they go with the folder, as
    `git worktree remove` does.
  - A worktree only given to a worker (`--worktree`, a branch's existing worktree) is never
    removed. A worker call that waited for a worktree the cleanup removed meanwhile never
    starts in what is left: `--branch` makes the worktree again, `--worktree` is refused.
  - Outcomes go to `<app home>/automagik-herdr/worker-reap.jsonl` (`{ worktree, result:
    "removed" | "kept" | "failed" | "gone", why, at }`), never to the workers ledger. A kept
    worktree is looked at again on each call, and its line is said again only when its reason
    changes; a worker call skips one whose reason is a day old (`reap` still looks).
- **Ledger:** `worker`, `start` and `attach` append one row per terminal to
  `<app home>/automagik-herdr/workers.jsonl`: `{ event: "start", kind: "worker" | "seat",
  terminal, pid, botId, task, worktree, agent, model, effort, template, role, branch, project,
  lead, base, created, swap, override, override_requested, at }` (`at` is ISO 8601).
  - `task`: Genie's task id (`--task`), else null; a seat's is null. `project`: the main
    checkout's absolute path, the project key, on seats too. Usage joins to tasks on
    **(project, task)**: task ids are unique per project only.
  - `branch`: the worker's branch. `lead`: the task's lead bot. `worktree`: the worker's
    folder as a real path. `base`: the commit the worktree started from (the base ref's SHA
    when this command made it, else the branch's oldest reflog entry), or null. `created`:
    this command made the worktree. `role`: the worker's role, null for a seat.
  - `swap`: the task ran the bot's swap arm. `override`: the bot picked the agent, model,
    effort or template itself. `override_requested`: on a swap task, what it asked for and
    didn't get, else null.
  - `template` is the hc template a worker runs, else null (seats and agent workers).
  - Rows written before a field have no such key. A worker row with no `branch` key predates
    the task contract: its `task` is the branch, not a Genie id.
  When a template runs, `agent`, `model` and `effort` are null: the template sets them. The
  briefing hook appends `{ event: "session", terminal, session, transcript, at }` and sets the terminal's `agent.session` label when a Claude session
  changes. A session row can repeat when the label write fails, so consumers dedupe session
  rows on (terminal, session). There is no end row: a worker's end comes from hc or from its
  session. The rows outlive the terminals, so usage can be tied to bots and tasks afterwards.

## The hc guard (a guardrail, not a boundary)

A pack-started dsh-tui bot pane, and every worker it starts, gets
`mods/am-sidebar/guard/` first on its PATH (`startArgs` and `workerArgs` add it for the
`dsh-tui` agent only). Its `hc` is a deny-by-default wrapper around the real `hc` (#624):
it scans PATH past its own entry and passes an allowed call through unchanged — same stdio,
same exit code, same stdout and stderr. It allows `send`, `read`, `ls`, `get`, `wait`, `put`,
`label`, `kill`, `rm`, `events`, `schema`, `templates`, the doc-only
`--help`/`-h`/`--version`/`--skill` forms, and one `run` shape: the dsh-tui worker start that
`automagik-herdr worker` emits (`--bg`, the caller as `--parent`, `worker.of=<the caller's
bot>`, a `--cwd` under the project's `.claude/worktrees/`, and `/usr/bin/env PATH=… dsh-tui`
after `--`). Everything else is refused with one stderr line naming #624 and #629, and the
real `hc` is never called: `exec`, any other `run` (including a template or another agent),
file writes, edits and reads, `machine`, `server`, `update`, `connect`, `keys`, `attach`, and
any `--on` outside an allowed `send`.

`send` is scoped to the caller's team: its lead chain (`effectiveLead` up), its members
(`descendantsOf`), the project's main bot (`mainBotOf`), its own workers (`worker.of` = the
caller's bot) and the shared reviewer/fixer roles (`RANKS`). The caller comes from the attach
ledger, the authority; a worker pane has no ledger row, so its `worker.of` label names its bot
and its cwd's project. The target is resolved with the real `hc` (`ls` for a name, `get` for
the labels). Any target outside that team is refused.

**This is a guardrail, not a boundary.** A bot can bypass it with an absolute path to the real
`hc`, a raw socket client, or `hc connect`. A bot that edits its project's
`.herdr/bots.json`, or changes a pane's labels with `hc label`, can widen its own `send`
scope; that data is writable by the bot, so the team check is only as good as that data. The
real fix is the sandboxed socket mask plus the per-pane filtering proxy wish (#624), and #629
is the hard boundary. This wrapper only stops the ordinary `hc exec` attempt while that lands. The
pack's own CLI still reaches the real `hc` for its trusted calls (system status, machine
lists, remote file/exec, docs), so `automagik-herdr worker` and the remote commands keep
working in a guarded pane.

## The Create form

**New bot** at the foot of the sidebar opens the form: a live preview of the bot's character,
its name, look, role and instructions (at most 4,000 characters), the agent it runs on, the
model it uses, whom it reports to, its category, and whether it is planned for a later wave.
The footer shows the matching `automagik-herdr create …` line, ready to copy. The form writes
`.herdr/bots.json` in the project's main checkout, or, from a focused worktree space, in that
worktree. The form then says where it saves and that the sidebar shows the bot once the change
is merged, stays open after saving, offers no Create & start (bots start from the main
checkout's file), and warns when the main checkout's `bots.json` isn't committed, has local
changes, or is deleted in the working tree.

The form starts on the focused space's project. A folder picked from the project chip is the
project itself outside git, and with no `.herdr/bots.json` yet it is a new project whose
first bot is its main bot. When the focused folder is outside git and sits under another
project's folder, the form asks: that parent project, or the folder as its own project. A
focused folder that no longer exists is not used; the form asks for the folder. The sidebar
still places panes by the walk-up, so a folder joins its own project once it has its file.

## Updates

```bash
automagik-herdr update --check      # the installed and the latest version
automagik-herdr update              # download, verify against the signed pointer, install
automagik-herdr update --rollback   # put the replaced set of mods back
automagik-herdr update --auto off   # Install updates automatically: on (default), off, or status
```

**Install updates automatically** is on by default: when the sidebar's check finds a newer
release, it installs it the same way `automagik-herdr update` does (the signed pointer, the
sha256, the replaced set kept for `--rollback`), Herdr reloads the mods, and one notice says
"Automagik Herdr updated to X". Your bots keep running: they live in herdr-core, not in the mods.
A version you rolled back with `--rollback` is never installed on its own again; it waits for a
newer one. A failed install posts one notice with the reason, changes nothing, and tries again
4 hours later; each further failure of that release waits longer (8, 16, then 24 hours, then
daily), with no second notice. Turn it off with `automagik-herdr update --auto off` or the switch
in the status bar; then a new release is only announced, as before. It applies only to a pack
`install.sh` installed from a signed release (its record in `<app home>/automagik-herdr/` has a
`sequence=`); the setting lives beside it, in `auto-update.json`.

Updates come from the Automagik monorepo's GitHub releases, through one signed pointer: the
`herdr-lane` release's `pack.json` names the newest pack release (not GitHub's "latest", often a
desktop or plugin release without it), and `pack.json.sig` signs it. The sidebar looks 20 seconds after it
loads and then every 4 hours, and installs a newer one (or, with the switch off, shows one notice
per new version with the command to run).
When it can't look (no network, no `node`), it says nothing and tries again in 30 minutes.
Set `AUTOMAGIK_HERDR_NO_UPDATE=1` to turn both off. A pack installed as a link to a checkout
is never replaced: update it with git.

The pointer is ed25519-signed with the pack's own key; the installed pack carries the public keys
(`mods/am-sidebar/pack-keys.json`) and refuses a pointer it can't verify, then a tarball whose
sha256 is not the one the pointer names. So an update shows who published it, not only that the
download is intact. `install.sh --version <v>` is the exception: a named older release is checked
against its own `.sha256` alone, and the installer says so.

## Pane labels

A bot's pane carries hc labels that say which bot it is, so tools such as herdr-meter can
stamp events with them (`actor.bot`, `actor.role`, `actor.squad`):

| Label | Value |
|---|---|
| `bot` | the bot's id |
| `role` | `main` for the main bot; `captain` for a bot that leads other bots; otherwise its `rank`. No rank, no label. |
| `category` | the category it shows under (a deeper member: its chain's category), when there is one |
| `squad` | the team, set by the team-assembly helper (`squad=memory`). Never overwritten. A pane with none gets its lead's pane's squad, and `automagik-herdr.squad=<that squad>` records the copy. |

They are a hint for display and for those tools; which pane plays which bot is the
[attach ledger](#the-attach-ledger)'s answer. Start sets them. Attach leaves the pane matching its bot: a `role=` or `category=` the bot
doesn't have (left by the pane's last bot) comes off. An edit that changes a bot's rank, lead or category, or a lead's
captain status, rewrites the labels on the live panes of the bots it changes; a squad this
pack copied (the pane's `squad` still equals its `automagik-herdr.squad`) follows a lead
change, or comes off when the new lead's pane has none. Detach takes off `bot`, any `role`
and any `category` (nothing else sets those two today), the `automagik-herdr.squad` mark,
and `squad` only while it still equals the mark: a squad set after the copy stays. Only panes
on this computer are labelled. The lead's pane is the one the attach ledger ties it to.

## Reference

### `.herdr/bots.json`

```json
{
  "version": 1,
  "categories": [{ "id": "eng", "title": "Engineering", "sub": "build and ship" }],
  "bots": [
    { "id": "b-k3m7q2zt5x", "name": "Genie", "kind": "main", "look": { "character": "octopus", "colour": "deepseek" },
      "role": "Runs the project", "instructions": "…", "agent": "claude", "model": "claude-opus-5-5" },
    { "id": "b-a2b3c4d5e6", "name": "Captain", "kind": "member", "category": "eng", "look": { "character": "star", "colour": "blue" },
      "role": "Squad lead", "instructions": "…", "agent": "codex" },
    { "id": "b-f7g2h3j4k5", "name": "Dev", "kind": "member", "lead": "b-a2b3c4d5e6", "look": { "character": "moon", "colour": "green" },
      "role": "Builds", "instructions": "…", "agent": "claude" },
    { "id": "b-m5n6p7q2r3", "name": "Studio", "kind": "member", "category": "eng", "look": { "character": "bunny", "colour": "violet" },
      "role": "Access and studio", "instructions": "", "planned": { "wave": 3, "note": "waits for the auth v2 decision" } }
  ]
}
```

- Exactly one bot has `kind: "main"`. Every other bot is a `member`.
- `lead` is the id of the bot a member reports to. Without one, the member reports to the
  main bot. A lead that is missing, planned or part of a cycle counts as the main bot, and
  the row shows a warning.
- `category` places a bot that reports to the main bot under a category header. Bots
  deeper down show under their lead and ignore it. A category id is a lowercase slug
  (`a-z`, `0-9`, single dashes, like `quality-gate`), since it goes into a pane label. A new
  id must be one (`category add --id`, the form's new category). An id already in the file
  that isn't one (`Knowledge`, written by hand) keeps working, with a warning, and gives its
  bots no `category=` label.
- `planned` marks a bot that is not started yet. It needs no `agent`.
- `instructions` holds at most 4,000 characters.
- `model` is an optional pin, picked from the agent's known models (never typed freely).
  Start passes it with the agent's own model flag; a pin the agent doesn't list (an old
  free-text model) is skipped by the sidebar with a note and refused by the CLI. A running
  bot shows the model its pane runs: the one its command line names, else the agent's own
  configured default. A bot that isn't running shows no model in its sidebar row
  ("not running · role"), while `automagik-herdr ls` and `show` print its pin, else that default.
- `rank` is optional: one of `captain`, `dev`, `tester`, `reviewer`, `fixer`, `integrator`,
  `pm`, `owner`. It sets the pane's `role=` label (see [Pane labels](#pane-labels)). `main` is not a
  rank: `role=main` belongs to the main bot alone. The free-text `role` is separate and goes
  to the briefing. An unknown rank is ignored with a warning. The form offers ranks as chips
  for team members; `automagik-herdr create|edit --rank R` sets one (`--rank=` clears it).
- `worker` is optional: `{ "agent": "codex", "model": "gpt-5.5", "effort": "high" }` or
  `{ "template": "dev-sol" }`, each key optional, the defaults of the bot's
  [workers](#workers). Without `agent`, workers run the bot's own agent; a `template` (an hc
  template name: letters, digits, `.`, `_`, `-`, no dash first) wins over `agent`, `model`
  and `effort`.
  `create|edit --worker-agent/--worker-model/--worker-effort/--worker-template` set them
  (an empty value clears one); the form keeps the field as it is. An invalid one is ignored
  with a warning.
- Ids are `b-` plus 10 lowercase base32 characters. A bot's terminal carries the hc label
  `bot=<id>`.

### The briefing hook (Claude bots)

Start and Attach add one `UserPromptSubmit` hook to `.claude/settings.local.json` in the
bot's session folder, never to the shared `settings.json`, and keep that file out of git
through the clone's own exclude file. The hook runs
`sh <app home>/mods/<sidebar>/bin/run.sh <app home>/automagik-herdr/briefing.mjs`, with the
installed sidebar folder's run.sh (`am-sidebar`, else the sidebar's folder from before v0.5.0;
nothing when neither has one): run.sh finds node 22.7 or later, or bun, even where the agent's PATH has no `node`, and the
fixed entry point runs that folder's `briefing.mjs`, so a renamed folder or a rollback doesn't
break it. The installer and `automagik-herdr update` move
older hooks onto it (each file backed up beside itself as `settings.local.json.am-backup`), a hook
in the older `node` form is upgraded to it the next time the bot starts or attaches, and a
rollback to a pack without the entry point moves the hooks back onto that folder's own
`briefing.mjs`. It prints nothing outside a bot's pane (by the attach ledger), finishes within about 2 seconds, and never fails a
prompt. `automagik-herdr worker` adds the same hook to a Claude worker's worktree. In any hc
terminal it runs in, the hook also records a new Claude session (see [Workers](#workers)). Members' reports are fenced as untrusted data. A session attached while it was
already running may need a restart to load the hook: `automagik-herdr restart <bot>` (or the bot row's Restart).

### Requirements

- macOS, Herdr and herdr-core (`hc`).
- Node 22.7 or later, or Bun, for the CLI, the briefing and updates, found automatically
  (`bin/run.sh`: node on PATH, nvm, Homebrew, then bun), even where PATH has no node.
  install.sh needs Node. The sidebar works without either, but its update check needs Node.
- herdr-core's typed notes left on (`~/.config/herdr-core/config.toml` must not say
  `notes = false`).

### Manual install

Without the installer, from a checkout: the bot mod alone, which is the sidebar without the rest
of the pack (for the rest, copy each folder of the table above the same way, and see
[Wiring](#wiring-your-layout)):

```bash
cp -R mods/am-sidebar ~/.config/herdr-app/mods/
mkdir -p ~/.config/herdr-app/layouts ~/.local/bin
cp ../herdr-layout/layouts/automagik.json ~/.config/herdr-app/layouts/
herdr-app do layout.switch '{"name":"automagik"}'
ln -s ~/.config/herdr-app/mods/am-sidebar/bin/automagik-herdr ~/.local/bin/automagik-herdr
```

Herdr never overwrites a mod folder that is already there. If you run your own
`am-sidebar` clone, move it out of `mods/` first, and keep the backup outside `mods/`,
or Herdr loads it as a second mod. A rename map in `<app home>/sidebar-agents.json` is read
as before. The sidebar docks nowhere by itself (its `mod.json` place is `none`): it shows only
in a layout that names it. `automagik.json` is Herdr's `main` layout with the pack in place of
the `spaces` and `agents` sidebars, so copying it and switching to it are required steps. If
your own layout already names `am-sidebar`, keep it and skip those two lines.

### Upgrading from herdr-bots

If you ran `herdr-bots` from a clone, use `automagik-herdr` in its place.

## Develop

No build step and no dependencies. The checks CI runs (`.github/workflows/ci.yml` at the
monorepo's root, from `herdr/`):

```bash
node --test 'test/*.test.mjs' && for f in mods/*/*.js mods/*/*.mjs mods/*/bin/*.mjs scripts/*.mjs scripts/*/*.mjs; do node --check "$f" || exit 1; done && node scripts/version.mjs check
```

The rules shared by the sidebar and the CLI import nothing from Herdr (`model.js`,
`launchArgs.js`, `models.js`, `workers.js`, `attach.js`, `formModel.js`, `release.js`,
`updateCheck.js`, `workerTab.js`, `migrate.js`, `restart.js`), so the tests
run them under plain node. The tests run the CLI and the briefing against scratch git
projects with a fake `hc`, and the sidebar's modules against stand-ins for Herdr's own. A
pass does not prove the pack works inside Herdr; check that in Herdr itself. Releases are
cut by CI on every push to `dev` with something new (see `AGENTS.md`).

The two theme files are built from Automagik's colours by `node scripts/themes.mjs`; edit that
script, not the JSON (`test/theme.test.mjs` fails when they differ).

### Publishing

The public repository carries the `herdr-mod` topic, which is set on GitHub (repository
settings), not in a file. `mods/am-sidebar/RECIPE.md` (how the pack is built) and
`mods/am-sidebar/preview.png` (the bot view) are Herdr's share files: they describe the pack
to readers of the repository and are inert in an installed copy.

## License and credits

Apache-2.0 (`LICENSE`; the pack folder carries a copy). The sidebar is derived from Herdr's
shipped `spaces` mod 0.1.7 (`LICENSE-herdr`); `main.js` says so at its top, and `mod.json`'s
`title` changed to "Automagik Sidebar". The characters come from Automagik by Namastex Labs
(`LICENSE-automagik`), whose drawing comes from DS Bot. See `mods/am-sidebar/NOTICE`.

## What else is in the pack

Besides the bot mod above, this pack builds and ships the pieces that make the sidebar usable, each
with its own `RECIPE.md`:

| Mod | Derived from | What it does |
|---|---|---|
| `am-footer` | Herdr's `workspace-chrome` | The sidebar's brand bar and a footer rail of icon tabs — Bots, Mods, Automations, Accounts (while am-quota is on), Settings, Add machine, and up to 4 buttons other mods add — so tabs never stack up. |
| `am-status` | Herdr's `workspace-status` | The window's bottom status bar (machine, branch, agents, `⌘⇧P commands`) plus the installed Automagik Herdr version beside "commands": click it to check now; when a release is out, `0.8.0 → 0.8.1 · update` installs it after a confirm, the same way `automagik-herdr update` does. |
| `am-tabs` | Herdr's `tabs` | The tab bar: pills named from the agent's own title, close ✕ on hover, middle-click to close, drag to reorder, per-space side-panel memory. Scrolling never switches tabs. Its `+` opens `am-new-menu`. |
| `am-automations` | `DnzzL/herdr-automations` (MIT) | Scheduled agent prompts as a side panel: inbox of finished runs, run now, pause all, and a form that previews the next runs. The panel draws and asks; the `herdr-automations` scheduler launches the work. **Ships switched off** (#220): the pack does not install the scheduler, so a fresh install puts the mod in `mods-disabled/`; turn it on in the Mods panel (*Automagik Automations*), and the rail's Automations tab then opens it. Without the scheduler, the panel shows the hash-checked command that installs it, to copy. An install that already has it keeps its state. |
| `am-markdown` | Herdr's `menu` + `ohneda/herdr-markdown-browser` (MIT) | Right-click a terminal: under Herdr's own items, the Markdown files that terminal printed. Pick one and it renders in a preview pane — live reload on save, `Default app` — that the next pick replaces in place. |
| `am-new-menu` | Herdr's `new-menu` | The `+` menu (the sidebar's and the tab bar's, in place of Herdr's own): terminal, the agents actually installed (per machine), new space, worktree dialogs; `⌘1…9`/`⌘T`/`⌘N`. |
| `am-mods` | `jacksonpires/herdr-app-mod-manager` (MIT) | The table over every installed mod — on/off, check result, version, source, drift — install, update, remove; `⌘⇧M`. |
| `am-quota` | clean-room | **Accounts**, for people who run their own CLIProxyAPI: per tool (Claude Code or Codex), the account this computer uses and whether it lasts until its window resets, one button to switch to the next account on the proxy, and a restart of the bots still on the old one. **Ships switched off** (a fresh install puts it in `mods-disabled/`): turn it on in the Mods panel (*Automagik Accounts*), and the rail's Accounts tab then toggles it. An install that already has it keeps its state. |

**Not in this pack, on purpose:** Pocket Link ([mods/pocket-link](mods/pocket-link/README.md)) sits
beside the pack's mods but belongs to Pocket (`apps/pocket/`), which owns its mod, its LaunchAgent and
its pairing state. Install it from its README; this pack never vendors, installs, updates, removes or
restarts it.

## Add a sidebar button from your mod

Any installed mod can put a button in the footer rail. Declare it in your own `mods/<name>/mod.json`:

```json
"automagik": { "footer": [ { "id": "tasks", "label": "Tasks", "icon": "mods/genie-herdr/tasks.svg",
                             "command": "mod.open", "args": { "name": "tasks-mock" }, "badge": "genie.tasks.waiting" } ] }
```

- `id` (required): unique within your mod; the button's key is `<mod>/<id>`.
- `label` (required): the name the rail shows while the pointer is on the button.
- `command` (required) and `args` (an object, default `{}`): a press calls `run(command, args)`.
  `mod.open {name}` opens the mod and closes it on a second press, so the button toggles it.
- `icon`: an SVG under the app home (`~/.config/herdr-app`), drawn with `svg()` and tinted like the
  rail's own icons. A missing, non-SVG or outside path draws a neutral circle.
- `badge`: a `shared()` key. While its value is a number above 0, the button shows it as a small
  count (9+ past 9); 0, `null`, a string or no value shows nothing.

An entry with no `id`, `label` or `command`, an `id` used twice, or a `mod.json` that is not JSON is
skipped (the reason goes to the console). The rail shows at most 4 contributed buttons in all, by
mod name, then in the order each mod lists them, after the pack's own tabs and before Settings. They
sit in their own group, which clips when the sidebar is too narrow: the rail's own tabs always show.
A mod named `pocket-link` (in any case) cannot add buttons: the rail has its own Pocket Link tab and
does not read that folder. The rail reads every installed mod's `mod.json` every 30 s, and at once
when a `mod.json`, a mod folder or an SVG under `mods/` changes; it writes nothing.

## Wiring (your layout)

The installer does this for the `automagik` layout. To give a layout of your own the whole pack,
copy these from `~/.config/herdr-app/automagik-herdr/automagik.json` (the pack's copy) into it:

1. root: `"terminal_menu": "am-markdown"`;
2. the tab bar block: `"mod": "am-tabs"`, `"size": { "px": 42 }`;
3. the `spaces` block: `"mod": "am-sidebar"`;
4. the footer block: `"mod": "am-footer"` with `"props": { "footer": true }` and
   `"size": { "px": 42 }`;
5. the status bar block (`"id": "status"`, `"size": { "px": 28 }`): `"mod": "am-status"` in place of
   `workspace-status`.

`am-new-menu` (opened by the sidebar's and the tab bar's `+`), `am-mods` (`⌘⇧M`, the rail's
Mods tab), `am-automations` and `am-quota` need no block. The rail's clock and Accounts tabs open
those two as a popup over the rail. Don't give them a block: Herdr shows plain Herdr instead of a
layout that names a mod that is off ("needs mods that aren't here"), even in a hidden block, and
both ship off. A layout that already has an `automations-panel` or `am-quota-panel` block
keeps working: while the mod is on, its tab shows and hides that block instead.

## One installer

`install.sh` (above) installs every mod of the pack; there is no second installer. To try it on a
scratch home first: `HERDR_APP_HOME=$(mktemp -d) sh install.sh --yes`.

## Our marketplace

`catalog/index.json` is the index the mod manager reads, in the same shape `herdr.dev/mods`
publishes. `scripts/catalog.mjs` builds it from this checkout (`--refresh` re-reads
stars/licence/head from GitHub, `--check` verifies and exits 1 when stale). Strict gate: a mod of
ours must carry `RECIPE.md` and `LICENSE`, a curated repo needs a licence and an upstream
`RECIPE.md`, and a mod name has one owner — this pack first. Every refusal is printed.

## Pack layout

```
mods/        each mod this pack installs (bots first, then the sidebar and its tools)
catalog/     index.json (generated) · repos.json (the other repos we carry)
scripts/     catalog.mjs (build the index) · version.mjs · themes.mjs
keys.json    the keys the pack asks for
test/        the bot work's pure-module tests (node --test)
```

The one layout the pack ships is `../herdr-layout/layouts/automagik.json`, beside this folder, not in it.

## Develop

```bash
node --test 'test/*.test.mjs' && for f in mods/*/*.js mods/*/*.mjs mods/*/bin/*.mjs scripts/*.mjs scripts/*/*.mjs; do node --check "$f" || exit 1; done
```

The pure rules (project key, schema, leads, ids, looks) live in `mods/am-sidebar/model.js`
and import nothing from Herdr; so does the briefing's text (`briefingText.mjs`).
Model detection lives in `models.js` (`test/models.test.mjs`). `test/briefing.test.mjs`
runs `briefing.mjs` under node with a fake `hc` on `PATH`, and `test/cli.test.mjs` runs every
`automagik-herdr` command against scratch git projects with a recording fake `hc`
(`test/fake-hc.mjs`). `test/bots.test.mjs` runs `bots.js` against stand-ins for
Herdr's `herdr` and `fs/promises` modules (`test/herdr-stub.mjs`, `test/fs-stub.mjs`; the
second has only the seven functions Herdr gives a mod). A pass there does not prove the pack
works inside Herdr. Check that in Herdr itself.

## License

Apache-2.0 (`LICENSE`; the pack folder carries a copy). Two files are changed from Herdr's
`spaces` 0.1.7: `mods/am-sidebar/main.js`, which says so at its top, and
`mods/am-sidebar/mod.json`, whose `title` changed to "Automagik Sidebar". JSON can't
carry a comment, so the change to `mod.json` is noted here and in the repository history.
