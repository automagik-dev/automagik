import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  stdin: {
    contents: "export * from './src/client/native-model-seat.js'; export { ModelMenu } from './src/client/model-menu.js'",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
const effects = []
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, console, setTimeout, clearTimeout,
  require: name => {
    if (name === 'react') return {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      Fragment: 'Fragment', useEffect: effect => { effects.push(effect) }, useLayoutEffect: () => {},
      useMemo: fn => fn(), useRef: current => ({ current }),
      useState: initial => [initial, () => {}],
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    }
    if (name === 'react-dom') return { createPortal: element => element }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`Unexpected module ${name}`)
  },
})
const { ModelMenu, NativeModelSeat, NATIVE_MODEL_CSS, conversationModelSeat, modelSeatTarget, sessionModelChanges, sessionModelRoster } = module.exports
const json = value => JSON.parse(JSON.stringify(value))
const current = { provider: 'deepseek', model: 'flash', reasoningEffort: 'high' }
const snapshot = { current, groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'flash', name: 'Flash' }] }] }
const roster = { byId: {}, roomsById: {}, models: [] }

test('each conversation keeps its actual model owner; groups and subagents have no independent selector', () => {
  const bot = { id: 'bot', kind: 'computer' }
  const native = { id: 'dsh', kind: 'dsh' }
  const state = { ...roster, byId: { part: bot, adopted: native }, roomsById: { room: {} } }
  assert.equal(modelSeatTarget(state, 'part'), 'bot')
  assert.equal(modelSeatTarget(state, 'adopted'), 'session')
  assert.equal(modelSeatTarget({ ...state, hostModels: { dsh: {} } }, 'adopted'), 'bot')
  assert.equal(modelSeatTarget(state, 'channel-thread'), 'session')
  assert.equal(modelSeatTarget(state, 'plain-session'), 'session')
  assert.equal(modelSeatTarget(state, 'room'), 'hidden')
  assert.equal(modelSeatTarget(state, 'child', true), 'hidden')
  assert.equal(modelSeatTarget(state, undefined), 'hidden')
})

test('native catalog keeps credential metadata and refreshes names and reasoning without exposing host-owned menus', () => {
  const source = { ...roster, hostModels: { thread: {} }, models: [
    { ref: 'deepseek/flash', provider: 'deepseek', name: 'Old name', needsKey: true },
    { ref: 'anthropic/opus', provider: 'anthropic', name: 'Opus', needsKey: true },
  ] }
  const value = sessionModelRoster(source, snapshot)
  assert.deepEqual(json(value.models), [
    { ref: 'deepseek/flash', provider: 'deepseek', name: 'Flash', needsKey: true, id: 'flash', providerName: 'DeepSeek' },
    source.models[1],
  ])
  assert.deepEqual(json(value.hostModels), {})
  assert.equal(source.models[0].name, 'Old name')
  assert.ok(source.hostModels.thread)
})

test('a refused key or login leaves the shared directory unchanged and permits retry', async () => {
  const selected = []
  const busy = []
  const denied = Object.assign(new Error('Sign in first'), { access: { ready: false, status: 'login-required' } })
  let reject = true
  const change = sessionModelChanges({
    sessionId: 'thread', onBusy: value => busy.push(value),
    select: async payload => { selected.push(json(payload)); if (reject) throw denied },
  })
  await assert.rejects(change('acp-codex/gpt'), error => error === denied)
  assert.deepEqual(snapshot.current, current)
  reject = false
  assert.equal(await change('acp-codex/gpt'), true)
  assert.deepEqual(selected, [
    { sessionId: 'thread', ref: 'acp-codex/gpt' },
    { sessionId: 'thread', ref: 'acp-codex/gpt' },
  ])
  assert.deepEqual(busy, [true, false, true, false])
})

test('one pending selection owns the write and effort reset omits reasoningEffort', async () => {
  let finish
  const writes = []
  const change = sessionModelChanges({ sessionId: 'native', select: payload => {
    writes.push(json(payload))
    return new Promise(resolve => { finish = resolve })
  } })
  const first = change('deepseek/flash', 'high')
  assert.equal(await change('other/model'), false)
  finish()
  await first
  const reset = change('deepseek/flash')
  finish()
  await reset
  assert.deepEqual(writes, [
    { sessionId: 'native', ref: 'deepseek/flash', reasoningEffort: 'high' },
    { sessionId: 'native', ref: 'deepseek/flash' },
  ])
})

function native({ locked = false } = {}) {
  const selected = []
  const loads = []
  const directory = { store: { subscribe: () => () => {}, getSnapshot: () => snapshot }, load: async () => { loads.push('directory') } }
  const actions = { refreshModels: async () => { loads.push('roster') }, modelAccountEntries: () => ['account UI'] }
  const tree = NativeModelSeat({ sessionId: 'thread', directory, roster, actions, select: async payload => { selected.push(json(payload)) }, locked })
  return { tree, menu: tree.children[0], selected, loads }
}

test('thread selector uses the Session projection, supports inline accounts, and survives Omni Bot-control hiding', async () => {
  const { tree, menu, selected, loads } = native()
  assert.equal(tree.props.className, 'bt-session-model')
  assert.equal(menu.type, ModelMenu)
  assert.equal(menu.props.bot.model, 'deepseek/flash')
  assert.equal(menu.props.bot.effort, 'high')
  assert.deepEqual(menu.props.actions.modelAccountEntries(), ['account UI'])
  await menu.props.onPick('anthropic/opus')
  await menu.props.onPickEffort(undefined)
  assert.deepEqual(selected, [
    { sessionId: 'thread', ref: 'anthropic/opus' },
    { sessionId: 'thread', ref: 'deepseek/flash' },
  ])
  assert.equal(menu.props.bot.model, 'deepseek/flash')
  await menu.props.actions.refreshModels()
  assert.deepEqual(loads, ['roster', 'directory'])
  assert.ok(NATIVE_MODEL_CSS.includes('.bt-session-model'))
})

test('a locked composer refuses model and effort writes while retaining its displayed selection', async () => {
  const { menu, selected } = native({ locked: true })
  assert.equal(menu.props.disabled, true)
  assert.equal(await menu.props.onPick('other/model'), false)
  assert.equal(await menu.props.onPickEffort('low'), false)
  assert.deepEqual(selected, [])
  assert.equal(menu.props.bot.model, 'deepseek/flash')
})

test('the shared seat delegates Bot menus and resolves directories only for ordinary Sessions', () => {
  const resolved = []
  const Pack = () => null
  const Seat = conversationModelSeat({ PackModelCell: Pack, directoryFor: id => { resolved.push(id); return {} }, addressed: id => id === 'subagent', select: () => {} })
  const render = (id, state) => Seat({ sessionId: id, useRoster: select => select(state) })
  assert.equal(render('bot', { ...roster, byId: { bot: { id: 'bot' } } }).type, Pack)
  assert.equal(render('room', { ...roster, roomsById: { room: {} } }), null)
  assert.equal(render('subagent', roster), null)
  const thread = render('thread', roster)
  assert.equal(thread.type, NativeModelSeat)
  assert.equal(thread.props.key, 'thread')
  assert.deepEqual(resolved, ['thread'])
})
