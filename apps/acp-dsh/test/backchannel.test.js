// The bridge→DSH leg and its probes (RFC 0003, amendment, deliveries 4 and 6): the credential
// binds a request to its Session and is revoked with it; a missing or foreign one is refused; a
// credential alone cannot approve; every DSH tool call enters DSH's approval service before it
// runs; and the offered set is the preset's, filtered by the Session's level.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session, pluginRecordOf } from '@deepseek-ai/dsh-session'
import { Backchannel, offeredTools, positionOf, recordDrift, signatureOf } from '../src/host/backchannel.js'
import { TOOL_NAME } from '../src/host/tool.js'

const TOOLS = [
  { name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: { command: { type: 'string' } } } },
  { name: 'write', description: 'Write a file', parameters: { type: 'object', properties: { file_path: { type: 'string' } } } },
  { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { file_path: { type: 'string' } } } },
]

function host({ sandbox = 'workspace-write', policy = 'ask', answer = 'allowed-once', tools = TOOLS, preset = 'standard', definitions = tools } = {}) {
  const session = Session.create('s1')
  session.append('turn/start', { turn: 3 })
  session.append('step/start', { turn: 3, step: 1 })
  const agent = { session }
  const asked = []
  const executed = []
  const ctx = {
    agents: { turnBoundaryOf: () => ({ lastTurn: 3 }) },
    get: (name) => {
      if (name === 'tools') {
        return {
          definitions: () => definitions,
          executable: toolName => definitions.find(definition => definition.name === toolName),
          execute: async ({ calls }) => {
            executed.push({ name: calls[0].name, arguments: calls[0].arguments })
            return { results: [{ callId: calls[0].id, result: { content: [{ type: 'text', text: `ran ${calls[0].name}` }], isError: false } }] }
          },
        }
      }
      if (name === 'approval') {
        return {
          effectivePolicy: () => policy,
          request: async (request) => {
            asked.push(request)
            // The real service rejects every ask deterministically under `never`.
            if (policy === 'never') return 'rejected'
            return typeof answer === 'function' ? answer(request) : answer
          },
        }
      }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: sandbox }) }
      if (name === 'agentPresets') return { presetForSession: () => preset }
      return undefined
    },
  }
  const backchannel = new Backchannel({ ctx })
  return { ctx, agent, session, asked, executed, backchannel }
}

async function serve() {
  const host_ = host()
  const bc = host_.backchannel
  await bc.listen()
  const record = bc.mint({ sessionId: 's1', agent: host_.agent, name: 'Fake agent' })
  // As after `session/new` in a real turn: the bridge may announce from now on.
  bc.announce(record)
  const post = async (op, body = {}, credential = record.credential, url = bc.urlFor(record)) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(credential === null ? {} : { authorization: `Bearer ${credential}` }) },
      body: JSON.stringify({ op, ...body }),
    })
    return { status: response.status, body: await response.json() }
  }
  return { ...host_, bc, record, post }
}

test('a request without a credential, with another Session\'s, or after revocation is refused', async () => {
  const h = await serve()
  try {
    assert.equal((await h.post('list', {}, null)).status, 401)
    assert.equal((await h.post('list', {}, '')).status, 401)
    // Another Session's credential, minted for a different Session in the same plugin instance.
    // One Session's credential is refused on another Session's channel, even while it is live.
    const foreign = h.bc.mint({ sessionId: 's2', agent: h.agent, name: 'Other' })
    assert.equal((await h.post('list', {}, foreign.credential)).status, 401)
    assert.equal((await h.post('list', {}, h.record.credential, h.bc.urlFor(foreign))).status, 401)
    // A signature-identical but unknown value is refused too.
    assert.equal((await h.post('list', {}, 'f'.repeat(64))).status, 401)
    assert.equal((await h.post('list')).status, 200)
    h.bc.revoke(h.record)
    assert.equal((await h.post('list')).status, 401)
    assert.equal((await h.post('call', { name: 'bash' })).status, 401)
  } finally {
    h.bc.dispose()
  }
})

test('the bridge lists the preset\'s tools, never the mirror, and hides file writers in read-only', async () => {
  const h = await serve()
  try {
    const listed = await h.post('list')
    assert.deepEqual(listed.body.tools.map(tool => tool.name), ['bash', 'write', 'read'])
    const readOnly = host({ sandbox: 'read-only', definitions: [...TOOLS, { name: TOOL_NAME, description: 'mirror', parameters: { type: 'object' } }] })
    assert.deepEqual(offeredTools(readOnly.ctx, readOnly.agent).map(tool => tool.name), ['bash', 'read'])
    // A conditional tool has no call outside a model step, so it is not offered either.
    const conditional = { ...TOOLS[0], name: 'web_search' }
    const withCondition = host()
    withCondition.ctx.get('tools').executable = name => (name === 'web_search' ? undefined : TOOLS.find(tool => tool.name === name))
    withCondition.ctx.get('tools').definitions = () => [...TOOLS, conditional]
    assert.deepEqual(offeredTools(withCondition.ctx, withCondition.agent).map(tool => tool.name), ['bash', 'write', 'read'])
  } finally {
    h.bc.dispose()
  }
})

test('a DSH tool call asks DSH before it runs, then writes the call and its result rows', async () => {
  const h = await serve()
  try {
    const answer = await h.post('call', { name: 'bash', arguments: { command: 'echo hi' }, callId: 'bridge-1' })
    assert.equal(answer.body.isError, false)
    assert.deepEqual(answer.body.content, [{ type: 'text', text: 'ran bash' }])
    assert.equal(h.asked.length, 1)
    assert.equal(h.asked[0].toolName, 'bash')
    assert.equal(h.asked[0].callId, 'bridge-1')
    assert.equal(h.asked[0].agent, h.agent)
    assert.match(h.asked[0].reason, /Fake agent: bash/)
    assert.deepEqual(h.executed, [{ name: 'bash', arguments: '{"command":"echo hi"}' }])
    const events = h.session.snapshotEvents()
    const call = events.find(event => event.type === 'tool/call')
    assert.deepEqual({ turn: call.data.turn, step: call.data.step, callId: call.data.callId, name: call.data.name }, { turn: 3, step: 1, callId: 'bridge-1', name: 'bash' })
    const result = events.find(event => event.type === 'tool/result')
    assert.equal(result.data.message.role, 'tool')
    assert.equal(result.data.message.toolCallId, 'bridge-1')
    assert.equal(result.surfaceOp, 'append')
    assert.deepEqual(result.sourceEventSeqs, [call.seq])
    // The order the person sees: the call row, then the question, then the result.
    assert.ok(call.seq < result.seq)
  } finally {
    h.bc.dispose()
  }
})

test('a refusal or an unavailable approval never runs the tool, and the agent gets an error', async () => {
  for (const answer of ['rejected', 'unavailable', 'cancelled']) {
    const run = host({ answer })
    await run.backchannel.listen()
    const record = run.backchannel.mint({ sessionId: 's1', agent: run.agent, name: 'Fake agent' })
    const response = await fetch(run.backchannel.urlFor(record), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${record.credential}` },
      body: JSON.stringify({ op: 'call', name: 'bash', arguments: {}, callId: 'c1' }),
    })
    const body = await response.json()
    assert.equal(body.isError, true)
    assert.match(body.content[0].text, /bash/)
    assert.equal(run.executed.length, 0, `${answer} never runs the tool`)
    const result = run.session.snapshotEvents().find(event => event.type === 'tool/result')
    assert.equal(result.data.message.isError, true)
    run.backchannel.dispose()
  }
  // Under `never` (Auto) the service rejects without prompting: the credential alone cannot approve.
  const auto = host({ policy: 'never' })
  await auto.backchannel.listen()
  const record = auto.backchannel.mint({ sessionId: 's1', agent: auto.agent, name: 'Fake agent' })
  const response = await fetch(auto.backchannel.urlFor(record), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${record.credential}` }, body: JSON.stringify({ op: 'call', name: 'bash' }) })
  assert.equal((await response.json()).isError, true)
  assert.equal(auto.asked.length, 1)
  assert.equal(auto.executed.length, 0)
  auto.backchannel.dispose()
})

test('full access runs a DSH tool call with no dialog, as it does DSH\'s own tools', async () => {
  const run = host({ sandbox: 'danger-full-access', policy: 'never' })
  await run.backchannel.listen()
  const record = run.backchannel.mint({ sessionId: 's1', agent: run.agent, name: 'Fake agent' })
  const response = await fetch(run.backchannel.urlFor(record), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${record.credential}` },
    body: JSON.stringify({ op: 'call', name: 'bash', arguments: {} }),
  })
  const body = await response.json()
  assert.equal(body.isError, false)
  assert.equal(run.asked.length, 0)
  assert.equal(run.executed.length, 1)
  run.backchannel.dispose()
})

test('a changed preset or level is a new signature, a new generation, and a waiting bridge is woken', async () => {
  const h = await serve()
  try {
    let preset = 'standard'
    let mode = 'workspace-write'
    const original = h.ctx.get
    h.ctx.get = (name) => {
      if (name === 'agentPresets') return { presetForSession: () => preset }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode }) }
      return original(name)
    }
    const before = h.record.generation
    // No change: the signature is stable.
    assert.equal(h.bc.refresh(h.record), false)
    const waiting = h.post('wait', { generation: h.record.generation, timeoutMs: 5_000 })
    // A level change reaches the bridge as a new list.
    mode = 'read-only'
    assert.equal(h.bc.refresh(h.record), true)
    const woken = await waiting
    assert.ok(woken.body.generation > before)
    assert.ok((await h.post('list')).body.generation > before)
    // The preset is part of the same fingerprint: creator mode's cordis preset is a change too.
    preset = 'cordis'
    assert.equal(h.bc.refresh(h.record), true)
    assert.equal(signatureOf(h.ctx, h.agent), h.record.signature)
  } finally {
    h.bc.dispose()
  }
})

test('a revoked bridge wakes its long poll and ends its calls', async () => {
  const h = await serve()
  const waiting = h.post('wait', { generation: h.record.generation, timeoutMs: 10_000 })
  // Wait until the poll is parked, so the revocation is what answers it.
  const deadline = Date.now() + 2_000
  while (h.record.waiters.size === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(h.record.waiters.size, 1)
  h.bc.revoke(h.record)
  const answer = await waiting
  assert.equal(answer.body.closed, true)
  assert.equal(h.bc.records.size, 0)
  h.bc.dispose()
})

test('a credential revoked while its approval is pending never runs the tool and the caller is refused', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const run = host({ answer: () => gate })
  await run.backchannel.listen()
  const record = run.backchannel.mint({ sessionId: 's1', agent: run.agent, name: 'Fake agent' })
  run.backchannel.announce(record)
  const pending = fetch(run.backchannel.urlFor(record), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${record.credential}` },
    body: JSON.stringify({ op: 'call', name: 'bash', arguments: {}, callId: 'race-1' }),
  })
  // Revoke while the ask is parked, then let it resolve allowed-once: the late grant loses.
  const deadline = Date.now() + 2_000
  while (run.asked.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(run.asked.length, 1, 'the approval was pending')
  run.backchannel.revoke(record)
  release('allowed-once')
  const response = await pending
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'refused' })
  assert.equal(run.executed.length, 0, 'the tool body never ran after revocation')
  // The call row was written before the ask; no result row claims a run.
  const rows = run.session.snapshotEvents()
  assert.equal(rows.filter(event => event.type === 'tool/call').length, 1)
  assert.equal(rows.filter(event => event.type === 'tool/result').length, 0)
  run.backchannel.dispose()
})

test('drift is a plugin record that replay can carry: plugin:acp-dsh/toolset-drift', () => {
  const session = Session.create('s1')
  assert.equal(recordDrift(session, { name: 'Bash', title: 'Bash: ls', provider: 'acp-claude' }), true)
  const record = pluginRecordOf(session.snapshotEvents().at(-1))
  assert.equal(record.type, 'plugin:acp-dsh/toolset-drift')
  assert.deepEqual(record.data, { name: 'Bash', title: 'Bash: ls', provider: 'acp-claude' })
})

test('the turn position for the bridge\'s rows comes from the log the Session already committed', () => {
  const h = host()
  assert.deepEqual(positionOf(h.ctx, h.session), { turn: 3, step: 1 })
})
