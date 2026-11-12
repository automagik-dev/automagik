// What a failed SSH connection leaves behind on the host: one cleaned diagnostics line,
// the facts its own wizard screen may show, and a new host key that only the trust step
// saves. Everything here runs against the fake ssh and the fake Hermes: no SSH client,
// no network, no real host name, user or key.
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { test } from 'node:test'
import { install as installDiagnostics } from '../src/host/diagnostics.js'
import { install } from '../src/host/hermes-remote.js'
import { startHermesSsh } from '../src/host/hermes-ssh.js'
import { redactSshNames, sshNames } from '../src/host/hermes-ssh-names.js'
import { fakeContext } from './fake-ctx.js'

const deadlines = { start: 5000, control: 2000, cancel: 400 }
const sampleKey = () => Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from([0, 0, 0, 32]), randomBytes(32)]).toString('base64')
const fingerprintOf = blob => `SHA256:${createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64').replace(/=+$/, '')}`
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value, headers: { getSetCookie: () => [] } })

async function host(t, { scenario, ...overrides } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'hermes-ssh-failures-'))
  const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  await writeFile(join(home, 'ssh'), `#!${process.execPath}\n${await fixture('hermes-fake-ssh.mjs')}`, { mode: 0o700 })
  const hermesPath = join(home, 'sample-hermes')
  await writeFile(hermesPath, `#!${process.execPath}\n${await fixture('hermes-fake-runtime.mjs')}`, { mode: 0o700 })
  const credential = randomBytes(32).toString('hex'), hostKey = sampleKey()
  const env = { ...process.env, HOME: home, PATH: `${dirname(process.execPath)}${delimiter}${home}${delimiter}${process.env.PATH}`, HERMES_SSH_RECORD: join(home, 'record.jsonl'), HERMES_SSH_SCENARIO: scenario ?? 'ready', HERMES_SSH_REMOTE_PORT: '4040', HERMES_SSH_HOST_KEY: hostKey }
  const ctx = fakeContext(), endpoints = new Map(), trusted = []
  ctx.llm.registerAdapter = () => () => {}
  const rt = { ctx, home, config: {}, state: { prefs: {}, bots: {}, mainBotIds: [], rooms: {} }, hooks: { endpoint: (name, fn) => endpoints.set(name, fn) },
    load: async () => {}, loadSecrets: async () => {}, secretValue: () => undefined, save: async () => {} }
  installDiagnostics(rt)
  install(rt, {
    deadlines, fetch: async () => response({}, 500),
    // The real SSH adapter, against the fake ssh executable in this test's own folder.
    startSsh: (ssh, options) => startHermesSsh(ssh, { ...options, env, allocatePort: async () => 4041, randomBytes: size => size === 32 ? Buffer.from(credential, 'hex') : randomBytes(size) }),
    trustSsh: async (...args) => { trusted.push(args); return { trusted: true, added: 1 } },
    ...overrides,
  })
  t.after(async () => { ctx.dispose(); await rm(home, { recursive: true, force: true, maxRetries: 5 }) })
  const call = (name, body) => endpoints.get(name)(body)
  const test = async (ssh, requestId = randomUUID()) => {
    let failure
    await assert.rejects(call('hermes-remote-test', { mode: 'ssh', ssh, requestId }), error => { failure = error; return true })
    return { failure, requestId, view: (await call('hermes-remote-test-status', { requestId })).failure }
  }
  const logged = async () => (await rt.diagnostics.entries()).filter(entry => entry.where === 'Remote Hermes')
  return { rt, home, call, test, logged, trusted, credential, hostKey, hermesPath }
}

test('a failed SSH test leaves one cleaned diagnostics line: stage, kind, time and the last lines, never the alias', async t => {
  const h = await host(t, { scenario: 'runtime-exit-early' })
  const alias = `sample-${randomUUID()}`
  const { failure, view } = await h.test({ host: alias, hermesPath: h.hermesPath })
  assert.equal(failure.code, 'bot/hermes-ssh-exited')
  const entries = await h.logged()
  assert.equal(entries.length, 1, 'one line per failed test')
  const [entry] = entries
  assert.equal(entry.code, 'bot/hermes-ssh-exited')
  assert.match(entry.text, new RegExp(`^Remote Hermes SSH failed: alias=<alias> stage=hermes-start kind=hermes-exited elapsed=\\d+ms exit=3 hermes="`))
  assert.match(entry.text, /sample start failure/)
  assert.match(entry.text, /could not read ~\/\.hermes\/config\.yaml/)
  // The planted token, the nonce Hermes echoed, the home path and this test's own folder.
  const nonce = (await readFile(join(h.home, 'record.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)).find(record => record.event === 'runtime-start').args.at(-1)
  for (const secret of [h.credential, nonce, 'sample-person', h.home]) {
    assert.ok(!entry.text.includes(secret), secret)
    assert.ok(!JSON.stringify(view).includes(secret), secret)
    assert.ok(!failure.message.includes(secret) && !failure.stack.includes(secret), secret)
  }
  // The same line is in the log file the app's diagnostics view and report read.
  const file = join(h.home, 'logs', 'diagnostics.jsonl')
  const until = Date.now() + 5000
  let text = ''
  while (!text.includes('Remote Hermes SSH failed') && Date.now() < until) { text = await readFile(file, 'utf8').catch(() => ''); await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.equal(text.trim().split('\n').length, 1)
  for (const secret of [h.credential, nonce, 'sample-person', alias]) assert.ok(!text.includes(secret), secret)
  assert.match((await h.rt.diagnostics.report({})).markdown, /Remote Hermes SSH failed: alias=<alias> stage=/)
  // The person's own screen gets the same facts, shaped.
  assert.deepEqual({ code: view.code, kind: view.kind, stage: view.stage, alias: view.alias, exit: view.exit }, { code: 'bot/hermes-ssh-exited', kind: 'hermes-exited', stage: 'hermes-start', alias, exit: 3 })
  assert.ok(view.hermes.some(line => line.includes('sample start failure')))
})

test('what SSH said reaches the line without key names; the key and identity names stay off it', async t => {
  const said = await host(t, { scenario: 'unclassified' })
  const first = await said.test({ host: 'sample.invalid' })
  assert.equal(first.failure.code, 'bot/hermes-ssh')
  assert.match((await said.logged())[0].text, /stage=ssh-sign-in kind=unknown elapsed=\d+ms ssh="A sample line SSH said, with ~\/\.ssh\/\[hidden\] in it"$/)

  const refused = await host(t, { scenario: 'auth' })
  const second = await refused.test({ host: 'sample.invalid' })
  assert.deepEqual(second.view.identities, ['id_sample', 'id_other'])
  assert.equal(second.view.agentKeys, 1)
  const [line] = await refused.logged()
  assert.match(line.text, /kind=auth-failed/)
  assert.ok(!line.text.includes('id_sample') && !line.text.includes('id_other'), 'an identity file name is for the screen only')

  const unknown = await host(t, { scenario: 'host-key' })
  const third = await unknown.test({ host: 'sample.invalid' })
  assert.equal(third.view.fingerprint, fingerprintOf(unknown.hostKey))
  assert.ok(!(await unknown.logged())[0].text.includes(third.view.fingerprint.slice(7)), 'no key material in the line')
})

test('the failure facts belong to their own request and go when the test passes or is replaced', async t => {
  const h = await host(t, { scenario: 'old-contract' })
  const { requestId, view } = await h.test({ host: 'sample.invalid' })
  assert.equal(view.kind, 'update-required')
  assert.equal(view.stage, 'remote-start')
  assert.equal((await h.call('hermes-remote-test-status', { requestId })).failure.kind, 'update-required', 'read back by its own request')
  assert.equal((await h.call('hermes-remote-test-status', { requestId: randomUUID() })).failure, undefined)
  assert.equal((await h.call('hermes-remote-test-status', {})).failure, undefined)
  // Nothing of the SSH details (user, key path) is in what the browser can read back.
  const next = await h.test({ host: 'sample.invalid', user: 'sample-user', identityFile: '/sample/home/.ssh/id_sample' })
  assert.ok(!JSON.stringify(next.view).includes('sample-user') && !JSON.stringify(next.view).includes('id_sample'))
})

test('a new host key is trusted only by the button, with the key the host kept, not the browser’s', async t => {
  const h = await host(t, { scenario: 'host-key' })
  const ssh = { host: 'sample.invalid', user: 'sample-user', port: 2200 }
  const { failure, requestId, view } = await h.test(ssh)
  assert.equal(failure.code, 'bot/hermes-ssh-host-key-unknown')
  assert.deepEqual({ kind: view.kind, keyType: view.keyType, fingerprint: view.fingerprint }, { kind: 'host-key-unknown', keyType: 'ssh-ed25519', fingerprint: fingerprintOf(h.hostKey) })
  assert.equal(h.trusted.length, 0, 'a failed test trusts nothing')
  // Another request, or none, cannot trust this key.
  for (const body of [{}, { requestId: randomUUID() }, { requestId: 'connect' }]) await assert.rejects(h.call('hermes-remote-ssh-trust', body), error => error.code === 'bot/hermes-expired')
  assert.equal(h.trusted.length, 0)
  // The browser names its request; a key it sends along is ignored.
  assert.deepEqual(await h.call('hermes-remote-ssh-trust', { requestId, keyType: 'ssh-rsa', fingerprint: fingerprintOf(sampleKey()), ssh: { host: 'other.invalid' } }), { trusted: true })
  assert.equal(h.trusted.length, 1)
  assert.deepEqual(h.trusted[0][0], ssh)
  assert.deepEqual(h.trusted[0][1], { keyType: 'ssh-ed25519', fingerprint: fingerprintOf(h.hostKey) })
  // One failed test, one trust.
  await assert.rejects(h.call('hermes-remote-ssh-trust', { requestId }), error => error.code === 'bot/hermes-expired')
  assert.equal(h.trusted.length, 1)
})

test('a changed host key can never be trusted, and a refused trust is logged with its own code', async t => {
  const changed = await host(t, { scenario: 'changed-key' })
  const { failure, requestId, view } = await changed.test({ host: 'sample.invalid' })
  assert.equal(failure.code, 'bot/hermes-ssh-host-key')
  assert.equal(view.kind, 'host-key-changed')
  assert.ok(!view.fingerprint && !view.keyType, 'a changed key is not offered')
  await assert.rejects(changed.call('hermes-remote-ssh-trust', { requestId }), error => error.code === 'bot/hermes-expired')
  assert.equal(changed.trusted.length, 0)

  // The host changed its key between the screen and the button: the trust step refuses.
  const refusal = Object.assign(new Error('Sample refusal'), { code: 'bot/hermes-ssh-host-key', sshError: 'host-key-changed', sshStage: 'host-key', sshDetail: { mismatch: true } })
  const swapped = await host(t, { scenario: 'host-key', trustSsh: async () => { throw refusal } })
  const first = await swapped.test({ host: 'sample.invalid' })
  await assert.rejects(swapped.call('hermes-remote-ssh-trust', { requestId: first.requestId }), error => error.code === 'bot/hermes-ssh-host-key' && !error.message.includes('Sample refusal'))
  const after = (await swapped.call('hermes-remote-test-status', { requestId: first.requestId })).failure
  assert.deepEqual({ kind: after.kind, stage: after.stage, mismatch: after.mismatch }, { kind: 'host-key-changed', stage: 'host-key', mismatch: true })
  assert.equal((await swapped.logged()).length, 2)
  assert.match((await swapped.logged())[1].text, /stage=host-key kind=host-key-changed/)
  await assert.rejects(swapped.call('hermes-remote-ssh-trust', { requestId: first.requestId }), error => error.code === 'bot/hermes-expired')
})

test('after the tunnel, a refused token and a silent tunnel are SSH kinds with their stage', async t => {
  const connection = () => ({ address: 'http://127.0.0.1:4041', credential: randomBytes(32).toString('hex'), close: async () => {} })
  const refused = await host(t, { startSsh: async () => connection(), fetch: async () => response({}, 401) })
  const first = await refused.test({ host: 'sample.invalid' })
  assert.equal(first.failure.code, 'bot/hermes-ssh-handshake')
  assert.deepEqual({ kind: first.view.kind, stage: first.view.stage }, { kind: 'handshake', stage: 'token' })

  const silent = await host(t, { startSsh: async () => connection(), fetch: async () => { throw new Error('Sample socket hang up') } })
  const second = await silent.test({ host: 'sample.invalid' })
  assert.equal(second.failure.code, 'bot/hermes-ssh-tunnel')
  assert.deepEqual({ kind: second.view.kind, stage: second.view.stage }, { kind: 'tunnel', stage: 'token' })
  assert.match((await silent.logged())[0].text, /stage=token kind=tunnel/)

  // Another answer from Hermes keeps its own code, with the stage it stopped at.
  const broken = await host(t, { startSsh: async () => connection(), fetch: async () => response({}, 500) })
  const third = await broken.test({ host: 'sample.invalid' })
  assert.equal(third.failure.code, 'bot/hermes-connection')
  assert.deepEqual({ kind: third.view.kind, stage: third.view.stage }, { kind: 'connection', stage: 'token' })
})

test('a saved SSH connection that fails to open keeps its kind and its facts for the wizard', async t => {
  const failure = Object.assign(new Error('Sample failure'), { code: 'bot/hermes-ssh-exited', sshError: 'hermes-exited', sshStage: 'hermes-start', sshDetail: { exit: 1, hermes: ['sample start failure'] } })
  const h = await host(t, { startSsh: async () => { throw failure } })
  h.rt.state.prefs.hermesRemote = { enabled: true, mode: 'ssh', ssh: { host: 'sample.invalid' }, profile: 'sample-profile', setupVersion: 1, models: [{ id: 'sample:model' }] }
  await assert.rejects(h.call('hermes-remote-connect', {}), error => error.code === 'bot/hermes-ssh-exited' && !error.message.includes('Sample failure'))
  const view = (await h.call('hermes-remote-test-status', { connect: true })).failure
  assert.deepEqual({ kind: view.kind, stage: view.stage, alias: view.alias, exit: view.exit, hermes: view.hermes }, { kind: 'hermes-exited', stage: 'hermes-start', alias: 'sample.invalid', exit: 1, hermes: ['sample start failure'] })
  assert.match((await h.logged())[0].text, /alias=<alias> stage=hermes-start kind=hermes-exited/)
})

// Everything a stored line could say of who and where: sample names only.
const WHO = ['sample-user', 'sample-remote', 'example.invalid', '192.0.2.44', '2001:db8', '::7:']
const logFile = async (h, lines) => {
  const until = Date.now() + 5000
  let text = ''
  while (text.trim().split('\n').filter(Boolean).length < lines && Date.now() < until) { text = await readFile(join(h.home, 'logs', 'diagnostics.jsonl'), 'utf8').catch(() => ''); await new Promise(resolve => setTimeout(resolve, 10)) }
  return text
}

test('the stored line and every export name no remote user, host, address or alias; the screen keeps them', async t => {
  const alias = `sample-alias-${randomUUID().slice(0, 8)}`
  const h = await host(t, { scenario: 'named-tail' })
  const { view } = await h.test({ host: alias, user: 'sample-user' })
  // The person's own screen: the alias they typed and what SSH said, as SSH said it.
  assert.equal(view.alias, alias)
  assert.deepEqual(view.ssh, [
    "Warning: Permanently added the ED25519 host key for IP address '2001:db8::7:1' to the list of known hosts.",
    `sample-user reached sample-remote.example.invalid through sample-user@${alias} at 192.0.2.44 and [2001:db8::7:2]:22`,
    'sample-user@sample-remote.example.invalid: Connection closed by 192.0.2.44 port 22',
  ])
  const [entry] = await h.logged()
  assert.match(entry.text, /^Remote Hermes SSH failed: alias=<alias> stage=ssh-sign-in kind=[a-z-]+ elapsed=\d+ms /)
  assert.equal(entry.text.slice(entry.text.indexOf(' ssh=')), ` ssh=${JSON.stringify([
    "Warning: Permanently added the ED25519 host key for IP address '<ip>' to the list of known hosts.",
    '<user> reached <host> through <user>@<alias> at <ip> and [<ip>]:22',
    '<user>@<host>: Connection closed by <ip> port 22',
  ].join(' | '))}`)

  // Hermes's own last lines get the same placeholders, with the names SSH's trace gave.
  const exited = await host(t, { scenario: 'frame-exit-named' })
  const second = await exited.test({ host: alias })
  assert.deepEqual(second.view.hermes, ['serving sample-user on sample-remote.example.invalid', `bound 192.0.2.44:8642 and [2001:db8::7:1]:8642 for ${alias}`])
  const [other] = await exited.logged()
  // SSH said nothing of its own here, so the line holds the end of its trace: cleaned too.
  assert.match(other.text, /^Remote Hermes SSH failed: alias=<alias> stage=[a-z-]+ kind=hermes-exited elapsed=\d+ms exit=2 ssh="debug1: Connecting to <host> \[<ip>\] port 22\. \| debug1: Authenticating to <host>:22 as '<user>'" hermes="serving <user> on <host> \| bound <ip>:8642 and \[<ip>\]:8642 for <alias>"$/)

  // What is stored, and everything the Feedback page shows, copies, downloads or files.
  for (const run of [h, exited]) {
    const report = await run.rt.diagnostics.report({})
    const leaving = { stored: JSON.stringify(await run.logged()), file: await logFile(run, 1), entries: JSON.stringify(report.entries), markdown: report.markdown, log: await run.rt.diagnostics.logText() }
    for (const [where, text] of Object.entries(leaving)) {
      assert.match(text, /Remote Hermes SSH failed: alias=<alias> /, where)
      for (const name of [...WHO, alias]) assert.ok(!text.includes(name), `${where} names ${name}`)
    }
  }
})

test('addresses, users and hosts become placeholders in every form SSH writes them; the rest stays', () => {
  const names = { alias: 'sample-box', hosts: ['sample-box.example.invalid'], users: ['sample-user'] }
  const cases = [
    ['connect to address 192.0.2.7 port 22: Connection refused', 'connect to address <ip> port 22: Connection refused'],
    ['fe80::1%eth0: Connection refused, then ::1, [2001:db8::1]:22 and ::ffff:192.0.2.1', '<ip>: Connection refused, then <ip>, [<ip>]:22 and <ip>'],
    ['2001:0db8:0000:0000:0000:0000:0000:0001: No route to host', '<ip>: No route to host'],
    ['bind [127.0.0.1]:8080: Address already in use', 'bind [<ip>]:8080: Address already in use'],
    // A clock time, a version and an algorithm's name are none of them.
    ['at 12:34:56 OpenSSH_9.6p1 offered chacha20-poly1305@openssh.com', 'at 12:34:56 OpenSSH_9.6p1 offered chacha20-poly1305@openssh.com'],
    // The alias is often the start of the host name: the longer name goes first.
    ['sample-box is sample-box.example.invalid for sample-user.', '<alias> is <host> for <user>.'],
    ['other-user@other.example.invalid: Permission denied (publickey).', '<user>@<host>: Permission denied (publickey).'],
    ['ssh: connect to host jump.example.invalid port 22: Connection timed out', 'ssh: connect to host <host> port 22: Connection timed out'],
    ['ssh: Could not resolve hostname other.example.invalid: Name or service not known', 'ssh: Could not resolve hostname <host>: Name or service not known'],
    ["Warning: Permanently added 'other.example.invalid,192.0.2.9' (ED25519) to the list of known hosts.", "Warning: Permanently added '<host>,<ip>' (ED25519) to the list of known hosts."],
    ['Connection closed by remote host', 'Connection closed by remote host'],
    ['Connection reset by peer', 'Connection reset by peer'],
    ['Host key verification failed.', 'Host key verification failed.'],
  ]
  for (const [said, kept] of cases) assert.equal(redactSshNames(said, names), kept)
  // With no names known at all, the shapes alone still go.
  assert.equal(redactSshNames('sample-user@sample-box.example.invalid: Connection closed by 192.0.2.7 port 22'), '<user>@<host>: Connection closed by <ip> port 22')
  assert.deepEqual(sshNames("debug1: Connecting to sample-box.example.invalid [192.0.2.7] port 22.\ndebug1: Authenticating to sample-box.example.invalid:22 as 'sample-user'\nsample line\n", 'hostname other.example.invalid\nuser other-user\nport 22\n'),
    { hosts: ['sample-box.example.invalid', 'other.example.invalid'], users: ['sample-user', 'other-user'] })
})
