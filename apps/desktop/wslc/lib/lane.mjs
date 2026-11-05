// The plugin lane's last step, in the guest (RFC 0016, "The image": "Code updates ride the signed
// plugin lane"). Electron keeps every check of the lane (the signed pointer, sha256 and sha512,
// size, the 3.N line, engines.dsh, bad versions) and its own records on Windows. Once a lane
// update is verified there, it writes the tarballs into the exchange folder's lane/ and, last,
// handoff.json naming them (the contract: wslc/README.md, "The lane handoff"). Before DSH starts,
// the launcher takes that handoff: it stages each tarball with the desktop's own lane.js stage(),
// reading the exchange file instead of the network, so its checks (size, sha256, integrity, the
// version inside) also catch a copy damaged on the way; then lane.js beforeStart() puts them in
// the profile, keeps each replaced plugin as <folder>.lane-prev, and makes this start a trial.
// The launcher verifies no signature: the trust root stays in the signed app, which wrote the
// handoff. An agent in the guest could write one too, but it can already write its own profile.
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { PUBLISHERS, beforeStart, confirm, laneMemory, stage, trialFailed } from '../../src/lane.js'

export const HANDOFF = 'handoff.json'
const MAX_TARBALL = 64 * 1024 * 1024
const MAX_HANDOFF = 256 * 1024
const TARBALL = /^[A-Za-z0-9][\w.+-]*\.tgz$/
const VERSION = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/
const HEX64 = /^[0-9a-f]{64}$/
const INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/

const fail = message => Object.assign(new Error(`lane handoff: ${message}`), { code: 'handoff' })

/**
 * The handoff's plugins grouped by lane, checked for shape: `{ v: 1, lanes: { <publisher>:
 * { version, sequence } }, plugins: [{ publisher, name, version, file, size, sha256, integrity }] }`.
 * A publisher must be one the app knows and a plugin one its lane may replace (lane.js PUBLISHERS);
 * a file must be a bare .tgz name in lane/. Throws a handoff error otherwise.
 */
export function readHandoff(text) {
  let handoff
  try { handoff = JSON.parse(text) } catch { throw fail('not JSON') }
  if (handoff?.v !== 1) throw fail(`version ${JSON.stringify(handoff?.v)}, not 1`)
  if (!handoff.lanes || typeof handoff.lanes !== 'object' || !Array.isArray(handoff.plugins) || handoff.plugins.length === 0) throw fail('no lanes or no plugins')
  const groups = new Map()
  for (const plugin of handoff.plugins) {
    const known = PUBLISHERS.find(entry => entry.publisher === plugin?.publisher)
    if (!known) throw fail(`unknown publisher ${JSON.stringify(plugin?.publisher)}`)
    if (!known.plugins.includes(plugin.name)) throw fail(`${plugin.name} is not ${known.publisher}'s to replace`)
    const lane = handoff.lanes[known.publisher]
    if (!lane || !VERSION.test(String(lane.version)) || !Number.isInteger(lane.sequence)) throw fail(`no version and sequence for ${known.publisher}`)
    if (!VERSION.test(String(plugin.version))) throw fail(`${plugin.name}: bad version`)
    if (typeof plugin.file !== 'string' || !TARBALL.test(plugin.file) || basename(plugin.file) !== plugin.file) throw fail(`${plugin.name}: bad file name`)
    if (!Number.isInteger(plugin.size) || plugin.size <= 0 || plugin.size > MAX_TARBALL) throw fail(`${plugin.name}: bad size`)
    if (!HEX64.test(String(plugin.sha256)) || !INTEGRITY.test(String(plugin.integrity))) throw fail(`${plugin.name}: bad sha256 or integrity`)
    const group = groups.get(known.publisher) ?? { publisher: known.publisher, version: lane.version, sequence: lane.sequence, plugins: [] }
    group.plugins.push({ name: plugin.name, version: plugin.version, file: plugin.file, size: plugin.size, sha256: plugin.sha256, integrity: plugin.integrity })
    groups.set(known.publisher, group)
  }
  return [...groups.values()]
}

// lane.js stage() fetches each plugin's URL; here the URL is the tarball's file in lane/.
async function fileFetch(url) {
  const file = fileURLToPath(url)
  const { size } = statSync(file)
  if (size > MAX_TARBALL) return { ok: false, status: 413 }
  const bytes = await readFile(file)
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

/**
 * Take the handoff in `exchange`/lane, if there is one, and stage it under <home>/lane. The
 * handoff is removed before anything is staged, so it is taken once: one that cannot be removed
 * is left untaken. A version this guest already found bad is not staged again. The tarballs are
 * removed once staged. Answers { taken, staged: [<publisher>@<version>], skipped, error }.
 */
export async function takeHandoff({ exchange, home, tar, log = () => {} }) {
  const dir = join(exchange, 'lane')
  const file = join(dir, HANDOFF)
  if (!existsSync(file)) return { taken: false, staged: [], skipped: [] }
  let groups
  try {
    if (statSync(file).size > MAX_HANDOFF) throw fail('larger than 256 KiB')
    groups = readHandoff(readFileSync(file, 'utf8'))
  } catch (error) {
    // A handoff that is not one is not tried again at every start.
    try { rmSync(file, { force: true }) } catch {}
    return { taken: false, staged: [], skipped: [], error: error.message }
  }
  try {
    rmSync(file)
  } catch (error) {
    return { taken: false, staged: [], skipped: [], error: `lane handoff: cannot be removed, so not taken (${error.message})` }
  }
  const staged = []
  const skipped = []
  let failure
  for (const group of groups) {
    const label = `${group.publisher}@${group.version}`
    if (laneMemory(home, group.publisher).bad.includes(group.version)) {
      skipped.push(label)
      log('warn', `lane: ${label} was found bad here before; not staged`)
      continue
    }
    try {
      const plugins = group.plugins.map(plugin => ({ ...plugin, url: pathToFileURL(join(dir, plugin.file)).href }))
      await stage({ publisher: group.publisher, version: group.version, sequence: group.sequence, plugins }, { home, tar, fetch: fileFetch })
      staged.push(label)
    } catch (error) {
      failure ??= `${label}: ${error.message}`
    }
  }
  for (const plugin of groups.flatMap(group => group.plugins)) {
    try { rmSync(join(dir, plugin.file), { force: true }) } catch {}
  }
  return { taken: true, staged, skipped, ...(failure ? { error: failure } : {}) }
}

/**
 * The lane step of a start: take the handoff, then lane.js beforeStart() on the profile at
 * `target`. Answers what the `lane` frame reports: { state: 'applied' | 'restored' | 'trial' |
 * 'none', version?, staged, skipped, error? }.
 */
export async function laneStep({ exchange, home, target, tar, log = () => {} }) {
  const taken = await takeHandoff({ exchange, home, tar, log })
  if (taken.error) log('error', taken.error)
  let state = null
  try {
    state = beforeStart({ home, target, log: line => log('info', line) })
  } catch (error) {
    log('error', `lane: ${error.message}`)
    return { state: 'none', staged: taken.staged, skipped: taken.skipped, error: error.message }
  }
  const version = readVersion(join(home, 'lane', 'applied.json'))
  return { state: state ?? 'none', ...(state && version ? { version } : {}), staged: taken.staged, skipped: taken.skipped, ...(taken.error ? { error: taken.error } : {}) }
}

const readVersion = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')).version } catch { return undefined } }

/**
 * Electron's verdict on this start's trial: 'passed' (the page drew the Bot team: the replaced
 * plugins go) or 'failed' (the previous plugins come back at the next start, before DSH, as
 * lane.js does on the desktop). Answers whether a trial was pending.
 */
export function judgeTrial(home, verdict) {
  if (verdict === 'passed') return confirm(home)
  const applied = readJsonOr(join(home, 'lane', 'applied.json'))
  if (!applied?.pending) return false
  trialFailed(home)
  return true
}

const readJsonOr = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }
