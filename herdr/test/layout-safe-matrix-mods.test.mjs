// The layout-safety matrix's mod manager routes (refs #431): a package's update and its remove (x)
// in mods/am-mods, against the five shapes of layout-safe-matrix.test.mjs, with the layout Herdr
// shows (the package's own scratchy.json) naming its mod. The same verdict: the shown layout keeps
// its bytes, every mod it names is still in mods/, nothing outside the app home changed, and a
// refusal names the layout; with no layout from Herdr a route may go on when it says why.
// Expected-fail rows pass while the gap is there and fail once it is closed. The mod manager runs
// under the gpui and herdr stand-ins over a scratch HERDR_APP_HOME, and a package served from a
// local git repository (file://): no network, never the real Herdr home.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { registerHooks } from "node:module";

const here = (f) => new URL(f, import.meta.url).href;
const stubs = { herdr: here("./footer-herdr.mjs"), "gpui-kit": here("./gpui-stub.mjs"), "gpui-base": here("./gpui-stub.mjs") };
registerHooks({ resolve: (specifier, context, next) => (stubs[specifier] ? { url: stubs[specifier], shortCircuit: true } : next(specifier, context)) });
const { state, ui } = await import(stubs.herdr);
const { default: ModManager } = await import("../mods/am-mods/main.js");
const { layoutNeeds } = await import("../mods/am-sidebar/release.js");

const SHAPES = ["plain folder", "symlinked mod folder", "symlinked layout file", "symlinked layouts folder", "no readable layout"];
/** Today's gaps: `${route} | ${shape}` → the issue ("new": no issue tracks it yet). */
const NEW_FAIL_OPEN = "new gap: the remove fails open without saying why";
const NEW_UPDATE_MOD = "new gap: an update that stops shipping the shown layout's mod moves it aside";
const EXPECTED_FAIL = {
  ...Object.fromEntries(SHAPES.map((s) => [`package update dropping the shown layout | ${s}`, "#431"])),
  ...Object.fromEntries(SHAPES.map((s) => [`package update dropping the shown layout's mod | ${s}`, NEW_UPDATE_MOD])),
  "package remove | no readable layout": NEW_FAIL_OPEN,
};

const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const makeCx = () => {
  const cx = { pending: [], spawn(fn) { const p = Promise.resolve().then(() => fn(cx)); cx.pending.push(p); return p; },
    timer: { after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) }, notify() {}, stop_propagation() {},
    focus_handle: () => ({ focus() {} }) };
  cx.settle = async () => { while (cx.pending.length) await Promise.allSettled(cx.pending.splice(0)); };
  return cx;
};
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

const LAYOUT = { id: "root", children: [{ id: "p", content: { mod: "scratch" } }] };
const BODY = JSON.stringify(LAYOUT);

/**
 * A scratch app home with the package scratch installed by the mod manager (its mod and its layout
 * scratchy.json, which Herdr shows), in `shape`, and its source: a git repository whose head ships
 * the mod and, with `layout`, the layout too. Links point into `ext`, outside the app home.
 */
function machine(t, shape, { layout, mod = "scratch" }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "am-layout-safe-mods-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appHome = join(root, "app"), ext = join(root, "ext"), repo = join(root, "repo"), bin = join(root, "bin");
  mkdirSync(ext, { recursive: true });
  if (shape === "symlinked mod folder") {
    write(join(ext, "scratch", "mod.json"), "{}");
    mkdirSync(join(appHome, "mods"), { recursive: true });
    symlinkSync(join(ext, "scratch"), join(appHome, "mods", "scratch"));
  } else write(join(appHome, "mods", "scratch", "mod.json"), "{}");
  if (shape === "symlinked layouts folder") {
    write(join(ext, "layouts", "scratchy.json"), BODY);
    symlinkSync(join(ext, "layouts"), join(appHome, "layouts"));
  } else if (shape === "symlinked layout file") {
    write(join(ext, "scratchy.json"), BODY);
    mkdirSync(join(appHome, "layouts"), { recursive: true });
    symlinkSync(join(ext, "scratchy.json"), join(appHome, "layouts", "scratchy.json"));
  } else write(join(appHome, "layouts", "scratchy.json"), BODY);
  write(join(appHome, "installed.json"), "{}");
  write(join(bin, "herdr-app"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "herdr-app"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  t.after(() => { process.env.PATH = path; });
  // The package's next commit: its mod, and its layout only with `layout`.
  write(join(repo, "mods", mod, "main.js"), "// v2\n");
  write(join(repo, "mods", mod, "mod.json"), "{}");
  if (layout) write(join(repo, "layouts", "scratchy.json"), BODY);
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", repo, ...args], { encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("add", "-A");
  git("commit", "-qm", "next");
  const source = `file://${repo}`;
  state.appHome = appHome;
  state.shared.clear?.();
  ui.props = {};
  state.shared.set("am.mods.installed", [{ source, prefix: "", sha: "abcdef1234", mods: ["scratch"], layouts: ["scratchy.json"], keys: [] }]);
  if (shape === "no readable layout") ui.layout = null;
  else { ui.layout = LAYOUT; state.shared.set("layout", "scratchy"); }
  return { root, appHome, ext, source, shape, shown: "scratchy" };
}

const snapshot = (m) => {
  let body = null;
  try { body = readFileSync(join(m.appHome, "layouts", "scratchy.json"), "utf8"); } catch {}
  return { body, ext: treeSum(m.ext) };
};
const FAIL_OPEN_REASON = /without knowing the layout Herdr shows|no layout to read|is Herdr running\?/;

function judge(m, before, said, stopped) {
  const after = snapshot(m);
  const problems = [];
  if (after.body === null) problems.push("layouts/scratchy.json is gone");
  else if (after.body !== before.body) problems.push("layouts/scratchy.json changed");
  const needs = [...layoutNeeds(LAYOUT).blocks];
  const missing = needs.filter((mod) => { try { return !statSync(join(m.appHome, "mods", mod)).isDirectory(); } catch { return true; } });
  if (missing.length) problems.push(`mods/${missing.join(", mods/")} left mods/`);
  if (after.ext !== before.ext) problems.push("something outside the app home changed (written through a link)");
  if (stopped && !said.includes(m.shown)) problems.push(`it stopped without naming the ${m.shown} layout: ${said}`);
  if (problems.length && m.shape === "no readable layout" && !stopped && after.ext === before.ext && said.includes(m.shown) && FAIL_OPEN_REASON.test(said)) {
    return { safe: true, why: `fail open: ${said}` };
  }
  return { safe: problems.length === 0, why: problems.join("; ") || (stopped ? `stopped: ${said}` : `went on: ${said}`) };
}

const update = async (m) => {
  const cx = makeCx();
  const view = new ModManager();
  view.init({}, cx);
  await cx.settle();
  await view.startReview(cx, m.source);
  await view.install(cx);
  await cx.settle();
  return { said: view.message ?? "", stopped: false };
};

/** route → [what its machine's next commit ships, how it runs]. */
const ROUTES = {
  // The package's next commit no longer ships its layout Herdr shows (#431's case).
  "package update dropping the shown layout": [{ layout: false }, update],
  // The next commit ships the layout, but its mod under another name: the old one is moved aside.
  "package update dropping the shown layout's mod": [{ layout: true, mod: "other" }, update],
  // x on the package, then y when it asks.
  "package remove": [{ layout: false }, async (m) => {
    const cx = makeCx();
    const view = new ModManager();
    view.init({}, cx);
    await cx.settle();
    view.at = view.grouped().rows.findIndex((r) => r.mod?.name === "scratch");
    view.onKey({ key: "x", key_char: "x" }, cx);
    await cx.settle();
    const asked = Boolean(view.confirm);
    if (asked) { view.onKey({ key: "y", key_char: "y" }, cx); await cx.settle(); }
    return { said: view.message ?? "", stopped: !asked };
  }],
};

for (const [route, [next, go]] of Object.entries(ROUTES)) {
  for (const shape of SHAPES) {
    const gap = EXPECTED_FAIL[`${route} | ${shape}`];
    test(`${route} | ${shape}${gap ? ` [expected-fail ${gap}]` : ""}`, async (t) => {
      const m = machine(t, shape, next);
      const before = snapshot(m);
      const { said, stopped } = await go(m);
      const verdict = judge(m, before, said, stopped);
      t.diagnostic(`${verdict.safe ? "SAFE" : "UNSAFE"}: ${verdict.why}`);
      if (gap) assert.ok(!verdict.safe, `${route} | ${shape} is safe now: drop its expected-fail mark (${gap})`);
      else assert.ok(verdict.safe, `${route} | ${shape}: ${verdict.why}`);
    });
  }
}
