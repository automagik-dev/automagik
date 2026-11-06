import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundleClient } from '../scripts/build-client.mjs'
import { loadDictionaries } from '../scripts/dictionaries.mjs'
import { fakeCtx, fakeLocale } from './fake-locale.js'
import { loadClient } from './load-client.js'

const dictionaries = loadDictionaries()
const { id, exports, requested } = loadClient()

// The pack, applied as DSH 0.2.2 applies it: the locale service already lists DSH's pt entry.
function applied(options = {}) {
  const locale = fakeLocale({ portuguese: true, ...options })
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

test('the pack carries omni-ui and corrected keys of five DSH namespaces', () => {
  assert.deepEqual(Object.keys(dictionaries), ['chat', 'conversation', 'omni-ui', 'permission.access', 'pluginManager'])
  assert.deepEqual(Object.keys(dictionaries.chat), [
    'number.groupSeparator',
    'clock.md',
    'clock.ymd',
    'message.systemPrompt',
    'message.systemPromptUpdate',
    'message.stepProcess.tools',
    'message.context.instructions.updated',
  ])
  assert.deepEqual(Object.keys(dictionaries.conversation), ['hint.plan', 'placeholder.plan', 'row.input', 'row.output', 'tool.title.queryRuntime'])
  assert.deepEqual(Object.keys(dictionaries['permission.access']), ['auto.label'])
  assert.deepEqual(Object.keys(dictionaries.pluginManager), ['terminalRunning'])
})

test('the pack keeps both Portuguese entries while DSH\'s copy is wrong', () => {
  const { locale } = applied({ languages: ['pt-BR'] })
  assert.deepEqual(locale.getLocale().locales.map((entry) => entry.id), ['en', 'zh', 'pt', 'pt-BR'])
  assert.deepEqual({ ...locale.getLocale().locales.at(-1) }, { id: 'pt-BR', label: 'Português (Brasil)', fallback: 'pt' })
  assert.deepEqual(locale.chain(), ['pt-BR', 'pt', 'en'])
  assert.equal(locale.getLocale().active, 'pt-BR')
})

test('omni-ui registers under DSH pt, so both Portuguese entries read it', () => {
  const { locale } = applied({ languages: ['pt-BR'] })
  const registers = locale.calls.filter(([kind]) => kind === 'register')
  assert.deepEqual(registers.map(([, ns, form]) => [ns, form]), [
    ['chat', 'pt-BR'],
    ['conversation', 'pt-BR'],
    ['omni-ui', 'pt'],
    ['permission.access', 'pt-BR'],
    ['pluginManager', 'pt-BR'],
  ])
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
  locale.setLocale('pt')
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Bot principal')
})

test('the corrected keys win on pt-BR and DSH pt fills everything else', () => {
  const { locale } = applied({ languages: ['pt-BR'] })
  locale.register('chat', 'pt', { 'clock.md': '{m}/{d}', 'number.groupSeparator': ',', 'other.key': 'DSH pt' })
  const t = locale.bind('chat')
  assert.equal(t('clock.md'), '{d}/{m}')
  assert.equal(t('number.groupSeparator'), '.')
  assert.equal(t('other.key'), 'DSH pt')
  assert.equal(locale.bind('conversation')('hint.plan'), 'descreva sua tarefa para gerar um plano')
})

test('a browser that asks for pt-BR opens in pt-BR; a plain pt browser takes DSH\'s entry', () => {
  assert.equal(applied({ languages: ['pt-BR', 'en-US'] }).locale.getLocale().active, 'pt-BR')
  assert.equal(applied({ languages: ['pt', 'en-US'] }).locale.getLocale().active, 'pt')
  assert.equal(applied({ languages: ['en-US'] }).locale.getLocale().active, 'en')
})

test('every dictionary registers once, as pt or pt-BR, and leaves on dispose', () => {
  const { locale, ctx } = applied({ languages: ['en-US'] })
  const registers = locale.calls.filter(([kind]) => kind === 'register')
  assert.deepEqual(registers.map(([, ns]) => ns), Object.keys(dictionaries))
  ctx.dispose()
  assert.equal(locale.bind('omni-ui')('Main Bot'), 'Main Bot')
})

test('every dictionary holds text', () => {
  for (const [ns, dict] of Object.entries(dictionaries)) {
    assert.ok(Object.keys(dict).length > 0, `${ns} is empty`)
    for (const [key, text] of Object.entries(dict)) assert.equal(typeof text, 'string', `${ns}:${key} is not text`)
  }
})
