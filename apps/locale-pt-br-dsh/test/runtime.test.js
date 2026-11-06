// The pack against DSH's own LocaleRuntime, from the DeepSeek Harness the tests run on:
// DSH_HARNESS, else the install `bun run harness` makes in dev/harness. The pack supports DSH
// 0.2.2 and later, whose locale runtime lists `pt`; these tests register that entry and DSH's
// own pt dictionaries on a bare LocaleRuntime, as DSH's client bundles do at boot.
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
  locale.register('pluginManager', 'pt', { panel: 'Plug-ins' })
  locale.register('sidebar', 'pt', { 'session.new': 'Nova sessão' })
}

test('DSH 0.2.2 keeps one Portuguese entry and the pack adds omni-ui under it', () => {
  const { locale, ctx } = runtime(['pt-BR', 'en-US'])
  dshPortuguese(locale)
  assert.equal(locale.getLocale().active, 'pt')
  assert.doesNotThrow(() => pack.apply(ctx))
  const { active, locales } = locale.getLocale()
  assert.equal(active, 'pt')
  const portuguese = Array.from(locales).filter((entry) => entry.id.toLowerCase().startsWith('pt'))
  assert.deepEqual(Array.from(portuguese, (entry) => [entry.id, entry.label]), [['pt', 'Português']])
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
  assert.equal(locale.bind('sidebar')('session.new'), 'Nova sessão')
})

test('the pack adds no language of its own to a 0.2.2 catalog', () => {
  const { locale, ctx } = runtime(['en-US'])
  dshPortuguese(locale)
  pack.apply(ctx)
  const ids = Array.from(locale.getLocale().locales, (entry) => entry.id).sort()
  assert.deepEqual(ids, ['en', 'pt', 'zh'])
})

// The proof for homes that saved pt-BR under the old pack: an English browser still resolves
// to Portuguese, and the stored choice is rewritten to DSH's id.
test('a saved pt-BR choice resolves to DSH pt on 0.2.2', () => {
  const host = fakeHost('pt-BR')
  const { locale, ctx } = runtime(['en-US'], { host })
  dshPortuguese(locale)
  assert.equal(locale.getLocale().active, 'en')
  assert.doesNotThrow(() => pack.apply(ctx))
  assert.equal(locale.getLocale().active, 'pt')
  assert.equal(host.preference, 'pt')
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
})

test('a fresh English browser on 0.2.2 gets DSH pt and no second Portuguese entry', () => {
  const host = fakeHost()
  const { locale, ctx } = runtime(['en-US'], { host })
  dshPortuguese(locale)
  pack.apply(ctx)
  assert.equal(locale.getLocale().active, 'en')
  assert.equal(host.preference, undefined)
  const locales = Array.from(locale.getLocale().locales)
  assert.deepEqual(Array.from(locales.filter((entry) => entry.id.startsWith('pt')), (entry) => entry.id), ['pt'])
})
