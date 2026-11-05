import assert from 'node:assert/strict'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { replaceFile } from '../src/host/files.js'

const folder = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-bot-files-'))
  t.after(() => { rmSync(dir, { recursive: true, force: true }) })
  return dir
}

test('replaces a file that another program holds open for a moment', { skip: process.platform !== 'win32' && 'only Windows refuses it' }, async (t) => {
  const dir = folder(t)
  const path = join(dir, 'state.json')
  writeFileSync(path, 'old')
  writeFileSync(`${path}.tmp`, 'new')
  const reader = openSync(path, 'r')
  setTimeout(() => { closeSync(reader) }, 60)
  await replaceFile(`${path}.tmp`, path)
  assert.equal(readFileSync(path, 'utf8'), 'new')
})

test('stops trying when the check before a new try throws, and leaves the file as it was', { skip: process.platform !== 'win32' && 'only Windows refuses it' }, async (t) => {
  const dir = folder(t)
  const path = join(dir, 'state.json')
  writeFileSync(path, 'old')
  writeFileSync(`${path}.tmp`, 'new')
  const reader = openSync(path, 'r')
  const lost = new Error('lost the lock')
  try {
    await assert.rejects(replaceFile(`${path}.tmp`, path, () => { throw lost }), lost)
  } finally {
    closeSync(reader)
  }
  assert.equal(readFileSync(path, 'utf8'), 'old')
})

test('gives up at once on an error that waiting does not fix', async (t) => {
  const dir = folder(t)
  const started = performance.now()
  await assert.rejects(replaceFile(join(dir, 'missing.tmp'), join(dir, 'state.json')), { code: 'ENOENT' })
  const elapsed = performance.now() - started
  t.diagnostic(`ENOENT rejected after ${elapsed.toFixed(2)} ms`)
  // ENOENT must fail at once: it is not a busy error, so replaceFile never waits on it. The
  // ceiling catches a bounded retry that waits before throwing, not a true hang: a hang never
  // rejects, so only the runner timeout catches it. Its 2 s also keeps a slow shared runner
  // from mattering (#324).
  const CEILING_MS = 2000
  assert.ok(elapsed < CEILING_MS, `ENOENT took ${elapsed.toFixed(2)} ms, over ${CEILING_MS} ms`)
})
