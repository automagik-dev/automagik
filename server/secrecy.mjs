#!/usr/bin/env node
// The server image's secrecy gate, run before the image is ever pushed: extract the built
// image's rootfs, inventory every file in it, and refuse any that could carry a person's data
// or a credential. It is the repository's own privacy grep (herdr/scripts/privacy-check.mjs,
// same deny list) over the image, plus what only an image can leak:
//
//   - a DeepSeek key (`sk-…`) or any `token=` value, a URL carrying a token, a launch URL
//   - `.env` files, `launch-url` files, git credentials (`.git-credentials`, netrc, a URL with
//     a user and password, a GitHub token, a private key)
//   - `/home/<user>` and `/mnt/ai` paths, the owner's names, hosts, accounts and emails
//   - anything under `/data`: the image bakes no profile, bot/team state, workspace or secret
//
// The image is exported (docker export), never run: the entrypoint, the profile seed and dsh
// do not execute. The layer list is read from the image's RootFS; the file inventory and the
// findings go to --inventory so CI can keep them. Any hit exits 1.
//
//   node server/secrecy.mjs automagik-server:3.92.0 [--inventory secrecy] [--keep]
//   node server/secrecy.mjs --rootfs /tmp/rootfs [--inventory secrecy]   (no docker)
import { execFileSync } from 'node:child_process'
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { denyMatcher, fileText, scan } from '../herdr/scripts/privacy-check.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIST = join(ROOT, 'herdr', 'scripts', 'privacy-list.json')
/** The only directories /data may carry; every file under it is a finding. */
export const DATA_DIRS = new Set(['data', 'data/dsh', 'data/bots', 'data/workspace', 'data/secrets'])
/** The dotenv names allowed: an example file has no values. */
const ENV_EXAMPLE = '.env.example'

/**
 * Server-only patterns, on top of the repository's privacy grep. `mask` keeps the value out
 * of the log: a finding names the rule and the file, never the credential.
 */
export const SERVER_RULES = [
  { rule: 'key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, mask: () => 'sk-***' },
  { rule: 'token', re: /(?<![A-Za-z0-9_])token=[A-Za-z0-9_.~+\/-]{8,}/g, mask: () => 'token=***' },
  { rule: 'token-url', re: /https?:\/\/[^\s"'<>]*[?&]token=[^&\s"'<>]+/g, mask: (m) => m.replace(/token=[^&\s]+/, 'token=***') },
  { rule: 'private-path', re: /\/mnt\/ai(?:\/|\b)/g, mask: () => '/mnt/ai' },
  { rule: 'git-credentials', re: /(?:https?|ssh):\/\/[^\s/:@]+:[^\s/@]+@/g, mask: () => '***:***@' },
  { rule: 'git-credentials', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16})\b/g, mask: () => '***' },
  { rule: 'git-credentials', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, mask: () => 'PRIVATE KEY' },
]

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`
const lineOf = (text, index) => text.slice(0, index).split('\n').length
const usage = 'usage: node server/secrecy.mjs <image> [--inventory <dir>] [--keep]\n'
  + '       node server/secrecy.mjs --rootfs <dir> [--inventory <dir>]'
/** Home paths in a binary's strings; the Node build's `iojs` is a build account, not a person. */
const HOME = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)([A-Za-z0-9._-]+)/g
const BUILD_ACCOUNTS = ['iojs']

/** Whether a file name alone is a finding. */
export function nameHits(file, kind = 'file') {
  const base = basename(file)
  const hits = []
  if (kind !== 'dir' && base === 'launch-url') hits.push({ file, line: 0, rule: 'launch-url', match: file })
  if (kind !== 'dir' && /^\.env(?:\.|$)/.test(base) && base !== ENV_EXAMPLE) {
    hits.push({ file, line: 0, rule: 'dotenv', match: file })
  }
  if (kind !== 'dir' && (base === '.git-credentials' || base === '.netrc' || base === 'netrc')) {
    hits.push({ file, line: 0, rule: 'git-credentials', match: file })
  }
  if (kind === 'dir') {
    if (file === 'data' || file.startsWith('data/')) {
      if (!DATA_DIRS.has(file)) hits.push({ file, line: 0, rule: 'data-state', match: file })
    }
  } else if (file.startsWith('data/')) {
    hits.push({ file, line: 0, rule: 'data-state', match: file })
  }
  return hits
}

/**
 * Every hit in one file's text: the repository's privacy grep and the server rules. The
 * email rule is left to package metadata: public npm READMEs and minified bundles carry
 * author addresses, and a shape alone is not a leak; the deny list's private names still
 * catch the owner's identity. In binaries only the high-confidence rules run (strings in a
 * WebP or a bundled asset produce email-shaped noise); the caller adds the home-path check.
 */
export function textHits(file, text, list, denied = denyMatcher(list.deny), { privacy = true } = {}) {
  const hits = privacy ? scan(file, text, list, denied).filter((hit) => hit.rule !== 'email') : []
  for (const { rule, re, mask } of SERVER_RULES) {
    for (const match of text.matchAll(re)) {
      hits.push({ file, line: lineOf(text, match.index), rule, match: mask(match[0]) })
    }
  }
  return hits
}

/** Home paths in a binary's strings, with the toolchain's build accounts allowed. */
export function binaryHits(file, text, users = []) {
  const allowed = new Set([...(users ?? []), ...BUILD_ACCOUNTS])
  const hits = []
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(HOME)) {
      if (!allowed.has(match[1])) hits.push({ file, line: 0, rule: 'home-path', match: match[0] })
    }
  }
  return hits
}

/** Every entry under `root`, without following symlinks out of it. */
export function walk(root) {
  const entries = []
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name)
      const file = relative(root, abs).split(sep).join('/')
      const stat = lstatSync(abs)
      if (stat.isDirectory()) {
        entries.push({ file, kind: 'dir' })
        visit(abs)
      } else if (stat.isSymbolicLink()) {
        entries.push({ file, kind: 'symlink', target: readlinkSync(abs) })
      } else if (stat.isFile()) {
        entries.push({ file, kind: 'file', size: stat.size })
      } else {
        entries.push({ file, kind: 'other' })
      }
    }
  }
  visit(root)
  return entries
}

/** Scan an extracted rootfs: inventory, names, contents and the /data rule. */
export function scanTree(root, list = JSON.parse(readFileSync(LIST, 'utf8'))) {
  const imageList = { ...list, users: [...(list.users ?? []), ...BUILD_ACCOUNTS] }
  const denied = denyMatcher(imageList.deny)
  const entries = walk(root)
  const hits = []
  let bytes = 0
  for (const entry of entries) {
    hits.push(...nameHits(entry.file, entry.kind))
    if (entry.kind !== 'file') continue
    bytes += entry.size
    let buf
    try {
      buf = readFileSync(join(root, entry.file))
    } catch (error) {
      hits.push({ file: entry.file, line: 0, rule: 'unreadable', match: error.code ?? 'read failed' })
      continue
    }
    const binary = buf.includes(0)
    const text = fileText(buf)
    hits.push(...textHits(entry.file, text, imageList, denied, { privacy: !binary }))
    if (binary) hits.push(...binaryHits(entry.file, text, imageList.users))
  }
  return { entries, hits, bytes }
}

/** The image's own config (env and labels), scanned like a file; docker keeps no secret there. */
export function scanImageConfig(image, list, denied = denyMatcher(list.deny)) {
  const raw = execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .Config}}'], { encoding: 'utf8' })
  const hits = textHits('image-config', raw, list, denied)
  for (const line of JSON.parse(raw).Env ?? []) {
    const [name, ...rest] = line.split('=')
    const value = rest.join('=')
    if (value && /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) {
      hits.push({ file: 'image-config', line: 0, rule: 'env-secret', match: name })
    }
  }
  return hits
}

/**
 * Export the image's rootfs into a work directory and read its layers. docker create runs no
 * entrypoint; docker export writes the flattened filesystem, never the running server.
 */
export function extractImage(image, work = mkdtempSync(join(tmpdir(), 'automagik-secrecy-'))) {
  const tar = join(work, 'image.tar')
  const rootfs = join(work, 'rootfs')
  mkdirSync(rootfs, { recursive: true })
  const name = `automagik-secrecy-${process.pid}`
  execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { stdio: 'pipe' })
  const layers = JSON.parse(execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .RootFS.Layers}}'], { encoding: 'utf8' }))
  try {
    execFileSync('docker', ['create', '--name', name, image], { stdio: 'pipe' })
    execFileSync('docker', ['export', '--output', tar, name], { stdio: 'pipe' })
  } finally {
    try { execFileSync('docker', ['rm', '--force', name], { stdio: 'ignore' }) } catch {}
  }
  execFileSync('tar', ['-xf', tar, '-C', rootfs], { stdio: 'pipe' })
  rmSync(tar, { force: true })
  return { work, rootfs, layers }
}

/** Write what was checked: the file inventory, the layer list, and the findings (or clean). */
export function writeInventory(dir, { image, layers, entries, hits }) {
  mkdirSync(dir, { recursive: true })
  const files = entries.map((entry) => {
    const target = entry.target ? ` -> ${entry.target}` : ''
    const size = entry.size !== undefined ? `\t${entry.size}` : ''
    return `${entry.kind}\t${entry.file}${size}${target}`
  })
  writeFileSync(join(dir, 'image-files.txt'), `${files.join('\n')}\n`)
  writeFileSync(join(dir, 'image-layers.txt'), `${(layers ?? []).join('\n')}\n`)
  writeFileSync(join(dir, 'secrecy.txt'), hits.length
    ? `${hits.map((hit) => `${hit.file}:${hit.line}: ${hit.rule}: ${hit.match}`).join('\n')}\n`
    : 'clean\n')
  writeFileSync(join(dir, 'image.txt'), `${image ?? 'rootfs'}\n`)
}

function topLevel(entries) {
  const counts = new Map()
  for (const entry of entries) {
    const top = entry.file.split('/')[0]
    counts.set(top, (counts.get(top) ?? 0) + 1)
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b))
}

function report({ image, layers, entries, hits, bytes }, inventory) {
  const files = entries.filter((entry) => entry.kind === 'file').length
  const symlinks = entries.filter((entry) => entry.kind === 'symlink').length
  const dirs = entries.filter((entry) => entry.kind === 'dir').length
  console.log(`[secrecy] ${image ?? 'rootfs'}`)
  if (layers) console.log(`[secrecy] layers: ${layers.length}`)
  console.log(`[secrecy] files: ${files} (${mb(bytes)}), symlinks: ${symlinks}, directories: ${dirs}`)
  console.log(`[secrecy] top-level: ${topLevel(entries).map(([name, count]) => `${name} ${count}`).join(', ')}`)
  console.log(`[secrecy] inventory: ${join(inventory, 'image-files.txt')}, layers: ${join(inventory, 'image-layers.txt')}`)
  if (hits.length) {
    for (const hit of hits) console.error(`${hit.file}:${hit.line}: ${hit.rule}: ${hit.match}`)
    console.error(`[secrecy] ${hits.length} finding(s): the image must not be pushed`)
    return false
  }
  console.log('[secrecy] clean: no key, token, .env, launch-url, data state, private path or git credential')
  return true
}

function summary({ image, layers, entries, hits }, inventory, clean) {
  const target = process.env.GITHUB_STEP_SUMMARY
  if (!target) return
  const files = entries.filter((entry) => entry.kind === 'file').length
  const lines = [
    '### Server image secrecy',
    '',
    `- image: \`${image ?? 'rootfs'}\``,
    `- layers: ${layers?.length ?? 0}`,
    `- files checked: ${files}`,
    `- inventory: \`${join(inventory, 'image-files.txt')}\``,
    `- result: ${clean ? 'clean' : `${hits.length} finding(s)`}`,
    '',
  ]
  writeFileSync(target, `${lines.join('\n')}`, { flag: 'a' })
}

function argsOf(argv) {
  const args = { inventory: 'secrecy', keep: false }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--keep') { args.keep = true; continue }
    if (!name.startsWith('--')) { args.image = name; continue }
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`${name} needs a value`)
    args[name.slice(2)] = value
    index += 1
  }
  return args
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let extracted
  try {
    const args = argsOf(process.argv.slice(2))
    if (!args.rootfs && !args.image) throw new Error(usage)
    const list = JSON.parse(readFileSync(LIST, 'utf8'))
    const denied = denyMatcher(list.deny)
    let image = args.image
    let rootfs = args.rootfs
    let layers
    if (!rootfs) {
      extracted = extractImage(image)
      rootfs = extracted.rootfs
      layers = extracted.layers
    }
    const tree = scanTree(rootfs, list)
    if (image) tree.hits.push(...scanImageConfig(image, list, denied))
    writeInventory(args.inventory, { image, layers, ...tree })
    const clean = report({ image, layers, ...tree }, args.inventory)
    summary({ image, layers, ...tree }, args.inventory, clean)
    if (!clean) process.exitCode = 1
    if (extracted && !args.keep) rmSync(extracted.work, { recursive: true, force: true })
    else if (extracted) console.log(`[secrecy] kept the export at ${extracted.work}`)
  } catch (error) {
    if (extracted && !process.argv.includes('--keep')) rmSync(extracted.work, { recursive: true, force: true })
    console.error(`[secrecy] FAILED: ${error?.message ?? error}`)
    process.exitCode = 1
  }
}
