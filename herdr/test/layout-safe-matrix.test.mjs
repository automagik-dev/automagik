// The layout-safety matrix (refs #431, #448, #450): every route that takes a folder out of mods/ or
// a file out of layouts/, against seven shapes of the app home, with the layout Herdr shows naming
// the mod. A row is safe when the shown layout keeps its bytes, every mod it names is still in
// mods/, nothing outside the app home changed (nothing written through a link), and a refusal or a
// hold names that layout in the guard's own wording. With no layout from Herdr and readable files
// (the fifth shape) a route may also go on, as today, when its warning names the layout and why
// (fail open); with nothing readable at all (the sixth), when it says why.
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
/** Herdr gives no layout (not running); every file in layouts/ reads. */
const NO_ANSWER = "Herdr does not answer, layout files readable";
/** Herdr gives no layout, and no file in layouts/ parses (each still names its mods in its text). */
const NOTHING = "no layout can be read";
/** #494: mods/ itself a link to the person's folder (outside the app home), Herdr showing the layout. */
const LINKED_MODS = "linked mods/ folder";
/** #494, with the layout Herdr shows (the person's) naming no mod, so no layout guard stops a route first. */
const LINKED_MODS_ANOTHER = "linked mods/ folder, another layout shown";
/** A refusal of a linked mods/ (#494): it names the link as the person's folder and moves nothing through it. */
const LINKED_MODS_REFUSAL = /mods\/ \(\S+\) is a link to \S+, your own folder, not one this install made: nothing is moved through it/;
export const SHAPES = ["plain folder", "symlinked mod folder", "symlinked layout file", "symlinked layouts folder", NO_ANSWER, NOTHING, LINKED_MODS];

/**
 * Today's gaps: `${route} | ${shape}` → the issue. "new" names a gap no issue tracks yet (reported
 * with this PR, not fixed in it). None left here (#494 closed the last); the mod manager's are in
 * layout-safe-matrix-mods.test.mjs.
 */
const PACK_ROUTES = ["pack uninstall", "pack uninstall --purge", "install.sh --uninstall"];
export const EXPECTED_FAIL = {};

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
  for (const d of [home, state, ext, bin]) mkdirSync(d, { recursive: true });
  // A linked mods/ (#494): the folders live in ext/mods, the person's folder, and mods/ points there.
  if (shape === LINKED_MODS) {
    mkdirSync(join(ext, "mods"), { recursive: true });
    symlinkSync(join(ext, "mods"), modsDir);
  } else mkdirSync(modsDir, { recursive: true });
  for (const m of mods) {
    if (shape === "symlinked mod folder" && named.includes(m)) {
      packFolder(join(ext, "checkout"), m, "0.1.0");
      symlinkSync(join(ext, "checkout", m), join(modsDir, m));
    } else packFolder(modsDir, m, "0.1.0");
  }
  write(join(state, "installed-by-install.sh"), formatMarker({ version: "0.1.0", mods, layout: "added" }));
  // With nothing readable, each layout (and the pack's reference copy) is cut off after its last
  // block: its text still names the mods, JSON.parse refuses it.
  const body = (v) => (shape === NOTHING ? json(v).replace(/\}\s*$/, ",\n") : json(v));
  write(join(state, "automagik.json"), body(pack));
  // layouts/: the pack's own copy, and the shown one when it is another; linked as the shape says.
  const files = { "automagik.json": body(pack) };
  if (shown !== "automagik") files[`${shown}.json`] = body(tree(...named));
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
  exe(join(bin, "herdr-app"), shape === NO_ANSWER || shape === NOTHING ? "#!/bin/sh\nexit 1\n"
    : `#!/bin/sh\n[ "$1" = status ] || exit 2\nprintf '{\\n  "layout": "%s",\\n  "zoom": false\\n}\\n' '${herdrShows}'\n`);
  // install.sh's bound on `herdr-app status`: long, as install.test.mjs's, so a loaded machine never
  // turns an answer into no answer (the fake answers at once, or fails at once).
  const env = {
    HOME: home, HERDR_APP_HOME: app, TMPDIR: root, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    AUTOMAGIK_HERDR_RELEASE_URL: `file://${join(root, "no-release")}`, AUTOMAGIK_HERDR_TTY: join(root, "no-tty"), AUTOMAGIK_HERDR_STATUS_SECONDS: "60",
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
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * A refusal or a hold in the guard's own wording, naming the layout `name`: layoutGuard's and
 * packageLayoutGuard's (release.js), install.sh layout_guard's, and heldModLine's for one layout
 * or several. Any other line naming it (a path, a banner) is not one.
 */
export const guardLine = (name) => {
  const n = esc(name);
  return new RegExp([
    `stays on: the ${n} layout shows it`,
    `the ${n} layout is this package's \\(layouts/${n}\\.json\\)`,
    `the pack stays: the ${n} layout shows `,
    `but the ${n} layout shows it`,
    `the ${n} layout still names it`,
    `the layouts (?:\\S+, )*${n}(?:, \\S+)* (?:show it|still name it)`,
  ].join("|"));
};
/** A fail-open warning naming the layout `name` among the ones it lists, with why Herdr gave none. */
export const failOpenLine = (name) => {
  const n = esc(name);
  return new RegExp([
    `without knowing the layout Herdr shows \\(.+\\): (?:.+, )?${n}(?: \\([^)]*\\))?(?:, .+)? shows? `,
    `without knowing the layout Herdr shows \\(.+\\): your layout ${n} \\(`,
    `${n}\\.json without knowing the layout Herdr shows \\(`,
  ].join("|"));
};
/** A fail-open line that says why, when no layout can be named (nothing reads). */
const FAIL_OPEN_REASON = /without knowing the layout Herdr shows|is Herdr running\?|no layout from herdr-app status/;

/** The verdict on one row: `{ safe, why }`. `rewrites`: the route may rewrite the layout (a rename's migration). */
function judge(m, before, outcome, { rewrites = false } = {}) {
  const after = snapshot(m);
  const lines = [outcome.error ?? "", ...m.logs, outcome.out ?? ""].join("\n").split("\n");
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
  // So does a refusal of a linked mods/ (#494), which moves nothing at all.
  const linkRefusal = /is a link \(a checkout\?\)/.test(outcome.error ?? "")
    || (m.shape === LINKED_MODS && LINKED_MODS_REFUSAL.test(outcome.error ?? ""));
  const named = lines.find((l) => guardLine(m.shown).test(l));
  if (stopped && !linkRefusal && !named) problems.push(`it stopped without the guard naming the ${m.shown} layout: ${lines.find((l) => l.trim()) ?? ""}`);
  // Fail open (no layout from Herdr): going on is today's rule, given the reason (and the layout, when one reads).
  const open = m.shape === NO_ANSWER ? lines.find((l) => failOpenLine(m.shown).test(l))
    : m.shape === NOTHING ? lines.find((l) => FAIL_OPEN_REASON.test(l)) : null;
  if (problems.length && open && !stopped && after.ext === before.ext) return { safe: true, why: `fail open: ${open}` };
  return { safe: problems.length === 0, why: problems.join("; ") || (stopped ? `stopped: ${named ?? outcome.error}` : "nothing the layout needs moved") };
}


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

/** Every route against the seven shapes, then the #448 rows, then #494's: [route, shape, the machine's options]. */
const ROWS = [
  ...Object.entries(ROUTES).flatMap(([route, spec]) => SHAPES.map((shape) => [route, shape, spec])),
  ...[...PACK_ROUTES, "herdr.layout uninstall", "herdr.layout uninstall --purge"]
    .map((route) => [route, LINKED_ANOTHER, { ...ROUTES[route], shown: "mine", named: [] }]),
  ...Object.entries(ROUTES).map(([route, spec]) => [route, LINKED_MODS_ANOTHER, { ...spec, shown: "mine", named: [] }]),
];

for (const [route, shape, spec] of ROWS) {
  const gap = EXPECTED_FAIL[`${route} | ${shape}`];
  test(`${route} | ${shape}${gap ? ` [expected-fail ${gap}]` : ""}`, async (t) => {
    const linked = shape === LINKED_ANOTHER ? "symlinked layouts folder" : shape === LINKED_MODS_ANOTHER ? LINKED_MODS : shape;
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
