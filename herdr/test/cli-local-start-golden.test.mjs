// A local start's command, byte for byte (#582): the linked-machine briefing and pane-env must
// never change what a bot started on this computer gets. For a Claude bot (the briefing file and
// the per-turn hook), an omp bot (the briefing as text) and a Hermes bot (the briefing in its
// environment): the `hc run` argv with its `/usr/bin/env` words, the briefing file and the
// project's settings.local.json, scratch paths written as <root>. The project holds a
// .herdr/pane-env, which a local start never reads (it is for a linked machine's panes). The
// fixture is recorded from origin/dev in a fresh copy (AUTOMAGIK_GOLDEN_RECORD=1; the commit is
// named in the PR); every later run compares.
// Fake hc and a scratch home only: the real hc and window are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readJsonLines } from "./log-lines.mjs";

const CLI = new URL("../mods/am-sidebar/bin/automagik-herdr.mjs", import.meta.url).pathname;
const FAKE_HC = new URL("./fake-hc.mjs", import.meta.url).pathname;
const FIXTURE = new URL("./fixtures/local-start-argv.json", import.meta.url).pathname;
const exe = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };
const BOTS = [
  { id: "b-claudeaaaa", name: "Genie", kind: "main", agent: "claude", model: "claude-opus-5-5" },
  { id: "b-ompaaaaaaa", name: "Omen", kind: "member", agent: "omp" },
  { id: "b-hermesaaaa", name: "Atlas", kind: "member", agent: "hermes" },
];

/** One local start of `bot` in a fresh scratch world: what hc run got, and the files it wrote. */
function startOne(t, bot) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hb-golden-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "proj"), bin = join(root, "bin"), home = join(root, "home"), app = join(root, "app");
  for (const d of [project, bin, home, join(app, "mods/am-sidebar")]) mkdirSync(d, { recursive: true });
  // No template: a runner's own init.templateDir can't change the exclude file the start writes.
  execFileSync("git", ["init", "-q", "--template=", project]);
  exe(join(bin, "hc"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_HC}" "$@"\n`);
  exe(join(bin, "herdr-app"), "#!/bin/sh\necho \"no window in tests\" >&2\nexit 1\n");
  for (const a of ["claude", "omp", "hermes"]) exe(join(bin, a), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(app, "mods/am-sidebar/briefing.mjs"), "// stand-in\n");
  mkdirSync(join(project, ".herdr"));
  writeFileSync(join(project, ".herdr/pane-env"), "PATH_PREPEND=/opt/node-22/bin\nHERDR_APP_HOME=/srv/bots/herdr-app\n");
  const look = { character: "star", colour: "blue" };
  writeFileSync(join(project, ".herdr/bots.json"), `${JSON.stringify({ version: 1, categories: [],
    bots: BOTS.map((b) => ({ look, role: "r", instructions: "i", ...b, ...(b.kind === "member" ? { lead: BOTS[0].id } : {}) })) }, null, 2)}\n`);
  const statePath = join(root, "hc.json"), logPath = join(root, "hc.log");
  writeFileSync(statePath, JSON.stringify({ terminals: [], next: 100 }));
  writeFileSync(logPath, "");
  // A pinned PATH, so the pane's PATH is the same on every runner.
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, HERDR_APP_HOME: app, HC_FAKE_STATE: statePath, HC_FAKE_LOG: logPath, LANG: "C" };
  const r = spawnSync(process.execPath, [CLI, "start", bot.name, "--json"], { cwd: project, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // The briefing file's name starts with a hash of the project's folder, a new temp folder each run.
  const norm = (text) => (text === null ? null : text.split(root).join("<root>").replace(/(\/briefings\/)[0-9a-f]{10}-/g, "$1<hash>-"));
  const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);
  const run = readJsonLines(logPath).find((c) => c[0] === "run");
  const file = run.find((w, i) => run[i - 1] === "--append-system-prompt-file") ?? null;
  return {
    argv: run.map(norm),
    briefingFile: file === null ? null : norm(read(file)),
    settings: norm(read(join(project, ".claude/settings.local.json"))),
    exclude: norm(read(join(project, ".git/info/exclude"))),
  };
}

test("a local start's argv, env words, briefing file and hook are byte-identical to before #582", (t) => {
  const seen = Object.fromEntries(BOTS.map((b) => [b.agent, startOne(t, b)]));
  if (process.env.AUTOMAGIK_GOLDEN_RECORD === "1") writeFileSync(FIXTURE, `${JSON.stringify(seen, null, 2)}\n`);
  const want = JSON.parse(readFileSync(FIXTURE, "utf8"));
  for (const agent of Object.keys(want)) assert.deepEqual(seen[agent], want[agent], agent);
  assert.deepEqual(Object.keys(seen).sort(), Object.keys(want).sort());
});
