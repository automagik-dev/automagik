// The briefing hook's fixed entry point (Group 6b). The pack copies this file to
// <app home>/automagik-herdr/briefing.mjs, outside mods/, and every Claude bot's and worker's
// hook runs that copy; the am part (RFC 0012) puts a link there to its own copy instead, so the
// app home is the folder the hook named (argv[1]), never this file's real place. It
// runs the first briefing.mjs it can: am's (<AM_HOME, else ~/.automagik>/parts/automagik.am/
// current/) when its VERSION is at least the installed sidebar's, then the sidebar folder's
// (mods/am-sidebar, else mods/spaces-agents), and am's last when it is older: an am that stopped
// updating never shadows a newer pack's briefing (t259's review). So a
// hook survives the sidebar being switched off, the folder's rename and a rollback across it. A
// copy that is missing, or whose import throws, is passed over for the next one: a broken am never
// silences a briefing. So that the next one starts clean, the hook's stdin (Claude Code's JSON) is
// read once here and replayed to each attempt, and each attempt's stdout is held and printed only
// when its import succeeds: a failed attempt prints nothing, whatever it wrote before it threw.
// am's copy lives outside the app home, so it is told the app home (HERDR_APP_HOME, when unset)
// that a sidebar copy finds from its own place. briefing.mjs runs only as the program node
// started, so the script becomes argv[1] before it is imported (env and exit code stay this
// process's). Fail-open like briefing.mjs: none found, nothing printed, exit 0. The installer, the
// updater and am replace the copy; edits to it are lost. Apache-2.0.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

// node resolves a link to its target for import.meta.url, but argv[1] keeps the path the hook ran.
const appHome = dirname(dirname(process.argv[1] ? resolve(process.argv[1]) : fileURLToPath(import.meta.url)));
const amHome = process.env.AM_HOME || join(homedir(), ".automagik");
const copies = [
  { path: join(amHome, "parts", "automagik.am", "current", "briefing.mjs"), am: true },
  ...["am-sidebar", "spaces-agents"].map((m) => ({ path: join(appHome, "mods", m, "briefing.mjs"), am: false })),
];
const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

/** A copy's VERSION as [major, minor, patch], or null when it has none it can read. */
const versionOf = (script) => {
  try {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(readFileSync(join(dirname(script), "VERSION"), "utf8").trim());
    return m ? m.slice(1).map(Number) : null;
  } catch { return null; }
};
/** Whether `a` is at least `b`: an unknown sidebar version never outranks am, an unknown am's always loses. */
const atLeast = (a, b) => {
  if (!b) return true;
  if (!a) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};
const sidebar = copies.slice(1).find((c) => existsSync(c.path));
if (sidebar && existsSync(copies[0].path) && !atLeast(versionOf(copies[0].path), versionOf(sidebar.path))) copies.push(copies.shift());

// The hook's stdin, all of it, as briefing.mjs reads it: none from a terminal, at most 300 ms for a
// caller that never closes it (Claude Code closes it at once), at most 1 MB.
const tty = Boolean(process.stdin.isTTY);
const input = tty ? Buffer.alloc(0) : await new Promise((resolve) => {
  const chunks = [];
  let size = 0;
  let timer = null;
  const done = () => { clearTimeout(timer); process.stdin.removeAllListeners("data"); process.stdin.destroy(); resolve(Buffer.concat(chunks)); };
  timer = setTimeout(done, 300);
  process.stdin.on("data", (d) => { chunks.push(d); size += d.length; if (size > 1_000_000) done(); });
  process.stdin.on("end", done);
  process.stdin.on("error", done);
});

/** A fresh stdin for one attempt: the same bytes, then the end. */
function replay() {
  const stream = new Readable({ read() { this.push(input); this.push(null); } });
  stream.isTTY = tty;
  return stream;
}

const write = process.stdout.write;
for (const copy of copies) {
  let target;
  try { target = realpathSync(copy.path); } catch { continue; }
  const before = process.env.HERDR_APP_HOME;
  if (copy.am && !before) process.env.HERDR_APP_HOME = appHome;
  process.argv[1] = target;
  Object.defineProperty(process, "stdin", { value: replay(), configurable: true, writable: true });
  const held = [];
  process.stdout.write = (chunk, encoding, callback) => {
    held.push(typeof chunk === "string" ? Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8") : Buffer.from(chunk));
    const done = typeof encoding === "function" ? encoding : callback;
    if (done) queueMicrotask(done);
    return true;
  };
  let ok = false;
  try {
    await import(pathToFileURL(target).href);
    ok = true;
  } catch (e) {
    process.stderr.write(`automagik-herdr briefing: ${firstLine(e)}\n`);
    if (copy.am && !before) delete process.env.HERDR_APP_HOME;
    process.exitCode = 0;
  } finally {
    process.stdout.write = write;
  }
  if (ok) {
    if (held.length) process.stdout.write(Buffer.concat(held));
    break;
  }
}
