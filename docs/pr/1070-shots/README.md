# Temporary PR 1075 real-app wizard captures

These are the running app's light and dark themes, using the approved Remote Hermes wizard
and its actual host endpoints. This wording-only round refreshes 23 affected frames: every dark
frame, plus light 06b, 07 and 04d–04g, where the updated permission text or control is visible.
The other 11 light frames keep the unchanged images from the prior reviewed capture.

Read only and Workspace both ask before each Hermes approval. Their difference applies only to
this computer's own files. Full access answers yes once; Auto review does not review Hermes
questions. The shared remote caveat appears once below each permission surface, and the
underlined “Choose in the chat” control was exercised through dismiss and reopen in the app.

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

The approved probe ran `node scripts/boot-check.mjs --keep <scratch>/boot` outside the
repository, with DSH bound only to loopback and separate empty app homes. Package installation
used offline caches. Runtime egress was blocked. A disposable in-memory gateway supplied
source-shaped REST/WebSocket replies, and a fake `ssh` executable supplied the supervisor and
tunnel states. The reserved example address was never contacted. No real Hermes, SSH client,
provider account, private reference image or key material was used.

The actual wizard exercised dashboard sign-in, profile refresh/pick/save, remembered one-click
connection, SSH test/cleanup, and actionable auth/host-key failures. Password fields were masked;
the probe checked that one-use sign-in values were absent from all isolated app-home files.
The installed client bundle matched the checkout byte for byte (SHA-256):
`081657b272f95862e7f3aee590232e8b5673f23118e25f18b074626be90e007c`.

The retained light frames are byte-identical to commit
`1852fbd855f458b132e79c3676c7adb5abdbffc7`, captured from source
`7727147d06fc722e68a73bbd31044cc55fa50fe0` with bundle SHA-256
`611ce0bf95a7bb7a526fa5b436d7b66d9b53a8bc36e0db1498789202e4731eb4`.
Their native, unconfigured background and wizard content are unchanged by this round.

Viewport: 1440 × 1000; locale: English; the app's own fonts and theme variables. Screenshots
finish finite menu animations and keep the real app around the wizard. The final boot and capture
probe exited successfully with no recorded console errors or page exceptions; its owned process
groups and fake SSH processes were stopped. The retained images keep their earlier provenance
and are unchanged by this wording round.

Keep this folder and `../1070-wizard-mock` for the orchestrator's review before the owner's
real-app look. Remove both temporary folders only in the later pre-merge commit after review.
