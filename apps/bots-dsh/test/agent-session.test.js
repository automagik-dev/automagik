import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAgentSession } from '../src/client/sources.js'

// A Bot's chat and a group chat are team conversations. Whatever an agent's session
// list (or the cache of the last pull) says, they keep the team's conversation cells,
// so DSH never draws its own transcript in their place (#139).
const roster = ready => ({
  ready,
  byId: { bot: { id: 'bot' } },
  roomsById: { room: { id: 'room' } },
  agentOf: { 'agent-session': 'a1', room: 'a1', bot: 'a1' },
})

test('a Bot or group session is never a plain DSH session', () => {
  assert.equal(isAgentSession(roster(true), new Set(), 'agent-session'), true)
  assert.equal(isAgentSession(roster(true), new Set(), 'room'), false)
  assert.equal(isAgentSession(roster(true), new Set(), 'bot'), false)
})

test('before the roster arrives the cache still answers', () => {
  const empty = { ready: false, byId: {}, roomsById: {}, agentOf: {} }
  assert.equal(isAgentSession(empty, new Set(['agent-session']), 'agent-session'), true)
  assert.equal(isAgentSession(empty, new Set(), 'agent-session'), false)
})
