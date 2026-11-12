import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, delimiter } from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'
import { HermesTransport } from '../src/host/hermes-transport.js'
import { install } from '../src/host/hermes-remote.js'
import { startHermesSsh } from '../src/host/hermes-ssh.js'
import { fakeContext } from './fake-ctx.js'
import { desktop8Session } from './fixtures/hermes-desktop8.mjs'

// Use the same React seed as the real DSH app, without evaluating its bootstrap.
const require = createRequire(join(process.env.DSH_HARNESS, 'package.json'))
const { JSDOM } = require('jsdom')
const assets = join(process.env.DSH_HARNESS, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
const frontend = readFileSync(join(assets, readdirSync(assets).find(name => /^index-.*\.js$/.test(name))), 'utf8')
const seed = /function (\w+)\(\)\{return\{react:[\s\S]*?\}\}/.exec(frontend)
assert.ok(seed)
const seeds = await build({ stdin: { contents: `${frontend.slice(0, seed.index + seed[0].length)}; globalThis.nativeSeeds = ${seed[1]}();`, resolveDir: assets }, bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' })
const seedDom = new JSDOM('<!doctype html><body></body>')
const seedContext = { window: seedDom.window, document: seedDom.window.document, navigator: seedDom.window.navigator, MutationObserver: seedDom.window.MutationObserver, console, setTimeout, clearTimeout, performance, TextEncoder, TextDecoder }
runInNewContext(seeds.outputFiles[0].text, seedContext)
const nativeRequire = name => seedContext.nativeSeeds[name] ?? require(name)
const React = nativeRequire('react'), { createRoot } = nativeRequire('react-dom/client'), { flushSync } = nativeRequire('react-dom')
const compiled = await build({ entryPoints: [new URL('../src/client/hermes-remote.js', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'browser', write: false, external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] })
const compiledMenu = await build({ entryPoints: [new URL('../src/client/model-menu.js', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'browser', write: false, external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] })
async function waitFor(predicate, description) {
  const deadline = Date.now() + 5000
  for (;;) {
    const value = predicate()
    if (value) return value
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function renderSettings(t, call, { component = 'HermesRemoteSettings', props = {}, menu = false, abortResponses = false, sshHosts = async () => ({ aliases: [], knownHosts: [] }) } = {}) {
  const dom = new JSDOM('<div id="root"></div>')
  const keys = ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'MutationObserver']
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key))
  keys.forEach(key => Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] }))
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  const module = { exports: {} }
  const source = menu ? compiledMenu : compiled
  runInNewContext(source.outputFiles[0].text, { module, exports: module.exports, require: nativeRequire, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, console, setTimeout, clearTimeout, AbortController, crypto: globalThis.crypto, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout,
    fetch: async (_url, init) => ({ ok: true, json: async () => {
      const result = (async () => {
        try { const request = JSON.parse(init.body); return { ok: true, value: request.endpoint === 'hermes-remote-ssh-hosts' ? await sshHosts(request.payload, init.signal) : await call(request, init.signal) } }
        catch (error) { return { ok: false, error: { code: error.code, message: 'Sample connection refused.' } } }
      })()
      if (!abortResponses || !init.signal) return result
      return new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }))
        if (init.signal.aborted) { abort(); return }
        init.signal.addEventListener('abort', abort, { once: true })
        result.then(value => { init.signal.removeEventListener('abort', abort); resolve(value) }, error => { init.signal.removeEventListener('abort', abort); reject(error) })
      })
    } }),
  })
  const root = createRoot(dom.window.document.getElementById('root'))
  t.after(() => {
    flushSync(() => root.unmount()); dom.window.close()
    keys.forEach((key, index) => saved[index] ? Object.defineProperty(globalThis, key, saved[index]) : delete globalThis[key])
  })
  const failures = []
  const mount = () => flushSync(() => root.render(React.createElement(module.exports[component], {
    key: randomUUID(), run: promise => promise.catch(error => { failures.push(error); return false }),
    Section: ({ children, title }) => React.createElement('section', null, title ? React.createElement('h3', null, title) : null, children),
    onClose() {}, ...props,
  })))
  mount()
  await waitFor(() => dom.window.document.querySelector(menu ? component === 'ModelLine' ? '.bt-model-line-text' : '.bt-model-trigger' : component === 'HermesRemoteConnect' ? '.bt-hermes-wizard:not([data-status=loading])' : 'section'), 'remote settings to render')
  const click = async label => { const button = [...dom.window.document.querySelectorAll('button')].find(node => node.textContent.replace(/[→←]/g, '').trim() === label || node.getAttribute('aria-label') === label); assert.ok(button, label); flushSync(() => button.click()) }
  const fill = async (label, value) => {
    const input = [...dom.window.document.querySelectorAll('input')].find(node => node.getAttribute('aria-label') === label)
    assert.ok(input, label)
    flushSync(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
  }
  return { document: dom.window.document, click, fill, failures, root, mount }
}

const sampleView = () => ({ address: '', profile: 'Sample', enabled: false, credentialSet: true, models: [], sessions: [] })

test('Settings keeps saved keys hidden and opens an empty masked replacement in the wizard', async t => {
  const calls = []
  const { document, click, failures } = await renderSettings(t, async call => { calls.push(call); return sampleView() })
  assert.match(document.body.textContent, /Key saved/)
  assert.equal(document.querySelector('input[type="password"]'), null)
  assert.equal(document.querySelector('h3'), null, 'the dialog owns the single page title')
  await click('Replace')
  const input = await waitFor(() => document.querySelector('input[aria-label="Session token"]'), 'masked replacement')
  assert.equal(input.type, 'password')
  assert.equal(input.value, '')
  assert.equal(input.autocomplete, 'new-password')
  assert.ok(!calls.some(call => call.endpoint === 'hermes-remote-configure'), 'opening replacement writes no credentials')
  assert.deepEqual(failures, [])
})

test('new remote setup opens the wizard with an empty password field', async t => {
  const { document, click } = await renderSettings(t, async () => ({ ...sampleView(), credentialSet: false, profile: '' }))
  await click('Set up connection')
  const input = await waitFor(() => document.querySelector('input[aria-label="Session token"]'), 'new credential field')
  assert.equal(input.type, 'password')
  assert.equal(input.value, '')
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

const connectedView = () => ({ ...sampleView(), enabled: true, address: 'https://example.invalid', profile: 'sample-profile', mode: 'remote', authMode: 'token', modelRef: 'hermes-remote/sample-model', models: [{ id: 'sample-model', name: 'Sample model' }] })
const testView = () => ({ testId: randomUUID(), profiles: [{ id: 'sample-profile', name: 'sample-profile' }], status: 'connected' })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

async function startWizard(t, overrides = {}, options = {}) {
  const calls = [], opened = [], closed = []
  const call = async (request, signal) => {
    calls.push(request)
    if (overrides[request.endpoint]) return overrides[request.endpoint](request.payload, signal)
    if (request.endpoint === 'hermes-remote') return { ...sampleView(), enabled: false, profile: '', credentialSet: false }
    if (request.endpoint === 'hermes-remote-ssh-hosts') return { aliases: [], knownHosts: [] }
    if (request.endpoint === 'hermes-remote-test') return testView()
    if (request.endpoint === 'hermes-remote-test-status') return { stage: 'open' }
    if (request.endpoint === 'hermes-remote-test-profiles') return { profiles: testView().profiles }
    if (request.endpoint === 'hermes-remote-save' || request.endpoint === 'hermes-remote-connect') return connectedView()
    if (request.endpoint === 'hermes-remote-disconnect') return sampleView()
    throw Error('Unexpected fake endpoint')
  }
  const render = await renderSettings(t, call, { ...options, sshHosts: (payload, signal) => call({ endpoint: 'hermes-remote-ssh-hosts', payload }, signal), component: 'HermesRemoteConnect', props: { onConnected: next => opened.push(next), onClose: () => closed.push(true) } })
  return { ...render, calls, opened, closed }
}

async function enterToken(render, credential = randomUUID()) {
  await render.click('Continue')
  await render.fill('Remote address', 'https://example.invalid')
  await render.fill('Session token', credential)
  return credential
}

test('editing a saved token sends only its reference and keeps the replacement blank', async t => {
  const view = { ...connectedView(), credentialRef: randomUUID() }
  const calls = []
  const edit = await renderSettings(t, async call => { calls.push(call); return testView() }, { component: 'HermesRemoteConnect', props: { edit: true, initialView: view } })
  assert.equal(edit.document.querySelector('input[aria-label="Session token"]').value, '')
  await edit.click('Test connection')
  await waitFor(() => edit.document.querySelector('[data-status=connected]'), 'saved connection test')
  const draft = calls.find(call => call.endpoint === 'hermes-remote-test').payload
  assert.equal(draft.credential, '')
  assert.equal(draft.credentialRef, view.credentialRef)
  assert.equal(draft.authMode, 'token')
  assert.equal(edit.failures.length, 0)
})

test('real SSH adapter failures reach wizard actions for update, platform, timeout and host key', async t => {
  const home = await mkdtemp(join(tmpdir(), 'hermes-wizard-ssh-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await writeFile(join(home, 'ssh'), `#!${process.execPath}\n${readFileSync(new URL('./fixtures/hermes-fake-ssh.mjs', import.meta.url), 'utf8')}`, { mode: 0o700 })
  for (const [scenario, expected, advice] of [
    ['old-contract', 'Hermes needs an update', 'Update Hermes on example.invalid'],
    ['python-missing', 'This computer cannot run the SSH connection yet', 'Check the remote system and Python'],
    ['timeout', 'The connection timed out', 'The other computer did not become ready in time'],
    ['host-key', 'Trust this SSH host?', 'example.invalid is new to this computer'],
    ['changed-key', 'This host’s key has changed', 'The key for example.invalid is not the one this computer saved'],
  ]) {
    await t.test(scenario, async child => {
      let actual
      const render = await startWizard(child, { 'hermes-remote-test': async () => {
        try {
          await startHermesSsh({ host: 'example.invalid' }, { env: { ...process.env, PATH: `${home}${delimiter}${process.env.PATH}`, HERMES_SSH_SCENARIO: scenario, HERMES_SSH_RECORD: join(home, 'record.jsonl') }, allocatePort: async () => 1024, deadlines: { start: scenario === 'timeout' ? 300 : 3000, control: 1000, cancel: 500 } })
          assert.fail('fake SSH must fail')
        } catch (error) { actual = error; await error.localClosed; throw error }
      } })
      await render.click('Through SSH'); await render.click('Continue')
      await render.fill('SSH host or config name', 'example.invalid')
      await render.click('Test SSH connection')
      await waitFor(() => render.document.querySelector('[data-status=error]'), 'typed SSH error')
      assert.ok(actual?.code.startsWith('bot/hermes-ssh-'))
      assert.ok(render.document.body.textContent.includes(expected))
      assert.ok(render.document.body.textContent.includes(advice))
      assert.ok(!render.document.body.textContent.includes('Check the SSH user and key'))
      // Without the key the host kept for this request, nothing can be trusted from the page.
      assert.ok(![...render.document.querySelectorAll('button')].some(button => button.textContent.includes('Trust this host')))
    })
  }
})

test('an expired saved token from the real transport and host endpoint asks for sign-in', async t => {
  const ctx = fakeContext(), endpoints = new Map(), credential = randomUUID()
  ctx.llm.registerAdapter = () => () => {}
  t.after(() => ctx.dispose())
  const rt = { ctx, state: { prefs: { hermesRemote: { ...connectedView(), credentialRef: 'SAMPLE' } }, hermesSessions: {} }, load: async () => {}, save: async () => {}, loadSecrets: async () => {}, secretValue: () => credential, hooks: { endpoint: (name, fn) => endpoints.set(name, fn) } }
  install(rt, { fetch: async () => ({ ok: true, json: async () => ({ profiles: [] }) }), transport: options => new HermesTransport({ ...options, fetch: async () => ({ ok: false, status: 401 }) }) })
  const render = await renderSettings(t, ({ endpoint, payload }) => endpoints.get(endpoint)(payload), { component: 'HermesRemoteConnect' })
  await waitFor(() => render.document.querySelector('[data-status=error]'), 'saved sign-in failure')
  assert.match(render.document.body.textContent, /The token wasn’t accepted/)
  assert.match(render.document.body.textContent, /Enter a valid session token/)
  assert.ok(!render.document.body.textContent.includes(credential))
  assert.doesNotMatch(render.document.body.textContent, /Check the remote address/)
})

test('a real host busy refusal tells the wizard to stop or wait without address advice', async t => {
  const ctx = fakeContext(), endpoints = new Map(), credential = randomUUID()
  ctx.llm.registerAdapter = () => () => {}
  t.after(() => ctx.dispose())
  const rt = { ctx, state: { prefs: { hermesRemote: { ...connectedView(), credentialRef: 'SAMPLE' } }, hermesSessions: { sample: { pendingSubmit: true, uncertain: true, storedSessionId: randomUUID() } } }, load: async () => {}, save: async () => {}, loadSecrets: async () => {}, secretValue: () => credential, hooks: { endpoint: (name, fn) => endpoints.set(name, fn) } }
  install(rt)
  const render = await startWizard(t, { 'hermes-remote-test': () => endpoints.get('hermes-remote-configure')({ enabled: true, address: 'https://example.invalid', profile: 'another-profile' }) })
  await enterToken(render); await render.click('Test connection')
  await waitFor(() => render.document.querySelector('[data-status=error]'), 'busy chat refusal')
  assert.match(render.document.body.textContent, /A chat is still running on this connection; stop it or wait\./)
  assert.match(render.document.body.textContent, /Your connection settings were not changed\./)
  assert.equal(render.document.querySelector('.bt-hw-error-note').textContent, 'Stop the chat or wait')
  assert.doesNotMatch(render.document.body.textContent, /Check the remote address|Check the SSH user and key/)
})

test('the wizard follows the approved remote token frames with honest progress, profile save and Ready', async t => {
  const pending = deferred()
  const render = await startWizard(t, { 'hermes-remote-test': () => pending.promise })
  const { document, click, calls, opened } = render
  assert.match(document.body.textContent, /How would you like to connect/)
  assert.match(document.body.textContent, /Remote address/)
  assert.match(document.body.textContent, /Through SSH/)
  assert.equal(document.querySelectorAll('.bt-hw-steps li').length, 5)
  const secret = await enterToken(render)
  assert.equal(document.querySelector('input[aria-label="Session token"]').type, 'password')
  await click('Test connection')
  await waitFor(() => document.querySelector('[data-status=testing]'), 'testing frame')
  assert.doesNotMatch(document.body.textContent, /Your sign-in was accepted/)
  await waitFor(() => document.body.textContent.includes('Your sign-in was accepted'), 'confirmed progress stage')
  assert.equal(document.querySelectorAll('.bt-hw-check-row .bt-hw-spinner').length, 1)
  pending.resolve(testView())
  await waitFor(() => document.querySelector('[data-status=connected]'), 'connected frame')
  await click('Choose a profile')
  assert.match(document.body.textContent, /Profiles available from example.invalid/)
  assert.equal(document.querySelector('[role=radio]').getAttribute('aria-checked'), 'true')
  await click('Refresh list')
  await waitFor(() => calls.some(call => call.endpoint === 'hermes-remote-test-profiles'), 'profile refresh')
  await waitFor(() => !document.querySelector('.bt-hw-foot button:last-child').disabled, 'profile refresh rendered')
  await click('Use this profile')
  await waitFor(() => document.querySelector('[data-step=ready]'), 'Ready frame')
  assert.match(document.body.textContent, /Next time, choose Remote Hermes to connect in one click/)
  assert.match(document.body.textContent, /Connection and profile remembered/)
  const submission = calls.find(call => call.endpoint === 'hermes-remote-test')
  assert.equal(submission.payload.credential, secret)
  assert.match(submission.payload.requestId, /^[a-f\d-]{36}$/)
  const saved = calls.find(call => call.endpoint === 'hermes-remote-save').payload
  assert.deepEqual(Object.keys(saved).sort(), ['profile', 'testId'])
  assert.ok(!JSON.stringify(saved).includes(secret))
  await click('Open chat')
  assert.equal(opened[0].modelRef, 'hermes-remote/sample-model')
})

test('dashboard sign-in is masked and a refused test clears the password before editing', async t => {
  const secret = randomUUID()
  const render = await startWizard(t, { 'hermes-remote-test': () => { throw Object.assign(Error('Fake refusal'), { code: 'bot/hermes-auth' }) } })
  await render.click('Continue')
  await render.fill('Remote address', 'https://example.invalid')
  await render.click('User and password')
  await render.fill('User', 'sample-profile')
  await render.fill('Password', secret)
  assert.equal(render.document.querySelector('input[aria-label=Password]').type, 'password')
  await render.click('Sign in and test')
  await waitFor(() => render.document.querySelector('[data-status=error]'), 'sign-in error frame')
  assert.match(render.document.body.textContent, /The sign-in wasn’t accepted/)
  assert.doesNotMatch(render.document.body.textContent, /Fake refusal/)
  assert.equal(render.calls.find(call => call.endpoint === 'hermes-remote-test').payload.password, secret)
  await render.click('Edit sign-in')
  assert.equal(render.document.querySelector('input[aria-label=Password]').value, '')
  assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-save'))
})

test('SSH uses optional config defaults and a path reference, with clear strict host-key guidance', async t => {
  const render = await startWizard(t, { 'hermes-remote-test': () => { throw Object.assign(Error('Fake refusal'), { code: 'bot/hermes-ssh-host-key' }) } })
  await render.click('Through SSH')
  await render.click('Continue')
  assert.match(render.document.body.textContent, /Connect through SSH/)
  await render.fill('SSH host or config name', 'example.invalid')
  assert.equal(render.document.querySelector('input[aria-label="Port (optional)"]').value, '')
  await render.click('Choose file…')
  assert.equal(render.document.querySelector('input[aria-label="Key file path"]').type, 'text')
  assert.equal(render.document.querySelector('input[type=file]'), null, 'a private key can never be uploaded')
  await render.click('Use this path')
  await render.click('Test SSH connection')
  await waitFor(() => render.document.querySelector('[data-status=error]'), 'SSH host-key error frame')
  assert.match(render.document.body.textContent, /The key for example\.invalid is not the one this computer saved/)
  assert.match(render.document.body.textContent, /cannot trust the new key for you/)
  assert.ok(![...render.document.querySelectorAll('button')].some(button => button.textContent.includes('Trust this host')), 'a changed key has no trust button')
  const payload = render.calls.find(call => call.endpoint === 'hermes-remote-test').payload
  assert.equal(payload.mode, 'ssh')
  assert.equal(payload.ssh.host, 'example.invalid')
  assert.equal(payload.ssh.port, undefined)
  assert.equal(payload.ssh.identityFile, '')
  await render.click('Edit SSH details')
  assert.equal(render.document.querySelector('input[aria-label="SSH host or config name"]').value, 'example.invalid')
})

test('SSH authentication errors show key guidance without an installation hint', async t => {
  const render = await startWizard(t, { 'hermes-remote-test': () => { throw Object.assign(Error('Fake refusal'), { code: 'bot/hermes-ssh-auth' }) } })
  await render.click('Through SSH'); await render.click('Continue')
  await render.fill('SSH host or config name', 'example.invalid')
  await render.click('Test SSH connection')
  await waitFor(() => render.document.querySelector('[data-status=error]'), 'SSH authentication frame')
  assert.match(render.document.body.textContent, /Check your SSH details/)
  assert.match(render.document.body.textContent, /unlock it in your SSH agent/)
  assert.match(render.document.querySelector('.bt-hw-error-note').textContent, /Check the SSH user and key/)
  assert.doesNotMatch(render.document.querySelector('.bt-hw-error-note').textContent, /Hermes must already be installed/)
})

test('saved Remote Hermes connects in one click without another setup or password prompt', async t => {
  const render = await startWizard(t, { 'hermes-remote': connectedView })
  await waitFor(() => render.opened.length === 1, 'one-click connection')
  assert.equal(render.opened[0].modelRef, 'hermes-remote/sample-model')
  assert.equal(render.calls.filter(call => call.endpoint === 'hermes-remote-connect').length, 1)
  assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-test' || call.endpoint === 'hermes-remote-save'))
  assert.equal(render.document.querySelector('input[type=password]'), null)
})

test('Cancel aborts a pending test and discards only test resources', async t => {
  const pending = deferred(); let signal
  const render = await startWizard(t, { 'hermes-remote-test': (_payload, nextSignal) => { signal = nextSignal; return pending.promise } })
  await enterToken(render); await render.click('Test connection')
  await waitFor(() => signal, 'pending request to start')
  await render.click('Cancel')
  assert.equal(signal.aborted, true)
  assert.equal(render.closed.length, 1)
  const requestId = render.calls.find(call => call.endpoint === 'hermes-remote-test').payload.requestId
  const cancelled = await waitFor(() => render.calls.find(call => call.endpoint === 'hermes-remote-disconnect'), 'pending test to cancel')
  assert.deepEqual(cancelled.payload, { testsOnly: true, requestId })
  const answer = testView()
  pending.resolve(answer)
  const close = await waitFor(() => render.calls.find(call => call.endpoint === 'hermes-remote-disconnect' && call.payload.testId === answer.testId), 'late test resources to close')
  assert.deepEqual(close.payload, { testsOnly: true, requestId, testId: answer.testId })
  assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-save'))
})

test('the model route opens first-use setup and saved route changes retain the handoff confirmation', async t => {
  for (const existing of [false, true]) await t.test(existing ? 'saved route' : 'first use', async sub => {
    const picked = [], calls = []
    const bot = { id: 'sample-profile', name: 'Sample', ...(existing ? { model: 'native/sample-model' } : {}) }
    const roster = { models: [{ ref: 'native/sample-model', provider: 'native', name: 'Sample model' }], prefs: { hermesRemote: { enabled: existing, profile: existing ? 'sample-profile' : '' } } }
    const actions = { refreshModels: async () => {}, updateBot: (...args) => { picked.push(args); return Promise.resolve() }, switchRoute: (...args) => { picked.push(args); return Promise.resolve() } }
    const render = await renderSettings(sub, async request => {
      calls.push(request)
      return request.endpoint === 'hermes-remote' ? existing ? connectedView() : { ...sampleView(), credentialSet: false, profile: '' } : connectedView()
    }, { component: 'ModelMenu', menu: true, props: { bot, roster, actions } })
    flushSync(() => render.document.querySelector('.bt-model-trigger').click())
    await waitFor(() => render.document.querySelector('.bt-model-menu [data-route="hermes-remote"]'), 'remote route row')
    const route = render.document.querySelector('.bt-model-menu [data-route="hermes-remote"]')
    assert.ok(route.querySelector('.bt-hermes-mark img'))
    assert.equal(route.querySelector('.bt-menu-hint').textContent, existing ? 'sample-profile' : 'Set up')
    flushSync(() => route.click())
    if (!existing) {
      await waitFor(() => render.document.querySelector('[data-step=connection]'), 'first-use wizard')
      assert.match(render.document.body.textContent, /How would you like to connect/)
    } else {
      await waitFor(() => render.document.querySelector('.bt-model-confirm'), 'route handoff confirmation')
      assert.equal(picked.length, 0)
      assert.equal(calls.filter(call => call.endpoint === 'hermes-remote-connect').length, 1)
      await render.click('Change route')
      assert.equal(picked[0][1], 'hermes-remote/sample-model')
    }
  })
})

test('successful dashboard sign-in forgets the password and persists only the tested profile reference', async t => {
  const render = await startWizard(t)
  const secret = randomUUID()
  await render.click('Continue'); await render.fill('Remote address', 'https://example.invalid')
  await render.click('User and password'); await render.fill('User', 'sample-profile'); await render.fill('Password', secret)
  await render.click('Sign in and test')
  await waitFor(() => render.document.querySelector('[data-status=connected]'), 'accepted dashboard sign-in')
  await render.click('Edit connection')
  assert.equal(render.document.querySelector('input[aria-label=Password]').value, '')
  assert.equal(render.document.querySelector('input[aria-label=User]').value, 'sample-profile')
  assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-save'))
})

test('refreshing profiles drops a removed selection before it can be saved', async t => {
  const render = await startWizard(t, {
    'hermes-remote-test': () => ({ ...testView(), profiles: [{ id: 'sample-profile', name: 'sample-profile' }] }),
    'hermes-remote-test-profiles': () => ({ profiles: [] }),
  })
  await enterToken(render); await render.click('Test connection')
  await waitFor(() => render.document.querySelector('[data-status=connected]'), 'connection result')
  await render.click('Choose a profile'); await render.click('Refresh list')
  await waitFor(() => render.document.body.textContent.includes('No profiles are available.'), 'removed profile refresh')
  assert.equal(render.document.querySelectorAll('[role=radio]').length, 0)
  assert.equal([...render.document.querySelectorAll('button')].find(node => node.textContent.includes('Use this profile')).disabled, true)
  assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-save'))
})

test('missing remote Hermes gets a path and installation action instead of raw SSH output', async t => {
  const render = await startWizard(t, { 'hermes-remote-test': () => { throw Object.assign(Error('Fake refusal'), { code: 'bot/hermes-ssh-missing' }) } })
  await render.click('Through SSH'); await render.click('Continue'); await render.fill('SSH host or config name', 'example.invalid')
  await render.click('Test SSH connection')
  await waitFor(() => render.document.querySelector('[data-status=error]'), 'missing Hermes error')
  assert.match(render.document.body.textContent, /Install or update Hermes on the other computer/)
  assert.match(render.document.body.textContent, /enter its executable path/)
})

test('parent navigation releases the completed unsaved SSH test by its own ID', async t => {
  const answer = testView()
  const render = await startWizard(t, { 'hermes-remote-test': () => answer })
  await render.click('Through SSH'); await render.click('Continue')
  await render.fill('SSH host or config name', 'example.invalid')
  await render.click('Test SSH connection')
  await waitFor(() => render.document.querySelector('[data-status=connected]'), 'completed SSH test')
  flushSync(() => render.root.render(null))
  const released = await waitFor(() => render.calls.find(call => call.endpoint === 'hermes-remote-disconnect'), 'unmounted test lease to close')
  assert.deepEqual(released.payload, { testsOnly: true, requestId: render.calls.find(call => call.endpoint === 'hermes-remote-test').payload.requestId, testId: answer.testId })
  assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-disconnect' && call.payload?.testsOnly !== true))
})

test('profile save locks navigation and selection until the tested connection commit settles', async t => {
  const pending = deferred()
  const render = await startWizard(t, { 'hermes-remote-save': () => pending.promise })
  try {
    await enterToken(render); await render.click('Test connection')
    await waitFor(() => render.document.querySelector('[data-status=connected]'), 'connection to choose')
    await render.click('Choose a profile'); await render.click('Use this profile')
    await waitFor(() => render.calls.some(call => call.endpoint === 'hermes-remote-save'), 'save request to start')
    const buttons = [...render.document.querySelectorAll('button')]
    assert.equal(buttons.find(node => node.textContent.trim() === 'Back').disabled, true)
    assert.equal(render.document.querySelector('[role=radio]').disabled, true)
    assert.equal(render.document.querySelector('[aria-label="Close connection setup"]').disabled, true)
    await render.click('Back')
    render.document.defaultView.dispatchEvent(new render.document.defaultView.KeyboardEvent('keydown', { key: 'Escape' }))
    assert.ok(render.document.querySelector('[data-step=profile][data-status=saving]'))
    assert.equal(render.closed.length, 0)
    assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-disconnect'))
    pending.resolve(connectedView())
    await waitFor(() => render.document.querySelector('[data-step=ready]'), 'saved connection to render')
    assert.match(render.document.querySelector('.bt-hw-summary').textContent, /example.invalid/)
  } finally { pending.resolve(connectedView()) }
})

test('Escape fences a saved-route completion while the model catalog refresh is pending', async t => {
  const refresh = deferred(), waiting = deferred(), picked = []
  let refreshes = 0
  const bot = { id: 'sample-profile', name: 'Sample' }
  const roster = { models: [{ ref: 'native/sample-model', provider: 'native', name: 'Sample model' }] }
  const actions = {
    refreshModels: () => { if (++refreshes === 1) return Promise.resolve(); waiting.resolve(); return refresh.promise },
    updateBot: (...args) => { picked.push(args); return Promise.resolve() },
    switchRoute: (...args) => { picked.push(args); return Promise.resolve() },
  }
  const render = await renderSettings(t, async () => connectedView(), { component: 'ModelMenu', menu: true, props: { bot, roster, actions } })
  flushSync(() => render.document.querySelector('.bt-model-trigger').click())
  const route = await waitFor(() => render.document.querySelector('.bt-model-menu [data-route="hermes-remote"]'), 'saved route')
  flushSync(() => route.click())
  await waiting.promise
  await waitFor(() => render.document.querySelector('.bt-hermes-wizard'), 'pending connection dialog')
  render.document.defaultView.dispatchEvent(new render.document.defaultView.KeyboardEvent('keydown', { key: 'Escape' }))
  await waitFor(() => !render.document.querySelector('.bt-hermes-wizard'), 'cancelled connection dialog')
  refresh.resolve()
  await refresh.promise
  await new Promise(resolve => setImmediate(resolve))
  flushSync(() => {})
  assert.equal(render.document.querySelector('.bt-model-confirm'), null)
  assert.equal(picked.length, 0)
})

test('navigation aborts a pending wizard test and releases a late test lease without touching saved connections', async t => {
  const pending = deferred(); let signal
  const render = await startWizard(t, { 'hermes-remote-test': (_payload, nextSignal) => { signal = nextSignal; return pending.promise } })
  await enterToken(render); await render.click('Test connection')
  await waitFor(() => signal, 'test request to start')
  flushSync(() => render.root.render(null))
  assert.equal(signal.aborted, true)
  const answer = testView()
  pending.resolve(answer)
  const released = await waitFor(() => render.calls.find(call => call.endpoint === 'hermes-remote-disconnect' && call.payload.testId === answer.testId), 'late unmounted lease to close')
  assert.deepEqual(released.payload, { testsOnly: true, requestId: render.calls.find(call => call.endpoint === 'hermes-remote-test').payload.requestId, testId: answer.testId })
})

test('Ready navigation does not discard a test already consumed by the saved connection', async t => {
  const render = await startWizard(t)
  await enterToken(render); await render.click('Test connection')
  await waitFor(() => render.document.querySelector('[data-status=connected]'), 'connection result')
  await render.click('Choose a profile'); await render.click('Use this profile')
  await waitFor(() => render.document.querySelector('[data-step=ready]'), 'saved Ready state')
  flushSync(() => render.root.render(null))
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-disconnect'))
})

test('parent picker unmount fences a saved-route completion after a deferred catalog refresh', async t => {
  const refresh = deferred(), waiting = deferred(), picked = []
  let refreshes = 0
  const bot = { id: 'sample-profile', name: 'Sample' }
  const actions = {
    refreshModels: () => { if (++refreshes === 1) return Promise.resolve(); waiting.resolve(); return refresh.promise },
    updateBot: (...args) => { picked.push(args); return Promise.resolve() },
  }
  const render = await renderSettings(t, async () => connectedView(), { component: 'ModelMenu', menu: true, props: { bot, roster: { models: [] }, actions } })
  flushSync(() => render.document.querySelector('.bt-model-trigger').click())
  const route = await waitFor(() => render.document.querySelector('.bt-model-menu [data-route="hermes-remote"]'), 'saved route')
  flushSync(() => route.click())
  await waiting.promise
  flushSync(() => render.root.render(null))
  refresh.resolve()
  await refresh.promise
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(picked.length, 0)
})

test('the current Remote Hermes picker row names its remembered profile without repeating the route', async t => {
  const bot = { id: 'sample-profile', name: 'Sample', model: 'hermes-remote/sample-model' }
  const roster = { models: [{ ref: bot.model, provider: 'hermes-remote', providerName: 'Remote Hermes', name: 'Sample model' }], prefs: { hermesRemote: { enabled: true, profile: 'sample-profile' } } }
  const render = await renderSettings(t, async () => connectedView(), { component: 'ModelMenu', menu: true, props: { bot, roster, actions: { refreshModels: async () => {} } } })
  flushSync(() => render.document.querySelector('.bt-model-trigger').click())
  const route = await waitFor(() => render.document.querySelector('.bt-model-menu [data-route="hermes-remote"]'), 'current remote route')
  assert.equal(route.querySelector('.bt-menu-hint').textContent, 'sample-profile')
  assert.equal((route.textContent.match(/Remote Hermes/g) ?? []).length, 1)
})

test('an SSH contract refusal keeps version guidance instead of reporting an SSH key failure', async t => {
  const render = await startWizard(t, { 'hermes-remote-test': () => { throw Object.assign(Error('Fake refusal'), { code: 'bot/hermes' }) } })
  await render.click('Through SSH'); await render.click('Continue')
  await render.fill('SSH host or config name', 'example.invalid')
  await render.click('Test SSH connection')
  await waitFor(() => render.document.querySelector('[data-status=error]'), 'SSH contract refusal')
  assert.match(render.document.body.textContent, /Check this Hermes version and profile/)
  assert.ok([...render.document.querySelectorAll('button')].some(button => button.textContent.includes('Edit SSH details')))
  assert.match(render.document.body.textContent, /Use a supported Hermes version/)
  assert.doesNotMatch(render.document.body.textContent, /Check your SSH details/)
  assert.doesNotMatch(render.document.body.textContent, /unlock it in your SSH agent/)
})

test('aborting a lost test response still releases the completed SSH lease by its request identity', async t => {
  const response = deferred(), answer = testView()
  let hostCompleted = false, activeRequest
  const render = await startWizard(t, {
    'hermes-remote-test': payload => { activeRequest = payload.requestId; hostCompleted = true; return response.promise },
    'hermes-remote-disconnect': payload => { if (payload.requestId === activeRequest) activeRequest = undefined; return sampleView() },
  }, { abortResponses: true })
  await render.click('Through SSH'); await render.click('Continue')
  await render.fill('SSH host or config name', 'example.invalid'); await render.click('Test SSH connection')
  await waitFor(() => hostCompleted, 'host test completed while response is held')
  const requestId = render.calls.find(call => call.endpoint === 'hermes-remote-test').payload.requestId
  flushSync(() => render.root.render(null))
  const cancellation = await waitFor(() => render.calls.find(call => call.endpoint === 'hermes-remote-disconnect'), 'request-scoped cleanup after response abort')
  assert.deepEqual(cancellation.payload, { testsOnly: true, requestId })
  await waitFor(() => activeRequest === undefined, 'the held SSH lease to close')
  response.resolve(answer)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-disconnect' && call.payload.testId === answer.testId), 'AbortError prevents the test ID from ever reaching the UI')
  assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-disconnect' && !call.payload.requestId))
})

test('delayed cleanup from an aborted wizard cannot cancel a replacement test', async t => {
  const oldResponse = deferred(), releaseOldCleanup = deferred()
  let currentRequest, oldRequest, cleanupSettled = false
  const render = await startWizard(t, {
    'hermes-remote-test': payload => {
      currentRequest = payload.requestId
      if (!oldRequest) { oldRequest = payload.requestId; return oldResponse.promise }
      return testView()
    },
    'hermes-remote-disconnect': async payload => {
      if (payload.requestId === oldRequest) await releaseOldCleanup.promise
      // Model the host's ownership check: an unscoped cancel would stop the new test.
      if (!payload.requestId || payload.requestId === currentRequest) currentRequest = undefined
      cleanupSettled = true
      return sampleView()
    },
  }, { abortResponses: true })
  await enterToken(render); await render.click('Test connection')
  await waitFor(() => oldRequest, 'first test request')
  render.mount()
  await waitFor(() => render.document.querySelector('[data-step=connection]:not([data-status=loading])'), 'replacement wizard')
  await enterToken(render); await render.click('Test connection')
  await waitFor(() => render.document.querySelector('[data-status=connected]'), 'replacement test result')
  const replacement = currentRequest
  assert.notEqual(replacement, oldRequest)
  releaseOldCleanup.resolve()
  await waitFor(() => cleanupSettled, 'old scoped cleanup to finish')
  assert.equal(currentRequest, replacement)
  const cancellations = render.calls.filter(call => call.endpoint === 'hermes-remote-disconnect')
  assert.ok(cancellations.length > 0)
  assert.ok(cancellations.every(call => call.payload.requestId === oldRequest && call.payload.testsOnly === true))
  oldResponse.resolve(testView())
})

test('wizard error strips give the action for the actual failure, not another error class', async t => {
  const cases = [
    ['remote', 'token', 'bot/hermes-auth', 'Enter a valid session token and test the connection again.'],
    ['remote', 'password', 'bot/hermes-auth', 'Enter your dashboard user and password again, then sign in.'],
    ['ssh', 'token', 'bot/hermes-ssh-host-key', 'Connect once in a terminal to verify the SSH host key, then test again.'],
    ['ssh', 'token', 'bot/hermes-ssh-missing', 'Hermes must already be installed on the other computer.'],
    ['ssh', 'token', 'bot/hermes-ssh-auth', 'Check the SSH user and key, then test again.'],
    ['ssh', 'token', 'bot/hermes-ssh', 'Run “ssh example.invalid” in a terminal to see the full error. Fix it there, then test again.'],
    ['remote', 'token', 'bot/hermes', 'Check the Hermes version and this profile’s approval settings, then test again.'],
    ['ssh', 'token', 'bot/hermes-unsupported', 'Check the Hermes version and this profile’s approval settings, then test again.'],
    ['remote', 'token', 'bot/hermes-profiles', 'Check the profile on the other computer, then test again.'],
    ['ssh', 'token', 'bot/hermes-profiles', 'Check the profile on the other computer, then test again.'],
    ['remote', 'token', 'bot/hermes-expired', 'Run a new connection test before choosing or saving a profile.'],
    ['ssh', 'token', 'bot/hermes-expired', 'Run a new connection test before choosing or saving a profile.'],
    ['remote', 'token', 'bot/hermes-connection', 'Check that Hermes is running at this address and try again.'],
  ]
  for (const [mode, authMode, code, hint] of cases) await t.test(`${mode}/${authMode}/${code}`, async sub => {
    const render = await startWizard(sub, { 'hermes-remote-test': () => { throw Object.assign(Error('Fake refusal'), { code }) } })
    if (mode === 'ssh') {
      await render.click('Through SSH'); await render.click('Continue')
      await render.fill('SSH host or config name', 'example.invalid'); await render.click('Test SSH connection')
    } else if (authMode === 'password') {
      await render.click('Continue'); await render.fill('Remote address', 'https://example.invalid')
      await render.click('User and password'); await render.fill('User', 'sample-profile'); await render.fill('Password', randomUUID())
      await render.click('Sign in and test')
    } else { await enterToken(render); await render.click('Test connection') }
    await waitFor(() => render.document.querySelector('[data-status=error]'), 'matching error action strip')
    const strip = render.document.querySelector('.bt-hw-error-note').textContent
    assert.equal(strip, hint)
    if (code !== 'bot/hermes-ssh-missing') assert.doesNotMatch(strip, /Hermes must already be installed/)
  })
})

test('Remote Hermes chat line and Details identify the profile after the route only once', async t => {
  for (const component of ['ModelLine', 'ModelMenu']) await t.test(component, async sub => {
    const bot = { id: 'sample-profile', name: 'Sample', model: 'hermes-remote/sample-model' }
    const roster = { models: [{ ref: bot.model, provider: 'hermes-remote', providerName: 'Remote Hermes', name: 'Sample model' }], prefs: { hermesRemote: { enabled: true, profile: 'sample-profile', address: 'https://example.invalid' } } }
    const render = await renderSettings(sub, async () => connectedView(), { component, menu: true, props: { bot, roster, actions: {} } })
    const summary = render.document.querySelector(component === 'ModelLine' ? '.bt-model-line-text' : '.bt-model-provider').textContent
    assert.equal((summary.match(/Remote Hermes/g) ?? []).length, 1)
    assert.match(summary, /Remote Hermes · sample-profile/)
  })
})

test('a legacy Remote Hermes model without profile metadata still prints the route once', async t => {
  for (const component of ['ModelLine', 'ModelMenu']) await t.test(component, async sub => {
    const bot = { id: 'sample-profile', name: 'Sample', model: 'hermes-remote/sample-model' }
    const roster = { models: [{ ref: bot.model, provider: 'hermes-remote', providerName: 'Remote Hermes', name: 'Sample model' }] }
    const render = await renderSettings(sub, async () => connectedView(), { component, menu: true, props: { bot, roster, actions: {} } })
    const summary = render.document.querySelector(component === 'ModelLine' ? '.bt-model-line-text' : '.bt-model-provider').textContent
    assert.equal((summary.match(/Remote Hermes/g) ?? []).length, 1)
    assert.doesNotMatch(summary, /Remote Hermes · Remote Hermes/)
  })
})


const hostInventory = () => ({
  aliases: Array.from({ length: 14 }, (_, index) => ({ alias: index === 13 ? '192.0.2.10' : `sample-${String(index + 1).padStart(2, '0')}`, hostname: `sample-${index + 1}.example.invalid`, user: `sample-${index + 1}`, port: String(2200 + index) })),
  knownHosts: Array.from({ length: 170 }, (_, index) => ({ alias: `other-${index + 1}.example.invalid`, hostname: `other-${index + 1}.example.invalid`, user: '', port: '' })),
})

test('SSH Details lists fourteen searchable aliases and keeps the larger known-host list collapsed', async t => {
  const inventory = hostInventory()
  const render = await startWizard(t, { 'hermes-remote-ssh-hosts': () => inventory })
  assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-ssh-hosts'))
  await render.click('Through SSH')
  assert.ok(!render.calls.some(call => call.endpoint === 'hermes-remote-ssh-hosts'), 'choosing the mode alone does not read hosts')
  await render.click('Continue')
  await waitFor(() => render.document.querySelectorAll('.bt-hw-host-choice').length === 14, 'configured SSH hosts')
  assert.equal(render.document.querySelector('.bt-hw-other-hosts').getAttribute('aria-expanded'), 'false')
  assert.ok(!render.document.body.textContent.includes('other-170.example.invalid'))
  assert.match(render.document.querySelector('style').textContent, /bt-hw-host-list\{[^}]*max-height:[^}]*overflow:auto/)
  await render.fill('Search SSH hosts', 'sample-12.example.invalid')
  assert.equal(render.document.querySelectorAll('.bt-hw-host-choice').length, 1)
  assert.equal(render.document.querySelector('.bt-hw-host-choice strong').textContent, 'sample-12')
  await render.click('Use SSH host sample-12')
  const input = label => render.document.querySelector(`input[aria-label="${label}"]`)
  assert.equal(input('SSH host or config name').value, 'sample-12', 'connect with the alias, not the resolved display hostname')
  assert.equal(input('User (optional)').value, 'sample-12')
  assert.equal(input('Port (optional)').value, '2211')
  await render.fill('Search SSH hosts', 'other-170.example.invalid')
  assert.match(render.document.body.textContent, /No SSH hosts match your search/)
  await render.click('Other hosts you have connected to')
  assert.equal(render.document.querySelector('.bt-hw-other-hosts').getAttribute('aria-expanded'), 'true')
  assert.equal(render.document.querySelectorAll('.bt-hw-host-choice').length, 1)
  await render.click('Use SSH host other-170.example.invalid')
  assert.equal(input('SSH host or config name').value, 'other-170.example.invalid')
  assert.equal(input('User (optional)').value, '')
  assert.equal(input('Port (optional)').value, '')
  await render.fill('SSH host or config name', 'manual.example.invalid')
  await render.click('Test SSH connection')
  await waitFor(() => render.calls.some(call => call.endpoint === 'hermes-remote-test'), 'manually typed SSH test')
  assert.equal(render.calls.find(call => call.endpoint === 'hermes-remote-test').payload.ssh.host, 'manual.example.invalid')
  assert.ok(!JSON.stringify(render.calls.find(call => call.endpoint === 'hermes-remote-test').payload).includes('knownHosts'))
})

test('the SSH host picker projects only four fields and never takes an identity file from the listing', async t => {
  const forbidden = randomUUID(), row = { alias: 'sample-alias', hostname: 'resolved.example.invalid', user: 'sample-user', port: '2200', IdentityFile: forbidden, identityFile: forbidden, extra: forbidden }
  const render = await startWizard(t, { 'hermes-remote-ssh-hosts': () => ({ aliases: [row, row], knownHosts: [], extra: forbidden }) })
  await render.click('Through SSH'); await render.click('Continue')
  await waitFor(() => render.document.querySelector('.bt-hw-host-choice'), 'safe host choice')
  assert.equal(render.document.querySelectorAll('.bt-hw-host-choice').length, 1, 'duplicate rows cannot generate key warnings containing host data')
  assert.ok(!render.document.body.textContent.includes(forbidden))
  await render.click('Use SSH host sample-alias')
  await render.click('Test SSH connection')
  await waitFor(() => render.calls.some(call => call.endpoint === 'hermes-remote-test'), 'selected alias test')
  const draft = render.calls.find(call => call.endpoint === 'hermes-remote-test').payload
  assert.equal(draft.ssh.host, 'sample-alias')
  assert.equal(draft.ssh.identityFile, '')
  assert.ok(!JSON.stringify(draft).includes(forbidden))
})

for (const failure of [false, true]) {
  test(`SSH hosts ${failure ? 'failure' : 'empty list'} leaves manual entry available`, async t => {
    const render = await startWizard(t, { 'hermes-remote-ssh-hosts': () => {
      if (failure) throw Object.assign(Error('Optional listing failed'), { code: 'bot/refused' })
      return { aliases: [], knownHosts: [] }
    } })
    await render.click('Through SSH'); await render.click('Continue')
    await waitFor(() => render.document.body.textContent.includes(failure ? 'Saved SSH hosts could not be listed.' : 'No saved SSH hosts.'), 'optional host list result')
    assert.equal(render.document.querySelector('.bt-hw-other-hosts'), null)
    await render.fill('SSH host or config name', 'manual.example.invalid')
    await render.click('Test SSH connection')
    await waitFor(() => render.document.querySelector('[data-status=connected]'), 'manual SSH connection')
  })
}

test('leaving SSH Details aborts only its host-list request, fences late replies, and preserves a connection test', async t => {
  const list = deferred(), testing = deferred(); let listSignal, testSignal
  const render = await startWizard(t, {
    'hermes-remote-ssh-hosts': (_payload, signal) => { listSignal = signal; return list.promise },
    'hermes-remote-test': (_payload, signal) => { testSignal = signal; return testing.promise },
  })
  await render.click('Through SSH'); await render.click('Continue')
  await waitFor(() => listSignal, 'host list request')
  await render.fill('SSH host or config name', 'manual.example.invalid')
  await render.click('Test SSH connection')
  await waitFor(() => testSignal, 'separate connection test request')
  assert.notEqual(listSignal, testSignal)
  assert.equal(listSignal.aborted, true)
  assert.equal(testSignal.aborted, false)
  list.resolve(hostInventory())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(render.document.querySelector('.bt-hw-host-picker'), null, 'late host replies cannot restore Details')
  testing.resolve(testView())
  await waitFor(() => render.document.querySelector('[data-status=connected]'), 'connection test result')
  assert.equal(testSignal.aborted, false)
})

test('switching away from SSH or unmounting aborts the optional list without retaining its values', async t => {
  const lists = [], signals = []
  const render = await startWizard(t, { 'hermes-remote-ssh-hosts': (_payload, signal) => { const list = deferred(); lists.push(list); signals.push(signal); return list.promise } })
  await render.click('Through SSH'); await render.click('Continue')
  await waitFor(() => signals.length === 1, 'first SSH list')
  await render.click('Back'); await render.click('Remote address'); await render.click('Continue')
  assert.equal(signals[0].aborted, true)
  lists[0].resolve(hostInventory())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(render.document.querySelector('.bt-hw-host-picker'), null)
  await render.click('Back'); await render.click('Through SSH'); await render.click('Continue')
  await waitFor(() => signals.length === 2, 'fresh SSH list after returning')
  flushSync(() => render.root.unmount())
  assert.equal(signals[1].aborted, true)
  lists[1].resolve(hostInventory())
})

// One failed SSH test as the host reports it: its code on the refusal, its facts by request.
async function failedSshTest(t, code, failure, overrides = {}) {
  const render = await startWizard(t, {
    'hermes-remote-test': () => { throw Object.assign(Error('Fake refusal'), { code }) },
    'hermes-remote-test-status': payload => ({ stage: 'open', ...(failure && payload?.requestId ? { failure: { code, ...failure } } : {}) }),
    ...overrides,
  })
  await render.click('Through SSH'); await render.click('Continue')
  await render.fill('SSH host or config name', 'sample-box')
  await render.click('Test SSH connection')
  await waitFor(() => render.document.querySelector('[data-status=error]'), `${code} screen`)
  const text = selector => render.document.querySelector(selector)?.textContent ?? ''
  const rows = Object.fromEntries([...render.document.querySelectorAll('.bt-hw-facts .bt-hw-pair')].map(row => [row.querySelector('span').textContent, row.querySelector('strong').textContent]))
  return { ...render, text, rows, buttons: () => [...render.document.querySelectorAll('.bt-hw-foot button')].map(button => button.textContent.replace(/[→←]/g, '').trim()) }
}
const GENERIC = 'The SSH connection could not start'
const fingerprint = 'SHA256:sampleSampleSampleSampleSampleSampleSample1'

test('every SSH failure kind has its own screen, naming the host and the next step', async t => {
  const cases = [
    ['bot/hermes-ssh-exited', { kind: 'hermes-exited', stage: 'hermes-start', exit: 3, hermes: ['sample start failure', 'could not read ~/.hermes/config.yaml'] },
      'Hermes stopped while starting', 'Hermes on sample-box stopped before it was ready', 'SSH signed in and started Hermes, but Hermes exited with code 3.', 'Run “hermes serve” on sample-box to see the full error, fix it there, then test again.'],
    ['bot/hermes-ssh-exited', { kind: 'hermes-exited', stage: 'hermes-start' },
      'Hermes stopped while starting', 'Hermes on sample-box stopped before it was ready', 'SSH signed in and started Hermes, but Hermes stopped right away.', 'Run “hermes serve” on sample-box to see the full error, fix it there, then test again.'],
    ['bot/hermes-ssh-not-ready', { kind: 'not-ready', stage: 'hermes-start', hermes: ['sample server still loading'] },
      'Hermes took too long to start', 'Hermes on sample-box was not ready in time', 'SSH signed in and started Hermes, but Hermes did not say it was ready before the deadline.', 'Check that Hermes starts normally on sample-box, then test again.'],
    ['bot/hermes-ssh-port', { kind: 'port-missing', stage: 'hermes-start' },
      'Hermes did not report its port', 'Hermes on sample-box started without a port', 'Hermes is running there, but it never said which port it listens on, so there is nothing to connect to.', 'Update Hermes on sample-box, then test again.'],
    ['bot/hermes-ssh-handshake', { kind: 'handshake', stage: 'token' },
      'The one-time token was not accepted', 'Automagik and sample-box could not agree on this connection', 'The start script or Hermes on sample-box did not accept the one-time token made for this connection.', 'Test again. If it keeps failing, update Hermes on sample-box and check that signing in there prints no extra text.'],
    ['bot/hermes-ssh-tunnel', { kind: 'tunnel', stage: 'tunnel', ssh: ['sample tunnel line'] },
      'The tunnel did not open', 'SSH could not open a tunnel to Hermes on sample-box', 'Hermes started, but the SSH tunnel from this computer to it did not start listening, or carried no answer.', 'Check that sample-box allows port forwarding, then test again.'],
    ['bot/hermes-ssh-forward', { kind: 'forward-conflict', stage: 'tunnel', port: 8080 },
      'A port from your SSH config is in use', 'Port 8080 from the SSH config for sample-box is busy', 'The SSH config entry for sample-box forwards its own ports.', 'Close the other SSH session to sample-box, or remove the forward from its config entry, then test again.'],
    ['bot/hermes-ssh-script', { kind: 'remote-script', stage: 'remote-start', fault: 'PermissionError', errno: 13, line: 92 },
      'The start script stopped', 'Automagik’s start script failed on sample-box', 'SSH signed in, but the small script that finds and starts Hermes stopped with an error.', 'Check that Python 3 works on sample-box and that this user can run Hermes, then test again.'],
    ['bot/hermes-ssh-details', { kind: 'invalid-details', stage: 'details' },
      'Check the SSH details', 'These SSH details can’t be used', 'The host, user, port, key path or Hermes path has characters SSH does not accept.', 'Edit the SSH details, then test again.'],
    ['bot/hermes-ssh-update', { kind: 'update-required', stage: 'remote-start' },
      'Hermes needs an update', 'Update Hermes on sample-box', 'This Hermes installation lacks the server ownership options needed for an SSH connection.', 'Update Hermes, then test the SSH connection again.'],
    ['bot/hermes-ssh-cleanup', { kind: 'cleanup', stage: 'hermes-start' },
      'Connection cleanup is unconfirmed', 'Check sample-box before reconnecting', 'Automagik could not confirm that the owned Hermes process group stopped.', 'Check the remote Hermes process before testing or connecting again.'],
    ['bot/hermes-ssh-host-key', { kind: 'host-key-changed', stage: 'ssh-sign-in' },
      'This host’s key has changed', 'The key for sample-box is not the one this computer saved', 'Automagik will not connect and cannot trust the new key for you.', 'Connect once in a terminal to verify the SSH host key, then test again.'],
    ['bot/hermes-ssh-auth', { kind: 'auth-failed', stage: 'ssh-sign-in', identities: ['id_sample', 'id_other'], agentKeys: 2 },
      'SSH couldn’t sign in', 'sample-box refused your SSH key', 'SSH offered id_sample, id_other, 2 keys from your SSH agent, and sample-box accepted none of them.', 'Check the SSH user and key, then test again.'],
    ['bot/hermes-connection', { kind: 'connection', stage: 'chat' },
      'Hermes did not answer', 'Hermes on sample-box started but did not answer correctly', 'SSH signed in and the tunnel opened, but Hermes did not complete the connection check.', 'Check that Hermes works on sample-box, then test again.'],
  ]
  for (const [code, failure, heading, title, text, hint] of cases) await t.test(`${code} ${failure.exit ?? ''}`, async sub => {
    const render = await failedSshTest(sub, code, failure)
    assert.equal(render.text('.bt-hw-content h2'), heading)
    assert.equal(render.text('.bt-hw-failed h3'), title)
    assert.ok(render.text('.bt-hw-failed p').includes(text), render.text('.bt-hw-failed p'))
    assert.equal(render.text('.bt-hw-error-note'), hint)
    // A known kind never shows the generic screen, and never a trust button.
    assert.ok(!render.document.body.textContent.includes(GENERIC))
    assert.deepEqual(render.buttons(), ['Test again', 'Edit SSH details'])
    assert.equal(render.rows['SSH host'], 'sample-box', 'the host the person picked is named')
    assert.doesNotMatch(render.document.body.textContent, /Fake refusal/)
  })
})

test('a failure screen shows the stage, the exit code and the last lines the host kept', async t => {
  const render = await failedSshTest(t, 'bot/hermes-ssh-exited', { kind: 'hermes-exited', stage: 'hermes-start', exit: 3, hermes: ['sample start failure', 'could not read ~/.hermes/config.yaml'], ssh: ['sample SSH line'] })
  assert.deepEqual(render.rows, { 'SSH host': 'sample-box', 'Stopped while': 'Starting Hermes', 'Exit code': '3' })
  const blocks = [...render.document.querySelectorAll('.bt-hw-lines')].map(block => [block.querySelector('span').textContent, block.querySelector('pre').textContent])
  assert.deepEqual(blocks, [['Last lines from Hermes', 'sample start failure\ncould not read ~/.hermes/config.yaml'], ['Last lines from SSH', 'sample SSH line']])
  assert.match(render.document.body.textContent, /Settings → Feedback keeps a line about this test for a report\./)

  const script = await failedSshTest(t, 'bot/hermes-ssh-script', { kind: 'remote-script', stage: 'remote-start', fault: 'PermissionError', errno: 13, line: 92 })
  assert.equal(script.rows.Error, 'PermissionError (13) · line 92')
  assert.equal(script.rows['Stopped while'], 'Finding Hermes')

  // A fact of the wrong shape is dropped, never rendered.
  const shaped = await failedSshTest(t, 'bot/hermes-ssh-exited', { kind: 'hermes-exited', stage: '<b>stage</b>', exit: 'three', fault: 'not a class name', hermes: ['kept line', { not: 'a line' }, 'x'.repeat(400)], identities: ['../../etc'] })
  assert.deepEqual(shaped.rows, { 'SSH host': 'sample-box' })
  assert.equal(shaped.document.querySelector('.bt-hw-lines pre').textContent, 'kept line')
})

test('only an unknown kind shows the generic SSH screen, with the host and what SSH said', async t => {
  const render = await failedSshTest(t, 'bot/hermes-ssh', { kind: 'unknown', stage: 'ssh-sign-in', ssh: ['A sample line SSH said'] })
  assert.equal(render.text('.bt-hw-content h2'), GENERIC)
  assert.equal(render.text('.bt-hw-failed h3'), 'SSH to sample-box stopped with an unexpected error')
  assert.equal(render.text('.bt-hw-failed p'), 'This is not one of the failures Automagik knows. What SSH said is shown below.')
  assert.equal(render.text('.bt-hw-error-note'), 'Run “ssh sample-box” in a terminal to see the full error. Fix it there, then test again.')
  assert.deepEqual(render.rows, { 'SSH host': 'sample-box', 'Stopped while': 'Signing in with SSH' })
  assert.equal(render.document.querySelector('.bt-hw-lines pre').textContent, 'A sample line SSH said')
  const silent = await failedSshTest(t, 'bot/hermes-ssh', { kind: 'unknown', stage: 'ssh-sign-in' })
  assert.equal(silent.text('.bt-hw-failed p'), 'This is not one of the failures Automagik knows, and SSH said nothing more.')
  assert.equal(silent.document.querySelector('.bt-hw-lines'), null)
})

test('a new host shows its key and is trusted only by the button, then tested again', async t => {
  let tests = 0
  const trusts = []
  const render = await failedSshTest(t, 'bot/hermes-ssh-host-key-unknown', { kind: 'host-key-unknown', stage: 'ssh-sign-in', keyType: 'ssh-ed25519', fingerprint }, {
    'hermes-remote-test': () => { if (tests++ === 0) throw Object.assign(Error('Fake refusal'), { code: 'bot/hermes-ssh-host-key-unknown' }); return testView() },
    'hermes-remote-ssh-trust': payload => { trusts.push(payload); return { trusted: true } },
  })
  assert.equal(render.text('.bt-hw-content h2'), 'Trust this SSH host?')
  assert.equal(render.text('.bt-hw-ask h3'), 'sample-box is new to this computer')
  assert.equal(render.document.querySelector('.bt-hw-failed'), null, 'a new host is a question, not a fault')
  assert.deepEqual(render.rows, { 'SSH host': 'sample-box', 'Key type': 'ssh-ed25519', Fingerprint: fingerprint }, 'a question shows the key, not a failed step')
  assert.match(render.text('.bt-hw-note'), /Only this exact key is saved to your known hosts\. If sample-box ever shows a different key, the connection is refused\./)
  assert.deepEqual(render.buttons(), ['Edit SSH details', 'Trust this host'])
  // Nothing was trusted by showing the screen.
  assert.equal(trusts.length, 0)
  assert.equal(render.calls.filter(call => call.endpoint === 'hermes-remote-test').length, 1)
  await render.click('Trust this host')
  await waitFor(() => render.document.querySelector('[data-status=connected]'), 'the test after trusting')
  // The page names its own failed request, never a key.
  const request = render.calls.find(call => call.endpoint === 'hermes-remote-test').payload.requestId
  assert.deepEqual(trusts, [{ requestId: request }])
  assert.equal(render.calls.filter(call => call.endpoint === 'hermes-remote-test').length, 2)
  assert.match(render.document.body.textContent, /Connection works/)
})

test('a changed key, or a host that swaps its key at the trust step, never gets a trust button', async t => {
  const changed = await failedSshTest(t, 'bot/hermes-ssh-host-key', { kind: 'host-key-changed', stage: 'ssh-sign-in', keyType: 'ssh-ed25519', fingerprint })
  assert.deepEqual(changed.buttons(), ['Test again', 'Edit SSH details'])
  assert.equal(changed.rows.Fingerprint, undefined, 'a changed key is not shown as one to trust')
  assert.ok(!changed.calls.some(call => call.endpoint === 'hermes-remote-ssh-trust'))

  let asked = 0
  const swapped = await failedSshTest(t, 'bot/hermes-ssh-host-key-unknown', undefined, {
    'hermes-remote-test-status': () => asked++ === 0 ? { stage: 'open', failure: { code: 'bot/hermes-ssh-host-key-unknown', kind: 'host-key-unknown', stage: 'ssh-sign-in', keyType: 'ssh-ed25519', fingerprint } }
      : { stage: 'open', failure: { code: 'bot/hermes-ssh-host-key', kind: 'host-key-changed', stage: 'host-key', mismatch: true } },
    'hermes-remote-ssh-trust': () => { throw Object.assign(Error('Fake refusal'), { code: 'bot/hermes-ssh-host-key' }) },
  })
  await swapped.click('Trust this host')
  await waitFor(() => swapped.document.querySelector('.bt-hw-failed'), 'the refused trust')
  assert.equal(swapped.document.querySelector('.bt-hw-content h2').textContent, 'This host’s key has changed')
  assert.ok(![...swapped.document.querySelectorAll('button')].some(button => button.textContent.includes('Trust this host')))
  assert.equal(swapped.calls.filter(call => call.endpoint === 'hermes-remote-test').length, 1, 'a refused trust does not test again by itself')

  // A new host whose key the host could not read, or whose config discards keys: no button.
  for (const [failure, hint] of [[{ kind: 'host-key-unknown', stage: 'ssh-sign-in' }, 'Connect to sample-box once in a terminal and accept its key, then test again.'],
    [{ kind: 'host-key-unknown', stage: 'host-key', keyType: 'ssh-ed25519', fingerprint, unsaved: true }, 'The SSH config for sample-box does not keep host keys. Change that config entry, then test again.']]) {
    const render = await failedSshTest(t, 'bot/hermes-ssh-host-key-unknown', failure)
    assert.equal(render.text('.bt-hw-error-note'), hint)
    assert.deepEqual(render.buttons(), ['Test again', 'Edit SSH details'])
  }
})

test('the failure screens read the same in English, Chinese and Brazilian Portuguese', async () => {
  const source = readFileSync(new URL('../src/client/hermes-remote.js', import.meta.url), 'utf8')
  const start = source.indexOf('const STAGES = {'), end = source.indexOf('// Route entry and Settings share the same wizard.')
  const keys = [...source.slice(start, end).matchAll(/\bt\(\s*'((?:\\.|[^'\\])*)'/g)].map(match => match[1].replace(/\\'/g, "'"))
  assert.ok(keys.length > 80, 'the failure screens carry their copy here')
  const { DICTIONARY } = await import('../src/client/i18n.js')
  const pt = JSON.parse(readFileSync(new URL('../../locale-pt-br-dsh/src/client/locales/pt-BR/omni-ui.json', import.meta.url), 'utf8'))
  const names = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',')
  for (const key of new Set(keys)) {
    for (const [language, text] of [['zh', DICTIONARY.zh[key]], ['pt-BR', pt[key]]]) {
      assert.ok(typeof text === 'string' && text.trim(), `${language}: ${key}`)
      assert.notEqual(text, key, `${language} leaves this in English: ${key}`)
      assert.equal(names(text), names(key), `${language} keeps the same names: ${key}`)
    }
  }
})
