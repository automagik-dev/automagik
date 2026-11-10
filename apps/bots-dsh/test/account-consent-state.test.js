// The account step of the sign-in row (#869, cli-login-state.js and cli-login.js): a CLI already
// signed in on this computer asks the person before Bots use it. Without a browser: the host is
// a fake, the clock and timers are manual, and every identity is invented.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { createCliLogin } from '../src/client/cli-login-state.js'
import { DONE_MS, APPLY_FAILED_MS } from '../src/client/cli-login-model.js'
import { DICTIONARY, hostText, installLocale } from '../src/client/i18n.js'
import { createSource, indexRoster } from '../src/client/sources.js'
import { teamActions } from '../src/client/team-actions.js'

// The modules that draw (they import React) are bundled and read with a stand-in React, as
// model-menu.test.js does: only their pure pieces are called here.
const client = fileURLToPath(new URL('../src/client/', import.meta.url))
const bundle = await build({
  stdin: { contents: "export { accountLabel, announceCarried, CLI_LOGIN_CSS } from './cli-login.js'\nexport { modelHint } from './model-menu.js'\nexport { startModel } from './bot-draft.js'\n", resolveDir: client },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const drawn = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module: drawn, exports: drawn.exports, document: { body: {} }, window: { innerWidth: 1280, innerHeight: 800 }, Symbol, Promise, URL, setTimeout, clearTimeout,
  require: name => (name === 'react' ? { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), Fragment: 'Fragment' } : {}),
})
const { accountLabel, announceCarried, CLI_LOGIN_CSS, modelHint, startModel } = drawn.exports

const WORK = { ref: 'ref-work', kind: 'account', email: 'ana@work.example', org: 'Acme', plan: 'team' }
const HOME = { ref: 'ref-home', kind: 'account', email: 'ana@home.example' }

function manualTimers() {
  let now = 1_000_000
  let id = 0
  const pending = new Map()
  const timers = {
    setTimeout: (fn, ms) => { pending.set(++id, { fn, at: now + ms }); return id },
    clearTimeout: key => pending.delete(key),
    setInterval: (fn, ms) => { const key = ++id; pending.set(key, { fn, at: now + ms, every: ms }); return key },
    clearInterval: key => pending.delete(key),
  }
  const advance = async (ms) => {
    const until = now + ms
    for (;;) {
      const next = [...pending.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [key, timer] = next
      now = timer.at
      if (timer.every) timer.at += timer.every
      else pending.delete(key)
      timer.fn()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    }
    now = until
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
  return { timers, advance, now: () => now, pending }
}

// The host as the page sees it: an agent already signed in to `account` (waiting for the
// person) or signed out (`account: null`), and what became of the chosen model.
function fakeHost({ account = WORK } = {}) {
  const calls = []
  const host = { account, choice: undefined, confirmError: null, signedIn: true }
  const record = (name, ...args) => { calls.push([name, ...args]) }
  const actions = {
    cliLoginCurrent: async (botId, provider) => { record('current', botId, provider); return { id: provider, attempt: null, ...(host.account ? { account: host.account } : {}), ...(host.choice ? { choice: host.choice } : {}) } },
    cliLoginStart: async (botId, provider, model) => {
      record('start', botId, provider, model)
      if (model) host.choice = { ref: model, state: 'pending' }
      if (host.account) return { id: provider, status: 'confirm', account: host.account, ...(host.choice ? { choice: host.choice } : {}) }
      return { id: provider, attemptId: 'attempt_000000000000000000000001', status: 'waiting', openedBy: botId, expiresAt: 9_999_999, url: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' }
    },
    cliLoginConfirm: async (botId, provider, ref, model) => {
      record('confirm', botId, provider, ref, model)
      if (host.confirmError) throw host.confirmError
      host.account = null
      if (model) host.choice = { ref: model, state: 'pending' }
      return { id: provider, status: 'ready', ...(host.choice ? { choice: host.choice } : {}) }
    },
    cliLoginStatus: async () => { record('status'); return null },
    cliLoginConnections: async () => { record('connections'); return { connections: {} } },
    refreshModels: async () => { record('refresh') },
  }
  return { host, calls, actions, names: () => calls.map(call => call[0]), called: name => calls.filter(call => call[0] === name) }
}

test('choosing a model of a CLI already signed in opens the account step at once, and starts nothing', async () => {
  const clock = manualTimers()
  const { actions, names } = fakeHost()
  const login = createCliLogin({ actions, timers: clock.timers, now: clock.now, pollMs: 100 })
  await login.open({ botId: 'a', provider: 'acp-claude', ref: 'acp-claude/opus' })
  const row = login.getSnapshot().rows.a
  assert.equal(row.stage, 'account')
  assert.deepEqual(row.account, WORK)
  assert.equal(row.ref, 'acp-claude/opus', 'the chosen model stays staged on the row')
  assert.equal(row.busy, false)
  assert.deepEqual(names(), ['current'], 'no sign-in is started and nothing is confirmed by showing it')
  // Nothing is polled: no attempt is at work.
  await clock.advance(1000)
  assert.deepEqual(names(), ['current'])
})

test('"Use this account" sends the account shown and the staged model; the row ends as after a sign-in', async () => {
  const clock = manualTimers()
  const { host, actions, called, names } = fakeHost()
  const login = createCliLogin({ actions, timers: clock.timers, now: clock.now, pollMs: 100 })
  await login.open({ botId: 'a', provider: 'acp-claude', ref: 'acp-claude/opus' })
  assert.equal(await login.confirm('a'), true)
  assert.deepEqual(called('confirm'), [['confirm', 'a', 'acp-claude', 'ref-work', 'acp-claude/opus']])
  const done = login.getSnapshot().rows.a
  assert.equal(done.stage, 'done')
  assert.equal(done.taken, true)
  assert.equal(done.account, undefined)
  assert.ok(names().includes('refresh'), 'the model list is read again')
  // The host applies the staged model; the row reads the outcome back while it says Done.
  host.choice = { ref: 'acp-claude/opus', state: 'applied' }
  await clock.advance(500)
  assert.equal(login.getSnapshot().rows.a.stage, 'done')
  await clock.advance(DONE_MS)
  assert.deepEqual(login.getSnapshot().rows, {})
  assert.ok(!names().includes('start'), 'the terminal\'s sign-in was never replaced')
})

test('a staged model that could not be applied says so, as after a sign-in', async () => {
  const clock = manualTimers()
  const { host, actions } = fakeHost()
  const login = createCliLogin({ actions, timers: clock.timers, now: clock.now, pollMs: 100 })
  await login.open({ botId: 'a', provider: 'acp-codex', ref: 'acp-codex/default' })
  await login.confirm('a')
  host.choice = { ref: 'acp-codex/default', state: 'failed', message: 'No.', kept: 'deepseek-official/deepseek-flash' }
  await clock.advance(500)
  assert.equal(login.getSnapshot().rows.a.stage, 'applyFailed')
  assert.equal(login.getSnapshot().rows.a.outcome.kept, 'deepseek-official/deepseek-flash')
  await clock.advance(APPLY_FAILED_MS)
  assert.deepEqual(login.getSnapshot().rows, {})
})

test('Sign in on an offer whose CLI is already signed in turns into the account step, not "Done"', async () => {
  const clock = manualTimers()
  const { host, actions, names } = fakeHost({ account: null })
  const login = createCliLogin({ actions, timers: clock.timers, now: clock.now, pollMs: 100 })
  await login.open({ botId: 'a', provider: 'acp-codex', ref: 'acp-codex/default' })
  assert.equal(login.getSnapshot().rows.a.stage, 'offer')
  // The terminal signed in meanwhile: the host answers with the account, before any sign-in.
  host.account = HOME
  await login.start('a')
  const row = login.getSnapshot().rows.a
  assert.equal(row.stage, 'account')
  assert.deepEqual(row.account, HOME)
  assert.equal(row.attempt, null)
  await clock.advance(1000)
  assert.ok(!names().includes('status'), 'no attempt is polled')
})

test('Not now leaves the Bot on its model: nothing is confirmed and nothing is staged further', async () => {
  const clock = manualTimers()
  const { actions, names } = fakeHost()
  const login = createCliLogin({ actions, timers: clock.timers, now: clock.now, pollMs: 100 })
  await login.open({ botId: 'a', provider: 'acp-claude', ref: 'acp-claude/opus' })
  login.dismiss('a')
  assert.deepEqual(login.getSnapshot().rows, {})
  assert.equal(await login.confirm('a'), false)
  assert.deepEqual(names(), ['current'])
})

test('another account signed in before the click: the row shows that account and takes nothing', async () => {
  const clock = manualTimers()
  const { host, actions, called } = fakeHost()
  const login = createCliLogin({ actions, timers: clock.timers, now: clock.now, pollMs: 100 })
  await login.open({ botId: 'a', provider: 'acp-claude', ref: 'acp-claude/opus' })
  host.account = HOME
  host.confirmError = Object.assign(new Error('The account changed. Check it and confirm again.'), { code: 'bot/account-changed' })
  assert.equal(await login.confirm('a'), false)
  const row = login.getSnapshot().rows.a
  assert.equal(row.stage, 'account')
  assert.deepEqual(row.account, HOME)
  assert.equal(row.error, 'The account changed. Check it and confirm again.')
  assert.equal(row.busy, false)
  // The next click is for the account now shown.
  host.confirmError = null
  assert.equal(await login.confirm('a'), true)
  assert.deepEqual(called('confirm').at(-1), ['confirm', 'a', 'acp-claude', 'ref-home', 'acp-claude/opus'])
  // The CLI signed out instead: the ordinary offer to sign in.
  const out = fakeHost()
  const other = createCliLogin({ actions: out.actions, timers: clock.timers, now: clock.now, pollMs: 100 })
  await other.open({ botId: 'b', provider: 'acp-codex', ref: 'acp-codex/default' })
  out.host.account = null
  out.host.confirmError = Object.assign(new Error('This coding agent is not signed in any more. Sign in to use it.'), { code: 'bot/account-signed-out' })
  await other.confirm('b')
  assert.equal(other.getSnapshot().rows.b.stage, 'offer')
  assert.equal(other.getSnapshot().rows.b.error, 'This coding agent is not signed in any more. Sign in to use it.')
  // Any other failure keeps the step and says so.
  const failing = fakeHost()
  const third = createCliLogin({ actions: failing.actions, timers: clock.timers, now: clock.now, pollMs: 100 })
  await third.open({ botId: 'c', provider: 'acp-codex' })
  failing.host.confirmError = Object.assign(new Error('The account could not be confirmed. Try again.'), { code: 'bot/refused' })
  await third.confirm('c')
  assert.equal(third.getSnapshot().rows.c.stage, 'account')
  assert.equal(third.getSnapshot().rows.c.error, 'The account could not be confirmed. Try again.')
})

test('every Bot showing the account step of that agent ends with the one confirmation', async () => {
  const clock = manualTimers()
  const { actions } = fakeHost()
  const login = createCliLogin({ actions, timers: clock.timers, now: clock.now, pollMs: 100 })
  await login.open({ botId: 'a', provider: 'acp-claude', ref: 'acp-claude/opus' })
  await login.open({ botId: 'b', provider: 'acp-claude' })
  await login.confirm('a')
  assert.equal(login.getSnapshot().rows.a.stage, 'done')
  assert.equal(login.getSnapshot().rows.b.stage, 'done')
})

test('a turn refused for the account opens the step in that Bot\'s chat, once per refused turn', async () => {
  const clock = manualTimers()
  const { host, actions, called } = fakeHost()
  const login = createCliLogin({ actions, timers: clock.timers, now: clock.now, pollMs: 100 })
  const refused = at => ({ selected: 'acp-claude/default', lastFailure: { code: 'MODEL_ACCESS_REQUIRED', ref: 'acp-claude/default', at } })
  login.followFailures({ a: refused(10), b: { selected: 'deepseek/v4', lastFailure: { code: 'PROVIDER_DOWN', ref: 'deepseek/v4', at: 10 } }, c: { selected: 'deepseek/v4', lastFailure: { code: 'MODEL_ACCESS_REQUIRED', ref: 'acp-claude/default', kept: 'deepseek/v4', at: 10 } } })
  await clock.advance(0)
  const row = login.getSnapshot().rows.a
  assert.equal(row.stage, 'account')
  assert.deepEqual(row.account, WORK)
  assert.equal(row.ref, undefined, 'nothing is staged: the Bot is already on that model')
  assert.deepEqual(Object.keys(login.getSnapshot().rows), ['a'], 'another failure, or a switch that went back, opens nothing')
  // The same state answer again asks nothing more; "Not now" is respected until the next refusal.
  login.dismiss('a')
  login.followFailures({ a: refused(10) })
  await clock.advance(0)
  assert.deepEqual(login.getSnapshot().rows, {})
  assert.equal(called('current').length, 1)
  login.followFailures({ a: refused(20) })
  await clock.advance(0)
  assert.equal(login.getSnapshot().rows.a.stage, 'account')
  // A turn refused because the CLI is signed out opens nothing here, as before.
  login.dismiss('a')
  host.account = null
  login.followFailures({ a: refused(30) })
  await clock.advance(0)
  assert.deepEqual(login.getSnapshot().rows, {})
  login.followFailures(undefined)
})

test('the account step closes by itself when its Bot moves to another provider', async () => {
  const clock = manualTimers()
  const { actions } = fakeHost()
  let model = 'deepseek/v4'
  const login = createCliLogin({ actions, timers: clock.timers, now: clock.now, pollMs: 100, modelOf: () => model })
  await login.open({ botId: 'a', provider: 'acp-claude', ref: 'acp-claude/opus' })
  login.followModels()
  assert.equal(login.getSnapshot().rows.a.stage, 'account')
  model = 'openai/gpt'
  login.followModels()
  assert.deepEqual(login.getSnapshot().rows, {})
})

test('the account in one line: the email, then what else the CLI says of it', () => {
  assert.equal(accountLabel(WORK), 'ana@work.example (Acme, team)')
  assert.equal(accountLabel(HOME), 'ana@home.example')
  assert.equal(accountLabel({ kind: 'account', org: 'Acme', plan: 'team' }), 'Acme (team)')
  assert.equal(accountLabel({ kind: 'account', email: 'a@b.example', plan: 'pro' }), 'a@b.example (pro)')
  assert.equal(accountLabel({ ref: 'unknown' }), undefined)
  assert.equal(accountLabel(undefined), undefined)
})

test('the one-time notice of a carried vendor is shown once, with the account, then acknowledged', async () => {
  const shown = []
  const noticed = []
  const actions = {
    cliLoginAccounts: async () => ({ accounts: { 'acp-claude': { consent: 'carried', notice: true, account: WORK }, 'acp-codex': { consent: 'carried', notice: true, account: { ref: 'unknown' } }, 'acp-other': { consent: 'carried', notice: true } } }),
    cliLoginNoticed: async (provider) => { noticed.push(provider) },
    showNotice: text => shown.push(text),
  }
  assert.equal(await announceCarried({ actions }), true)
  assert.deepEqual(shown, ['Your Bots use the Claude Code sign-in on this computer: ana@work.example (Acme, team). It is shared with your terminal. Your Bots use the Codex sign-in on this computer. It is shared with your terminal.'])
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(noticed, ['acp-claude', 'acp-codex'])
  // Nothing due, or a host that does not answer: nothing is shown.
  assert.equal(await announceCarried({ actions: { ...actions, cliLoginAccounts: async () => ({ accounts: { 'acp-claude': { consent: 'given' } } }) } }), false)
  assert.equal(await announceCarried({ actions: { ...actions, cliLoginAccounts: async () => { throw new Error('offline') } } }), false)
  assert.equal(await announceCarried({ actions: {} }), false)
  assert.equal(shown.length, 1)
})

test('the hints are honest about an account that waits, and a new Bot never starts on it', () => {
  const models = [
    { ref: 'deepseek/v4', provider: 'deepseek', providerName: 'DeepSeek', name: 'DeepSeek V4' },
    { ref: 'acp-claude/opus', provider: 'acp-claude', providerName: 'Claude Code', via: 'cli', name: 'Opus', needsAccount: true },
  ]
  const roster = { models, defaultModel: 'acp-claude/opus' }
  assert.equal(modelHint({ id: 'a', model: 'acp-claude/opus' }, roster, { selected: 'acp-claude/opus', lastFailure: { code: 'MODEL_ACCESS_REQUIRED', ref: 'acp-claude/opus' } }), 'Opus waits for you to confirm its account.')
  assert.equal(startModel(roster), 'deepseek/v4')
})

test('the step adds no style rule, and every new string has its Chinese text', () => {
  // The row's own stylesheet is as the sign-in row shipped it: the step reuses its classes.
  for (const rule of ['.bt-cli-row{', '.bt-cli-actions{', '.bt-cli-error{']) assert.ok(CLI_LOGIN_CSS.includes(rule), rule)
  assert.equal(CLI_LOGIN_CSS.includes('account'), false)
  const source = readFileSync(new URL('../src/client/cli-login.js', import.meta.url), 'utf8')
  const step = source.slice(source.indexOf("case 'account':"), source.indexOf("case 'attempt':"))
  assert.deepEqual([...new Set([...step.matchAll(/className: '([^']+)'/g)].map(match => match[1]))].sort(), ['bt-cli-actions', 'bt-cli-error', 'bt-q-submit', 'bt-soft bt-soft-sm'])
  for (const key of [
    '{name} on this computer is signed in as {account}.',
    '{name} on this computer is already signed in. This version does not show which account.',
    '{name} on this computer uses an API key.',
    'Bots will use and bill this account. It is the same sign-in your terminal uses.',
    'Use this account',
    'Done: Bots will use this {name} account.',
    'Your Bots use the {name} sign-in on this computer: {account}. It is shared with your terminal.',
    'Your Bots use the {name} sign-in on this computer. It is shared with your terminal.',
    '{model} waits for you to confirm its account.',
    'This model needs you to confirm the account of its coding agent.',
    'Confirm account',
    'Confirm the account of {connection} before using this model.',
    'The account changed. Check it and confirm again.',
    'This coding agent is not signed in any more. Sign in to use it.',
    'The account could not be confirmed. Try again.',
  ]) assert.ok(Object.hasOwn(DICTIONARY.zh, key), key)
  // The host's refusal is worded in the interface language around its value.
  const dicts = new Map()
  const off = installLocale({
    register: (ns, lang, dict) => { dicts.set(`${ns}:${lang}`, dict); return () => {} },
    bind: ns => (key, params) => (dicts.get(`${ns}:zh`)?.[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? `{${name}}`),
    getLocale: () => ({ active: 'zh' }),
  })
  try {
    assert.equal(hostText('Confirm the account of Claude Code (acp-claude) before using this model.'), '使用此模型前，请确认 Claude Code (acp-claude) 的账号。')
  } finally {
    off()
  }
})

test('a model refused for its account opens the account step from the chat; updateBot never does', async () => {
  const roster = createSource(indexRoster({ bots: [{ id: 'a', name: 'A', model: 'deepseek-official/deepseek-flash' }], rooms: [], agents: [], models: [], prefs: {} }))
  const opened = []
  const sessions = []
  let refusal = { code: 'bot/account-confirm-required', message: 'Confirm the account of Claude Code before using this model.' }
  const call = async (endpoint) => { if (endpoint === 'update-bot') throw Object.assign(new Error(refusal.message), { code: refusal.code }) }
  const manager = { open: (options) => { opened.push(options); return Promise.resolve(true) } }
  const actions = teamActions({ call, after: value => value, partFor: id => id, roster, ui: createSource({}), openSession: id => sessions.push(id), loginState: () => manager })
  await assert.rejects(actions.updateBot('a', { model: 'acp-claude/default' }), { code: 'bot/account-confirm-required' })
  assert.deepEqual(opened, [])
  // The pick in the chat opens the row (it asks the host, which answers with the account step).
  assert.equal(await actions.chooseModelInChat('a', 'acp-claude/default'), undefined)
  assert.deepEqual(opened, [{ botId: 'a', provider: 'acp-claude', ref: 'acp-claude/default' }])
  assert.deepEqual(sessions, ['a'])
  // Only that refusal, and only for an agent's model.
  await assert.rejects(actions.chooseModelInChat('a', 'deepseek-official/deepseek-pro'), { code: 'bot/account-confirm-required' })
  refusal = { code: 'bot/refused', message: 'Turn on Claude Code first' }
  await assert.rejects(actions.chooseModelInChat('a', 'acp-claude/default'), { code: 'bot/refused' })
  assert.equal(opened.length, 1)
})

// The Bot's settings, drawn with a stand-in React that keeps state between two draws: enough to
// pick a model and read the rows that follow. Nothing is mounted and no child is drawn.
test('settings: a model refused for its account offers "Confirm account", which opens the step in the chat', async () => {
  const built = await build({
    stdin: { contents: "export { BotSettingsForm } from './bot-settings.js'\n", resolveDir: client },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
  })
  const slots = []
  let slot = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useState: (first) => {
      const at = slot++
      if (!(at in slots)) slots[at] = typeof first === 'function' ? first() : first
      return [slots[at], (next) => { slots[at] = typeof next === 'function' ? next(slots[at]) : next }]
    },
    useEffect: () => {},
    useLayoutEffect: () => {},
    useCallback: fn => fn,
    useMemo: fn => fn(),
    useRef: current => ({ current }),
    useSyncExternalStore: (subscribe, snapshot) => snapshot(),
  }
  const made = { exports: {} }
  runInNewContext(built.outputFiles[0].text, {
    module: made, exports: made.exports, document: { body: {} }, window: { innerWidth: 1280, innerHeight: 800 }, Symbol, Promise, URL, setTimeout, clearTimeout,
    require: name => (name === 'react' ? react : {}),
  })
  const { BotSettingsForm } = made.exports
  const bot = { id: 'a', name: 'A', model: 'deepseek/v4' }
  const roster = { bots: [bot], models: [], mainBotIds: [] }
  const opened = []
  let refusal = 'bot/account-confirm-required'
  const actions = {
    updateBot: async () => { throw Object.assign(new Error('refused'), { code: refusal }) },
    openCliLogin: (...args) => { opened.push(args); return true },
  }
  const run = promise => promise.catch(() => {})
  const draw = () => { slot = 0; return BotSettingsForm({ bot, roster, actions, run }) }
  const all = (node, out = []) => {
    if (node === null || typeof node !== 'object') return out
    if (Array.isArray(node)) { for (const child of node) all(child, out); return out }
    out.push(node)
    all(node.children, out)
    return out
  }
  const menu = tree => all(tree).find(node => typeof node.props?.onPick === 'function')
  const button = (tree, label) => all(tree).find(node => node.type === 'button' && node.children.includes(label))
  let tree = draw()
  assert.equal(button(tree, 'Confirm account'), undefined)
  await menu(tree).props.onPick('acp-claude/opus')
  tree = draw()
  const confirm = button(tree, 'Confirm account')
  assert.ok(confirm, 'the row is offered')
  assert.equal(button(tree, 'Sign in'), undefined)
  // The existing row's classes and nothing new.
  assert.equal(confirm.props.className, 'bt-soft bt-soft-sm')
  assert.ok(all(tree).some(node => node.children?.includes('This model needs you to confirm the account of its coding agent.')))
  confirm.props.onClick()
  assert.deepEqual(opened, [['a', 'acp-claude', 'acp-claude/opus']])
  assert.equal(button(draw(), 'Confirm account'), undefined)
  // A signed-out agent keeps its own row, as shipped, and a model that is no agent's gets none.
  refusal = 'bot/sign-in-required'
  await menu(draw()).props.onPick('acp-codex/default')
  tree = draw()
  assert.ok(button(tree, 'Sign in'))
  assert.equal(button(tree, 'Confirm account'), undefined)
  button(tree, 'Sign in').props.onClick()
  refusal = 'bot/account-confirm-required'
  await menu(draw()).props.onPick('deepseek/v5')
  assert.equal(button(draw(), 'Confirm account'), undefined)
})
