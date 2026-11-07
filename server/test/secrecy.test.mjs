import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DATA_DIRS, binaryHits, nameHits, scanTree, walk } from '../secrecy.mjs'

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

const write = (dir, path, content, mode) => {
  mkdirSync(join(dir, dirname(path)), { recursive: true })
  writeFileSync(join(dir, path), content, mode ? { mode } : undefined)
}
// Built, not written as a literal: the repository's privacy grep scans this file too.
const home = (name) => ['', 'home', name, 'project'].join('/')

test('names alone: dotenv, launch-url, data state and credentials', () => {
  assert.deepEqual(nameHits('opt/automagik/.env', 'file').map((hit) => hit.rule), ['dotenv'])
  assert.deepEqual(nameHits('opt/automagik/.env.example', 'file'), [])
  assert.deepEqual(nameHits('data/dsh/launch-url', 'file').map((hit) => hit.rule), ['launch-url', 'data-state'])
  assert.deepEqual(nameHits('data', 'dir'), [])
  assert.deepEqual(nameHits('data/dsh', 'dir'), [])
  assert.deepEqual(nameHits('data/dsh/profiles/automagik-web', 'dir').map((hit) => hit.rule), ['data-state'])
  assert.deepEqual(nameHits('opt/automagik/.git-credentials', 'file').map((hit) => hit.rule), ['git-credentials'])
  assert.deepEqual(nameHits('opt/automagik/netrc', 'file').map((hit) => hit.rule), ['git-credentials'])
})

test('a clean rootfs: the profile code and the empty /data tree pass', () => {
  const dir = rootfs()
  cpSync(join(HERE, '..', 'lib.mjs'), join(dir, 'opt/automagik/lib.mjs'))
  cpSync(join(HERE, '..', 'entrypoint.mjs'), join(dir, 'opt/automagik/entrypoint.mjs'))
  cpSync(join(HERE, '..', 'healthcheck.mjs'), join(dir, 'opt/automagik/healthcheck.mjs'))
  write(dir, 'opt/automagik/versions.json', '{"automagik":"3.92.0","dsh":"0.2.2-rc.1"}\n')
  write(dir, 'usr/local/bin/dsh', '#!/bin/sh\nexec node /opt/automagik/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js "$@"\n')
  const { hits } = scanTree(dir)
  assert.deepEqual(hits, [])
})

test('the image rules catch keys, tokens, .env, launch-url, data, /mnt/ai, home and git credentials', () => {
  const dir = rootfs()
  // The key and the token are made here, not written as literals.
  write(dir, 'opt/leak/key.txt', `DEEPSEEK_API_KEY=sk-${'a'.repeat(32)}\n`)
  write(dir, 'opt/leak/token.txt', `http://127.0.0.1:3081/?token=${'b'.repeat(32)}\n`)
  write(dir, 'opt/leak/mnt.txt', 'workspace at /mnt/ai/bots\n')
  write(dir, 'opt/leak/home.txt', `workspace at ${home('alice')}\n`)
  write(dir, 'opt/leak/creds.txt', 'https://user:password@example.com/automagik-dev/automagik.git\n')
  write(dir, 'opt/leak/binary.bin', Buffer.concat([Buffer.from([0]), Buffer.from(`${home('bob')}\0/sk-${'c'.repeat(32)}\0`)]))
  write(dir, 'opt/leak/.env', 'DEEPSEEK_API_KEY=not-a-key\n')
  write(dir, 'data/bots/team.json', '{}\n')
  write(dir, 'data/dsh/launch-url', 'http://127.0.0.1:3081/?token=deadbeef\n')
  const rules = new Set(scanTree(dir).hits.map((hit) => hit.rule))
  for (const rule of ['key', 'token', 'private-path', 'home-path', 'git-credentials', 'dotenv', 'data-state', 'launch-url']) {
    assert.ok(rules.has(rule), `missing ${rule}`)
  }
})

test('the Node build account in a binary is not a person', () => {
  const carol = ['', 'home', 'carol'].join('/')
  const text = `${['', 'home', 'iojs'].join('/')}/build/ws/out\0${carol}/src\0`
  const hits = binaryHits('nodejs/bin/node', text)
  assert.deepEqual(hits.map((hit) => hit.match), [carol])
})

test('the redaction regex in the image code is not mistaken for a token', () => {
  const dir = rootfs()
  cpSync(join(HERE, '..', 'lib.mjs'), join(dir, 'opt/automagik/lib.mjs'))
  assert.deepEqual(scanTree(dir).hits, [])
})

test('the CLI scans a rootfs, writes the inventory, and fails on a hit', () => {
  const clean = rootfs()
  const cleanInventory = join(clean, 'inventory')
  const cleanRun = execFileSync(process.execPath, [join(HERE, '..', 'secrecy.mjs'), '--rootfs', clean, '--inventory', cleanInventory], { encoding: 'utf8' })
  assert.match(cleanRun, /\[secrecy\] clean/)
  assert.equal(readFileSync(join(cleanInventory, 'secrecy.txt'), 'utf8'), 'clean\n')
  assert.ok(walk(clean).some((entry) => entry.file === 'data/dsh'))

  const bad = rootfs()
  write(bad, 'opt/leak/key.txt', `sk-${'d'.repeat(32)}\n`)
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
