#!/usr/bin/env node
// Boots the plugins for real: a DSH web profile with this checkout's Bot team and welcome and
// Omni's channels and canvases (from the Omni release apps/desktop/omni.json pins, or
// OMNI_SOURCE), installed the way DSH installs any plugin (`dsh plugin install`, pnpm), on the
// DSH the Bot team is tested on. Headless Chromium then opens it and checks that the web UI
// comes up with every plugin active: DSH refuses to boot the whole UI when one plugin's
// client import misses, so this is where a renamed package that another plugin imports would
// show.
//
//   node scripts/boot-check.mjs [--keep <dir>] [--shot <png>] [--port <n>]
//
// Needs the Bot team's harness (`bun run harness` in apps/bots-dsh), git, and a Chromium:
// CHROME_BIN, else google-chrome or chromium on PATH, else Playwright's headless shell.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'package.json'))
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []))
const say = line => console.log(`[boot-check] ${line}`)
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const env = { ...process.env, DO_NOT_TRACK: '1', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_update_notifier: 'false' }

const work = args.keep ? resolve(args.keep) : mkdtempSync(join(tmpdir(), 'automagik-boot-'))
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
const DSH_BIN = join(ROOT, 'apps', 'bots-dsh', 'dev', 'harness', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(DSH_BIN)) throw new Error('no DSH: run `bun run harness` in apps/bots-dsh first')

// Omni at the pinned release: only its plugin folders.
const OMNI = readJson(join(ROOT, 'apps', 'desktop', 'omni.json'))
let omniDir = process.env.OMNI_SOURCE ? resolve(process.env.OMNI_SOURCE) : join(work, 'omni')
if (!process.env.OMNI_SOURCE) {
  say(`fetching Omni ${OMNI.version} (${OMNI.commit.slice(0, 9)})`)
  mkdirSync(omniDir, { recursive: true })
  const git = argv => execFileSync('git', argv, { cwd: omniDir, env, stdio: ['ignore', 'pipe', 'inherit'] })
  git(['init', '-q'])
  git(['remote', 'add', 'origin', OMNI.repository])
  git(['sparse-checkout', 'set', '--no-cone', '/apps/omni-channels-dsh/', '/apps/omni-canvas-dsh/'])
  git(['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', OMNI.commit])
  git(['checkout', '-q', 'FETCH_HEAD'])
}
omniDir = resolve(omniDir)

const folders = [join(ROOT, 'apps', 'bots-dsh'), join(omniDir, 'apps', 'omni-channels-dsh'), join(omniDir, 'apps', 'omni-canvas-dsh'), join(ROOT, 'apps', 'welcome-dsh')]
const dshHome = join(work, 'dsh')
const profileDir = join(dshHome, 'profiles', 'boot')
mkdirSync(join(profileDir, 'vendor'), { recursive: true })
const packed = folders.map((dir) => {
  const [info] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', join(profileDir, 'vendor')], { cwd: dir, env, encoding: 'utf8' }))
  return { name: info.name, version: info.version, file: info.filename }
})
say(`packed ${packed.map(pkg => `${pkg.name}@${pkg.version}`).join(', ')}`)
writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
  name: 'automagik-boot-check',
  private: true,
  dependencies: Object.fromEntries(packed.map(pkg => [pkg.name, `file:vendor/${pkg.file}`])),
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...packed.map(pkg => pkg.name)] } },
}, null, 2)}\n`)
cpSync(join(ROOT, 'apps', 'desktop', 'profile', 'pnpm-workspace.yaml'), join(profileDir, 'pnpm-workspace.yaml'))
// DSH's plugin manager runs pnpm: the release the desktop app ships.
const shims = join(work, 'bin')
mkdirSync(shims, { recursive: true })
writeFileSync(join(shims, 'pnpm'), '#!/bin/sh\nexec npx --yes pnpm@10.34.6 "$@"\n', { mode: 0o755 })
const dshEnv = { ...env, DSH_HOME: dshHome, OMNI_HOME: join(work, 'omni-home'), PATH: `${shims}:${env.PATH}` }
execFileSync(process.execPath, [DSH_BIN, 'plugin', '--profile', 'boot', 'install', '--prod', '--ignore-scripts'], { cwd: profileDir, env: dshEnv, stdio: ['ignore', 'inherit', 'inherit'] })

function chrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim()
    } catch {}
  }
  const cache = join(homedir(), '.cache', 'ms-playwright')
  const shell = existsSync(cache) ? readdirSync(cache).filter(name => name.startsWith('chromium_headless_shell-')).sort().at(-1) : undefined
  if (shell) return join(cache, shell, 'chrome-headless-shell-linux64', 'chrome-headless-shell')
  throw new Error('no Chromium: set CHROME_BIN')
}

const port = String(args.port ?? 39400 + Math.floor(Math.random() * 500))
const dsh = spawn(process.execPath, [DSH_BIN, '--profile', 'boot', '--no-open', '--host', '127.0.0.1', '--port', port], { cwd: work, env: dshEnv, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
let failed = true
try {
  const url = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`dsh did not start:\n${log.slice(-3000)}`)), 180_000)
    const onData = (chunk) => {
      log += chunk
      const match = log.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\S*token=\S+)/)
      if (match) {
        clearTimeout(timer)
        done(match[1])
      }
    }
    dsh.stdout.on('data', onData)
    dsh.stderr.on('data', onData)
    dsh.once('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`dsh exited ${code}:\n${log.slice(-3000)}`))
    })
  })
  say(`dsh up on ${port}`)
  const { chromium } = require('playwright-core')
  const browser = await chromium.launch({ executablePath: chrome() })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    const problems = []
    page.on('pageerror', error => problems.push(`page error: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error' && /client-modules|did not activate|not loaded because/.test(message.text())) problems.push(`console: ${message.text()}`)
    })
    await page.goto(url)
    // The welcome's stage (first run) or the Bot team's sidebar.
    await page.locator('.bt-tile, .bt-row, .oa-stage').first().waitFor({ timeout: 90_000 }).catch(() => problems.push('neither the welcome nor the Bot team showed'))
    await page.waitForTimeout(3000)
    const entries = await page.evaluate(() => (window.__DSH_BOOT__?.entries ?? []).map(row => row.id ?? row.name))
    const body = await page.evaluate(() => document.body.innerText)
    if (/did not activate|Failed to load plugins/i.test(body)) problems.push(`the web UI did not boot: ${body.slice(0, 600)}`)
    for (const pkg of packed) if (!entries.includes(pkg.name)) problems.push(`${pkg.name} is not in the client graph`)
    if (args.shot) await page.screenshot({ path: resolve(args.shot) })
    say(`client graph: ${entries.filter(id => id.startsWith('@automagik/')).join(', ')}`)
    for (const problem of problems) say(`FAIL ${problem}`)
    failed = problems.length > 0
    if (!failed) say('PASS: the web UI booted with every plugin')
  } finally {
    await browser.close()
  }
} finally {
  dsh.kill('SIGTERM')
  await new Promise((done) => {
    const timer = setTimeout(() => {
      try { dsh.kill('SIGKILL') } catch {}
      done()
    }, 8000)
    dsh.once('exit', () => {
      clearTimeout(timer)
      done()
    })
  })
  if (!args.keep) rmSync(work, { recursive: true, force: true, maxRetries: 3 })
}
process.exit(failed ? 1 : 0)
