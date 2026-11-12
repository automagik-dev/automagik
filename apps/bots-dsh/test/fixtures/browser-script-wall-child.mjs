// Stands in for script-child.js in test/browser-script-wall.test.js. It is plain Node code
// with all of Node in reach, which is what a script that owned its process would have.
// The host starts it exactly as it starts script-child.js, and the start message's body
// names one check. A check is one ordinary call; the answer says whether this process
// could make it.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'

const say = line => process.stdout.write(`${line}\n`)
const message = value => say(JSON.stringify(value))
const answer = value => message({ type: 'done', answer: JSON.stringify(value), error: null })
// 'allowed' when the call went through, else the code of the error that refused it.
const attempt = (fn) => {
  try { fn() } catch (error) { return String(error?.code ?? error) }
  return 'allowed'
}

const checks = {
  // What the process may do.
  readFile: ({ path }) => answer(attempt(() => readFileSync(path))),
  writeFile: ({ path }) => answer(attempt(() => writeFileSync(path, 'written'))),
  spawn: () => answer(attempt(() => {
    const result = spawnSync(process.execPath, ['--version'])
    if (result.error) throw result.error
  })),
  worker: () => answer(attempt(() => new Worker('', { eval: true }))),
  addon: ({ path }) => answer(attempt(() => process.dlopen({ exports: {} }, path))),
  env: () => answer(Object.keys(process.env)),
  // A process that handles the polite stop and so outlives it.
  ignoreStop: () => {
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1_000)
  },
  // Lines that are not what script-child.js sends.
  notJson: () => say('not json'),
  notAnObject: () => say('[1]'),
  unknownType: () => message({ type: 'run', command: 'x' }),
  unknownHelper: () => message({ type: 'call', id: 1, name: 'shell', args: '[]' }),
  inheritedHelper: () => message({ type: 'call', id: 1, name: 'constructor', args: '[]' }),
  argsNotText: () => message({ type: 'call', id: 1, name: 'goto', args: ['x'] }),
  idNotANumber: () => message({ type: 'call', id: 'one', name: 'goto', args: '[]' }),
  answerNotText: () => message({ type: 'done', answer: { text: 'x' }, error: null }),
  errorNotText: () => message({ type: 'done', answer: null, error: 5 }),
  // A message with no end: more than the host holds for one line.
  endlessLine: ({ length }) => process.stdout.write('x'.repeat(length)),
}

let held = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  held += chunk
  const at = held.indexOf('\n')
  if (at === -1) return
  const start = JSON.parse(held.slice(0, at))
  held = ''
  if (start.type !== 'start') return
  const request = JSON.parse(start.body)
  checks[request.check](request)
})
process.stdin.on('end', () => process.exit(0))
