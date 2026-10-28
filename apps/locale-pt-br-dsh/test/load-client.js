// client.js as DSH runs it: a classic script that hands a factory to the module loader.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

export function loadClient(source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')) {
  const loads = []
  const requested = []
  runInNewContext(source, { window: { __ModuleLoader__: { load: (entry) => loads.push(entry) } } })
  if (loads.length !== 1) throw new Error(`client.js loaded ${loads.length} modules`)
  const exports = loads[0].factory((name) => {
    requested.push(name)
    throw new Error(`no platform module ${name}`)
  })
  return { id: loads[0].id, exports, requested }
}
