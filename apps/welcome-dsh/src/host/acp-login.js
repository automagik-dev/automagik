// A user-owned login terminal, reached only by the account card's explicit Sign in button.
// This is not an agent terminal or a tool: its input/output never enters a conversation,
// logger, settings, or file. The CLI itself owns its account credentials.
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { delimiter, dirname } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import { parse } from './payloads.js'

export const LOGIN_COMMANDS = Object.freeze({
  'acp-claude': Object.freeze(['auth', 'login']),
  'acp-codex': Object.freeze(['login']),
})
export const LOGIN_LIFETIME_MS = 10 * 60 * 1000
export const LOGIN_MAX_TEXT = 32 * 1024
const Agent = z.enum(['acp-claude', 'acp-codex'])
const Terminal = z.string().uuid()
const Start = z.object({ id: Agent, cols: z.number().int().min(30).max(200).optional(), rows: z.number().int().min(6).max(60).optional() }).strict()
const Read = z.object({ terminal: Terminal, from: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).strict()
const Write = z.object({ terminal: Terminal, data: z.string().min(1).max(4096) }).strict()
const Resize = z.object({ terminal: Terminal, cols: z.number().int().min(30).max(200), rows: z.number().int().min(6).max(60) }).strict()
const Close = z.object({ terminal: Terminal }).strict()
const failure = (code, message) => Object.assign(new Error(message), { code: `omni-ai/${code}` })
const invalid = () => failure('invalid', 'Say which coding agent or sign-in terminal.')
const refused = message => failure('refused', message)
const service = (ctx, name) => { try { return ctx.get?.(name) } catch { return undefined } }

// ACP owns the selected CLI and platform-specific launch rules. In particular an external
// Windows codex.cmd needs ACP's quoted cmd.exe wrapper; a PTY cannot execute that batch file.
// Older ACPs can still launch native executables, but never guess how to quote a batch file.
async function loginCommand(acp, id, env) {
  if (typeof acp.loginCommand === 'function') {
    const command = await acp.loginCommand(id)
    if (!Array.isArray(command?.argv) || command.argv.length === 0 || command.argv.some(arg => typeof arg !== 'string' || arg === '' || arg.includes('\0'))) {
      throw refused('The coding agent could not prepare its sign-in command. Update the coding agents plugin.')
    }
    return { argv: command.argv, env: command.env ?? {} }
  }
  const cli = await acp.cliPath(id)
  if (typeof cli !== 'string' || cli === '') throw refused('The coding agent is still installing. Try signing in when it is ready.')
  if (/\.(cmd|bat)$/i.test(cli)) throw refused('Update the coding agents plugin to sign in with this Windows CLI.')
  const cliEnv = await acp.cliEnv?.(id) ?? {}
  return { argv: [cli, ...LOGIN_COMMANDS[id]], env: { ...cliEnv, PATH: [dirname(cli), env.PATH].filter(Boolean).join(delimiter) } }
}

/** Bounded process-local account attempts; call dispose when the welcome plugin stops. */
export function createAcpLoginActions(ctx, { home = homedir(), env = process.env, timer = setTimeout, untimer = clearTimeout } = {}) {
  const attempts = new Map()
  let disposed = false
  const forget = (entry) => {
    untimer(entry.timer)
    attempts.delete(entry.terminal)
    entry.text = ''
  }
  const close = (entry) => {
    if (entry.closing) return entry.closing
    entry.cancelled = true
    entry.abort.abort()
    entry.closing = (async () => {
      await entry.opening?.catch(() => {})
      if (entry.handle) await entry.handle.terminate()
      forget(entry)
    })().catch(() => {
      entry.closing = null
      entry.status = 'failed'
      // Keep ownership so a subsequent close/disposal can retry. Never expose provider errors:
      // a subprocess failure can contain the person's input or an authorization URL.
      throw refused('The sign-in terminal could not close. Try closing it again.')
    })
    return entry.closing
  }
  const expire = (entry) => {
    void close(entry).catch(() => {
      entry.timer = timer(() => expire(entry), 5000)
      entry.timer?.unref?.()
    })
  }
  const append = (entry, text) => {
    if (!text || !attempts.has(entry.terminal)) return
    entry.nextOffset += text.length
    entry.text = (entry.text + text).slice(-LOGIN_MAX_TEXT)
    // Keep UTF-16 offsets, but never start a retained tail halfway through a character.
    if (/^[\uDC00-\uDFFF]/.test(entry.text)) entry.text = entry.text.slice(1)
  }
  const snapshot = (entry, from = 0) => {
    if (from > entry.nextOffset) throw invalid()
    const start = entry.nextOffset - entry.text.length
    return {
      terminal: entry.terminal, id: entry.id, status: entry.status,
      text: entry.text.slice(Math.max(0, from - start)), nextOffset: entry.nextOffset, lossy: from < start,
      ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
    }
  }
  const existing = (payload, schema) => {
    const asked = parse(schema, payload)
    if (!asked) throw invalid()
    const entry = attempts.get(asked.terminal)
    if (!entry || entry.cancelled) throw refused('This sign-in terminal has closed. Start signing in again.')
    return { asked, entry }
  }
  const actions = {
    'acp-login-start': async (payload, signal) => {
      const asked = parse(Start, payload)
      if (!asked) throw invalid()
      if (disposed) throw refused('The sign-in service has stopped.')
      const previous = [...attempts.values()].find(entry => entry.id === asked.id)
      if (previous) {
        if (!previous.cancelled && previous.status === 'running') {
          await previous.opening
          return snapshot(previous)
        }
        await close(previous)
      }
      const acp = service(ctx, 'acpAgents')
      const subprocess = service(ctx, 'subprocess')
      if ((typeof acp?.loginCommand !== 'function' && typeof acp?.cliPath !== 'function') || typeof subprocess?.spawnTerminal !== 'function') {
        throw refused('This DSH cannot open a coding-agent sign-in terminal. Update the coding agents plugin.')
      }
      const entry = { terminal: randomUUID(), id: asked.id, status: 'running', text: '', nextOffset: 0, abort: new AbortController() }
      attempts.set(entry.terminal, entry)
      const cancel = () => entry.abort.abort()
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
      entry.timer = timer(() => expire(entry), LOGIN_LIFETIME_MS)
      entry.timer?.unref?.()
      entry.opening = (async () => {
        try {
          const command = await loginCommand(acp, asked.id, env)
          if (disposed || entry.abort.signal.aborted) throw refused('The sign-in was cancelled.')
          entry.handle = await subprocess.spawnTerminal({
            ...command, cwd: home,
            rows: asked.rows ?? 12, cols: asked.cols ?? 80, terminalType: 'xterm-256color', graceMs: 1000,
            signal: entry.abort.signal,
          })
          if (disposed || entry.abort.signal.aborted) {
            await entry.handle.terminate()
            throw refused('The sign-in was cancelled.')
          }
          const decoder = new StringDecoder('utf8')
          const output = (async () => {
            for await (const bytes of entry.handle.output) append(entry, decoder.write(bytes))
            append(entry, decoder.end())
          })()
          // Drain the last output before declaring completion, so the UI can stop polling.
          void Promise.all([entry.handle.done, output]).then(([result]) => {
            entry.exitCode = result.exitCode
            entry.status = 'exited'
          }).catch(() => {
            entry.status = 'failed'
            void entry.handle.terminate().catch(() => {})
          })
        } catch (error) {
          if (!entry.handle) forget(entry)
          else entry.status = 'failed'
          if (error?.code?.startsWith('omni-ai/')) throw error
          throw refused('The sign-in terminal could not start. Check that the coding agent is installed and try again.')
        } finally {
          signal?.removeEventListener('abort', cancel)
        }
      })()
      await entry.opening
      return snapshot(entry)
    },
    'acp-login-read': (payload) => {
      const { asked, entry } = existing(payload, Read)
      return snapshot(entry, asked.from ?? 0)
    },
    'acp-login-write': async (payload) => {
      const { asked, entry } = existing(payload, Write)
      if (entry.status !== 'running' || !entry.handle) throw refused('The sign-in terminal is no longer accepting input.')
      try { await entry.handle.write(asked.data) } catch { throw refused('The sign-in terminal did not accept this input. Check its status and try again.') }
      return { accepted: true }
    },
    'acp-login-resize': async (payload) => {
      const { asked, entry } = existing(payload, Resize)
      if (entry.status !== 'running' || !entry.handle) throw refused('The sign-in terminal is no longer accepting input.')
      try { await entry.handle.resize(asked.cols, asked.rows) } catch { throw refused('The sign-in terminal could not resize. Check its status and try again.') }
      return { resized: true }
    },
    'acp-login-close': async (payload) => {
      const asked = parse(Close, payload)
      if (!asked) throw invalid()
      const entry = attempts.get(asked.terminal)
      if (entry) await close(entry)
      return { closed: true }
    },
  }
  return {
    actions,
    async dispose() {
      disposed = true
      await Promise.all([...attempts.values()].map(close))
    },
  }
}
