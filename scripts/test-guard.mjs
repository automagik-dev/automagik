#!/usr/bin/env node
/**
 * Runs `node --test` and fails a truncated run (#422). Node's own arguments go in unchanged:
 *
 *   node ../../scripts/test-guard.mjs --import ./setup.mjs --test --test-force-exit "test/*.test.js"
 *
 * Under --test-force-exit each test file's process calls process.exit() as soon as its results are
 * written, and on a pipe that drops what the kernel has not taken yet. The runner then reports only
 * what arrived: exit 0, 0 failures, and a `1..N` that counts the arrived results, so a plan check
 * alone passes a truncated run. This guard makes three checks on a TAP ledger written to a file,
 * which force-exit closes before it exits:
 *
 *   - the plan is there (the runner itself stopped when it is not);
 *   - the plan equals the top-level results;
 *   - every test file sent its end-of-file summary, the last thing its process writes.
 *
 * test-guard-flush.mjs stops the pipe from dropping anything, so a complete run stays complete.
 * test-guard-reporter.mjs writes the ledger. stdout stays the runner's own: nothing is parsed from
 * it, buffered or changed. A complete run keeps its exit code, so failing tests fail as before.
 * A truncation is named on stderr and turns exit 0 into exit 1. There are no retries.
 *
 * Plain Node, no dependencies: the plugins' tests run on Node (22 in CI). Apache-2.0.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = (file) => new URL(file, import.meta.url).href;

/** Node's own default, kept so a run reads as it would without the guard. */
function shownReporter() {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 23 || process.stdout.isTTY ? "spec" : "tap";
}

/** What the ledger proves: `problems` names each truncation, `complete` sums up a whole run. */
function judge(ledger) {
  let plan = null;
  let ran = 0;
  let last = "an unknown file";
  let files = null;
  const counts = {};
  for (const line of ledger.split("\n")) {
    let match;
    if ((match = /^1\.\.(\d+)/.exec(line))) plan = Number(match[1]);
    else if (/^(?:not )?ok\b/.test(line)) ran += 1;
    else if ((match = /^# test-guard file (.+)$/.exec(line))) last = match[1];
    else if ((match = /^# test-guard files (.+)$/.exec(line))) files = parseFiles(match[1]);
    else if ((match = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line))) counts[match[1]] = match[2];
  }
  const problems = [];
  if (plan === null) problems.push(`expected a TAP plan, saw ${ran} results and no plan, file ${last}`);
  else if (plan !== ran) problems.push(`expected ${plan}, saw ${ran}, file ${last}`);
  else if (files === null) problems.push(`expected the per-file record after the plan, saw none, file ${last}`);
  for (const { name, expected, saw, done } of files ?? []) {
    if (!done) problems.push(`expected ${expected}, saw ${saw}, file ${name}: no end-of-file summary`);
  }
  const { tests, pass, fail, cancelled, skipped, todo } = counts;
  const complete = `plan 1..${plan}, ${ran} top-level results, ${tests} tests (${pass} pass, ${fail} fail, ` +
    `${cancelled} cancelled, ${skipped} skipped, ${todo} todo), ${files?.length} files`;
  return { problems, complete };
}

function parseFiles(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/test-guard.mjs <the arguments for node --test>");
  process.exit(2);
}
const folder = mkdtempSync(join(tmpdir(), "test-guard-"));
const ledger = join(folder, "run.tap");
const shown = args.some((arg) => arg.startsWith("--test-reporter")) ? [] : [`--test-reporter=${shownReporter()}`, "--test-reporter-destination=stdout"];
const child = spawn(process.execPath, [
  `--import=${here("./test-guard-flush.mjs")}`,
  ...shown,
  `--test-reporter=${here("./test-guard-reporter.mjs")}`,
  `--test-reporter-destination=${ledger}`,
  ...args,
], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

child.on("close", (code, signal) => {
  let text = "";
  try {
    text = readFileSync(ledger, "utf8");
  } catch {
    // No ledger is a run that wrote no plan: judged below.
  }
  rmSync(folder, { recursive: true, force: true });
  const { problems, complete } = judge(text);
  for (const problem of problems) console.error(`test-guard: truncated run: ${problem}`);
  if (problems.length === 0) console.error(`test-guard: complete run: ${complete}`);
  const failed = code !== 0 || signal !== null;
  process.exit(failed ? (code ?? 1) : problems.length > 0 ? 1 : 0);
});
