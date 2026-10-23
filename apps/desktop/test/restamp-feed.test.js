import assert from 'node:assert/strict'
import { test } from 'node:test'
import { restampFeed } from '../scripts/restamp-feed.mjs'

const FEED = `version: 2.261023.5
files:
  - url: Omni-2.261023.5-mac-arm64.zip
    sha512: zipsum
    size: 353591688
  - url: Omni-2.261023.5-mac-arm64.dmg
    sha512: oldsum
    size: 328311718
path: Omni-2.261023.5-mac-arm64.zip
sha512: zipsum
releaseDate: '2026-10-23T04:22:52.657Z'
`

test("the stapled dmg's sha512 and size replace the old ones, and nothing else moves", () => {
  const out = restampFeed(FEED, { url: 'Omni-2.261023.5-mac-arm64.dmg', sha512: 'newsum', size: 328400000 })
  assert.equal(out, FEED.replace('sha512: oldsum', 'sha512: newsum').replace('size: 328311718', 'size: 328400000'))
})

test('a file the feed does not list is refused', () => {
  assert.throws(() => restampFeed(FEED, { url: 'Omni-1.0.0-mac-arm64.dmg', sha512: 'x', size: 1 }), /lists no/)
})
