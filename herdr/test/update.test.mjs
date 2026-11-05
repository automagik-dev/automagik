// The pack's updates over a fake release: no network, a temp app home for mods/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  POINTER_SIG_URL, POINTER_URL, applyUpdate, checkForUpdate, compareVersions, downloadUpdate, fetchPointer, installUpdate, noticeText, packKeys,
  packOfPointer, parseSums, verifyPointer,
  checkMods, markerOf, offDirOf, pickUpdate, repairInstall, setupHome, toCheck, prevSetOf, readMarker, readVersion, relinkCli, rollback, stateDirOf, unsafeEntries, verifySha256,
  autoFileOf, autoStatus, lockOf, managedPack, olderSequence, overtaken, readAuto, takeLock, writeAuto,
} from "../mods/am-sidebar/update.mjs";
import { formatMarker, OFF_BY_DEFAULT, parseMarker } from "../mods/am-sidebar/release.js";
import { cmdUpdate } from "../mods/am-sidebar/bin/automagik-herdr.mjs";
import { keys, pointerBytes, signatureOf } from "./pointer.mjs";

/** The herdr-lane release serving the pointer to `version` (pointerBytes' options), signed with the test key. */
const served = (version, opts = {}, { untrusted = false } = {}) => {
  const bytes = pointerBytes(version, opts);
  return { [POINTER_URL]: bytes, [POINTER_SIG_URL]: signatureOf(bytes, { untrusted }) };
};
const packOf = (version, opts) => packOfPointer(JSON.parse(pointerBytes(version, opts)));
import { OLD_PACK_NAME } from "../mods/am-sidebar/release.js";

const UPDATE = fileURLToPath(new URL("../mods/am-sidebar/update.mjs", import.meta.url));
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** A two-folder pack at `version` under `parent` (`mods` its PACK_MODS), as release.yml lays the tarball out. */
const MODS = ["am-sidebar", "am-tabs"];
function packDir(parent, version, { main = true, mod = true, mods = MODS } = {}) {
  for (const m of mods) {
    const dir = join(parent, m);
    mkdirSync(dir, { recursive: true });
    if (main || m !== "am-sidebar") writeFileSync(join(dir, "main.js"), `export const v = "${version}";\n`);
    if (mod || m !== "am-sidebar") writeFileSync(join(dir, "mod.json"), '{ "place": "none" }\n');
  }
  const pack = join(parent, "am-sidebar");
  writeFileSync(join(pack, "VERSION"), `${version}\n`);
  writeFileSync(join(pack, "release.js"), `export const PACK_MODS = ${JSON.stringify(mods)};\n`);
  writeFileSync(join(pack, "update.mjs"), "// the pack's updater\n");
  return pack;
}
function tarball(version, opts) {
  const src = mkdtempSync(join(tmpdir(), "pack-src-"));
  const tree = join(src, "tree");
  packDir(tree, version, opts);
  const out = join(src, `automagik-herdr-pack-${version}.tgz`);
  execFileSync("tar", ["czf", out, "-C", tree, ...(opts?.mods ?? MODS)], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return { path: out, buf: readFileSync(out), src };
}
/** An app home with the pack installed at `version` (or none), its ownership record listing it. */
function appHome(version, mods = MODS) {
  const home = mkdtempSync(join(tmpdir(), "app-home-"));
  const modsDir = join(home, "mods");
  mkdirSync(modsDir);
  if (version) {
    packDir(modsDir, version, { mods });
    mkdirSync(join(home, "automagik-herdr"));
    writeFileSync(join(home, "automagik-herdr", "installed-by-install.sh"), `version=${version}\nmods=${mods.join(",")}\nbefore=none\n`);
  }
  return { home, mods: modsDir };
}
const kept = (mods, m = "am-sidebar") => join(prevSetOf(mods), m);
/** fetch over a table url → body (string, Buffer, object for JSON, or a status number). */
const fakeFetch = (table, calls = []) => async (url, init) => {
  calls.push({ url, init });
  const body = table[url];
  if (body === undefined) return new Response("not found", { status: 404 });
  if (typeof body === "number") return new Response("", { status: body });
  if (Buffer.isBuffer(body) || typeof body === "string") return new Response(body);
  return Response.json(body);
};

test("compareVersions orders by semver precedence", () => {
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.0-rc.1", "0.1.0"), -1);
  assert.ok(Number.isNaN(compareVersions("v0.1.0", "0.1.0")));
});

test("the marker carries the pointer's sequence; an unknown or malformed one is none", () => {
  const text = formatMarker({ version: "3.57.1", mods: ["am-sidebar"], sequence: 570001 });
  assert.equal(text, "version=3.57.1\nmods=am-sidebar\nbefore=none\nsequence=570001\n");
  assert.equal(parseMarker(text).sequence, 570001);
  assert.equal(parseMarker("version=1.0.0\nmods=a\n").sequence, null);
  assert.equal(parseMarker("version=1.0.0\nmods=a\nsequence=12x\n").sequence, null);
  assert.doesNotMatch(formatMarker({ version: "1.0.0", mods: ["a"] }), /sequence/);
});

test("pickUpdate offers only a newer pack than the installed one", () => {
  const up = pickUpdate("0.1.0", packOf("0.2.0"));
  assert.equal(up.version, "0.2.0");
  assert.equal(up.tarball.name, "automagik-herdr-pack-0.2.0.tgz");
  assert.match(up.sha256, /^[0-9a-f]{64}$/);
  assert.equal(up.page, "https://github.com/automagik-dev/automagik/releases/tag/v0.2.0");
  assert.equal(pickUpdate("0.2.0", packOf("0.2.0")), null, "same version");
  assert.equal(pickUpdate("0.3.0", packOf("0.2.0")), null, "older");
  assert.equal(pickUpdate("0.1.0", null), null, "no pointer");
  assert.equal(pickUpdate("0.0.0", packOf("0.1.0")).version, "0.1.0", "an unreleased install takes the first release");
  assert.equal(pickUpdate("0.8.0", packOf("3.57.1")).version, "3.57.1", "an automagik-herdr v0.8.x install takes the monorepo's pack");
  assert.match(noticeText(up), /Automagik Herdr 0\.2\.0 is out/);
});

test("packOfPointer refuses what is not this pack's pointer", () => {
  const bad = (extra, re) => assert.throws(() => packOfPointer({ ...JSON.parse(pointerBytes("3.57.1")), ...extra }), re);
  bad({ schemaVersion: 2 }, /schema 2/);
  bad({ part: "plugins" }, /part plugins/);
  bad({ version: "3.57" }, /names version 3\.57/);
  bad({ tarball: { name: "automagik-herdr-pack-3.57.2.tgz", url: "https://x/y", sha256: "a".repeat(64) } }, /not automagik-herdr-pack-3\.57\.1\.tgz/);
  bad({ tarball: { name: "automagik-herdr-pack-3.57.1.tgz", url: "https://x/y", sha256: "nope" } }, /sha256/);
  bad({ tarball: { name: "automagik-herdr-pack-3.57.1.tgz", sha256: "a".repeat(64) } }, /no tarball URL/);
  bad({ sequence: undefined }, /has no sequence/);
  bad({ sequence: "570001" }, /has no sequence/);
  bad({ sequence: -1 }, /has no sequence/);
  assert.equal(packOf("3.57.1").sequence, 570001);
});

test("fetchPointer: a good signature names the pack; a bad one, an untrusted key or no signature is refused", async () => {
  assert.equal(POINTER_URL, "https://github.com/automagik-dev/automagik/releases/download/herdr-lane/pack.json");
  assert.equal(POINTER_SIG_URL, `${POINTER_URL}.sig`);
  const calls = [];
  const got = await fetchPointer({ fetch: fakeFetch(served("3.57.1"), calls), env: {}, keys });
  assert.equal(got.version, "3.57.1");
  assert.deepEqual(calls.map((c) => c.url), [POINTER_URL, POINTER_SIG_URL], "the pointer and its signature: no search through releases");
  assert.equal(calls[0].init.headers["user-agent"], "automagik-herdr");
  // A bad signature (another key's, over the same bytes) is refused.
  await assert.rejects(fetchPointer({ fetch: fakeFetch(served("3.57.1", {}, { untrusted: true })), env: {}, keys }), /signature does not match: refusing it/);
  // A pointer changed after it was signed is refused.
  const table = served("3.57.1");
  table[POINTER_URL] = Buffer.from(table[POINTER_URL].toString().replace("3.57.1", "3.57.9"));
  await assert.rejects(fetchPointer({ fetch: fakeFetch(table), env: {}, keys }), /signature does not match/);
  // A key the pack does not list, and a pointer without its signature.
  await assert.rejects(fetchPointer({ fetch: fakeFetch(served("3.57.1", { keyId: "someone-else" })), env: {}, keys }), /signed by someone-else, a key this pack does not trust/);
  await assert.rejects(fetchPointer({ fetch: fakeFetch({ [POINTER_URL]: pointerBytes("3.57.1") }), env: {}, keys }), /404 for the pack pointer's signature/);
  // No pointer yet (404): no pack released here, no update. Updates off: nothing is asked.
  assert.equal(await fetchPointer({ fetch: fakeFetch({}), env: {}, keys }), null);
  const none = [];
  assert.equal(await fetchPointer({ fetch: fakeFetch(served("3.57.1"), none), env: { AUTOMAGIK_HERDR_NO_UPDATE: "1" }, keys }), null);
  assert.equal(none.length, 0);
  await assert.rejects(fetchPointer({ fetch: fakeFetch({ [POINTER_URL]: 500 }), env: {}, keys }), /500 for the pack pointer/);
  assert.throws(() => verifyPointer(Buffer.from("not json"), "", keys), /not JSON/);
});

test("the trusted keys are the installed pack's pack-keys.json", async () => {
  const shipped = JSON.parse(readFileSync(fileURLToPath(new URL("../mods/am-sidebar/pack-keys.json", import.meta.url)), "utf8")).keys;
  assert.deepEqual(packKeys(), shipped);
  for (const key of shipped) assert.doesNotMatch(key.publicKey, /PRIVATE/);
  // Without a key passed, a pointer signed by a key the shipped file does not list is refused.
  if (!shipped.some((k) => k.keyId === "herdr-pack-test")) {
    await assert.rejects(fetchPointer({ fetch: fakeFetch(served("3.57.1")), env: {} }), /a key this pack does not trust/);
  }
});

test("verifySha256 takes a match and refuses a mismatch or a missing name", () => {
  const buf = Buffer.from("pack");
  const sums = `${sha(buf)}  automagik-herdr-0.2.0.tgz\n${"0".repeat(64)} *other.tgz\n`;
  assert.equal(parseSums(sums).get("other.tgz"), "0".repeat(64));
  assert.equal(verifySha256(buf, sums, "automagik-herdr-0.2.0.tgz"), sha(buf));
  assert.throws(() => verifySha256(Buffer.from("tampered"), sums, "automagik-herdr-0.2.0.tgz"), /does not match its \.sha256/);
  assert.throws(() => verifySha256(buf, sums, "automagik-herdr-0.3.0.tgz"), /not in its \.sha256/);
});

test("downloadUpdate refuses a tampered tarball (not the signed pointer's sha256), writing nothing", async () => {
  const t = tarball("0.2.0");
  const out = mkdtempSync(join(tmpdir(), "dl-"));
  try {
    const up = pickUpdate("0.1.0", packOf("0.2.0", { body: t.buf }));
    const tampered = Buffer.concat([t.buf, Buffer.from("x")]);
    await assert.rejects(downloadUpdate(up, { fetch: fakeFetch({ [up.tarball.url]: tampered }), dir: out }), /does not match the signed pointer/);
    assert.equal(existsSync(join(out, up.tarball.name)), false);
    const path = await downloadUpdate(up, { fetch: fakeFetch({ [up.tarball.url]: t.buf }), dir: out });
    assert.deepEqual(readFileSync(path), t.buf);
  } finally {
    rmSync(t.src, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("applyUpdate swaps the pack in, keeps the old one outside mods/, and rollback swaps back and forth", async () => {
  const { home, mods } = appHome("0.1.0");
  const t = tarball("0.2.0");
  try {
    const done = await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
    assert.equal(done.version, "0.2.0");
    assert.equal(readVersion(join(mods, "am-sidebar")), "0.2.0");
    assert.equal(done.prev, join(home, "automagik-herdr", ".prev"));
    assert.deepEqual(done.replaced, MODS);
    assert.equal(stateDirOf(mods), join(home, "automagik-herdr"));
    assert.equal(readVersion(kept(mods)), "0.1.0");
    assert.equal(readFileSync(join(kept(mods, "am-tabs"), "main.js"), "utf8"), 'export const v = "0.1.0";\n', "the whole set is kept");
    assert.deepEqual(execFileSync("ls", ["-A", mods], { encoding: "utf8" }).trim().split("\n"), MODS, "nothing else in mods/");
    assert.deepEqual(execFileSync("ls", ["-A", stateDirOf(mods)], { encoding: "utf8" }).trim().split("\n"), [".prev", "installed-by-install.sh"], "staging removed");
    assert.equal(readMarker(mods).version, "0.2.0");

    assert.equal(rollback({ modsDir: mods }).version, "0.1.0");
    assert.equal(readMarker(mods).version, "0.1.0");
    assert.equal(readVersion(kept(mods)), "0.2.0", "the rolled-back pack is kept");
    assert.equal(rollback({ modsDir: mods }).version, "0.2.0", "a second rollback undoes the first");

    const t3 = tarball("0.3.0");
    await applyUpdate({ tgzPath: t3.path, version: "0.3.0", modsDir: mods });
    assert.equal(readVersion(kept(mods)), "0.2.0", "only one pack is kept");
    rmSync(t3.src, { recursive: true, force: true });
  } finally {
    rmSync(t.src, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("applyUpdate refuses a pack without main.js or mod.json and leaves the installed one", async () => {
  const { home, mods } = appHome("0.1.0");
  const noMain = tarball("0.2.0", { main: false });
  const noMod = tarball("0.2.0", { mod: false });
  try {
    await assert.rejects(applyUpdate({ tgzPath: noMain.path, version: "0.2.0", modsDir: mods }), /am-sidebar\/ has no main\.js and mod\.json/);
    await assert.rejects(applyUpdate({ tgzPath: noMod.path, version: "0.2.0", modsDir: mods }), /refusing/);
    assert.equal(readVersion(join(mods, "am-sidebar")), "0.1.0");
    assert.equal(existsSync(prevSetOf(mods)), false);
    assert.deepEqual(execFileSync("ls", ["-A", stateDirOf(mods)], { encoding: "utf8" }).trim(), "installed-by-install.sh", "staging removed");
  } finally {
    for (const t of [noMain, noMod]) rmSync(t.src, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("applyUpdate installs into an empty mods/ and refuses a linked checkout; rollback needs a kept pack", async () => {
  const { home, mods } = appHome(null);
  const t = tarball("0.2.0");
  try {
    assert.throws(() => rollback({ modsDir: mods }), /nothing to roll back to/);
    const done = await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
    assert.equal(done.prev, null);
    assert.equal(readVersion(join(mods, "am-sidebar")), "0.2.0");
    rmSync(join(mods, "am-sidebar"), { recursive: true });
    symlinkSync(t.src, join(mods, "am-sidebar"));
    await assert.rejects(applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods }), /is a link/);
  } finally {
    rmSync(t.src, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("checkForUpdate and installUpdate against a fake release", async () => {
  const { home, mods } = appHome("0.1.0");
  const t = tarball("0.2.0");
  const url = "https://dl.test/v0.2.0/automagik-herdr-pack-0.2.0.tgz";
  const table = { ...served("0.2.0", { url, body: t.buf }), [url]: t.buf };
  try {
    const off = await checkForUpdate({ fetch: fakeFetch(table), env: { AUTOMAGIK_HERDR_NO_UPDATE: "1" }, modsDir: mods, keys });
    const { auto, ...rest } = off;
    assert.deepEqual(rest, { current: "0.1.0", latest: null, update: null, disabled: true });
    assert.equal(auto.managed, false, "an install record without sequence= (before signed releases) stays manual");
    const found = await checkForUpdate({ fetch: fakeFetch(table), env: {}, modsDir: mods, keys });
    assert.equal(found.current, "0.1.0");
    assert.equal(found.latest, "0.2.0");
    assert.equal(found.update.version, "0.2.0");
    const done = await installUpdate({ fetch: fakeFetch(table), env: {}, modsDir: mods, keys });
    assert.equal(done.installed.version, "0.2.0");
    assert.equal(readMarker(mods).sequence, 20000, "the update records the signed pointer's sequence");
    const again = await installUpdate({ fetch: fakeFetch(table), env: {}, modsDir: mods, keys });
    assert.equal(again.update, null);
    assert.equal(again.installed, null);
  } finally {
    rmSync(t.src, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("node update.mjs: one JSON line, no network with AUTOMAGIK_HERDR_NO_UPDATE=1, rollback by CLI", () => {
  const { home, mods } = appHome("0.1.0");
  try {
    // HOME too: a rollback looks at $HOME/.local/bin, which must be a scratch one.
    const env = { ...process.env, HOME: home, HERDR_APP_HOME: home, AUTOMAGIK_HERDR_NO_UPDATE: "1" };
    const out = execFileSync(process.execPath, [UPDATE, "check"], { env, encoding: "utf8" });
    const { auto, ...answer } = JSON.parse(out);
    assert.deepEqual(answer, { current: "0.1.0", latest: null, update: null, disabled: true });
    assert.deepEqual(Object.keys(auto).sort(), ["managed", "on", "skip", "why"], "the setting rides along for the mod");
    let failed;
    try { execFileSync(process.execPath, [UPDATE, "rollback", "--mods", mods], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (error) { failed = error; }
    assert.equal(failed.status, 1);
    assert.match(JSON.parse(failed.stdout).error, /nothing to roll back to/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/** One ustar entry: `type` "0" file, "1" hard link, "2" symlink, "5" folder, "6" fifo. */
function tarEntry(name, { type = "0", body = "", linkname = "", mode = 0o644 } = {}) {
  const data = Buffer.from(body);
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write(`${mode.toString(8).padStart(7, "0")}\0`, 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write(linkname, 157, 100, "utf8");
  h.write("ustar\0", 257);
  h.write("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}
/** A gzipped tarball of a valid 0.2.0 pack plus `extra` entries ([name, options]). */
function crafted(dir, file, extra) {
  const entries = [
    ["am-sidebar/", { type: "5", mode: 0o755 }],
    ["am-sidebar/main.js", { body: "export {};\n" }],
    ["am-sidebar/mod.json", { body: '{ "place": "left" }\n' }],
    ["am-sidebar/VERSION", { body: "0.2.0\n" }],
    ["am-sidebar/release.js", { body: 'export const PACK_MODS = ["am-sidebar"];\n' }],
    ["am-sidebar/update.mjs", { body: "//\n" }],
    ...extra,
  ];
  const path = join(dir, file);
  writeFileSync(path, gzipSync(Buffer.concat([...entries.map(([n, o]) => tarEntry(n, o)), Buffer.alloc(1024)])));
  return path;
}

test("unsafeEntries: only plain files and folders in pack folders, plus layouts/automagik.json", () => {
  assert.deepEqual(unsafeEntries(["am-sidebar/", "am-sidebar/main.js"], ["drwxr-xr-x 0 0 0 0 x am-sidebar/", "-rw-r--r-- 0 0 0 1 x am-sidebar/main.js"]), []);
  assert.match(unsafeEntries(["am-sidebar/l"], ["lrwxrwxrwx 0 0 0 0 x am-sidebar/l -> /etc"])[0], /not a plain file/);
  assert.match(unsafeEntries(["am-sidebar/h"], ["-rw-r--r-- 0 0 0 0 x am-sidebar/h link to am-sidebar/main.js"])[0], /not a plain file/);
  assert.match(unsafeEntries(["am-sidebar/../x"], ["-"])[0], /\.\. segment/);
  assert.match(unsafeEntries(["/etc/x"], ["-"])[0], /absolute/);
  assert.deepEqual(unsafeEntries(["am-tabs/main.js", "layouts/", "layouts/automagik.json"], ["-", "d", "-"]), []);
  for (const outside of ["evil.js", "pocket-link/main.js", "layouts/other.json", "Bad/x"]) {
    assert.match(unsafeEntries([outside], ["-"])[0], /outside the pack's folders/, outside);
  }
  assert.match(unsafeEntries([], [])[0], /empty/);
  assert.match(unsafeEntries(["a", "b"], ["-"])[0], /does not add up/);
});

test("applyUpdate refuses crafted tarballs (symlink, hard link, .., absolute, outside, fifo) and writes nothing", async () => {
  const { home, mods } = appHome("0.1.0");
  const dir = mkdtempSync(join(tmpdir(), "crafted-"));
  const cases = {
    symlink: [["am-sidebar/link", { type: "2", linkname: "/etc" }]],
    hardlink: [["am-sidebar/hard", { type: "1", linkname: "am-sidebar/main.js" }]],
    dotdot: [["am-sidebar/../evil.js", { body: "x" }]],
    absolute: [[`${home}/evil.js`, { body: "x" }]],
    outside: [["evil.js", { body: "x" }]],
    fifo: [["am-sidebar/pipe", { type: "6" }]],
  };
  try {
    for (const [label, extra] of Object.entries(cases)) {
      const tgz = crafted(dir, `${label}.tgz`, extra);
      await assert.rejects(applyUpdate({ tgzPath: tgz, version: "0.2.0", modsDir: mods }), /refusing it|Command failed/, label);
      assert.equal(readVersion(join(mods, "am-sidebar")), "0.1.0", `${label}: installed pack kept`);
      assert.equal(existsSync(join(home, "evil.js")), false, `${label}: nothing written outside`);
      assert.equal(existsSync(join(stateDirOf(mods), "evil.js")), false, `${label}: nothing written beside`);
    }
    const plain = crafted(dir, "plain.tgz", []);
    assert.equal((await applyUpdate({ tgzPath: plain, version: "0.2.0", modsDir: mods })).version, "0.2.0", "the same pack without them installs");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("applyUpdate refuses a tarball whose VERSION is not the release's, and needs the version", async () => {
  const { home, mods } = appHome("0.1.0");
  const t = tarball("0.2.0");
  try {
    await assert.rejects(applyUpdate({ tgzPath: t.path, version: "0.3.0", modsDir: mods }), /carries VERSION 0\.2\.0, not 0\.3\.0/);
    await assert.rejects(applyUpdate({ tgzPath: t.path, modsDir: mods }), /needs the release's version/);
    assert.equal(readVersion(join(mods, "am-sidebar")), "0.1.0");
  } finally {
    rmSync(t.src, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a pack made as release.yml makes it (git archive of the tag's mods/am-sidebar) installs", async (t) => {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  try {
    execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: repo, stdio: "ignore" });
  } catch {
    t.skip("not a git checkout (an export?): git archive needs the repository's history");
    return;
  }
  const { home, mods } = appHome(null);
  const tgz = join(home, "pack.tgz");
  try {
    // release.yml's "Pack the herdr pack" step: the tag's PACK_MODS folders of herdr/mods/ plus
    // the pack's layout (herdr-layout/layouts/ at the top), from the repository's top (archive in a
    // subfolder lists only its paths).
    const { PACK_MODS } = await import("../mods/am-sidebar/release.js");
    const topDir = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repo, encoding: "utf8" }).trim();
    const prefix = execFileSync("git", ["rev-parse", "--show-prefix"], { cwd: repo, encoding: "utf8" }).trim();
    const layout = join(home, "automagik.json");
    writeFileSync(layout, execFileSync("git", ["show", "HEAD:herdr-layout/layouts/automagik.json"], { cwd: topDir }));
    execFileSync("git", ["archive", "--format=tar.gz", "-o", tgz, "--prefix=layouts/", `--add-file=${layout}`, "--prefix=", `HEAD:${prefix}mods`, "--", ...PACK_MODS], { cwd: topDir });
    const top = [...new Set(execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" }).split("\n").filter(Boolean).map((n) => n.split("/")[0]))].sort();
    assert.deepEqual(top, [...PACK_MODS, "layouts"].sort());
    const version = execFileSync("git", ["show", `HEAD:${prefix}mods/am-sidebar/VERSION`], { cwd: topDir, encoding: "utf8" }).trim();
    const done = await applyUpdate({ tgzPath: tgz, version, modsDir: mods });
    assert.equal(done.version, version);
    assert.deepEqual(done.installed, [...PACK_MODS].sort());
    assert.ok(existsSync(join(mods, "am-sidebar", "update.mjs")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("update.mjs runs from a copy of the pack outside the repository (no package.json), without warnings", () => {
  const home = mkdtempSync(join(tmpdir(), "installed-"));
  try {
    const pack = join(home, "mods", "am-sidebar");
    cpSync(fileURLToPath(new URL("../mods/am-sidebar", import.meta.url)), pack, { recursive: true });
    const r = spawnSync(process.execPath, [join(pack, "update.mjs"), "check"], {
      env: { ...process.env, HERDR_APP_HOME: home, AUTOMAGIK_HERDR_NO_UPDATE: "1", NODE_OPTIONS: "" }, encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.equal(JSON.parse(r.stdout).current, readVersion(pack));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("update.mjs install needs --from and --version (install.sh's entry); any unknown flag is a usage error", () => {
  const home = mkdtempSync(join(tmpdir(), "strict-"));
  try {
    for (const args of [["install", "--from", "/nowhere.tgz"], ["rollback", "--mod", home], ["update", "--chek"], ["install", "--from", "/x.tgz", "--version", "1.0.0", "--mods"], ["nope"]]) {
      const r = spawnSync(process.execPath, [UPDATE, ...args], { encoding: "utf8", env: { ...process.env, HERDR_APP_HOME: home } });
      assert.equal(r.status, 2, args.join(" "));
      assert.match(r.stdout, /install --from <tgz> --version <v>/);
    }
    assert.equal(execFileSync("ls", ["-A", home], { encoding: "utf8" }), "", "nothing written");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a failure in the middle of the swap renames every folder back, and the record and kept set are unchanged", async () => {
  const { home, mods } = appHome("0.1.0");
  const t = tarball("0.2.0");
  try {
    let n = 0;
    const rename = (a, b) => { if (++n === 3) throw new Error("disk full"); renameSync(a, b); };
    await assert.rejects(applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods, rename }), /disk full/);
    for (const m of MODS) assert.equal(readFileSync(join(mods, m, "main.js"), "utf8"), 'export const v = "0.1.0";\n', m);
    assert.equal(readMarker(mods).version, "0.1.0");
    assert.deepEqual(execFileSync("ls", ["-A", stateDirOf(mods)], { encoding: "utf8" }).trim(), "installed-by-install.sh", "no staging, no half set");
    await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
    n = 0;
    assert.throws(() => rollback({ modsDir: mods, rename }), /disk full/);
    assert.equal(readVersion(join(mods, "am-sidebar")), "0.2.0");
    assert.equal(readVersion(kept(mods)), "0.1.0");
  } finally {
    rmSync(t.src, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("private paths are carried on update and rollback; a symlinked .state stays a link", async () => {
  const { home, mods } = appHome("0.1.0");
  const t = tarball("0.2.0");
  const elsewhere = mkdtempSync(join(tmpdir(), "state-"));
  try {
    symlinkSync(elsewhere, join(mods, "am-sidebar", ".state"));
    mkdirSync(join(mods, "am-tabs", "node_modules", "x"), { recursive: true });
    writeFileSync(join(mods, "am-tabs", ".tabs.json"), "{}\n");
    await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
    assert.equal(lstatSync(join(mods, "am-sidebar", ".state")).isSymbolicLink(), true);
    assert.equal(readlinkSync(join(mods, "am-sidebar", ".state")), elsewhere);
    assert.equal(readFileSync(join(mods, "am-tabs", ".tabs.json"), "utf8"), "{}\n");
    assert.ok(existsSync(join(mods, "am-tabs", "node_modules", "x")));
    writeFileSync(join(mods, "am-tabs", ".tabs.json"), "{\"newer\":true}\n");
    rollback({ modsDir: mods });
    assert.equal(readVersion(join(mods, "am-sidebar")), "0.1.0");
    assert.equal(readFileSync(join(mods, "am-tabs", ".tabs.json"), "utf8"), "{\"newer\":true}\n", "rollback carries the latest state back");
    assert.equal(readlinkSync(join(mods, "am-sidebar", ".state")), elsewhere);
  } finally {
    for (const d of [t.src, home, elsewhere]) rmSync(d, { recursive: true, force: true });
  }
});

test("a folder not in the record is left alone, or adopted to backup/; a retired one leaves with the set; rollback refuses a foreign folder", async () => {
  const { home, mods } = appHome("0.1.0", ["am-sidebar", "old-mod"]);
  const t = tarball("0.2.0");
  try {
    mkdirSync(join(mods, "am-tabs"));
    writeFileSync(join(mods, "am-tabs", "main.js"), "// mine\n");
    const left = await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
    assert.deepEqual([left.left, left.replaced, left.retired], [["am-tabs"], ["am-sidebar"], ["old-mod"]]);
    assert.equal(readFileSync(join(mods, "am-tabs", "main.js"), "utf8"), "// mine\n");
    assert.equal(existsSync(join(mods, "old-mod")), false);
    assert.ok(existsSync(join(kept(mods, "old-mod"), "main.js")));
    assert.deepEqual(readMarker(mods).mods, ["am-sidebar"]);
    assert.throws(() => { mkdirSync(join(mods, "old-mod")); rollback({ modsDir: mods }); }, /mods\/old-mod is not this installer's: nothing rolled back/);
    rmSync(join(mods, "old-mod"), { recursive: true });
    const adopted = await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods, adopt: true });
    assert.deepEqual(adopted.adopted.map((a) => a.mod), ["am-tabs"]);
    assert.equal(readFileSync(join(adopted.adopted[0].backup, "main.js"), "utf8"), "// mine\n");
    assert.deepEqual(readMarker(mods).mods, MODS);
    assert.match(readFileSync(markerOf(mods), "utf8"), /^adopted=am-tabs:backup\/am-tabs-\d{4}-\d\d-\d\d$/m);
  } finally {
    rmSync(t.src, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("release.js's PACK_KEYS and CATALOG_URL equal the repository's keys.json and the mod manager's index URL", async () => {
  const { PACK_KEYS, CATALOG_URL } = await import("../mods/am-sidebar/release.js");
  const core = await import("../mods/am-mods/core.js");
  assert.deepEqual(JSON.parse(JSON.stringify(PACK_KEYS)), JSON.parse(readFileSync(new URL("../keys.json", import.meta.url), "utf8")));
  assert.equal(CATALOG_URL, core.CATALOG_URL);
});

test("rollback then reinstall: a folder only the newer set had comes back with its .state", async () => {
  const { home, mods } = appHome("0.1.0", ["am-sidebar"]);
  const t = tarball("0.2.0");
  try {
    await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
    mkdirSync(join(mods, "am-tabs", ".state"));
    writeFileSync(join(mods, "am-tabs", ".state", "cred"), "SECRET\n");
    rollback({ modsDir: mods });
    assert.equal(existsSync(join(mods, "am-tabs")), false);
    assert.equal(readFileSync(join(kept(mods, "am-tabs"), ".state", "cred"), "utf8"), "SECRET\n");
    const again = await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
    assert.deepEqual(again.installed, ["am-tabs"]);
    assert.equal(readFileSync(join(mods, "am-tabs", ".state", "cred"), "utf8"), "SECRET\n");
  } finally {
    rmSync(t.src, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a failure after the swap never deletes the replaced folders, and says where they are", async () => {
  const { home, mods } = appHome("0.1.0");
  const t = tarball("0.2.0");
  try {
    // The kept set cannot take its new place: the install stands, the record names it, and the
    // replaced 0.1.0 folders wait in .prev-next-<pid>-<random> with the old set back in .prev.
    await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
    const rename = (a, b) => { if (b === prevSetOf(mods)) throw new Error("EPERM"); renameSync(a, b); };
    const t3 = tarball("0.3.0");
    const r = await applyUpdate({ tgzPath: t3.path, version: "0.3.0", modsDir: mods, rename });
    rmSync(t3.src, { recursive: true, force: true });
    assert.equal(readVersion(join(mods, "am-sidebar")), "0.3.0");
    assert.equal(readMarker(mods).version, "0.3.0");
    assert.equal(r.prev, null);
    const next = /they are in (\S+)$/.exec(r.warnings[0])?.[1];
    assert.match(r.warnings[0], new RegExp(`could not become the kept set .*they are in ${join(stateDirOf(mods), ".prev-next-")}${process.pid}-[0-9a-f]{8}$`));
    assert.equal(readVersion(join(next, "am-sidebar")), "0.2.0", "the replaced folders are kept");
    assert.equal(readVersion(kept(mods)), "0.1.0", "the older set is back in .prev, still a rollback point");
  } finally {
    rmSync(t.src, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("an older kept set that cannot be removed is reported, and the new set is still kept", { skip: process.getuid?.() === 0 }, async () => {
  const { home, mods } = appHome("0.1.0");
  const t = tarball("0.2.0");
  const t3 = tarball("0.3.0");
  const locked = () => join(stateDirOf(mods), readdirSync(stateDirOf(mods), { encoding: "utf8" }).find((n) => n.startsWith(".prev-old-")) ?? ".prev", "am-tabs");
  try {
    await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
    chmodSync(join(prevSetOf(mods), "am-tabs"), 0o555);
    const r = await applyUpdate({ tgzPath: t3.path, version: "0.3.0", modsDir: mods });
    assert.match(r.warnings[0], /older kept set could not be removed .*\.prev-old-/);
    assert.equal(readVersion(join(mods, "am-sidebar")), "0.3.0");
    assert.equal(readVersion(kept(mods)), "0.2.0", "the set just replaced is the kept one");
    chmodSync(locked(), 0o755);
  } finally {
    for (const d of [t.src, t3.src, home]) rmSync(d, { recursive: true, force: true });
  }
});

test("an earlier run's leftover .prev-next-<pid> or .prev-old-<pid> (a reused pid) is never deleted", async () => {
  const { home, mods } = appHome("0.1.0");
  const t = tarball("0.2.0");
  try {
    for (const n of [`.prev-next-${process.pid}`, `.prev-old-${process.pid}`]) {
      mkdirSync(join(stateDirOf(mods), n, "am-sidebar"), { recursive: true });
      writeFileSync(join(stateDirOf(mods), n, "am-sidebar", "main.js"), "// left by a failed run\n");
    }
    await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
    rollback({ modsDir: mods });
    for (const n of [`.prev-next-${process.pid}`, `.prev-old-${process.pid}`]) {
      assert.equal(readFileSync(join(stateDirOf(mods), n, "am-sidebar", "main.js"), "utf8"), "// left by a failed run\n", n);
    }
  } finally {
    rmSync(t.src, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("relinkCli: our link follows the pack's entry (the wrapper, or the .mjs before it); any other is left", (t) => {
  const { home, mods } = appHome("0.4.0");
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const binDir = join(home, "local-bin"); // a scratch ~/.local/bin
  mkdirSync(binDir);
  const link = join(binDir, "automagik-herdr");
  const bin = join(mods, "am-sidebar", "bin");
  const wrapper = join(bin, "automagik-herdr"), mjs = join(bin, "automagik-herdr.mjs");
  mkdirSync(bin);
  writeFileSync(mjs, "#!/usr/bin/env node\n");
  const point = (to) => { rmSync(link, { force: true }); symlinkSync(to, link); };
  // A pack from before the wrapper: a link to the .mjs is already right; one to a missing wrapper is repointed.
  point(mjs);
  assert.equal(relinkCli({ modsDir: mods, binDir }), null);
  point(wrapper);
  assert.deepEqual(relinkCli({ modsDir: mods, binDir }), { link, from: wrapper, to: mjs });
  assert.equal(readlinkSync(link), mjs);
  // A pack with the wrapper: the .mjs link (absolute or relative) moves to it, once.
  writeFileSync(wrapper, "#!/bin/sh\n");
  assert.deepEqual(relinkCli({ modsDir: mods, binDir }), { link, from: mjs, to: wrapper });
  assert.equal(relinkCli({ modsDir: mods, binDir }), null);
  point(relative(binDir, mjs));
  assert.equal(relinkCli({ modsDir: mods, binDir }).to, wrapper);
  // Not ours: another target, a regular file, no link at all.
  point("/somewhere/else/automagik-herdr.mjs");
  assert.equal(relinkCli({ modsDir: mods, binDir }), null);
  assert.equal(readlinkSync(link), "/somewhere/else/automagik-herdr.mjs");
  rmSync(link);
  writeFileSync(link, "mine\n");
  assert.equal(relinkCli({ modsDir: mods, binDir }), null);
  assert.equal(readFileSync(link, "utf8"), "mine\n");
  rmSync(link);
  assert.equal(relinkCli({ modsDir: mods, binDir }), null);
  assert.equal(existsSync(link), false);
});

test("relinkCli across the rename: a link into the old sidebar folder moves to this pack's entry, never onto nothing", (t) => {
  const { home, mods } = appHome("0.5.0");
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const binDir = join(home, "local-bin");
  mkdirSync(binDir);
  const link = join(binDir, "automagik-herdr");
  const old = join(mods, OLD_PACK_NAME, "bin", "automagik-herdr"); // a v0.4.x link; that folder is gone
  symlinkSync(old, link);
  const bin = join(mods, "am-sidebar", "bin");
  mkdirSync(bin);
  // No entry in this pack yet: the link stays where it was.
  assert.equal(relinkCli({ modsDir: mods, binDir }), null);
  assert.equal(readlinkSync(link), old);
  writeFileSync(join(bin, "automagik-herdr"), "#!/bin/sh\n");
  assert.deepEqual(relinkCli({ modsDir: mods, binDir }), { link, from: old, to: join(bin, "automagik-herdr") });
  assert.equal(relinkCli({ modsDir: mods, binDir }), null);
});

test("update --rollback to a pack without the wrapper repoints the link at its .mjs, and back again", async (t) => {
  const { home, mods } = appHome("0.3.2"); // the installed pack: no wrapper
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const pack = join(mods, "am-sidebar");
  mkdirSync(join(pack, "bin"));
  writeFileSync(join(pack, "bin", "automagik-herdr.mjs"), "x\n");
  // The update to 0.4.0 ships the wrapper; the 0.3.2 set is kept.
  const src = mkdtempSync(join(tmpdir(), "pack-src-"));
  t.after(() => rmSync(src, { recursive: true, force: true }));
  const tree = join(src, "tree");
  packDir(tree, "0.4.0");
  mkdirSync(join(tree, "am-sidebar", "bin"));
  for (const f of ["automagik-herdr", "automagik-herdr.mjs"]) writeFileSync(join(tree, "am-sidebar", "bin", f), "x\n");
  const tgz = join(src, "automagik-herdr-pack-0.4.0.tgz");
  execFileSync("tar", ["czf", tgz, "-C", tree, ...MODS], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  await applyUpdate({ tgzPath: tgz, version: "0.4.0", modsDir: mods });
  const binDir = join(home, "local-bin");
  mkdirSync(binDir);
  const link = join(binDir, "automagik-herdr");
  symlinkSync(join(pack, "bin", "automagik-herdr"), link);
  const io = { modsDir: mods, binDir, env: { HOME: join(home, "no-such-home") } };
  const back = await cmdUpdate({ rollback: true }, [], io);
  assert.match(back, /^Rolled back to Automagik Herdr 0\.3\.2 .* now points at .*automagik-herdr\.mjs\.$/);
  assert.equal(readlinkSync(link), join(pack, "bin", "automagik-herdr.mjs"));
  const json = await cmdUpdate({ rollback: true, json: true }, [], io);
  assert.equal(json.rolledBack.version, "0.4.0");
  assert.deepEqual(json.relinked, { link, from: join(pack, "bin", "automagik-herdr.mjs"), to: join(pack, "bin", "automagik-herdr") });
  assert.equal(lstatSync(link).isSymbolicLink(), true);
});

test("update when already up to date (an older CLI did the update) still moves our link to the wrapper", async (t) => {
  const { home, mods } = appHome("0.4.0");
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const binDir = join(home, "local-bin");
  mkdirSync(binDir);
  const link = join(binDir, "automagik-herdr");
  const bin = join(mods, "am-sidebar", "bin");
  mkdirSync(bin);
  for (const f of ["automagik-herdr", "automagik-herdr.mjs"]) writeFileSync(join(bin, f), "x\n");
  symlinkSync(join(bin, "automagik-herdr.mjs"), link);
  const io = { modsDir: mods, binDir, env: {}, keys, fetch: fakeFetch(served("0.4.0")) };
  assert.equal(await cmdUpdate({ check: true }, [], io), "Automagik Herdr 0.4.0 is installed; the latest release is 0.4.0. Up to date.");
  assert.equal(readlinkSync(link), join(bin, "automagik-herdr.mjs"), "--check changes nothing");
  assert.match(await cmdUpdate({}, [], io), /Up to date\. .*automagik-herdr now points at .*bin\/automagik-herdr\.$/);
  assert.equal(readlinkSync(link), join(bin, "automagik-herdr"));
  assert.equal(await cmdUpdate({}, [], io), "Automagik Herdr 0.4.0 is installed; the latest release is 0.4.0. Up to date.", "idempotent");
});

test("any CLI start moves our link from the .mjs to the installed pack's wrapper (scratch HOME and app home)", (t) => {
  const { home, mods } = appHome("0.4.0");
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(mods, "am-sidebar", "bin");
  mkdirSync(bin);
  for (const f of ["automagik-herdr", "automagik-herdr.mjs"]) writeFileSync(join(bin, f), "x\n");
  const binDir = join(home, "home", ".local", "bin");
  mkdirSync(binDir, { recursive: true });
  const link = join(binDir, "automagik-herdr");
  symlinkSync(join(bin, "automagik-herdr.mjs"), link);
  const cli = fileURLToPath(new URL("../mods/am-sidebar/bin/automagik-herdr.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8",
    env: { HOME: join(home, "home"), HERDR_APP_HOME: home, PATH: process.env.PATH, AUTOMAGIK_HERDR_NO_UPDATE: "1" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readlinkSync(link), join(bin, "automagik-herdr"));
});

// ---- The automagik layout on update and rollback (PR #79: am-status in the status bar) ----

const LAYOUT_V1 = '{ "id": "root", "children": [{ "id": "status", "content": { "mod": "workspace-status" } }] }\n';
const LAYOUT_V2 = '{ "id": "root", "children": [{ "id": "status", "content": { "mod": "am-status" } }] }\n';
/** A release tarball at `version` carrying layouts/automagik.json = `layout`, as release.yml packs it. */
function tarballWithLayout(version, layout, mods = MODS) {
  const src = mkdtempSync(join(tmpdir(), "pack-src-"));
  const tree = join(src, "tree");
  packDir(tree, version, { mods });
  mkdirSync(join(tree, "layouts"));
  writeFileSync(join(tree, "layouts", "automagik.json"), layout);
  const out = join(src, `automagik-herdr-pack-${version}.tgz`);
  execFileSync("tar", ["czf", out, "-C", tree, ...mods, "layouts"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return { path: out, buf: readFileSync(out), src };
}
/** An app home at 0.1.0 whose pack placed LAYOUT_V1 (live and reference), and a 0.2.0 release with LAYOUT_V2. */
function layoutHome() {
  const { home, mods } = appHome("0.1.0");
  mkdirSync(join(home, "layouts"));
  writeFileSync(join(home, "layouts", "automagik.json"), LAYOUT_V1);
  writeFileSync(join(home, "automagik-herdr", "automagik.json"), LAYOUT_V1);
  const t = tarballWithLayout("0.2.0", LAYOUT_V2);
  // The signed herdr-lane pointer to 0.2.0 and its tarball.
  const url = "https://dl.test/v0.2.0/automagik-herdr-pack-0.2.0.tgz";
  const table = { ...served("0.2.0", { url, body: t.buf }), [url]: t.buf };
  const live = () => readFileSync(join(home, "layouts", "automagik.json"), "utf8");
  const ref = () => readFileSync(join(home, "automagik-herdr", "automagik.json"), "utf8");
  const done = () => { rmSync(t.src, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); };
  return { home, mods, table, live, ref, done };
}

test("installUpdate places the release's layout over the last pack's own (what `automagik-herdr update` runs)", async () => {
  const h = layoutHome();
  try {
    const r = await installUpdate({ keys, fetch: fakeFetch(h.table), env: {}, modsDir: h.mods });
    assert.equal(r.installed.version, "0.2.0");
    assert.equal(r.installed.layout, "replaced");
    assert.equal(h.live(), LAYOUT_V2, "the status bar block names am-status now");
    assert.equal(h.ref(), LAYOUT_V2);
    assert.equal(readFileSync(join(prevSetOf(h.mods), ".layout.json"), "utf8"), LAYOUT_V1, "the kept set carries the layout its pack placed");
  } finally { h.done(); }
});

test("installUpdate keeps a layout the person edited (D8), and adds one that is missing", async () => {
  const h = layoutHome();
  try {
    const mine = LAYOUT_V1.replace('"root"', '"mine"');
    writeFileSync(join(h.home, "layouts", "automagik.json"), mine);
    const r = await installUpdate({ keys, fetch: fakeFetch(h.table), env: {}, modsDir: h.mods });
    assert.equal(r.installed.layout, "kept");
    assert.equal(h.live(), mine);
    assert.equal(h.ref(), LAYOUT_V2, "the pack's copy is still the reference");
  } finally { h.done(); }
  const g = layoutHome();
  try {
    rmSync(join(g.home, "layouts", "automagik.json"));
    const r = await installUpdate({ keys, fetch: fakeFetch(g.table), env: {}, modsDir: g.mods });
    assert.equal(r.installed.layout, "added");
    assert.equal(g.live(), LAYOUT_V2);
  } finally { g.done(); }
});

test("#387: an update swaps a kept layout's workspace-status for am-status and says so; a rollback to a pack without am-status puts it back", async () => {
  const h = layoutHome();
  const withStatus = tarballWithLayout("0.2.0", LAYOUT_V2, [...MODS, "am-status"]);
  const url = "https://dl.test/v0.2.0/automagik-herdr-pack-0.2.0.tgz";
  const table = { ...served("0.2.0", { url, body: withStatus.buf }), [url]: withStatus.buf };
  try {
    // Both shown with the sidebar and the status block still Herdr's; automagik.json edited (kept, D8).
    const mine = '{\n    "id": "mine",\n    "children": [\n        { "id": "spaces", "content": { "mod": "am-sidebar" } },\n        { "id": "status", "content": { "mod": "workspace-status" } }\n    ]\n}\n';
    const agents = JSON.stringify({ id: "root", children: [{ id: "spaces", content: { mod: "am-sidebar" } }, { id: "status", content: { mod: "workspace-status" } }] });
    writeFileSync(join(h.home, "layouts", "automagik.json"), mine);
    writeFileSync(join(h.home, "layouts", "main-agents.json"), agents);
    const lines = [];
    const r = await installUpdate({ keys, fetch: fakeFetch(table), env: {}, modsDir: h.mods, log: (l) => lines.push(l) });
    assert.equal(r.installed.version, "0.2.0");
    assert.equal(r.installed.layout, "kept");
    assert.equal(h.live(), mine.replace('"workspace-status"', '"am-status"'), "that block only, the rest byte for byte");
    const agentsNow = readFileSync(join(h.home, "layouts", "main-agents.json"), "utf8");
    assert.equal(agentsNow, agents.replace('"workspace-status"', '"am-status"'));
    for (const name of ["automagik", "main-agents"]) {
      assert.ok(lines.some((l) => l.startsWith(`swapped Herdr's workspace-status for am-status in ${join(h.home, "layouts", `${name}.json`)}`)), lines.join("\n"));
    }
    // 0.1.0's pack has no am-status: a layout naming it would show plain Herdr, so the swap is undone.
    const back = rollback({ modsDir: h.mods });
    assert.equal(back.version, "0.1.0");
    for (const [name, before] of [["automagik", mine], ["main-agents", agents]]) {
      assert.deepEqual(JSON.parse(readFileSync(join(h.home, "layouts", `${name}.json`), "utf8")), JSON.parse(before));
    }
  } finally { h.done(); rmSync(withStatus.src, { recursive: true, force: true }); }
});

test("rollback puts the rolled-to pack's layout back (no layout naming a missing am-status), and a second rollback undoes it", async () => {
  const h = layoutHome();
  try {
    await installUpdate({ keys, fetch: fakeFetch(h.table), env: {}, modsDir: h.mods });
    const back = rollback({ modsDir: h.mods });
    assert.equal(back.version, "0.1.0");
    assert.equal(back.layout, "restored");
    assert.equal(h.live(), LAYOUT_V1);
    assert.equal(h.ref(), LAYOUT_V1, "the reference is the rolled-to pack's");
    assert.equal(readFileSync(join(prevSetOf(h.mods), ".layout.json"), "utf8"), LAYOUT_V2, "the rolled-out pack's layout is kept with it");
    const forward = rollback({ modsDir: h.mods });
    assert.equal(forward.version, "0.2.0");
    assert.equal(forward.layout, "restored");
    assert.equal(h.live(), LAYOUT_V2);
    assert.equal(h.ref(), LAYOUT_V2);
  } finally { h.done(); }
});

test("rollback keeps a layout the person edited after the update; a set kept before v0.9 (no layout) changes nothing", async () => {
  const h = layoutHome();
  try {
    await installUpdate({ keys, fetch: fakeFetch(h.table), env: {}, modsDir: h.mods });
    const mine = LAYOUT_V2.replace('"root"', '"mine"');
    writeFileSync(join(h.home, "layouts", "automagik.json"), mine);
    const back = rollback({ modsDir: h.mods });
    assert.equal(back.layout, "kept");
    assert.equal(h.live(), mine);
    assert.equal(h.ref(), LAYOUT_V1);
  } finally { h.done(); }
  const g = layoutHome();
  try {
    await installUpdate({ keys, fetch: fakeFetch(g.table), env: {}, modsDir: g.mods });
    rmSync(join(prevSetOf(g.mods), ".layout.json"));
    const back = rollback({ modsDir: g.mods });
    assert.equal(back.layout, null);
    assert.equal(g.live(), LAYOUT_V2);
  } finally { g.done(); }
});

test("installUpdate with `expect`: a newer latest than the confirmed version downloads nothing and is refused", async () => {
  const h = layoutHome();
  try {
    const calls = [];
    const r = await installUpdate({ keys, fetch: fakeFetch(h.table, calls), env: {}, modsDir: h.mods, expect: "0.1.5" });
    assert.equal(r.installed, null);
    assert.deepEqual(r.refused, { expected: "0.1.5", latest: "0.2.0" });
    assert.deepEqual(calls.map((c) => c.url), [POINTER_URL, POINTER_SIG_URL], "only the signed pointer: no tarball");
    assert.equal(readVersion(join(h.mods, "am-sidebar")), "0.1.0");
    const ok = await installUpdate({ keys, fetch: fakeFetch(h.table), env: {}, modsDir: h.mods, expect: "0.2.0" });
    assert.equal(ok.installed.version, "0.2.0");
  } finally { h.done(); }
});

test("node update.mjs apply --expect <v>: the flag takes a value; other commands refuse it", async () => {
  const { parseArgs } = await import("../mods/am-sidebar/update.mjs");
  assert.deepEqual(parseArgs(["apply", "--expect", "0.8.1", "--mods", "/m"]), { command: "apply", opts: { expect: "0.8.1", mods: "/m" } });
  assert.throws(() => parseArgs(["apply", "--expect"]), /usage/);
  assert.throws(() => parseArgs(["check", "--expect", "0.8.1"]), /usage/);
});

test("a pack mod switched off (mods-disabled/) is updated where it is and stays off; rollback and retiring keep it off", async () => {
  const { home, mods } = appHome("0.1.0");
  const off = offDirOf(mods);
  assert.equal(off, join(home, "mods-disabled"));
  mkdirSync(off);
  renameSync(join(mods, "am-tabs"), join(off, "am-tabs"));
  mkdirSync(join(off, "am-tabs", ".state"));
  writeFileSync(join(off, "am-tabs", ".state", "mine"), "kept\n");
  const t = tarball("0.2.0");
  const t3 = tarball("0.3.0", { mods: ["am-sidebar"] });
  try {
    const lines = [];
    const done = await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods, log: (l) => lines.push(l) });
    assert.deepEqual(done.off, ["am-tabs"]);
    assert.equal(existsSync(join(mods, "am-tabs")), false, "never switched back on by an update");
    assert.equal(readFileSync(join(off, "am-tabs", "main.js"), "utf8"), 'export const v = "0.2.0";\n', "updated in mods-disabled/");
    assert.equal(readFileSync(join(off, "am-tabs", ".state", "mine"), "utf8"), "kept\n", "its private paths carried");
    assert.equal(readFileSync(join(kept(mods, "am-tabs"), "main.js"), "utf8"), 'export const v = "0.1.0";\n', "the old copy is in the kept set");
    assert.deepEqual(readMarker(mods).mods, MODS, "the record still lists it");
    assert.ok(lines.includes("updated mods-disabled/am-tabs: it stays off"));

    rollback({ modsDir: mods });
    assert.equal(existsSync(join(mods, "am-tabs")), false, "a rollback keeps it off");
    assert.equal(readFileSync(join(off, "am-tabs", "main.js"), "utf8"), 'export const v = "0.1.0";\n');
    assert.equal(readFileSync(join(off, "am-tabs", ".state", "mine"), "utf8"), "kept\n");

    // A release that no longer ships it: the off copy leaves with the set, like a live one.
    const r = await applyUpdate({ tgzPath: t3.path, version: "0.3.0", modsDir: mods });
    assert.deepEqual(r.retired, ["am-tabs"]);
    assert.equal(existsSync(join(off, "am-tabs")), false);
    assert.equal(existsSync(kept(mods, "am-tabs")), true);
  } finally {
    for (const d of [t.src, t3.src, home]) rmSync(d, { recursive: true, force: true });
  }
});

for (const mod of OFF_BY_DEFAULT) test(`${mod} ships off: a fresh install puts it in mods-disabled/; an installed copy keeps its state`, async () => {
  const WITH = ["am-sidebar", "am-tabs", mod];
  const t = tarball("0.2.0", { mods: WITH });
  const homes = [];
  try {
    // A fresh install: no record, nothing in mods/.
    const fresh = appHome(null);
    homes.push(fresh.home);
    const lines = [];
    const r = await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: fresh.mods, log: (l) => lines.push(l) });
    const off = offDirOf(fresh.mods);
    assert.equal(existsSync(join(fresh.mods, mod)), false, "not on");
    assert.equal(readFileSync(join(off, mod, "main.js"), "utf8"), 'export const v = "0.2.0";\n');
    assert.ok(existsSync(join(fresh.mods, "am-tabs", "main.js")), "the other mods are on");
    assert.deepEqual(r.installedOff, [mod]);
    assert.deepEqual(readMarker(fresh.mods).mods.sort(), [...WITH].sort(), "the record owns it, so updates keep it off");
    assert.ok(lines.includes(`installed mods-disabled/${mod}: it ships off; turn it on in the Mods panel`));
    // ...and the next update keeps it off.
    const t3 = tarball("0.3.0", { mods: WITH });
    try {
      const again = await applyUpdate({ tgzPath: t3.path, version: "0.3.0", modsDir: fresh.mods });
      assert.deepEqual(again.off, [mod]);
      assert.equal(existsSync(join(fresh.mods, mod)), false);
    } finally { rmSync(t3.src, { recursive: true, force: true }); }

    // An update from a release that did not ship it: arriving for the first time, it comes off.
    const older = appHome("0.1.0");
    homes.push(older.home);
    await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: older.mods });
    assert.equal(existsSync(join(older.mods, mod)), false);
    assert.ok(existsSync(join(offDirOf(older.mods), mod, "main.js")));
    // Rolled back to the release without it, then forward: it is still off, never turned on.
    assert.equal(rollback({ modsDir: older.mods }).version, "0.1.0");
    assert.equal(existsSync(join(older.mods, mod)), false);
    assert.equal(rollback({ modsDir: older.mods }).version, "0.2.0");
    assert.equal(existsSync(join(older.mods, mod)), false, "still off after rolling forward");
    assert.ok(existsSync(join(offDirOf(older.mods), mod, "main.js")));

    // Installed and on (the record lists it, in mods/): updated in place, still on.
    const on = appHome("0.1.0", WITH);
    homes.push(on.home);
    const u = await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: on.mods });
    assert.equal(readFileSync(join(on.mods, mod, "main.js"), "utf8"), 'export const v = "0.2.0";\n');
    assert.equal(existsSync(join(offDirOf(on.mods), mod)), false);
    assert.deepEqual(u.installedOff, []);
    // Rollback and forward again: it stays on both ways, never moved to mods-disabled/.
    assert.equal(rollback({ modsDir: on.mods }).version, "0.1.0");
    assert.equal(readFileSync(join(on.mods, mod, "main.js"), "utf8"), 'export const v = "0.1.0";\n');
    assert.equal(rollback({ modsDir: on.mods }).version, "0.2.0");
    assert.equal(readFileSync(join(on.mods, mod, "main.js"), "utf8"), 'export const v = "0.2.0";\n');
    assert.equal(existsSync(join(offDirOf(on.mods), mod)), false);

    // A repair of a missing one the record lists reinstalls it on, as it was.
    rmSync(join(on.mods, mod), { recursive: true, force: true });
    await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: on.mods, repair: [mod] });
    assert.ok(existsSync(join(on.mods, mod, "main.js")));

    // A folder already in mods-disabled/ that the record does not own is left alone.
    const theirs = appHome(null);
    homes.push(theirs.home);
    mkdirSync(join(offDirOf(theirs.mods), mod), { recursive: true });
    writeFileSync(join(offDirOf(theirs.mods), mod, "main.js"), "// mine\n");
    const said = [];
    const l = await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: theirs.mods, log: (x) => said.push(x) });
    assert.equal(readFileSync(join(offDirOf(theirs.mods), mod, "main.js"), "utf8"), "// mine\n");
    assert.equal(l.mods.includes(mod), false);
    assert.ok(said.some((x) => x.includes(`left alone: mods-disabled/${mod}`)));
  } finally {
    for (const d of [t.src, ...homes]) rmSync(d, { recursive: true, force: true });
  }
});

test("herdr-app check skips only a switched-off mod: one missing from mods/ and mods-disabled/ still fails", () => {
  const { home, mods } = appHome("0.1.0", ["am-sidebar", "am-tabs", "am-quota", "am-footer"]);
  try {
    const off = offDirOf(mods);
    mkdirSync(off);
    renameSync(join(mods, "am-quota"), join(off, "am-quota"));       // switched off (or shipped off)
    rmSync(join(mods, "am-footer"), { recursive: true });             // should be on, and is gone
    assert.deepEqual(toCheck(mods, ["am-sidebar", "am-tabs", "am-quota", "am-footer"]), ["am-sidebar", "am-tabs", "am-footer"]);
    // A stand-in herdr-app that fails a folder that isn't there, as the real check does.
    const bin = join(home, "herdr-app");
    writeFileSync(bin, '#!/bin/sh\n[ "$1" = check ] && [ -d "$2" ] && exit 0\necho "no mod at $2" >&2\nexit 1\n');
    chmodSync(bin, 0o755);
    const lines = [];
    const r = checkMods({ modsDir: mods, mods: toCheck(mods, readMarker(mods).mods), log: (l) => lines.push(l), herdrApp: bin });
    assert.deepEqual(r.failed, ["am-footer"], "the missing mod fails the setup; the switched-off one is not checked");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/** A stand-in herdr-app: logs each `check <dir>` and fails a folder that isn't there, as the real one does. */
function fakeHerdrApp(dir) {
  const bin = join(dir, "herdr-app"), calls = join(dir, "herdr-app.log");
  writeFileSync(bin, `#!/bin/sh\necho "$2" >> "${calls}"\n[ "$1" = check ] && [ -d "$2" ] && exit 0\nexit 1\n`);
  chmodSync(bin, 0o755);
  return { bin, checked: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((p) => p.split("/").pop()) : []) };
}

test("setupHome checks the record's mods but a switched-off one: a mod missing from both folders fails", () => {
  const { home, mods } = appHome("0.1.0", ["am-sidebar", "am-tabs", "am-quota"]);
  try {
    mkdirSync(offDirOf(mods));
    renameSync(join(mods, "am-quota"), join(offDirOf(mods), "am-quota"));
    rmSync(join(mods, "am-tabs"), { recursive: true });
    const tgzDir = join(home, "empty");
    mkdirSync(tgzDir);
    const app = fakeHerdrApp(home);
    const failed = setupHome({ modsDir: mods, tgzDir, record: { mods: ["am-sidebar", "am-tabs", "am-quota"] }, herdrApp: app.bin });
    assert.deepEqual(failed, ["am-tabs"], "the missing one fails; the switched-off one is not checked");
    assert.deepEqual(app.checked().sort(), ["am-sidebar", "am-tabs"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("repairInstall checks every mod that is on, never the one that ships off", async () => {
  const WITH = ["am-sidebar", "am-tabs", "am-quota"];
  const t = tarball("0.2.0", { mods: WITH });
  const { home, mods } = appHome(null);
  try {
    await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
    assert.ok(existsSync(join(offDirOf(mods), "am-quota")), "am-quota starts off");
    const app = fakeHerdrApp(home);
    const r = await repairInstall({ tgzPath: t.path, version: "0.2.0", modsDir: mods, herdrApp: app.bin });
    assert.deepEqual(r.checkFailed, []);
    assert.deepEqual(app.checked().sort(), ["am-sidebar", "am-tabs"]);
  } finally {
    for (const d of [t.src, home]) rmSync(d, { recursive: true, force: true });
  }
});

test("rollback keeps a switched-off mod off: one a release retired (a), and one new in the rolled-out release (b)", async () => {
  const off = (mods) => offDirOf(mods);
  const at = (mods, m) => (existsSync(join(mods, m)) ? "on" : existsSync(join(off(mods), m)) ? "off" : "gone");
  // (a) am-tabs is off; a release that drops it keeps it (off=); the rollback brings it back off.
  {
    const { home, mods } = appHome("0.1.0");
    mkdirSync(off(mods));
    renameSync(join(mods, "am-tabs"), join(off(mods), "am-tabs"));
    const t = tarball("0.2.0", { mods: ["am-sidebar"] });
    try {
      const r = await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
      assert.deepEqual(r.retired, ["am-tabs"]);
      assert.match(readFileSync(join(prevSetOf(mods), ".pack"), "utf8"), /^off=am-tabs$/m, "the kept set says it was off");
      assert.equal(at(mods, "am-tabs"), "gone");
      rollback({ modsDir: mods });
      assert.equal(at(mods, "am-tabs"), "off");
      assert.equal(readFileSync(join(off(mods), "am-tabs", "main.js"), "utf8"), 'export const v = "0.1.0";\n');
      rollback({ modsDir: mods });
      assert.equal(at(mods, "am-tabs"), "gone", "forward again: retired again");
      rollback({ modsDir: mods });
      assert.equal(at(mods, "am-tabs"), "off", "and back, still off");
    } finally {
      rmSync(t.src, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
  // (b) am-tabs is new in 0.2.0 and switched off there; rolled back twice it ends where it was: off.
  {
    const { home, mods } = appHome("0.1.0", ["am-sidebar"]);
    const t = tarball("0.2.0");
    try {
      await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods });
      mkdirSync(off(mods));
      renameSync(join(mods, "am-tabs"), join(off(mods), "am-tabs"));
      rollback({ modsDir: mods });
      assert.equal(at(mods, "am-tabs"), "gone", "0.1.0 has no am-tabs");
      assert.match(readFileSync(join(prevSetOf(mods), ".pack"), "utf8"), /^off=am-tabs$/m);
      rollback({ modsDir: mods });
      assert.equal(at(mods, "am-tabs"), "off", "back to 0.2.0, still off");
      assert.equal(readFileSync(join(off(mods), "am-tabs", "main.js"), "utf8"), 'export const v = "0.2.0";\n');
    } finally {
      rmSync(t.src, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("an update with a mod in both mods/ and mods-disabled/ updates mods/ and says the off copy is left", async () => {
  const { home, mods } = appHome("0.1.0");
  mkdirSync(join(offDirOf(mods), "am-tabs"), { recursive: true });
  writeFileSync(join(offDirOf(mods), "am-tabs", "main.js"), "stale\n");
  const t = tarball("0.2.0");
  try {
    const lines = [];
    await applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: mods, log: (l) => lines.push(l) });
    assert.equal(readFileSync(join(mods, "am-tabs", "main.js"), "utf8"), 'export const v = "0.2.0";\n');
    assert.equal(readFileSync(join(offDirOf(mods), "am-tabs", "main.js"), "utf8"), "stale\n");
    assert.ok(lines.some((l) => /mods\/am-tabs and mods-disabled\/am-tabs both exist/.test(l)));
  } finally {
    rmSync(t.src, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a mod retired while it was off, then shipped again, comes back off (the kept set's off=)", async () => {
  const { home, mods } = appHome("0.1.0");
  mkdirSync(offDirOf(mods));
  renameSync(join(mods, "am-tabs"), join(offDirOf(mods), "am-tabs"));
  const t2 = tarball("0.2.0", { mods: ["am-sidebar"] });
  const t3 = tarball("0.3.0");
  try {
    await applyUpdate({ tgzPath: t2.path, version: "0.2.0", modsDir: mods });
    assert.ok(!existsSync(join(offDirOf(mods), "am-tabs")));
    const r = await applyUpdate({ tgzPath: t3.path, version: "0.3.0", modsDir: mods });
    assert.ok(r.off.includes("am-tabs"));
    assert.ok(!existsSync(join(mods, "am-tabs")), "never back on by itself");
    assert.equal(readFileSync(join(offDirOf(mods), "am-tabs", "main.js"), "utf8"), 'export const v = "0.3.0";\n');
    assert.ok(readMarker(mods).mods.includes("am-tabs"));
  } finally {
    for (const d of [t2.src, t3.src, home]) rmSync(d, { recursive: true, force: true });
  }
});

// ---- Installing updates on their own: update.mjs's side (temp homes, a fake release) ----

/** A temp app home at 0.1.0 installed by install.sh from a signed release (sequence=), and a release table. */
function autoHome(served_ = ["0.2.0"]) {
  const { home, mods } = appHome("0.1.0");
  writeFileSync(markerOf(mods), "version=0.1.0\nmods=am-sidebar,am-tabs\nbefore=none\nsequence=10000\n");
  const made = [];
  const table = {};
  const serve = (version) => {
    const t = tarball(version);
    made.push(t.src);
    const url = `https://dl.test/v${version}/automagik-herdr-pack-${version}.tgz`;
    Object.assign(table, served(version, { url, body: t.buf }), { [url]: t.buf });
  };
  served_.forEach(serve);
  const done = () => { for (const d of [...made, home]) rmSync(d, { recursive: true, force: true }); };
  return { home, mods, table, serve, done };
}

test("managedPack: only a pack install.sh put in place from a signed release; never a checkout or a hand install", () => {
  const h = autoHome([]);
  try {
    assert.deepEqual(managedPack(h.mods), { managed: true, why: null });
    writeFileSync(markerOf(h.mods), "version=0.1.0\nmods=am-sidebar,am-tabs\nbefore=none\n");
    assert.match(managedPack(h.mods).why, /before signed releases: run `automagik-herdr update` once/);
    rmSync(markerOf(h.mods));
    assert.match(managedPack(h.mods).why, /not installed by install.sh/);
    // A dev checkout: mods/am-sidebar is a link.
    const checkout = mkdtempSync(join(tmpdir(), "checkout-"));
    renameSync(join(h.mods, "am-sidebar"), join(checkout, "am-sidebar"));
    symlinkSync(join(checkout, "am-sidebar"), join(h.mods, "am-sidebar"));
    writeFileSync(markerOf(h.mods), "version=0.1.0\nmods=am-sidebar,am-tabs\nbefore=none\nsequence=10000\n");
    assert.match(managedPack(h.mods).why, /is a link to a checkout/);
    rmSync(checkout, { recursive: true, force: true });
  } finally { h.done(); }
});

test("the setting: on by default, written whole beside the record, read by check; garbage reads as on", async () => {
  const h = autoHome();
  try {
    assert.deepEqual(readAuto(h.mods), { on: true, skip: null });
    assert.equal(autoFileOf(h.mods), join(h.home, "automagik-herdr", "auto-update.json"));
    writeAuto(h.mods, { on: false });
    assert.deepEqual(JSON.parse(readFileSync(autoFileOf(h.mods), "utf8")), { auto: false });
    const found = await checkForUpdate({ fetch: fakeFetch(h.table), env: {}, modsDir: h.mods, keys });
    assert.deepEqual(found.auto, { on: false, skip: null, managed: true, why: null });
    writeFileSync(autoFileOf(h.mods), "{ not json");
    assert.deepEqual(readAuto(h.mods), { on: true, skip: null });
    assert.deepEqual(readdirSync(join(h.home, "automagik-herdr")).filter((f) => f.startsWith(".auto-update")), [], "no temp file left");
  } finally { h.done(); }
});

test("a rollback sticks: the version rolled away from is never installed on its own; a newer one is", async () => {
  const h = autoHome();
  try {
    const first = await installUpdate({ keys, fetch: fakeFetch(h.table), env: {}, modsDir: h.mods, expect: "0.2.0", auto: true });
    assert.equal(first.installed.version, "0.2.0");
    rollback({ modsDir: h.mods });
    assert.equal(readVersion(join(h.mods, "am-sidebar")), "0.1.0");
    assert.equal(readAuto(h.mods).skip, "0.2.0", "the rollback recorded the version it rolled away from");
    assert.equal(autoStatus(h.mods).managed, true, "the rolled-to pack is still install.sh's");
    const calls = [];
    const held = await installUpdate({ keys, fetch: fakeFetch(h.table, calls), env: {}, modsDir: h.mods, expect: "0.2.0", auto: true });
    assert.equal(held.installed, null);
    assert.match(held.held, /0\.2\.0 was rolled back here/);
    assert.deepEqual(calls.map((c) => c.url), [POINTER_URL, POINTER_SIG_URL], "nothing downloaded");
    assert.equal(readVersion(join(h.mods, "am-sidebar")), "0.1.0");
    // The person can still install it by hand.
    const asked = await installUpdate({ keys, fetch: fakeFetch(h.table), env: {}, modsDir: h.mods, expect: "0.2.0" });
    assert.equal(asked.installed.version, "0.2.0");
    rollback({ modsDir: h.mods });
    h.serve("0.3.0");
    const newer = await installUpdate({ keys, fetch: fakeFetch(h.table), env: {}, modsDir: h.mods, expect: "0.3.0", auto: true });
    assert.equal(newer.installed.version, "0.3.0");
  } finally { h.done(); }
});

test("apply --auto holds, downloading nothing: the switch off, a checkout, another update or rollback running", async () => {
  const h = autoHome();
  try {
    const calls = [];
    writeAuto(h.mods, { on: false });
    const off = await installUpdate({ keys, fetch: fakeFetch(h.table, calls), env: {}, modsDir: h.mods, expect: "0.2.0", auto: true });
    assert.equal(off.installed, null);
    assert.match(off.held, /is off/);
    writeAuto(h.mods, { on: true });
    const free = takeLock(h.mods);
    const busy = await installUpdate({ keys, fetch: fakeFetch(h.table, calls), env: {}, modsDir: h.mods, expect: "0.2.0", auto: true });
    assert.match(busy.held, /another update or rollback is running/);
    await assert.rejects(installUpdate({ keys, fetch: fakeFetch(h.table), env: {}, modsDir: h.mods }), /another update or rollback is running/,
      "asked for by hand: an error, not a silent hold");
    assert.throws(() => rollback({ modsDir: h.mods }), /another update or rollback is running/);
    free();
    assert.equal(existsSync(lockOf(h.mods)), false);
    assert.ok(calls.every((c) => c.url === POINTER_URL || c.url === POINTER_SIG_URL), "no tarball fetched");
    assert.equal(readVersion(join(h.mods, "am-sidebar")), "0.1.0");
    // A lock left by a run that died (older than LOCK_STALE_MS) is taken over.
    mkdirSync(lockOf(h.mods));
    const later = takeLock(h.mods, Date.now() + 11 * 60_000);
    later();
    // The released lock lets it through.
    const ok = await installUpdate({ keys, fetch: fakeFetch(h.table), env: {}, modsDir: h.mods, expect: "0.2.0", auto: true });
    assert.equal(ok.installed.version, "0.2.0");
    assert.equal(existsSync(lockOf(h.mods)), false, "freed after the install");
  } finally { h.done(); }
});

test("a failed swap leaves the installed pack whole (no half-installed pack) and the lock free", async () => {
  const h = autoHome();
  try {
    let n = 0;
    const rename = (from, to) => { if (++n === 3) throw new Error("disk full"); renameSync(from, to); };
    const t = tarball("0.2.0");
    try {
      await assert.rejects(applyUpdate({ tgzPath: t.path, version: "0.2.0", modsDir: h.mods, rename }), /disk full/);
    } finally { rmSync(t.src, { recursive: true, force: true }); }
    assert.equal(readVersion(join(h.mods, "am-sidebar")), "0.1.0");
    assert.equal(readFileSync(join(h.mods, "am-tabs", "main.js"), "utf8"), 'export const v = "0.1.0";\n');
    assert.equal(readMarker(h.mods).version, "0.1.0");
    assert.deepEqual(readdirSync(stateDirOf(h.mods)).filter((f) => f.startsWith("staging-") || f.startsWith(".prev-next-")), []);
  } finally { h.done(); }
});

test("automagik-herdr update --auto on|off|status, and apply --auto in update.mjs's arguments", async () => {
  const h = autoHome([]);
  try {
    assert.match(await cmdUpdate({ auto: "status" }, [], { modsDir: h.mods, env: {} }), /^Install updates automatically: on\.$/);
    assert.match(await cmdUpdate({ auto: "off" }, [], { modsDir: h.mods, env: {} }), /^Install updates automatically: off\.$/);
    assert.equal(readAuto(h.mods).on, false);
    writeAuto(h.mods, { skip: "0.2.0" });
    assert.equal(await cmdUpdate({ auto: "on" }, [], { modsDir: h.mods, env: {} }),
      "Install updates automatically: on.\n0.2.0 was rolled back here: it waits for a release newer than 0.2.0.");
    assert.deepEqual(await cmdUpdate({ auto: "status", json: true }, [], { modsDir: h.mods, env: {} }),
      { on: true, skip: "0.2.0", managed: true, why: null, checks: true });
    rmSync(markerOf(h.mods));
    assert.match(await cmdUpdate({ auto: "status" }, [], { modsDir: h.mods, env: {} }), /It doesn't apply to this pack \(this pack was not installed by install.sh/);
    await assert.rejects(cmdUpdate({ auto: "maybe" }, [], { modsDir: h.mods }), /--auto takes on, off or status/);
    await assert.rejects(cmdUpdate({ auto: "on", check: true }, [], { modsDir: h.mods }), /--auto alone/);
    const { parseArgs } = await import("../mods/am-sidebar/update.mjs");
    assert.deepEqual(parseArgs(["apply", "--expect", "0.2.0", "--auto"]), { command: "apply", opts: { expect: "0.2.0", auto: true } });
    assert.throws(() => parseArgs(["check", "--auto"]), /usage/);
  } finally { h.done(); }
});

// ---- Review of #271: races between runs (the reviewer's zz-race scenarios, with assertions) ----

/** fetch that runs `between()` once, right after the signed pointer is read: another run lands then. */
const racing = (fetch, between) => {
  let raced = false;
  return async (url, init) => {
    const r = await fetch(url, init);
    if (!raced && String(url).endsWith(".sig")) { raced = true; await between(); }
    return r;
  };
};

test("race: a CLI update lands between the auto check and its lock: no reinstall over itself, the rollback target kept", async () => {
  const h = autoHome(["0.2.0"]);
  try {
    const base = fakeFetch(h.table);
    const fetch = racing(base, () => installUpdate({ fetch: base, env: {}, modsDir: h.mods, keys }));
    const r = await installUpdate({ fetch, env: {}, modsDir: h.mods, keys, expect: "0.2.0", auto: true });
    assert.equal(r.installed, null);
    assert.equal(r.update, null);
    assert.equal(r.current, "0.2.0");
    assert.equal(parseMarker(readFileSync(join(prevSetOf(h.mods), ".pack"), "utf8")).version, "0.1.0", "rollback still goes to 0.1.0");
    // The same for an update asked for by hand.
    rollback({ modsDir: h.mods });
    writeAuto(h.mods, { skip: null });
    const manual = racing(base, () => installUpdate({ fetch: base, env: {}, modsDir: h.mods, keys }));
    const m = await installUpdate({ fetch: manual, env: {}, modsDir: h.mods, keys });
    assert.equal(m.installed, null);
    assert.equal(parseMarker(readFileSync(join(prevSetOf(h.mods), ".pack"), "utf8")).version, "0.1.0");
  } finally { h.done(); }
});

test("race: a newer release installed between the auto check and its lock is never downgraded", async () => {
  const h = autoHome(["0.2.0"]);
  const t3 = autoHome(["0.3.0"]);
  try {
    const newer = fakeFetch({ ...h.table, ...t3.table });
    const fetch = racing(fakeFetch(h.table), () => installUpdate({ fetch: newer, env: {}, modsDir: h.mods, keys }));
    const r = await installUpdate({ fetch, env: {}, modsDir: h.mods, keys, expect: "0.2.0", auto: true });
    assert.equal(r.installed, null);
    assert.equal(readMarker(h.mods).version, "0.3.0");
    assert.equal(readVersion(join(h.mods, "am-sidebar")), "0.3.0");
  } finally { h.done(); t3.done(); }
});

test("an auto install whose record can't be written is a failure (no reinstall loop); asked for by hand it warns", async () => {
  const h = autoHome(["0.2.0"]);
  try {
    mkdirSync(`${markerOf(h.mods)}.tmp`); // writeMarker's temp path is taken: the record can't be written
    await assert.rejects(installUpdate({ fetch: fakeFetch(h.table), env: {}, modsDir: h.mods, keys, expect: "0.2.0", auto: true }),
      /0\.2\.0 went in, but the install record could not be written/);
    assert.equal(existsSync(lockOf(h.mods)), false, "the lock is freed");
    rollback({ modsDir: h.mods });
    writeAuto(h.mods, { skip: null });
    const manual = await installUpdate({ fetch: fakeFetch(h.table), env: {}, modsDir: h.mods, keys });
    assert.equal(manual.installed.recorded, false);
    assert.ok(manual.installed.warnings.some((w) => /ownership record could not be written/.test(w)));
  } finally { h.done(); }
});

test("lock: a run whose stale lock was taken over never frees the new holder's; a second taker is refused", () => {
  const h = autoHome([]);
  try {
    const old = takeLock(h.mods, Date.now());
    const later = Date.now() + 11 * 60_000;
    const a = takeLock(h.mods, later); // the old one looks dead: taken over
    assert.throws(() => takeLock(h.mods, Date.now()), /another update or rollback is running/, "A's lock is fresh");
    old(); // the slow old holder finishes
    assert.equal(existsSync(lockOf(h.mods)), true, "A still holds it");
    assert.throws(() => takeLock(h.mods, Date.now()), /another update or rollback is running/);
    a();
    assert.equal(existsSync(lockOf(h.mods)), false);
    assert.deepEqual(readdirSync(stateDirOf(h.mods)).filter((f) => f.startsWith(".update.lock")), [], "nothing left aside");
  } finally { h.done(); }
});

test("lock: the setting is written under it, so a switch never wipes a rollback's skip; rollback records it while holding", async () => {
  const h = autoHome(["0.2.0"]);
  try {
    await installUpdate({ fetch: fakeFetch(h.table), env: {}, modsDir: h.mods, keys });
    const free = takeLock(h.mods);
    assert.throws(() => writeAuto(h.mods, { on: false }), /another update or rollback is running/);
    await assert.rejects(cmdUpdate({ auto: "off" }, [], { modsDir: h.mods, env: {} }), /The setting was not saved: another update/);
    assert.equal(readAuto(h.mods).on, true);
    free();
    rollback({ modsDir: h.mods });
    assert.equal(readAuto(h.mods).skip, "0.2.0");
    writeAuto(h.mods, { on: false });
    assert.deepEqual(readAuto(h.mods), { on: false, skip: "0.2.0" });
  } finally { h.done(); }
});

// ---- The pointer's sequence (#207 L2) and #276's off-by-default, through an install on its own ----

test("a pointer whose sequence is below the record's is never offered or installed, whatever version it names", async () => {
  const h = autoHome([]);
  const t = tarball("0.2.0");
  try {
    const url = "https://dl.test/v0.2.0/automagik-herdr-pack-0.2.0.tgz";
    const table = { ...served("0.2.0", { url, body: t.buf, sequence: 5000 }), [url]: t.buf }; // the record says 10000
    const found = await checkForUpdate({ fetch: fakeFetch(table), env: {}, modsDir: h.mods, keys });
    assert.equal(found.update, null);
    assert.deepEqual(found.olderSequence, { sequence: 5000, recorded: 10000 });
    const calls = [];
    for (const auto of [true, false]) {
      const r = await installUpdate({ fetch: fakeFetch(table, calls), env: {}, modsDir: h.mods, keys, auto });
      assert.equal(r.installed, null);
    }
    assert.ok(calls.every((c) => c.url !== url), "no tarball downloaded");
    assert.equal(readVersion(join(h.mods, "am-sidebar")), "0.1.0");
    assert.equal(olderSequence({ sequence: 10000 }, { sequence: 10000 }), false, "the same sequence is not older");
    assert.equal(olderSequence({ sequence: null }, { sequence: 1 }), false, "a record without one compares nothing");
  } finally { rmSync(t.src, { recursive: true, force: true }); h.done(); }
});

test("under the lock: a record that moved to a higher sequence since the check stops the install", async () => {
  const h = autoHome(["0.2.0"]); // pointer 0.2.0 at sequence 20000; record 0.1.0 at 10000
  try {
    // Between the check and the lock, the record now came through sequence 30000 (same version).
    const fetch = racing(fakeFetch(h.table), async () => {
      writeFileSync(markerOf(h.mods), "version=0.1.0\nmods=am-sidebar,am-tabs\nbefore=none\nsequence=30000\n");
    });
    const r = await installUpdate({ fetch, env: {}, modsDir: h.mods, keys, expect: "0.2.0", auto: true });
    assert.equal(r.installed, null);
    assert.equal(readVersion(join(h.mods, "am-sidebar")), "0.1.0");
    assert.equal(readMarker(h.mods).sequence, 30000);
  } finally { h.done(); }
});

test("an install on its own keeps #276's off-by-default: am-quota arriving first lands in mods-disabled/, an on copy stays on", async () => {
  const h = autoHome([]);
  const withQuota = [...MODS, "am-quota"];
  const t2 = tarball("0.2.0", { mods: withQuota });
  const t3 = tarball("0.3.0", { mods: withQuota });
  const table = {};
  for (const [v, t] of [["0.2.0", t2], ["0.3.0", t3]]) {
    const url = `https://dl.test/v${v}/automagik-herdr-pack-${v}.tgz`;
    Object.assign(table, { [url]: t.buf });
  }
  const at = (v, t) => ({ ...table, ...served(v, { url: `https://dl.test/v${v}/automagik-herdr-pack-${v}.tgz`, body: t.buf }) });
  try {
    const r = await installUpdate({ fetch: fakeFetch(at("0.2.0", t2)), env: {}, modsDir: h.mods, keys, expect: "0.2.0", auto: true });
    assert.equal(r.installed.version, "0.2.0");
    assert.equal(existsSync(join(h.mods, "am-quota")), false, "Herdr doesn't load it");
    assert.equal(existsSync(join(offDirOf(h.mods), "am-quota", "main.js")), true);
    // The person turns it on; the next install on its own keeps it on.
    renameSync(join(offDirOf(h.mods), "am-quota"), join(h.mods, "am-quota"));
    const r3 = await installUpdate({ fetch: fakeFetch(at("0.3.0", t3)), env: {}, modsDir: h.mods, keys, expect: "0.3.0", auto: true });
    assert.equal(r3.installed.version, "0.3.0");
    assert.equal(readFileSync(join(h.mods, "am-quota", "main.js"), "utf8"), 'export const v = "0.3.0";\n');
    assert.equal(existsSync(join(offDirOf(h.mods), "am-quota")), false);
  } finally { for (const t of [t2, t3]) rmSync(t.src, { recursive: true, force: true }); h.done(); }
});

// ---- Re-review of #271: the lock's takeover and the re-check under it, each pinned ----

test("lock: two runs that both find it stale: the second to move it aside gets the first's fresh lock back and is refused", () => {
  const h = autoHome([]);
  try {
    takeLock(h.mods, Date.now()); // a holder that died: its lock goes stale
    const later = Date.now() + 11 * 60_000;
    let b = null;
    // A looked and found it stale; before A moves it aside, B takes it over completely.
    assert.throws(() => takeLock(h.mods, later, { beforeTakeover: () => { b = takeLock(h.mods, later); } }),
      /another update or rollback is running/);
    assert.ok(b, "B holds it");
    assert.equal(existsSync(lockOf(h.mods)), true, "A put B's lock back");
    assert.throws(() => takeLock(h.mods, Date.now()), /another update or rollback is running/, "and B's lock is fresh");
    b();
    assert.equal(existsSync(lockOf(h.mods)), false);
    assert.deepEqual(readdirSync(stateDirOf(h.mods)).filter((f) => f.startsWith(".update.lock")), []);
  } finally { h.done(); }
});

test("lock: a takeover that loses the folder to another run between the move and the mkdir is 'locked', not a raw EEXIST", () => {
  const h = autoHome([]);
  try {
    takeLock(h.mods, Date.now());
    const later = Date.now() + 11 * 60_000;
    assert.throws(() => takeLock(h.mods, later, { beforeRetake: () => mkdirSync(lockOf(h.mods)) }),
      (e) => e.locked === true && /another update or rollback is running/.test(e.message));
  } finally { h.done(); }
});

test("overtaken (under the lock): the version installed since the check, or a record that came through a higher sequence", () => {
  const h = autoHome([]);
  try {
    const update = { version: "0.2.0", sequence: 20000 };
    assert.equal(overtaken(h.mods, update), null, "0.1.0 at sequence 10000: 0.2.0 at 20000 goes in");
    writeFileSync(markerOf(h.mods), "version=0.1.0\nmods=am-sidebar,am-tabs\nbefore=none\nsequence=30000\n");
    assert.match(overtaken(h.mods, update).why, /sequence 20000 is below the record's 30000/);
    writeFileSync(markerOf(h.mods), "version=0.2.0\nmods=am-sidebar,am-tabs\nbefore=none\nsequence=20000\n");
    assert.deepEqual(overtaken(h.mods, update), { current: "0.2.0", why: "0.2.0 is installed now" });
    writeFileSync(markerOf(h.mods), "version=0.3.0\nmods=am-sidebar,am-tabs\nbefore=none\nsequence=30000\n");
    assert.equal(overtaken(h.mods, update).current, "0.3.0", "never a downgrade");
  } finally { h.done(); }
});
