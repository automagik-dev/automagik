# RFC 0014: Shared Bot registry

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | not scheduled |
| Lanes | plugin (3.N.P), desktop (3.N), herdr (3.N.P, [RFC 0011](0011-monorepo-parts-and-releases.md)) |
| Created | 2026-11-03 |

## Summary

The Bot team (DSH, `apps/bots-dsh`) and the Automagik Herdr pack (`herdr/`) keep Bots in two
places today, with two id shapes and two pet systems. This RFC proposes one Bot registry both
read and write: a `bots.json` version 2 in `~/.automagik/bots/` for Bots that belong to no
project, and in `<repo>/.automagik/bots/` for a project's Bots. It covers writes that never
overwrite each other, global Bots in Herdr, the desktop app's move to `~/.automagik/bots` (D6),
one pet folder, Bots on other machines, and the deliveries. RFC 0013's delivery 8 (shared Bots
in the switch) waits on it.

## Motivation

Felipe decided one registry and one way to register a Bot (D1), one main Bot per repo (D2),
DSH's global Bots as the level above the repo main Bots (D3), one pet system (D4, D11) and one
home (D5, D6). RFC 0013 ("Shared state") lists what the two modes need from this RFC. Today:

- The desktop app's team lives in `~/.automagik/desktop/bots` (`apps/desktop/src/dsh.js:707`,
  `AUTOMAGIK_BOTS_HOME`); a Bot team installed in the person's own dsh lives in
  `~/.automagik/bots` (`apps/bots-dsh/src/host/folders.js:23`). The split is on purpose:
  "neither sees the other's Bots or Sessions" (`dsh.js:11`).
- DSH keeps each Bot in `state.json`, written whole by one host at a time
  (`home-lock.js`). A Bot's id is the Session id of its first chat, `session-<uuid>` when DSH made it
  (`agents.js:381`), and never changes; `bot.sessionId` is the current Session
  (`store.js:402`).
- Herdr keeps a project's Bots in `<project>/.herdr/bots.json`, version 1 (`model.js:13`), with
  ids `b-` plus 10 base32 characters (`model.js:35`, refused otherwise at `:272`). It writes only
  if the file still holds the text the edit started from (`bots.js:275`,
  `automagik-herdr.mjs:184`). It reads other machines' files through herdr-core (`bots.js:41`).
- Pets: DSH reads `<team home>/pets` (`pets.js:68`); `automagik-pets bake` writes there
  (`apps/automagik-pets/README.md`). Herdr still draws its own vector characters.

Issues it links: #206 (Bots on linked machines), #226 (no workspace-level Bot), #227 (two
checkouts claim one pane), #230 (2-space JSON), #234 (edits on the main checkout block pulls).

## Decided and proposed

Decided by Felipe (handoff `bot-system-unification.md`): D1 one registry, home
`~/.automagik/bots`, a repo may keep a committable copy at `<repo>/.automagik/bots/`, replacing
`.herdr/bots.json`; D2 one main Bot per repo; D3 global Bots above repo main Bots; D4 one pet
system, Codex-pet compatible, Herdr renders pets; D5 the home is `~/.automagik/bots` on every
platform; D6 the desktop app's home merges into it, Felipe starts from scratch, migration is
optional and offered to others; D11 bake on demand into `~/.automagik/bots/pets/`; D27 one
registry RFC before the shared-Bot step.

Agreed between the two orchestrators (t259, t22n), not decided by Felipe: the id pattern,
`main` and `identity`, the pose map, the repo path and `version: 2`, and the order of the
pack's reads. Each one is an open question below, recommended as agreed.

Everything else in Design is this RFC's proposal.

## Design

### Two files, one format

- **The home file**, `~/.automagik/bots/bots.json` (`$AUTOMAGIK_HOME/bots`), holds global Bots
  (no folder) and Bots whose folder is in no project with its own file.
- **A repo file**, `<project>/.automagik/bots/bots.json`, holds that project's Bots. The project
  key is Herdr's: the main checkout (`model.js` `projectOf`). A repo opts in by having the file.
- **The legacy file**, `<project>/.herdr/bots.json`, stays version 1. It is read, and written in
  place, while it is the only file in the project; nothing writes version 2 there.

This draft is written as if each Bot lives in exactly one file, with no copies to keep in step.
D1's "committable copy" can also be read as a copy of home entries; Q1 puts the choice to
Felipe, and the other options change this section and deliveries 2-4.

The home file is in the registry home, `$AUTOMAGIK_HOME/bots`, always, whatever
`AUTOMAGIK_BOTS_HOME` says. So the desktop app and Herdr share Bots before the home move, and
still do if a person keeps two team homes (Q9).

### Schema, version 2

Top level: `version: 2`; `bots[]`; in a repo file, the optional `name` (the project's display
name) and Herdr's `categories[]`; in the home file, `projects[]`, the `{ folder, machine? }` of
each project with a repo file that either app has opened, so DSH can find them (Q12).

Per Bot:

| Field | Meaning | From DSH today | From Herdr v1 |
|---|---|---|---|
| `id` | opaque, never rewritten (Q3) | `id` | `id` |
| `name`, `role`, `instructions` | text | same | same |
| `identity` | the Bot's character: `omni`, `genie`, a user's own slug (D4) | `kind` | none |
| `main` | repo file: the project's main Bot (exactly one, D2). Home file: a team Main Bot | `mainBotIds` | `kind: "main"` |
| `pet` | `{ source: "builtin" \| "team", id }` | `avatar.pet` | `look` → `<character>-<colour>`, `team` |
| `folder`, `machine` | home file only; `machine` is an `hc machine` name, absent for this computer | `workDir` | the project key |
| `agent`, `model`, `worker`, `rank`, `lead`, `category`, `planned` | Herdr's seat and team fields | ignored | same |
| `dsh` | `{ model, effort, color }`, DSH's chat route and ink (Q14) | same | ignored |

DSH's ids are the ids of Sessions it made (`roster.js:203`, `createSession` at `:109`, which
takes DSH's `sessionController.create`). DSH mints `session-<uuid>` today, as every Session folder
on disk shows, but DSH does not promise that shape. A Session a host plugin hands over keeps the
host's id: the Unfold Bot adopts the root Session `unfold-root` by default
(`unfold-session-dsh/index.js:43`, `unfold-bot-dsh/src/host/unfold.js:81`). So DSH exports only
Bots whose id matches the contract pattern. A host-pinned Bot (`sessionPinned`) or any other id
stays in DSH alone, with one warning in its log (Q18).

`kind` is read only from each app's own legacy source (`.herdr/bots.json` v1, `state.json`),
never from a version 2 file.

Never in either file: memory, rooms, schedules, secrets, Sessions (`sessionId`, segments),
photos, permission levels, capabilities, browser grants or partitions. These stay in DSH's
`state.json` and folders, keyed by the same id, and in Herdr's app home.

### Writes under one lock

Every writer follows Herdr's rule today: keep the text the edit started from; just before
writing, read the file again; if it differs, save nothing. Then write a temporary file beside it
and rename it into place. A new file is created exclusively.

That compare alone is not enough. Herdr's in-app writer, `writeTextFile(path, text, expected)`
(`bots.js:285`), shares no lock with a Node writer, so DSH and Herdr can both pass the compare
from the same text, and the later rename drops the earlier edit. So every writer also holds one
lock, `bots.json.lock` beside the file, across the compare and the rename. The lock is the CLI's
existing one (`automagik-herdr.mjs:204-238`): an exclusive create holding a pid and a token, waited
for up to 3 s, taken over when older than 10 s, and removed only by its holder. The registry
module carries it, so DSH takes the same lock. The mod cannot: Herdr's file API has no exclusive
create, and the mod has no `fs`. So the mod's writes go through the CLI, which it already runs
through the pack's Node launcher (`bin/run.sh`) (Q6). Until delivery 2 does this, the race stays
as it is today between the form and the CLI.

- A write changes only the Bots and fields the person changed. Unknown fields and other Bots are
  kept as parsed, so DSH never drops Herdr's `rank` and Herdr never drops `dsh`.
- The indentation the file was found with is kept; a new file uses two spaces (#230).
- Herdr's form says "changed since this form opened", as now. DSH's own writes (a rename, a new
  Bot) redo the edit on the fresh text, up to three times, then notify.

DSH reads the files at load and when they change. A Bot it does not know is adopted: it is shown,
and it gets a Session the first time it is opened (`sessionId` set, `id` unchanged). Definitions
in the file win over `state.json`; a Bot gone from the file is handled by Q10. `state.lock` keeps
governing `state.json` only.

### Global Bots in Herdr

Global Bots are the home file's Bots with no folder (D3). Herdr lists them above the projects
(#226). One can be started in the team workspace (`<team home>/workspace`, DSH's folder for Bots
without one). Its briefing lists each project's main Bot with its status (Q11). RFC 0013 is
unchanged: a global Bot with a live pane is focused, otherwise Code opens on no space (D27).

### The home move (D6)

What changes: the desktop app sets `AUTOMAGIK_BOTS_HOME` to `<automagik home>/bots`
(`~/.automagik/bots`) instead of `<automagik home>/desktop/bots` (`dsh.js:707`,
`dsh.test.js:18`, the comment at `dsh.js:9`). What does not: the app's `DSH_HOME`
(`~/.automagik/desktop/dsh`), so every Session stays where it is; plugin ids (`omni-ui`,
`omni-ai`), routes (`/api/omni-ui`), browser-storage prefixes (`omni-ui:`), the files inside the
team home (README "Data and backups"), and the per-Bot browser partitions in Electron's data.

The team workspace needs care. `<team home>/workspace` is the folder of every Bot without one of
its own, and their Sessions were started there. The bots-dsh README says it is untested whether
dsh finds a Session whose folder moved. So the move does not copy `workspace/`: the moved team
keeps working in `~/.automagik/desktop/bots/workspace` (Q8). A fresh team uses
`~/.automagik/bots/workspace`.

At the first start of a new app:

`state.json` below is the team file at the root of a team home (`apps/bots-dsh/index.js:85`).
`~/.automagik/bots` may already be a team home: a Bot team installed in the person's own dsh
uses it by default (`folders.js:23`).

1. No old team and no `state.json` in `~/.automagik/bots`: the app starts there. Felipe's case
   (D6).
2. An old team, and no `state.json` in `~/.automagik/bots` (its `bots.json` and `pets/`
   may already be there from delivery 3): the app offers "Bring my Bots" once. Yes copies the
   old folder (never moves it) except `workspace/`, adds its `pets/` without replacing a pet of
   the same id, leaves `bots.json` alone, checks the copy, then writes `MOVED.json` (`to`, `at`,
   app version) in the old folder. No starts fresh. Either way the old folder is left as it
   was (Q8).
3. A `state.json` in `~/.automagik/bots`, from the person's own dsh, whether or not an old app
   team exists: the app does not move there, and the two teams are never merged (Q7). One home
   cannot serve two hosts: the second to load only reads (`home-lock.js:1-3`), and each host's
   Sessions are in its own DSH home.

Rollback: an older app reads `~/.automagik/desktop/bots`, still as it was when copied. What it
cannot undo: changes made after the move are only in the new home; the registry files stay, and
older apps ignore them.

### Pets in one system

One folder: `~/.automagik/bots/pets/` (D11). DSH's team pet source reads it from delivery 3, and
still lists `<team home>/pets` while the two differ. A look `{ character, colour }` is the pet
`<character>-<colour>`, baked on demand by `automagik-pets bake`; Herdr draws its
`frames/<row>-<n>.png` and keeps the vector character until the bake lands. Poses come from
`STATE_ROWS` and `EVENT_ROWS` in `apps/bots-dsh/src/client/pet.js` (Q5). Committed custom pets go
in `<repo>/.automagik/bots/pets/`. Pets not made by the bake, such as builtin `genie-clay` and
codex-pets.net pets, are Q13.

### Other machines

A repo file on a linked machine lives on that machine. Herdr reads it through herdr-core as
today; writing it there is #206, with the same compare-before-write (Q12). The home file is on
this computer; a Bot there may name a `machine` for its folder. DSH reads only this computer's
files. RFC 0013's main reads `folder` and `machine` to pick the space; an id DSH cannot find
opens the app with nothing selected, as 0013 already says.

## Contracts introduced

- **`~/.automagik/bots/bots.json`** (`$AUTOMAGIK_HOME/bots`), version 2. New.
- **`<repo>/.automagik/bots/bots.json`**, version 2, and `<repo>/.automagik/bots/pets/`. New.
  `.herdr/bots.json` stays version 1, read and written in place; packs older than delivery 2
  do not see a version 2 file.
- **Bot ids**: `^(b-[a-z2-7]{10}|session-[0-9a-f-]{36})$` in both apps. Herdr's `ID_SHAPE`
  widens (`model.js:35`, `:153`, `:272`). Existing ids are never rewritten.
- **The desktop app's team home**: `~/.automagik/desktop/bots` becomes `~/.automagik/bots`
  (delivery 6), except where Q7 keeps it. The team's home is a public contract (AGENTS.md:14,
  "Plugin ids, routes, storage prefixes and the team's home"), so this RFC changes it on
  purpose: AGENTS.md:14 gains the rule for the move, and README.md:30 ("From 3.12 the team's
  home ...") changes with it. Plugin ids, routes, storage prefixes and DSH_HOME do not change.
- **`MOVED.json`** in the old desktop home. New.
- **`~/.automagik/bots/pets/<id>/`**: the shared pet folder (D11), now also read by Herdr.

## Threat model

A repo file arrives with a clone, so its text is untrusted. Herdr already feeds a repo's
`instructions` to its main Bot's briefing; this RFC adds DSH as a reader.

- **What Herdr starts.** A repo file's `agent`, `model`, `worker.agent` and `worker.template`
  choose the program Herdr starts and its arguments (`automagik-herdr.mjs:1115-1152`). This is
  so today with `.herdr/bots.json`. The controls: the agent must be in Herdr's closed table
  (`models.js:14`, refused otherwise by `startableAgent`); worker fields may not start with a
  dash, and `worker.template` must match `TEMPLATE_SHAPE` (`model.js:72`, `:83-93`); the CLI's
  start refuses a seat model pin the agent does not list (A12, `automagik-herdr.mjs:1138`).
  **Known gap:** the parser does not refuse a seat `model` that starts with a dash
  (`model.js:170`, unlike the worker fields at `:88`), and `modelArgs` puts it after `--model`
  (`models.js:229-235`). t2x5 files it as an issue.
- **Fields a repo file cannot set.** `folder`, `machine` and `dsh` (DSH's model, effort and ink)
  are read from the home file only; in a repo file they are ignored. The schema has no level,
  capability, grant or secret field.
- **Pet ids** are checked as one path segment (`cleanPetId`, `pets.js:27`) before any path is
  made from them.
- **Instructions become a prompt.** A repo Bot's `instructions` become a DSH Bot's prompt once
  it is adopted. Herdr lists every repo it opens in `projects[]`, so that list is only an
  offer: DSH adopts a project's Bots only after the person says yes for that project, and keeps
  that yes in its own `state.json`, never in a file that could vouch for itself. Until then DSH
  shows "Bots in `<project>`" with Add, and makes no Session.
- **Level.** An adopted Bot gets the team's default level, as any new Bot does
  (`roster.js:222`). If that default is Full access, a repo Bot would start there; Q17 asks for
  a lower start.
- `identity` from a repo file sets the look only: Omni's or Unfold's tools come from DSH's own
  `kind`, never from the file (Q17).
- The home file is the person's own, like `state.json`: no new boundary. A remote machine's file
  is reached only through an `hc` machine link the person made.

Undo: delete the file, or revert the delivery; `state.json` keeps every DSH Bot.

## Failure modes

- A file that does not parse: the app shows its last good read with a warning and writes nothing
  until it parses (Herdr does this today).
- Windows refuses a rename over an open file: retry for up to a second, then not saved.
- A machine that is away: its Bots show stale, as Herdr does today (`bots.js:150`).
- A bake fails: the vector character stays; DSH falls back to `genie-clay` as now.

## Deliveries

1. **The registry module** (plugin). Parse, check and write-if-unchanged for version 2, readers
   for v1 and `state.json`, one `newBotId()`, in `apps/bots-dsh/src/shared/registry.js`. Nothing
   uses it yet. *Check:* unit tests on fixtures: Herdr's v1 test files, a `state.json`, unknown
   fields kept, a stale write refused. *Rollback:* revert; nothing reads it.
2. **Herdr reads version 2** (herdr). A byte-equal copy of the module (checked in the gate);
   `botsFileOf(key)`: the repo file, else `.herdr/bots.json`; `projectOf`'s walk-up finds both;
   the briefing hook follows; `session-` ids accepted; global Bots listed read-only; the mod's
   writes go through the CLI under the lock (Q6). Its one new write: a project with a repo file
   (v2 or legacy) that Herdr opens is added to the home file's `projects[]`, so DSH can offer it
   (it adopts nothing without a yes; see Threat model).
   *Check:* the herdr gate; a v2-only project shows its Bots and briefs its main Bot; a v1
   project is unchanged; the mod reads `~/.automagik/bots/bots.json`, which is outside any
   project and outside Herdr's app home (`bots.js:5` says Herdr's own file writes stay in its
   home); the CLI writes it; a form edit and a CLI edit started from the same text leave one
   saved and one refused. *Rollback:* a later pack that reverts it (the pointer never
   downgrades); v2 files stay and v1 projects never changed.
3. **DSH shares its Bots** (plugin). At its first load bots-dsh writes every Bot the home file
   lacks, then writes definitions on each change; it reads the home file and the listed local
   repo files (v2 or legacy), adopts unknown Bots, and reads pets from the registry home. First
   it checks every place that takes a Bot id for a Session id (`chatOf` at `store.js:413` falls
   back to the id), since adopted Bots have no Session until opened. *Check:* a Bot made in
   Herdr shows in DSH and opens a new Session; an adopted Bot with no Session breaks no list,
   search or usage count; a DSH rename shows in Herdr; two writers racing lose nothing.
   DSH keeps writing every definition field to `state.json` as well, and an adopted Bot enters
   `state.json` only when first opened, with its new `sessionId`. *Rollback:* revert. It holds
   because `state.json` still has every DSH Bot with current definitions; edits made in Herdr
   after the last DSH save are not in it, and the files stay. Bots adopted and opened under
   delivery 3 stay in `state.json` with `b-` (or another host's) ids. The older plugin lacks
   delivery 3's check, so wherever it takes a Bot id for a Session id, it fails for those Bots;
   their chats still open through `sessionId` (`store.js:413`). The check's list of places is
   copied into this rollback note when delivery 3 is written.
4. **Herdr writes version 2** (herdr). New projects get the repo file; "Move to .automagik"
   converts a legacy file (write new, then delete old); global Bots are created and started in
   Herdr. A converted project has no `.herdr/bots.json`, so a pack older than delivery 2 shows no
   Bots there until it updates through the herdr lane. *Check:* the gate; a converted project
   keeps its ids and panes. *Rollback:* a reverting pack; converted projects stay version 2,
   which delivery 2 still reads.
5. **Pets in Herdr** (herdr, after `automagik-pets` installs to `~/.automagik/bin`). Draw the
   `pet`, bake on demand, the pose map. *Check:* `herdr-app check am-sidebar`; a DSH look shows
   on the same Bot's row. *Rollback:* a reverting pack; vector characters return.
6. **The home move** (desktop). `AUTOMAGIK_BOTS_HOME`, the first-start offer, `MOVED.json`, and
   Q7's rule. *Check:* a fresh install uses `~/.automagik/bots`; "Bring my Bots" opens the old
   team with its chats; No leaves the old folder untouched. *Rollback:* as in "The home move".
7. **Other machines** (herdr, after #206). Writes to a linked machine's repo file with the same
   rule. *Check:* an edit from this computer lands there; a stale one is refused.
   *Rollback:* a reverting pack; that machine's files go read-only again.

RFC 0013's delivery 8 can start after deliveries 1-3.

## Open questions

1. **What is a repo's "committable copy" (D1)?** For Felipe; no recommendation, since the
   options read D1 differently.
   - A. *One file per Bot.* A project with a repo file keeps its Bots only there; the home file
     holds the rest. No syncing; a clone brings the Bots. A home Bot whose folder later gets a
     repo file stays at home until the person moves it. This draft is written this way.
   - B. *Home holds every Bot; the repo file is a copy the apps keep in step.* Needs a rule for
     which side wins when both changed, and for a clone whose copy is newer than home.
   - C. *Home holds every Bot; the repo file is an export the person commits.* It is read only
     when the person imports it, so a clone brings nothing until then.
2. **Repo path and version** (agreed). *Recommended:* `<repo>/.automagik/bots/bots.json`,
   `version: 2`, `pets/` beside it.
3. **Id shapes and the mint** (pattern agreed, mint open in the log). *Recommended:* accept both
   shapes forever; one `newBotId()` that mints `b-`; Herdr uses it now, DSH once delivery 3's
   check of ids used as Session ids has shipped.
4. **`main` and `identity`** (agreed). *Recommended:* as agreed; in the home file `main` means a
   team Main Bot, in a repo file the project's one main Bot.
5. **The pose map** (agreed). *Recommended:* working→running, idle→idle, needs-you→waving once
   then waiting, done→review, failed→failed, asleep→sleep strip, jumping as a one-shot event.
6. **How the Herdr mod takes the lock.** *Recommended:* the mod's writes go through the CLI,
   which takes the CLI's existing lock (`automagik-herdr.mjs:204-238`); DSH takes the same lock
   through the registry module. The other way, the mod making the lock with
   `writeTextFile(lock, token, null)` as an exclusive create, rests on behaviour Herdr does not
   document. If neither ships, the race is accepted and the section is renamed to say so.
7. **`~/.automagik/bots` is already another dsh's team home.** A Bot team installed in the
   person's own dsh lives there (`folders.js:23`). Two `state.json`s with Sessions in two DSH
   homes cannot merge, and two hosts on one home leave the second read-only (`home-lock.js:1-3`).
   *Recommended:* the app keeps its team in its old home, says why once, and still shares Bots
   and pets through the registry home (Q9). D6 is then not met for that person; Felipe may
   prefer another answer.
8. **The migration offer.** *Recommended:* copy, never move, everything but `workspace/`;
   offered once; the moved team keeps its old workspace folder; the old folder kept until the
   person deletes it.
9. **The registry home apart from the team home.** *Recommended:* the registry and pets always
   at `$AUTOMAGIK_HOME/bots`, so sharing does not wait for the move.
10. **A Bot removed in Herdr.** *Recommended:* DSH hides it and keeps its chats and memory,
    with Restore and Delete; nothing is archived without the person.
11. **Global Bots (#226).** *Recommended:* no membership field yet: every global Bot is above
    every project; its briefing shows each project's main Bot and status; messages do not fan
    out.
12. **Which repo files DSH reads, and other machines.** *Recommended:* the home file's
    `projects[]`, this computer only; an entry whose file is gone is dropped by the next reader
    that finds it gone (Herdr's #229 has the same gap). Bots on other machines are reached
    through Code.
13. **Pets the bake cannot make** (`genie-clay`, market pets). *Recommended:* `automagik-pets
    frames <id>` cuts Herdr's frames from any v1 or v2 spritesheet; builtin pets are copied into
    the shared folder.
14. **One model field or one per app?** *Recommended:* per app: Herdr's `agent`, `model` and
    `worker`, DSH's `dsh.model` and `dsh.effort`, until RFC 0003's ACP route makes one possible.
15. **Where the module lives.** *Recommended:* `apps/bots-dsh/src/shared/registry.js`, with a
    byte-equal copy in `herdr/mods/am-sidebar/` that both gates check; a schema change ships
    plugin first, then herdr, and readers keep unknown fields.
16. **Clones and the main checkout (#227, #234).** *Recommended:* a pane is matched by project
    and id; edits from a worktree are written in that worktree, reads stay on the main checkout.
17. **Trust in a repo file.** *Recommended:* as in the Threat model: adoption per project on an
    explicit yes; `identity` never grants a plugin's tools; a Bot adopted from a repo starts at
    a level that asks before acting, whatever the team default, until the person changes it.
18. **Ids DSH did not mint as `session-<uuid>`.** Host-pinned Bots (Unfold's `unfold-root`) and
    any id outside the pattern. *Recommended:* they stay DSH-only and are not exported; widening
    the pattern to any opaque id is the other option, and it would let Herdr show Bots it can
    never start.

## Links

- Handoff: `~/.config/herdr-app/handoffs/bot-system-unification.md` (D1-D6, D11, D27;
  "Agreed between orchestrators"; "Headless bake design").
- RFCs: [0013](0013-work-code-switch.md) "Shared state" and delivery 8;
  [0011](0011-monorepo-parts-and-releases.md) lanes and the herdr pointer;
  [0003](0003-model-routes-and-acp.md) model routes; [0010](0010-desktop-sandbox.md).
- Code: `apps/desktop/src/dsh.js:707`; `apps/bots-dsh/src/host/{folders,home-lock,roster,store,pets}.js`;
  `apps/bots-dsh/src/client/pet.js`; `herdr/mods/am-sidebar/{model,bots,create,briefing}.js`,
  `bin/automagik-herdr.mjs`; `apps/automagik-pets/`.
- Issues: #206, #226, #227, #230, #234.
