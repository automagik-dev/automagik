// The ACP library this plugin is built on (#958): what an SDK bump can change is pinned here
// against a real agent process over stdio, the fake one (dev/fake-agent.mjs). The names the code
// asks the library for are checked one by one: a rename in a later SDK fails this file, not a
// Codex preset change a week later.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as sdk from '@agentclientprotocol/sdk/unstable'
import { AgentRun } from '../src/host/acp.js'

const FAKE = join(import.meta.dirname, '..', 'dev', 'fake-agent.mjs')

function fake(t, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'acp-sdk-'))
  const trace = join(dir, 'trace.jsonl')
  const run = new AgentRun({ command: process.execPath, args: [FAKE], env: { FAKE_ACP_TRACE: trace, ...env }, cwd: dir, name: 'Fake agent' })
  t.after(() => {
    run.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const traced = () => readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  return { run, traced, dir }
}

async function drain(run) {
  const events = []
  for (;;) {
    const event = await run.next()
    events.push(event)
    if (event.type === 'end' || event.type === 'error') return events
  }
}

test('the SDK entry still has every name this plugin asks it for', () => {
  assert.equal(typeof sdk.client, 'function')
  assert.equal(typeof sdk.agent, 'function')
  assert.equal(typeof sdk.ndJsonStream, 'function')
  assert.equal(typeof sdk.RequestError?.authRequired, 'function')
  assert.equal(sdk.PROTOCOL_VERSION, 1, 'a new protocol version is a migration, not a bump')
  const { agent, client } = sdk.methods
  assert.deepEqual({
    initialize: agent.initialize,
    new: agent.session.new,
    fork: agent.session.fork,
    close: agent.session.close,
    setMode: agent.session.setMode,
    setConfigOption: agent.session.setConfigOption,
    prompt: agent.session.prompt,
    cancel: agent.session.cancel,
    update: client.session.update,
    requestPermission: client.session.requestPermission,
  }, {
    initialize: 'initialize',
    new: 'session/new',
    fork: 'session/fork',
    close: 'session/close',
    setMode: 'session/set_mode',
    setConfigOption: 'session/set_config_option',
    prompt: 'session/prompt',
    cancel: 'session/cancel',
    update: 'session/update',
    requestPermission: 'session/request_permission',
  })
})

test('one session over stdio: handshake, options, a prompt, a fork and the close of its source', async (t) => {
  const { run, traced, dir } = fake(t)
  await run.start()
  assert.equal(run.init.protocolVersion, sdk.PROTOCOL_VERSION)
  assert.equal(run.option('model')?.currentValue, 'fake-large')
  await run.setOption('model', 'fake-small')
  assert.equal(run.option('model').currentValue, 'fake-small')
  run.prompt([{ type: 'text', text: 'plain' }])
  const events = await drain(run)
  assert.equal(events.at(-1).stopReason, 'end_turn')
  assert.match(events.filter(event => event.type === 'text').map(event => event.text).join(''), /you said "plain"/)
  const source = run.sessionId
  const forked = await run.fork({ cwd: dir, mcpServers: [] })
  assert.notEqual(forked, source)
  const seen = traced()
  assert.ok(seen.some(entry => entry.event === 'fork' && entry.from === source))
  assert.ok(seen.some(entry => entry.event === 'close' && entry.sessionId === source))
})

test('an agent that answers another protocol version does not start, and says what to do', async (t) => {
  const newer = fake(t, { FAKE_ACP_PROTOCOL: '2' })
  await assert.rejects(newer.run.start(), error => error.code === 'acp_protocol_mismatch' && /newer ACP protocol \(version 2\).*update Automagik/.test(error.message))
  const older = fake(t, { FAKE_ACP_PROTOCOL: '0' })
  await assert.rejects(older.run.start(), error => error.code === 'acp_protocol_mismatch' && /update the connector/.test(error.message))
})

test('an update of an unknown kind, and a tool update with no call id, do not end the turn', async (t) => {
  const { run } = fake(t)
  await run.start()
  // The SDK reports each refused notification on the console; the test keeps the run quiet.
  const quiet = t.mock.method(console, 'error', () => {})
  run.prompt([{ type: 'text', text: 'odd-updates' }])
  const events = await drain(run)
  assert.equal(events.at(-1).type, 'end')
  assert.match(events.filter(event => event.type === 'text').map(event => event.text).join(''), /Still here\./)
  assert.equal(run.tools.size, 0, 'no call was made up from the update without an id')
  assert.ok(quiet.mock.callCount() >= 2, 'both were refused at the connection, not passed on')
})

test('a question the agent takes back is withdrawn here, not left waiting for an answer', async (t) => {
  const { run, traced } = fake(t)
  await run.start()
  run.prompt([{ type: 'text', text: 'withdraw' }])
  const first = await run.next()
  const events = [first, ...await drain(run)]
  const call = events.find(event => event.type === 'tool')
  assert.ok(call, 'the call was announced')
  assert.equal(run.tools.get(call.id).permission, undefined, 'no question is left on the call')
  assert.equal(events.at(-1).stopReason, 'end_turn')
  assert.ok(traced().some(entry => entry.event === 'withdrawn'), 'the agent got its answer')
})

test('a withdrawn question answers as cancelled even when nothing was listening yet', async () => {
  const run = new AgentRun({ name: 'probe', cwd: '/' })
  const controller = new AbortController()
  const asked = run.onPermission({ toolCall: { toolCallId: 'c1', title: 'Run?' }, options: [{ optionId: 'yes', kind: 'allow_once' }] }, controller.signal)
  assert.notEqual(run.tools.get('c1').permission, undefined)
  controller.abort()
  assert.deepEqual(await asked, { outcome: { outcome: 'cancelled' } })
  assert.equal(run.tools.get('c1').permission, undefined)
  const late = new AbortController()
  late.abort()
  assert.deepEqual(await run.onPermission({ toolCall: { toolCallId: 'c2', title: 'Run?' }, options: [] }, late.signal), { outcome: { outcome: 'cancelled' } })
})
