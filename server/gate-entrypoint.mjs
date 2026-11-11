#!/usr/bin/env node
// Access and self-hosted passkey sign-in are independent; both keep DSH behind the gate.
import { accessConfig, AccessConfigurationError, AccessSignIn } from './gate-access.mjs'
import { createGate, pinOrigin } from './gate.mjs'
import { writeFileSync } from 'node:fs'
import { controlServer } from './gate-control.mjs'
import { readOwner, SessionStore } from './gate-store.mjs'
import { DshCredentials, DSH_HOST } from './gate-upstream.mjs'

let claimErrors, control, server, bootstrap
try {
  const config = accessConfig(process.env)
  if (process.env.AUTOMAGIK_GATE_ENABLED !== '1') throw new Error('Gate disabled')
  let SelfHostedClaim, passkeyOrigin
  if (!config) { ({ SelfHostedClaim, passkeyOrigin, ClaimConfigurationError: claimErrors } = await import('./gate-claim.mjs')) }
  const origin = config ? pinOrigin(process.env.AUTOMAGIK_GATE_ORIGIN) : passkeyOrigin(process.env.AUTOMAGIK_GATE_ORIGIN)
  const port = Number(process.env.AUTOMAGIK_GATE_PORT || 3082)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 3081) throw new Error('Invalid gate port')
  const dir = process.env.AUTOMAGIK_GATE_HOME || '/data'
  const owner = readOwner(dir)
  const sessions = new SessionStore(dir)
  // No owner means no session. Unknown owner formats already stopped startup above.
  if (!owner) sessions.revokeAll()
  const credentials = new DshCredentials({ launchFile: '/dsh/dsh/launch-url' })
  const access = config ? new AccessSignIn(config, { ownerDir: dir }) : undefined
  const selfHosted = config ? undefined : new SelfHostedClaim({ dir, origin: origin.origin, sessions, claimMode: process.env.AUTOMAGIK_GATE_CLAIM ?? 'local' })
  const published = process.env.AUTOMAGIK_GATE_HOST || DSH_HOST
  if (!config && ![DSH_HOST, '0.0.0.0'].includes(published)) throw new claimErrors('AUTOMAGIK_GATE_HOST must be loopback or the IPv4 wildcard bind address')
  server = createGate({ origin: origin.origin, sessions, credentials, access, selfHosted })
  if (selfHosted) {
    if (selfHosted.claimMode === 'local') {
      const bootstrapPort = Number(process.env.AUTOMAGIK_GATE_BOOTSTRAP_PORT || 3083)
      if (!Number.isInteger(bootstrapPort) || bootstrapPort < 1 || bootstrapPort > 65535 || [3081, port].includes(bootstrapPort)) {
        throw new claimErrors('AUTOMAGIK_GATE_BOOTSTRAP_PORT must be a separate valid port, never the DSH or main gate port')
      }
      bootstrap = createGate({ origin: origin.origin, sessions, credentials, selfHosted, bootstrap: true })
      await new Promise((resolve, reject) => {
        bootstrap.once('error', reject)
        bootstrap.listen(bootstrapPort, DSH_HOST, resolve)
      })
      bootstrap.on('error', () => { console.error('automagik-gate: bootstrap listener failed'); process.exit(1) })
    }
    control = await controlServer(selfHosted)
    selfHosted.bindingChange = async (claimed, drop) => {
      if (drop) bootstrap?.closeAllConnections()
      try { await server.rebind(port, () => selfHosted.claimed ? published : DSH_HOST, drop) }
      catch { console.error('automagik-gate: listener failed'); process.exit(1) }
    }
    await selfHosted.start({ interactive: process.env.AUTOMAGIK_GATE_IMAGE !== '1' && Boolean(process.stdin.isTTY && process.stdout.isTTY),
      show: code => writeFileSync('/dev/tty', `Automagik claim code: ${code}\n`) })
  }
  server.listen(port, selfHosted?.claimed ? published : DSH_HOST, () => console.log('automagik-gate: listening on loopback or claimed address'))
  server.on('error', () => { console.error('automagik-gate: listener failed'); process.exitCode = 1 })
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { control?.close(); bootstrap?.closeGate(); server.closeGate() })
} catch (error) {
  control?.close()
  bootstrap?.closeGate()
  server?.closeGate()
  // Never echo config, credentials, a URL, an owner record or a session into container logs.
  console.error(error instanceof AccessConfigurationError || (claimErrors && error instanceof claimErrors)
    ? `automagik-gate: ${error.message}`
    : 'automagik-gate: disabled or invalid configuration/state; see server/README.md')
  process.exitCode = 1
}
