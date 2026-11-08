// Windows terminals pass argv through C-runtime quoting. Let Node receive ordinary arguments,
// then use its cmd.exe shell support once, preserving the attached terminal's input/output.
// No client command is accepted: the caller supplies an allowlisted agent and its host CLI.
import { spawn } from 'node:child_process'
import { AGENTS } from './agents.js'
import { batchSafe } from './batch-spawn.js'

const [key, cli] = process.argv.slice(2)
const spec = Object.values(AGENTS).find(agent => agent.key === key)
if (!spec || !cli || process.argv.length !== 4) throw new Error('Unknown coding-agent login command')
const child = spawn(...batchSafe(cli, spec.loginArgs, { stdio: 'inherit', env: process.env, windowsHide: true }))
child.once('error', () => { console.error('The coding-agent sign-in command could not start.'); process.exitCode = 1 })
child.once('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal)
})
