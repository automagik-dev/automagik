// SPIKE harness (throwaway): why does apps/desktop's browser-smoke.mjs "a crashed page drops the
// connection and loads again" fail on Linux only? Run as Electron's main script:
//
//   electron [chromium switches] crash-probe.mjs
//
// One Bot-like view (a WebContentsView in a persist partition, sandboxed, as bot-views.js makes
// them) is crashed three ways, one at a time, each on a fresh page: forcefullyCrashRenderer()
// (what the smoke test does), CDP Page.crash through debugger.attach, and SIGKILL to the
// renderer's pid. For each it records whether the renderer process really went, whether and
// when `render-process-gone` fired (bot-views.js drops the relay and reloads on it), and whether
// a reload then loads. Prints one JSON line per trial, prefixed "PROBE ".
import { app, BrowserWindow, WebContentsView } from 'electron'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

app.setPath('userData', mkdtempSync(join(tmpdir(), 'crash-probe-')))
const out = (kind, value) => console.log(`PROBE ${JSON.stringify({ kind, ...value })}`)
const delay = ms => new Promise(r => setTimeout(r, ms))
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const userNs = (pid) => { try { return readlinkSync(`/proc/${pid}/ns/user`) } catch { return null } }
const state = (pid) => { try { return readFileSync(`/proc/${pid}/status`, 'utf8').match(/^State:\s+(.*)$/m)?.[1] ?? null } catch { return null } }

const server = createServer((request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>${request.url.slice(1) || 'home'}</title><body>${request.url}</body>`))
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

await app.whenReady()
out('env', {
  platform: process.platform, electron: process.versions.electron, argv: process.argv.slice(1).filter(a => a.startsWith('--')),
  display: process.env.DISPLAY ?? null, wayland: process.env.WAYLAND_DISPLAY ?? null, ozone: app.commandLine.getSwitchValue('ozone-platform') || null,
  noSandbox: app.commandLine.hasSwitch('no-sandbox'), mainUserNs: userNs(process.pid),
})
const window = new BrowserWindow({ width: 900, height: 700, show: true })
const view = new WebContentsView({ webPreferences: { partition: 'persist:crash-probe', sandbox: true, contextIsolation: true, nodeIntegration: false } })
window.contentView.addChildView(view)
view.setBounds({ x: 0, y: 0, width: 900, height: 700 })
const contents = view.webContents
const gone = []
contents.on('render-process-gone', (_e, details) => gone.push({ at: Date.now(), ...details }))
app.on('child-process-gone', (_e, details) => out('child-process-gone', details))

const loaded = (url, timeout = 15_000) => Promise.race([
  contents.loadURL(url).then(() => true, e => `load error ${e.code ?? e.message}`),
  delay(timeout).then(() => 'load timeout'),
])

const methods = {
  forcefullyCrashRenderer: async () => contents.forcefullyCrashRenderer(),
  'cdp Page.crash': async () => {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    await contents.debugger.sendCommand('Page.crash').catch(() => {})
  },
  'SIGKILL renderer': async () => process.kill(contents.getOSProcessId(), 'SIGKILL'),
}

for (const [method, crash] of Object.entries(methods)) {
  const page = `${base}before-${method.replace(/\W+/g, '-')}`
  const first = await loaded(page)
  const pid = contents.getOSProcessId()
  const before = { pid, userNs: userNs(pid), state: state(pid), title: contents.getTitle() }
  gone.length = 0
  const t0 = Date.now()
  let error = null
  await crash().catch(e => { error = e.message })
  let event = null
  for (const end = t0 + 30_000; Date.now() < end && !(event = gone[0]);) await delay(50)
  const after = { alive: alive(pid), state: state(pid), crashedFlag: contents.isCrashed() }
  // What bot-views.js does on the event: reload. Done here even without the event, to see
  // whether the page can come back at all.
  const reload = await Promise.race([
    new Promise(r => { contents.once('did-finish-load', () => r(true)); contents.reload() }),
    delay(15_000).then(() => 'reload timeout'),
  ])
  out('trial', {
    method, firstLoad: first, before, error,
    event: event ? { afterMs: event.at - t0, reason: event.reason, exitCode: event.exitCode } : null,
    after, reload, titleAfter: contents.getTitle(), newPid: contents.getOSProcessId(),
  })
  if (contents.debugger.isAttached()) try { contents.debugger.detach() } catch {}
}
server.close()
app.exit(0)
