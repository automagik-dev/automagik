import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'
import { HermesTransport } from '../src/host/hermes-transport.js'
import { install } from '../src/host/hermes-remote.js'
import { fakeContext } from './fake-ctx.js'
import { desktop8Session } from './fixtures/hermes-desktop8.mjs'

// Use the same React seed as the real DSH app, without evaluating its bootstrap.
const require = createRequire(join(process.env.DSH_HARNESS, 'package.json'))
const { JSDOM } = require('jsdom')
const assets = join(process.env.DSH_HARNESS, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
const frontend = readFileSync(join(assets, readdirSync(assets).find(name => /^index-.*\.js$/.test(name))), 'utf8')
const seed = /function (\w+)\(\)\{return\{react:[\s\S]*?\}\}/.exec(frontend)
assert.ok(seed)
const seeds = await build({ stdin: { contents: `${frontend.slice(0, seed.index + seed[0].length)}; globalThis.nativeSeeds = ${seed[1]}();`, resolveDir: assets }, bundle: true, format: 'iife', platform: 'browser', write: false })
const seedDom = new JSDOM('<!doctype html><body></body>')
const seedContext = { window: seedDom.window, document: seedDom.window.document, navigator: seedDom.window.navigator, MutationObserver: seedDom.window.MutationObserver, console, setTimeout, clearTimeout, performance, TextEncoder, TextDecoder }
runInNewContext(seeds.outputFiles[0].text, seedContext)
const nativeRequire = name => seedContext.nativeSeeds[name] ?? require(name)
const React = nativeRequire('react'), { createRoot } = nativeRequire('react-dom/client'), { flushSync } = nativeRequire('react-dom')
const compiled = await build({ entryPoints: [new URL('../src/client/hermes-remote.js', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'browser', write: false, external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] })
async function waitFor(predicate, description) {
  const deadline = Date.now() + 5000
  for (;;) {
    const value = predicate()
    if (value) return value
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function renderSettings(t, call) {
  const dom = new JSDOM('<div id="root"></div>')
  const keys = ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'MutationObserver']
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key))
  keys.forEach(key => Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] }))
  const module = { exports: {} }
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: nativeRequire, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, console, setTimeout, clearTimeout, fetch: async (_url, init) => ({ ok: true, json: async () => ({ ok: true, value: await call(JSON.parse(init.body)) }) }) })
  const root = createRoot(dom.window.document.getElementById('root'))
  t.after(() => {
    flushSync(() => root.unmount()); dom.window.close()
    keys.forEach((key, index) => saved[index] ? Object.defineProperty(globalThis, key, saved[index]) : delete globalThis[key])
  })
  const failures = []
  flushSync(() => root.render(React.createElement(module.exports.HermesRemoteSettings, {
    run: promise => promise.catch(error => { failures.push(error); return false }),
    Section: ({ children, title }) => React.createElement('section', null, title ? React.createElement('h3', null, title) : null, children),
  })))
  await waitFor(() => dom.window.document.querySelector('input[aria-label="Address"]'), 'remote settings to render')
  const click = async label => { const button = [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(button, label); flushSync(() => button.click()) }
  return { document: dom.window.document, click, failures }
}

const sampleView = () => ({ address: '', profile: 'Sample', enabled: false, credentialSet: true, models: [], sessions: [] })

test('saved remote keys are never echoed; Replace opens an empty password input and Save hides it', async t => {
  const calls = []
  const { document, click, failures } = await renderSettings(t, async call => { calls.push(call); return sampleView() })
  assert.match(document.body.textContent, /Key saved/)
  assert.equal(document.querySelector('input[aria-label="Credential"]'), null)
  assert.equal(document.querySelector('h3'), null, 'the dialog owns the single page title')
  await click('Replace')
  const input = document.querySelector('input[aria-label="Credential"]')
  assert.equal(input.type, 'password')
  assert.equal(input.value, '')
  assert.equal(input.autocomplete, 'new-password')
  await click('Save')
  await waitFor(() => document.querySelector('input[aria-label="Credential"]') === null, 'saved credentials to render')
  assert.equal(calls.at(-1).endpoint, 'hermes-remote-configure')
  assert.equal(calls.at(-1).payload.credential, '')
  assert.equal(document.querySelector('input[aria-label="Credential"]'), null)
  assert.match(document.body.textContent, /Key saved/)
  assert.deepEqual(failures, [])
})

test('new remote credentials use a real password input', async t => {
  const { document } = await renderSettings(t, async () => ({ ...sampleView(), credentialSet: false }))
  assert.equal(document.querySelector('input[aria-label="Credential"]').type, 'password')
  assert.doesNotMatch(document.body.textContent, /Key saved/)
})

test('Settings renders redacted role+text history returned by the real resume and reconcile endpoint', async t => {
  const credential = randomUUID(), ticket = randomUUID(), session = randomUUID(), stored = randomUUID()
  const source = desktop8Session(session, stored), sent = []
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.frame({ method: 'event', params: { type: 'gateway.ready', payload: { replay_epoch: 'sample-epoch' } } })) }
    frame(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', ...data }) })) }
    send(text) {
      const frame = JSON.parse(text); sent.push(frame)
      const result = frame.method === 'client.capabilities' ? { server_requests: ['approval'] }
        : frame.method === 'session.events.since' ? { events: [], latest_seq: 1, epoch: 'sample-epoch', truncated: false, count: 0, open_requests: [] }
          : { ...source.live, messages: [{ role: 'assistant', text: `Recovered answer ${credential} ${ticket}` }, { role: 'assistant', content: 'Compatible history answer' }] }
      queueMicrotask(() => this.frame({ id: frame.id, result }))
    }
    close() { this.dispatchEvent(new Event('close')) }
  }
  const ctx = fakeContext(), endpoints = new Map()
  ctx.llm.registerAdapter = () => () => {}
  t.after(() => ctx.dispose())
  const rt = { ctx, state: { prefs: { hermesRemote: { address: `https://${randomUUID()}.invalid`, profile: 'sample', enabled: true, models: [], credentialRef: 'SAMPLE' } }, hermesSessions: { sample: { storedSessionId: stored, runtimeSessionId: session, pendingSubmit: true, uncertain: true } } },
    load: async () => {}, save: async () => {}, loadSecrets: async () => {}, secretValue: () => credential, hooks: { endpoint: (name, fn) => endpoints.set(name, fn) } }
  install(rt, { transport: options => new HermesTransport({ ...options, fetch: async () => ({ ok: true, json: async () => ({ ticket }) }), socket: () => new Socket() }) })
  const { document, click, failures } = await renderSettings(t, ({ endpoint, payload }) => endpoints.get(endpoint)(payload))
  await click('Reconnect and reconcile')
  const history = await waitFor(() => document.querySelector('pre')?.textContent, 'reconciled history to render')
  assert.match(history, /assistant: Recovered answer/)
  assert.match(history, /assistant: Compatible history answer/)
  assert.match(history, /redacted/)
  assert.ok(!history.includes(credential) && !history.includes(ticket))
  assert.equal(sent.find(frame => frame.method === 'session.resume').params.session_id, stored)
  assert.ok(sent.some(frame => frame.method === 'session.activate'))
  assert.ok(!sent.some(frame => frame.method === 'prompt.submit'))
  assert.deepEqual(failures, [])
})
