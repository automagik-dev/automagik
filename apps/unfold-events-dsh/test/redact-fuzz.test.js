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
const timed = (fn, ceiling = FAST_MS) => {
  let best = Infinity
  for (let i = 0; i < FAST_TRIES && best >= ceiling; i++) {
    const t0 = process.cpuUsage()
    fn()
    const used = process.cpuUsage(t0)
    best = Math.min(best, (used.user + used.system) / 1000)
  }
  return best
}

// A slow path by construction: it burns SLOW_REFERENCE_MS of CPU, counting CPU time itself, so no
// load can cut the burn short. The window's bound is a multiple of what this same run measures
// here, so the bound travels with the machine and with the clock; the test at the end pins the
// burn to what it claims, so a harness that misreads it fails rather than scaling every bound.
const SLOW_REFERENCE_MS = 60
const slowReference = () => {
  const start = process.cpuUsage()
  let spin = 0
  for (;;) {
    spin += 1
    if ((spin & 0x3ff) !== 0) continue
    const used = process.cpuUsage(start)
    if (used.user + used.system >= SLOW_REFERENCE_MS * 1000) return spin
  }
}
const slowRef = timed(slowReference)

// The window runs redactText over every delta on top of its own row work, so it costs a multiple
// of the text paths, and the exact multiple is not established: one Ryzen run under Node 24.9.0
// measured 26.24 ms of CPU for it against 10.5-11.3 ms for the text paths (24.22.2: 26.30 ms), and
// CI reported the row without its milliseconds. Its bound is therefore relative, WINDOW_MARGIN
// times the slow reference above, capped by an absolute backstop sized from those numbers (7.6x
// the measured window cost) with headroom. A quadratic rule at 80k characters is 6.4e9 steps,
// seconds of CPU, far past either bound.
const WINDOW_MARGIN = 3
const WINDOW_BACKSTOP_MS = 200
const WINDOW_BOUND_MS = Math.min(WINDOW_MARGIN * slowRef, WINDOW_BACKSTOP_MS)

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
  for (const [shape, text] of cases) {
    for (const [path, run] of textPaths) {
      const ms = timed(() => run(text))
      const detail = `${path}: ${shape}: ${ms.toFixed(1)} ms of CPU, ceiling ${FAST_MS} ms`
      assert.ok(ms < FAST_MS, detail)
    }
    const windowMs = timed(() => windowRun(text), WINDOW_BOUND_MS)
    const margin = `${WINDOW_MARGIN} x slow reference ${slowRef.toFixed(1)} ms`
    const detail = `${windowPath}: ${shape}: ${windowMs.toFixed(1)} ms of CPU, ` +
      `bound ${WINDOW_BOUND_MS.toFixed(1)} ms (${margin}; backstop ${WINDOW_BACKSTOP_MS} ms)`
    assert.ok(windowMs <= WINDOW_BOUND_MS, detail)
  }
})

// The window's bound is only meaningful if this run can see the slow reference for what it is: a
// harness that read the burn as less than FAST_MS would shrink every bound with it.
test('the slow reference burns what its bound claims', () => {
  const detail = `slow reference ${slowRef.toFixed(1)} ms of CPU, burn ${SLOW_REFERENCE_MS} ms`
  assert.ok(slowRef >= SLOW_REFERENCE_MS, detail)
})
