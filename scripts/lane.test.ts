import { describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AM, addonPinsOnly, amPaths, globPattern, herdrShips, kindOf, LANE_ADDONS, manifest, nextPatch, pocketShips, pocketSince, sequenceOf, ships, signLane, unpackedIn, verifyLane } from './lane';

describe('the plugin lane', () => {
  test('only changes inside the plugins ride the lane; anything the app or an install sees is a full release', () => {
    const none = () => false;
    expect(kindOf(['apps/bots-dsh/src/client/mark.js', 'apps/welcome-dsh/client.js', 'marketplace/automagik.json'], none)).toBe('plugins');
    expect(kindOf(['apps/bots-dsh/src/client/mark.js', 'apps/desktop/src/main.js'], none)).toBe('full');
    expect(kindOf(['apps/bots-dsh/dev/harness/package.json'], none)).toBe('full');
    expect(kindOf(['apps/welcome-dsh/bun.lock'], none)).toBe('full');
    expect(kindOf(['.github/workflows/release.yml', 'scripts/lane.ts', 'scripts/version.test.ts', 'apps/desktop/test/version.test.js', 'AGENTS.md', 'apps/welcome-dsh/client.js'], none)).toBe('plugins');
    expect(kindOf(['apps/desktop/package.json', 'apps/welcome-dsh/client.js'], none)).toBe('full');
    expect(kindOf(['apps/desktop/package.json', 'apps/desktop/package-lock.json', 'package.json', 'apps/welcome-dsh/client.js'], none, path => path !== 'apps/welcome-dsh/client.js')).toBe('plugins');
    expect(kindOf(['apps/desktop/electron-builder.yml', 'apps/welcome-dsh/client.js'], none, () => false)).toBe('full');
    expect(kindOf(['apps/bots-dsh/package.json'], plugin => plugin === 'bots-dsh')).toBe('full');
    expect(kindOf([], none)).toBe('full');
    expect(kindOf(['apps/automagik-pets/src/bake.js', 'apps/automagik-pets/bun.lock', 'apps/bots-dsh/client.js'], none)).toBe('plugins');
  });

  test('a herdr-only change is a herdr patch: no desktop build, no plugins, the pack alone', () => {
    const none = () => false;
    const pack = ['herdr/mods/am-sidebar/main.js', 'herdr-layout/automagik.json', 'herdr/install.sh'];
    // Since the last release (here also the last full one), only herdr/ ships.
    expect(kindOf(pack, none, none, pack)).toBe('herdr');
    expect(herdrShips(pack)).toBe(true);
    // The import itself: the pack, its tests, notes and catalog, the release tooling and the RFC.
    const importing = [...pack, 'herdr/test/update.test.mjs', 'herdr/README.md', 'herdr/.genie/INDEX.md', 'herdr/catalog/index.json',
      '.github/workflows/release.yml', 'scripts/lane.ts', 'scripts/import-herdr.sh', 'docs/rfcs/0011-monorepo-parts-and-releases.md', 'AGENTS.md'];
    expect(kindOf(importing, none, none, importing)).toBe('herdr');
    // After a plugin patch (v3.N.1), a herdr-only change since it is still herdr: the plugins are not packed again.
    expect(kindOf(['apps/bots-dsh/client.js', ...pack], none, none, pack)).toBe('herdr');
    // With a plugin change since the last release it is a plugin patch, and the pack comes along.
    expect(kindOf(['apps/bots-dsh/client.js', ...pack], none, none, ['apps/bots-dsh/client.js', ...pack])).toBe('plugins');
    expect(herdrShips(['apps/bots-dsh/client.js', ...pack])).toBe(true);
    // With an app change it is a full release, the pack included; herdr/ alone never makes one.
    expect(kindOf(['apps/desktop/src/main.js', ...pack], none, none, ['apps/desktop/src/main.js', ...pack])).toBe('full');
    expect(kindOf(pack, none)).toBe('plugins');
    // What the pack does not carry ships nothing: tests, notes, plans, the mockup, the catalog (read from dev).
    const notes = ['herdr/test/update.test.mjs', 'herdr/README.md', 'herdr/RECIPE.md', 'herdr/docs/agent-install.md', 'herdr/.genie/INDEX.md',
      'herdr/mockup/gen-sidebar.mjs', 'herdr/catalog/index.json', 'docs/rfcs/0011-monorepo-parts-and-releases.md'];
    expect(ships(notes, none)).toBe(false);
    expect(herdrShips(notes)).toBe(false);
    // The pack's version files, bumped by a release, ship nothing on their own.
    const versions = ['herdr/package.json', 'herdr/mods/am-sidebar/VERSION'];
    expect(herdrShips(versions, path => versions.includes(path))).toBe(false);
    expect(herdrShips(versions)).toBe(true);
    // Nothing shipping since the last release falls back to the rule since the last full one.
    expect(kindOf(['apps/bots-dsh/client.js'], none, none, ['herdr/README.md'])).toBe('plugins');
  });

  test('an am-only change is an am patch; am never makes a release more than it is otherwise', () => {
    const none = () => false;
    const am = ['am/bin/am.mjs', 'am/lib/self.mjs', 'am/am-keys.json'];
    expect(kindOf(am, none, none, am)).toBe('am');
    // am's tests and notes ship nothing; with them alone there is nothing am-only to release.
    expect(ships(['am/test/am.test.mjs', 'am/README.md'], none)).toBe(false);
    expect(kindOf(['apps/bots-dsh/client.js'], none, none, ['am/test/am.test.mjs'])).toBe('plugins');
    // A herdr change that resyncs am's copies of the pack's CLI is a herdr patch, not a full release.
    const resync = ['herdr/mods/am-sidebar/model.js', 'am/model.js', 'am/copies.json'];
    expect(kindOf(resync, none, none, resync)).toBe('herdr');
    expect(kindOf([...resync, 'apps/pocket/android/app/build.gradle.kts'], none, none, [...resync, 'apps/pocket/android/app/build.gradle.kts'])).toBe('pocket');
    // Beside a plugin change it is still a plugin patch; beside an app change, a full release.
    expect(kindOf(['apps/bots-dsh/client.js', ...am], none, none, ['apps/bots-dsh/client.js', ...am])).toBe('plugins');
    expect(kindOf(['apps/desktop/src/main.js', ...am], none, none, ['apps/desktop/src/main.js', ...am])).toBe('full');
  });

  test('the am part\'s paths come from its part.json', () => {
    expect(amPaths({ paths: ['am/**'] }).map(String)).toEqual(['/^am\\/.*$/']);
    expect(globPattern('herdr/mods/*/part.json').test('herdr/mods/am-footer/part.json')).toBe(true);
    expect(globPattern('herdr/mods/*/part.json').test('herdr/mods/a/b/part.json')).toBe(false);
    expect(AM.test('am/bin/am.mjs')).toBe(true);
    expect(AM.test('amx/file')).toBe(false);
    expect(AM.test('herdr/mods/am-sidebar/model.js')).toBe(false);
  });

  test('a Pocket-only change is a pocket patch: the phone app, no desktop build, no plugins', () => {
    const none = () => false;
    const app = ['apps/pocket/android/app/src/main/java/ai/namastex/automagik/Updater.kt', 'apps/pocket/android/app/build.gradle.kts'];
    expect(kindOf(app, none, none, app)).toBe('pocket');
    expect(pocketShips(app)).toBe(true);
    expect(herdrShips(app)).toBe(false);
    // The import itself: the app, its docs, Pocket Link under herdr/, the tooling, the RFC.
    const importing = [...app, 'apps/pocket/README.md', 'apps/pocket/docs/guides/releasing.md', 'herdr/mods/pocket-link/main.js',
      '.github/workflows/ci.yml', 'scripts/lane.ts', 'scripts/import-pocket.sh', 'docs/rfcs/0011-monorepo-parts-and-releases.md', 'AGENTS.md'];
    expect(kindOf(importing, none, none, importing)).toBe('pocket');
    expect(herdrShips(importing)).toBe(true);
    // With the layout's own folder (herdr-layout/, the herdr part) it is still a pocket patch, the pack along.
    expect(kindOf([...app, 'herdr-layout/automagik.json'], none, none, [...app, 'herdr-layout/automagik.json'])).toBe('pocket');
    // A Pocket Link change alone is the pack's lane: herdr/.
    expect(kindOf(['herdr/mods/pocket-link/bridge/bridge.mjs'], none, none, ['herdr/mods/pocket-link/bridge/bridge.mjs'])).toBe('herdr');
    expect(pocketShips(['herdr/mods/pocket-link/bridge/bridge.mjs'])).toBe(false);
    // With a plugin change it is a plugin patch, with an app change a full release: Pocket comes along, never makes one.
    expect(kindOf(['apps/bots-dsh/client.js', ...app], none, none, ['apps/bots-dsh/client.js', ...app])).toBe('plugins');
    expect(kindOf(['apps/desktop/src/main.js', ...app], none, none, ['apps/desktop/src/main.js', ...app])).toBe('full');
    expect(kindOf(app, none)).toBe('plugins');
    // What no APK carries ships nothing: its notes, docs, unit tests and the Android project's scripts.
    const notes = ['apps/pocket/README.md', 'apps/pocket/AGENTS.md', 'apps/pocket/docs/rfcs/0002-release-and-update-channel.md',
      'apps/pocket/android/app/src/test/java/ai/namastex/automagik/ReleaseTest.kt', 'apps/pocket/android/scripts/test_terminal.py'];
    expect(ships(notes, none)).toBe(false);
    expect(pocketShips(notes)).toBe(false);
  });

  // Pocket is rebuilt from what phones have, the version pocket-lane names, not from the last tag: a
  // prerelease never moves the lane, so a Pocket fix that shipped only in one reaches phones with the
  // next release, even when that release changes nothing under apps/pocket/.
  test('Pocket\'s changes are measured from the build pocket-lane names, past prereleases and failed posts', () => {
    const tags = ['v3.59.0', 'v3.59.1', 'v3.59.2', 'v3.60.0'];
    // v3.59.1 was a prerelease with a Pocket fix; pocket-lane still names 3.59.0.
    expect(pocketSince('v3.60.0', '3.59.0', tags)).toBe('v3.59.0');
    const sincePrerelease = ['apps/pocket/android/app/src/main/java/ai/namastex/automagik/Updater.kt', 'apps/desktop/src/main.js'];
    expect(pocketShips(sincePrerelease)).toBe(true);
    // Up to date: the lane names the last release.
    expect(pocketSince('v3.60.0', '3.60.0', tags)).toBe('v3.60.0');
    // No lane yet (before the first Pocket release), an unreadable one, or a version with no tag here: the last release.
    for (const lane of [undefined, '', 'null', '0.23.0', '3.61.0', 'pocket-lane']) expect(pocketSince('v3.60.0', lane, tags)).toBe('v3.60.0');
    expect(pocketSince('', undefined, [])).toBe('');
  });

  test('a patch stops at 3.N.999: Pocket\'s versionCode gives a patch three digits', () => {
    expect(nextPatch(['v3.22.0', 'v3.22.998'])).toBe('3.22.999');
    expect(() => nextPatch(['v3.22.0', 'v3.22.999'])).toThrow(/cut 3\.23\.0 instead/);
  });

  test('a change no install sees is no release: a plugin file its package does not carry', () => {
    const unpacked = unpackedIn({ 'bots-dsh': ['index.js', 'src/host/', 'client.js'], 'welcome-dsh': ['src/*.js'] });
    expect(ships(['apps/bots-dsh/scripts/lint.mjs', 'apps/bots-dsh/dev/bench.sh', 'apps/bots-dsh/test/x.test.js', '.github/workflows/ci.yml'], unpacked)).toBe(false);
    expect(ships(['apps/bots-dsh/scripts/lint.mjs', 'apps/bots-dsh/src/host/turns.js'], unpacked)).toBe(true);
    // What the app's build reads, and a plugin whose files has a glob, still count.
    for (const path of ['apps/bots-dsh/dev/harness/package.json', 'apps/bots-dsh/bun.lock', 'apps/bots-dsh/package.json', 'apps/welcome-dsh/scripts/lint.mjs']) expect(ships([path], unpacked)).toBe(true);
    expect(kindOf(['apps/bots-dsh/dev/harness/package.json'], () => false, unpacked)).toBe('full');
  });

  test('the lane carries no add-on, so moving an add-on\'s pin is a full release', () => {
    expect(LANE_ADDONS).toEqual([]);
    const profile = (subscriptions = '2eff034', more = {}) => JSON.stringify({
      omni: { addonVersions: { '@goodandready/dsh-subscriptions': '0.7.21-omni.1' } },
      dependencies: { '@automagik/bots-dsh': '*', '@goodandready/dsh-subscriptions': `github:automagik-genie/dsh-subscriptions#${subscriptions}` },
      ...more,
    });
    expect(addonPinsOnly(profile(), profile())).toBe(true);
    // dsh-subscriptions has dependencies of its own: its pin, or anything else, is a full release.
    expect(addonPinsOnly(profile(), profile('ffff000'))).toBe(false);
    expect(addonPinsOnly(profile(), profile('2eff034', { dsh: { profile: { bundles: [] } } }))).toBe(false);
  });

  test('a patch goes on the newest 3.N, and the sequence keeps the releases in order', () => {
    expect(nextPatch(['v3.21.0', 'v3.22.0', 'v3.9.4', 'v3.261024.1'])).toBe('3.22.1');
    expect(nextPatch(['v3.22.0', 'v3.22.1', 'v3.22.2'])).toBe('3.22.3');
    expect(sequenceOf('3.22.1')).toBeGreaterThan(sequenceOf('3.22.0'));
    expect(sequenceOf('3.23.0')).toBeGreaterThan(sequenceOf('3.22.9'));
  });

  test('the manifest names each tarball on its own release, and only its signer\'s key opens it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lane-'));
    writeFileSync(join(dir, 'automagik-bots-dsh-3.22.1.tgz'), 'tarball');
    const lane = manifest({
      repository: 'https://github.com/automagik-dev/automagik',
      version: '3.22.1',
      commit: 'a'.repeat(40),
      packages: { '@automagik/bots-dsh': { version: '3.22.1', file: 'automagik-bots-dsh-3.22.1.tgz', integrity: 'sha512-x', size: 7 } },
    }, { base: '3.22.0', issuedAt: '2026-10-26T03:00:00Z', dir, engines: () => '>=0.2.1-rc.3 <0.2.2-0' });
    expect(lane.plugins[0].url).toBe('https://github.com/automagik-dev/automagik/releases/download/v3.22.1/automagik-bots-dsh-3.22.1.tgz');
    expect(lane.plugins[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lane.plugins[0].engines.dsh).toBe('>=0.2.1-rc.3 <0.2.2-0');
    expect([lane.base, lane.sequence, lane.keyId]).toEqual(['3.22.0', 220001, 'automagik-2026-10']);
    writeFileSync(join(dir, 'dsh-addon-1.5.6-omni.8.tgz'), 'addon');
    const carried = manifest({ repository: 'https://github.com/automagik-dev/automagik', version: '3.22.1', commit: 'a'.repeat(40), packages: {} }, {
      base: '3.22.0', issuedAt: '2026-10-26T03:00:00Z', dir, engines: () => '',
      addons: { 'dsh-addon': { version: '1.5.6-omni.8', file: 'dsh-addon-1.5.6-omni.8.tgz', integrity: 'sha512-y', size: 5, engines: { dsh: '>=0.2.0-rc.1 <0.3.0' }, source: `github:automagik-genie/dsh-addon#${'b'.repeat(40)}` } },
    });
    // Apart from plugins[] (Omni serves those, checking each), on this release, in the plugins' shape.
    expect(carried.addons).toEqual([{ name: 'dsh-addon', version: '1.5.6-omni.8', url: 'https://github.com/automagik-dev/automagik/releases/download/v3.22.1/dsh-addon-1.5.6-omni.8.tgz', integrity: 'sha512-y', sha256: createHash('sha256').update('addon').digest('hex'), size: 5, engines: { dsh: '>=0.2.0-rc.1 <0.3.0' } }]);
    const pair = generateKeyPairSync('ed25519');
    const bytes = Buffer.from(JSON.stringify(lane));
    const signature = signLane(bytes, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    const keys = [{ keyId: 'automagik-2026-10', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }];
    expect(verifyLane(bytes, signature, keys).version).toBe('3.22.1');
    expect(() => verifyLane(Buffer.from(JSON.stringify({ ...lane, sequence: 999999 })), signature, keys)).toThrow(/signature/);
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(() => verifyLane(bytes, signature, [{ keyId: 'automagik-2026-10', publicKey: other }])).toThrow(/signature/);
  });
});
