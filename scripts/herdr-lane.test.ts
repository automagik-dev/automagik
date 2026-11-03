import { describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTALL_SH, KEY_ID, KEYS_FILE, installKeys, keyProblem, pointer, signPointer, verifyPointer, withInstallKeys } from './herdr-lane';

// A throwaway key, made for this run only: no private key is ever committed.
const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
};

describe('the herdr lane', () => {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-lane-'));
  const tgz = join(dir, 'automagik-herdr-pack-3.57.1.tgz');
  writeFileSync(tgz, 'the pack');
  const commit = 'a'.repeat(40);

  test('pack.json names the release, the tarball\'s URL, sha256 and size, and a monotonic sequence', () => {
    const p = pointer(tgz, { version: '3.57.1', commit, issuedAt: '2026-11-03T00:00:00Z' });
    expect(p).toMatchObject({ schemaVersion: 1, publisher: 'automagik', part: 'herdr', keyId: KEY_ID, sequence: 570001, version: '3.57.1', tag: 'v3.57.1', commit });
    expect(p.tarball).toEqual({
      name: 'automagik-herdr-pack-3.57.1.tgz',
      url: 'https://github.com/automagik-dev/automagik/releases/download/v3.57.1/automagik-herdr-pack-3.57.1.tgz',
      sha256: createHash('sha256').update('the pack').digest('hex'),
      size: 8,
    });
    const newer = join(dir, 'automagik-herdr-pack-3.58.0.tgz');
    writeFileSync(newer, 'a newer pack');
    expect(pointer(newer, { version: '3.58.0', commit, issuedAt: 'x' }).sequence).toBeGreaterThan(p.sequence);
    expect(() => pointer(tgz, { version: '3.57.2', commit, issuedAt: 'x' })).toThrow(/is not automagik-herdr-pack-3\.57\.2\.tgz/);
    expect(() => pointer(tgz, { version: '3.57.1', commit: 'HEAD', issuedAt: 'x' })).toThrow(/not a commit/);
  });

  test('a good signature verifies; another key, a tampered byte or an unknown key id is refused', () => {
    const key = pair();
    const keys = [{ keyId: KEY_ID, publicKey: key.pub }];
    const bytes = Buffer.from(JSON.stringify(pointer(tgz, { version: '3.57.1', commit, issuedAt: 'x' })));
    const sig = signPointer(bytes, key.priv);
    expect(verifyPointer(bytes, sig, keys).version).toBe('3.57.1');
    expect(() => verifyPointer(bytes, signPointer(bytes, pair().priv), keys)).toThrow(/signature does not match/);
    expect(() => verifyPointer(Buffer.from(bytes.toString().replace('3.57.1', '3.57.9')), sig, keys)).toThrow(/signature does not match/);
    expect(() => verifyPointer(bytes, sig, [{ keyId: 'another', publicKey: key.pub }])).toThrow(/no key herdr-pack/);
  });

  test('check-key: the release refuses a missing key, a non-key, or one pack-keys.json does not list', () => {
    const key = pair();
    expect(keyProblem(undefined, [])).toBe('HERDR_PACK_KEY is not set');
    expect(keyProblem('not a pem', [])).toMatch(/not a private key/);
    expect(keyProblem(key.priv, [])).toMatch(/lists no herdr-pack/);
    expect(keyProblem(key.priv, [{ keyId: KEY_ID, publicKey: pair().pub }])).toMatch(/is not the herdr-pack/);
    expect(keyProblem(key.priv, [{ keyId: KEY_ID, publicKey: key.pub }])).toBeNull();
  });

  test('install.sh embeds the same keys pack-keys.json lists, and keygen rewrites both alike', () => {
    const keys = JSON.parse(readFileSync(KEYS_FILE, 'utf8')).keys;
    const script = readFileSync(INSTALL_SH, 'utf8');
    expect(installKeys(script)).toEqual(keys);
    const next = [{ keyId: KEY_ID, publicKey: pair().pub }];
    expect(installKeys(withInstallKeys(script, next))).toEqual(next);
    // The private half never appears in either file.
    expect(readFileSync(KEYS_FILE, 'utf8')).not.toContain('PRIVATE KEY');
    expect(script).not.toContain('PRIVATE KEY');
  });
});
