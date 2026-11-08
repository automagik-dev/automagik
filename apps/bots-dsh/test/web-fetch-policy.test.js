// web_fetch is on in both the bot profile (the desktop app) and the channel profile (the
// server). DSH 0.2.2's HTTP provider has no address policy of its own, so bots-dsh gates the
// web_fetch tool with the same address lists as the Bot browser. Both lists start empty:
// localhost, LAN and tailnet fetches are allowed by default.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const desktopProfile = new URL('../../desktop/profile/cordis.patch.yml', import.meta.url)
const serverProfile = new URL('../../../server/profile/cordis.patch.yml', import.meta.url)
const profiles = [
  ['desktop', readFileSync(desktopProfile, 'utf8')],
  ['server', readFileSync(serverProfile, 'utf8')],
]

test('both bot and channel profiles leave web fetch on', () => {
  for (const [name, profile] of profiles) {
    assert.match(profile, /- id: web-fetch-http\n {2}disabled: false/, name)
    assert.match(profile, /fetchProvider: http/, name)
    assert.doesNotMatch(profile, /- id: web-fetch-http\n {2}disabled: true/, name)
  }
})

test('the app profile keeps read-before-write on', () => {
  const desktop = profiles[0][1]
  assert.match(desktop, /- id: fs-observation-policy\n {2}disabled: false/)
})
