#!/usr/bin/env bun
/**
 * The meter lane: a signed pointer to the newest usagemeter build (docs/rfcs/0017-usagemeter-crate.md,
 * "Release and trust"), as the am lane (scripts/am-lane.ts) is for am. A release that builds the
 * meter attaches its four binaries (meter/usagemeter/part.json `artifact`) and usagemeter.SHA256SUMS,
 * and installers read only two files from the rolling `meter-lane` release, which holds nothing else:
 *
 *   https://github.com/automagik-dev/automagik/releases/download/meter-lane/meter.json
 *   https://github.com/automagik-dev/automagik/releases/download/meter-lane/meter.json.sig
 *
 * meter.json names the newest meter's release and, per target, its asset's name, URL, sha256 and
 * size; meter.json.sig is ed25519 over its exact bytes, detached, base64, made with the
 * METER_LANE_KEY Actions secret, the meter's own key (never PLUGIN_LANE_KEY, HERDR_PACK_KEY or
 * AM_LANE_KEY). The public keys are meter/usagemeter/meter-keys.json; it lists none until the owner
 * makes the key (RFC 0017 delivery 5). The key comes first (Chat, 2026-11-09): no release builds,
 * attaches or signs the meter while it lists none (scripts/lane.ts meterHeld), so every meter build
 * that reaches a release is signed; installers keep the pack's pin until then.
 *
 *   bun scripts/meter-lane.ts manifest <dir> <version> <commit> <issuedAt>   print meter.json for the
 *       four binaries and usagemeter.SHA256SUMS in <dir>, each checked against that list; its keyId
 *       the meter-keys.json entry whose public key is METER_LANE_KEY's
 *   bun scripts/meter-lane.ts sign <meter.json>        print its signature (METER_LANE_KEY, PEM)
 *   bun scripts/meter-lane.ts verify <meter.json> <sig>  check it against meter-keys.json
 *   bun scripts/meter-lane.ts matches <meter.json> <dir>  check it names exactly the binaries in <dir>
 *       (each one's sha256 and size, and usagemeter.SHA256SUMS there): the meter-lane job posts only
 *       a pointer to the build its release holds
 *   bun scripts/meter-lane.ts posted <meter.json> <dir>  refuse to post it when <dir> holds the posted
 *       pointer (meter.json, meter.json.sig), it verifies, and its sequence is higher; or when <dir>
 *       holds a posted pointer that does not verify, unless METER_LANE_REPLACE_UNVERIFIED=true (the
 *       release's replace_unverified_meter_pointer input)
 *   bun scripts/meter-lane.ts check-key                before the tag, on a release that builds the
 *       meter (so meter-keys.json lists a key, or the lane would be held): METER_LANE_KEY must be set
 *       and be a listed key, `sign=yes` to $GITHUB_OUTPUT; anything else fails the run before the tag,
 *       so no unsigned meter build is ever attached. There is no warn-only path: unlike am, which
 *       every release carries, the meter is never built without its key.
 *   bun scripts/meter-lane.ts keygen [--repo <owner/repo>] [--key-id <id>]
 *       the owner's step, never CI's or a contributor's: an ed25519 pair generated in memory; the
 *       private key goes straight to `gh secret set` on its stdin (never printed, never written to
 *       disk), and only then is the public key added to meter-keys.json (commit it). The first key
 *       goes to METER_LANE_KEY. A rotation is two phases (RFC 0011): keygen puts the new key in the
 *       slot that is NOT signing (the METER_LANE_SIGNER variable names the one that is;
 *       METER_LANE_KEY when unset), so releases keep signing with the old key while installers
 *       carrying the new public key ship; later `gh variable set METER_LANE_SIGNER --body <the new
 *       slot>` switches.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, createPublicKey, generateKeyPairSync, verify as verifyBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { keyIdOf, publicOf } from './herdr-lane';
import { ROOT, sequenceOf, signLane } from './lane';
import { VERSION } from './version';

export const LANE_RELEASE = 'meter-lane';
export const POINTER = 'meter.json';
export const SIGNATURE = 'meter.json.sig';
export const SUMS = 'usagemeter.SHA256SUMS';
export const SCHEMA_VERSION = 1;
export const PART = 'automagik.usagemeter';
export const KEY_ID = 'meter-2026-11';
export const REPOSITORY = 'https://github.com/automagik-dev/automagik';
const DOWNLOADS = `${REPOSITORY}/releases/download/`;
/** The two secret slots a rotation alternates between; release.yml signs with the one METER_LANE_SIGNER names. */
export const SLOTS = ['METER_LANE_KEY', 'METER_LANE_KEY_NEXT'] as const;
export const KEYS_FILE = join(ROOT, 'meter', 'usagemeter', 'meter-keys.json');
export const PART_FILE = join(ROOT, 'meter', 'usagemeter', 'part.json');

/** Target (`<os>-<arch>`) to asset name, from part.json's `artifact`: the four every meter release carries. */
export const ARTIFACTS: Record<string, string> = JSON.parse(readFileSync(PART_FILE, 'utf8')).artifact;

export interface MeterKey { keyId: string; publicKey: string }
export interface MeterAsset { name: string; url: string; sha256: string; size: number }
export interface MeterPointer {
  schemaVersion: number;
  publisher: 'automagik';
  part: 'automagik.usagemeter';
  keyId: string;
  /** Monotonic across releases (3.N.P as N·10000 + P): an installer refuses a pointer older than one it took. */
  sequence: number;
  issuedAt: string;
  repository: string;
  version: string;
  tag: string;
  commit: string;
  /** Per target, the asset on vX.Y.Z. */
  assets: Record<string, MeterAsset>;
}

/** usagemeter.SHA256SUMS's lines (`<sha256>  <name>`, sha256sum's format) as name to sha256. */
export function parseSums(text: string): Record<string, string> {
  const sums: Record<string, string> = {};
  for (const line of text.split('\n').filter(Boolean)) {
    const match = /^([0-9a-f]{64}) [ *](\S+)$/.exec(line);
    if (!match) throw new Error(`meter lane: ${SUMS} has a line that is not sha256sum's: ${line}`);
    if (match[2] in sums) throw new Error(`meter lane: ${SUMS} names ${match[2]} twice`);
    sums[match[2]] = match[1];
  }
  return sums;
}

/**
 * meter.json for the binaries in `dir`, released as v`version` from `commit`. Every target's asset
 * must be there and match its line in `dir`'s usagemeter.SHA256SUMS, which names exactly the four.
 */
export function pointer(dir: string, { version, commit, issuedAt, keyId = KEY_ID, artifacts = ARTIFACTS }: { version: string; commit: string; issuedAt: string; keyId?: string; artifacts?: Record<string, string> }): MeterPointer {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`not a commit: ${commit}`);
  const sums = parseSums(readFileSync(join(dir, SUMS), 'utf8'));
  const names = Object.values(artifacts);
  const extra = Object.keys(sums).filter(name => !names.includes(name));
  if (extra.length > 0) throw new Error(`meter lane: ${SUMS} names ${extra.join(', ')}, not a meter asset`);
  const assets: Record<string, MeterAsset> = {};
  for (const [target, name] of Object.entries(artifacts)) {
    let bytes: Buffer;
    try { bytes = readFileSync(join(dir, name)); } catch { throw new Error(`meter lane: ${name} (${target}) is missing`); }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sums[name] === undefined) throw new Error(`meter lane: ${SUMS} does not list ${name}`);
    if (sums[name] !== sha256) throw new Error(`meter lane: ${name} does not match its line in ${SUMS}`);
    if (bytes.byteLength === 0) throw new Error(`meter lane: ${name} is empty`);
    assets[target] = { name, url: `${DOWNLOADS}v${version}/${name}`, sha256, size: bytes.byteLength };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    publisher: 'automagik',
    part: PART,
    keyId,
    sequence: sequenceOf(version),
    issuedAt,
    repository: REPOSITORY,
    version,
    tag: `v${version}`,
    commit,
    assets,
  };
}

export const signPointer = signLane;

const fail = (why: string): never => { throw new Error(`meter lane: ${why}`); };

/** Throws unless `p` is a meter pointer whose fields agree with each other and name the four assets; returns it. */
export function checkPointer(p: unknown, artifacts = ARTIFACTS): MeterPointer {
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('the pointer is not a JSON object');
  const q = p as MeterPointer;
  if (q.schemaVersion !== SCHEMA_VERSION || q.part !== PART) fail(`not a meter pointer (schema ${q.schemaVersion}, part ${q.part})`);
  if (q.publisher !== 'automagik' || q.repository !== REPOSITORY) fail('the pointer is not Automagik\'s');
  if (typeof q.version !== 'string' || !VERSION.test(q.version)) fail(`the pointer's version is not a release version: ${q.version}`);
  if (q.tag !== `v${q.version}`) fail(`the pointer's tag ${q.tag} is not v${q.version}`);
  if (!Number.isSafeInteger(q.sequence) || q.sequence !== sequenceOf(q.version)) fail(`the pointer's sequence ${q.sequence} is not ${q.version}'s`);
  if (typeof q.commit !== 'string' || !/^[0-9a-f]{40}$/.test(q.commit)) fail('the pointer names no commit');
  const assets = q.assets && typeof q.assets === 'object' ? q.assets : {};
  if (Object.keys(assets).sort().join() !== Object.keys(artifacts).sort().join()) fail(`the pointer's targets are not ${Object.keys(artifacts).join(', ')}`);
  for (const [target, name] of Object.entries(artifacts)) {
    const a = assets[target] ?? ({} as MeterAsset);
    if (a.name !== name) fail(`the pointer's ${target} asset ${a.name} is not ${name}`);
    if (a.url !== `${DOWNLOADS}${q.tag}/${name}`) fail(`the pointer's ${name} URL ${a.url} is not on ${q.tag}`);
    if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) fail(`the pointer names no sha256 for ${name}`);
    if (!Number.isSafeInteger(a.size) || a.size <= 0) fail(`the pointer names no size for ${name}`);
  }
  return q;
}

/**
 * The pointer in `bytes` (meter.json's exact bytes) when `signature` (base64) verifies against the
 * key it names among `keys` and its fields are a meter pointer's; throws otherwise, "meter lane: …".
 */
export function verify(bytes: Buffer, signature: string, keys: MeterKey[]): MeterPointer {
  let parsed: { keyId?: string } | undefined;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { fail('the pointer is not JSON'); }
  const key = keys.find(entry => entry.keyId === parsed?.keyId);
  if (!key) fail(`the pointer is signed by ${parsed?.keyId}, a key meter-keys.json does not list`);
  let ok = false;
  try { ok = verifyBytes(null, bytes, createPublicKey(key!.publicKey), Buffer.from(String(signature ?? '').trim(), 'base64')); } catch { /* not a key */ }
  if (!ok) fail('the signature does not match');
  return checkPointer(parsed);
}

/** Throws unless `p` names exactly the binaries in `dir` (their sha256 and size, and `dir`'s usagemeter.SHA256SUMS). */
export function matches(p: MeterPointer, dir: string, artifacts = ARTIFACTS): void {
  const fresh = pointer(dir, { version: p.version, commit: p.commit, issuedAt: p.issuedAt, keyId: p.keyId, artifacts });
  for (const target of Object.keys(artifacts)) {
    const [mine, theirs] = [p.assets[target], fresh.assets[target]];
    if (mine?.sha256 !== theirs.sha256 || mine?.size !== theirs.size || mine?.url !== theirs.url) fail(`the pointer's ${theirs.name} is not the one v${p.version} holds`);
  }
}

/**
 * What check-key decides: `sign` when METER_LANE_KEY is a key meter-keys.json lists; `fail` (with
 * why) otherwise. It runs only on a release that builds the meter, which the lane allows only once a
 * key is listed (scripts/lane.ts meterHeld): an empty list here means the hold was bypassed, and an
 * unset secret means the release would attach an unsigned build. Both stop the run before the tag.
 * keygen sets the secret before it writes the key, so a listed key with no secret is a mistake.
 */
export function keyVerdict(privatePem: string | undefined, keys: MeterKey[]): { verdict: 'sign' | 'fail'; message: string } {
  if (keys.length === 0) {
    return { verdict: 'fail', message: 'meter/usagemeter/meter-keys.json lists no key, so the meter lane is held (scripts/lane.ts meterHeld) and no release may build the meter. The owner makes the key (bun scripts/meter-lane.ts keygen; RFC 0017 delivery 5)' };
  }
  if (!privatePem) {
    return { verdict: 'fail', message: 'METER_LANE_KEY is not set (the slot METER_LANE_SIGNER names): a meter build is never attached unsigned' };
  }
  try { publicOf(privatePem); } catch { return { verdict: 'fail', message: 'METER_LANE_KEY is not a private key (PEM)' }; }
  const keyId = keyIdOf(privatePem, keys);
  return keyId
    ? { verdict: 'sign', message: `METER_LANE_KEY is ${keyId}, listed in meter/usagemeter/meter-keys.json` }
    : { verdict: 'fail', message: 'METER_LANE_KEY\'s public key is not in meter/usagemeter/meter-keys.json' };
}

/**
 * Why `next` (meter.json's bytes) must not replace the posted pointer, or null when it may: as
 * am-lane's postedProblem. Nothing posted yet is no reason to stop; a posted pointer that verifies
 * with a higher sequence always stops it; one that does not verify stops it too, unless
 * `replaceUnverified` (the release's replace_unverified_meter_pointer input).
 */
export function postedProblem(next: Buffer, posted: Buffer | null, postedSig: string | null, keys: MeterKey[], { replaceUnverified = false } = {}): string | null {
  if (!posted && postedSig === null) return null;
  let current: MeterPointer;
  try {
    if (!posted) throw new Error('meter.json is missing');
    if (postedSig === null) throw new Error('meter.json.sig is missing');
    current = verify(posted, postedSig, keys);
  } catch (error) {
    if (replaceUnverified) return null;
    const why = (error as Error).message.replace(/^meter lane: /, '');
    return `the posted meter-lane pointer does not verify (${why}), so its sequence is unknown: refusing to replace it. Dispatch the release with replace_unverified_meter_pointer=true once you have checked it is not newer`;
  }
  const mine = JSON.parse(next.toString('utf8')) as MeterPointer;
  return current.sequence > mine.sequence
    ? `the posted meter-lane pointer names ${current.version} (sequence ${current.sequence}), newer than ${mine.version} (sequence ${mine.sequence}): refusing to post an older one`
    : null;
}

/** The secret slot keygen writes: METER_LANE_KEY for the first key, else the slot that is not `signer`. */
export const slotFor = (keys: MeterKey[], signer: string | null) =>
  keys.length === 0 ? SLOTS[0] : (signer === SLOTS[1] ? SLOTS[0] : SLOTS[1]);

const readKeys = (): MeterKey[] => JSON.parse(readFileSync(KEYS_FILE, 'utf8')).keys ?? [];

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const flag = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
  if (command === 'manifest' && args.length === 4) {
    const [dir, version, commit, issuedAt] = args;
    const keyId = process.env.METER_LANE_KEY ? keyIdOf(process.env.METER_LANE_KEY, readKeys()) : null;
    if (!keyId) throw new Error(`meter lane: ${keyVerdict(process.env.METER_LANE_KEY, readKeys()).message}`);
    console.log(JSON.stringify(pointer(dir, { version, commit, issuedAt, keyId }), null, 2));
  } else if (command === 'sign' && args.length === 1) {
    const key = process.env.METER_LANE_KEY;
    if (!key) throw new Error('METER_LANE_KEY is not set');
    console.log(signPointer(readFileSync(args[0]), key));
  } else if (command === 'verify' && args.length === 2) {
    const found = verify(readFileSync(args[0]), readFileSync(args[1], 'utf8'), readKeys());
    console.log(`meter lane ${found.version} (sequence ${found.sequence}) is signed by ${found.keyId}`);
  } else if (command === 'matches' && args.length === 2) {
    const found = checkPointer(JSON.parse(readFileSync(args[0], 'utf8')));
    matches(found, args[1]);
    console.log(`meter lane ${found.version}: the pointer names the binaries ${args[1]} holds`);
  } else if (command === 'posted' && args.length === 2) {
    const [file, dir] = args;
    const read = (name: string) => { try { return readFileSync(join(dir, name)); } catch { return null; } };
    const posted = read(POINTER);
    const sig = read(SIGNATURE);
    const next = readFileSync(file);
    const postedSig = sig === null ? null : sig.toString('utf8');
    const problem = postedProblem(next, posted, postedSig, readKeys());
    const replaceUnverified = process.env.METER_LANE_REPLACE_UNVERIFIED === 'true';
    if (problem && replaceUnverified && postedProblem(next, posted, postedSig, readKeys(), { replaceUnverified }) === null) {
      console.log(`::warning::meter lane: ${problem.split(': refusing')[0]}; replacing it (replace_unverified_meter_pointer)`);
    } else if (problem) {
      console.error(`meter lane: ${problem}`);
      process.exit(1);
    } else {
      console.log(posted || sig ? 'meter lane: the posted pointer is not newer' : 'meter lane: no pointer posted yet');
    }
  } else if (command === 'check-key' && args.length === 0) {
    const { verdict, message } = keyVerdict(process.env.METER_LANE_KEY, readKeys());
    if (verdict === 'fail') { console.error(`::error::meter lane: ${message}`); process.exit(1); }
    console.log(`meter lane: ${message}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'sign=yes\n');
  } else if (command === 'keygen') {
    // The owner's step (RFC 0017 delivery 5): it writes a repository secret and the keys file.
    const repo = flag('--repo', 'automagik-dev/automagik');
    const keyId = flag('--key-id', KEY_ID);
    const keys = readKeys();
    if (keys.some(entry => entry.keyId === keyId)) throw new Error(`meter-keys.json already lists ${keyId}: pick a new --key-id to rotate`);
    // Never the slot releases sign with: a rotation's new key waits in the other one (phase 1).
    const signer = keys.length === 0 ? null : spawnSync('gh', ['variable', 'get', 'METER_LANE_SIGNER', '--repo', repo], { encoding: 'utf8' });
    const slot = slotFor(keys, signer && signer.status === 0 ? signer.stdout.trim() : null);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const secret = spawnSync('gh', ['secret', 'set', slot, '--repo', repo], { input: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), stdio: ['pipe', 'inherit', 'inherit'] });
    if (secret.status !== 0) { console.error('meter lane: gh secret set failed; nothing was written'); process.exit(1); }
    const next = [...keys, { keyId, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() }];
    writeFileSync(KEYS_FILE, `${JSON.stringify({ keys: next }, null, 2)}\n`);
    console.log(`meter lane: ${slot} set on ${repo}; ${keyId} added to meter/usagemeter/meter-keys.json. Commit it.`);
    if (keys.length > 0) console.log(`Phase 2, only after a release has shipped this meter-keys.json and installers have taken it: gh variable set METER_LANE_SIGNER --body ${slot} --repo ${repo}`);
  } else {
    console.error('usage: bun scripts/meter-lane.ts manifest <dir> <version> <commit> <issuedAt> | sign <meter.json> | verify <meter.json> <sig> | matches <meter.json> <dir> | posted <meter.json> <dir> | check-key | keygen [--repo <owner/repo>] [--key-id <id>]');
    process.exit(2);
  }
}
