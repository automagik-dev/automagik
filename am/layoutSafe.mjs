// The one door for a folder leaving mods/ or a file leaving layouts/ (refs #431, #448, #450): every
// route (am uninstall, the pack's update, rename, rollback and repair, the rename migration's layout
// writes) hands its file operations to change(), which first works out what the layouts Herdr could
// show need, decides per the caller's options, and only then does the operations itself, journalled:
// on a failure every one already done is undone. Node only (like update.mjs); Herdr never loads this
// file, and mods/am-mods (which runs inside Herdr, through its io) keeps its own copy of the two
// guards it shares with release.js. Apache-2.0.
//
// Which layouts could be shown: the one Herdr shows when `ask` gets its tree, else every file in
// layouts/. Which mods they need: their blocks' content.mod, read by name (release.js layoutNeeds),
// so a mod folder that is a link still counts. Which operations matter: one that takes a mod folder
// out of mods/ for good (nothing later in the batch puts one back), one that removes or moves the
// shown layout's file, and one that writes through a link inside the app home (a linked mod folder
// or layouts/). Each caller says what each of those does to it, so today's behaviour is kept, gaps
// included: the options that keep a gap open are named in the issue's comment where they are passed.

import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { layoutGuard, layoutNeeds, packageLayoutGuard } from "./release.js";

const lstat = (path) => { try { return lstatSync(path); } catch { return null; } };
const isLink = (path) => Boolean(lstat(path)?.isSymbolicLink());
const isDir = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const isFile = (path) => { try { return statSync(path).isFile(); } catch { return false; } };

/** What a refusal adds after "Switch layouts first": the command, left out while main is shown (it names main). */
export const switchCommand = (shown) => (typeof shown === "string" && shown.toLowerCase() === "main" ? ""
  : `; from a terminal: herdr-app do layout.switch '{"name":"main"}'`);

/** Where an operation reads and writes: `[from, to]` for a move or a replace, `[path]` for a remove. */
const pathsOf = (op) => (op.op === "remove" ? [op.path] : [op.from, op.to]);

/** Whether `path`, inside `home`, is reached through a link: a folder between `home` and it is one. */
function throughLink(home, path) {
  const rel = relative(home, resolve(path));
  if (!rel || rel.startsWith("..") || rel.startsWith(sep)) return false;
  const parts = rel.split(sep).slice(0, -1);
  let at = home;
  return parts.some((p) => isLink((at = join(at, p))));
}

/** The layouts in layouts/ (names, sorted) whose blocks name one of `mods`, `skip` (file names) left out. */
function layoutsNaming(home, mods, skip = []) {
  const dir = join(home, "layouts");
  return (isDir(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith(".json") && !skip.includes(f)).sort().flatMap((f) => {
    let blocks;
    try { blocks = layoutNeeds(JSON.parse(readFileSync(join(dir, f), "utf8"))).blocks; } catch { return []; }
    const named = mods.filter((m) => blocks.has(m));
    return named.length ? [{ name: f.slice(0, -".json".length), mods: named }] : [];
  });
}

/**
 * The layouts in layouts/ (names, sorted) whose blocks name `mod`; an unreadable one names none.
 * `exclude(name, body)`: a file the caller knows will not stay (the pack's own unedited copy).
 */
function layoutsShowing(home, mod, exclude) {
  const dir = join(home, "layouts");
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort(); } catch { return []; }
  return names.filter((n) => {
    try {
      const file = join(dir, n);
      if (!isFile(file) || (exclude && exclude(n, () => readFileSync(file)))) return false;
      return layoutNeeds(JSON.parse(readFileSync(file, "utf8"))).blocks.has(mod);
    } catch { return false; }
  }).map((n) => n.slice(0, -".json".length));
}

/** A name beside `path` nothing has, for a remove that stays undoable until the batch stands. */
function aside(path) {
  for (;;) {
    const at = join(dirname(path), `.${basename(path)}.am-rm-${process.pid}-${randomBytes(4).toString("hex")}`);
    if (!lstat(at)) return at;
  }
}

/**
 * Does `ops` on the app home `home`, once the layouts allow it. Each op is `{ op: "move", from, to }`
 * (with `mkdir`, the folder of `to` made first), `{ op: "replace", from, to }` (a rename over `to`; last in its batch: an
 * earlier `to` cannot be put back) or `{ op: "remove", path, force }` (missing and `force`: nothing;
 * missing without it: rmSync's own error). Options, all off unless given:
 * - `ask()`: the layout Herdr shows, `{ name, tree, why }` (parts.mjs shownLayout); not given, Herdr
 *   is not asked and every file in layouts/ could be shown.
 * - `mods`: the mod names checked (default: every mod folder the ops take out of mods/ for good);
 *   `modsDir`: that folder, when it is not <home>/mods (update.mjs takes any).
 * - `needed`: what an op taking a checked mod a layout needs does: "refuse" (with `ask`: the shown
 *   layout's blocks; the right-click menu's mod goes with a note), or "hold" (every file in layouts/,
 *   `exclude` leaving some out; for `renamed[mod]`, a rename's new name, `stranded(home, mod,
 *   renamed[mod])` instead: migrateHome's strandedLayouts, the files the migration cannot move):
 *   the op is dropped and the mod stays. Unset: not checked.
 * - `unknown`: with `ask` and no tree from it, "warn" logs each layout in layouts/ naming a checked
 *   mod (`skip`: file names left out) and goes on (fail open). Unset: nothing said.
 * - `shownFile`: "refuse" refuses an op that removes or moves the file of the layout Herdr shows,
 *   decided on its name (`ask`'s `name`) alone. Unset: not checked.
 * - `then`, `pack`: the refusal's and the warning's wording ("uninstall it"; the whole pack).
 * - `prepare(decision)`: runs once the decision stands, before the first op (a throw stops it all).
 * - `rename`: the rename of moves and replaces (injectable for tests; an undo uses renameSync).
 * - `log`: where notes and warnings go.
 * Writing through a link is found and returned (`throughLinks`), never refused here: each caller
 * still checks the links it checks today.
 * Returns `{ refused, held, notes, shown, throughLinks, done }`: `refused` is the reason, nothing done.
 */
export function change(home, ops, options = {}) {
  const {
    ask = null, mods = null, needed = null, unknown = null, shownFile = null, then = "uninstall it", pack = false,
    skip = [], exclude = null, renamed = {}, stranded = null, prepare = null, rename = renameSync, log = () => {},
  } = options;
  const root = home ? resolve(home) : null;
  const modsDir = options.modsDir ? resolve(options.modsDir) : root && join(root, "mods");
  // A mod folder leaves for good when no later op puts one back at the same place.
  const takes = (i) => {
    const from = ops[i].op === "remove" ? ops[i].path : ops[i].op === "move" ? ops[i].from : null;
    if (!from || !modsDir || dirname(resolve(from)) !== modsDir) return null;
    const back = ops.slice(i + 1).some((o) => o.op !== "remove" && resolve(o.to) === resolve(from));
    return back ? null : basename(from);
  };
  const taken = ops.map((_, i) => takes(i));
  const checked = (mods ?? taken.filter(Boolean));
  const decision = { refused: null, held: [], notes: [], shown: null, throughLinks: [], done: false };
  if (root) decision.throughLinks = [...new Set(ops.flatMap(pathsOf).filter((p) => throughLink(root, p)))];
  let shown = null;
  const shownOnce = () => (shown ??= ask ? ask() : { name: null, tree: null, why: null });

  if (shownFile === "refuse" && ask) {
    const files = ops.filter((o) => o.op !== "replace").map((o) => (o.op === "remove" ? o.path : o.from))
      .filter((p) => root && dirname(resolve(p)) === join(root, "layouts")).map((p) => basename(p));
    if (files.length) {
      decision.shown = shownOnce();
      const guard = packageLayoutGuard({ name: decision.shown.name, layouts: files, then });
      if (guard) return { ...decision, refused: `${guard.refuse}${switchCommand(decision.shown.name)}` };
    }
  }

  const drop = new Set();
  if (needed === "refuse" && ask && checked.length) {
    decision.shown = shownOnce();
    const s = decision.shown;
    if (s.tree) {
      const guards = checked.map((mod) => ({ mod, ...layoutGuard({ name: s.name, tree: s.tree, mod, then }) }));
      const refused = guards.filter((g) => g.refuse);
      const also = refused.slice(1).map((g) => g.mod);
      if (refused.length) {
        return { ...decision, refused: `${refused[0].refuse}${also.length ? ` (its blocks name ${also.join(", ")} too)` : ""}${switchCommand(s.name)}` };
      }
      for (const g of guards) if (g.note) { decision.notes.push(`${g.mod} was ${g.note}`); log(`${g.mod} was ${g.note}`); }
    } else if (unknown === "warn") {
      const naming = layoutsNaming(root, checked, skip);
      if (naming.length) {
        const what = pack ? "uninstalling the pack" : `switching ${checked[0]} off`;
        const list = pack ? naming.map((l) => `${l.name} (${l.mods.join(", ")})`) : naming.map((l) => l.name);
        const back = pack ? "`am install herdr.pack` puts the pack back" : `\`am install herdr.${checked[0]}\` switches it back on`;
        const line = `${what} without knowing the layout Herdr shows (${s.why}): ${list.join(", ")} `
          + `show${naming.length === 1 ? "s" : ""} ${pack ? "the pack's mods" : "it"}, and Herdr drops a layout whose mod is ${pack ? "gone" : "off"} (plain Herdr instead). `
          + `Showing one? Switch layouts (ctrl-shift-l), or ${back}`;
        decision.notes.push(line);
        log(line);
      }
    }
  } else if (needed === "hold" && root) {
    for (const [i, mod] of taken.entries()) {
      if (!mod || !checked.includes(mod)) continue;
      const showing = Object.hasOwn(renamed, mod)
        ? stranded(root, mod, renamed[mod]).map((f) => basename(f, ".json"))
        : layoutsShowing(root, mod, exclude);
      if (!showing.length) continue;
      decision.held.push(Object.hasOwn(renamed, mod) ? { mod, renamed: renamed[mod], layouts: showing } : { mod, layouts: showing });
      drop.add(i);
    }
  }

  prepare?.(decision);
  const done = [];
  const trash = [];
  try {
    for (const [i, op] of ops.entries()) {
      if (drop.has(i)) continue;
      if (op.op === "remove") {
        if (!lstat(op.path)) {
          if (op.force) continue;
          rmSync(op.path);
        }
        const at = aside(op.path);
        renameSync(op.path, at);
        done.push([op.path, at]);
        trash.push(at);
        continue;
      }
      if (op.op === "move" && op.mkdir) mkdirSync(dirname(op.to), { recursive: true });
      rename(op.from, op.to);
      done.push([op.from, op.to]);
    }
  } catch (error) {
    for (const [from, to] of done.reverse()) renameSync(to, from);
    throw error;
  }
  for (const at of trash) rmSync(at, { recursive: true, force: true });
  decision.done = true;
  return decision;
}
