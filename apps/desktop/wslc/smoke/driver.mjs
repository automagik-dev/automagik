// Electron's side of the launcher's framed stdio, as a test plays it: the launcher's tests run
// dsh-launch as a child process, the CI smoke runs it with `docker exec -i`, and both drive it
// through this. It answers the Bot team's browser-endpoint request as main.js answerDsh does
// (with a relay URL on RELAY_PORT and TOKEN), and stands in for the relay at the far end of each
// tunnel: a connection that says "hello <token>" hears "relay <token>" back.
import { FrameReader, encode } from '../lib/frame.mjs'
import { maskSecrets } from './redact.mjs'

export const TOKEN = 'ab'.repeat(32)
export const RELAY_PORT = 9222
export const RELAY_URL = `ws://127.0.0.1:${RELAY_PORT}/devtools/browser/${TOKEN}`

export class FakeElectron {
  constructor(child) {
    this.child = child
    this.frames = []
    this.stderr = ''
    this.tunnels = new Map()
    this.protocolError = null
    this.#waiters = new Set()
    this.exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal, at: Date.now() })))
    const reader = new FrameReader(frame => this.#take(frame), (error) => { this.protocolError = error })
    child.stdout.on('data', chunk => reader.push(chunk))
    child.stderr.on('data', (chunk) => { this.stderr += chunk.toString('utf8') })
    child.stdin.on('error', () => {})
  }

  #waiters

  #take(frame) {
    this.frames.push(frame)
    if (frame.type === 'ipc' && frame.message?.type === 'ds-bot:browser-endpoint') {
      this.send({ type: 'ipc', message: { type: 'ds-bot:browser-endpoint-response', id: frame.message.id, url: RELAY_URL } })
    }
    if (frame.type === 'tunnel' && frame.op === 'open') this.tunnels.set(frame.id, { port: frame.port, host: frame.host, text: '' })
    if (frame.type === 'tunnel' && frame.op === 'data') {
      const tunnel = this.tunnels.get(frame.id)
      if (tunnel) {
        tunnel.text += Buffer.from(frame.data, 'base64').toString('utf8')
        const end = tunnel.text.indexOf('\n')
        if (end !== -1 && tunnel.text.startsWith('hello ')) {
          this.send({ type: 'tunnel', op: 'data', id: frame.id, data: Buffer.from(`relay ${tunnel.text.slice(6, end)}\n`).toString('base64') })
          tunnel.text = tunnel.text.slice(end + 1)
        }
      }
    }
    for (const waiter of [...this.#waiters]) waiter()
  }

  send(frame) {
    this.child.stdin.write(encode(frame))
  }

  /** The first frame `test` accepts, once it has come; rejects after `ms`. */
  waitFor(test, ms = 15_000, what = 'a frame') {
    return new Promise((resolve, reject) => {
      const look = () => {
        const found = this.frames.find(test)
        if (!found) return false
        this.#waiters.delete(look)
        clearTimeout(timer)
        resolve(found)
        return true
      }
      const timer = setTimeout(() => {
        this.#waiters.delete(look)
        // This message reaches the smoke's public log and its run summary through the FAIL line,
        // and both parts carry the token: a `ready` frame's URL and stderr's launch line. Mask each
        // part before its 2000-character cut: masking the cut would drop the key (`token=` or
        // `/devtools/browser/`) and leave the value unmatched, while a cut of the masked text can
        // only clip a `[redacted]` placeholder, never the token.
        const frames = maskSecrets(JSON.stringify(this.frames)).slice(-2000)
        const stderr = maskSecrets(this.stderr).slice(-2000)
        reject(new Error(`no ${what} within ${ms} ms; frames: ${frames}; stderr: ${stderr}`))
      }, ms)
      if (!look()) this.#waiters.add(look)
    })
  }

  /** An ipc message from DSH of `type`, once it has come. */
  ipc(type, ms) {
    return this.waitFor(frame => frame.type === 'ipc' && frame.message?.type === type, ms, `ipc ${type}`).then(frame => frame.message)
  }

  /** Closes the launcher's stdin; answers how it exited and how long after the close it took. */
  async close() {
    const at = Date.now()
    this.child.stdin.end()
    const { code, signal, at: end } = await this.exited
    return { code, signal, ms: end - at }
  }
}
