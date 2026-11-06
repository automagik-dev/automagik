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

// A durable preference scope, as DSH hands the locale runtime (configForms' `locale`).
function fakeHost(preference) {
  const value = preference === undefined ? {} : { preference }
  const listeners = new Set()
  return {
    getSnapshot: () => ({ value }),
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    set(field, next) {
      value[field] = next
      for (const fn of listeners) fn()
    },
    get preference() {
      return value.preference
    },
  }
}

// The runtime class out of DSH's client bundle. Without a settings scope, the browser's
// languages decide, as on a first visit; `host` is DSH's durable preference scope.
function runtime(languages, { host } = {}) {
  const loads = []
  runInNewContext(readFileSync(join(harness, BUNDLE), 'utf8'), {
    window: { __ModuleLoader__: { load: (entry) => loads.push(entry) } },
    navigator: { languages, language: languages[0] },
  })
  const platform = new Proxy({}, { get: (_target, name) => (name === '__esModule' ? true : () => {}) })
  const { LocaleRuntime } = loads[0].factory(() => platform)
  const ctx = fakeCtx(null, { host })
  ctx.emit = () => {}
  const locale = new LocaleRuntime(ctx, host)
  ctx.locale = locale
  return { locale, ctx }
}

const pack = loadClient().exports

// DSH 0.2.2's own language and dictionaries, as its client bundles register them.
function dshPortuguese(locale) {
  locale.addLanguage({ id: 'pt', label: 'Português', fallback: 'en' })
  locale.register('pluginManager', 'pt', { panel: 'Plugins', title: 'Plugins' })
  locale.register('question', 'pt', { 'reply.label': 'Responder a perguntas pendentes anteriores' })
  locale.register('sidebar', 'pt', { 'session.new': 'Nova sessão' })
}

test('DSH gives the pack\'s pt-BR language to a pt-BR browser and opens in it', () => {
  const { locale, ctx } = runtime(['pt-BR', 'pt', 'en-US'])
  assert.equal(locale.getLocale().active, 'en')
  pack.apply(ctx)
  const { active, locales } = locale.getLocale()
  assert.equal(active, 'pt-BR')
  assert.deepEqual({ ...locales.find((entry) => entry.id === 'pt-BR') }, { id: 'pt-BR', label: 'Português', fallback: 'en' })
})

test('DSH reads omni-ui in pt-BR and falls back to en for a key the pack lacks', () => {
  const { locale, ctx } = runtime(['pt-BR'])
  pack.apply(ctx)
  const t = locale.bind('omni-ui')
  assert.equal(t('Main Bot'), 'Bot principal')
  assert.equal(t('a key the Bot team does not have'), 'a key the Bot team does not have')
})

test('DSH keeps an English browser in English with the pack loaded', () => {
  const { locale, ctx } = runtime(['en-US'])
  pack.apply(ctx)
  assert.equal(locale.getLocale().active, 'en')
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Main Bot')
})

test('on DSH 0.2.1 the pt-BR entry renders the four strings DSH has', () => {
  const { locale, ctx } = runtime(['pt-BR', 'en-US'])
  pack.apply(ctx)
  assert.equal(locale.getLocale().active, 'pt-BR')
  locale.register('pluginManager', { en: { previewAlt: 'Preview of {name}', previewUnavailable: 'No preview' } })
  locale.register('question', { en: { 'reply.open': 'Open details', 'reply.close': 'Close details' } })
  assert.equal(locale.bind('pluginManager')('previewAlt', { name: 'Bots' }), 'Prévia do recurso de Bots')
  assert.equal(locale.bind('question')('reply.open'), 'Abrir os detalhes da pergunta')
})

// The proof for DSH 0.2.2: one Portuguese entry, omni-ui under it, and a saved pt-BR choice
// that still resolves to Portuguese on a browser that asks for English.
test('a saved pt-BR choice resolves to DSH pt on 0.2.2, with one Portuguese entry', () => {
  const host = fakeHost('pt-BR')
  const { locale, ctx } = runtime(['en-US'], { host })
  dshPortuguese(locale)
  assert.equal(locale.getLocale().active, 'en')
  assert.doesNotThrow(() => pack.apply(ctx))
  const { active, locales } = locale.getLocale()
  assert.equal(active, 'pt')
  assert.equal(host.preference, 'pt')
  const portuguese = Array.from(locales).filter((entry) => entry.id.toLowerCase().startsWith('pt'))
  assert.deepEqual(Array.from(portuguese, (entry) => [entry.id, entry.label]), [['pt', 'Português']])
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
  assert.equal(locale.bind('sidebar')('session.new'), 'Nova sessão')
})

test('a fresh browser on 0.2.2 gets DSH pt and no second Portuguese entry', () => {
  const host = fakeHost()
  const { locale, ctx } = runtime(['en-US'], { host })
  dshPortuguese(locale)
  pack.apply(ctx)
  assert.equal(locale.getLocale().active, 'en')
  assert.equal(host.preference, undefined)
  const locales = Array.from(locale.getLocale().locales)
  assert.deepEqual(Array.from(locales.filter((entry) => entry.id.startsWith('pt')), (entry) => entry.id), ['pt'])
})
