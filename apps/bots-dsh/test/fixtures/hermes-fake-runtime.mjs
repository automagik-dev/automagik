// A fake executable: prints upstream's help/ready shapes and sleeps, never serves a port.
import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
const args = process.argv.slice(2)
const scenario = process.env.HERMES_SSH_SCENARIO
const record = fields => appendFileSync(process.env.HERMES_SSH_RECORD, `${JSON.stringify({ role: 'runtime', pid: process.pid, ...fields })}\n`, { mode: 0o600 })
if (args.includes('--help')) {
  record({ event: 'probe', args })
  console.log(scenario === 'runtime-old' ? 'serve' : 'serve --ssh-session-token-file --ssh-owner-nonce')
} else {
  const tokenPath = args[args.indexOf('--ssh-session-token-file') + 1]
  const token = readFileSync(tokenPath, 'utf8')
  record({ event: 'runtime-start', args, tokenMode: statSync(tokenPath).mode & 0o777, tokenHash: createHash('sha256').update(token).digest('hex') })
  // Private child output must be swallowed by the supervisor, not forwarded or logged.
  console.log(`private-output ${token}`)
  if (scenario.startsWith('runtime-leader-exits')) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { appendFileSync } from 'node:fs';
      const record = event => appendFileSync(process.env.HERMES_SSH_RECORD, JSON.stringify({ role: 'descendant', pid: process.pid, event }) + '\\n');
      process.on('SIGTERM', () => record('descendant-term'));
      record('descendant-start'); process.send('ready'); setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    await new Promise(resolve => child.once('message', resolve))
    child.disconnect()
  }
  console.log(`HERMES_DASHBOARD_READY port=${process.env.HERMES_SSH_REMOTE_PORT}`)
  process.on('SIGTERM', () => { if (scenario !== 'runtime-ignore-term') { record({ event: 'runtime-stop' }); process.exit(0) } })
  setInterval(() => {}, 1000)
}
