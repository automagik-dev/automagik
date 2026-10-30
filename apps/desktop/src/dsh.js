// The DeepSeek Harness the app runs, as plain Node: where its home is, how the profile the
// app ships lands there, and the server process itself. Electron's main process
// (main.js) uses this; tests use it without Electron.
//
// Automagik's home is $AUTOMAGIK_HOME, else ~/.automagik (automagikHome). It holds the
// preload `omni desktop` and `genie desktop` write (preload), the builds they download
// (app/<tag>/), and everything the app keeps, under desktop/ (appHome):
//   dsh/   DSH_HOME: dsh's own Sessions, settings and the `omni` profile
//   bots/  the Bot team's home (AUTOMAGIK_BOTS_HOME), with the Omni link (bots/omni.json)
//   bin/   `node` and `pnpm` for dsh, both on Electron's own Node (writeTools)
// It is apart from a dsh you already run (~/.dsh) and from the Bot team installed into that
// one (~/.automagik/bots), so neither sees the other's Bots or Sessions. Omni's own folder
// (~/.omni: its sandbox, the Bun its channels download) is Omni's.
import { spawn } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { DEFAULTS as PRIVACY_DEFAULTS, privacyEnv } from './privacy.js'

export const PROFILE = 'omni'
const READY_TIMEOUT_MS = 120_000
const STOP_GRACE_MS = 8_000

const expandHome = text => (text === '~' ? homedir() : /^~[\\/]/.test(text) ? join(homedir(), text.slice(2)) : text)

/** Automagik's home: $AUTOMAGIK_HOME, else ~/.automagik. A blank value counts as unset. */
export function automagikHome(env = process.env) {
  return env.AUTOMAGIK_HOME?.trim() ? resolve(expandHome(env.AUTOMAGIK_HOME.trim())) : join(homedir(), '.automagik')
}

/** The app's own folder: desktop/ in Automagik's home. */
export const appHome = (env = process.env) => join(automagikHome(env), 'desktop')

// What the person chose to share (privacy.js), and the dsh overlay made from it at each launch.
export const privacyFileOf = home => join(home, 'privacy.json')
export const privacyPatchOf = home => join(home, 'privacy.patch.yml')
// DSH's anonymous id, sent with every DeepSeek request, kept in the DSH home; no setting
// stops it, so the app starts each launch without one and DSH makes a new one.
export const ANONYMOUS_ID = '.anonymous-user-id'

/** Where the runtime and the profile are: inside the app when packaged, build/ in a checkout. */
export function resourcesOf({ packaged, resourcesPath, appPath }) {
  const root = packaged ? resourcesPath : join(appPath, 'build')
  return {
    bin: join(root, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    pnpm: join(root, 'runtime', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    profile: join(root, 'profile'),
  }
}

const shellQuote = text => `'${String(text).replaceAll("'", `'\\''`)}'`

/**
 * Write `node` and `pnpm` into `dir` for dsh's PATH: dsh's plugin manager installs plugins
 * (the market, Settings → Plugins) with pnpm, and nothing guarantees a machine has Node or
 * pnpm. Both run on `node`, the app's own binary as Node (ELECTRON_RUN_AS_NODE). Written at
 * every launch, since the app's path changes with each install.
 */
export function writeTools({ dir, node, pnpm }) {
  mkdirSync(dir, { recursive: true })
  const tools = {
    node: `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(node)} "$@"`,
    pnpm: `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(node)} ${shellQuote(pnpm)} "$@"`,
  }
  for (const [name, line] of Object.entries(tools)) {
    const file = join(dir, name)
    writeFileSync(file, `#!/bin/sh\n# Written by the Automagik desktop app at launch (src/dsh.js writeTools).\n${line}\n`)
    chmodSync(file, 0o755)
  }
  return dir
}

// The top-level entries of a cordis patch file (a YAML list): each starts with "- " at the
// first column, runs over its indented lines, and takes the comment lines right above it.
function patchEntries(text) {
  const entries = []
  let comments = []
  let current = null
  for (const line of String(text).split('\n')) {
    if (line.startsWith('- ')) {
      current = { lines: [...comments, line], ids: [] }
      comments = []
      entries.push(current)
    } else if (line.startsWith('#')) {
      comments.push(line)
      continue
    } else if (current && /^\s+\S/.test(line)) {
      current.lines.push(line)
    } else {
      comments = []
      continue
    }
    const id = line.match(/^[\s-]*id:\s*['"]?([^'"\s#]+)/)
    if (id) current.ids.push(id[1])
  }
  return entries
}

const idsIn = text => new Set([...String(text).matchAll(/^[\s-]*id:\s*['"]?([^'"\s#]+)/gm)].map(match => match[1]))

/**
 * The user's profile patch with the shipped entries it lacks appended, or null when it
 * lacks none. An entry is missing when none of the ids it names appears in the user's file;
 * one the user has (changed or not) is theirs and stays. DSH's empty template (`[]`) is
 * replaced rather than appended to.
 */
export function mergeProfilePatch(user, shipped) {
  const have = idsIn(user)
  const missing = patchEntries(shipped).filter(entry => entry.ids.length > 0 && entry.ids.every(id => !have.has(id)))
  if (missing.length === 0) return null
  const added = missing.map(entry => entry.lines.join('\n')).join('\n')
  const base = String(user).replace(/^\[\]\s*$/m, '').replace(/\s*$/, '')
  return `${base === '' ? '' : `${base}\n`}${added}\n`
}

/**
 * Packages earlier builds shipped under another name: the Bot team and the welcome were
 * @automagik/omni-dsh and @automagik/omni-ai-dsh while they lived in Omni's repository. An
 * update moves a profile it finds from the old names to the new ones (installProfile), so
 * it does not run two copies of one plugin, and the user's settings rows keep applying:
 * DSH applies a profile row only to the package its `name` names.
 */
export const RENAMED = Object.freeze({
  '@automagik/omni-dsh': '@automagik/bots-dsh',
  '@automagik/omni-ai-dsh': '@automagik/welcome-dsh',
})

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * A cordis patch file's text with each renamed package's name moved to its new one, its
 * subpaths too (`@automagik/omni-dsh/web-search`); null when it names none of them.
 */
export function renamePatch(text, renamed = RENAMED) {
  let next = String(text)
  for (const [from, to] of Object.entries(renamed)) {
    next = next.replace(new RegExp(`(?<![\\w@/.-])${escapeRegExp(from)}(?![\\w.-])`, 'gm'), to)
  }
  return next === String(text) ? null : next
}

/** The renamed packages whose new name `shipped` (a profile package.json) carries. */
function renamedIn(shipped, renamed = RENAMED) {
  return Object.entries(renamed).filter(([, to]) => Object.hasOwn(shipped?.dependencies ?? {}, to)).map(([from]) => from)
}

/**
 * Move a profile from the renamed packages to their new names: the old packages leave
 * node_modules (the new ones arrive with the shipped packages), and the profile's patch and
 * DSH's own (DSH_HOME/cordis.patch.yml) name the new ones. Bots, chats, memory and the Omni
 * link are in the team's home, which no name is part of: nothing there moves.
 */
export function migrateRenamed({ target, dshHome, shipped, renamed = RENAMED }) {
  const moved = renamedIn(shipped, renamed)
  if (moved.length === 0) return []
  const changed = []
  for (const name of moved) {
    const dir = join(target, 'node_modules', ...name.split('/'))
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
      changed.push(dir)
    }
  }
  const only = Object.fromEntries(moved.map(name => [name, renamed[name]]))
  for (const file of [join(target, 'cordis.patch.yml'), join(dshHome, 'cordis.patch.yml')]) {
    if (!existsSync(file)) continue
    const next = renamePatch(readFileSync(file, 'utf8'), only)
    if (next !== null) {
      writeFileSync(file, next)
      changed.push(file)
    }
  }
  return changed
}

/**
 * Put the shipped profile in place under DSH_HOME/profiles/omni. It is copied, not
 * linked: dsh routes a plugin's imports to its own packages only for files inside the
 * profile. A profile already there from the same build (scripts/prepare-runtime.mjs stamps
 * each with .build-id) is left as it is. Another build's gets the new packages
 * (node_modules, package.json) and nothing else: dsh keeps the user's settings in that
 * folder too (models and preferences in cordis.patch.yml, .plugin-manager/), and an
 * update must not take them away. The shipped cordis.patch.yml only seeds a new profile.
 */
export function installProfile({ dshHome, source }) {
  const target = join(dshHome, 'profiles', PROFILE)
  const id = join(source, '.build-id')
  const stamp = existsSync(id) ? readFileSync(id, 'utf8') : readFileSync(join(source, 'package.json'), 'utf8')
  const marker = join(target, '.omni-desktop-profile')
  if (existsSync(marker) && readFileSync(marker, 'utf8') === stamp) return { target, installed: false }
  if (!existsSync(target)) {
    mkdirSync(join(dshHome, 'profiles'), { recursive: true })
    cpSync(source, target, { recursive: true })
  } else {
    // A profile from a build that shipped the Bot team or the welcome under its old name.
    migrateRenamed({ target, dshHome, shipped: readJson(join(source, 'package.json')) })
    // Only the packages the app ships are replaced: a plugin the user installed (the market,
    // Settings → Plugins) stays, with its dependencies, and in package.json.
    for (const name of packagesIn(join(source, 'node_modules'))) {
      rmSync(join(target, 'node_modules', name), { recursive: true, force: true })
      cpSync(join(source, 'node_modules', name), join(target, 'node_modules', name), { recursive: true })
    }
    // The tarballs in vendor/ are the app's (file:vendor/… in the shipped package.json), except
    // those a plugin the person installed names.
    const user = readJson(join(target, 'package.json'))
    const shipped = readJson(join(source, 'package.json'))
    const own = ownDependencies(user, shipped)
    const kept = new Set(own.map(([, spec]) => /^file:(?:\.\/)?vendor\/([^/]+)$/.exec(String(spec))?.[1]))
    for (const file of existsSync(join(target, 'vendor')) ? readdirSync(join(target, 'vendor')) : []) {
      if (!kept.has(file)) rmSync(join(target, 'vendor', file), { recursive: true, force: true })
    }
    if (existsSync(join(source, 'vendor'))) cpSync(join(source, 'vendor'), join(target, 'vendor'), { recursive: true })
    writeFileSync(join(target, 'package.json'), mergeProfilePackage(user, shipped))
    replaceLocks({ target, source, ownPlugins: own.length > 0 })
    if (existsSync(join(source, '.build-id'))) cpSync(join(source, '.build-id'), join(target, '.build-id'))
    for (const file of ['cordis.patch.yml', 'pnpm-workspace.yaml']) {
      if (!existsSync(join(target, file)) && existsSync(join(source, file))) cpSync(join(source, file), join(target, file))
    }
    // A setting a newer build ships (a new plugin's row, a seed) reaches an existing profile.
    const patch = join(target, 'cordis.patch.yml')
    const merged = mergeProfilePatch(readFileSync(patch, 'utf8'), readFileSync(join(source, 'cordis.patch.yml'), 'utf8'))
    if (merged !== null) writeFileSync(patch, merged)
  }
  writeFileSync(marker, stamp)
  return { target, installed: true }
}

/**
 * The lock and pnpm's records of node_modules must say what is installed, or the plugin
 * manager's next pnpm run in the profile fails on them or puts other versions back (pnpm add
 * re-resolves from them; its repair is pnpm install --frozen-lockfile). The app just put the
 * shipped packages in place, so the shipped build's own records come with them. When the person
 * installed plugins of their own, those records do not know them: the lock goes instead, and pnpm
 * resolves from package.json at its next run (node_modules/.modules.yaml stays, for its layout).
 */
function replaceLocks({ target, source, ownPlugins }) {
  const locks = ['pnpm-lock.yaml', join('node_modules', '.pnpm', 'lock.yaml')]
  if (ownPlugins) {
    for (const name of locks) rmSync(join(target, name), { force: true })
    return
  }
  for (const name of [...locks, join('node_modules', '.modules.yaml')]) {
    if (existsSync(join(source, name))) cpSync(join(source, name), join(target, name))
  }
}

/**
 * pnpm refuses to change a profile whose node_modules were linked from another store
 * (ERR_PNPM_UNEXPECTED_STORE): the shipped profile was installed on the build machine, and a
 * person's own pnpm config may name a store of its own. So the profile names the app's store
 * in its pnpm-workspace.yaml, which wins over the person's config, and its node_modules record
 * that store. Run at every launch: it also repairs a profile an earlier build left behind, and
 * never touches the person's pnpm config. `layout` is the store's folder for the app's pnpm
 * (v10 for pnpm 10, see storeLayoutOf). Returns the store path.
 */
export function pinProfileStore({ target, home, layout = 'v10' }) {
  const store = join(home, 'pnpm-store')
  const workspace = join(target, 'pnpm-workspace.yaml')
  const text = existsSync(workspace) ? readFileSync(workspace, 'utf8') : ''
  const line = `storeDir: ${JSON.stringify(store)}`
  const next = /^storeDir:.*$/m.test(text) ? text.replace(/^storeDir:.*$/m, line) : `${text.replace(/\s*$/, '')}${text.trim() ? '\n' : ''}${line}\n`
  if (next !== text) writeFileSync(workspace, next)
  // pnpm writes .modules.yaml as JSON; a store recorded there must be the one in use.
  const modules = join(target, 'node_modules', '.modules.yaml')
  const recorded = join(store, layout)
  if (existsSync(modules)) {
    const raw = readFileSync(modules, 'utf8')
    let fixed = raw
    try {
      const state = JSON.parse(raw)
      if (state.storeDir !== recorded) fixed = `${JSON.stringify({ ...state, storeDir: recorded }, null, 2)}\n`
    } catch {
      fixed = raw.replace(/^(\s*storeDir:\s*).*$/m, `$1${JSON.stringify(recorded)}`)
    }
    if (fixed !== raw) writeFileSync(modules, fixed)
  }
  return store
}

/** What a shipped profile records as its store until the app records its own at launch. */
export const SHIPPED_STORE = '<omni-desktop home>/pnpm-store'

/**
 * Take the build machine out of an installed profile before it ships: the store pnpm linked
 * it from (node_modules/.modules.yaml) and pnpm's cache of that machine's paths
 * (node_modules/.pnpm-workspace-state-v1.json, rebuilt on the next install).
 */
export function scrubBuildPaths(target) {
  const modules = join(target, 'node_modules', '.modules.yaml')
  if (existsSync(modules)) {
    const state = JSON.parse(readFileSync(modules, 'utf8'))
    writeFileSync(modules, `${JSON.stringify({ ...state, storeDir: SHIPPED_STORE }, null, 2)}\n`)
  }
  rmSync(join(target, 'node_modules', '.pnpm-workspace-state-v1.json'), { force: true })
}

/** The store folder pnpm uses for its major version: `v10` for pnpm 10.x. */
export function storeLayoutOf(pnpmCli) {
  const major = String(readJson(join(pnpmCli, '..', '..', 'package.json')).version ?? '').split('.')[0]
  return /^\d+$/.test(major) ? `v${major}` : 'v10'
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

// The packages in a node_modules folder, scoped ones as @scope/name; npm's and pnpm's own
// dot files are not packages.
function packagesIn(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(name => !name.startsWith('.')).flatMap(name =>
    name.startsWith('@') ? readdirSync(join(dir, name)).map(inner => `${name}/${inner}`) : [name])
}

// The dependencies the person added: neither shipped nor a shipped package under its old name.
function ownDependencies(user, shipped) {
  const replaced = new Set(renamedIn(shipped))
  return Object.entries(user?.dependencies ?? {}).filter(([name]) => !Object.hasOwn(shipped?.dependencies ?? {}, name) && !replaced.has(name))
}

/**
 * The shipped profile package.json with what the user added on top: dependencies and
 * bundles the shipped one does not name keep their place after the shipped ones.
 */
export function mergeProfilePackage(user, shipped) {
  const merged = structuredClone(shipped)
  const replaced = new Set(renamedIn(shipped))
  const extraDependencies = ownDependencies(user, shipped)
  if (extraDependencies.length > 0) merged.dependencies = { ...shipped.dependencies, ...Object.fromEntries(extraDependencies) }
  const shippedBundles = shipped.dsh?.profile?.bundles ?? []
  const extraBundles = (user?.dsh?.profile?.bundles ?? []).filter(name => !shippedBundles.includes(name) && !replaced.has(name))
  if (extraBundles.length > 0) merged.dsh.profile.bundles = [...shippedBundles, ...extraBundles]
  return `${JSON.stringify(merged, null, 2)}\n`
}

/**
 * The products the app can be opened for: `omni desktop` opens it for Omni, `genie desktop`
 * for Genie. A preload is a preference, not another build: the welcome (welcome-dsh) lists
 * that one first in its team step and starts with it chosen; the other stays a click away.
 */
export const PRELOADS = Object.freeze(['omni', 'genie'])
const PRELOAD_FILE = 'preload'

/** The preload a launch asks for: `--preload=<id>` or `--preload <id>`, else AUTOMAGIK_PRELOAD; null for none. */
export function preloadAsked(argv = [], env = {}) {
  let asked = null
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i])
    if (arg.startsWith('--preload=')) asked = arg.slice('--preload='.length)
    else if (arg === '--preload' && i + 1 < argv.length) asked = String(argv[++i])
  }
  asked ??= env.AUTOMAGIK_PRELOAD ?? null
  const id = typeof asked === 'string' ? asked.trim().toLowerCase() : ''
  return PRELOADS.includes(id) ? id : null
}

/**
 * The app's preload: the one this launch asks for, saved in the app's home so a later launch
 * from the Dock or a desktop entry (which passes no flags) keeps it; else the saved one; else
 * null, no preference. The installer never sees it: the launch that asks for it writes it.
 */
export function preloadOf({ home, argv = [], env = {} }) {
  const file = join(home, PRELOAD_FILE)
  const asked = preloadAsked(argv, env)
  if (asked) {
    mkdirSync(home, { recursive: true })
    if (!existsSync(file) || readFileSync(file, 'utf8').trim() !== asked) writeFileSync(file, `${asked}\n`)
    return asked
  }
  if (!existsSync(file)) return null
  const saved = readFileSync(file, 'utf8').trim()
  return PRELOADS.includes(saved) ? saved : null
}

/** A loopback port nobody listens on. */
export function freePort() {
  return new Promise((done, fail) => {
    const server = createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

/** The launch URL (with dsh's per-launch token) in a line of dsh's output, or null. */
export function launchUrlOf(text, port) {
  const match = String(text).match(/dsh web: (http:\/\/127\.0\.0\.1:(\d+)\/\S*token=\S+)/)
  if (!match || (port !== undefined && Number(match[2]) !== port)) return null
  return match[1]
}

/**
 * Drops every dsh login cookie the app's session kept for dsh's host. dsh names one per
 * host:port and keeps it for days, but cookies ignore the port, so each start on a new port added
 * one more to every request until dsh refused them all (431 Request Header Fields Too Large) and
 * the page stayed blank. The launch URL's token signs the page in again. `cookies` is a session's
 * cookies (get, remove); answers how many went.
 */
export async function forgetDshLogins(cookies, origin) {
  const { hostname } = new URL(origin)
  const logins = (await cookies.get({ domain: hostname })).filter(cookie => cookie.name.startsWith('dsh-auth-'))
  await Promise.all(logins.map(cookie => cookies.remove(`http://${hostname}${cookie.path ?? '/'}`, cookie.name)))
  return logins.length
}

/** The environment dsh runs with: its own home, Omni's, and nothing that phones home. */
/**
 * Where command-line tools that plugins drive install themselves. An app opened from the Dock
 * or a desktop launcher gets a bare PATH without them, so dsh-oh-my-claude could not start
 * Claude Code (which installs to ~/.local/bin) although it works in the person's terminal.
 */
export const toolDirs = (userHome = homedir()) => [join(userHome, '.local', 'bin'), join(userHome, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin']

export function dshEnv({ base = process.env, home, electronAsNode = false, binDir, userHome = homedir(), preload = null, privacy = PRIVACY_DEFAULTS }) {
  // After the machine's own: a project's commands keep the user's node and pnpm, and then the
  // usual tool folders, then the app's own node and pnpm.
  const PATH = [...String(base.PATH ?? '').split(delimiter), ...toolDirs(userHome), ...(binDir ? [binDir] : [])]
    .filter((dir, index, all) => dir !== '' && all.indexOf(dir) === index)
    .join(delimiter)
  return {
    ...base,
    PATH,
    DSH_HOME: join(home, 'dsh'),
    // The app's own team, apart from one in a dsh the person runs (bots-dsh folders.js).
    AUTOMAGIK_BOTS_HOME: join(home, 'bots'),
    // Signs in to an Omni as the desktop app (the Better Auth device-flow client id).
    OMNI_CLIENT_ID: 'omni-desktop',
    // The app answers the Bot team's browser bridge over dsh's IPC channel (startDsh): each Bot's
    // browser is in the window (bot-views.js), and the Bot drives it through bot-relay.js.
    AUTOMAGIK_APP_BROWSER: '1',
    // Nothing usable for training is reported unless the person chose to share it (privacy.js):
    // DSH's own opt-out, and the CLIs' analytics (npm's notice, OpenUI's).
    ...privacyEnv(privacy),
    // The Bot team's Privacy page saves the choices here; the app applies them at launch.
    AUTOMAGIK_PRIVACY_FILE: privacyFileOf(home),
    // The welcome keeps in it whether any agent is at work (welcome-dsh src/host/busy.js), so
    // an update installs while the person is away only when none is (idle.js).
    AUTOMAGIK_BUSY_FILE: busyFileOf(home),
    // The welcome reads it (welcome-dsh src/host/preload.js); none is no preference.
    ...(preload ? { AUTOMAGIK_PRELOAD: preload } : {}),
    ...(electronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  }
}

/** The file dsh's welcome keeps the count of running agents in (see dshEnv). */
export const busyFileOf = home => join(home, 'busy.json')

/**
 * Start dsh on 127.0.0.1:`port` and resolve with { child, url } once it prints its launch
 * URL. `node` is the executable that runs dsh: Electron itself (with ELECTRON_RUN_AS_NODE),
 * or a Node in tests. Output goes to `log` (a writable stream) when given. `onSpawn` gets
 * the process at once, so a quit while dsh starts can stop it, and the app can answer its
 * messages (the Bot browser bridge, main.js) from the start.
 */
export function startDsh({ node, bin, env, port, cwd, log, privacy, timeoutMs = READY_TIMEOUT_MS, onSpawn }) {
  const child = spawn(node, [bin, '--profile', PROFILE, ...(privacy ? ['--patch', privacy] : []), '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  onSpawn?.(child)
  const ready = new Promise((done, fail) => {
    let seen = ''
    const timer = setTimeout(() => fail(new Error(`dsh did not start within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)
    const onData = (chunk) => {
      log?.write(chunk)
      seen = `${seen}${chunk}`.slice(-4096)
      const url = launchUrlOf(seen, port)
      if (url) {
        clearTimeout(timer)
        done(url)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      fail(new Error(`dsh exited before it was ready (${signal ?? code})`))
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
  })
  return ready.then(url => ({ child, url }), (error) => {
    stopDsh(child)
    throw error
  })
}

/** Stop dsh: SIGTERM, then SIGKILL if it is still there after the grace period. */
export function stopDsh(child, graceMs = STOP_GRACE_MS) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((done) => {
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, graceMs)
    child.once('exit', () => {
      clearTimeout(timer)
      done()
    })
    try { child.kill('SIGTERM') } catch { done() }
  })
}

/**
 * The app's rules for every webContents it makes (main.js harden, on 'web-contents-created'):
 * window.open and off-origin links go to the system browser (`openExternal`), and a navigation
 * or a redirect off dsh's origin is refused. A Bot view (`isBotView`, bot-views.js) is left to
 * its own rules: its pages browse the web, and their new windows are the Bot's tabs.
 */
export function guardContents(contents, { origin, openExternal, isBotView = () => false }) {
  if (isBotView(contents)) return false
  contents.setWindowOpenHandler(({ url }) => {
    if (navigationOf(url, origin) === 'external') void openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    const verdict = navigationOf(url, origin)
    if (verdict === 'allow') return
    event.preventDefault()
    if (verdict === 'external') void openExternal(url)
  })
  // A server redirect is a navigation too.
  contents.on('will-redirect', (event, url) => {
    if (navigationOf(url, origin) !== 'allow') event.preventDefault()
  })
  contents.on('will-attach-webview', event => event.preventDefault())
  return true
}

/**
 * What the window may do with a URL. The app page and everything on its origin stays in
 * the window; web links (a wa.me link, docs, a channel's web page) open in the system
 * browser; anything else is refused.
 */
export function navigationOf(url, origin) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return 'deny'
  }
  if (parsed.origin === origin) return 'allow'
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') return 'external'
  return 'deny'
}
