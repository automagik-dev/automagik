# Português (Brasil) (`@automagik/locale-pt-br-dsh`)

Brazilian Portuguese for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). DSH 0.2.2 ships Portuguese itself — every DSH screen reads in Brazilian Portuguese from its own `pt` dictionaries, and Settings › General › Language lists it as **Português**. This client plugin adds the part DSH does not carry: the Bot team's `omni-ui` strings, under DSH's own language. There is one Portuguese entry in the list, and a pt-BR choice saved before the upgrade keeps working: it is moved onto DSH's entry.

Supported runtime: **DSH 0.2.2-rc.1 or later** (`engines.dsh` is `>=0.2.2-rc.1 <0.3.0`). Earlier DSH releases have no `pt`, and this pack has nothing to hang its strings on; DSH refuses the install there.

## What it translates

The pack adds no language and registers one dictionary: `omni-ui`, the Bot team's namespace (`@automagik/bots-dsh`), under DSH's `pt`.

The 18 DSH namespaces it used to carry are DSH's own now: `common`, `settings`, `settings.locale`, `settings.theme`, `sidebar`, `workspace`, `conversation`, `model`, `slash.menu`, `command`, `reference`, `chat`, `approval`, `permission.access`, `question`, `pluginManager`, `pluginMarket`, `settings.plugins` and `settings.pluginInventory`. Of the 1,267 strings the pack translated there, DSH's `pt` dictionaries already translate 1,263 (500 with identical text, 763 worded differently), and the other four no longer exist in DSH 0.2.2 — `pluginManager.previewAlt`, `pluginManager.previewUnavailable`, `question.reply.open` and `question.reply.close` have no hits in the 0.2.2 packages, so they are dropped rather than carried as dead strings.

The pack carries all 1,450 `omni-ui` keys. A few hold their English text on purpose rather than a poor translation: brand and product names (`Omni`, `DSH`, `Automagik`, `DeepSeek`, `Claude`, `Codex`, `ChatGPT`, `OpenAI`, `Anthropic`, `Google`, `GitHub`, `Namastex`, `Kimi`, `MCP`, `API`), code-like strings (`cookies.txt, JSON, storageState`, `MEMORY.md`, `GITHUB_TOKEN`, `~/.codex/pets`, `#rrggbb`, `@Name`, `/side`, `/feedback`), words Brazilian Portuguese uses unchanged (`Chat`, `Bots`, `Plugins`, `Admin`, `Site`, `Terminal`, `Endpoint`, `Feedback`, `Skill`, `status`, `tokens`, `Pets`), and strings that are only a value (`{count}`, `{n}h`, `1 item`). `test/coverage.test.js` requires every Bot key to have an entry and at least 95% of them to differ from the English text.

A plugin can add its own words to `omni-ui` through the Bot team's `addStrings` (Unfold session's model-menu messages, `apps/unfold-session-dsh/src/client/strings.js`); `scripts/copy-check.mjs` lists those modules in `OMNI_PLUGIN_STRINGS`, so their keys are checked and covered like the Bot team's. The Bot team words a host message with any language pack's entry for it.

The welcome (`@automagik/welcome-dsh`) keeps its own pt-BR, in its `welcome.team` namespace: the companion step, the team step, Connect AI with its sign-ins and the Claude Code and Codex rows (there and on their Settings page), and the step rail. Names stay as written, and so do the host's error messages and what a provider's own sign-in says. The Connect Omni step comes from `@automagik/omni-channels-dsh` and reads in English until that plugin ships its pt-BR.

A plugin's title and description in the plugin pages come from that plugin's own package (its `locale/<lang>.json`, English from its `package.json`), not from a dictionary, so they stay in the languages the plugin ships.

## A saved pt-BR choice

DSH resolves a saved language by exact id. The pack's own entry was `pt-BR`; DSH's is `pt`, and registering both would put two Portuguese entries in the list. The pack registers no language: the list keeps DSH's one entry (**Português**), and the pack rewrites a stored `pt-BR` preference to `pt` through the locale service's own preference write (`setLocale`). The move happens when the plugin loads, before the choice is read, so a team that picked pt-BR under the old pack still opens in Portuguese.

## Install

1. Add the Automagik market to DSH's plugin market ([marketplace/README.md](../../marketplace/README.md) has the URL).
2. Install **Português (Brasil)**. If DSH asks for a restart, restart it.
3. Pick **Português** in Settings › General › Language (DSH's entry), or open DSH in a browser set to Portuguese.

The client declares `inject: ['locale']` and loads in DSH's first boot phase (`immediately`). The host half does nothing. It needs no settings.

## Develop

```sh
bun run harness      # the pinned DSH release the tests and the linter run against
bun run build        # client.js from src/client; commit it with the sources
bun run test         # on Node: a fake locale service, then DSH's own LocaleRuntime
bun run lint
node scripts/copy-check.mjs     # every pt-BR text against its English text and the copy rules
```

`src/client/locales/pt-BR/omni-ui.json` is keyed by the Bot team's English text. The copy check rejects a namespace DSH does not own, each `omni-ui` key the Bot team no longer has, and every `{placeholder}` that does not match its English text. Its rules: Brazilian Portuguese, gender-neutral for the person, no article before Unfold, "clique" for a click, and "ambiente isolado" for a sandbox.

To move to a new DSH release, refresh `test/en/` from that release's English dictionaries.
