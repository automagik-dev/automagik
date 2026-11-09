// The per-turn briefing hook on a CLI-only host (issue #807): am's copy of briefingText.mjs
// points the hook at the installed am part's own entry and runner when no pack is under the app
// home, and am self doctor reports which briefing a project's hook runs. Fake app home, fake am
// store and fake project only: never a real home or settings file. Apache-2.0.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { amPartEntryPath, amPartHookCommand, hookCommand, installHook, scriptOf } from "../briefingText.mjs";
import { doctorSelf } from "../lib/self.mjs";

/** A scratch machine: HOME, app home, the am part's store and a project, all under one temp folder. */
function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "am-briefing-hook-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const app = join(root, "app");
  const store = join(home, ".automagik", "parts", "automagik.am");
  const project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(app, { recursive: true });
  mkdirSync(project, { recursive: true });
  const env = { HOME: home, HERDR_APP_HOME: app };
  const io = {
    git: async () => null,
    read: async (path) => { try { return readFileSync(path, "utf8"); } catch { return null; } },
    write: async (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); },
    mkdir: async (dir) => { mkdirSync(dir, { recursive: true }); },
  };
  const current = join(store, "current");
  /** The am part's installed shape: current/{bin/run.sh,briefingEntry.mjs,briefing.mjs} (no VERSION needed here). */
  const installAmPart = () => {
    mkdirSync(join(current, "bin"), { recursive: true });
    writeFileSync(join(current, "bin", "run.sh"), '#!/bin/sh\nexec node "$@"\n');
    writeFileSync(join(current, "briefingEntry.mjs"), "// am's entry\n");
    writeFileSync(join(current, "briefing.mjs"), "// am's briefing\n");
  };
  const settings = join(project, ".claude", "settings.local.json");
  const command = () => JSON.parse(readFileSync(settings, "utf8")).hooks.UserPromptSubmit[0].hooks[0].command;
  const doctorLine = () => doctorSelf({ env, project }).lines.find((l) => l.check === "briefing hook");
  return { root, home, app, store, current, project, env, io, installAmPart, settings, command, doctorLine };
}

test("am's copy writes the am part's hook when no pack is installed, and am self doctor names it", async (t) => {
  const s = scratch(t);
  s.installAmPart();
  const r = await installHook("Genie", s.project, s.app, s.io, { amStore: s.store });
  assert.equal(r.written, true, r.warnings.join(" "));
  assert.deepEqual(r.warnings, []);
  assert.equal(s.command(), amPartHookCommand(s.app, s.store));
  assert.equal(scriptOf(s.command()), amPartEntryPath(s.store));
  const line = s.doctorLine();
  assert.equal(line.ok, true, line.detail);
  assert.match(line.detail, /am's entry \(.*briefingEntry\.mjs\) in .*settings\.local\.json$/);
});

test("with a pack under the app home the doctor names the pack's stable entry, and the hook stays the pack's", async (t) => {
  const s = scratch(t);
  s.installAmPart();
  mkdirSync(join(s.app, "mods", "am-sidebar"), { recursive: true });
  writeFileSync(join(s.app, "mods", "am-sidebar", "briefing.mjs"), "// the pack's briefing\n");
  writeFileSync(join(s.app, "mods", "am-sidebar", "briefingEntry.mjs"), "// the pack's entry\n");
  mkdirSync(dirname(s.settings), { recursive: true });
  writeFileSync(s.settings, `${JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: hookCommand(s.app), timeout: 10 }] }] } }, null, 2)}\n`);
  // Starting again leaves the pack's command alone (the stable entry placed, never an am one).
  assert.equal((await installHook("Genie", s.project, s.app, s.io, { amStore: s.store })).written, false);
  assert.equal(s.command(), hookCommand(s.app));
  assert.equal(existsSync(join(s.app, "automagik-herdr", "briefing.mjs")), true, "the stable entry was put in place");
  const line = s.doctorLine();
  assert.equal(line.ok, true, line.detail);
  assert.match(line.detail, /the pack's stable entry \(.*automagik-herdr\/briefing\.mjs\) in .*settings\.local\.json$/);
});

test("am self doctor says none, and says plainly when neither the pack's entry nor am's is installed", async (t) => {
  const s = scratch(t);
  mkdirSync(dirname(s.settings), { recursive: true });
  writeFileSync(s.settings, `${JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo mine" }] }] } }, null, 2)}\n`);
  const none = s.doctorLine();
  assert.equal(none.ok, false, "neither is installed: the doctor fails and says why");
  assert.match(none.detail, /none: .*settings\.local\.json has no briefing hook; neither the pack's entry \(.*\) nor am's entry \(.*\) is installed$/);
  assert.equal(existsSync(join(s.project, ".claude", "settings.local.json")), true, "doctor wrote nothing");
  s.installAmPart();
  const installed = s.doctorLine();
  assert.equal(installed.ok, true, installed.detail);
  assert.match(installed.detail, /none: .*has no briefing hook$/, "a project with no hook is a note once something is installed");
});
