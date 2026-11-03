// RFC 0013 delivery 1 on a real OS (.github/workflows/herdr-harness.yml, CI runners only: it
// installs herdr-app and drives its window). It checks herdrdev's feed and the sha256 of this
// OS's build, installs herdr-app with herdrdev's own installer, then runs the app's own finder
// and start-or-raise (src/herdr.js) on a temp HERDR_APP_HOME: status, ls, do space.new, and a
// raise from behind another window. Each check is one JSON line in $OUT/results.jsonl; the
// table goes to $GITHUB_STEP_SUMMARY. It exits 1 when a check delivery 1 needs fails.
//
//   node test/cross-os/herdr-harness.mjs        (Linux: under xvfb-run, with a window manager)
import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { OVERRIDE, findHerdr, frontmost, openHerdr, run } from '../../src/herdr.js'

const FEED = 'https://releases.herdr.dev/app/latest.json'
const platform = process.platform
const OS = { darwin: 'macos', linux: 'linux', win32: 'windows' }[platform]
const ARCH = { arm64: 'aarch64', x64: 'x86_64' }[process.arch]
const target = `${OS}-${ARCH}`
const out = process.env.OUT || mkdtempSync(join(tmpdir(), 'herdr-harness-'))
mkdirSync(out, { recursive: true })
const results = join(out, 'results.jsonl')
const rows = []
let failed = false

const clip = (text, max = 1500) => {
  const value = String(text ?? '').trim()
  return value.length > max ? `${value.slice(0, max)}… (${value.length} chars)` : value
}
/** One check: `ok` true, false, or null (informational). A false `needed` check fails the run. */
function record(check, ok, detail, { needed = true, value } = {}) {
  const line = { os: OS, target, check, ok, needed, detail: clip(detail), ...(value === undefined ? {} : { value }) }
  appendFileSync(results, `${JSON.stringify(line)}\n`)
  rows.push(line)
  if (ok === false && needed) failed = true
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INFO'} ${check}: ${clip(detail, 400)}`)
}
const shown = result => `exit ${result.code}${result.stdout.trim() ? `\nstdout: ${result.stdout.trim()}` : ''}${result.stderr.trim() ? `\nstderr: ${result.stderr.trim()}` : ''}`
const sleep = ms => new Promise(done => setTimeout(done, ms))

// The socket lives in HERDR_APP_HOME, and a Unix socket path must stay short (SUN_LEN).
const appHome = platform === 'win32' ? join(tmpdir(), `hh${randomBytes(3).toString('hex')}`) : `/tmp/hh${randomBytes(3).toString('hex')}`
mkdirSync(appHome, { recursive: true })
const { [OVERRIDE]: _override, ...base } = process.env
const env = { ...base, HERDR_APP_HOME: appHome }
const host = { platform, arch: process.arch, env, home: homedir() }

async function feed() {
  const manifest = await fetch(FEED).then(response => response.json())
  const build = manifest.targets?.[target]
  if (!build?.url) return record('feed', false, `${FEED} has no ${target} build: ${JSON.stringify(manifest)}`)
  const bytes = Buffer.from(await fetch(build.url).then(response => response.arrayBuffer()))
  const sha = createHash('sha256').update(bytes).digest('hex')
  record('feed sha256', sha === build.sha256, `${manifest.version} ${build.url}: ${bytes.length} bytes, sha256 ${sha}${sha === build.sha256 ? ' matches' : ` != feed ${build.sha256}`}`, { value: manifest.version })
}

function install() {
  return new Promise(done => {
    const [file, args] = platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://releases.herdr.dev/app/install.ps1 | iex']]
      : ['sh', ['-c', 'curl -fsSL https://releases.herdr.dev/app/install.sh | sh']]
    execFile(file, args, { env: base, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      record('install (herdrdev installer)', !error, `${error ? `failed: ${error.message}\n` : ''}${stdout}${stderr}`)
      done()
    })
  })
}

// When the window does not come up, the app's own output says why: run it attached for a while.
function attachedRun(bin, ms) {
  return new Promise(done => {
    let text = ''
    const child = spawn(bin, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => { text += chunk })
    child.stderr.on('data', chunk => { text += chunk })
    child.on('error', error => { text += `\nspawn error: ${error.message}` })
    const timer = setTimeout(() => { child.kill(); done(`still running after ${ms} ms\n${text}`) }, ms)
    child.on('exit', (code, signal) => { clearTimeout(timer); done(`exited ${code ?? signal}\n${text}`) })
  })
}

// Something else in front, so the second open is a raise, not a start.
async function somethingElseInFront() {
  if (platform === 'darwin') return run('/usr/bin/open', ['-a', 'Finder'], { env })
  const file = platform === 'win32' ? 'notepad.exe' : 'xterm'
  const child = spawn(file, [], { env, detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
  await sleep(2500)
  return { code: 0, stdout: '', stderr: '' }
}

async function main() {
  record('runner', null, `${process.platform} ${process.arch} node ${process.version}; HERDR_APP_HOME=${appHome}; DISPLAY=${process.env.DISPLAY ?? ''}`, { needed: false })
  await feed().catch(error => record('feed sha256', false, error.stack))
  await install()

  const found = findHerdr(host)
  record('find', found !== null, found ? `${found.bin} (${found.source}${found.app ? `, bundle ${found.app}` : ''})` : 'herdr-app not found after the install')
  if (!found) return
  record('find without PATH', findHerdr({ ...host, env: { ...env, PATH: '', Path: '' } }) !== null, 'the install paths alone, as for an app started from Finder or the Start menu')
  const version = await run(found.bin, ['--version'], { env })
  record('--version', version.code === 0, shown(version))

  const before = await run(found.bin, ['status'], { env })
  record('status before start (exit 2)', before.code === 2, shown(before))

  const marks = []
  const t0 = Date.now()
  const logs = []
  const opened = await openHerdr({ ...host, mark: step => marks.push(`${step} +${Date.now() - t0} ms`), log: line => logs.push(line) })
  record('start and wait', opened.ok, `${JSON.stringify(opened)}\nsteps: ${marks.join(', ')}${logs.length ? `\nlog: ${logs.join(' | ')}` : ''}`)
  if (!opened.ok) {
    record('app output (attached run, 20 s)', null, await attachedRun(found.bin, 20_000), { needed: false })
    const after = await run(found.bin, ['status'], { env })
    record('status after the attached run', after.code === 0, shown(after), { needed: false })
    return
  }
  record('first open: raised or the no-focus message', opened.raised === true || opened.message !== undefined, opened.raised === true ? 'raised' : `${opened.message} (front: ${opened.detail})`, { value: opened.raised })

  const status = await run(found.bin, ['status'], { env })
  record('status (exit 0)', status.code === 0, shown(status))
  const ls = await run(found.bin, ['ls'], { env })
  let lsOk = ls.code === 0
  try { JSON.parse(ls.stdout) } catch { lsOk = false }
  record('ls (JSON)', lsOk, shown(ls))
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hs')))
  const made = await run(found.bin, ['do', 'space.new', '--name', 'harness', '--folder', folder], { env })
  let madeOk = made.code === 0 && !/"error"/.test(made.stdout)
  record('do space.new', madeOk, shown(made))
  const again = await run(found.bin, ['ls'], { env })
  madeOk = again.code === 0 && again.stdout.includes(JSON.stringify(folder).slice(1, -1))
  record('ls shows the new space\'s folder', madeOk, shown(again))

  const other = await somethingElseInFront()
  const behind = await frontmost({ platform, env })
  record('another window in front', null, `${shown(other)}\nfront: ${JSON.stringify(behind)}`, { needed: false })
  const raised = await openHerdr({ ...host, log: line => logs.push(line) })
  record('second open from behind: raised or the no-focus message', raised.ok && (raised.raised === true || raised.message !== undefined), raised.raised === true ? 'raised' : JSON.stringify(raised), { value: raised.raised })

  const shot = await run(found.bin, ['shot', join(out, `herdr-${OS}.png`)], { env })
  record('shot', null, shown(shot), { needed: false })
}

function summary() {
  const cell = row => (row.ok === true ? 'pass' : row.ok === false ? '**fail**' : 'info')
  const md = [`### herdr-app on ${target}`, '', '| check | result | detail |', '|---|---|---|',
    ...rows.map(row => `| ${row.check} | ${cell(row)} | ${clip(row.detail, 700).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')} |`), '']
  writeFileSync(join(out, 'summary.md'), md.join('\n'))
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`)
}

try {
  await main()
} catch (error) {
  record('harness', false, error.stack)
}
summary()
console.log(readFileSync(join(out, 'summary.md'), 'utf8'))
process.exit(failed ? 1 : 0)
