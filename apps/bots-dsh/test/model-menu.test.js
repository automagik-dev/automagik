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
const { groupModels, greetingOnly, ModelChoiceDock, ModelLine, ModelLineTail, ModelMenu, effortRows, offeredModels } = module.exports

// ModelMenu picks the menu a Bot gets (DSH's models, or its plugin's): draw the one it picked.
const drawMenu = (props) => {
  const picked = ModelMenu(props)
  return picked.type(picked.props)
}

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
  assert.equal(line.props.modelRef, 'official/flash')
  line.props.onPick('local/flash')
  const [start] = nodes(tree, node => node.type === 'button' && node.children.includes('Start'))
  start.props.onClick()
  assert.deepEqual(picked, [['chief', 'local/flash'], ['chief', 'official/flash']])
})

test('the model line names the model and its provider, and "change" opens the model menu', () => {
  const bot = { id: 'chief', name: 'Pip', model: 'anthropic/claude-opus-5-5' }
  const roster = { models: [{ ref: 'anthropic/claude-opus-5-5', provider: 'anthropic', providerName: 'Anthropic', name: 'Claude Opus 5.5' }, ...models] }
  const line = ModelLine({ bot, roster, actions: {}, run: () => {} })
  assert.equal(nodes(line, node => node.props.className === 'bt-model-line-text')[0].children[0], 'Using Claude Opus 5.5 · Anthropic')
  const [menu] = nodes(line, node => node.type === ModelMenu)
  assert.equal(menu.props.link, true)
  // Closed, the trigger is the "change" link.
  const closed = drawMenu(menu.props)
  const [trigger] = nodes(closed, node => node.type === 'button')
  assert.equal(trigger.children[0], 'change')
  assert.equal(trigger.props['aria-haspopup'], 'menu')
  // Open, the menu lists the connections and leads to the providers.
  menuOpen = true
  try {
    const open = drawMenu({ ...menu.props, actions: { openHarnessSettings: () => {} } })
    const steps = nodes(open, node => node.type?.name === 'ModelSteps')[0]
    assert.equal(steps.props.current, 'anthropic/claude-opus-5-5')
    const drawn = steps.type(steps.props)
    const items = nodes(drawn, node => node.type === 'button').map(button => nodes(button, n => n.props.className === 'bt-menu-label')[0]?.children[0] ?? '')
    assert.deepEqual(items, ['Anthropic', 'DeepSeek', 'Ollama', 'Models and providers…'])
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
  assert.equal(nodes(offer, node => node.type === ModelLine)[0].props.modelRef, 'local/flash')
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

// A Bot whose model menu its plugin owns: rows come only from the state's `hostModels`.
const HOST = {
  entries: [
    { id: 'granite', label: 'Granite 4.1 3B', group: 'Unfold', privacy: { kind: 'local', device: 'Mac' }, answering: true },
    { id: 'deepseek', label: 'DeepSeek V4.1 Flash', group: 'Unfold', current: true, privacy: { kind: 'direct', provider: 'DeepSeek', memories: true }, levels: [{ id: 'auto', name: 'Auto' }, { id: 'off', name: 'Off' }, { id: 'high', name: 'High' }] },
    { id: 'openai-codex/gpt-5.5', label: 'GPT-5.5', group: 'Unfold Automagik', privacy: { kind: 'relay', provider: 'ChatGPT', via: 'Unfold Automagik', device: 'Mac' }, confirm: true },
  ],
  level: 'auto',
  status: { kind: 'after-reply' },
}
const hostBot = { id: 'unfold', name: 'Unfold', kind: 'unfold', model: 'luna/gpt-5.6' }
const hostRoster = (menu = HOST) => ({ ready: true, byId: { unfold: hostBot }, models, hostModels: { unfold: menu } })
// ModelMenu hands a host-owned Bot to the host menu: draw that one.
const drawHost = drawMenu

test('a host-owned Bot\'s menu lists only the plugin\'s entries, says where each goes, and its levels as given', () => {
  const picked = []
  menuOpen = true
  try {
    const tree = drawHost({ bot: hostBot, roster: hostRoster(), actions: { updateBot: (id, patch) => { picked.push([id, patch]); return Promise.resolve() } }, run: promise => promise })
    const rows = nodes(tree, node => node.type === 'button' && node.props.role === 'menuitemradio')
    const labels = rows.map(row => nodes(row, node => node.props.className === 'bt-menu-label')[0].children[0])
    // No DSH catalog model, no Default row: the plugin's entries, then its levels.
    assert.deepEqual(labels, ['Granite 4.1 3B', 'DeepSeek V4.1 Flash', 'GPT-5.5', 'Auto', 'Off', 'High'])
    const details = nodes(tree, node => node.props.className === 'bt-host-model-detail').map(node => node.children[0])
    assert.deepEqual(details, [
      'Stays on this Mac.',
      'Your message and the memories recalled for it go to DeepSeek.',
      'Your message goes to ChatGPT through Unfold Automagik; memories stay on this Mac.',
    ])
    assert.deepEqual(rows.map(row => row.props['aria-checked']), [false, true, false, true, false, false])
    // The tick is the pick; the row that still answers says so.
    assert.equal(nodes(rows[0], node => node.props.className === 'bt-menu-hint')[0].children[0], 'Answering now')
    assert.equal(nodes(tree, node => node.props.role === 'status')[0].children[0], 'Switching after this reply…')
    assert.equal(nodes(tree, node => node.props.className === 'bt-model-provider')[0].children[0], 'Switching after this reply…')
    rows[0].props.onClick()
    rows[5].props.onClick()
    // The current entry and the current level change nothing.
    rows[1].props.onClick()
    rows[3].props.onClick()
    assert.equal(JSON.stringify(picked), JSON.stringify([['unfold', { model: 'granite' }], ['unfold', { effort: 'high' }]]))
  } finally {
    menuOpen = false
  }
})

test('a host-owned Bot never gets the DSH model dock or the greeting\'s model line', () => {
  const tree = ModelChoiceDock({ sessionId: 'unfold', useRoster: select => select(hostRoster()), actions: { updateBot: () => Promise.resolve() } })
  assert.equal(tree, null)
  const line = ModelLineTail({
    turn: { turn: 1 }, sessionId: 'unfold', actions: {},
    useRoster: select => select(hostRoster()),
    useSessions: select => select({ byId: { unfold: { projectionValues: { turnOutline: [{ turn: 1, prompt: '' }] } } } }),
  })
  assert.equal(line, null)
  // Without the plugin's menu the same Bot is an ordinary one again.
  const props = { bot: hostBot, actions: {}, run: p => p }
  assert.equal(ModelMenu({ ...props, roster: { ready: true, byId: { unfold: hostBot }, models } }).type.name, 'DshModelMenu')
  assert.equal(ModelMenu({ ...props, roster: hostRoster() }).type.name, 'HostModelMenu')
})

test('the trigger names the picked entry, its group and level, and a fallback says who answers', () => {
  const trigger = (menu) => {
    const tree = drawHost({ bot: hostBot, roster: hostRoster(menu), actions: {}, run: p => p })
    const copy = nodes(tree, node => node.props.className === 'bt-model-copy')[0]
    return copy.children.filter(Boolean).map(node => node.children[0])
  }
  assert.deepEqual(trigger({ ...HOST, status: undefined }), ['DeepSeek V4.1 Flash', 'Unfold · Auto'])
  assert.deepEqual(trigger({ ...HOST, status: { kind: 'fallback', answering: 'Granite 4.1 3B' } }), ['DeepSeek V4.1 Flash', 'Granite 4.1 3B answers for now'])
  assert.deepEqual(trigger({ entries: [], loading: true }), ['Choose a model'])
})

test('a host-owned Bot\'s settings and details name what answers now, never the DSH model saved on it', () => {
  const { modelHint, needsModelPick } = module.exports
  const saved = { id: 'unfold', name: 'Unfold', kind: 'unfold', model: 'luna/gpt-5.6', appliedModel: 'luna/gpt-5.6' }
  const plain = { ready: true, byId: { unfold: saved }, models: [{ ref: 'luna/gpt-5.6', provider: 'luna', providerName: 'Luna', name: 'GPT-5.6 Luna' }] }
  // Without the plugin's menu it is an ordinary Bot.
  assert.equal(modelHint(saved, plain), 'Every message of this Bot runs on it.')
  const hosted = { ...plain, hostModels: { unfold: HOST } }
  assert.equal(modelHint(saved, hosted), 'Granite 4.1 3B answers now.')
  assert.equal(modelHint(saved, { ...plain, hostModels: { unfold: { entries: [], loading: true } } }), null)
  // No "Pick a model" note under the plugin's menu, even with no DSH model saved.
  const bare = { id: 'unfold', name: 'Unfold', kind: 'unfold' }
  assert.equal(needsModelPick(bare, { ...plain, byId: { unfold: bare } }), true)
  assert.equal(needsModelPick(bare, { ...hosted, byId: { unfold: bare } }), false)
})

test('the menu leaves out a superseded model, unless the Bot is on it', () => {
  const models = [
    { ref: 'anthropic/claude-opus-5-5', provider: 'anthropic' },
    { ref: 'anthropic/claude-opus-4-7', provider: 'anthropic', superseded: true },
    { ref: 'acp-claude/default', provider: 'acp-claude' },
  ]
  assert.deepEqual(Array.from(offeredModels(models, 'acp-claude/default'), model => model.ref), ['anthropic/claude-opus-5-5', 'acp-claude/default'])
  // A Bot saved on an older Claude still sees, and keeps, the model it is on.
  assert.deepEqual(Array.from(offeredModels(models, 'anthropic/claude-opus-4-7'), model => model.ref), ['anthropic/claude-opus-5-5', 'anthropic/claude-opus-4-7', 'acp-claude/default'])
  assert.equal(offeredModels(undefined, undefined).length, 0)
})

// A Bot's settings say what its model really did (model-state.js): a failed switch and the
// model it stays on, a model that needs a sign-in, a switch not answered yet. A pick or a
// started request never reads as an answer.
test('the model hint is honest about a switch: failed and kept, needs a sign-in, not answered yet', () => {
  const { modelHint, modelStateLine } = module.exports
  const models = [
    { ref: 'deepseek/v4', provider: 'deepseek', providerName: 'DeepSeek', name: 'DeepSeek V4' },
    { ref: 'acp-codex/default', provider: 'acp-codex', providerName: 'Codex', name: 'Codex' },
  ]
  const roster = { ready: true, byId: {}, models }
  const bot = { id: 'b1', name: 'Ops', model: 'deepseek/v4', appliedModel: 'deepseek/v4' }
  const kept = code => ({ selected: 'deepseek/v4', previousModel: 'deepseek/v4', pending: false, answered: false, lastFailure: { code, ref: 'acp-codex/default', kept: 'deepseek/v4' } })
  assert.equal(modelHint(bot, roster, kept('MODEL_SWITCH_COMPACTION_FAILED')), 'Codex could not take over this conversation. This Bot stays on DeepSeek V4.')
  assert.equal(modelHint(bot, roster, kept('MODEL_ACCESS_REQUIRED')), 'Codex needs a sign-in before it can answer. This Bot stays on DeepSeek V4.')
  assert.equal(modelHint(bot, roster, kept('INVALID_REQUEST')), 'Codex did not answer. This Bot stays on DeepSeek V4.')
  const onCodex = { ...bot, model: 'acp-codex/default', appliedModel: 'acp-codex/default' }
  assert.equal(modelHint(onCodex, roster, { selected: 'acp-codex/default', previousModel: 'deepseek/v4', pending: true, answered: false }), 'Switching to this model. It has not answered yet.')
  assert.equal(modelHint(onCodex, roster, { selected: 'acp-codex/default', previousModel: null, pending: false, answered: false, lastFailure: { code: 'MODEL_ACCESS_REQUIRED', ref: 'acp-codex/default' } }), 'Codex needs a sign-in before it can answer.')
  // Nothing to say: the hint it always had.
  assert.equal(modelHint(bot, roster, { selected: 'deepseek/v4', previousModel: null, pending: false, answered: true }), 'Every message of this Bot runs on it.')
  assert.equal(modelHint(bot, roster, undefined), 'Every message of this Bot runs on it.')
  assert.equal(modelStateLine(undefined, roster), undefined)
  // A failure that did not go back (a provider error on a confirmed model) is not a switch line.
  assert.equal(modelStateLine({ selected: 'deepseek/v4', pending: false, lastFailure: { code: 'NETWORK', ref: 'deepseek/v4' } }, roster), undefined)
})

// The menu's connections (D-d): only what is set up, named by connection, then model, then
// level; the Bot's own model always shows, and says when it cannot run.
const lineup = [
  { ref: 'deepseek/flash', provider: 'deepseek', providerName: 'DeepSeek', name: 'DeepSeek Flash' },
  { ref: 'anthropic/claude-opus-5-5', provider: 'anthropic', providerName: 'Anthropic', via: 'key', name: 'Claude Opus 5.5' },
  { ref: 'openai/gpt-5.6', provider: 'openai', providerName: 'OpenAI', via: 'key', name: 'GPT-5.6', needsKey: true },
  { ref: 'openai-codex/gpt-5.6-sol', provider: 'openai-codex', providerName: 'ChatGPT', via: 'signin', name: '5.6 Sol', covered: true },
  { ref: 'openai-codex/gpt-5.6-luna', provider: 'openai-codex', providerName: 'ChatGPT', via: 'signin', name: '5.6 Luna', covered: true },
  { ref: 'acp-codex/gpt-5.6-sol', provider: 'acp-codex', providerName: 'Codex', via: 'cli', name: '5.6 Sol' },
  { ref: 'acp-claude/default', provider: 'acp-claude', providerName: 'Claude Code', via: 'cli', name: 'Claude Code', needsSignIn: true },
]

test('a connection is named by its brand and how it is connected', () => {
  const { connectionOf } = module.exports
  assert.deepEqual(lineup.map(connectionOf), ['DeepSeek', 'Anthropic · API key', 'OpenAI · API key', 'ChatGPT · sign-in', 'ChatGPT · sign-in', 'Codex', 'Claude Code'])
  assert.equal(connectionOf({ ref: 'custom/flash' }), 'custom')
})

test('the menu offers only what is set up, and never the same model twice', () => {
  const groups = refs => Array.from(groupModels(offeredModels(lineup, refs)), ([label, list]) => [label, Array.from(list, model => model.ref)])
  assert.deepEqual(groups('deepseek/flash'), [
    ['DeepSeek', ['deepseek/flash']],
    ['Anthropic · API key', ['anthropic/claude-opus-5-5']],
    ['Codex', ['acp-codex/gpt-5.6-sol']],
  ])
  // DSH's own ChatGPT sign-in is no connection: Codex serves that plan (D-a, D-c).
  // The Bot's own model stays, set up or not.
  assert.deepEqual(groups('acp-claude/default').at(-1), ['Claude Code', ['acp-claude/default']])
  // A Bot still on it sees only its own model there, marked as not available.
  assert.deepEqual(groups('openai-codex/gpt-5.6-sol')[2], ['ChatGPT · sign-in', ['openai-codex/gpt-5.6-sol']])
  assert.equal(module.exports.unavailableModel(lineup[3]), true)
  // One no longer served shows too, first, under its provider id.
  assert.deepEqual(groups('gone/model')[0], ['gone', ['gone/model']])
})

test('the Bot\'s model that cannot run is marked in the menu, its trigger and its hint', () => {
  const { modelHint } = module.exports
  const bot = { id: 'b1', name: 'Ops', model: 'acp-claude/default', appliedModel: 'acp-claude/default' }
  const roster = { ready: true, byId: { b1: bot }, models: lineup, defaultModel: 'deepseek/flash' }
  const props = { bot, roster, actions: { updateBot: () => Promise.resolve() }, run: promise => promise }
  const trigger = drawMenu(props)
  const button = nodes(trigger, node => node.props.className === 'bt-model-trigger')[0]
  assert.equal(button.props['data-missing'], '')
  assert.equal(nodes(button, node => node.props.className === 'bt-model-provider')[0].children[0], 'Claude Code · not available')
  assert.equal(modelHint(bot, roster, undefined), 'Claude Code needs a sign-in before it can answer.')
  menuOpen = true
  try {
    const open = drawMenu(props)
    const steps = nodes(open, node => node.type?.name === 'ModelSteps')[0]
    // Step 1: the set-up connections, and the Bot's own one, which says it cannot run.
    const first = nodes(steps.type(steps.props), node => node.props.role === 'menuitem' && node.props['aria-haspopup'] === 'menu')
    const hint = row => nodes(row, node => node.props.className === 'bt-menu-hint')[0]?.children[0]
    const label = row => nodes(row, node => node.props.className === 'bt-menu-label')[0].children[0]
    assert.deepEqual(first.map(row => [label(row), hint(row) ?? null]), [
      ['DeepSeek', null], ['Anthropic · API key', null], ['Codex', null], ['Claude Code', 'Default · Not available'],
    ])
    assert.equal(first.at(-1).props['aria-label'], 'Claude Code, current model Default · Not available')
    // Step 2: that connection's models; the agent's own default is no second "Claude Code".
    const second = steps.type({ ...steps.props, view: { step: 'models', provider: 'acp-claude' } })
    const rows = nodes(second, node => node.props.role === 'menuitemradio')
    assert.deepEqual(rows.map(row => [row.props.title, label(row), hint(row) ?? null]), [['acp-claude/default', 'Default', 'Not available']])
    assert.equal(rows[0].props['aria-label'], 'Default · Not available')
    const deepseek = nodes(steps.type({ ...steps.props, view: { step: 'models', provider: 'deepseek' } }), node => node.props.role === 'menuitemradio')
    assert.deepEqual(deepseek.map(row => [row.props.title, hint(row)]), [['deepseek/flash', 'Default']])
  } finally {
    menuOpen = false
  }
  // Set up: the trigger names the connection, nothing is marked.
  const fine = { ...bot, model: 'anthropic/claude-opus-5-5', appliedModel: 'anthropic/claude-opus-5-5' }
  const ok = nodes(drawMenu({ ...props, bot: fine, roster: { ...roster, byId: { b1: fine } } }), node => node.props.className === 'bt-model-trigger')[0]
  assert.equal(ok.props['data-missing'], undefined)
  assert.equal(nodes(ok, node => node.props.className === 'bt-model-provider')[0].children[0], 'Anthropic · API key')
})

test('the dock offers only what is set up, and a missing sign-in never asks for a key', () => {
  const buttons = tree => nodes(tree, node => node.type === 'button').map(button => button.children[0])
  // Lost model: the choices are the set-up connections only.
  const { tree } = dock(lineup, { model: 'gone/flash', harness: false })
  assert.deepEqual(nodes(tree, node => node.props.className === 'bt-model-choice-group').map(group => group.props['aria-label']), ['DeepSeek', 'Anthropic · API key', 'Codex'])
  // Only sign-ins missing, no key missing: setup choices, no key card.
  const signedOut = lineup.filter(model => model.needsSignIn)
  const bot = { id: 'chief', name: 'Omni' }
  const bare = ModelChoiceDock({ sessionId: bot.id, useRoster: select => select({ ready: true, byId: { chief: bot }, models: signedOut }), actions: { setProviderKey: () => {}, openHarnessOnboarding: () => {} } })
  assert.equal(nodes(bare, node => node.props.model !== undefined).length, 0)
  assert.deepEqual(buttons(bare), ['Connect an AI: ChatGPT, Claude, Kimi or an API key', 'Enter a DeepSeek API key'])
})

// The menu goes in steps (connection, then model, then level): the connections set up with the
// current one marked, a connection's models, and a model's levels when it has them.
const levels = { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' }
const cascade = [
  { ref: 'deepseek/flash', provider: 'deepseek', providerName: 'DeepSeek', name: 'DeepSeek Flash' },
  { ref: 'deepseek/pro', provider: 'deepseek', providerName: 'DeepSeek', name: 'DeepSeek Pro', reasoning: levels },
  { ref: 'acp-codex/default', id: 'default', provider: 'acp-codex', providerName: 'Codex', via: 'cli', name: 'Codex', resolvesTo: '6.1 Sol', reasoning: levels },
  { ref: 'acp-codex/gpt-6.1-sol', id: 'gpt-6.1-sol', provider: 'acp-codex', providerName: 'Codex', via: 'cli', name: '6.1 Sol' },
]

function openMenu({ bot = { id: 'b1', name: 'Ops', model: 'acp-codex/default', appliedModel: 'acp-codex/default', effort: 'high' }, chat = false, onPick, onPickEffort } = {}) {
  const updates = []
  const chosen = []
  const actions = {
    updateBot: (id, patch) => { updates.push([id, { ...patch }]); return Promise.resolve() },
    chooseModelInChat: (id, ref, patch) => { chosen.push([id, ref, { ...patch }]); return Promise.resolve() },
    openHarnessSettings: () => {},
  }
  const roster = { ready: true, byId: { [bot.id]: bot }, models: cascade, defaultModel: 'deepseek/flash' }
  menuOpen = true
  try {
    const open = drawMenu({ bot, roster, actions, run: promise => promise, chat, onPick, onPickEffort })
    const steps = nodes(open, node => node.type?.name === 'ModelSteps')[0]
    const step = view => steps.type({ ...steps.props, view: view ?? steps.props.view })
    return { steps, step, updates, chosen, open }
  } finally {
    menuOpen = false
  }
}
const labelOf = row => nodes(row, node => node.props.className === 'bt-menu-label')[0].children[0]
const hintOf = row => nodes(row, node => node.props.className === 'bt-menu-hint')[0]?.children[0] ?? null

test('step 1 lists the connections, marks the current one with its model and level, and ends on the providers', () => {
  const { step, steps } = openMenu()
  assert.equal(steps.props.view.step, 'connections')
  const tree = step()
  const rows = nodes(tree, node => node.type === 'button')
  assert.deepEqual(rows.map(row => [labelOf(row), hintOf(row)]), [
    ['DeepSeek', null], ['Codex', 'Default (6.1 Sol) · High'], ['Models and providers…', null],
  ])
  assert.deepEqual(rows.slice(0, 2).map(row => [row.props.role, row.props['aria-haspopup'], row.props['data-current'] ?? null]), [['menuitem', 'menu', null], ['menuitem', 'menu', '']])
  assert.equal(rows[1].props['aria-label'], 'Codex, current model Default (6.1 Sol) · High')
  // The current connection carries the tick; no model row and no level row on this step.
  assert.deepEqual(rows.slice(0, 2).map(row => nodes(row, node => node.type?.name === 'Tick')[0].props.on), [false, true])
  assert.equal(nodes(tree, node => node.props.role === 'menuitemradio').length, 0)
})

test('step 2 is one connection\'s models with a way back; a model with levels says another step follows', () => {
  const { step } = openMenu()
  const tree = step({ step: 'models', provider: 'acp-codex' })
  const [backRow] = nodes(tree, node => node.props.className === 'bt-model-back')
  assert.equal(backRow.props['aria-label'], 'Back to connections')
  assert.equal(labelOf(backRow), 'Codex')
  const rows = nodes(tree, node => node.props.role === 'menuitemradio')
  // The agent's own default names what it runs on, not "Codex" under "Codex".
  assert.deepEqual(rows.map(row => [labelOf(row), row.props['aria-checked'], row.props['aria-haspopup'] ?? null]), [
    ['Default (6.1 Sol)', true, 'menu'], ['6.1 Sol', false, null],
  ])
  // Without the catalog's word on it, it is just "Default".
  const { modelLabel } = module.exports
  assert.equal(modelLabel({ ...cascade[2], resolvesTo: undefined }), 'Default')
  assert.equal(modelLabel({ ref: 'acp-claude/default', id: 'default', provider: 'acp-claude', providerName: 'Claude Code', name: 'Default (recommended)' }), 'Default (recommended)')
  assert.equal(modelLabel(cascade[0]), 'DeepSeek Flash')
  // An unknown connection (a refreshed list dropped it) falls back to step 1.
  assert.equal(nodes(step({ step: 'models', provider: 'gone' }), node => node.props['aria-label'] === 'Back to connections').length, 0)
})

test('step 3 is a model\'s levels with Default first; the Bot\'s level is ticked only on its own model', () => {
  const { step } = openMenu()
  const own = step({ step: 'levels', provider: 'acp-codex', ref: 'acp-codex/default' })
  assert.equal(nodes(own, node => node.props.className === 'bt-model-back')[0].props['aria-label'], 'Back to Codex')
  const rows = nodes(own, node => node.props.role === 'menuitemradio')
  assert.deepEqual(rows.map(row => [labelOf(row), row.props['aria-checked']]), [['Default', false], ['Low', false], ['High', true]])
  const other = nodes(step({ step: 'levels', provider: 'deepseek', ref: 'deepseek/pro' }), node => node.props.role === 'menuitemradio')
  assert.deepEqual(other.map(row => row.props['aria-checked']), [false, false, false])
  // A model with no levels has no level step: its connection's models show instead.
  assert.ok(nodes(step({ step: 'levels', provider: 'deepseek', ref: 'deepseek/flash' }), node => node.props['aria-label'] === 'Back to connections').length === 1)
})

test('a model without levels applies at once; a level applies with its model in one update', async () => {
  const { steps, updates } = openMenu()
  steps.props.onModel(cascade[0])
  // A model with levels opens its level step, saving nothing yet.
  steps.props.onModel(cascade[1])
  await Promise.resolve()
  assert.deepEqual(updates, [['b1', { model: 'deepseek/flash' }]])
  steps.props.onLevel(cascade[1], 'high')
  steps.props.onLevel(cascade[1], undefined)
  // On the Bot's own model a level changes the level only, and the one it runs on changes nothing.
  steps.props.onLevel(cascade[2], 'low')
  steps.props.onLevel(cascade[2], 'high')
  assert.deepEqual(updates.slice(1), [
    ['b1', { model: 'deepseek/pro', effort: 'high' }],
    ['b1', { model: 'deepseek/pro', effort: null }],
    ['b1', { effort: 'low' }],
  ])
})

test('in a Bot\'s chat the level goes with the model through the chat pick, and a new Bot keeps both', async () => {
  const inChat = openMenu({ chat: true })
  inChat.steps.props.onLevel(cascade[1], 'low')
  assert.deepEqual(inChat.chosen, [['b1', 'deepseek/pro', { effort: 'low' }]])
  const picks = []
  const fresh = openMenu({ bot: { id: 'new-bot', name: 'New' }, onPick: (ref) => { picks.push(['model', ref]) }, onPickEffort: (effort) => { picks.push(['effort', effort]) } })
  fresh.steps.props.onLevel(cascade[1], 'high')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(picks, [['model', 'deepseek/pro'], ['effort', 'high']])
  assert.deepEqual(fresh.updates, [])
})

test('a Bot kept on a plan route until its CLI can take it says so, not that its model is unavailable (#868)', () => {
  const { modelHint } = module.exports
  const bot = { id: 'b1', name: 'Ops', model: 'openai-codex/gpt-5.6-sol', appliedModel: 'openai-codex/gpt-5.6-sol' }
  const roster = { ready: true, byId: { b1: bot }, models: lineup, defaultModel: 'deepseek/flash' }
  const waiting = reason => ({ ...roster, subscriptionWaiting: { 'openai-codex': { to: 'acp-codex', cli: 'Codex', reason } } })
  assert.equal(modelHint(bot, roster, undefined), 'This model is not available now. Pick another one.')
  assert.equal(modelHint(bot, waiting('sign-in'), undefined), 'This Bot stays on 5.6 Sol until Codex is signed in.')
  assert.equal(modelHint(bot, waiting('cli'), undefined), 'This Bot stays on 5.6 Sol until Codex is ready.')
  assert.equal(modelHint(bot, waiting('checking'), undefined), 'This Bot stays on 5.6 Sol until Codex is ready.')
  // Another route's wait says nothing about this Bot.
  assert.equal(modelHint(bot, { ...roster, subscriptionWaiting: { anthropic: { to: 'acp-claude', cli: 'Claude Code', reason: 'sign-in' } } }, undefined), 'This model is not available now. Pick another one.')
})
