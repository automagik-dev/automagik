// The CLI tests' stand-in hc (fake-hc.mjs) under concurrent use: the CLI runs several hc calls at
// once (hc get of every helper, Promise.all), and a call that changes the state saves the whole
// file. A reader must never see a file part-way through a save.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FAKE_HC = new URL("./fake-hc.mjs", import.meta.url).pathname;

/** One fake hc call: resolves { code, stderr }. */
function call(env, args) {
  return new Promise((done) => {
    const p = spawn(process.execPath, [FAKE_HC, ...args], { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => { stderr += d; });
    p.on("close", (code) => done({ code, stderr }));
  });
}

test("fake hc: many calls at once that save and read the state never read it part-way through a save", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "hb-fakehc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "hc.json");
  const log = join(root, "hc.log");
  // A large state (about a megabyte) so a save takes long enough for a reader to land inside it.
  const terminals = Array.from({ length: 3000 }, (_, n) => ({ address: `t${n}`, name: `t${n}`, cwd: "/x", state: "live", parent: null,
    created_ms: 1, labels: { note: "x".repeat(200) }, foreground: { argv: ["claude"], cwd: "/x" }, status: { app: "claude-code", state: "idle" } }));
  writeFileSync(state, JSON.stringify({ terminals, next: 5000 }));
  writeFileSync(log, "");
  const env = { ...process.env, HC_FAKE_STATE: state, HC_FAKE_LOG: log };
  for (let round = 0; round < 4; round += 1) {
    // Writers (label saves the state) and readers (get) together.
    const calls = Array.from({ length: 24 }, (_, n) => (n % 2
      ? call(env, ["label", `t${n}`, `round=${round}`])
      : call(env, ["get", `t${n}`, "--json"])));
    const results = await Promise.all(calls);
    const torn = results.filter((r) => /SyntaxError|Unexpected end of JSON|Unexpected token/.test(r.stderr));
    assert.deepEqual(torn.map((r) => r.stderr.split("\n").find((l) => /Error/.test(l))), [], `round ${round}: a call read a torn state file`);
    assert.deepEqual(results.map((r) => r.code), results.map(() => 0), results.map((r) => r.stderr).join("\n"));
  }
  // The file left behind is whole, and no temp file is left beside it.
  assert.equal(JSON.parse(readFileSync(state, "utf8")).terminals.length, 3000);
  const { readdirSync } = await import("node:fs");
  assert.deepEqual(readdirSync(root).filter((f) => f.includes(".tmp")), []);
});
