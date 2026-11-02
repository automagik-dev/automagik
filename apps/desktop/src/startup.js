// The order a start keeps (main.js launch), as one function the tests can run without Electron.
// dsh's boot is the long wait of a start, so whatever does not have to come before it runs beside
// it, and whatever must come before it still does:
//   - the loopback port, the profile (with the lane's plugins in it) and the tools on dsh's PATH
//     are made ready together, and dsh is spawned only once all three are;
//   - the forgetting of earlier dsh logins and what the page needs before it loads (the
//     navigation guard, its view, the update watcher) happen while dsh boots;
//   - the page loads once dsh is ready and the earlier logins are gone.

// A step's call as a promise: a step that throws rejects it, as one that rejects does.
const run = (step, ...args) => new Promise(done => done(step(...args)))

/**
 * Run a start's steps in that order. Every step is a function and may return a promise.
 * `spawn(port)` starts dsh and resolves, once it is ready, with what `load` gets; `forget(port)`
 * and `after(port)` run while it boots; `load(dsh)` loads the page. `mark(step)` notes a moment
 * for start.log. Resolves with what `load` resolved with.
 */
export async function startUp({ port, profile, tools, spawn, forget = () => {}, after = () => {}, load, mark = () => {} }) {
  const [free] = await Promise.all([run(port), run(profile), run(tools)])
  mark('profile ready')
  const ready = run(spawn, free)
  // Awaited together, so a rejection of one is never left unhandled while another is awaited.
  const [dsh] = await Promise.all([ready, run(forget, free), run(after, free)])
  return load(dsh)
}
