import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { feedProblems, parseFeed } from '../scripts/check-feed.mjs'

const sha512 = bytes => createHash('sha512').update(bytes).digest('base64')
// The shape electron-builder writes for NSIS (latest.yml).
const feedOf = ({ exe = 'Automagik-3.65.0-win-x64.exe', sum, size, path = exe }) => `version: 3.65.0
files:
  - url: ${exe}
    sha512: ${sum}
    size: ${size}
path: ${path}
sha512: ${sum}
releaseDate: '2026-11-03T12:00:00.000Z'
`

test('a feed is read for its files, its path and its sha512', () => {
  assert.deepEqual(parseFeed(feedOf({ sum: 'abc==', size: 12 }).replaceAll('\n', '\r\n')), {
    files: [{ url: 'Automagik-3.65.0-win-x64.exe', sha512: 'abc==', size: 12 }], path: 'Automagik-3.65.0-win-x64.exe', sha512: 'abc==',
  })
})

test('the Windows feed must name the installer beside it, with its sha512 and size', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'automagik-feed-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bytes = Buffer.from('an installer')
  writeFileSync(join(dir, 'Automagik-3.65.0-win-x64.exe'), bytes)
  assert.deepEqual(feedProblems(feedOf({ sum: sha512(bytes), size: bytes.length }), dir), [])
  assert.match(feedProblems(feedOf({ sum: sha512('another build'), size: bytes.length }), dir).join('\n'), /the feed says sha512/)
  assert.match(feedProblems(feedOf({ sum: sha512(bytes), size: 1 }), dir).join('\n'), /the feed says 1 bytes/)
  assert.match(feedProblems(feedOf({ exe: 'Automagik-3.64.0-win-x64.exe', sum: sha512(bytes), size: bytes.length }), dir).join('\n'), /is not beside the feed/)
  assert.match(feedProblems(feedOf({ sum: sha512(bytes), size: bytes.length, path: 'other.exe' }), dir).join('\n'), /path other\.exe is not one of its files/)
  assert.deepEqual(feedProblems('version: 1.0.0\n', dir).slice(0, 1), ['the feed lists no files'])
})
