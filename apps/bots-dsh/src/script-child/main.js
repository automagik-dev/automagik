// The process side of browser_exec, built into src/host/browser/script-child.js
// (scripts/build-script-child.mjs): one file with the interpreter inside it, because the
// process may read its own entry file and nothing else (script-runner.js).
//
// It joins two things: the host, in JSON lines on stdin and stdout, and the script, in
// the interpreter of sandbox.js. It is a process and not a worker thread because the
// host can kill a process whose script never returns.
import { openSandbox } from './sandbox.js'

// A write to a host that is gone fails, and there is no one to tell. An error of this
// process's stack is not that: the sandbox ends the run on it.
const send = (message) => {
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`)
  } catch (error) {
    if (error instanceof RangeError) throw error
  }
}

// The host kills this process at the run's deadline. A host that is gone, or stopped,
// kills nothing, so the process keeps the deadline too, this long after the host's: a
// script that never yields is stopped by the interpreter (sandbox.js `overdue`), and the
// process then leaves.
const GRACE = 1_000

let lastCall = 0
let waitLimit = 0
let deadline = Infinity
let sandbox

// A helper call of the script: `wait` is this process's own timer, every other name is
// the host's to answer.
const call = (name, args) => {
  const id = ++lastCall
  if (name === 'wait') {
    let ms = 0
    try { ms = Number(JSON.parse(args)[0]) } catch {}
    setTimeout(() => sandbox.settle(id, true, null), Number.isFinite(ms) ? Math.min(Math.max(ms, 0), waitLimit) : 0)
    return id
  }
  send({ type: 'call', id, name, args })
  return id
}

const finish = (answer, error) => send({ type: 'done', answer, error })

let started = false
const receive = async (message) => {
  if (message?.type === 'start') {
    if (started || typeof message.body !== 'string' || !Array.isArray(message.names) || !(message.wait > 0)) return
    started = true
    waitLimit = message.wait
    // By the clock that only runs forward: a change of the machine's time moves nothing.
    deadline = performance.now() + waitLimit + GRACE
    setTimeout(() => process.exit(0), waitLimit + GRACE)
    const overdue = () => performance.now() >= deadline ? `Script ran longer than ${waitLimit / 1000} seconds.` : undefined
    try {
      sandbox = await openSandbox({ call, finish, overdue })
      sandbox.start(message.names, message.body)
    } catch {
      finish(null, 'Script failed.')
    }
    return
  }
  if (sandbox === undefined || !Number.isSafeInteger(message?.id)) return
  const ok = message.ok === true && (typeof message.value === 'string' || message.value === null)
  if (ok) sandbox.settle(message.id, true, message.value)
  else sandbox.settle(message.id, false, typeof message.error === 'string' ? message.error : 'The helper failed.')
}

// One message a line; what has no line end yet is held until it has.
let held = []
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  let from = 0
  for (;;) {
    const at = chunk.indexOf('\n', from)
    if (at === -1) break
    held.push(chunk.slice(from, at))
    const line = held.join('')
    held = []
    from = at + 1
    let message
    try { message = JSON.parse(line) } catch { continue }
    receive(message)
  }
  if (from < chunk.length) held.push(chunk.slice(from))
})
// The host went away: nothing is left to answer the script.
process.stdin.on('end', () => process.exit(0))
process.stdin.on('error', () => process.exit(0))
