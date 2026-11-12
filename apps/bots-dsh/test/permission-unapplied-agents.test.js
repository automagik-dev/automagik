// The "level not applied" rule for a Bot on an ACP agent (Claude Code, Codex). The agent runs
// its own tools under its own mode, which the team's tools/execute guard never reaches, so the
// team also answers acp-dsh's turn gate (`acpAgents.holdTurns`) from the same mark, and ends
// the agent session of a Session the moment it is marked (`acpAgents.endSession`). Both only
// ever refuse. acp-dsh is a fake here: the gates it was given and the sessions it was told to end.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const FULL = 'danger-full-access'
const WRITE = 'workspace-write'
const STOCK = {
  [WRITE]: { sandbox: 'workspace-write', approval: 'ask' },
  [FULL]: { sandbox: 'danger-full-access', approval: 'never' },
}
const AUTO_SPEC = { sandbox: 'danger-full-access', approval: 'ask' }
const refused = level => ({ code: 'bot/refused', message: new RegExp(`^The ${level} permission level could not be set on this conversation, so no tool runs here until it is\\.`) })

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: {
    m1: { id: 'm1', name: 'Omni', role: '', instructions: '', createdAt: 1 },
    b2: { id: 'b2', name: 'Ada', role: '', instructions: '', createdAt: 2 },
  },
  rooms: { r1: { id: 'r1', name: 'Launch', named: true, members: ['m1', 'b2'], mode: 'everyone', notice: '', sessions: { m1: 'g1', b2: 'g2' }, seq: 0, log: [] } },
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

// The whole team over a fake DSH presets service, as in permissions.test.js. `failing`
// holds the Sessions whose set throws; `sets` counts every set DSH was asked for.
function team(t, { acp = true, auto = true, bots = {}, room = {}, tasks, closed = [], presets = true, levels = {}, failing: failingAtStart = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-unapplied-agents-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({ ...TEAM, bots: { m1: { ...TEAM.bots.m1, ...bots.m1 }, b2: { ...TEAM.bots.b2, ...bots.b2 } }, rooms: { r1: { ...TEAM.rooms.r1, ...room } }, ...(tasks ? { tasks } : {}) }))
  const presetOf = new Map(Object.entries(levels))
  const failing = new Set(failingAtStart)
  const sets = []
  const service = {
    auto,
    names: () => [...Object.keys(STOCK), ...(service.auto ? ['auto'] : [])],
    catalog: () => ({ options: service.names().map(value => ({ value, name: value })), defaultOptions: [], defaultPreset: WRITE }),
    resolve: (name) => {
      if (!service.names().includes(name)) throw new Error(`permission: unknown preset "${name}"`)
      return name === 'auto' ? AUTO_SPEC : STOCK[name]
    },
    current: session => presetOf.get(session.id),
    set: (session, name) => {
      service.resolve(name)
      sets.push(`${session.id}=${name}`)
      if (failing.has(session.id)) throw new Error('permission: the Session log refused the write')
      presetOf.set(session.id, name)
    },
  }
  // acp-dsh's service, as the team sees it: the gates it registered, the sessions it ended.
  const gates = []
  const ended = []
  const acpAgents = {
    holdTurns: (gate) => { gates.push(gate); return () => { gates.splice(gates.indexOf(gate), 1) } },
    endSession: (sessionId, why) => { ended.push([sessionId, why]); return true },
  }
  const ctx = fakeContext({ services: { ...(presets ? { permissionPresets: service } : {}), ...(acp === true ? { acpAgents } : acp ? { acpAgents: acp } : {}) } })
  const open = new Set()
  const headers = {}
  let sessions = 0
  Object.assign(ctx, {
    workspaceRegistry: {
      get: () => ({ id: 'w1', path: home }),
      resolveByPath: async path => ({ id: 'w1', path }),
      create: async path => ({ id: 'w1', path }),
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: `s${++sessions}` }),
      async resolveAgent(sessionId) {
        if (closed.includes(sessionId)) return { error: { code: 'gateway/internal', message: `resume failed for session "${sessionId}": Error: permission: cannot restore preset "auto" without its active integration` } }
        const session = { id: sessionId }
        if (!open.has(sessionId)) {
          open.add(sessionId)
          for (const listener of ctx.listeners.get('session/created') ?? []) void Promise.resolve(listener(session)).catch(() => {})
        }
        await new Promise(resolve => setTimeout(resolve, 1))
        return { agent: { session, followup() {} } }
      },
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {}, list: () => [...open].map(id => ({ id })), get: id => (headers[id] ? { header: headers[id] } : undefined) },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  apply(ctx, { home })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const rt = ctx.provided.get('omniTeam')
  t.mock.method(rt, 'warn', () => {})
  // Every refused call tries the apply again, unless a test spaces the tries out.
  rt.levelRetryMs = 0
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))
  // One tool call of a Session through the team's guard, the first tools/execute listener.
  // Resolves 'ran' when the tool's body was reached.
  const tool = (sessionId, { name = 'bash', header } = {}) => ctx.listeners.get('tools/execute')[0](
    { name, arguments: {}, agent: { id: sessionId, session: { id: sessionId, ...(header ? { header } : {}) } } },
    async () => 'ran',
  )
  // DSH opens a Session: its level is set again within the announce.
  const opens = async (sessionId) => {
    for (const listener of ctx.listeners.get('session/created') ?? []) void Promise.resolve(listener({ id: sessionId })).catch(() => {})
    await settle()
  }
  // acp-dsh asking the team before an agent acts for a Session.
  // Bounded: a gate that never answers fails its test, it does not hang the run.
  const turn = (sessionId, header) => {
    let timer
    const late = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('the gate did not answer in 10 s')), 10_000) })
    const answer = Promise.resolve().then(() => gates[0]({ sessionId, provider: 'acp-claude', agent: { id: sessionId, session: { id: sessionId, ...(header ? { header } : {}) } } }))
    return Promise.race([answer, late]).finally(() => clearTimeout(timer))
  }
  return { ctx, rt, service, call, settle, failing, sets, headers, tool, opens, gates, ended, turn, levelOf: id => presetOf.get(id) }
}

const sentence = level => `The ${level} permission level could not be set on this conversation, so no tool runs here until it is. Tell the user: restarting DeepSeek Harness, or changing the permission level, tries again.`

test('the team holds an agent\'s turns on a marked Session with the guard\'s own sentence, and ends its agent session when it marks it', async (t) => {
  const { call, settle, failing, sets, gates, ended, turn, tool, levelOf } = team(t, { room: { permission: FULL }, levels: { g1: FULL, g2: FULL } })
  await call('state', {})
  assert.equal(gates.length, 1, 'one gate registered')
  // Nothing marked: the gate lets every Session go and asks DSH for nothing.
  const before = sets.length
  assert.equal(await turn('g2'), undefined)
  assert.equal(await turn('elsewhere'), undefined)
  assert.equal(sets.length, before)
  assert.deepEqual(ended, [])

  failing.add('g2')
  await call('update-room', { id: 'r1', permission: WRITE })
  await settle()
  assert.deepEqual([levelOf('g1'), levelOf('g2')], [WRITE, FULL])
  // Marked: its agent session was ended at once, with the sentence a step under way answers.
  // (Every failed apply of it ends it; ending one that is gone does nothing.)
  assert.ok(ended.length >= 1)
  for (const entry of ended) assert.deepEqual(entry, ['g2', sentence(WRITE)])
  // And no turn starts there: the same sentence the tool guard refuses with.
  assert.equal(await turn('g2'), sentence(WRITE))
  await assert.rejects(tool('g2'), refused(WRITE))
  // The Session that took the level, and any other, is let go.
  assert.equal(await turn('g1'), undefined)
  assert.equal(await turn('b2'), undefined)

  // Each ask tries the apply again; once it holds, the turn starts and the mark is gone.
  failing.clear()
  assert.equal(await turn('g2'), undefined)
  assert.equal(levelOf('g2'), WRITE)
  const after = sets.length
  assert.equal(await turn('g2'), undefined)
  assert.equal(sets.length, after, 'nothing more is asked of a Session whose level holds')
  assert.equal(await tool('g2'), 'ran')
})

test('a subagent child of a marked Session is held too', async (t) => {
  const { call, settle, failing, headers, turn } = team(t, { room: { permission: FULL }, levels: { g1: FULL, g2: FULL } })
  await call('state', {})
  failing.add('g2')
  await call('update-room', { id: 'r1', permission: WRITE })
  await settle()
  headers.child = { origin: 'subagent', parentSession: 'g2' }
  headers.other = { origin: 'subagent', parentSession: 'g1' }
  assert.equal(await turn('child', headers.child), sentence(WRITE))
  assert.equal(await turn('other', headers.other), undefined)
})

test('marking a Session ends the agent sessions of its open subagent children too, and of no other Session', async (t) => {
  const { ctx, call, settle, failing, headers, ended } = team(t, { room: { permission: FULL }, levels: { g1: FULL, g2: FULL } })
  await call('state', {})
  // Open Sessions DSH lists: a child and a grandchild of g2 mid-prompt, a child of g1, a stranger.
  headers.child = { origin: 'subagent', parentSession: 'g2' }
  headers.grandchild = { origin: 'subagent', parentSession: 'child' }
  headers.other = { origin: 'subagent', parentSession: 'g1' }
  const list = ctx.sessions.list
  ctx.sessions.list = () => [...list(), { id: 'child', header: headers.child }, { id: 'grandchild' }, { id: 'other', header: headers.other }, { id: 'stranger' }, {}]
  failing.add('g2')
  await call('update-room', { id: 'r1', permission: WRITE })
  await settle()
  const ids = new Set(ended.map(([id]) => id))
  assert.deepEqual([...ids].sort(), ['child', 'g2', 'grandchild'])
  for (const [, why] of ended) assert.equal(why, sentence(WRITE))
})

test('a Sessions list that throws still ends the marked Session itself', async (t) => {
  const { ctx, call, settle, failing, ended, tool } = team(t, { room: { permission: FULL }, levels: { g1: FULL, g2: FULL } })
  await call('state', {})
  ctx.sessions.list = () => { throw new Error('not now') }
  failing.add('g2')
  await call('update-room', { id: 'r1', permission: WRITE })
  await settle()
  assert.deepEqual([...new Set(ended.map(([id]) => id))], ['g2'])
  await assert.rejects(tool('g2'), refused(WRITE))
})

test('a Session marked again by a retry that fails ends its agent session again, and a restart marks and ends it', async (t) => {
  const { call, failing, ended, turn, opens } = team(t, { room: { permission: WRITE }, levels: { g2: FULL }, failing: ['g2'] })
  await call('state', {})
  await opens('g2')
  assert.deepEqual(ended.at(-1), ['g2', sentence(WRITE)])
  const count = ended.length
  assert.equal(await turn('g2'), sentence(WRITE))
  assert.ok(ended.length > count, 'the failed retry ended it again')
  failing.clear()
  assert.equal(await turn('g2'), undefined)
})

test('a failure that is not the refusal is thrown to acp-dsh, never answered as text', async (t) => {
  const { rt, call, settle, failing, turn } = team(t, { room: { permission: FULL }, levels: { g1: FULL, g2: FULL } })
  await call('state', {})
  failing.add('g2')
  await call('update-room', { id: 'r1', permission: WRITE })
  await settle()
  t.mock.method(rt, 'load', async () => { throw new Error('EACCES: /home/someone/state.json') })
  await assert.rejects(turn('g2'), /EACCES/)
})

test('acp-dsh without the new methods, an endSession that throws, or no acp-dsh at all: the team marks and guards as before', async (t) => {
  for (const acp of [false, {}, { keepImages: () => () => {} }, { holdTurns: () => undefined, endSession: () => { throw new Error('gone') } }]) {
    const { call, settle, failing, tool, levelOf } = team(t, { acp, room: { permission: FULL }, levels: { g1: FULL, g2: FULL } })
    await call('state', {})
    failing.add('g2')
    await call('update-room', { id: 'r1', permission: WRITE })
    await settle()
    assert.equal(levelOf('g2'), FULL)
    await assert.rejects(tool('g2'), refused(WRITE))
    assert.equal(await tool('g1'), 'ran')
  }
})

test('the gate goes when the team is disposed', async (t) => {
  const { ctx, call, gates } = team(t)
  await call('state', {})
  assert.equal(gates.length, 1)
  await ctx.dispose()
  assert.equal(gates.length, 0)
})
