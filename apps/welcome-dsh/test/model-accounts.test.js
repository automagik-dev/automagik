import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

const bundle = await build({
  stdin: { contents: "export * from './src/client/model-accounts.js'", resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom'], loader: { '.css': 'text' },
})

function client() {
  let hooks
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (...args) => hooks.useState(...args), useEffect: (...args) => hooks.useEffect(...args),
    useRef: (...args) => hooks.useRef(...args), useCallback: (...args) => hooks.useCallback(...args),
  }
  const module = { exports: {} }
  const timers = new Map()
  let nextTimer = 0
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: name => ({ react, 'react-dom': {} })[name], setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id }, clearTimeout: id => timers.delete(id) })
  function mount(draw) {
    const slots = []
    let at, effects, current, queued = false, alive = true
    const same = (a, b) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]))
    hooks = {
      useState(initial) {
        const slot = slots[at] ?? (slots[at] = { value: typeof initial === 'function' ? initial() : initial })
        at++
        return [slot.value, value => { slot.value = typeof value === 'function' ? value(slot.value) : value; if (alive && !queued) { queued = true; queueMicrotask(render) } }]
      },
      useRef(current) { return slots[at++] ?? (slots[at - 1] = { current }) },
      useCallback(fn, deps) {
        const i = at++
        if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }
        return slots[i].fn
      },
      useEffect(effect, deps) {
        const i = at++
        const slot = slots[i] ?? (slots[i] = {})
        if (!slot.deps || !same(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = effect() })
      },
    }
    function render() { queued = false; at = 0; effects = []; current = draw(); for (const effect of effects) effect() }
    render()
    return { get current() { return current }, settle: () => new Promise(resolve => setImmediate(resolve)), unmount: () => { alive = false; for (const slot of slots) slot.cleanup?.() } }
  }
  return { ui: module.exports, mount, timers }
}

const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap(child => nodes(child, predicate))]
const text = node => node && typeof node === 'object' ? (node.children ?? []).map(text).join('') : node ? String(node) : ''
const button = (tree, label) => nodes(tree, node => node.type === 'button' && text(node) === label)[0]
const plain = value => JSON.parse(JSON.stringify(value))

test('account metadata includes disconnected providers and never exposes credential fields', () => {
  const { ui } = client()
  const rows = ui.providerAccounts({ rows: [
    { id: 'claude', name: 'Claude', kind: 'signin', ready: false, on: false, apiKey: 'private' },
    { id: 'openai', name: 'OpenAI API', kind: 'key', ready: true, on: false },
    { id: 'deepseek', name: 'DeepSeek', kind: 'key', ready: true, on: true },
  ] }, { available: true, agents: [{ id: 'acp-codex', on: true, signedIn: false, connector: { state: 'ready' } }] })
  assert.deepEqual(plain(rows), [
    { provider: 'anthropic', name: 'Claude', company: 'Anthropic', ready: false, kind: 'signin' },
    { provider: 'openai', name: 'OpenAI API', company: 'OpenAI', ready: false, kind: 'key' },
    { provider: 'deepseek', name: 'DeepSeek', company: 'DeepSeek', ready: true, kind: 'key' },
    { provider: 'acp-codex', name: 'Codex', company: 'OpenAI', ready: false, kind: 'cli' },
  ])
})

test('the independent slot registers account metadata and its component with teardown', () => {
  const { ui } = client()
  let registered, component, disposed = false
  const dispose = ui.installModelAccounts({ slots: {
    inject: (name, run) => { assert.equal(name, 'conversation.model.accounts'); return run() },
    register: (entry, view) => { registered = entry; component = view; return () => { disposed = true } },
  } })
  assert.equal(registered.id, 'automagik-welcome')
  assert.equal(registered.matches, undefined)
  assert.equal(component.accounts.matches('anthropic'), true)
  assert.equal(component.accounts.matches('acp-codex'), true)
  assert.equal(component.accounts.matches('unknown'), false)
  assert.equal(component, ui.ProviderAccountSetup)
  assert.equal(typeof component.accounts.providers, 'function')
  dispose()
  assert.equal(disposed, true)
})

test('opening a provider only reads its state; sign-in waits for the user', async () => {
  const { ui, mount } = client()
  const calls = []
  const request = async endpoint => { calls.push(endpoint); return { rows: [{ id: 'chatgpt', name: 'ChatGPT', kind: 'signin', signIn: true, ready: false, on: false }] } }
  const mounted = mount(() => ui.ApiAccount({ provider: 'openai-codex', request }))
  await mounted.settle()
  assert.deepEqual(calls, ['ais'])
  assert.equal(nodes(mounted.current, node => typeof node.type === 'function').length, 0)
  button(mounted.current, 'Sign in or connect an account').props.onClick()
  await mounted.settle()
  const [setup] = nodes(mounted.current, node => typeof node.type === 'function')
  assert.equal(setup.props.row.id, 'chatgpt')
  assert.equal(setup.props.cancelOnUnmount, true)
  mounted.unmount()
})

test('enabling a connected provider refreshes the catalog without finishing onboarding or switching a model', async () => {
  const { ui, mount } = client()
  const calls = []
  let on = false, refreshed = 0
  const request = async (endpoint, payload) => {
    calls.push([endpoint, payload])
    if (endpoint === 'ai-switch') { assert.deepEqual(plain(payload), { id: 'openai', on: true }); on = true; return {} }
    return { rows: [{ id: 'openai', name: 'OpenAI API', kind: 'key', ready: true, on }] }
  }
  const mounted = mount(() => ui.ApiAccount({ provider: 'openai', request, onConnected: () => { refreshed++ } }))
  await mounted.settle()
  await button(mounted.current, 'Turn on').props.onClick()
  await mounted.settle()
  assert.deepEqual(calls.map(([name]) => name), ['ais', 'ai-switch', 'ais'])
  assert.equal(refreshed, 1)
  assert.match(text(mounted.current), /Connected. Choose a model/)
  mounted.unmount()
})

test('private CLI login cancels on leaving, including a start that resolves after leaving', async () => {
  for (const pending of [false, true]) {
    const { ui, mount, timers } = client()
    const calls = []
    let resolveStart
    const result = { terminal: 'private-attempt', id: 'acp-codex', status: 'running', text: 'Open a browser', nextOffset: 14 }
    const request = async (endpoint, payload) => {
      calls.push([endpoint, plain(payload)])
      if (endpoint === 'acp-login-start') return pending ? new Promise(resolve => { resolveStart = resolve }) : result
      return {}
    }
    const mounted = mount(() => ui.CliLogin({ provider: 'acp-codex', request }))
    await mounted.settle()
    mounted.unmount()
    if (pending) resolveStart(result)
    await mounted.settle()
    assert.deepEqual(calls.map(([name]) => name), ['acp-login-start', 'acp-login-close'])
    assert.deepEqual(calls[1][1], { terminal: 'private-attempt' })
    assert.equal(timers.size, 0)
  }
})

test('CLI exit is checked against its own login status before refreshing the model catalog', async () => {
  for (const signedIn of [false, true]) {
    const { ui, mount } = client()
    let connected = 0
    const calls = []
    const request = async endpoint => {
      calls.push(endpoint)
      if (endpoint === 'acp-login-start') return { terminal: 'private-attempt', status: 'exited', text: 'Done', exitCode: 0 }
      if (endpoint === 'acp') return { agents: [{ id: 'acp-claude', signedIn }] }
      return {}
    }
    const mounted = mount(() => ui.CliLogin({ provider: 'acp-claude', request, onConnected: () => { connected++ } }))
    await mounted.settle()
    assert.equal(connected, signedIn ? 1 : 0)
    assert.deepEqual(calls, ['acp-login-start', 'acp-login-close', 'acp'])
    if (!signedIn) assert.match(text(mounted.current), /did not finish/)
    else assert.match(text(mounted.current), /Connected\. Choose a model/)
    mounted.unmount()
  }
})
