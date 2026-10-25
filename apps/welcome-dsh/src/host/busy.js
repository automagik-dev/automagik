// Whether any of dsh's agents is at work, for the Automagik desktop app: it installs an update
// while the person is away only when none is (apps/desktop src/idle.js). The app names the file
// in AUTOMAGIK_BUSY_FILE and reads it; without that name this does nothing. The file holds
// { running, at }: how many agents run, and when that last changed.
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
  const save = () => {
    try {
      write(file, `${JSON.stringify({ running: running.size, at: now() })}\n`)
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
  save()
}
