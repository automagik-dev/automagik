import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fallbackFor, fallbackNotice, install, KEEP_CODES } from '../src/host/fallback.js'

const OPENAI = { provider: 'openai', model: 'gpt-5.4-mini' }
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

test('the notice names the model that failed, why, and the one the turn continues with', () => {
  const notice = fallbackNotice(OPENAI, DEEPSEEK, { code: 'INVALID_REQUEST', message: 'OpenAI API error (400): Missing namespace\nmore' })
  assert.match(notice.content[0].text, /^\[model fallback: openai\/gpt-5\.4-mini failed \(INVALID_REQUEST: OpenAI API error \(400\): Missing namespace\); this turn continues with deepseek-official\/deepseek-flash\]$/)
  assert.equal(notice.source.kind, 'model-selection')
  assert.equal(notice.source.form, 'notice')
})

// The two hooks as DSH runs them: a waterfall where each listener gets `next`.
function harness({ isBot = true, config = {}, defaultModel = 'deepseek-official/deepseek-flash' } = {}) {
  const hooks = new Map()
  const warnings = []
  const ctx = { on: (name, listener, options) => hooks.set(name, { listener, options }) }
  install({ ctx, config, isBotSession: () => isBot, defaultModel: async () => defaultModel, botOf: () => ({ name: 'Ops' }), warn: (...args) => warnings.push(args) })
  const appended = []
  const agent = {
    id: 'bot-1',
    session: { requestHeader: () => ({ config: OPENAI }), append: (type, data) => appended.push({ type, data }) },
  }
  const failed = (failure, turn = 3, inner = undefined) => hooks.get('agent/request-error').listener({ agent, turn, step: 1, failure }, async () => inner)
  const request = (turn = 3) => hooks.get('agent/request').listener({ agent, turn, step: 1 }, async () => ({ ...OPENAI, reasoningEffort: 'high', maxTokens: 128000 }))
  return { hooks, failed, request, appended, warnings }
}

test('a failed step is retried on the default model, and the rest of that turn stays there', async () => {
  const h = harness()
  assert.equal(h.hooks.get('agent/request').options?.prepend, true, 'it has the last word over the model selection')
  assert.deepEqual(await h.request(), { ...OPENAI, reasoningEffort: 'high', maxTokens: 128000 }, 'untouched before a failure')
  assert.deepEqual(await h.failed({ code: 'INVALID_REQUEST', message: 'Missing namespace' }), { kind: 'retry' })
  assert.deepEqual(await h.request(), DEEPSEEK, "the failed model's effort and output limit are dropped")
  assert.equal(h.appended.length, 1)
  assert.equal(h.appended[0].type, 'user/message')
  assert.match(h.appended[0].data.content[0].text, /model fallback: openai\/gpt-5\.4-mini failed/)
  // The next turn is back on the Bot's own model.
  assert.deepEqual(await h.request(4), { ...OPENAI, reasoningEffort: 'high', maxTokens: 128000 })
  assert.deepEqual(await h.request(4), { ...OPENAI, reasoningEffort: 'high', maxTokens: 128000 })
})

test('what answers a failure first keeps its answer, and other Sessions, kept codes and config off stay failed', async () => {
  assert.deepEqual(await harness().failed({ code: 'RATE_LIMIT' }, 3, { kind: 'retry', reason: 'same model' }), { kind: 'retry', reason: 'same model' })
  assert.equal(await harness({ isBot: false }).failed({ code: 'SERVER' }), undefined)
  assert.equal(await harness().failed({ code: 'CONTEXT_WINDOW_EXCEEDED' }), undefined)
  assert.equal(await harness({ defaultModel: 'openai/gpt-5.4-mini' }).failed({ code: 'SERVER' }), undefined, 'the default is the model that failed')
  assert.deepEqual(await harness({ config: { fallbackModel: 'xai/grok-4.7' } }).failed({ code: 'SERVER' }), { kind: 'retry' })
  const off = harness({ config: { fallback: false } })
  assert.equal(off.hooks.size, 0)
})
