// am end to end on temp homes (RFC 0012 delivery 1): the Bot verbs are automagik-herdr's byte for
// byte; am updates from a file:// am-lane signed by a key made for this run, refuses a lower
// sequence and a tarball that does not match, rolls back, keeps two copies, and takes and hands
// back the links. Never a real home, never the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASES, sequenceOf } from "../lib/lane.mjs";

const AM = fileURLToPath(new URL("..", import.meta.url));
const PACK = join(AM, "..", "herdr", "mods", "am-sidebar");
const NODE_DIR = dirname(process.execPath);
const KEY = (() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, trusted: JSON.stringify({ keys: [{ keyId: "am-test", publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() }] }) };
})();

function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "am-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const app = join(home, ".config", "herdr-app");
  const releases = join(root, "releases");
  mkdirSync(app, { recursive: true });
  const env = {
    PATH: `${NODE_DIR}:/usr/bin:/bin`, HOME: home, HERDR_APP_HOME: app, AUTOMAGIK_HERDR_NO_UPDATE: "1",
    AM_RELEASE_URL: `file://${releases}`, AM_TRUSTED_KEYS: KEY.trusted,
  };
  const run = (cmd, args, extra = {}) => spawnSync("sh", [cmd, ...args], { encoding: "utf8", env: { ...env, ...extra }, cwd: root });
  const am = (...args) => run(join(AM, "bin", "am"), args);
  const installed = (...args) => run(join(home, ".local", "bin", "am"), args);
  const store = join(home, ".automagik", "parts", "automagik.am");
  return { root, home, app, releases, env, run, am, installed, store };
}

/** An am tarball of this checkout at `version` (no test/), as the release packs it. */
function tarball(s, version, { tamper } = {}) {
  const dir = join(s.root, `src-${version}`);
  cpSync(AM, dir, { recursive: true, filter: (p) => !p.startsWith(join(AM, "test")) });
  writeFileSync(join(dir, "VERSION"), `${version}\n`);
  tamper?.(dir);
  const out = join(s.releases, "download", `v${version}`);
  mkdirSync(out, { recursive: true });
  const tgz = join(out, `automagik-am-${version}.tgz`);
  execFileSync("tar", ["-czf", tgz, "-C", dir, ...readdirSync(dir)]);
  return tgz;
}

/** Posts am-lane's pointer to `version`'s tarball, signed with this run's key (or `sig`). */
function post(s, version, { tgz = join(s.releases, "download", `v${version}`, `automagik-am-${version}.tgz`), sig } = {}) {
  const bytes = readFileSync(tgz);
  const pointer = Buffer.from(JSON.stringify({
    schemaVersion: 1, publisher: "automagik", part: "automagik.am", keyId: "am-test", sequence: sequenceOf(version),
    issuedAt: "2026-11-03T00:00:00Z", repository: "https://github.com/automagik-dev/automagik", version, tag: `v${version}`, commit: "c".repeat(40),
    tarball: { name: `automagik-am-${version}.tgz`, url: `${RELEASES}/download/v${version}/automagik-am-${version}.tgz`,
      sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength },
  }, null, 2));
  const lane = join(s.releases, "download", "am-lane");
  mkdirSync(lane, { recursive: true });
  writeFileSync(join(lane, "am.json"), pointer);
  writeFileSync(join(lane, "am.json.sig"), sig ?? sign(null, pointer, KEY.privateKey).toString("base64"));
}

const json = (r) => { assert.equal(r.stderr, "", r.stderr); return JSON.parse(r.stdout); };
const record = (s) => JSON.parse(readFileSync(join(s.store, "record.json"), "utf8"));
const versions = (s) => readdirSync(s.store).filter((n) => /^\d/.test(n)).sort();

test("every Bot verb's output is byte for byte the pack's automagik-herdr's, under am and the alias", (t) => {
  const s = scratch(t);
  assert.equal(s.am("self", "install").status, 0);
  const pack = join(PACK, "bin", "automagik-herdr");
  const alias = join(s.home, ".local", "bin", "automagik-herdr");
  for (const args of [["--version"], ["ls", "--json"], ["ls"], ["show", "nobody"], ["whois", "t1", "--json"], ["whois", "--bot", "x", "--json"],
    ["brief", "nobody"], ["category", "ls", "--json"], ["history", "nobody"], ["nonsense"]]) {
    const want = s.run(pack, args);
    for (const [name, got] of [["am", s.installed(...args)], ["automagik-herdr", s.run(alias, args)]]) {
      assert.deepEqual([got.status, got.stdout, got.stderr], [want.status, want.stdout, want.stderr], `${name} ${args.join(" ")}`);
    }
  }
  // The alias's help is the pack's too; am's adds its own verbs before it.
  assert.equal(s.run(alias, ["--help"]).stdout, s.run(pack, ["--help"]).stdout);
  const help = s.installed("help").stdout;
  assert.match(help, /^am: Automagik's one command/);
  assert.ok(help.endsWith(s.run(pack, ["--help"]).stdout));
});

test("self install: the store, the links and the briefing entry; doctor is healthy", (t) => {
  const s = scratch(t);
  const r = s.am("self", "install", "--json");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(json(r).detail.version, readFileSync(join(AM, "VERSION"), "utf8").trim());
  assert.equal(readlinkSync(join(s.home, ".local", "bin", "am")), join(s.store, "current", "bin", "am"));
  assert.equal(readFileSync(join(s.app, "automagik-herdr", "briefing.mjs"), "utf8"), readFileSync(join(PACK, "briefingEntry.mjs"), "utf8"),
    "the entry am writes is the pack's, byte for byte");
  assert.equal(record(s).current.signed, false);
  assert.equal(record(s).current.part.id, "automagik.am", "the store keeps its own copy of the manifest");
  const doctor = s.installed("self", "doctor", "--json");
  assert.equal(doctor.status, 0, doctor.stdout);
  for (const line of doctor.stdout.trim().split("\n").map((l) => JSON.parse(l))) {
    assert.deepEqual(Object.keys(line).slice(0, 4), ["part", "check", "ok", "detail"]);
    assert.equal(line.ok, true, line.detail);
  }
});

test("update from a file:// am-lane: newer moves, a lower sequence is refused, rollback goes back, two copies kept", (t) => {
  const s = scratch(t);
  // Nothing posted yet: nothing to do, and that is not a failure.
  const none = s.am("update", "automagik.am", "--json");
  assert.equal(none.status, 0, none.stderr);
  assert.equal(json(none).am.state, "none");

  tarball(s, "3.70.1");
  post(s, "3.70.1");
  assert.equal(json(s.am("update", "automagik.am", "--check", "--json")).am.state, "available");
  assert.equal(existsSync(s.store), false, "--check installs nothing");
  const first = s.am("update", "automagik.am", "--json");
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual([json(first).am.state, json(first).am.to], ["updated", "3.70.1"]);
  assert.equal(s.installed("--version").stdout.trim(), "automagik-herdr 3.70.1");
  assert.deepEqual([record(s).current.signed, record(s).current.sequence, record(s).seen], [true, sequenceOf("3.70.1"), sequenceOf("3.70.1")]);
  assert.equal(json(s.installed("update", "automagik.am", "--json")).am.state, "current");

  tarball(s, "3.70.2");
  post(s, "3.70.2");
  assert.equal(json(s.installed("update", "automagik.am", "--json")).am.to, "3.70.2");
  tarball(s, "3.71.0");
  post(s, "3.71.0");
  assert.equal(json(s.installed("update", "automagik.am", "--json")).am.to, "3.71.0");
  assert.deepEqual(versions(s), ["3.70.2", "3.71.0"], "only current and previous are kept");
  assert.equal(s.installed("--version").stdout.trim(), "automagik-herdr 3.71.0");

  // A replayed older pointer (validly signed) is refused, and nothing moves.
  post(s, "3.70.2");
  const older = s.installed("update", "automagik.am");
  assert.equal(older.status, 1);
  assert.match(older.stderr, /older than the newest this machine took \(sequence 710000\): refusing it/);
  assert.equal(s.installed("--version").stdout.trim(), "automagik-herdr 3.71.0");

  // Rollback goes back to the kept copy; the next update moves forward again.
  const back = s.installed("rollback", "automagik.am");
  assert.equal(back.status, 0, back.stderr);
  assert.equal(s.installed("--version").stdout.trim(), "automagik-herdr 3.70.2");
  assert.equal(record(s).seen, sequenceOf("3.71.0"), "a rollback keeps the newest sequence taken");
  post(s, "3.71.0");
  assert.equal(json(s.installed("update", "automagik.am", "--json")).am.to, "3.71.0");
  assert.equal(s.installed("--version").stdout.trim(), "automagik-herdr 3.71.0");
});

test("refused, with nothing installed: a tarball that is not the signed one, an unsigned pointer, an unsafe tarball", (t) => {
  const s = scratch(t);
  const tgz = tarball(s, "3.70.1");
  post(s, "3.70.1");
  writeFileSync(tgz, Buffer.concat([readFileSync(tgz), Buffer.from("x")]));
  const swapped = s.am("update", "automagik.am");
  assert.equal(swapped.status, 1);
  assert.match(swapped.stderr, /does not match the signed pointer/);

  tarball(s, "3.70.1");
  post(s, "3.70.1", { sig: "AAAA" });
  assert.match(s.am("update", "automagik.am").stderr, /signature does not match/);
  rmSync(join(s.releases, "download", "am-lane", "am.json.sig"));
  assert.match(s.am("update", "automagik.am").stderr, /am\.json\.sig is missing/);

  // The run's own keys only for a file:// folder: with none trusted (am-keys.json is empty), refused.
  post(s, "3.70.1");
  assert.match(s.run(join(AM, "bin", "am"), ["update", "automagik.am"], { AM_TRUSTED_KEYS: "" }).stderr, /a key this am does not trust/);

  tarball(s, "3.70.1", { tamper: (dir) => symlinkSync("/etc/passwd", join(dir, "evil")) });
  post(s, "3.70.1");
  assert.match(s.am("update", "automagik.am").stderr, /evil: not a plain file or folder/);
  assert.equal(existsSync(join(s.store, "current")), false);
});

test("links: am takes the pack's automagik-herdr, leaves a foreign one, and hands it back on uninstall", (t) => {
  const s = scratch(t);
  const bin = join(s.home, ".local", "bin");
  const packCli = join(s.app, "mods", "am-sidebar", "bin", "automagik-herdr");
  mkdirSync(dirname(packCli), { recursive: true });
  writeFileSync(packCli, "#!/bin/sh\necho pack\n");
  mkdirSync(bin, { recursive: true });
  symlinkSync(packCli, join(bin, "automagik-herdr"));
  assert.equal(s.am("self", "install").status, 0);
  assert.equal(readlinkSync(join(bin, "automagik-herdr")), join(s.store, "current", "bin", "automagik-herdr"));

  const gone = s.installed("self", "uninstall");
  assert.equal(gone.status, 0, gone.stderr);
  assert.equal(readlinkSync(join(bin, "automagik-herdr")), packCli, "handed back to the pack's entry");
  assert.equal(existsSync(join(bin, "am")), false);
  assert.ok(existsSync(join(s.store, "current")), "the store stays without --purge");

  // Someone else's automagik-herdr is left alone, and doctor says so.
  rmSync(join(bin, "automagik-herdr"));
  symlinkSync("/usr/bin/true", join(bin, "automagik-herdr"));
  const again = s.am("self", "install");
  assert.match(again.stdout, /automagik-herdr: left \(it points at \/usr\/bin\/true\)/);
  assert.ok(lstatSync(join(bin, "automagik-herdr")).isSymbolicLink());
  assert.equal(readlinkSync(join(bin, "automagik-herdr")), "/usr/bin/true");
  assert.equal(s.installed("self", "doctor").status, 1);
});

test("a machine with no pack (work only): am update is am's alone, and herdr.pack is not applicable", (t) => {
  const s = scratch(t);
  const all = s.am("update", "--json");
  assert.equal(all.status, 0, all.stderr);
  assert.deepEqual(json(all), { am: { state: "none", from: null, to: null, detail: "nothing is posted on am-lane yet" }, pack: { state: "not-installed" } });
  const pack = s.am("update", "herdr.pack");
  assert.equal(pack.status, 2);
  assert.match(pack.stderr, /the herdr pack is not installed on this machine/);
  assert.equal(existsSync(join(s.app, "mods")), false, "nothing of the pack was installed");
});

test("usage: exit 2 for an id am does not handle and an unknown option", (t) => {
  const s = scratch(t);
  assert.equal(s.am("rollback", "herdr.am-quota").status, 2);
  assert.equal(s.am("update", "--nope").status, 2);
  assert.equal(s.am("self", "dance").status, 2);
});
