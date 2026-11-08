import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// Composer packs (src/client/composer-packs.js): the AI a Bot runs on decides what its
// composer offers. Bundled with a stand-in React whose elements are plain objects.
const { outputFiles } = await build({
  stdin: {
    contents: [
      "export * from './src/client/composer-packs.js'",
      "export { packModelCell } from './src/client/composer-pack-cells.js'",
      "export { composerPacks, registerComposerPack } from './src/client/extend.js'",
      "export { ModelMenu } from './src/client/model-menu.js'",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent', external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const element = (type, props, ...children) => ({ type, props: props ?? {}, children })
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports, console, setTimeout, clearTimeout,
  require: (name) => {
    if (name === 'react') {
      return {
        createElement: element, Fragment: 'Fragment',
        useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
        useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
        useEffect: () => {}, useRef: () => ({ current: null }), useMemo: fn => fn(), useCallback: fn => fn,
      }
    }
    if (name === 'react-dom') return { createPortal: node => node }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`Unexpected platform module ${name}`)
  },
})
const {
  BUILTIN_PACKS, DEFAULT_PACK, BOT_MODEL_PACK, THINKING_PACK, ModelMenu,
  cellChoice, composerPacks, packCellSync, packFor, packModelCell, registerComposerPack, stepsAside, targetOf,
} = module.exports

const EFFORTS = { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' }
function rosterWith(bot, models = []) {
  return { ready: true, bots: [bot], byId: { [bot.id]: bot, [bot.sessionId]: bot }, roomsById: {}, models }
}
const agentBot = (extra = {}) => ({ id: 'bot-1', sessionId: 'session-1', name: 'Omni', model: 'acp-claude/claude-opus-5-5', ...extra })
const deepseekBot = (extra = {}) => ({ id: 'bot-1', sessionId: 'session-1', name: 'Omni', model: 'deepseek-official/deepseek-v4', ...extra })
// What the composer cells hold, by key: the fiber names of their registrants.
const envWith = registrants => ({ registrants: key => registrants[key] ?? [] })
// A plugin that runs an agent and brings its own composer controls, the way a pack from
// outside Omni registers (extend.js): its permission modes and Omni's model menu.
const AGENT = /acp-dsh/
const AGENT_PACK = Object.freeze({
  id: 'agent',
  order: -200,
  match: provider => provider === 'acp-claude',
  available: env => ['conversation.input.permission', 'conversation.input.left'].some(key => (env.registrants?.(key) ?? []).some(name => AGENT.test(name ?? ''))),
  cells: Object.freeze({ permission: target => (target?.bot?.permission ? 'hidden' : 'host'), model: 'model' }),
  hostFor: Object.freeze({ permission: AGENT }),
})
const PLUGIN = envWith({ 'conversation.input.permission': ['acp-dsh'], 'conversation.input.left': ['acp-dsh'] })
const NONE = envWith({})
const packs = [...BUILTIN_PACKS, AGENT_PACK].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
// The surface registers Omni's own packs (index.js), the plugin its own; the cells read the registry.
for (const pack of [...BUILTIN_PACKS, AGENT_PACK]) registerComposerPack(pack)

test('every personal Bot has a model picker, including legacy Claude Code routes', () => {
  assert.deepEqual(Array.from(BUILTIN_PACKS, pack => pack.id), ['host-model', 'thinking', 'agent-model', 'bot-model'])
  const old = rosterWith(deepseekBot({ model: 'claude-code/claude-opus-5-5' }))
  assert.equal(packFor(targetOf(old, 'session-1'), { packs: BUILTIN_PACKS, env: PLUGIN }), BOT_MODEL_PACK)
  const levels = rosterWith(deepseekBot({ model: 'claude-code/opus' }), [{ ref: 'claude-code/opus', reasoning: EFFORTS }])
  assert.equal(packFor(targetOf(levels, 'session-1'), { packs: BUILTIN_PACKS, env: PLUGIN }).id, 'thinking')
})

test('a Bot on a plugin\'s agent gets its pack while that plugin\'s controls are there', () => {
  const roster = rosterWith(agentBot())
  assert.equal(packFor(targetOf(roster, 'session-1'), { packs, env: PLUGIN }).id, 'agent')
  // It wins over the thinking pack, which a lower order puts after it.
  const levels = rosterWith(agentBot(), [{ ref: 'acp-claude/claude-opus-5-5', reasoning: EFFORTS }])
  assert.equal(packFor(targetOf(levels, 'session-1'), { packs, env: PLUGIN }).id, 'agent')
  // Without the plugin's controls the pack is not available: the next one that matches wins.
  assert.equal(packFor(targetOf(levels, 'session-1'), { packs, env: NONE }).id, 'thinking')
  // Without them, Omni's own pack for an agent over ACP: its model menu.
  assert.equal(packFor(targetOf(roster, 'session-1'), { packs, env: NONE }).id, 'agent-model')
})

// The main Bot of a fresh team runs on acp-codex/default or acp-claude/default. Before acp-dsh
// read the agents' efforts it had no thinking levels, so no pack drew its model menu (the
// Claude Code pack that did left with Oh My Claude).
test('a Bot on an agent over ACP gets Omni\'s model menu in the composer, and nothing else', () => {
  for (const model of ['acp-codex/default', 'acp-claude/default']) {
    const target = targetOf(rosterWith(agentBot({ model })), 'session-1')
    const pack = packFor(target, { packs: BUILTIN_PACKS, env: NONE })
    assert.equal(pack.id, 'agent-model')
    assert.equal(cellChoice(pack, 'model', target), 'model')
    assert.equal(cellChoice(pack, 'permission', target), 'hidden')
  }
  // Not an ACP route: acp is a prefix of the provider id, not of any word.
  assert.equal(packFor(targetOf(rosterWith(deepseekBot({ model: 'acpx/default' })), 'session-1'), { packs: BUILTIN_PACKS, env: NONE }), BOT_MODEL_PACK)
  // A group Session has no single AI: still Omni's own composer.
  assert.equal(packFor(undefined, { packs: BUILTIN_PACKS, env: NONE }), DEFAULT_PACK)
})

// acp-dsh serves an agent model's efforts (its thought_level) as the model's reasoning, as
// any provider does: that Bot gets the menu with those levels, from the thinking pack.
test('an ACP model with the agent\'s efforts gets the model menu with its levels', () => {
  const codex = { efforts: [{ id: 'low', name: 'low' }, { id: 'medium', name: 'medium' }, { id: 'high', name: 'high' }] }
  const target = targetOf(rosterWith(agentBot({ model: 'acp-codex/default' }), [{ ref: 'acp-codex/default', provider: 'acp-codex', reasoning: codex }]), 'session-1')
  const pack = packFor(target, { packs: BUILTIN_PACKS, env: NONE })
  assert.equal(pack.id, 'thinking')
  assert.equal(cellChoice(pack, 'model', target), 'model')
  assert.deepEqual(Array.from(target.reasoning.efforts, effort => effort.id), ['low', 'medium', 'high'])
  // A model of the same agent with none: still the menu, from the ACP pack.
  const bare = targetOf(rosterWith(agentBot({ model: 'acp-claude/haiku' }), [{ ref: 'acp-claude/haiku', provider: 'acp-claude' }]), 'session-1')
  assert.equal(packFor(bare, { packs: BUILTIN_PACKS, env: NONE }).id, 'agent-model')
})

test('pack selection: thinking levels, then Omni\'s own composer; a broken pack never wins', () => {
  const thinking = rosterWith(deepseekBot(), [{ ref: 'deepseek-official/deepseek-v4', reasoning: EFFORTS }])
  assert.equal(packFor(targetOf(thinking, 'session-1'), { packs, env: NONE }).id, 'thinking')
  assert.equal(packFor(targetOf(rosterWith(deepseekBot()), 'session-1'), { packs, env: NONE }), BOT_MODEL_PACK)
  assert.equal(packFor(undefined, { packs, env: PLUGIN }), DEFAULT_PACK)
  assert.equal(packFor(targetOf(rosterWith(deepseekBot({ model: undefined })), 'session-1'), { packs, env: PLUGIN }), BOT_MODEL_PACK)
  const broken = { id: 'broken', order: -999, match: () => { throw new Error('boom') }, cells: { permission: 'host' } }
  assert.equal(packFor(targetOf(rosterWith(agentBot()), 'session-1'), { packs: [broken, ...packs], env: PLUGIN }).id, 'agent')
  const unavailable = { id: 'unavailable', order: -999, match: () => true, available: () => { throw new Error('boom') } }
  assert.equal(packFor(targetOf(rosterWith(agentBot()), 'session-1'), { packs: [unavailable, ...packs], env: PLUGIN }).id, 'agent')
})

test('a registered pack joins the selection in order and leaves with its disposer', () => {
  const before = composerPacks.entries().length
  const codex = { id: 'codex', order: -300, match: provider => provider === 'openai-codex', cells: { model: 'model' } }
  const off = registerComposerPack(codex)
  const target = targetOf(rosterWith(deepseekBot({ model: 'openai-codex/gpt-6' })), 'session-1')
  assert.equal(packFor(target, { env: NONE }).id, 'codex')
  off()
  assert.equal(composerPacks.entries().length, before)
  assert.equal(packFor(target, { env: NONE }), BOT_MODEL_PACK)
})

test('a plugin\'s pack un-blanks its permission and model cells, and only those', () => {
  const target = targetOf(rosterWith(agentBot()), 'session-1')
  assert.equal(cellChoice(AGENT_PACK, 'permission', target), 'host')
  assert.equal(cellChoice(AGENT_PACK, 'model', target), 'model')
  // The plan cell and the docks are not pack cells: they stay Omni's.
  assert.equal(cellChoice(AGENT_PACK, 'plan', target), 'hidden')
  assert.equal(cellChoice(AGENT_PACK, 'usage', target), 'hidden')
  // A choice that throws or names nothing known reads as hidden.
  assert.equal(cellChoice({ cells: { permission: () => { throw new Error('boom') } } }, 'permission', target), 'hidden')
  assert.equal(cellChoice({ cells: { permission: 'everything' } }, 'permission', target), 'hidden')
  assert.equal(stepsAside({ roster: rosterWith(agentBot()), sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: PLUGIN, packs }), true)
})

test('a Bot with its own permissions keeps Omni\'s empty permission cell under a plugin\'s pack', () => {
  const roster = rosterWith(agentBot({ permission: 'read-only' }))
  assert.equal(cellChoice(AGENT_PACK, 'permission', targetOf(roster, 'session-1')), 'hidden')
  assert.equal(stepsAside({ roster, sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: PLUGIN, packs }), false)
})

test('without the plugin, or without its permission control, nothing steps aside', () => {
  const roster = rosterWith(agentBot())
  assert.equal(stepsAside({ roster, sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: NONE, packs }), false)
  // Only its left button is there (an older DSH): DSH's own permission control would show.
  const leftOnly = envWith({ 'conversation.input.left': ['acp-dsh'] })
  assert.equal(stepsAside({ roster, sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: leftOnly, packs }), false)
  // The model cell is Omni's own either way: the agent's Bot keeps its model menu.
  const drawn = packModelCell(NONE)({ sessionId: 'session-1', useRoster: pick => pick(roster), actions: {} })
  assert.equal(drawn.props['data-pack'], 'agent-model')
  assert.equal(drawn.children[0].type, ModelMenu)
})

test('personal Bot models remain selectable without thinking levels; room cells stay hidden', () => {
  assert.deepEqual({ ...DEFAULT_PACK.cells }, { permission: 'hidden', model: 'hidden' })
  const roster = rosterWith(deepseekBot())
  assert.equal(stepsAside({ roster, sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: PLUGIN, packs }), false)
  assert.equal(packModelCell(PLUGIN)({ sessionId: 'session-1', useRoster: pick => pick(roster), actions: {} }).children[0].type, ModelMenu)
  assert.equal(packModelCell(PLUGIN)({ sessionId: 'group-1', useRoster: pick => pick(roster), actions: {} }), null)
  let registered = 0
  const sync = packCellSync({ register: () => { registered += 1; return () => { registered -= 1 } }, wantHost: () => false })
  sync.sync()
  sync.sync()
  assert.equal(registered, 1)
  sync.dispose()
  assert.equal(registered, 0)
})

test('swapping the Bot\'s model swaps the composer live', () => {
  let roster = rosterWith(deepseekBot())
  let registered = 0
  const sync = packCellSync({
    register: () => { registered += 1; return () => { registered -= 1 } },
    wantHost: () => stepsAside({ roster, sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: PLUGIN, packs }),
  })
  const cell = packModelCell(PLUGIN)
  const draw = () => cell({ sessionId: 'session-1', useRoster: pick => pick(roster), actions: {} })
  sync.sync()
  assert.equal(registered, 1)
  assert.equal(draw().props['data-pack'], 'bot-model')
  roster = rosterWith(agentBot())
  sync.sync()
  assert.equal(registered, 0, 'Omni stepped aside for the agent\'s permission modes')
  const drawn = draw()
  assert.equal(drawn.props['data-pack'], 'agent')
  assert.equal(drawn.children[0].type, ModelMenu)
  assert.equal(drawn.children[0].props.bot.model, 'acp-claude/claude-opus-5-5')
  roster = rosterWith(deepseekBot(), [{ ref: 'deepseek-official/deepseek-v4', reasoning: EFFORTS }])
  sync.sync()
  assert.equal(registered, 1, 'back on DeepSeek, Omni holds the permission cell again')
  assert.equal(draw().props['data-pack'], 'thinking')
  sync.dispose()
})

test('the model menu a pack draws saves to the Bot and reports a failed save', async () => {
  const reported = []
  const roster = rosterWith(agentBot())
  const drawn = packModelCell(PLUGIN)({ sessionId: 'session-1', useRoster: pick => pick(roster), actions: { reportError: (error, where) => reported.push([error.message, where]) } })
  const { run } = drawn.children[0].props
  assert.equal(await run(Promise.resolve()), true)
  assert.equal(await run(Promise.reject(new Error('not served'))), false)
  assert.deepEqual(reported, [['not served', 'composer-model']])
})

test('the thinking pack matches only models that serve levels', () => {
  assert.equal(THINKING_PACK.match('deepseek-official', { reasoning: EFFORTS }), true)
  assert.equal(THINKING_PACK.match('deepseek-official', { reasoning: { efforts: [] } }), false)
  assert.equal(THINKING_PACK.match('deepseek-official', {}), false)
})

test('a Bot whose model menu its plugin owns gets that menu in the composer, whatever DSH model it was saved with', () => {
  const host = { entries: [{ id: 'granite', label: 'Granite 4.1 3B', current: true }] }
  for (const bot of [agentBot({ kind: 'unfold' }), deepseekBot({ kind: 'unfold', model: undefined })]) {
    const roster = { ...rosterWith(bot, [{ ref: 'deepseek-official/deepseek-v4', reasoning: EFFORTS }]), hostModels: { 'bot-1': host } }
    const target = targetOf(roster, 'session-1')
    assert.equal(target.host, host)
    assert.equal(target.provider, undefined)
    assert.equal(packFor(target, { packs, env: PLUGIN }).id, 'host-model')
    // DSH's permission control never shows for it, and the model cell draws Omni's menu.
    assert.equal(stepsAside({ roster, sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: PLUGIN, packs }), false)
    const drawn = packModelCell(PLUGIN)({ sessionId: 'session-1', useRoster: pick => pick(roster), actions: {} })
    assert.equal(drawn.props['data-pack'], 'host-model')
    assert.equal(drawn.children[0].type, ModelMenu)
  }
  // Without the plugin's menu the Bot gets its ordinary pack.
  assert.equal(packFor(targetOf(rosterWith(agentBot({ kind: 'unfold' })), 'session-1'), { packs, env: PLUGIN }).id, 'agent')
})
