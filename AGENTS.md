# Automagik repository contract

Automagik holds the DeepSeek Harness (DSH) plugins every Automagik product builds on (the Bot team, `apps/bots-dsh`; the welcome, `apps/welcome-dsh`) and the Automagik desktop app (`apps/desktop`).

- Bun for the repository's tooling (`scripts/`, `bun test`). The plugins run on Node like DSH (`node --test`, esbuild) and install with Bun; a DSH profile is only ever installed through DSH (`dsh plugin`, pnpm); npm only for the desktop app's Electron tooling.
- Nothing is published to npm. Plugins ship as git sources pinned to release commits and as release tarballs.
- One version for everything (`bun scripts/version.ts`); never edit a version by hand.
- Generated client bundles (`client.js`) are committed: run `node scripts/build-client.mjs` in the plugin and commit the result.
- Plugin ids, routes, storage prefixes and the team's home are a public contract: installed teams keep their data there. Do not rename them.
- Omni-specific code still in the Bot team (the `omni_*` tool names, Omni as the Main Bot) belongs in Omni's plugins; move it there, not further in.
- Commits are conventional (`type(scope): description`); pull requests target `dev`.
- Do not start services, access production systems or send external messages without explicit approval.
