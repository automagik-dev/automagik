# RFC 0008: Platform and web instances

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | not scheduled |
| Lanes | desktop (3.N); release tooling |
| Created | 2026-10-30 |

## Summary

Four platform pieces: an `install.sh` for Linux (headless or desktop) and WSL, Windows builds,
official web instances, and the desktop app as a client of a web instance with OIDC sign-in.
Every major choice is an open question with a recommendation. Nothing is scheduled until the
questions are answered.

## Motivation

Automagik runs today as the desktop app on macOS and Linux, and some people already run it as a
server and reach it from a browser. That server install is done by hand. There are no Windows
builds. The desktop app cannot connect to a server, so people choose between a local app and a
remote server.

## Design

### install.sh

- One script for Linux and WSL. `--headless` installs the DSH runtime and the plugins as a user
  service; the default installs the desktop app.
- It installs a pinned release. It checks every download against the release's published
  checksums and signature before unpacking anything.
- It never pipes a download into a shell itself. The documented install is: download the
  script, check it, run it.
- It installs pinned add-ons the same way, including ACP adapters (RFC 0003).

### Windows builds

- Built in CI next to the macOS and Linux builds, with the same runtime pins.
- Code-signed, or clearly marked unsigned on the download page and in the app.

### Web instances

- A web instance is the DSH runtime plus Automagik's plugins on a server, used from a browser.
- It listens on loopback only until OIDC sign-in ships. Before that, it is reached through an
  SSH tunnel.
- With sign-in: TLS in front, OIDC with PKCE, `state` and `nonce`, issuer and audience checks,
  and session cookies set `HttpOnly`, `Secure` and `SameSite`.
- Features that act like a shell relay stay off on a web instance until sign-in is reviewed.
  The Herdr relay (RFC 0006) is the first.

### The desktop app as a client

- Settings get "Connect to a web instance": the user enters its address and signs in in the
  browser flow. The app then opens that instance instead of starting a local DSH.
- Tokens are stored with the OS's secure storage, never in a plain file.
- The "where it runs" strip (RFC 0004) shows the instance name instead of "This computer".

## Contracts introduced

- `install.sh` flags and install paths. Compatibility: a host installed by hand keeps working;
  the script adopts it only when asked.
- The desktop setting for a remote instance. Compatibility: off for every existing install.
- The OIDC client registration for web instances. New.

## Threat model

A web instance puts a process with shell tools on the network. This is the largest new trust
boundary in the roadmap.

- **Who can reach it.** Anyone who can reach its address. Before sign-in ships, nobody off the
  machine: it binds to loopback.
- **What it can do.** Everything the DSH runtime can do as its user: run commands, read and
  write files, use stored credentials.
- **Authentication.** OIDC as above. Every plugin route is behind the sign-in. No route is
  exempt for convenience.
- **The desktop client.** It stores tokens in OS secure storage and shows which instance it is
  connected to.
- **install.sh.** Pinned versions, checksum and signature checks, no unchecked download.
- **Windows.** Signed builds, or an explicit unsigned label.
- **Undo.** Stop the service, revoke the OIDC client, remove the desktop setting.

## Deliveries

None until the open questions are answered. A likely order: install.sh headless, then Windows
builds, then web sign-in, then the desktop client. Each becomes its own delivery with a check
and a rollback when this RFC is accepted.

## Open questions

1. **Who hosts official web instances?** Recommended: self-hosted first, on the user's own
   server through `install.sh --headless`. A hosted offer later, as its own RFC.
2. **Which sign-in provider?** Recommended: any standard OIDC provider the instance owner
   configures, with one documented default.
3. **How is install.sh signed?** Recommended: reuse the release signing that the plugin lane
   already has, with a key of its own, and publish the public key in this repository.
4. **Windows signing.** Recommended: ship unsigned preview builds, clearly labelled, until a
   code-signing certificate is in place; sign before any public announcement.
5. **WSL: headless or desktop?** Recommended: headless inside WSL, opened from the Windows
   browser. Windows users who want an app use the Windows build.
6. **Can the desktop app hold several instances?** Recommended: one at a time, with a switcher
   later if people ask.
7. **Local and remote together?** Recommended: no. The app runs either a local DSH or a remote
   one, so the user always knows where the work runs.

## Links

- [0003](0003-model-routes-and-acp.md) pinned adapters, [0004](0004-composer-chat-kinds.md)
  "where it runs", [0006](0006-herdr-terminal-mode.md) relay
- [docs/upgrade.md](../upgrade.md) upgrading an installed host
