#!/usr/bin/env node
// C2.1 is opt-in and has no network sign-in/claim endpoint yet.
import { createGate, pinOrigin } from './gate.mjs'
import { readOwner, SessionStore } from './gate-store.mjs'
import { DshCredentials, DSH_HOST } from './gate-upstream.mjs'

try {
  if (process.env.AUTOMAGIK_GATE_ENABLED !== '1') throw new Error('Gate disabled; C2.2/C2.3 will provide sign-in')
  const origin = pinOrigin(process.env.AUTOMAGIK_GATE_ORIGIN)
  const port = Number(process.env.AUTOMAGIK_GATE_PORT || 3082)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 3081) throw new Error('Invalid gate port')
  const dir = process.env.AUTOMAGIK_GATE_HOME || '/data'
  const owner = readOwner(dir)
  const sessions = new SessionStore(dir)
  // No owner means no session. Unknown owner formats already stopped startup above.
  if (!owner) sessions.revokeAll()
  const credentials = new DshCredentials({ launchFile: '/dsh/dsh/launch-url' })
  const server = createGate({ origin: origin.origin, sessions, credentials })
  // Remains loopback-only until C2.2's claim or C2.3's Cloud configuration lands.
  server.listen(port, DSH_HOST, () => console.log('automagik-gate: listening on loopback'))
  server.on('error', () => { console.error('automagik-gate: listener failed'); process.exitCode = 1 })
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.closeGate())
} catch {
  // Never echo config, credentials, a URL, an owner record or a session into container logs.
  console.error('automagik-gate: disabled or invalid configuration/state; see server/README.md')
  process.exitCode = 1
}
