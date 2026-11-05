// install.sh (A17) against a fake home, a fake release served from a folder (file:// URLs) and
// fake `uname`, `brew` and Herdr: never the real home, Homebrew or Herdr. Run with `sh`, so a
// bash-only construct fails here (CI's sh is dash).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INSTALL = join(ROOT, "install.sh");
const PACK_SRC = join(ROOT, "mods", "am-sidebar");
// The layout is its own top-level entry beside herdr/ (RFC 0011); the tarball carries it as layouts/automagik.json.
const LAYOUT_SRC = join(ROOT, "..", "herdr-layout", "layouts", "automagik.json");
const { OFF_BY_DEFAULT, OLD_PACK_NAME, PACK_MODS, USAGEMETER, V020_LAYOUT_SHA256, parseMarker } = await import("../mods/am-sidebar/release.js");
/** The pack mods a fresh install turns on (herdr-app checks those); OFF_BY_DEFAULT ones start off. */
const ON_MODS = PACK_MODS.filter((m) => !OFF_BY_DEFAULT.includes(m));
/** herdrdev's installer (D27), the only Herdr install.sh offers; and the app's bundle ids. */
const HERDR_INSTALLER = "https://releases.herdr.dev/app/install.sh";
const HERDR_ID = "dev.herdr.app", HERDR_UI_ID = "so.pen.herdr-gpui";
const { keys: TEST_KEYS, pointerBytes, signatureOf } = await import("./pointer.mjs");

const exe = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };
/** An app bundle at `app` with the bundle id `id`: only its Info.plist, as the check reads it. */
const plist = (id) => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n    <key>CFBundleExecutable</key><string>Herdr</string>\n    <key>CFBundleIdentifier</key><string>${id}</string>\n</dict></plist>\n`;
const appBundle = (app, id = HERDR_ID) => { mkdirSync(join(app, "Contents"), { recursive: true }); writeFileSync(join(app, "Contents", "Info.plist"), plist(id)); };
/** The command install.sh links (its cli_target): the sidebar's bin/automagik-herdr wrapper when the pack ships one, else the .mjs. */
const cliTarget = (s) => join(s.pack, "bin", existsSync(join(s.pack, "bin", "automagik-herdr")) ? "automagik-herdr" : "automagik-herdr.mjs");
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
/** One digest over every file and link under `dir` (names, link targets, bytes). */
const treeSum = (dir) => {
  const h = createHash("sha256");
  const walk = (at, rel) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name), st = lstatSync(path);
      h.update(`${rel}${name}\0${st.mode}\0`);
      if (st.isSymbolicLink()) h.update(readlinkSync(path));
      else if (st.isDirectory()) walk(path, `${rel}${name}/`);
      else h.update(readFileSync(path));
    }
  };
  walk(dir, "");
  return h.digest("hex");
};

/** herdr: true, an app with bundle id dev.herdr.app in the fake /Applications; a string, that bundle id. */
function scratch(t, { herdr = true, os = "Darwin", arch = "arm64" } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ah-install-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home"), bin = join(root, "bin"), apps = join(root, "Applications"), rel = join(root, "release");
  for (const d of [home, bin, apps, rel]) mkdirSync(d, { recursive: true });
  if (herdr) appBundle(join(apps, "Herdr.app"), herdr === true ? HERDR_ID : herdr);
  const brewLog = join(root, "brew.log");
  writeFileSync(brewLog, "");
  exe(join(bin, "uname"), `#!/bin/sh\ncase "$1" in -m) echo ${arch} ;; *) echo ${os} ;; esac\n`);
  // curl: logs each URL, then the real curl (file:// only: the release URL is a folder here).
  // Herdr's installer is never fetched for real: herdrInstaller() stubs it, else it fails.
  const curlLog = join(root, "curl.log");
  writeFileSync(curlLog, "");
  exe(join(bin, "curl"), `#!/bin/sh\nfor a; do case $a in file://*|https://*) echo "$a" >> "${curlLog}" ;; esac; case $a in https://releases.herdr.dev/*) exit 22 ;; esac; done\nexec /usr/bin/curl "$@"\n`);
  // Homebrew: only logs its arguments (install.sh offers it for Node on macOS, never for Herdr).
  exe(join(bin, "brew"), `#!/bin/sh\necho "$*" >> "${brewLog}"\n`);
  // herdr-app, when a test puts it on PATH: logs its arguments; `status` prints the layout
  // `show(name)` set (as JSON), or fails while none is set.
  const herdrLog = join(root, "herdr-app.log"), shownFile = join(root, "herdr-shown");
  writeFileSync(herdrLog, "");
  const addHerdrApp = () => exe(join(bin, "herdr-app"), `#!/bin/sh
printf '%s\\n' "$*" >> "${herdrLog}"
if [ "$1" = status ]; then
  [ -f "${shownFile}" ] || exit 1
  printf '{\\n  "layout": "%s",\\n  "zoom": false\\n}\\n' "$(cat "${shownFile}")"
fi
`);
  const show = (name) => writeFileSync(shownFile, name);
  // A fake hc with no linked machine (linkMachines adds two): install.sh's `meter install --linked`
  // never reaches the real hc, wherever node and hc are installed.
  const hcState = join(root, "hc.json"), hcLog = join(root, "hc.log");
  writeFileSync(hcState, JSON.stringify({ terminals: [], machines: [] }));
  writeFileSync(hcLog, "");
  exe(join(bin, "hc"), `#!/bin/sh\nexec "${process.execPath}" "${join(ROOT, "test", "fake-hc.mjs")}" "$@"\n`);
  const extraEnv = { HC_FAKE_STATE: hcState, HC_FAKE_LOG: hcLog };
  const env = {
    HOME: home, TMPDIR: root, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    AUTOMAGIK_HERDR_RELEASE_URL: `file://${rel}`, AUTOMAGIK_HERDR_TTY: join(root, "no-tty"), AUTOMAGIK_HERDR_APPS: apps,
    AUTOMAGIK_HERDR_PACK_KEYS: JSON.stringify({ keys: TEST_KEYS }),
  };
  const appHome = join(home, ".config", "herdr-app");
  const pack = join(appHome, "mods", "am-sidebar");
  const old = join(appHome, "mods", OLD_PACK_NAME); // the sidebar's folder before the rename (v0.2-v0.4.x)
  const link = join(home, ".local", "bin", "automagik-herdr");
  const run = (...args) => {
    const r = spawnSync("sh", [INSTALL, ...args], { cwd: root, env: { ...env, ...extraEnv }, encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  // As `curl … | sh -s -- <args>` runs it: the script is stdin.
  const piped = (...args) => {
    const r = spawnSync("sh", ["-s", "--", ...args], { cwd: root, env: { ...env, ...extraEnv }, encoding: "utf8", input: readFileSync(INSTALL) });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  /**
   * Publishes a release as release.yml packs it: every PACK_MODS folder of the repo plus
   * the layout (herdr-layout/layouts/automagik.json, at the same path), at `version`, or `edit(srcDir)` changing it first. As in a real release
   * only am-sidebar carries VERSION; each main.js ends in a `// release <v>` line, the code
   * change a release brings, so a test can tell which release a folder is from. The tarball and its
   * .sha256 go in download/v<version>/; with `latest`, the herdr-lane release's pack.json names it,
   * signed by the test key (pack.json.sig; `sign: "untrusted"` signs with another key, `sign: false`
   * leaves the signature out; `pointer` adds or overrides pack.json fields). `sums` replaces the sha256 both publish. Without `latest`, only
   * --version reaches it.
   */
  const publish = (version, { edit, sums, latest = true, sign = true, pointer = {} } = {}) => {
    const src = join(root, `src-${version}`);
    rmSync(src, { recursive: true, force: true });
    for (const m of PACK_MODS) {
      cpSync(join(ROOT, "mods", m), join(src, m), { recursive: true });
      writeFileSync(join(src, m, "main.js"), `${readFileSync(join(src, m, "main.js"), "utf8")}\n// release ${version}\n`);
    }
    writeFileSync(join(src, "am-sidebar", "VERSION"), `${version}\n`);
    mkdirSync(join(src, "layouts"));
    cpSync(LAYOUT_SRC, join(src, "layouts", "automagik.json"));
    edit?.(src);
    const name = `automagik-herdr-pack-${version}.tgz`;
    const dir = join(rel, "download", `v${version}`);
    mkdirSync(dir, { recursive: true });
    execFileSync("tar", ["-czf", join(dir, name), "-C", src, ...readdirSync(src)], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    const sum = sums ?? sha(join(dir, name));
    writeFileSync(join(dir, `${name}.sha256`), `${sum}  ${name}\n`);
    if (latest) {
      const lane = join(rel, "download", "herdr-lane");
      mkdirSync(lane, { recursive: true });
      const bytes = pointerBytes(version, { url: `file://${dir}/${name}`, sha256: sum, ...pointer });
      writeFileSync(join(lane, "pack.json"), bytes);
      rmSync(join(lane, "pack.json.sig"), { force: true });
      if (sign) writeFileSync(join(lane, "pack.json.sig"), `${signatureOf(bytes, { untrusted: sign === "untrusted" })}\n`);
    }
  };
  /**
   * Publishes usagemeter release `version` under <release>/usagemeter/download/v<version>/: each
   * asset a script answering `--version` with `usagemeter <reports>`, and SHA256SUMS (or `sums`).
   * The fakes are not the real builds, so the installer's pin is theirs (AUTOMAGIK_HERDR_METER_PIN,
   * a file:// release only), or `pin`.
   */
  const publishMeter = ({ version = USAGEMETER.version, reports = version, sums, pin } = {}) => {
    const dir = join(rel, "usagemeter", "download", `v${version}`);
    mkdirSync(dir, { recursive: true });
    const lines = Object.values(USAGEMETER.assets).map((name) => {
      exe(join(dir, name), `#!/bin/sh\n[ "$1" = --version ] && echo "usagemeter ${reports}"\nexit 0\n`);
      return `${sums ?? sha(join(dir, name))}  ${name}\n`;
    });
    writeFileSync(join(dir, "SHA256SUMS"), lines.join(""));
    const pinFile = join(root, "meter-pin");
    writeFileSync(pinFile, Object.values(USAGEMETER.assets).map((name) => `${pin ?? sha(join(dir, name))}  ${name}\n`).join(""));
    extraEnv.AUTOMAGIK_HERDR_METER_PIN = pinFile;
  };
  const meterCalls = () => readFileSync(curlLog, "utf8").split("\n").filter((l) => l.includes("/usagemeter/"));
  const herdrInstallerCalls = () => readFileSync(curlLog, "utf8").split("\n").filter((l) => l === HERDR_INSTALLER);
  const brewCalls = () => readFileSync(brewLog, "utf8").split("\n").filter(Boolean);
  /** herdr-app's calls other than `status` and `check`. */
  const herdrCalls = () => readFileSync(herdrLog, "utf8").split("\n").filter((l) => l && l !== "status" && l !== "ls" && !l.startsWith("check "));
  const checks = () => readFileSync(herdrLog, "utf8").split("\n").filter((l) => l.startsWith("check "));
  const mark = () => readFileSync(join(appHome, "automagik-herdr", "installed-by-install.sh"), "utf8");
  const mods = join(appHome, "mods"), state = join(appHome, "automagik-herdr");
  /** Where a pack folder is: mods/<m>, or mods-disabled/<m> while it is off (am-automations and am-quota ship off). */
  const where = (m) => (existsSync(join(mods, m)) ? join(mods, m) : join(appHome, "mods-disabled", m));
  /** Every pack folder's release (its VERSION), by name, on or off. */
  const versions = () => Object.fromEntries(PACK_MODS.map((m) => [m, /\/\/ release (\S+)\n$/.exec(readFileSync(join(where(m), "main.js"), "utf8"))?.[1]]));
  const all = (v) => Object.fromEntries(PACK_MODS.map((m) => [m, v]));
  return { root, bin, home, apps, appHome, mods, state, where, pack, old, link, run, piped, publish, publishMeter, meterCalls, herdrInstallerCalls, brewCalls, addHerdrApp, show, herdrCalls, checks, mark, versions, all, extraEnv, herdrLog };
}

test("install.sh is POSIX sh", () => {
  execFileSync("sh", ["-n", INSTALL]);
});

test("a fresh install puts the pack and the command in place; a second run changes nothing", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  s.publishMeter();
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(s.versions(), s.all("9.9.0"));
  assert.match(s.mark(), new RegExp(`^version=9\\.9\\.0\nmods=${PACK_MODS.join(",")}\nlayout=added\nbefore=none\ninstalled=\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z\nsequence=90000\nusagemeter=0\\.3\\.0\nusagemeter-scope=all\n$`));
  // The pack ships bin/run.sh and the bin/automagik-herdr wrapper (dev #42); the link is the wrapper.
  const listed = execFileSync("tar", ["-tzf", join(s.root, "release", "download", "v9.9.0", "automagik-herdr-pack-9.9.0.tgz")], { encoding: "utf8" }).split("\n");
  for (const f of ["run.sh", "automagik-herdr"]) assert.ok(listed.includes(`am-sidebar/bin/${f}`), `the tarball has am-sidebar/bin/${f}`);
  for (const f of ["run.sh", "automagik-herdr"]) assert.equal(lstatSync(join(s.pack, "bin", f)).mode & 0o111, 0o111, f);
  assert.equal(readlinkSync(s.link), join(s.pack, "bin", "automagik-herdr"));
  assert.match(r.out, /Checksum: ok\.\n(  .*\n)*Installed the pack 9\.9\.0/);
  assert.deepEqual(JSON.parse(readFileSync(join(s.appHome, "keys.json"), "utf8")), { global: { "cmd-shift-m": "mod.open:am-mods" } });
  assert.match(readFileSync(join(s.appHome, "data", "am-mods", "catalog.json"), "utf8"), /automagik-dev\/automagik\/dev\/herdr\/catalog\/index\.json/);
  assert.match(r.out, /Add ~\/\.local\/bin to your PATH/);
  const version = spawnSync(s.link, ["--version"], { encoding: "utf8", env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` } });
  assert.equal(version.stdout.trim(), "automagik-herdr 9.9.0", version.stderr);
  // No node on PATH (a pane Herdr started): bin/run.sh finds one anyway.
  // Linux may install node in /usr/bin: expose only the wrapper's shell utilities.
  const bareBin = join(s.root, "bare-bin");
  mkdirSync(bareBin);
  for (const cmd of ["sh", "dirname", "readlink"]) {
    const path = execFileSync("/bin/sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" }).trim();
    symlinkSync(path, join(bareBin, cmd));
  }
  const bare = { HOME: s.home, PATH: bareBin, AUTOMAGIK_HERDR_RUNTIME_DIRS: dirname(process.execPath) };
  const which = spawnSync("/bin/sh", ["-c", "command -v node"], { encoding: "utf8", env: bare });
  assert.notEqual(which.status, 0, `node must be absent from the test PATH, found ${which.stdout.trim()}`);
  const noNode = spawnSync(s.link, ["--version"], { encoding: "utf8", env: bare });
  assert.equal(noNode.stdout.trim(), "automagik-herdr 9.9.0", noNode.stderr);
  assert.deepEqual(s.brewCalls(), []);
  const before = lstatSync(s.pack).ino;
  const again = s.run();
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /Automagik Herdr 9\.9\.0 is already up to date .*: every file matches the release; herdr-app not found, so no mod was checked\./);
  assert.doesNotMatch(again.out, /Downloading|Linked/);
  assert.equal(lstatSync(s.pack).ino, before);
  assert.equal(existsSync(join(s.state, ".prev")), false);
});

test("a link to the .mjs (installed before bin/run.sh) is repointed at the wrapper; a pinned old pack gets the .mjs", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  rmSync(s.link);
  symlinkSync(join(s.pack, "bin", "automagik-herdr.mjs"), s.link);
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /already up to date/);
  assert.match(r.out, /Linked /);
  assert.equal(readlinkSync(s.link), join(s.pack, "bin", "automagik-herdr"));
  // A release from before the wrapper: the link names the .mjs it has.
  s.publish("9.8.0", { latest: false, edit: (dir) => rmSync(join(dir, "am-sidebar", "bin", "automagik-herdr")) });
  const old = s.run("--yes", "--version", "9.8.0");
  assert.equal(old.code, 0, old.err);
  assert.equal(readlinkSync(s.link), join(s.pack, "bin", "automagik-herdr.mjs"));
  const again = s.run("--yes", "--version", "9.8.0");
  assert.match(again.out, /already up to date/);
});

test("a newer release replaces the installed one; --version pins one", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  s.publish("9.10.0");
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(s.versions(), s.all("9.10.0"));
  assert.match(r.out, /The folders it replaced \(9\.9\.0\) are kept in .*\.prev/);
  const pinned = s.run("--yes", "--version", "v9.9.0");
  assert.equal(pinned.code, 0, pinned.err);
  assert.deepEqual(s.versions(), s.all("9.9.0"));
  assert.equal(s.run("--version", "1.0.0").code, 1, "a release that isn't there");
});

test("Herdr missing with no terminal and no --yes: stops, prints herdrdev's install command, runs nothing", (t) => {
  const s = scratch(t, { herdr: false });
  s.publish("9.9.0");
  const r = s.run();
  assert.notEqual(r.code, 0);
  assert.match(r.err, /Herdr \(dev\.herdr\.app\) is not in .*Install it with: curl -fsSL https:\/\/releases\.herdr\.dev\/app\/install\.sh \| sh/);
  assert.deepEqual(s.herdrInstallerCalls(), []);
  assert.deepEqual(s.brewCalls(), []);
  assert.equal(existsSync(s.pack), false);
});

test("macOS, Herdr missing with --yes: herdrdev's installer puts it in ~/Applications, then the pack", (t) => {
  const s = scratch(t, { herdr: false });
  s.publish("9.9.0");
  herdrInstaller(s, macInstaller(s));
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(s.herdrInstallerCalls(), [HERDR_INSTALLER]);
  assert.deepEqual(s.brewCalls(), [], "Homebrew is never used for Herdr");
  assert.ok(existsSync(join(s.home, "Applications", "Herdr.app", "Contents", "Info.plist")));
  assert.equal(readFileSync(join(s.pack, "VERSION"), "utf8").trim(), "9.9.0");
  // herdr-app is only in ~/.local/bin, which PATH lacks here: the mod checks still run.
  assert.equal(s.checks().length, ON_MODS.length);
});

test("macOS: Herdr is found by its bundle id, never by its name", async (t) => {
  await t.test("dev.herdr.app in ~/Applications only (where herdrdev's installer puts it): ok", (t) => {
    const s = scratch(t, { herdr: false });
    s.publish("9.9.0");
    appBundle(join(s.home, "Applications", "Herdr.app"));
    const r = s.run("--yes");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Herdr: ok\./);
    assert.deepEqual(s.herdrInstallerCalls(), []);
  });
  await t.test("a Herdr.app folder with no Info.plist, or herdr-app on PATH alone: not Herdr", (t) => {
    const s = scratch(t, { herdr: false });
    s.publish("9.9.0");
    mkdirSync(join(s.apps, "Herdr.app"));
    s.addHerdrApp();
    const r = s.run();
    assert.equal(r.code, 1);
    assert.match(r.err, /Herdr \(dev\.herdr\.app\) is not in /);
    assert.equal(existsSync(s.appHome), false);
  });
  await t.test("Herdr UI (so.pen.herdr-gpui) in /Applications: named, left alone, herdrdev's installed beside it", (t) => {
    const s = scratch(t, { herdr: HERDR_UI_ID });
    s.publish("9.9.0");
    const theirs = join(s.apps, "Herdr.app", "Contents", "Info.plist");
    const no = s.run();
    assert.equal(no.code, 1);
    assert.match(no.out, /Herdr\.app is so\.pen\.herdr-gpui, a different app named Herdr, not dev\.herdr\.app/);
    assert.match(no.err, /releases\.herdr\.dev\/app\/install\.sh/);
    herdrInstaller(s, macInstaller(s));
    const r = s.run("--yes");
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(s.herdrInstallerCalls(), [HERDR_INSTALLER]);
    assert.equal(readFileSync(theirs, "utf8"), plist(HERDR_UI_ID), "the other app is untouched");
    assert.equal(readFileSync(join(s.pack, "VERSION"), "utf8").trim(), "9.9.0");
  });
  await t.test("Herdr UI in ~/Applications: refused before herdrdev's installer could replace it", (t) => {
    const s = scratch(t, { herdr: false });
    s.publish("9.9.0");
    appBundle(join(s.home, "Applications", "Herdr.app"), HERDR_UI_ID);
    herdrInstaller(s, macInstaller(s));
    const r = s.run("--yes");
    assert.equal(r.code, 1);
    assert.match(r.err, /Herdr's installer would replace .*Herdr\.app, which is not dev\.herdr\.app/);
    assert.deepEqual(s.herdrInstallerCalls(), []);
    assert.equal(readFileSync(join(s.home, "Applications", "Herdr.app", "Contents", "Info.plist"), "utf8"), plist(HERDR_UI_ID));
    assert.equal(existsSync(s.appHome), false);
  });
  // Anything in ~/Applications/Herdr.app that is not positively dev.herdr.app stops the install:
  // herdrdev's installer would rm -rf it.
  const unreadable = {
    "an empty Herdr.app folder": (app) => mkdirSync(app, { recursive: true }),
    "an Info.plist with no CFBundleIdentifier": (app) => { mkdirSync(join(app, "Contents"), { recursive: true }); writeFileSync(join(app, "Contents", "Info.plist"), '<?xml version="1.0"?>\n<plist version="1.0"><dict><key>CFBundleName</key><string>Herdr</string></dict></plist>\n'); },
    "an empty CFBundleIdentifier": (app) => appBundle(app, ""),
    "a plain file named Herdr.app": (app) => { mkdirSync(dirname(app), { recursive: true }); writeFileSync(app, "not an app\n"); },
  };
  for (const [what, make] of Object.entries(unreadable)) {
    await t.test(`${what} in ~/Applications: refused, untouched, herdrdev's installer never fetched`, (t) => {
      const s = scratch(t, { herdr: false });
      s.publish("9.9.0");
      const app = join(s.home, "Applications", "Herdr.app");
      make(app);
      const before = treeSum(join(s.home, "Applications"));
      herdrInstaller(s, macInstaller(s));
      const r = s.run("--yes");
      assert.equal(r.code, 1);
      assert.match(r.out, /Herdr\.app is not dev\.herdr\.app .*: its bundle id cannot be read; it is left alone\./);
      assert.match(r.err, /Herdr's installer would replace .*Herdr\.app, which is not dev\.herdr\.app/);
      assert.deepEqual(s.herdrInstallerCalls(), []);
      assert.equal(treeSum(join(s.home, "Applications")), before);
      assert.equal(existsSync(s.appHome), false);
    });
  }
});

test("a tampered tarball (not the signed pointer's sha256, or not a --version release's .sha256) installs nothing", (t) => {
  const s = scratch(t);
  s.publish("9.9.0", { sums: "0".repeat(64) });
  const r = s.run("--yes");
  assert.equal(r.code, 1);
  assert.match(r.err, /automagik-herdr-pack-9\.9\.0\.tgz does not match the signed pointer \(sha256 [0-9a-f]{64}, expected 0{64}\): nothing was installed/);
  assert.equal(existsSync(s.appHome), false, "nothing written before the checksum");
  assert.equal(existsSync(s.link), false);
  s.publish("9.8.0", { sums: "0".repeat(64), latest: false });
  const old = s.run("--yes", "--version", "9.8.0");
  assert.equal(old.code, 1);
  assert.match(old.err, /does not match automagik-herdr-pack-9\.8\.0\.tgz\.sha256 .*nothing was installed/);
  assert.equal(existsSync(s.appHome), false);
});

test("the pack pointer: a bad signature, an untrusted key, no signature or no pointer installs nothing", (t) => {
  const s = scratch(t);
  s.publishMeter();
  const refused = (re, what) => {
    const r = s.run("--yes");
    assert.equal(r.code, 1, what);
    assert.match(r.err, re, what);
    assert.equal(existsSync(s.appHome), false, `${what}: nothing written`);
  };
  refused(/could not download file:\/\/.*\/download\/herdr-lane\/pack\.json \(is a pack released yet\?\)/, "no pointer");
  s.publish("9.9.0", { sign: "untrusted" });
  refused(/the pack pointer .*pack\.json: its signature does not match; nothing was installed/, "another key's signature");
  // A pointer edited after it was signed (here: to name another sha256).
  s.publish("9.9.0");
  const lane = join(s.root, "release", "download", "herdr-lane", "pack.json");
  writeFileSync(lane, readFileSync(lane, "utf8").replace(/"sha256": "[0-9a-f]{64}"/, `"sha256": "${"1".repeat(64)}"`));
  refused(/its signature does not match/, "an edited pointer");
  s.publish("9.9.0", { sign: false });
  refused(/could not download .*pack\.json\.sig: refusing the pointer/, "no signature");
  s.publish("9.9.0");
  s.extraEnv.AUTOMAGIK_HERDR_PACK_KEYS = JSON.stringify({ keys: [{ ...TEST_KEYS[0], keyId: "someone-else" }] });
  refused(/it is signed by herdr-pack-test, a key this installer does not trust/, "an unknown key");
  // The installer's own keys are pack-keys.json's (herdr-lane.test.ts keeps them equal); a test key is never one.
  const shipped = JSON.parse(/^\s*TRUSTED_KEYS='([^']*)'$/m.exec(readFileSync(INSTALL, "utf8"))[1]).keys;
  assert.deepEqual(shipped, JSON.parse(readFileSync(join(PACK_SRC, "pack-keys.json"), "utf8")).keys);
  assert.ok(!shipped.some((k) => k.keyId === "herdr-pack-test"));
  delete s.extraEnv.AUTOMAGIK_HERDR_PACK_KEYS;
  const ok = s.run("--yes");
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /Pack pointer: signed by a key this installer trusts; it names 9\.9\.0\./);
});

test("a tarball holding a symlink installs nothing, and leaves the old pack", (t) => {
  const s = scratch(t);
  mkdirSync(s.pack, { recursive: true });
  writeFileSync(join(s.pack, "main.js"), "// the old pack\n");
  s.publish("9.9.0", { edit: (dir) => symlinkSync("/etc/passwd", join(dir, "am-tabs", "evil")) });
  const r = s.run("--yes");
  assert.equal(r.code, 1);
  assert.match(r.err, /nothing was installed: .*evil: not a plain file or folder/);
  assert.equal(readFileSync(join(s.pack, "main.js"), "utf8"), "// the old pack\n");
  assert.equal(existsSync(s.link), false);
  assert.deepEqual(readdirSync(s.mods), ["am-sidebar"]);
});

test("a foreign folder in the tarball (not its PACK_MODS, or pocket-link) is refused, and nothing is installed", (t) => {
  const s = scratch(t);
  for (const extra of ["evil-mod", "pocket-link"]) {
    s.publish("9.9.0", { edit: (dir) => { mkdirSync(join(dir, extra)); writeFileSync(join(dir, extra, "main.js"), "x\n"); writeFileSync(join(dir, extra, "mod.json"), "{}\n"); } });
    const r = s.run("--yes");
    assert.equal(r.code, 1, extra);
    assert.match(r.err, extra === "pocket-link" ? /pocket-link\/.*outside the pack's folders/ : /are not its PACK_MODS/);
    assert.equal(existsSync(s.mods), false, extra);
  }
});

test("--uninstall puts the adopted pack back and removes the command; bots and settings stay", (t) => {
  const s = scratch(t);
  mkdirSync(s.pack, { recursive: true });
  writeFileSync(join(s.pack, "main.js"), "// the owner's clone\n");
  writeFileSync(join(s.pack, "mod.json"), "{}\n");
  writeFileSync(join(s.appHome, "settings.json"), "{\"theme\":\"mine\"}\n");
  const project = join(s.home, "proj", ".herdr");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "bots.json"), "{\"version\":1}\n");
  s.publish("9.9.0");
  assert.equal(s.run("--yes", "--adopt").code, 0);
  assert.equal(readFileSync(join(s.pack, "VERSION"), "utf8").trim(), "9.9.0");
  const r = s.run("--uninstall");
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(join(s.pack, "main.js"), "utf8"), "// the owner's clone\n");
  assert.equal(existsSync(s.link), false);
  assert.equal(readFileSync(join(s.appHome, "settings.json"), "utf8"), "{\"theme\":\"mine\"}\n");
  assert.equal(readFileSync(join(project, "bots.json"), "utf8"), "{\"version\":1}\n");
  const again = s.run("--uninstall");
  assert.equal(again.code, 0);
  assert.match(again.out, /Nothing to uninstall/);
  assert.equal(readFileSync(join(s.pack, "main.js"), "utf8"), "// the owner's clone\n");
});

test("--uninstall with nothing there before moves the pack out of mods/, never deletes it", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  const r = s.run("--uninstall");
  assert.equal(r.code, 0, r.err);
  assert.equal(existsSync(s.pack), false);
  assert.deepEqual(readdirSync(s.mods), []);
  assert.equal(readFileSync(join(s.state, ".prev", "am-sidebar", "VERSION"), "utf8").trim(), "9.9.0");
  assert.match(readFileSync(join(s.state, ".prev", ".pack"), "utf8"), new RegExp(`^mods=${PACK_MODS.join(",")}$`, "m"));
});

test("a command link the person pointed elsewhere is never replaced or removed; one into this install is", (t) => {
  const s = scratch(t);
  const theirs = join(s.root, "elsewhere", "automagik-herdr.mjs");
  mkdirSync(dirname(theirs), { recursive: true });
  writeFileSync(theirs, "#!/usr/bin/env node\n");
  mkdirSync(dirname(s.link), { recursive: true });
  symlinkSync(theirs, s.link);
  s.publish("9.9.0");
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.equal(readlinkSync(s.link), theirs);
  assert.match(r.out, /Left .*automagik-herdr alone: it points at .*elsewhere\/automagik-herdr\.mjs, not this install\./);
  const again = s.run();
  assert.match(again.out, /is already up to date/, "a link of the person's own doesn't make every run reinstall");
  const gone = s.run("--uninstall");
  assert.equal(gone.code, 0, gone.err);
  assert.equal(readlinkSync(s.link), theirs);
  assert.match(gone.out, /Left .*automagik-herdr: it points at .*elsewhere/);
  // A link elsewhere under mods/ is not the pack's command: still the person's.
  rmSync(s.link);
  symlinkSync(join(s.mods, "other-mod", "bin", "cli.mjs"), s.link);
  assert.equal(s.run("--yes").code, 0);
  assert.equal(readlinkSync(s.link), join(s.mods, "other-mod", "bin", "cli.mjs"));
  // The pack's own command path (an earlier install's, even dangling) is ours: replaced, then removed.
  assert.equal(s.run("--uninstall").code, 0);
  rmSync(s.link);
  symlinkSync(join(s.pack, "bin", "automagik-herdr.mjs"), s.link);
  assert.equal(s.run("--yes").code, 0);
  assert.equal(readlinkSync(s.link), cliTarget(s));
  assert.equal(s.run("--uninstall").code, 0);
  assert.equal(readdirSync(dirname(s.link)).includes("automagik-herdr"), false);
});

test("unsupported OS: explains and exits 1; Node too old with no brew: says where to get it", (t) => {
  const unsupported = scratch(t, { os: "FreeBSD" });
  const r = unsupported.run("--yes");
  assert.equal(r.code, 1);
  assert.match(r.err, /supports macOS and Linux; this is FreeBSD/);
  const old = scratch(t);
  exe(join(old.root, "bin", "node"), "#!/bin/sh\nif [ \"$1\" = --version ]; then echo v18.0.0; exit 0; fi\nexit 1\n");
  rmSync(join(old.root, "bin", "brew"));
  const n = old.run("--yes");
  assert.equal(n.code, 1);
  assert.match(n.err, /Node 22\.7 or later is needed \(found: v18\.0\.0\)\. Install it from https:\/\/nodejs\.org/);
});

for (const arch of ["x86_64", "aarch64"]) {
  test(`Linux ${arch}: installs all mods, checks them and installs the Linux meter without Homebrew`, (t) => {
    const s = scratch(t, { os: "Linux", arch, herdr: false });
    s.addHerdrApp();
    s.publish("9.9.0");
    s.publishMeter();
    const r = s.piped("--yes");
    assert.equal(r.code, 0, `${r.out}\n${r.err}`);
    assert.match(r.out, /Linux: ok/);
    assert.deepEqual(s.versions(), s.all("9.9.0"));
    assert.equal(s.checks().length, ON_MODS.length);
    assert.deepEqual(s.brewCalls(), []);
    assert.ok(s.meterCalls().some((url) => url.endsWith(`/usagemeter-linux-${arch}`)));
    assert.equal(s.run("--uninstall").code, 0);
    assert.equal(existsSync(s.link), false);
  });
}

test("Linux without herdr-app: asks before installing, ignores a Mac app folder and never uses brew", (t) => {
  const s = scratch(t, { os: "Linux" });
  const r = s.run();
  assert.equal(r.code, 1);
  assert.match(r.err, /herdr-app is not on PATH or in .*Install it with: curl -fsSL https:\/\/releases\.herdr\.dev\/app\/install\.sh \| sh/);
  assert.deepEqual(s.herdrInstallerCalls(), []);
  assert.deepEqual(s.brewCalls(), []);
  assert.equal(existsSync(s.appHome), false);
});

// herdrdev's installer is fetched via the same curl as the pack. Stub that one URL only;
// all pack and meter downloads remain real file:// downloads into the scratch home.
function herdrInstaller(s, body, { downloadFails = false } = {}) {
  const curl = join(s.bin, "curl");
  const original = readFileSync(curl, "utf8");
  exe(curl, `#!/bin/sh
if [ "$2" = ${HERDR_INSTALLER} ]; then
  echo "$2" >> "${join(s.root, "curl.log")}"
  ${downloadFails ? "exit 22" : `cat > "$4" <<'HERDR_INSTALLER'\n${body}\nHERDR_INSTALLER\nexit 0`}
fi
${original.replace(/^#![^\n]*\n/, "")}`);
}
/** What herdrdev's installer does, without sudo: Linux, the app in ~/.local/share/herdr-app linked from ~/.local/bin. */
function linuxInstaller(s) {
  s.addHerdrApp();
  const app = readFileSync(join(s.bin, "herdr-app"), "utf8");
  rmSync(join(s.bin, "herdr-app"));
  const data = join(s.home, ".local", "share", "herdr-app"), bin = join(s.home, ".local", "bin");
  return `#!/bin/sh\nmkdir -p '${data}' '${bin}'\ncat > '${join(data, "herdr-app")}' <<'APP'\n${app}\nAPP\nchmod +x '${join(data, "herdr-app")}'\nln -sfn '${join(data, "herdr-app")}' '${join(bin, "herdr-app")}'`;
}
/** macOS: Herdr.app (dev.herdr.app) in ~/Applications, its binary linked from ~/.local/bin. */
function macInstaller(s) {
  s.addHerdrApp();
  const app = readFileSync(join(s.bin, "herdr-app"), "utf8");
  rmSync(join(s.bin, "herdr-app"));
  const bundle = join(s.home, "Applications", "Herdr.app"), exeFile = join(bundle, "Contents", "MacOS", "Herdr"), bin = join(s.home, ".local", "bin");
  return `#!/bin/sh\nmkdir -p '${dirname(exeFile)}' '${bin}'\ncat > '${join(bundle, "Contents", "Info.plist")}' <<'PLIST'\n${plist(HERDR_ID)}PLIST\ncat > '${exeFile}' <<'APP'\n${app}\nAPP\nchmod +x '${exeFile}'\nln -sfn '${exeFile}' '${join(bin, "herdr-app")}'`;
}

test("Linux with --yes: runs herdrdev's installer (no sudo) then installs the pack through piped stdin", (t) => {
  const s = scratch(t, { os: "Linux", herdr: false });
  s.publish("9.9.0");
  s.publishMeter();
  // A sudo that would be noticed: herdrdev's installer never needs it.
  exe(join(s.bin, "sudo"), `#!/bin/sh\necho "$*" >> "${join(s.root, "sudo.log")}"\nexit 1\n`);
  herdrInstaller(s, linuxInstaller(s));
  const r = s.piped("--yes");
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  assert.deepEqual(s.herdrInstallerCalls(), [HERDR_INSTALLER]);
  assert.equal(existsSync(join(s.root, "sudo.log")), false, "no sudo");
  assert.deepEqual(s.versions(), s.all("9.9.0"));
  // herdr-app is only in ~/.local/bin, which PATH lacks here: found, and the mod checks run.
  assert.equal(s.checks().length, ON_MODS.length);
  assert.deepEqual(s.brewCalls(), []);
});

test("Linux: herdr-app in ~/.local/bin, not on PATH, counts as installed", (t) => {
  const s = scratch(t, { os: "Linux", herdr: false });
  s.publish("9.9.0");
  s.publishMeter();
  const body = linuxInstaller(s);
  assert.equal(spawnSync("sh", ["-c", body]).status, 0);
  const r = s.run("--yes");
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  assert.match(r.out, /Herdr: ok\./);
  assert.deepEqual(s.herdrInstallerCalls(), []);
  assert.equal(s.checks().length, ON_MODS.length);
});

for (const failure of ["download", "script", "missing-cli"]) {
  test(`Linux installer ${failure} failure stops before writing the pack`, (t) => {
    const s = scratch(t, { os: "Linux", herdr: false });
    herdrInstaller(s, failure === "script" ? "exit 1" : "exit 0", { downloadFails: failure === "download" });
    const r = s.piped("--yes");
    assert.equal(r.code, 1);
    assert.match(r.err, { download: /could not download Herdr's installer/, script: /Herdr's installer failed/, "missing-cli": /Herdr's installer finished, but Herdr is not installed/ }[failure]);
    assert.equal(existsSync(s.appHome), false);
    assert.deepEqual(s.brewCalls(), []);
    assert.equal(readdirSync(s.root).some((name) => name.startsWith("automagik-herdr.")), false);
  });
}

test("Linux with old Node: gives portable guidance and never invokes brew", (t) => {
  const s = scratch(t, { os: "Linux" });
  exe(join(s.bin, "node"), '#!/bin/sh\n[ "$1" = --version ] && echo v18.0.0\nexit 1\n');
  const r = s.run("--yes");
  assert.equal(r.code, 1);
  assert.match(r.err, /Install it from https:\/\/nodejs.org/);
  assert.doesNotMatch(r.err, /brew/);
  assert.deepEqual(s.brewCalls(), []);
});

test("--help and an unknown option", (t) => {
  const s = scratch(t);
  assert.match(s.run("--help").out, /install\.sh --uninstall/);
  assert.match(s.run("--help").out, /--version installs that Automagik release; it must carry the\npack/);
  assert.match(s.run("--help").out, /--adopt replaces a pack-named mod/);
  assert.equal(s.run("--nope").code, 2);
});

test("the README's agent prompt is docs/agent-install.md, word for word", () => {
  const prompt = readFileSync(join(ROOT, "docs", "agent-install.md"), "utf8");
  assert.ok(prompt.split("\n").length <= 25);
  assert.ok(readFileSync(join(ROOT, "README.md"), "utf8").includes(`\`\`\`text\n${prompt}\`\`\`\n`));
});

test("piped into sh (curl | sh -s -- --yes), with Herdr from herdrdev's installer, the whole script runs", (t) => {
  const s = scratch(t, { herdr: false });
  s.publish("9.9.0");
  herdrInstaller(s, macInstaller(s));
  const r = s.piped("--yes");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(s.herdrInstallerCalls(), [HERDR_INSTALLER]);
  assert.deepEqual(s.brewCalls(), []);
  assert.match(r.out, /Done: Automagik Herdr 9\.9\.0\./);
});

const today = () => new Date().toISOString().slice(0, 10);

test("adopt, then update twice: the adopted original stays in backup/, and --uninstall puts it back", (t) => {
  const s = scratch(t);
  mkdirSync(join(s.mods, "am-footer", ".state"), { recursive: true });
  writeFileSync(join(s.mods, "am-footer", "main.js"), "// hand-installed\n");
  writeFileSync(join(s.mods, "am-footer", ".state", "rail.json"), "{\"tab\":\"mods\"}\n");
  const original = treeSum(join(s.mods, "am-footer"));
  s.publish("9.9.0");
  const first = s.run("--yes", "--adopt");
  assert.equal(first.code, 0, first.err);
  const backup = join(s.state, "backup", `am-footer-${today()}`);
  assert.ok(first.out.includes(`adopted mods/am-footer: the original is kept in ${backup}`), first.out);
  assert.match(s.mark(), /^adopted=am-footer:backup\/am-footer-\d{4}-\d\d-\d\d$/m);
  assert.equal(readFileSync(join(s.mods, "am-footer", ".state", "rail.json"), "utf8"), "{\"tab\":\"mods\"}\n", "its state carried over");
  for (const v of ["9.10.0", "9.11.0"]) {
    s.publish(v);
    const r = s.run("--yes");
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(s.versions(), s.all(v));
    assert.equal(treeSum(backup), original, `${v}: the adopted original is untouched`);
    assert.equal(existsSync(join(s.state, ".prev", "am-footer", "main.js")), true);
  }
  assert.deepEqual(readdirSync(join(s.state, "backup")), [`am-footer-${today()}`]);
  const r = s.run("--uninstall");
  assert.equal(r.code, 0, r.err);
  assert.equal(treeSum(join(s.mods, "am-footer")), original);
  assert.equal(existsSync(backup), false);
  assert.deepEqual(readdirSync(s.mods), ["am-footer"]);
});

test("old-named folders the installer didn't write are left alone without --adopt; --uninstall leaves them too", (t) => {
  const s = scratch(t);
  const mine = {};
  for (const m of ["am-sidebar", "am-tabs"]) {
    mkdirSync(join(s.mods, m, "bin"), { recursive: true });
    writeFileSync(join(s.mods, m, "main.js"), `// ${m}, hand-placed\n`);
    writeFileSync(join(s.mods, m, "VERSION"), "9.9.0\n");
    mine[m] = treeSum(join(s.mods, m));
  }
  s.publish("9.9.0");
  const first = s.run("--yes");
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /left alone: mods\/am-tabs \(not installed by automagik-herdr; --adopt/);
  assert.match(first.out, /Left .*automagik-herdr as it is: .*am-sidebar is not this installer's/);
  assert.match(s.mark(), new RegExp(`^mods=${PACK_MODS.filter((m) => !(m in mine)).join(",")}$`, "m"));
  for (const m in mine) assert.equal(treeSum(join(s.mods, m)), mine[m], m);
  assert.equal(existsSync(s.link), false);
  const r = s.run("--uninstall");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readdirSync(s.mods), ["am-sidebar", "am-tabs"]);
  for (const m in mine) assert.equal(treeSum(join(s.mods, m)), mine[m], m);
});

test("a v0.2.0-shaped home: rerunning install.sh installs the pack beside it, then --adopt takes the hand-installed mods", (t) => {
  const s = scratch(t);
  // v0.2.x: its marker, its spaces-agents and kept copies, its bots-only layout; hand-installed mods.
  mkdirSync(s.state, { recursive: true });
  writeFileSync(join(s.state, "installed-by-install.sh"), "version=0.2.2\nbefore=kept\nlayout=added\n");
  for (const dir of [s.old, join(s.state, "spaces-agents.prev"), join(s.state, "spaces-agents.before-install")]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "main.js"), `// ${dir}\n`);
  }
  mkdirSync(join(s.old, ".state"));
  writeFileSync(join(s.old, ".state", "projects.json"), "[]\n");
  writeFileSync(join(s.old, "VERSION"), "0.2.2\n");
  // The layout v0.2 shipped, byte for byte (`git show v0.2.0:mods/spaces-agents/layouts/automagik.json`).
  const v020 = readFileSync(join(ROOT, "test", "fixtures", "layout-v0.2.0.json"));
  assert.equal(createHash("sha256").update(v020).digest("hex"), V020_LAYOUT_SHA256);
  const layout = join(s.appHome, "layouts", "automagik.json");
  mkdirSync(dirname(layout));
  writeFileSync(layout, v020);
  const hand = {};
  for (const m of ["sidebar-chrome", "auto-tabs"]) {
    mkdirSync(join(s.mods, m));
    writeFileSync(join(s.mods, m, "main.js"), `// ${m} by hand\n`);
    hand[m] = treeSum(join(s.mods, m));
  }
  s.publish("9.9.0");
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  for (const m in hand) assert.equal(treeSum(join(s.mods, m)), hand[m], `${m} untouched without --adopt`);
  assert.equal(readFileSync(join(s.pack, "VERSION"), "utf8").trim(), "9.9.0");
  assert.equal(existsSync(s.old), false, "v0.2's folder became am-sidebar");
  assert.equal(readFileSync(join(s.pack, ".state", "projects.json"), "utf8"), "[]\n", "v0.2's state carried over");
  assert.equal(readFileSync(layout, "utf8"), readFileSync(LAYOUT_SRC, "utf8"), "v0.2's unchanged layout replaced (D8)");
  assert.equal(readFileSync(join(s.state, ".prev", "spaces-agents", "VERSION"), "utf8"), "0.2.2\n");
  const backups = readdirSync(join(s.state, "backup")).sort();
  assert.deepEqual(backups, [`spaces-agents-before-install-${today()}`, `spaces-agents-v0.2-prev-${today()}`]);
  assert.match(s.mark(), /^layout=added$/m);
  assert.match(s.mark(), /^adopted=spaces-agents:backup\/spaces-agents-before-install-/m);
  const adopt = s.run("--yes", "--adopt");
  assert.equal(adopt.code, 0, adopt.err);
  assert.deepEqual(s.versions(), s.all("9.9.0"));
  for (const m in hand) assert.equal(treeSum(join(s.state, "backup", `${m}-${today()}`)), hand[m], `${m} moved to backup/ first`);
  const un = s.run("--uninstall");
  assert.equal(un.code, 0, un.err);
  for (const m in hand) assert.equal(treeSum(join(s.mods, m)), hand[m], `${m} put back`);
  assert.equal(readFileSync(join(s.old, "main.js"), "utf8"), `// ${join(s.state, "spaces-agents.before-install")}\n`, "the pack from before v0.2's first install");
});

test("a v1 marker is still uninstalled: v0.2's spaces-agents leaves, its first pack comes back", (t) => {
  const s = scratch(t);
  mkdirSync(join(s.state, "spaces-agents.before-install"), { recursive: true });
  writeFileSync(join(s.state, "installed-by-install.sh"), "version=0.2.2\nbefore=kept\n");
  writeFileSync(join(s.state, "spaces-agents.before-install", "main.js"), "// before\n");
  mkdirSync(s.old, { recursive: true });
  writeFileSync(join(s.old, "main.js"), "// v0.2.2\n");
  const r = s.run("--uninstall");
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(join(s.old, "main.js"), "utf8"), "// before\n");
  assert.equal(readFileSync(join(s.state, ".prev", "spaces-agents", "main.js"), "utf8"), "// v0.2.2\n");
});

test("install, update, rollback, uninstall: a planted pocket-link stays byte-identical", (t) => {
  const s = scratch(t);
  const pocket = join(s.mods, "pocket-link");
  mkdirSync(join(pocket, ".state"), { recursive: true });
  writeFileSync(join(pocket, "main.js"), "// automagik-pocket's\n");
  writeFileSync(join(pocket, ".state", "pairing.key"), "secret\n");
  symlinkSync("/nowhere", join(pocket, "dangling"));
  const sum = treeSum(pocket);
  s.addHerdrApp();
  s.publish("9.9.0");
  s.publishMeter();
  assert.equal(s.run("--yes").code, 0);
  assert.equal(s.checks().length, ON_MODS.length, "herdr-app check on every pack mod that is on");
  assert.equal(s.checks().some((c) => c.includes("pocket-link")), false);
  assert.equal(treeSum(pocket), sum, "after install");
  s.publish("9.10.0");
  assert.equal(s.run("--yes").code, 0);
  assert.equal(treeSum(pocket), sum, "after update");
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: s.home, HERDR_APP_HOME: s.appHome };
  const back = spawnSync(s.link, ["update", "--rollback"], { encoding: "utf8", env });
  assert.equal(back.status, 0, back.stderr);
  assert.deepEqual(s.versions(), s.all("9.9.0"));
  assert.match(s.mark(), /^version=9\.9\.0$/m);
  // The record's usagemeter line survives update.mjs's update and rollback (Group 6c).
  assert.equal(parseMarker(s.mark()).usagemeter, "0.3.0");
  assert.equal(treeSum(pocket), sum, "after rollback");
  assert.equal(s.run("--uninstall").code, 0);
  assert.deepEqual(readdirSync(s.mods), ["pocket-link"]);
  assert.equal(treeSum(pocket), sum, "after uninstall");
});

test("free keys only, and an unreadable keys.json stops the install before any folder moves", (t) => {
  const s = scratch(t);
  mkdirSync(s.appHome, { recursive: true });
  writeFileSync(join(s.appHome, "keys.json"), JSON.stringify({ global: { "cmd-shift-m": "mine.thing" } }));
  s.publish("9.9.0");
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /key = cmd-shift-m stays mine\.thing/);
  assert.deepEqual(JSON.parse(readFileSync(join(s.appHome, "keys.json"), "utf8")), { global: { "cmd-shift-m": "mine.thing" } });
  const bad = scratch(t);
  mkdirSync(bad.appHome, { recursive: true });
  writeFileSync(join(bad.appHome, "keys.json"), "{ nope");
  bad.publish("9.9.0");
  const b = bad.run("--yes");
  assert.equal(b.code, 1);
  assert.match(b.err, /keys\.json is unreadable .*nothing was installed/);
  assert.equal(existsSync(bad.mods), false);
});

test("a failing herdr-app check exits 1 after installing, naming the mod and the rollback", (t) => {
  const s = scratch(t);
  s.addHerdrApp();
  writeFileSync(join(s.bin, "herdr-app"), `${readFileSync(join(s.bin, "herdr-app"), "utf8")}case "$2" in */am-tabs) echo broken >&2; exit 1 ;; esac\n`);
  s.publish("9.9.0");
  const r = s.run("--yes");
  assert.equal(r.code, 1);
  assert.match(r.out, /check FAILED: am-tabs: broken/);
  assert.match(r.err, /herdr-app check failed .*update --rollback/);
  assert.doesNotMatch(r.out, /Done/);
  assert.deepEqual(s.versions(), s.all("9.9.0"));
});

// #44: a rerun of the installed release checks every file against it before saying "up to date".
test("a same-version rerun repairs a corrupted main.js, a deleted layout and a missing mod; nothing else", (t) => {
  const s = scratch(t);
  s.addHerdrApp();
  s.show("main");
  // Other mods (one of them Pocket Link, spelled otherwise) and a personal layout: never touched.
  const theirs = [join(s.mods, "Sheepdog"), join(s.mods, "Pocket-Link"), join(s.appHome, "layouts", "mine.json")];
  mkdirSync(join(theirs[0], ".state"), { recursive: true });
  writeFileSync(join(theirs[0], "main.js"), "// sheepdog\n");
  writeFileSync(join(theirs[0], ".state", "k"), "1\n");
  mkdirSync(theirs[1]);
  writeFileSync(join(theirs[1], "main.js"), "// automagik-pocket's\n");
  mkdirSync(dirname(theirs[2]), { recursive: true });
  writeFileSync(theirs[2], '{"name":"mine"}\n');
  const sums = () => [treeSum(theirs[0]), treeSum(theirs[1]), sha(theirs[2])];
  const before = sums();
  s.publish("9.8.0");
  assert.equal(s.run("--yes").code, 0);
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  const layout = join(s.appHome, "layouts", "automagik.json");
  const mainJs = join(s.pack, "main.js"), shipped = readFileSync(mainJs);
  mkdirSync(join(s.pack, ".state"), { recursive: true });
  writeFileSync(join(s.pack, ".state", "kept"), "the mod's own\n");

  // The issue's repro, plus a damaged file in a subfolder (the command the link points at).
  const cli = join(s.pack, "bin", "automagik-herdr.mjs"), cliShipped = readFileSync(cli);
  writeFileSync(mainJs, "invalid JavaScript !!!\n");
  writeFileSync(cli, "broken\n");
  rmSync(layout);
  const checksBefore = s.checks().length;
  const again = s.run("--yes");
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /Checking the installed Automagik Herdr 9\.9\.0 against the release\.\.\.\nChecksum: ok\./);
  assert.match(again.out, /differs from the release: mods\/am-sidebar \(bin\/automagik-herdr\.mjs, main\.js\)/);
  assert.match(again.out, /missing: the automagik layout/);
  assert.match(again.out, /repaired mods\/am-sidebar: reinstalled 9\.9\.0; the damaged copy is kept in .*backup\/am-sidebar-/);
  assert.match(again.out, /added the automagik layout/);
  assert.match(again.out, /Repaired the pack 9\.9\.0/);
  assert.match(again.out, /Done: Automagik Herdr 9\.9\.0\./);
  assert.doesNotMatch(again.out, /up to date/);
  assert.deepEqual(readFileSync(mainJs), shipped);
  assert.deepEqual(readFileSync(cli), cliShipped);
  assert.deepEqual(readFileSync(layout), readFileSync(LAYOUT_SRC));
  assert.equal(readFileSync(join(s.pack, ".state", "kept"), "utf8"), "the mod's own\n");
  assert.equal(s.checks().length - checksBefore, ON_MODS.length, "herdr-app check on every pack mod that is on, after the repair");
  // The damaged copy is in backup/, not the kept set: a rollback still brings back 9.8.0.
  const backups = readdirSync(join(s.state, "backup"));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(s.state, "backup", backups[0], "main.js"), "utf8"), "invalid JavaScript !!!\n");
  assert.match(readFileSync(join(s.state, ".prev", ".pack"), "utf8"), /^version=9\.8\.0$/m);
  assert.doesNotMatch(s.mark(), /adopted=/);
  assert.deepEqual(s.versions(), s.all("9.9.0"));

  // A missing sibling mod, the sidebar's VERSION and the command intact.
  rmSync(join(s.mods, "am-tabs"), { recursive: true });
  const sibling = s.run("--yes");
  assert.equal(sibling.code, 0, sibling.err);
  assert.match(sibling.out, /missing: mods\/am-tabs/);
  assert.match(sibling.out, /repaired mods\/am-tabs: it was missing; installed 9\.9\.0/);
  assert.deepEqual(s.versions(), s.all("9.9.0"));

  // A pack mod the mod manager switched off (moved to mods-disabled/) stays off.
  const off = join(s.appHome, "mods-disabled", "am-markdown");
  mkdirSync(dirname(off), { recursive: true });
  execFileSync("mv", [join(s.mods, "am-markdown"), off]);
  const checksOff = s.checks().length;
  const clean = s.run("--yes");
  assert.equal(clean.code, 0, clean.err);
  assert.equal(existsSync(join(s.mods, "am-markdown")), false, "a switched-off mod is not turned back on");
  assert.equal(existsSync(join(off, "main.js")), true);
  const ran = s.checks().slice(checksOff);
  assert.equal(ran.length, ON_MODS.length - 1, "every pack mod but the switched-off ones (and those that ship off) is checked");
  assert.equal(ran.some((c) => c.endsWith("/am-markdown")), false);
  assert.match(clean.out, /Automagik Herdr 9\.9\.0 is already up to date .*every file matches the release/);
  assert.doesNotMatch(clean.out, /repaired|Done/);
  assert.deepEqual(sums(), before, "Sheepdog, Pocket-Link and the personal layout are untouched");
  assert.equal(s.checks().some((c) => /sheepdog|pocket-link/i.test(c)), false);
});

test("a same-version rerun never installs a pack-named folder the record doesn't list, and restores a lost exec bit", (t) => {
  const s = scratch(t);
  // The person's own am-markdown, there before the install: left alone, so not in the record.
  mkdirSync(join(s.mods, "am-markdown"), { recursive: true });
  writeFileSync(join(s.mods, "am-markdown", "main.js"), "// mine\n");
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  assert.doesNotMatch(s.mark(), /am-markdown/);
  // Switched off (mods-disabled/), or removed: neither brings the pack's am-markdown in.
  const off = join(s.appHome, "mods-disabled", "am-markdown");
  mkdirSync(dirname(off), { recursive: true });
  execFileSync("mv", [join(s.mods, "am-markdown"), off]);
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /already up to date/);
  assert.equal(existsSync(join(s.mods, "am-markdown")), false);
  rmSync(off, { recursive: true });
  assert.equal(s.run("--yes").code, 0);
  assert.equal(existsSync(join(s.mods, "am-markdown")), false);
  // A shipped executable that lost its exec bit differs from the release.
  const cmd = join(s.pack, "bin", "automagik-herdr.mjs");
  chmodSync(cmd, 0o644);
  const bit = s.run("--yes");
  assert.equal(bit.code, 0, bit.err);
  assert.match(bit.out, /differs from the release: mods\/am-sidebar \(bin\/automagik-herdr\.mjs\)/);
  assert.notEqual(lstatSync(cmd).mode & 0o111, 0);
});

test("a same-version rerun whose herdr-app check fails exits 1 with the check's output, never up to date", (t) => {
  const s = scratch(t);
  s.addHerdrApp();
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  writeFileSync(join(s.bin, "herdr-app"), `${readFileSync(join(s.bin, "herdr-app"), "utf8")}case "$2" in */am-markdown) printf 'main.js:3: SyntaxError\\n  at load\\n' >&2; exit 1 ;; esac\n`);
  const r = s.run("--yes");
  assert.equal(r.code, 1);
  assert.match(r.out, /check FAILED: am-markdown: main\.js:3: SyntaxError\n {8}at load\n/);
  assert.match(r.err, /herdr-app check failed for a mod/);
  assert.doesNotMatch(r.out, /up to date|Done/);
});

test("a clean same-version rerun checks every file and every mod, swaps nothing and says up to date", (t) => {
  const s = scratch(t);
  s.addHerdrApp();
  s.show("automagik");
  s.publish("9.9.0");
  s.publishMeter();
  assert.equal(s.run("--yes").code, 0);
  const ino = lstatSync(s.pack).ino, mark = s.mark(), checksBefore = s.checks().length, meterBefore = s.meterCalls().length;
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Checksum: ok\.\n(  check passed: .*\n)+(.*\n)*Automagik Herdr 9\.9\.0 is already up to date .*: every file matches the release and every mod passed herdr-app check\./);
  assert.equal(s.checks().length - checksBefore, ON_MODS.length);
  assert.match(r.out, /usagemeter 0\.3\.0: already installed/);
  assert.equal(s.meterCalls().length, meterBefore, "usagemeter current: nothing downloaded");
  assert.doesNotMatch(r.out, /Downloading|Linked|repaired|missing|differs|Done/);
  assert.equal(lstatSync(s.pack).ino, ino);
  assert.equal(s.mark(), mark);
  assert.equal(existsSync(join(s.state, "backup")), false);
  assert.equal(existsSync(join(s.state, ".prev")), false);
  // usagemeter is optional: its download failing is a warning, and the verified pack is still up to date.
  rmSync(join(s.home, ".local", "bin", "usagemeter"));
  rmSync(join(s.root, "release", "usagemeter"), { recursive: true });
  const noMeter = s.run("--yes");
  assert.equal(noMeter.code, 0, noMeter.err);
  assert.match(noMeter.out, /Warning: usagemeter was not installed/);
  assert.match(noMeter.out, /Automagik Herdr 9\.9\.0 is already up to date/);
  // The command's link gone, the pack intact: linked again, and that is not "up to date".
  rmSync(s.link);
  const relinked = s.run("--yes");
  assert.equal(relinked.code, 0, relinked.err);
  assert.match(relinked.out, /Linked .*automagik-herdr\.\n(.*\n)*Done: Automagik Herdr 9\.9\.0\./);
  assert.doesNotMatch(relinked.out, /up to date/);
  assert.equal(readlinkSync(s.link), cliTarget(s));
  assert.equal(lstatSync(s.pack).ino, ino);
});

const HINT = /the sidebar appears after this:\n  herdr-app do layout\.switch '\{"name":"automagik"\}'\n$/;

test("the automagik layout: added when absent, switched to only with a yes; uninstall removes it only unchanged", (t) => {
  const s = scratch(t);
  s.addHerdrApp();
  s.show("main");
  s.publish("9.9.0");
  const layout = join(s.appHome, "layouts", "automagik.json");
  // No terminal, no --yes: added, not switched; the command is printed.
  const r = s.run();
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(layout, "utf8"), readFileSync(LAYOUT_SRC, "utf8"));
  assert.match(r.out, HINT);
  assert.match(s.mark(), /^layout=added$/m);
  assert.deepEqual(s.herdrCalls(), []);
  assert.equal(s.run("--uninstall").code, 0);
  assert.equal(existsSync(layout), false, "unchanged: removed");
  // --yes: switched, no command printed.
  const yes = s.run("--yes");
  assert.equal(yes.code, 0, yes.err);
  assert.deepEqual(s.herdrCalls(), ['do layout.switch {"name":"automagik"}']);
  assert.doesNotMatch(yes.out, /the sidebar appears after this/);
  // Edited by the person: kept on uninstall, never overwritten, never switched to by itself.
  writeFileSync(layout, "{\"mine\":true}\n");
  assert.equal(s.run("--uninstall").code, 0);
  assert.equal(readFileSync(layout, "utf8"), "{\"mine\":true}\n");
  const again = s.run("--yes");
  assert.equal(again.code, 0, again.err);
  assert.equal(readFileSync(layout, "utf8"), "{\"mine\":true}\n");
  assert.equal(s.herdrCalls().length, 1);
  assert.match(again.out, HINT);
});

test("the switch is offered again while Herdr shows another layout: a --yes re-run switches; on automagik, nothing", (t) => {
  const s = scratch(t);
  s.addHerdrApp();
  s.show("main");
  s.publish("9.9.0");
  assert.equal(s.run().code, 0);
  assert.deepEqual(s.herdrCalls(), []);
  const rerun = s.run("--yes");
  assert.equal(rerun.code, 0, rerun.err);
  assert.match(rerun.out, /already up to date/);
  assert.deepEqual(s.herdrCalls(), ['do layout.switch {"name":"automagik"}']);
  s.show("automagik");
  const quiet = s.run("--yes");
  assert.equal(quiet.code, 0, quiet.err);
  assert.equal(s.herdrCalls().length, 1, "already shown: not switched again");
  assert.doesNotMatch(quiet.out, /layout\.switch|sidebar appears/);
});

test("a layout already showing the pack (the owner's main-agents): --yes switches nothing, prints nothing", (t) => {
  const s = scratch(t);
  s.addHerdrApp();
  s.show("main-agents");
  const own = join(s.appHome, "layouts", "main-agents.json");
  mkdirSync(dirname(own), { recursive: true });
  writeFileSync(own, JSON.stringify({ id: "root", children: [{ id: "spaces", content: { mod: "am-sidebar" } }] }, null, 2));
  s.publish("9.9.0");
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(s.herdrCalls(), []);
  assert.doesNotMatch(r.out, /layout\.switch|sidebar appears/);
});

// ---- #387: a kept layout still placing Herdr's workspace-status gets am-status in that block ----

const SWAPPED = /swapped Herdr's workspace-status for am-status in /;
/** The owner's kept layouts: automagik.json (4-space, the status block still Herdr's) and a compact main-agents. */
const keptLayouts = (s) => {
  const dir = join(s.appHome, "layouts");
  mkdirSync(dir, { recursive: true });
  const automagik = `${JSON.stringify(JSON.parse(readFileSync(LAYOUT_SRC, "utf8")), null, 4)}\n`.replace('"mod": "am-status"', '"mod": "workspace-status"');
  const agents = JSON.stringify({ id: "root", type: "row", children: [
    { id: "spaces", type: "block", content: { mod: "am-sidebar" } }, { id: "main", type: "block", content: { mod: "terminal" } },
    { id: "status", type: "block", size: { px: 28 }, content: { mod: "workspace-status" } }] });
  // Plain Herdr's own layout: it doesn't show the pack, so it stays Herdr's.
  const plain = '{ "id": "root", "children": [{ "id": "status", "content": { "mod": "workspace-status" } }] }\n';
  writeFileSync(join(dir, "automagik.json"), automagik);
  writeFileSync(join(dir, "main-agents.json"), agents);
  writeFileSync(join(dir, "main.json"), plain);
  return {
    read: (name) => readFileSync(join(dir, `${name}.json`), "utf8"),
    automagik: automagik.replace('"mod": "workspace-status"', '"mod": "am-status"'),
    agents: agents.replace('"mod":"workspace-status"', '"mod":"am-status"'),
    plain,
  };
};

test("#387: a kept layout placing workspace-status gets am-status in that block, said in the output; the rest stays byte for byte", (t) => {
  const s = scratch(t);
  const k = keptLayouts(s);
  s.publish("9.9.0");
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.match(s.mark(), /^layout=kept$/m);
  assert.equal(k.read("automagik"), k.automagik, "only the status block changed");
  assert.equal(k.read("main-agents"), k.agents, "only the status block changed, the compact form kept");
  assert.equal(k.read("main"), k.plain, "a layout that doesn't show the pack is left alone");
  assert.match(r.out, new RegExp(`${SWAPPED.source}\\S*/layouts/automagik\\.json`));
  assert.match(r.out, new RegExp(`${SWAPPED.source}\\S*/layouts/main-agents\\.json: .*; nothing else in the file changed`));
  assert.doesNotMatch(r.out, new RegExp(`${SWAPPED.source}\\S*/layouts/main\\.json`));
  // The same release again (install.sh's repair run): nothing left to swap, nothing said.
  const again = s.run("--yes");
  assert.equal(again.code, 0, again.err);
  assert.equal(k.read("automagik"), k.automagik);
  assert.equal(k.read("main-agents"), k.agents);
  assert.equal(k.read("main"), k.plain);
  assert.doesNotMatch(again.out, SWAPPED);
});

test("#387: rerunning the installed release swaps the block in a layout edited since the install", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  const k = keptLayouts(s);
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Checking the installed Automagik Herdr 9\.9\.0/);
  assert.equal(k.read("automagik"), k.automagik);
  assert.equal(k.read("main-agents"), k.agents);
  assert.equal(k.read("main"), k.plain);
  assert.match(r.out, new RegExp(`${SWAPPED.source}\\S*/layouts/main-agents\\.json`));
});

test("#387: a layout already placing am-status, or placing neither, is left byte for byte, with no swap said", (t) => {
  const s = scratch(t);
  const dir = join(s.appHome, "layouts");
  mkdirSync(dir, { recursive: true });
  const automagik = `${JSON.stringify(JSON.parse(readFileSync(LAYOUT_SRC, "utf8")), null, 4)}\n`;
  const sidebar = { id: "spaces", type: "block", content: { mod: "am-sidebar" } };
  const herdr = { id: "status", type: "block", content: { mod: "workspace-status" } };
  const both = `${JSON.stringify({ id: "root", children: [sidebar, herdr, { id: "am", type: "block", content: { mod: "am-status" } }] })}\n`;
  const neither = `${JSON.stringify({ id: "root", children: [sidebar] }, null, 2)}\n`;
  writeFileSync(join(dir, "automagik.json"), automagik);
  writeFileSync(join(dir, "both.json"), both);
  writeFileSync(join(dir, "neither.json"), neither);
  s.publish("9.9.0");
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.match(s.mark(), /^layout=kept$/m);
  assert.equal(readFileSync(join(dir, "automagik.json"), "utf8"), automagik);
  assert.equal(readFileSync(join(dir, "both.json"), "utf8"), both, "am-status is already placed: never swapped");
  assert.equal(readFileSync(join(dir, "neither.json"), "utf8"), neither, "no block is added");
  assert.doesNotMatch(r.out, SWAPPED);
  // The layout with neither still gets the note naming what it lacks and where to copy it from.
  assert.match(r.out, /Your layout neither \(.*\) shows the Automagik sidebar, but not the rest of the pack: .*the status bar with the pack version \(am-status\)/);
});

test("#387: a kept layout placing workspace-status twice is left byte for byte, and the install says why, every run", (t) => {
  const s = scratch(t);
  const dir = join(s.appHome, "layouts");
  mkdirSync(dir, { recursive: true });
  const twice = (id) => `${JSON.stringify({ id, children: [{ id: "spaces", content: { mod: "am-sidebar" } },
    { id: "a", content: { mod: "workspace-status" } }, { id: "b", content: { mod: "workspace-status" } }] }, null, 2)}\n`;
  writeFileSync(join(dir, "automagik.json"), twice("mine"));
  writeFileSync(join(dir, "main-agents.json"), twice("root"));
  s.publish("9.9.0");
  for (const run of [s.run("--yes"), s.run("--yes")]) {
    assert.equal(run.code, 0, run.err);
    assert.equal(readFileSync(join(dir, "automagik.json"), "utf8"), twice("mine"));
    assert.equal(readFileSync(join(dir, "main-agents.json"), "utf8"), twice("root"));
    assert.doesNotMatch(run.out, SWAPPED);
    for (const name of ["automagik", "main-agents"]) {
      assert.match(run.out, new RegExp(`left: \\S*/layouts/${name}\\.json \\(it places Herdr's workspace-status 2 times, so am-status \\(the status bar`));
    }
  }
  assert.match(s.mark(), /^layout=kept$/m);
});

test("#387 audit: every layout the pack ships places am-status, and none places Herdr's workspace-status", () => {
  const dir = dirname(LAYOUT_SRC);
  const names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  assert.deepEqual(names, ["automagik.json"], "the pack ships one layout; a new one joins this audit");
  for (const name of names) {
    const mods = [];
    const walk = (n) => { if (n?.content?.mod) mods.push(n.content.mod); (n?.children ?? []).forEach(walk); };
    walk(JSON.parse(readFileSync(join(dir, name), "utf8")));
    assert.equal(mods.filter((m) => m === "am-status").length, 1, `${name} places am-status once`);
    assert.equal(mods.includes("workspace-status"), false, `${name} places no workspace-status`);
  }
});

test("no herdr-app, or no status from it: the command is printed and nothing else is tried", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  const none = s.run("--yes");
  assert.equal(none.code, 0, none.err);
  assert.match(none.out, HINT);
  s.addHerdrApp(); // no layout set: `status` fails
  const nostatus = s.run("--yes");
  assert.equal(nostatus.code, 0, nostatus.err);
  assert.match(nostatus.out, HINT);
  assert.deepEqual(s.herdrCalls(), []);
});

test("a layout the person copied by hand is never removed, even unchanged", (t) => {
  const s = scratch(t);
  const layout = join(s.appHome, "layouts", "automagik.json");
  mkdirSync(dirname(layout), { recursive: true });
  cpSync(LAYOUT_SRC, layout);
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  assert.match(s.mark(), /^layout=kept$/m);
  assert.equal(s.run("--uninstall").code, 0);
  assert.equal(existsSync(layout), true);
});

test("--uninstall leaves a pack folder that became a symlink in place, and moves the rest", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  const real = join(s.root, "elsewhere");
  cpSync(s.pack, real, { recursive: true });
  rmSync(s.pack, { recursive: true });
  symlinkSync(real, s.pack);
  const r = s.run("--uninstall");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Left .*am-sidebar: it is a link/);
  assert.equal(lstatSync(s.pack).isSymbolicLink(), true);
  assert.deepEqual(readdirSync(s.mods), ["am-sidebar"]);
});

test("AUTOMAGIK_HERDR_RELEASE_URL: a file:// folder or this repository on GitHub only, always said", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  const ok = s.run("--yes");
  assert.match(ok.out, /^Releases from file:\/\/.* \(AUTOMAGIK_HERDR_RELEASE_URL\)\.$/m);
  s.extraEnv.AUTOMAGIK_HERDR_RELEASE_URL = "https://evil.example/releases";
  const bad = s.run("--yes");
  assert.equal(bad.code, 1);
  assert.match(bad.err, /must be a file:\/\/ folder or https:\/\/github\.com\/automagik-dev\/automagik\//);
});

test("AUTOMAGIK_HERDR_RELEASE_URL with '..' or '%' is refused before anything is fetched", (t) => {
  const s = scratch(t);
  const curlLog = join(s.root, "curl.log");
  writeFileSync(curlLog, "");
  exe(join(s.bin, "curl"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${curlLog}"\nexit 1\n`);
  for (const url of [
    "https://github.com/automagik-dev/automagik/../../evil/repo/releases",
    "https://github.com/automagik-dev/automagik/%2e%2e/%2e%2e/evil/repo/releases",
  ]) {
    s.extraEnv.AUTOMAGIK_HERDR_RELEASE_URL = url;
    const r = s.run("--yes");
    assert.equal(r.code, 1, url);
    assert.match(r.err, /must not contain '\.\.' or '%'/);
  }
  assert.equal(readFileSync(curlLog, "utf8"), "");
  assert.equal(existsSync(s.pack), false);
});

test("no downgrade: a re-posted older signed pointer is refused by version or sequence; --version still installs it", (t) => {
  const s = scratch(t);
  s.publishMeter();
  s.publish("9.10.0");
  const first = s.run("--yes");
  assert.equal(first.code, 0, first.err);
  assert.match(s.mark(), /^sequence=100000$/m, "the marker records the pointer's sequence");
  // Someone who can write release assets, without the key, re-posts the older 9.9.0 pointer and signature.
  s.publish("9.9.0");
  const before = treeSum(s.mods);
  const r = s.run("--yes");
  assert.equal(r.code, 1);
  assert.match(r.err, /it names 9\.9\.0 \(sequence 90000\), older than the installed 9\.10\.0: refusing to downgrade; nothing was installed\. To install 9\.9\.0 on purpose: --version 9\.9\.0/);
  assert.equal(treeSum(s.mods), before, "nothing changed");
  assert.deepEqual(s.versions(), s.all("9.10.0"));
  // The same version, signed with a lower sequence: the sequence alone refuses it.
  s.publish("9.10.0", { pointer: { sequence: 5 } });
  const seq = s.run("--yes");
  assert.equal(seq.code, 1);
  assert.match(seq.err, /it names 9\.10\.0 \(sequence 5\), older than the installed sequence 100000: refusing to downgrade/);
  // The current pointer again: a re-run checks the install, as before.
  s.publish("9.10.0");
  const again = s.run("--yes");
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /already up to date/);
  // On purpose: --version installs the older release (its .sha256), and records no sequence.
  const down = s.run("--yes", "--version", "9.9.0");
  assert.equal(down.code, 0, down.err);
  assert.deepEqual(s.versions(), s.all("9.9.0"));
  assert.doesNotMatch(s.mark(), /^sequence=/m);
  // The newest pointer takes it forward again.
  const up = s.run("--yes");
  assert.equal(up.code, 0, up.err);
  assert.deepEqual(s.versions(), s.all("9.10.0"));
  assert.match(s.mark(), /^sequence=100000$/m);
});

test("every download keeps the path as written (curl --path-as-is), including Herdr's installer", () => {
  const calls = readFileSync(INSTALL, "utf8").split("\n").filter((l) => /^\s+curl /.test(l));
  assert.equal(calls.length, 7);
  for (const l of calls) assert.match(l, /--path-as-is/);
  // Herdr's installer, an https URL, is fetched over https only, never a redirect to another scheme.
  assert.match(calls.find((line) => line.includes('"$HERDR_INSTALLER"')) ?? "", /--proto '=https'/);
  for (const l of calls.filter((line) => !line.includes('"$HERDR_INSTALLER"'))) {
    assert.match(l, /^\s+curl -fsSL --path-as-is "(\$u?base\/|\$POINTER(\.sig)?")/);
  }
  assert.doesNotMatch(readFileSync(INSTALL, "utf8"), /api\.github\.com|releases\?per_page|MAX_PAGES/, "no search through the releases");
});

test("Herdr comes only from herdrdev (releases.herdr.dev): no Herdr UI, cask, sudo or system package manager", () => {
  const script = readFileSync(INSTALL, "utf8"), readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(script, /^ {2}HERDR_INSTALLER=https:\/\/releases\.herdr\.dev\/app\/install\.sh$/m);
  assert.match(script, /^ {2}HERDR_ID=dev\.herdr\.app$/m);
  // The script runs no cask, sudo or package manager (its comments may say "no sudo").
  assert.doesNotMatch(script, /herdrui\.dev|--cask|apt-get|\bdnf\b|pacman|^\s*\$?sudo\b/m);
  for (const [name, text] of [["README.md", readme], ["agent-install.md", readFileSync(join(ROOT, "docs", "agent-install.md"), "utf8")]]) {
    assert.doesNotMatch(text, /herdrui\.dev|--cask|\bsudo\b|apt-get|\bAPT\b|\bdnf\b|\bDNF\b|pacman|Herdr UI/, name);
  }
});

test("the release the signed pointer names is installed, not a newer one it does not name", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  s.publishMeter();
  s.publish("9.10.0", { latest: false });
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(s.versions(), s.all("9.9.0"));
  // --version takes a version, nothing else reaches a URL.
  const bad = s.run("--yes", "--version", "9.9.0/../../x");
  assert.equal(bad.code, 1);
  assert.match(bad.err, /--version takes a version like 3\.58\.0/);
});

test("no override (the real curl | bash path): no unbound variable, no override line, up to the OS check", (t) => {
  const s = scratch(t, { os: "FreeBSD" });
  s.extraEnv.AUTOMAGIK_HERDR_RELEASE_URL = "";
  const r = s.run("--yes");
  assert.equal(r.code, 1, r.err);
  assert.doesNotMatch(r.err, /unbound|parameter not set/i);
  assert.doesNotMatch(r.out, /AUTOMAGIK_HERDR_RELEASE_URL/);
  assert.match(r.err + r.out, /macOS/);
});

test("a download cut short runs nothing (the body is one function called on the last line)", (t) => {
  const s = scratch(t, { herdr: false });
  s.publish("9.9.0");
  const text = readFileSync(INSTALL, "utf8");
  for (const cut of [0.3, 0.6, 0.95]) {
    const part = text.slice(0, Math.floor(text.length * cut));
    const r = spawnSync("sh", ["-s", "--", "--yes"], { cwd: s.root, input: part, encoding: "utf8",
      env: { HOME: s.home, PATH: `${join(s.root, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin` } });
    assert.equal(r.stdout, "", `cut at ${cut}`);
  }
  assert.deepEqual(s.brewCalls(), []);
  assert.equal(existsSync(s.pack), false);
});

test("every pack mod docks nowhere by itself; the shipped layout names only pack mods and stock Herdr mods", () => {
  // place "left" plus a layout that also names am-sidebar made Herdr show two sidebars.
  for (const m of PACK_MODS) assert.equal(JSON.parse(readFileSync(join(ROOT, "mods", m, "mod.json"), "utf8")).place, "none", m);
  const stock = new Set(["changes", "files", "pane", "tabs", "workspace-chrome", "workspace-status", "spaces", "agents"]);
  const named = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      if (typeof node.mod === "string") named.push(node.mod);
      Object.values(node).forEach(walk);
    }
  };
  walk(JSON.parse(readFileSync(LAYOUT_SRC, "utf8")));
  assert.ok(named.includes("am-sidebar"));
  assert.deepEqual(named.filter((m) => !PACK_MODS.includes(m) && !stock.has(m)), []);
  // One layout (D8), in its own entry beside herdr/: none in herdr/ (herdr.dev would skip the repo) or the sidebar.
  // herdr.dev lists a layout only from its entry's layouts/ (a .json at the entry's root is ignored).
  assert.deepEqual(readdirSync(join(ROOT, "..", "herdr-layout", "layouts")), ["automagik.json"]);
  assert.ok(!readdirSync(join(ROOT, "..", "herdr-layout")).includes("automagik.json"));
  assert.equal(existsSync(join(ROOT, "layouts")), false, "no layouts/ in the herdr/ entry");
  assert.equal(existsSync(join(PACK_SRC, "layouts")), false, "one layout: herdr-layout's (D8)");
  assert.deepEqual(readdirSync(join(ROOT, "mods")).filter((m) => m !== "pocket-link").sort(), [...PACK_MODS].sort());
});

test("rollback, or --uninstall, then a reinstall: a mod's .state comes back from the kept set, off if it was off", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  const off = join(s.appHome, "mods-disabled");
  for (const m of OFF_BY_DEFAULT) assert.ok(existsSync(join(off, m, "mod.json")), `${m} ships off`);
  for (const m of [...OFF_BY_DEFAULT, "am-tabs"]) {
    mkdirSync(join(s.where(m), ".state"));
    writeFileSync(join(s.where(m), ".state", "cred"), `${m} secret\n`);
  }
  assert.equal(s.run("--uninstall").code, 0);
  assert.equal(existsSync(join(s.mods, "am-tabs")), false);
  for (const m of OFF_BY_DEFAULT) assert.equal(existsSync(join(off, m)), false, `${m}: the switched-off copy is kept too, not stranded`);
  assert.match(readFileSync(join(s.state, ".prev", ".pack"), "utf8"), new RegExp(`^off=${[...OFF_BY_DEFAULT].sort().join(",")}$`, "m"));
  const again = s.run("--yes");
  assert.equal(again.code, 0, again.err);
  for (const m of [...OFF_BY_DEFAULT, "am-tabs"]) assert.equal(readFileSync(join(s.where(m), ".state", "cred"), "utf8"), `${m} secret\n`, m);
  for (const m of OFF_BY_DEFAULT) {
    assert.equal(existsSync(join(s.mods, m)), false, `${m} comes back off`);
    assert.match(again.out, new RegExp(`mods-disabled/${m}: it (stays off|was off when it was kept, so it stays off)`));
    assert.match(again.out, new RegExp(`${m} \\(off; turn it on in the Mods panel\\)`));
    assert.doesNotMatch(again.out, new RegExp(`${m}: it ships off`), "not a first install");
    assert.ok(existsSync(join(off, m, "main.js")));
  }
});

test("--uninstall never glob-expands the record, and moves only backup/<name> paths it adopted", (t) => {
  const s = scratch(t);
  mkdirSync(join(s.state, "backup", "keep"), { recursive: true });
  writeFileSync(join(s.state, "backup", "keep", "main.js"), "// mine\n");
  mkdirSync(join(s.mods, "pocket-link"), { recursive: true });
  writeFileSync(join(s.mods, "pocket-link", "main.js"), "// pocket\n");
  writeFileSync(join(s.root, "am-tabs"), "a file in the cwd a glob would find\n");
  mkdirSync(join(s.mods, "am-tabs"));
  writeFileSync(join(s.mods, "am-tabs", "main.js"), "// not the record's\n");
  const stateBefore = treeSum(s.state);
  writeFileSync(join(s.state, "installed-by-install.sh"),
    "version=9.9.0\nmods=*,am-t*\nbefore=none\nadopted=am-quota:,am-tabs:.,am-markdown:backup/,am-mods:backup/../..,am-new-menu:/etc,am-automations:backup/*,am-footer:backup/.hidden\n");
  const r = s.run("--uninstall");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readdirSync(s.mods), ["am-tabs", "pocket-link"], "nothing put back; `am-t*` matched nothing");
  assert.equal(readFileSync(join(s.mods, "am-tabs", "main.js"), "utf8"), "// not the record's\n");
  assert.equal(readFileSync(join(s.mods, "pocket-link", "main.js"), "utf8"), "// pocket\n");
  rmSync(join(s.state, "installed-by-install.sh"), { force: true });
  assert.equal(treeSum(s.state), stateBefore, "the state folder is whole");
  assert.deepEqual(parseMarker("mods=a\nadopted=a:,b:.,c:backup/,d:backup/../x,e:backup/ok,pocket-link:backup/p\n").adopted, [{ mod: "e", path: "backup/ok" }]);
});

// ---- usagemeter (Group 6c) ----

const meterBin = (s) => join(s.home, ".local", "bin", "usagemeter");
const meterSays = (s) => spawnSync(meterBin(s), ["--version"], { encoding: "utf8" }).stdout.trim();
/** A usagemeter the person (or Pocket Link) put there: answers `usagemeter <version>`. */
const plantMeter = (s, version) => {
  mkdirSync(dirname(meterBin(s)), { recursive: true });
  exe(meterBin(s), `#!/bin/sh\n[ "$1" = --version ] && echo "usagemeter ${version}"\nexit 0\n`);
};
const leftovers = (s) => readdirSync(dirname(meterBin(s))).filter((n) => n.startsWith(".usagemeter"));

test("usagemeter: install.sh pins release.js's version and knows its four builds", () => {
  assert.equal(/^\s+METER_VERSION=(\S+)$/m.exec(readFileSync(INSTALL, "utf8"))?.[1], USAGEMETER.version);
  assert.equal(USAGEMETER.version, "0.3.0");
  assert.deepEqual(Object.values(USAGEMETER.assets).sort(),
    ["usagemeter-darwin-arm64", "usagemeter-darwin-x86_64", "usagemeter-linux-aarch64", "usagemeter-linux-x86_64"]);
  for (const name of Object.values(USAGEMETER.assets)) assert.ok(readFileSync(INSTALL, "utf8").includes(`asset=${name} ;;`), name);
  // The same sha256 per asset as release.js: the pin is the build, not only the version.
  const pins = Object.fromEntries([...readFileSync(INSTALL, "utf8").matchAll(/^ {4}(usagemeter-[a-z0-9_-]+)\) echo ([0-9a-f]{64}) ;;$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(pins, USAGEMETER.sha256);
  assert.deepEqual(Object.keys(USAGEMETER.sha256).sort(), Object.values(USAGEMETER.assets).sort());
});

test("usagemeter: a download that matches SHA256SUMS but not the pinned sha256 installs nothing", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  s.publishMeter({ pin: "a".repeat(64) });
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Warning: usagemeter was not installed: usagemeter-darwin-\S+ is not the build this installer pins \(sha256 [0-9a-f]{64}, pinned a{64}\): nothing was installed/);
  assert.equal(existsSync(meterBin(s)), false);
  assert.deepEqual(leftovers(s), []);
  assert.equal(parseMarker(s.mark()).usagemeter, null);
  // The pin hook is a file:// test release's only: a GitHub release always uses the embedded pin.
  assert.match(readFileSync(INSTALL, "utf8"), /meter_pin\(\) \{\n  case \$METER_RELEASES in\n    file:\/\/\*\)/);
});

test("usagemeter: a scratch install puts the hash-checked binary in ~/.local/bin; a rerun downloads nothing", (t) => {
  for (const arch of ["arm64", "x86_64"]) {
    const s = scratch(t, { arch });
    s.publish("9.9.0");
    s.publishMeter();
    const r = s.run("--yes");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Installed usagemeter 0\.3\.0 \(.*\/\.local\/bin\/usagemeter, checksum ok\)/);
    assert.equal(meterSays(s), "usagemeter 0.3.0");
    assert.equal(lstatSync(meterBin(s)).mode & 0o777, 0o755);
    assert.equal(sha(meterBin(s)), sha(join(s.root, "release", "usagemeter", "download", "v0.3.0", `usagemeter-darwin-${arch}`)));
    assert.deepEqual(leftovers(s), []);
    assert.equal(parseMarker(s.mark()).usagemeter, "0.3.0");
    assert.deepEqual(s.meterCalls().map((u) => u.replace(/.*\/download\//, "")), ["v0.3.0/SHA256SUMS", `v0.3.0/usagemeter-darwin-${arch}`]);
    // No LaunchAgent and no daemon: the sidebar runs `usagemeter sync`, nothing else does.
    assert.equal(existsSync(join(s.home, "Library", "LaunchAgents")), false);
    const before = s.meterCalls().length;
    const again = s.run();
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /usagemeter 0\.3\.0: already installed/);
    assert.equal(s.meterCalls().length, before);
    // A newer pack (update.mjs rewrites the record) keeps the usagemeter line, and still no download.
    s.publish("9.9.1");
    const update = s.run();
    assert.equal(update.code, 0, update.err);
    assert.equal(parseMarker(s.mark()).usagemeter, "0.3.0");
    assert.equal(s.meterCalls().length, before);
  }
  assert.doesNotMatch(readFileSync(INSTALL, "utf8"), /LaunchAgent|launchctl/);
});

test("usagemeter: a bad hash installs nothing; the pack install still exits 0 with a warning", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  s.publishMeter({ sums: "0".repeat(64) });
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(s.versions(), s.all("9.9.0"));
  assert.match(r.out, /Warning: usagemeter was not installed: usagemeter-darwin-arm64 does not match SHA256SUMS/);
  assert.equal(existsSync(meterBin(s)), false);
  assert.deepEqual(leftovers(s), []);
  assert.equal(parseMarker(s.mark()).usagemeter, null);
});

test("usagemeter: offline, or no build for this machine: a warning, and the pack is installed", (t) => {
  const offline = scratch(t);
  offline.publish("9.9.0");
  const r = offline.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Warning: usagemeter was not installed: could not download file:.*\/usagemeter\/download\/v0\.3\.0\/SHA256SUMS/);
  assert.equal(existsSync(meterBin(offline)), false);
  assert.deepEqual(offline.versions(), offline.all("9.9.0"));
  // Offline at first, then online: the rerun (pack already current) installs it.
  offline.publishMeter();
  const later = offline.run();
  assert.equal(later.code, 0, later.err);
  assert.equal(meterSays(offline), "usagemeter 0.3.0");
  assert.equal(parseMarker(offline.mark()).usagemeter, "0.3.0");
  const odd = scratch(t, { arch: "ppc" });
  odd.publish("9.9.0");
  odd.publishMeter();
  const o = odd.run("--yes");
  assert.equal(o.code, 0, o.err);
  assert.match(o.out, /Warning: usagemeter was not installed: no usagemeter build for Darwin ppc/);
  assert.deepEqual(odd.meterCalls(), []);
});

test("usagemeter: --no-usagemeter skips the step, with no download", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  s.publishMeter();
  const r = s.run("--yes", "--no-usagemeter");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /usagemeter: skipped \(--no-usagemeter\)/);
  assert.deepEqual(s.meterCalls(), []);
  assert.equal(existsSync(meterBin(s)), false);
  assert.match(s.run("--help").out, /--no-usagemeter/);
});

test("usagemeter: the v0.2.0 the last pin installed is upgraded to v0.3.0, and recorded as ours", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  s.publishMeter();
  plantMeter(s, "0.2.0");
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Installed usagemeter 0\.3\.0 \(.*checksum ok\)/);
  assert.equal(meterSays(s), "usagemeter 0.3.0");
  assert.equal(parseMarker(s.mark()).usagemeter, "0.3.0");
  assert.deepEqual(leftovers(s), []);
});

test("usagemeter: never a downgrade (0.10.0 is newer than 0.3.0); an older one is replaced; a link or folder stays", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  s.publishMeter();
  plantMeter(s, "0.10.0");
  const kept = sha(meterBin(s));
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /usagemeter 0\.10\.0 is installed .*not older than 0\.3\.0: not replacing it/);
  assert.equal(sha(meterBin(s)), kept);
  assert.deepEqual(s.meterCalls(), []);
  assert.equal(parseMarker(s.mark()).usagemeter, null);
  // An older one is replaced.
  plantMeter(s, "0.1.9");
  const up = s.run();
  assert.equal(up.code, 0, up.err);
  assert.equal(meterSays(s), "usagemeter 0.3.0");
  assert.equal(parseMarker(s.mark()).usagemeter, "0.3.0");
  // A link (a build the person points at) is left, and no longer recorded as the pack's.
  rmSync(meterBin(s));
  symlinkSync("/usr/bin/true", meterBin(s));
  const linked = s.run();
  assert.equal(linked.code, 0, linked.err);
  assert.match(linked.out, /usagemeter: left .*, a link or a folder, as it is/);
  assert.equal(readlinkSync(meterBin(s)), "/usr/bin/true");
  assert.equal(parseMarker(s.mark()).usagemeter, null);
  rmSync(meterBin(s));
  mkdirSync(join(meterBin(s), "inside"), { recursive: true });
  const folder = s.run();
  assert.equal(folder.code, 0, folder.err);
  assert.deepEqual(readdirSync(meterBin(s)), ["inside"]);
});

test("usagemeter: a dev build counts by its X.Y.Z; one with no version is left with a warning", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  s.publishMeter();
  // A pre-release of a newer version, or of the pinned one: kept, no download.
  for (const dev of ["0.4.0-dev", "0.3.0-dev", "0.3.1+abc"]) {
    plantMeter(s, dev);
    const kept = sha(meterBin(s));
    const r = s.run("--yes");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`usagemeter ${dev.replace(/[.+]/g, "\\$&")} is installed .*not replacing it`));
    assert.equal(sha(meterBin(s)), kept, dev);
    assert.deepEqual(s.meterCalls(), [], dev);
    assert.equal(parseMarker(s.mark()).usagemeter, null);
  }
  // No version at all (not a usagemeter answer): left, with exactly one warning.
  exe(meterBin(s), "#!/bin/sh\necho 'something else 1.0'\n");
  const kept = sha(meterBin(s));
  const none = s.run();
  assert.equal(none.code, 0, none.err);
  assert.equal(none.out.split("\n").filter((l) => /^Warning:/.test(l)).length, 1, none.out);
  assert.match(none.out, /Warning: .*\/usagemeter reports no usagemeter version; left it as it is/);
  assert.equal(sha(meterBin(s)), kept);
  assert.deepEqual(s.meterCalls(), []);
  // A pre-release of an older version is older: replaced by the pinned release.
  plantMeter(s, "0.1.0-dev");
  const old = s.run();
  assert.equal(old.code, 0, old.err);
  assert.equal(meterSays(s), "usagemeter 0.3.0");
  assert.equal(parseMarker(s.mark()).usagemeter, "0.3.0");
});

/** A fake hc (test/fake-hc.mjs) on install.sh's PATH: `lin` (Linux x86_64, connected), `off` (not). */
const linkMachines = (s) => {
  const lin = join(s.root, "m-lin"), log = s.extraEnv.HC_FAKE_LOG;
  mkdirSync(lin);
  writeFileSync(s.extraEnv.HC_FAKE_STATE, JSON.stringify({ terminals: [], machines: [
    { name: "lin", state: "connected", uname: "Linux x86_64", home: lin }, { name: "off", state: "disconnected", uname: "Linux aarch64", home: lin }] }));
  return {
    meter: join(lin, ".local", "bin", "usagemeter"),
    execs: () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a[0] === "exec"),
  };
};

test("usagemeter on linked machines: install puts it on the connected one, records it; --uninstall removes it", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  s.publishMeter();
  const m = linkMachines(s);
  const r = s.run("--yes");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /usagemeter 0\.3\.0 on lin: installed \(checksum ok\)\./);
  assert.match(r.out, /Warning: usagemeter on off: skipped, the machine is not connected\./);
  assert.equal(spawnSync(m.meter, ["--version"], { encoding: "utf8" }).stdout.trim(), "usagemeter 0.3.0");
  assert.equal(sha(m.meter), sha(join(s.root, "release", "usagemeter", "download", "v0.3.0", "usagemeter-linux-x86_64")));
  assert.deepEqual(parseMarker(s.mark()).usagemeterOn, { lin: "0.3.0" });
  assert.equal(parseMarker(s.mark()).usagemeterScope, "all");
  // A rerun: already there, nothing downloaded; update.mjs's rewrite of the record keeps the line.
  const again = s.run();
  assert.match(again.out, /usagemeter 0\.3\.0 on lin: already installed\./);
  assert.deepEqual(parseMarker(s.mark()).usagemeterOn, { lin: "0.3.0" });
  const u = s.run("--uninstall");
  assert.equal(u.code, 0, u.err);
  assert.match(u.out, /Removed usagemeter on lin\. Its store is kept\./);
  assert.equal(existsSync(m.meter), false);
});

test("usagemeter on linked machines: --usagemeter-local-only and --no-usagemeter skip them and are recorded", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  s.publishMeter();
  const m = linkMachines(s);
  const local = s.run("--yes", "--usagemeter-local-only");
  assert.equal(local.code, 0, local.err);
  assert.match(local.out, /usagemeter on linked machines: skipped \(--usagemeter-local-only\)\./);
  assert.equal(meterSays(s), "usagemeter 0.3.0");
  assert.equal(parseMarker(s.mark()).usagemeterScope, "local");
  const none = s.run("--no-usagemeter");
  assert.equal(none.code, 0, none.err);
  assert.equal(parseMarker(s.mark()).usagemeterScope, "none");
  assert.deepEqual(m.execs(), []);
  assert.equal(existsSync(m.meter), false);
  // Run again without either: everywhere again, and the line goes.
  assert.equal(s.run().code, 0);
  assert.equal(parseMarker(s.mark()).usagemeterScope, "all");
  assert.deepEqual(parseMarker(s.mark()).usagemeterOn, { lin: "0.3.0" });
  // --uninstall --usagemeter-local-only leaves the linked machines' copy.
  const u = s.run("--uninstall", "--usagemeter-local-only");
  assert.match(u.out, /Left usagemeter on the linked machines \(lin\)\./);
  assert.equal(existsSync(m.meter), true);
  assert.match(s.run("--help").out, /--usagemeter-local-only/);
});

test("usagemeter: --uninstall --no-usagemeter keeps even a pack-installed binary", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  s.publishMeter();
  assert.equal(s.run("--yes").code, 0);
  assert.equal(parseMarker(s.mark()).usagemeter, "0.3.0");
  const kept = sha(meterBin(s));
  const u = s.run("--uninstall", "--no-usagemeter");
  assert.equal(u.code, 0, u.err);
  assert.match(u.out, /Left .*\/usagemeter \(--no-usagemeter\)\./);
  assert.equal(sha(meterBin(s)), kept);
  assert.match(s.run("--help").out, /--uninstall keeps it/);
});

test("usagemeter: --uninstall removes a pack-installed binary and leaves one the person installed", (t) => {
  // Installed by the pack: removed.
  const ours = scratch(t);
  ours.publish("9.9.0");
  ours.publishMeter();
  assert.equal(ours.run("--yes").code, 0);
  const u = ours.run("--uninstall");
  assert.equal(u.code, 0, u.err);
  assert.match(u.out, /Removed .*\/usagemeter \(usagemeter 0\.3\.0\)\. Its store is kept\./);
  assert.equal(existsSync(meterBin(ours)), false);
  // The person's own (the pinned version, there first): never recorded, never removed.
  const theirs = scratch(t);
  theirs.publish("9.9.0");
  theirs.publishMeter();
  plantMeter(theirs, "0.3.0");
  const planted = sha(meterBin(theirs));
  assert.equal(theirs.run("--yes").code, 0);
  assert.equal(parseMarker(theirs.mark()).usagemeter, null);
  assert.equal(theirs.run("--uninstall").code, 0);
  assert.equal(sha(meterBin(theirs)), planted);
  // Ours, then replaced by a newer one (Pocket Link's): left.
  const newer = scratch(t);
  newer.publish("9.9.0");
  newer.publishMeter();
  assert.equal(newer.run("--yes").code, 0);
  plantMeter(newer, "0.4.0");
  const n = newer.run("--uninstall");
  assert.match(n.out, /Left .*usagemeter: it is not the usagemeter 0\.3\.0 this installer put there/);
  assert.equal(meterSays(newer), "usagemeter 0.4.0");
  // Ours, with Pocket Link installed beside the pack: left, and Pocket Link untouched.
  const pocket = scratch(t);
  pocket.publish("9.9.0");
  pocket.publishMeter();
  assert.equal(pocket.run("--yes").code, 0);
  mkdirSync(join(pocket.mods, "pocket-link"));
  writeFileSync(join(pocket.mods, "pocket-link", "main.js"), "// pocket\n");
  const pl = treeSum(join(pocket.mods, "pocket-link"));
  const p = pocket.run("--uninstall");
  assert.match(p.out, /Left .*usagemeter: Pocket Link .* runs it too/);
  assert.equal(meterSays(pocket), "usagemeter 0.3.0");
  assert.equal(treeSum(join(pocket.mods, "pocket-link")), pl);
});

// ---- #420: --uninstall asks the shown layout first, as `am uninstall herdr.pack` does ----

test("--uninstall is refused while the shown layout's blocks name a pack mod; nothing moves", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  s.addHerdrApp();
  s.show("automagik");
  const layout = join(s.appHome, "layouts", "automagik.json");
  const r = s.run("--uninstall");
  assert.equal(r.code, 1);
  assert.match(r.err, /the pack stays: the automagik layout shows am-\S+(, am-\S+)+, and Herdr drops a layout whose mod is gone \(plain Herdr instead\)\. Switch layouts first \(ctrl-shift-l\), then uninstall the pack\./);
  assert.ok(existsSync(join(s.pack, "VERSION")) && existsSync(layout) && existsSync(join(s.state, "installed-by-install.sh")), "the pack, its layout and its record stay");
  // The person's own layout that shows the sidebar: refused too.
  writeFileSync(join(s.appHome, "layouts", "main-agents.json"), JSON.stringify({ id: "root", children: [{ id: "spaces", content: { mod: "am-sidebar" } }] }, null, 2));
  s.show("main-agents");
  const own = s.run("--uninstall");
  assert.equal(own.code, 1);
  assert.match(own.err, /the main-agents layout shows am-sidebar, and Herdr drops/);
  assert.ok(existsSync(join(s.pack, "VERSION")));
  // One that names none of the pack: it goes, as before.
  writeFileSync(join(s.appHome, "layouts", "mine.json"), "{\"id\":\"root\"}\n");
  s.show("mine");
  const gone = s.run("--uninstall");
  assert.equal(gone.code, 0, gone.err);
  assert.equal(existsSync(s.pack), false);
});

test("--uninstall with no layout to read goes on, naming the person's layouts that show a pack mod", (t) => {
  const s = scratch(t);
  s.publish("9.9.0");
  assert.equal(s.run("--yes").code, 0);
  writeFileSync(join(s.appHome, "layouts", "main-agents.json"), JSON.stringify({ id: "root", children: [{ id: "spaces", content: { mod: "am-sidebar" } }] }, null, 2));
  s.addHerdrApp();
  s.show("../elsewhere");
  const r = s.run("--uninstall");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Uninstalling the pack without knowing the layout Herdr shows \(Herdr shows the layout "\.\.\/elsewhere", a name with a path, so no file in .*layouts was read\): your layout main-agents \(.*main-agents\.json\) shows am-sidebar, and Herdr drops/);
  assert.doesNotMatch(r.out, /your layout automagik /, "the pack's own copy, removed with it, is not listed");
  assert.equal(existsSync(s.pack), false);
});
