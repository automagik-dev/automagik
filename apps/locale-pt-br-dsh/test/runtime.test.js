// The pack against DSH's own LocaleRuntime, from the DeepSeek Harness the tests run on:
// DSH_HARNESS, else the install `bun run harness` makes in dev/harness.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { fakeCtx } from './fake-locale.js'
import { loadClient } from './load-client.js'

const BUNDLE = 'node_modules/@deepseek-ai/dsh-client-locale/lib/client.js'
const harness = [process.env.DSH_HARNESS, resolve(import.meta.dirname, '../dev/harness')].filter(Boolean).find((dir) => existsSync(join(dir, BUNDLE)))
if (!harness) {
  console.error('runtime.test: no DSH harness; set DSH_HARNESS or run bun run harness')
  process.exit(1)
}

// The runtime class out of DSH's client bundle; it is constructed with no settings scope, so the
// browser's languages decide, as on a first visit.
function runtime(languages) {
  const loads = []
  runInNewContext(readFileSync(join(harness, BUNDLE), 'utf8'), {
    window: { __ModuleLoader__: { load: (entry) => loads.push(entry) } },
    navigator: { languages, language: languages[0] },
  })
  const platform = new Proxy({}, { get: (_target, name) => (name === '__esModule' ? true : () => {}) })
  const { LocaleRuntime } = loads[0].factory(() => platform)
  const ctx = fakeCtx(null)
  ctx.emit = () => {}
  const locale = new LocaleRuntime(ctx)
  ctx.locale = locale
  return { locale, ctx }
}

const pack = loadClient().exports

test('DSH\'s runtime takes the language and opens in it for a pt-BR browser', () => {
  const { locale, ctx } = runtime(['pt-BR', 'pt', 'en-US'])
  assert.equal(locale.getLocale().active, 'en')
  pack.apply(ctx)
  const { active, locales } = locale.getLocale()
  assert.equal(active, 'pt-BR')
  assert.deepEqual({ ...locales.find((entry) => entry.id === 'pt-BR') }, { id: 'pt-BR', label: 'Português (Brasil)', fallback: 'en' })
})

test('DSH\'s runtime reads a DSH namespace in pt-BR and falls back to en for a key the pack lacks', () => {
  const { locale, ctx } = runtime(['pt-BR'])
  locale.register('sidebar', { en: { 'session.new': 'New Session', 'only.en': 'Only in English' }, zh: { 'session.new': '新会话', 'only.en': '仅英文' } })
  pack.apply(ctx)
  const t = locale.bind('sidebar')
  assert.equal(t('session.new'), 'Nova sessão')
  assert.equal(t('only.en'), 'Only in English')
})

test('DSH\'s runtime opens in pt-BR for a browser that asks for Portuguese first', () => {
  const { locale, ctx } = runtime(['pt', 'en-US'])
  pack.apply(ctx)
  assert.equal(locale.getLocale().active, 'pt-BR')
})

test('DSH\'s runtime keeps an English browser in English with the pack loaded', () => {
  const { locale, ctx } = runtime(['en-US'])
  locale.register('sidebar', { en: { 'session.new': 'New Session' }, zh: { 'session.new': '新会话' } })
  pack.apply(ctx)
  assert.equal(locale.getLocale().active, 'en')
  assert.equal(locale.bind('sidebar')('session.new'), 'New Session')
})
