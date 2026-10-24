import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/model-menu.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
// `menuOpen`: every state that starts empty starts as an open menu's place, so a menu
// renders its rows.
let menuOpen = false
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  document: { body: {} },
  window: { innerWidth: 1280, innerHeight: 800 },
  require: name => {
    const platform = {
      react: {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
        Fragment: 'Fragment',
        useState: initial => [initial === null && menuOpen ? { left: 0, top: 0, width: 240 } : initial, () => {}],
        useEffect: () => {},
        useLayoutEffect: () => {},
        useRef: current => ({ current }),
        useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
      },
      'react-dom': { createPortal: node => node },
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
})
const { groupModels, greetingOnly, ModelChoiceDock, ModelLine, ModelLineTail, ModelMenu, effortRows } = module.exports

function nodes(tree, match) {
  if (!tree || typeof tree !== 'object') return []
  return [...(match(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, match))]
}

// `harness`: the window has DSH's own settings to send the user to, as the plugin does.
function dock(models, { model, ready = true, harness = true } = {}) {
  const picked = []
  const bot = { id: 'chief', name: 'Omni', model }
  const roster = { ready, byId: { chief: bot }, models, defaultModel: models[0]?.ref }
  const tree = ModelChoiceDock({
    sessionId: bot.id, useRoster: select => select(roster),
    actions: {
      updateBot: (id, patch) => { picked.push([id, patch.model]); return Promise.resolve() },
      ...(harness ? { openHarnessSettings: () => {}, openHarnessOnboarding: () => {} } : {}),
    },
  })
  return { tree, picked }
}

const models = [
  { ref: 'official/flash', provider: 'official', providerName: 'DeepSeek', name: 'DeepSeek Flash' },
  { ref: 'local/flash', provider: 'local', providerName: 'Ollama', name: 'DeepSeek Flash' },
  { ref: 'official/pro', provider: 'official', providerName: 'DeepSeek', name: 'DeepSeek Pro' },
]

test('with models that can run and none chosen, one press starts the Bot: no grid of choices', () => {
  const { tree, picked } = dock(models)
  assert.equal(nodes(tree, node => node.props.className === 'bt-model-choice-group').length, 0)
  assert.equal(nodes(tree, node => node.type === 'button' && node.children.includes('Manage models')).length, 0)
  assert.match(nodes(tree, node => node.props.className === 'bt-bubble')[0].children[0], /Say when, and I'll start/)
  // It offers DSH's default, named with its provider; "change" picks another.
  const [line] = nodes(tree, node => node.type === ModelLine)
  assert.equal(line.props.ref, 'official/flash')
  line.props.onPick('local/flash')
  const [start] = nodes(tree, node => node.type === 'button' && node.children.includes('Start'))
  start.props.onClick()
  assert.deepEqual(picked, [['chief', 'local/flash'], ['chief', 'official/flash']])
})

test('the model line names the model and its provider, and "change" opens the model menu', () => {
  const bot = { id: 'chief', name: 'Pip', model: 'claude-code/opus' }
  const roster = { models: [{ ref: 'claude-code/opus', provider: 'claude-code', providerName: 'Oh My Claude', name: 'Claude Opus 5.5' }, ...models] }
  const line = ModelLine({ bot, roster, actions: {}, run: () => {} })
  assert.equal(nodes(line, node => node.props.className === 'bt-model-line-text')[0].children[0], 'Using Claude Opus 5.5 · Oh My Claude')
  const [menu] = nodes(line, node => node.type === ModelMenu)
  assert.equal(menu.props.link, true)
  // Closed, the trigger is the "change" link.
  const closed = ModelMenu(menu.props)
  const [trigger] = nodes(closed, node => node.type === 'button')
  assert.equal(trigger.children[0], 'change')
  assert.equal(trigger.props['aria-haspopup'], 'menu')
  // Open, the menu lists the models and leads to the providers.
  menuOpen = true
  try {
    const open = ModelMenu({ ...menu.props, actions: { openHarnessSettings: () => {} } })
    const items = nodes(open, node => node.type === 'button').map(button => button.children.map(child => (typeof child === 'string' ? child : nodes(child, n => n.props.className === 'bt-menu-label')[0]?.children[0] ?? '')).join(''))
    assert.equal(nodes(open, node => node.type?.name === 'ModelRows')[0].props.current, 'claude-code/opus')
    assert.ok(items.includes('Models and providers…'))
  } finally {
    menuOpen = false
  }
})

test('while the chat holds only the greeting, the line under it names the model; then it goes', () => {
  const kickoff = { turn: 1, prompt: '[Bot team setup]\nGreet the user.', response: 'Hi, I\'m Omni.' }
  assert.equal(greetingOnly([kickoff]), true)
  // DSH's outline lists a turn the team started with no prompt.
  assert.equal(greetingOnly([{ turn: 1, prompt: '', response: 'Hi, I\'m Omni.' }]), true)
  assert.equal(greetingOnly([kickoff, { turn: 2, prompt: 'Plan the launch week' }]), false)
  assert.equal(greetingOnly([{ turn: 1, prompt: 'Plan the launch week' }]), false)
  assert.equal(greetingOnly([]), false)
  assert.equal(greetingOnly(undefined), false)
  const tail = (outline, { model = models[2].ref, turn = 1 } = {}) => {
    const bot = { id: 'chief', name: 'Omni', model }
    return ModelLineTail({
      turn: { turn }, sessionId: 'chief', actions: {},
      useRoster: select => select({ ready: true, byId: { chief: bot }, models }),
      useSessions: select => select({ byId: { chief: { projectionValues: { turnOutline: outline } } } }),
    })
  }
  const [line] = nodes(tail([{ turn: 1, prompt: '', response: 'Hi' }]), node => node.type === ModelLine)
  assert.equal(line.props.bot.model, 'official/pro')
  // Once someone writes, on another turn's tail, or with a model that went away: no line.
  assert.equal(tail([{ turn: 1, prompt: '' }, { turn: 2, prompt: 'hello' }]), null)
  assert.equal(tail([{ turn: 1, prompt: '' }], { turn: 2 }), null)
  assert.equal(tail([{ turn: 1, prompt: '' }], { model: 'gone/flash' }), null)
  // The choice dock stays away while the Bot has a model it can run on.
  assert.equal(dock(models, { model: models[2].ref }).tree, null)
})

test('providers with the same display name stay distinct, and unnamed providers use their id', () => {
  const entries = [
    { ...models[0], providerName: 'Cloud' },
    { ...models[1], providerName: 'Cloud' },
    { ref: 'custom/flash', provider: 'custom', name: 'Flash' },
  ]
  const groups = groupModels(entries)
  assert.deepEqual(Array.from(groups, ([label, list]) => [label, Array.from(list, model => model.ref)]), [
    ['Cloud (official)', ['official/flash']],
    ['Cloud (local)', ['local/flash']],
    ['custom', ['custom/flash']],
  ])
})

test('an unavailable model offers the provider groups, each model route, and a way to the models', () => {
  const { tree, picked } = dock(models, { model: 'gone/flash' })
  const groups = nodes(tree, node => node.props.className === 'bt-model-choice-group')
  assert.deepEqual(groups.map(group => group.props['aria-label']), ['DeepSeek', 'Ollama'])
  assert.ok(nodes(tree, node => node.props.className === 'bt-bubble')[0].children[0].includes('not available anymore'))
  const buttons = groups.map(group => nodes(group, node => node.type === 'button'))
  assert.deepEqual(buttons.map(list => list.map(button => button.children[0])), [['DeepSeek Flash', 'DeepSeek Pro'], ['DeepSeek Flash']])
  assert.match(buttons[0][0].props.title, /official\/flash.*Harness default/)
  buttons[1][0].props.onClick()
  assert.deepEqual(picked, [['chief', 'local/flash']])
  assert.equal(nodes(tree, node => node.type === 'button' && node.children.includes('Manage models')).length, 1)
})

test('an empty catalog offers setup choices, Connect an AI first, and a ready model needs no choice dock', () => {
  const { tree } = dock([])
  assert.deepEqual(nodes(tree, node => node.type === 'button').map(button => button.children[0]), [
    'Connect an AI: ChatGPT, Claude, Kimi or an API key', 'Enter a DeepSeek API key', 'Open settings to set up a custom model',
  ])
  assert.equal(dock(models, { model: models[0].ref }).tree, null)
  assert.equal(dock(models, { ready: false }).tree, null)
})

test('without DSH\'s own settings, the choice offers no way into them', () => {
  const buttons = tree => nodes(tree, node => node.type === 'button').map(button => button.children[0])
  assert.deepEqual(buttons(dock(models, { harness: false }).tree), ['Start'])
  assert.deepEqual(buttons(dock(models, { harness: false, model: 'gone/flash' }).tree), ['DeepSeek Flash', 'DeepSeek Pro', 'DeepSeek Flash'])
  assert.deepEqual(buttons(dock([], { harness: false }).tree), [])
})

test('the Thinking section always offers Default, so a picked level can be cleared', () => {
  const efforts = [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]
  // Array.from: the rows come from the bundle's realm, whose arrays are not this one's.
  assert.deepEqual(Array.from(effortRows({ efforts, defaultEffort: 'high' }), row => row.effort), [undefined, 'low', 'high'])
  assert.deepEqual(Array.from(effortRows({ efforts }), row => row.effort), [undefined, 'low', 'high'])
  assert.equal(effortRows({ efforts: [] }).length, 0)
})

const keyless = [
  { ref: 'official/flash', provider: 'official', providerName: 'DeepSeek', name: 'DeepSeek Flash', needsKey: true },
  { ref: 'official/pro', provider: 'official', providerName: 'DeepSeek', name: 'DeepSeek Pro', needsKey: true },
]

test('models that need an API key are no choice', () => {
  const buttons = tree => nodes(tree, node => node.type === 'button').map(button => button.children[0])
  // DSH's default needs a key: the Bot offers the model that can run.
  const offer = dock([...keyless, models[1]], { harness: false }).tree
  assert.deepEqual(buttons(offer), ['Start'])
  assert.equal(nodes(offer, node => node.type === ModelLine)[0].props.ref, 'local/flash')
  // Where DSH's own settings are, they take the key; Omni's Connect AI step comes first.
  assert.deepEqual(buttons(dock(keyless).tree), ['Connect an AI: ChatGPT, Claude, Kimi or an API key', 'Enter a DeepSeek API key', 'Open settings to set up a custom model'])
})

test('a window without DSH settings asks for the missing API key in the first choice', () => {
  const saved = []
  const bot = { id: 'chief', name: 'Omni' }
  const tree = ModelChoiceDock({
    sessionId: bot.id,
    useRoster: select => select({ ready: true, byId: { chief: bot }, models: keyless }),
    actions: { setProviderKey: (provider, value) => { saved.push([provider, value]) } },
  })
  assert.match(nodes(tree, node => node.props.className === 'bt-bubble')[0].children[0], /need a DeepSeek API key/)
  const [card] = nodes(tree, node => node.props.model !== undefined)
  assert.equal(card.props.model.provider, 'official')
  assert.equal(nodes(tree, node => node.props.className === 'bt-model-chips').length, 0)
})
