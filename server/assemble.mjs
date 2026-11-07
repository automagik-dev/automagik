#!/usr/bin/env node
// Assemble what the server image carries, in the builder stage:
//
//   out/runtime/   the pinned DeepSeek Harness and the pnpm it installs plugins with
//                  (apps/desktop/runtime/package.json + lock, the desktop's own pins)
//   out/profile/   the automagik-web profile: dsh's base and web app, the Bot team, the
//                  welcome and ACP, installed by dsh's own plugin command from the release
//                  tarballs, with pnpm's store repointed at /data and build-only files gone
//   out/versions.json
//
// The release is pinned by --version (default 3.90.1); every tarball is checked against the
// release's plugins.json and PLUGINS.SHA256SUMS before it is installed. Run it in the image
// builder, where npm and the network exist; the runtime stage carries no package manager but
// the profile's own pnpm.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchPlugins, DEFAULT_PACKAGES } from './fetch-plugins.mjs'
import { profileDirOf, PROFILE, pinStore } from './lib.mjs'
import { pruneNodeModules } from '../apps/desktop/scripts/prune-runtime.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const RUNTIME_SOURCE = join(REPO, 'apps', 'desktop', 'runtime')
const PROFILE_SOURCE = join(HERE, 'profile')
const ENV = { ...process.env, DO_NOT_TRACK: '1', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_update_notifier: 'false' }

const say = (message) => console.log(`[assemble] ${message}`)
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const mib = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`

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

function run(command, args, options) {
  execFileSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options })
}

export async function assemble({ out, version = '3.90.1', dsh = '0.2.2-rc.1', repository = 'https://github.com/automagik-dev/automagik' }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`not a release version: ${version}`)
  const runtimeDir = join(out, 'runtime')
  const dshHome = join(out, 'dsh-home')
  const installDir = profileDirOf(dshHome)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(runtimeDir, { recursive: true })

  const pinned = readJson(join(RUNTIME_SOURCE, 'package.json')).dependencies?.['@deepseek-ai/dsh']
  if (pinned !== dsh) throw new Error(`apps/desktop/runtime pins dsh ${pinned}, not the image's ${dsh}`)
  for (const file of ['package.json', 'package-lock.json']) cpSync(join(RUNTIME_SOURCE, file), join(runtimeDir, file))
  say(`installing dsh ${dsh} and pnpm`)
  // npm 11.19 gates dependency install scripts behind allowScripts and skips them by default.
  // The runtime needs them: koffi's native module (dsh-subprocess-local, dsh-fs-local) and
  // node-pty's spawn helper. Every package is pinned by the desktop's lock, so the scripts it
  // names are the ones the desktop build runs.
  run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--dangerously-allow-all-scripts'], { cwd: runtimeDir, env: ENV })
  const installedDsh = readJson(join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')).version
  if (installedDsh !== dsh) throw new Error(`runtime installed dsh ${installedDsh}, not ${dsh}`)

  say(`fetching ${DEFAULT_PACKAGES.join(', ')} at ${version}`)
  mkdirSync(installDir, { recursive: true })
  const fetched = await fetchPlugins({ version, out: join(installDir, 'vendor'), repository })
  const profile = readJson(join(PROFILE_SOURCE, 'package.json'))
  for (const name of DEFAULT_PACKAGES) profile.dependencies[name] = `file:vendor/${fetched.plugins[name].file}`
  writeFileSync(join(installDir, 'package.json'), `${JSON.stringify(profile, null, 2)}\n`)
  for (const file of ['cordis.patch.yml', 'pnpm-workspace.yaml']) cpSync(join(PROFILE_SOURCE, file), join(installDir, file))

  say('installing the profile with dsh plugin')
  const path = [join(runtimeDir, 'node_modules', '.bin'), ENV.PATH].filter(Boolean).join(':')
  run(process.execPath, [join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'plugin', '--profile', PROFILE, 'install', '--prod', '--ignore-scripts'], {
    cwd: installDir,
    env: { ...ENV, DSH_HOME: dshHome, PATH: path },
  })

  for (const name of DEFAULT_PACKAGES) {
    const installed = readJson(join(installDir, 'node_modules', ...name.split('/'), 'package.json')).version
    if (installed !== version) throw new Error(`${name} installed at ${installed}, not the release's ${version}`)
  }

  // DSH's record of this build's install is not part of what ships; the profile is seeded at
  // the first start, not installed there.
  rmSync(join(installDir, '.plugin-manager'), { recursive: true, force: true })
  pinStore(installDir, '/data/dsh')

  // What the web profile never composes (proved by its --dump-config graph): the office
  // conversion wasm, the voice engine, the inspector, the alternate app bundles' optional
  // extras and the other platforms' native prebuilds. npm installs dsh's whole dependency
  // list; the automagik-web tree names none of these entries.
  const PRUNE = [
    // office-to-pdf is a composed entry (libreoffice-kit-wasm included), so its stack stays
    '@deepseek-ai/dsh-experimental-inspector', '@deepseek-ai/dsh-experimental-inspector-profile',
    '@deepseek-ai/dsh-experimental-session-inspector',
    '@deepseek-ai/dsh-experimental-client-ui-forge', '@deepseek-ai/dsh-experimental-forge',
    '@deepseek-ai/dsh-experimental-forge-bundle', '@deepseek-ai/dsh-experimental-forge-github',
    '@deepseek-ai/dsh-experimental-forge-session',
    '@deepseek-ai/dsh-experimental-liveshare', '@deepseek-ai/dsh-experimental-liveshare-protocol',
    '@deepseek-ai/dsh-experimental-agent-team', '@deepseek-ai/dsh-experimental-agent-team-profile',
    '@deepseek-ai/dsh-experimental-client-ui-agent-team', '@deepseek-ai/dsh-experimental-tool-agent-team',
    '@deepseek-ai/dsh-experimental-auto-review', '@deepseek-ai/dsh-experimental-badge-skill-bundle',
    '@deepseek-ai/dsh-experimental-cot-translation-bundle', '@deepseek-ai/dsh-experimental-client-ui-cot-translation',
    '@deepseek-ai/dsh-experimental-translator',
    '@deepseek-ai/dsh-experimental-voice-input-bundle', '@deepseek-ai/dsh-experimental-client-ui-voice-input',
    '@deepseek-ai/dsh-experimental-speech-to-text', '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
    '@deepseek-ai/dsh-experimental-api-speech-to-text', 'sherpa-onnx-linux-x64', 'sherpa-onnx-node',
    '@deepseek-ai/dsh-experimental-plugin-market-bundle', '@deepseek-ai/dsh-experimental-ralph-bundle',
    '@deepseek-ai/dsh-experimental-session-search', '@deepseek-ai/dsh-experimental-session-titles-bundle',
    '@deepseek-ai/dsh-experimental-terminal-bundle', '@deepseek-ai/dsh-experimental-tool-worktree',
    '@deepseek-ai/dsh-experimental-worktree',
    '@img/sharp-libvips-linuxmusl-x64', '@img/sharp-linuxmusl-x64',
    'node-pty/prebuilds/win32-arm64', 'node-pty/prebuilds/win32-x64',
    'node-pty/prebuilds/darwin-arm64', 'node-pty/prebuilds/darwin-x64', 'node-pty/prebuilds/linux-arm64',
  ]
  for (const name of PRUNE) rmSync(join(runtimeDir, 'node_modules', name), { recursive: true, force: true })

  say('pruning what the runtime and the profile nothing read')
  const runtimePruned = pruneNodeModules(join(runtimeDir, 'node_modules'), { keepDocsOf: (name) => name.startsWith('@deepseek-ai/') })
  const profilePruned = pruneNodeModules(join(installDir, 'node_modules'), {
    keepDocsOf: (name) => name.startsWith('@deepseek-ai/') || DEFAULT_PACKAGES.includes(name),
    docs: false,
  })
  say(`runtime: left out ${runtimePruned.files} files, ${mib(runtimePruned.bytes)}`)
  say(`profile: left out ${profilePruned.files} files, ${mib(profilePruned.bytes)}`)

  cpSync(installDir, join(out, 'profile'), { recursive: true, verbatimSymlinks: true })
  rmSync(dshHome, { recursive: true, force: true })
  writeFileSync(join(out, 'versions.json'), `${JSON.stringify({
    automagik: version,
    dsh: installedDsh,
    profile: PROFILE,
    plugins: Object.fromEntries(DEFAULT_PACKAGES.map((name) => [name, version])),
  }, null, 2)}\n`)
  return { out, version, dsh: installedDsh, runtime: runtimeDir }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = argsOf(process.argv.slice(2))
    if (!args.out) throw new Error('usage: node assemble.mjs --out <dir> [--version 3.90.1] [--dsh 0.2.2-rc.1] [--repository <url>]')
    const result = await assemble({ out: resolve(args.out), version: args.version, dsh: args.dsh, repository: args.repository })
    console.log(`[assemble] ready: dsh ${result.dsh}, automagik ${result.version}`)
  } catch (error) {
    console.error(`assemble: ${error?.stack ?? error}`)
    process.exit(1)
  }
}
