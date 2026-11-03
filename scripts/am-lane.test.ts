import { describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEY_ID, KEYS_FILE, SLOTS, keyVerdict, pointer, postedProblem, signPointer, slotFor, verify } from './am-lane';

// A throwaway key, made for this run only: no private key is ever committed.
const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
};
const SCRIPT = join(import.meta.dir, 'am-lane.ts');

describe('the am lane', () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-lane-'));
  const tgz = join(dir, 'automagik-am-3.64.1.tgz');
  writeFileSync(tgz, 'the am');
  const commit = 'a'.repeat(40);

  test('am.json names the release, the tarball\'s URL, sha256 and size, and a monotonic sequence', () => {
    const p = pointer(tgz, { version: '3.64.1', commit, issuedAt: '2026-11-03T00:00:00Z' });
    expect(p).toMatchObject({ schemaVersion: 1, publisher: 'automagik', part: 'automagik.am', keyId: KEY_ID, sequence: 640001, version: '3.64.1', tag: 'v3.64.1', commit });
    expect(p.tarball).toEqual({
      name: 'automagik-am-3.64.1.tgz',
      url: 'https://github.com/automagik-dev/automagik/releases/download/v3.64.1/automagik-am-3.64.1.tgz',
      sha256: createHash('sha256').update('the am').digest('hex'),
      size: 6,
    });
    expect(() => pointer(tgz, { version: '3.64.2', commit, issuedAt: 'x' })).toThrow(/is not automagik-am-3\.64\.2\.tgz/);
    expect(() => pointer(tgz, { version: '3.64.1', commit: 'HEAD', issuedAt: 'x' })).toThrow(/not a commit/);
  });

  test('the signer\'s pointer is one am accepts (am/lib/lane.mjs); another key or a tampered byte is refused', () => {
    const key = pair();
    const keys = [{ keyId: KEY_ID, publicKey: key.pub }];
    const bytes = Buffer.from(JSON.stringify(pointer(tgz, { version: '3.64.1', commit, issuedAt: 'x' })));
    const sig = signPointer(bytes, key.priv);
    expect(verify(bytes, sig, keys).version).toBe('3.64.1');
    expect(() => verify(bytes, sig, [{ keyId: KEY_ID, publicKey: pair().pub }])).toThrow(/signature does not match/);
    const tampered = Buffer.from(bytes.toString().replace('3.64.1', '3.64.9'));
    expect(() => verify(tampered, sig, keys)).toThrow(/signature does not match/);
    expect(() => verify(bytes, sig, [])).toThrow(/does not trust/);
  });

  test('check-key: unset is a warning and no signing; a listed key signs; any other key fails before the tag', () => {
    const key = pair();
    const keys = [{ keyId: KEY_ID, publicKey: key.pub }];
    expect(keyVerdict(undefined, keys).verdict).toBe('skip');
    expect(keyVerdict('', []).verdict).toBe('skip');
    expect(keyVerdict(key.priv, keys)).toEqual({ verdict: 'sign', message: `AM_LANE_KEY is ${KEY_ID}, listed in am/am-keys.json` });
    expect(keyVerdict(pair().priv, keys)).toEqual({ verdict: 'fail', message: 'AM_LANE_KEY\'s public key is not in am/am-keys.json' });
    expect(keyVerdict(key.priv, []).verdict).toBe('fail');
    expect(keyVerdict('not a key', keys)).toEqual({ verdict: 'fail', message: 'AM_LANE_KEY is not a private key (PEM)' });
  });

  test('check-key as the release runs it: sign=no with a ::warning:: and exit 0 while the secret is absent', () => {
    const out = join(dir, 'github-output');
    writeFileSync(out, '');
    const env = { ...process.env, GITHUB_OUTPUT: out };
    delete (env as Record<string, string | undefined>).AM_LANE_KEY;
    const absent = spawnSync('bun', [SCRIPT, 'check-key'], { encoding: 'utf8', env });
    expect(absent.status).toBe(0);
    expect(absent.stdout).toMatch(/^::warning::am lane: AM_LANE_KEY is not set: this release attaches automagik-am-<v>\.tgz but posts no am-lane pointer/);
    expect(readFileSync(out, 'utf8')).toBe('sign=no\n');
    // A key that am-keys.json does not list (it lists none yet, or another) stops the run.
    const wrong = spawnSync('bun', [SCRIPT, 'check-key'], { encoding: 'utf8', env: { ...env, AM_LANE_KEY: pair().priv } });
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toMatch(/AM_LANE_KEY's public key is not in am\/am-keys\.json/);
    expect(readFileSync(out, 'utf8')).toBe('sign=no\n');
  });

  test('keygen never writes the slot releases sign with: the first key to AM_LANE_KEY, a rotation to the other', () => {
    expect(slotFor([], null)).toBe('AM_LANE_KEY');
    const one = [{ keyId: KEY_ID, publicKey: 'x' }];
    expect(slotFor(one, null)).toBe('AM_LANE_KEY_NEXT');
    expect(slotFor(one, 'AM_LANE_KEY')).toBe('AM_LANE_KEY_NEXT');
    expect(slotFor(one, 'AM_LANE_KEY_NEXT')).toBe('AM_LANE_KEY');
    expect(SLOTS).toEqual(['AM_LANE_KEY', 'AM_LANE_KEY_NEXT']);
  });

  test('am\'s own key, never the pack\'s or the plugin lane\'s: am-keys.json shares no key with them', () => {
    const am = JSON.parse(readFileSync(KEYS_FILE, 'utf8')).keys.map((k: { publicKey: string }) => k.publicKey);
    const others = ['herdr/mods/am-sidebar/pack-keys.json', 'plugin-lane/keys.json']
      .flatMap(file => JSON.parse(readFileSync(join(import.meta.dir, '..', file), 'utf8')).keys.map((k: { publicKey: string }) => k.publicKey));
    expect(am.filter((k: string) => others.includes(k))).toEqual([]);
  });

  const signed = (version: string, key: { priv: string }) => {
    const file = join(dir, `automagik-am-${version}.tgz`);
    writeFileSync(file, `am ${version}`);
    const bytes = Buffer.from(JSON.stringify(pointer(file, { version, commit, issuedAt: 'x' })));
    return { bytes, sig: signPointer(bytes, key.priv) };
  };

  test('posted: the signer refuses to post a lower sequence than the posted pointer\'s', () => {
    const key = pair();
    const keys = [{ keyId: KEY_ID, publicKey: key.pub }];
    const older = signed('3.64.1', key);
    const newer = signed('3.65.0', key);
    expect(postedProblem(older.bytes, null, null, keys)).toBeNull();
    expect(postedProblem(newer.bytes, older.bytes, older.sig, keys)).toBeNull();
    expect(postedProblem(newer.bytes, newer.bytes, newer.sig, keys)).toBeNull();
    expect(postedProblem(older.bytes, newer.bytes, newer.sig, keys)).toMatch(/names 3\.65\.0 \(sequence 650000\), newer than 3\.64\.1 \(sequence 640001\): refusing to post an older one/);
    expect(postedProblem(older.bytes, newer.bytes, newer.sig, keys, { replaceUnverified: true })).toMatch(/refusing to post an older one/);
  });

  test('posted: an unverifiable posted pointer is refused unless the release says to replace it', () => {
    const key = pair();
    const keys = [{ keyId: KEY_ID, publicKey: key.pub }];
    const mine = signed('3.65.0', key);
    const other = signed('3.64.1', pair());
    for (const [posted, sig] of [[other.bytes, other.sig], [mine.bytes, null], [null, mine.sig], [Buffer.from('nope'), mine.sig]] as const) {
      expect(postedProblem(mine.bytes, posted, sig, keys)).toMatch(/does not verify .* replace_unverified_am_pointer=true/);
      expect(postedProblem(mine.bytes, posted, sig, keys, { replaceUnverified: true })).toBeNull();
    }
    expect(postedProblem(mine.bytes, mine.bytes, mine.sig, [])).toMatch(/a key this am does not trust/);
  });
});
