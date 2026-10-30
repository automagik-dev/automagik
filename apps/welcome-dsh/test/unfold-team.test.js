// The team step with Unfold: its card (the third, or the first when the instance was opened for
// Unfold), its power button, and Unfold's own instance (host unfold), where Omni and Genie come
// bundled: no new Omni of its own, no line to paste into a terminal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { install } from '../src/host/endpoint.js'
import { fakeContext } from './fake-ctx.js'

// The client modules, with a React that records elements instead of rendering them.
async function load(file) {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(`../src/client/${file}`, import.meta.url))],
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom'],
    loader: { '.css': 'text' },
  })
  const module = { exports: {} }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}, useRef: current => ({ current }), useCallback: fn => fn,
  }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, URL, setTimeout, clearTimeout, require: name => ({ react, 'react-dom': { createPortal: node => node } })[name] })
  return module.exports
}
const plain = value => JSON.parse(JSON.stringify(value))
function render(node) {
  if (Array.isArray(node)) return node.map(render)
  if (node === null || typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children }))
  return { ...node, children: node.children.map(render) }
}
function findAll(node, match, out = []) {
  if (Array.isArray(node)) node.forEach(child => findAll(child, match, out))
  else if (node && typeof node === 'object') {
    if (match(node)) out.push(node)
    node.children.forEach(child => findAll(child, match, out))
  }
  return out
}
const textOf = node => (Array.isArray(node) ? node.map(textOf).join('') : node && typeof node === 'object' ? textOf(node.children) : node === null || node === undefined || node === false ? '' : String(node))
const byClass = name => node => String(node?.props?.className ?? '').split(' ').includes(name)

const team = await load('team.js')
const art = await load('companion-art.js')

test('opened for Unfold, Unfold\'s card comes first and starts chosen; elsewhere it is the third', () => {
  assert.deepEqual(plain(team.teamOrder('unfold')), ['unfold', 'omni', 'genie'])
  assert.deepEqual(plain(team.cardsOf('unfold')), ['unfold', 'omni', 'genie'])
  // Unfold's card is only in Unfold's own instance; elsewhere the team step never shows it.
  for (const preload of [null, 'omni']) assert.deepEqual(plain(team.cardsOf(preload)), ['omni', 'genie'])
  assert.deepEqual(plain(team.cardsOf('genie')), ['genie', 'omni'])
  for (const preload of [null, 'omni']) assert.deepEqual(plain(team.cardsOf(preload, 'unfold')), ['omni', 'genie', 'unfold'])
  assert.deepEqual(plain(team.cardsOf('genie', 'unfold')), ['genie', 'omni', 'unfold'])
  assert.deepEqual(plain(team.preselected('unfold')), { omni: false, genie: false, unfold: true })
  assert.equal(team.powersOnByItself('unfold', 'asleep', null, false, 'unfold'), true)
  assert.equal(team.powersOnByItself('unfold', 'asleep', null, false), false)
  assert.equal(team.powersOnByItself('unfold', 'asleep', null, false, 'genie'), false)
  assert.equal(team.powersOnByItself(null, 'asleep', null, false, 'unfold'), false)
})

test('who joins, in words: Unfold among them when it joined beside the leader', () => {
  assert.equal(team.joinedLabel({ omni: false, genie: false }, 'Unfold'), 'Continue with just Unfold')
  assert.equal(team.joinedLabel({ omni: true, genie: false, unfold: true }, 'Pip'), 'Continue with Omni and Unfold')
})

// The welcome's unfold-plugin answers, one per call, then the last again.
function unfoldHost(answers) {
  const calls = []
  const shown = []
  let at = 0
  const ai = async (endpoint) => {
    calls.push(endpoint)
    const answer = answers[Math.min(at++, answers.length - 1)]
    if (answer instanceof Error) throw answer
    return answer
  }
  const show = (phase, detail) => shown.push(detail === undefined || detail === null ? phase : [phase, plain(detail)])
  return { calls, shown, run: () => team.unfoldPowerOn({ show, unfoldAi: ai, wait: async () => {}, quick: true }) }
}

test('the team step\'s cards, from the state the host serves: Unfold only in Unfold\'s own instance', async () => {
  const cards = async (env) => {
    const { handle } = install(fakeContext({ entries: { 'omni-ai': {} } }).ctx, { env, checkClaude: async () => ({ plugin: false, installed: false, loggedIn: false }) })
    const state = (await handle('state')).value
    return plain(team.cardsOf(state.preload, state.host ?? null))
  }
  for (const env of [{}, { AUTOMAGIK_PRELOAD: 'omni' }, { AUTOMAGIK_PRELOAD: 'genie' }, { AUTOMAGIK_HOST: 'desktop' }]) {
    assert.ok(!(await cards(env)).includes('unfold'), JSON.stringify(env))
  }
  for (const env of [{ AUTOMAGIK_PRELOAD: 'unfold' }, { AUTOMAGIK_HOST: 'unfold' }, { AUTOMAGIK_PRELOAD: 'unfold', AUTOMAGIK_HOST: 'unfold' }]) {
    assert.deepEqual(await cards(env), ['unfold', 'omni', 'genie'], JSON.stringify(env))
  }
})

test('Unfold powers on: already on the team it is ready at once; else its plugins install, then it is ready', async () => {
  const bot = { id: 'u', name: 'Unfold' }
  const here = unfoldHost([{ ready: true, bot }])
  assert.equal(await here.run(), 'ready')
  assert.deepEqual(here.calls, ['unfold-plugin'])
  const plain = unfoldHost([{ ready: false, install: null }, { ready: false, install: { phase: 'installing' } }, { ready: false, install: { phase: 'done' } }, { ready: true, bot, install: { phase: 'done' } }])
  assert.equal(await plain.run(), 'ready')
  assert.deepEqual(plain.calls, ['unfold-plugin', 'unfold-plugin-install', 'unfold-plugin', 'unfold-plugin'])
  const restart = unfoldHost([{ ready: false, install: null }, { ready: false, install: { phase: 'restart' } }])
  assert.equal(await restart.run(), 'restart')
  const failed = unfoldHost([{ ready: false, install: null }, new Error('no plugin manager')])
  assert.equal(await failed.run(), 'failed')
})

test('Unfold\'s card: its box, its name, and what it starts with; on the team once its Bot is', () => {
  const card = (phase, host) => render(team.UnfoldCard({ power: { phase, detail: null, toggle: () => {} }, host }))
  const ready = card('ready')
  assert.equal(textOf(findAll(ready, node => node.type === 'h2')[0]), 'Unfold')
  assert.ok(byClass('oai-chosen')(ready))
  assert.match(textOf(findAll(ready, byClass('oai-team-line'))[0]), /On your team/)
  assert.equal(findAll(ready, byClass('oai-clay-unfold')).length, 1)
  const rows = findAll(ready, node => node.type === 'li' && node.props['data-cap'])
  assert.ok(rows.some(row => /Unfold bridge/.test(textOf(row))))
  assert.match(textOf(findAll(ready, byClass('oai-status'))[0]), /On your team/)
  // In Unfold's own instance its plugins came with it.
  assert.match(textOf(card('ready', 'unfold')), /Comes with this DSH/)
  assert.doesNotMatch(textOf(card('ready', 'unfold')), /Installs when/)
  assert.match(textOf(card('asleep')), /Installs when Unfold powers on/)
})

test('the stage mascot above every step is Unfold in its instance (host or preload unfold), else the octopus', async () => {
  // The look the stage draws, from the state the host serves the steps.
  const mascot = async (env) => {
    const { handle } = install(fakeContext({ entries: { 'omni-ai': {} } }).ctx, { env, checkClaude: async () => ({ plugin: false, installed: false, loggedIn: false }) })
    const state = (await handle('state')).value
    return JSON.stringify(render(art.Hero({ look: art.companionLook(state) })))
  }
  for (const env of [{ AUTOMAGIK_PRELOAD: 'unfold' }, { AUTOMAGIK_HOST: 'unfold' }, { AUTOMAGIK_PRELOAD: 'unfold', AUTOMAGIK_HOST: 'unfold' }]) {
    const drawn = await mascot(env)
    assert.match(drawn, /oai-clay-unfold/, JSON.stringify(env))
    assert.doesNotMatch(drawn, /oai-clay-omni/, JSON.stringify(env))
  }
  // A plain DSH before its companion exists: the octopus, as before.
  for (const env of [{}, { AUTOMAGIK_PRELOAD: 'omni' }]) {
    const drawn = await mascot(env)
    assert.match(drawn, /oai-clay-omni/, JSON.stringify(env))
    assert.doesNotMatch(drawn, /oai-clay-unfold/, JSON.stringify(env))
  }
})

test('under host unfold, Omni\'s choices hold no new Omni of its own', () => {
  assert.deepEqual(team.destinyOf([]).tiles.map(tile => tile.id), ['local', 'remote'])
  assert.deepEqual(team.destinyOf([], { newOmni: false }).tiles.map(tile => tile.id), ['remote'])
  const omniType = { type: 'omni', groups: [] }
  const card = local => render(team.OmniCard({ power: { phase: 'none', detail: { sandbox: null }, busy: null, problem: null, use: () => {}, remote: () => {}, local, cancelPairing: () => {} }, onPower: () => {}, type: omniType, abilities: {}, onToggle: () => {}, live: null }))
  const titles = tree => findAll(tree, byClass('oai-destiny-tile')).filter(node => node.type === 'button').map(node => textOf(findAll(node, node => node.type === 'strong')[0]))
  assert.deepEqual(titles(card(() => {})), ['Run Omni on this computer', 'An Omni somewhere else'])
  assert.deepEqual(titles(card(undefined)), ['An Omni somewhere else'])
})

test('under host unfold, Genie\'s card says its plugin came with this DSH and offers no install line', () => {
  const genie = (detail, host) => render(team.GenieCard({ power: { phase: 'ready', detail, toggle: () => {} }, host }))
  const offer = { genie: { skills: false, cli: 'curl -fsSL https://example.invalid/install.sh | bash' } }
  assert.equal(findAll(genie(offer), byClass('oai-genie-skills')).length, 1)
  const bundled = { genie: { skills: false, cli: '/pack/bin/genie', cliBundled: true } }
  assert.equal(findAll(genie(bundled, 'unfold'), byClass('oai-genie-skills')).length, 0)
  assert.match(textOf(genie(bundled, 'unfold')), /Comes with this DSH/)
  assert.match(textOf(genie(offer)), /Installs when Genie powers on/)
})

test('the served client bundle holds no install line piped to a shell', () => {
  const bundle = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(bundle, /install\.sh \|/)
  assert.doesNotMatch(bundle, /curl[^'"\n]*\|\s*(GENIE_CHANNEL=\w+ )?bash/)
})
