// The order a start keeps (main.js launch), as one function the tests can run without Electron.
// dsh's boot is the long wait of a start, so whatever does not have to come before it runs beside
// it, and whatever must come before it still does:
//   - the loopback port, the profile (then the lane's plugins in it) and the tools on dsh's PATH
//     are made ready together, and dsh is spawned only once all three are;
//   - while dsh boots, earlier dsh logins are forgotten, and the page gets ready: the navigation
//     guard first, then the page's view, which the guard must cover;
//   - once dsh is ready and the earlier logins are gone, the page loads, and updates are watched
//     from then on, whether or not the page loads.

// A step's call as a promise: a step that throws rejects it, as one that rejects does.
const run = (step, ...args) => new Promise(done => done(step(...args)))
const nothing = () => {}

/**
 * Run a start's steps in that order. Every step is a function and may return a promise; those
 * that run before dsh is ready get the port. `spawn(port)` starts dsh and resolves, once it is
 * ready, with what `load` gets. `after` is the bookkeeping that only has to follow the spawn.
 * `mark(step)` notes a moment for start.log. Resolves with what `load` resolved with.
 */
export async function startUp({ port, profile, lane = nothing, tools, spawn, forget = nothing, after = nothing, guard = nothing, view = nothing, load, updates = nothing, mark = nothing }) {
  const [free] = await Promise.all([run(port), run(profile).then(() => lane()), run(tools)])
  mark('profile ready')
  const ready = run(spawn, free)
  // The logins first: their cookie I/O runs while the page gets ready.
  const forgotten = run(forget, free)
  const page = run(after, free).then(() => guard(free)).then(() => view(free))
  // Awaited together, so a rejection of one is never left unhandled while another is awaited.
  const [dsh] = await Promise.all([ready, forgotten, page])
  // The load is under way before the update watcher starts, and a load that fails does not stop it.
  const [loaded] = await Promise.all([run(load, dsh), run(updates)])
  return loaded
}
