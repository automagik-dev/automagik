import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundleClient } from '../scripts/build-client.mjs'
import { loadDictionaries } from '../scripts/dictionaries.mjs'
import { fakeCtx, fakeLocale } from './fake-locale.js'
import { loadClient } from './load-client.js'

const dictionaries = loadDictionaries()
const { id, exports, requested } = loadClient()

// The pack, applied as DSH applies it, to a fake locale service.
function applied(options) {
  const locale = fakeLocale(options)
  const ctx = fakeCtx(locale)
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

test('a catalog with only en and zh gets pt-BR, whose fallback chain ends at en', () => {
  const { locale } = applied()
  assert.deepEqual(locale.getLocale().locales.map((entry) => entry.id), ['en', 'zh', 'pt-BR'])
  assert.deepEqual({ ...locale.getLocale().locales[2] }, { id: 'pt-BR', label: 'Português (Brasil)', fallback: 'en' })
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
  assert.equal(locale.bind('sidebar')('session.new'), 'session.new')
})

test('a DSH namespace takes the pt-BR dictionary beside its own en and zh, and a missing key falls back to en', () => {
  const locale = fakeLocale({ languages: ['pt-BR'] })
  // DSH's sidebar registers its typed dictionaries (en and zh) on its own; a key the pack lacks.
  locale.register('sidebar', { en: { 'session.new': 'New Session', 'only.en': 'Only in English' }, zh: { 'session.new': '新会话', 'only.en': '仅英文' } })
  locale.register('common', { en: { cancel: 'Cancel' }, zh: { cancel: '取消' } })
  const ctx = fakeCtx(locale)
  exports.apply(ctx)
  const t = locale.bind('sidebar')
  assert.equal(t('session.new'), 'Nova sessão')
  assert.equal(t('only.en'), 'Only in English')
  assert.equal(t('cancel'), 'Cancelar')
  assert.equal(t('no.such.key'), 'no.such.key')
})

test('every dictionary holds text', () => {
  for (const [ns, dict] of Object.entries(dictionaries)) {
    assert.ok(Object.keys(dict).length > 0, `${ns} is empty`)
    for (const [key, text] of Object.entries(dict)) assert.equal(typeof text, 'string', `${ns}:${key} is not text`)
  }
})
