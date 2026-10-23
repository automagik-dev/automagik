// After the dmg is notarized, its ticket is stapled into it, which changes its bytes: the
// sha512 and size electron-builder wrote for it into latest-mac.yml no longer match. This
// writes the new ones for that file (the zip's entry, which updates read, stays as it was).
// Usage: node scripts/restamp-feed.mjs dist/latest-mac.yml dist/Omni-<version>-mac-arm64.dmg
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The feed with the entry for `url` given `sha512` and `size`; throws when it lists no such file. */
export function restampFeed(text, { url, sha512, size }) {
  const lines = String(text).split('\n')
  const at = lines.findIndex(line => line.replace(/^\s*-\s*/, '').trim() === `url: ${url}`)
  if (at === -1) throw new Error(`the feed lists no ${url}`)
  const indent = lines[at].match(/^\s*-\s*/)[0].replace('-', ' ')
  let seen = 0
  for (let i = at + 1; i < lines.length && lines[i].startsWith(indent) && !lines[i].trimStart().startsWith('- '); i++) {
    if (lines[i].trimStart().startsWith('sha512: ')) {
      lines[i] = `${indent}sha512: ${sha512}`
      seen++
    } else if (lines[i].trimStart().startsWith('size: ')) {
      lines[i] = `${indent}size: ${size}`
      seen++
    }
  }
  if (seen !== 2) throw new Error(`the feed's entry for ${url} has no sha512 and size to replace`)
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [feed, file] = process.argv.slice(2)
  const bytes = readFileSync(file)
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  writeFileSync(feed, restampFeed(readFileSync(feed, 'utf8'), { url: basename(file), sha512, size: bytes.length }))
  console.log(`[restamp-feed] ${basename(file)}: ${bytes.length} bytes`)
}
