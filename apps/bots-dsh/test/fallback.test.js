import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fallbackFor, fallbackNotice, install, KEEP_CODES } from '../src/host/fallback.js'

const OPENAI = { provider: 'openai', model: 'gpt-5.4-mini', reasoningEffort: 'high' }
const DEEPSEEK = { provider: 'deepseek-official', model: 'deepseek-flash' }

test('a failed model moves to the fallback, except what another model cannot answer better', () => {
  assert.deepEqual(fallbackFor({ failure: { code: 'INVALID_REQUEST' }, failed: OPENAI, fallback: DEEPSEEK }), DEEPSEEK)
  for (const code of ['AUTH', 'QUOTA', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'PROVIDER_ERROR', 'PI_AI_ERROR', 'MISSING_CREDENTIAL']) {
    assert.deepEqual(fallbackFor({ failure: { code }, failed: OPENAI, fallback: DEEPSEEK }), DEEPSEEK, code)
  }
  for (const code of KEEP_CODES) assert.equal(fallbackFor({ failure: { code }, failed: OPENAI, fallback: DEEPSEEK }), undefined, code)
  // Already on the fallback: a fallback that fails too ends the turn, it does not loop.
  assert.equal(fallbackFor({ failure: { code: 'SERVER' }, failed: DEEPSEEK, fallback: DEEPSEEK }), undefined)
  assert.equal(fallbackFor({ failure: { code: 'SERVER' }, failed: OPENAI, fallback: undefined }), undefined)
  assert.equal(fallbackFor({ failure: { code: 'SERVER' }, failed: undefined, fallback: DEEPSEEK }), undefined)
})

test('the notice names the model that failed, why, and the one the next turn continues with', () => {
  const notice = fallbackNotice(OPENAI, DEEPSEEK, { code: 'INVALID_REQUEST', message: 'OpenAI API error (400): Missing namespace\nmore' })
  assert.match(notice.content[0].text, /^\[model fallback: openai\/gpt-5\.4-mini failed \(INVALID_REQUEST: OpenAI API error \(400\): Missing namespace\); the next turn continues with deepseek-official\/deepseek-flash\]$/)
  assert.equal(notice.source.kind, 'model-selection')
  assert.equal(notice.source.form, 'notice')
})

// The hooks as DSH runs them: a waterfall where each listener gets `next`, and the Agent's
// model choice (agent.model.select/current) plus its followup wake, dsh 0.2.2's contract.
function harness({ isBot = true, config = {}, defaultModel = 'deepseek-official/deepseek-flash' } = {}) {
  const hooks = new Map()
  const warnings = []
  const ctx = { on: (name, listener, options) => hooks.set(name, { listener, options }) }
  install({ ctx, config, isBotSession: () => isBot, defaultModel: async () => defaultModel, botOf: () => ({ name: 'Ops' }), warn: (...args) => warnings.push(args) })
  const selected = []
  const followed = []
  const agent = {
    id: 'bot-1',
    model: {
      current: () => selected.at(-1),
      select: (selection) => selected.push(selection),
    },
    followup: (message) => followed.push(message),
    session: { id: 'bot-1', requestHeader: () => ({ config: OPENAI }), append: () => {} },
  }
  const failed = (failure, turn = 3, inner = undefined) => hooks.get('agent/request-error').listener({ agent, turn, step: 1, failure, signal: { aborted: false } }, async () => inner)
  const turnEnd = turn => hooks.get('session/event').listener(agent.session, { type: 'turn/end', data: { turn, reason: { kind: 'error' } } })
  return { hooks, failed, turnEnd, selected, followed, warnings, agent }
}

test('a failed turn records the fallback, wakes the next turn on it, and the turn after is back on the Bot\'s model', async () => {
  const h = harness()
  assert.equal(h.hooks.has('agent/request'), false, 'it no longer rewrites agent/request, which dsh 0.2.2 rejects')
  assert.equal(await h.failed({ code: 'INVALID_REQUEST', message: 'Missing namespace' }), undefined, 'the failed step is not retried on the same route')
  assert.deepEqual(h.selected, [DEEPSEEK], 'the fallback is recorded on the Agent, without the failed effort or output limit')
  assert.equal(h.followed.length, 1, 'one turn is woken to continue the conversation')
  assert.match(h.followed[0].content[0].text, /model fallback: openai\/gpt-5\.4-mini failed/)
  // The failed turn's own end does not restore; the fallback turn's does.
  h.turnEnd(3)
  assert.deepEqual(h.selected, [DEEPSEEK])
  h.turnEnd(4)
  assert.deepEqual(h.selected, [DEEPSEEK, { provider: 'openai', model: 'gpt-5.4-mini' }], "the Bot's own route comes back with its effort")
  h.turnEnd(5)
  assert.equal(h.selected.length, 2, 'once')
})

test('what answers a failure first keeps its answer, and other Sessions, kept codes and config off stay failed', async () => {
  assert.deepEqual(await harness().failed({ code: 'RATE_LIMIT' }, 3, { kind: 'retry', reason: 'same model' }), { kind: 'retry', reason: 'same model' })
  const other = harness({ isBot: false })
  assert.equal(await other.failed({ code: 'SERVER' }), undefined)
  assert.equal(other.followed.length, 0)
  assert.equal(await harness().failed({ code: 'CONTEXT_WINDOW_EXCEEDED' }), undefined)
  assert.equal(await harness({ defaultModel: 'openai/gpt-5.4-mini' }).failed({ code: 'SERVER' }), undefined, 'the default is the model that failed')
  const configured = harness({ config: { fallbackModel: 'xai/grok-4.7' } })
  assert.equal(await configured.failed({ code: 'SERVER' }), undefined)
  assert.deepEqual(configured.selected, [{ provider: 'xai', model: 'grok-4.7' }], 'config.fallbackModel is the route')
  const off = harness({ config: { fallback: false } })
  assert.equal(off.hooks.size, 0)
})
