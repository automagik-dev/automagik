// Writes src/client/vendor/art/inline.js: every picture in src/client/vendor/art (copies of
// apps/bots-dsh/src/client/art) as a data: URL, so the bundle carries them and the tests that
// bundle a client module need no asset loader. The files beside it are the sources; edit
// those, then run this and commit both.
//
//   node scripts/inline-art.mjs           writes src/client/vendor/art/inline.js
//   node scripts/inline-art.mjs --check   exits 1 when inline.js differs from the files
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
export const ART = join(PLUGIN, 'src', 'client', 'vendor', 'art')
const OUTPUT = join(ART, 'inline.js')
const TYPES = { '.webp': 'image/webp', '.woff2': 'font/woff2' }

// genie-expressions.webp -> genieExpressions; fonts/dm-sans-latin.woff2 -> dmSansLatin.
const nameOf = file => file.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase())

export function inlineArt(dir = ART) {
  const files = readdirSync(dir, { recursive: true }).map(file => String(file).replaceAll('\\', '/'))
    .filter(file => Object.keys(TYPES).some(ext => file.endsWith(ext))).sort()
  const lines = files.map((file) => {
    const type = TYPES[file.slice(file.lastIndexOf('.'))]
    return `// ${file}\nexport const ${nameOf(file)} = 'data:${type};base64,${readFileSync(join(dir, file)).toString('base64')}'`
  })
  return `// Generated from the files in ${relative(PLUGIN, dir)} by scripts/inline-art.mjs. Do not edit by hand.\n${lines.join('\n')}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = inlineArt()
  if (process.argv.includes('--check')) {
    let current = null
    try { current = readFileSync(OUTPUT, 'utf8') } catch { /* missing counts as stale */ }
    if (current !== next) {
      console.error('src/client/vendor/art/inline.js is stale: run `node scripts/inline-art.mjs` and commit the result')
      process.exit(1)
    }
  } else {
    writeFileSync(OUTPUT, next)
  }
}
