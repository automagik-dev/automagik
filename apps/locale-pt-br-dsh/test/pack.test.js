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

// The pack, applied as DSH applies it, to a fake locale service.
function applied(options = {}) {
  const locale = fakeLocale(options)
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

test('a DSH without Portuguese gets pt-BR, whose fallback chain ends at en', () => {
  const { locale } = applied()
  assert.deepEqual(locale.getLocale().locales.map((entry) => entry.id), ['en', 'zh', 'pt-BR'])
  assert.deepEqual({ ...locale.getLocale().locales[2] }, { id: 'pt-BR', label: 'Português', fallback: 'en' })
  locale.setLocale('pt-BR')
  assert.deepEqual(locale.chain(), ['pt-BR', 'en'])
})

test('a browser that asks for pt-BR, or for any Portuguese, opens in pt-BR; others keep their language', () => {
  assert.equal(applied({ languages: ['pt-BR', 'en-US'] }).locale.getLocale().active, 'pt-BR')
  assert.equal(applied({ languages: ['pt', 'en'] }).locale.getLocale().active, 'pt-BR')
  assert.equal(applied({ languages: ['en-US'] }).locale.getLocale().active, 'en')
  assert.equal(applied({ languages: ['zh-CN'] }).locale.getLocale().active, 'zh')
})

test('every dictionary registers once, as pt-BR, after the language, and leaves on dispose', () => {
  const { locale, ctx } = applied()
  const registers = locale.calls.filter(([kind]) => kind === 'register')
  assert.equal(locale.calls[0][0], 'addLanguage')
  assert.deepEqual(registers.map(([, ns]) => ns), Object.keys(dictionaries))
  for (const [, , form] of registers) assert.equal(form, 'pt-BR')
  assert.equal(ctx.labels.length, 1 + Object.keys(dictionaries).length)
  ctx.dispose()
  assert.deepEqual(locale.getLocale().locales.map((entry) => entry.id), ['en', 'zh'])
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Main Bot')
})

test('the pt-BR entry still renders the four strings when DSH 0.2.1 has them', () => {
  const locale = fakeLocale({ languages: ['pt-BR'] })
  locale.register('pluginManager', { en: { previewAlt: 'Preview of {name}', previewUnavailable: 'No preview' } })
  locale.register('question', { en: { 'reply.open': 'Open details', 'reply.close': 'Close details' } })
  const ctx = fakeCtx(locale)
  exports.apply(ctx)
  const pm = locale.bind('pluginManager')
  assert.equal(pm('previewAlt', { name: 'Bots' }), 'Prévia do recurso de Bots')
  assert.equal(pm('previewUnavailable'), 'Não foi possível mostrar a prévia do recurso')
  assert.equal(locale.bind('question')('reply.open'), 'Abrir os detalhes da pergunta')
  assert.equal(locale.bind('question')('reply.close'), 'Fechar os detalhes da pergunta')
})

// DSH 0.2.2: its own pt entry, its own dictionaries. The pack adds omni-ui under that locale
// and registers nothing in the namespaces DSH already serves in pt.
test('a DSH that ships pt keeps one Portuguese entry and puts omni-ui under it', () => {
  const { locale, ctx } = applied({ languages: ['pt-BR'], portuguese: true })
  assert.deepEqual(locale.getLocale().locales.map((entry) => entry.id), ['en', 'zh', 'pt'])
  assert.equal(locale.getLocale().locales.filter((entry) => entry.id.startsWith('pt')).length, 1)
  assert.deepEqual(locale.calls.filter(([kind]) => kind === 'addLanguage'), [])
  assert.deepEqual(locale.calls.filter(([kind]) => kind === 'register').map(([, ns, form]) => [ns, form]), [['omni-ui', 'pt']])
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
  assert.equal(ctx.labels.length, 1)
})

test('a DSH pt dictionary in pluginManager or question does not collide with the pack', () => {
  const locale = fakeLocale({ languages: ['pt'], portuguese: true })
  locale.register('pluginManager', 'pt', { panel: 'Plugins' })
  locale.register('question', 'pt', { 'reply.label': 'Responder' })
  const ctx = fakeCtx(locale)
  assert.doesNotThrow(() => exports.apply(ctx))
  assert.equal(locale.bind('pluginManager')('panel'), 'Plugins')
})

test('a saved pt-BR choice moves onto DSH pt, and a fresh English browser stays English', () => {
  const host = fakeHost('pt-BR')
  const { locale } = applied({ languages: ['en-US'], portuguese: true, host })
  assert.equal(locale.getLocale().active, 'pt')

  const fresh = fakeHost()
  const untouched = applied({ languages: ['en-US'], portuguese: true, host: fresh }).locale
  assert.equal(untouched.getLocale().active, 'en')
})

test('every dictionary holds text', () => {
  for (const [ns, dict] of Object.entries(dictionaries)) {
    assert.ok(Object.keys(dict).length > 0, `${ns} is empty`)
    for (const [key, text] of Object.entries(dict)) assert.equal(typeof text, 'string', `${ns}:${key} is not text`)
  }
})
