// scripts/scheduler-upstream.mjs: herdr/scheduler is upstream's tarball minus the paths UPSTREAM.md
// excludes, plus the fork's patch listed under "Local changes". These cases build the two trees on
// disk, so the comparison is tested without a download.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { compare, matcher } from "../scripts/scheduler-upstream.mjs";

const note = (local) => `# Upstream: fixture

## Excluded upstream paths

\`\`\`
app/
docs/*.gif
\`\`\`

## Local changes

\`\`\`
${local}
\`\`\`
`;

const UPSTREAM = {
  "LICENSE": "MIT\n",
  "go.mod": "module example\n",
  "main.go": "package main\n",
  "docs/adr/0001.md": "note\n",
  "app/mods/automations/main.js": "// excluded\n",
  "docs/board.gif": "GIF89a\n",
};
const LOCAL = {
  "LICENSE": "MIT\n",
  "LICENSE-upstream": "MIT\n",
  "go.mod": "module example\n",
  "main.go": "package main\n",
  "docs/adr/0001.md": "note\n",
};

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "scheduler-upstream-test-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

/** The tarball as source and the copy as dir, with its own UPSTREAM.md; call done() at the end. */
function pair({ local = LOCAL, changes = "" } = {}) {
  const source = tree(UPSTREAM);
  const dir = tree({ ...local, "UPSTREAM.md": note(changes) });
  return { source, dir, done: () => { rmSync(source, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); } };
}

test("a copy that skips the excluded paths is identical", () => {
  const t = pair();
  try {
    const result = compare(t.source, t.dir);
    assert.equal(result.compared, 4, "LICENSE, go.mod, main.go and the ADR are compared");
    assert.equal(result.excluded, 2, "app/ and docs/*.gif are left out");
    assert.deepEqual(result.patched, []);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.problems, []);
  } finally {
    t.done();
  }
});

test("a listed file may differ: it prints as patched, not as a difference", () => {
  const t = pair({ local: { ...LOCAL, "main.go": "package main // patched\n" }, changes: "main.go — patched: the API carries close_workspace\n" });
  try {
    const result = compare(t.source, t.dir);
    assert.deepEqual(result.patched, ["main.go"]);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.problems, []);
  } finally {
    t.done();
  }
});

test("an unlisted file that differs is a difference", () => {
  const t = pair({ local: { ...LOCAL, "main.go": "package main // patched\n" } });
  try {
    const result = compare(t.source, t.dir);
    assert.deepEqual(result.patched, []);
    assert.deepEqual(result.problems, [{ kind: "differs", path: "main.go" }]);
  } finally {
    t.done();
  }
});

test("a listed new file is an addition; an unlisted one is extra", () => {
  const listed = pair({ local: { ...LOCAL, "main_test.go": "package main\n" }, changes: "main_test.go — added: the put wire path\n" });
  try {
    const result = compare(listed.source, listed.dir);
    assert.deepEqual(result.added, ["main_test.go"]);
    assert.deepEqual(result.problems, []);
  } finally {
    listed.done();
  }
  const unlisted = pair({ local: { ...LOCAL, "extra_test.go": "package main\n" } });
  try {
    assert.deepEqual(compare(unlisted.source, unlisted.dir).problems, [{ kind: "extra", path: "extra_test.go" }]);
  } finally {
    unlisted.done();
  }
});

test("the exclusion patterns and the list's paths: folders, names and globs", () => {
  assert.equal(matcher("app/").test("app/mods/automations/main.js"), true);
  assert.equal(matcher("app/").test("app"), false, "a folder exclusion needs the slash");
  assert.equal(matcher("herdr-automations").test("herdr-automations"), true);
  assert.equal(matcher("herdr-automations").test("herdr-automations/x"), false);
  assert.equal(matcher("docs/*.gif").test("docs/board.gif"), true);
  assert.equal(matcher("docs/*.gif").test("docs/adr/0001.md"), false);
  assert.equal(matcher("docs/*.gif").test("docs/deep/board.gif"), false, "one name deep, like a shell glob");
});
