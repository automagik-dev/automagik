# Automagik

Automagik's plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), and the Automagik desktop app that runs them.

| Folder | Package | What it is |
|---|---|---|
| [`apps/bots-dsh`](apps/bots-dsh/README.md) | `@automagik/bots-dsh` | The Bot team: long-lived Bots, group chats, memory, settings, scheduled tasks, the Bot browser. Omni's and Genie's plugins build on it. |
| [`apps/welcome-dsh`](apps/welcome-dsh/README.md) | `@automagik/welcome-dsh` | The welcome: the octopus, the team step, and Connect AI through DSH's own sign-ins. |
| [`apps/unfold-bridge-dsh`](apps/unfold-bridge-dsh/README.md) | `@automagik/unfold-bridge-dsh` | The Unfold bridge: your DSH's model routes for Unfold, as an OpenAI-compatible endpoint on 127.0.0.1 behind a key made at each start. |
| [`apps/locale-pt-br-dsh`](apps/locale-pt-br-dsh/README.md) | `@automagik/locale-pt-br-dsh` | Português (Brasil): adds Brazilian Portuguese to DSH's languages and translates what a first session shows, the Bot team's main screens included; the rest stays in English. |
| [`apps/unfold-capabilities-dsh`](apps/unfold-capabilities-dsh/README.md) | `@automagik/unfold-capabilities-dsh` | What Unfold can do, and how well: a read-only capability map computed only from bench scorecards, pushed when a run lands. |
| [`apps/desktop`](apps/desktop/README.md) | (the app) | The Automagik desktop app: DSH of its own with the Bot team, the welcome and Omni's channels and canvases. `omni desktop` opens it with Omni preloaded, `genie desktop` with Genie. |

Omni's own plugins (its channels and canvases) live with Omni, in [automagik-dev/omni](https://github.com/automagik-dev/omni) (`apps/omni-channels-dsh`, `apps/omni-canvas-dsh`), and carry Omni's version.

## Install

- **The desktop app**: download it from [Releases](https://github.com/automagik-dev/automagik/releases/latest), or run `omni desktop`. See [apps/desktop](apps/desktop/README.md).
- **Into your own DSH**: add the Automagik market to DSH's plugin market and install from there:

  ```
  https://raw.githubusercontent.com/automagik-dev/dsh-marketplace/main/index.json
  ```

  Every Omni also serves a market at `https://<your-omni>/api/market/index.json` with the release of these plugins it was tested with.

Nothing here is published to npm. The plugins install as git sources pinned to a release commit, or from the tarballs each release carries (`plugins.json` lists their integrity).

## History

`@automagik/bots-dsh` and `@automagik/welcome-dsh` were `@automagik/omni-dsh` and `@automagik/omni-ai-dsh` in automagik-dev/omni (`apps/omni-ui-dsh`, `apps/omni-ai-dsh`), and the desktop app was automagik-dev/omni-desktop. They moved here with their history. What did not change with the names: plugin ids (`omni-ui`, `omni-ai`), routes and browser-storage prefixes. From 3.12 the team's home is Automagik's own (`~/.automagik/bots`, or `~/.automagik/desktop/bots` in the app), and the app's identity is Automagik's (`ai.namastex.automagik`): an app from 3.11.x or before is installed afresh, not updated.

- The Bot team's client bundle also answers to its former name, so channels and canvas plugins built before the rename keep working on it.
- In your own DSH: install `@automagik/bots-dsh` from the market. With both installed, the newer one runs (they share the plugin id); remove `@automagik/omni-dsh` when you like. A settings row in your profile's `cordis.patch.yml` that names `@automagik/omni-dsh` needs its `name:` changed to `@automagik/bots-dsh` to keep applying.

## Versions and releases

One version for the whole repository, `3.N` (semver `3.N.0`, N one above the last release: `scripts/version.ts`), above the 2.x builds omni-desktop released. Every merge into dev is a release: `release.yml` tags `v<version>`, publishes the plugin tarballs and `plugins.json`, builds the desktop app into the same release (`desktop-build.yml`), lists the release in [`marketplace/automagik.json`](marketplace/automagik.json), and moves `main` to it. `follow-omni.yml` moves the desktop app to each newer Omni release and cuts a release with it.

| Branch | What |
|---|---|
| `dev` | Integration: pull requests land here; releases are cut from it |
| `main` | The latest release, moved by `release.yml` only |

## Develop

Bun for the repository's own tooling; the plugins run on Node, as DSH does (`node --test`, esbuild), with Bun installing them; the desktop app uses npm for Electron.

```sh
bun install && bun run check                    # versions, release tooling, market index
cd apps/bots-dsh && bun install && bun run harness && bun run test
cd apps/welcome-dsh && bun install && bun run harness && bun run test
cd apps/unfold-bridge-dsh && bun install && bun run harness && bun run test
cd apps/unfold-capabilities-dsh && bun install && bun run harness && bun run test
cd apps/desktop && npm ci && npm test
node scripts/boot-check.mjs                     # boot the plugins with Omni's in headless Chromium
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
