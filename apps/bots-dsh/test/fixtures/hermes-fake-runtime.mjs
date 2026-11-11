// A fake executable: prints upstream's help/ready shapes and sleeps, never serves a port.
import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
  console.log(`HERMES_DASHBOARD_READY port=${process.env.HERMES_SSH_REMOTE_PORT}`)
  process.on('SIGTERM', () => { if (scenario !== 'runtime-ignore-term') { record({ event: 'runtime-stop' }); process.exit(0) } })
  setInterval(() => {}, 1000)
}
