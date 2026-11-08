#!/usr/bin/env node
// The usagemeter pin against the pinned release itself (CI): downloads that release's SHA256SUMS
// and its four binaries, hashes each, and checks that release.js USAGEMETER.sha256 and install.sh's
// meter_pin both name exactly those hashes. Exits 1 on any difference, 2 when neither the public
// release-download URL nor the REST API asset route can serve the release.
//
// The public URL is tried first. When it fails (a 5xx, a timeout, a network error or any other
// refusal), the same bytes come from the API asset route, which is what `gh release download`
// uses: GET /repos/<repo>/releases/tags/<tag>, then the named asset's url with Accept:
// application/octet-stream, and GITHUB_TOKEN as a bearer token when set. The route that served
// each asset is one log line; the sha256 checks are the same wherever the bytes came from.
//   node scripts/usagemeter-pin.mjs
// Apache-2.0.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USAGEMETER } from "../mods/am-sidebar/release.js";
import { releaseBase } from "../mods/am-sidebar/meterFleet.js";

const INSTALL = fileURLToPath(new URL("../install.sh", import.meta.url));
const API = `https://api.github.com/repos/${USAGEMETER.repo}`;
const PUBLIC = "public release download";
const API_ROUTE = "REST API asset route";
const nativeFetch = globalThis.fetch;

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** One GET as bytes, following redirects; a timeout or network error is an error like any refusal. */
async function download(fetchImpl, url, headers = {}) {
  const response = await fetchImpl(url, { redirect: "follow", headers, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The API headers: the release's metadata as JSON, an asset as its raw bytes, the token when set. */
const apiHeaders = (token, accept) => ({ Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) });

/**
 * The named asset through the REST API: the release's `assets`, found by name, then its `url` as
 * octet-stream. The metadata is fetched once per run (`release`), since the unauthenticated API
 * allows few requests. Throws when the API has no such release or asset; the caller reports both
 * routes' failures.
 */
async function apiAsset(name, { fetch: fetchImpl, api, tag, token, release }) {
  if (!release.value) {
    const body = await download(fetchImpl, `${api}/releases/tags/${encodeURIComponent(tag)}`, apiHeaders(token, "application/vnd.github+json"));
    try { release.value = JSON.parse(body.toString("utf8")); } catch { throw new Error(`the API's ${tag} release is not JSON`); }
  }
  const assets = Array.isArray(release.value?.assets) ? release.value.assets : [];
  const asset = assets.find((candidate) => candidate?.name === name);
  if (!asset?.url) throw new Error(`the API's ${tag} release has no asset named ${name}`);
  return download(fetchImpl, asset.url, apiHeaders(token, "application/octet-stream"));
}

/** An asset's bytes and the route that served them, the public URL first and the API on failure. */
async function get(name, ctx) {
  try {
    return { bytes: await download(ctx.fetch, `${ctx.base}/${name}`), route: PUBLIC };
  } catch (publicError) {
    try {
      return { bytes: await apiAsset(name, ctx), route: API_ROUTE };
    } catch (apiError) {
      throw new Error(`${publicError.message}; the API asset route failed too: ${apiError.message}`);
    }
  }
}

/**
 * Check the release against the pins. `pinned`, `assets` and `install` are injectable so the tests
 * can serve their own bytes; the CLI runs with release.js's maps and this checkout's install.sh.
 * Returns the exit code: 0 when every pin matches, 1 on any difference, 2 when neither route serves
 * an asset. Logs one line per asset naming the route that served it.
 */
export async function check({
  fetch: fetchImpl = nativeFetch,
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
  const ctx = { fetch: fetchImpl, base, api, tag, token, release: { value: null } };
  const problems = [];
  let sums;
  try {
    const served = await get("SHA256SUMS", ctx);
    log(`SHA256SUMS: served by the ${served.route}`);
    sums = served.bytes.toString("utf8");
  } catch (e) {
    error(`usagemeter-pin: ${e.message}`);
    return 2;
  }
  const listed = Object.fromEntries([...sums.matchAll(/^([0-9a-f]{64}) [ *](usagemeter-[a-z0-9_-]+)$/gm)].map((m) => [m[2], m[1]]));
  const script = Object.fromEntries([...readFileSync(install, "utf8").matchAll(/^ {4}(usagemeter-[a-z0-9_-]+)\) echo ([0-9a-f]{64}) ;;$/gm)].map((m) => [m[1], m[2]]));

  for (const asset of assets) {
    let served;
    try { served = await get(asset, ctx); } catch (e) { error(`usagemeter-pin: ${e.message}`); return 2; }
    log(`${asset}: served by the ${served.route}`);
    const got = digest(served.bytes);
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
