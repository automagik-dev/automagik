// The host's side of test/browser-script-wall.test.js, run by the runtime under test
// (Node, or Electron as Node): it starts browser-script-wall-child.mjs through the real
// runner, so the flags, the environment and the channel are the runner's own, and prints
// what came of it as one line of JSON.
//   <runtime> browser-script-wall-host.mjs '<{"check": ..., "timeout": ms, ...}>'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { fileURLToPath } from 'node:url'

const request = JSON.parse(process.argv[2])
const entry = fileURLToPath(new URL('./browser-script-wall-child.mjs', import.meta.url))

// The runner's child, to see for ourselves that it is gone afterwards.
let child
const spawn = childProcess.spawn
childProcess.spawn = (...args) => (child = spawn(...args))
syncBuiltinESMExports()
const { runIsolatedScript } = await import('../../src/host/browser/script-runner.js')

let helperCalls = 0
const helpers = { goto: async () => { helperCalls += 1; return 'ok' } }
const result = { node: process.versions.node, electron: process.versions.electron ?? null, hostCwd: process.cwd() }
try {
  result.answer = await runIsolatedScript(JSON.stringify(request), helpers, { timeout: request.timeout, entry })
} catch (error) {
  result.error = String(error?.message ?? error)
}
result.helperCalls = helperCalls
// A settled run alone does not prove that the process stopped.
result.exit = await new Promise((resolve) => {
  const ended = () => ({ code: child.exitCode, signal: child.signalCode })
  if (child.exitCode !== null || child.signalCode !== null) return resolve(ended())
  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    resolve('survived')
  }, 3_000)
  child.once('exit', () => { clearTimeout(timer); resolve(ended()) })
})
console.log(JSON.stringify(result))
process.exit(0)
