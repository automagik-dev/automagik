import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linkInArgs, parseDeepLink } from '../src/deeplink.js'

test('a connect link gives the Omni\'s address, cleaned, and whether it is encrypted', () => {
  assert.deepEqual(parseDeepLink('omni://connect?url=https%3A%2F%2Fomni.example.com'), { action: 'connect', url: 'https://omni.example.com', host: 'omni.example.com', secure: true })
  assert.deepEqual(parseDeepLink('omni://connect?url=https://omni.example.com/api/v2/'), { action: 'connect', url: 'https://omni.example.com', host: 'omni.example.com', secure: true })
  assert.deepEqual(parseDeepLink('omni://connect?url=https://example.com/omni/'), { action: 'connect', url: 'https://example.com/omni', host: 'example.com', secure: true })
  assert.equal(parseDeepLink('omni://connect?url=http://192.168.1.5:8882').secure, false)
  assert.deepEqual(parseDeepLink('omni:connect?url=https://omni.example.com').url, 'https://omni.example.com')
  assert.deepEqual(parseDeepLink('omni://open'), { action: 'open' })
})

test('anything else is refused: other schemes, other actions, odd or credentialed addresses', () => {
  for (const bad of [
    'https://omni.example.com',
    'omni://connect',
    'omni://connect?url=',
    'omni://connect?url=javascript:alert(1)',
    'omni://connect?url=file:///etc/passwd',
    'omni://connect?url=https://user:pass@omni.example.com',
    'omni://delete?url=https://omni.example.com',
    'not a link',
  ]) assert.equal(parseDeepLink(bad), null, bad)
})

test('the link comes from the command line on Linux, among Electron\'s own arguments', () => {
  assert.equal(linkInArgs(['/usr/bin/omni-desktop', '--no-sandbox', 'omni://connect?url=https://a.example']), 'omni://connect?url=https://a.example')
  assert.equal(linkInArgs(['/usr/bin/omni-desktop']), null)
  assert.equal(linkInArgs(undefined), null)
})
