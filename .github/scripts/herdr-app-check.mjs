#!/usr/bin/env node
// Every mod the pack ships must load in the real Herdr app, not just pass the pack's tests. A pack
// mod that imported node:url passed every test once and failed only in the app (#624); the
// import-graph test now catches that form statically (#652), and this is the app's own loader as
// the last gate before a release ships. The Linux build is pinned to ONE version and ONE sha256
// (the numbers https://releases.herdr.dev/app/latest.json published for 0.1.13 when the pin was
// made): no "latest" tag, no secrets. A bump changes VERSION and SHA256 together.
//
//   node .github/scripts/herdr-app-check.mjs [--pack <file.tgz>]
//
// Without --pack it builds the pack from HEAD with herdr/scripts/pack.mjs, the way release.yml
// packs the tag, and checks the archive's mod folders, not the source tree. `herdr-app check`
// loads the mod in-process: it needs the app's shared libraries (libxkbcommon-x11-0, which brings
// libxcb-xkb1) but no X server, so no xvfb. Every result and the step's wall time are printed;
// the run fails (exit 1, with herdr-app's own output for the mod) when the download, the sha256,
// the app start, or any mod load fails. It never skips: a broken download or missing binary is a
// failure like any other. Apache-2.0.
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
// The one pinned build: herdr-app 0.1.13, linux-x86_64, as the release feed published it.
const VERSION = "0.1.13";
const SHA256 = "77b0be72a46ca14bb367365a04164641f914b3a69712bac391d39c56a959bef4";
const BUILD = `https://releases.herdr.dev/app/${VERSION}/herdr-app-linux-x86_64.tar.gz`;
const BUDGET_MS = 2 * 60 * 1000;
const CHECK_TIMEOUT_MS = 60 * 1000;

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const fail = (message) => { throw new Error(message); };
const output = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd();

/** `{ out }` from argv, or the usage. */
function parseArgs(argv) {
  const opts = { pack: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pack" && argv[i + 1]) opts.pack = resolve(argv[++i]);
    else throw new Error("usage: node .github/scripts/herdr-app-check.mjs [--pack <file.tgz>]");
  }
  return opts;
}

/** The pack tarball from HEAD, exactly as release.yml builds it from the tag. */
function buildPack(out) {
  const script = join(REPO, "herdr", "scripts", "pack.mjs");
  if (!existsSync(script)) fail(`there is no pack builder at ${script}`);
  const r = spawnSync(process.execPath, [script, "--repo", REPO, "--ref", "HEAD", "--out", out],
    { encoding: "utf8", timeout: 120_000 });
  if (r.error || r.status !== 0) {
    fail(`the pack could not be built from HEAD (${r.error?.message ?? `exit ${r.status}`}):\n${output(r)}`);
  }
  process.stdout.write(`${r.stdout}`);
}

/** Extracts the pack and returns its folder, holding it to the PACK_MODS it claims to ship. */
function unpack(pack, dir, packMods) {
  const r = spawnSync("tar", ["-xzf", pack, "-C", dir], { encoding: "utf8", timeout: 120_000 });
  if (r.error || r.status !== 0) {
    fail(`the pack tarball could not be extracted (${r.error?.message ?? `exit ${r.status}`}):\n${output(r)}`);
  }
  const top = readdirSync(dir).sort();
  const extra = top.filter((name) => name !== "layouts" && !packMods.includes(name));
  if (extra.length) fail(`the pack's top level has entries that are not PACK_MODS: ${extra.join(" ")}`);
  for (const mod of packMods) {
    if (!existsSync(join(dir, mod, "mod.json"))) fail(`the built pack has no ${mod}/mod.json`);
  }
  return dir;
}

/** Downloads the pinned Linux build, checks the pinned sha256, and returns its executable. */
async function installApp(tmp) {
  const tarball = join(tmp, "herdr-app.tar.gz");
  let response;
  try {
    response = await fetch(BUILD, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    fail(`herdr-app ${VERSION} could not be downloaded from ${BUILD}: ${e.message}`);
  }
  if (!response.ok) fail(`herdr-app ${VERSION} could not be downloaded from ${BUILD}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== SHA256) {
    fail(`herdr-app ${VERSION} does not match its pinned sha256: got ${got}, pinned ${SHA256} (${BUILD})`);
  }
  writeFileSync(tarball, bytes);
  const appDir = join(tmp, "app");
  mkdirSync(appDir);
  const r = spawnSync("tar", ["-xzf", tarball, "-C", appDir], { encoding: "utf8", timeout: 120_000 });
  if (r.error || r.status !== 0) {
    fail(`herdr-app ${VERSION} could not be unpacked (${r.error?.message ?? `exit ${r.status}`}):\n${output(r)}`);
  }
  const bin = join(appDir, "herdr-app", "herdr-app");
  try {
    accessSync(bin, constants.X_OK);
  } catch {
    fail(`herdr-app ${VERSION}'s tarball has no executable herdr-app/herdr-app`);
  }
  return bin;
}

/** Runs the pinned app once so an unrunnable binary fails before any mod is judged. */
function checkAppRuns(bin, env) {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30_000, env });
  if (r.error || r.status !== 0) {
    fail(`herdr-app could not start (${r.error?.message ?? `exit ${r.status}`}):\n${output(r)}`);
  }
  const line = String(r.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
  if (line !== `herdr-app ${VERSION}`) fail(`herdr-app --version said "${line}", not "herdr-app ${VERSION}"`);
  process.stdout.write(`${line}\n`);
}

/** `herdr-app check <mod>`: loads it once; returns null on success, else herdr-app's output. */
function checkMod(bin, dir, env) {
  const r = spawnSync(bin, ["check", dir], { encoding: "utf8", timeout: CHECK_TIMEOUT_MS, env, maxBuffer: 16 << 20 });
  const passed = !r.error && r.status === 0 && /(^|\n)check passed:/.test(String(r.stdout ?? ""));
  if (passed) return null;
  const reason = r.error ? r.error.message : r.signal ? `killed by ${r.signal}` : `exit ${r.status}`;
  return `herdr-app check could not load this mod (${reason}):\n${output(r)}`;
}

async function main() {
  const started = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail(`the pinned herdr-app build is linux-x86_64; this runner is ${process.platform}-${process.arch}`);
  }
  const { PACK_MODS } = await import(pathToFileURL(join(REPO, "herdr", "mods", "am-sidebar", "release.js")).href);
  if (!Array.isArray(PACK_MODS) || PACK_MODS.length === 0) fail("PACK_MODS is empty: there is no pack to check");

  const tmp = mkdtempSync(join(tmpdir(), "herdr-app-check-"));
  try {
    const pack = opts.pack ?? join(tmp, "automagik-herdr-pack.tgz");
    if (opts.pack) {
      if (!existsSync(pack)) fail(`there is no pack at ${pack}`);
      process.stdout.write(`pack: ${pack}\n`);
    } else {
      buildPack(pack);
    }
    const packDir = unpack(pack, mkdtempSync(join(tmp, "pack-")), PACK_MODS);

    const bin = await installApp(tmp);
    process.stdout.write(`herdr-app ${VERSION}: sha256 ${SHA256} verified\n`);
    const home = join(tmp, "home");
    mkdirSync(home);
    const env = { ...process.env, HERDR_APP_HOME: home };
    checkAppRuns(bin, env);

    const checksStarted = Date.now();
    for (const mod of PACK_MODS) {
      const modStarted = Date.now();
      const problem = checkMod(bin, join(packDir, mod), env);
      const took = secs(Date.now() - modStarted);
      if (problem) {
        process.stderr.write(`herdr-app check ${mod}: FAILED (${took})\n${problem}\n`);
        fail(`herdr-app could not load ${mod}`);
      }
      process.stdout.write(`herdr-app check ${mod}: passed (${took})\n`);
    }
    const total = Date.now() - started;
    process.stdout.write(`herdr-app check: ${PACK_MODS.length} pack mods loaded in ${secs(Date.now() - checksStarted)};`
      + ` step wall time ${secs(total)} (budget under 2 minutes)\n`);
    if (total > BUDGET_MS) process.stdout.write(`::warning::the herdr-app check took ${secs(total)}, over its 2-minute budget\n`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  process.stderr.write(`herdr-app check: ${e.message}\n`);
  process.stderr.write("::error::herdr-app check failed\n");
  process.exit(1);
});
