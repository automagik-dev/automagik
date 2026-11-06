// dsh-TUI as a Herdr agent (#561): the pin and its integrity, the `tui`-only profile, the
// `dsh-tui` shim's long --profile form, the opt-in doctor, uninstall, and the release-age
// exception. A fake `dsh` in a temp PATH and a temp HOME: the real DSH, Herdr and ~/.dsh are
// never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DSH_TUI, PIN, SHIM, SHIM_TEXT, SKIP, desktopFingerprint, doctorDshTui, findDsh, installDshTui, lockIntegrity,
  packageOfEntry, profileState, releaseAgeEntries, scopeReleaseAge, shimIsOurs, uninstallDshTui,
} from "../mods/am-sidebar/dshTui.mjs";

const CLI = new URL("../mods/am-sidebar/bin/automagik-herdr.mjs", import.meta.url).pathname;
const PUBLISHED = "2026-11-06T03:36:00Z";
const exe = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };

/**
 * A scratch home with a fake `dsh`: it records every argv, and on `plugin --profile tui add`
 * writes the profile the way pnpm does (package.json, lockfile, workspace yaml, node_modules).
 * `cfg.add.integrity`, `.pin`, `.installed`, `.workspace` and `.fail` change what it writes.
 */
function scene(t, { dsh = true, config = {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dsh-tui-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home"), bin = join(root, "bin"), log = join(root, "dsh.log");
  mkdirSync(home);
  mkdirSync(bin);
  writeFileSync(log, "");
  // The desktop profile, its settings and DSH's credentials: sentinels that must never change.
  mkdirSync(join(home, ".dsh", "profiles", "desktop"), { recursive: true });
  writeFileSync(join(home, ".dsh", "profiles", "desktop", "package.json"), "{\"name\":\"dsh-profile-desktop\"}\n");
  writeFileSync(join(home, ".dsh", "profiles", "desktop", "cordis.patch.yml"), "[]\n");
  writeFileSync(join(home, ".dsh", ".credentials.yaml"), "keep: me\n");
  const cfgPath = join(root, "dsh.json");
  writeFileSync(cfgPath, JSON.stringify(config));
  const helper = join(root, "fake-dsh.cjs");
  writeFileSync(helper, `const fs = require("fs"), path = require("path");
const args = process.argv.slice(2), cfg = JSON.parse(fs.readFileSync(process.env.DSH_FAKE, "utf8"));
if (args[0] !== "plugin") process.exit(0);
if (args[1] !== "--profile" || args[2] !== "tui") { console.error("wrong call: " + args.join(" ")); process.exit(64); }
const dir = path.join(process.env.DSH_HOME, "profiles", "tui");
if (args[3] === "add") {
  if (cfg.add && cfg.add.fail) { console.error("ERR_PNPM a fake add failure"); process.exit(1); }
  const spec = args[4] || "", version = spec.slice(spec.lastIndexOf("@") + 1);
  const add = cfg.add || {};
  const pkg = path.join(dir, "node_modules", "@deepseek-harness-tui", "dsh-tui");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { "@deepseek-harness-tui/dsh-tui": add.pin || version } }) + "\\n");
  fs.writeFileSync(path.join(dir, "pnpm-workspace.yaml"), add.workspace || "minimumReleaseAgeExclude:\\n  - '@deepseek-harness-tui/dsh-tui@0.19.0'\\n");
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "packages:\\n\\n  '@deepseek-harness-tui/dsh-tui@0.19.0':\\n    resolution: {integrity: " + (add.integrity || "sha512-4TAPhsTqfL+oG1H39Fbj13tfaVVGnwV9N33dV8Acn/YBoZT/YgXwF+ZnbhvRi0l55bNc6X6loKkngxrNL8NX3w==") + "}\\n\\n");
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ version: add.installed || version }) + "\\n");
  process.exit(0);
}
if (args[3] === "remove") {
  if (cfg.remove && cfg.remove.fail) { console.error("ERR_PNPM a fake remove failure"); process.exit(1); }
  fs.writeFileSync(path.join(dir, "package.json"), "{\\"dependencies\\":{}}\\n");
  fs.rmSync(path.join(dir, "node_modules", "@deepseek-harness-tui", "dsh-tui"), { recursive: true, force: true });
  process.exit(0);
}
process.exit(0);
`);
  if (dsh) {
    exe(join(bin, "dsh"), `#!/bin/sh
printf '%s\\n' "$*" >> "$DSH_LOG"
exec "${process.execPath}" "${helper}" "$@"
`);
  }
  const env = {
    HOME: home, PATH: `${bin}:${join(home, ".local", "bin")}:/usr/bin:/bin`,
    DSH_LOG: log, DSH_FAKE: cfgPath, AUTOMAGIK_HERDR_DSH_TUI_PUBLISHED: PUBLISHED,
  };
  const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const runShim = (args, extra = {}) => spawnSync("sh", [join(home, ".local", "bin", SHIM), ...args], { env: { ...env, ...extra }, encoding: "utf8" });
  const cli = (args, extra = {}) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, env: { ...env, ...extra }, encoding: "utf8" });
  return { root, home, bin, env, calls, runShim, cli, dsh: join(bin, "dsh") };
}

test("install pins exactly 0.19.0 with its integrity into the tui profile only", async (t) => {
  const s = scene(t);
  const r = await installDshTui({ env: s.env, publishedAt: PUBLISHED, now: () => Date.parse("2026-11-06T10:00:00Z") });
  assert.equal(r.status, "installed", r.detail);
  const state = profileState(join(s.home, ".dsh"));
  assert.equal(state.pin, DSH_TUI.version);
  assert.equal(state.installed, DSH_TUI.version);
  assert.equal(state.integrity, DSH_TUI.integrity);
  assert.equal(lockIntegrity(readFileSync(join(state.dir, "pnpm-lock.yaml"), "utf8")), DSH_TUI.integrity);
  assert.deepEqual(s.calls(), [`plugin --profile tui add ${PIN} --save-exact`]);
  assert.equal(readFileSync(join(s.home, ".local", "bin", SHIM), "utf8"), SHIM_TEXT);
  assert.ok(statSync(join(s.home, ".local", "bin", SHIM)).mode & 0o111, "the shim is executable");
  assert.deepEqual(JSON.parse(readFileSync(join(s.home, ".dsh-tui", "onboarding.json"), "utf8")), { completed: true, version: 1 });
});

test("a lockfile integrity that is not the pin fails, removes what it added, and writes no shim", async (t) => {
  const s = scene(t, { config: { add: { integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==" } } });
  const r = await installDshTui({ env: s.env, publishedAt: PUBLISHED });
  assert.equal(r.status, "failed");
  assert.match(r.detail, /lockfile records .*not the pinned/);
  assert.equal(existsSync(join(s.home, ".local", "bin", SHIM)), false);
  assert.deepEqual(s.calls(), [`plugin --profile tui add ${PIN} --save-exact`, `plugin --profile tui remove ${DSH_TUI.package}`]);
  assert.deepEqual(JSON.parse(readFileSync(join(s.home, ".dsh", "profiles", "tui", "package.json"), "utf8")).dependencies, {});
});

test("the desktop profile, its settings and DSH's credentials are untouched", async (t) => {
  const s = scene(t);
  const before = desktopFingerprint(join(s.home, ".dsh"));
  const desktop = (name) => readFileSync(join(s.home, ".dsh", "profiles", "desktop", name), "utf8");
  const pkg = desktop("package.json"), patch = desktop("cordis.patch.yml"), creds = readFileSync(join(s.home, ".dsh", ".credentials.yaml"), "utf8");
  const r = await installDshTui({ env: s.env, publishedAt: PUBLISHED });
  assert.equal(r.status, "installed", r.detail);
  assert.deepEqual(desktopFingerprint(join(s.home, ".dsh")), before);
  assert.equal(desktop("package.json"), pkg);
  assert.equal(desktop("cordis.patch.yml"), patch);
  assert.equal(readFileSync(join(s.home, ".dsh", ".credentials.yaml"), "utf8"), creds);
  assert.ok(s.calls().every((line) => line.includes("--profile tui") && !line.includes("desktop")), "every dsh call is the tui profile");
});

test("the shim runs the long --profile tui form and forwards the app's arguments", async (t) => {
  const s = scene(t);
  await installDshTui({ env: s.env, publishedAt: PUBLISHED });
  const shimLog = join(s.root, "shim.log");
  writeFileSync(shimLog, "");
  const r = s.runShim(["--resume", "abc"], { DSH_LOG: shimLog });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(shimLog, "utf8").split("\n").filter(Boolean), ["--profile tui --resume abc"]);
  assert.equal(spawnSync("sh", ["-n", join(s.home, ".local", "bin", SHIM)], { encoding: "utf8" }).status, 0);
  assert.match(readFileSync(join(s.home, ".local", "bin", SHIM), "utf8"), /^exec dsh --profile tui "\$@"$/m);
});

test("doctor states dsh, the tui profile and the shim honestly, before and after install", async (t) => {
  const missing = scene(t, { dsh: false });
  const none = doctorDshTui({ env: missing.env });
  assert.equal(none.code, 2, "no dsh: not applicable");
  assert.equal(none.checks.find((c) => c.check === "dsh").ok, true);
  assert.match(none.checks.find((c) => c.check === "dsh").detail, /not found on PATH/);
  assert.match(none.checks.find((c) => c.check === "dsh-tui-profile").detail, /not installed/);
  assert.match(none.checks.find((c) => c.check === "dsh-tui-shim").detail, /not installed/);

  const s = scene(t);
  const before = doctorDshTui({ env: s.env });
  assert.equal(before.code, 2);
  assert.equal(before.checks.find((c) => c.check === "dsh").detail, s.dsh);
  await installDshTui({ env: s.env, publishedAt: PUBLISHED });
  const after = doctorDshTui({ env: s.env });
  assert.equal(after.code, 0, JSON.stringify(after.checks));
  assert.ok(after.checks.every((c) => c.ok), JSON.stringify(after.checks));
  assert.match(after.checks.find((c) => c.check === "dsh-tui-profile").detail, /integrity ok/);

  rmSync(join(s.home, ".local", "bin", SHIM));
  const half = doctorDshTui({ env: s.env });
  assert.equal(half.code, 1);
  assert.equal(half.checks.find((c) => c.check === "dsh-tui-shim").ok, false);
});

test("uninstall removes the plugin and the shim, and leaves a foreign shim alone", async (t) => {
  const s = scene(t);
  await installDshTui({ env: s.env, publishedAt: PUBLISHED });
  const r = uninstallDshTui({ env: s.env });
  assert.equal(r.status, "removed", JSON.stringify(r));
  assert.ok(s.calls().includes(`plugin --profile tui remove ${DSH_TUI.package}`));
  assert.equal(existsSync(join(s.home, ".local", "bin", SHIM)), false);
  assert.deepEqual(JSON.parse(readFileSync(join(s.home, ".dsh", "profiles", "tui", "package.json"), "utf8")).dependencies, {});
  assert.deepEqual(releaseAgeEntries(readFileSync(join(s.home, ".dsh", "profiles", "tui", "pnpm-workspace.yaml"), "utf8")), []);
  assert.equal(readFileSync(join(s.home, ".dsh", ".credentials.yaml"), "utf8"), "keep: me\n", "credentials stay");

  const foreign = scene(t);
  mkdirSync(join(foreign.home, ".local", "bin"), { recursive: true });
  writeFileSync(join(foreign.home, ".local", "bin", SHIM), "#!/bin/sh\nexec my-own-dsh \"$@\"\n");
  const refused = await installDshTui({ env: foreign.env, publishedAt: PUBLISHED });
  assert.equal(refused.status, "failed");
  assert.match(refused.detail, /not this installer's/);
  assert.equal(readFileSync(join(foreign.home, ".local", "bin", SHIM), "utf8"), "#!/bin/sh\nexec my-own-dsh \"$@\"\n");
  assert.deepEqual(foreign.calls(), []);
});

test("no dsh: one honest line, nothing written", async (t) => {
  const s = scene(t, { dsh: false });
  const r = await installDshTui({ env: s.env });
  assert.equal(r.status, "skipped");
  assert.deepEqual(r.lines, [SKIP]);
  assert.match(r.lines[0], /^DSH is not installed \(no dsh on PATH\)/);
  assert.equal(findDsh(s.env), null);
  assert.equal(existsSync(join(s.home, ".local")), false);
  assert.equal(existsSync(join(s.home, ".dsh-tui")), false);
  const cli = s.cli(["dsh-tui", "install"]);
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim(), SKIP);
});

test("the release-age exception is exact, leaves other packages alone, and is pruned once aged", async (t) => {
  const s = scene(t);
  const workspace = join(s.home, ".dsh", "profiles", "tui", "pnpm-workspace.yaml");
  const young = await installDshTui({ env: s.env, publishedAt: PUBLISHED, now: () => Date.parse("2026-11-06T10:00:00Z") });
  assert.equal(young.status, "installed", young.detail);
  assert.deepEqual(releaseAgeEntries(readFileSync(workspace, "utf8")), [PIN]);
  const aged = await installDshTui({ env: s.env, publishedAt: PUBLISHED, now: () => Date.parse("2026-11-09T10:00:00Z") });
  assert.equal(aged.status, "installed");
  assert.deepEqual(releaseAgeEntries(readFileSync(workspace, "utf8")), []);
  assert.match(aged.lines.join("\n"), /Removed the release-age exception for .*older than the profile's minimumReleaseAge/);

  const scoped = "minimumReleaseAgeExclude:\n  - '@deepseek-harness-tui/dsh-tui'\n  - 'someone-else@1.0.0'\n";
  const fixed = scopeReleaseAge(scoped, [PIN]);
  assert.deepEqual(releaseAgeEntries(fixed.text).sort(), [PIN, "someone-else@1.0.0"].sort());
  assert.ok(!releaseAgeEntries(fixed.text).includes(DSH_TUI.package), "the bare package entry is gone");
  assert.equal(packageOfEntry(PIN), DSH_TUI.package);
  assert.equal(packageOfEntry(DSH_TUI.package), DSH_TUI.package);
  assert.equal(packageOfEntry("someone-else"), "someone-else");
});

test("the CLI command installs, reports doctor JSON and uninstalls", async (t) => {
  const s = scene(t);
  const installed = s.cli(["dsh-tui", "install", "--json"]);
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).status, "installed");
  const doctor = s.cli(["dsh-tui", "doctor", "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.code, 0);
  assert.deepEqual(report.checks.map((c) => c.check), ["dsh", "dsh-tui-profile", "dsh-tui-shim", "dsh-tui-path", "dsh-tui-guide"]);
  const removed = s.cli(["dsh-tui", "uninstall", "--json"]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(JSON.parse(removed.stdout).status, "removed");
  assert.equal(existsSync(join(s.home, ".local", "bin", SHIM)), false);
});

test("shimIsOurs accepts only the marked long-form shim", () => {
  assert.equal(shimIsOurs(SHIM_TEXT), true);
  assert.equal(shimIsOurs("#!/bin/sh\nexec dsh --profile tui \"$@\"\n"), false);
  assert.equal(shimIsOurs("#!/bin/sh\nexec dsh-tui --profile tui \"$@\"\n"), false);
});
