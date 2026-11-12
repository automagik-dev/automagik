// A fake executable: prints upstream's help/ready shapes and sleeps, never serves a port.
import { appendFileSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
const args = process.argv.slice(2)
const scenario = process.env.HERMES_SSH_SCENARIO
const record = fields => appendFileSync(process.env.HERMES_SSH_RECORD, `${JSON.stringify({ role: 'runtime', pid: process.pid, ...fields })}\n`, { mode: 0o600 })
if (args.includes('--help')) {
  record({ event: 'probe', args })
  console.log(scenario === 'runtime-old' ? 'serve' : 'serve --ssh-session-token-file --ssh-owner-nonce')
} else {
  const tokenPath = args[args.indexOf('--ssh-session-token-file') + 1]
  // Upstream's own rules for the token file (hermes_cli/main_dashboard.py): an absolute path
  // under ~/.hermes/desktop-ssh/<32 hex>/<16 hex>.token, its folder 0700, the file 64 bytes
  // and private; any other path ends serve before it is ready. The token is removed once read.
  const refuse = message => { console.error(message); process.exit(1) }
  const parts = relative(join(process.env.HOME, '.hermes', 'desktop-ssh'), tokenPath).split(sep)
  if (!isAbsolute(tokenPath) || parts.length !== 2 || !/^[0-9a-f]{32}$/.test(parts[0])) refuse('--ssh-session-token-file must be under the desktop-ssh directory')
  if (!/^[0-9a-f]{16}\.token$/.test(parts[1])) refuse('--ssh-session-token-file has an invalid filename')
  const folderMode = statSync(dirname(tokenPath)).mode & 0o777, tokenMode = statSync(tokenPath).mode & 0o777
  if (folderMode !== 0o700) refuse('--ssh-session-token-file parent has unsafe permissions')
  if (tokenMode & ~0o600) refuse('--ssh-session-token-file has unsafe permissions')
  if (statSync(tokenPath).size !== 64) refuse('--ssh-session-token-file contains an invalid token')
  const token = readFileSync(tokenPath, 'utf8')
  unlinkSync(tokenPath)
  record({ event: 'runtime-start', args, tokenMode, folderMode, tokenHash: createHash('sha256').update(token).digest('hex') })
  // Private child output must be swallowed by the supervisor, not forwarded or logged.
  console.log(`private-output ${token}`)
  if (scenario === 'runtime-exit-early') {
    // A start that fails: its last lines name the token, the nonce and a home path.
    console.log(`sample start failure for nonce ${args[args.indexOf('--ssh-owner-nonce') + 1]}`)
    console.log('\u001b[31mcould not read /home/sample-person/.hermes/config.yaml\u001b[0m')
    // The remote home is whatever it is there: only the remote side knows to shorten it.
    console.log(`sample cache at ${homedir()}/.cache/sample`)
    process.exit(3)
  }
  if (scenario === 'runtime-never-ready') { console.log('sample server still loading'); setInterval(() => {}, 1000); await new Promise(() => {}) }
  if (scenario === 'runtime-bad-port') { console.log('HERMES_DASHBOARD_READY port=99999'); setInterval(() => {}, 1000); await new Promise(() => {}) }
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
