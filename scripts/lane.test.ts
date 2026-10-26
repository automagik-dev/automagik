import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kindOf, manifest, nextPatch, sequenceOf, signLane, verifyLane } from './lane';

describe('the plugin lane', () => {
  test('only changes inside the plugins ride the lane; anything the app or an install sees is a full release', () => {
    const none = () => false;
    expect(kindOf(['apps/bots-dsh/src/client/mark.js', 'apps/welcome-dsh/client.js', 'marketplace/automagik.json'], none)).toBe('plugins');
    expect(kindOf(['apps/bots-dsh/src/client/mark.js', 'apps/desktop/src/main.js'], none)).toBe('full');
    expect(kindOf(['apps/bots-dsh/dev/harness/package.json'], none)).toBe('full');
    expect(kindOf(['apps/welcome-dsh/bun.lock'], none)).toBe('full');
    expect(kindOf(['.github/workflows/release.yml'], none)).toBe('full');
    expect(kindOf(['apps/bots-dsh/package.json'], plugin => plugin === 'bots-dsh')).toBe('full');
    expect(kindOf([], none)).toBe('full');
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
