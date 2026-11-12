import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HermesTransport } from '../src/host/hermes-transport.js'
import { desktop8Session } from './fixtures/hermes-desktop8.mjs'

function wire(rows, profile = 'sample') {
  const transport = new HermesTransport({ address: 'https://example.invalid', credential: 'fixture', profile })
  const calls = []
  transport.request = async (method, params) => {
    calls.push({ method, params })
    if (method === 'session.list') return { sessions: rows }
    if (method === 'session.resume') return desktop8Session('runtime', params.session_id).live
    throw Error(`Unexpected mutation: ${method}`)
  }
  return { transport, calls }
}

test('paired transport resolves exact Bot Chat on every open and follows compression tip', async () => {
  const rows = [{ id: 'root', resolved_id: 'tip', title: 'Bot Chat' }]
  const { transport, calls } = wire(rows)
  const identity = { canonicalBot: true, storedSessionId: 'stale' }
  const result = await transport.session(identity)
  assert.equal(result.stored_session_id, 'tip')
  assert.deepEqual(calls.map(call => call.method), ['session.list', 'session.resume'])
  assert.equal(calls[0].params.title, 'Bot Chat')
  assert.equal(calls[1].params.session_id, 'tip')
  rows[0].resolved_id = 'next-tip'
  assert.equal((await transport.session(identity)).stored_session_id, 'next-tip')
})

test('absent, ambiguous, wrong-title and wrong-profile pairings refuse without creating or submitting', async () => {
  for (const rows of [[], [{ id: 'x', title: 'Bot Chat #2' }], [{ id: 'x', title: 'Bot Chat' }, { id: 'y', title: 'Bot Chat' }]]) {
    const { transport, calls } = wire(rows)
    await assert.rejects(transport.session({ canonicalBot: true }), /Bot Chat/)
    assert.ok(calls.every(call => call.method === 'session.list'))
  }
  const { transport } = wire([{ id: 'x', title: 'Bot Chat' }], 'wrong-profile')
  await assert.rejects(transport.session({ canonicalBot: true }), /profile/i)
})

test('uncertain admission cannot silently jump to a replacement canonical chat', async () => {
  const { transport, calls } = wire([{ id: 'new-root', title: 'Bot Chat' }])
  await assert.rejects(transport.session({ canonicalBot: true, storedSessionId: 'old-root', pendingSubmit: true }), /changed|reconcile/i)
  assert.equal(calls.length, 1)
})
