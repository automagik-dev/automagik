import { describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addonPinsOnly, kindOf, manifest, nextPatch, sequenceOf, signLane, verifyLane } from './lane';

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
  });

  test('moving only the pins of the add-ons the lane carries keeps a release on the lane', () => {
    const profile = (omc: string, subscriptions = '2eff034', more = {}) => JSON.stringify({
      omni: { addonVersions: { '@goodandready/dsh-subscriptions': '0.7.21-omni.1', 'dsh-oh-my-claude': omc } },
      dependencies: { '@automagik/bots-dsh': '*', '@goodandready/dsh-subscriptions': `github:automagik-genie/dsh-subscriptions#${subscriptions}`, 'dsh-oh-my-claude': `github:automagik-genie/dsh-oh-my-claude#${omc}` },
      ...more,
    });
    expect(addonPinsOnly(profile('1.5.6-omni.7'), profile('1.5.6-omni.8'))).toBe(true);
    // Another add-on's pin (it has dependencies of its own), or anything else, is a full release.
    expect(addonPinsOnly(profile('1.5.6-omni.7'), profile('1.5.6-omni.8', 'ffff000'))).toBe(false);
    expect(addonPinsOnly(profile('1.5.6-omni.7'), profile('1.5.6-omni.7', '2eff034', { dsh: { profile: { bundles: [] } } }))).toBe(false);
    const inert = (path: string) => path === 'apps/desktop/profile/package.json';
    expect(kindOf(['apps/desktop/profile/package.json', 'apps/desktop/test/dsh.test.js', 'apps/bots-dsh/dev/live-addons.json', 'marketplace/automagik.json'], () => false, inert)).toBe('plugins');
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
    expect(lane.addons).toEqual([]);
    writeFileSync(join(dir, 'dsh-oh-my-claude-1.5.6-omni.8.tgz'), 'addon');
    const carried = manifest({ repository: 'https://github.com/automagik-dev/automagik', version: '3.22.1', commit: 'a'.repeat(40), packages: {} }, {
      base: '3.22.0', issuedAt: '2026-10-26T03:00:00Z', dir, engines: () => '',
      addons: { 'dsh-oh-my-claude': { version: '1.5.6-omni.8', file: 'dsh-oh-my-claude-1.5.6-omni.8.tgz', integrity: 'sha512-y', size: 5, engines: { dsh: '>=0.2.0-rc.1 <0.3.0' }, source: `github:automagik-genie/dsh-oh-my-claude#${'b'.repeat(40)}` } },
    });
    // Apart from plugins[] (Omni serves those), on this release, in the plugins' own shape.
    expect(carried.plugins).toEqual([]);
    expect(carried.addons).toEqual([{ name: 'dsh-oh-my-claude', version: '1.5.6-omni.8', url: 'https://github.com/automagik-dev/automagik/releases/download/v3.22.1/dsh-oh-my-claude-1.5.6-omni.8.tgz', integrity: 'sha512-y', sha256: createHash('sha256').update('addon').digest('hex'), size: 5, engines: { dsh: '>=0.2.0-rc.1 <0.3.0' } }]);
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
