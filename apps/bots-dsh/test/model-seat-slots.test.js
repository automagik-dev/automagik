import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// ui-slots is browser-private: DSH publishes its real SlotCore inside the frontend,
// not as a separately importable package. Evaluate that pure module closure from
// the installed, pinned harness. This exercises its actual declaration, validation,
// metadata retention, winner election, and unload cascade without launching DSH.
const frontend = new URL('dist/index.html', import.meta.resolve('@deepseek-ai/dsh-web-frontend/package.json'))
const html = readFileSync(frontend, 'utf8')
const script = /<script\s+type="module"[^>]*src="([^"]+)"/.exec(html)
assert.ok(script, 'The installed DSH frontend must name its module entry')
const source = readFileSync(new URL(script[1], frontend), 'utf8')
const namespace = /const (\w+)=Object\.freeze\(Object\.defineProperty\(\{__proto__:null,SlotCore:(\w+)/.exec(source)
assert.ok(namespace, 'The installed DSH frontend must export the ui-slots platform module')
const endOfModule = '{value:"Module"}))'
const start = source.lastIndexOf(`${endOfModule};`, namespace.index) + endOfModule.length + 1
const end = source.indexOf(endOfModule, namespace.index) + endOfModule.length
assert.ok(start > endOfModule.length && end > start, 'The ui-slots platform closure must have clear module boundaries')
const { SlotCore } = runInNewContext(`${source.slice(start, end)};${namespace[1]}`, { queueMicrotask })

const bundle = await build({
  stdin: {
    contents: [
      "export * from './src/client/native-model-seat.js'",
      "export { groupsFor, surfaceGroups } from './src/client/surface.js'",
      "export { installModelAccounts, ProviderAccountSetup, ACCOUNT_SLOT } from '../welcome-dsh/src/client/model-accounts.js'",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'node', write: false, loader: { '.css': 'text' },
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, console, setTimeout, clearTimeout,
  require: name => {
    if (name === 'react') return {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      useEffect: () => {}, useState: value => [value, () => {}], useRef: current => ({ current }),
      useMemo: fn => fn(), useSyncExternalStore: (_subscribe, get) => get(),
    }
    if (name === 'react-dom' || name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`Unexpected module ${name}`)
  },
})
const { installConversationModelSeat, conversationModelSeat, NativeModelSeat, groupsFor, surfaceGroups, installModelAccounts, ProviderAccountSetup, ACCOUNT_SLOT } = module.exports
const plain = value => JSON.parse(JSON.stringify(value))

function coreFixture() {
  const core = new SlotCore()
  core.register({ name: 'root', children: {
    'conversation.input.model': { kind: 'single', scope: 'session' },
    'conversation.input.left': { kind: 'list', scope: 'session' },
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
  } }, () => null)
  // These tests register after the declaration exists. Cordis' injection lifetime
  // owns the returned disposer; all slot semantics below are the real SlotCore.
  const slots = {
    inject: (name, install) => { assert.ok(core.spec(name)); return install() },
    register: (...args) => core.register(...args),
    entries: name => core.entries(name),
  }
  return { core, slots }
}

test('DSH accepts the session picker root account slot and retains Welcome component metadata', async () => {
  const { core, slots } = coreFixture()
  const native = () => null
  core.register({ name: 'conversation.input.model' }, native)
  const picker = () => null
  const offPicker = installConversationModelSeat({ slots, face: () => ({}), Component: picker })
  assert.deepEqual(plain(core.spec(ACCOUNT_SLOT)), { kind: 'list', scope: 'root' })
  const offWelcome = installModelAccounts({ slots })
  const [account] = core.entries(ACCOUNT_SLOT)
  assert.equal(account.component, ProviderAccountSetup)
  assert.equal(account.component.accounts.matches('acp-codex'), true)
  assert.equal(account.component.accounts.matches('unsupported-provider'), false)
  assert.equal(typeof account.component.accounts.providers, 'function')
  assert.deepEqual(plain(account.options), { id: 'automagik-welcome', order: 0 })
  assert.deepEqual(Array.from(core.entriesOfSlot('conversation.input.model'), entry => entry.component), [picker])
  // DSH strips arbitrary options. Metadata intentionally lives on the retained
  // component, so both company discovery and account setup survive registration.
  assert.equal(account.options.providers, undefined)
  assert.equal(account.options.matches, undefined)
  offWelcome()
  assert.equal(core.entries(ACCOUNT_SLOT).length, 0)
  installModelAccounts({ slots })
  offPicker()
  assert.equal(core.spec(ACCOUNT_SLOT), undefined)
  assert.equal(core.entries(ACCOUNT_SLOT).length, 0)
  assert.deepEqual(Array.from(core.entriesOfSlot('conversation.input.model'), entry => entry.component), [native])
})

test('Bot, native, and channel surface switches keep one active control and the account registration', () => {
  const { core, slots } = coreFixture()
  core.register({ name: 'conversation.input.model' }, () => null)
  const PackModelCell = () => null
  const directories = []
  const Seat = conversationModelSeat({ PackModelCell, addressed: () => false, directoryFor: id => { directories.push(id); return {} }, select: () => {} })
  const offPicker = installConversationModelSeat({ slots, face: () => ({}), Component: Seat })
  const offWelcome = installModelAccounts({ slots })
  const account = core.entries(ACCOUNT_SLOT)[0]
  const lifecycle = surfaceGroups({
    shell: () => [() => slots.register({ name: 'sidebar.workspaces' }, () => null)],
    conversation: () => [() => slots.register({ name: 'conversation.input.left', id: 'bot-controls' }, () => null)],
  })
  const roster = { byId: { bot: { id: 'bot' }, dsh: { id: 'dsh', kind: 'dsh' } }, roomsById: {} }
  for (const [state, sessionId, expected] of [
    [{ mode: 'bot' }, 'bot', PackModelCell],
    [{ mode: 'bot', plain: true }, 'dsh', NativeModelSeat],
    [{ mode: 'agent' }, 'plain-session', NativeModelSeat],
    [{ mode: 'bot' }, 'channel-thread', NativeModelSeat],
    [{ mode: 'bot' }, 'bot', PackModelCell],
  ]) {
    lifecycle.reconcile(groupsFor(state))
    const controls = core.entriesOfSlot('conversation.input.model')
    assert.equal(controls.length, 1)
    assert.equal(controls[0].component, Seat)
    const rendered = controls[0].component({ sessionId, useRoster: select => select(roster) })
    assert.equal(rendered.type, expected)
    assert.equal(core.entries(ACCOUNT_SLOT)[0], account)
  }
  assert.deepEqual(directories, ['dsh', 'plain-session', 'channel-thread'])
  lifecycle.dispose()
  offWelcome()
  offPicker()
})
