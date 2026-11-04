// Claude through Claude Code (the Oh My Claude plugin, providers claude-code and
// claude-code-<box>) left Automagik: Claude comes through DSH's pi-ai route `anthropic` now,
// on a Claude Pro or Max sign-in or an Anthropic API key. A Bot saved on a claude-code model
// moves once to the pi-ai model closest to it (store.js); the old ref stays on the Bot as
// `claudeCodeModel`, so a later migration can move it on to ACP's acp-claude (RFC 0003).

export const PI_AI_CLAUDE = 'anthropic'

// The Claude models pi-ai 1.4.0 serves on `anthropic`, per family, oldest first, as their
// version suffix (`5-5` is claude-opus-5-5, `5` is claude-opus-5).
export const PI_AI_CLAUDE_MODELS = Object.freeze({
  opus: Object.freeze(['4-5', '4-6', '4-7', '4-8', '5', '5-5']),
  sonnet: Object.freeze(['4-5', '4-6', '5', '5-5']),
  haiku: Object.freeze(['4-5', '5-5']),
  fable: Object.freeze(['5', '5-1']),
})

// Claude Code's `default` ("Default (recommended)") is Opus on the Max plan, the plan its
// Bots ran on; an id this table cannot read takes it too.
export const DEFAULT_FAMILY = 'opus'

export const isClaudeCode = provider => provider === 'claude-code' || String(provider).startsWith('claude-code-')

const versionOf = suffix => {
  const [major, minor = '0'] = suffix.split('-')
  return Number(major) + Number(minor) / 100
}
const newest = family => `claude-${family}-${PI_AI_CLAUDE_MODELS[family].at(-1)}`

// The family's model nearest the version asked for; between two as near, the newer.
function nearest(family, version) {
  let best
  for (const suffix of PI_AI_CLAUDE_MODELS[family]) {
    const distance = Math.abs(versionOf(suffix) - version)
    if (best === undefined || distance <= best.distance) best = { suffix, distance }
  }
  return `claude-${family}-${best.suffix}`
}

// Claude Code's aliases (`opus`, `sonnet[1m]`, `opusplan`) and versioned ids
// (`claude-opus-4-7`, `claude-sonnet-4-5-20250929`, `claude-opus-5-5[1m]`). pi-ai has no
// separate 1M model: the plain one stands in for it.
const ALIAS = /^(opus|sonnet|haiku|fable)(?:plan)?(?:\[1m\])?$/
const VERSIONED = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[1m\])?$/

/** The pi-ai model id closest to a Claude Code model id. */
export function closestClaude(id) {
  const model = String(id ?? '').trim().toLowerCase()
  const alias = ALIAS.exec(model)
  if (alias) return newest(alias[1])
  const versioned = VERSIONED.exec(model)
  if (versioned && Object.hasOwn(PI_AI_CLAUDE_MODELS, versioned[1])) {
    return nearest(versioned[1], Number(versioned[2]) + Number(versioned[3] ?? 0) / 100)
  }
  // An id of an older naming (claude-3-5-sonnet-…) still names its family.
  const family = Object.keys(PI_AI_CLAUDE_MODELS).find(name => model.includes(name))
  return newest(family ?? DEFAULT_FAMILY)
}

/** `anthropic/<model>` for a claude-code* ref; undefined for any other ref. */
export function piAiClaudeOf(ref) {
  if (typeof ref !== 'string') return undefined
  const slash = ref.indexOf('/')
  if (slash <= 0 || !isClaudeCode(ref.slice(0, slash))) return undefined
  return `${PI_AI_CLAUDE}/${closestClaude(ref.slice(slash + 1))}`
}

// The Claude models a menu offers on `anthropic`: each family's newest, by the same reading
// as closestClaude. pi-ai serves its whole Claude catalog there (17 models in pi-ai 1.4.0:
// every 4.5 to 5.5 version, dated snapshots, "(latest)" aliases), so the rest is marked
// `superseded` and the menu hides it. It stays served: a Bot already on one keeps it, a Main
// Bot can still name it. An id this cannot read is never superseded.
const SNAPSHOT = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(-\d{8})?$/

/** The ids among `ids` that a newer model of their family, or the undated alias, replaces. */
export function supersededClaude(ids) {
  const read = []
  const newest = new Map()
  for (const id of ids) {
    const match = SNAPSHOT.exec(String(id))
    if (!match) continue
    const version = Number(match[2]) + Number(match[3] ?? 0) / 100
    read.push({ id, family: match[1], version, dated: match[4] !== undefined })
    newest.set(match[1], Math.max(newest.get(match[1]) ?? -Infinity, version))
  }
  return new Set(read.filter(model => model.dated || model.version < newest.get(model.family)).map(model => model.id))
}
