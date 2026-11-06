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
  locale.register('chat', 'pt', { 'clock.md': '{m}/{d}', 'number.groupSeparator': ',' })
  locale.register('sidebar', 'pt', { 'session.new': 'Nova sessão' })
}

// The pack as it was before this one: its pt-BR entry, the DSH namespace under it, and omni-ui
// under pt. Its disposers are what DSH runs as it replaces the old plugin with this one.
function oldPack(locale) {
  const offs = [
    locale.addLanguage({ id: 'pt-BR', label: 'Português (Brasil)', fallback: 'pt' }),
    locale.register('chat', 'pt-BR', { 'clock.md': '{d}/{m}' }),
    locale.register('omni-ui', 'pt', { 'Main Bot': 'Bot principal da cópia antiga' }),
  ]
  return () => offs.forEach((off) => off())
}

const portuguese = (locale) => Array.from(locale.getLocale().locales)
  .filter((entry) => entry.id.toLowerCase().startsWith('pt'))
  .map((entry) => [entry.id, entry.label])

test('a fresh install keeps DSH\'s one Portuguese entry and registers omni-ui under it', () => {
  const host = fakeHost()
  const { locale, ctx } = runtime(['en-US'], { host })
  dshPortuguese(locale)
  assert.doesNotThrow(() => pack.apply(ctx))
  assert.deepEqual(portuguese(locale), [['pt', 'Português']])
  assert.equal(locale.getLocale().active, 'en')
  assert.equal(host.preference, undefined)
  locale.setLocale('pt')
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
})

test('a browser set to pt-BR lands on DSH pt, the only Portuguese entry', () => {
  const { locale, ctx } = runtime(['pt-BR', 'en-US'])
  dshPortuguese(locale)
  pack.apply(ctx)
  assert.deepEqual(portuguese(locale), [['pt', 'Português']])
  assert.equal(locale.getLocale().active, 'pt')
})

test('a saved pt-BR choice ends on pt instead of dropping to English', () => {
  const host = fakeHost('pt-BR')
  const { locale, ctx } = runtime(['en-US'], { host })
  dshPortuguese(locale)
  assert.equal(locale.getLocale().active, 'en')
  assert.doesNotThrow(() => pack.apply(ctx))
  assert.equal(locale.getLocale().active, 'pt')
  assert.equal(host.preference, 'pt')
  assert.deepEqual(portuguese(locale), [['pt', 'Português']])
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
  assert.equal(locale.bind('sidebar')('session.new'), 'Nova sessão')
})

test('a profile with the old pack ends with one Portuguese entry and no duplicate registration', () => {
  const host = fakeHost('pt-BR')
  const { locale, ctx } = runtime(['en-US'], { host })
  dshPortuguese(locale)
  const unload = oldPack(locale)
  assert.deepEqual(portuguese(locale), [['pt', 'Português'], ['pt-BR', 'Português (Brasil)']])
  assert.doesNotThrow(() => pack.apply(ctx))
  assert.equal(locale.getLocale().active, 'pt')
  assert.equal(host.preference, 'pt')
  // DSH unloads the old plugin as it loads this one: the old row and its dictionary leave, and the
  // strings this copy could not register while the old one held them take over.
  unload()
  assert.deepEqual(portuguese(locale), [['pt', 'Português']])
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
  // DSH's own pt copy serves the DSH screens; this pack no longer overrides them.
  assert.equal(locale.bind('chat')('clock.md'), '{m}/{d}')
})

test('uninstalling the pack leaves DSH pt, the saved choice and DSH\'s copy', () => {
  const host = fakeHost('pt-BR')
  const { locale, ctx } = runtime(['en-US'], { host })
  dshPortuguese(locale)
  pack.apply(ctx)
  ctx.dispose()
  assert.deepEqual(portuguese(locale), [['pt', 'Português']])
  assert.equal(locale.getLocale().active, 'pt')
  assert.equal(host.preference, 'pt')
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Main Bot')
  assert.equal(locale.bind('sidebar')('session.new'), 'Nova sessão')
})
