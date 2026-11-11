# Temporary PR 1075 real-app wizard captures

These are the running app's own light and dark themes with sample data. This round refreshes
only the 12 Through SSH frames: 02, 03b, and 04d–04g in each theme. The other 22 images retain
their previously reviewed contents and provenance. Light 02 was recaptured with identical bytes,
so Git shows 11 changed PNG files for the 12 refreshed frames.

The SSH details frame shows searchable configured aliases and the collapsed “Other hosts you
have connected to” list. Choosing an alias fills the host, user and port; the alias remains the
connection target. The probe also exercised search, opening the secondary list, choosing a
previous host, and typing a new host before restoring the shown sample alias.

| State | Light | Dark |
| --- | --- | --- |
| Route selector | [Light](light-00-route-selector.png) | [Dark](dark-00-route-selector.png) |
| Connection: remote address | [Light](light-01-connection.png) | [Dark](dark-01-connection.png) |
| Connection: Through SSH | [Light](light-02-through-ssh.png) | [Dark](dark-02-through-ssh.png) |
| Details: session token | [Light](light-03a-address-token.png) | [Dark](dark-03a-address-token.png) |
| Details: dashboard sign-in | [Light](light-03a-address-password.png) | [Dark](dark-03a-address-password.png) |
| Details: SSH | [Light](light-03b-ssh-details.png) | [Dark](dark-03b-ssh-details.png) |
| Test: opening Hermes | [Light](light-04a-testing.png) | [Dark](dark-04a-testing.png) |
| Test: connected | [Light](light-04b-connected.png) | [Dark](dark-04b-connected.png) |
| Test: sign-in refused | [Light](light-04c-sign-in-error.png) | [Dark](dark-04c-sign-in-error.png) |
| Test: SSH sign-in refused | [Light](light-04d-ssh-sign-in-error.png) | [Dark](dark-04d-ssh-sign-in-error.png) |
| Test: unknown SSH host key | [Light](light-04e-ssh-host-key-error.png) | [Dark](dark-04e-ssh-host-key-error.png) |
| Test: SSH progress | [Light](light-04f-ssh-testing.png) | [Dark](dark-04f-ssh-testing.png) |
| Test: SSH connected | [Light](light-04g-ssh-connected.png) | [Dark](dark-04g-ssh-connected.png) |
| Profile selection | [Light](light-05-profile.png) | [Dark](dark-05-profile.png) |
| Ready | [Light](light-06a-ready.png) | [Dark](dark-06a-ready.png) |
| Later one-click connection | [Light](light-06b-one-click-chat.png) | [Dark](dark-06b-one-click-chat.png) |
| Bot settings: Remote Hermes | [Light](light-07-settings.png) | [Dark](dark-07-settings.png) |

The approved probe ran `node scripts/boot-check.mjs --keep <scratch>/boot` in isolated scratch
under `/mnt/ai`, with DSH bound only to loopback and separate app homes. Package installation
used offline caches; runtime and browser egress were blocked. The real host discovery endpoint
read fixture SSH files and called a fake `ssh -G`; later connection tests used a fake SSH
supervisor/tunnel and an in-memory Hermes gateway. No real SSH client, Hermes, account, key
file or private reference screenshot was used. Sample onboarding was marked complete through
the existing host API before initial navigation, so the capture needed no page reloads.

Fixture size: 14 aliases and 170 known-host records, including 6 hashed records which were
ignored. The endpoint returned 14 aliases and 164 previous names, with exactly alias, hostname,
user and port. The probe verified the alias target in the fake SSH argv and checked that
unselected discovery data and public-key columns were absent from the app's persisted files.

The 12 refreshed images were captured from source commit
`9ab8bda316a06d6e705e3fc6fadb70d5b1824bda`. The installed client matched that checkout byte for
byte (SHA-256): `ec861ac659d10545bc3dec4abb673c163cc0051102669536dd5dafcb01c3590a`.
The final boot and capture completed successfully, with no recorded console errors, page
exceptions or HTTP failures. The owned boot/app process groups and fake SSH processes were
verified gone afterward. Earlier probe attempts and their diagnostics are retained in scratch.

The 22 retained images are byte-identical to commit
`18c5780538fb661913680699ef68501cad35bb4d`. Their provenance is unchanged:

- All 11 non-SSH dark frames, plus light 06b and 07, came from source
  `3431387d437acd218bcdeb36a179785c171fbb3e`, bundle SHA-256
  `081657b272f95862e7f3aee590232e8b5673f23118e25f18b074626be90e007c`, recorded in
  `716241f0f05d4923e1d1137793a10122a53e1ced`.
- The remaining 9 non-SSH light frames came from source
  `7727147d06fc722e68a73bbd31044cc55fa50fe0`, bundle SHA-256
  `611ce0bf95a7bb7a526fa5b436d7b66d9b53a8bc36e0db1498789202e4731eb4`, retained in
  `1852fbd855f458b132e79c3676c7adb5abdbffc7`.

Viewport: 1440 × 1000; locale: English; native app fonts and theme variables. These temporary
images and `../1070-wizard-mock` stay for the orchestrator's review before the owner's look.
Remove both folders only in the later pre-merge commit after that review. The PR remains draft.
