// Runs a browser_exec body away from the host process. The model writes the body, and a
// page can talk the model into writing anything. Two walls stand around it.
//
// The inner wall is the interpreter (src/script-child/sandbox.js): the body runs in
// QuickJS compiled to WebAssembly, inside the child process. It shares no object with
// that process's Node, and what crosses is two functions that take text. It has no
// file, process or network API, because nothing gives it one.
//
// The outer wall is the process, started with nothing to give, as if the body owned all
// of its JavaScript after all:
//
//   closed    files (read and write), child processes, worker threads, native addons:
//             Node's permission model, with nothing granted
//             the host's environment: the child gets an empty one
//             the host itself: the one channel is JSON lines on the child's stdin and
//             stdout, and a line the host does not accept ends the run
//             time: at the deadline the child is killed, not asked
//   NOT closed  the network, by this wall. The permission model of the Node this runs
//             on (24, and the desktop app's Electron as Node) has no network
//             permission; from Node 26 the same flags deny it. Until then the network
//             is closed by the inner wall alone.
//
// test/browser-script-wall.test.js checks each closed line of the outer wall on both
// runtimes; test/browser-script-sandbox.test.js checks the inner wall's two functions.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SCRIPT_TIMEOUT = 20_000
const CHILD = fileURLToPath(new URL('./script-child.js', import.meta.url))

// The child's flags and no others: the host's own (loaders, --expose-internals) are not
// the child's. --permission with no --allow-* flag is the wall, and the heap is bounded.
const CHILD_FLAGS = ['--permission', '--max-old-space-size=128']

// The longest helper arguments a script may send (the child refuses more before
// sending), and the longest line that can carry them: JSON escaping makes at most six
// characters of one.
const MAX_ARGS = 4_000_000
const MAX_LINE = MAX_ARGS * 6 + 1_000

// The child sees none of the host's environment (keys, tokens, DSH_HOME). Windows needs
// SystemRoot to start a process; the desktop app's host is Electron run as Node, and so
// must the child be.
function childEnv() {
  const env = {}
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

// What the child sends and nothing else: a call of one of the helpers, or the one
// answer. Anything else comes from a child that is no longer ours.
function readMessage(line, helpers) {
  let message
  try { message = JSON.parse(line) } catch { return undefined }
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return undefined
  const text = value => typeof value === 'string' || value === null
  if (message.type === 'done') return text(message.answer) && text(message.error) ? message : undefined
  if (message.type !== 'call') return undefined
  const { id, name, args } = message
  if (!Number.isSafeInteger(id) || id < 1) return undefined
  if (typeof name !== 'string' || !Object.hasOwn(helpers, name)) return undefined
  if (typeof args !== 'string' || args.length > MAX_ARGS) return undefined
  return message
}

// helpers: name → async function on the host. Only JSON crosses in either direction.
// `entry` is the child's file; only the tests give another.
export function runIsolatedScript(body, helpers, { timeout = SCRIPT_TIMEOUT, entry = CHILD } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let child
    const end = (settle, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // SIGKILL: a child that handles or ignores SIGTERM would outlive its run, and it
      // holds nothing worth a clean exit.
      if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      settle(value)
    }
    // The kill stops a script that never yields, which a Promise.race cannot.
    const timer = setTimeout(() => end(reject, new Error(`Script ran longer than ${timeout / 1000} seconds.`)), timeout)
    try {
      child = spawn(process.execPath, [...CHILD_FLAGS, entry], {
        env: childEnv(),
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      })
    } catch (error) {
      end(reject, new Error(`Could not start the script: ${error?.message ?? error}`))
      return
    }
    const send = message => {
      try { child.stdin.write(`${JSON.stringify(message)}\n`) } catch {}
    }
    const refuse = () => end(reject, new Error('Script stopped: it sent the host something that is not a helper call or an answer.'))
    const receive = async (line) => {
      const message = readMessage(line, helpers)
      if (message === undefined) return refuse()
      if (message.type === 'done') {
        if (message.error === null) end(resolve, message.answer)
        else end(reject, new Error(message.error))
        return
      }
      let reply
      try {
        const args = JSON.parse(message.args)
        const value = await helpers[message.name](...(Array.isArray(args) ? args : []))
        const json = JSON.stringify(value)
        reply = { id: message.id, ok: true, value: json === undefined ? null : json }
      } catch (error) {
        reply = { id: message.id, ok: false, error: String(error?.message ?? error) }
      }
      if (!settled) send(reply)
    }
    // One message a line. What has no line end yet is held, up to the longest line.
    let held = []
    let heldLength = 0
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      let from = 0
      // Lines already read when the run ended still arrive; none may act.
      while (!settled) {
        const at = chunk.indexOf('\n', from)
        if (at === -1) break
        held.push(chunk.slice(from, at))
        const line = held.join('')
        held = []
        heldLength = 0
        from = at + 1
        receive(line)
      }
      if (settled || from >= chunk.length) return
      held.push(chunk.slice(from))
      heldLength += chunk.length - from
      if (heldLength > MAX_LINE) refuse()
    })
    // A killed child closes its pipes under a write; the exit below reports it.
    child.stdin.on('error', () => {})
    child.stdout.on('error', () => {})
    child.on('error', error => end(reject, new Error(`Script stopped: ${error?.message ?? error}`)))
    child.on('exit', (code, signal) => end(reject, new Error(`Script stopped before it finished (${signal ?? `exit ${code}`}).`)))
    send({ type: 'start', body, names: Object.keys(helpers), wait: timeout })
  })
}
