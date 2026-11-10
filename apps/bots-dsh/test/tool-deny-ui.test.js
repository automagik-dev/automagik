import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))

// The Bot settings form renders on a minimal React stand-in, as advanced-ui.test.js does:
// this test reads the element tree and exercises the field's own save path.
const compiled = await build({
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

function hooks() {
  const states = []
  let cursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: Symbol('Fragment'),
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = { current: initial }
      return states[index]
    },
    useEffect() {},
    useLayoutEffect() {},
    useCallback: fn => fn,
    useMemo: make => make(),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useId: () => 'id',
  }
  return { react, render: (component) => { cursor = 0; return component() } }
}

function load(react) {
  const module = { exports: {} }
  runInNewContext(compiled.outputFiles[0].text, {
    module, exports: module.exports, URL, URLSearchParams, setTimeout, clearTimeout,
    console, require: name => (name === 'react' ? react : name === 'react-dom' ? { createPortal: node => node } : {}),
  })
  return module.exports
}

const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const match = find(child, predicate)
    if (match) return match
  }
  return null
}

const fieldOf = (tree, InlineText) => find(tree, node => node.type === InlineText && node.props?.label === 'Denied tools')

test('the Bot settings Tools card shows and saves an edited deny list', () => {
  const form = hooks()
  const { BotSettingsForm, InlineText } = load(form.react)
  const updates = []
  const actions = {
    updateBot: (id, patch) => { updates.push([id, patch]); return Promise.resolve({}) },
    refreshModels: () => Promise.resolve(),
  }
  const bot = { id: 'b2', name: 'Writer', role: 'writer', instructions: '', denyTools: ['bash', 'write'] }
  const roster = { mainBotId: 'm1', mainBotIds: ['m1'], memory: false }
  const render = (shown) => form.render(() => BotSettingsForm({ bot: shown, roster, actions, run: promise => promise }))
  const tree = render(bot)
  assert.ok(find(tree, node => node.props?.title === 'Tools'), 'the Tools card is rendered')
  const field = fieldOf(tree, InlineText)
  assert.ok(field, 'the deny list field is rendered')
  assert.equal(field.props.value, 'bash\nwrite', 'the current list is shown, one tool per line')

  // A Bot with no list starts on an empty field: empty means every tool is allowed.
  assert.equal(fieldOf(render({ ...bot, denyTools: undefined }), InlineText).props.value, '')

  // The field's own edit path: type (a comma and a newline both separate), then blur commits.
  // A second load gives the same component its own hook slots, as a separate tree would.
  const editing = hooks()
  const editingModule = load(editing.react)
  let input = editing.render(() => editingModule.InlineText(field.props))
  find(input, node => node.type === 'textarea').props.onChange({ target: { value: 'bash, read\nwrite' } })
  input = editing.render(() => editingModule.InlineText(field.props))
  const area = find(input, node => node.type === 'textarea')
  assert.equal(area.props.value, 'bash, read\nwrite', 'the edit is what the field shows before blur')
  area.props.onBlur()
  // The patch crosses the vm realm, so its array is spread into this one before asserting.
  assert.equal(updates.at(-1)[0], 'b2')
  assert.deepEqual([...updates.at(-1)[1].denyTools], ['bash', 'read', 'write'])

  // Emptying the field clears the list: the user path sends null, which the host maps to
  // "every tool allowed" (cleanDenyTools(null)).
  const clearing = hooks()
  const clearingModule = load(clearing.react)
  const clearProps = { ...field.props, value: 'bash\nwrite' }
  find(clearing.render(() => clearingModule.InlineText(clearProps)), node => node.type === 'textarea')
    .props.onChange({ target: { value: '  ' } })
  find(clearing.render(() => clearingModule.InlineText(clearProps)), node => node.type === 'textarea').props.onBlur()
  assert.equal(updates.at(-1)[0], 'b2')
  assert.equal(updates.at(-1)[1].denyTools, null, 'empty sends null, the host clear')
})

test('the shared team action sends the deny list through the user update-bot call', async () => {
  const { teamActions } = load(hooks().react)
  const calls = []
  const actions = teamActions({
    call: async (endpoint, payload) => { calls.push({ endpoint, payload }); return {} },
    after: value => value,
  })
  await actions.updateBot('b2', { denyTools: ['bash', 'read'] })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].endpoint, 'update-bot')
  assert.equal(calls[0].payload.id, 'b2')
  assert.deepEqual([...calls[0].payload.denyTools], ['bash', 'read'])
})
