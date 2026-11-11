// Real subprocesses with invented credential writes in a temporary home, never vendor CLIs.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { CliLogins } from '../src/host/login.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const alive = pid => {
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}
async function until(check) {
  const deadline = Date.now() + 8000
  while (!check()) {
    if (Date.now() > deadline) assert.fail('fake login did not reach the expected state')
    await pause(10)
  }
}

test('an exited wrapper retains its credential-writing child until the whole group is stopped',
  { skip: process.platform === 'win32' && 'Unix process group; Windows Job covered separately' },
  async t => {
    const home = mkdtempSync(join(tmpdir(), 'login-tree-'))
    const credentials = join(home, 'invented-credentials')
    const parentFile = join(home, 'parent')
    const childFile = join(home, 'child')
    const wrapper = join(home, 'wrapper')
    const descendant = [
      "const fs = require('node:fs');",
      "process.on('SIGTERM', () => {});",
      "fs.writeFileSync(process.env.FAKE_CHILD, String(process.pid));",
      "process.send('ready');",
      "setTimeout(() => {fs.writeFileSync(process.env.FAKE_AUTH, 'old-login');",
      'process.exit(0)}, 3500);',
    ].join('')
    writeFileSync(wrapper, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "fs.writeFileSync(process.env.FAKE_PARENT, String(process.pid));",
      `const child = require('node:child_process').spawn(process.execPath,`,
      `['-e', ${JSON.stringify(descendant)}],`,
      "{stdio: ['ignore','ignore','ignore','ipc']});",
      "child.once('message', () => {child.disconnect(); process.exit(0)});",
    ].join('\n'), { mode: 0o755 })
    const logins = new CliLogins({
      resolve: async () => ({ cli: wrapper, env: { ...process.env, HOME: home,
        AUTOMAGIK_BOT_CLI_HOME: home, FAKE_PARENT: parentFile, FAKE_CHILD: childFile,
        FAKE_AUTH: credentials } }), signedIn: async () => false,
    })
    t.after(async () => {
      logins.dispose()
      try { await logins.stop('acp-claude') } finally {
        // Also bound the fixture when run against the old, deliberately broken ownership.
        if (existsSync(childFile)) {
          const pid = Number(readFileSync(childFile, 'utf8'))
          if (alive(pid)) try { process.kill(pid, 'SIGKILL') } catch {}
        }
        rmSync(home, { recursive: true, force: true })
      }
    })
    logins.start('acp-claude')
    await until(() => existsSync(parentFile) && existsSync(childFile)
      && !alive(Number(readFileSync(parentFile, 'utf8'))))
    const childPid = Number(readFileSync(childFile, 'utf8'))
    await logins.stop('acp-claude')
    assert.equal(alive(childPid), false, 'auth changes wait for the descendant, not its wrapper')
    writeFileSync(credentials, 'new-login')
    await pause(3600)
    assert.equal(readFileSync(credentials, 'utf8'), 'new-login')
  })

test('a new login waits for the previous owned process before resolving or spawning its CLI',
  async t => {
    const children = []
    let resolved = 0
    const logins = new CliLogins({
      resolve: async () => { resolved++; return { cli: '/fake/claude', env: {} } },
      signedIn: async () => false,
      spawn: () => {
        const child = new EventEmitter()
        child.stdin = new PassThrough()
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        child.exitCode = child.signalCode = null
        child.kill = () => true
        children.push(child)
        return child
      },
    })
    t.after(async () => {
      logins.dispose()
      for (const child of children) { child.exitCode = 0; child.emit('close', 0) }
      await logins.stop('acp-claude')
    })
    const first = logins.start('acp-claude')
    await tick()
    logins.cancel('acp-claude', first.attemptId)
    logins.start('acp-claude')
    await tick()
    assert.equal(resolved, 1)
    assert.equal(children.length, 1)
    children[0].exitCode = 0
    children[0].emit('close', 0)
    await tick()
    assert.equal(resolved, 2)
    assert.equal(children.length, 2)
  })
