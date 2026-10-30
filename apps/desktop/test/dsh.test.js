import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { appHome, dshEnv, forgetDshLogins, freePort, guardContents, installProfile, launchUrlOf, mergeProfilePackage, mergeProfilePatch, migrateRenamed, navigationOf, pinProfileStore, preloadAsked, preloadOf, RENAMED, renamePatch, resourcesOf, scrubBuildPaths, SHIPPED_STORE, startDsh, stopDsh, storeLayoutOf, writeTools } from '../src/dsh.js'

test('the app keeps everything in one folder under ~/.automagik, apart from a dsh you already run', () => {
  assert.equal(appHome({}), join(homedir(), '.automagik', 'desktop'))
  assert.equal(appHome({ AUTOMAGIK_HOME: '/srv/automagik' }), '/srv/automagik/desktop')
  assert.equal(appHome({ AUTOMAGIK_HOME: '~/apps/automagik' }), join(homedir(), 'apps', 'automagik', 'desktop'))
  assert.equal(appHome({ AUTOMAGIK_HOME: ' ', OMNI_HOME: '/srv/omni', OMNI_DESKTOP_HOME: '/srv/old' }), join(homedir(), '.automagik', 'desktop'))
  const env = dshEnv({ base: { PATH: '/bin', DSH_HOME: '/home/me/.dsh' }, home: '/a/desktop', electronAsNode: true })
  assert.equal(env.DSH_HOME, '/a/desktop/dsh')
  assert.equal(env.AUTOMAGIK_BOTS_HOME, '/a/desktop/bots')
  // Omni's own folder is Omni's: the app names none, so its sandbox and downloads land in ~/.omni.
  assert.equal(env.OMNI_HOME, undefined)
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(env.DO_NOT_TRACK, '1')
  assert.equal(env.OMNI_CLIENT_ID, 'omni-desktop')
  // Nothing is reported: DSH's own opt-out (it does not read DO_NOT_TRACK), and the CLIs it runs.
  for (const name of ['DO_NOT_TRACK', 'DSH_TELEMETRY_DISABLED', 'DISABLE_TELEMETRY', 'OPENUI_TELEMETRY_DISABLED']) assert.equal(env[name], '1', name)
  assert.equal(env.AUTOMAGIK_PRIVACY_FILE, '/a/desktop/privacy.json')
  // A share the person switched on drops its own opt-out, and only its own.
  const sharing = dshEnv({ base: {}, home: '/a', privacy: { 'deepseek-feedback': true } })
  assert.equal(sharing.DSH_TELEMETRY_DISABLED, undefined)
  assert.equal(sharing.DISABLE_ERROR_REPORTING, '1')
  // Chosen nothing: Claude Code's own error reports work (not training data).
  assert.equal(env.DISABLE_ERROR_REPORTING, undefined)
  // The welcome counts the agents at work there, for an update while the person is away.
  assert.equal(env.AUTOMAGIK_BUSY_FILE, '/a/desktop/busy.json')
  // The person's PATH comes first; the usual tool folders follow (see toolDirs below).
  assert.ok(env.PATH.startsWith('/bin:'))
  assert.equal(dshEnv({ base: {}, home: '/a' }).ELECTRON_RUN_AS_NODE, undefined)
})

test('resources come from the app when packaged and from build/ in a checkout', () => {
  assert.deepEqual(resourcesOf({ packaged: true, resourcesPath: '/opt/Omni/resources', appPath: '/x' }), {
    bin: '/opt/Omni/resources/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
    pnpm: '/opt/Omni/resources/runtime/node_modules/pnpm/bin/pnpm.cjs',
    profile: '/opt/Omni/resources/profile',
  })
  assert.equal(resourcesOf({ packaged: false, resourcesPath: '/x', appPath: '/src/apps/omni-desktop' }).profile, '/src/apps/omni-desktop/build/profile')
})

test('the shipped profile seeds a new home, and a new build replaces only its packages', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-profile-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'shipped')
  mkdirSync(join(source, 'node_modules', '@automagik', 'omni-dsh'), { recursive: true })
  writeFileSync(join(source, 'package.json'), '{"dependencies":{"@automagik/omni-dsh":"0.1.7"}}')
  writeFileSync(join(source, 'cordis.patch.yml'), '[]')
  writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'v1')
  const dshHome = join(root, 'dsh')

  const first = installProfile({ dshHome, source })
  assert.equal(first.installed, true)
  assert.equal(first.target, join(dshHome, 'profiles', 'omni'))
  assert.equal(readFileSync(join(first.target, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'utf8'), 'v1')

  // dsh writes its own files into the profile; the same build leaves them be.
  writeFileSync(join(first.target, 'cordis.yml'), '[]')
  writeFileSync(join(first.target, 'cordis.patch.yml'), '- id: llm-pi-ai  # the user\'s models')
  mkdirSync(join(first.target, '.plugin-manager'))
  writeFileSync(join(first.target, '.plugin-manager', 'state.json'), '{}')
  assert.equal(installProfile({ dshHome, source }).installed, false)
  assert.equal(existsSync(join(first.target, 'cordis.yml')), true)

  writeFileSync(join(source, 'package.json'), '{"dependencies":{"@automagik/omni-dsh":"0.1.8"}}')
  writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'v2')
  // pnpm resolves the plugin manager's installs from the lock: the new build's comes with its packages.
  writeFileSync(join(source, 'pnpm-lock.yaml'), 'omni-dsh 0.1.8')
  writeFileSync(join(first.target, 'pnpm-lock.yaml'), 'omni-dsh 0.1.7')
  assert.equal(installProfile({ dshHome, source }).installed, true)
  assert.equal(readFileSync(join(first.target, 'pnpm-lock.yaml'), 'utf8'), 'omni-dsh 0.1.8')
  assert.equal(readFileSync(join(first.target, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'utf8'), 'v2')
  assert.deepEqual(JSON.parse(readFileSync(join(first.target, 'package.json'), 'utf8')), { dependencies: { '@automagik/omni-dsh': '0.1.8' } })
  // What dsh and the user put there survives the update.
  assert.equal(readFileSync(join(first.target, 'cordis.yml'), 'utf8'), '[]')

  // A build id, when the build stamped one, decides even with the same package.json.
  writeFileSync(join(source, '.build-id'), '0.1.8+one')
  assert.equal(installProfile({ dshHome, source }).installed, true)
  assert.equal(installProfile({ dshHome, source }).installed, false)
  writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'v3')
  writeFileSync(join(source, '.build-id'), '0.1.8+two')
  assert.equal(installProfile({ dshHome, source }).installed, true)
  assert.equal(readFileSync(join(first.target, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'utf8'), 'v3')
  assert.equal(readFileSync(join(first.target, 'cordis.patch.yml'), 'utf8'), '- id: llm-pi-ai  # the user\'s models')
  assert.equal(readFileSync(join(first.target, '.plugin-manager', 'state.json'), 'utf8'), '{}')
})

// pnpm refuses to change node_modules linked from another store (ERR_PNPM_UNEXPECTED_STORE),
// so a profile built on CI, or one a person's own pnpm config re-linked, could not take a
// plugin from the market.
const modulesYaml = storeDir => `${JSON.stringify({ layoutVersion: 5, nodeLinker: 'hoisted', storeDir, virtualStoreDir: '.pnpm' }, null, 2)}\n`
const WORKSPACE = '# What dsh writes\npackages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'

test('a shipped profile carries no build machine paths', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-scrub-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, 'node_modules', '.modules.yaml'), modulesYaml('/Users/runner/Library/pnpm/store/v10'))
  writeFileSync(join(root, 'node_modules', '.pnpm-workspace-state-v1.json'), '{"projects":{"/Users/runner/work/omni-desktop/build/dsh-home/profiles/omni":{}}}')
  scrubBuildPaths(root)
  const modules = readFileSync(join(root, 'node_modules', '.modules.yaml'), 'utf8')
  assert.equal(JSON.parse(modules).storeDir, SHIPPED_STORE)
  assert.equal(JSON.parse(modules).nodeLinker, 'hoisted')
  assert.doesNotMatch(modules, /runner/)
  assert.equal(existsSync(join(root, 'node_modules', '.pnpm-workspace-state-v1.json')), false)
})

test('the profile names the app\'s own pnpm store, and a profile linked from another store is repaired', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-store-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'desktop')
  const target = join(home, 'dsh', 'profiles', 'omni')
  mkdirSync(join(target, 'node_modules'), { recursive: true })
  writeFileSync(join(target, 'pnpm-workspace.yaml'), WORKSPACE)
  // What a person's own pnpm config left behind on the owner's Mac.
  writeFileSync(join(target, 'node_modules', '.modules.yaml'), modulesYaml('/tmp/khal-pnpm-store-repro/v10'))

  const store = pinProfileStore({ target, home, layout: 'v10' })
  assert.equal(store, join(home, 'pnpm-store'))
  const workspace = readFileSync(join(target, 'pnpm-workspace.yaml'), 'utf8')
  assert.ok(workspace.startsWith(WORKSPACE.trimEnd()), 'the shipped settings stay')
  assert.match(workspace, new RegExp(`^storeDir: ${JSON.stringify(store).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'm'))
  assert.equal(JSON.parse(readFileSync(join(target, 'node_modules', '.modules.yaml'), 'utf8')).storeDir, join(home, 'pnpm-store', 'v10'))

  // Again at the next launch: nothing changes, and there is still one storeDir line.
  const before = [readFileSync(join(target, 'pnpm-workspace.yaml'), 'utf8'), readFileSync(join(target, 'node_modules', '.modules.yaml'), 'utf8')]
  pinProfileStore({ target, home, layout: 'v10' })
  assert.deepEqual([readFileSync(join(target, 'pnpm-workspace.yaml'), 'utf8'), readFileSync(join(target, 'node_modules', '.modules.yaml'), 'utf8')], before)
  assert.equal(workspace.match(/^storeDir:/gm).length, 1)

  // A moved home (AUTOMAGIK_HOME) moves the store with it.
  const moved = join(root, 'elsewhere')
  pinProfileStore({ target, home: moved, layout: 'v10' })
  assert.equal(readFileSync(join(target, 'pnpm-workspace.yaml'), 'utf8').match(/^storeDir:.*$/gm).join(), `storeDir: ${JSON.stringify(join(moved, 'pnpm-store'))}`)
})

test('a profile without node_modules yet still gets the store, and the layout follows the app\'s pnpm', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-layout-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const target = join(root, 'profile')
  mkdirSync(target)
  pinProfileStore({ target, home: root })
  assert.equal(readFileSync(join(target, 'pnpm-workspace.yaml'), 'utf8'), `storeDir: ${JSON.stringify(join(root, 'pnpm-store'))}\n`)
  const pnpm = join(root, 'runtime', 'node_modules', 'pnpm')
  mkdirSync(join(pnpm, 'bin'), { recursive: true })
  writeFileSync(join(pnpm, 'package.json'), '{"version":"10.34.6"}')
  assert.equal(storeLayoutOf(join(pnpm, 'bin', 'pnpm.cjs')), 'v10')
  writeFileSync(join(pnpm, 'package.json'), '{"version":"11.0.1"}')
  assert.equal(storeLayoutOf(join(pnpm, 'bin', 'pnpm.cjs')), 'v11')
})

// The app opens on the Omni octopus (@automagik/welcome-dsh), not on DSH's own welcome
// notice and credential step.
test('the shipped profile bundles the Bot team first, Omni\'s plugins, the welcome and the plugin market, and switches DSH\'s own onboarding off', () => {
  const profile = JSON.parse(readFileSync(new URL('../profile/package.json', import.meta.url), 'utf8'))
  const omni = ['@automagik/bots-dsh', '@automagik/omni-channels-dsh', '@automagik/omni-canvas-dsh', '@automagik/welcome-dsh']
  // Omni's plugins first, then the add-ons that connect AI subscriptions, each a reviewed fork at
  // a pinned commit (the build checks it holds the version addonVersions names), bundled after.
  const addons = Object.keys(profile.omni.addonVersions)
  assert.deepEqual(Object.keys(profile.dependencies), [...omni, ...addons])
  for (const name of addons) assert.match(profile.dependencies[name], /^github:automagik-genie\/[\w.-]+#[0-9a-f]{40}$/)
  assert.deepEqual(profile.dsh.profile.bundles.filter(name => name.startsWith('@automagik/')), omni)
  assert.deepEqual(profile.dsh.profile.bundles.slice(-addons.length), addons)
  assert.ok(profile.dsh.profile.bundles.includes('@deepseek-ai/dsh-experimental-plugin-market-bundle'))
  const patch = readFileSync(new URL('../profile/cordis.patch.yml', import.meta.url), 'utf8')
  // DSH compares the notice version exactly, as a string.
  assert.match(patch, /^- id: ui-settings-general\n {2}config:\n {4}welcomeNoticeVersion: '2026-09-28\.1'$/m)
  assert.match(patch, /^- id: ui-settings-models\n {2}config:\n {4}credentialOnboarding: false$/m)
  // Automagik's market, where Genie is; pairing adds the Omni's market beside it
  // (apps/omni-channels-dsh omni-link.js).
  assert.match(patch, /^- id: plugin-market\n {2}config:\n {4}indexes:\n {6}- https:\/\/raw\.githubusercontent\.com\/automagik-dev\/dsh-marketplace\/main\/index\.json$/m)
  // Omni's dsh-subscriptions has no local-Ollama fallback to switch off.
  assert.doesNotMatch(patch, /ollamaFallback/)
})

test('the launch URL is read from dsh\'s output, only for the port it was given', () => {
  const line = 'starting…\ndsh web: http://127.0.0.1:41149/?token=abc123\n'
  assert.equal(launchUrlOf(line, 41149), 'http://127.0.0.1:41149/?token=abc123')
  assert.equal(launchUrlOf(line, 5000), null)
  assert.equal(launchUrlOf('dsh web: http://0.0.0.0:41149/?token=x', 41149), null)
  assert.equal(launchUrlOf('no url here'), null)
})

test('a start forgets the dsh logins earlier starts left, and nothing else of the host', async () => {
  // 70 of these came to 15.7 KB and dsh answered the page with 431; cookies ignore the port.
  const kept = [
    ...Array.from({ length: 70 }, (_, n) => ({ name: `dsh-auth-${'x'.repeat(43)}${n}`, domain: '127.0.0.1', path: '/' })),
    { name: 'theme', domain: '127.0.0.1', path: '/' },
  ]
  const asked = []
  const removed = []
  const cookies = {
    get: async (filter) => { asked.push(filter); return kept.filter(cookie => cookie.domain === filter.domain) },
    remove: async (url, name) => { removed.push([url, name]) },
  }
  assert.equal(await forgetDshLogins(cookies, 'http://127.0.0.1:57765'), 70)
  assert.deepEqual(asked, [{ domain: '127.0.0.1' }])
  assert.equal(removed.length, 70)
  assert.ok(removed.every(([url, name]) => url === 'http://127.0.0.1/' && name.startsWith('dsh-auth-')))
  assert.equal(await forgetDshLogins({ get: async () => [], remove: async () => assert.fail('nothing to remove') }, 'http://127.0.0.1:1'), 0)
})

test('the window stays on dsh\'s origin; web links go to the system browser; the rest is refused', () => {
  const origin = 'http://127.0.0.1:41149'
  assert.equal(navigationOf('http://127.0.0.1:41149/session/1', origin), 'allow')
  assert.equal(navigationOf('http://127.0.0.1:9999/', origin), 'external')
  assert.equal(navigationOf('https://wa.me/5511999990000?text=Omni%207KQ4-9XZP', origin), 'external')
  assert.equal(navigationOf('mailto:dev@namastex.ai', origin), 'external')
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'whatsapp://send?text=x', 'not a url']) assert.equal(navigationOf(url, origin), 'deny', url)
})

test('the app\'s pages send web links to the system browser; a Bot view keeps its own pages and tabs', () => {
  const origin = 'http://127.0.0.1:41149'
  const opened = []
  const contentsOf = (session) => {
    const contents = new EventEmitter()
    contents.session = session
    contents.setWindowOpenHandler = (handler) => { contents.openHandler = handler }
    return contents
  }
  const botSession = {}
  const guard = contents => guardContents(contents, { origin, openExternal: url => opened.push(url), isBotView: view => view.session === botSession })
  const navigate = (contents, url) => {
    let refused = false
    contents.emit('will-navigate', { preventDefault: () => { refused = true } }, url)
    return refused
  }

  const page = contentsOf({})
  assert.equal(guard(page), true)
  assert.deepEqual(page.openHandler({ url: 'https://example.com/' }), { action: 'deny' })
  assert.equal(navigate(page, 'https://example.com/next'), true)
  assert.equal(navigate(page, `${origin}/session/1`), false)
  assert.deepEqual(opened, ['https://example.com/', 'https://example.com/next'])

  // A Bot view gets none of it: its links and redirects stay in the view, nothing opens outside.
  const bot = contentsOf(botSession)
  assert.equal(guard(bot), false)
  assert.equal(bot.openHandler, undefined)
  assert.equal(bot.listenerCount('will-navigate') + bot.listenerCount('will-redirect'), 0)
  assert.equal(opened.length, 2)
})

test('dsh starts on the given loopback port, its URL resolves, and stopping ends it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-start-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  // A stand-in dsh: prints its launch line for the port and the profile it was given, then waits.
  const bin = join(root, 'fake-dsh.mjs')
  writeFileSync(bin, `
const args = process.argv.slice(2)
const port = args[args.indexOf('--port') + 1]
const profile = args[args.indexOf('--profile') + 1]
const host = args[args.indexOf('--host') + 1]
const patch = args.includes('--patch') ? args[args.indexOf('--patch') + 1] : 'none'
console.log('booting ' + profile + ' on ' + host + ' with ' + patch)
setTimeout(() => console.log('dsh web: http://127.0.0.1:' + port + '/?token=t0k3n'), 50)
setInterval(() => {}, 1000)
`)
  const port = await freePort()
  const lines = []
  const { child, url } = await startDsh({ node: process.execPath, bin, env: process.env, port, cwd: root, privacy: '/app/profile/privacy.patch.yml', log: { write: chunk => lines.push(String(chunk)) } })
  assert.equal(url, `http://127.0.0.1:${port}/?token=t0k3n`)
  // The privacy overlay goes on every launch, after the person's own profile patch.
  assert.match(lines.join(''), /booting omni on 127\.0\.0\.1 with \/app\/profile\/privacy\.patch\.yml/)
  await stopDsh(child)
  assert.notEqual(child.exitCode ?? child.signalCode, null)
})

test('a dsh that exits before it is ready is reported, and one that never says so times out', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-fail-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dies = join(root, 'dies.mjs')
  writeFileSync(dies, 'process.exit(3)')
  await assert.rejects(startDsh({ node: process.execPath, bin: dies, env: process.env, port: await freePort(), cwd: root }), /exited before it was ready \(3\)/)
  const silent = join(root, 'silent.mjs')
  writeFileSync(silent, 'setInterval(() => {}, 1000)')
  await assert.rejects(startDsh({ node: process.execPath, bin: silent, env: process.env, port: await freePort(), cwd: root, timeoutMs: 300 }), /did not start within/)
})

test('dsh gets node and pnpm on its PATH, both on the app\'s own Node', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-tools-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const script = join(root, "it's pnpm.cjs")
  writeFileSync(script, 'console.log(JSON.stringify([process.env.ELECTRON_RUN_AS_NODE, ...process.argv.slice(2)]))')
  const dir = writeTools({ dir: join(root, 'bin'), node: process.execPath, pnpm: script })
  assert.deepEqual(JSON.parse(execFileSync(join(dir, 'pnpm'), ['add', 'a b'], { encoding: 'utf8' })), ['1', 'add', 'a b'])
  assert.equal(execFileSync(join(dir, 'node'), ['-p', '6*7'], { encoding: 'utf8' }).trim(), '42')
  const tools = '/u/.local/bin:/u/.claude/local:/opt/homebrew/bin:/usr/local/bin'
  assert.equal(dshEnv({ base: { PATH: '/bin' }, home: '/a', binDir: dir, userHome: '/u' }).PATH, `/bin:${tools}:${dir}`)
  assert.equal(dshEnv({ base: { PATH: '/bin' }, home: '/a', userHome: '/u' }).PATH, `/bin:${tools}`)
  // A folder already on the person's PATH keeps its place and is not repeated.
  assert.equal(dshEnv({ base: { PATH: '/usr/local/bin:/bin' }, home: '/a', userHome: '/u' }).PATH, '/usr/local/bin:/bin:/u/.local/bin:/u/.claude/local:/opt/homebrew/bin')
})

test('an update adds the settings a newer build ships and keeps every one the user has', () => {
  const shipped = `# Omni's own search.
- insert:
    - id: web-search-auto
      name: x
- id: web
  config:
    searchProvider: auto
# The octopus opens the app.
- id: ui-settings-models
  config:
    credentialOnboarding: false
`
  // DSH's empty template takes every shipped entry, comments and all.
  assert.equal(mergeProfilePatch('[]\n', shipped), shipped)
  // An entry the user has, changed or not, stays theirs; only the missing one is added.
  const user = `- id: web\n  config:\n    searchProvider: brave\n- insert:\n    - id: web-search-auto\n      name: x\n`
  assert.equal(
    mergeProfilePatch(user, shipped),
    `${user}# The octopus opens the app.\n- id: ui-settings-models\n  config:\n    credentialOnboarding: false\n`,
  )
  assert.equal(mergeProfilePatch(shipped, shipped), null)
})

test('an existing profile gets pnpm settings and the newer build\'s settings on update', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-migrate-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'shipped')
  mkdirSync(join(source, 'node_modules'), { recursive: true })
  writeFileSync(join(source, 'package.json'), '{}')
  writeFileSync(join(source, '.build-id'), 'one')
  writeFileSync(join(source, 'cordis.patch.yml'), '- id: web\n  config:\n    searchProvider: auto\n')
  const dshHome = join(root, 'dsh')
  const { target } = installProfile({ dshHome, source })
  // An install from before pnpm-workspace.yaml shipped, with the user's own search.
  rmSync(join(target, 'pnpm-workspace.yaml'), { force: true })
  writeFileSync(join(target, 'cordis.patch.yml'), '- id: web\n  config:\n    searchProvider: brave\n')
  writeFileSync(join(source, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')
  writeFileSync(join(source, 'cordis.patch.yml'), '- id: web\n  config:\n    searchProvider: auto\n- id: plugin-market\n  config:\n    indexes: []\n')
  writeFileSync(join(source, '.build-id'), 'two')
  installProfile({ dshHome, source })
  assert.equal(readFileSync(join(target, 'pnpm-workspace.yaml'), 'utf8'), 'nodeLinker: hoisted\n')
  assert.equal(
    readFileSync(join(target, 'cordis.patch.yml'), 'utf8'),
    '- id: web\n  config:\n    searchProvider: brave\n- id: plugin-market\n  config:\n    indexes: []\n',
  )
})

test('an update replaces the packages the app ships and keeps the plugins the user installed', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-keep-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'shipped')
  const shippedPackage = (version) => ({ dependencies: { '@automagik/omni-dsh': version }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@automagik/omni-dsh'] } } })
  mkdirSync(join(source, 'node_modules', '@automagik', 'omni-dsh'), { recursive: true })
  writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'v1')
  writeFileSync(join(source, 'package.json'), JSON.stringify(shippedPackage('1')))
  writeFileSync(join(source, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(source, '.build-id'), 'one')
  const dshHome = join(root, 'dsh')
  const { target } = installProfile({ dshHome, source })
  // The user installs a market plugin: dsh's pnpm adds it, and its own dependency, beside Omni's.
  mkdirSync(join(target, 'node_modules', 'dsh-kimi-subscription'), { recursive: true })
  mkdirSync(join(target, 'node_modules', '@automagik', 'their-plugin'), { recursive: true })
  const user = shippedPackage('1')
  user.dependencies['dsh-kimi-subscription'] = '1.3.10'
  user.dependencies['their-plugin'] = 'file:vendor/their-plugin-1.0.0.tgz'
  user.dsh.profile.bundles.push('dsh-kimi-subscription')
  writeFileSync(join(target, 'package.json'), JSON.stringify(user))

  writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'v2')
  writeFileSync(join(source, 'package.json'), JSON.stringify(shippedPackage('2')))
  // The tarballs package.json names (file:vendor/…) come with the build.
  mkdirSync(join(source, 'vendor'), { recursive: true })
  writeFileSync(join(source, 'vendor', 'omni-dsh-2.tgz'), 'two')
  mkdirSync(join(target, 'vendor'), { recursive: true })
  writeFileSync(join(target, 'vendor', 'omni-dsh-1.tgz'), 'one')
  writeFileSync(join(target, 'vendor', 'their-plugin-1.0.0.tgz'), 'theirs')
  // The shipped lock does not know the user's plugins: pnpm resolves from package.json instead.
  writeFileSync(join(source, 'pnpm-lock.yaml'), 'shipped')
  writeFileSync(join(target, 'pnpm-lock.yaml'), 'stale')
  writeFileSync(join(source, '.build-id'), 'two')
  installProfile({ dshHome, source })
  assert.deepEqual(readdirSync(join(target, 'vendor')).sort(), ['omni-dsh-2.tgz', 'their-plugin-1.0.0.tgz'])
  assert.equal(existsSync(join(target, 'pnpm-lock.yaml')), false)
  assert.equal(readFileSync(join(target, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'utf8'), 'v2')
  assert.equal(existsSync(join(target, 'node_modules', 'dsh-kimi-subscription')), true)
  assert.equal(existsSync(join(target, 'node_modules', '@automagik', 'their-plugin')), true)
  const merged = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  assert.deepEqual(merged.dependencies, { '@automagik/omni-dsh': '2', 'dsh-kimi-subscription': '1.3.10', 'their-plugin': 'file:vendor/their-plugin-1.0.0.tgz' })
  assert.deepEqual(merged.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@automagik/omni-dsh', 'dsh-kimi-subscription'])
  // Nothing added: the shipped package.json as it is.
  assert.deepEqual(JSON.parse(mergeProfilePackage(shippedPackage('2'), shippedPackage('3'))), shippedPackage('3'))
})

// Builds up to 2.261023.x (automagik-dev/omni-desktop) shipped the Bot team and the welcome
// as @automagik/omni-dsh and @automagik/omni-ai-dsh. An update into this app finds such a
// profile: it must end with the new packages only, the user's rows naming them, and the
// team's home untouched.
test('an update moves a profile from the renamed packages to the new ones and keeps everything else', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-rename-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dshHome = join(root, 'dsh')
  const target = join(dshHome, 'profiles', 'omni')
  const old = ['@automagik/omni-dsh', '@automagik/omni-channels-dsh', '@automagik/omni-canvas-dsh', '@automagik/omni-ai-dsh']
  for (const name of [...old, 'dsh-kimi-subscription']) {
    mkdirSync(join(target, 'node_modules', ...name.split('/')), { recursive: true })
    writeFileSync(join(target, 'node_modules', ...name.split('/'), 'index.js'), 'old')
  }
  writeFileSync(join(target, 'package.json'), JSON.stringify({
    dependencies: { ...Object.fromEntries(old.map(name => [name, `file:vendor/${name.slice(11)}-2.261023.32.tgz`])), 'dsh-kimi-subscription': '1.3.10' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', ...old, 'dsh-kimi-subscription'] } },
  }))
  // The user's settings: rows DSH's Settings wrote for the team (by package name), the web
  // search the app inserted, and the user's own model setup.
  writeFileSync(join(target, 'cordis.patch.yml'), [
    '- insert:', '    - id: web-search-auto', "      name: '@automagik/omni-dsh/web-search'",
    '- id: omni-ui', "  name: '@automagik/omni-dsh'", '  config:', '    checkRatio: 0.7', '    memoryReview: false',
    '- id: omni-ai', "  name: '@automagik/omni-ai-dsh'", '  config:', '    welcomeDone: true',
    '- id: llm-pi-ai', '  config:', '    routes: [juice]', '',
  ].join('\n'))
  writeFileSync(join(target, '.omni-desktop-profile'), 'old build')
  writeFileSync(join(dshHome, 'cordis.patch.yml'), "- id: omni-ui\n  name: '@automagik/omni-dsh'\n  config:\n    browser: false\n")
  // The team's home: Bots, chats, memory and the Omni link.
  const team = join(root, 'ui')
  mkdirSync(join(team, 'memory'), { recursive: true })
  writeFileSync(join(team, 'state.json'), '{"version":1,"bots":[{"id":"omni"}]}')
  writeFileSync(join(team, 'omni.json'), '{"url":"https://omni.example"}')

  const source = join(root, 'shipped')
  const fresh = ['@automagik/bots-dsh', '@automagik/omni-channels-dsh', '@automagik/omni-canvas-dsh', '@automagik/welcome-dsh']
  for (const name of fresh) {
    mkdirSync(join(source, 'node_modules', ...name.split('/')), { recursive: true })
    writeFileSync(join(source, 'node_modules', ...name.split('/'), 'index.js'), 'new')
  }
  writeFileSync(join(source, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries(fresh.map(name => [name, 'file:vendor/x.tgz'])), dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', ...fresh] } } }))
  writeFileSync(join(source, 'cordis.patch.yml'), readFileSync(new URL('../profile/cordis.patch.yml', import.meta.url), 'utf8'))
  writeFileSync(join(source, '.build-id'), 'new build')

  assert.equal(installProfile({ dshHome, source }).installed, true)
  const merged = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  assert.deepEqual(Object.keys(merged.dependencies), [...fresh, 'dsh-kimi-subscription'])
  assert.deepEqual(merged.dsh.profile.bundles, ['@deepseek-ai/dsh-base', ...fresh, 'dsh-kimi-subscription'])
  assert.equal(existsSync(join(target, 'node_modules', '@automagik', 'omni-dsh')), false)
  assert.equal(existsSync(join(target, 'node_modules', '@automagik', 'omni-ai-dsh')), false)
  for (const name of fresh) assert.equal(readFileSync(join(target, 'node_modules', ...name.split('/'), 'index.js'), 'utf8'), 'new')
  assert.equal(readFileSync(join(target, 'node_modules', 'dsh-kimi-subscription', 'index.js'), 'utf8'), 'old')
  const patch = readFileSync(join(target, 'cordis.patch.yml'), 'utf8')
  assert.doesNotMatch(patch, /omni-dsh|omni-ai-dsh/)
  assert.match(patch, /^- id: omni-ui\n {2}name: '@automagik\/bots-dsh'\n {2}config:\n {4}checkRatio: 0\.7\n {4}memoryReview: false$/m)
  assert.match(patch, /name: '@automagik\/bots-dsh\/web-search'/)
  assert.match(patch, /^- id: omni-ai\n {2}name: '@automagik\/welcome-dsh'\n {2}config:\n {4}welcomeDone: true$/m)
  assert.match(patch, /routes: \[juice\]/)
  assert.equal(readFileSync(join(dshHome, 'cordis.patch.yml'), 'utf8'), "- id: omni-ui\n  name: '@automagik/bots-dsh'\n  config:\n    browser: false\n")
  assert.equal(readFileSync(join(team, 'state.json'), 'utf8'), '{"version":1,"bots":[{"id":"omni"}]}')
  assert.equal(readFileSync(join(team, 'omni.json'), 'utf8'), '{"url":"https://omni.example"}')
  // Run again (the next launch of the same build): nothing left to move.
  assert.deepEqual(migrateRenamed({ target, dshHome, shipped: JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) }), [])
})

test('the rename touches only the old names, whole', () => {
  assert.deepEqual(RENAMED, { '@automagik/omni-dsh': '@automagik/bots-dsh', '@automagik/omni-ai-dsh': '@automagik/welcome-dsh' })
  assert.equal(renamePatch("- id: x\n  name: '@automagik/omni-dsh-extra'\n- id: y\n  name: '@automagik/omni-channels-dsh'\n"), null)
  assert.equal(renamePatch('name: @automagik/omni-dsh # the team\n'), 'name: @automagik/bots-dsh # the team\n')
  assert.equal(renamePatch('name: "@automagik/omni-ai-dsh"'), 'name: "@automagik/welcome-dsh"')
  // Comments too, whatever follows the name.
  assert.equal(renamePatch('# opens this app (@automagik/omni-ai-dsh: Welcome)'), '# opens this app (@automagik/welcome-dsh: Welcome)')
  // A build that does not ship the new name leaves the old one alone.
  assert.deepEqual(JSON.parse(mergeProfilePackage({ dependencies: { '@automagik/omni-dsh': '1' } }, { dependencies: {} })).dependencies, { '@automagik/omni-dsh': '1' })
})

test('a preload comes from the launch and stays in the app\'s home; none is no preference', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'omni-desktop-preload-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  assert.equal(preloadAsked(['/opt/Omni/omni-desktop', '--preload=omni']), 'omni')
  assert.equal(preloadAsked(['x', '--preload', 'Genie']), 'genie')
  assert.equal(preloadAsked(['x'], { AUTOMAGIK_PRELOAD: 'omni' }), 'omni')
  assert.equal(preloadAsked(['x', '--preload=other']), null)
  assert.equal(preloadAsked(['x', '--preload']), null)
  assert.equal(preloadOf({ home, argv: ['x'] }), null)
  assert.equal(existsSync(join(home, 'preload')), false)
  assert.equal(preloadOf({ home, argv: ['x', '--preload=genie'] }), 'genie')
  // A later launch from the Dock or a desktop entry passes no flag.
  assert.equal(preloadOf({ home, argv: ['x'] }), 'genie')
  assert.equal(preloadOf({ home, argv: ['x', '--preload=omni'] }), 'omni')
  assert.equal(preloadOf({ home, argv: ['x'] }), 'omni')
  writeFileSync(join(home, 'preload'), 'nonsense\n')
  assert.equal(preloadOf({ home, argv: ['x'] }), null)
  assert.equal(dshEnv({ base: {}, home: '/a', preload: 'omni' }).AUTOMAGIK_PRELOAD, 'omni')
  assert.equal('AUTOMAGIK_PRELOAD' in dshEnv({ base: {}, home: '/a' }), false)
})

