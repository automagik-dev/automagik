#!/usr/bin/env node
// Host-only control: pathname socket in the gate volume, never TCP or HTTP.
import net from 'node:net'
import { chmodSync, lstatSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

async function removeStaleSocket(path) {
  let before
  try { before = lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (!before.isSocket()) throw new Error('Host control path is not a socket')
  await new Promise((resolve, reject) => {
    const probe = net.connect(path)
    probe.setTimeout(1000, () => probe.destroy(new Error('Host control probe timed out')))
    probe.once('connect', () => { probe.destroy(); reject(new Error('Host control is already running')) })
    probe.once('error', error => error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? resolve() : reject(error))
  })
  // A competing starter may have replaced the dead endpoint during the probe.
  // Never remove a replacement or a regular file, even when connection was refused.
  let after
  try { after = lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (!after.isSocket() || after.ino !== before.ino || after.dev !== before.dev) throw new Error('Host control endpoint changed')
  unlinkSync(path)
}

export async function controlServer(claim) {
  const path = join(claim.dir, 'control.sock')
  await removeStaleSocket(path)
  const server = net.createServer(socket => {
    socket.on('error', () => {})
    socket.setTimeout(5000, () => socket.destroy())
    let pending = ''
    socket.on('data', async chunk => {
      pending += chunk.toString('utf8')
      if (pending.length > 1024) { socket.destroy(); return }
      if (!pending.includes('\n')) return
      socket.removeAllListeners('data')
      try {
        const command = JSON.parse(pending).command
        const result = command === 'reset' ? await claim.reset() : command === 'renew-claim' ? await claim.renewCode() : undefined
        if (!result) throw new Error('Unknown host command')
        socket.end(`${JSON.stringify(result)}\n`)
      } catch { socket.end('{"error":"Host operation refused"}\n') }
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve) })
  try { chmodSync(path, 0o600) } catch (error) { server.close(); throw error }
  return server
}
export async function hostCommand(dir, command) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(join(dir, 'control.sock'))
    let result = ''
    socket.setTimeout(5000, () => socket.destroy(new Error('Host command timed out')))
    socket.on('error', reject)
    socket.on('connect', () => socket.write(`${JSON.stringify({ command })}\n`))
    socket.on('data', chunk => { result += chunk })
    socket.on('end', () => { try { const value = JSON.parse(result); if (value.error) throw new Error(value.error); resolve(value) } catch (error) { reject(error) } })
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2]
  if (!['reset', 'renew-claim'].includes(command)) { console.error('usage: gate-control.mjs reset|renew-claim'); process.exitCode = 1 }
  else hostCommand(process.env.AUTOMAGIK_GATE_HOME || '/data', command).then(() => console.log('Host operation complete'), () => { console.error('Host operation refused'); process.exitCode = 1 })
}
