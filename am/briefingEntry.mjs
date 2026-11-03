// The briefing hook's fixed entry point (Group 6b). The pack copies this file to
// <app home>/automagik-herdr/briefing.mjs, outside mods/, and every Claude bot's and worker's
// hook runs that copy; the am part (RFC 0012) writes the same bytes there from its own copy. It
// runs the first briefing.mjs it can: am's (<AM_HOME, else ~/.automagik>/parts/automagik.am/
// current/), then the installed sidebar folder's (mods/am-sidebar, else mods/spaces-agents), so a
// hook survives the sidebar being switched off, the folder's rename and a rollback across it. A
// copy that is missing, or whose import throws, is passed over for the next one: a broken am never
// silences a briefing. am's copy lives outside the app home, so it is told the app home
// (HERDR_APP_HOME, when unset) that a sidebar copy finds from its own place. briefing.mjs runs only
// as the program node started, so the script becomes argv[1] before it is imported (stdin, env and
// exit code stay this process's). Fail-open like briefing.mjs: none found, nothing printed, exit 0.
// The installer, the updater and am replace the copy; edits to it are lost. Apache-2.0.

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appHome = dirname(dirname(fileURLToPath(import.meta.url)));
const amHome = process.env.AM_HOME || join(homedir(), ".automagik");
const copies = [
  { path: join(amHome, "parts", "automagik.am", "current", "briefing.mjs"), am: true },
  ...["am-sidebar", "spaces-agents"].map((m) => ({ path: join(appHome, "mods", m, "briefing.mjs"), am: false })),
];
const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

for (const copy of copies) {
  let target;
  try { target = realpathSync(copy.path); } catch { continue; }
  const before = process.env.HERDR_APP_HOME;
  if (copy.am && !before) process.env.HERDR_APP_HOME = appHome;
  process.argv[1] = target;
  try {
    await import(pathToFileURL(target).href);
    break;
  } catch (e) {
    process.stderr.write(`automagik-herdr briefing: ${firstLine(e)}\n`);
    if (copy.am && !before) delete process.env.HERDR_APP_HOME;
    process.exitCode = 0;
  }
}
