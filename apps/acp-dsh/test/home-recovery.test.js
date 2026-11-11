// Real app crashes, scratch homes and invented credentials only; never a live vendor login.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CliHomes, trackRun } from '../src/host/cli-homes.js'
import { recordLogin } from '../src/host/login-ownership.js'

const module = new URL('../src/host/cli-homes.js', import.meta.url).href
const run = program => spawnSync(process.execPath, ['--input-type=module', '-e', program], {
  encoding: 'utf8', timeout: 10_000,
})

test('a crash during recovery cannot leave a permanently held recovery claim', t => {
  const root = mkdtempSync(join(tmpdir(), 'bot-home-recovery-'))
  const homes = new CliHomes(root)
  t.after(() => { homes.dispose(); rmSync(root, { recursive: true, force: true }) })
  const old = run(`import {CliHomes} from ${JSON.stringify(module)};
    const homes=new CliHomes(${JSON.stringify(root)});
    homes.environment('claude');homes.begin('claude');process.exit(0);`)
  assert.equal(old.status, 0, old.stderr)
  const lock = join(root, 'claude', 'changing')
  const oldOwner = readFileSync(join(lock, 'owner'), 'utf8')
  // An earlier release used an exclusive file here. Its claimant died after writing it.
  const claimant = run(`import {writeFileSync} from 'node:fs';
    import {randomUUID} from 'node:crypto';
    writeFileSync(${JSON.stringify(join(lock, 'recovering'))},process.pid+'-'+randomUUID());
    process.kill(process.pid,'SIGKILL');`)
  assert.notEqual(claimant.status, 0)
  const hit = join(root, 'crashed-in-recovery')
  const recovery = run(`import fs from 'node:fs';
    import {dirname} from 'node:path';
    import {syncBuiltinESMExports} from 'node:module';
    import {CliHomes} from ${JSON.stringify(module)};
    const mkdir=fs.mkdirSync;
    fs.mkdirSync=(path,...args)=>{const result=mkdir(path,...args);
      if(dirname(String(path))===${JSON.stringify(join(root, 'mutations', 'claude'))}){
        fs.writeFileSync(${JSON.stringify(hit)},'claim-created');
        process.kill(process.pid,'SIGKILL');
      }return result;};syncBuiltinESMExports();
    new CliHomes(${JSON.stringify(root)}).begin('claude');`)
  assert.notEqual(recovery.status, 0)
  assert.equal(readFileSync(hit, 'utf8'), 'claim-created')
  assert.equal(readFileSync(join(lock, 'owner'), 'utf8'), oldOwner)
  homes.begin('claude')
  assert.equal(readFileSync(join(lock, 'owner'), 'utf8'), homes.instance)
  assert.equal(existsSync(join(lock, 'recovering')), false)
  assert.deepEqual(readdirSync(join(root, 'mutations', 'claude')), [])
  homes.end('claude')
})

test('a late real writer stays in the abandoned generation after owner reset', async t => {
  const root = mkdtempSync(join(tmpdir(), 'bot-home-generation-'))
  const homes = new CliHomes(root)
  const old = homes.environment('codex')
  // An interrupted launch has no tree identity, so normal recovery deliberately cannot clear it.
  recordLogin(old)
  const ready = join(root, 'ready')
  const child = spawn(process.execPath, ['-e', [
    "const fs=require('node:fs'),path=require('node:path');",
    'fs.writeFileSync(process.argv[1],\'ready\');',
    "setTimeout(()=>fs.writeFileSync(path.join(process.env.CODEX_HOME,'auth.json'),",
    "'old-invented-credentials'),200);",
  ].join(''), ready], { env: old, stdio: 'ignore' })
  const exited = new Promise(resolve => child.once('exit', resolve))
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    homes.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  const deadline = Date.now() + 5000
  while (!existsSync(ready) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(existsSync(ready), true)
  homes.reset('codex')
  const fresh = homes.environment('codex')
  writeFileSync(join(fresh.CODEX_HOME, 'auth.json'), 'new-invented-credentials')
  await exited
  assert.equal(readFileSync(join(old.CODEX_HOME, 'auth.json'), 'utf8'),
    'old-invented-credentials')
  assert.equal(readFileSync(join(fresh.CODEX_HOME, 'auth.json'), 'utf8'),
    'new-invented-credentials')
  assert.throws(() => trackRun({ spec: { env: old } }), /account changed/)
  homes.collect('codex')
  assert.equal(existsSync(old.HOME), true, 'unproved pending ownership was never deleted')
})
