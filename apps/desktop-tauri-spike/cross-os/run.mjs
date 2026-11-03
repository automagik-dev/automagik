// SPIKE harness (throwaway): the cross-OS matrix of .github/workflows/cross-os.yml. One Node
// script for macOS, Linux and Windows, so every OS runs the same checks the same way. It never
// touches ~/.automagik: each launch gets a temp home. Results are JSON lines, one per check:
//   {"os","shell","check","result":"works|degraded|broken|info","value","reason"}
//
//   node run.mjs electron-app   --exe <packaged app binary> --desktop <apps/desktop> --test <test dir>
//   node run.mjs electron-smoke --desktop <apps/desktop>
//   node run.mjs tauri-app      --exe <spike binary> --resources <apps/desktop/build> --test <test dir> --playwright <bots-dsh/package.json>
//   node run.mjs size           --shell <s> --check <c> --path <file or dir> [--path …] [--add <dir> …]
//   node run.mjs herdr
//   node run.mjs record         --shell <s> --check <c> --result <r> [--value <v>] [--reason <text>]
//   node run.mjs runner
//   node run.mjs report         --in <dir with *.jsonl> --out <markdown file>
//
// Env: RESULTS (the JSONL file, default results.jsonl), LOGS (default logs/), IDLE_SECONDS (60).
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { appendFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { createServer as netServer } from 'node:net'
import { arch, cpus, release, tmpdir, totalmem } from 'node:os'
import { basename, join, resolve } from 'node:path'

const OS = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform] ?? process.platform
const WIN = process.platform === 'win32'
const RESULTS = resolve(process.env.RESULTS ?? 'results.jsonl')
const LOGS = resolve(process.env.LOGS ?? 'logs')
const IDLE = Number(process.env.IDLE_SECONDS ?? 60) * 1000
mkdirSync(LOGS, { recursive: true })

const [command, ...rest] = process.argv.slice(2)
const opts = {}
for (let i = 0; i < rest.length; i += 2) {
  const key = rest[i].replace(/^--/, '')
  opts[key] = opts[key] === undefined ? rest[i + 1] : [].concat(opts[key], rest[i + 1])
}
const list = value => (value === undefined ? [] : [].concat(value))

function record(shell, check, result, { value = null, reason = '' } = {}) {
  const line = { os: OS, shell, check, result, value, reason: String(reason).slice(0, 600) }
  appendFileSync(RESULTS, `${JSON.stringify(line)}\n`)
  console.log(`[${shell}] ${check}: ${result}${reason ? ` (${String(reason).slice(0, 200)})` : ''}${value !== null ? ` ${JSON.stringify(value)}` : ''}`)
}

const delay = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(probe, timeoutMs, everyMs = 250) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > end) return null
    await delay(everyMs)
  }
}
const freePort = () => new Promise((ok, fail) => {
  const server = netServer().once('error', fail).listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => ok(port))
  })
})
const mb = kb => Math.round(kb / 102.4) / 10

// ---------- processes ----------

/** Every process: pid, ppid, rss in KB (Windows: the working set), command line. */
function processes() {
  if (WIN) {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,Name,CommandLine | ConvertTo-Json -Compress'],
    { encoding: 'utf8', maxBuffer: 64 << 20 })
    return [].concat(JSON.parse(out)).map(p => ({ pid: p.ProcessId, ppid: p.ParentProcessId, rss: Math.round(Number(p.WorkingSetSize) / 1024), cmd: p.CommandLine || p.Name || '' }))
  }
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,args='], { encoding: 'utf8', maxBuffer: 64 << 20 })
  return out.split('\n').filter(Boolean).map((line) => {
    const [, pid, ppid, rss, cmd] = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/) ?? []
    return { pid: Number(pid), ppid: Number(ppid), rss: Number(rss), cmd: cmd ?? '' }
  }).filter(p => p.pid)
}
function treeOf(root, all = processes()) {
  const out = []
  const walk = (pid) => {
    const self = all.find(p => p.pid === pid)
    if (self) out.push(self)
    for (const child of all.filter(p => p.ppid === pid && p.pid !== pid)) walk(child.pid)
  }
  walk(root)
  return out
}
const isDsh = p => /@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js/.test(p.cmd)
const isWebKitXpc = p => /com\.apple\.WebKit\./.test(p.cmd)

/** RSS of the app's tree, plus (macOS) WebKit's XPC processes that started after `before`. */
function rssOf(root, before) {
  const all = processes()
  const rows = treeOf(root, all)
  if (OS === 'macos' && before) {
    for (const p of all) if (isWebKitXpc(p) && !before.has(p.pid) && !rows.some(r => r.pid === p.pid)) rows.push(p)
  }
  const dshRoots = rows.filter(isDsh)
  const dshPids = new Set(dshRoots.flatMap(p => treeOf(p.pid, all).map(c => c.pid)))
  const total = rows.reduce((s, p) => s + p.rss, 0)
  const dsh = rows.filter(p => dshPids.has(p.pid)).reduce((s, p) => s + p.rss, 0)
  const parts = rows.map(p => `${p.pid} ${mb(p.rss)}MB ${p.cmd.replace(/token=\S+/g, 'token=…').slice(0, 140)}`)
  return { totalMB: mb(total), dshMB: mb(dsh), withoutDshMB: mb(total - dsh), processes: rows.length, parts }
}

function launch(name, exe, args, env) {
  const log = createWriteStream(join(LOGS, `${name}.log`))
  const lines = []
  const before = new Set(processes().map(p => p.pid))
  const started = Date.now()
  const child = spawn(exe, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = ''
    stream.on('data', (chunk) => {
      log.write(chunk)
      buffer += chunk
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop()
      for (const line of parts) lines.push({ at: Date.now() - started, line })
    })
  }
  let exited = null
  child.on('exit', (code, signal) => { exited = { code, signal, at: Date.now() - started } })
  child.on('error', (error) => { exited = { error: error.message } })
  return { child, lines, before, started, log, exited: () => exited, find: re => lines.find(l => re.test(l.line)) }
}

async function stop(run) {
  const { child } = run
  if (run.exited()) return run.exited()
  const tree = treeOf(child.pid)
  if (WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
  await waitFor(() => run.exited(), 20_000)
  // Whatever of its tree is still there (DSH left behind is itself a finding: see the log).
  const alive = new Set(processes().map(p => p.pid))
  const left = tree.filter(p => p.pid !== child.pid && alive.has(p.pid))
  for (const p of left) {
    if (WIN) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
    else try { process.kill(p.pid, 'SIGKILL') } catch {}
  }
  if (!run.exited()) {
    if (WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else try { child.kill('SIGKILL') } catch {}
    await waitFor(() => run.exited(), 5000)
  }
  run.log.end()
  return { ...run.exited(), leftBehind: left.map(p => basename(p.cmd.split(' ')[0] || '')).slice(0, 10) }
}

// ---------- CDP ----------

async function getJson(url, timeoutMs = 3000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  const text = await response.text()
  try { return { status: response.status, json: JSON.parse(text), text } } catch { return { status: response.status, json: null, text } }
}
function cdpSession(wsUrl) {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map()
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const waiter = pending.get(message.id)
      if (waiter) { pending.delete(message.id); message.error ? waiter.fail(new Error(message.error.message)) : waiter.ok(message.result) }
    }
    ws.onerror = () => fail(new Error(`websocket ${wsUrl} failed`))
    ws.onopen = () => ok({
      send: (method, params = {}) => new Promise((ok2, fail2) => { const n = ++id; pending.set(n, { ok: ok2, fail: fail2 }); ws.send(JSON.stringify({ id: n, method, params })) }),
      close: () => ws.close(),
    })
  })
}
async function evaluate(session, expression) {
  const { result, exceptionDetails } = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}
const PAGE_STATE = `(() => { const b = document.body; const text = b ? b.innerText.trim().replace(/\\s+/g, ' ') : '';
  return { ready: document.readyState, title: document.title, nodes: document.querySelectorAll('*').length, text: text.length, sample: text.slice(0, 160) } })()`
const BAD_PAGE = /authentication required|failed to load plugins|could not start|cannot get \//i

// ---------- the Bot store probe ----------

function serveTest(dir) {
  return new Promise((ok) => {
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://x').pathname
      if (path === '/bot.html') return response.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(join(dir, 'bot.html')))
      if (path === '/host.html') return response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>host</title><body>cross-os host page (DSH did not start)</body>')
      response.writeHead(404).end('no')
    })
    server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port }))
  })
}
/** Isolation (fresh stores: b, written after a, reads nothing) and persistence (each reads back its own). */
function judgeStores(phase, a, b) {
  if (!a || !b) return { result: 'broken', reason: `no probe result from ${!a ? 'bot a' : ''} ${!b ? 'bot b' : ''}`.trim() }
  const empty = x => !x.before.cookie && x.before.localStorage == null && x.before.indexedDB == null
  if (phase === 'write') {
    return empty(a) && empty(b)
      ? { result: 'works', reason: 'fresh stores: bot b read nothing 2 s after bot a wrote (cookie, localStorage, IndexedDB)' }
      : { result: 'broken', reason: `stores not isolated or not fresh: a.before=${JSON.stringify(a.before)} b.before=${JSON.stringify(b.before)}` }
  }
  const own = (x, id) => x.before.cookie.includes(`who=${id}`) && x.before.localStorage === id && x.before.indexedDB === id
  return own(a, 'a') && own(b, 'b')
    ? { result: 'works', reason: 'after a relaunch each Bot read back its own id (cookie, localStorage, IndexedDB)' }
    : { result: 'broken', reason: `not persisted per Bot: a.before=${JSON.stringify(a.before)} b.before=${JSON.stringify(b.before)}` }
}

// ---------- Electron: the packaged app ----------

const BOT_A = 'session-1b4e28ba-2fa1-4d3b-a3f5-ef19f1a2b3c4'
const BOT_B = 'session-2b4e28ba-2fa1-4d3b-a3f5-ef19f1a2b3c4'

async function electronApp() {
  const exe = resolve(opts.exe)
  const desktop = resolve(opts.desktop)
  const home = mkdtempSync(join(tmpdir(), 'cross-os-electron-'))
  const startLog = join(home, 'desktop', 'logs', 'start.log')
  const { server, port: testPort } = await serveTest(resolve(opts.test))
  const botUrl = `http://127.0.0.1:${testPort}/bot.html`
  const version = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).version
  let dshVersion = null
  try { dshVersion = JSON.parse(readFileSync(join(desktop, 'build', 'versions.json'), 'utf8')) } catch {}
  record('electron', 'version', 'info', { value: { app: version, electron: JSON.parse(readFileSync(join(desktop, 'node_modules', 'electron', 'package.json'), 'utf8')).version, runtime: dshVersion } })
  const env = { ...process.env, AUTOMAGIK_HOME: home, ELECTRON_ENABLE_LOGGING: '1' }
  delete env.ELECTRON_RUN_AS_NODE

  async function once(name) {
    const debugPort = await freePort()
    const logStart = existsSync(startLog) ? readFileSync(startLog, 'utf8').length : 0
    const run = launch(`electron-${name}`, exe, [`--remote-debugging-port=${debugPort}`], env)
    let target = null
    let state = null
    let failure = null
    const page = await waitFor(async () => {
      if (run.exited()) { failure = `the app exited: ${JSON.stringify(run.exited())}`; return true }
      try {
        const { json } = await getJson(`http://127.0.0.1:${debugPort}/json/list`)
        target = json?.find(t => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url) && !t.url.includes(`:${testPort}/`))
        if (!target) return null
        const session = await cdpSession(target.webSocketDebuggerUrl)
        try { state = await evaluate(session, PAGE_STATE) } finally { session.close() }
        return state.ready === 'complete' && state.text > 20 ? { at: Date.now() - run.started } : null
      } catch { return null }
    }, 180_000, 500)
    const log = existsSync(startLog) ? readFileSync(startLog, 'utf8').slice(logStart) : ''
    const mark = step => Number(log.match(new RegExp(`start: ${step} \\+(\\d+) ms`))?.[1] ?? NaN)
    const timings = { dshReadyMs: mark('dsh ready'), pageInMs: mark('page in'), contentSeenMs: page && !failure ? page.at : null }
    const ok = page && !failure && state && !BAD_PAGE.test(state.sample)
    return { run, target, state, ok, failure: failure ?? (page ? (ok ? null : `page shows: ${state?.sample}`) : `no DSH page with content in 180 s (target ${target?.url?.replace(/token=\S+/, 'token=…') ?? 'none'}, state ${JSON.stringify(state)})`), timings, debugPort }
  }

  async function views(session, phase) {
    const script = `(async () => {
      const views = window.dsBotApp?.browser?.views
      if (!views) return { error: 'no dsBotApp.browser.views in the page' }
      await views.create(${JSON.stringify(BOT_A)}, 'cross-os-a', ${JSON.stringify(`${botUrl}?bot=a`)})
      await views.place('cross-os-a', { left: 0, top: 0, width: 640, height: 420 }, true)
      await new Promise(r => setTimeout(r, 300))
      await views.create(${JSON.stringify(BOT_B)}, 'cross-os-b', ${JSON.stringify(`${botUrl}?bot=b`)})
      await views.place('cross-os-b', { left: 640, top: 0, width: 640, height: 420 }, true)
      return { ok: true }
    })()`
    const made = await evaluate(session, script).catch(error => ({ error: error.message }))
    if (made?.error) return { made, a: null, b: null }
    const read = (bot, tab) => evaluate(session, `window.dsBotApp.browser.views.read(${JSON.stringify(bot)}, ${JSON.stringify(tab)}, 'JSON.stringify(window.__probe ?? null)')`).then(t => JSON.parse(t ?? 'null')).catch(() => null)
    const a = await waitFor(() => read(BOT_A, 'cross-os-a'), 30_000, 500)
    const b = await waitFor(() => read(BOT_B, 'cross-os-b'), 30_000, 500)
    return { made, a, b }
  }

  const first = await once('first')
  record('electron', 'page-first-launch', first.ok ? 'works' : 'broken', { value: first.timings, reason: first.failure ?? `"${first.state.title}", ${first.state.nodes} nodes: ${first.state.sample}` })
  console.log('stop', JSON.stringify(await stop(first.run)))

  const warm = await once('warm')
  record('electron', 'page', warm.ok ? 'works' : 'broken', { value: warm.timings, reason: warm.failure ?? `"${warm.state.title}", ${warm.state.nodes} nodes: ${warm.state.sample}` })
  record('electron', 'cold-start', warm.ok ? 'info' : 'broken', { value: { warm: warm.timings, first: first.timings } })
  if (warm.ok) {
    await delay(IDLE)
    const idle = rssOf(warm.run.child.pid, warm.run.before)
    record('electron', 'idle-rss', 'info', { value: { ...idle, idleSeconds: IDLE / 1000 } })
    const session = await cdpSession(warm.target.webSocketDebuggerUrl)
    const made = await views(session, 'write')
    session.close()
    const judged = made.made?.error ? { result: 'broken', reason: made.made.error } : judgeStores('write', made.a, made.b)
    record('electron', 'views-isolated', judged.result, { value: { a: made.a, b: made.b }, reason: `real app: dsBotApp.browser.views (bot-views.js, persist partitions). ${judged.reason}` })
    await delay(15_000)
    record('electron', 'rss-2-views', 'info', { value: rssOf(warm.run.child.pid, warm.run.before) })
  }
  console.log('stop', JSON.stringify(await stop(warm.run)))

  if (warm.ok) {
    const again = await once('reread')
    if (again.ok) {
      const session = await cdpSession(again.target.webSocketDebuggerUrl)
      const read = await views(session, 'read')
      session.close()
      const judged = read.made?.error ? { result: 'broken', reason: read.made.error } : judgeStores('read', read.a, read.b)
      record('electron', 'views-persistent', judged.result, { value: { a: read.a, b: read.b }, reason: judged.reason })
    } else {
      record('electron', 'views-persistent', 'broken', { reason: `relaunch: ${again.failure}` })
    }
    console.log('stop', JSON.stringify(await stop(again.run)))
  }
  server.close()
}

// ---------- Electron: the in-app Bot browser driven over CDP (the app's own smoke test) ----------

async function electronSmoke() {
  const desktop = resolve(opts.desktop)
  const electron = createRequire(join(desktop, 'package.json'))('electron')
  const out = spawnSync(electron, ['scripts/browser-smoke.mjs'], { cwd: desktop, encoding: 'utf8', timeout: 300_000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } })
  const text = `${out.stdout ?? ''}\n${out.stderr ?? ''}`
  writeFileSync(join(LOGS, 'electron-browser-smoke.log'), text)
  const passed = text.split('\n').filter(l => l.startsWith('ok   ')).length
  const failed = text.split('\n').filter(l => l.startsWith('FAIL ')).map(l => l.slice(5))
  const all = /browser smoke: all passed/.test(text) || (failed.length === 0 && passed >= 20)
  record('electron', 'automation', all ? 'works' : passed > 0 ? 'degraded' : 'broken', {
    value: { passed, failed: failed.length, exit: out.status, signal: out.signal },
    reason: all
      ? `scripts/browser-smoke.mjs: ${passed} checks passed (Playwright connectOverCDP through bot-relay.js debugger.attach, 2 Bots' views, cross-site iframe, route, dialogs, screenshots, isolation)${out.status ? `; exit ${out.status} after the checks: ${(text.match(/Error: (E[A-Z]+[^\n]{0,80})/) ?? [])[1] ?? 'see log'}` : ''}`
      : `browser-smoke.mjs: ${passed} ok, ${failed.length} failed: ${failed.slice(0, 4).join(' | ') || text.slice(-400)}`,
  })
}

// ---------- Tauri spike ----------

async function tauriApp() {
  const exe = resolve(opts.exe)
  const home = mkdtempSync(join(tmpdir(), 'cross-os-tauri-'))
  const { server, port: testPort } = await serveTest(resolve(opts.test))
  const botUrl = `http://127.0.0.1:${testPort}/bot.html`
  const base = { ...process.env, SPIKE_HOME: home, SPIKE_RESOURCES: resolve(opts.resources), SPIKE_START: 'direct', SPIKE_NODE: process.execPath }
  const bridge = (run, kind) => {
    const hit = run.lines.find(l => l.line.includes(`bridge ${kind} from `))
    if (!hit) return null
    const ms = Number(hit.line.match(/\[spike\] \+(\d+)ms/)?.[1])
    const json = hit.line.slice(hit.line.indexOf('{'))
    try { return { ms, from: hit.line.match(/from (\S+)/)?.[1], payload: JSON.parse(json) } } catch { return { ms, payload: null } }
  }
  const markMs = (run, re) => Number(run.lines.find(l => re.test(l.line))?.line.match(/\+(\d+)ms/)?.[1] ?? NaN)

  async function once(name, extra = {}, { wantBots = false } = {}) {
    const run = launch(`tauri-${name}`, exe, [], { ...base, ...extra })
    const seen = await waitFor(() => run.exited() || bridge(run, 'visible') || bridge(run, 'visible-timeout'), 180_000)
    let bots = null
    if (wantBots && !run.exited()) {
      await waitFor(() => bridge(run, 'bot-store-a') && bridge(run, 'bot-store-b'), 45_000)
      bots = { a: bridge(run, 'bot-store-a')?.payload ?? null, b: bridge(run, 'bot-store-b')?.payload ?? null }
    }
    const visible = bridge(run, 'visible')
    const timings = { dshReadyMs: markMs(run, /dsh ready/), loadMs: bridge(run, 'load')?.ms ?? null, visibleMs: visible?.ms ?? null }
    const remote = visible && /^http:\/\/127\.0\.0\.1:\d+$/.test(visible.from ?? '')
    const sample = visible?.payload?.sample ?? ''
    const ok = Boolean(remote && visible.payload?.text > 20 && !BAD_PAGE.test(sample))
    const error = run.lines.filter(l => /\[spike\] (?!\+)|error|panicked/i.test(l.line)).slice(0, 5).map(l => l.line).join(' | ')
    const failure = ok ? null
      : run.exited() ? `the app exited ${JSON.stringify(run.exited())}: ${error || run.lines.slice(-5).map(l => l.line).join(' | ')}`
        : visible ? `page shows: ${sample}`
          : bridge(run, 'visible-timeout') ? `page never drew content: ${JSON.stringify(bridge(run, 'visible-timeout').payload).slice(0, 300)}`
            : seen ? 'no visible report' : `no page report in 180 s (load: ${JSON.stringify(bridge(run, 'load'))}) ${error}`
    return { run, ok, failure, timings, bots, sample, visible }
  }

  const first = await once('first')
  record('tauri', 'page-first-launch', first.ok ? 'works' : 'broken', { value: first.timings, reason: first.failure ?? `${first.visible.payload.nodes} nodes: ${first.sample}` })
  console.log('stop', JSON.stringify(await stop(first.run)))

  const warm = await once('warm')
  record('tauri', 'page', warm.ok ? 'works' : 'broken', { value: warm.timings, reason: warm.failure ?? `${warm.visible.payload.nodes} nodes: ${warm.sample}` })
  record('tauri', 'cold-start', warm.ok ? 'info' : 'broken', { value: { warm: warm.timings, first: first.timings } })
  if (warm.ok) {
    await delay(IDLE)
    record('tauri', 'idle-rss', 'info', { value: { ...rssOf(warm.run.child.pid, warm.run.before), idleSeconds: IDLE / 1000 } })
  }
  console.log('stop', JSON.stringify(await stop(warm.run)))

  // The Bot views. Without a working DSH, they are laid beside a static page instead, so the
  // wrapper's own part (views, stores, CDP) still gets a result.
  const viewsEnv = { SPIKE_BOT_URL: botUrl, ...(warm.ok ? {} : { SPIKE_URL: `http://127.0.0.1:${testPort}/host.html` }) }
  const without = warm.ok ? '' : ' (beside a static page: DSH did not start)'
  const inspectPort = await freePort()
  // Below the ephemeral range (Windows hands out 49152+ in order, so DSH's free port would be base+1).
  const cdpBase = await cdpPorts()
  const cdpEnv = WIN ? { SPIKE_CDP_PORT: String(cdpBase) }
    : OS === 'linux' ? { WEBKIT_INSPECTOR_HTTP_SERVER: `127.0.0.1:${inspectPort}` } : {}
  const write = await once('views-write', { ...viewsEnv, ...cdpEnv }, { wantBots: true })
  {
    const judged = write.bots ? judgeStores('write', write.bots.a, write.bots.b) : { result: 'broken', reason: write.failure }
    record('tauri', 'views-isolated', judged.result, { value: write.bots, reason: `${OS === 'macos' ? 'data_store_identifier (WKWebsiteDataStore)' : 'data_directory per Bot'}${without}. ${judged.reason}` })
  }
  if (!write.run.exited()) {
    await delay(15_000)
    if (warm.ok) record('tauri', 'rss-2-views', 'info', { value: rssOf(write.run.child.pid, write.run.before) })
    await tauriCdp(write.run, home, inspectPort, cdpBase)
  } else {
    record('tauri', 'automation', 'broken', { reason: `the app exited before the CDP check: ${write.failure}` })
  }
  console.log('stop', JSON.stringify(await stop(write.run)))

  const read = await once('views-read', viewsEnv, { wantBots: true })
  {
    const judged = read.bots ? judgeStores('read', read.bots.a, read.bots.b) : { result: 'broken', reason: read.failure }
    record('tauri', 'views-persistent', judged.result, { value: read.bots, reason: `${judged.reason}${without}` })
  }
  console.log('stop', JSON.stringify(await stop(read.run)))
  server.close()
}

function findFiles(root, name, depth = 5) {
  const out = []
  const walk = (dir, d) => {
    if (d < 0) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === name && e.isFile()) out.push(join(dir, e.name))
      else if (e.isDirectory() && !e.isSymbolicLink()) walk(join(dir, e.name), d - 1)
    }
  }
  walk(root, depth)
  return out
}

/** Can a Bot driver attach to the platform webview the way bots-dsh does (Playwright connectOverCDP)? */
async function cdpPorts() {
  const free = port => new Promise(ok => { const s = netServer().once('error', () => ok(false)).listen(port, '127.0.0.1', () => s.close(() => ok(true))) })
  for (;;) {
    const base = 20000 + Math.floor(Math.random() * 9000)
    if (await free(base + 1) && await free(base + 2)) return base
  }
}

async function tauriCdp(run, home, inspectPort, cdpBase) {
  if (OS === 'macos') {
    const ports = spawnSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', treeOf(run.child.pid).map(p => p.pid).join(',')], { encoding: 'utf8' }).stdout.trim().split('\n').slice(1)
    record('tauri', 'automation', 'broken', { value: { listening: ports.map(l => l.replace(/\s+/g, ' ').slice(0, 120)) }, reason: 'WKWebView has no CDP endpoint and no switch to open one (isInspectable serves Safari\'s Web Inspector over webinspectord only); Playwright cannot attach. Only DSH listens in the app\'s tree.' })
    return
  }
  const { chromium } = createRequire(resolve(opts.playwright))('playwright-core')
  let endpoints = []
  if (WIN) {
    const roots = [home, join(process.env.LOCALAPPDATA ?? '', 'ai.namastex.automagik.tauri-spike')]
    const files = roots.flatMap(root => findFiles(root, 'DevToolsActivePort'))
    endpoints = [{ file: 'SPIKE_CDP_PORT bot-a', port: cdpBase + 1 }, { file: 'SPIKE_CDP_PORT bot-b', port: cdpBase + 2 },
      ...files.map(f => ({ file: f, port: Number(readFileSync(f, 'utf8').split('\n')[0]) })).filter(e => e.port)]
  } else {
    endpoints = [{ file: 'WEBKIT_INSPECTOR_HTTP_SERVER', port: inspectPort }]
  }
  const found = []
  for (const endpoint of endpoints) {
    const version = await getJson(`http://127.0.0.1:${endpoint.port}/json/version`).catch(e => ({ error: e.message }))
    const targets = await getJson(`http://127.0.0.1:${endpoint.port}/json/list`).catch(e => ({ error: e.message }))
    found.push({ ...endpoint, version: version.json ?? version.error ?? version.text?.slice(0, 120), status: version.status, targets: Array.isArray(targets.json) ? targets.json.map(t => t.url.replace(/token=\S+/, 'token=…')) : (targets.error ?? targets.text?.slice(0, 120)) })
  }
  const botEndpoint = found.find(e => Array.isArray(e.targets) && e.targets.some(u => u.includes('bot.html?bot=a')))
    ?? found.find(e => Array.isArray(e.targets) && e.targets.some(u => u.includes('bot.html?bot=b')))
  if (!botEndpoint) {
    const attempt = await chromium.connectOverCDP(`http://127.0.0.1:${endpoints[0]?.port ?? 9}`, { timeout: 10_000 }).then(b => { b.close(); return 'connected (unexpected)' }, e => e.message.split('\n')[0])
    record('tauri', 'automation', 'broken', {
      value: { endpoints: found },
      reason: OS === 'linux'
        ? `WebKitGTK has no CDP: its inspector server speaks WebKit's own inspector protocol. connectOverCDP: ${attempt}`
        : `no CDP endpoint lists bot a's view (tried ${found.map(e => `${e.port} ${e.status ?? e.version}`).join(', ')}). connectOverCDP: ${attempt}`,
    })
    return
  }
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${botEndpoint.port}`, { timeout: 15_000 })
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('bot.html?bot='))
    if (!page) throw new Error(`connected, but no Playwright page for a Bot view among ${browser.contexts().flatMap(c => c.pages()).map(p => p.url()).join(', ')}`)
    const bot = await page.evaluate(() => window.__probe?.bot ?? document.title)
    const shot = await page.screenshot()
    await page.mouse.click(20, 20)
    await page.route('**/cross-os-blocked*', route => route.abort())
    const routed = await page.evaluate(() => fetch('/cross-os-blocked').then(() => 'loaded', () => 'aborted'))
    const others = found.filter(e => e !== botEndpoint).map(e => ({ port: e.port, targets: e.targets }))
    await browser.close()
    record('tauri', 'automation', routed === 'aborted' ? 'works' : 'degraded', {
      value: { endpoint: botEndpoint.port, evaluate: bot, screenshotBytes: shot.length, route: routed, endpoints: found.length, others },
      reason: `WebView2 opens CDP per Bot view (additional_browser_args --remote-debugging-port, one browser process per data directory); Playwright connectOverCDP on ${bot}'s view: evaluate, screenshot, mouse click, route abort ${routed}; endpoints: ${found.map(e => `${e.file.replace('SPIKE_CDP_PORT ', '')} ${e.status === 200 ? JSON.stringify(e.targets).slice(0, 90) : `status ${e.status ?? e.version}`}`).join('; ')}`,
    })
  } catch (error) {
    record('tauri', 'automation', 'broken', { value: { endpoints: found }, reason: `CDP endpoint found but Playwright failed: ${error.message.split('\n')[0]}` })
  }
}

// ---------- sizes, herdr, runner, record ----------

function sizeOf(path) {
  const stat = lstatSync(path)
  if (!stat.isDirectory()) return stat.size
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0)
}
function sizes() {
  const files = list(opts.path).filter(existsSync).map(p => ({ name: basename(p), MB: Math.round(sizeOf(p) / 1048576 * 10) / 10 }))
  const added = list(opts.add).filter(existsSync).reduce((s, p) => s + sizeOf(p), 0)
  record(opts.shell, opts.check, files.length ? 'info' : 'broken', { value: { files, ...(added ? { runtimeAndProfileMB: Math.round(added / 1048576) } : {}) }, reason: files.length ? '' : `none of ${list(opts.path).join(', ')} exists` })
}

async function herdr() {
  const headers = { accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }
  const cask = await fetch('https://raw.githubusercontent.com/penso/homebrew-tap/HEAD/Casks/herdr-gpui.rb').then(r => r.text()).catch(e => e.message)
  record('herdr', 'cask', 'info', { value: { url: cask.match(/url "([^"]+)"/)?.[1], dependsOn: cask.match(/depends_on (.+)/)?.[1] }, reason: 'penso/tap/herdr-gpui (Homebrew cask): macOS only' })
  const releaseInfo = await fetch('https://api.github.com/repos/penso/herdr-gpui/releases/latest', { headers }).then(r => r.json())
  const want = OS === 'macos' ? /universal-apple-darwin\.dmg$/ : OS === 'linux' ? /x86_64-unknown-linux-gnu\.tar\.gz$/ : /x86_64-pc-windows-msvc\.zip$/
  const asset = releaseInfo.assets?.find(a => want.test(a.name) && a.name.startsWith('Herdr-'))
  const allForOs = (releaseInfo.assets ?? []).map(a => a.name).filter(n => (OS === 'linux' ? /linux-gnu\.(deb|rpm|tar\.gz|pkg\.tar\.zst)$/ : OS === 'windows' ? /windows-msvc(-setup\.exe|\.zip)$/ : /darwin\.dmg$/).test(n))
  if (!asset) return record('herdr', 'build', 'broken', { reason: `no ${want} asset in ${releaseInfo.tag_name}` })
  record('herdr', 'build', 'works', { value: { release: releaseInfo.tag_name, assets: allForOs }, reason: `GitHub release of penso/herdr-gpui ships ${allForOs.length} ${OS} builds` })
  const dir = mkdtempSync(join(tmpdir(), 'cross-os-herdr-'))
  const file = join(dir, asset.name)
  writeFileSync(file, Buffer.from(await fetch(asset.browser_download_url).then(r => r.arrayBuffer())))
  let exe = null
  if (OS === 'macos') {
    spawnSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', join(dir, 'mnt'), file])
    const app = readdirSync(join(dir, 'mnt')).find(n => n.endsWith('.app'))
    const macos = join(dir, 'mnt', app, 'Contents', 'MacOS')
    exe = join(macos, readdirSync(macos)[0])
  } else {
    mkdirSync(join(dir, 'x'))
    if (WIN) spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${file}' -DestinationPath '${join(dir, 'x')}'`])
    else spawnSync('tar', ['-xf', file, '-C', join(dir, 'x')])
    const all = []
    const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else all.push(p) } }
    walk(join(dir, 'x'))
    exe = all.find(p => WIN ? /^(herdr-gpui|herdr|herdr-ui)\.exe$/i.test(basename(p)) : /^herdr(-gpui)?$/.test(basename(p)))
      ?? all.find(p => (WIN ? /\.exe$/i : /^[^.]+$/).test(basename(p)) && !/remote/i.test(p))
  }
  const exes = OS === 'macos' ? [] : (() => { const all = []; const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (WIN ? /\.exe$/i.test(e.name) : !e.name.includes('.')) all.push(e.name) } }; walk(join(dir, 'x')); return all })()
  console.log(`herdr executables: ${exes.join(', ')}`)
  if (!exe) return record('herdr', 'launch', 'broken', { reason: `no executable found in ${asset.name} (${exes.join(', ')})` })
  // A third-party binary: run it with a bare environment (no token, no runner variables).
  const bare = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'DISPLAY', 'XDG_RUNTIME_DIR', 'LOCALAPPDATA', 'APPDATA'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
  // herdr-gpui has no --version (exit 2, "Unknown option"); --help proves the binary loads and runs here.
  const out = spawnSync(exe, ['--help'], { encoding: 'utf8', timeout: 20_000, env: bare })
  const text = `${out.stdout ?? ''} ${out.stderr ?? ''}`.trim().replace(/\s+/g, ' ').slice(0, 200)
  const ran = out.status === 0 || /usage: herdr/i.test(text)
  record('herdr', 'launch', ran ? 'works' : 'broken', { value: { exe: basename(exe), executables: exes, exit: out.status, signal: out.signal, error: out.error?.message }, reason: `${basename(exe)} --help (no daemon, so this proves only that the binary runs here): ${text || '(no output)'}` })
}

function runner() {
  record('runner', 'runner', 'info', { value: { arch: arch(), cpus: cpus().length, cpu: cpus()[0]?.model, memGB: Math.round(totalmem() / 1073741824), kernel: release(), node: process.version } })
}

// ---------- report ----------

function report() {
  const rows = readdirSync(opts.in).filter(n => n.endsWith('.jsonl')).flatMap(n => readFileSync(join(opts.in, n), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)))
  const oses = ['macos', 'linux', 'windows']
  const get = (shell, check, os) => rows.filter(r => r.shell === shell && r.check === check && r.os === os).at(-1)
  const cell = (r) => {
    if (!r) return '— (no result)'
    if (r.result === 'works') return '**works**'
    return `**${r.result}**: ${r.reason.replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 220)}`
  }
  const steps = [
    ['1. Build', 'build'], ['2. DSH page loads (warm launch)', 'page'], ['2. DSH page loads (first launch)', 'page-first-launch'],
    ['3. 2 Bot views: isolated stores', 'views-isolated'], ['3. 2 Bot views: persistent stores', 'views-persistent'],
    ['4. Bot browser automation (CDP)', 'automation'], ['6. Package', 'package'], ['6. Signing', 'signing'],
  ]
  let md = '## Cross-OS matrix (generated)\n\n| Step | Shell | ' + oses.join(' | ') + ' |\n|---|---|' + oses.map(() => '---').join('|') + '|\n'
  for (const [label, check] of steps) for (const shell of ['electron', 'tauri']) md += `| ${label} | ${shell} | ${oses.map(os => cell(get(shell, check, os))).join(' | ')} |\n`
  md += `| 7. herdr-app build | herdr | ${oses.map(os => cell(get('herdr', 'build', os))).join(' | ')} |\n`
  md += `| 7. herdr-app binary runs (--help) | herdr | ${oses.map(os => cell(get('herdr', 'launch', os))).join(' | ')} |\n`
  const num = (shell, check, os, pick) => { const r = get(shell, check, os); try { return r?.value ? pick(r.value) : '—' } catch { return '—' } }
  md += '\n### Numbers\n\n| Number | Shell | ' + oses.join(' | ') + ' |\n|---|---|' + oses.map(() => '---').join('|') + '|\n'
  const numbers = [
    ['Cold start, warm launch: DSH ready / page (ms)', 'cold-start', v => `${v.warm.dshReadyMs} / ${v.warm.pageInMs ?? v.warm.loadMs} (content ${v.warm.contentSeenMs ?? v.warm.visibleMs})`],
    ['Cold start, first launch: DSH ready / page (ms)', 'cold-start', v => `${v.first.dshReadyMs} / ${v.first.pageInMs ?? v.first.loadMs}`],
    ['Idle RSS total / without DSH / DSH (MB)', 'idle-rss', v => `${v.totalMB} / ${v.withoutDshMB} / ${v.dshMB}`],
    ['RSS with 2 Bot views (MB)', 'rss-2-views', v => `${v.totalMB} / ${v.withoutDshMB} / ${v.dshMB}`],
    ['Shell bundle (MB)', 'bundle-size', v => v.files.map(f => `${f.name} ${f.MB}`).join('; ') + (v.runtimeAndProfileMB ? `; runtime+profile ${v.runtimeAndProfileMB}` : '')],
    ['Installers (MB)', 'installers', v => v.files.map(f => `${f.name} ${f.MB}`).join('; ')],
  ]
  for (const [label, check, pick] of numbers) for (const shell of ['electron', 'tauri']) md += `| ${label} | ${shell} | ${oses.map(os => num(shell, check, os, pick)).join(' | ')} |\n`
  md += `| Runner | — | ${oses.map(os => num('runner', 'runner', os, v => `${v.arch}, ${v.cpus} CPU, ${v.memGB} GB`)).join(' | ')} |\n`
  md += `| Versions | electron | ${oses.map(os => num('electron', 'version', os, v => `app ${v.app}, Electron ${v.electron}`)).join(' | ')} |\n`
  writeFileSync(opts.out, md)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md)
  console.log(md)
}

const commands = {
  'electron-app': electronApp, 'electron-smoke': electronSmoke, 'tauri-app': tauriApp, size: sizes, herdr, runner, report,
  record: () => record(opts.shell, opts.check, opts.result, { value: opts.value ? (() => { try { return JSON.parse(opts.value) } catch { return opts.value } })() : null, reason: opts.reason ?? '' }),
}
if (!commands[command]) { console.error(`unknown command ${command}`); process.exit(2) }
try {
  await commands[command]()
} catch (error) {
  const shell = command.startsWith('electron') ? 'electron' : command.startsWith('tauri') ? 'tauri' : command
  record(shell, `${command}-crashed`, 'broken', { reason: error.stack ?? String(error) })
  process.exitCode = 1
}
// Child pipes, servers and timers must not keep the harness alive.
setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref()
