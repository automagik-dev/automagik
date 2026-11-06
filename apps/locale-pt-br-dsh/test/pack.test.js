import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundleClient } from '../scripts/build-client.mjs'
import { loadDictionaries } from '../scripts/dictionaries.mjs'
import { fakeCtx, fakeLocale } from './fake-locale.js'
import { loadClient } from './load-client.js'

const dictionaries = loadDictionaries()
const { id, exports, requested } = loadClient()

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

// The pack, applied as DSH 0.2.2 applies it: the locale service already lists DSH's pt entry.
function applied(options = {}) {
  const locale = fakeLocale({ portuguese: true, ...options })
  const ctx = fakeCtx(locale, { host: options.host })
  exports.apply(ctx)
  return { locale, ctx }
}

// The pack as it was before this one: its own pt-BR entry, the DSH strings under it, and omni-ui
// under pt. A profile that still has that copy mounted unloads it when DSH replaces the plugin;
// its disposers are what this returns.
function oldPack(locale) {
  const offs = [
    locale.addLanguage({ id: 'pt-BR', label: 'Português (Brasil)', fallback: 'pt' }),
    locale.register('chat', 'pt-BR', { 'clock.md': '{d}/{m}' }),
    locale.register('omni-ui', 'pt', { 'Main Bot': 'Bot principal da cópia antiga' }),
  ]
  return () => offs.forEach((off) => off())
}

const portuguese = (locale) => locale.getLocale().locales
  .filter((entry) => entry.id.toLowerCase().startsWith('pt'))
  .map((entry) => [entry.id, entry.label])

test('client.js is the build of src/client', async () => {
  assert.equal(await bundleClient(), readFileSync(new URL('../client.js', import.meta.url), 'utf8'), 'client.js is stale: run `npm run build` and commit it')
})

test('client.js loads as the package, asks for no platform module and injects only locale', () => {
  assert.equal(id, '@automagik/locale-pt-br-dsh')
  assert.deepEqual(requested, [])
  assert.deepEqual(Array.from(exports.inject), ['locale'])
  assert.equal(typeof exports.apply, 'function')
})

test('the pack carries the Bot team\'s namespace and nothing DSH already translates', () => {
  assert.deepEqual(Object.keys(dictionaries), ['omni-ui'])
  assert.ok(Object.keys(dictionaries['omni-ui']).length > 1000)
})

test('a fresh install leaves DSH\'s one Portuguese entry and adds omni-ui under it', () => {
  const { locale, ctx } = applied({ languages: ['en-US'] })
  assert.deepEqual(portuguese(locale), [['pt', 'Português']])
  assert.deepEqual(locale.calls.filter(([kind]) => kind === 'addLanguage'), [])
  assert.deepEqual(locale.calls.filter(([kind]) => kind === 'register').map(([, ns, form]) => [ns, form]), [['omni-ui', 'pt']])
  assert.equal(locale.getLocale().active, 'en')
  locale.setLocale('pt')
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
  assert.equal(ctx.labels.length, 1)
})

test('a browser set to pt-BR lands on DSH pt, the only Portuguese entry', () => {
  const { locale } = applied({ languages: ['pt-BR', 'en-US'] })
  assert.deepEqual(portuguese(locale), [['pt', 'Português']])
  assert.equal(locale.getLocale().active, 'pt')
})

test('a saved pt-BR choice moves onto pt; a fresh English browser stays English', () => {
  const host = fakeHost('pt-BR')
  const { locale } = applied({ languages: ['en-US'], host })
  assert.equal(locale.getLocale().active, 'pt')
  assert.equal(host.preference, 'pt')
  assert.deepEqual(portuguese(locale), [['pt', 'Português']])

  const fresh = fakeHost()
  const untouched = applied({ languages: ['en-US'], host: fresh })
  assert.equal(untouched.locale.getLocale().active, 'en')
  assert.equal(fresh.preference, undefined)
})

test('a pt-BR preference adopted after the plugin loads still moves onto pt', () => {
  const host = fakeHost()
  const { locale } = applied({ languages: ['en-US'], host })
  assert.equal(locale.getLocale().active, 'en')
  // DSH adopts the durable snapshot after a start; the pack watches the same scope.
  host.set('preference', 'pt-BR')
  assert.equal(locale.getLocale().active, 'pt')
  assert.equal(host.preference, 'pt')
})

test('a profile with the old pack ends with one Portuguese entry and no duplicate registration', () => {
  const host = fakeHost('pt-BR')
  const locale = fakeLocale({ portuguese: true, languages: ['en-US'], host })
  const unload = oldPack(locale)
  assert.deepEqual(portuguese(locale), [['pt', 'Português'], ['pt-BR', 'Português (Brasil)']])
  const ctx = fakeCtx(locale, { host })
  // The old copy is still mounted: this one neither adds a second Portuguese entry nor throws on
  // the omni-ui dictionary the old copy already holds.
  assert.doesNotThrow(() => exports.apply(ctx))
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal da cópia antiga')
  assert.equal(locale.getLocale().active, 'pt')
  assert.equal(host.preference, 'pt')
  // DSH unloads the old copy as it replaces the plugin: its row and its dictionary leave, and the
  // strings this copy could not register take over.
  unload()
  assert.deepEqual(portuguese(locale), [['pt', 'Português']])
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
  ctx.dispose()
})

test('disposing the pack leaves DSH pt and the saved choice as they were', () => {
  const host = fakeHost('pt-BR')
  const { locale, ctx } = applied({ languages: ['en-US'], host })
  ctx.dispose()
  assert.deepEqual(portuguese(locale), [['pt', 'Português']])
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Main Bot')
  assert.equal(locale.getLocale().active, 'pt')
  assert.equal(host.preference, 'pt')
})

test('every dictionary holds text', () => {
  for (const [ns, dict] of Object.entries(dictionaries)) {
    assert.ok(Object.keys(dict).length > 0, `${ns} is empty`)
    for (const [key, text] of Object.entries(dict)) assert.equal(typeof text, 'string', `${ns}:${key} is not text`)
  }
})
