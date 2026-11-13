// Required image-read CI: a successful Node exit alone can hide skipped/todo subtests.
// An optional file argument lets the regression tests exercise this gate with real TAP.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const file = process.argv[2] ?? fileURLToPath(
  new URL('../test/image-read.test.js', import.meta.url),
)
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], {
  encoding: 'utf8', timeout: 120_000, maxBuffer: 2 << 20,
})
process.stdout.write(run.stdout ?? '')
process.stderr.write(run.stderr ?? '')
const expected = { tests: 7, pass: 7, fail: 0, cancelled: 0, skipped: 0, todo: 0 }
const problems = []
for (const [name, count] of Object.entries(expected)) {
  const rows = [...(run.stdout ?? '').matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))]
  if (rows.length !== 1 || Number(rows[0][1]) !== count) {
    problems.push(`expected ${name} ${count}; saw ${rows.map(row => row[1]).join(', ') || 'none'}`)
  }
}
if (!/^1\.\.1$/m.test(run.stdout ?? '')) problems.push('expected one complete top-level TAP plan')
if (run.error) problems.push(run.error.message)
for (const problem of problems) console.error(`image-read-gate: ${problem}`)
process.exit(run.status === 0 && run.signal === null && problems.length === 0 ? 0 : 1)
