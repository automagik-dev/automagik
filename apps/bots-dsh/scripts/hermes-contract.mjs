// Run for EVERY Hermes release before accepting it:
// node scripts/hermes-contract.mjs /scratch/gateway-contract.openrpc.json
// Reads only a downloaded generated contract; never contacts a Hermes instance.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const USED_METHODS = ['client.capabilities', 'session.create', 'session.resume', 'session.activate', 'session.close', 'session.events.since', 'session.interrupt', 'prompt.submit', 'model.options', 'config.set']
const EVENTS = ['gateway.ready', 'session.info', 'message.start', 'message.delta', 'message.interim', 'message.complete', 'tool.start', 'tool.complete', 'request.cancel', 'error']
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function contractPin(contract) {
  const entries = {}
  const schemas = contract.components?.schemas ?? {}
  const visit = value => {
    if (!value || typeof value !== 'object') return
    if (value.$ref?.startsWith('#/components/schemas/')) {
      const name = value.$ref.slice('#/components/schemas/'.length)
      if (!Object.hasOwn(entries, `schema:${name}`)) {
        if (!schemas[name]) throw new Error('Generated contract has an unresolved schema.')
        entries[`schema:${name}`] = hash(schemas[name])
        visit(schemas[name])
      }
    }
    for (const nested of Object.values(value)) visit(nested)
  }
  for (const [kind, list, wanted] of [
    ['method', contract.methods, USED_METHODS],
    ['event', contract['x-notifications'], EVENTS],
    ['request', contract['x-server-requests'], ['approval']],
  ]) {
    for (const name of wanted) {
      const entry = list?.find(entry => entry.name === name)
      if (!entry) throw new Error(`Generated contract is missing ${kind} ${name}.`)
      entries[`${kind}:${name}`] = hash(entry)
      visit(entry)
    }
  }
  return { generatedSha256: hash(contract), entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) }
}

export function differences(before, after) {
  return [...new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])].filter(key => before.entries[key] !== after.entries[key])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const pinned = JSON.parse(readFileSync(new URL('../src/host/hermes-contract.json', import.meta.url), 'utf8'))
    if (!process.argv[2]) throw new Error('Pass the generated OpenRPC file downloaded for the Hermes release being reviewed.')
    const next = contractPin(JSON.parse(readFileSync(process.argv[2], 'utf8')))
    const changed = differences(pinned, next)
    if (pinned.generatedSha256 !== next.generatedSha256) {
      console.error('Hermes generated contract changed; reject this release until reviewed and fixture-tested.')
      console.error(changed.length ? changed.join('\n') : 'Only unused contract surfaces changed; review the upstream diff before updating the pin.')
      process.exitCode = 1
    } else console.log('Hermes generated contract matches the tested pin (Desktop 8, standalone).')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
