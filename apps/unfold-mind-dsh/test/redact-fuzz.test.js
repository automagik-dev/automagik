// Every redaction path stays fast on a seeded fuzz of mixed inputs: the text rules, the values a
// cut tail still masks, and Mind's stream.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MindStream } from '../src/mind.js'
import { redactText, secretsIn } from '../src/redact.js'

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

// A run under FAST_MS passes as it is. A slower run is judged against the same path on BASE_TEXT,
// 84k characters no rule backtracks on, timed right after it: a slow or busy runner, and the
// garbage the stream makes, slow both alike, so their ratio holds; a quadratic rule does not. Five
// tries of each, the best of each kept: noise only slows a run, a quadratic rule is slow every
// time. Measured on Node 22 and 24, 20 runs each: idle, every case stays under FAST_MS; under 36
// busy loops the slowest healthy case (the stream on 80k random pieces) reaches 23 times on Node
// 22 and 33 on Node 24. The backtracking KEY= rule that 110ccf82 replaced, put back, reaches at
// least 109 times idle and 366 under load (40k `APIKEY` then `= x`), so 60 sits between the two.
const FAST_MS = 50
const SLOW_RATIO = 60
const BASE_TEXT = 'word x9 = "a" \\t token\n'.repeat(3_500)
const timed = (run, text) => {
  let [ms, base] = [Infinity, Infinity]
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now()
    run(text)
    const t1 = performance.now()
    if (t1 - t0 < FAST_MS) return { ms: t1 - t0, ratio: 0 }
    run(BASE_TEXT)
    ms = Math.min(ms, t1 - t0)
    base = Math.min(base, performance.now() - t1)
  }
  return { ms, ratio: ms / base }
}

function push(text) {
  const mind = new MindStream({ now: () => 1 })
  mind.life = 'lifeZ'
  mind.agentd({ v: 2, id: 'g:0', producer: 'g', seq: 0, t_ns: 0, source: 'guest', kind: 'response_started', response_id: 'rK' }, { via: 'agentd journal', file: '/j', offset: 0 })
  mind.agentd({ v: 2, id: 'g:1', producer: 'g', seq: 1, t_ns: 1, source: 'guest', kind: 'agent_delta', response_id: 'rK', text }, { via: 'agentd journal', file: '/j', offset: 1 })
}
const PATHS = [['redactText', redactText], ['secretsIn', secretsIn], ['the stream', push]]

test('a seeded fuzz of 200 mixed texts up to 80k characters stays fast on every path', (t) => {
  let slowest = { ratio: 0, note: 'every case under FAST_MS' }
  for (const [shape, text] of fuzzCases()) {
    for (const [path, run] of PATHS) {
      const { ms, ratio } = timed(run, text)
      const note = `${path}: ${shape} (${ms.toFixed(0)} ms, ${ratio.toFixed(1)} times the baseline)`
      assert.ok(ratio < SLOW_RATIO, note)
      if (ratio > slowest.ratio) slowest = { ratio, note }
    }
  }
  t.diagnostic(`slowest: ${slowest.note}`)
})
