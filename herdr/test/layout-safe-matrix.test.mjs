// The layout-safety matrix (refs #431, #448, #450): every route that takes a folder out of mods/ or
// a file out of layouts/, against five shapes of the app home, with the layout Herdr shows naming
// the mod. A row is safe when the shown layout keeps its bytes, every mod it names is still in
// mods/, nothing outside the app home changed (nothing written through a link), and a refusal or a
// hold names the layout. With no layout from Herdr (the fifth shape) a route may also go on, as
// today, when its output gives the reason and names the layout (fail open).
//
// A row that is unsafe today is marked expected-fail with its issue (EXPECTED_FAIL below): it
// passes while the gap is there and fails once the gap is closed, so the fix (PR B) drops its mark
// on purpose. Only fake homes: a temp app home and HOME, a fake herdr-app on a PATH of their own,
// never the real Herdr home (the pack auto-updates there). The am-mods routes (package update and
// remove) are in layout-safe-matrix-mods.test.mjs, which needs Herdr's stand-ins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contextOf, partOf, runCommand, uninstall } from "../mods/am-sidebar/parts.mjs";
import { formatMarker, layoutNeeds } from "../mods/am-sidebar/release.js";
import { applyUpdate, migrateRefs, prevSetOf, rollback } from "../mods/am-sidebar/update.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INSTALL = join(ROOT, "install.sh");

/** The crafted pack: three folders, am-tabs the one the shown layout names. */
const MODS = ["am-sidebar", "am-tabs", "am-status"];
const MOD = "am-tabs";
const OLD = "auto-tabs"; // am-tabs's name before the rename (migrate.js RENAMES)
const tree = (...mods) => ({ id: "root", children: mods.map((m, i) => ({ id: `b${i}`, content: { mod: m } })) });
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** The extra shape for #448: layouts/ linked, Herdr showing a layout of the person's that names no pack mod. */
const LINKED_ANOTHER = "symlinked layouts folder, another layout shown";
export const SHAPES = ["plain folder", "symlinked mod folder", "symlinked layout file", "symlinked layouts folder", "no readable layout"];

/**
 * Today's gaps: `${route} | ${shape}` → the issue. "new" names a gap no issue tracks yet (reported
 * with this PR, not fixed in it).
 */
const NEW_ROLLBACK = "new gap: a rollback asks no layout before a mod leaves mods/";
const NEW_FAIL_OPEN = "new gap: with no layout from Herdr, the pack's own layout and its mods go without saying why";
const PACK_ROUTES = ["pack uninstall", "pack uninstall --purge", "install.sh --uninstall"];
export const EXPECTED_FAIL = {
  ...Object.fromEntries(PACK_ROUTES.map((r) => [`${r} | symlinked mod folder`, "#450"])),
  ...Object.fromEntries(PACK_ROUTES.map((r) => [`${r} | no readable layout`, NEW_FAIL_OPEN])),
  ...Object.fromEntries(SHAPES.filter((s) => s !== "symlinked mod folder").map((s) => [`rollback | ${s}`, NEW_ROLLBACK])),
  // #448: the pack's layout in a linked layouts/ while Herdr shows another one (with it shown, the
  // guard refuses first): the uninstall deletes the person's file through the link.
  ...Object.fromEntries([...PACK_ROUTES, "herdr.layout uninstall", "herdr.layout uninstall --purge"]
    .map((r) => [`${r} | ${LINKED_ANOTHER}`, "#448"])),
};

const exe = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); chmodSync(path, 0o755); };
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };

/** One digest over every file and link under `dir` (names, link targets, bytes); "" when absent. */
function treeSum(dir) {
  if (!existsSync(dir)) return "";
  const h = createHash("sha256");
  const walk = (at, rel) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name), st = lstatSync(path);
      h.update(`${rel}${name}\0`);
      if (st.isSymbolicLink()) h.update(`->${readlinkSync(path)}`);
      else if (st.isDirectory()) walk(path, `${rel}${name}/`);
      else h.update(readFileSync(path));
    }
  };
  walk(dir, "");
  return h.digest("hex");
}

function packFolder(dir, m, version, shipped = MODS) {
  write(join(dir, m, "main.js"), `export const v = "${version}";\n`);
  write(join(dir, m, "mod.json"), '{ "place": "none" }\n');
  if (m === "am-sidebar") {
    write(join(dir, m, "VERSION"), `${version}\n`);
    write(join(dir, m, "release.js"), `export const PACK_MODS = ${JSON.stringify(shipped)};\n`);
    write(join(dir, m, "update.mjs"), "// the pack's updater\n");
  }
}

/** A release tarball at `version` shipping `mods` (as release.yml lays it out), under `root`. */
function tarball(root, version, mods) {
  const src = join(root, `src-${version}`);
  for (const m of mods) packFolder(src, m, version, mods);
  const out = join(root, `automagik-herdr-pack-${version}.tgz`);
  execFileSync("tar", ["czf", out, "-C", src, ...mods], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return out;
}

/**
 * A fake machine with the pack (MODS, or `mods`) installed at 0.1.0 by its record, in `shape`, the
 * layout `shown` (a file name without .json) naming `named`, and Herdr (a fake herdr-app) showing it.
 * `pack`: the body of the pack's own layouts/automagik.json (also its reference copy), recorded as
 * added. Everything a link points at lives in `ext`, outside the app home.
 */
export function machine(t, shape, { shown, named = [MOD], mods = MODS, pack = tree("am-sidebar"), herdrShows = shown } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "am-layout-safe-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home"), app = join(root, "app"), ext = join(root, "ext"), bin = join(root, "bin");
  const modsDir = join(app, "mods"), state = join(app, "automagik-herdr");
  for (const d of [home, modsDir, state, ext, bin]) mkdirSync(d, { recursive: true });
  for (const m of mods) {
    if (shape === "symlinked mod folder" && named.includes(m)) {
      packFolder(join(ext, "checkout"), m, "0.1.0");
      symlinkSync(join(ext, "checkout", m), join(modsDir, m));
    } else packFolder(modsDir, m, "0.1.0");
  }
  write(join(state, "installed-by-install.sh"), formatMarker({ version: "0.1.0", mods, layout: "added" }));
  write(join(state, "automagik.json"), json(pack));
  // layouts/: the pack's own copy, and the shown one when it is another; linked as the shape says.
  const files = { "automagik.json": json(pack) };
  if (shown !== "automagik") files[`${shown}.json`] = json(tree(...named));
  const layouts = join(app, "layouts");
  if (shape === "symlinked layouts folder") {
    for (const [f, body] of Object.entries(files)) write(join(ext, "layouts", f), body);
    symlinkSync(join(ext, "layouts"), layouts);
  } else {
    for (const [f, body] of Object.entries(files)) {
      if (shape === "symlinked layout file" && f === `${shown}.json`) {
        write(join(ext, f), body);
        mkdirSync(layouts, { recursive: true });
        symlinkSync(join(ext, f), join(layouts, f));
      } else write(join(layouts, f), body);
    }
  }
  // herdr-app: `status` names the shown layout, or fails (Herdr not running) for the fifth shape.
  exe(join(bin, "herdr-app"), shape === "no readable layout" ? "#!/bin/sh\nexit 1\n"
    : `#!/bin/sh\n[ "$1" = status ] || exit 2\nprintf '{\\n  "layout": "%s",\\n  "zoom": false\\n}\\n' '${herdrShows}'\n`);
  const env = {
    HOME: home, HERDR_APP_HOME: app, TMPDIR: root, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    AUTOMAGIK_HERDR_RELEASE_URL: `file://${join(root, "no-release")}`, AUTOMAGIK_HERDR_TTY: join(root, "no-tty"), AUTOMAGIK_HERDR_STATUS_SECONDS: "5",
  };
  const logs = [];
  const ctx = () => contextOf({ env, exec: (cmd, args, opts) => runCommand(cmd, args, opts), log: (l) => logs.push(l), platform: "darwin" });
  return { root, home, app, ext, modsDir, state, layouts, env, logs, ctx, shown, named, shape };
}

/** What a row checks, read before and after the route. */
function snapshot(m) {
  const file = join(m.layouts, `${m.shown}.json`);
  let body = null;
  try { body = readFileSync(file, "utf8"); } catch {}
  return { body, ext: treeSum(m.ext) };
}

/** The verdict on one row: `{ safe, why }`. `rewrites`: the route may rewrite the layout (a rename's migration). */
function judge(m, before, outcome, { rewrites = false } = {}) {
  const after = snapshot(m);
  const said = [outcome.error ?? "", ...m.logs, outcome.out ?? ""].join("\n");
  const problems = [];
  let parsed = null;
  try { parsed = JSON.parse(after.body); } catch {}
  if (after.body === null) problems.push(`layouts/${m.shown}.json is gone`);
  else if (!rewrites && after.body !== before.body) problems.push(`layouts/${m.shown}.json changed`);
  const needs = parsed ? [...layoutNeeds(parsed).blocks] : m.named;
  const missing = needs.filter((mod) => { try { return !statSync(join(m.modsDir, mod)).isDirectory(); } catch { return true; } });
  if (missing.length) problems.push(`mods/${missing.join(", mods/")} left mods/`);
  if (after.ext !== before.ext) problems.push("something outside the app home changed (written through a link)");
  const stopped = Boolean(outcome.error) || outcome.held;
  // A refusal of a link (a checkout's mod folder) moves nothing the layout needs: it need not name it.
  const linkRefusal = /is a link \(a checkout\?\)/.test(outcome.error ?? "");
  if (stopped && !linkRefusal && !said.includes(m.shown)) problems.push(`it stopped without naming the ${m.shown} layout: ${said.split("\n")[0]}`);
  // Fail open (no layout from Herdr): going on is today's rule, given the reason and the layout.
  if (problems.length && m.shape === "no readable layout" && !stopped && after.ext === before.ext
    && said.split("\n").some((l) => l.includes(m.shown) && FAIL_OPEN_REASON.test(l))) {
    return { safe: true, why: `fail open: ${said.split("\n").find((l) => l.includes(m.shown) && FAIL_OPEN_REASON.test(l))}` };
  }
  return { safe: problems.length === 0, why: problems.join("; ") || (stopped ? `stopped: ${said.split("\n").find((l) => l.includes(m.shown)) ?? said.trim().split("\n")[0]}` : "nothing the layout needs moved") };
}

/** A fail-open line says why the shown layout was not known (shownLayout's `why`, install.sh's layout_guard). */
const FAIL_OPEN_REASON = /without knowing the layout Herdr shows|is Herdr running\?|no layout from herdr-app status/;

const run = async (fn) => {
  try { return { ...(await fn()), error: null }; } catch (error) { return { error: error.message }; }
};

/** The routes: each sets up its machine and runs, returning `{ held?, out? }` or throwing. */
export const ROUTES = {
  "one-mod uninstall": {
    shown: "mine",
    go: (m) => uninstall(m.ctx(), partOf(`herdr.${MOD}`)),
  },
  "pack uninstall": {
    shown: "automagik", pack: tree(MOD),
    go: (m) => uninstall(m.ctx(), partOf("herdr.pack")),
  },
  "pack uninstall --purge": {
    shown: "automagik", pack: tree(MOD),
    go: (m) => uninstall(m.ctx(), partOf("herdr.pack"), { purge: true }),
  },
  "herdr.layout uninstall": {
    shown: "automagik", pack: tree(MOD),
    go: (m) => uninstall(m.ctx(), partOf("herdr.layout")),
  },
  "herdr.layout uninstall --purge": {
    shown: "automagik", pack: tree(MOD),
    go: (m) => uninstall(m.ctx(), partOf("herdr.layout"), { purge: true }),
  },
  "update retire": {
    shown: "mine",
    go: async (m) => {
      const r = await applyUpdate({ tgzPath: tarball(m.root, "0.2.0", MODS.filter((x) => x !== MOD)), version: "0.2.0", modsDir: m.modsDir, log: (l) => m.logs.push(l) });
      return { held: r.held.length > 0 };
    },
  },
  rename: {
    shown: "mine", named: [OLD], mods: ["am-sidebar", OLD, "am-status"], rewrites: true,
    go: async (m) => {
      const log = (l) => m.logs.push(l);
      const r = await applyUpdate({ tgzPath: tarball(m.root, "0.2.0", MODS), version: "0.2.0", modsDir: m.modsDir, log });
      migrateRefs({ modsDir: m.modsDir, log });
      return { held: r.held.length > 0 };
    },
  },
  rollback: {
    shown: "mine",
    setup: (m) => {
      // The kept set: the release before, which had no am-tabs.
      const prev = prevSetOf(m.modsDir);
      for (const x of MODS.filter((y) => y !== MOD)) packFolder(prev, x, "0.0.9");
      write(join(prev, ".pack"), formatMarker({ version: "0.0.9", mods: MODS.filter((y) => y !== MOD) }));
    },
    go: (m) => { rollback({ modsDir: m.modsDir, log: (l) => m.logs.push(l) }); return {}; },
  },
  repair: {
    shown: "mine",
    setup: (m) => { try { writeFileSync(join(m.modsDir, MOD, "main.js"), "// damaged\n"); } catch {} },
    go: async (m) => {
      await applyUpdate({ tgzPath: tarball(m.root, "0.1.0", MODS), version: "0.1.0", modsDir: m.modsDir, repair: [MOD], log: (l) => m.logs.push(l) });
      return {};
    },
  },
  "install.sh --uninstall": {
    shown: "automagik", pack: tree(MOD),
    go: (m) => {
      const r = spawnSync("sh", [INSTALL, "--uninstall"], { cwd: m.root, env: m.env, encoding: "utf8" });
      const out = `${r.stdout}${r.stderr}`;
      if (r.status !== 0) throw new Error(out.trim() || `install.sh exited ${r.status}`);
      return { out };
    },
  },
};

/** Every route against the five shapes, then the #448 rows: [route, shape, the machine's options]. */
const ROWS = [
  ...Object.entries(ROUTES).flatMap(([route, spec]) => SHAPES.map((shape) => [route, shape, spec])),
  ...[...PACK_ROUTES, "herdr.layout uninstall", "herdr.layout uninstall --purge"]
    .map((route) => [route, LINKED_ANOTHER, { ...ROUTES[route], shown: "mine", named: [] }]),
];

for (const [route, shape, spec] of ROWS) {
  const gap = EXPECTED_FAIL[`${route} | ${shape}`];
  test(`${route} | ${shape}${gap ? ` [expected-fail ${gap}]` : ""}`, async (t) => {
    const linked = shape === LINKED_ANOTHER ? "symlinked layouts folder" : shape;
    const m = machine(t, linked, { shown: spec.shown, named: spec.named, mods: spec.mods, pack: spec.pack });
    spec.setup?.(m);
    const before = snapshot(m);
    const outcome = await run(() => spec.go(m));
    const verdict = judge(m, before, outcome, { rewrites: spec.rewrites });
    t.diagnostic(`${verdict.safe ? "SAFE" : "UNSAFE"}: ${verdict.why}`);
    if (gap) assert.ok(!verdict.safe, `${route} | ${shape} is safe now: drop its expected-fail mark (${gap})`);
    else assert.ok(verdict.safe, `${route} | ${shape}: ${verdict.why}`);
  });
}
