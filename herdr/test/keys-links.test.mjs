// keys.json (#380) under dev's layout guard: a linked mods/ moves nothing and keys.json is written
// in the app home by a rename through layoutSafe.mjs change(); a linked keys.json is the person's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupHome } from "../mods/am-sidebar/update.mjs";
import { PACK_KEYS } from "../mods/am-sidebar/release.js";

const native = () => ({
  global: { "ctrl-alt-a": "space.next" },
  terminal: { "ctrl-shift-v": "terminal.paste", "shift-insert": "terminal.paste" },
});

function scene(t) {
  const home = mkdtempSync(join(tmpdir(), "herdr-keys-links-")), theirs = mkdtempSync(join(tmpdir(), "herdr-keys-theirs-"));
  t.after(() => { rmSync(home, { recursive: true, force: true }); rmSync(theirs, { recursive: true, force: true }); });
  const tgzDir = join(home, "archive"), modsDir = join(home, "mods"), keys = join(home, "keys.json");
  mkdirSync(tgzDir);
  const lines = [];
  const setup = () => setupHome({ modsDir, tgzDir, record: { mods: [] }, log: (line) => lines.push(line) });
  return { home, theirs, modsDir, keys, lines, setup };
}
const tree = (dir) => readdirSync(dir, { recursive: true }).sort().map((p) => `${p}:${lstatSync(join(dir, p)).isFile() ? readFileSync(join(dir, p), "utf8") : ""}`);

test("keys rule through links: a linked mods/ moves nothing, keys.json merges by a rename; a linked keys.json stays theirs", (t) => {
  // A linked mods/: keys.json stays absent, then merges by a rename in the home.
  const s = scene(t);
  mkdirSync(join(s.theirs, "my-mod"));
  writeFileSync(join(s.theirs, "my-mod", "main.js"), "// mine\n");
  symlinkSync(s.theirs, s.modsDir);
  const before = tree(s.theirs);
  s.setup();
  assert.equal(existsSync(s.keys), false, "before Herdr's first launch keys.json is left for Herdr");
  writeFileSync(s.keys, JSON.stringify(native()), { flag: "wx" });
  const ino = statSync(s.keys).ino;
  s.setup();
  assert.equal(lstatSync(s.keys).isFile(), true);
  assert.notEqual(statSync(s.keys).ino, ino, "replaced by a rename (layoutSafe change()), never written in place");
  const merged = JSON.parse(readFileSync(s.keys, "utf8"));
  assert.deepEqual(merged.terminal, native().terminal);
  assert.equal(merged.global["ctrl-alt-a"], "space.next");
  for (const [section, entries] of Object.entries(PACK_KEYS)) for (const [key, action] of Object.entries(entries)) assert.equal(merged[section][key], action);
  assert.deepEqual(tree(s.theirs), before, "nothing written through the linked mods/");
  assert.deepEqual(readdirSync(s.home).filter((f) => f.includes(".am-tmp-")), [], "no temporary file left");

  // A linked keys.json (the person's dotfile): never written through, the link stays.
  const l = scene(t);
  mkdirSync(l.modsDir);
  const target = join(l.theirs, "keys.json"), text = JSON.stringify(native());
  writeFileSync(target, text);
  symlinkSync(target, l.keys);
  l.setup();
  assert.equal(readFileSync(target, "utf8"), text, "the person's file keeps its bytes");
  assert.equal(lstatSync(l.keys).isSymbolicLink(), true);
  assert.equal(readlinkSync(l.keys), target);
  assert.match(l.lines.join("\n"), /keys\.json .* is a link, your own file: left as it is; add cmd-shift-m/);
});
