# am-quota

**Accounts** keeps your bots working when a plan hits its limit: it shows how long the Claude
Code or Codex account this computer uses will last, and moves the tool to another account on your
own CLIProxyAPI before it runs out. A personal tool for people who run one; accounts are added on
the proxy (sign in there), never on this computer.

CLIProxyAPI: <https://github.com/router-for-me/CLIProxyAPI>.

**It ships switched off**, footer tab included: a fresh install puts it in
`<app home>/mods-disabled/am-quota`, where Herdr does not load it. To turn it on, open the **Mods**
panel (the puzzle tab in the footer), find *Automagik Accounts* and switch it on; the footer's
**Accounts** tab then appears and opens the panel. Switching it off again hides both. An install that
already has it keeps its state through updates, on or off (`OFF_BY_DEFAULT` in
`am-sidebar/release.js`; `am install herdr.am-quota` also switches it on).

## Setup

The panel reads two files and does not create either of them:

- **`~/.config/herdr-app/cliproxy.json`** (or `$HERDR_APP_HOME/cliproxy.json` when that variable
  moves the app home):

  ```json
  { "url": "https://proxy.example.com", "name": "lab" }
  ```

  `url` is the CLIProxyAPI base URL, `https` (plain `http` is accepted only for `localhost` /
  `127.0.0.1`). No trailing slash needed; a path prefix is fine. `name` is optional: what the panel
  calls your proxy ("Accounts come from your CLIProxyAPI, lab"). Without it the panel uses the
  URL's host.
- **`~/.config/cliproxyapi/mgmt.key`** — the management key as plain text, one line, mode `0600`:

  ```sh
  install -m 600 /dev/null ~/.config/cliproxyapi/mgmt.key
  printf '%s\n' '<the management key>' > ~/.config/cliproxyapi/mgmt.key
  ```

  Or set **`CLIPROXY_MGMT_KEY`** in the environment Herdr itself runs in; the variable wins over the
  file. The key is only ever read — it is not written to a log, a notify, shared state or a command
  line.

Without `cliproxy.json` the panel says what it is for and how to set it up, and reads nothing.

## What you see

A card filling its block: **Accounts**, "Keeps your bots working when a plan hits its limit" and
`↻`; a **Claude Code / Codex** switch, one tool at a time, each with a dot (green: the account in
use lasts until it resets; amber: it is running out or can't be used; grey: not managed or not
tracked). For the tool picked, in order:

1. **The account in use on this computer**, as `email · plan` (Claude's listing has no plan, so its
   accounts show the email alone), never the credential's file name. A pill (`In use`, `Running
   out`, `Can't be used`), its window bar and `N% used of this week · resets Thu 09:00`, and one
   sentence: **Lasts until it resets**, or **At this pace it runs out in about N h, before it
   resets** (policy's projection; for the first minute, before there are two readings, it says it
   is measuring the pace).
2. **One button when the policy says switch**: `Switch to <email>`, with the reason underneath
   (`12% used · resets in 6 h · resets soonest, so none of its hours go to waste`). Bots already
   running stay on the old account until restarted; the panel offers that right after the switch.
3. **The tool's other accounts on the proxy**: `email · plan`, a bar, `N% used`, the reset, a
   **Switch** button, and `next` on the one the rule would move to next. An account the quota
   extension reports no window for says **usage not tracked** and has no bar; one that needs a new
   sign-in or is disabled says so and has no button.
4. A footer: "Accounts come from your CLIProxyAPI, <name>. To add one, sign in to it there." and
   **Open <name>**, which opens the proxy's base URL (without userinfo or query) in the browser.

**Not managed**: when no account is recorded for the tool, or the login on this computer changed
since the panel installed it, or the recorded account is no longer on the proxy, the card says so
(`No account from <name>`, `Changed outside this panel`, …) with a grey `Not managed` pill, and the
button reads `Use <email>`: the account the rule would pick.

**Just switched**: a banner, "<tool> is now on <email>", then the bots still on the old account and
**Restart N bots** (see *After a switch*). `×` closes it.

Colours are semantic only: green lasts, amber runs out; a suggestion is the one accent button,
never red. Red is kept for errors (a failed read or switch).

## How it behaves

- **Reading**: `cliproxy.json`'s `url` + `$CLIPROXY_MGMT_KEY` or `~/.config/cliproxyapi/mgmt.key`
  make the client; then `…/v1/quotas` joined with `/v8/management/credentials` (`proxy.js`).
  Refresh on open, every 60 s while the panel is drawn, and on `↻`. A poll that a newer one has
  overtaken is dropped, and a hidden panel does not poll. The management key rides only in the
  `Authorization` header.
- **Deciding**: `policy.choose` per provider, with this panel's record of what it installed as the
  active account (none while the tool is not managed: the verdict is then the account to start on). The burn rate comes from the last two polls (`prev` per account and window, dropped
  when the window resets). Projected exhaustion before the reset, the soonest-resetting account with
  headroom wins, near-reset (15 min) held, no reserve, providers never mix, fixed tie-break.
  One switch at a time: a second click while one runs is refused.
- **Switching** (`Switch` or `Use`): `GET …/credentials/download?name=<file>` → translate → write:
  - Codex: `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`; `OPENAI_API_KEY: null`,
    `auth_mode: "chatgpt"`, `last_refresh`, `tokens{…}`), previous file kept as
    `auth.json.bak-<stamp>`;
  - Claude: the Keychain item **first** on macOS. With no `CLAUDE_CONFIG_DIR` that is
    `Claude Code-credentials`; with one, it is that profile's own item,
    `Claude Code-credentials-<sha256(dir)[:8]>` (measured on CLI 2.1.316), so a profile switch never
    replaces your default-profile login — and the profile's `.credentials.json` is written as well.
    On Linux there is no item: the profile's / default `.credentials.json` is the route. The item is
    **merged**: only `claudeAiOauth` changes, so other keys the CLI keeps there (`mcpOAuth`, …)
    survive. The old item is saved to a `0600` file before the write and put back if a later step
    fails. On macOS with the item verified and no `CLAUDE_CONFIG_DIR`, the plaintext
    `~/.claude/.credentials.json` is not written or backed up at all. An existing item too large for
    one `security -i` line (past ~1,950 bytes once merged) is refused — "this login item is too large
    to switch safely" — rather than truncated or stripped of its other keys.
  Written through `sh`: the payload lives in a `0700` folder, is `0600`d the moment it exists, and
  becomes the real file by `mv` (atomic rename); the token is read from a file by the shell, so it
  never appears in `argv`, a log, a notify, shared state or an error message. Backups are pruned to
  the three newest. The Keychain item is written via `security -i` on stdin with the payload
  hex-encoded (`-X`) — the same mechanism the installed CLI uses; `security -w` would put the token
  in `argv` and, read from the prompt, truncates at 128 bytes. It is read back before success is
  reported, because an over-long `-i` line can store a truncated item and still exit 0. The scratch
  file is deleted afterwards, success or failure.
- If the app's environment cannot be read, the panel does not know whether a `CLAUDE_CONFIG_DIR`
  is set, so a Claude switch refuses rather than act on the default login. A failed `active.json`
  write is shown as an error.
- **After a switch**: the panel records `<provider> → <credential name + token fingerprint>` in
  `data/am-quota/active.json` (an older record naming a saved login, `saved:<name>`, reads as not
  managed). New client runs use the new account; ones already running keep the old one — that is
  the client's behaviour, not a defect. So the banner lists the bots still on the old account:
  `automagik-herdr ls --all --json` (run as the sidebar runs it, through
  `mods/am-sidebar/bin/run.sh`), the running bots whose agent is that tool and whose pane started
  (`since`) before the switch. If any of them has no start time the panel can't split them
  reliably: it lists every running bot of that tool and says so. **Restart N bots** asks for a
  second press within five seconds, then runs `automagik-herdr restart <bot> --project <project>`
  for each, one at a time (each resumes its conversation), and names any it refused (a working
  bot is refused rather than forced). Without the sidebar mod there is no CLI: the banner says to
  run `automagik-herdr restart <bot>` instead.
- **The refresh token is shared with the proxy.** Both sides hold the same one, and Anthropic rotates
  it on use, so whichever side refreshes first can sign the other out. Expect to re-import or sign in
  on the side that lost it; the banner after a Claude switch says so too.

## Built from

`main.js` (the panel, drawing what `view.js` says), `view.js` (each tool's card, the proxy's
name and the bots a switch left behind, as plain data; pure), `policy.js` (the decision, pure), `proxy.js` (the reader and the per-window
samples, pure), `translate.js` (proxy credential → client credential, item merge, Keychain service
name, fingerprints; pure apart from the `shasum` lookup), `write.js` (the shell that writes; pure),
`switch.js` (the install flow, with its shell and files injected so it is tested end to end),
`lock.js` (one switch at a time), `mod.json` (`place: none`), `LICENSE`, `DESIGN.md` (endpoints,
writers, secret rules), and tests for every module in the repository's `test/`.

Herdr API: `exec`, `theme`, `appHome`, `home`, `readTextFile`, `writeTextFile`, `window`,
`fs/promises`; the runtime's `fetch`. Programs: `sh`, `security` (macOS Keychain), `od`/`tr` for
the hex encoding, `open` (`xdg-open` on Linux) for Open, and the sidebar's `automagik-herdr`.

## Watch out

- **It writes real credentials.** That is its purpose; the old file is always kept as a dated
  backup, the old Keychain item is saved and restored on failure, and no token is ever logged. A
  switch affects **new** client runs only.
- **`login status` / `auth status` are shallow** — a garbage token reported "logged in". The panel
  therefore reports what it *wrote*, not that the account *works*; a verification request is a
  separate, quota-spending action, and is not wired yet.
- Codex's `auth.json` expects a nested `tokens` object while the proxy's file is flat; `translate.js`
  is the only place that knows the mapping, and the tests pin it.
- `CODEX_HOME` and `CLAUDE_CONFIG_DIR` are honoured: the panel writes where the client would read —
  including the separate Keychain item a `CLAUDE_CONFIG_DIR` profile reads.
- A provider with no window is shown but never suggested (nothing to project).
- The proxy's quota extension (`cpa-quota-api-extension`) supplies the windows, Claude's
  (`seven_day`) as well as Codex's; without it the panel still lists accounts, each reading `usage
  not tracked`, with an amber line saying the proxy sent no usage and no advice. No bar is faked.

## Done when

`herdr-app check mods/am-quota` passes; the panel lists both providers' accounts with their windows;
Switch rewrites the file (and the Keychain item for Claude — the profile's own item under a
`CLAUDE_CONFIG_DIR`) with a backup and a 0600 permission; the next `claude`/`codex` run is on the
chosen account; the banner names the bots still on the old one and Restart moves them; no token
appears in any log, notify or state.
