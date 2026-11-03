import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { batchSafe, quoteForCmd } from '../scripts/batch-spawn.mjs'

test('only a Windows batch file goes through cmd.exe, with every argument quoted', () => {
  assert.deepEqual(batchSafe('npm', ['ci'], { cwd: '/a' }, 'linux'), ['npm', ['ci'], { cwd: '/a' }])
  assert.deepEqual(batchSafe('npm.cmd', ['ci'], {}, 'linux'), ['npm.cmd', ['ci'], {}])
  assert.deepEqual(batchSafe('git.exe', ['status'], {}, 'win32'), ['git.exe', ['status'], {}])
  assert.deepEqual(batchSafe('npm.cmd', ['pack', '--pack-destination', 'C:\\a b\\packs'], { cwd: 'C:\\x' }, 'win32'),
    ['"npm.cmd"', ['"pack"', '"--pack-destination"', '"C:\\a b\\packs"'], { cwd: 'C:\\x', shell: true }])
  assert.deepEqual(batchSafe('C:\\Tools\\RUN.BAT', [], {}, 'win32'), ['"C:\\Tools\\RUN.BAT"', [], { shell: true }])
})

test('a quoted argument reads back as it was, and one cmd.exe would expand is refused', () => {
  assert.equal(quoteForCmd(''), '""')
  assert.equal(quoteForCmd('a & b | c ^ <d>'), '"a & b | c ^ <d>"')
  // A trailing backslash would escape the closing quote.
  assert.equal(quoteForCmd('C:\\packs\\'), '"C:\\packs\\\\"')
  assert.equal(quoteForCmd('C:\\a\\b'), '"C:\\a\\b"')
  for (const bad of ['say "hi"', '%PATH%', 'a\nb', 'a\rb']) assert.throws(() => quoteForCmd(bad), /refusing to pass/)
})

test('on Windows a batch file gets its arguments exactly', { skip: process.platform === 'win32' ? false : 'needs cmd.exe' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'automagik batch-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const script = join(root, 'echo args.cjs')
  writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))')
  const batch = join(root, 'echo.cmd')
  writeFileSync(batch, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
  const args = ['pack', 'a b', 'x&y', 'p|q', 'C:\\dir\\', '']
  assert.deepEqual(JSON.parse(execFileSync(...batchSafe(batch, args, { encoding: 'utf8' }))), args)
})
