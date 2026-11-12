import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const GATE = fileURLToPath(new URL('../scripts/image-read-gate.mjs', import.meta.url))

for (const mode of ['pass', 'skip', 'todo', 'missing', 'empty']) {
  test(`required image-read gate: ${mode}`, t => {
    const root = mkdtempSync(join(tmpdir(), 'image-read-gate-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const file = join(root, 'fixture.mjs')
    const options = mode === 'skip' || mode === 'todo' ? `{ ${mode}: true }, ` : ''
    const source = [
      "import { test } from 'node:test'",
      "test('parent', async t => {",
      ...Array.from({ length: mode === 'missing' ? 5 : 6 }, (_, index) =>
        `await t.test('case ${index}', ${index === 0 ? options : ''}() => {})`),
      '})',
    ].join('\n')
    writeFileSync(file, mode === 'empty' ? '' : source)
    // These are independent test runners, not recursive runs inside this test process.
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const plain = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], {
      env, encoding: 'utf8', timeout: 10_000,
    })
    assert.equal(plain.status, 0, 'plain Node stays green even with missing coverage')
    assert.match(plain.stdout, /^# tests \d+$/m, 'the independent runner really executed')
    const guarded = spawnSync(process.execPath, [GATE, file], {
      env, encoding: 'utf8', timeout: 10_000,
    })
    assert.ifError(guarded.error)
    assert.equal(guarded.status, mode === 'pass' ? 0 : 1, guarded.stdout + guarded.stderr)
    if (mode === 'skip' || mode === 'todo') {
      assert.match(guarded.stderr, new RegExp(`expected ${mode === 'skip' ? 'skipped' : mode} 0`))
    } else if (mode !== 'pass') assert.match(guarded.stderr, /expected tests 7/)
  })
}
