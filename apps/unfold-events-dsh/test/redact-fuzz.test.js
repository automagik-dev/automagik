// Every redaction path stays fast on a seeded fuzz of mixed inputs: the window's rules, the
// browser copy and its values, and the window itself.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCatalog } from '../src/catalog.js'
import { EventWindow, redactText } from '../src/window.js'
import { redactText as clientRedactText, secretsIn as clientSecretsIn } from '../src/client/redact.js'

// A seeded fuzz: 200 texts of up to 80k characters, each a random mix of the pieces a rule could
// backtrack on (whitespace runs, key names in each case and form, separators, open and closed
// quotes, backslashes, escaped quotes, newlines, schemes), most with a run repeated to fill the
// size. A third are the shapes a rule once backtracked on, with random runs, keys and tails:
// whitespace before a YAML block key, a word of upper-case names then `=` and a failing value, an
// unbroken run then a separator and whitespace, and a key name run then a failing value. The same
// seed gives the same texts, and each text comes with a short shape that names it.
const SEED = 0x5eed124
const PIECES = [' ', '\t', ' \t', '\n', '\n  ', 'password', 'db_password', 'DB_PASS', 'accessToken', 'ClientSecret', 'DbPass', 'API_TOKEN', '--token', '-pass', 'token', '=', ': ', ' = ', '":', '\\":', ': |\n', ': >-\n', '"', "'", '`', '\\', '\\\\', '\\"', '\\"\\"', 'bearer ', 'basic ', 'Bearer ', 'x9', 'a', 'word ', '{"', '{\\"', '_', '-']
const SIZES = [1_000, 4_000, 16_000, 40_000, 80_000]
const SHAPES = [
  [[' ', '\t', ' \t', '\t '], ['password', 'accessToken', 'db_password', 'ClientSecret'], [': |\n', ': >-\n', ': |', ':  >']],
  [['TOKEN', 'API_KEY_', 'SECRET', 'PASSWORD_', 'X9_', 'APIKEY'], [''], ['=', '= x', '="', "='", '=`', '=x', ' =', '']],
  [['a', 'DB_PASSaClientSecret', 'x9-', 'word'], [''], [': = \t', ': =\\": \t', ' \t', ':\n ']],
  [['password', 'accessToken', 'db_pass ', '--token'], [''], ['=', ': ', '\\": \\"', '="', ' = ']],
]
function fuzzCases(seed = SEED, count = 200) {
  let state = seed >>> 0
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const unit = () => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(PIECES)).join('')
  const fill = (piece, size) => piece.repeat(Math.max(1, Math.floor(size / piece.length)))
  return Array.from({ length: count }, (_, i) => {
    const size = pick(SIZES)
    if (i % 3 === 2) {
      const [runs, keys, tails] = pick(SHAPES)
      const [run, key, tail] = [pick(runs), pick(keys), pick(tails)]
      return [`#${i} ${JSON.stringify(run)} to ${size}, then ${JSON.stringify(key + tail)}`, `${fill(run, size)}${key}${tail}`]
    }
    if (i % 3 === 0) {
      const parts = []
      for (let n = 0; n < size; ) {
        const piece = pick(PIECES)
        parts.push(piece)
        n += piece.length
      }
      return [`#${i} ${size} random pieces`, parts.join('')]
    }
    const [lead, run, tail] = [unit(), unit(), unit()]
    const share = rand()
    const text = `${fill(lead, size * share)}${fill(run, size * (1 - share))}${tail}`
    return [`#${i} ${JSON.stringify(lead)} then ${JSON.stringify(run)} repeated, then ${JSON.stringify(tail)}`, text]
  })
}

// A sample uses CPU time, not wall clock: CI runs this package's test files side by side, and a
// wall-clock sample includes the time this process waits for a CPU. Five wall-clock runs of the
// same 80k text spanned 8 ms to 211 ms here while their CPU time stayed within a millisecond. The
// best of five runs drops one that caught a background compile or a collection; noise can add CPU
// time, never remove it, so a rule that is slow in every run stays slow in every sample.
const FAST_MS = 50
const FAST_TRIES = 5
const sample = (fn) => {
  const t0 = process.cpuUsage()
  fn()
  const used = process.cpuUsage(t0)
  return (used.user + used.system) / 1000
}
const timed = (fn, ceiling = FAST_MS) => {
  let best = Infinity
  for (let i = 0; i < FAST_TRIES && best >= ceiling; i++) best = Math.min(best, sample(fn))
  return best
}
// The reference sets a bound, so it always takes all five samples.
const fixedWork = (fn) => Math.min(...Array.from({ length: FAST_TRIES }, () => sample(fn)))

// The reference is a fixed amount of the same work: redactText over one 80k text of the fuzz's own
// pieces, built once from a fixed seed. It runs the same code path over a fixed N pieces, never the
// fuzz texts, so its cost is linear in that input (40k, 80k and 160k characters measured 100, 98
// and 98 ns per character) and every run pays exactly that work. A slower machine or a slower clock
// raises the reference and the window's bound together: it is not a time constant.
const REFERENCE_TEXT = (() => {
  let state = 0x531 >>> 0
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
  const parts = []
  for (let n = 0; n < 80_000; ) {
    const piece = PIECES[Math.floor(rand() * PIECES.length)]
    parts.push(piece)
    n += piece.length
  }
  return parts.join('')
})()

// The window runs redactText over every delta on top of its own row work, so it costs a multiple of
// the reference: 1.89-1.96x measured here (Node 22.23.2) and 2.32-2.50x on the Ryzen numbers (26.24
// ms against 10.5-11.3 ms, Node 24.9.0/24.22.2). WINDOW_MARGIN sits above both, and a 2x regression
// of the window path fails on either (3.8x here, 4.6-5.0x on Ryzen); the absolute backstop caps how
// far a reference that reads high can widen the bound. A quadratic rule at 80k characters is 6.4e9
// steps, seconds of CPU, far past either.
const WINDOW_MARGIN = 3.5
const WINDOW_BACKSTOP_MS = 200

const catalog = loadCatalog()
const push = (text) => new EventWindow(catalog, { limit: 20 }).push({ v: 2, id: 'g:1', producer: 'g', seq: 1, t_ns: 1, source: 'guest', kind: 'agent_delta', response_id: 'rK', text })
const PATHS = [['the window rules', redactText], ['the browser copy', clientRedactText], ["the browser copy's values", clientSecretsIn], ['the window', push]]

test('a seeded fuzz of 200 mixed texts up to 80k characters stays fast on every path', () => {
  const cases = fuzzCases()
  // Warm-up, not measured: a cold process pays to compile each rule's regular expressions, grow
  // its buffers and climb V8's tiers once, and that setup is not a text's cost. The pass runs the
  // same texts through the same paths, so a rule that is slow on a shape is still slow on the
  // measured pass; only the one-time cold cost of a new process is left out.
  for (const [, text] of cases) for (const [, run] of PATHS) run(text)
  const [windowPath, windowRun] = PATHS[PATHS.length - 1]
  const textPaths = PATHS.slice(0, -1)
  const referenceMs = fixedWork(() => redactText(REFERENCE_TEXT))
  // A zero sample would make the bound zero and pass a window that measured nothing.
  assert.ok(referenceMs > 0, `reference sample is ${referenceMs} ms of CPU`)
  const bound = Math.min(WINDOW_MARGIN * referenceMs, WINDOW_BACKSTOP_MS)
  const margin = `${WINDOW_MARGIN} x reference ${referenceMs.toFixed(1)} ms`
  for (const [shape, text] of cases) {
    for (const [path, run] of textPaths) {
      const ms = timed(() => run(text))
      const detail = `${path}: ${shape}: ${ms.toFixed(1)} ms of CPU, ceiling ${FAST_MS} ms`
      assert.ok(ms < FAST_MS, detail)
    }
    const windowMs = timed(() => windowRun(text), bound)
    const detail = `${windowPath}: ${shape}: ${windowMs.toFixed(1)} ms of CPU, ` +
      `bound ${bound.toFixed(1)} ms (${margin}; backstop ${WINDOW_BACKSTOP_MS} ms)`
    assert.ok(windowMs <= bound, detail)
  }
})
