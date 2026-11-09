// Refs #631: real bwrap, fixture roots only. No host core, credentials or runtime sockets.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { approveProject, readApprovedRecord } from "../mods/am-sidebar/approved.js";
import { scratchRoot } from "./scratch-project.mjs";

const wrapper = fileURLToPath(new URL("../mods/am-sidebar/bin/hc-socket-mask.mjs", import.meta.url));

test("approved snapshot write and rename are refused inside the sandbox wrapper", (t) => {
  if (process.platform !== "linux") return t.skip("the sandbox wrapper uses Linux bwrap");
  const capability = spawnSync("bwrap", ["--unshare-all", "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64", "--", "/usr/bin/true"],
  { encoding: "utf8", timeout: 5000 });
  if (capability.error?.code === "ENOENT") return t.skip("bwrap is not installed");
  if (capability.status !== 0) {
    return t.skip(`bwrap namespaces unavailable: ${(capability.stderr || capability.error?.message)
      .replace(/\s+/g, " ").trim()}`);
  }
  const root = scratchRoot(t, "approved-worker-");
  const home = join(root, "home"), project = join(root, "project");
  const env = { PATH: "/usr/bin:/bin", HOME: home, XDG_DATA_HOME: join(root, "data"), GIT_CEILING_DIRECTORIES: root };
  const packRoot = join(env.XDG_DATA_HOME, "automagik-herdr", "dsh-sandbox");
  const proxy = join(root, "automagik-hc-proxy", "t1", "fixture.sock");
  const real = join(root, "fixture-runtime", "fixture.sock");
  for (const dir of [home, join(project, ".herdr"), packRoot,
    join(root, "fixture-runtime"), join(root, "automagik-hc-proxy", "t1")]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(project, ".herdr", "bots.json"), JSON.stringify({ version: 1,
    categories: [], bots: [] }));
  const approved = approveProject({ project, env, approvedAt: "2026-11-02", approvedBy: "fixture" });
  const before = readFileSync(approved.path, "utf8");
  const incoming = join(dirname(approved.path), "replacement.json");
  const probe = join(root, "probe.mjs");
  writeFileSync(probe, `
import { writeFileSync, renameSync } from "node:fs";
const [target, source, sibling] = process.argv.slice(2);
// A writable sibling proves that refusal comes from the parent's read-only bind.
writeFileSync(sibling, "writable");
const results = {};
for (const [name, action] of [["write", () => writeFileSync(target, "changed")],
  ["rename", () => renameSync(source, target)]]) {
  try { action(); results[name] = "allowed"; }
  catch (error) { results[name] = error.code; }
}
console.log(JSON.stringify(results));
`);
  const harness = join(root, "wrapper-harness.mjs");
  writeFileSync(harness, `
import { maskArgs, runBwrap } from ${JSON.stringify(pathToFileURL(wrapper).href)};
const result = maskArgs(process.argv.slice(2), process.env, {
  packRoot: ${JSON.stringify(packRoot)}, containerSockets: []
});
if (result.fatal) throw new Error(result.fatal);
runBwrap(result.args);
`);
  const args = ["--unshare-all", "--new-session", "--die-with-parent",
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/bin", "/bin",
    "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64",
    "--ro-bind", process.execPath, "/fixture-node",
    "--proc", "/proc", "--dev", "/dev", "--bind", root, root, "--chdir", root,
    "--", "/fixture-node", probe, approved.path, incoming, join(root, "writable")];
  const run = (mask) => {
    writeFileSync(incoming, "replacement", { mode: 0o600 });
    return spawnSync(process.execPath, [harness, ...args], { encoding: "utf8", timeout: 15000,
      env: { ...env, DSH_SANDBOX_MASK: mask, AM_HC_REAL_SOCKET: real, AM_HC_PROXY_SOCKET: proxy } });
  };
  const control = run("0");
  assert.equal(control.status, 0, `unmasked fixture control: ${control.stderr}`);
  assert.deepEqual(JSON.parse(control.stdout), { write: "allowed", rename: "allowed" });
  writeFileSync(approved.path, before);
  assert.equal(readApprovedRecord({ project, env }).text, before, "the masked fixture is valid approval");
  const masked = run("1");
  assert.equal(masked.status, 0, `sandbox wrapper probe: ${masked.stderr}`);
  const results = JSON.parse(masked.stdout);
  for (const name of ["write", "rename"]) {
    assert.match(results[name], /^(EROFS|EACCES|EPERM)$/, `${name} was refused inside the sandbox`);
  }
  assert.equal(readFileSync(approved.path, "utf8"), before, "the approved snapshot was not changed");
});
