// The plugin lane on the app's side: the plugins update without a new app. Every release posts
// a signed lane.json (scripts/lane.ts in the repository) naming the newest Automagik plugins and
// the tarball of each on its own versioned release. The app reads it with its update checks,
// checks the signature against the keys it was built with, and takes the plugins only when they
// run on this app (the same 3.N line, at or past their base) and on its DSH (their engines.dsh),
// are newer than what the profile has, and were never found bad. It downloads and checks each
// tarball (sha256, sha512 integrity, size) and unpacks it beside the profile, staged; the next
// start of the app puts them in place, before DSH starts. That start is a trial: the page must
// draw the Bot team within a while, or the previous plugins come back and that version is
// marked bad. Restart (the sidebar), a quit, or a start while away is that start.
//
// What it keeps, in <home>/lane: staged.json (what waits), applied.json (the trial or the last
// good one), bad.json (versions never to take again), and the folders: staged/<name>@<version>,
// and each replaced plugin as <its folder>.lane-prev until the trial passes.
import { createHash, createPublicKey, verify } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { compareVersions } from './update.js'
import { LANE_KEYS } from './lane-keys.js'

export const LANE_URL = 'https://github.com/automagik-dev/automagik/releases/download/plugin-lane/lane.json'
// Each publisher's lane, the keys it is signed with, and the plugins it may replace: a lane never
// touches another's. `sameLine`: its base is an app release, and the app takes it only on that
// 3.N line (Automagik's plugins are built against one app). Genie's plugin follows its own
// versions, and its base is the oldest app it runs on.
export const PUBLISHERS = Object.freeze([
  { publisher: 'automagik', url: LANE_URL, keys: LANE_KEYS.automagik, sameLine: true, plugins: ['@automagik/bots-dsh', '@automagik/welcome-dsh'] },
  { publisher: 'genie', url: 'https://github.com/automagik-dev/genie/releases/download/plugin-lane/lane.json', keys: LANE_KEYS.genie, sameLine: false, plugins: ['@automagik/genie-dsh'] },
])
const SCHEMA_VERSION = 1
const MAX_TARBALL = 64 * 1024 * 1024
const TIMEOUT_MS = 60_000
export const TRIAL_MS = 45_000

const fail = message => Object.assign(new Error(`lane: ${message}`), { code: 'lane' })
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback } }
const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`); renameSync(`${file}.tmp`, file) }
export const laneDir = home => join(home, 'lane')
const files = home => ({ staged: join(laneDir(home), 'staged.json'), applied: join(laneDir(home), 'applied.json'), bad: join(laneDir(home), 'bad.json'), dir: join(laneDir(home), 'staged') })

/** The lane in `bytes`, when `signature` (base64, detached ed25519) is one of `keys`'. */
export function verifyLane(bytes, signature, keys) {
  let lane
  try { lane = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw fail('lane.json is not JSON') }
  const key = keys.find(entry => entry.keyId === lane?.keyId)
  if (!key) throw fail(`no key ${lane?.keyId}`)
  if (!verify(null, Buffer.from(bytes), createPublicKey(key.publicKey), Buffer.from(String(signature).trim(), 'base64'))) throw fail('the signature does not match')
  if (lane.schemaVersion !== SCHEMA_VERSION) throw fail(`schema ${lane.schemaVersion}`)
  return lane
}

/** Whether `version` is in `range`: comparators (>=, >, <=, <, =) joined by spaces, all to hold. */
export function satisfies(version, range) {
  const parts = String(range ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return false
  return parts.every((part) => {
    const match = /^(>=|<=|>|<|=)?v?(.+)$/.exec(part)
    if (!match) return false
    const order = compareVersions(version, match[2])
    if (Number.isNaN(order)) return false
    return { '>=': order >= 0, '<=': order <= 0, '>': order > 0, '<': order < 0, '=': order === 0 }[match[1] ?? '=']
  })
}
const line = version => /^(\d+)\.(\d+)\./.exec(String(version))?.slice(1, 3).join('.')

/**
 * What this app takes from `lane`: { version, sequence, plugins } with the plugins it should
 * install, or null. `installed` names each plugin's version in the profile; `last` is the
 * sequence of the lane it took last (an older one is a rollback and refused); `bad` lists versions
 * a trial failed.
 */
export function laneUpdate(lane, { publisher, appVersion, dshVersion, installed, last = 0, bad = [] }) {
  if (!lane || lane.publisher !== publisher.publisher || !Number.isInteger(lane.sequence) || lane.sequence < last) return null
  if ((publisher.sameLine !== false && line(lane.base) !== line(appVersion)) || !(compareVersions(appVersion, lane.base) >= 0)) return null
  if (bad.includes(lane.version)) return null
  const plugins = (Array.isArray(lane.plugins) ? lane.plugins : []).filter(plugin => publisher.plugins.includes(plugin?.name)
    && typeof plugin.url === 'string' && plugin.url.startsWith('https://github.com/')
    && typeof installed[plugin.name] === 'string' && compareVersions(plugin.version, installed[plugin.name]) > 0
    && satisfies(dshVersion, plugin.engines?.dsh))
  return plugins.length > 0 ? { version: lane.version, sequence: lane.sequence, plugins } : null
}

/** The version each plugin of `names` has in the profile at `target`. */
export function installedVersions(target, names) {
  return Object.fromEntries(names.map(name => [name, readJson(join(target, 'node_modules', name, 'package.json'), {})?.version]).filter(([, version]) => typeof version === 'string'))
}

const integrityOf = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

/** Downloads, checks and unpacks `update`'s plugins under <home>/lane/staged, then records it waits. */
export async function stage(update, { home, fetch = globalThis.fetch, tar = 'tar' }) {
  const { dir, staged } = files(home)
  const ready = []
  for (const plugin of update.plugins) {
    const response = await fetch(plugin.url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw fail(`${plugin.name} ${plugin.version}: HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_TARBALL || (plugin.size && bytes.length !== plugin.size)) throw fail(`${plugin.name} ${plugin.version}: not the size the lane names`)
    if (createHash('sha256').update(bytes).digest('hex') !== plugin.sha256 || integrityOf(bytes) !== plugin.integrity) throw fail(`${plugin.name} ${plugin.version}: the tarball does not match the lane`)
    const into = join(dir, `${plugin.name.replace('/', '+')}@${plugin.version}`)
    rmSync(into, { recursive: true, force: true })
    mkdirSync(into, { recursive: true })
    const archive = `${into}.tgz`
    writeFileSync(archive, bytes)
    // npm pack puts everything under package/.
    execFileSync(tar, ['-xzf', archive, '-C', into, '--strip-components=1'], { stdio: 'ignore' })
    rmSync(archive, { force: true })
    if (readJson(join(into, 'package.json'), {})?.version !== plugin.version) throw fail(`${plugin.name}: the tarball holds another version`)
    ready.push({ name: plugin.name, version: plugin.version, dir: into })
  }
  writeJson(staged, { version: update.version, sequence: update.sequence, plugins: ready, at: new Date().toISOString() })
  return ready
}

/** What waits to go in, or null. */
export const stagedOf = home => readJson(files(home).staged, null)

/**
 * Before DSH starts: put the staged plugins in the profile at `target`, keeping each one they
 * replace beside it, and begin a trial; or, after a start whose trial never passed (a crash, a
 * page that never drew), put the previous ones back. Returns what it did: 'applied', 'restored',
 * 'trial' (a trial still runs this start) or null.
 */
export function beforeStart({ home, target, log = () => {} }) {
  const { applied: appliedFile, staged: stagedFile, bad: badFile } = files(home)
  const applied = readJson(appliedFile, null)
  if (applied?.pending) {
    // The start after a trial began is its second chance at most.
    if ((applied.starts ?? 0) >= 1) {
      restore(applied, log)
      writeJson(badFile, [...new Set([...readJson(badFile, []), applied.version])])
      writeJson(appliedFile, { ...applied, pending: false, restored: true })
      log(`lane: ${applied.version} did not come up; the previous plugins are back`)
      return 'restored'
    }
    writeJson(appliedFile, { ...applied, starts: (applied.starts ?? 0) + 1 })
    return 'trial'
  }
  const staged = readJson(stagedFile, null)
  if (!staged) return null
  const installed = installedVersions(target, staged.plugins.map(plugin => plugin.name))
  // A newer app brought newer plugins of its own: what was staged for the old one goes.
  const plugins = staged.plugins.filter(plugin => existsSync(plugin.dir) && installed[plugin.name] && compareVersions(plugin.version, installed[plugin.name]) > 0)
  rmSync(stagedFile, { force: true })
  if (plugins.length === 0) { rmSync(files(home).dir, { recursive: true, force: true }); return null }
  const moved = []
  try {
    for (const plugin of plugins) {
      const real = realpathSync(join(target, 'node_modules', plugin.name))
      const previous = `${real}.lane-prev`
      rmSync(previous, { recursive: true, force: true })
      renameSync(real, previous)
      moved.push({ name: plugin.name, real, previous })
      renameSync(plugin.dir, real)
    }
  } catch (error) {
    restore({ plugins: moved }, log)
    log(`lane: ${staged.version} could not be put in place (${error.message}); nothing changed`)
    return null
  }
  writeJson(appliedFile, { version: staged.version, sequence: staged.sequence, plugins: moved, pending: true, starts: 0, at: new Date().toISOString() })
  log(`lane: ${staged.version} is in place; this start is its trial`)
  return 'applied'
}

function restore(applied, log) {
  for (const plugin of applied.plugins ?? []) {
    if (!existsSync(plugin.previous)) continue
    try {
      rmSync(plugin.real, { recursive: true, force: true })
      renameSync(plugin.previous, plugin.real)
    } catch (error) {
      log(`lane: ${plugin.name} could not be put back: ${error.message}`)
    }
  }
}

/** The page drew the Bot team: the trial passed, and the plugins it replaced go. */
export function confirm(home) {
  const { applied: appliedFile } = files(home)
  const applied = readJson(appliedFile, null)
  if (!applied?.pending) return false
  for (const plugin of applied.plugins ?? []) rmSync(plugin.previous, { recursive: true, force: true })
  writeJson(appliedFile, { ...applied, pending: false, starts: undefined, confirmedAt: new Date().toISOString() })
  rmSync(files(home).dir, { recursive: true, force: true })
  return true
}

/** The trial failed within this start: the previous plugins come back at the next one. */
export function trialFailed(home) {
  const applied = readJson(files(home).applied, null)
  if (applied?.pending) writeJson(files(home).applied, { ...applied, starts: 1 })
}

/** The last lane this app took (a later one must not be older), and the versions found bad. */
export const laneMemory = home => ({ last: readJson(files(home).applied, null)?.sequence ?? 0, bad: readJson(files(home).bad, []) })

/** One look at a publisher's lane: fetch, verify, decide. */
export async function checkLane({ publisher, fetch = globalThis.fetch, ...context }) {
  const get = async (url) => {
    const response = await fetch(url, { headers: { 'user-agent': 'automagik-desktop' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw fail(`${url}: HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
  const [bytes, signature] = await Promise.all([get(publisher.url), get(`${publisher.url}.sig`)])
  return laneUpdate(verifyLane(bytes, signature.toString('utf8'), publisher.keys), { publisher, ...context })
}
