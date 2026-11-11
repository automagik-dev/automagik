// The fork's wait for its bridge holds the event loop (#864).
//
// A preset or level change on an agent that takes a new tool set only through a fork makes the
// adapter fork the ACP session and then wait for the new bridge's first `tools/list`. That wait
// polls on a timer that does not hold the event loop, the agent's process and pipes do not hold
// it either, and nor does the back-channel's server. When the fork's bridge never starts, the
// source bridge's sockets are the last thing that does, and they close with the source session.
// So the wait must hold the loop itself (`held`, around the whole fork). Without that hold the
// loop ran empty with the turn still pending: under `node --test` on Node 22 every test still to
// run was cancelled ("Promise resolution is still pending but the event loop has already
// resolved"), while the runner of Node 24.9 keeps such a process alive and hid it.
//
// These rows read the run's own hold, so they fail the same way on every Node: when a wait for
// a bridge begins, when it ends, and each time the wait looks whether its bridge has listed
// (first on entry, then on coming back from each poll: the adapter's own steps, not moments
// the test picks). While a wait is suspended it is also looked at every few milliseconds from
// a timer of the row's own; those looks are extra, and nothing counts on how many happen.
// "Holds" is checked three ways: the hold is set, it is referenced, and it is a live timer
// that Node counts among what keeps the loop. The rows keep the event loop themselves, so a
// regression is a failed assertion and never a cancelled file; that also means they prove the
// hold at those points, not the loop's life by any other measure (a hold dropped and taken
// back between two looks is not seen).
// The real adapter and Backchannel, and the fake agent over stdio, as adapter.test.js.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { Session } from '@deepseek-ai/dsh-session'
import { AcpAdapter } from '../src/host/adapter.js'
import { Backchannel } from '../src/host/backchannel.js'
import { TOOL_NAME } from '../src/host/tool.js'

const FAKE = join(import.meta.dirname, '..', 'dev', 'fake-agent.mjs')
const MESSAGES = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'bridge bash' }] }]
const traceEvents = path => (existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [])

// One Session on the fake agent with DSH's tools over the bridge, on an agent that follows a
// tool change through a fork.
function forkHost({ trace, env = {}, spec: extra = {} }) {
  const session = Session.create('s1')
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 0 })
  const definitions = [
    { name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: {} } },
    { name: 'write', description: 'Write a file', parameters: { type: 'object', properties: {} } },
  ]
  const agent = { session, ctx: { tools: { register: () => () => {} } } }
  const ctx = {
    agents: { get: () => agent, turnBoundaryOf: () => ({ lastTurn: 1 }) },
    get: (name) => {
      if (name === 'tools') {
        return {
          definitions: () => [...definitions, { name: TOOL_NAME, description: 'mirror', parameters: { type: 'object' } }],
          executable: toolName => definitions.find(definition => definition.name === toolName),
          execute: async ({ calls }) => ({ results: [{ callId: calls[0].id, result: { content: [{ type: 'text', text: `ran ${calls[0].name}` }], isError: false } }] }),
        }
      }
      if (name === 'approval') return { effectivePolicy: () => 'ask', request: async () => 'allowed-once' }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write' }) }
      if (name === 'agentPresets') return { presetForSession: () => 'standard' }
      return undefined
    },
    logger: { warn: () => {}, info: () => {} },
  }
  const spec = {
    name: 'Fake agent',
    catalog: { models: async () => [{ id: 'default', name: 'Fake agent' }], model: async () => undefined, ownEffort: () => undefined, dispose() {} },
    installed: () => true,
    spawn: () => ({ command: process.execPath, args: [FAKE], env: { FAKE_ACP_TRACE: trace, ...env } }),
    refresh: 'fork',
    ...extra,
  }
  const backchannel = new Backchannel({ ctx })
  const adapter = new AcpAdapter(ctx, new Map([['acp-fake', spec]]), { dshTools: () => true, backchannel })
  // `run.hold` is the run's own keep-alive (acp.js `holdOn`): an interval, set while any of its
  // work is held. It holds the event loop only while it is a live timer and referenced. Node
  // lists the timers that keep the loop; one that is among them leaves the list when it is
  // unreferenced, so taking its reference away for an instant shows whether it was counted (a
  // timer that already fired, or was cleared, changes nothing there).
  const loopTimers = () => process.getActiveResourcesInfo().filter(kind => kind === 'Timeout').length
  const holding = () => {
    const hold = adapter.live.get('s1')?.run?.hold
    if (hold === undefined || hold === null || hold.hasRef?.() !== true) return false
    const counted = loopTimers()
    hold.unref()
    const without = loopTimers()
    hold.ref()
    return counted - without === 1
  }
  // Every wait for a bridge: whether the run held the event loop when the wait began and when
  // it ended (the adapter's own promise settling); at each of the wait's own checks of its
  // bridge (`checks`: it reads `listed` on entry and after every poll, so there is always at
  // least one, and one more for each poll it came back from); and at every look in between
  // (`during`: a timer of the row's own, which only fires while the wait is suspended).
  const waits = []
  const lookers = new Set()
  const ready = adapter.ready.bind(adapter)
  adapter.ready = async (agent, state, ...rest) => {
    const wait = { heldAtStart: holding(), checks: [], during: [] }
    waits.push(wait)
    // The wait's own reads of `listed`, seen through the record it reads them from.
    const record = state.bridge
    let listed = record.listed
    let watching = true
    Object.defineProperty(record, 'listed', {
      configurable: true,
      enumerable: true,
      get: () => { if (watching) wait.checks.push(holding()); return listed },
      set: (value) => { listed = value },
    })
    const looking = setInterval(() => wait.during.push(holding()), LOOK_MS)
    lookers.add(looking)
    try {
      await ready(agent, state, ...rest)
      wait.outcome = 'listed'
    } catch (error) {
      wait.outcome = error?.code ?? 'failed'
      throw error
    } finally {
      watching = false
      clearInterval(looking)
      lookers.delete(looking)
      Object.defineProperty(record, 'listed', { configurable: true, enumerable: true, writable: true, value: listed })
      wait.heldAtEnd = holding()
    }
  }
  // Each part is closed whatever the others do, a look still running included (a wait that
  // never settles never reaches its own cleanup). Once closed, no turn starts: a row given up
  // on may still be running, and must not start an agent or a bridge after its cleanup.
  let closed = false
  const close = () => {
    closed = true
    for (const looking of lookers) clearInterval(looking)
    lookers.clear()
    try { adapter.dispose() } finally { backchannel.dispose() }
  }
  const turn = async () => {
    if (closed) throw new Error('the row is over: no turn starts after its cleanup')
    return step(adapter)
  }
  return { adapter, backchannel, definitions, waits, holding, turn, close }
}

// How often a pending wait is looked at: several times inside one poll of the adapter's (25 ms).
const LOOK_MS = 5
// A wait as the rows compare it: its two ends and its outcome, without the looks in between.
const endsOf = ({ heldAtStart, outcome, heldAtEnd }) => ({ heldAtStart, outcome, heldAtEnd })

async function step(adapter) {
  const chunks = []
  for await (const chunk of adapter.stream(markAgentLoopRequest({ provider: 'acp-fake', model: 'default', sessionId: 's1', messages: MESSAGES }))) chunks.push(chunk)
  return chunks
}

// How long a row may take before it is given up, with what it was doing. Far above what a
// turn takes (well under a second); it only keeps a regression from hanging the file.
const GIVE_UP_MS = 60_000

// The body of a row, with the event loop kept by the row itself, a folder for the trace, and
// an end even when a turn never settles: the host is closed and the row fails naming the phase.
async function kept(prefix, options, body) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const keep = setInterval(() => {}, 1 << 30)
  let h
  let phase = 'starting'
  let watchdog
  const gaveUp = new Promise((_, fail) => {
    watchdog = setTimeout(() => fail(new Error(`the row did not end within ${GIVE_UP_MS / 1000} s (${phase})`)), GIVE_UP_MS)
  })
  try {
    h = forkHost({ trace: join(dir, 'trace.ndjson'), ...options })
    await Promise.race([body(h, join(dir, 'trace.ndjson'), (next) => { phase = next }), gaveUp])
  } finally {
    // Every step of the cleanup runs, and none of them hides why the row failed.
    clearTimeout(watchdog)
    clearInterval(keep)
    try { h?.close() } catch {}
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

test('#864: a fork whose bridge never lists waits for it with the event loop held, then fails the turn', () => kept('acp-dsh-fork-hold-', { spec: { bridgeReadyMs: 250 }, env: { FAKE_ACP_FORK_SKIP_MCP: '1' } }, async (h, trace, at) => {
  at('the first turn')
  const first = await h.turn()
  assert.equal(first.at(-1).reason.kind, 'stop')
  // Between turns the run holds nothing: what holds the next wait is that wait's own hold.
  assert.equal(h.holding(), false)
  h.definitions.push({ name: 'extra', description: 'Extra', parameters: { type: 'object', properties: {} } })
  at('the turn that forks')
  const second = await h.turn()
  // The first turn's wait is the start's; the second is the fork's, the one of this issue.
  assert.equal(h.waits.length, 2)
  assert.deepEqual(endsOf(h.waits[0]), { heldAtStart: true, outcome: 'listed', heldAtEnd: true })
  assert.deepEqual(endsOf(h.waits[1]), { heldAtStart: true, outcome: 'acp_bridge_missing', heldAtEnd: true })
  // Held at each of the wait's own checks of its bridge (at least the first, whatever the
  // machine's load), and at every look while it was suspended.
  for (const wait of h.waits) {
    assert.ok(wait.checks.length > 0, 'the wait checked its bridge')
    assert.deepEqual(wait.checks.filter(held => held !== true), [], `held at each of ${wait.checks.length} checks`)
    assert.deepEqual(wait.during.filter(held => held !== true), [], `held at each of ${wait.during.length} looks`)
  }
  // What the turn does about it is unchanged: it fails closed.
  assert.equal(second.at(-1).reason.kind, 'error')
  assert.match(second.at(-1).reason.failure.message, /would not refresh its DSH tools/)
  assert.equal(second.at(-1).reason.failure.code, 'acp_bridge_missing')
  const events = traceEvents(trace)
  const fork = events.find(event => event.event === 'fork')
  assert.ok(fork, 'the session was forked')
  assert.equal(events.filter(event => event.event === 'prompt' && event.sessionId === fork.sessionId).length, 0)
  assert.equal(events.filter(event => event.event === 'mcp-list' && event.sessionId === fork.sessionId).length, 0)
  assert.equal(h.adapter.live.size, 0)
  assert.equal(h.backchannel.records.size, 0)
}))

test('#864: a fork whose bridge lists is waited for with the event loop held too, and the turn goes on', () => kept('acp-dsh-fork-hold-ok-', {}, async (h, trace, at) => {
  at('the first turn')
  await h.turn()
  assert.equal(h.holding(), false)
  h.definitions.push({ name: 'extra', description: 'Extra', parameters: { type: 'object', properties: {} } })
  at('the turn that forks')
  const second = await h.turn()
  assert.equal(h.waits.length, 2)
  assert.deepEqual(endsOf(h.waits[0]), { heldAtStart: true, outcome: 'listed', heldAtEnd: true })
  assert.deepEqual(endsOf(h.waits[1]), { heldAtStart: true, outcome: 'listed', heldAtEnd: true })
  // A bridge that lists has listed before the session answer, so these waits check once and
  // may not suspend at all; whatever was seen of them was held.
  for (const wait of h.waits) {
    assert.ok(wait.checks.length > 0, 'the wait checked its bridge')
    assert.deepEqual(wait.checks.filter(held => held !== true), [])
    assert.deepEqual(wait.during.filter(held => held !== true), [])
  }
  assert.equal(second.at(-1).reason.kind, 'stop')
  // Held for the wait, not for good: the turn over, the run holds nothing again.
  assert.equal(h.holding(), false)
  const events = traceEvents(trace)
  const fork = events.find(event => event.event === 'fork')
  assert.equal(events.filter(event => event.event === 'prompt' && event.sessionId === fork.sessionId).length, 1)
}))
