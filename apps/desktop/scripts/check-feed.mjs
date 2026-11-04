// An update feed (latest.yml, latest-linux.yml, latest-mac.yml) is checked against the files
// beside it before a release takes it: electron-updater downloads the file the feed's `path`
// names and refuses it unless its sha512 is the feed's, so a feed that names another file, or
// another build of it, leaves every installed app without its update.
// Usage: node scripts/check-feed.mjs dist/latest.yml
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The feed's `files` entries ({ url, sha512, size }) and its top-level `path` and `sha512`. */
export function parseFeed(text) {
  const files = []
  const top = {}
  for (const raw of String(text).split(/\r?\n/)) {
    const item = /^\s*-\s+url:\s*(.+)$/.exec(raw)
    if (item) { files.push({ url: unquote(item[1]) }); continue }
    const field = /^(\s*)(path|sha512|size):\s*(.+)$/.exec(raw)
    if (!field) continue
    const value = field[2] === 'size' ? Number(field[3]) : unquote(field[3])
    if (field[1] === '') top[field[2]] = value
    else if (files.length > 0) files.at(-1)[field[2]] = value
  }
  return { files, path: top.path, sha512: top.sha512 }
}

const unquote = text => text.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')

/**
 * The problems with the feed in `dir`: every file it lists must be there with its sha512
 * (base64) and size, and its `path` must be one of them with the same sha512. Empty when none.
 */
export function feedProblems(text, dir) {
  const feed = parseFeed(text)
  const problems = []
  if (feed.files.length === 0) problems.push('the feed lists no files')
  for (const entry of feed.files) {
    const file = join(dir, entry.url)
    let bytes
    try { bytes = readFileSync(file) } catch { problems.push(`${entry.url} is not beside the feed`); continue }
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    if (entry.sha512 !== sha512) problems.push(`${entry.url}: the feed says sha512 ${entry.sha512}, the file is ${sha512}`)
    if (entry.size !== bytes.length) problems.push(`${entry.url}: the feed says ${entry.size} bytes, the file is ${bytes.length}`)
  }
  const main = feed.files.find(entry => entry.url === feed.path)
  if (!main) problems.push(`the feed's path ${feed.path} is not one of its files`)
  else if (feed.sha512 !== main.sha512) problems.push(`the feed's sha512 is not its path's (${feed.path})`)
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const feed = process.argv[2]
  if (!feed) throw new Error('usage: node scripts/check-feed.mjs <latest.yml>')
  const problems = feedProblems(readFileSync(feed, 'utf8'), dirname(feed))
  for (const problem of problems) console.error(`::error ::${feed}: ${problem}`)
  if (problems.length > 0) process.exit(1)
  const { path } = parseFeed(readFileSync(feed, 'utf8'))
  console.log(`${feed}: ${path} and every file it lists match`)
}
