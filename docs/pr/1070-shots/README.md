# Temporary PR 1075 UI captures

These screenshots show the real running app with the selector amendment and the dedicated
Remote Hermes entry in Bot settings, using the app's own light and dark themes.

- [Light route selector](light-route-selector.png)
- [Dark route selector](dark-route-selector.png)
- [Light connection settings](light-connection-settings.png)
- [Dark connection settings](dark-connection-settings.png)

The approved probe ran `node scripts/boot-check.mjs --keep <scratch>/boot` with scratch
outside the repository. DSH bound only to loopback, with its own app homes and an empty
child home. Runtime egress was blocked. Hermes settings came from a browser-side disposable
fixture; the reserved example address was never contacted. The saved-key state is sample data only; the probe also verified that Replace opens an empty
password input. The profile had no CLI logins or provider credentials. No real Hermes was started.

The installed client bundle matched the checkout byte for byte:
`629738caf7be3be14f23f12543d56566d82ee892400072bafb11992bd3dc902f` (SHA-256).
The probe also checked the single page heading, settings order and one-line route subtitle.
The probe exited successfully and its owned process groups were stopped.

These files are held for the orchestrator's review before the owner's UI review. Remove
this temporary screenshot folder in a later commit before merging, after that review.
