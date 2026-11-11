// Executed only as a disposable executable named ssh by hermes-ssh.test.js.
// It never opens a socket or runs an SSH client/Hermes installation.
import { appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
const args = process.argv.slice(2)
const scenario = process.env.HERMES_SSH_SCENARIO || 'ready'
const role = args.includes('-N') ? 'tunnel' : 'supervisor'
const record = fields => appendFileSync(process.env.HERMES_SSH_RECORD, `${JSON.stringify({ role, pid: process.pid, ...fields })}\n`, { mode: 0o600 })
record({ event: 'spawn', args })
// The fake app-exit test closes the parent's stdout reader before remote cleanup.
process.stdout.on('error', () => {})
let nonce, runtime, closed = false, received = ''
const emit = frame => process.stdout.write(`${JSON.stringify({ nonce, ...frame })}\n`)
const finish = () => {
  if (closed || scenario === 'ignore-close') return
  if (runtime) { runtime.stdin.end(); return }
  closed = true
  record({ event: 'closed' })
  if (role === 'supervisor' && nonce) emit({ type: 'closed', clean: scenario !== 'unclean' })
  process.exit(0)
}
process.on('SIGTERM', finish)
if (['host-key', 'changed-key', 'auth', 'auth-delayed', 'interactive', 'unreachable'].includes(scenario)) {
  process.stderr.write({ 'host-key': 'No host key is known and you have requested strict checking. Host key verification failed.', 'changed-key': 'REMOTE HOST IDENTIFICATION HAS CHANGED!', auth: 'Permission denied (publickey).', 'auth-delayed': 'Permission denied (publickey).', interactive: 'interactive verification required', unreachable: 'Could not resolve hostname' }[scenario])
  if (scenario === 'auth-delayed') { process.stdin.destroy(); setTimeout(() => process.exit(255), 50) }
  else process.exit(255)
}
if (role === 'tunnel') {
  if (scenario === 'tunnel-failure') { process.stderr.write('forwarding failed: address already in use'); process.exit(255) }
  const spec = args[args.indexOf('-L') + 1]
  const port = Number(spec.split(':')[1])
  process.stderr.write(`debug1: Local forwarding listening on 127.0.0.1 port ${port}.\n`)
} else if (scenario.startsWith('runtime-')) {
  // Execute only Automagik's supervisor against an explicit disposable fake Hermes.
  // No upstream code, real SSH client or network listener is involved.
  runtime = spawn('/bin/sh', ['-c', args.at(-1)], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
  process.stdin.pipe(runtime.stdin)
  runtime.stdout.pipe(process.stdout)
  runtime.stderr.pipe(process.stderr)
  runtime.stdin.on('error', () => {})
  runtime.on('error', () => process.exit(1))
  runtime.on('close', code => { record({ event: 'closed' }); process.exit(code ?? 1) })
} else {
  process.stdin.on('data', chunk => {
    received += String(chunk)
    let newline
    while ((newline = received.indexOf('\n')) >= 0) {
      const line = received.slice(0, newline); received = received.slice(newline + 1)
      if (!nonce) {
        const options = JSON.parse(line)
        nonce = options.nonce
        record({ event: 'input', hermesPath: options.hermesPath, startMs: options.startMs, controlMs: options.controlMs, cancelMs: options.cancelMs })
        if (scenario === 'missing') { emit({ type: 'error', code: 'hermes-not-found' }); finish(); return }
        if (scenario === 'old-contract') { emit({ type: 'error', code: 'update-required' }); finish(); return }
        if (scenario === 'wrong-nonce') { emit({ type: 'ready', nonce: 'unrelated', port: Number(process.env.HERMES_SSH_REMOTE_PORT) }); return }
        if (scenario === 'bad-frame') { process.stdout.write(`${JSON.stringify({ nonce, type: 'ready', port: options.credential })}\n`); return }
        if (scenario === 'oversized') { process.stdout.write(options.credential.repeat(2048)); return }
        if (scenario !== 'timeout') {
          process.stdout.write('A sample login banner\n')
          emit({ type: 'ready', port: Number(process.env.HERMES_SSH_REMOTE_PORT) })
          if (scenario === 'drop') setTimeout(() => process.exit(255), 150)
        }
      } else if (line === 'close') { finish() }
    }
  })
  process.stdin.on('end', finish)
}
setInterval(() => {}, 1000)
