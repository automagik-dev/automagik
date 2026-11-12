import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { discoverSshHosts } from '../src/host/hermes-ssh-hosts.js'

const env = { PATH: 'fixture-bin' }
async function fixture(t, files = {}) {
  const home = await mkdtemp(join(tmpdir(), 'hermes-hosts-')), sshDir = join(home, '.ssh')
  await mkdir(sshDir)
  for (const [name, text] of Object.entries(files)) {
    const path = join(sshDir, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  t.after(() => rm(home, { recursive: true, force: true }))
  return sshDir
}
function resolver(overrides = {}) {
  const calls = []
  const execFile = async (command, args, options) => {
    calls.push({ command, args, options })
    const alias = args[1]
    if (overrides[alias] instanceof Error) throw overrides[alias]
    return { stdout: overrides[alias] ?? `hostname ${alias}.example.invalid\nuser sample-user\nport 2222\nidentityfile /sample/private-key\nproxycommand private fixture detail\n` }
  }
  return { calls, execFile }
}
const discover = (sshDir, execFile, options = {}) => discoverSshHosts({ sshDir, execFile, env, ...options })
const exactFields = result => {
  assert.deepEqual(Object.keys(result), ['aliases', 'knownHosts'])
  for (const host of [...result.aliases, ...result.knownHosts]) {
    assert.deepEqual(Object.keys(host), ['alias', 'hostname', 'user', 'port'])
    for (const value of Object.values(host)) assert.equal(typeof value, 'string')
  }
}

test('SSH aliases resolve through argv-only ssh -G and return exactly four fields without reading identity files', async t => {
  const config = 'Host sample-api 192.0.2.20\n HostName ignored.example.invalid\n User ignored-user\n IdentityFile "keys/do-not-read"\n', poison = 'Host private-key-must-not-be-read\n'
  const sshDir = await fixture(t, { config, 'keys/do-not-read': poison })
  const f = resolver({ '192.0.2.20': 'hostname 192.0.2.21\nuser sample-admin\nport 22\nidentityfile /sample/never-return\n' })
  const result = await discover(sshDir, f.execFile)
  assert.deepEqual(result, { aliases: [
    { alias: 'sample-api', hostname: 'sample-api.example.invalid', user: 'sample-user', port: '2222' },
    { alias: '192.0.2.20', hostname: '192.0.2.21', user: 'sample-admin', port: '22' },
  ], knownHosts: [] })
  exactFields(result)
  for (const call of f.calls) {
    assert.equal(call.command, 'ssh'); assert.deepEqual(call.args, ['-G', call.args[1]])
    assert.equal(call.options.shell, false); assert.equal(call.options.env, env)
    assert.ok(call.options.timeout > 0 && call.options.timeout <= 750)
    assert.equal(call.options.killSignal, 'SIGKILL'); assert.equal(call.options.maxBuffer, 32 * 1024)
  }
  assert.equal(await readFile(join(sshDir, 'config'), 'utf8'), config)
  assert.equal(await readFile(join(sshDir, 'keys/do-not-read'), 'utf8'), poison)
  assert.deepEqual((await readdir(sshDir)).sort(), ['config', 'keys'])
  assert.ok(!JSON.stringify(result).includes('private'))
})

test('the computer list is the Host entries of the SSH config: every alias, no wildcard or negated pattern, Include optional', async t => {
  const config = [
    'Host sample-box', '  HostName sample-box.example.invalid', '  User sample-user', '',
    'Host other-box second-name', '  Port 2200', '',
    'Host *.example.invalid sample-* !sample-negated sample?', '  ForwardAgent no', '',
    'Host *', '  ServerAliveInterval 30', '',
  ].join('\n')
  // No Include at all: the config alone is the list.
  const plain = await discover(await fixture(t, { config }), resolver().execFile)
  assert.deepEqual(plain.aliases.map(host => host.alias), ['sample-box', 'other-box', 'second-name'])
  exactFields(plain)
  // An Include adds its Host entries where it stands; one that matches no file changes nothing.
  const included = await discover(await fixture(t, { config: `Include config.d/*.conf\nInclude missing.d/*.conf\n${config}`, 'config.d/team.conf': 'Host sample-team\nHost team-* *\n' }), resolver().execFile)
  assert.deepEqual(included.aliases.map(host => host.alias), ['sample-team', 'sample-box', 'other-box', 'second-name'])
  exactFields(included)
  for (const result of [plain, included]) assert.ok(!result.aliases.some(host => /[*?!]/.test(host.alias)), 'a pattern is never offered as a computer')
})

test('recursive Include globs use the SSH directory, quotes and equals syntax, skip Match, and stop cycles', async t => {
  const sshDir = await fixture(t, {
    config: 'Host = "sample-root"\nInclude = "config.d/0?.conf" # comment\nMatch user sample-user\n Include excluded.conf\nHost "sample-after"\nInclude nested/first.conf\n',
    'config.d/01.conf': 'Host sample-build *.example.invalid !sample-negated sample?\nIdentityFile excluded.conf\n',
    'config.d/02.conf': 'Match all\n Include excluded.conf\nHost sample-second\n',
    'nested/first.conf': 'Include "config.d/with space.conf"\nInclude nested/first.conf\n',
    'config.d/with space.conf': 'Host sample-included\nInclude config\n',
    'nested/config.d/with space.conf': 'Host wrong-relative-base\n',
    'excluded.conf': 'Host must-not-be-discovered\n',
  })
  const f = resolver(), result = await discover(sshDir, f.execFile)
  assert.deepEqual(result.aliases.map(host => host.alias), ['sample-root', 'sample-build', 'sample-second', 'sample-after', 'sample-included'])
  assert.equal(f.calls.length, 5)
  exactFields(result)
})

test('known_hosts skips every marked row while retaining regular and bracket hosts and ignoring hashes and patterns', async t => {
  const sshDir = await fixture(t, { known_hosts: [
    'known.example.invalid ssh-ed25519 sample-public-key',
    'KNOWN.EXAMPLE.INVALID ssh-rsa sample-other-key',
    '[192.0.2.44]:2202 ssh-ed25519 sample-key',
    '[2001:db8::8]:2203 ssh-ed25519 sample-key',
    '@cert-authority cert.example.invalid,alternate.example.invalid ssh-ed25519 sample-key',
    '@revoked revoked.example.invalid ssh-ed25519 sample-key',
    '@unknown-marker unknown.example.invalid ssh-ed25519 sample-key',
    '|1|sample-salt|sample-hash ssh-ed25519 sample-key',
    '*.example.invalid,!excluded.example.invalid,question?.example.invalid ssh-ed25519 sample-key',
    'malformed-line', '# comment',
  ].join('\n') })
  const result = await discover(sshDir, async () => { throw Error('No aliases should execute') })
  assert.deepEqual(result, { aliases: [], knownHosts: [
    { alias: 'known.example.invalid', hostname: 'known.example.invalid', user: '', port: '' },
    { alias: '192.0.2.44', hostname: '192.0.2.44', user: '', port: '2202' },
    { alias: '2001:db8::8', hostname: '2001:db8::8', user: '', port: '2203' },
  ] })
  exactFields(result)
})

test('known hosts are deduplicated against aliases and resolved hostnames', async t => {
  const sshDir = await fixture(t, { config: 'Host sample-alias\n', known_hosts: 'sample-alias,SERVICE.EXAMPLE.INVALID,[service.example.invalid]:2222,other.example.invalid ssh-ed25519 sample-key\nother.example.invalid ssh-rsa sample-key\n' })
  const result = await discover(sshDir, resolver({ 'sample-alias': 'hostname service.example.invalid\nuser sample-user\nport 2222\n' }).execFile)
  assert.deepEqual(result.knownHosts, [{ alias: 'other.example.invalid', hostname: 'other.example.invalid', user: '', port: '' }])
})

test('one failed ssh -G retains its alias and does not hide successful hosts or expose errors or extra output', async t => {
  const sshDir = await fixture(t, { config: 'Host sample-good sample-failed sample-invalid\n' })
  const f = resolver({ 'sample-failed': Error('private fixture detail'), 'sample-invalid': 'hostname unsafe value\nuser sample user\nport 99999\nidentityfile /sample/private\npassword ignored\n' })
  const result = await discover(sshDir, f.execFile)
  assert.deepEqual(result.aliases[1], { alias: 'sample-failed', hostname: 'sample-failed', user: '', port: '' })
  assert.deepEqual(result.aliases[2], { alias: 'sample-invalid', hostname: 'sample-invalid', user: '', port: '' })
  assert.equal(result.aliases[0].user, 'sample-user')
  assert.ok(!JSON.stringify(result).includes('private'))
  exactFields(result)
})

test('missing config and known_hosts returns empty lists without executing any command', async t => {
  const sshDir = await fixture(t)
  assert.deepEqual(await discover(sshDir, async () => { throw Error('Unexpected executor') }), { aliases: [], knownHosts: [] })
})

test('file, depth, alias and output bounds retain modest valid configs without expanding oversized sources', async t => {
  const files = { config: 'Host sample-kept\nInclude cycle.conf\nInclude oversized.conf\nInclude deep/0.conf\nInclude many/*.conf\n', 'cycle.conf': 'Include config\nHost sample-cycle\n', 'oversized.conf': '#'.repeat(128 * 1024 + 1) + '\nHost oversized-hidden\n' }
  for (let index = 0; index < 10; index++) files[`deep/${index}.conf`] = `Include deep/${index + 1}.conf\nHost deep-${index}\n`
  for (let index = 0; index < 80; index++) files[`many/${String(index).padStart(2, '0')}.conf`] = `Host many-${index}\n`
  const sshDir = await fixture(t, files), f = resolver(), result = await discover(sshDir, f.execFile)
  assert.ok(result.aliases.some(host => host.alias === 'sample-kept'))
  assert.ok(!result.aliases.some(host => ['oversized-hidden', 'deep-8', 'deep-9', 'many-79'].includes(host.alias)))
  assert.ok(result.aliases.length <= 64 && f.calls.length <= 64)
  const manyAliases = await fixture(t, { config: `Host ${Array.from({ length: 200 }, (_, index) => `sample-${index}`).join(' ')}\n` })
  assert.equal((await discover(manyAliases, async () => ({ stdout: 'x'.repeat(32 * 1024 + 1) }))).aliases.length, 128)
})

test('a stuck injected ssh -G is timed out and other aliases remain visible', { timeout: 2000 }, async t => {
  const sshDir = await fixture(t, { config: 'Host sample-stuck sample-fast\n' })
  let killed = false
  const result = await discover(sshDir, async (_command, args, options) => {
    if (args[1] === 'sample-stuck') { options.signal.addEventListener('abort', () => { killed = true }); return new Promise(() => {}) }
    return { stdout: 'hostname fast.example.invalid\nuser sample-user\nport 22\n' }
  })
  assert.equal(killed, true)
  assert.deepEqual(result.aliases[0], { alias: 'sample-stuck', hostname: 'sample-stuck', user: '', port: '' })
  assert.equal(result.aliases[1].hostname, 'fast.example.invalid')
})

test('aborting discovery cancels the executor without starting queued aliases', async t => {
  const sshDir = await fixture(t, { config: 'Host sample-one sample-two sample-three sample-four sample-five\n' }), controller = new AbortController()
  let began, calls = 0
  const entered = new Promise(resolve => { began = resolve }), signals = []
  const pending = discover(sshDir, async (_command, _args, options) => { calls++; signals.push(options.signal); began(); return new Promise(() => {}) }, { signal: controller.signal })
  await entered; controller.abort()
  const result = await pending
  assert.ok(calls <= 4 && calls > 0)
  assert.ok(signals.every(signal => signal.aborted))
  assert.equal(result.aliases.length, 5)
  exactFields(result)
})

test('the owner-sized fourteen aliases and 170 known-host records stay complete and deduplicated', async t => {
  const aliases = Array.from({ length: 14 }, (_, index) => `sample-${index}`)
  const lines = Array.from({ length: 170 }, (_, index) => index < 6
    ? `|1|sample-salt-${index}|sample-hash ssh-ed25519 sample-key`
    : `${index < 20 ? aliases[index - 6] : `known-${index}.example.invalid`} ssh-ed25519 sample-key`)
  const sshDir = await fixture(t, { config: `Host ${aliases.join(' ')}\n`, known_hosts: lines.join('\n') }), f = resolver()
  const result = await discover(sshDir, f.execFile)
  assert.equal(result.aliases.length, 14)
  assert.equal(result.knownHosts.length, 150)
  assert.equal(f.calls.length, 14)
  exactFields(result)
})

test('the cumulative Include byte budget stops before oversized inventories can trigger unbounded resolution', async t => {
  const files = { config: 'Include total/*.conf\n' }
  for (let index = 0; index < 10; index++) files[`total/${index}.conf`] = '#'.repeat(120 * 1024) + `\nHost bounded-${index}\n`
  const sshDir = await fixture(t, files), f = resolver(), result = await discover(sshDir, f.execFile)
  assert.ok(result.aliases.some(host => host.alias === 'bounded-0'))
  assert.ok(result.aliases.length < 10)
  assert.equal(f.calls.length, result.aliases.length)
})
