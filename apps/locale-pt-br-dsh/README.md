# Português (Brasil) (`@automagik/locale-pt-br-dsh`)

Brazilian Portuguese for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). DSH ships English and Chinese; this client plugin adds **Português (Brasil)** to Settings › General › Language and registers pt-BR dictionaries for the screens a first session shows. A browser whose first language is Portuguese opens DSH in it, unless a language was already picked in Settings.

## What it translates

It uses the language-pack interface of DSH's locale service (`@deepseek-ai/dsh-client-locale`): `addLanguage({id: 'pt-BR', label: 'Português (Brasil)', fallback: 'en'})`, then `register(namespace, 'pt-BR', dictionary)` for each namespace below. DSH looks a key up in pt-BR, then in English, so anything this pack doesn't translate stays in English, key by key.

| Screen | Namespaces |
|---|---|
| Shell and the Language row | `common`, `settings.locale` |
| Sidebar and the session list | `sidebar`, `workspace` |
| Composer | `conversation`, `model`, `slash.menu`, `command`, `reference` |
| Messages | `chat` |
| Approvals and questions | `approval`, `permission.access`, `question` |
| Plugin pages | `pluginManager`, `pluginMarket`, `settings.plugins`, `settings.pluginInventory` |
| Settings | `settings` (General), `settings.theme` |
| The Bot team (`@automagik/bots-dsh`) | `omni-ui`: the sidebar, new chat, the transcript, questions, views, feedback and errors |

That is 19 of DSH 0.2.1-rc.3's 65 namespaces (1268 of its 2915 strings) and 431 of the Bot team's 1284. Not translated yet: the rest of Settings (models, account, agent loop, shell, subagents, web search, session log), the right sidebar and its previews, the trajectory and inspector views, schedules and jobs, and the Bot team's connectors, memory, secrets, usage, voice and Bot settings. A plugin's title and description in the plugin pages come from that plugin's own package, not from a dictionary, so they stay in the languages the plugin ships.

The welcome (`@automagik/welcome-dsh`) has no namespace: its copy is written into its views, so this pack can't reach it.

## Install

1. Add the Automagik market to DSH's plugin market ([marketplace/README.md](../../marketplace/README.md) has the URL).
2. Install **Português (Brasil)**. If DSH asks for a restart, restart it.
3. Pick Português (Brasil) in Settings › General › Language, or open DSH in a browser set to Portuguese.

The client declares `inject: ['locale']` and loads in DSH's first boot phase (`immediately`), so the language is in the list before the page draws. The host half does nothing. It needs no settings.

## Develop

```sh
bun run harness      # the pinned DSH release the tests and the linter run against
bun run build        # client.js from src/client; commit it with the sources
bun run test         # on Node: a fake locale service with only en and zh, then DSH's own LocaleRuntime
bun run lint
node scripts/copy-check.mjs     # every pt-BR text against its English text and the copy rules
```

A dictionary is `src/client/locales/pt-BR/<namespace>.json`, keyed as DSH's English dictionary is. The copy check keeps each DSH namespace whole (every English key of `test/en/<dsh version>.json` has a text, and no other key), each `omni-ui` key one the Bot team still has, and every `{placeholder}` in place. Its rules: Brazilian Portuguese, gender-neutral for the person, no article before Unfold, "clique" for a click, and "ambiente isolado" for a sandbox.

To move to a new DSH release, refresh `test/en/` from that release's English dictionaries and translate the keys the copy check reports missing.
