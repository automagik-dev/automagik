// Assembles what the packaged app carries next to Electron, in build/:
//
//   build/runtime/node_modules   the pinned DeepSeek Harness (runtime/package.json + lock)
//   build/profile/               the dsh profile the app starts: package.json, cordis.patch.yml,
//                                pnpm-workspace.yaml,
//                                and node_modules holding only Omni's plugins
//
// The plugins are the @automagik packages profile/package.json depends on, taken from Omni
// itself at the commit omni.json pins (the Omni release this app carries): its apps/*-dsh
// folders, packed with `npm pack` so the app ships exactly what each package publishes, and
// each at omni.json's version. Their @deepseek-ai peers are not installed again: dsh
// supplies them. OMNI_SOURCE points at a local Omni checkout instead, for development.
// Native packages are per platform, so run this on the platform you build for.
// Usage: node scripts/prepare-runtime.mjs [--skip-runtime]
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(APP, 'build')
const VENDOR = 'vendor'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// @openuidev/lang-core and others phone home from install scripts unless told not to.
const env = { ...process.env, DO_NOT_TRACK: '1', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_update_notifier: 'false' }
const run = (args, cwd) => execFileSync(npm, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] })
const git = (args, cwd) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const say = message => console.log(`[prepare-runtime] ${message}`)
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

const OMNI = readJson(join(APP, 'omni.json'))
// Omni at the pinned commit: only its plugin folders and the harness they are tested on.
function omniSource() {
  if (process.env.OMNI_SOURCE) return resolve(process.env.OMNI_SOURCE)
  const dir = join(BUILD, 'omni')
  const head = existsSync(join(dir, '.git')) ? git(['rev-parse', 'HEAD'], dir).trim() : ''
  if (head === OMNI.commit) return dir
  say(`fetching Omni ${OMNI.version} (${OMNI.commit.slice(0, 9)})`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  git(['init', '-q'], dir)
  git(['remote', 'add', 'origin', OMNI.repository], dir)
  git(['sparse-checkout', 'set', '--no-cone', '/apps/*-dsh/'], dir)
  git(['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', OMNI.commit], dir)
  git(['checkout', '-q', 'FETCH_HEAD'], dir)
  return dir
}
const OMNI_DIR = omniSource()

// Each plugin the profile depends on: Omni's own (an apps/*-dsh folder, packed at this Omni's
// version), an add-on from npm at the exact version the profile names (vetted there), or one
// from a reviewed fork at a pinned commit (`github:owner/repo#<40-hex>`), whose version the
// profile names under omni.addonVersions.
const profileJson = readJson(join(APP, 'profile', 'package.json'))
const profileDeps = profileJson.dependencies
const PINNED_GIT = /^github:[\w.-]+\/[\w.-]+#[0-9a-f]{40}$/
const apps = join(OMNI_DIR, 'apps')
const folders = Object.fromEntries(readdirSync(apps)
  .filter(name => name.endsWith('-dsh') && existsSync(join(apps, name, 'package.json')))
  .map(name => [readJson(join(apps, name, 'package.json')).name, join(apps, name)]))
const PLUGINS = {}
const ADDONS = {}
for (const [name, spec] of Object.entries(profileDeps)) {
  if (folders[name]) PLUGINS[name] = folders[name]
  else if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(spec)) ADDONS[name] = spec
  else if (PINNED_GIT.test(spec) && profileJson.omni?.addonVersions?.[name]) ADDONS[name] = profileJson.omni.addonVersions[name]
  else throw new Error(`profile/package.json depends on ${name}@${spec}: neither Omni's (apps/*-dsh) nor an add-on at an exact version or a pinned commit with its version in omni.addonVersions`)
}

// The DeepSeek Harness the app runs is the one Omni's plugins are tested against.
const tested = readJson(join(apps, 'omni-ui-dsh', 'dev', 'harness', 'package.json')).dependencies['@deepseek-ai/dsh']
const pinned = readJson(join(APP, 'runtime', 'package.json')).dependencies['@deepseek-ai/dsh']
if (tested !== pinned) throw new Error(`runtime/package.json pins dsh ${pinned}, but Omni ${OMNI.version} tests its plugins on ${tested}`)

const runtimeDir = join(BUILD, 'runtime')
if (!process.argv.includes('--skip-runtime') || !existsSync(join(runtimeDir, 'node_modules'))) {
  say('installing the pinned DeepSeek Harness')
  rmSync(runtimeDir, { recursive: true, force: true })
  mkdirSync(runtimeDir, { recursive: true })
  for (const file of ['package.json', 'package-lock.json']) {
    if (existsSync(join(APP, 'runtime', file))) cpSync(join(APP, 'runtime', file), join(runtimeDir, file))
  }
  run(existsSync(join(runtimeDir, 'package-lock.json')) ? ['ci', '--omit=dev'] : ['install', '--omit=dev'], runtimeDir)
  // A fresh lock is the one to commit (runtime/package-lock.json).
  if (!existsSync(join(APP, 'runtime', 'package-lock.json'))) cpSync(join(runtimeDir, 'package-lock.json'), join(APP, 'runtime', 'package-lock.json'))
}

say(`packing ${Object.keys(PLUGINS).join(', ')}`)
const packs = join(BUILD, 'packs')
rmSync(packs, { recursive: true, force: true })
mkdirSync(packs, { recursive: true })
const packed = Object.entries(PLUGINS).map(([name, dir]) => {
  const [info] = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', packs], { cwd: dir, env, encoding: 'utf8' }))
  if (info.name !== name) throw new Error(`${dir} packs ${info.name}, not ${name}`)
  if (info.version !== OMNI.version) throw new Error(`${name} is ${info.version}, not Omni's ${OMNI.version}`)
  return { name, version: info.version, tarball: join(packs, info.filename) }
})

// The profile is installed the way DSH installs any plugin: the pinned dsh's own
// `dsh plugin --profile omni install` (pnpm, hoisted, no install scripts) in a scratch DSH
// home, with the runtime's pinned pnpm first on PATH. The result, pnpm's lockfile with it,
// is the profile the app ships, so a plugin added later from the market lands the same way.
const dshHome = join(BUILD, 'dsh-home')
const installDir = join(dshHome, 'profiles', 'omni')
rmSync(dshHome, { recursive: true, force: true })
mkdirSync(join(installDir, VENDOR), { recursive: true })
const profile = JSON.parse(readFileSync(join(APP, 'profile', 'package.json'), 'utf8'))
// Omni's plugins ship as tarballs the package.json names by file: dsh's pnpm, installing a
// market plugin later, resolves them there, offline (they are not on npm).
for (const plugin of packed) {
  cpSync(plugin.tarball, join(installDir, VENDOR, basename(plugin.tarball)))
  profile.dependencies[plugin.name] = `file:${VENDOR}/${basename(plugin.tarball)}`
}
writeFileSync(join(installDir, 'package.json'), `${JSON.stringify(profile, null, 2)}\n`)
for (const file of ['cordis.patch.yml', 'pnpm-workspace.yaml']) cpSync(join(APP, 'profile', file), join(installDir, file))
say(`installing the profile with dsh plugin (${Object.keys(ADDONS).map(name => `${name}@${ADDONS[name]}`).join(', ') || 'no add-ons'})`)
execFileSync(process.execPath, [join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'plugin', '--profile', 'omni', 'install', '--prod', '--ignore-scripts'], {
  cwd: installDir,
  env: { ...env, DSH_HOME: dshHome, PATH: [join(runtimeDir, 'node_modules', '.bin'), env.PATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':') },
  stdio: ['ignore', 'inherit', 'inherit'],
})
for (const [name, version] of Object.entries(ADDONS)) {
  const installed = readJson(join(installDir, 'node_modules', ...name.split('/'), 'package.json')).version
  if (installed !== version) throw new Error(`${name} installed at ${installed}, not the vetted ${version}`)
}
// DSH's own record of the build's install (.plugin-manager) is not part of what ships.
rmSync(join(installDir, '.plugin-manager'), { recursive: true, force: true })
const profileDir = join(BUILD, 'profile')
rmSync(profileDir, { recursive: true, force: true })
cpSync(installDir, profileDir, { recursive: true, verbatimSymlinks: true })
rmSync(dshHome, { recursive: true, force: true })

// The app copies the profile into its home again whenever this id changes (src/dsh.js).
writeFileSync(join(profileDir, '.build-id'), `${packed.map(plugin => plugin.version).join('+')}+${new Date().toISOString()}\n`)

const versions = {
  dsh: JSON.parse(readFileSync(join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version,
  omni: OMNI.version,
  plugin: packed[0].version,
  plugins: Object.fromEntries(packed.map(plugin => [plugin.name, plugin.version])),
  addons: ADDONS,
}
writeFileSync(join(BUILD, 'versions.json'), `${JSON.stringify(versions, null, 2)}\n`)
say(`ready: dsh ${versions.dsh}, ${packed.map(plugin => `${plugin.name} ${plugin.version}`).join(', ')}`)
