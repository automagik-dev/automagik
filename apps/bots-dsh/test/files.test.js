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
  // replaceFile tries again only on Windows, so the test makes that decision as Windows makes
  // it and counts the new tries `check` runs before: ENOENT is not a busy error, so a new try
  // on it is the bug. No clock is read, so a slow shared runner cannot fail this (#324).
  const { platform } = process
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  t.after(() => { Object.defineProperty(process, 'platform', { value: platform, configurable: true }) })
  let retries = 0
  await assert.rejects(
    replaceFile(join(dir, 'missing.tmp'), join(dir, 'state.json'), () => { retries += 1 }),
    { code: 'ENOENT' },
  )
  assert.equal(retries, 0, 'ENOENT must not wait for a second try')
})
