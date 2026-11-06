# Claude logins signed in on this Mac (#453) — design note

Status: **design only, nothing built.** Refs #453, #424. Owner decisions of 2026-11-06: the copy
test is dropped; Claude reaches a machine only through that machine's own Anthropic sign-in, one
per account it needs; a Claude login is never copied from the proxy, which keeps its logins for
quota reading only; Codex stays as it is. A second Claude login exists **on the Mac only**.

This note supersedes, for Claude on the Mac, what `DESIGN.md` and `RECIPE.md` say about Claude
accounts being added on the proxy and installed from it. Those files change in the build PR, not
here. Codex's card, its proxy download and its `auth.json` write are out of scope and stay
byte-identical.

## The constraint

**No two places may hold the same grant.** A grant is one sign-in's token chain: Anthropic rotates
the refresh token on use, so two holders of one chain sign each other out (seen on 2026-11-06 at
00:09Z, when the proxy renewed an account the panel had copied into the Mac's Keychain, and every
Claude pane on the default login stopped that minute). So:

- every login on the Mac comes from its own `claude auth login`, run by the person;
- a switch only changes **which existing login new launches use**; it never copies, moves, merges
  or restores a credential, and never writes the Keychain;
- the panel never reads a token, never reads or writes a Claude Keychain item, never runs a login
  or a logout, and never downloads a Claude credential from the proxy.

## 1. Where each login lives

Two logins, **A** and **B**, one per account.

| | Login A (the one signed in today) | Login B (the second sign-in) |
|---|---|---|
| Config folder | `~/.claude` | **`$HOME/.claude-2`** |
| Global state file | `~/.claude.json` | `$HOME/.claude-2/.claude.json` |
| `CLAUDE_CONFIG_DIR` | **unset** | `$HOME/.claude-2`, expanded |
| macOS Keychain service | `Claude Code-credentials` | `Claude Code-credentials-<h>` |

`<h>` is the first 8 hex digits of the SHA-256 of the folder path **exactly as passed** in
`CLAUDE_CONFIG_DIR` (measured on CLI 2.1.316, `DESIGN.md` "A `CLAUDE_CONFIG_DIR` has its own
Keychain item"; the docs say the Keychain entry is "keyed to that directory", authentication.md).
Anyone can compute it without touching the Keychain:

```sh
printf %s "$HOME/.claude-2" | shasum -a 256 | cut -c1-8
```

**The form rule.** The sign-in and every launch must pass the identical string: absolute, `$HOME`
expanded by the shell, no `~`, no trailing slash, no symlinked parent. Any other spelling digests
to a different item, and the CLI reports "not logged in" for a login that exists. The build's
check refuses a recorded folder that is not in that form.

Login A stays exactly where it is. Nothing is migrated: moving it into a folder of its own would
mean copying its grant (forbidden) or signing in again for no gain. A is chosen by launching with
the variable **unset**, never with `CLAUDE_CONFIG_DIR=$HOME/.claude`: a set variable always names
a suffixed item, so pointing it at the default folder would name a third, empty item.

**The owner's second sign-in, which can happen before the build.** Make the folder and its links
(section 4), then sign in by hand, in a terminal:

```sh
mkdir -m 700 "$HOME/.claude-2"
cd "$HOME/.claude-2"
for f in settings.json CLAUDE.md agents commands skills plugins projects file-history history.jsonl; do
  [ -e "$HOME/.claude/$f" ] && ln -s "$HOME/.claude/$f" "$f"
done
CLAUDE_CONFIG_DIR="$HOME/.claude-2" claude auth login
```

Never create `$HOME/.claude-2` by copying `~/.claude` (`cp -R`, Finder, a backup restore): that
would carry a `.credentials.json` if one is there, and `~/.claude.json`'s account record. The
folder starts empty apart from the links.

Further accounts, if ever needed, follow the same shape: `$HOME/.claude-3`, and so on. Slot names
are numbers, never derived from an email.

## 2. How a switch chooses the login for new launches

**One record, read at launch.** `<app home>/claude-logins.json`, written only by the panel (or by
hand before the build), read by the bot CLI:

```json
{ "use": "2", "logins": [ { "id": "2", "dir": "/absolute/home/.claude-2" } ] }
```

- `use` is `"default"` (login A) or a listed `id`. The default login is implicit and never listed.
- It lives at the app home's top level, not under `data/am-quota/`, because the CLI reads it and
  am-quota ships switched off: the CLI must not depend on another mod's private folder. With the
  mod off the file stays as last written, and the person can edit it by hand.
- A switch is one atomic write of `use` (`writeTextFile` with the snapshot it replaces). It writes
  nothing else and touches no credential, so there is nothing to back up or put back.

**The CLI turns it into the launch's environment.** Every Claude launch the pack makes on this
Mac — `automagik-herdr start`, `restart` (and the panel's Restart, which runs it), and a worker a
bot spawns — reads the record at that moment:

| Record | The agent starts as |
|---|---|
| no file, or `use: "default"` | `/usr/bin/env -u CLAUDE_CONFIG_DIR PATH=… claude …` |
| `use: "<id>"`, folder valid | `/usr/bin/env PATH=… CLAUDE_CONFIG_DIR=<dir> claude …` |
| unreadable, malformed, unknown `id`, folder missing or not in the form rule | refused, with why: no guess |

The unset matters: panes start in herdr-core's environment, which may carry the variable.
`startArgs` (`launchArgs.js`) already takes extra `env` words, and `workerArgs` (`workers.js`) gets
the same. The build must teach `paneCommand` (`restart.js`) to strip a leading `-u NAME` as well as
`NAME=value` words, so a restart drops the old prefix and puts the current choice on.

Out of scope, by design:

- a `claude` typed into an ordinary terminal uses login A unless the person sets the variable;
- launches on linked machines (`--machine`) never get the variable: each host has one login;
- per-bot pinning to a login (not asked for).

Not used: `launchctl setenv` (machine-wide, reaches every app, and going back to A needs an unset
nothing guarantees), a `claude` wrapper on `PATH`, or swapping folders by symlink (one rename away
from two folders naming one item).

## 3. Running bots

Unaffected. A running Claude process keeps the environment it started with, so it keeps its
folder, its Keychain item and its account, and refreshes its own grant in its own item. Nothing
the switch does can sign it out.

After a switch the banner lists the Claude bots still on the other login and offers **Restart N
bots**, through the existing restart flow (#433). The list no longer needs the `since` guess:
`hc get`'s argv of each pane shows its `CLAUDE_CONFIG_DIR` word (none: login A), so the panel
lists exactly the panes on the other login. A pane whose argv hc doesn't give is listed with that
reason.

Each restart resumes its conversation under the new login, because the transcripts are shared
(section 4). If resuming fails, the bot starts a new conversation and appears in the banner's
existing "Started on a new conversation" list.

## 4. Settings, MCP config and history across the two folders

`$HOME/.claude-2` holds real files only for what must be per login, and links into `~/.claude`
for what must be shared.

**Shared, by symlink from B into A's folder:** `settings.json` (hooks, status line, permissions,
enabled plugins), `CLAUDE.md`, `agents/`, `commands/`, `skills/`, `plugins/`, `projects/`,
`file-history/`, `history.jsonl`.

`projects/` carries the weight. It holds the transcripts, and both the resume and the chat
projection depend on it:

- the docs say `--resume <id>` searches "every other project on this machine", which in practice
  means the active config folder's `projects/`, so without the link a bot moved to B could not
  resume a conversation it had under A;
- `transcriptFolder.mjs` (and Pocket Link's `chat/folder-rule.js`) accept a transcript only when
  its real path is inside `~/.claude/projects`. B's transcripts resolve there through the link,
  so B's panes keep their chat. Without the link they would be screen only.

**Per login, never shared:**

- the credential: each folder's own Keychain item (and no `.credentials.json` in either);
- `.claude.json`: it holds the account record (who is signed in), onboarding and folder trust,
  and the user-scope MCP servers (`claude mcp add --scope user` writes it). Linking it would label
  B's grant with A's account. So **user-scope MCP servers are per login**: add one to both, or
  keep it project-scoped in the repository's `.mcp.json`, which both logins read;
- MCP OAuth sign-ins: the CLI keeps their tokens with its login, so each login authorizes an MCP
  server on its own. That keeps them out of two places too;
- anything else the CLI creates in B (caches, session state): B's own.

**Known costs of B's fresh `.claude.json`:** the first `claude` run under B can show onboarding,
and the first launch in each project folder can ask to trust it. A bot pane stopped on that
question looks stuck. The build checks this on a scratch config folder and either pre-answers it
the documented way or shows the panel line "first launch under login 2 in <folder> needs one
answer in its pane".

**To verify in the build, on scratch folders (no sign-in needed):** the CLI writes
`.claude.json` inside `CLAUDE_CONFIG_DIR`; it follows the `projects` link for resume; and it does
not replace a linked `settings.json` with a real file by rename. If it does replace one, the
panel's check names the link that turned into a file (`settings.json in login 2 is no longer
shared`); it never repairs it by copying.

The docs' caveat on several folders applies to Console sign-ins without an API key, not to
claude.ai logins, which is what both logins are.

## 5. What the panel shows

The Claude card lists **the logins signed in on this Mac**, not the proxy's accounts:

- **Who each login is:** `claude auth status` run under that login's environment (unset for A,
  the folder for B) through exec, read-only. It prints JSON with `authMethod` and
  `configDirectory` and exits 1 when not signed in; no token is printed or seen. If it does not
  carry the account's email, the email comes from that folder's `.claude.json` account record,
  as a last resort. That file can hold secrets elsewhere (an MCP server's `env`), so the panel
  takes the one email field and never logs, shows or keeps the rest. Read on open, after a
  switch, and at most every five minutes.
- **Rows:** one per login, `email`, matched by email to the proxy's quota rows for the bar and the
  policy's projection (`policy.choose` runs over the local logins only). The login in use (the
  record's `use`) gets the pill; the others get **Use**. A login the proxy doesn't list reads
  "usage not tracked". A login that is not signed in reads **Sign in again** with the command,
  and no button.
- **A proxy account with no login on this Mac** is listed under "On your CLIProxyAPI, not signed
  in here" with the sign-in command for a new slot, and **no** button. It can never be installed.
- **Gone:** "changed outside this panel" and "no longer installed" (the fingerprint badge for
  Claude); Claude's refresh token rotates on every CLI refresh, so the badge could only mislead.
  The banner line "This Mac now shares that sign-in with <proxy>" goes too: nothing is shared.
- A folder whose record is invalid (section 2) is one red line naming it; the card offers no
  switch until it is fixed.

## 6. Adding or removing an account

**Add (by hand; the panel shows the lines and never runs them):** pick the next free slot `n`,
make `$HOME/.claude-<n>` and its links as in section 1, run
`CLAUDE_CONFIG_DIR="$HOME/.claude-<n>" claude auth login` in a terminal, then **Add login** in the
panel records `{id, dir}` (after checking the form rule and that `claude auth status` says signed
in). Before the build, editing `claude-logins.json` by hand is the same thing.

**Remove:**

1. If the login is `use`, switch to another first; the panel refuses to remove the login in use.
2. Restart or stop the bots still on it; the panel refuses while a pane's argv names its folder,
   because a logout ends their sign-in.
3. In a terminal: `CLAUDE_CONFIG_DIR="$HOME/.claude-<n>" claude auth logout`. The CLI removes its
   own credential; the panel does not touch the Keychain.
4. **Remove login** in the panel drops the record. Deleting the folder is optional and by hand
   (`rm` on the links removes the links, never `~/.claude`'s files). Keep `projects` in mind: it
   is a link, so B's transcripts were always in A's folder and stay.

Login A is never removed through the panel.

## 7. What the proxy is still used for

Reading quota, nothing else, for Claude: `…/v1/quotas` and the credential listing's emails, to
draw each local login's bar and run the projection. Quota belongs to the account, not the grant,
so the proxy's own sign-in to an account (a separate grant, made on the proxy) reports the same
windows the Mac's login spends. The Claude path never calls `…/credentials/download`; the build
adds a test that fails if it does. The 00:09Z failure cannot recur: the proxy's grant and the
Mac's are different chains.

## 8. What leaves today's Claude switch

From `am-quota` (the build PR; Codex untouched):

- the Claude download and install: `install()`/`place()` for `provider: "claude"`, `toClaude`,
  `problems()`'s Claude rule, `TARGETS.claude`'s Keychain and file target;
- every Claude Keychain write path: `keychainScript`, `keychainBackupScript`,
  `keychainRestoreScript`, `mergeCredentialItem`, `KEYCHAIN_BYTES`, `keychainService`, the
  backup / put-back logic in `switch.js`, and the profile `.credentials.json` write;
- `readIdentity`/`installedIdentity` for Claude and `keychainReadScript`;
- the shared-sign-in banner line and the refresh-token section of `DESIGN.md`/`RECIPE.md`;
- the Claude cases in `am-quota-switch`/`am-quota-translate` tests, replaced by tests that the
  Claude path never reaches `security` or the download (a shim that fails the test if called);
- the `claude` entry in `active.json`: ignored on read, dropped at the next write.

Kept: `sweepScript` (it also removes any `keychain-claude-*.hex` an interrupted old switch left),
`itemText`/`hexToUtf8` (Codex identity), and the whole restart flow.

Nothing is deleted from the Keychain by the build. Login A's item is the person's own sign-in now
(the copy the old panel put there was replaced by a sign-in on 2026-11-06). An `am-quota saved: …`
item from older versions stays until removed by hand, as `DESIGN.md` already says.

## 9. Rollback

- **Before the build:** nothing to roll back. Login B is an ordinary sign-in; step 3 of "Remove"
  undoes it.
- **After the build, if new launches misbehave:** set `use` to `"default"` or delete
  `claude-logins.json`. Every new launch is then on login A, exactly as today. Running bots keep
  their login until restarted.
- **If the CLI change itself is broken:** a fix-forward herdr patch that makes the CLI ignore the
  record (launches as today, variable unset). The pack never downgrades through its pointer
  (AGENTS.md), so a rollback is a new release, not an older version.
- **A rollback never brings back the proxy-to-Keychain write.** Reverting the build PR whole
  would reintroduce the Claude install; the revert keeps Section 8's removals and reverts only
  the launch change.
- Nothing in the Keychain needs restoring in any case, because the panel never wrote it.

## Acceptance for the build (from #453)

- A Claude switch changes only `use`; a test with a `security` shim and a fake proxy proves no
  Keychain call and no credential download happen on the Claude path.
- Start, restart and worker launches put `-u CLAUDE_CONFIG_DIR` or `CLAUDE_CONFIG_DIR=<dir>` on,
  per the record, and refuse an invalid record; tests use temp homes only.
- The panel lists local logins, matches quota by email, and offers no button for a proxy account
  without a local login.
- No emails, usernames or machine names in code, tests or docs.
