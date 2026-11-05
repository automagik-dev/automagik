import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupHome } from "../mods/am-sidebar/update.mjs";
import { PACK_KEYS } from "../mods/am-sidebar/release.js";

function machine(t) {
  const home = mkdtempSync(join(tmpdir(), "herdr-setup-keys-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const modsDir = join(home, "mods"), tgzDir = join(home, "archive"), path = join(home, "keys.json");
  mkdirSync(modsDir); mkdirSync(tgzDir);
  const lines = [];
  return { path, lines, setup: () => setupHome({ modsDir, tgzDir, record: { mods: [] }, log: (line) => lines.push(line) }) };
}

// A native key file that Herdr creates at first launch, with a personal shortcut too.
const native = () => ({
  global: { "ctrl-shift-t": "tab.new", "ctrl-alt-a": "space.next" },
  terminal: { "ctrl-shift-v": "terminal.paste", "shift-insert": "terminal.paste", "ctrl-shift-c": "terminal.copy" },
});

test("pack setup before Herdr's first launch leaves keys.json absent for native initialization", (t) => {
  const m = machine(t);
  assert.deepEqual(m.setup(), []);
  assert.equal(existsSync(m.path), false, "a pack-only keys file would suppress Herdr's native defaults");
  assert.deepEqual(m.setup(), []);
  assert.equal(existsSync(m.path), false, "a second pre-launch install must also leave initialization to Herdr");
  assert.match(m.lines.join("\n"), /Open Herdr.*rerun/);
});

test("after native initialization, rerunning setup merges pack shortcuts and preserves terminal and personal keys", (t) => {
  const m = machine(t), defaults = native();
  m.setup();
  writeFileSync(m.path, JSON.stringify(defaults), { flag: "wx" });
  m.setup();
  const keys = JSON.parse(readFileSync(m.path, "utf8"));
  assert.deepEqual(keys.terminal, defaults.terminal);
  for (const [key, action] of Object.entries(defaults.global)) assert.equal(keys.global[key], action);
  for (const [section, bindings] of Object.entries(PACK_KEYS)) {
    for (const [key, action] of Object.entries(bindings)) assert.equal(keys[section][key], action);
  }
  const before = readFileSync(m.path);
  m.setup();
  assert.deepEqual(readFileSync(m.path), before, "a rerun does not rewrite unchanged bindings");
});

test("existing personal rebindings stay intact, including a deliberately empty key map", (t) => {
  const m = machine(t), personal = native();
  for (const [section, bindings] of Object.entries(PACK_KEYS)) {
    for (const key of Object.keys(bindings)) (personal[section] ??= {})[key] = "my.action";
  }
  personal.terminal["ctrl-shift-v"] = "terminal";
  const text = JSON.stringify(personal);
  writeFileSync(m.path, text);
  m.setup();
  assert.equal(readFileSync(m.path, "utf8"), text);
  writeFileSync(m.path, "{}\n");
  m.setup();
  assert.deepEqual(JSON.parse(readFileSync(m.path, "utf8")), PACK_KEYS);
});
