import assert from 'node:assert/strict'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import fsp from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { clearTimeout as realClearTimeout, setTimeout as realTimeout } from 'node:timers'
import { replaceFile } from '../src/host/files.js'

const folder = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-bot-files-'))
  t.after(() => { rmSync(dir, { recursive: true, force: true }) })
  return dir
}

// What the win32 retry path needs from the outside, recorded in order: a move that refuses,
// a wait that costs nothing and a check that only counts.
const refusing = code => {
  const log = []
  return {
    log,
    rename: async () => { log.push('try'); throw Object.assign(new Error(code), { code }) },
    sleep: async ms => { log.push(`sleep ${ms}`) },
    check: () => { log.push('check') },
  }
}
const count = (log, step) => log.filter(entry => entry === step).length

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

test('the busy codes are retried; any other code is not', async () => {
  // The set that makes Windows wait is the whole classification, and this runs on any OS:
  // the real move cannot fail with EBUSY on a runner, so the test's move does (#356).
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const { log, rename, sleep, check } = refusing(code)
    await assert.rejects(
      replaceFile('state.json.tmp', 'state.json', check, { platform: 'win32', sleep, rename }),
      { code },
    )
    assert.equal(count(log, 'try'), 6, `${code} is retried to the last try`)
    assert.equal(count(log, 'check'), 5, `${code} checks before each new try`)
  }
  for (const code of ['ENOENT', 'EEXIST']) {
    const { log, rename, sleep, check } = refusing(code)
    await assert.rejects(
      replaceFile('state.json.tmp', 'state.json', check, { platform: 'win32', sleep, rename }),
      { code },
    )
    assert.deepEqual(log, ['try'], `${code} is given up on the first try, with no wait and no check`)
  }
})

test('an ENOENT is not waited for: the first try throws, no check and no sleep', async (t) => {
  const dir = folder(t)
  let checks = 0
  let sleeps = 0
  const started = performance.now()
  await assert.rejects(
    replaceFile(join(dir, 'missing.tmp'), join(dir, 'state.json'), () => { checks += 1 }, {
      platform: 'win32',
      sleep: async () => { sleeps += 1 },
    }),
    { code: 'ENOENT' },
  )
  // The time is a smoke report, not the assertion: a slow shared runner must not fail this.
  t.diagnostic(`ENOENT rejected after ${(performance.now() - started).toFixed(1)} ms`)
  assert.equal(checks, 0, 'ENOENT must not run the check')
  assert.equal(sleeps, 0, 'ENOENT must not wait for a second try')
})

test('a busy file is waited for and checked between tries, then fails on the last', async () => {
  const { log, rename, sleep, check } = refusing('EBUSY')
  await assert.rejects(
    replaceFile('state.json.tmp', 'state.json', check, { platform: 'win32', sleep, rename }),
    { code: 'EBUSY' },
  )
  assert.deepEqual(log, [
    'try', 'sleep 40', 'check',
    'try', 'sleep 80', 'check',
    'try', 'sleep 120', 'check',
    'try', 'sleep 160', 'check',
    'try', 'sleep 200', 'check',
    'try',
  ], 'six tries, and a wait and a check between each pair')
})
