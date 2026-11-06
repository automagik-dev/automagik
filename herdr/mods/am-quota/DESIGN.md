# am-quota — design notes

The decisions this mod is built on, so the panel cannot drift from them. `policy.js`, `proxy.js`,
`translate.js`, `write.js`, `switch.js`, `lock.js` and `view.js` are the tested parts
(`test/am-quota-*.test.mjs`); `main.js` is the panel that wires them (`am-quota-panel.test.mjs`
draws it under a stub runtime). `RECIPE.md` is the
person-facing version.

## Where the facts come from (measured against a private CLIProxyAPI deployment, 2026-11-01)

| Call | Gives |
|---|---|
| `GET /v0/management/plugins/cpa-quota-api-extension/v1/quotas` | per credential: `windows[]` of `{id, used_percent, remaining_percent, reset_at}`, `credential_state`, `status` — the panel's rows |
| `GET …/v1/accounts` | redacted inventory: email, account type, `last_refresh`, `recent_requests`, `status` |
| `GET /v8/management/credentials` | the same credentials plus `path`, `access_token_expires_at` and `quota.signals` (a fallback when the plugin is absent) |
| `GET /v8/management/credentials/download?name=<file>` | the credential file itself — **live tokens** |

Both the base URL and the management key are configuration, never constants: the base URL is
`<app home>/cliproxy.json`'s `url`, the key is `$CLIPROXY_MGMT_KEY` or `~/.config/cliproxyapi/mgmt.key`.
The key **travels in an environment variable or a file, never in `argv`** — `ps` shows argv, and it
is never echoed in a URL or an error.

When the quota extension does not answer, the management API's accounts are still listed and the
panel shows an error line over them; it does not render a column of "no window" as if the accounts
had no quota.

## Writing a credential locally

| Client | Where it reads | What a switch writes |
|---|---|---|
| Codex | `$CODEX_HOME/auth.json`, default `~/.codex/auth.json` | that file, translated from the proxy's flat form (`access_token, refresh_token, id_token, account_id, last_refresh`) to Codex's `{OPENAI_API_KEY: null, auth_mode: "chatgpt", last_refresh, tokens: {…}}` |
| Claude Code | its own sign-in on this Mac | **nothing.** A Claude login is never downloaded from the proxy or installed, and the mod never reads, writes or deletes a Claude Keychain item (#453, `docs/local-logins.md`). Until the Claude card lists the logins signed in on this Mac, it shows the proxy's usage and offers no switch |

**Why Claude left the switch (#453).** Copying a proxy login into the Mac's Keychain put one grant
in two places. Anthropic rotates the refresh token on use, so the two holders signed each other
out: on 2026-11-06 at 00:09Z the proxy renewed an account the panel had copied, and every Claude
pane on the default login stopped. Login A's item now holds the person's own sign-in, which the old
switch would have overwritten. Each Claude login on the Mac is now its own `claude auth login` in
its own `CLAUDE_CONFIG_DIR` folder, and a Claude switch only chooses which one new launches use.

**A `CLAUDE_CONFIG_DIR` has its own Keychain item** (measured, kept so a person can recognize the
items in Keychain Access; nothing in the mod computes or reads these names any more). On CLI
2.1.316, with `CLAUDE_CONFIG_DIR=/tmp/cc-scratch` and a `security` shim on `PATH`, the CLI ran
`find-generic-password -a <login user> -w -s "Claude Code-credentials-bde599a8"`, then
`… -s "Claude Code-bde599a8"`, and `sha256("/tmp/cc-scratch")[:8]` is `bde599a8`: the digest of the
directory **as given**, no `~` expansion and no trailing-slash trimming.

Rules for the Codex write, from the coordinator and from the experiment:

- write `0600`, into a temporary file in the **same** directory, then **atomic rename** — never a
  partial credential on disk. The payload's folder is forced `0700` *before* any payload exists,
  which is what keeps the file out of reach; the file itself is `0600`d the moment it is created
  (`writeTextFile` replaces the inode, so a mode set beforehand would not survive);
- back up the file being replaced, and keep the backup out of any log;
- **never** put a token in a log, a `notify` body, a shared state key, or an error message;
- a failed download or write leaves the previous credential in place and says so without detail;
- the payload file is created inside a `0700` folder and narrowed to `0600` at once, removed by the
  scripts and again in `finally`, and anything older than an hour is swept when the panel opens;
- backups are pruned to the three newest, so a click does not accumulate token-bearing files;
- the proxy client refuses a non-`https` base URL (plain `http` only for loopback), and a body
  that is not JSON is reported by name, never quoted;
- verification is a real request (a tiny prompt per client), because `claude auth status` and
  `codex login status` are shallow: a garbage `{"access_token":"nope"}` was reported as
  "Logged in using ChatGPT".

## Saved logins (removed)

Earlier versions kept saved Claude logins in their own Keychain items (`am-quota saved: <name>`)
or `data/am-quota/saved/`. Accounts now live on the person's CLIProxyAPI, so the panel no longer
reads, writes or deletes them; one left on a Mac stays until removed by hand. An `active.json`
record naming one (`saved:<name>`) reads as not managed.

The sweep that removes interrupted payloads matches only their names (`claude-*.json`,
`codex-*.json`, `keychain-*.hex`): it used to match every `*.json` in the folder, which deleted
`active.json` (and would have deleted `saved.json`) an hour after it was written.

- Resets re-rank when they happen; they are events, not predictions.

## The panel's own state

`data/am-quota/active.json` records the Codex credential name this panel installed and a 32-bit
FNV-1a **fingerprint of its identity** (Codex's `account_id`); an identity, never the token. On
each identity read the panel compares that fingerprint with what is actually in Codex's file: a
mismatch means the credential changed outside this panel, and the row says
`changed outside this panel` instead of a false `in use`. A file that is gone says
`no longer installed`; a file that cannot be read keeps the record's claim, because a guess is
worse than the record. A `claude` entry an older version wrote is ignored on read and dropped at
the next write (#453).

The installed file holds tokens, so it is re-read for the badge **on open, after a switch, and then
at most every five minutes** — not on every 60 s poll.

One switch at a time: a second click while `busy` is set is refused with the running switch's text
(`lock.js`), so two writes cannot interleave. The success line is kept in `note` (the 60 s poll no
longer clears it), and the poll skips a hidden panel and a copy that has not been drawn for two
intervals, and drops a response that a newer read has overtaken.

Every request the proxy client makes carries a **30-second `AbortSignal.timeout`**, so a hung
server cannot leave a switch `busy` (or the panel reading forever). A runtime without
`AbortSignal.timeout` gets no signal rather than an exception.
