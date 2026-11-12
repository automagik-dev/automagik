// Windows' batch files (pnpm.cmd, npm.cmd, codex.cmd) through cmd.exe, argv quoted. Imports only
// Node's own modules, so ci.yml runs it on windows-latest without a harness.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { signedInOf } from '../src/host/agents.js'
import { batchSafe, quoteForCmd } from '../src/host/batch-spawn.js'
import { runInstall } from '../src/host/install.js'
// This gate runs on Windows without the harness; include the owned login Job regression.
import './windows-login.check.js'

const windowsOnly = { skip: process.platform === 'win32' ? false : 'needs cmd.exe' }

test('only a Windows batch file goes through cmd.exe, with every argument quoted', () => {
  assert.deepEqual(batchSafe('/usr/bin/pnpm', ['install'], { cwd: '/a' }, 'linux'), ['/usr/bin/pnpm', ['install'], { cwd: '/a' }])
  assert.deepEqual(batchSafe('C:\\Program Files\\nodejs\\node.exe', ['x.js'], {}, 'win32'), ['C:\\Program Files\\nodejs\\node.exe', ['x.js'], {}])
  assert.deepEqual(batchSafe('C:\\Users\\Ana Lu\\.automagik\\desktop\\bin\\pnpm.cmd', ['install', '--prod'], { cwd: 'C:\\x' }, 'win32'),
    ['"C:\\Users\\Ana Lu\\.automagik\\desktop\\bin\\pnpm.cmd"', ['"install"', '"--prod"'], { cwd: 'C:\\x', shell: true }])
  assert.deepEqual(batchSafe('C:\\nvm\\codex.CMD', ['login', 'status'], {}, 'win32'), ['C:\\nvm\\codex.CMD', ['"login"', '"status"'], { shell: true }])
  for (const bad of ['say "hi"', '%PATH%', 'Bang!', 'a\nb']) assert.throws(() => quoteForCmd(bad), /refusing to pass/)
  assert.equal(quoteForCmd('C:\\dir\\'), '"C:\\dir\\\\"')
})

// A package manager and a CLI as npm lays them out on Windows: a .cmd that runs a Node script
// beside it (%~dp0), in a folder with a space, as a person's user folder can have.
function batchTool(t, name, script) {
  const root = mkdtempSync(join(tmpdir(), 'acp dsh batch-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, `${name}.js`), script)
  writeFileSync(join(bin, `${name}.cmd`), `@echo off\r\n"${process.execPath}" "%~dp0${name}.js" %*\r\n`)
  return { root, cmd: join(bin, `${name}.cmd`) }
}

test('on Windows an install runs the app\'s pnpm.cmd and gets its arguments exactly', windowsOnly, async (t) => {
  const { root, cmd } = batchTool(t, 'pnpm', "require('node:fs').writeFileSync('args.json', JSON.stringify(process.argv.slice(2)))")
  const args = ['install', '--prod', '--config.node-linker=hoisted', '--reporter=silent']
  await runInstall(cmd, args, { cwd: root, env: process.env })
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'args.json'), 'utf8')), args)
  // A failing install still says so, with its exit code through cmd.exe.
  const failing = batchTool(t, 'npm', 'process.exit(3)')
  await assert.rejects(runInstall(failing.cmd, ['install'], { cwd: failing.root, env: process.env }), /install failed \(exit 3\)/)
})

test('on Windows the sign-in check runs a CLI npm installed as a .cmd', windowsOnly, async (t) => {
  const { cmd } = batchTool(t, 'codex', "process.exit(process.argv.slice(2).join(' ') === 'login status' ? 0 : 5)")
  const spec = { signIn: { args: ['login', 'status'], read: ({ code }) => (code === 0 ? true : code === 1 ? false : undefined) } }
  assert.equal(await signedInOf(spec, cmd, { env: process.env, run: execFile }), true)
})
