// One wait for the bots-dsh tests (#358). The ceiling only stops a condition that never
// holds, so it is generous for a loaded runner (4x the 2.5 s stall #354 names); a wait that
// holds returns at once. A failed wait names what it awaited and how long it waited; given a
// test's `t`, a wait that holds reports how long it took. It never retries.
export const UNTIL_MS = 10_000

// The step between checks: 20 ms of real time by default. A test that mocks setTimeout
// passes `poll: immediate`, which waits for the next turn of the event loop instead.
const twentyMs = () => new Promise(resolve => setTimeout(resolve, 20))
export const immediate = () => new Promise(resolve => setImmediate(resolve))

// Without a label, a failure names the check by its source, e.g. `() => sent.length > 0`.
const sourceOf = check => `\`${String(check).replace(/\s+/g, ' ')}\``

export const until = async (check, { label = sourceOf(check), t, ms = UNTIL_MS, poll = twentyMs } = {}) => {
  const start = Date.now()
  while (!check()) {
    const elapsed = Date.now() - start
    if (elapsed > ms) throw new Error(`until: ${label} did not hold within ${ms} ms (waited ${elapsed} ms)`)
    await poll()
  }
  t?.diagnostic(`until: ${label} held after ${Date.now() - start} ms`)
}
