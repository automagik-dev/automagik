// RFC 0003 delivery 4, the Bot side: a Bot's team tools are what the ACP bridge offers, a
// call raises the Bot's own DSH approval and posts, and on Auto the bridge call is refused by
// auto-review instead of running. The bridge is simulated at its contract boundary (offer,
// approval under the Session's level, then DSH's tool pipeline); the ACP half is proved in
// apps/acp-dsh/test.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply as applyAutoReview } from '@deepseek-ai/dsh-experimental-auto-review'
import { Session } from '@deepseek-ai/dsh-session'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { until } from './until.js'

// A read-only Session cannot write files, so the bridge hides the file-only mutators. The
// list repeats apps/acp-dsh/src/host/backchannel.js, which owns it for a real bridge.
const MUTATING_TOOLS = new Set(['write', 'edit', 'apply_patch', 'str_replace_editor'])

const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Omni', role: 'Boss', sessionId: 'a', createdAt: 1, permission: 'workspace-write' },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2, permission: 'workspace-write' },
  },
  rooms: { r1: { id: 'r1', name: 'Ops', members: ['a', 'b'], mode: 'admin', admin: 'a', named: true, log: [], seq: 0, seen: {} } },
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
})

async function start() {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-acp-tools-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  const ctx = fakeContext()
  const agents = new Map()
  const sessionOf = (id) => {
    if (!agents.has(id)) {
      const session = Session.create(id)
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 0 })
      const calls = []
      agents.set(id, {
        session,
        calls,
        followup(message) { calls.push(message) },
        steer() {}, inject() {}, cancel() {}, whenIdle: async () => {}, inbox: { nextStep: [], nextTurn: [], remove: () => false },
      })
    }
    return agents.get(id)
  }
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: { create: async () => ({ sessionId: 's1' }), resolveAgent: async sessionId => ({ agent: { id: sessionId, ...sessionOf(sessionId) } }), selectModel: async () => {}, page: async () => ({ records: [], hasMore: false }) },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {}, list: () => [] },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  apply(ctx, { home })
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', {
    method: 'POST', body: JSON.stringify({ endpoint, payload }),
  }))).json()
  const askApproval = (sessionId, extra = {}, next = () => 'allowed-once') => ctx.listeners.get('approval/request')[0](
    { agent: { session: { id: sessionId } }, toolName: 'post_to_group', reason: 'Writer: post_to_group', ...extra }, next,
  )
  // The offered set the bridge would list for this Bot at `level` (the ACP side filters the
  // Session's preset tools exactly so; the Bot team registers the team tools into it).
  const offeredAt = (level) => [...ctx.registeredTools.values()]
    .filter(tool => level !== 'read-only' || !MUTATING_TOOLS.has(tool.name))
    .map(tool => tool.name)
  // One bridge call, in the order the ACP bridge runs it: the offer check, then the level's
  // gate, then DSH's tool pipeline. Auto has no bridge dialog: auto-review's pre-execute is
  // the gate, and this Session has no assistant block for it to read, so it fails closed.
  const bridgeCall = async (sessionId, name, args, { level = 'workspace-write', autoReview, next } = {}) => {
    assert.ok(offeredAt(level).includes(name), `${name} is offered at ${level}`)
    const session = sessionOf(sessionId).session
    const body = async () => {
      const tool = ctx.registeredTools.get(name)
      const value = await tool.execute(args, { agent: { id: sessionId, session }, callId: 'bridge-1' })
      return { isError: false, value }
    }
    if (autoReview !== undefined) {
      const id = 'bridge-1'
      session.append('tool/call', { turn: 1, step: 0, callId: id, name, arguments: JSON.stringify(args) })
      const exec = { callId: id, rootCallId: id, name, arguments: args, agent: { session }, signal: new AbortController().signal }
      const decision = await autoReview(exec, async () => ({ kind: 'allow' }))
      if (decision.kind !== 'allow') return { isError: true, error: decision.info }
      return body()
    }
    const outcome = await askApproval(sessionId, {}, next ?? (() => 'allowed-once'))
    if (outcome !== 'allowed-once') return { isError: true, error: { code: String(outcome).toUpperCase() } }
    return body()
  }
  const stop = async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) }
  await call('state', {})
  return { ctx, agents, call, askApproval, offeredAt, bridgeCall, stop }
}

// Auto review's real pre-execute listener, over the same Session the bridge writes. The
// wrapper runs it exactly where DSH's tool pipeline does, before the body.
function autoReview() {
  const preExecute = []
  const ctx = {
    permissionPresets: { current: () => 'auto', registerAuto: () => () => {} },
    approval: { overrideOf: () => 'never' },
    workingDirectory: { ensure: async () => '/tmp' },
    sessions: { list: () => [] },
    llm: { stream: () => { throw new Error('a refused snapshot never reaches the reviewer') } },
    on: (name, listener) => {
      if (name === 'tools/pre-execute') preExecute.push(listener)
      return () => {}
    },
    effect: (fn) => {
      const iterator = fn()
      let next = iterator.next()
      while (!next.done) next = iterator.next(next.value)
      return next.value
    },
  }
  applyAutoReview(ctx)
  return async (exec, next) => preExecute[0](exec, next)
}

test('a team tool posts to the Bot\'s group through the bridge, and the call carries the approval row', async (t) => {
  const host = await start()
  t.after(host.stop)
  assert.ok(host.offeredAt('workspace-write').includes('post_to_group'))
  let release
  const pending = host.bridgeCall('b', 'post_to_group', { group: 'Ops', message: 'the report is ready' }, {
    next: () => new Promise((resolve) => { release = resolve }),
  })
  await until(async () => (await host.call('state', {})).value.work.approvals.length > 0)
  // The team view lists the call while it waits, under the Bot whose Session asked.
  const { value } = await host.call('state', {})
  const [approval] = value.work.approvals
  assert.deepEqual([approval.botId, approval.tool, approval.answerable], ['b', 'post_to_group', false])
  release('allowed-once')
  const result = await pending
  assert.equal(result.isError, false)
  assert.match(result.value, /^Posted in "Ops"/)
  // The call reached the group: with no round running, the group Session takes the post as
  // its next message, the same way a user's message arrives there.
  const room = host.agents.get('r1')
  assert.match(JSON.stringify(room?.calls ?? []), /the report is ready/)
})

test('an Auto Bot\'s bridge call is refused by auto-review with AUTO_REVIEW_FAILED, and nothing posts', async (t) => {
  const host = await start()
  t.after(host.stop)
  const refusal = await host.bridgeCall('b', 'post_to_group', { group: 'Ops', message: 'should not post' }, { level: 'danger-full-access', autoReview: autoReview() })
  assert.equal(refusal.isError, true)
  assert.equal(refusal.error.code, 'AUTO_REVIEW_FAILED')
  // No silent run: the room has no post, and no approval was left waiting.
  const state = (await host.call('state', {})).value
  assert.deepEqual(state.work.approvals, [])
  assert.equal(JSON.stringify(state.rooms).includes('should not post'), false)
})

test('a read-only Bot is not offered a file-writing tool through the bridge', async (t) => {
  const host = await start()
  t.after(host.stop)
  // A profile's own file tools are part of the same offered set; the bridge hides the ones a
  // read-only sandbox cannot run.
  host.ctx.registeredTools.set('write', { name: 'write' })
  host.ctx.registeredTools.set('edit', { name: 'edit' })
  assert.ok(host.offeredAt('workspace-write').includes('write'))
  assert.equal(host.offeredAt('read-only').includes('write'), false)
  assert.equal(host.offeredAt('read-only').includes('edit'), false)
  // The team tool still is: posting a message is not a file write.
  assert.ok(host.offeredAt('read-only').includes('post_to_group'))
})
