// Links out of the guest (RFC 0016, "Links out and sign-in callbacks"). `xdg-open` and $BROWSER
// in the image are the shim bin/xdg-open.mjs: it hands the URL to the launcher over a Unix
// socket, and the launcher asks Electron to open it with an `open` frame. Only https: URLs go:
// Electron opens them in the default browser on Windows, so nothing else may reach it.
import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'

export const MAX_URL = 8 * 1024
// A runaway program must not flood the person's browser: at most this many opens a minute.
export const OPENS_PER_MINUTE = 10
const MAX_REQUEST = 16 * 1024
const REQUEST_MS = 5_000
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Where the launcher listens for the shim: `run/open.sock` in the app's home, unless overridden. */
export const openSocketOf = (home, env = process.env) => env.AUTOMAGIK_OPEN_SOCKET?.trim() || join(home, 'run', 'open.sock')

/**
 * Whether `url` may be opened: a string of at most MAX_URL characters that parses as an https:
 * URL with a host and no user name or password (`https://bank.example@evil.example` reads as
 * the first host to a person and goes to the second). Answers { ok, url } with the parsed URL,
 * or { ok: false, reason }.
 */
export function openPolicy(url) {
  if (typeof url !== 'string' || url === '') return { ok: false, reason: 'no URL' }
  if (url.length > MAX_URL) return { ok: false, reason: `a URL longer than ${MAX_URL} characters` }
  let parsed
  try { parsed = new URL(url) } catch { return { ok: false, reason: 'not a URL' } }
  if (parsed.protocol !== 'https:') return { ok: false, reason: `only https: URLs open, not ${parsed.protocol}` }
  if (parsed.hostname === '') return { ok: false, reason: 'a URL with no host' }
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'a URL with a user name or password' }
  return { ok: true, url: parsed.href }
}

/**
 * The guest port a sign-in's browser flow comes back to, when its `redirect_uri` names this
 * machine's loopback (`http://localhost:<port>/callback`): the port a reverse tunnel would carry
 * (deferred to delivery 3; the `open` frame reports it). Null otherwise.
 */
export function callbackPortOf(url) {
  try {
    const redirect = new URL(new URL(url).searchParams.get('redirect_uri') ?? '')
    if (!LOOPBACK.has(redirect.hostname) || redirect.port === '') return null
    const port = Number(redirect.port)
    return port >= 1 && port <= 65535 ? port : null
  } catch {
    return null
  }
}

/** A sliding one-minute window: `take()` answers whether one more open fits. */
export function openBudget(limit = OPENS_PER_MINUTE, now = Date.now) {
  const times = []
  return {
    take() {
      const at = now()
      while (times.length > 0 && at - times[0] >= 60_000) times.shift()
      if (times.length >= limit) return false
      times.push(at)
      return true
    },
  }
}

/**
 * Listen on the Unix socket `path` for the shim. Each connection sends one JSON line,
 * `{"url": "..."}`, and gets one back: `{"ok": true}` once `onOpen(url)` took it, or
 * `{"ok": false, "error": "..."}`. Its folder, when made here, is private to the guest user; a
 * socket left by an earlier launcher is replaced. Resolves with the server once it listens.
 */
export function listenForOpens(path, { onOpen, budget = openBudget() }) {
  // A folder made here is the guest user's alone; one that exists is left as it is.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  rmSync(path, { force: true })
  const server = createServer((socket) => {
    let text = ''
    const answer = (reply) => {
      socket.end(`${JSON.stringify(reply)}\n`)
    }
    socket.setTimeout(REQUEST_MS, () => socket.destroy())
    socket.on('error', () => {})
    socket.on('data', (chunk) => {
      text += chunk.toString('utf8')
      if (text.length > MAX_REQUEST) return answer({ ok: false, error: 'the request is too long' })
      const end = text.indexOf('\n')
      if (end === -1) return
      socket.removeAllListeners('data')
      let url
      try { url = JSON.parse(text.slice(0, end)).url } catch { return answer({ ok: false, error: 'the request is not JSON' }) }
      const verdict = openPolicy(url)
      if (!verdict.ok) return answer({ ok: false, error: verdict.reason })
      if (!budget.take()) return answer({ ok: false, error: `more than ${OPENS_PER_MINUTE} links a minute` })
      try {
        onOpen(verdict.url)
        answer({ ok: true })
      } catch (error) {
        answer({ ok: false, error: String(error?.message ?? error) })
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      try { chmodSync(path, 0o600) } catch {}
      resolve(server)
    })
  })
}
