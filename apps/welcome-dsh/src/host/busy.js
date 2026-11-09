// Whether any of dsh's agents is at work, for the Automagik desktop app: it installs an update
// while the person is away only when none is (apps/desktop src/idle.js). The app names the file
// in AUTOMAGIK_BUSY_FILE and reads it; without that name this does nothing. The file holds
// { running, at }: how many agents run, and when that last changed.
//
// A Claude Code or Codex sign-in that is starting or waiting for the person (acp-dsh's
// login.js) counts as running too: a restart would kill the CLI holding the link or code the
// person is using on another device. acp-dsh announces the number at work
// (`acp-dsh/login-active`); a welcome that reloads mid-attempt reads it from the service. So
// the plugin lane's automatic apply and the app's update while away wait for the attempt to end
// or expire. The desktop app reads only `running`, so nothing changes there.
import { renameSync, writeFileSync } from 'node:fs'

function writeAtomic(file, text) {
  const next = `${file}.${process.pid}.tmp`
  writeFileSync(next, text)
  renameSync(next, file)
}

export function watchBusy(ctx, { env = process.env, write = writeAtomic, now = Date.now } = {}) {
  const file = env.AUTOMAGIK_BUSY_FILE?.trim()
  if (!file) return
  // The agents already at work when the welcome (re)loads, as DSH's agent registry lists them.
  const running = new Set((ctx.get?.('agents')?.list?.() ?? []).filter(agent => agent?.status === 'running').map(agent => agent.id))
  const count = value => (Number.isInteger(value) && value > 0 ? Math.min(value, 100) : 0)
  let logins = 0
  try { logins = count(ctx.get?.('acpAgents')?.loginActive?.()) } catch {}
  const save = () => {
    try {
      write(file, `${JSON.stringify({ running: running.size + logins, at: now() })}\n`)
    } catch (error) {
      ctx.logger?.warn?.('omni-ai: the busy file was not written: %s', error?.message ?? error)
    }
  }
  ctx.on('agent/status', ({ agent, status }) => {
    const was = running.size
    if (status === 'running') running.add(agent.id)
    else running.delete(agent.id)
    if (running.size !== was) save()
  })
  ctx.on('agent/disposed', ({ agent }) => {
    if (running.delete(agent.id)) save()
  })
  ctx.on('acp-dsh/login-active', (payload) => {
    const next = count(payload?.active)
    if (next === logins) return
    logins = next
    save()
  })
  save()
}
