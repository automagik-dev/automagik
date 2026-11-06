# DSH pt-BR copy fixes (dropped from the pack, kept for upstream)

Felipe ratified the locale shrink as-is: **one Portuguese row, DSH's own `pt`** (dates `11/6`,
thousands `1,000`), and the pack's `pt-BR` entry and the four DSH-namespace overrides stay
dropped until upstream carries the Brazilian copy. This file preserves exactly what was dropped,
with the upstream file and key for each string, so the fixes can be offered to DeepSeek Harness
without re-deriving them. Nothing in this repository registers these dictionaries.

Upstream state checked on 2026-11-06, `deepseek-ai/deepseek-harness` `master`, MIT.
`CONTRIBUTING.md` says the project **cannot accept external pull requests at the moment**; it
points contributors to GitHub Discussions instead. Do not open an upstream PR without the owner's
approval and without that policy changing.

## What DSH's `pt` does today and what should change

| Upstream file (line in `master`) | Key | Today (DSH `pt`) | Brazilian fix |
|---|---|---|---|
| `packages/client/ui-chat/src/client/locale.ts` (1661) | `clock.md` | `{m}/{d}` → 6 Nov as `11/6` | `{d}/{m}` → `06/11` |
| `packages/client/ui-chat/src/client/locale.ts` (1662) | `clock.ymd` | `{y}-{m}-{d}` | `{d}/{m}/{y}` |
| `packages/client/ui-chat/src/client/locale.ts` (1532) | `number.groupSeparator` | `,` → 1,234 as `1.234` | `.` → `1.234` |
| `packages/client/ui-chat/src/client/locale.ts` (1579) | `message.systemPrompt` | `Alerta do sistema` | `Prompt do sistema` |
| `packages/client/ui-chat/src/client/locale.ts` (1580) | `message.systemPromptUpdate` | `Atualização imediata do sistema` | `Atualização do prompt do sistema` |
| `packages/client/ui-chat/src/client/locale.ts` (1473) | `message.stepProcess.tools` | `Ferramentas de chamada` | `Chamando ferramentas` |
| `packages/client/ui-chat/src/client/locale.ts` (1595) | `message.context.instructions.updated` | `atualizado` | `atualizadas` |
| `packages/client/ui-conversation/src/client/locales.ts` (2781) | `hint.plan` | English (`describe your task to generate plan`) | `descreva sua tarefa para gerar um plano` |
| `packages/client/ui-conversation/src/client/locales.ts` (2784) | `placeholder.plan` | English | `descreva sua tarefa para gerar um plano` |
| `packages/client/ui-conversation/src/client/locales.ts` (2916) | `tool.title.queryRuntime` | `Tempo de execução da consulta` | `Consultar o runtime` |
| `packages/client/ui-conversation/src/client/locales.ts` (3086) | `row.input` | `IN` | `ENTRADA` |
| `packages/client/ui-conversation/src/client/locales.ts` (3087) | `row.output` | `OUT` | `SAÍDA` |
| `packages/client/ui-permission-presets/src/client/locales.ts` (299) | `permission.access` `auto.label` | `Auto review` | `Revisão automática` |
| `packages/client/ui-plugin-manager/src/client/locales.ts` (2313) | `terminalRunning` | `Correndo` (jogging) | `Rodando` |

## The dropped dictionaries, verbatim

These are the four files removed from `apps/locale-pt-br-dsh/src/client/locales/pt-BR/` in the
shrink. They were registered under the pack's own `pt-BR` entry, which the pack no longer adds.
The Bot team's `omni-ui` dictionary (1,450 keys) stays in the pack and is not part of this file.

### `chat.json`

```json
{
  "number.groupSeparator": ".",
  "clock.md": "{d}/{m}",
  "clock.ymd": "{d}/{m}/{y}",
  "message.systemPrompt": "Prompt do sistema",
  "message.systemPromptUpdate": "Atualização do prompt do sistema",
  "message.stepProcess.tools": "Chamando ferramentas",
  "message.context.instructions.updated": "atualizadas"
}
```

### `conversation.json`

```json
{
  "hint.plan": "descreva sua tarefa para gerar um plano",
  "placeholder.plan": "descreva sua tarefa para gerar um plano",
  "row.input": "ENTRADA",
  "row.output": "SAÍDA",
  "tool.title.queryRuntime": "Consultar o runtime"
}
```

### `permission.access.json`

```json
{
  "auto.label": "Revisão automática"
}
```

### `pluginManager.json`

```json
{
  "terminalRunning": "Rodando"
}
```

## Why these cannot be served from a plugin under one row

DSH 0.2.2's `LocaleRuntime.register(ns, locale, dict)` throws when the namespace already has that
locale (`locale namespace "<ns>" already has locale "pt"`), so a pack cannot register a second
`pt` dictionary for `chat`, `conversation`, `permission.access` or `pluginManager`. The four
overrides therefore required the pack's own `pt-BR` language entry — the second picker row the
owner removed. The only one-row mechanism tested on 0.2.2-rc.1 is to merge keys into the
dictionary DSH registered for `pt` (`locale.dicts`, a plain class field; the dictionary object is
stored by reference and is not frozen), which reaches into private runtime state and was not
adopted.
