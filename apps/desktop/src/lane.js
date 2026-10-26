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
// pnpm must see what the lane put in: a plugin manager install (pnpm add in the profile) resolves
// from the profile's package.json and lock, and would put the profile's own version back. So the
// staged tarball goes into the profile's vendor/ and package.json, pnpm-lock.yaml and pnpm's
// own records (node_modules/.pnpm/lock.yaml, node_modules/.modules.yaml) name it instead of the
// package it replaces (pinLanePackage); copies of the four wait beside the trial.
//
// What it keeps, in <home>/lane: staged.json (what waits, from every lane that has something),
// applied.json (the trial or the last good one), taken.json (the newest sequence taken from each
// lane), bad.json (versions never to take again, as <publisher>@<version>), and the folders:
// staged/<name>@<version>, and each replaced plugin as <its folder>.lane-prev until the trial
// passes. Each lane keeps its own sequence and failures: Genie's numbers are not Automagik's.
import { createHash, createPublicKey, verify } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { compareVersions } from './update.js'
import { LANE_KEYS } from './lane-keys.js'

export const LANE_URL = 'https://github.com/automagik-dev/automagik/releases/download/plugin-lane/lane.json'
// Each publisher's lane, the keys it is signed with, and the plugins it may replace: a lane never
// touches another's. `sameLine`: its base is an app release, and the app takes it only on that
// 3.N line (Automagik's plugins are built against one app). Genie's plugin follows its own
// versions, and its base is the oldest app it runs on. Automagik's lane also carries the add-ons
// the profile pins that have no dependencies of their own (its `addons`, scripts/lane.ts
// LANE_ADDONS), so a pin move needs no new app either.
export const PUBLISHERS = Object.freeze([
  { publisher: 'automagik', url: LANE_URL, keys: LANE_KEYS.automagik, sameLine: true, plugins: ['@automagik/bots-dsh', '@automagik/welcome-dsh', 'dsh-oh-my-claude'] },
  { publisher: 'genie', url: 'https://raw.githubusercontent.com/automagik-dev/genie/lane/lane.json', keys: LANE_KEYS.genie, sameLine: false, plugins: ['@automagik/genie-dsh'] },
])
const SCHEMA_VERSION = 1
const MAX_TARBALL = 64 * 1024 * 1024
const TIMEOUT_MS = 60_000
export const TRIAL_MS = 45_000

const fail = message => Object.assign(new Error(`lane: ${message}`), { code: 'lane' })
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback } }
const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`); renameSync(`${file}.tmp`, file) }
export const laneDir = home => join(home, 'lane')
const files = home => ({ staged: join(laneDir(home), 'staged.json'), applied: join(laneDir(home), 'applied.json'), taken: join(laneDir(home), 'taken.json'), bad: join(laneDir(home), 'bad.json'), dir: join(laneDir(home), 'staged') })

// The lanes a staged or applied record carries, { publisher: { version, sequence } }. A record
// from before each lane had its own holds one lane, named by its plugins.
function lanesOf(record) {
  if (!record) return {}
  if (record.lanes) return record.lanes
  const owner = PUBLISHERS.find(entry => (record.plugins ?? []).some(plugin => entry.plugins.includes(plugin.name)))?.publisher ?? 'automagik'
  return { [owner]: { version: record.version, sequence: record.sequence } }
}
// What a record is called: Automagik's version when it has one.
const labelOf = lanes => (lanes.automagik ?? Object.values(lanes)[0])?.version

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
  const listed = [lane.plugins, lane.addons].flatMap(entries => (Array.isArray(entries) ? entries : []))
  const plugins = listed.filter(plugin => publisher.plugins.includes(plugin?.name)
    && typeof plugin.url === 'string' && plugin.url.startsWith('https://github.com/')
    && typeof installed[plugin.name] === 'string' && compareVersions(plugin.version, installed[plugin.name]) > 0
    && satisfies(dshVersion, plugin.engines?.dsh))
  return plugins.length > 0 ? { publisher: publisher.publisher, version: lane.version, sequence: lane.sequence, plugins } : null
}

/** The version each plugin of `names` has in the profile at `target`. */
export function installedVersions(target, names) {
  return Object.fromEntries(names.map(name => [name, readJson(join(target, 'node_modules', name, 'package.json'), {})?.version]).filter(([, version]) => typeof version === 'string'))
}

const integrityOf = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

/**
 * Downloads, checks and unpacks `update`'s plugins under <home>/lane/staged, then records it
 * waits, beside what another lane staged. `onProgress(percent)` follows the download, by bytes
 * when the lane names sizes.
 */
export async function stage(update, { home, fetch = globalThis.fetch, tar = 'tar', onProgress = () => {} }) {
  const { dir, staged } = files(home)
  const publisher = update.publisher ?? 'automagik'
  const ready = []
  const total = update.plugins.reduce((sum, plugin) => sum + (plugin.size || 0), 0)
  let done = 0
  onProgress(0)
  for (const [index, plugin] of update.plugins.entries()) {
    const response = await fetch(plugin.url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw fail(`${plugin.name} ${plugin.version}: HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_TARBALL || (plugin.size && bytes.length !== plugin.size)) throw fail(`${plugin.name} ${plugin.version}: not the size the lane names`)
    if (createHash('sha256').update(bytes).digest('hex') !== plugin.sha256 || integrityOf(bytes) !== plugin.integrity) throw fail(`${plugin.name} ${plugin.version}: the tarball does not match the lane`)
    const into = join(dir, `${plugin.name.replace('/', '+')}@${plugin.version}`)
    rmSync(into, { recursive: true, force: true })
    mkdirSync(into, { recursive: true })
    // The tarball stays: it goes into the profile's vendor/ with the plugin.
    const archive = `${into}.tgz`
    writeFileSync(archive, bytes)
    // npm pack puts everything under package/.
    execFileSync(tar, ['-xzf', archive, '-C', into, '--strip-components=1'], { stdio: 'ignore' })
    if (readJson(join(into, 'package.json'), {})?.version !== plugin.version) throw fail(`${plugin.name}: the tarball holds another version`)
    ready.push({ publisher, name: plugin.name, version: plugin.version, dir: into, archive, integrity: plugin.integrity })
    done += plugin.size || 0
    onProgress(Math.floor(total > 0 ? (done / total) * 100 : ((index + 1) / update.plugins.length) * 100))
  }
  // What this lane staged before goes; another lane's stays.
  const before = readJson(staged, null)
  const earlier = (before?.plugins ?? []).map(plugin => ({ publisher: Object.keys(lanesOf(before))[0], ...plugin }))
  for (const plugin of earlier) {
    if (plugin.publisher !== publisher || ready.some(entry => entry.dir === plugin.dir)) continue
    rmSync(plugin.dir, { recursive: true, force: true })
    if (plugin.archive) rmSync(plugin.archive, { force: true })
  }
  const kept = earlier.filter(plugin => plugin.publisher !== publisher && existsSync(plugin.dir))
  const lanes = Object.fromEntries(Object.entries(lanesOf(before)).filter(([name]) => kept.some(plugin => plugin.publisher === name)))
  lanes[publisher] = { version: update.version, sequence: update.sequence }
  writeJson(staged, { version: labelOf(lanes), lanes, plugins: [...kept, ...ready], at: new Date().toISOString() })
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
      const failed = Object.entries(lanesOf(applied)).map(([publisher, { version }]) => `${publisher}@${version}`)
      writeJson(badFile, [...new Set([...readJson(badFile, []), ...failed])])
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
  const metadata = keepMetadata(home, target)
  try {
    for (const plugin of plugins) {
      const real = realpathSync(join(target, 'node_modules', plugin.name))
      const previous = `${real}.lane-prev`
      rmSync(previous, { recursive: true, force: true })
      renameSync(real, previous)
      moved.push({ name: plugin.name, real, previous })
      renameSync(plugin.dir, real)
      if (plugin.archive && existsSync(plugin.archive)) pinLanePackage(target, { name: plugin.name, version: plugin.version, integrity: plugin.integrity, archive: plugin.archive })
    }
  } catch (error) {
    restore({ plugins: moved, metadata }, log)
    log(`lane: ${staged.version} could not be put in place (${error.message}); nothing changed`)
    return null
  }
  const lanes = lanesOf(staged)
  writeJson(appliedFile, { version: labelOf(lanes), lanes, plugins: moved, metadata, pending: true, starts: 0, at: new Date().toISOString() })
  const { taken: takenFile } = files(home)
  const taken = readJson(takenFile, {})
  for (const [publisher, { sequence }] of Object.entries(lanes)) taken[publisher] = Math.max(taken[publisher] ?? 0, sequence ?? 0)
  writeJson(takenFile, taken)
  log(`lane: ${staged.version} is in place; this start is its trial`)
  return 'applied'
}

function restore(applied, log) {
  for (const { file, copy } of applied.metadata ?? []) {
    try {
      if (copy === null) rmSync(file, { force: true })
      else if (existsSync(copy)) { mkdirSync(dirname(file), { recursive: true }); copyFileSync(copy, file) }
    } catch (error) {
      log(`lane: ${file} could not be put back: ${error.message}`)
    }
  }
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
  rmSync(join(laneDir(home), 'metadata'), { recursive: true, force: true })
  // Nothing is kept to go back to once the trial passed: the record says so.
  const plugins = (applied.plugins ?? []).map(({ previous, ...plugin }) => plugin)
  writeJson(appliedFile, { ...applied, plugins, metadata: undefined, pending: false, starts: undefined, confirmedAt: new Date().toISOString() })
  rmSync(files(home).dir, { recursive: true, force: true })
  return true
}

/** The trial failed within this start: the previous plugins come back at the next one. */
export function trialFailed(home) {
  const applied = readJson(files(home).applied, null)
  if (applied?.pending) writeJson(files(home).applied, { ...applied, starts: 1 })
}

// The profile files pnpm resolves from, which a lane patch changes.
const METADATA = ['package.json', 'pnpm-lock.yaml', join('node_modules', '.pnpm', 'lock.yaml'), join('node_modules', '.modules.yaml')]

// Copies of the profile's metadata under <home>/lane/metadata, for a trial that fails. A file the
// profile does not have is recorded as null: putting it back removes it.
function keepMetadata(home, target) {
  const dir = join(laneDir(home), 'metadata')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return METADATA.map((name, index) => {
    const file = join(target, name)
    if (!existsSync(file)) return { file, copy: null }
    const copy = join(dir, String(index))
    copyFileSync(file, copy)
    return { file, copy }
  })
}

/** npm pack's file name for a package: the scope's @ dropped and its / made a dash. */
export const tarballOf = (name, version) => `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`

/**
 * Makes the profile at `target` name a lane's package the way pnpm would have installed it:
 * the tarball in vendor/, package.json's dependency `file:vendor/<tarball>`, and the lock and
 * pnpm's records moved from the package it replaced to that tarball. A lane patch changes no
 * field a plugin is installed by (scripts/lane.ts), so the tarball, its integrity and its version
 * are all that differ. A lock that already disagreed with package.json about it is dropped:
 * pnpm then resolves from package.json, which is right.
 */
export function pinLanePackage(target, { name, version, integrity, archive }) {
  const manifestFile = join(target, 'package.json')
  const manifest = readJson(manifestFile, {})
  const spec = manifest.dependencies?.[name]
  if (typeof spec !== 'string') return
  const file = tarballOf(name, version)
  const id = `file:vendor/${file}`
  mkdirSync(join(target, 'vendor'), { recursive: true })
  copyFileSync(archive, join(target, 'vendor', file))
  manifest.dependencies[name] = id
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
  // How pnpm writes the name in its YAML: quoted when scoped.
  const yamlName = text => (name.startsWith('@') ? `'${text}'` : text)
  let was = null
  for (const lock of [join(target, 'pnpm-lock.yaml'), join(target, 'node_modules', '.pnpm', 'lock.yaml')]) {
    if (!existsSync(lock)) continue
    let lines = readFileSync(lock, 'utf8').split('\n')
    // The profile's own entry for it: the specifier package.json had, and what it resolved to.
    const at = lines.indexOf(`      ${yamlName(name)}:`)
    const resolved = at === -1 || lines[at + 1] !== `        specifier: ${spec}` ? null : /^ {8}version: ([^(]+)/.exec(lines[at + 2] ?? '')?.[1]
    if (!resolved) { rmSync(lock, { force: true }); continue }
    lines[at + 1] = `        specifier: ${id}`
    lines = lines.join('\n').replaceAll(resolved, id).split('\n')
    // The package's own entry: its resolution and version are the tarball's.
    const head = lines.indexOf(`  ${yamlName(`${name}@${id}`)}:`)
    if (head === -1 || !lines[head + 1]?.startsWith('    resolution: ') || !lines[head + 2]?.startsWith('    version: ')) { rmSync(lock, { force: true }); continue }
    lines[head + 1] = `    resolution: {integrity: ${integrity}, tarball: ${id}}`
    lines[head + 2] = `    version: ${version}`
    writeFileSync(lock, lines.join('\n'))
    was ??= resolved
  }
  const modules = join(target, 'node_modules', '.modules.yaml')
  if (was && existsSync(modules)) writeFileSync(modules, readFileSync(modules, 'utf8').replaceAll(was, id))
}

/**
 * What this app remembers of `publisher`'s lane: the sequence it took last (a later one must not
 * be older) and the versions found bad.
 */
export function laneMemory(home, publisher = 'automagik') {
  const { applied, taken, bad } = files(home)
  const last = Math.max(readJson(taken, {})[publisher] ?? 0, lanesOf(readJson(applied, null))[publisher]?.sequence ?? 0)
  // A bare version is from before each lane kept its own: it was Automagik's.
  const versions = readJson(bad, []).map(entry => (/^\d/.test(entry) ? `automagik@${entry}` : entry))
  return { last, bad: versions.filter(entry => entry.startsWith(`${publisher}@`)).map(entry => entry.slice(publisher.length + 1)) }
}

/** The version `publisher`'s lane has waiting, if any. */
export const stagedVersion = (home, publisher) => lanesOf(stagedOf(home))[publisher]?.version

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
