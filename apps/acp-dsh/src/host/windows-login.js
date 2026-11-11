// Windows login ownership: a Job Object outlives a .cmd wrapper and owns its descendants.
// The supervisor starts the vendor suspended, assigns the job, then resumes it. Raw stdio
// remains the vendor's protocol. No process exit authorizes an auth change without job proof.
import { execFile, spawn as spawnProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { batchSafe } from './batch-spawn.js'

const SUPERVISOR = fileURLToPath(new URL('./windows-login.ps1', import.meta.url))
const failed = () => new Error('The complete sign-in process tree could not be stopped.')
const read = (env, key) => Object.entries(env).find(([name]) => (
  name.toLowerCase() === key.toLowerCase()
))?.[1]

// The Windows CRT argument rule, for a native CreateProcess call (not shell escaping).
const nativeArg = value => `"${String(value).replace(/(\\*)"/g, '$1$1\\"')
  .replace(/(\\+)$/, '$1$1')}"`

export function windowsLoginCommand(file, args, env) {
  if (/\.(cmd|bat)$/i.test(file)) {
    const [command, quoted] = batchSafe(file, args, {}, 'win32')
    const shell = read(env, 'ComSpec') ?? 'cmd.exe'
    return { executable: shell,
      line: `${nativeArg(shell)} /d /s /c "${[command, ...quoted].join(' ')}"` }
  }
  return { executable: file, line: [file, ...args].map(nativeArg).join(' ') }
}

export function launchWindowsLogin(file, args, options = {}, {
  spawn = spawnProcess, taskkill = execFile, stopMs = 5000,
} = {}) {
  const directory = mkdtempSync(join(options.cwd ?? tmpdir(), '.login-job-'))
  const stopFile = join(directory, 'stop')
  const doneFile = join(directory, 'done')
  const nonce = randomUUID()
  const env = options.env ?? process.env
  const request = { ...windowsLoginCommand(file, args, env), cwd: options.cwd,
    stop: stopFile, done: doneFile, nonce, parent: process.pid,
    challenge: join(directory, 'challenge'), acknowledge: join(directory, 'acknowledge') }
  const system = read(env, 'SystemRoot') ?? 'C:\\Windows'
  const powershell = win32.join(system, 'System32', 'WindowsPowerShell', 'v1.0',
    'powershell.exe')
  let child
  try {
    child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-File', SUPERVISOR], {
      ...options, shell: false, windowsHide: true,
      env: { ...env, AUTOMAGIK_LOGIN_JOB: JSON.stringify(request) },
    })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
  let verified = false
  let closed = false
  let spawnFailed = false
  let stopping
  // A handle opened from a PID could otherwise belong to a process that reused it during
  // PowerShell startup. Only this live app knows to answer its fresh private challenge.
  const parentWatch = setInterval(() => {
    try {
      if (readFileSync(request.challenge, 'utf8') !== nonce) return
      const staged = `${request.acknowledge}.tmp`
      writeFileSync(staged, nonce, { mode: 0o600 })
      renameSync(staged, request.acknowledge)
      clearInterval(parentWatch)
    } catch {}
  }, 20)
  parentWatch.unref?.()
  const dispose = () => {
    clearInterval(parentWatch)
    if (verified) try { rmSync(directory, { recursive: true, force: true }) } catch {}
  }
  const done = new Promise((resolve, reject) => {
    child.once('error', () => {
      // spawn failed: no supervisor or vendor process exists.
      if (child.pid === undefined) {
        spawnFailed = verified = true
        dispose()
        resolve()
        return
      }
      reject(failed())
    })
    child.once('close', () => {
      clearInterval(parentWatch)
      closed = true
      if (spawnFailed) return
      try { verified = readFileSync(doneFile, 'utf8') === nonce } catch {}
      if (!verified) { reject(failed()); return }
      resolve()
    })
  })
  done.catch(() => {})
  const stop = () => {
    if (verified) return Promise.resolve()
    if (stopping) return stopping
    stopping = (async () => {
      writeFileSync(stopFile, '', { mode: 0o600 })
      let timer
      try {
        await Promise.race([done, new Promise((_, reject) => {
          timer = setTimeout(() => reject(failed()), stopMs)
        })])
      } catch {
        // This also closes the kill-on-close Job handle. Without a proof, remain paused.
        if (!closed && child.exitCode === null && child.signalCode === null
          && Number.isInteger(child.pid) && child.pid > 1) {
          await new Promise(resolve => {
            try {
              taskkill('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
                windowsHide: true, timeout: 3000,
              }, () => resolve())
            } catch { resolve() }
          })
        }
        if (!verified) throw failed()
      } finally { clearTimeout(timer) }
    })().finally(() => { stopping = undefined })
    return stopping
  }
  return { child, done, stop, dispose,
    identity: { kind: 'windows', supervisor: child.pid,
      directory: basename(directory), nonce } }
}
