// node --test bridge/meter.test.mjs: the install script, hc exec decoding and the loop, against
// a fake curl and a fake hc. Synthetic data only; nothing touches the network or the real home.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync, mkdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INSTALL, SYNC, ASSETS, parseSums, parseLatest, assetUrl, failing, hcExec, meterOne, startMeter, SHOW_AFTER } from './meter.mjs'

const sha = (b) => createHash('sha256').update(b).digest('hex')

/** A home with a fake curl that "downloads" `payload` and logs its arguments. */
function sandbox(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'meter-test-'))
  const home = join(dir, 'home'); mkdirSync(home)
  const bin = join(dir, 'bin'); mkdirSync(bin)
  writeFileSync(join(dir, 'payload'), payload)
  writeFileSync(join(bin, 'curl'), `#!/bin/sh\necho "$@" >> "${dir}/curl.log"\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && cp "${dir}/payload" "$2"; shift; done\n`)
  chmodSync(join(bin, 'curl'), 0o755)
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` }
  const run = (want, version = '0.2.0') => {
    try {
      return { code: 0, out: execFileSync('/bin/sh', ['-c', INSTALL, 'sh', 'https://example.invalid/usagemeter-x', want, version], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
    } catch (e) { return { code: e.status, out: String(e.stderr).trim() } }
  }
  return { dir, home, bin, env, run, dest: join(home, '.local/bin/usagemeter'), old: join(home, '.local/bin/automagik-meter') }
}

test('install verifies the hash before the binary is used, and only then replaces it', () => {
  const good = Buffer.from('#!/bin/sh\necho usagemeter 0.2.0\n')
  const s = sandbox(good)
  assert.deepEqual(s.run(sha(good)), { code: 0, out: 'installed' })
  assert.equal(readFileSync(s.dest, 'utf8'), good.toString())
  assert.equal(statSync(s.dest).mode & 0o777, 0o755)
  assert.deepEqual(s.run(sha(good)), { code: 0, out: 'current' }, 'no download when it matches')
  assert.equal(readFileSync(join(s.dir, 'curl.log'), 'utf8').trim().split('\n').length, 1)
  assert.match(readFileSync(join(s.dir, 'curl.log'), 'utf8'), /--proto =https/)

  // A tampered download is refused and the installed binary stays.
  writeFileSync(join(s.dir, 'payload'), 'not the release')
  const r = s.run(sha(Buffer.from('a newer release')))
  assert.equal(r.code, 3)
  assert.match(r.out, /checksum mismatch/)
  assert.equal(readFileSync(s.dest, 'utf8'), good.toString())
})

/** Puts a fake usagemeter at `dest` that reports `version` (and exits `code` on sync). */
function fakeMeter(s, version, code = 0) {
  mkdirSync(join(s.home, '.local/bin'), { recursive: true })
  writeFileSync(s.dest, `#!/bin/sh\n[ "$1" = --version ] && { echo "usagemeter ${version}"; exit 0; }\necho "$@" >> "${s.dir}/meter.log"\nexit ${code}\n`)
  chmodSync(s.dest, 0o755)
  return readFileSync(s.dest, 'utf8')
}

test('install never downgrades: an installed usagemeter newer than the release stays', () => {
  const release = Buffer.from('#!/bin/sh\necho usagemeter 0.9.0\n')
  for (const [installed, expected] of [['0.10.0', 'newer'], ['1.0.0', 'newer'], ['0.9.1', 'newer'], ['0.9.0', 'installed'], ['0.8.12', 'installed'], ['garbage', 'installed']]) {
    const s = sandbox(release)
    const before = fakeMeter(s, installed)
    assert.deepEqual(s.run(sha(release), '0.9.0'), { code: 0, out: expected }, `installed ${installed}, release 0.9.0`)
    if (expected === 'newer') {
      assert.equal(readFileSync(s.dest, 'utf8'), before, 'the newer binary is left in place')
      assert.ok(!existsSync(join(s.dir, 'curl.log')), 'and nothing is downloaded')
    } else {
      assert.equal(readFileSync(s.dest, 'utf8'), release.toString())
    }
  }
})

test('install never downgrades a usagemeter updated during the download', () => {
  const release = Buffer.from('#!/bin/sh\necho usagemeter 0.9.0\n')
  const s = sandbox(release)
  fakeMeter(s, '0.8.0')
  // Another installer (Herdr) puts 0.10.0 in place while this one downloads 0.9.0.
  const newer = `#!/bin/sh\necho usagemeter 0.10.0\n`
  writeFileSync(join(s.dir, 'newer'), newer)
  writeFileSync(join(s.bin, 'curl'), `#!/bin/sh\ncp "${join(s.dir, 'newer')}" "${s.dest}"\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && cp "${s.dir}/payload" "$2"; shift; done\n`)
  assert.deepEqual(s.run(sha(release), '0.9.0'), { code: 0, out: 'newer' })
  assert.equal(readFileSync(s.dest, 'utf8'), newer)
  assert.deepEqual(readdirSync(join(s.home, '.local/bin')), ['usagemeter'], 'the download is cleaned up')
})

test('install on a machine without curl says so', () => {
  const s = sandbox('x')
  const env = { HOME: s.home, PATH: '/nonexistent' }
  let code = 0, err = ''
  try { execFileSync('/bin/sh', ['-c', INSTALL, 'sh', 'https://example.invalid/a', sha('y'), '0.2.0'], { env, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { code = e.status; err = String(e.stderr) }
  // sha256sum/shasum may be missing too on this PATH; either way nothing is installed.
  assert.notEqual(code, 0, err)
  assert.ok(!existsSync(s.dest))
})

/** Runs SYNC in the sandbox, on AC power (a fake pmset), with an old automagik-meter beside it. */
function sync(s) {
  writeFileSync(join(s.bin, 'pmset'), "#!/bin/sh\necho \"Now drawing from 'AC Power'\"\n")
  chmodSync(join(s.bin, 'pmset'), 0o755)
  mkdirSync(join(s.home, '.local/bin'), { recursive: true })
  writeFileSync(s.old, '#!/bin/sh\n'); chmodSync(s.old, 0o755)
  try { return { code: 0, out: execFileSync('/bin/sh', ['-c', SYNC], { env: s.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() } } catch (e) { return { code: e.status, out: String(e.stderr).trim() } }
}

test('sync refuses to run a missing binary, and keeps the old automagik-meter', () => {
  const s = sandbox('x')
  assert.equal(sync(s).code, 5)
  assert.ok(existsSync(s.old))
})

test('the old automagik-meter is removed only after a usagemeter sync succeeds', () => {
  const ok = sandbox('x')
  fakeMeter(ok, '0.1.0', 0)
  assert.equal(sync(ok).code, 0)
  assert.equal(readFileSync(join(ok.dir, 'meter.log'), 'utf8').trim(), 'sync')
  assert.ok(!existsSync(ok.old), 'migrated')

  const failed = sandbox('x')
  fakeMeter(failed, '0.1.0', 7)
  assert.equal(sync(failed).code, 7)
  assert.ok(existsSync(failed.old), 'a failed sync keeps it')
})

test('release sums parse only meter assets with full hashes', () => {
  const h = 'a'.repeat(64)
  const sums = parseSums(`${h}  usagemeter-linux-x86_64\n${h} *usagemeter-darwin-arm64\nbad  usagemeter-x\n${h}  ../../etc/passwd\n${h}  install.sh\n`)
  assert.deepEqual(Object.keys(sums).sort(), ['usagemeter-darwin-arm64', 'usagemeter-linux-x86_64'])
  for (const a of Object.values(ASSETS)) assert.match(a, /^usagemeter-(darwin|linux)-(arm64|x86_64|aarch64)$/)
})

test('the latest version is read from the releases/latest redirect', () => {
  assert.equal(parseLatest('https://github.com/automagik-dev/usagemeter/releases/tag/v0.12.3'), '0.12.3')
  assert.equal(parseLatest('https://github.com/automagik-dev/usagemeter/releases/tag/v0.1.0-rc1'), null)
  assert.equal(parseLatest('https://github.com/automagik-dev/usagemeter/releases'), null)
  assert.equal(parseLatest('https://github.com/someone-else/usagemeter/releases/tag/v9.9.9'), null)
  assert.equal(parseLatest(null), null)
  assert.equal(assetUrl('0.1.0', 'SHA256SUMS'), 'https://github.com/automagik-dev/usagemeter/releases/download/v0.1.0/SHA256SUMS')
})

/** A fake hc: answers `exec` from a script of (argv → result), logs every call. */
function fakeHc(dir, answers) {
  const p = join(dir, 'hc')
  writeFileSync(join(dir, 'answers.json'), JSON.stringify(answers))
  writeFileSync(p, `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(join(dir, 'hc.log'))}, JSON.stringify(a) + '\\n')
if (a[0] === 'machine') { console.log(JSON.stringify({ machines: [{ name: 'box', state: 'connected' }, { name: 'off', state: 'disconnected' }] })); process.exit(0) }
const argv = a.slice(a.indexOf('--') + 1); const on = a.includes('--on') ? a[a.indexOf('--on') + 1] : 'here'
const answers = JSON.parse(fs.readFileSync(${JSON.stringify(join(dir, 'answers.json'))}, 'utf8'))
const key = on + ' ' + (argv[0] === 'sh' ? (argv[2].includes('curl') ? 'install' : 'sync') : argv.join(' '))
const r = answers[key] ?? { code: 0, stdout: '' }
const b = (s) => Buffer.from(s ?? '').toString('base64')
console.log(JSON.stringify({ code: r.code, stdout: b(r.stdout), stderr: b(r.stderr), timed_out: !!r.timed_out }))
process.exit(r.code === 0 ? 0 : 1)
`)
  chmodSync(p, 0o755)
  return p
}

test('hc exec output is decoded, a timeout is an error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meter-hc-'))
  const hc = fakeHc(dir, { 'box uname -sm': { code: 0, stdout: 'Linux x86_64\n' }, 'box sync': { code: 0, timed_out: true } })
  assert.deepEqual(await hcExec(hc, 'box', ['uname', '-sm'], 5), { code: 0, stdout: 'Linux x86_64\n', stderr: '' })
  assert.equal((await hcExec(hc, 'box', ['sh', '-c', SYNC], 5)).code, -1)
  assert.equal((await hcExec('/nonexistent/hc', null, ['true'], 5)).code, -1, 'a missing hc never throws')
})

test('a machine is installed from the release, then synced; waits while there is no release', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meter-one-'))
  const hc = fakeHc(dir, {
    'box uname -sm': { code: 0, stdout: 'Linux aarch64\n' },
    'box install': { code: 0, stdout: 'installed\n' },
    'here uname -sm': { code: 0, stdout: 'Darwin arm64\n' },
    'here sync': { code: 5, stderr: 'usagemeter is not installed' },
  })
  const release = { version: '0.4.0', sums: { 'usagemeter-linux-aarch64': 'b'.repeat(64) } }
  assert.deepEqual(await meterOne(hc, 'box', release), { ok: true, installed: 'installed', skipped: null })
  const install = readFileSync(join(dir, 'hc.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((a) => a.includes('-c') && a.some((x) => String(x).includes('curl')))
  assert.deepEqual(install.slice(-3), ['https://github.com/automagik-dev/usagemeter/releases/download/v0.4.0/usagemeter-linux-aarch64', 'b'.repeat(64), '0.4.0'])
  // No darwin asset in this release: nothing to install, and not installed is not an error.
  assert.equal((await meterOne(hc, null, release)).ok, true)
  // No release known at all (GitHub unreachable): the same.
  assert.equal((await meterOne(hc, null, null)).ok, true)
  // A platform with no build is an error worth showing.
  assert.match((await meterOne(hc, 'elsewhere', release)).error, /no meter build/)
})

test('the loop runs one pass at a time and counts failures in a row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meter-loop-'))
  const hc = fakeHc(dir, { 'box uname -sm': { code: 1, stderr: 'machine unreachable' }, 'here uname -sm': { code: 0, stdout: 'Linux x86_64\n' } })
  let state = {}
  const m = startMeter({ hc, read: () => structuredClone(state), write: (s) => { state = structuredClone(s) }, log: () => {}, latest: async () => { throw new Error('offline') } })
  try {
    const [a, b] = await Promise.all([m.pass(), m.pass()])
    assert.ok(b.skipped, 'a pass while one runs is skipped')
    assert.equal(a.machines.box.failures, 1)
    assert.ok(!('off' in a.machines), 'disconnected machines are left alone')
    for (let i = 1; i < SHOW_AFTER; i++) await m.pass()
    assert.deepEqual(failing(state).map((f) => f.machine), ['box'])
    assert.match(failing(state)[0].error, /unreachable/)
    assert.equal(state.machines['this computer'].failures, 0)
  } finally { m.stop() }
})
