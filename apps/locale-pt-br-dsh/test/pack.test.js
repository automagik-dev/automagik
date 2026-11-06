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

test('client.js is the build of src/client', async () => {
  assert.equal(await bundleClient(), readFileSync(new URL('../client.js', import.meta.url), 'utf8'), 'client.js is stale: run `npm run build` and commit it')
})

test('client.js loads as the package, asks for no platform module and injects only locale', () => {
  assert.equal(id, '@automagik/locale-pt-br-dsh')
  assert.deepEqual(requested, [])
  assert.deepEqual(Array.from(exports.inject), ['locale'])
  assert.equal(typeof exports.apply, 'function')
})

test('the pack carries omni-ui and no DSH namespace', () => {
  assert.deepEqual(Object.keys(dictionaries), ['omni-ui'])
})

test('the pack keeps DSH\'s one Portuguese entry and puts omni-ui under it', () => {
  const { locale, ctx } = applied({ languages: ['pt-BR'] })
  assert.deepEqual(locale.getLocale().locales.map((entry) => entry.id), ['en', 'zh', 'pt'])
  assert.equal(locale.getLocale().locales.filter((entry) => entry.id.startsWith('pt')).length, 1)
  assert.deepEqual(locale.calls.filter(([kind]) => kind === 'addLanguage'), [])
  assert.deepEqual(locale.calls.filter(([kind]) => kind === 'register').map(([, ns, form]) => [ns, form]), [['omni-ui', 'pt']])
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
  assert.equal(ctx.labels.length, 1)
})

test('a pt-BR browser opens in DSH pt, not a second entry', () => {
  assert.equal(applied({ languages: ['pt-BR', 'en-US'] }).locale.getLocale().active, 'pt')
  assert.equal(applied({ languages: ['en-US'] }).locale.getLocale().active, 'en')
})

test('a DSH pt dictionary in pluginManager or question does not collide with the pack', () => {
  const locale = fakeLocale({ languages: ['pt'], portuguese: true })
  locale.register('pluginManager', 'pt', { panel: 'Plugins' })
  locale.register('question', 'pt', { 'reply.label': 'Responder' })
  const ctx = fakeCtx(locale)
  assert.doesNotThrow(() => exports.apply(ctx))
  assert.equal(locale.bind('pluginManager')('panel'), 'Plugins')
})

test('every dictionary registers once, as pt, and leaves on dispose', () => {
  const { locale, ctx } = applied()
  const registers = locale.calls.filter(([kind]) => kind === 'register')
  assert.deepEqual(registers.map(([, ns]) => ns), Object.keys(dictionaries))
  for (const [, , form] of registers) assert.equal(form, 'pt')
  ctx.dispose()
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Main Bot')
})

test('a saved pt-BR choice moves onto DSH pt, and a fresh English browser stays English', () => {
  const host = fakeHost('pt-BR')
  const { locale } = applied({ languages: ['en-US'], host })
  assert.equal(locale.getLocale().active, 'pt')

  const fresh = fakeHost()
  const untouched = applied({ languages: ['en-US'], host: fresh }).locale
  assert.equal(untouched.getLocale().active, 'en')
})

test('every dictionary holds text', () => {
  for (const [ns, dict] of Object.entries(dictionaries)) {
    assert.ok(Object.keys(dict).length > 0, `${ns} is empty`)
    for (const [key, text] of Object.entries(dict)) assert.equal(typeof text, 'string', `${ns}:${key} is not text`)
  }
})
