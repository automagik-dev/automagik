#!/usr/bin/env node
// The usagemeter pin against the pinned release itself (CI): downloads that release's SHA256SUMS
// and its four binaries, hashes each, and checks that release.js USAGEMETER.sha256 and install.sh's
// meter_pin both name exactly those hashes. Exits 1 on any difference, 2 when neither the public
// release-download URL nor the REST API asset route can serve the release. Both routes are
// release-assets.mjs's (shared with scheduler-pin.mjs): the public URL first, the API asset route
// on a 5xx, a timeout or a network error, one route log line per asset, the token only as a bearer
// header. The sha256 checks are the same wherever the bytes came from.
//   node scripts/usagemeter-pin.mjs
// Apache-2.0.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USAGEMETER } from "../mods/am-sidebar/release.js";
import { releaseBase } from "../mods/am-sidebar/meterFleet.js";
import { releaseAssets } from "./release-assets.mjs";

const INSTALL = fileURLToPath(new URL("../install.sh", import.meta.url));
const API = `https://api.github.com/repos/${USAGEMETER.repo}`;

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Check the release against the pins. `pinned`, `assets` and `install` are injectable so the tests
 * can serve their own bytes; the CLI runs with release.js's maps and this checkout's install.sh.
 * Returns the exit code: 0 when every pin matches, 1 on any difference, 2 when neither route serves
 * an asset. release-assets.mjs logs one line per asset naming the route that served it.
 */
export async function check({
  fetch: fetchImpl = globalThis.fetch,
  base = releaseBase(),
  api = API,
  tag = `v${USAGEMETER.version}`,
  token = process.env.GITHUB_TOKEN,
  install = INSTALL,
  pinned = USAGEMETER.sha256,
  assets = Object.values(USAGEMETER.assets),
  log = console.log,
  error = console.error,
} = {}) {
  const source = releaseAssets({ base, api, tag, token, fetch: fetchImpl, log });
  const problems = [];
  let sums;
  try {
    sums = (await source.get("SHA256SUMS")).toString("utf8");
  } catch (e) {
    error(`usagemeter-pin: ${e.message}`);
    return 2;
  }
  const listed = Object.fromEntries([...sums.matchAll(/^([0-9a-f]{64}) [ *](usagemeter-[a-z0-9_-]+)$/gm)].map((m) => [m[2], m[1]]));
  const script = Object.fromEntries([...readFileSync(install, "utf8").matchAll(/^ {4}(usagemeter-[a-z0-9_-]+)\) echo ([0-9a-f]{64}) ;;$/gm)].map((m) => [m[1], m[2]]));

  for (const asset of assets) {
    let bytes;
    try { bytes = await source.get(asset); } catch (e) { error(`usagemeter-pin: ${e.message}`); return 2; }
    const got = digest(bytes);
    const pin = pinned[asset];
    if (listed[asset] !== got) problems.push(`${asset}: SHA256SUMS says ${listed[asset] ?? "nothing"}, the download is ${got}`);
    if (pin !== got) problems.push(`${asset}: release.js pins ${pin ?? "nothing"}, the release's build is ${got}`);
    if (script[asset] !== got) problems.push(`${asset}: install.sh pins ${script[asset] ?? "nothing"}, the release's build is ${got}`);
    if (!problems.length) log(`${asset}: ${got} ok`);
  }
  for (const extra of Object.keys(pinned)) if (!assets.includes(extra)) problems.push(`release.js pins ${extra}, which is not an asset`);
  if (problems.length) {
    for (const p of problems) error(`usagemeter-pin: ${p}`);
    return 1;
  }
  log(`usagemeter v${USAGEMETER.version}: release.js and install.sh pin the release's four builds.`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await check();
