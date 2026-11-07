#!/usr/bin/env node
// Fetch the plugin tarballs a release carries, and prove they are the release's bytes before
// they reach the image. The release's plugins.json says what each tarball is and its sha512
// integrity and size; PLUGINS.SHA256SUMS says its sha256, and plugins.json's own sha256. Both
// come from the same immutable release, and the build refuses a tarball that fails either.
//
//   node fetch-plugins.mjs --version 3.90.1 --out vendor
//     [--repository https://github.com/automagik-dev/automagik]
//     [--packages @automagik/bots-dsh,@automagik/welcome-dsh,@automagik/acp-dsh]
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_PACKAGES = ['@automagik/bots-dsh', '@automagik/welcome-dsh', '@automagik/acp-dsh']

/** The sha256 a sum file names a file by, or undefined. */
export function sumOf(sums, file) {
  for (const line of sums.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/.exec(line.trim())
    if (match && match[2] === file) return match[1]
  }
  return undefined
}

/** Refuse bytes that are not the release's: size, sha512 integrity, and the sum file's sha256. */
export function verifyTarball(bytes, entry, sha256) {
  if (bytes.byteLength !== entry.size) throw new Error(`${entry.file}: ${bytes.byteLength} bytes, not the release's ${entry.size}`)
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (integrity !== entry.integrity) throw new Error(`${entry.file}: sha512 integrity does not match plugins.json`)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (!sha256) throw new Error(`${entry.file}: not in PLUGINS.SHA256SUMS`)
  if (digest !== sha256) throw new Error(`${entry.file}: sha256 does not match PLUGINS.SHA256SUMS`)
  return digest
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function argsOf(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name.startsWith('--')) throw new Error(`unexpected argument: ${name}`)
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`${name} needs a value`)
    args[name.slice(2)] = value
    index += 1
  }
  return args
}

export async function fetchPlugins({ version, out, repository = 'https://github.com/automagik-dev/automagik', packages = DEFAULT_PACKAGES }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`not a release version: ${version}`)
  if (!/^https:\/\/[\w.-]+(?:\/[\w.-]+)+\/?$/.test(repository)) throw new Error(`not an https repository URL: ${repository}`)
  const base = `${repository.replace(/\/$/, '')}/releases/download/v${version}`
  const pluginsBytes = await download(`${base}/plugins.json`)
  const sums = (await download(`${base}/PLUGINS.SHA256SUMS`)).toString('utf8')
  const pluginsSum = sumOf(sums, 'plugins.json')
  if (!pluginsSum) throw new Error('PLUGINS.SHA256SUMS does not list plugins.json')
  const pluginsDigest = createHash('sha256').update(pluginsBytes).digest('hex')
  if (pluginsDigest !== pluginsSum) throw new Error('plugins.json: sha256 does not match PLUGINS.SHA256SUMS')
  const plugins = JSON.parse(pluginsBytes.toString('utf8'))
  if (plugins.version !== version) throw new Error(`plugins.json is for ${plugins.version}, not ${version}`)
  mkdirSync(out, { recursive: true })
  const fetched = {}
  for (const name of packages) {
    const entry = plugins.packages?.[name]
    if (!entry) throw new Error(`plugins.json lists no ${name}`)
    if (entry.version !== version) throw new Error(`${name} is ${entry.version}, not ${version}`)
    if (!/^[^/]+\.tgz$/.test(entry.file)) throw new Error(`${name}: unexpected file name ${entry.file}`)
    const bytes = await download(`${base}/${entry.file}`)
    const sha256 = verifyTarball(bytes, entry, sumOf(sums, entry.file))
    writeFileSync(join(out, entry.file), bytes, { mode: 0o644 })
    fetched[name] = { file: entry.file, version: entry.version, size: entry.size, sha256 }
  }
  return { version, plugins: fetched }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = argsOf(process.argv.slice(2))
    if (!args.version || !args.out) throw new Error('usage: node fetch-plugins.mjs --version <v> --out <dir> [--repository <url>] [--packages <a,b>]')
    const fetched = await fetchPlugins({
      version: args.version,
      out: args.out,
      repository: args.repository,
      packages: args.packages ? args.packages.split(',').map((name) => name.trim()).filter(Boolean) : DEFAULT_PACKAGES,
    })
    for (const [name, entry] of Object.entries(fetched.plugins)) console.log(`${name} ${entry.version} ${entry.file} ${entry.size} bytes sha256=${entry.sha256}`)
  } catch (error) {
    console.error(`fetch-plugins: ${error?.message ?? error}`)
    process.exit(1)
  }
}
