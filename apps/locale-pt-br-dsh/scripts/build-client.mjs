// Builds client.js, the DSH client half: createPack (src/client/pack.js) and the pt-BR
// dictionaries (src/client/locales/pt-BR).
//
//   node scripts/build-client.mjs           writes client.js
//   node scripts/build-client.mjs --check   exits 1 when client.js differs from a fresh build
//
// client.js is committed, so `link:` and git installs need no build step. DSH loads it as a
// classic script that hands a factory to its module loader. The pack imports nothing, so no
// bundler is needed: the build writes createPack's source and the dictionaries as JSON.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPack } from '../src/client/pack.js'
import { PLUGIN, loadDictionaries } from './dictionaries.mjs'

// DSH's client loader matches a bundle's id to the npm package that ships it.
const PACKAGE_NAME = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')).name
const OUTPUT = join(PLUGIN, 'client.js')

export async function bundleClient() {
  return [
    '// Generated from src/client by `npm run build` (scripts/build-client.mjs). Do not edit by hand.',
    'window.__ModuleLoader__.load({',
    `  id: '${PACKAGE_NAME}',`,
    '  factory: () => {',
    `const createPack = ${createPack.toString()}`,
    `const pack = createPack(${JSON.stringify(loadDictionaries(), null, 2)})`,
    // The loader gets a plain exports object tagged as a module, as DSH's own bundles are.
    'return Object.defineProperty({ ...pack }, Symbol.toStringTag, { value: \'Module\' })',
    '  },',
    '})',
    '',
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = await bundleClient()
  if (process.argv.includes('--check')) {
    let current = null
    try { current = readFileSync(OUTPUT, 'utf8') } catch { /* missing counts as stale */ }
    if (current !== next) {
      console.error('client.js is stale: run `npm run build` in apps/locale-pt-br-dsh and commit the result')
      process.exit(1)
    }
  } else {
    writeFileSync(OUTPUT, next)
  }
}
