#!/usr/bin/env node
// The Automations panel installs our scheduler release and pins its two darwin binaries by sha256
// (mods/am-automations/scheduler.js, SCHEDULER). This check downloads that release's checksums.txt
// and fails unless both pins are exactly its hashes, so a release built from a different tree
// cannot leave the panel handing out a repair command that 404s or fails its shasum.
//
//   node herdr/scripts/scheduler-pin.mjs
//
// Prints a line per pinned asset; exits 1 on any difference, 2 when GitHub cannot be read (the
// release not cut yet is a 404, which is the same "not there").
import { SCHEDULER } from "../mods/am-automations/scheduler.js";

const RELEASE = `herdr-automations-v${SCHEDULER.version}`;
const BASE = `https://github.com/${SCHEDULER.repo}/releases/download/${RELEASE}`;
const ASSETS = { arm64: "herdr-automations_darwin_arm64", amd64: "herdr-automations_darwin_amd64" };

async function get(url) {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const problems = [];
let sums;
try { sums = (await get(`${BASE}/checksums.txt`)).toString("utf8"); } catch (e) { console.error(`scheduler-pin: ${e.message}`); process.exit(2); }
const listed = Object.fromEntries([...sums.matchAll(/^([0-9a-f]{64}) [ *](\S+)$/gm)].map((m) => [m[2], m[1]]));
for (const [arch, asset] of Object.entries(ASSETS)) {
  const pinned = SCHEDULER.sha256[arch];
  if (/^[0-9a-f]{64}$/.test(pinned) && listed[asset] === pinned) console.log(`${asset}: ${pinned} ok`);
  else problems.push(`${asset}: checksums.txt says ${listed[asset] ?? "nothing"}, the panel pins ${pinned}`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`scheduler-pin: ${problem}`);
  process.exit(1);
}
console.log(`scheduler-pin: ${RELEASE} matches both darwin pins`);
