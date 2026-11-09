// The pack's Antigravity model cache (modelCache.js, #793): what `agy models`' table and the
// cache text mean, and the one refresh that fills the cache from a fake agy (never the real
// CLI). No file or program is touched: read/write/exec are injected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AG_MODELS_FILE, AG_MODELS_TTL_MS, agModelsCacheText, agModelsFresh, agModelsPath, parseAgModelsCache,
  parseAgModelsOutput, refreshAgModels, refreshAgModelsSync,
} from "../mods/am-sidebar/modelCache.js";

const MODELS = readFileSync(new URL("./fixtures/agy/models-1.5.3.txt", import.meta.url), "utf8");
const IDS = MODELS.trim().split("\n").map((line) => line.split("\t")[0]);
const NOW = Date.parse("2026-11-09T12:00:00Z");

test("parseAgModelsOutput: the fixture table's ids and labels, noise and duplicates skipped", () => {
  const models = parseAgModelsOutput(MODELS);
  assert.deepEqual(models.map((m) => m.id), IDS);
  assert.equal(models.length, 13);
  assert.deepEqual(models[0], { id: "gemini-4-argon-medium", label: "Gemini 4 Argon (Medium)" });
  assert.deepEqual(models.at(-1), { id: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)" });
  // agy prints its log lines on stderr; a stray line without a separator is not a model.
  assert.deepEqual(parseAgModelsOutput("INFO starting\nNot a model\nok-id\tOk\n"), [{ id: "ok-id", label: "Ok" }]);
  // A run of spaces between id and label reads as the same table.
  assert.deepEqual(parseAgModelsOutput("spaced-id  Two words\n"), [{ id: "spaced-id", label: "Two words" }]);
  // A model id that isn't one word (or starts with a dash) is never a pin.
  assert.deepEqual(parseAgModelsOutput("-x\tBad\nhas space\tBad\n--model\tBad\ngood\tGood\n"), [{ id: "good", label: "Good" }]);
  assert.deepEqual(parseAgModelsOutput("same\tOne\nsame\tTwo\n"), [{ id: "same", label: "One" }]);
  assert.deepEqual(parseAgModelsOutput(""), []);
  assert.deepEqual(parseAgModelsOutput(null), []);
});

test("cache text: the fixture list round-trips with its time and source; malformed text is no cache", () => {
  const at = new Date(NOW).toISOString();
  const text = agModelsCacheText(parseAgModelsOutput(MODELS), NOW);
  const cache = parseAgModelsCache(text);
  assert.equal(cache.at, at);
  assert.deepEqual(cache.models, parseAgModelsOutput(MODELS));
  assert.match(text, /"source": "agy models"/);
  assert.equal(agModelsFresh(cache, NOW + AG_MODELS_TTL_MS - 1), true);
  assert.equal(agModelsFresh(cache, NOW + AG_MODELS_TTL_MS), false, "a day old is stale");
  assert.equal(agModelsFresh(cache, NOW + 1), true, "a little clock skew is still fresh");
  // A hand-edited or older cache: bare ids still read, bad ids don't, no list is no cache.
  assert.deepEqual(parseAgModelsCache('{"models":["a","b"]}')?.models, [{ id: "a", label: "" }, { id: "b", label: "" }]);
  assert.equal(parseAgModelsCache('{"models":[]}'), null);
  assert.equal(parseAgModelsCache('{"models":["-x"]}'), null);
  assert.equal(parseAgModelsCache("{not json"), null);
  assert.equal(parseAgModelsCache(null), null);
  assert.equal(agModelsFresh(null, NOW), false);
  assert.equal(agModelsPath("/app/"), `/app/${AG_MODELS_FILE}`);
});

test("refreshAgModels: a fresh cache is used without running agy", async () => {
  const text = agModelsCacheText(parseAgModelsOutput(MODELS), NOW);
  let writes = 0, execs = 0;
  const r = await refreshAgModels({
    appHome: "/app", read: () => text, write: () => { writes += 1; }, now: NOW + 1000,
    exec: () => { execs += 1; return { code: 0, stdout: MODELS, stderr: "" }; },
  });
  assert.deepEqual([execs, writes, r.refreshed], [0, 0, false]);
  assert.equal(r.text, text);
  assert.equal(r.cache.models.length, 13);
});

test("refreshAgModels: a missing cache runs `agy models` once, writes the table and never throws", async () => {
  let written = null;
  const r = await refreshAgModels({
    appHome: "/app", read: () => null, write: (path, text) => { written = { path, text }; }, now: NOW,
    exec: (command, args, options) => {
      assert.deepEqual([command, args], ["agy", ["models"]]);
      assert.ok(options.timeout > 0);
      return { code: 0, stdout: MODELS, stderr: "INFO noise" };
    },
  });
  assert.equal(r.refreshed, true);
  assert.equal(r.why, null);
  assert.equal(written.path, `/app/${AG_MODELS_FILE}`);
  assert.deepEqual(parseAgModelsCache(written.text).models.map((m) => m.id), IDS);
  assert.equal(r.text, written.text);
});

test("refreshAgModels: agy missing or failing keeps the last list and says why; no list stays none", async () => {
  const stale = agModelsCacheText(parseAgModelsOutput(MODELS), NOW - AG_MODELS_TTL_MS - 1);
  const missing = await refreshAgModels({
    appHome: "/app", read: () => stale, write: () => { throw new Error("must not write"); }, now: NOW,
    exec: () => { throw Object.assign(new Error("spawn agy ENOENT"), { code: "ENOENT" }); },
  });
  assert.deepEqual([missing.refreshed, missing.cache.models.length], [false, 13], "the stale list survives");
  assert.match(missing.why, /agy models couldn't run/);
  assert.equal(missing.text, stale);
  const none = await refreshAgModels({
    appHome: "/app", read: () => null, write: () => {}, now: NOW,
    exec: () => { throw new Error("spawn agy ENOENT"); },
  });
  assert.deepEqual([none.text, none.cache, none.refreshed], [null, null, false]);
  assert.match(none.why, /ENOENT/);
  const failed = await refreshAgModels({
    appHome: "/app", read: () => null, write: () => {}, now: NOW,
    exec: () => ({ code: 1, stdout: "", stderr: "not logged in\n" }),
  });
  assert.equal(failed.why, "agy models failed (not logged in)");
  const empty = await refreshAgModels({
    appHome: "/app", read: () => null, write: () => {}, now: NOW,
    exec: () => ({ code: 0, stdout: "INFO nothing\n", stderr: "" }),
  });
  assert.equal(empty.why, "agy models listed no models");
  assert.equal(empty.text, null);
});

test("refreshAgModelsSync: the CLI's synchronous path reads fresh, refreshes old, keeps a failed list", () => {
  const fresh = agModelsCacheText(parseAgModelsOutput(MODELS), NOW);
  let execs = 0;
  const used = refreshAgModelsSync({ appHome: "/app", read: () => fresh, write: () => {}, now: NOW + 1,
    exec: () => { execs += 1; return { code: 0, stdout: MODELS, stderr: "" }; } });
  assert.deepEqual([execs, used.refreshed, used.cache.models.length], [0, false, 13]);
  let written = null;
  const filled = refreshAgModelsSync({ appHome: "/app", read: () => null, write: (path, text) => { written = { path, text }; }, now: NOW,
    exec: () => ({ code: 0, stdout: MODELS, stderr: "" }) });
  assert.equal(filled.refreshed, true);
  assert.match(written.path, /antigravity-models\.json$/);
  const stale = agModelsCacheText(parseAgModelsOutput(MODELS), NOW - AG_MODELS_TTL_MS - 1);
  const kept = refreshAgModelsSync({ appHome: "/app", read: () => stale, write: () => {}, now: NOW,
    exec: () => ({ code: 1, stdout: "", stderr: "offline" }) });
  assert.deepEqual([kept.refreshed, kept.cache.models.length], [false, 13]);
  assert.match(kept.why, /offline/);
});
