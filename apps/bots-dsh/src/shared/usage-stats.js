// Pure accounting snapshots. Null means unreported/incomplete, never an estimated zero.
const isCount = value => Number.isSafeInteger(value) && value >= 0
const tokenFields = ['input', 'output', 'cacheRead', 'cacheWrite']
const safeSum = values => {
  if (!values.every(isCount)) return null
  const sum = values.reduce((total, value) => total + value, 0)
  return isCount(sum) ? sum : null
}

// Evidence: pinned dsh-llm-deepseek translate/updateUsage and pi-ai's
// anthropic-messages/openai-completions/openai-responses-shared translators.
// A provider name alone cannot identify an adapter or its token semantics.
function semanticsOf(provenance) {
  if (provenance?.kind === 'deepseek-messages' && provenance.version === 1) return 'prompt-disjoint-v1'
  if (provenance?.kind === 'pi-ai' && provenance.version === 2 && ['anthropic-messages', 'openai-completions', 'openai-responses'].includes(provenance.api)) return 'prompt-disjoint-v1'
  return null
}

export function normalizeUsage(usage, provenance = {}) {
  const read = field => isCount(usage?.[field]) ? usage[field] : null
  return {
    input: read('inputTokens'), output: read('outputTokens'), cacheRead: read('cacheReadTokens'), cacheWrite: read('cacheWriteTokens'),
    totalTokens: read('totalTokens'), cacheSemantics: semanticsOf(provenance),
  }
}

const unique = rows => [...new Map(rows.map(row => [row.attemptId ?? row.key, row])).values()]

export function summarizeUsage(rows) {
  const attempts = unique(rows)
  const requestIds = attempts.map(row => row.requestId)
  return {
    ...Object.fromEntries(tokenFields.map(field => [field, safeSum(attempts.map(row => row[field]))])),
    calls: requestIds.every(id => typeof id === 'string' && id !== '') ? new Set(requestIds).size : null,
    attempts: attempts.length,
    retries: attempts.every(row => isCount(row.retryOrdinal)) ? attempts.filter(row => row.retryOrdinal > 0).length : null,
  }
}

function promptOf(row) {
  if (!isCount(row.cacheRead) || !isCount(row.input) || !isCount(row.output)) return null
  const components = safeSum([row.input, row.cacheRead, row.cacheWrite])
  // Explicit adapter total may supply the denominator even when its cache-write
  // field was omitted. We never restore that omitted count to a known zero.
  const prompt = isCount(row.totalTokens) ? row.totalTokens - row.output : components
  if (!isCount(prompt) || prompt < row.input + row.cacheRead || (components !== null && components !== prompt)) return null
  return prompt
}

function cacheRatio(rows, semantics) {
  if (semantics === null || rows.length === 0) return null
  const prompt = safeSum(rows.map(promptOf))
  const read = safeSum(rows.map(row => row.cacheRead))
  return prompt !== null && prompt > 0 && read !== null ? { read, prompt, ratio: read / prompt } : null
}

function scope(id, rows) {
  const attempts = unique(rows)
  const kinds = new Map()
  const providers = new Map()
  for (const row of attempts) {
    const kind = row.kind ?? 'other'
    if (!kinds.has(kind)) kinds.set(kind, [])
    kinds.get(kind).push(row)
    const provider = row.provider ?? ''
    if (!providers.has(provider)) providers.set(provider, [])
    providers.get(provider).push(row)
  }
  return {
    id, allIn: summarizeUsage(attempts),
    byKind: Object.fromEntries([...kinds].map(([kind, entries]) => [kind, summarizeUsage(entries)])),
    byProvider: [...providers].map(([provider, entries]) => {
      const semantics = entries[0].cacheSemantics ?? null
      const compatible = entries.every(row => row.cacheSemantics === semantics) ? semantics : null
      return { provider, semantics: compatible, totals: summarizeUsage(entries), cacheRatio: cacheRatio(entries, compatible) }
    }),
  }
}

export const usageStatsResult = ({ botId, sessionId, scanning, coverage }, scopes) => ({ version: 1, botId, sessionId, scanning, coverage, scopes })

// SQL and the cooperative memory fallback return only these aggregate groups,
// never a second snapshot of historical attempts. Distinct calls are counted
// inside each scope, not summed from overlapping provider/kind groups.
export function scopeFromAggregates(id, groups) {
  const totals = row => Object.fromEntries([...tokenFields, 'calls', 'attempts', 'retries'].map(field => [field, row[field]]))
  const allIn = groups.find(row => row.dimension === 'allIn')
  return {
    id, allIn: totals(allIn),
    byKind: Object.fromEntries(groups.filter(row => row.dimension === 'kind').map(row => [row.name, totals(row)])),
    byProvider: groups.filter(row => row.dimension === 'provider').map(row => ({
      provider: row.name, semantics: row.semantics,
      totals: totals(row),
      cacheRatio: row.semantics !== null && isCount(row.cacheRead) && isCount(row.prompt) && row.prompt > 0
        ? { read: row.cacheRead, prompt: row.prompt, ratio: row.cacheRead / row.prompt } : null,
    })),
  }
}

// Fallback only: no array of team/owner history is created. Request identity sets
// retain exact distinct calls when one request spans providers or retries.
function accumulator() {
  const fields = Object.fromEntries(tokenFields.map(field => [field, 0]))
  const requests = new Set()
  let attempts = 0
  let knownCalls = true
  let retries = 0
  let semantics
  let prompt = 0
  const add = (a, b) => isCount(a) && isCount(b) && isCount(a + b) ? a + b : null
  return {
    push(row) {
      attempts += 1
      for (const field of tokenFields) fields[field] = add(fields[field], row[field])
      if (typeof row.requestId === 'string' && row.requestId !== '') requests.add(row.requestId)
      else knownCalls = false
      retries = isCount(row.retryOrdinal) ? add(retries, row.retryOrdinal > 0 ? 1 : 0) : null
      semantics = attempts === 1 ? row.cacheSemantics ?? null : semantics === row.cacheSemantics ? semantics : null
      prompt = add(prompt, promptOf(row))
    },
    view: () => ({ ...fields, calls: knownCalls ? requests.size : null, attempts, retries, semantics: semantics ?? null, prompt }),
  }
}

function scopeAccumulator(id) {
  const all = accumulator()
  const kinds = new Map()
  const providers = new Map()
  return {
    push(row, kind) {
      all.push(row)
      if (!kinds.has(kind)) kinds.set(kind, accumulator())
      kinds.get(kind).push(row)
      const provider = row.provider ?? ''
      if (!providers.has(provider)) providers.set(provider, accumulator())
      providers.get(provider).push(row)
    },
    view: () => scopeFromAggregates(id, [
      { dimension: 'allIn', ...all.view() },
      ...[...kinds].map(([name, group]) => ({ dimension: 'kind', name, ...group.view() })),
      ...[...providers].map(([name, group]) => ({ dimension: 'provider', name, ...group.view() })),
    ]),
  }
}

export async function buildUsageStatsIterated(rows, options, signal) {
  const { botId, sessionId, owners, kinds } = options
  let visited = 0
  const cooperate = async () => {
    signal?.throwIfAborted()
    if (++visited % 256 === 0) await new Promise(resolve => setTimeout(resolve, 0))
  }
  let latest
  for (const row of rows()) {
    await cooperate()
    if (owners.get(row.session)?.owner !== botId || row.session !== sessionId || row.kind !== 'turn' || !row.requestId || !row.turnId) continue
    if (!latest || (row.sourceSeq ?? row.time) >= (latest.sourceSeq ?? latest.time)) latest = row
  }
  const scopes = { bot: scopeAccumulator(botId), session: scopeAccumulator(sessionId), lastRequest: latest && scopeAccumulator(latest.requestId), lastTurn: latest && scopeAccumulator(latest.turnId) }
  for (const row of rows()) {
    await cooperate()
    if (owners.get(row.session)?.owner !== botId) continue
    const kind = row.kind === 'turn' ? kinds.get(row.session) ?? 'chat' : row.kind ?? 'other'
    scopes.bot.push(row, kind)
    if (row.session !== sessionId) continue
    scopes.session.push(row, kind)
    if (latest && row.requestId === latest.requestId) scopes.lastRequest.push(row, kind)
    if (latest && row.turnId === latest.turnId) scopes.lastTurn.push(row, kind)
  }
  return usageStatsResult(options, Object.fromEntries(Object.entries(scopes).map(([name, group]) => [name, group?.view() ?? null])))
}

export function buildUsageStats(rows, { botId, sessionId = null, owners = new Map(), kinds = new Map(), scanning = false, coverage = { status: 'complete', unreadableSessionIds: [], unresolvedSessionIds: [] } }) {
  const owned = unique(rows.filter(row => owners.get(row.session)?.owner === botId))
  const selected = owned.filter(row => row.session === sessionId)
  // Auxiliary requests without explicit parent linkage cannot become the latest
  // foreground request/turn merely because they happened later in wall time.
  const foreground = selected.filter(row => row.kind === 'turn' && row.requestId && row.turnId)
  const latest = foreground.reduce((last, row) => !last || (row.sourceSeq ?? row.time) >= (last.sourceSeq ?? last.time) ? row : last, null)
  const classify = entries => entries.map(row => row.kind === 'turn' ? { ...row, kind: kinds.get(row.session) ?? 'chat' } : row)
  return {
    version: 1, botId, sessionId, scanning, coverage,
    scopes: {
      lastRequest: latest ? scope(latest.requestId, classify(selected.filter(row => row.requestId === latest.requestId))) : null,
      lastTurn: latest ? scope(latest.turnId, classify(selected.filter(row => row.turnId === latest.turnId))) : null,
      session: sessionId === null ? null : scope(sessionId, classify(selected)),
      bot: scope(botId, classify(owned)),
    },
  }
}
