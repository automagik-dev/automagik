import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { foldCalls } from '../src/host/usage.js'
import { buildUsageStats, normalizeUsage } from '../src/shared/usage-stats.js'

// Execute the pinned native implementation, not a copied/reimplemented formula.
// Append a test-only export in memory; no installed package or source is written.
const nativeUrl = new URL('../dev/harness/node_modules/@deepseek-ai/dsh-token-meter/lib/index.js', import.meta.url).href
const hook = registerHooks({ load(url, context, next) {
  const loaded = next(url, context)
  if (url !== nativeUrl) return loaded
  const source = typeof loaded.source === 'string' ? loaded.source : new TextDecoder().decode(loaded.source)
  assert.ok(source.includes('const tokenUsageProjectionDefinition = {'))
  return { ...loaded, source: `${source}\nexport { tokenUsageProjectionDefinition as __accountingProjection };\n` }
} })
let projection
try {
  ;({ __accountingProjection: projection } = await import(nativeUrl))
} finally {
  hook.deregister()
}

const header = {
  type: 'request/header', data: { reason: 'initial', header: {
    config: { provider: 'synthetic-provider', model: 'synthetic-model', reasoningEffort: 'high' },
    tools: [{ name: 'fixture_tool', description: 'Synthetic tool definition; never executed', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }],
  } },
}
const usage = (inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens) => ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens })
const settlement = (type, turn, step, sample) => ({ type, data: {
  turn, step, ...(type === 'assistant/message' ? { usage: sample } : {}),
  stream: [{ type: 'chunk', chunk: { type: 'usage', usage: sample } }],
} })
const nativeTotals = events => {
  const view = projection.wire.view(events.reduce((state, event) => projection.apply(state, event), projection.init()))
  return { input: view.uncachedInputTokens, output: view.outputTokens, cacheRead: view.cacheReadTokens, cacheWrite: view.cacheWriteTokens }
}
const botStats = (events, overhead = []) => {
  const rows = foldCalls(events).rows.map(row => ({ ...row, session: 'own-chat', kind: 'turn',
    key: `own-chat#${row.key}`, attemptId: `own-chat#${row.key}`, requestId: `own-chat:${row.turn}:${row.step}`, turnId: `own-chat:${row.turn}`,
  }))
  return buildUsageStats([...rows, ...overhead], { botId: 'bot', sessionId: 'own-chat', owners: new Map([['own-chat', { owner: 'bot' }]]) })
}
const buckets = totals => Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite'].map(field => [field, totals[field]]))
const matchedEvents = [
  header,
  settlement('assistant/attempt', 1, 0, usage(10, 1, 20, 3)),
  { type: 'llm/retry-started', data: { turn: 1, step: 0 } },
  settlement('assistant/message', 1, 0, usage(30, 4, 40, 5)),
  settlement('assistant/message', 1, 0, usage(31, 6, 41, 7)), // same-attempt replacement
  settlement('assistant/message', 1, 1, usage(0, 0, 0, 0)), // reported zero, not absence
  settlement('assistant/message', 2, 0, usage(2, 3, 0, 0)),
]

test('matched synthetic provider/model/effort/tools: native and Bot billing buckets agree through retries/replacement/knownzero', () => {
  const nativeEvents = structuredClone(matchedEvents)
  const botEvents = structuredClone(matchedEvents)
  assert.deepEqual(nativeEvents[0].data.header, botEvents[0].data.header)
  assert.equal(nativeEvents[0].data.header.config.reasoningEffort, 'high')
  assert.equal(nativeEvents[0].data.header.tools[0].name, 'fixture_tool')
  // Compare every settlement boundary, not merely two coincidentally equal totals.
  for (let end = 1; end <= nativeEvents.length; end += 1) {
    assert.deepEqual(buckets(botStats(botEvents.slice(0, end)).scopes.bot.allIn), nativeTotals(nativeEvents.slice(0, end)))
  }
  const totals = botStats(botEvents).scopes.bot.allIn
  assert.deepEqual(buckets(totals), { input: 43, output: 10, cacheRead: 61, cacheWrite: 10 })
  assert.deepEqual({ calls: totals.calls, attempts: totals.attempts, retries: totals.retries }, { calls: 3, attempts: 4, retries: 1 })
  assert.deepEqual(nativeEvents, botEvents) // neither fold mutates the matched request contract
})

test('Bot-owned auxiliary overhead increases allIn exactly once, not the native foreground baseline', () => {
  const overhead = { key: 'aux', attemptId: 'aux', requestId: 'aux-request', turnId: null, session: 'own-chat',
    kind: 'checkpoint', provider: header.data.header.config.provider, retryOrdinal: 0, ...normalizeUsage(usage(7, 2, 3, 0)),
  }
  const before = botStats(matchedEvents)
  const after = botStats(matchedEvents, [overhead, overhead])
  assert.deepEqual(buckets(after.scopes.bot.byKind.chat), nativeTotals(matchedEvents))
  assert.deepEqual(buckets(after.scopes.bot.byKind.checkpoint), { input: 7, output: 2, cacheRead: 3, cacheWrite: 0 })
  assert.deepEqual(buckets(after.scopes.bot.allIn), { input: 50, output: 12, cacheRead: 64, cacheWrite: 10 })
  assert.equal(after.scopes.bot.allIn.attempts, before.scopes.bot.allIn.attempts + 1)
  assert.equal(after.scopes.bot.allIn.calls, before.scopes.bot.allIn.calls + 1)
  assert.deepEqual(after.scopes.lastRequest, before.scopes.lastRequest)
  assert.deepEqual(after.scopes.lastTurn, before.scopes.lastTurn)
  // Accounting correctness only: no model calls, effectiveness, cost or timing comparison.
})

test('native legacy cache0 cannot recover absence: Bot intentionally retains unknown rather than claim knownzero', () => {
  const events = [header, settlement('assistant/message', 1, 0, { inputTokens: 8, outputTokens: 2 })]
  assert.deepEqual(nativeTotals(events), { input: 8, output: 2, cacheRead: 0, cacheWrite: 0 })
  assert.deepEqual(buckets(botStats(events).scopes.bot.allIn), { input: 8, output: 2, cacheRead: null, cacheWrite: null })
  const knownzero = [header, settlement('assistant/message', 1, 0, usage(8, 2, 0, 0))]
  assert.deepEqual(buckets(botStats(knownzero).scopes.bot.allIn), nativeTotals(knownzero))
})
