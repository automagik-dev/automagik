// Every redaction path hides a planted secret and stays fast on a seeded fuzz of mixed inputs: the
// text rules, the values a cut tail still masks, and Mind's stream.
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

// Each text ends with two planted credentials: `SVCTOKEN=`, which only the upper-case KEY= rule
// knows (no `_` or `-` before its TOKEN), and a lower-case `db_password=`. Every path must hide
// both (redactText's output and the stream's snapshot never hold them) and secretsIn must find
// both, so a rule that stops matching fails here on any case. They are bare: after a text's own
// open quote they are part of its value, and hidden with it.
const [UPPER, LOWER] = ['s3cretPlantedUpper9', 's3cretPlantedLower9']
const PLANTED = ` SVCTOKEN=${UPPER} db_password=${LOWER}`

// Speed is one catastrophic ceiling, CEILING_MS, on the best of TRIES runs of each path: noise
// only slows a run, and a rule gone catastrophic is slow every time. It sits far above any healthy
// run: on Node 22 and 24, idle and under 16 and 36 busy loops, the slowest healthy case (the
// stream on 80k random pieces) took at most 227 ms, 22 times under it. The ratio to the same path
// on BASE_TEXT (84k characters no rule backtracks on) is only reported, never asserted.
// The backtracking KEY= rule that 110ccf82 replaced hides the same text, so it is a speed-only
// regression, and shared runners cannot tell it from load: put back, 40k `APIKEY` then `= x`
// takes 504 ms on the stream idle and 952 ms in secretsIn under 36 loops, both under the ceiling,
// and only the ratio line shows it (over 100 times the baseline). key-names.test.js times that
// shape at 80k and 160k against 50 ms.
const TRIES = 10
const CEILING_MS = 5_000
const BASE_TEXT = 'word x9 = "a" \\t token\n'.repeat(3_500)
const best = (run, text) => {
  let ms = Infinity
  for (let i = 0; i < TRIES; i++) {
    const t0 = performance.now()
    run(text)
    ms = Math.min(ms, performance.now() - t0)
  }
  return ms
}

function push(text) {
  const mind = new MindStream({ now: () => 1 })
  mind.life = 'lifeZ'
  mind.agentd({ v: 2, id: 'g:0', producer: 'g', seq: 0, t_ns: 0, source: 'guest', kind: 'response_started', response_id: 'rK' }, { via: 'agentd journal', file: '/j', offset: 0 })
  mind.agentd({ v: 2, id: 'g:1', producer: 'g', seq: 1, t_ns: 1, source: 'guest', kind: 'agent_delta', response_id: 'rK', text }, { via: 'agentd journal', file: '/j', offset: 1 })
  return mind
}
const PATHS = [
  ['redactText', redactText, (out) => [out]],
  ['secretsIn', secretsIn, null],
  ['the stream', push, (mind) => [JSON.stringify(mind.snapshot())]],
]

test('a seeded fuzz of 200 mixed texts up to 80k characters hides every planted secret, fast, on every path', (t) => {
  for (const [path, run, shown] of PATHS) {
    const base = best(run, BASE_TEXT)
    let slowest = { ms: 0, note: '' }
    for (const [shape, plain] of fuzzCases()) {
      const text = plain + PLANTED
      const note = `${path}: ${shape}`
      if (shown) {
        for (const out of shown(run(text))) for (const secret of [UPPER, LOWER]) assert.ok(!out.includes(secret), `${note} shows ${secret}`)
      } else {
        const found = run(text)
        for (const secret of [UPPER, LOWER]) assert.ok(found.some((v) => v.includes(secret)), `${note} misses ${secret}`)
      }
      const ms = best(run, text)
      assert.ok(ms < CEILING_MS, `${note} took ${ms.toFixed(1)} ms, over the ${CEILING_MS} ms ceiling`)
      if (ms > slowest.ms) slowest = { ms, note }
    }
    t.diagnostic(`${slowest.note}: slowest, ${slowest.ms.toFixed(1)} ms, ${(slowest.ms / base).toFixed(1)} times the baseline's ${base.toFixed(1)} ms`)
  }
})
