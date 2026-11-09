// The dispatch-time sign-in check (model-access-hooks.js, plan v3 H14): only a Bot's Session on an
// agent route, only a CLI that says it is signed out, and an unknown sign-in passes.
import assert from 'node:assert/strict'
import test from 'node:test'
import { install } from '../src/host/model-access-hooks.js'
import { MODEL_ACCESS_REQUIRED } from '../src/host/model-state.js'

function fixture(access) {
  let stream
  const checked = []
  install({
    ctx: { on(name, listener) { if (name === 'llm/stream') stream = listener } },
    isBotSession: id => id === 'bot-chat',
    async modelAccess(ref) {
      checked.push(ref)
      if (access instanceof Error) throw access
      return typeof access === 'function' ? access(ref) : access
    },
  })
  const dispatched = []
  const next = options => () => {
    dispatched.push(options)
    return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })()
  }
  const run = options => Array.fromAsync(stream(options, next(options)))
  return { checked, dispatched, run, stream }
}

const signedOut = { ready: false, code: 'bot/sign-in-required', message: 'Sign in to Codex CLI (acp-codex) before using this model.' }

test('a Bot on a signed-out agent fails as MODEL_ACCESS_REQUIRED and never dispatches', async () => {
  const h = fixture(signedOut)
  assert.deepEqual(await h.run({ provider: 'acp-codex', model: 'default', sessionId: 'bot-chat' }), [{
    type: 'finish',
    reason: { kind: 'error', failure: { code: MODEL_ACCESS_REQUIRED, message: signedOut.message } },
  }])
  assert.deepEqual(h.dispatched, [])
  assert.deepEqual(h.checked, ['acp-codex/default'])
})

test('an unknown sign-in, any other refusal and a failed check pass to the agent', async () => {
  for (const access of [{ ready: true }, { ready: false, code: 'bot/refused', message: 'Turn on …' }, new Error('check failed'), undefined]) {
    const h = fixture(access)
    assert.deepEqual(await h.run({ provider: 'acp-claude', model: 'default', sessionId: 'bot-chat' }), [{ type: 'finish', reason: { kind: 'stop' } }])
    assert.equal(h.dispatched.length, 1)
  }
})

test('API providers, ordinary DSH Sessions and calls with no Session are never checked', async () => {
  const h = fixture(signedOut)
  for (const options of [
    { provider: 'openai-codex', model: 'gpt', sessionId: 'bot-chat' },
    { provider: 'deepseek', model: 'v4', sessionId: 'bot-chat' },
    { provider: 'acp-codex', model: 'default', sessionId: 'plain-dsh-chat' },
    { provider: 'acp-codex', model: 'default' },
  ]) {
    const original = Symbol('native')
    assert.equal(h.stream(options, () => original), original)
  }
  assert.deepEqual(h.checked, [])
  const original = Symbol('native validation')
  assert.equal(h.stream({}, () => original), original)
})

test('only a turn\'s first call is checked: a call that continues a turn passes without a check', async () => {
  const h = fixture(signedOut)
  const opened = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }
  const context = { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'now' }] }
  const called = { role: 'assistant', content: [{ type: 'tool-call', id: 't1', name: 'read', input: {} }] }
  const result = { role: 'tool', content: [{ type: 'tool-result', id: 't1', output: 'ok' }] }
  for (const messages of [[opened, called, result], [opened, called, result, context]]) {
    const original = Symbol('continuing')
    assert.equal(h.stream({ provider: 'acp-codex', model: 'default', sessionId: 'bot-chat', messages }, () => original), original)
  }
  assert.deepEqual(h.checked, [])
  // A turn that opens, after earlier ones, is checked; so is a message steered in mid-turn.
  for (const messages of [[opened], [opened, called, result, { role: 'assistant', content: [] }, opened, context], [opened, called, result, opened]]) {
    assert.equal((await h.run({ provider: 'acp-codex', model: 'default', sessionId: 'bot-chat', messages }))[0].reason.failure.code, MODEL_ACCESS_REQUIRED)
  }
  assert.equal(h.checked.length, 3)
})
