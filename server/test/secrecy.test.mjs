import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyAllowlist, DATA_DIRS, loadAllowlist, nameHits, scanTree } from '../secrecy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const temps = []
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'automagik-secrecy-test-'))
  temps.push(dir)
  return dir
}

/** An image's empty /data tree, as the Dockerfile's tools stage creates it. */
function rootfs(dir = temp()) {
  for (const path of DATA_DIRS) mkdirSync(join(dir, path), { recursive: true })
  return dir
}

const write = (dir, path, content) => {
  mkdirSync(join(dir, dirname(path)), { recursive: true })
  writeFileSync(join(dir, path), content)
}
// Built, not written as a literal where the repository's privacy grep would see a person or a secret.
const home = (name) => ['', 'home', name, 'project'].join('/')
const shortName = ['g', '9'].join('')
const key = `sk-${'a'.repeat(32)}`
const providerKey = `ghp_${'b'.repeat(30)}`
const token = 'c'.repeat(32)

test('names alone: dotenv, launch-url, data state, credentials and archives', () => {
  assert.deepEqual(nameHits('opt/automagik/.env', 'file').map((hit) => hit.rule), ['dotenv'])
  assert.deepEqual(nameHits('opt/automagik/.env.example', 'file'), [])
  assert.deepEqual(nameHits('data/dsh/launch-url', 'file').map((hit) => hit.rule), ['launch-url', 'data-state'])
  assert.deepEqual(nameHits('data', 'dir'), [])
  assert.deepEqual(nameHits('data/dsh', 'dir'), [])
  assert.deepEqual(nameHits('data/dsh/profiles/automagik-web', 'dir').map((hit) => hit.rule), ['data-state'])
  assert.deepEqual(nameHits('opt/automagik/.git-credentials', 'file').map((hit) => hit.rule), ['git-credentials'])
  assert.deepEqual(nameHits('opt/automagik/netrc', 'file').map((hit) => hit.rule), ['git-credentials'])
  assert.deepEqual(nameHits('opt/automagik/bundle.tgz', 'file').map((hit) => hit.rule), ['archive'])
})

test('a clean rootfs: the profile code and the empty /data tree pass', () => {
  const dir = rootfs()
  cpSync(join(HERE, '..', 'lib.mjs'), join(dir, 'opt/automagik/lib.mjs'))
  cpSync(join(HERE, '..', 'entrypoint.mjs'), join(dir, 'opt/automagik/entrypoint.mjs'))
  cpSync(join(HERE, '..', 'healthcheck.mjs'), join(dir, 'opt/automagik/healthcheck.mjs'))
  write(dir, 'opt/automagik/versions.json', '{"automagik":"3.93.0","dsh":"0.2.2-rc.1"}\n')
  write(dir, 'etc/passwd', 'root:x:0:0:root:/root:/sbin/nologin\nautomagik:x:1000:1000::/data:/sbin/nologin\n')
  const { hits: findings } = scanTree(dir, undefined, [])
  assert.deepEqual(findings, [])
})

test('the 17 negative probes all stay failures', () => {
  const cases = [
    ['key', `DEEPSEEK_API_KEY=${key}\n`, 'key'],
    ['provider key', `GITHUB_TOKEN=${providerKey}\n`, 'key'],
    ['token=', `url?token=${token}\n`, 'token'],
    ['token-url', `http://127.0.0.1:3081/?token=${token}\n`, 'token-url'],
    ['token-json', `{"token": "${'a1'.repeat(16)}"}\n`, 'token-json'],
    ['private-key', `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----\n`, 'private-key'],
    ['private-path', 'workspace at /mnt/ai/bots\n', 'private-path'],
    ['home-path text', `workspace at ${home('alice')}\n`, 'home-path'],
    ['home-path binary', Buffer.concat([Buffer.from([0]), Buffer.from(`${home('bob')}\0`)]), 'home-path'],
    ['private-name', `${shortName}\n`, 'private-name'],
    ['git-credentials', 'https://user:password@example.com/x.git\n', 'git-credentials'],
    ['git-credentials file', 'nothing\n', 'git-credentials', 'opt/leak/.git-credentials'],
    ['.env', 'DEEPSEEK_API_KEY=not-a-key\n', 'dotenv', 'opt/leak/.env'],
    ['launch-url', 'nothing\n', 'launch-url', 'data/dsh/launch-url'],
    ['data state', '{}\n', 'data-state', 'data/bots/team.json'],
    ['archive', 'nothing\n', 'archive', 'opt/leak/bundle.tgz'],
    ['archive inside a package', 'nothing\n', 'archive', 'opt/leak/node_modules/x/cache.zip'],
  ]
  assert.equal(cases.length, 17)
  for (const [label, content, rule, path = 'opt/leak/probe.txt'] of cases) {
    const dir = rootfs()
    write(dir, path, content)
    const { hits: findings } = scanTree(dir, undefined, [])
    assert.ok(findings.some((hit) => hit.rule === rule), `${label}: expected ${rule}, got ${JSON.stringify(findings)}`)
  }
})

test('a bare PEM label constant is not a key; a real body, short last line and header are', () => {
  const dir = rootfs()
  write(dir, 'opt/leak/label.txt', '-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----\n')
  // The repository's privacy grep still reports a bare header as `secret`; the key rule does not.
  assert.deepEqual(scanTree(dir, undefined, []).hits.filter((hit) => hit.rule === 'private-key'), [])
  const bodies = [
    `${'A'.repeat(64)}\n`,
    `${'A'.repeat(64)}\nAAAA\n`,
    `Proc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123456789ABCDEF\n\nAAAAAA\n`,
    'AAAAAA\n',
  ]
  bodies.forEach((body, index) => {
    const file = `opt/leak/real-${index}.txt`
    write(dir, file, `-----BEGIN PRIVATE KEY-----\n${body}-----END PRIVATE KEY-----\n`)
    assert.ok(scanTree(dir, undefined, []).hits.some((hit) => hit.rule === 'private-key' && hit.file === file), `body ${index}`)
  })
})

test('a private-key entry is allowed only for the gnutls library', () => {
  const file = join(temp(), 'allowlist.json')
  writeFileSync(file, JSON.stringify([{
    file: 'opt/automagik/runtime/node_modules/@deepseek-ai/libreoffice-kit-wasm/assets/soffice.wasm',
    rule: 'private-key',
    sha256: 'a'.repeat(64),
    reason: 'not the gnutls library',
  }]))
  assert.throws(() => loadAllowlist(file), /private-key may not be allowlisted here/)
})

test('the node build account is excused only for the pinned binary hash', () => {
  const pin = '5bcb4ec9c0ad9764e41392c1d3a3d46c28656c79b6e49f4a644499c9d96ac39f'
  const hit = { file: 'nodejs/bin/node', rule: 'home-path', raw: '/home/iojs', match: '/home/iojs', fileSha256: pin }
  const entry = { file: 'nodejs/bin/node', rule: 'home-path', match: '/home/iojs', fileSha256: pin, reason: 'pinned' }
  assert.equal(applyAllowlist([hit], [entry]).kept.length, 0)
  assert.equal(applyAllowlist([hit], [{ ...entry, fileSha256: '0'.repeat(64) }]).kept.length, 1)
})

test('an exact allowlist entry excuses one path, and a key may never be allowlisted', () => {
  const dir = rootfs()
  write(dir, 'opt/vendor/example.txt', `workspace at ${home('example')}\n`)
  const entry = { file: 'opt/vendor/example.txt', rule: 'home-path', match: home('example').replace(/\/project$/, ''), reason: 'a documented example' }
  const { hits: findings, allowed } = scanTree(dir, undefined, [entry])
  assert.deepEqual(findings, [])
  assert.equal(allowed.length, 1)

  const file = join(temp(), 'allowlist.json')
  writeFileSync(file, JSON.stringify([{ file: 'opt/leak/key.txt', rule: 'key', match: key, reason: 'never' }]))
  assert.throws(() => loadAllowlist(file), /key may not be allowlisted/)
  const hit = { file: 'opt/leak/key.txt', rule: 'key', raw: key, match: 'sk-***' }
  assert.equal(applyAllowlist([hit], []).kept.length, 1)
  assert.equal(applyAllowlist([hit], [{ file: 'opt/leak/key.txt', rule: 'key', match: key, reason: 'never' }]).kept.length, 1)
})

test('the redaction regex in the image code is not mistaken for a token', () => {
  const dir = rootfs()
  cpSync(join(HERE, '..', 'lib.mjs'), join(dir, 'opt/automagik/lib.mjs'))
  assert.deepEqual(scanTree(dir, undefined, []).hits, [])
})

test('the CLI scans a rootfs, writes the inventory, and exits 1 on a hit', () => {
  const clean = rootfs()
  const cleanInventory = join(clean, 'inventory')
  const cleanRun = execFileSync(process.execPath, [join(HERE, '..', 'secrecy.mjs'), '--rootfs', clean, '--inventory', cleanInventory], { encoding: 'utf8' })
  assert.match(cleanRun, /\[secrecy\] clean/)
  assert.equal(readFileSync(join(cleanInventory, 'secrecy.txt'), 'utf8'), 'clean\n')
  assert.ok(readFileSync(join(cleanInventory, 'image-files.txt'), 'utf8').includes('data/dsh'))

  const bad = rootfs()
  write(bad, 'opt/leak/key.txt', `${key}\n`)
  const badRun = (() => {
    try {
      execFileSync(process.execPath, [join(HERE, '..', 'secrecy.mjs'), '--rootfs', bad, '--inventory', join(bad, 'inventory')], { encoding: 'utf8', stdio: 'pipe' })
      return { status: 0 }
    } catch (error) {
      return { status: error.status, stderr: String(error.stderr) }
    }
  })()
  assert.equal(badRun.status, 1)
  assert.match(badRun.stderr, /key: sk-\*\*\*/)
  assert.match(readFileSync(join(bad, 'inventory', 'secrecy.txt'), 'utf8'), /: key: sk-\*\*\*/)
})
