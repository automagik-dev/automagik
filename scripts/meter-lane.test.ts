import { describe, expect, test } from 'bun:test';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARTIFACTS, INSTALL_SH, KEY_ID, KEYS_FILE, PACK_KEYS_COPY, SLOTS, SUMS, checkPointer, installKeys, keyVerdict, matches, parseSums, pointer, postedProblem, signPointer, slotFor, verify, withInstallKeys, type MeterKey } from './meter-lane';
// @ts-expect-error: plain JavaScript, no types
import { METER_TARGETS, verifyMeterPointer } from '../herdr/mods/am-sidebar/meterLane.mjs';

// A throwaway key, made for this run only: no private key is ever committed.
const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
};
const SCRIPT = join(import.meta.dir, 'meter-lane.ts');
const ROOT = join(import.meta.dir, '..');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const commit = 'a'.repeat(40);
const NAMES = ['usagemeter-darwin-arm64', 'usagemeter-darwin-x86_64', 'usagemeter-linux-aarch64', 'usagemeter-linux-x86_64'];

/** A release folder as the meter job leaves it: the four binaries and usagemeter.SHA256SUMS. */
function release(version: string, { drop = '', tamper = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'meter-lane-'));
  const lines: string[] = [];
  for (const name of Object.values(ARTIFACTS)) {
    const body = `${name} ${version}`;
    if (name !== drop) writeFileSync(join(dir, name), name === tamper ? 'tampered' : body);
    lines.push(`${sha(body)}  ${name}`);
  }
  writeFileSync(join(dir, SUMS), `${lines.sort().join('\n')}\n`);
  return dir;
}

describe('the meter lane', () => {
  test('part.json names the four targets, Intel Mac included, and the part every pointer names', () => {
    expect(ARTIFACTS).toEqual({
      'darwin-arm64': 'usagemeter-darwin-arm64',
      'darwin-x86_64': 'usagemeter-darwin-x86_64',
      'linux-x86_64': 'usagemeter-linux-x86_64',
      'linux-aarch64': 'usagemeter-linux-aarch64',
    });
    const part = JSON.parse(readFileSync(join(ROOT, 'meter', 'usagemeter', 'part.json'), 'utf8'));
    expect(part).toMatchObject({ id: 'automagik.usagemeter', kind: 'binary', paths: ['meter/usagemeter/**'], provides: ['meter.usage@1'], os: ['macos', 'linux'] });
    expect(part.writes).toEqual(['~/.local/bin/usagemeter', '~/.automagik/meter/**']);
  });

  test('meter.json names the release, a monotonic sequence and, per target, the asset\'s URL, sha256 and size', () => {
    const dir = release('3.109.1');
    const p = pointer(dir, { version: '3.109.1', commit, issuedAt: '2026-11-09T00:00:00Z' });
    expect(p).toMatchObject({ schemaVersion: 1, publisher: 'automagik', part: 'automagik.usagemeter', keyId: KEY_ID, sequence: 1090001, version: '3.109.1', tag: 'v3.109.1', commit });
    expect(Object.keys(p.assets).sort()).toEqual(['darwin-arm64', 'darwin-x86_64', 'linux-aarch64', 'linux-x86_64']);
    expect(p.assets['darwin-x86_64']).toEqual({
      name: 'usagemeter-darwin-x86_64',
      url: 'https://github.com/automagik-dev/automagik/releases/download/v3.109.1/usagemeter-darwin-x86_64',
      sha256: sha('usagemeter-darwin-x86_64 3.109.1'),
      size: 'usagemeter-darwin-x86_64 3.109.1'.length,
    });
    expect(checkPointer(p)).toBe(p);
    expect(() => pointer(dir, { version: '3.109.1', commit: 'HEAD', issuedAt: 'x' })).toThrow(/not a commit/);
  });

  test('every asset must be there and match usagemeter.SHA256SUMS, which names the four and nothing else', () => {
    expect(() => pointer(release('3.109.1', { drop: 'usagemeter-darwin-x86_64' }), { version: '3.109.1', commit, issuedAt: 'x' })).toThrow(/usagemeter-darwin-x86_64 \(darwin-x86_64\) is missing/);
    expect(() => pointer(release('3.109.1', { tamper: 'usagemeter-linux-aarch64' }), { version: '3.109.1', commit, issuedAt: 'x' })).toThrow(/usagemeter-linux-aarch64 does not match its line/);
    const extra = release('3.109.1');
    writeFileSync(join(extra, SUMS), `${readFileSync(join(extra, SUMS), 'utf8')}${sha('x')}  SHA256SUMS\n`);
    expect(() => pointer(extra, { version: '3.109.1', commit, issuedAt: 'x' })).toThrow(/names SHA256SUMS, not a meter asset/);
    const short = release('3.109.1');
    writeFileSync(join(short, SUMS), readFileSync(join(short, SUMS), 'utf8').split('\n').filter(line => !line.endsWith('usagemeter-linux-x86_64')).join('\n'));
    expect(() => pointer(short, { version: '3.109.1', commit, issuedAt: 'x' })).toThrow(/does not list usagemeter-linux-x86_64/);
    expect(parseSums(`${sha('a')} *usagemeter-darwin-arm64\n`)).toEqual({ 'usagemeter-darwin-arm64': sha('a') });
    expect(() => parseSums('not a line\n')).toThrow(/not sha256sum's/);
  });

  test('the signer\'s pointer verifies; another key, a tampered byte or a pointer short of a target is refused', () => {
    const key = pair();
    const keys = [{ keyId: KEY_ID, publicKey: key.pub }];
    const p = pointer(release('3.109.1'), { version: '3.109.1', commit, issuedAt: 'x' });
    const bytes = Buffer.from(JSON.stringify(p));
    const sig = signPointer(bytes, key.priv);
    expect(verify(bytes, sig, keys).version).toBe('3.109.1');
    expect(() => verify(bytes, sig, [{ keyId: KEY_ID, publicKey: pair().pub }])).toThrow(/signature does not match/);
    expect(() => verify(Buffer.from(bytes.toString().replace('3.109.1', '3.109.9')), sig, keys)).toThrow(/signature does not match/);
    expect(() => verify(bytes, sig, [])).toThrow(/a key meter-keys\.json does not list/);
    // Signed, but not a meter pointer: no Intel Mac asset, or a URL off its tag.
    const { 'darwin-x86_64': _, ...three } = p.assets;
    const noIntel = Buffer.from(JSON.stringify({ ...p, assets: three }));
    expect(() => verify(noIntel, signPointer(noIntel, key.priv), keys)).toThrow(/targets are not/);
    const offTag = Buffer.from(JSON.stringify({ ...p, assets: { ...p.assets, 'linux-x86_64': { ...p.assets['linux-x86_64'], url: p.assets['linux-x86_64'].url.replace('v3.109.1', 'v3.1.0') } } }));
    expect(() => verify(offTag, signPointer(offTag, key.priv), keys)).toThrow(/is not on v3\.109\.1/);
    const wrongSequence = Buffer.from(JSON.stringify({ ...p, sequence: 1 }));
    expect(() => verify(wrongSequence, signPointer(wrongSequence, key.priv), keys)).toThrow(/sequence 1 is not 3\.109\.1's/);
  });

  test('matches: the posted pointer names exactly the binaries the release holds', () => {
    const dir = release('3.109.1');
    const p = pointer(dir, { version: '3.109.1', commit, issuedAt: 'x' });
    expect(() => matches(p, dir)).not.toThrow();
    // Another build of the same release (a re-run that replaced a binary), or one gone: refused.
    expect(() => matches(p, release('3.109.1', { tamper: 'usagemeter-darwin-arm64' }))).toThrow(/does not match its line/);
    const other = release('3.109.1');
    writeFileSync(join(other, 'usagemeter-linux-x86_64'), 'rebuilt');
    writeFileSync(join(other, SUMS), readFileSync(join(other, SUMS), 'utf8').replace(sha('usagemeter-linux-x86_64 3.109.1'), sha('rebuilt')));
    expect(() => matches(p, other)).toThrow(/usagemeter-linux-x86_64 is not the one v3\.109\.1 holds/);
    expect(() => matches(p, release('3.109.1', { drop: 'usagemeter-darwin-x86_64' }))).toThrow(/is missing/);
  });

  test('check-key: a listed key signs; no key listed, the secret unset, or another key fails before the tag', () => {
    const key = pair();
    const keys = [{ keyId: KEY_ID, publicKey: key.pub }];
    expect(keyVerdict(key.priv, keys)).toEqual({ verdict: 'sign', message: `METER_LANE_KEY is ${KEY_ID}, listed in meter/usagemeter/meter-keys.json` });
    // The key comes first: no warn-only path, so no meter build is ever attached unsigned.
    expect(keyVerdict(undefined, keys)).toEqual({ verdict: 'fail', message: 'METER_LANE_KEY is not set (the slot METER_LANE_SIGNER names): a meter build is never attached unsigned' });
    expect(keyVerdict('', keys).verdict).toBe('fail');
    expect(keyVerdict(pair().priv, keys)).toEqual({ verdict: 'fail', message: 'METER_LANE_KEY\'s public key is not in meter/usagemeter/meter-keys.json' });
    expect(keyVerdict('not a key', keys)).toEqual({ verdict: 'fail', message: 'METER_LANE_KEY is not a private key (PEM)' });
    // No key listed: the lane is held, so this never runs in a release; run anyway, it fails.
    for (const pem of [undefined, key.priv]) {
      expect(keyVerdict(pem, []).verdict).toBe('fail');
      expect(keyVerdict(pem, []).message).toMatch(/^meter\/usagemeter\/meter-keys\.json lists no key, so the meter lane is held/);
    }
  });

  test('the committed keys file lists the owner\'s one public key, and no private key (RFC 0017 delivery 5)', () => {
    const text = readFileSync(KEYS_FILE, 'utf8');
    expect(text).not.toMatch(/PRIVATE/i);
    const { keys } = JSON.parse(text) as { keys: MeterKey[] };
    expect(keys).toHaveLength(1);
    const [listed] = keys;
    expect(Object.keys(listed).sort()).toEqual(['keyId', 'publicKey']);
    expect(listed.keyId).toBe(KEY_ID);
    expect(listed.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n?$/);
    const pub = createPublicKey(listed.publicKey);
    expect(pub.asymmetricKeyType).toBe('ed25519');
    // It round-trips as SPKI PEM, and is not a private key in disguise.
    expect(pub.export({ type: 'spki', format: 'pem' }).toString().trim()).toBe(listed.publicKey.trim());
    expect(() => createPrivateKey(listed.publicKey)).toThrow();
    // check-key, with a key made for this run (never the real one): a key that is not the listed one
    // fails; in the committed entry's place (same id, this run's public key), it signs as that id.
    const key = pair();
    expect(keyVerdict(key.priv, keys)).toEqual({ verdict: 'fail', message: 'METER_LANE_KEY\'s public key is not in meter/usagemeter/meter-keys.json' });
    expect(keyVerdict(key.priv, [{ ...listed, publicKey: key.pub }])).toEqual({ verdict: 'sign', message: `METER_LANE_KEY is ${KEY_ID}, listed in meter/usagemeter/meter-keys.json` });
  });

  test('check-key as the release runs it: no sign=yes and exit 1 when the secret is unset or not the listed key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meter-lane-out-'));
    const out = join(dir, 'github-output');
    writeFileSync(out, '');
    const env = { ...process.env, GITHUB_OUTPUT: out };
    delete (env as Record<string, string | undefined>).METER_LANE_KEY;
    // The committed file lists the owner's key; this run's key is never it.
    expect(JSON.parse(readFileSync(KEYS_FILE, 'utf8')).keys).toHaveLength(1);
    const expected = [/^::error::meter lane: METER_LANE_KEY is not set/, /^::error::meter lane: METER_LANE_KEY's public key is not in/];
    for (const [i, secret] of [undefined, pair().priv].entries()) {
      const run = spawnSync('bun', [SCRIPT, 'check-key'], { encoding: 'utf8', env: secret ? { ...env, METER_LANE_KEY: secret } : env });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(expected[i]);
    }
    expect(readFileSync(out, 'utf8')).toBe('');
  }, 30_000);

  test('keygen never writes the slot releases sign with: the first key to METER_LANE_KEY, a rotation to the other', () => {
    expect(SLOTS).toEqual(['METER_LANE_KEY', 'METER_LANE_KEY_NEXT']);
    expect(slotFor([], null)).toBe('METER_LANE_KEY');
    const one = [{ keyId: KEY_ID, publicKey: 'x' }];
    expect(slotFor(one, null)).toBe('METER_LANE_KEY_NEXT');
    expect(slotFor(one, 'METER_LANE_KEY')).toBe('METER_LANE_KEY_NEXT');
    expect(slotFor(one, 'METER_LANE_KEY_NEXT')).toBe('METER_LANE_KEY');
  });

  test('the meter\'s own key: meter-keys.json shares no key with the pack, am or the plugin lane', () => {
    const mine = JSON.parse(readFileSync(KEYS_FILE, 'utf8')).keys.map((k: { publicKey: string }) => k.publicKey);
    const others = ['herdr/mods/am-sidebar/pack-keys.json', 'am/am-keys.json', 'plugin-lane/keys.json']
      .flatMap(file => JSON.parse(readFileSync(join(ROOT, file), 'utf8')).keys.map((k: { publicKey: string }) => k.publicKey));
    expect(mine.filter((k: string) => others.includes(k))).toEqual([]);
    // And the script reads only its own secret.
    const text = readFileSync(SCRIPT, 'utf8');
    for (const other of ['PLUGIN_LANE_KEY', 'HERDR_PACK_KEY', 'AM_LANE_KEY']) expect(text).not.toMatch(new RegExp(`process\\.env\\.${other}`));
  });

  const signed = (version: string, key: { priv: string }) => {
    const bytes = Buffer.from(JSON.stringify(pointer(release(version), { version, commit, issuedAt: 'x' })));
    return { bytes, sig: signPointer(bytes, key.priv) };
  };

  test('posted: the signer refuses to post a lower sequence than the posted pointer\'s', () => {
    const key = pair();
    const keys = [{ keyId: KEY_ID, publicKey: key.pub }];
    const older = signed('3.109.1', key);
    const newer = signed('3.110.0', key);
    expect(postedProblem(older.bytes, null, null, keys)).toBeNull();
    expect(postedProblem(newer.bytes, older.bytes, older.sig, keys)).toBeNull();
    // A re-run of the same release posts its own sequence again.
    expect(postedProblem(newer.bytes, newer.bytes, newer.sig, keys)).toBeNull();
    expect(postedProblem(older.bytes, newer.bytes, newer.sig, keys)).toMatch(/names 3\.110\.0 \(sequence 1100000\), newer than 3\.109\.1 \(sequence 1090001\): refusing to post an older one/);
    // replace_unverified never lets a lower sequence over a pointer that verifies.
    expect(postedProblem(older.bytes, newer.bytes, newer.sig, keys, { replaceUnverified: true })).toMatch(/refusing to post an older one/);
  });

  test('posted: an unverifiable posted pointer is refused unless the release says to replace it', () => {
    const key = pair();
    const keys = [{ keyId: KEY_ID, publicKey: key.pub }];
    const mine = signed('3.110.0', key);
    const other = signed('3.109.1', pair());
    for (const [posted, sig] of [[other.bytes, other.sig], [mine.bytes, null], [null, mine.sig], [Buffer.from('nope'), mine.sig]] as const) {
      expect(postedProblem(mine.bytes, posted, sig, keys)).toMatch(/does not verify .* replace_unverified_meter_pointer=true/);
      expect(postedProblem(mine.bytes, posted, sig, keys, { replaceUnverified: true })).toBeNull();
    }
  });

  test('posted as the release runs it, with a per-run key: exit 1 on a lower sequence or an unverified pointer', () => {
    // The CLI reads the repository's meter-keys.json, which lists only the owner's key, never this
    // run's: a pointer this run signs is unverifiable, so the run refuses unless replace_unverified.
    const key = pair();
    const dir = mkdtempSync(join(tmpdir(), 'meter-lane-posted-'));
    const posted = join(dir, 'posted');
    mkdirSync(posted);
    const mine = signed('3.110.0', key);
    writeFileSync(join(dir, 'meter.json'), mine.bytes);
    const run = (env: Record<string, string> = {}) => spawnSync('bun', [SCRIPT, 'posted', join(dir, 'meter.json'), posted], { encoding: 'utf8', env: { ...process.env, ...env } });
    expect(run().status).toBe(0);
    expect(run().stdout).toContain('meter lane: no pointer posted yet');
    const older = signed('3.109.1', key);
    writeFileSync(join(posted, 'meter.json'), older.bytes);
    writeFileSync(join(posted, 'meter.json.sig'), older.sig);
    const refused = run();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/does not verify .* refusing to replace it/);
    const replaced = run({ METER_LANE_REPLACE_UNVERIFIED: 'true' });
    expect(replaced.status).toBe(0);
    expect(replaced.stdout).toContain('::warning::meter lane: the posted meter-lane pointer does not verify');
  }, 30_000);

  test('the installers carry meter-keys.json: the pack\'s copy, am\'s and install.sh\'s METER_KEYS, public keys only', () => {
    const text = readFileSync(KEYS_FILE, 'utf8');
    const keys = JSON.parse(text).keys;
    expect(keys.length).toBeGreaterThan(0);
    expect(readFileSync(PACK_KEYS_COPY, 'utf8')).toBe(text);
    expect(readFileSync(join(ROOT, 'am', 'meter-keys.json'), 'utf8')).toBe(text);
    expect(installKeys(readFileSync(INSTALL_SH, 'utf8'))).toEqual(keys);
    for (const k of keys) {
      expect(createPublicKey(k.publicKey).asymmetricKeyType).toBe('ed25519');
      expect(() => createPrivateKey(k.publicKey)).toThrow();
    }
    // keygen rewrites install.sh's line the same way it writes the two files.
    const next = [...keys, { keyId: 'meter-next', publicKey: pair().pub }];
    expect(installKeys(withInstallKeys(readFileSync(INSTALL_SH, 'utf8'), next))).toEqual(next);
    expect(() => withInstallKeys('#!/bin/sh\n', next)).toThrow(/no METER_KEYS line/);
    expect(readFileSync(SCRIPT, 'utf8')).toMatch(/writeFileSync\(PACK_KEYS_COPY, file\);\n\s*writeFileSync\(INSTALL_SH, withInstallKeys/);
  });

  test('the pack\'s verifier (meterLane.mjs) takes what this script signs, and nothing changed or signed by another key', () => {
    expect(METER_TARGETS).toEqual(ARTIFACTS);
    const key = pair();
    const keys = [{ keyId: KEY_ID, publicKey: key.pub }];
    const { bytes, sig } = signed('3.109.1', key);
    const p = verifyMeterPointer(bytes, sig, keys);
    expect(p).toMatchObject({ version: '3.109.1', sequence: 1090001, tag: 'v3.109.1', keyId: KEY_ID });
    expect(p.assets['darwin-x86_64'].sha256).toBe(sha('usagemeter-darwin-x86_64 3.109.1'));
    const changed = Buffer.from(bytes.toString('utf8').replace(sha('usagemeter-linux-x86_64 3.109.1'), 'f'.repeat(64)));
    expect(() => verifyMeterPointer(changed, sig, keys)).toThrow(/not signed by a key this pack trusts/);
    expect(() => verifyMeterPointer(bytes, sig, [{ keyId: KEY_ID, publicKey: pair().pub }])).toThrow(/not signed by a key this pack trusts/);
  });
});

describe('the meter lane\'s names', () => {
  test('the asset names are the ones installers already fetch', () => {
    expect(Object.values(ARTIFACTS).sort()).toEqual(NAMES);
  });
});
