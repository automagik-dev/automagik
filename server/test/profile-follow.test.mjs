import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { followImage, installOffline } from '../profile-follow.mjs'
import { profileDirOf } from '../lib.mjs'
import { compareRelease, FOLLOW_STATUS, installedPlugins, markSeed, ownership, packageHash, profileState, SEED_MARKER } from '../profile-state.mjs'
import { materializePlugins, packPlugin, PLUGINS } from '../plugin-payload.mjs'
import { buildOfflineStore } from '../offline-store.mjs'
import { healthReport } from '../healthcheck.mjs'

const original = JSON.parse(readFileSync(new URL('../profile/package.json', import.meta.url), 'utf8'))
const write = (path, content) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, content) }
function image(root, release) {
  const source = join(root, 'profile'), build = { automagik: release, revision: 'a'.repeat(40), plugins: Object.fromEntries(PLUGINS.map(name => [name, release])) }
  const pkg = structuredClone(original)
  let lock = "lockfileVersion: '9.0'\npackages:\n"
  for (const name of PLUGINS) {
    const file = `automagik-${name.split('/')[1]}-${release}.tgz`
    pkg.dependencies[name] = `file:vendor/${file}`
    const dir = join(source, 'node_modules', ...name.split('/'))
    write(join(dir, 'package.json'), JSON.stringify({ name, version: release }))
    write(join(dir, 'main.js'), `export default ${JSON.stringify(release)}\n`)
    lock += `  '${name}@file:vendor/${file}':\n    resolution: {integrity: sha512-AAAA, tarball: file:vendor/${file}}\n`
  }
  write(join(source, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
  write(join(source, 'pnpm-lock.yaml'), lock)
  write(join(source, 'cordis.patch.yml'), '[]\n')
  write(join(source, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  write(join(root, 'versions.json'), JSON.stringify(build))
  const store = join(root, 'offline-store'); mkdirSync(store, { recursive: true })
  return { source, build, store }
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'automagik-follow-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const dshHome = join(dir, 'data', 'dsh'), old = image(join(dir, 'old'), '3.90.1'), next = image(join(dir, 'image'), '3.93.0')
  mkdirSync(dshHome, { recursive: true })
  return { dir, dshHome, old, next, target: profileDirOf(dshHome) }
}
const successful = source => ({ profile }) => cpSync(join(source, 'node_modules'), join(profile, 'node_modules'), { recursive: true })
const prepare = async (f, img = f.old, install = successful(img.source)) => followImage({ dshHome: f.dshHome, ...img, install })

// FOLLOW_NO_BACKUP: starting installation without preserving the old package/lock loses recovery.
test('fresh seed records its package hash; a newer image installs in staging after a full backup', async t => {
  const f = fixture(t)
  assert.equal((await prepare(f)).seeded, true)
  const marker = JSON.parse(readFileSync(join(f.target, SEED_MARKER), 'utf8'))
  assert.equal(marker.packageSha256, packageHash(f.target)); assert.equal(marker.release, '3.90.1')
  write(join(f.target, 'cordis.patch.yml'), 'owner settings\n')
  let backupPresent = false, calls = 0
  const beforePackage = readFileSync(join(f.target, 'package.json'), 'utf8'), beforeLock = readFileSync(join(f.target, 'pnpm-lock.yaml'), 'utf8')
  const upgraded = await prepare(f, f.next, async args => {
    calls++; assert.notEqual(args.profile, f.target)
    const backups = join(f.dshHome, 'backups'), stamps = readdirSync(backups)
    assert.equal(stamps.length, 1); assert.match(stamps[0], /^\d{4}-\d\d-\d\dT/)
    const backup = join(backups, stamps[0], 'automagik-web')
    backupPresent = existsSync(join(backup, 'package.json')) && existsSync(join(backup, 'pnpm-lock.yaml'))
    assert.equal(readFileSync(join(backup, 'package.json'), 'utf8'), beforePackage)
    assert.equal(readFileSync(join(backup, 'pnpm-lock.yaml'), 'utf8'), beforeLock)
    assert.equal(installedPlugins(backup)[PLUGINS[0]], '3.90.1')
    assert.equal(installedPlugins(f.target)[PLUGINS[0]], '3.90.1', 'live profile stays old during installation')
    successful(f.next.source)(args)
  })
  assert.ok(backupPresent); assert.equal(calls, 1); assert.equal(upgraded.result, 'updated')
  assert.equal(upgraded.followsImage, true)
  assert.ok(Object.values(installedPlugins(f.target)).every(v => v === '3.93.0'))
  assert.equal(readFileSync(join(f.target, 'cordis.patch.yml'), 'utf8'), 'owner settings\n')
  assert.equal(JSON.parse(readFileSync(join(f.target, SEED_MARKER), 'utf8')).packageSha256, packageHash(f.target))
  assert.equal(existsSync(join(f.target, 'vendor')), false)
})

test('a missing or legacy marker is adopted only for the complete canonical image seed shape', async t => {
  for (const legacy of [undefined, 'unknown\n']) {
    const f = fixture(t)
    cpSync(f.old.source, f.target, { recursive: true })
    if (legacy) write(join(f.target, SEED_MARKER), legacy)
    assert.equal((await prepare(f, f.next)).result, 'updated')
    assert.equal(ownership(f.target, f.next.source).managed, true)
  }
  const f = fixture(t)
  cpSync(f.old.source, f.target, { recursive: true })
  const pkg = JSON.parse(readFileSync(join(f.target, 'package.json'), 'utf8')); pkg.extra = 'owner setting'
  const raw = `${JSON.stringify(pkg, null, 2)}\n`; write(join(f.target, 'package.json'), raw)
  let called = false
  const result = await prepare(f, f.next, () => { called = true })
  assert.equal(result.ownerManaged, true); assert.equal(called, false)
  assert.equal(readFileSync(join(f.target, 'package.json'), 'utf8'), raw)
  assert.equal(existsSync(join(f.target, SEED_MARKER)), false)
})

// FOLLOW_IGNORE_OWNER: ignoring a changed package hash silently replaces the owner's manifest.
test('an owner-edited package remains byte-for-byte unchanged and is reported as owner-managed', async t => {
  const f = fixture(t); await prepare(f)
  const pkg = JSON.parse(readFileSync(join(f.target, 'package.json'), 'utf8')); pkg.description = 'owner-managed profile'
  const raw = `${JSON.stringify(pkg, null, 2)}\n`; write(join(f.target, 'package.json'), raw)
  let called = false
  const result = await prepare(f, f.next, () => { called = true })
  assert.equal(result.ownerManaged, true); assert.equal(result.reason, 'owner-managed'); assert.equal(called, false)
  assert.equal(readFileSync(join(f.target, 'package.json'), 'utf8'), raw)
  assert.equal(installedPlugins(f.target)[PLUGINS[0]], '3.90.1')
})

// FOLLOW_INSTALL_LIVE: directing a partial install at the live profile corrupts rollback.
test('a partial install failure preserves the old package, lock and all installed plugins and reports rollback', async t => {
  const f = fixture(t); await prepare(f)
  const before = [readFileSync(join(f.target, 'package.json'), 'utf8'), readFileSync(join(f.target, 'pnpm-lock.yaml'), 'utf8'), readFileSync(join(f.target, SEED_MARKER), 'utf8')]
  let calls = 0
  const result = await prepare(f, f.next, ({ profile }) => {
    calls++; write(join(profile, 'node_modules', ...PLUGINS[0].split('/'), 'package.json'), JSON.stringify({ name: PLUGINS[0], version: '3.93.0' }))
    write(join(profile, 'pnpm-lock.yaml'), 'partial install\n'); throw new Error('private installer diagnostics must not escape')
  })
  assert.equal(calls, 1); assert.equal(result.result, 'update-rolled-back'); assert.equal(result.reason, 'update-rolled-back')
  assert.deepEqual([readFileSync(join(f.target, 'package.json'), 'utf8'), readFileSync(join(f.target, 'pnpm-lock.yaml'), 'utf8'), readFileSync(join(f.target, SEED_MARKER), 'utf8')], before)
  assert.ok(Object.values(installedPlugins(f.target)).every(v => v === '3.90.1'))
  assert.equal(JSON.parse(readFileSync(join(f.dshHome, FOLLOW_STATUS), 'utf8')).result, 'update-rolled-back')
  const report = await healthReport({ root: dirname(f.next.source), dshHome: f.dshHome, env: {}, probe: async () => 401 })
  assert.equal(report.reason, 'update-rolled-back'); assert.equal(report.healthy, false)
  assert.equal((await prepare(f, f.next)).result, 'updated', 'a later restart can retry the failed image update')
})

// FOLLOW_DOWNGRADE: disabling both ordering guards overwrites newer plugins with an older image.
test('equal and older images never install or downgrade plugins', async t => {
  const f = fixture(t); await prepare(f, f.next)
  let called = false
  assert.equal((await prepare(f, f.next, () => { called = true })).result, 'matching-image')
  assert.equal((await prepare(f, f.old, args => { called = true; successful(f.old.source)(args) })).reason, 'newer-than-image')
  assert.equal(called, false); assert.ok(Object.values(installedPlugins(f.target)).every(v => v === '3.93.0'))
  for (const [a,b,expected] of [['3.90.1','3.93.0',-1],['3.93.0','3.93.0-rc.1',1],['3.93.0-rc.2','3.93.0-rc.10',-1]]) assert.equal(compareRelease(a,b), expected)
})

// FOLLOW_SKIP_RECOVERY: seeding over an interrupted swap loses the old profile's settings.
test('an interrupted directory swap restores the previous owned profile before first-seed logic', async t => {
  const f = fixture(t); await prepare(f)
  renameSync(f.target, `${f.target}.image-previous`)
  const result = await prepare(f, f.next)
  assert.equal(result.seeded, false); assert.equal(result.result, 'update-rolled-back')
  assert.equal(installedPlugins(f.target)[PLUGINS[0]], '3.90.1')
  assert.equal(existsSync(`${f.target}.image-previous`), false)
})

// FOLLOW_SKIP_VERSION_VERIFY: a successful installer exit is not proof all three plugins moved.
test('a zero-exit partial install rolls back unless all three installed plugin versions match', async t => {
  const f = fixture(t); await prepare(f)
  const result = await prepare(f, f.next, ({ profile }) => {
    const dir = join(profile, 'node_modules', ...PLUGINS[0].split('/'))
    mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PLUGINS[0], version: '3.93.0' }))
  })
  assert.equal(result.result, 'update-rolled-back')
  assert.ok(Object.values(installedPlugins(f.target)).every(v => v === '3.90.1'))
})

test('unsupported seed records are preserved and cannot turn into a new seed or owner-managed exception', async t => {
  const f = fixture(t); await prepare(f)
  const raw = JSON.stringify({ version: 2, packageSha256: packageHash(f.target) }); write(join(f.target, SEED_MARKER), raw)
  const result = await prepare(f, f.next)
  assert.equal(result.ownerManaged, false); assert.equal(result.followsImage, false); assert.equal(result.reason, 'unsupported-seed-marker')
  assert.equal(readFileSync(join(f.target, SEED_MARKER), 'utf8'), raw)
})

// FOLLOW_ONLINE_INSTALL: omitting offline/frozen flags lets runtime resolution reach the network.
test('the real installer invokes DSH with offline, frozen, production and no-script arguments', t => {
  const f = fixture(t), bin = join(f.dir, 'fake-dsh.mjs')
  write(bin, `import {writeFileSync} from 'node:fs';writeFileSync(process.env.DSH_HOME+'/argv.json',JSON.stringify(process.argv.slice(2)))`)
  installOffline({ dshBin: bin, profile: f.dshHome, dshHome: f.dshHome })
  assert.deepEqual(JSON.parse(readFileSync(join(f.dshHome, 'argv.json'), 'utf8')), ['plugin','--profile','automagik-web','install','--offline','--frozen-lockfile','--prod','--ignore-scripts'])
})

test('local tarballs contain the inspected plugin files and their exact integrity reaches the lock', t => {
  const f = fixture(t), target = join(f.dir, 'materialized')
  materializePlugins({ source: f.next.source, target })
  const lock = readFileSync(join(target, 'pnpm-lock.yaml'), 'utf8')
  for (const name of PLUGINS) {
    const dir = join(f.next.source, 'node_modules', ...name.split('/')), bytes = packPlugin(dir)
    assert.ok(gunzipSync(bytes).includes(Buffer.from('package/package.json')))
    assert.ok(lock.includes(`sha512-${createHash('sha512').update(bytes).digest('base64')}`))
  }
})

// STORE_INCLUDE_UNUSED: copying the raw cache also ships files the inspected profile pruned.
test('the offline cache retains only inspected files and validates each content hash', t => {
  const f = fixture(t), store = join(f.dir, 'cache'), profile = join(f.dir, 'pruned'), out = join(f.dir, 'offline')
  const kept = Buffer.from('runtime file'), removed = Buffer.from('uninspected fixture'), digest = b => createHash('sha512').update(b).digest('hex')
  const records = {}, add = (name,bytes) => {
    const hex = digest(bytes); write(join(store,'v10','files',hex.slice(0,2),hex.slice(2)),bytes)
    records[name] = { integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, mode: 0o644, size: bytes.length }
  }
  const pkg = Buffer.from(JSON.stringify({name:'fixture',version:'1.0.0'}))
  add('package.json',pkg); add('index.js',kept); add('tests/private.txt',removed)
  write(join(store,'v10','index','aa','fixture.json'),JSON.stringify({name:'fixture',version:'1.0.0',files:records}))
  write(join(profile,'node_modules','fixture','package.json'),pkg); write(join(profile,'node_modules','fixture','index.js'),kept)
  assert.equal(buildOfflineStore({store,profile,out}).packages,1)
  const index = JSON.parse(readFileSync(join(out,'v10','index','aa','fixture.json'),'utf8'))
  assert.deepEqual(Object.keys(index.files).sort(),['index.js','package.json'])
  const hash = digest(removed)
  assert.equal(existsSync(join(out,'v10','files',hash.slice(0,2),hash.slice(2))),false)
  write(join(profile,'node_modules','fixture','index.js'),'changed')
  assert.throws(()=>buildOfflineStore({store,profile,out}),/differs from inspected/)
})
