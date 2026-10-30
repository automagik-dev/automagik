// Fixture-only fail-closed transport fence. Never preload into an installed/live runtime.
import net from 'node:net'
import { isAbsolute, resolve, sep } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'

const root = process.env.ADVANCED_FIXTURE_ROOT
if (!root || !isAbsolute(root) || !root.includes(`${sep}.tools${sep}advanced-fixture${sep}`)) throw new Error('Missing scoped fixture root')
const original = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const options = typeof first === 'object' && first !== null ? first : undefined
  const path = options?.path ?? (typeof first === 'string' && !/^\d+$/.test(first) ? first : undefined)
  if (path) {
    const absolute = resolve(path)
    if (!absolute.startsWith(`${root}${sep}`)) throw new Error('Fixture blocked an out-of-scope socket path')
  } else {
    const host = options?.host ?? (typeof args[1] === 'string' ? args[1] : 'localhost')
    if (!['127.0.0.1', '::1', 'localhost', '[::1]'].includes(host)) throw new Error('Fixture blocked non-loopback TCP')
    const port = Number(options?.port ?? first)
    const allowed = new Set((process.env.ADVANCED_FIXTURE_PORTS ?? '').split(',').filter(Boolean).map(Number))
    if ([60237, 55677, 56091].includes(port) || !allowed.has(port)) throw new Error('Fixture blocked unowned TCP port')
  }
  return original.apply(this, args)
}
syncBuiltinESMExports()
