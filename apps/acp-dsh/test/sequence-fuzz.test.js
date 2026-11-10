// The sequence fuzz (#958): random interleavings of bridge calls, their results, cancellations,
// overlapping calls and step and turn ends, through the real Backchannel on a real Session.
// After every move the stored log must load with the pinned DSH reader, the one a desktop
// reload runs: one unloadable step loses the whole conversation.
//
// The runs are seeded, so a failure names the seed and the moves that reproduce it. FUZZ_SEED
// and FUZZ_RUNS replay one seed or widen the search; the daily compatibility run widens it.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { bridgeHost, loadError, ticks } from './support/bridge-host.js'

const RUNS = Number(process.env.FUZZ_RUNS ?? 150)
const SEED = Number(process.env.FUZZ_SEED ?? 958)
const MOVES = 40

// mulberry32: small, seeded, the same sequence on every Node.
function random(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const ENDS = ['ok', 'ok', 'tool-error', 'throw', 'throw-odd', 'empty']
// Each move with its weight: calls and results most often, boundaries often enough to cut them.
const MOVE_TABLE = [
  ['call', 8], ['finish', 7], ['overlap', 3], ['duplicate', 1], ['answer', 3], ['reject', 1],
  ['step', 5], ['turn', 2], ['cut-turn', 1], ['between', 1], ['revoke', 1], ['stale-result', 1],
]
const TOTAL = MOVE_TABLE.reduce((sum, [, weight]) => sum + weight, 0)

function pick(next) {
  let at = next() * TOTAL
  for (const [move, weight] of MOVE_TABLE) {
    at -= weight
    if (at < 0) return move
  }
  return 'call'
}

/** One seeded run. Returns the first load failure, with the moves that led to it. */
async function run(seed, { guard }) {
  const next = random(seed)
  const host = bridgeHost({ id: `fuzz-${seed}`, level: next() < 0.5 ? 'full' : 'manual', guard })
  host.mint()
  host.startTurn()
  host.startStep()
  const moves = []
  const pending = []
  let minted = 0
  const start = (callId) => {
    const answer = host.call({ callId })
    answer.catch(() => {})
    pending.push(answer)
  }
  const check = () => {
    const error = loadError(host.session)
    return error === undefined ? undefined : { seed, moves: [...moves], message: error.message }
  }
  for (let index = 0; index < MOVES; index += 1) {
    const move = pick(next)
    moves.push(move)
    if (move === 'call') start(`bridge_${seed}_${++minted}`)
    else if (move === 'overlap') {
      // Two calls at once, as an agent that runs its tools in parallel sends them.
      start(`bridge_${seed}_${++minted}`)
      start(`bridge_${seed}_${++minted}`)
    } else if (move === 'duplicate') start(`bridge_${seed}_${Math.max(1, minted)}`)
    else if (move === 'finish') host.finish(ENDS[Math.floor(next() * ENDS.length)])
    else if (move === 'answer') host.answer('allowed-once')
    else if (move === 'reject') host.answer('rejected')
    else if (move === 'step') {
      if (host.stepOpen) host.endStep()
      if (host.turnOpen) host.startStep()
    } else if (move === 'turn' || move === 'cut-turn') {
      // `cut-turn` ends the turn over its open step, as a Stop or a crash recovery does.
      if (move === 'turn' && host.stepOpen) host.endStep()
      if (host.turnOpen) host.endTurn()
      host.startTurn()
      host.startStep()
    } else if (move === 'between') {
      // A call that arrives between two steps.
      if (host.stepOpen) host.endStep()
      start(`bridge_${seed}_${++minted}`)
      await ticks(1)
      if (host.turnOpen) host.startStep()
    } else if (move === 'revoke') {
      // The bridge goes (a model switch, a fork, the kill switch) and a new one is minted.
      host.backchannel.revoke(host.record)
      host.mint()
    } else if (move === 'stale-result') {
      // A result row for a call of an earlier step, stamped with that step.
      const callId = `bridge_${seed}_${Math.max(1, Math.floor(next() * minted))}`
      try {
        host.session.append('tool/result', {
          turn: host.turn,
          step: Math.max(1, host.step - 1),
          message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'late' }], isError: false }),
        }, { surfaceOp: 'append' })
      } catch {}
    }
    await ticks(1 + Math.floor(next() * 3))
    const failure = check()
    if (failure !== undefined) return failure
  }
  // Everything still running ends, in any order, and the turn closes.
  moves.push('drain')
  for (let left = 0; left < 200 && (host.finish(ENDS[Math.floor(next() * ENDS.length)]) || host.answer('allowed-once')); left += 1) await ticks(1)
  if (host.stepOpen) host.endStep()
  if (host.turnOpen) host.endTurn()
  host.backchannel.revoke(host.record)
  await Promise.allSettled(pending)
  await ticks()
  return check()
}

test(`every stored log loads: ${RUNS} random sequences from seed ${SEED}`, async () => {
  for (let index = 0; index < RUNS; index += 1) {
    const failure = await run(SEED + index, { guard: true })
    assert.equal(failure, undefined, `seed ${failure?.seed} (FUZZ_SEED=${failure?.seed} FUZZ_RUNS=1): ${failure?.message}\nmoves: ${failure?.moves.join(' ')}`)
  }
})

test('the same sequences without the guard do store unloadable logs (the fuzz bites)', async () => {
  let broken = 0
  const reasons = new Set()
  for (let index = 0; index < Math.min(RUNS, 40); index += 1) {
    const failure = await run(SEED + index, { guard: false })
    if (failure === undefined) continue
    broken += 1
    reasons.add(failure.message.replace(/bridge_\S+/g, '<id>').replace(/\d+/g, 'N'))
  }
  assert.ok(broken >= 20, `only ${broken} of 40 unguarded runs broke`)
  // More than the one shape #957 names: the class, not a case.
  assert.ok(reasons.size >= 2, `the unguarded runs broke in one way only: ${[...reasons].join('; ')}`)
})
