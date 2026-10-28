// The pack's dictionaries: src/client/locales/pt-BR/<namespace>.json, by namespace name.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
export const FOLDER = join(PLUGIN, 'src/client/locales/pt-BR')

export function loadDictionaries(folder = FOLDER) {
  const names = readdirSync(folder).filter((file) => file.endsWith('.json')).sort()
  return Object.fromEntries(names.map((file) => [file.slice(0, -'.json'.length), JSON.parse(readFileSync(join(folder, file), 'utf8'))]))
}
