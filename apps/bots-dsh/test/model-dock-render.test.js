// The no-model dock rendered by the React DSH ships (issue #153), not a createElement stub:
// a stub hands `ref` to the component like any prop, while React keeps it for itself, so a
// model route passed as `ref` only fails here (React error 290, a string ref with no owner).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'

const plugin = dirname(dirname(fileURLToPath(import.meta.url)))
const harness = process.env.DSH_HARNESS
const require = createRequire(join(harness, 'package.json'))
const { JSDOM } = require('jsdom')
// DSH ships React as module-loader seeds, not an npm peer. Evaluate only the published seed
// prefix, never its application bootstrap or network operations.
const assets = join(harness, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
const frontend = readFileSync(join(assets, readdirSync(assets).find(name => /^index-.*\.js$/.test(name))), 'utf8')
const seed = /function (\w+)\(\)\{return\{react:[\s\S]*?\}\}/.exec(frontend)
assert.ok(seed, 'the declared native harness supplies its React seed factory')
const seedsBuild = await build({ stdin: { contents: `${frontend.slice(0, seed.index + seed[0].length)}; globalThis.nativeSeeds = ${seed[1]}();`, resolveDir: assets }, bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' })
const seedDom = new JSDOM('<!doctype html><html><body></body></html>')
const seedContext = { window: seedDom.window, document: seedDom.window.document, navigator: seedDom.window.navigator, MutationObserver: seedDom.window.MutationObserver, fetch: async () => { throw new Error('seed bootstrap must not fetch') }, console, setTimeout, clearTimeout, performance, TextEncoder, TextDecoder }
runInNewContext(seedsBuild.outputFiles[0].text, seedContext)
const nativeRequire = name => seedContext.nativeSeeds[name] ?? require(name)
const React = nativeRequire('react')
const { createRoot } = nativeRequire('react-dom/client')
const { flushSync } = nativeRequire('react-dom')

const { outputFiles } = await build({
  entryPoints: [join(plugin, 'src/client/model-menu.js')],
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

const tick = () => new Promise(resolve => setTimeout(resolve, 10))

// An error boundary stands in for the host's slot: it records what the dock threw.
class Slot extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { this.props.onError(error) }
  render() { return this.state.error ? null : this.props.children }
}

async function renderDock(t, { models, defaultModel = models[0]?.ref }) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const globals = ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'MutationObserver']
  const saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key))
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  const module = { exports: {} }
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports, require: nativeRequire,
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout,
    console, setTimeout, clearTimeout, Promise, Map, Set,
  })
  const errors = []
  const consoleError = console.error
  console.error = (...args) => { errors.push(args.map(String).join(' ')) }
  const picked = []
  const bot = { id: 'chief', name: 'Omni' }
  const roster = { ready: true, byId: { chief: bot }, models, defaultModel }
  const actions = { updateBot: (id, patch) => { picked.push([id, patch.model]); return Promise.resolve() }, refreshModels: () => {} }
  const caught = []
  const root = createRoot(dom.window.document.getElementById('root'))
  flushSync(() => root.render(React.createElement(Slot, { onError: error => caught.push(error) },
    React.createElement(module.exports.ModelChoiceDock, { sessionId: bot.id, useRoster: select => select(roster), actions }))))
  await tick()
  t.after(() => {
    flushSync(() => root.unmount())
    console.error = consoleError
    dom.window.close()
    globals.forEach((key, index) => saved[index] ? Object.defineProperty(globalThis, key, saved[index]) : delete globalThis[key])
  })
  return { document: dom.window.document, caught, errors, picked }
}

const models = [
  { ref: 'deepseek-official/deepseek-flash', provider: 'deepseek-official', providerName: 'DeepSeek', name: 'DeepSeek Flash' },
  { ref: 'local/flash', provider: 'local', providerName: 'Ollama', name: 'DeepSeek Flash' },
]

test('a Bot with no model renders its dock in React: the offered model, Start and change', async (t) => {
  const { document, caught, errors, picked } = await renderDock(t, { models })
  assert.deepEqual(caught.map(error => error.message), [], 'the dock renders without crashing its slot')
  assert.deepEqual(errors.filter(line => /#290|string ref/i.test(line)), [], 'React reports no string ref')
  const dock = document.querySelector('.bt-model-dock')
  assert.ok(dock, 'the no-model dock is on screen')
  assert.match(dock.querySelector('.bt-bubble').textContent, /Say when, and I'll start/)
  // The line names the model the Bot would start on: DSH's default.
  assert.equal(dock.querySelector('.bt-model-line-text').textContent, 'Using DeepSeek Flash · DeepSeek')
  const change = dock.querySelector('.bt-model-line .bt-model-change')
  assert.ok(change, 'the line has its "change" link')
  // "change" opens the model menu on the offered model; picking another gives the Bot that one.
  flushSync(() => change.click())
  await tick()
  const rows = [...document.body.querySelectorAll('.bt-model-menu [role="menuitemradio"]')]
  assert.deepEqual(rows.filter(row => row.getAttribute('aria-checked') === 'true').map(row => row.title), ['deepseek-official/deepseek-flash'])
  const company = document.querySelector('.bt-model-field select')
  flushSync(() => { company.value = 'Ollama'; company.dispatchEvent(new document.defaultView.Event('change', { bubbles: true })) })
  flushSync(() => document.querySelector('[title="local/flash"]').click())
  await tick()
  // Start picks the offered model for the Bot.
  const start = [...dock.querySelectorAll('button')].find(button => button.textContent === 'Start')
  flushSync(() => start.click())
  await tick()
  assert.deepEqual(picked, [['chief', 'local/flash'], ['chief', 'deepseek-official/deepseek-flash']])
})

test('the dock offers the first model that can run when DSH\'s default cannot', async (t) => {
  const { document, caught } = await renderDock(t, { models: [{ ...models[0], needsKey: true }, models[1]] })
  assert.deepEqual(caught.map(error => error.message), [])
  assert.equal(document.querySelector('.bt-model-line-text').textContent, 'Using DeepSeek Flash · Ollama')
})
