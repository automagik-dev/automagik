// transcriptFolder.mjs: the folder rule for a transcript_path on this computer (RFC 0015, the
// folder rule). Its cases are the shared vectors RFC 0015 delivery 1's chat/ rule also reads
// (fixtures/transcript-folder-rule.json; new cases go there, not here): every local case, in
// a temp home. The remote half belongs to the engine; the hook reads only this computer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync }
  from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TRANSCRIPT_FOLDERS, transcriptRealPath, transcriptShape }
  from "../mods/am-sidebar/transcriptFolder.mjs";

const FIXTURE = new URL("./fixtures/transcript-folder-rule.json", import.meta.url);
const VECTORS = JSON.parse(readFileSync(FIXTURE, "utf8"));

test("the shared vectors name the same folders", () => {
  assert.equal(VECTORS.version, 1);
  assert.deepEqual(VECTORS.folders, { ...TRANSCRIPT_FOLDERS });
});

const local = VECTORS.cases.filter((c) => c.mode === "local");
test("there are local cases to run", () => assert.ok(local.length >= 10, String(local.length)));

for (const c of local) {
  test(`shared vector: ${c.name}`, (t) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "hb-transcript-")));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const at = (p) => p.replaceAll("{home}", home);
    for (const d of c.setup?.dirs ?? []) mkdirSync(at(d), { recursive: true });
    for (const f of c.setup?.files ?? []) {
      mkdirSync(dirname(at(f)), { recursive: true });
      writeFileSync(at(f), "");
    }
    for (const l of c.setup?.symlinks ?? []) {
      mkdirSync(dirname(at(l.at)), { recursive: true });
      symlinkSync(at(l.to), at(l.at));
    }
    const got = transcriptRealPath(at(c.path), c.agent, home);
    if (c.expect === "accept") assert.equal(got, at(c.resolved));
    else assert.equal(got, null);
  });
}

test("transcriptShape and the home: more refusals the hook relies on", (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "hb-transcript-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const s = join(home, ".claude/projects/p/s.jsonl");
  mkdirSync(dirname(s), { recursive: true });
  writeFileSync(s, "");
  assert.equal(transcriptRealPath(s, "claude", home), s);
  assert.equal(transcriptRealPath(s, "claude", `${home}/`), s, "a trailing slash on the home");
  assert.equal(transcriptRealPath(s, "claude", "relative"), null);
  assert.equal(transcriptRealPath(s, "claude", undefined), null, "no home: none read from the env");
  assert.equal(transcriptRealPath(s, "toString", home), null, "not an inherited key");
  const long = `/${"a".repeat(5000)}.jsonl`;
  const odd = ["/h/s\n.jsonl", "/h/s\u001b.jsonl", "/h//s.jsonl", "/h/./s.jsonl", "/h/s.jsonl/"];
  for (const bad of [...odd, null, 7, long]) {
    assert.equal(transcriptShape(bad), false, JSON.stringify(bad));
  }
});
