// Retired agents (Gemini CLI, which Antigravity replaces) stay out of the pack's agent lists: the
// + menu (am-new-menu/agents.js), the automations form (am-automations/agents.js) and the sidebar's
// bot form and resolver (am-sidebar/models.js LEGACY_AGENTS). All three read one list,
// am-sidebar/retired.js; the other two mods carry byte-equal copies so each loads on its own (#224).
// The files are pure, so they load here as they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { menuAgents, RETIRED as MENU_RETIRED } from "../mods/am-new-menu/agents.js";
import { AGENTS as AUTO_AGENTS, offeredAgents, RETIRED as AUTO_RETIRED } from "../mods/am-automations/agents.js";
import { LEGACY_AGENTS, RETIRED, isRetired } from "../mods/am-sidebar/retired.js";
import { AGENTS as SIDEBAR_AGENTS, LEGACY_AGENTS as SIDEBAR_LEGACY, resolveAgent } from "../mods/am-sidebar/models.js";

const MODS = fileURLToPath(new URL("../mods/", import.meta.url));
const SOURCE = "am-sidebar/retired.js";
const COPIES = ["am-automations/retired.js", "am-new-menu/retired.js"];
const agent = (key, installed) => ({ key, name: key, installed, run: [key] });
const keys = (list) => list.map((a) => a.key);

test("one list: am-sidebar/retired.js is the source and each mod's copy is byte-equal to it", () => {
  const source = readFileSync(join(MODS, SOURCE));
  for (const copy of COPIES) {
    assert.ok(readFileSync(join(MODS, copy)).equals(source), `mods/${copy} drifted: copy mods/${SOURCE} over it`);
  }
  assert.deepEqual(LEGACY_AGENTS, { gemini: "antigravity" });
  assert.deepEqual([...RETIRED], ["gemini"]);
});

test("the three consumers resolve the same set", () => {
  assert.equal(SIDEBAR_LEGACY, LEGACY_AGENTS, "models.js re-exports the source's map itself");
  assert.deepEqual([...MENU_RETIRED], [...RETIRED]);
  assert.deepEqual([...AUTO_RETIRED], [...RETIRED]);
  assert.deepEqual(Object.keys(SIDEBAR_LEGACY), [...RETIRED]);
});

test("each consumer rejects gemini and accepts antigravity and the other agents", () => {
  assert.equal(isRetired("gemini"), true);
  for (const key of ["antigravity", "claude", "codex", "pi", "omp", "", "constructor", "toString"]) {
    assert.equal(isRetired(key), false, key);
  }
  assert.equal(isRetired(undefined), false);
  // + menu
  assert.deepEqual(keys(menuAgents([agent("gemini", true), agent("antigravity", true)]).installed), ["antigravity"]);
  // automations: its own fixed list, never a retired entry
  for (const set of [AUTO_RETIRED, MENU_RETIRED]) {
    assert.ok(set.has("gemini"));
    assert.ok(!set.has("antigravity"));
  }
  assert.deepEqual(offeredAgents(null, ""), AUTO_AGENTS);
  // sidebar: the bot form's filter (create.js) and the resolver read LEGACY_AGENTS
  const listed = Object.keys(SIDEBAR_AGENTS).concat("gemini").filter((k) => !Object.hasOwn(SIDEBAR_LEGACY, k));
  assert.deepEqual(listed, Object.keys(SIDEBAR_AGENTS));
  assert.ok(listed.includes("antigravity"));
  assert.equal(resolveAgent("gemini"), "antigravity", "a saved gemini still runs, as its replacement");
  assert.equal(resolveAgent("antigravity"), "antigravity");
});

test("no second list: no am-* mod names gemini in code outside retired.js", () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.m?js$/.test(name)) files.push(path);
    }
  };
  for (const mod of readdirSync(MODS).filter((m) => m.startsWith("am-"))) walk(join(MODS, mod));
  const literal = /["'`]gemini["'`]|\bgemini\s*:/;
  const hits = [];
  for (const path of files) {
    const rel = path.slice(MODS.length);
    if (rel.endsWith("/retired.js") || rel.endsWith("/emoji-data.js")) continue; // emoji: the zodiac sign
    readFileSync(path, "utf8").split("\n").forEach((line, i) => {
      if (!/^\s*(\/\/|\/\*|\*)/.test(line) && literal.test(line)) hits.push(`${rel}:${i + 1}`);
    });
  }
  assert.ok(files.length > 20, `scanned ${files.length} files`);
  assert.deepEqual(hits, []);
});

test("+ menu: an installed gemini gets no row and no number key; the keys stay consecutive", () => {
  const { installed, choices } = menuAgents([agent("claude", true), agent("gemini", true), agent("codex", true)]);
  assert.deepEqual(keys(installed), ["claude", "codex"]);   // ⌘1 claude, ⌘2 codex
  assert.deepEqual(keys(choices), ["claude", "codex"]);
});

test("+ menu: a not-installed gemini is never suggested and takes no suggestion slot", () => {
  const list = [agent("claude", true), agent("gemini", false), agent("pi", false), agent("omp", false)];
  const { installed, choices } = menuAgents(list);
  assert.deepEqual(keys(installed), ["claude"]);
  assert.deepEqual(keys(choices), ["claude", "pi", "omp"]);
});

test("+ menu: a list without retired agents is unchanged", () => {
  const list = [agent("claude", true), agent("codex", true), agent("pi", false), agent("omp", false), agent("agy", false)];
  const { installed, choices } = menuAgents(list);
  assert.deepEqual(keys(installed), ["claude", "codex"]);
  assert.deepEqual(keys(choices), ["claude", "codex", "pi", "omp"]);
});

test("+ menu: gemini alone, or no list, leaves nothing", () => {
  assert.deepEqual(menuAgents([agent("gemini", true)]), { installed: [], choices: [] });
  assert.deepEqual(menuAgents(undefined), { installed: [], choices: [] });
});

test("automations: the form offers installed agents, the entry's own, never gemini", () => {
  assert.deepEqual(offeredAgents(["claude", "gemini", "pi"], "claude"), ["claude", "pi"]);
  assert.deepEqual(offeredAgents(["claude"], "codex"), ["claude", "codex"]);
  assert.deepEqual(offeredAgents(["claude"], "gemini"), ["claude"]);
  assert.deepEqual(offeredAgents(null, "gemini"), ["claude", "codex", "pi"]);
});
