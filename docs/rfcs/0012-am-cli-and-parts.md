# RFC 0012: am, one CLI and parts

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | not scheduled |
| Lanes | herdr (3.N.P), plugin (3.N.P), pocket (3.N.P), desktop (3.N); see [0011](0011-monorepo-parts-and-releases.md) |
| Created | 2026-11-03 |

## Summary

Automagik gets one command, `am`, for everything it installs. Bot verbs stay at the top level,
as in `automagik-herdr` today, and every other part gets its own noun group (D22). Every part
(a DSH plugin, a herdr mod, the layout, the CLI, usagemeter, the desktop app) carries a
`part.json` and can be installed, checked, rolled back and uninstalled on its own, as a set
(`code`, `work`) or all together. Parts depend on versioned capabilities, not on each other's
ids, so anyone can fork a part and swap it in. This RFC fixes the manifest, the install record,
the entry contract, the trust rules and the order of deliveries. RFC 0013's "One install"
(delivery 7) runs through it.

## Motivation

The owner wants one Automagik that "delivers each relevant part individually too", where anyone
builds their own (owner direction 2026-11-03 (2), via t22n). Today each part has its own
installer and its own record: `herdr/install.sh` and the pack marker, DSH's plugin lane in the
desktop app, usagemeter's binary, Pocket's APK. There is no single command that says what is
installed on a machine, whether it works, and how to undo it. RFC 0013's switch needs that
answer ("Set up", "Update due"), and so does fleet work over Herdr's machines.

Sources: `pocket-into-automagik-monorepo.md` ("One `am` CLI", "Parts", the eight rules revised
after t22n's review); `bot-system-unification.md` (D22, D25, D27, D28);
`herdr-parts-questions-t2zx.md` (t2zx's defaults, all accepted by t22n); RFCs 0010, 0011, 0013
and 0014.

## Decided and proposed

Decided (the log): D22 (one `am`, bot verbs on top, noun groups, `am update` for every part,
`automagik-herdr` kept as a byte-identical alias for at least one bridge cycle); D25 (plugins
update on their own); D27 (one install sets up DSH, herdr-app and the pack); D28 (targets); the
handoff's eight rules; t259 and t22n's two rules (a) and (b) below; t2zx's defaults 1 to 5.

Proposed here, open to the owner: everything else. Where a sentence below proposes rather than
records, it says "proposed". The open questions list the choices the log leaves open.

## Design

### The command

`am` is one Node entry. Its shape is D22's:

- Top level, one-to-one with `automagik-herdr`: `ls show create edit rm start attach detach
  whois brief worker category`. They act on the shared Bot registry (RFC 0014).
- Parts, top level: `am install`, `am uninstall`, `am update`, `am doctor`. Proposed:
  `am rollback <id>` and `am parts` (what is installed, per machine), since `am ls` is taken by
  Bots.
- Noun groups: `am herdr …` (mods, layouts, restart, doctor), `am meter …`, `am pets bake|ls …`,
  `am pocket pair|link …`, `am desktop open|logs …`. A future clash between a top-level verb and a
  part goes to the part's group, never to the top level.
- Every command takes `--json` and prints one JSON value or JSON lines. Exit codes: 0 done or
  healthy, 1 failed or broken, 2 not applicable (proposed for the shell; the doctor's are
  decided, below).

`automagik-herdr` stays an alias whose output is byte-identical to `am`'s for the same verb: the
briefing hook in 62 settings files, Bots' instructions, workers' briefs and Brain's frozen
`whois --json` depend on it. The alias is retired only after a bridge cycle, by its own RFC
change.

### Parts and `part.json`

A part is a folder with a `part.json` at its root, beside the part's own manifest (a DSH
`package.json`, a herdr `mod.json`), which it never repeats. Fields (Contracts has the example):

| Field | Meaning |
|---|---|
| `id` | Public contract, like plugin ids: never renamed. A fork takes a new id. |
| `title` | What `am parts` and the desktop show. |
| `kind` | `dsh-plugin`, `herdr-mod`, `herdr-layout`, `binary`, `android-app`, `desktop-app`. |
| `paths` | Repository globs that rebuild it. `scripts/lane.ts` derives lane kinds from them. |
| `provides` | Capabilities it offers, `name@major`. |
| `requires` | Capabilities it needs, `{cap, major}`. |
| `os` | `macos`, `linux`, `windows`. |
| `targets` | `local`, or `fleet` (every connected machine, under the part's own consent). |
| `artifact` | Release asset name, `{version}` filled by the release. |
| `select` | Subpath inside a shared artifact. |
| `entry` | `install`, `uninstall`, `doctor`, optional `rollback`: argv arrays. |
| `replaces` | Optional: ids this part stands in for (a fork names the part it swaps out). |
| `writes` | Paths and globs it writes outside its folder; `#` names a key inside a file. |
| `set` | Bundles that include it by default: `code`, `work`. |

No version field: a part's version is the release's `vX.Y.Z`, stamped into the artifact by the
release (the one-version rule); a manifest with `version` is refused.

The herdr parts, as built on `feat/herdr-parts` (t2zx, `6b5dbba5`, WIP; its write-up is
`herdr-parts-for-rfc-0012.md`). Eleven parts, all `targets: local`, `set: ["code"]`, artifact
`automagik-herdr-pack-{version}.tgz`, and today `os: ["macos"]` only (question 10):

- One `herdr-mod` part per pack mod: `herdr.am-sidebar`, `herdr.am-automations`,
  `herdr.am-footer`, `herdr.am-markdown`, `herdr.am-mods`, `herdr.am-new-menu`, `herdr.am-quota`,
  `herdr.am-status`, `herdr.am-tabs`. `part.json` ships inside each mod folder of the tarball.
  `select` is the tarball's real layout (`am-sidebar/`, `am-footer/`), which has no `mods/`.
- `herdr.cli` (`binary`) at `herdr/mods/am-sidebar/bin/part.json`, `select` `am-sidebar/bin/`. It
  owns the `automagik-herdr` link, and `am` once the pack ships `bin/am` (rule 8), so the
  sidebar and the CLI can be swapped separately.
- `herdr.layout` (`herdr-layout`) at `herdr-layout/part.json`, `select` `layouts/`: in the tarball
  `herdr-layout/automagik.json` is `layouts/automagik.json`. One function, `repoPathOf` in
  `herdr/scripts/parts.mjs`, maps tarball paths to the repository's.
- One entry script, `am-sidebar/bin/part.mjs <install|uninstall|doctor> <id>`, run from the
  part's folder: `["node", "bin/part.mjs", …]` for the sidebar, `["node", "part.mjs", …]` for
  the CLI, `["node", "../am-sidebar/bin/part.mjs", …]` for the other mods and the layout. That
  relative path works because of rule (a): the whole tarball is there. No rollback entry.
- `writes` (`~/` is the home, `**/` any project; the entries honour `HERDR_APP_HOME`): am-sidebar
  the marker, `automagik-herdr/.prev/**`, `briefing.mjs`, `hooks-journal.json` and the per-project
  briefing hooks (`**/.claude/settings.local.json#hooks.UserPromptSubmit`); am-mods
  `~/.config/herdr-app/keys.json#global.cmd-shift-m`; herdr.cli `~/.local/bin/am` and
  `~/.local/bin/automagik-herdr`; herdr.layout `~/.config/herdr-app/layouts/automagik.json`.
- The pack's gate, `herdr/scripts/parts.mjs --check`, checks every `part.json` under `herdr/` and
  `herdr-layout/`: the fields, `paths` against tracked files, `select` as the part's own folder,
  entry scripts shipping in the tarball, and `writes` (it refuses `shared.json`, `data/`,
  pocket-link, LaunchAgents, and any path not starting `~/` or `**/`). Every `PACK_MODS` folder
  must have one.
- None declares `~/.local/bin/usagemeter`: that becomes
  usagemeter's own part (t22b); `install.sh` and `am meter` keep handling it until then.
- Pocket Link (`herdr/mods/pocket-link`) is on the herdr lane but is not a pack member (it is
  never in `PACK_MODS`, and the pack never writes it). Proposed: its own part, owned by Pocket.
  Pocket itself (`android-app`) installs nothing on a computer: proposed, its doctor reports 2
  there, and `am pocket pair` is how a phone joins.

### Capabilities and replacement

Parts depend on capabilities, never on ids (rule 1). The one version bumps on every merge and
forks have none, so a frozen contract is a capability major. `bots.registry@1` is the registry's
(RFC 0014). The herdr parts provide:

| Part | Provides | Requires |
|---|---|---|
| `herdr.am-sidebar` | `bots.sidebar@1`, `herdr.pack@1` (the updater and the record) | nothing |
| `herdr.cli` | `bots.cli@1`, `bots.attach-ledger@1`, `bots.whois-json@1` (Brain pins it) | `herdr.pack@1` |
| the other mods | `herdr.automations@1`, `herdr.footer@1`, `herdr.markdown@1`, `herdr.mod-manager@1`, `herdr.new-menu@1`, `herdr.quota@1`, `herdr.status-bar@1`, `herdr.tabs@1` | `herdr.pack@1` |
| `herdr.layout` | `herdr.layout@1` | `bots.sidebar`, `herdr.footer`, `herdr.tabs`, `herdr.status-bar`, `herdr.automations`, `herdr.quota`, `herdr.markdown`, each `@1` |

- `am install` resolves `requires` through `provides` and shows a dry run first: what it adds,
  what it replaces, what it removes.
- Two installed parts may not provide one capability. A fork keeps the `provides`, changes the
  `id` (`me.my-sidebar`), and names the part it swaps out in `replaces`. `am install <source>`
  then uninstalls the old part (or switches it off, for a pack member) and installs the new one.
- Proposed: `am uninstall` refuses to remove the only provider of a capability another installed
  part requires, and its dry run names those parts.

### Sources and trust

| Source | How | Checked against | Recorded |
|---|---|---|---|
| Release (default) | `am install <id>` | the lane's signed pointer | `signed: true`, lane, sequence |
| Path | `am install ./path --trust` | nothing; proposed: a hash of the tree at install | `signed: false`, the path |
| Git | `am install git+<url>@<sha> --trust` | the commit (proposed: 40 hex characters only) | `signed: false`, url and sha |

Release parts are verified the way `herdr/install.sh` and the pack's updater already verify
(RFC 0011): the pointer, its signature against the installed trust anchor, then the artifact
against the sha256 the pointer names, before anything is written. Each lane has its own key:
`herdr-lane` (`pack.json`, `HERDR_PACK_KEY`), `plugin-lane` (`lane.json`, `PLUGIN_LANE_KEY`).
`pack.json` names one sha256 for the whole tarball, so every pack member records the tarball's
hash; a per-member hash would need a new pointer field (rule 5: a part's sha256 comes from the
pointer, never from the download). Pocket's `latest.json` is unsigned on purpose (the APK's
signer is the check); usagemeter's trust is open (questions).

**Rule (a), agreed by t259 and t22n.** For a release source, am verifies the pack tarball against
the signed pointer's sha256, extracts the whole tarball to a staging folder, and runs each entry
with `AM_PART_DIR=<extracted>/<select>` and `AM_ARTIFACT=<verified tgz path>`. The herdr entry
prefers `AM_ARTIFACT` and installs the pack through the tarball's own `update.mjs install
--setup` (unless the marker already names `AM_VERSION`), with `stagePack`'s checks unchanged.
Without it, `AM_PART_DIR` may also be a checkout's folder (a path source).

Path and git sources need `--trust` once per id and source. `am doctor` keeps listing them as
"unsigned, from <source>" for as long as they are installed.

### Downgrades and rollback

- am refuses a pointer whose sequence is lower than the one installed (rule 4), the rule
  `install.sh` and the release already apply. During the bridge the herdr parts' sequence is the
  marker's `sequence=`.
- An on-purpose downgrade is `am install <id> --version <v>`, as `install.sh --version`: checked
  against that release's `.sha256` alone (integrity, not who published it), recorded with no
  sequence, and said so.
- am keeps the previous artifact of every part. When install fails, or the doctor run after it
  exits 1, am rolls back: `entry.rollback` when the part has one, else the install entry run
  again on the kept artifact. The herdr parts have no rollback entry, so am restores the kept
  tarball; the pack's own `.prev/` stays the updater's kept set. `am rollback <id>` does the same
  by hand.
- A shared artifact is one unit. The pack installs and updates as a whole (`stagePack` accepts
  only exactly `PACK_MODS`), so installing or updating any member installs or updates the pack,
  and all members carry one version.

### One member of a shared pack

**Rule (b), agreed by t259 and t22n.** Uninstalling one member of the pack (an am-* mod) switches
it off: the folder moves to `<app home>/mods-disabled/`, as the mod manager does, and parts.json
records it as `disabled`. Its doctor reports it as not applicable (exit 2). A pack update keeps
it off: the updater updates it in place in `mods-disabled/` (t2zx's change to `update.mjs`, which
also fixes today's bug where an update puts a second copy of a mod the manager switched off back
into `mods/`). `am install <id>` switches it back on, and installs the pack first when none is
installed. The marker's `mods=` stays as it is. Uninstalling the whole pack part,
`herdr.am-sidebar` (it carries the updater, the record and the CLI), removes the pack for real
with `install.sh --uninstall`'s logic: the folders, on or off, go to the kept set `.prev` (deleted
with `--purge`), adopted folders come back, and the pack's briefing hooks (each file backed up as
`.am-backup`), keys, links, the layout it added and the marker are removed. Uninstalling
`herdr.layout` removes the layout while it is byte-equal to the pack's copy and records
`layout=removed`, so no update or repair puts it back.

### The entry contract

- Entries are argv arrays, never bare paths: Windows runs no shebangs. Proposed: am runs them with
  the part's folder as the working directory, resolves a relative argv path against it, and runs
  `node` as the Node am itself runs on.
- am sets `AM_HOME` (`$AUTOMAGIK_HOME`, else `~/.automagik`), `AM_PART_DIR`, `AM_ARTIFACT` (release
  sources), `AM_VERSION`, `AM_MACHINE` and `AM_JSON=1`. am appends `--purge` to the uninstall
  argv when asked.
- install and uninstall are idempotent. Uninstall keeps user data unless `--purge`. They log to
  stderr and print one stdout line, `{part, ok, changed, detail}` with `AM_JSON=1`, else the
  detail.
- doctor is read-only and finishes in under 30 s (Herdr's exec cap). The herdr doctors run no
  program and no network and take milliseconds.
- Exit 0 healthy, 1 broken, 2 not applicable (a switched-off member, an OS the part does not list).

### Doctor

A doctor prints JSON lines `{part, check, ok, detail, fix}`; am fills `part` when an entry leaves
it out, and adds `machine` when it runs across machines. `fix` is the exact command, or null when
no command fixes it. The herdr checks: every part `record` (the marker exists) and `version`; the
mods `listed`, `folder`, `files`; the sidebar also `pack-version`, `pack-mods`, `briefing-entry`;
am-mods `keys`; the CLI `command`, `am`, `path` (`~/.local/bin` on PATH), `node` (22.7 or later);
the layout `layout`, `layout-json`. Their `fix` is `am install <id>`, the `install.sh` one-liner
for a missing pack folder, or the PATH or brew command. am adds its own
checks per part (proposed names): `am.source` (signed, or "unsigned, from <source>"),
`am.sequence`, `am.artifact` (the kept artifact still matches its sha256), `am.writes` (each
declared path present), `am.capabilities` (no unmet `requires`, no two providers). `am doctor`
exits 1 when any part is broken, else 0. RFC 0013's switch reads it to show "Set up".

### The install record

`~/.automagik/parts.json` (`$AUTOMAGIK_HOME/parts.json`), written only by am, keyed by machine
(rule 3). For each part: id, version, source (release, path or git), sha256, signed, and
(proposed) state (`installed` or `disabled`), lane and sequence, provides, the kept artifact's
path, and when. Proposed: writes go through one lock file (an exclusive create, as RFC 0014's
registry does) and an atomic rename; kept artifacts live in `~/.automagik/parts/`, named by
sha256, so one pack tarball is kept once for all its members.

**One install authority at a time (rule 2).** During the bridge cycle the pack marker,
`<app home>/automagik-herdr/installed-by-install.sh` (version, mods, sequence, usagemeter
machines and scope, the rollback set), stays the record for herdr parts. am reads it and never
writes it; parts.json only points to it. The herdr entries write it, through `update.mjs`, as
`install.sh` does today. After the bridge, am migrates the marker once, the herdr entries stop
writing it, and parts.json becomes the only record.

### Machines and fleet installs

`targets: fleet` means every connected Herdr machine, under the part's own consent (local,
everywhere, none), as am-quota and usagemeter ask today. `am install <id> --machine M` installs
on one machine. Proposed:

- am runs the remote side as `hc exec --on M am install <id> --json`. The remote am fetches from
  its own pointer and verifies with its own trust anchor; no bytes are pushed from here.
- A path source is refused with `--machine` (whose path is it?). A git source runs on the remote,
  with `--trust` confirmed here.
- `am doctor --machine all` runs each machine's doctor in parallel with a timeout per machine; a
  machine that does not answer is one line, `ok: false`, with its error.
- parts.json is keyed by hc's machine name. This machine writes its own entry; a remote's entry
  here is only its last report, marked with when it came.

### Operating systems

Supported targets are D28's: macOS arm64, Linux x86_64 and aarch64, Windows x86_64. Intel Macs and
Windows on ARM are not supported: the code set is refused there, and RFC 0013's switch never
shows. am refuses a part whose `os` does not list this one, and its doctor reports 2. The herdr
parts list only `macos` today, so on Linux and Windows the code set's pack parts are refused
until they add those OSes (question 10). Argv entries
and running `node` by am's own path keep entries portable. Proposed for Windows: `~/.automagik`
is `%USERPROFILE%\.automagik`, and the `am` and `automagik-herdr` links are `.cmd` shims in a
folder am adds to the user's PATH.

### The sandbox

D27's one install is "sandboxed"; RFC 0013 (Decided 2) puts herdr-app on now and the fence later.
am follows RFC 0010's supervision rule now: entries get an allowlisted environment (the `AM_*`
variables, `HOME`, `PATH`, `USER`, `LANG`, `TMPDIR`, `HERDR_APP_HOME`, and Windows' system
variables), never a spread of am's own. Entries run outside the DSH server fence, as RFC 0013's
launch does, because they write outside any instance home. `writes` is the list a later fence
enforces; for now doctor checks it and uninstall removes it. am refuses a manifest whose `writes`
names anything Herdr owns (`shared.json`, `data/`) or another part's files (rule 7).

### Updates

`am update` updates every installed part from its own pointer (D22). It never becomes a second
writer where a part already updates itself: DSH plugins install only through DSH (`dsh plugin`)
and apply their updates on their own (D25), and the desktop app keeps its feed. For those, `am
update` asks the owner (the desktop app, the pack's updater) and reports.

## Contracts introduced

- **`part.json`** at each part's root. Its `id` is permanent. Example (a pack member, as built):

  ```json
  {
    "id": "herdr.am-footer",
    "title": "Footer",
    "kind": "herdr-mod",
    "paths": ["herdr/mods/am-footer/**"],
    "provides": ["herdr.footer@1"],
    "requires": [{ "cap": "herdr.pack", "major": 1 }],
    "os": ["macos"],
    "targets": "local",
    "artifact": "automagik-herdr-pack-{version}.tgz",
    "select": "am-footer/",
    "entry": {
      "install": ["node", "../am-sidebar/bin/part.mjs", "install", "herdr.am-footer"],
      "uninstall": ["node", "../am-sidebar/bin/part.mjs", "uninstall", "herdr.am-footer"],
      "doctor": ["node", "../am-sidebar/bin/part.mjs", "doctor", "herdr.am-footer"]
    },
    "writes": [],
    "set": ["code"]
  }
  ```
- **Part ids** the eleven `herdr.*` above, and one per `apps/*` part as each owner adds it.
- **Capabilities** listed above. A major is never reused for an incompatible change.
- **`~/.automagik/parts.json`** and **`~/.automagik/parts/`**. New. am is the only writer.
- **Entry variables** `AM_HOME`, `AM_PART_DIR`, `AM_ARTIFACT`, `AM_VERSION`, `AM_MACHINE`,
  `AM_JSON`; `--purge` appended to uninstall. **Entry result** `{part, ok, changed, detail}`.
  **Doctor lines** `{part, check, ok, detail, fix}` (proposed:
  plus `machine`) and exit codes 0, 1, 2.
- **`am` verbs** above; `automagik-herdr` unchanged and byte-identical.
- **`<app home>/mods-disabled/`** now also holds pack members switched off by am. Compatible: the
  mod manager already uses it, and `verifyInstall` and `repair` already leave it alone.

## Threat model

- **Unsigned sources.** A path or git part runs its entries as the person. `--trust` is the
  boundary. The sharp case is a prompt-injected Bot, inside DSH, running `am install
  git+<url>@<sha> --trust`. Proposed: `--trust` needs a confirmation typed at a TTY or given in
  the desktop app's dialog; the flag alone, with no TTY, is refused. Release parts need no
  confirmation: they are signed.
- **Release parts.** As safe as their pointer's key (RFC 0011). A replayed older pointer is
  refused by sequence. Someone who can write release assets but has no key can only deny updates.
- **Entries writing outside their folder.** `writes` is declared and doctor checks it; rule 7
  stops a part from claiming Herdr's files or another part's. Not enforced by a fence yet.
- **Fleet.** `hc exec --on` runs am on a machine the person already connected to Herdr; each
  machine verifies on its own, so a compromised controller cannot push bytes, only ask for a
  signed part (or an unsigned one the person confirmed).
- **Undo.** Every install keeps the previous artifact; `am rollback` and `am uninstall` undo it.
  A `--purge` cannot be undone.

## Deliveries

Each delivery is one PR on one lane. Lanes for 2 and 3 depend on question 1 (shown with its
recommendation).

1. **Herdr part manifests** (herdr; t2zx, `feat/herdr-parts`). `part.json` for every pack member,
   `herdr.cli` and the layout; `am-sidebar/bin/part.mjs`; `herdr/scripts/parts.mjs --check`;
   switched-off members kept off by updates and rollbacks (t2zx's `0deadda2`).
   *Check:* the pack's gate with `parts.mjs --check`; `herdr-app check`, `catalog.mjs` and
   `entries.mjs --check` accept the files; each doctor prints valid lines and exits 0, 1 or 2; a
   member in `mods-disabled/` stays there across an update and a rollback.
   *Rollback:* revert the pack. The manifests are inert without am.
2. **The am shell** (herdr). Dispatcher, help, `--json`, exit codes, the top-level Bot verbs, the
   `automagik-herdr` alias; `scripts/lane.ts` reads part paths (same PR, per the handoff).
   *Check:* every verb's output is byte-identical under `am` and `automagik-herdr`, `whois --json`
   included; `lane.test.ts` gives the same kinds as before for its existing cases.
   *Rollback:* revert. The alias is the old command.
3. **Parts, local, release source** (herdr). Resolver, parts.json, install, uninstall, doctor,
   rollback and update; reads the marker during the bridge.
   *Check:* on a temp home with a `file://` pointer signed by a per-run key: `am install code`
   then doctor exits 0; a doctor forced to fail rolls back; a lower sequence is refused;
   `am uninstall herdr.am-quota` switches it off, an update keeps it off, `am install` puts it
   back; uninstalling `herdr.am-sidebar` removes the pack and keeps user data. The same run on a
   fresh macOS, Linux and Windows runner (#191's harness). RFC 0013 delivery 7 waits on this.
   *Rollback:* revert; `install.sh` and the pack's updater still work, and the marker is intact.
4. **Path and git sources, `--trust`, `replaces`** (herdr).
   *Check:* a fork of the sidebar with the same `provides` swaps in and back; two providers are
   refused; doctor lists the fork as unsigned; `--trust` without a TTY is refused.
   *Rollback:* revert; an installed fork stays, listed as unsigned, until it is uninstalled.
5. **The `apps/*` parts** (one PR per owner and lane): Bot team and plugins (plugin, through
   `dsh plugin`), pets and the desktop app (t259's worker), usagemeter (t22b), Pocket and Pocket
   Link (t16r).
   *Check:* each part's doctor in `am doctor`; `am install work` on a fresh machine.
   *Rollback:* revert each; the part's own updater is unchanged.
6. **Fleet** (herdr). `--machine`, `targets: fleet`, `am doctor --machine all`.
   *Check:* two machines in a test Herdr (the second over `hc machine add` with a command);
   install and doctor on both; a dead machine is one failed line.
   *Rollback:* revert; local installs are unaffected.
7. **The bridge ends** (herdr). am migrates the marker into parts.json once; the herdr entries
   stop writing it.
   *Check:* migration twice gives the same file; an old pack updater still reads a marker left
   in place.
   *Rollback:* the migration leaves the marker where it was, read-only; reverting goes back to it.

## Open questions

1. **Where does the `am` shell live, and which part installs it?** Rule 8 gives `herdr.cli` the
   `am` binary; D22 says every part's installer installs it; t2zx's default 3 links `am` once the
   pack ships `bin/am`. Recommended: in the pack, under `herdr.cli`, on the herdr lane, with
   `herdr.cli` in both sets (`code` and `work`) so a work-only install has `am` too.
2. **How does `am` first arrive, and on which Node?** Recommended: two bootstraps, both verifying
   the herdr-lane pointer: the `install.sh` one-liner, and the desktop app's "Set up" (RFC 0013
   delivery 7). Node: the pack's floor (22.7) until RFC 0010's question 2 (a separate Node) is
   answered, then that Node.
3. **herdr-app as a part.** Its bytes are herdrdev's, checked against the sha256 in its feed, not
   our signature. Recommended: a part of ours (`code` set) whose install entry downloads the
   feed's build and checks its sha256, and whose doctor says "third party, feed-checked".
4. **Architecture in `os`.** D28's targets carry an architecture; `os` does not. Recommended: am
   applies D28's list to every part, and `os` stays OS-only until a part needs more.
5. **usagemeter's trust.** Its `SHA256SUMS` proves integrity, not provenance (handoff). Recommended:
   sign a usagemeter pointer as herdr-lane does, or pin its hash in the part (t22b decides).
6. **A per-member hash.** Members record the tarball's sha256. Recommended: keep it; the pack is
   one unit, and a new pointer field buys nothing.
7. **`--trust` from a Bot.** Recommended as in the threat model: TTY or the desktop dialog only.
8. **Path sources over `--machine`.** Recommended: refused; a git source works instead.
9. **parts.json's machine key.** Recommended: hc's machine name, so it matches `--machine` and
   Herdr's spaces.
10. **The herdr parts are macOS-only today** (`os: ["macos"]`; their entries exit 2 elsewhere),
    but D27 and D28 want the one install on macOS, Linux and Windows, and RFC 0013 delivery 7
    checks all three. Recommended: add `linux` in delivery 1 or 3 (the launcher and `install.sh`
    are POSIX sh), and `windows` with its own delivery, which ports the launcher and links (the
    `.cmd` shims above) and replaces am-quota's Keychain reads. Until then RFC 0013's "Set up"
    shows on macOS only.

## Links

- Handoffs: `~/.config/herdr-app/handoffs/pocket-into-automagik-monorepo.md` ("One `am` CLI",
  "Parts"); `bot-system-unification.md` (D22, D25, D27, D28); `herdr-parts-questions-t2zx.md`.
- RFCs: [0010](0010-desktop-sandbox.md) sandbox, [0011](0011-monorepo-parts-and-releases.md)
  parts and releases, [0013](0013-work-code-switch.md) the switch (delivery 7),
  [0014](0014-shared-bot-registry.md) the Bot registry.
- Code: `herdr/install.sh`, `herdr/mods/am-sidebar/update.mjs` (`stagePack`, `verifyInstall`),
  `release.js` (`PACK_MODS`), `herdr/mods/am-mods/core.js` (`OFF_DIR`), `scripts/herdr-lane.ts`,
  `scripts/lane.ts`. Branch `feat/herdr-parts` (t2zx). Cross-OS harness #191.
