// Where the machine DSH runs on is, seen from the page: loopback addresses, the viewer's OS, and
// the rule that puts them together with what the host says about itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLoopbackHost, viewerOsOf, whereOf } from '../src/client/where.js'

test('loopback is localhost, 127.x, ::1 and its IPv4-mapped forms, never a LAN or Tailscale address', () => {
  const loopback = ['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1', '[::ffff:127.0.0.1]', '::ffff:127.0.0.1', '[::ffff:7f00:1]', '0.0.0.0']
  for (const name of loopback) assert.equal(isLoopbackHost(name), true, name)
  // URL's own spelling of the IPv4-mapped loopback.
  assert.equal(isLoopbackHost(new URL('http://[::ffff:127.0.0.1]:8080/').hostname), true)
  const elsewhere = ['192.168.1.10', '100.64.0.5', '10.0.0.1', 'myhost.example', 'localhost.example', '127.0.0.1.example', '128.0.0.1', '127.0.0.256', '[::2]', '::ffff:192.168.1.10', '', undefined, null, 42]
  for (const name of elsewhere) assert.equal(isLoopbackHost(name), false, String(name))
})

test('the viewer\'s OS comes from userAgentData first, then navigator.platform; Android and iOS are other', () => {
  const hinted = platform => viewerOsOf({ userAgentData: { platform }, platform: 'Win32' })
  assert.deepEqual(['macOS', 'Windows', 'Linux', 'Chrome OS', 'Android'].map(hinted), ['macos', 'windows', 'linux', 'other', 'other'])
  const platformed = (platform, userAgent = '') => viewerOsOf({ platform, userAgent })
  assert.equal(platformed('MacIntel'), 'macos')
  assert.equal(platformed('Win32'), 'windows')
  assert.equal(platformed('Linux x86_64'), 'linux')
  assert.equal(platformed('Linux armv8l', 'Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'other')
  assert.equal(platformed('Linux aarch64', 'Mozilla/5.0 (Linux; Android 14)'), 'other')
  assert.equal(platformed('iPhone'), 'other')
  assert.equal(platformed('iPad'), 'other')
  // A browser that says nothing: no OS, so nothing to compare.
  assert.equal(viewerOsOf(undefined), undefined)
  assert.equal(viewerOsOf({}), undefined)
  assert.equal(viewerOsOf({ userAgentData: { platform: '' }, platform: '' }), undefined)
})

const MAC = { platform: 'MacIntel' }
const LINUX = { platform: 'Linux x86_64' }
const page = (hostname, navigator, extra = {}) => ({ location: { hostname }, navigator, ...extra })

test('whereOf: the desktop app first, then the address, then SSH and the two OSes', () => {
  const cases = [
    // Automagik's desktop app runs its own DSH: here, named by the app's OS (WSLC: a Linux host on a Windows PC).
    ['desktop on Windows, Linux host', { machine: { os: 'linux' }, scope: { omniDesktop: { platform: 'win32' }, location: { hostname: '127.0.0.1' } } }, { at: 'here', os: 'windows' }],
    ['desktop on a Mac', { machine: { os: 'macos', remoteHint: true }, scope: { omniDesktop: { platform: 'darwin' } } }, { at: 'here', os: 'macos' }],
    ['desktop without a platform', { machine: { os: 'linux' }, scope: { omniDesktop: {} } }, { at: 'here', os: 'linux' }],
    ['a server address', { machine: { os: 'linux' }, scope: page('dsh.example.com', MAC) }, { at: 'remote', os: 'linux' }],
    ['a Tailscale address, same OS', { machine: { os: 'linux' }, scope: page('100.64.0.5', LINUX) }, { at: 'remote', os: 'linux' }],
    ['a server address, old host', { scope: page('dsh.example.com', MAC) }, { at: 'remote', os: 'other' }],
    // The reported case: a Mac reading a Linux server's DSH through an SSH tunnel.
    ['loopback, Mac viewer, Linux host', { machine: { os: 'linux' }, scope: page('localhost', MAC) }, { at: 'remote', os: 'linux' }],
    ['loopback, same OS', { machine: { os: 'macos' }, scope: page('127.0.0.1', MAC) }, { at: 'here', os: 'macos' }],
    ['loopback, launched over SSH', { machine: { os: 'linux', remoteHint: true }, scope: page('[::1]', LINUX) }, { at: 'remote', os: 'linux' }],
    ['loopback, viewer OS unknown', { machine: { os: 'linux' }, scope: page('localhost', undefined) }, { at: 'here', os: 'linux' }],
    ['loopback, viewer OS other', { machine: { os: 'windows' }, scope: page('localhost', { platform: 'iPad' }) }, { at: 'here', os: 'windows' }],
    ['loopback, host OS other', { machine: { os: 'other' }, scope: page('localhost', MAC) }, { at: 'here', os: 'other' }],
    ['loopback, old host', { scope: page('localhost', MAC) }, { at: 'unknown' }],
    ['no address, launched over SSH', { machine: { os: 'linux', remoteHint: true }, scope: {} }, { at: 'remote', os: 'linux' }],
    ['no address', { machine: { os: 'linux' }, scope: {} }, { at: 'unknown' }],
    ['nothing at all', { scope: {} }, { at: 'unknown' }],
    ['an OS the welcome does not know', { machine: { os: 'plan9' }, scope: page('localhost', MAC) }, { at: 'unknown' }],
  ]
  for (const [name, input, expected] of cases) assert.deepEqual(whereOf(input), expected, name)
  assert.deepEqual(whereOf({ scope: undefined }), { at: 'unknown' })
})
