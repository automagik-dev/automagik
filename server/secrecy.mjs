#!/usr/bin/env node
// The server image's secrecy gate, run before the image is ever pushed: extract the built
// image's rootfs, inventory every file in it, and refuse any that could carry a person's data
// or a credential.
//
// Every file gets the repository's own privacy grep (herdr/scripts/privacy-check.mjs, same
// deny list) and the image rules: a provider key, a token=, a JSON token field, a complete
// private-key block, /mnt/ai, a home path, a credential URL, .env/launch-url files, an archive,
// or any file under /data. The image's config and environment are scanned too. A hit fails the
// job; the one exception is an exact, reviewed entry in server/secrecy-allowlist.json (file +
// rule + matched string or its sha256), with a reason, for a vendored package's example or a
// toolchain's build account. There are no path patterns: an entry names one file, one rule and
// the exact match. Keys, private-key blocks, /data, our own code, /etc and config files may
// never be allowlisted.
//
// The image is exported (docker export), never run: the entrypoint, the profile seed and dsh
// do not execute. The layer list comes from the image's RootFS and from docker save's manifest;
// the file inventory, the allowlist used and any external symlinks go to --inventory so CI can
// keep them. Any unallowed hit exits 1.
//
//   node server/secrecy.mjs automagik-server:3.93.0 [--inventory secrecy] [--keep]
//   node server/secrecy.mjs --rootfs /tmp/rootfs [--inventory secrecy]   (no docker)
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { denyMatcher, fileText, scan } from '../herdr/scripts/privacy-check.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIST = join(ROOT, 'herdr', 'scripts', 'privacy-list.json')
export const ALLOWLIST_FILE = join(ROOT, 'server', 'secrecy-allowlist.json')
/** The only directories /data may carry; every file under it is a finding. */
export const DATA_DIRS = new Set(['data', 'data/dsh', 'data/bots', 'data/workspace', 'data/secrets'])
/** The dotenv names allowed: an example file has no values. */
const ENV_EXAMPLE = '.env.example'
/** Home paths, in text and in a binary's strings. */
const HOME = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)([A-Za-z0-9._-]+)/g
/** Archives are not opened by this scan: an archive in a runtime image is a finding until one is reviewed. */
export const ARCHIVE = /\.(?:tgz|tar|tar\.gz|gz|xz|bz2|zip|7z|rar)$/i

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`
const lineOf = (text, index) => text.slice(0, index).split('\n').length
export const sha256 = (text) => createHash('sha256').update(String(text)).digest('hex')
const usage = 'usage: node server/secrecy.mjs <image> [--inventory <dir>] [--keep]\n'
  + '       node server/secrecy.mjs --rootfs <dir> [--inventory <dir>]'

/**
 * High-confidence live-secret shapes, applied to every file. `mask` keeps the value out of the
 * log: a finding names the rule and the file, never the credential.
 */
export const SECRET_RULES = [
  { rule: 'key', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/g, mask: () => 'sk-***' },
  { rule: 'key', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, mask: () => 'gh***' },
  { rule: 'key', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, mask: () => 'github_pat_***' },
  { rule: 'key', re: /\bAKIA[0-9A-Z]{16}\b/g, mask: () => 'AKIA***' },
  { rule: 'key', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, mask: () => 'xox***' },
  // A real block: a header, at least one body element (a base64 line of any length, including a
  // short final line, a Proc-Type/DEK-Info header, or the blank line after it), and a footer. A
  // bare BEGIN/END label constant is not a key.
  { rule: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\r\n]+(?:(?:Proc-Type|DEK-Info):[^\r\n]*[\r\n]+|[\r\n]+|[A-Za-z0-9+/=]+[\r\n]+)+-----END [A-Z ]*PRIVATE KEY-----/g, mask: () => 'PRIVATE KEY block' },
  { rule: 'private-path', re: /\/mnt\/ai(?:\/|\b)/g, mask: () => '/mnt/ai' },
]
export const TOKEN_RULES = [
  { rule: 'token', re: /(?<![A-Za-z0-9_])token=[A-Za-z0-9_.~+\/-]{24,}/g, mask: () => 'token=***' },
  { rule: 'token-url', re: /https?:\/\/[^\s"'<>]*[?&]token=[^&\s"'<>]+/g, mask: (m) => m.replace(/token=[^&\s]+/, 'token=***') },
  { rule: 'token-json', re: /["'](?:access_?|refresh_?|api_?|launch_?)?token["']\s*:\s*["'](?=[A-Za-z0-9_.~+\/-]{32,}["'])(?=[A-Za-z0-9_.~+\/-]*\d)[A-Za-z0-9_.~+\/-]+["']/gi, mask: () => 'token: ***' },
]
export const CREDENTIAL_RULES = [
  { rule: 'git-credentials', re: /(?:https?|ssh):\/\/[^\s/:@]+:[^\s/@]+@/g, mask: () => '***:***@' },
]
export const SERVER_RULES = [...SECRET_RULES, ...TOKEN_RULES, ...CREDENTIAL_RULES]

/** Rules that may never be allowlisted: a provider key is never a reviewed exception. */
const NEVER_ALLOW_RULE = new Set(['key', 'data-state', 'launch-url', 'dotenv', 'env-secret', 'archive', 'unreadable'])
/** Paths that may never be allowlisted: /data, our own code, /etc and its config. */
const NEVER_ALLOW_PATH = /^(?:data\/|opt\/automagik\/(?:[^/]+\.mjs|versions\.json)|opt\/automagik\/profile\/(?:package\.json|cordis\.patch\.yml|pnpm-workspace\.yaml)|opt\/automagik\/profile\/node_modules\/@automagik\/|usr\/local\/bin\/(?:dsh|pnpm)$|etc\/)/
/** Only the six reviewed gnutls test-vector blocks may be private-key entries; nowhere else. */
const PRIVATE_KEY_ALLOW = /^usr\/lib\/x86_64-linux-gnu\/libgnutls\.so\.30$/
const allowable = (entry) => !NEVER_ALLOW_RULE.has(entry.rule)
  && !NEVER_ALLOW_PATH.test(entry.file)
  && (entry.rule !== 'private-key' || PRIVATE_KEY_ALLOW.test(entry.file))

/**
 * The reviewed exceptions: one exact file, one rule and the exact matched string (or its
 * sha256), each with the reason it is not this repository's state. An entry for a key, a
 * private-key block, /data, our own code or /etc is refused at load.
 */
export function loadAllowlist(file = ALLOWLIST_FILE) {
  const entries = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(entries)) throw new Error('secrecy allowlist must be an array')
  const seen = new Set()
  for (const entry of entries) {
    if (!entry || typeof entry.file !== 'string' || typeof entry.rule !== 'string' || typeof entry.reason !== 'string') {
      throw new Error('secrecy allowlist entries need file, rule and reason')
    }
    if (!entry.match && !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '')) throw new Error(`${entry.file}: allowlist entry needs match or sha256`)
    if (entry.fileSha256 !== undefined && !/^[0-9a-f]{64}$/.test(entry.fileSha256)) throw new Error(`${entry.file}: fileSha256 is not a sha256`)
    if (!allowable(entry)) throw new Error(`${entry.file}: ${entry.rule} may not be allowlisted here`)
    const key = `${entry.file}\0${entry.rule}\0${entry.sha256 ?? sha256(entry.match)}`
    if (seen.has(key)) throw new Error(`${entry.file}: duplicate allowlist entry`)
    seen.add(key)
  }
  return entries
}

/** Split hits into the ones an exact entry names (with its reason) and the ones that still fail. */
export function applyAllowlist(hits, entries = []) {
  const exact = new Map(entries
    .filter(allowable)
    .map((entry) => [`${entry.file}\0${entry.rule}\0${entry.sha256 ?? sha256(entry.match)}`, entry]))
  const used = new Map()
  const kept = []
  for (const hit of hits) {
    const key = `${hit.file}\0${hit.rule}\0${sha256(hit.raw ?? hit.match ?? '')}`
    const entry = exact.get(key)
    if (!entry || (entry.fileSha256 && entry.fileSha256 !== hit.fileSha256)) { kept.push(hit); continue }
    if (!used.has(key)) used.set(key, { file: hit.file, rule: hit.rule, reason: entry.reason, count: 0 })
    used.get(key).count += 1
  }
  const allowedKeys = new Set(used.keys())
  return {
    kept,
    allowed: [...used.values()],
    unused: entries.filter((entry) => !allowedKeys.has(`${entry.file}\0${entry.rule}\0${entry.sha256 ?? sha256(entry.match)}`)),
  }
}

const hitOf = (file, line, rule, raw, match = raw) => ({ file, line, rule, raw, match })

/** Whether a file name alone is a finding. */
export function nameHits(file, kind = 'file') {
  const base = basename(file)
  const hits = []
  if (kind !== 'dir' && base === 'launch-url') hits.push(hitOf(file, 0, 'launch-url', file))
  if (kind !== 'dir' && /^\.env(?:\.|$)/.test(base) && base !== ENV_EXAMPLE) hits.push(hitOf(file, 0, 'dotenv', file))
  if (kind !== 'dir' && (base === '.git-credentials' || base === '.netrc' || base === 'netrc')) {
    hits.push(hitOf(file, 0, 'git-credentials', file))
  }
  if (kind === 'file' && ARCHIVE.test(base)) hits.push(hitOf(file, 0, 'archive', file))
  if (kind === 'dir') {
    if ((file === 'data' || file.startsWith('data/')) && !DATA_DIRS.has(file)) hits.push(hitOf(file, 0, 'data-state', file))
  } else if (file.startsWith('data/')) {
    hits.push(hitOf(file, 0, 'data-state', file))
  }
  return hits
}

/**
 * Every hit in one file's text: the repository's privacy grep (emails excepted: public package
 * metadata carries author addresses, and the deny list's private names still catch the owner)
 * and every server rule.
 */
export function textHits(file, text, list, denied = denyMatcher(list.deny), { privacy = true } = {}) {
  const hits = []
  if (privacy) {
    for (const found of scan(file, text, list, denied)) {
      if (found.rule !== 'email') hits.push(hitOf(file, found.line, found.rule, found.match))
    }
  }
  for (const { rule, re, mask } of SERVER_RULES) {
    for (const match of text.matchAll(re)) hits.push(hitOf(file, lineOf(text, match.index), rule, match[0], mask(match[0])))
  }
  return hits
}

/** Home paths in a binary's strings (a text file's are in the privacy grep). */
export function homeHits(file, text) {
  const hits = []
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(HOME)) hits.push(hitOf(file, 0, 'home-path', match[0]))
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

/** Symlinks whose target is outside the rootfs (reported, not followed) or missing. */
export function symlinks(root, entries) {
  const external = []
  for (const entry of entries) {
    if (entry.kind !== 'symlink') continue
    const target = resolve(dirname(join(root, entry.file)), entry.target)
    if (!(target === root || target.startsWith(`${root}${sep}`))) external.push({ file: entry.file, target: entry.target, kind: 'external' })
    else if (!lstatSync(target, { throwIfNoEntry: false })) external.push({ file: entry.file, target: entry.target, kind: 'dangling' })
  }
  return external
}

/** Scan an extracted rootfs: inventory, names, contents and the /data rule; apply exact exceptions. */
export function scanTree(root, list = JSON.parse(readFileSync(LIST, 'utf8')), allowlist = loadAllowlist()) {
  const denied = denyMatcher(list.deny)
  const entries = walk(root)
  const raw = []
  let bytes = 0
  for (const entry of entries) {
    if (entry.kind !== 'file') {
      raw.push(...nameHits(entry.file, entry.kind))
      continue
    }
    bytes += entry.size
    let buf
    try {
      buf = readFileSync(join(root, entry.file))
    } catch (error) {
      raw.push(hitOf(entry.file, 0, 'unreadable', error.code ?? 'read failed'))
      continue
    }
    const digest = sha256(buf)
    const tagged = (hits) => hits.map((hit) => ({ ...hit, fileSha256: digest }))
    raw.push(...tagged(nameHits(entry.file, entry.kind)))
    const binary = buf.includes(0)
    const text = fileText(buf)
    raw.push(...tagged(textHits(entry.file, text, list, denied, { privacy: !binary })))
    if (binary) raw.push(...tagged(homeHits(entry.file, text)))
  }
  const applied = applyAllowlist(raw, allowlist)
  return { entries, hits: applied.kept, allowed: applied.allowed, unused: applied.unused, bytes, external: symlinks(root, entries) }
}

/** The image's own config (env and labels), scanned like a file; docker keeps no secret there. */
export function scanImageConfig(image, list, denied = denyMatcher(list.deny)) {
  const raw = execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .Config}}'], { encoding: 'utf8' })
  const hits = textHits('image-config', raw, list, denied)
  for (const line of JSON.parse(raw).Env ?? []) {
    const [name, ...rest] = line.split('=')
    const value = rest.join('=')
    if (value && /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) hits.push(hitOf('image-config', 0, 'env-secret', name))
  }
  return hits
}

/**
 * Export the image's rootfs into a work directory, read its layers (RootFS diff ids and the
 * docker-save manifest blobs) and never run it. `docker create` runs no entrypoint.
 */
export function extractImage(image, work = mkdtempSync(join(tmpdir(), 'automagik-secrecy-'))) {
  const tar = join(work, 'image.tar')
  const saved = join(work, 'image-save.tar')
  const rootfs = join(work, 'rootfs')
  mkdirSync(rootfs, { recursive: true })
  const name = `automagik-secrecy-${process.pid}`
  execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { stdio: 'pipe' })
  const layers = JSON.parse(execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .RootFS.Layers}}'], { encoding: 'utf8' }))
  let blobs = []
  try {
    execFileSync('docker', ['save', '--output', saved, image], { stdio: 'pipe' })
    blobs = JSON.parse(execFileSync('tar', ['-xOf', saved, 'manifest.json'], { encoding: 'utf8' }))[0]?.Layers ?? []
  } catch {
    blobs = []
  } finally {
    rmSync(saved, { force: true })
  }
  try {
    // A command lets docker create an image that declares no CMD (the self-check's imported
    // red image); it is never run, only exported.
    execFileSync('docker', ['create', '--name', name, image, '/bin/true'], { stdio: 'pipe' })
    execFileSync('docker', ['export', '--output', tar, name], { stdio: 'pipe' })
  } finally {
    try { execFileSync('docker', ['rm', '--force', name], { stdio: 'ignore' }) } catch {}
  }
  execFileSync('tar', ['-xf', tar, '-C', rootfs], { stdio: 'pipe' })
  rmSync(tar, { force: true })
  return { work, rootfs, layers, blobs }
}

/** Write what was checked: inventory, layers, exact allowlist used, external symlinks, findings. */
export function writeInventory(dir, { image, layers, blobs, entries, hits, allowed, unused, external }) {
  mkdirSync(dir, { recursive: true })
  const files = entries.map((entry) => {
    const target = entry.target ? ` -> ${entry.target}` : ''
    const size = entry.size !== undefined ? `\t${entry.size}` : ''
    return `${entry.kind}\t${entry.file}${size}${target}`
  })
  const layerLines = ['# RootFS.Layers (diff ids)', ...(layers ?? []), '', '# docker save manifest layers', ...(blobs ?? []), '']
  writeFileSync(join(dir, 'image-files.txt'), `${files.join('\n')}\n`)
  writeFileSync(join(dir, 'image-layers.txt'), layerLines.join('\n'))
  writeFileSync(join(dir, 'secrecy.txt'), hits.length
    ? `${hits.map((hit) => `${hit.file}:${hit.line}: ${hit.rule}: ${hit.match}`).join('\n')}\n`
    : 'clean\n')
  writeFileSync(join(dir, 'allowlist-used.txt'), allowed.length
    ? `${allowed.map((entry) => `${entry.file}: ${entry.rule} (${entry.count}): ${entry.reason}`).join('\n')}\n`
    : '')
  writeFileSync(join(dir, 'allowlist-unused.txt'), unused.length
    ? `${unused.map((entry) => `${entry.file}: ${entry.rule}: ${entry.reason}`).join('\n')}\n`
    : '')
  writeFileSync(join(dir, 'image-symlinks.txt'), external.length
    ? `${external.map((entry) => `${entry.kind}\t${entry.file} -> ${entry.target}`).join('\n')}\n`
    : '')
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

function report({ image, layers, blobs, entries, hits, allowed, unused, bytes, external }, inventory) {
  const files = entries.filter((entry) => entry.kind === 'file').length
  const symlinkCount = entries.filter((entry) => entry.kind === 'symlink').length
  const dirs = entries.filter((entry) => entry.kind === 'dir').length
  console.log(`[secrecy] ${image ?? 'rootfs'}`)
  if (layers) console.log(`[secrecy] layers: ${layers.length} RootFS, ${blobs?.length ?? 0} save-manifest blobs`)
  console.log(`[secrecy] files: ${files} (${mb(bytes)}), symlinks: ${symlinkCount} (${external.length} external/dangling), directories: ${dirs}`)
  console.log(`[secrecy] top-level: ${topLevel(entries).map(([name, count]) => `${name} ${count}`).join(', ')}`)
  console.log(`[secrecy] inventory: ${join(inventory, 'image-files.txt')}, layers: ${join(inventory, 'image-layers.txt')}, allowlist: ${join(inventory, 'allowlist-used.txt')}`)
  if (unused.length) console.warn(`[secrecy] warning: ${unused.length} allowlist entry(s) did not match; see ${join(inventory, 'allowlist-unused.txt')}`)
  for (const entry of allowed) console.log(`[secrecy] allowed: ${entry.file} ${entry.rule} (${entry.count}): ${entry.reason}`)
  if (hits.length) {
    for (const hit of hits) console.error(`${hit.file}:${hit.line}: ${hit.rule}: ${hit.match}`)
    console.error(`[secrecy] ${hits.length} finding(s): the image must not be pushed`)
    return false
  }
  console.log(`[secrecy] clean: 0 findings, ${allowed.length} exact allowlist hit(s), ${unused.length} unused`)
  return true
}

function summary({ image, layers, entries, hits, allowed, unused, external }, inventory, clean) {
  const target = process.env.GITHUB_STEP_SUMMARY
  if (!target) return
  const files = entries.filter((entry) => entry.kind === 'file').length
  const lines = [
    '### Server image secrecy',
    '',
    `- image: \`${image ?? 'rootfs'}\``,
    `- layers: ${layers?.length ?? 0}`,
    `- files checked: ${files}`,
    `- exact allowlist: ${allowed.length} used, ${unused.length} unused (\`${join(inventory, 'allowlist-used.txt')}\`)`,
    `- external/dangling symlinks: ${external.length}`,
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
    let blobs
    if (!rootfs) {
      extracted = extractImage(image)
      rootfs = extracted.rootfs
      layers = extracted.layers
      blobs = extracted.blobs
    }
    const tree = scanTree(rootfs, list)
    if (image) tree.hits.push(...scanImageConfig(image, list, denied))
    writeInventory(args.inventory, { image, layers, blobs, ...tree })
    const clean = report({ image, layers, blobs, ...tree }, args.inventory)
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
