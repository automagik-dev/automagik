import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { APPLY_IDLE_MS, applyNow, applyStaged, appStopped, causeOf, changesOf, stillIdle, readAutoApply, settingsFileOf, writeAutoApply } from '../src/auto-apply.js'
import { updatePresentation } from '../src/frame.js'
import { tarOf } from '../src/tar.js'
import { beforeStart, confirm, installedVersions, laneMemory, laneUpdate, PUBLISHERS, stage, stagedOf, trialFailed } from '../src/lane.js'

const run = promisify(execFile)
const temp = (t) => { const dir = mkdtempSync(join(tmpdir(), 'auto-apply-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir }
const BOTS = '@automagik/bots-dsh'
const idle = { auto: true, busy: { running: 0 }, trial: 'good', fetching: null, appUpdate: false, applying: false, idleMs: 0, focused: false }

test('staged plugins go in when no agent is at work and no one is typing, and wait otherwise', () => {
  const staged = { version: '3.59.2' }
  assert.equal(applyNow({ ...idle, staged }), 'apply')
  assert.equal(applyNow({ ...idle, staged: null }), 'nothing staged')
  assert.equal(applyNow({ ...idle, staged, auto: false }), 'switched off')
  assert.equal(applyNow({ ...idle, staged, busy: { running: 2 } }), 'agents at work')
  // A welcome that does not say (an older one, a DSH not up): nothing restarts under it.
  assert.equal(applyNow({ ...idle, staged, busy: null }), 'busy unknown')
  // The window in front: only once the person has stopped for a minute.
  assert.equal(applyNow({ ...idle, staged, focused: true, idleMs: 5_000 }), 'person here')
  assert.equal(applyNow({ ...idle, staged, focused: true, idleMs: APPLY_IDLE_MS }), 'apply')
  // An app update brings its own plugins; a trial or a download under way finishes first.
  assert.equal(applyNow({ ...idle, staged, appUpdate: true }), 'app update')
  assert.equal(applyNow({ ...idle, staged, trial: 'applied' }), 'trial running')
  assert.equal(applyNow({ ...idle, staged, fetching: { version: '3.59.3' } }), 'downloading')
  assert.equal(applyNow({ ...idle, staged, applying: true }), 'applying')
})

test('"Apply plugin updates automatically" is on unless switched off, and keeps the other settings', (t) => {
  const file = settingsFileOf(temp(t))
  assert.equal(readAutoApply(file), true)
  writeFileSync(file, '{ not json')
  assert.equal(readAutoApply(file), true)
  writeFileSync(file, JSON.stringify({ other: 1 }))
  assert.equal(writeAutoApply(file, false), false)
  assert.equal(readAutoApply(file), false)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).other, 1)
  writeAutoApply(file, true)
  assert.equal(readAutoApply(file), true)
})

test('the notice names each plugin with its versions, apart from the app\'s update', () => {
  const changes = changesOf([{ name: BOTS, version: '3.59.2' }, { name: '@automagik/welcome-dsh', version: '3.59.2' }], { [BOTS]: '3.58.1' })
  assert.deepEqual(changes, [{ name: BOTS, from: '3.58.1', to: '3.59.2' }, { name: '@automagik/welcome-dsh', to: '3.59.2' }])
  const waiting = updatePresentation(null, { plugins: '3.59.2', lane: { changes, auto: true } })
  // What an older Bot team reads stays as it was.
  assert.equal(waiting.phase, 'ready')
  assert.equal(waiting.kind, 'plugins')
  assert.deepEqual(waiting.app, { phase: 'idle' })
  assert.deepEqual(waiting.plugins, { phase: 'ready', changes, auto: true })
  // Going in: the plugins' notice says so; the app's is its own.
  const going = updatePresentation({ state: 'downloading', version: '3.60.0', percent: 40.6 }, { plugins: '3.59.2', lane: { changes, auto: true, applying: true } })
  assert.deepEqual(going.plugins, { phase: 'installing', changes, auto: true })
  assert.deepEqual(going.app, { phase: 'downloading', version: '3.60.0', percent: 40 })
  assert.equal(going.phase, 'installing')
  // Downloading, with what it will change.
  const coming = updatePresentation(null, { fetching: { version: '3.59.2', percent: 12.5, changes }, lane: { changes: [], auto: false } })
  assert.deepEqual(coming.plugins, { phase: 'downloading', changes, percent: 12, auto: false })
  // Without `lane` (the tests above it, an older caller): only the fields it always had.
  assert.deepEqual(updatePresentation(null, { plugins: '3.59.2' }), { phase: 'ready', version: '3.59.2', kind: 'plugins' })
})

test('the Automagik lane updates the Automagik plugins a person added from the market, never Omni\'s or Unfold\'s', () => {
  const automagik = PUBLISHERS.find(entry => entry.publisher === 'automagik')
  for (const name of ['@automagik/locale-pt-br-dsh', BOTS]) assert.ok(automagik.plugins.includes(name), name)
  assert.ok(!automagik.plugins.some(name => name.startsWith('@automagik/omni-')))
  // Unfold's ship from Unfold's own release, not this lane (Refs marketplace/unfold).
  assert.ok(!automagik.plugins.some(name => name.startsWith('@automagik/unfold-')))
  const lane = { schemaVersion: 1, publisher: 'automagik', sequence: 590002, version: '3.59.2', base: '3.59.0', plugins: [{ name: '@automagik/locale-pt-br-dsh', version: '3.59.2', url: 'https://github.com/automagik-si/automagik/releases/download/v3.59.2/x.tgz', engines: { dsh: '>=0.2.1-rc.5 <0.2.2-0' } }] }
  const context = { publisher: automagik, appVersion: '3.59.0', dshVersion: '0.2.1-rc.5' }
  assert.equal(laneUpdate(lane, { ...context, installed: { '@automagik/locale-pt-br-dsh': '3.59.0' } })?.plugins.length, 1)
  // Not added here: nothing to update.
  assert.equal(laneUpdate(lane, { ...context, installed: {} }), null)
})

// End to end: a profile as pnpm lays it out, a lane tarball staged as the app stages it, a "DSH"
// that is a real Node process loading the Bot team from the profile, and a page that draws the
// Bot team only when the plugin it loaded does.
function profileWith(root, version) {
  const real = join(root, 'profile', 'node_modules', '.pnpm', `@automagik+bots-dsh@${version}`, 'node_modules', '@automagik', 'bots-dsh')
  writePlugin(real, version, true)
  mkdirSync(join(root, 'profile', 'node_modules', '@automagik'), { recursive: true })
  symlinkSync(real, join(root, 'profile', 'node_modules', '@automagik', 'bots-dsh'))
  writeFileSync(join(root, 'profile', 'package.json'), JSON.stringify({ dependencies: { [BOTS]: `file:vendor/automagik-bots-dsh-${version}.tgz` } }))
  return join(root, 'profile')
}
function writePlugin(dir, version, draws) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: BOTS, version, type: 'module', main: 'index.js' }))
  writeFileSync(join(dir, 'index.js'), `export const version = '${version}'\nexport const draws = ${draws}\n`)
}
async function staged(root, home, version, draws) {
  const dir = join(root, 'pack', version)
  writePlugin(join(dir, 'package'), version, draws)
  const file = join(root, `bots-${version}.tgz`)
  execFileSync(tarOf(), ['-czf', file, '-C', dir, 'package'])
  const bytes = readFileSync(file)
  const plugin = { name: BOTS, version, url: `https://github.com/automagik-si/automagik/releases/download/v${version}/automagik-bots-dsh-${version}.tgz`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
  await stage({ publisher: 'automagik', version, sequence: Number(version.replaceAll('.', '')), plugins: [plugin] }, { home, fetch: async () => new Response(bytes) })
}

// The app's side of it, as main.js runs it: a look every minute that decides (applyNow), and the
// restart of DSH alone (applyStaged) with the lane's own steps. `dsh` is what the app runs now.
function appOf({ home, target, crash = false }) {
  const app = { dsh: null, starts: 0, stops: 0, trial: null, log: [] }
  const startDsh = async () => {
    // DSH loads the Bot team from the profile, as it does at every start.
    const entry = join(target, 'node_modules', BOTS, 'index.js')
    // By URL: import() takes no Windows path (D:\...).
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(pathToFileURL(entry).href)}); console.log(JSON.stringify({ version: m.version, draws: m.draws }))`])
    const loaded = JSON.parse(stdout)
    if (crash && loaded.version !== '3.58.1') throw new Error('dsh exited before it was ready (1)')
    return loaded
  }
  app.tick = async (state) => {
    const why = applyNow({ ...idle, staged: stagedOf(home), trial: app.trial, ...state })
    if (why !== 'apply') return why
    return applyStaged({
      cycle: async (prepare) => {
        app.stops += 1
        app.dsh = null
        const prepared = prepare()
        app.dsh = await startDsh()
        app.starts += 1
        return prepared
      },
      beforeStart: () => (app.trial = beforeStart({ home, target })),
      confirm: () => { confirm(home); app.trial = 'good' },
      trialFailed: () => trialFailed(home),
      judge: async () => app.dsh?.draws === true,
      log: line => app.log.push(line),
    })
  }
  return app
}

test('end to end: a staged update waits while agents work, then goes in with DSH restarted alone', async (t) => {
  const root = temp(t)
  const home = join(root, 'home')
  const target = profileWith(root, '3.58.1')
  await staged(root, home, '3.59.2', true)
  const app = appOf({ home, target })
  // Busy: nothing moves.
  assert.equal(await app.tick({ busy: { running: 1 } }), 'agents at work')
  assert.equal(await app.tick({ focused: true, idleMs: 3_000 }), 'person here')
  assert.equal(installedVersions(target, [BOTS])[BOTS], '3.58.1')
  assert.equal(stagedOf(home).version, '3.59.2')
  assert.equal(app.stops, 0)
  // Idle: DSH restarts once, loads the new Bot team, and the trial passes.
  assert.equal(await app.tick({ busy: { running: 0 } }), 'good')
  assert.equal(app.stops, 1)
  assert.deepEqual(app.dsh, { version: '3.59.2', draws: true })
  assert.equal(installedVersions(target, [BOTS])[BOTS], '3.59.2')
  assert.equal(stagedOf(home), null)
  const applied = JSON.parse(readFileSync(join(home, 'lane', 'applied.json'), 'utf8'))
  assert.equal(applied.pending, false)
  assert.ok(applied.confirmedAt)
  assert.equal(laneMemory(home).last, 3592)
  // Nothing waits any more: the next look does nothing.
  assert.equal(await app.tick({}), 'nothing staged')
})

test('end to end: a version whose Bot team never draws is rolled back in the same window, and stays out', async (t) => {
  const root = temp(t)
  const home = join(root, 'home')
  const target = profileWith(root, '3.58.1')
  await staged(root, home, '3.59.2', false)
  const app = appOf({ home, target })
  assert.equal(await app.tick({}), 'restored')
  // DSH restarted twice: into the new plugins, then back to the previous ones.
  assert.equal(app.stops, 2)
  assert.deepEqual(app.dsh, { version: '3.58.1', draws: true })
  assert.equal(installedVersions(target, [BOTS])[BOTS], '3.58.1')
  assert.deepEqual(laneMemory(home).bad, ['3.59.2'])
  assert.ok(app.log.some(line => /never drew/.test(line)))
  assert.equal(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).dependencies[BOTS], 'file:vendor/automagik-bots-dsh-3.58.1.tgz')
  assert.equal(existsSync(join(home, 'lane', 'staged', `${BOTS.replace('/', '+')}@3.59.2`)), false)
  // The lane offers it again: it is refused.
  const automagik = PUBLISHERS.find(entry => entry.publisher === 'automagik')
  const lane = { schemaVersion: 1, publisher: 'automagik', sequence: 3593, version: '3.59.2', base: '3.59.0', plugins: [{ name: BOTS, version: '3.59.2', url: 'https://github.com/automagik-si/automagik/releases/download/v3.59.2/x.tgz', engines: { dsh: '>=0.2.1-rc.5 <0.2.2-0' } }] }
  assert.equal(laneUpdate(lane, { publisher: automagik, appVersion: '3.59.0', dshVersion: '0.2.1-rc.5', installed: installedVersions(target, [BOTS]), ...laneMemory(home) }), null)
})

test('end to end: a DSH that does not come up with the new plugins comes back with the previous ones', async (t) => {
  const root = temp(t)
  const home = join(root, 'home')
  const target = profileWith(root, '3.58.1')
  await staged(root, home, '3.59.2', true)
  const app = appOf({ home, target, crash: true })
  assert.equal(await app.tick({}), 'restored')
  assert.deepEqual(app.dsh, { version: '3.58.1', draws: true })
  assert.deepEqual(laneMemory(home).bad, ['3.59.2'])
})

test('a restart that cannot bring DSH back with nothing changed asks for a start of the app', async () => {
  let started = 0
  const outcome = await applyStaged({
    cycle: async () => { started += 1; throw new Error('the app is quitting') },
    beforeStart: () => 'applied',
    confirm: () => assert.fail('nothing to confirm'),
    trialFailed: () => assert.fail('no trial began'),
    judge: async () => true,
  })
  assert.equal(outcome, 'down')
  assert.equal(started, 1)
})

test('a quit while the new plugins come up is no verdict on them: the next start of the app runs their trial', async (t) => {
  const root = temp(t)
  const home = join(root, 'home')
  const target = profileWith(root, '3.58.1')
  await staged(root, home, '3.59.2', true)
  const lane = { beforeStart: () => beforeStart({ home, target }), confirm: () => confirm(home), trialFailed: () => trialFailed(home) }
  // The quit stops DSH as it comes up with them, or while the page is still drawing.
  for (const [cycle, judge] of [
    [async (prepare) => { prepare(); throw appStopped('the app is quitting') }, async () => true],
    [async prepare => prepare(), async () => { throw appStopped('the app is quitting') }],
  ]) {
    assert.equal(await applyStaged({ ...lane, cycle, judge }), 'down')
    assert.deepEqual(laneMemory(home).bad, [])
    assert.equal(JSON.parse(readFileSync(join(home, 'lane', 'applied.json'), 'utf8')).starts, 0)
    // The next start: their trial, not a rollback.
    assert.equal(beforeStart({ home, target }), 'trial')
    assert.equal(installedVersions(target, [BOTS])[BOTS], '3.59.2')
    // Back to where the first case left it, for the second.
    trialFailed(home)
    assert.equal(beforeStart({ home, target }), 'restored')
    rmSync(join(home, 'lane', 'bad.json'), { force: true })
    await staged(root, home, '3.59.2', true)
  }
})

test('a quit that stops DSH before the app says it is quitting is still the app\'s doing, not the plugins\'', async (t) => {
  const failed = new Error('dsh exited before it was ready (SIGTERM)')
  // main.js cycleDsh's catch: before-quit stopped the fresh dshProcess while no DSH ran yet.
  assert.equal(causeOf(failed, { quitting: false, stopped: true }).code, 'app')
  assert.equal(causeOf(failed, { quitting: true, stopped: false }).code, 'app')
  // Neither: the plugins' own failure, judged as a trial.
  assert.equal(causeOf(failed, { quitting: false, stopped: false }), failed)
  const root = temp(t)
  const home = join(root, 'home')
  const target = profileWith(root, '3.58.1')
  await staged(root, home, '3.59.2', true)
  const outcome = await applyStaged({
    cycle: async (prepare) => { prepare(); throw causeOf(failed, { quitting: false, stopped: true }) },
    beforeStart: () => beforeStart({ home, target }),
    confirm: () => confirm(home),
    trialFailed: () => assert.fail('a quit is no failed trial'),
    judge: async () => true,
  })
  assert.equal(outcome, 'down')
  assert.deepEqual(laneMemory(home).bad, [])
  assert.equal(beforeStart({ home, target }), 'trial')
})

test('the automatic path looks at the agents again just before DSH stops', () => {
  assert.equal(stillIdle({ running: 0 }), true)
  assert.equal(stillIdle({ running: 1 }), false)
  assert.equal(stillIdle(null), false)
})
