// #844: a Bot Session adopt that the host refuses must say why, name the Bot and
// the Session, and say what to do next. Each refusal keeps its own `bot/adopt-*`
// code (never the generic `bot/refused`), writes a stackless host diagnostics entry,
// and moves nothing: the Bots, DSH bots, group chats, tasks and switching records are
// the same before and after, and the Bot keeps its old Session and preset. The client
// toast names the same reason even when the native view has moved on. A successful
// adopt still persists the exact selected Session.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'
import { apply } from '../index.js'
import { TEAM_TOOLS } from '../src/host/constants.js'
import { fakeContext } from './fake-ctx.js'

const plugin = dirname(dirname(fileURLToPath(import.meta.url)))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// Enough of the DSH services for the roster and agents modules to install: a fake
// route captures the plugin's /api handler, a temp home holds one team file, and
// the Session controller resolves the native Session the adopt bench registers.
function start(team, { home = mkdtempSync(join(tmpdir(), 'ds-bot-adopt-')) } = {}) {
  if (team !== undefined) writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const ctx = fakeContext()
  const workspaces = new Map()
  const created = []
  const archived = []
  const restricted = []
  const renamed = []
  let sessions = 0
  ctx.tools.schemas = () => [...TEAM_TOOLS, 'read', 'write'].map(name => ({ name }))
  Object.assign(ctx, {
    workspaceRegistry: {
      get: id => workspaces.get(id),
      resolveByPath: async path => [...workspaces.values()].find(workspace => workspace.path === path),
      create: async (path) => {
        const workspace = { id: `w${workspaces.size + 1}`, path }
        workspaces.set(workspace.id, workspace)
        return workspace
      },
      archiveSession: async (sessionId) => { archived.push(sessionId) },
    },
    sessionController: {
      create: async (options) => {
        created.push(options)
        sessions += 1
        // The first Session is the adopted Bot's own chat; later ones keep counting.
        return { sessionId: options.sessionId ?? (sessions === 1 ? 'brain' : `s${sessions}`) }
      },
      resolveAgent: async (sessionId) => {
        const agent = {
          session: { id: sessionId },
          ctx: {
            tools: { restrict: (filter) => { restricted.push({ sessionId, filter }); return () => {} } },
            effect: execute => execute(),
          },
          followup() {},
        }
        return { agent }
      },
      selectModel: async () => {},
    },
    sessionTitle: { rename: async (session, title) => { renamed.push({ id: session.id, title }) } },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  apply(ctx, { home })
  const call = async (endpoint, payload) => {
    const response = await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
    return response.json()
  }
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { call, stop, home, created, archived, restricted, renamed, ctx }
}

// The team records an adopt must leave untouched. Room records carry their member
// Sessions and earlier segments, so the group-chat side of the team is covered too.
const teamState = rt => structuredClone({
  bots: rt.state.bots,
  agents: rt.state.agents,
  rooms: rt.state.rooms,
  tasks: rt.state.tasks,
  switching: rt.state.switching,
})

// An adopted Bot "Brain" whose current part is `brain`, and a native root Session
// `picked` that a project picker would hand to the adopt endpoint. The target starts
// blank and preset-less, exactly as the native picker creates it.
const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 2,
  bots: { m1: { id: 'm1', sessionId: 'm1', name: 'Omni', role: 'Channel orchestrator', instructions: '', createdAt: 1 } },
  rooms: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

async function adoptBench(t) {
  const bench = start(TEAM)
  t.after(bench.stop)
  await bench.call('state', {})
  const rt = bench.ctx.provided.get('omniTeam')
  bench.ctx.provided.set('agentPresets', { list: async () => [{ id: 'cordis' }] })
  const entry = (await bench.call('add-agent', { name: 'Brain', profile: 'cordis' })).value
  const botId = (await bench.call('agent-bot-adopt', { agentId: entry.id })).value.botId
  const bot = rt.state.bots[botId]
  Object.assign(bot, { workDir: '/original', model: 'native/chosen', effort: 'high', permissions: { mode: 'ask' } })
  await rt.save({ required: true })
  // A group chat with a live Session and an earlier segment, so the snapshot proves
  // a refusal leaves rooms (and the switching record that follows one) alone.
  rt.state.rooms['room-1'] = {
    id: 'room-1',
    name: 'Crew',
    members: [botId],
    sessions: { [botId]: 'group-brain' },
    segments: { [botId]: [{ sessionId: 'group-old', endedAt: 1 }] },
  }
  rt.state.switching = { 'group-old': { botId } }
  rt.indexSessions()
  const target = {
    id: 'picked',
    session: { id: 'picked', header: { id: 'picked', cwd: '/selected', isSeeded: false } },
    preset: 'standard',
    boundary: { openTurnStartSeq: null, lastTurn: 0 },
  }
  const resolve = rt.resolveAgent
  rt.resolveAgent = async id => id === 'picked' ? target : resolve(id)
  // dsh 0.2.2 reads the turn boundary and the preset through their owning services.
  bench.ctx.agents = { turnBoundaryOf: session => session.id === 'picked' ? target.boundary : undefined, isOwnedBy: () => false }
  const selected = []
  const presets = {
    list: async () => [{ id: 'cordis' }],
    select: async (live, preset) => { selected.push([live.session.id, preset]); live.preset = preset },
    // The owner reads the Session's recorded preset (the agent that carries it here).
    presetForSession: session => session?.id === 'picked' ? target.preset : undefined,
  }
  bench.ctx.provided.set('agentPresets', presets)
  const adopt = () => bench.call('bot-session-adopt', { botId, sessionId: 'picked', sourceSessionId: botId })
  return { ...bench, rt, bot, botId, entry, target, presets, selected, adopt }
}

// The reply and the host diagnostics entry of one refusal. A named refusal answers
// its own message (the channel exposes a `bot/`-coded message), names the Bot, the
// Session and the next step, and leaves one `source: 'api'` entry with no stack.
async function assertRefused(bench, result, expected) {
  const { code, reason, parts, where, diagnosticsBot, sessionId = 'picked' } = expected
  assert.equal(result.ok, false, 'the adopt must be refused')
  assert.equal(result.error.code, code, 'each refusal carries its own bot/adopt-* code')
  assert.notEqual(result.error.code, 'bot/refused', 'a deliberate adopt refusal is never the generic code')
  assert.match(result.error.message, reason, 'the reply names the reason')
  for (const part of parts) {
    assert.equal(result.error.message.includes(part), true, `the reply names ${part}: ${result.error.message}`)
  }
  const entries = await bench.rt.diagnostics.entries()
  const matching = entries.filter(entry => entry.code === code)
  const noted = matching.at(-1)
  assert.ok(noted, `the host diagnostics records ${code}: ${JSON.stringify(entries)}`)
  assert.equal(noted.source, 'api')
  assert.equal(noted.where, where)
  assert.equal(noted.bot, diagnosticsBot)
  assert.equal(noted.code, code)
  assert.equal(noted.text, result.error.message, 'the host entry keeps the same text the person sees')
  assert.equal(noted.sessionId, sessionId ?? undefined)
  assert.equal(noted.stack, undefined, 'a named refusal is not logged with a stack')
  return noted
}

const unchanged = (bench, before, why) => {
  assert.deepEqual(teamState(bench.rt), before, why)
  assert.equal(bench.rt.chatOf(bench.botId), bench.botId, 'the Bot keeps its old Session')
  assert.equal(bench.bot.sessionId, before.bots[bench.botId].sessionId, 'the Bot still points at its old part')
  assert.equal(bench.bot.profile, 'cordis', 'the Bot preset is unchanged')
}

test('#844: an unknown Bot adopt is refused as bot/adopt-unknown, naming the Bot and Session', async t => {
  const bench = await adoptBench(t)
  const before = teamState(bench.rt)
  const result = await bench.call('bot-session-adopt', { botId: 'no-such-bot', sessionId: 'picked', sourceSessionId: 'no-such-bot' })
  await assertRefused(bench, result, {
    code: 'bot/adopt-unknown',
    reason: /is not an adopted DSH Bot/,
    parts: ['Bot no-such-bot', 'Session picked', 'Open the Bot from the team list and try again.'],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'no-such-bot',
  })
  unchanged(bench, before, 'an unknown Bot changes nothing')
  assert.deepEqual(bench.selected, [], 'no native preset was selected')

  // A record that exists but is not an adopted DSH Bot is the same refusal family.
  delete bench.bot.kind
  bench.rt.indexSessions()
  const beforeOrdinary = teamState(bench.rt)
  const ordinary = await bench.adopt()
  await assertRefused(bench, ordinary, {
    code: 'bot/adopt-unknown',
    reason: /Bot "Brain" is not an adopted DSH Bot/,
    parts: ['Bot "Brain"', 'Session picked', 'Open the Bot from the team list and try again.'],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, beforeOrdinary, 'an ordinary Bot record changes nothing')
})

test('#844: an invalid Session transition is refused as bot/adopt-invalid-transition', async t => {
  const bench = await adoptBench(t)
  const before = teamState(bench.rt)
  const cases = [
    { payload: { sessionId: undefined, sourceSessionId: bench.botId }, session: 'Session (missing)', sessionId: null },
    { payload: { sessionId: 42, sourceSessionId: bench.botId }, session: 'Session 42', sessionId: null },
    { payload: { sessionId: 'picked' }, session: 'Session picked', sessionId: 'picked' },
  ]
  for (const entry of cases) {
    const result = await bench.call('bot-session-adopt', { botId: bench.botId, ...entry.payload })
    await assertRefused(bench, result, {
      code: 'bot/adopt-invalid-transition',
      reason: /the request needs a valid Session id and the id of the Bot's current part/,
      parts: ['Bot "Brain"', entry.session, 'Pick the project Session again.'],
      where: `bot-session-adopt (${entry.session})`,
      diagnosticsBot: 'Brain',
      sessionId: entry.sessionId,
    })
    unchanged(bench, before, 'a malformed transition changes nothing')
  }
  assert.equal((await bench.rt.diagnostics.entries()).filter(entry => entry.code === 'bot/adopt-invalid-transition').length, 3)
  assert.deepEqual(bench.selected, [])
})

test('#844: a pending Bot Session transition is refused as bot/adopt-pending', async t => {
  const bench = await adoptBench(t)
  const before = teamState(bench.rt)
  const resolveAgent = bench.rt.resolveAgent
  let release
  bench.rt.resolveAgent = async (id) => {
    if (id === 'picked' && release === undefined) await new Promise((resolve) => { release = resolve })
    return resolveAgent(id)
  }
  const first = bench.rt.adoptBotSession(bench.botId, 'picked', bench.botId)
  assert.equal(typeof release, 'function', 'the first adopt holds the transition')
  const result = await bench.adopt()
  await assertRefused(bench, result, {
    code: 'bot/adopt-pending',
    reason: /A Bot Session transition is already pending/,
    parts: ['Bot "Brain"', 'Session picked', 'Wait for the current change to finish, then try again.'],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, before, 'a pending refusal changes nothing')
  assert.deepEqual(bench.selected, [], 'the refused attempt selected no preset')
  release()
  assert.equal(await first, 'picked', 'the held adopt still completes')
})

test('#844: a Bot changed during the transition is refused as bot/adopt-changed', async t => {
  const bench = await adoptBench(t)
  const before = teamState(bench.rt)
  const resolveAgent = bench.rt.resolveAgent
  const chatOf = bench.rt.chatOf
  bench.rt.resolveAgent = async (id) => {
    const live = await resolveAgent(id)
    // An edit from another window changes where the Bot's current part is while the
    // Session resolves; the harness changes no team record, only the answer.
    if (id === 'picked') bench.rt.chatOf = () => 'edited-elsewhere'
    return live
  }
  let result
  try { result = await bench.adopt() } finally { bench.rt.resolveAgent = resolveAgent; bench.rt.chatOf = chatOf }
  await assertRefused(bench, result, {
    code: 'bot/adopt-changed',
    reason: /changed while Session picked was joining it/,
    parts: ['Bot "Brain"', 'Session picked', 'Nothing was changed; try again.'],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, before, 'a changed registration changes nothing')
  assert.deepEqual(bench.selected, [])
})

test('#844: a Session already on the team is refused as bot/adopt-in-team', async t => {
  const bench = await adoptBench(t)
  bench.rt.state.tasks ??= {}
  bench.rt.state.tasks.picked = { from: bench.botId }
  const beforeTask = teamState(bench.rt)
  const task = await bench.adopt()
  await assertRefused(bench, task, {
    code: 'bot/adopt-in-team',
    reason: /already belongs to the team \(a Bot, group chat, task, or DSH bot\)/,
    parts: ['Bot "Brain"', 'Session picked', 'Open a new blank Session or a fork of this Bot instead.'],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, beforeTask, 'a task-owned Session changes nothing')

  // A Bot (not this Bot) already owns the Session.
  delete bench.rt.state.tasks.picked
  bench.rt.state.bots['another-bot'] = { id: 'another-bot', sessionId: 'picked', name: 'Another', createdAt: 1 }
  bench.rt.indexSessions()
  const beforeOwner = teamState(bench.rt)
  const owner = await bench.adopt()
  await assertRefused(bench, owner, {
    code: 'bot/adopt-in-team',
    reason: /already belongs to the team \(a Bot, group chat, task, or DSH bot\)/,
    parts: ['Bot "Brain"', 'Session picked', 'Open a new blank Session or a fork of this Bot instead.'],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, beforeOwner, 'a Bot-owned Session changes nothing')
  assert.deepEqual(bench.selected, [])
})

test('#844: a non-root Session is refused as bot/adopt-root', async t => {
  const bench = await adoptBench(t)
  bench.target.session.header.origin = 'subagent'
  const beforeSubagent = teamState(bench.rt)
  const subagent = await bench.adopt()
  await assertRefused(bench, subagent, {
    code: 'bot/adopt-root',
    reason: /is not a root Session \(it is a subagent, delegated, or owned by another Session\)/,
    parts: ['Bot "Brain"', 'Session picked', "Open the project's own root Session instead."],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, beforeSubagent, 'a subagent Session changes nothing')

  delete bench.target.session.header.origin
  bench.target.session.header.delegationDepth = 2
  const beforeDepth = teamState(bench.rt)
  const depth = await bench.adopt()
  await assertRefused(bench, depth, {
    code: 'bot/adopt-root',
    reason: /is not a root Session/,
    parts: ['Bot "Brain"', 'Session picked', "Open the project's own root Session instead."],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, beforeDepth, 'a delegated Session changes nothing')
  assert.deepEqual(bench.selected, [])
})

test('#844: a not-blank, non-fork Session is refused as bot/adopt-not-blank', async t => {
  const bench = await adoptBench(t)
  bench.target.boundary.lastTurn = 3
  const before = teamState(bench.rt)
  const result = await bench.adopt()
  await assertRefused(bench, result, {
    code: 'bot/adopt-not-blank',
    reason: /is neither blank nor a fork of the current part of Bot "Brain"/,
    parts: ['Bot "Brain"', 'Session picked', `Session ${bench.botId}`, 'Start a new Session in the project or fork the Bot\'s current chat.'],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, before, 'a not-blank Session changes nothing')
  assert.deepEqual(bench.selected, [])
})

test('#844: an unavailable native preset is refused as bot/adopt-preset-unavailable', async t => {
  const bench = await adoptBench(t)
  bench.presets.list = async () => []
  const beforeList = teamState(bench.rt)
  const unserved = await bench.adopt()
  await assertRefused(bench, unserved, {
    code: 'bot/adopt-preset-unavailable',
    reason: /The preset cordis is not available in this DSH/,
    parts: ['Bot "Brain"', 'Session picked', "Choose an available preset in the Bot's settings, then try again."],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, beforeList, 'an unserved preset changes nothing')

  bench.presets.list = async () => [{ id: 'cordis' }]
  delete bench.presets.select
  bench.target.preset = 'standard'
  const beforeSelect = teamState(bench.rt)
  const noSelect = await bench.adopt()
  await assertRefused(bench, noSelect, {
    code: 'bot/adopt-preset-unavailable',
    reason: /native preset selection is unavailable in this DSH/,
    parts: ['Bot "Brain"', 'Session picked', 'Update DSH or pick a Session already on that preset.'],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, beforeSelect, 'a Session that cannot be preset changes nothing')
  assert.equal((await bench.rt.diagnostics.entries()).filter(entry => entry.code === 'bot/adopt-preset-unavailable').length, 2)
  assert.deepEqual(bench.selected, [])
})

test('#844: a native preset that does not persist is refused as bot/adopt-preset-not-persisted', async t => {
  const bench = await adoptBench(t)
  bench.target.preset = 'standard'
  bench.presets.select = async (live, preset) => { bench.selected.push([live.session.id, preset]) }
  const before = teamState(bench.rt)
  const result = await bench.adopt()
  await assertRefused(bench, result, {
    code: 'bot/adopt-preset-not-persisted',
    reason: /could not keep the native preset "cordis"/,
    parts: ['Bot "Brain"', 'Session picked', 'Try again, or pick a Session already on that preset.'],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, before, 'an unpersisted preset changes nothing')
  assert.deepEqual(bench.selected, [['picked', 'cordis']], 'the refusal follows the attempted selection')
  assert.equal(bench.target.preset, 'standard', 'no preset was selected on the Session')
})

test('#844: a Bot changed while persisting is refused as bot/adopt-changed-persisting', async t => {
  const bench = await adoptBench(t)
  const original = bench.rt.state.agents[bench.entry.id]
  const profile = original.profile
  const save = bench.rt.save
  let armed = true
  bench.rt.save = async (options) => {
    const value = await save(options)
    // Another window edits the adopted registration after this save and before the
    // post-save check; the test restores the field before comparing the snapshot.
    if (armed) { armed = false; original.profile = 'edited-during-persist' }
    return value
  }
  const before = teamState(bench.rt)
  let result
  try { result = await bench.adopt() } finally { bench.rt.save = save; original.profile = profile }
  await assertRefused(bench, result, {
    code: 'bot/adopt-changed-persisting',
    reason: /changed while Session picked was being saved/,
    parts: ['Bot "Brain"', 'Session picked', 'Nothing was changed; try again.'],
    where: 'bot-session-adopt (Session picked)',
    diagnosticsBot: 'Brain',
  })
  unchanged(bench, before, 'a failed persistence is rolled back')
  const stored = JSON.parse(readFileSync(join(bench.home, 'state.json'), 'utf8'))
  assert.equal(stored.bots[bench.botId].sessionId, before.bots[bench.botId].sessionId, 'the failed persistence left the old part on disk')
  assert.deepEqual(stored.bots[bench.botId].segments, before.bots[bench.botId].segments)
})

test('#844: a successful adopt still joins the Bot to the exact Session and persists it', async t => {
  const bench = await adoptBench(t)
  const original = structuredClone(bench.rt.state.agents[bench.entry.id])
  const before = teamState(bench.rt)
  const result = await bench.adopt()
  assert.equal(result.ok, true, result.error?.message)
  assert.equal(result.value.sessionId, 'picked')
  assert.equal(bench.rt.chatOf(bench.botId), 'picked')
  assert.equal(bench.rt.selfOf('picked'), bench.botId)
  assert.equal(bench.bot.sessionId, 'picked')
  assert.equal(bench.bot.profile, 'cordis')
  assert.deepEqual(bench.selected, [['picked', 'cordis']], 'the served preset is selected')
  assert.deepEqual(bench.rt.state.agents[bench.entry.id], original, 'the registration is kept for rollback')
  assert.deepEqual((bench.bot.segments ?? []).filter(part => part.sessionId === bench.botId).map(part => part.sessionId), [bench.botId], 'the old part becomes a segment')
  const stored = JSON.parse(readFileSync(join(bench.home, 'state.json'), 'utf8'))
  assert.equal(stored.bots[bench.botId].sessionId, 'picked')
  assert.notDeepEqual(teamState(bench.rt), before, 'a successful adopt changes the Bot')
  assert.equal((await bench.rt.diagnostics.entries()).filter(entry => String(entry.code).startsWith('bot/adopt-')).length, 0, 'a success is not a refusal')
})

// The client adopt flow: a native pick assigns a destination Session to the Bot.
// The report must still reach the toast when the native view moved on while the
// host was answering (the adopt catch's reportError is outside the view check).
test('#844: a refused adopt reaches the toast after the native view moved on', async t => {
  const bench = await adoptBench(t)
  bench.target.boundary.lastTurn = 1 // the host refuses this Session as not blank
  t.mock.method(console, 'warn', () => {})
  const harness = process.env.DSH_HARNESS
  assert.ok(harness, 'the DSH harness supplies the client bundle dependencies')
  const requireHarness = createRequire(join(harness, 'package.json'))
  const { JSDOM } = requireHarness('jsdom')
  const { outputFiles } = await build({
    stdin: {
      contents: "export { apply, omni } from './src/client/index.js'; export { clientErrors, clearClientErrors } from './src/client/diagnostics.js'",
      resolveDir: plugin,
    },
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
    external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
  })
  const source = (value) => {
    let current = value
    const listeners = new Set()
    return {
      getSnapshot: () => current,
      subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
      set: (next) => { current = next; for (const fn of listeners) fn() },
    }
  }
  const list = source({ ids: ['brain'], byId: { brain: { id: 'brain', retainedBy: { mainView: 1 } } } })
  let adoptPayload
  let startAdopt
  const adoptStarted = new Promise((resolve) => { startAdopt = resolve })
  let finishCall
  const gate = new Promise((resolve) => { finishCall = resolve })
  let hostRefusal
  const fetch = async (_url, options) => {
    const { endpoint, payload } = JSON.parse(options.body)
    if (endpoint === 'state') {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          value: {
            revision: 1,
            bots: [{ id: 'brain', sessionId: 'brain', name: 'Brain', kind: 'dsh', dshAgentId: 'native', profile: 'cordis', parts: [] }],
            rooms: [],
            agents: [],
            mainBotId: 'main',
            mainBotIds: ['main'],
            models: [],
            questions: {},
            exchangeTurns: {},
          },
        }),
      }
    }
    if (endpoint === 'bot-session-adopt') {
      adoptPayload = payload
      startAdopt()
      await gate
      const result = await bench.call(endpoint, payload)
      if (!result.ok) hostRefusal = result.error
      return { ok: true, json: async () => result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error } }
    }
    return { ok: true, json: async () => ({ ok: true, value: {} }) }
  }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
  const effects = []
  const ctx = {
    effect: (fn, label) => { effects.push({ fn, label }); return () => {} },
    inject: () => () => {},
    get: () => undefined,
    sessions: { list, refresh: async () => {}, refreshProjections: async () => {} },
    uiWorkspace: { openSession() {} },
    layout: { panelInfo: source({}), selectPanel() {}, toggleSidebar() {} },
    slots: { entries: () => [], inject: () => () => {}, register: () => () => {}, subscribe: () => () => {} },
    theme: { overrideTokens: () => () => {} },
    uiConversation: { binding: () => ({ target: () => undefined }) },
  }
  const module = { exports: {} }
  runInNewContext(outputFiles[0].text, {
    module,
    exports: module.exports,
    require: name => name.startsWith('react') ? new Proxy({}, { get: () => () => null }) : {},
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
    fetch,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    AbortController,
    performance,
    TextEncoder,
    TextDecoder,
  })
  module.exports.apply(ctx)
  const effect = label => effects.find(entry => entry.label === label).fn()
  const disposePoll = effect('ds-bot: roster poll')
  const disposeSurface = effect('ds-bot: agent surface')
  const disposeFace = effect('ds-bot: face for other Omni plugins')
  t.after(() => { disposeSurface?.(); disposeFace?.(); disposePoll?.(); dom.window.close() })
  await wait(30)
  const face = module.exports.omni.face()
  assert.ok(face, 'the client applies a Bot face')
  assert.equal(face.hooks.roster.getSnapshot().ready, true, 'the roster carries the Bot')
  module.exports.clearClientErrors()

  // A native project pick moves the main view to `picked`; the adopt request starts.
  list.set({ ids: ['brain', 'picked'], byId: { brain: { id: 'brain' }, picked: { id: 'picked', blank: true, retainedBy: { mainView: 1 } } } })
  await adoptStarted
  assert.deepEqual(adoptPayload, { botId: 'brain', sessionId: 'picked', sourceSessionId: 'brain' })

  // The view moves on while the host is still answering the adopt.
  list.set({
    ids: ['brain', 'picked', 'moved-on'],
    byId: { brain: { id: 'brain' }, picked: { id: 'picked', blank: true }, 'moved-on': { id: 'moved-on', blank: false, retainedBy: { mainView: 1 } } },
  })
  finishCall()
  for (let attempt = 0; attempt < 100 && face.hooks.ui.getSnapshot().toast === null; attempt += 1) await wait(10)
  const toast = face.hooks.ui.getSnapshot().toast
  assert.ok(toast, 'the refusal still reaches the toast after the view moved on')
  assert.ok(hostRefusal, 'the host answered the adopt')
  assert.equal(toast.text, hostRefusal.message, 'the toast shows the host reason, not a generic failure')
  assert.match(toast.text, /neither blank nor a fork/)
  assert.equal(toast.text.includes('Bot "Brain"'), true)
  assert.equal(toast.text.includes('Session picked'), true)
  const noted = module.exports.clientErrors().find(entry => entry.code === 'bot/adopt-not-blank')
  assert.ok(noted, 'the browser error keeps the refusal code')
  assert.equal(noted.text, `bot-session-adopt: ${hostRefusal.message}`)
})
