# Automagik Herdr (herdr/) contract

The pack is a part of the Automagik monorepo: the root `AGENTS.md` holds the repository's rules
(one version, releases, commits, pull requests); this file adds the pack's own.

Automagik Herdr is a Herdr pack: one mod folder, `mods/am-sidebar/` (the sidebar, the bot form, the briefing hook), and the `automagik-herdr` CLI in `mods/am-sidebar/bin/`. Herdr loads the folder as it is; there is no build step.

- Node 22.7 or later for everything (the installed pack has no package.json, so its `.js` files load as ESM by syntax detection; CI runs Node 22.7 and 24: `node --test 'test/*.test.mjs'` from `herdr/`); no Bun, no npm install, no dependencies. Files Herdr loads (`*.js`) import only `herdr`, `gpui-*` or each other; the pure ones (`model.js`, `launchArgs.js`, `models.js`, `workers.js`, `attach.js`, `formModel.js`, `release.js`, `updateCheck.js`, `spaceIconModel.js`, `meter.js`, `workerTab.js`, `migrate.js`) import none of them, so the tests and the CLI share them.
- The mod folder is named `am-sidebar` (renamed in v0.5.0, D4) and stays so: an installed layout names it, and Herdr never overwrites a taken folder. A folder is renamed only with a migration (`migrate.js`, which carries installs across the rename). The `bot` label key and `.herdr/bots.json` are a public contract too: installed teams keep their data there.
- The monorepo's one version (`bun scripts/version.ts` at the root writes `package.json` and `mods/am-sidebar/VERSION` here; `node scripts/version.mjs check` checks them); never edit a version by hand. Releases are the monorepo's (its `.github/workflows/release.yml`): a release whose `herdr/` changed since the one before attaches `automagik-herdr-pack-<v>.tgz` and its `.sha256`; a herdr-only merge is a herdr patch (`scripts/lane.ts`, docs/rfcs/0010). Do not tag, release or push `main` yourself.
- Commits are conventional, checked on every pull request (the root `.github/workflows/commitlint.yml`): the subject matches `^(feat|fix|chore|docs|refactor|test|ci|build|perf|style|revert)(\([a-z0-9._/-]+\))?!?: .+`, and no line of the message is over 100 characters. `chore(release)`, `ci`, `docs` and `test` alone release nothing.
- Pull requests target `dev`. `main` holds released commits and nothing else.
- Pocket Link (`mods/pocket-link`) belongs to Pocket: the pack's installer and updater never write it, and it is never in `PACK_MODS`.
- Before you push, from `herdr/`: `node --test 'test/*.test.mjs' && for f in mods/*/*.js mods/*/*.mjs mods/*/bin/*.mjs scripts/*.mjs; do node --check "$f" || exit 1; done && node scripts/version.mjs check` (what CI runs).
- Do not start services, touch a live Herdr install (`~/.config/herdr-app`, `~/.config/herdr-core`) or send external messages without explicit approval; tests use temp folders and fakes.
