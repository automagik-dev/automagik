#!/usr/bin/env bun
/**
 * The herdr lane: a signed pointer to the newest herdr pack, as the plugin lane (scripts/lane.ts)
 * is for the plugins (docs/rfcs/0011-monorepo-parts-and-releases.md). A release carries the pack
 * only when herdr/ changed, so the pack's updater and installer do not search the releases: they
 * read two files from the rolling `herdr-lane` release, which holds nothing else:
 *
 *   https://github.com/automagik-dev/automagik/releases/download/herdr-lane/pack.json
 *   https://github.com/automagik-dev/automagik/releases/download/herdr-lane/pack.json.sig
 *
 * pack.json names the newest pack release and its tarball's URL, sha256 and size; pack.json.sig is
 * ed25519 over its exact bytes, detached, base64, made with the HERDR_PACK_KEY Actions secret (the
 * pack's own key, never PLUGIN_LANE_KEY). The public keys are herdr/mods/am-sidebar/pack-keys.json,
 * which ships inside the pack (the installed copy is the trust anchor), and the same list is
 * embedded in herdr/install.sh (a test keeps them equal).
 *
 *   bun scripts/herdr-lane.ts manifest <tgz> <version> <commit> <issuedAt>   print pack.json
 *   bun scripts/herdr-lane.ts sign <pack.json>        print its signature (HERDR_PACK_KEY, PEM)
 *   bun scripts/herdr-lane.ts verify <pack.json> <sig>  check it against pack-keys.json
 *   bun scripts/herdr-lane.ts check-key               HERDR_PACK_KEY is set, and its public key is in pack-keys.json
 *   bun scripts/herdr-lane.ts keygen [--repo <owner/repo>] [--key-id <id>]
 *       make the key: an ed25519 pair generated in memory; the private key goes straight to
 *       `gh secret set HERDR_PACK_KEY` on its stdin (never printed, never written to disk), and only
 *       then is the public key added to pack-keys.json and install.sh. A maintainer runs it once
 *       (t259 or the owner), and again to rotate: the old key stays listed until every install has
 *       a pack that knows the new one.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, verify as verifyBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ROOT, sequenceOf, signLane } from './lane';

export const LANE_RELEASE = 'herdr-lane';
export const SCHEMA_VERSION = 1;
export const KEY_ID = 'herdr-pack-2026-11';
export const KEYS_FILE = join(ROOT, 'herdr', 'mods', 'am-sidebar', 'pack-keys.json');
export const INSTALL_SH = join(ROOT, 'herdr', 'install.sh');
const REPOSITORY = 'https://github.com/automagik-dev/automagik';
const DOWNLOADS = `${REPOSITORY}/releases/download/`;

export interface PackKey { keyId: string; publicKey: string }
export interface PackPointer {
  schemaVersion: number;
  publisher: 'automagik';
  part: 'herdr';
  keyId: string;
  /** Monotonic across releases (3.N.P as N·10000 + P): a consumer can refuse an older pointer. */
  sequence: number;
  issuedAt: string;
  repository: string;
  version: string;
  tag: string;
  commit: string;
  tarball: { name: string; url: string; sha256: string; size: number };
}

/** pack.json for the pack tarball at `tgz`, released as v`version` from `commit`. */
export function pointer(tgz: string, { version, commit, issuedAt, keyId = KEY_ID }: { version: string; commit: string; issuedAt: string; keyId?: string }): PackPointer {
  const name = `automagik-herdr-pack-${version}.tgz`;
  if (basename(tgz) !== name) throw new Error(`${tgz} is not ${name}`);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`not a commit: ${commit}`);
  const bytes = readFileSync(tgz);
  return {
    schemaVersion: SCHEMA_VERSION,
    publisher: 'automagik',
    part: 'herdr',
    keyId,
    sequence: sequenceOf(version),
    issuedAt,
    repository: REPOSITORY,
    version,
    tag: `v${version}`,
    commit,
    tarball: { name, url: `${DOWNLOADS}v${version}/${name}`, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.byteLength },
  };
}

export const signPointer = signLane;

/** The pointer in `bytes` when `signature` verifies against the key it names among `keys`; throws otherwise. */
export function verifyPointer(bytes: Buffer, signature: string, keys: PackKey[]): PackPointer {
  const parsed = JSON.parse(bytes.toString('utf8')) as PackPointer;
  const key = keys.find(entry => entry.keyId === parsed.keyId);
  if (!key) throw new Error(`herdr lane: no key ${parsed.keyId}`);
  if (!verifyBytes(null, bytes, createPublicKey(key.publicKey), Buffer.from(signature.trim(), 'base64'))) throw new Error('herdr lane: the signature does not match');
  if (parsed.schemaVersion !== SCHEMA_VERSION || parsed.part !== 'herdr') throw new Error(`herdr lane: not a pack pointer (schema ${parsed.schemaVersion}, part ${parsed.part})`);
  return parsed;
}

/** The public key (SPKI PEM) of a private key (PEM). */
export const publicOf = (privatePem: string) => createPublicKey(createPrivateKey(privatePem)).export({ type: 'spki', format: 'pem' }).toString();

/** Why `privatePem` cannot sign pointers this pack trusts, or null when it can (its public key is listed as KEY_ID). */
export function keyProblem(privatePem: string | undefined, keys: PackKey[], keyId = KEY_ID): string | null {
  if (!privatePem) return 'HERDR_PACK_KEY is not set';
  let pub: string;
  try { pub = publicOf(privatePem); } catch { return 'HERDR_PACK_KEY is not a private key (PEM)'; }
  const listed = keys.find(entry => entry.keyId === keyId);
  if (!listed) return `pack-keys.json lists no ${keyId}`;
  return createPublicKey(listed.publicKey).export({ type: 'spki', format: 'pem' }).toString() === pub ? null : `HERDR_PACK_KEY is not the ${keyId} that pack-keys.json lists`;
}

/** install.sh's embedded copy of pack-keys.json: its `TRUSTED_KEYS='…'` line, parsed. */
export const installKeys = (text: string): PackKey[] => JSON.parse(/^\s*TRUSTED_KEYS='([^']*)'$/m.exec(text)?.[1] ?? 'null')?.keys;

/** `text` (install.sh) with its TRUSTED_KEYS line set to `keys`. */
export const withInstallKeys = (text: string, keys: PackKey[]) => {
  if (!/^\s*TRUSTED_KEYS='[^']*'$/m.test(text)) throw new Error('install.sh has no TRUSTED_KEYS line');
  return text.replace(/^(\s*)TRUSTED_KEYS='[^']*'$/m, (_, indent: string) => `${indent}TRUSTED_KEYS='${JSON.stringify({ keys })}'`);
};

const readKeys = (): PackKey[] => JSON.parse(readFileSync(KEYS_FILE, 'utf8')).keys ?? [];

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const flag = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
  if (command === 'manifest' && args.length === 4) {
    const [tgz, version, commit, issuedAt] = args;
    console.log(JSON.stringify(pointer(tgz, { version, commit, issuedAt }), null, 2));
  } else if (command === 'sign' && args.length === 1) {
    const key = process.env.HERDR_PACK_KEY;
    if (!key) throw new Error('HERDR_PACK_KEY is not set');
    console.log(signPointer(readFileSync(args[0]), key));
  } else if (command === 'verify' && args.length === 2) {
    const found = verifyPointer(readFileSync(args[0]), readFileSync(args[1], 'utf8'), readKeys());
    console.log(`herdr lane ${found.version} (sequence ${found.sequence}) is signed by ${found.keyId}`);
  } else if (command === 'check-key' && args.length === 0) {
    const problem = keyProblem(process.env.HERDR_PACK_KEY, readKeys());
    if (problem) { console.error(`herdr lane: ${problem} (bun scripts/herdr-lane.ts keygen makes it; RFC 0011)`); process.exit(1); }
    console.log(`herdr lane: HERDR_PACK_KEY is ${KEY_ID}, listed in pack-keys.json`);
  } else if (command === 'keygen') {
    const repo = flag('--repo', 'automagik-dev/automagik');
    const keyId = flag('--key-id', KEY_ID);
    const keys = readKeys();
    if (keys.some(entry => entry.keyId === keyId)) throw new Error(`pack-keys.json already lists ${keyId}: pick a new --key-id to rotate`);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const secret = spawnSync('gh', ['secret', 'set', 'HERDR_PACK_KEY', '--repo', repo], { input: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), stdio: ['pipe', 'inherit', 'inherit'] });
    if (secret.status !== 0) { console.error('herdr lane: gh secret set failed; nothing was written'); process.exit(1); }
    const next = [...keys, { keyId, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() }];
    writeFileSync(KEYS_FILE, `${JSON.stringify({ keys: next }, null, 2)}\n`);
    writeFileSync(INSTALL_SH, withInstallKeys(readFileSync(INSTALL_SH, 'utf8'), next));
    console.log(`herdr lane: HERDR_PACK_KEY set on ${repo}; ${keyId} added to pack-keys.json and install.sh. Commit both.`);
  } else {
    console.error('usage: bun scripts/herdr-lane.ts manifest <tgz> <version> <commit> <issuedAt> | sign <pack.json> | verify <pack.json> <sig> | check-key | keygen [--repo <owner/repo>] [--key-id <id>]');
    process.exit(2);
  }
}
