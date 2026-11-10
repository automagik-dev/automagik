// Acceptance for #830: the person can see and edit an existing Bot's tool deny list from
// Bot Settings, through the user path that has no acting Bot. These rows are written from
// the acceptance, not from the implementation: they name the route, the field, the team
// state and the committed bundles the feature promises, and they exercise the field's own
// edit/save path rather than calling a helper the feature added.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { apply } from '../index.js'
import { ROUTE } from '../src/host/constants.js'
import { fakeContext } from './fake-ctx.js'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const LOCALE = join(PLUGIN, '..', 'locale-pt-br-dsh')
const HINT = 'Exact tool names, one per line or comma separated, case-sensitive. Empty allows every tool.'
const HINT_KEY = HINT
const localeDictionary = () => JSON.parse(readFileSync(join(LOCALE, 'src/client/locales/pt-BR/omni-ui.json'), 'utf8'))

// The client half, bundled the way the app bundles it, with React left to the browser
// shell: the test renders the element tree on a small stand-in and reads the controls back.
const clientBundle = await build({
  stdin: {
    contents: "export { BotSettingsForm, InlineText } from './src/client/bot-settings.js'\nexport { teamActions } from './src/client/team-actions.js'",
    resolveDir: PLUGIN,
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  external: ['react', 'react-dom'],
  logLevel: 'silent',
})

function reactStandIn() {
  const slots = []
  let cursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: Symbol('Fragment'),
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useEffect() {},
    useLayoutEffect() {},
    useCallback: fn => fn,
    useMemo: make => make(),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useId: () => 'id',
  }
  return {
    react,
    render: (component) => { cursor = 0; return component() },
  }
}

function loadClient(react) {
  const module = { exports: {} }
  runInNewContext(clientBundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console,
    require: name => (name === 'react' ? react : name === 'react-dom' ? { createPortal: node => node } : {}),
  })
  return module.exports
}

const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = find(child, predicate)
    if (found) return found
  }
  return null
}

const fieldIn = (tree, InlineText) => find(tree, node => node.type === InlineText && node.props?.label === 'Denied tools')
const areaIn = tree => find(tree, node => node.type === 'textarea' && node.props?.['aria-label'] === 'Denied tools')

// ---- host harness: a real plugin over a temporary team home, and the real POST route ----

const SERVED = ['bash', 'read', 'write', 'edit', 'omni_send', 'omni_messages']

function starterTeam() {
  return {
    version: 1,
    revision: 1,
    mainBotIds: ['main-bot'],
    bots: {
      'main-bot': {
        id: 'main-bot', sessionId: 'main-bot', name: 'Lead', role: 'leads the team', instructions: 'Lead.', createdAt: 1, denyTools: ['bash'],
      },
      'writer-bot': {
        id: 'writer-bot', sessionId: 'writer-bot', name: 'Writer', role: 'writes', instructions: 'Write.', createdAt: 2, denyTools: ['bash', 'omni_send'],
      },
    },
    rooms: {},
    exchanges: [],
    exchangeTurns: {},
    questions: {},
  }
}

function startHost(t) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-deny-acceptance-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(starterTeam()))
  const ctx = fakeContext()
  const restrictions = []
  ctx.tools.schemas = () => SERVED.map(name => ({ name }))
  ctx.tools.view = () => ({ restrictableNames: new Set(SERVED), knownNames: new Set(SERVED) })
  Object.assign(ctx, {
    llm: {
      listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
      listModels: async () => [{ id: 'v4' }],
      resolveModelInfo: async () => ({}),
    },
    sessionController: {
      resolveAgent: async sessionId => {
        const agent = {
          session: { id: sessionId, seq: 1 },
          ctx: {
            tools: {
              restrict: ({ deny }) => {
                restrictions.push({ sessionId, deny: [...deny] })
                return () => {}
              },
            },
          },
        }
        return { agent }
      },
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {}, get: () => undefined },
    workspaceRegistry: {
      get: () => undefined,
      resolveByPath: async () => undefined,
      create: async path => ({ id: 'workspace', path }),
      archiveSession: async () => {},
    },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    if (options.path === ROUTE && options.methods.includes('POST')) route = options
    return register(options)
  }
  apply(ctx, { home })
  const rt = ctx.provided.get('omniTeam')
  assert.ok(rt, 'the plugin provided its runtime')
  assert.ok(route, `the plugin registered POST ${ROUTE}`)
  const call = async (endpoint, payload) => {
    const request = new Request('http://localhost/api/omni-ui', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload }),
    })
    return (await route.fetch(request)).json()
  }
  const stored = () => JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  return { ctx, home, rt, route, call, stored, restrictions }
}

const storedBot = (file, id) => file.bots?.[id]

// ---- A: the Settings form ----

test('A: Bot Settings shows an existing Bot deny list and saves add, replace and clear', () => {
  const form = reactStandIn()
  const { BotSettingsForm, InlineText } = loadClient(form.react)
  let record = {
    id: 'writer-bot', name: 'Writer', role: 'writes', instructions: 'Write.', denyTools: ['bash', 'omni_send'],
  }
  const roster = { mainBotId: 'main-bot', mainBotIds: ['main-bot'], memory: false }
  const patches = []
  const actions = {
    updateBot(id, patch) {
      patches.push({ id, patch })
      if (patch.denyTools === null) record = { ...record, denyTools: undefined }
      else if (patch.denyTools !== undefined) record = { ...record, denyTools: [...patch.denyTools] }
      return Promise.resolve(record)
    },
    refreshModels: () => Promise.resolve(),
  }
  const render = () => form.render(() => BotSettingsForm({ bot: record, roster, actions, run: value => value }))

  let tree = render()
  assert.ok(find(tree, node => node.props?.title === 'Tools'), 'the Tools card is shown for an existing Bot')
  let field = fieldIn(tree, InlineText)
  assert.ok(field, 'the Denied tools field is shown')
  assert.equal(field.props.label, 'Denied tools')
  assert.equal(field.props.multiline, true, 'the field edits several names')
  assert.equal(field.props.value, 'bash\nomni_send', 'the current list shows one exact name per line')

  // Edit through the field's own onChange/onBlur save path, as a person typing and leaving.
  const edit = (props, text) => {
    const editor = reactStandIn()
    const { InlineText: EditorText } = loadClient(editor.react)
    let view = editor.render(() => EditorText(props))
    let area = areaIn(view)
    assert.ok(area, 'the field renders its textarea')
    area.props.onChange({ target: { value: text } })
    view = editor.render(() => EditorText(props))
    area = areaIn(view)
    assert.equal(area.props.value, text, 'the field shows the edit before it is saved')
    area.props.onBlur()
  }

  // Add a name: a newline and a comma both separate, and the patch is the cleaned list.
  edit(field.props, 'bash, omni_send\nwrite')
  assert.equal(patches.length, 1)
  assert.equal(patches[0].id, 'writer-bot')
  assert.deepEqual([...patches[0].patch.denyTools], ['bash', 'omni_send', 'write'])
  assert.deepEqual(Object.keys(patches[0].patch), ['denyTools'], 'the field sends only the field it edits')
  tree = render()
  field = fieldIn(tree, InlineText)
  assert.equal(field.props.value, 'bash\nomni_send\nwrite', 'the saved list is what the form shows again')

  // Replace the list.
  edit(field.props, 'read, write')
  assert.equal(patches.length, 2)
  assert.deepEqual([...patches[1].patch.denyTools], ['read', 'write'])
  tree = render()
  field = fieldIn(tree, InlineText)
  assert.equal(field.props.value, 'read\nwrite', 'the replaced list is what the form shows again')

  // Clear it: an empty field is the user path's null, which allows every tool.
  edit(field.props, '  \n , ')
  assert.equal(patches.length, 3)
  assert.equal(patches[2].patch.denyTools, null, 'an empty field sends null')
  tree = render()
  field = fieldIn(tree, InlineText)
  assert.equal(field.props.value, '', 'a cleared list shows an empty field')
  assert.equal(record.denyTools, undefined)
})

// ---- B: the client payload and the user route ----

test('B: teamActions.updateBot sends denyTools on update-bot with no actorId', async () => {
  const { teamActions } = loadClient(reactStandIn().react)
  const calls = []
  const actions = teamActions({
    call: async (endpoint, payload) => { calls.push({ endpoint, payload }); return {} },
    after: value => value,
  })
  await actions.updateBot('writer-bot', { denyTools: ['bash', 'read'] })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].endpoint, 'update-bot')
  assert.equal(calls[0].payload.id, 'writer-bot')
  assert.deepEqual([...calls[0].payload.denyTools], ['bash', 'read'])
  assert.equal(Object.hasOwn(calls[0].payload, 'actorId'), false, 'the user path carries no acting Bot')
  assert.deepEqual(Object.keys(calls[0].payload).sort(), ['denyTools', 'id'])
})

test('B: the no-actorId POST route persists add, replace and clear, and refuses an unknown name', async (t) => {
  const host = startHost(t)
  const seen = []
  const updateBot = host.rt.updateBot
  host.rt.updateBot = async (...args) => { seen.push(args); return updateBot(...args) }

  // Add a name to the existing list: the response is the updated Bot record.
  const added = await host.call('update-bot', { id: 'writer-bot', denyTools: ['bash', 'omni_send', 'read'] })
  assert.equal(added.ok, true)
  assert.deepEqual(added.value.denyTools, ['bash', 'omni_send', 'read'])
  assert.equal(seen.length, 1)
  assert.equal(seen[0].length, 2, 'the channel calls rt.updateBot(id, body) with no actorId')
  assert.equal(seen[0][0], 'writer-bot')
  assert.equal(Object.hasOwn(seen[0][1], 'actorId'), false)
  let state = await host.call('state', {})
  assert.equal(state.ok, true)
  let shown = state.value.bots.find(bot => bot.id === 'writer-bot')
  assert.deepEqual(shown.denyTools, ['bash', 'omni_send', 'read'])
  assert.deepEqual(storedBot(host.stored(), 'writer-bot').denyTools, ['bash', 'omni_send', 'read'])

  // Replace it: the host trims, drops empty entries and deduplicates exact names.
  const replaced = await host.call('update-bot', { id: 'writer-bot', denyTools: [' write ', 'write', '', ' read '] })
  assert.equal(replaced.ok, true)
  assert.deepEqual(replaced.value.denyTools, ['write', 'read'])
  state = await host.call('state', {})
  shown = state.value.bots.find(bot => bot.id === 'writer-bot')
  assert.deepEqual(shown.denyTools, ['write', 'read'])
  assert.deepEqual(storedBot(host.stored(), 'writer-bot').denyTools, ['write', 'read'])

  // A name this DSH does not serve refuses the update and leaves the list as it was.
  const refused = await host.call('update-bot', { id: 'writer-bot', denyTools: ['read', 'bashh'] })
  assert.equal(refused.ok, false)
  assert.match(refused.error.message, /bashh is not a tool this DSH serves/)
  state = await host.call('state', {})
  assert.deepEqual(state.value.bots.find(bot => bot.id === 'writer-bot').denyTools, ['write', 'read'])
  assert.deepEqual(storedBot(host.stored(), 'writer-bot').denyTools, ['write', 'read'])

  // null clears the list.
  const cleared = await host.call('update-bot', { id: 'writer-bot', denyTools: null })
  assert.equal(cleared.ok, true)
  assert.equal(cleared.value.denyTools, undefined)
  state = await host.call('state', {})
  assert.equal(state.value.bots.find(bot => bot.id === 'writer-bot').denyTools, undefined)
  assert.equal(storedBot(host.stored(), 'writer-bot').denyTools, undefined)

  // An empty list clears it too.
  await host.call('update-bot', { id: 'writer-bot', denyTools: ['bash'] })
  const emptied = await host.call('update-bot', { id: 'writer-bot', denyTools: [] })
  assert.equal(emptied.ok, true)
  assert.equal(emptied.value.denyTools, undefined)
  state = await host.call('state', {})
  assert.equal(state.value.bots.find(bot => bot.id === 'writer-bot').denyTools, undefined)
  assert.equal(storedBot(host.stored(), 'writer-bot').denyTools, undefined)
})

// ---- C: the guard against Bots is untouched ----

test('C: a Bot and the Main Bot are refused through update_bot, and nothing is written', async (t) => {
  const host = startHost(t)
  await host.rt.load()
  const before = readFileSync(join(host.home, 'state.json'))
  const beforeStat = statSync(join(host.home, 'state.json'))
  const seen = []
  const updateBot = host.rt.updateBot
  host.rt.updateBot = async (...args) => { seen.push(args); return updateBot(...args) }
  let saves = 0
  const save = host.rt.save
  host.rt.save = (...args) => { saves += 1; return save(...args) }
  const tool = host.ctx.registeredTools.get('update_bot')
  assert.ok(tool, 'update_bot is registered')
  const exec = id => ({ agent: { id } })

  // A regular Bot cannot widen or clear its own list.
  const regular = await tool.execute({ deny_tools: ['read'] }, exec('writer-bot'))
  assert.match(regular, /^Could not update the Bot: Only the user can set what Writer may use/)
  assert.equal(seen.at(-1)[2], 'writer-bot', 'the tool passes the calling Bot as actorId')
  assert.deepEqual(seen.at(-1)[1].denyTools, ['read'])

  // A Main Bot cannot set another Bot's list either, though it may change other fields.
  const other = await tool.execute({ bot: 'Writer', denyTools: ['read'] }, exec('main-bot'))
  assert.match(other, /^Could not update the Bot: Only the user can set what Writer may use/)
  assert.equal(seen.at(-1)[2], 'main-bot')
  assert.deepEqual(seen.at(-1)[1].denyTools, ['read'])

  // Nor its own.
  const own = await tool.execute({ denyTools: [] }, exec('main-bot'))
  assert.match(own, /^Could not update the Bot: Only the user can set what Lead may use/)
  assert.equal(seen.at(-1)[2], 'main-bot')

  assert.deepEqual(host.rt.botOf('writer-bot').denyTools, ['bash', 'omni_send'], 'the stored list is unchanged')
  assert.deepEqual(host.rt.botOf('main-bot').denyTools, ['bash'])
  assert.equal(saves, 0, 'a refused update never reaches save()')
  assert.equal(readFileSync(join(host.home, 'state.json')).equals(before), true, 'state.json is byte-for-byte unchanged')
  assert.equal(statSync(join(host.home, 'state.json')).mtimeMs, beforeStat.mtimeMs, 'state.json was not written')
})

// ---- D: both committed bundles ----

test('D: both committed client bundles are current and carry the denial UI and its pt-BR text', () => {
  for (const app of [PLUGIN, LOCALE]) {
    const check = spawnSync(process.execPath, ['scripts/build-client.mjs', '--check'], { cwd: app, encoding: 'utf8' })
    assert.equal(check.status, 0, `${app}: ${check.stderr || check.stdout}`)
  }
  const botsBundle = readFileSync(join(PLUGIN, 'client.js'), 'utf8')
  for (const text of ['Denied tools', HINT, 'denyTools']) {
    assert.ok(botsBundle.includes(text), `apps/bots-dsh/client.js carries ${JSON.stringify(text)}`)
  }
  const dictionary = localeDictionary()
  const localeBundle = readFileSync(join(LOCALE, 'client.js'), 'utf8')
  for (const key of ['Tools', 'Denied tools', HINT_KEY]) {
    assert.equal(typeof dictionary[key], 'string', `${key} is in the pt-BR dictionary`)
    assert.ok(localeBundle.includes(`${JSON.stringify(key)}: ${JSON.stringify(dictionary[key])}`), `apps/locale-pt-br-dsh/client.js carries the ${JSON.stringify(key)} entry`)
  }
})

// ---- E: the pt-BR locale ----

test('E: the pt-BR locale translates the Tools strings, not leaves them in English', () => {
  const dictionary = localeDictionary()
  assert.equal(dictionary.Tools, 'Ferramentas')
  assert.equal(dictionary['Denied tools'], 'Ferramentas bloqueadas')
  const hint = dictionary[HINT_KEY]
  assert.equal(typeof hint, 'string', 'the hint is translated')
  assert.notEqual(hint, HINT, 'the hint is not the English text')
  assert.match(hint, /ferramenta/i)
  assert.match(hint, /vírgula/i)
  assert.match(hint, /vazi/i)
  const bundle = readFileSync(join(LOCALE, 'client.js'), 'utf8')
  for (const [key, value] of [['Tools', 'Ferramentas'], ['Denied tools', 'Ferramentas bloqueadas'], [HINT_KEY, hint]]) {
    assert.ok(bundle.includes(`${JSON.stringify(key)}: ${JSON.stringify(value)}`), `the locale bundle carries ${JSON.stringify(key)}`)
  }
  assert.equal(bundle.includes(`${JSON.stringify(HINT_KEY)}: ${JSON.stringify(HINT)}`), false, 'the bundle does not fall back to the English hint')
})
