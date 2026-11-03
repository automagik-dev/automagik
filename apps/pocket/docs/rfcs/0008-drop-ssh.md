---
rfc: "0008"
title: "Drop SSH: Pocket Link (QR pairing) is the only way to connect"
status: Accepted
created: 2026-11-03
pr: ""
---
# RFC 0008 — Drop SSH: Pocket Link is the only way to connect

## Summary

The app stops connecting over SSH. Pocket Link pairing, by QR code or link, is the only way to add
and reach a machine. Machines saved over SSH by an older version stay in **Machines**, greyed, with
one button, **Pair with QR**; once that computer pairs, the old entry is deleted. The phone's old
SSH key is deleted once no such entry is left. Nothing new is collected, sent or asked for.

## Motivation

The owner decided it: "i want to drop ssh hosts, qr works perfectly" (Decisions). SSH was the
second of two ways in, with its own key, password prompt, host-key trust and network scan, and the
code, dependencies and docs that came with them. Removing it changes what the app stores and which
network connections it makes, so [AGENTS.md](../../AGENTS.md) asks for an RFC first.

## Current state

Before this RFC, on `dev` (`a9fb03f`):

- `android/app/src/main/java/ai/namastex/automagik/Ssh.kt:17` (`SshKeys`) made an Ed25519 key in
  no-backup storage (`ssh/id_ed25519`) and opened SSH sessions with JSch, pinning the host key
  (`Ssh.kt:46`) and running `hc connect` (`Ssh.kt:69`).
- `PocketViewModel.kt:129` created that key on every start, for every user, SSH or not.
- `PocketViewModel.kt:238` asked for an SSH password when the key was refused; it was never saved.
- `Discovery.kt:77` browsed the local network for `_ssh._tcp` while the start or Machines screen
  was open, to suggest machines.
- `Screens.kt:147`, `MainActivity.kt:293` and `MainActivity.kt:302` offered **Add an SSH machine**;
  `MainActivity.kt:246` showed the host-key trust dialog; Settings showed the public key.
- `android/app/build.gradle.kts:62` and `:63` bundled JSch and Bouncy Castle, used only by
  `Ssh.kt`.
- Saved machines carry `transport`; an entry without one is SSH
  (`Model.kt:28`, `HostProfile.parse`).

## Design

| Area | After this RFC |
|---|---|
| Adding a machine | Only **Pair with Herdr desktop** (QR or pasted link). The top bar's **+** opens pairing. |
| Saved SSH machines | Kept and shown greyed, status "Pair again with QR", one button **Pair with QR** that opens the scanner, plus Remove. Never connected: `connect()` refuses a legacy entry (`PocketViewModel.kt:196`); reconnect, pull to refresh and watch-after-restart skip them. |
| Replacing one | The card's button records which entry the scan is for (`PocketViewModel.kt:252`). Only after the pairing succeeds is that entry removed and the paired desktop put in its place, keeping its core session (`LegacySsh.afterPairing`, `LegacySsh.kt`). A cancelled or failed scan changes nothing. If that desktop was already paired, its card is updated and the SSH entry still goes. |
| The old SSH key | Deleted from no-backup storage (`ssh/`) at start, after a pairing and after a removal, each time only if no SSH entry is left (`LegacySsh.deleteKeyIfUnused`). |
| Removed | `Ssh.kt`, `Discovery.kt` (the `_ssh._tcp` scan), the password prompt, the host-key trust dialog, the SSH edit dialog, the Settings key section, `SshIntegrationTest`, `android/scripts/ssh_test_host.py`, JSch and Bouncy Castle with their bundled licence files. |
| Kept | `HostProfile`'s SSH fields and its JSON format, so old entries load and can be shown until replaced. |
| Manifest | No change: no permission was SSH-only. Internet still carries Pocket Link and the update check; network state still gates automatic updates to unmetered networks. |
| Privacy | [privacy.md](../privacy.md) drops the SSH password row, the SSH connection and the mDNS scan, and says that legacy SSH entries and the old key stay only until re-paired or removed. |

## Decisions

- Owner, 2026-11-03: drop SSH hosts; "qr works perfectly". Recorded in the handoff for this task.
- Owner, 2026-11-03: saved SSH machines show "pair again with QR".

## Alternatives considered

- **Delete saved SSH machines on update.** Simpler, but loses the person's list without a word;
  the handoff asks for no silent data loss.
- **Keep SSH behind a setting.** Keeps JSch, Bouncy Castle, the key and the password prompt in the
  APK for a path the owner dropped.

## Open questions

1. When can the legacy card code (`LegacySsh.kt`) be removed, once updated phones no longer carry
   SSH entries? Owner.

## Related

- [RFC 0003](0003-pocket-link-pairing.md): Pocket Link pairing.
- [RFC 0007](0007-watch-after-reboot.md): its typed-password exclusion no longer applies.
