# Português (Brasil) (`@automagik/locale-pt-br-dsh`)

Brazilian Portuguese for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). DSH 0.2.2 ships Portuguese itself, as **Português**; this client plugin keeps a **Português (Brasil)** entry with the Bot team's own strings and the DSH strings DSH's copy gets wrong, and falls back to DSH's `pt` for everything else.

Supported runtime: **DSH 0.2.2-rc.1 or later** (`engines.dsh` is `>=0.2.2-rc.1 <0.3.0-0`). Earlier DSH releases have no `pt` to fall back to, and DSH refuses the install there.

## Why two Portuguese entries

DSH's `pt` copy is wrong on keys a reader sees: `chat.clock.md` is `{m}/{d}`, so 6 November shows as 11/6 (read as 11 June); `chat.number.groupSeparator` is `,`, so 1,234 reads as 1.234; the plan hint is left in English (`describe your task to generate plan`); `row.input`/`output` are `IN`/`OUT`; `auto.label` is `Auto review`; and several strings are mistranslated (`message.systemPrompt` "Alerta do sistema" for *system prompt*, `terminalRunning` "Correndo" for *running*, and others). A pack cannot override a namespace DSH already registers for `pt` — the second registration throws — so the corrected strings live under this pack's own `pt-BR` id, which falls back to DSH's `pt`.

Until the owner decides between fixing this upstream in DSH and accepting DSH's copy, the pack keeps its own entry: correctness over a single picker row. A reader who chose **Português (Brasil)** keeps that choice; a reader on DSH's **Português** gets DSH's copy.

## What it carries

| Namespace | Keys | Why |
|---|---|---|
| `omni-ui` | all 1,450 | The Bot team's namespace, which DSH does not have; registered under `pt`, so both Portuguese entries read it |
| `chat` | 7 | Date order, grouping separator, and two mistranslations |
| `conversation` | 5 | Plan hint left in English, `IN`/`OUT`, query-runtime wording |
| `permission.access` | 1 | `Auto review` |
| `pluginManager` | 1 | "Correndo" (*jogging*) for a running plugin |

The full diff against DSH 0.2.2-rc.1 measured 1,267 strings the pack used to carry: DSH's `pt` already translates 1,263 (500 identical, 763 worded differently); four no longer exist in 0.2.2. The pack now carries only the wrong ones above, and DSH supplies the rest through the fallback chain.

`omni-ui` holds all 1,450 Bot team keys. A few keep their English text on purpose: brand and product names (`Omni`, `DSH`, `Automagik`, `DeepSeek`, `Claude`, `Codex`, `ChatGPT`, `OpenAI`, `Anthropic`, `Google`, `GitHub`, `Namastex`, `Kimi`, `MCP`, `API`), code-like strings (`cookies.txt, JSON, storageState`, `MEMORY.md`, `GITHUB_TOKEN`, `~/.codex/pets`, `#rrggbb`, `@Name`, `/side`, `/feedback`), words Brazilian Portuguese uses unchanged (`Chat`, `Bots`, `Plugins`, `Admin`, `Site`, `Terminal`, `Endpoint`, `Feedback`, `Skill`, `status`, `tokens`, `Pets`), and strings that are only a value (`{count}`, `{n}h`, `1 item`). `test/coverage.test.js` requires every Bot key to have an entry and at least 95% of them to differ from the English text.

A plugin can add its own words to `omni-ui` through the Bot team's `addStrings` (Unfold session's model-menu messages, `apps/unfold-session-dsh/src/client/strings.js`); `scripts/copy-check.mjs` lists those modules in `OMNI_PLUGIN_STRINGS`, so their keys are checked and covered like the Bot team's. The Bot team words a host message with any language pack's entry for it.

The welcome (`@automagik/welcome-dsh`) registers its pt-BR copy in its `welcome.team` namespace under both `pt-BR` and DSH's `pt`, so the onboarding reads in Portuguese whichever entry is active.

## Install

1. Add the Automagik market to DSH's plugin market ([marketplace/README.md](../../marketplace/README.md) has the URL).
2. Install **Português (Brasil)**. If DSH asks for a restart, restart it.
3. Pick **Português (Brasil)** in Settings › General › Language, or open DSH in a browser set to Portuguese.

The client declares `inject: ['locale']` and loads in DSH's first boot phase (`immediately`). The host half does nothing. It needs no settings.

## Develop

```sh
bun run harness      # the pinned DSH release the tests and the linter run against
bun run build        # client.js from src/client; commit it with the sources
bun run test         # on Node: a fake locale service, then DSH's own LocaleRuntime
bun run lint
node scripts/copy-check.mjs     # every pt-BR text against its English text and the copy rules
```

`src/client/locales/pt-BR/omni-ui.json` is keyed by the Bot team's English text; the four DSH namespace files hold only the keys DSH's `pt` gets wrong. The copy check rejects a key outside its English dictionary, each `omni-ui` key the Bot team no longer has, and every `{placeholder}` that does not match its English text. Its rules: Brazilian Portuguese, gender-neutral for the person, no article before Unfold, "clique" for a click, and "ambiente isolado" for a sandbox.

To move to a new DSH release, refresh `test/en/` from that release's English dictionaries and check the overrides still beat DSH's `pt`.
