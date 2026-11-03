---
rfc: "0008"
title: "Drop SSH: Pocket Link (QR pairing) is the only way to connect"
status: Accepted
created: 2026-11-03
pr: "#46"
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

- `SshKeys` in `Ssh.kt` made an Ed25519 key in no-backup storage (`ssh/id_ed25519`); its `open`
  ran SSH sessions with JSch, pinning the host key and running `hc connect`.
- `PocketViewModel`'s `init` created that key on every start, for every user, SSH or not.
- `PocketViewModel.connect` asked for an SSH password (`PasswordPrompt`) when the key was refused;
  it was never saved.
- `Discovery` browsed the local network for `_ssh._tcp` while the start or Machines screen was
  open, to suggest machines.
- `MachinesScreen` and `WelcomeScreen` offered **Add an SSH machine** (`HostDialog`); `PocketApp`
  showed the host-key trust dialog; `SettingsScreen` showed the public key.
- `android/app/build.gradle.kts` bundled JSch and Bouncy Castle, used only by `Ssh.kt`.
- Saved machines carry `transport`; an entry without one is SSH (`HostProfile.parse`).

## Design

| Area | After this RFC |
|---|---|
| Adding a machine | Only **Pair with Herdr desktop** (QR or pasted link). The top bar's **+** opens pairing. |
| Saved SSH machines | Kept and shown greyed, status "Pair again with QR", one button **Pair with QR** that opens the scanner, plus Remove. Never connected: `PocketViewModel.connect` refuses a legacy entry (`LegacySsh.refusal`); reconnect, pull to refresh and watch-after-restart (`resumeWatching`) skip them. |
| Replacing one | The card's button records which entry the scan is for (`PocketViewModel.repairWithQr`, `LegacySsh.start`); the scan's result, whatever it is, uses that up (`PocketViewModel.scanned`, `LegacySsh.scanned`). A pasted link, an external link and the general **Pair with Herdr desktop** dialog never replace a card. Only after the pairing succeeds is that entry removed (`LegacySsh.afterPairing`). If the desktop wasn't paired yet, the new card takes the entry's place and keeps its core session; if it was, its existing card is updated, keeps its own session, and the SSH entry still goes. A cancelled or failed scan changes nothing. |
| What the phone can't check | Whether the scanned desktop is the same computer as the SSH entry: the entry holds an SSH address and the pairing a Pocket Link key, with nothing to compare. Scanning computer B from computer A's card replaces A's card. Pairing from the general button leaves the legacy card until it is removed by hand. |
| The old SSH key | Deleted from no-backup storage (`ssh/`) at start, after a pairing and after a removal, each time only if no SSH entry is left (`LegacySsh.deleteKeyIfUnused`). Never when the saved list couldn't be read (`LegacySsh.loadHosts` returns null): it then shows empty, but SSH entries may still be in the preferences. |
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
