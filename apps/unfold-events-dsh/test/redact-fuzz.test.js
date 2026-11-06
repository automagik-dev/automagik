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

// A wall-clock sample holds the rule's own work plus the time this process waited for a CPU, and CI
// runs this package's test files side by side. Five wall-clock runs of the same 80k text spanned
// 8 ms to 211 ms here while their CPU time stayed within a millisecond. A rule's cost is CPU work,
// so the sample is CPU time, and the best of five drops one that caught a background compile or a
// collection. It cannot hide a regression: a rule slower than FAST_MS uses more than FAST_MS of
// CPU in every run, so its best is over the ceiling too (the test below holds the harness to that).
const FAST_MS = 50
const FAST_TRIES = 5
const timed = (fn) => {
  let best = Infinity
  for (let i = 0; i < FAST_TRIES && best >= FAST_MS; i++) {
    const t0 = process.cpuUsage()
    fn()
    const used = process.cpuUsage(t0)
    best = Math.min(best, (used.user + used.system) / 1000)
  }
  return best
}

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
  for (const [shape, text] of cases) {
    for (const [path, run] of PATHS) {
      assert.ok(timed(() => run(text)) < FAST_MS, `${path}: ${shape}`)
    }
  }
})

// The harness above must fail a path slower than the ceiling, or a regression could hide in the
// sampling. This path burns 60 ms of CPU by construction, counting CPU time itself, so no amount
// of load can cut the burn short: every run is over the ceiling and its best is too.
test('the measurement fails a path slower than the ceiling', () => {
  const slow = () => {
    const start = process.cpuUsage()
    let spin = 0
    for (;;) {
      spin += 1
      if ((spin & 0x3ff) !== 0) continue
      const used = process.cpuUsage(start)
      if (used.user + used.system >= 60_000) return spin
    }
  }
  assert.ok(timed(slow) >= FAST_MS)
})
