// The switch gate: a second click while one switch runs must start nothing.
import test from "node:test";
import assert from "node:assert/strict";

import { claim, release } from "../mods/am-quota/lock.js";

test("a second click is refused while the first switch runs, and does not disturb it", () => {
  const state = { busy: null };
  assert.equal(claim(state, "claude", { name: "claude-a.json" }), null, "the first claim starts");
  assert.equal(state.busy, "switching claude to claude-a.json…");

  const refused = claim(state, "claude", { name: "claude-b.json" });
  assert.match(refused, /one switch at a time/);
  assert.match(refused, /claude-a\.json/, "it says what is running");
  assert.equal(state.busy, "switching claude to claude-a.json…", "the running switch keeps its text");

  // Three clicks in a row are still one switch.
  claim(state, "codex", { name: "codex-a.json" });
  assert.equal(state.busy, "switching claude to claude-a.json…");

  release(state);
  assert.equal(state.busy, null);
  assert.equal(claim(state, "codex", { name: "codex-a.json" }), null, "after it ends, the next switch starts");
});

test("a missing account name still names the switch", () => {
  const state = {};
  assert.equal(claim(state, "claude", null), null);
  assert.match(state.busy, /switching claude to claude…/);
});

test("no switch while bots restart, and the busy line is the caller's", () => {
  const state = { restarting: { codex: true } };
  assert.equal(claim(state, "codex", { name: "codex-a.json" }), "bots are restarting: switch once they are done");
  assert.equal(state.busy, undefined, "nothing started");
  // Another provider's restart does not block this one.
  assert.equal(claim({ restarting: { claude: true } }, "codex", { name: "codex-a.json" }), null);
  delete state.restarting.codex;
  assert.equal(claim(state, "codex", { name: "codex-a.json" }, "switching Codex to ana@example.com · Pro…"), null);
  assert.equal(state.busy, "switching Codex to ana@example.com · Pro…");
});
