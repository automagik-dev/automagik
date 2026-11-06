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
// or layouts/). Each caller says what each of those does to it: the pack's uninstalls refuse the
// shown layout's own file (#450) and leave what a link reaches (#448).

import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { layoutGuard, layoutNeeds, packageLayoutGuard } from "./release.js";

const lstat = (path) => { try { return lstatSync(path); } catch { return null; } };
const isLink = (path) => Boolean(lstat(path)?.isSymbolicLink());
const isDir = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const isFile = (path) => { try { return statSync(path).isFile(); } catch { return false; } };

/**
 * rmSync that never follows a link (#550): a link at `path`, live or dangling, is unlinked (never
 * its target); anything else goes to rmSync(path, options) as before (missing and `force`: nothing;
 * missing without it: rmSync's own error). On Node 24.0 to 24.9 rmSync returns without an error on
 * a dangling link and leaves it there; unlinkSync removes it on every version.
 */
export function removePath(path, options) {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(path);
  else rmSync(path, options);
}

/** What a refusal adds after "Switch layouts first": the command, left out while main is shown (it names main). */
export const switchCommand = (shown) => (typeof shown === "string" && shown.toLowerCase() === "main" ? ""
  : `; from a terminal: herdr-app do layout.switch '{"name":"main"}'`);

/**
 * The refusal of a linked mods/ (#494): `modsDir` is a link to `target` (its text as written), the
 * person's folder, so nothing is moved in or out through it. install.sh's linked_mods_line and
 * mods/am-mods core.js linkedModsLine say the same words.
 */
export const linkedModsLine = (modsDir, target) => `mods/ (${modsDir}) is a link to ${target}, your own folder, not one this install made: `
  + "nothing is moved through it, and the folders in it stay as they are. Put that folder in the link's place (a plain mods/), then run this again";

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
 * `exclude(name, body, mod)`: a file the caller knows will not stay (the pack's own unedited copy),
 * or will not name `mod` by then (a rollback's reverted migration edits).
 */
function layoutsShowing(home, mod, exclude) {
  const dir = join(home, "layouts");
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort(); } catch { return []; }
  return names.filter((n) => {
    try {
      const file = join(dir, n);
      if (!isFile(file) || (exclude && exclude(n, () => readFileSync(file), mod))) return false;
      return layoutNeeds(JSON.parse(readFileSync(file, "utf8"))).blocks.has(mod);
    } catch { return false; }
  }).map((n) => n.slice(0, -".json".length));
}

/** The files in layouts/ (sorted) that do not parse, `exclude` leaving some out (as layoutsShowing's). */
function layoutsUnreadable(home, exclude) {
  const dir = join(home, "layouts");
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort(); } catch { return []; }
  return names.filter((n) => {
    const file = join(dir, n);
    try {
      if (!isFile(file) || (exclude && exclude(n, () => readFileSync(file)))) return false;
      JSON.parse(readFileSync(file, "utf8"));
      return false;
    } catch { return true; }
  });
}

/**
 * The files in layouts/ (sorted) that do not parse but whose text still names one of `mods` in a
 * block ("mod": "<m>", as install.sh's grep reads it): `[{ file, mods }]`, `exclude` leaving some
 * out (as layoutsShowing's). No layout can be read from them, so a route that goes on says so (#489).
 */
function layoutsUnreadNaming(home, mods, exclude) {
  const dir = join(home, "layouts");
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort(); } catch { return []; }
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return names.flatMap((n) => {
    const file = join(dir, n);
    let text;
    try {
      if (!isFile(file) || (exclude && exclude(n, () => readFileSync(file)))) return [];
      text = readFileSync(file, "utf8");
      JSON.parse(text);
      return [];
    } catch { if (typeof text !== "string") return []; }
    const named = mods.filter((m) => new RegExp(`"mod"\\s*:\\s*"${esc(m)}"`).test(text));
    return named.length ? [{ file: n, mods: named }] : [];
  });
}

/** The fail-open line of a route Herdr is not asked for, when layouts/ files `unread` do not read (#488, #489). */
const unreadLine = (unread, mods) => `going on without knowing the layout Herdr shows (Herdr is not asked here, and layouts/${unread.join(", layouts/")} `
  + `do${unread.length === 1 ? "es" : ""} not read): if one names ${mods.join(", ")} and Herdr shows it, Herdr drops it (plain Herdr instead)`;

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
 *   layout's blocks; the right-click menu's mod goes with a note; without it: every file in layouts/,
 *   `exclude` leaving some out, nothing done; a rollback's, #488), or "hold" (every file in layouts/,
 *   `exclude` leaving some out; for `renamed[mod]`, a rename's new name, `stranded(home, mod,
 *   renamed[mod])` instead: migrateHome's strandedLayouts, the files the migration cannot move):
 *   the op is dropped and the mod stays. Unset: not checked.
 * - `unknown`: with `ask` and no tree from it, "warn" logs each layout in layouts/ naming a checked
 *   mod (`skip`: file names left out), then each file there that does not parse but names one in
 *   its text (`skip` not applied), and goes on (fail open); with "refuse" and no `ask`, when no
 *   layout refused, it logs the files in layouts/ that do not read and goes on; with "hold", it
 *   logs the files that do not parse but name a mod that still leaves in their text (`exclude`
 *   leaving some out) and goes on (#489); with `shownFile` and no name from `ask` (Herdr did not
 *   answer), it logs each file in layouts/ the ops remove that parses, with the checked mods its
 *   blocks name, and each one `links` keeps whose blocks name one, and goes on (#487). Unset:
 *   nothing said.
 * - `shownFile`: "refuse" refuses an op that removes or moves the file of the layout Herdr shows,
 *   decided on its name (`ask`'s `name`) alone, once `needed` has passed (its refusal, about a mod,
 *   comes first). Unset: not checked.
 * - `links`: "hold-layouts" leaves a removal or a move of a file in layouts/ where it is while
 *   <home>/layouts is a link (the person's folder, #448): dropped, listed in `left`, and never
 *   refused by `shownFile` (it stays). Only layouts/: a mod folder below a linked mods/ moves as
 *   before. Unset: done through the link.
 * - `then`, `pack`: the refusal's and the warning's wording ("uninstall it"; the whole pack).
 * - `prepare(decision)`: runs once the decision stands, before the first op (a throw stops it all).
 * - `rename`: the rename of moves and replaces (injectable for tests; an undo uses renameSync).
 * - `log`: where notes and warnings go.
 * Writing through a link is found and returned (`throughLinks`), never refused here: each caller
 * still checks the links it checks today, or passes `links: "hold-layouts"`. One link is always
 * refused, first: mods/ itself (`modsDir`) a link, while an op reads or writes in it (#494,
 * linkedModsLine); a caller throws the reason, as for any refusal.
 * Returns `{ refused, held, left, notes, shown, throughLinks, done }`: `refused` is the reason, nothing done.
 */
export function change(home, ops, options = {}) {
  const {
    ask = null, mods = null, needed = null, unknown = null, shownFile = null, links = null, then = "uninstall it", pack = false,
    skip = [], exclude = null, renamed = {}, stranded = null, prepare = null, rename = renameSync, log = () => {},
  } = options;
  const root = home ? resolve(home) : null;
  const modsDir = options.modsDir ? resolve(options.modsDir) : root && join(root, "mods");
  // A linked mods/ (#494) is the person's folder: an op reading or writing in it is refused before
  // anything else (no layout asked, nothing done), whatever the caller's options.
  const inMods = (p) => Boolean(modsDir) && resolve(p).startsWith(modsDir + sep);
  if (modsDir && isLink(modsDir) && ops.some((op) => pathsOf(op).some(inMods))) {
    return { refused: linkedModsLine(modsDir, readlinkSync(modsDir)), held: [], left: [], notes: [], shown: null, throughLinks: [], done: false };
  }
  // A mod folder leaves for good when no later op puts one back at the same place.
  const takes = (i) => {
    const from = ops[i].op === "remove" ? ops[i].path : ops[i].op === "move" ? ops[i].from : null;
    if (!from || !modsDir || dirname(resolve(from)) !== modsDir) return null;
    const back = ops.slice(i + 1).some((o) => o.op !== "remove" && resolve(o.to) === resolve(from));
    return back ? null : basename(from);
  };
  const taken = ops.map((_, i) => takes(i));
  const checked = (mods ?? taken.filter(Boolean));
  const decision = { refused: null, held: [], left: [], notes: [], shown: null, throughLinks: [], done: false };
  if (root) decision.throughLinks = [...new Set(ops.flatMap(pathsOf).filter((p) => throughLink(root, p)))];
  let shown = null;
  const shownOnce = () => (shown ??= ask ? ask() : { name: null, tree: null, why: null });

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
      // A layout that does not parse but whose text names a checked mod (#489: with nothing
      // readable, the route said nothing): said too, the pack's own file included (`skip` is for
      // a layout that reads), since Herdr may show it.
      const unread = layoutsUnreadNaming(root, checked);
      if (unread.length) {
        const what = pack ? "uninstalling the pack" : `switching ${checked[0]} off`;
        const list = pack ? unread.map((l) => `layouts/${l.file} (${l.mods.join(", ")})`) : unread.map((l) => `layouts/${l.file}`);
        const back = pack ? "`am install herdr.pack` puts the pack back" : `\`am install herdr.${checked[0]}\` switches it back on`;
        const one = unread.length === 1;
        const line = `${what} without knowing the layout Herdr shows (${s.why}), and ${list.join(", ")} do${one ? "es" : ""} not read: `
          + `${one ? "its" : "their"} text names ${pack ? "the pack's mods" : "it"}, and Herdr drops a layout whose mod is ${pack ? "gone" : "off"} (plain Herdr instead). `
          + `Showing ${one ? "it" : "one"}? Switch layouts (ctrl-shift-l), or ${back}`;
        decision.notes.push(line);
        log(line);
      }
    }
  } else if (needed === "refuse" && !ask && root && checked.length) {
    // Herdr not asked (a rollback, #488): any file in layouts/ could be shown, so one naming a
    // checked mod that leaves refuses, in heldModLine's wording; Herdr is not said to show it.
    const naming = taken.filter((mod) => mod && checked.includes(mod)).map((mod) => ({ mod, layouts: layoutsShowing(root, mod, exclude) }))
      .filter((n) => n.layouts.length);
    if (naming.length) {
      const [{ mod, layouts }] = naming;
      const also = naming.slice(1).map((n) => n.mod);
      const which = layouts.length === 1 ? `the ${layouts[0]} layout still names it` : `the layouts ${layouts.join(", ")} still name it`;
      return { ...decision, refused: `${mod} would leave mods/, but ${which}${also.length ? ` (and a layout names ${also.join(", ")} too)` : ""}, `
        + `and Herdr drops a layout whose mod is gone (plain Herdr instead). Take ${mod} out of ${layouts.length === 1 ? "that layout" : "those layouts"}`
        + ` (switch layouts first, ctrl-shift-l, if Herdr shows one), then ${then}` };
    }
    const unread = unknown === "warn" ? layoutsUnreadable(root, exclude) : [];
    if (unread.length) {
      const line = unreadLine(unread, checked);
      decision.notes.push(line);
      log(line);
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
    // A mod that still leaves while a layout that does not parse names it in its text (#489): it
    // goes (fail open, as a rollback's), said.
    const leaving = taken.filter((mod, i) => mod && checked.includes(mod) && !drop.has(i));
    const unread = unknown === "warn" && leaving.length ? layoutsUnreadNaming(root, leaving, exclude) : [];
    if (unread.length) {
      const line = unreadLine(unread.map((l) => l.file), [...new Set(unread.flatMap((l) => l.mods))]);
      decision.notes.push(line);
      log(line);
    }
  }

  // A file in a linked layouts/ (#448: the person's folder) is left where it is with
  // `links: "hold-layouts"`; nothing else is held for a link.
  const inLayouts = (p) => Boolean(root) && dirname(resolve(p)) === join(root, "layouts");
  const leaves = (op) => (op.op === "remove" ? op.path : op.from);
  const kept = new Set();
  if (links === "hold-layouts" && root && isLink(join(root, "layouts"))) {
    for (const [i, op] of ops.entries()) if (!drop.has(i) && op.op !== "replace" && inLayouts(leaves(op))) kept.add(i);
  }

  // After the mods (their refusal comes first, in their wording): the shown layout's own file, even
  // when no mod it names leaves (#450: each is a link the batch leaves in place). A file kept above
  // is not taken away, so it is not refused.
  if (shownFile === "refuse" && ask) {
    const files = ops.filter((o, i) => o.op !== "replace" && !kept.has(i)).map(leaves)
      .filter(inLayouts).map((p) => basename(p));
    if (files.length) {
      decision.shown = shownOnce();
      const guard = packageLayoutGuard({ name: decision.shown.name, layouts: files, then });
      if (guard) return { ...decision, refused: `${guard.refuse}${switchCommand(decision.shown.name)}` };
    }
    // Herdr did not answer (no name at all), so no file could be refused for being the one it
    // shows (#487): each one this removes is said, with the checked mods its blocks name (`skip`
    // leaves it out of the list of layouts that stay), and so is one a linked layouts/ keeps while
    // its blocks name one. One that does not parse is #489's line's.
    const keptFiles = [...kept].map((i) => basename(leaves(ops[i])));
    if (unknown === "warn" && (files.length || keptFiles.length) && (decision.shown = shownOnce()).name == null) {
      const why = decision.shown.why;
      const after = `If Herdr shows it, Herdr drops it (plain Herdr instead): switch layouts (ctrl-shift-l)${pack ? ", or `am install herdr.pack` puts the pack back" : ""}`;
      for (const [f, stays] of [...files.map((f) => [f, false]), ...keptFiles.map((f) => [f, true])]) {
        let blocks;
        try { blocks = layoutNeeds(JSON.parse(readFileSync(join(root, "layouts", f), "utf8"))).blocks; } catch { continue; }
        const named = checked.filter((m) => blocks.has(m));
        const leave = `${named.join(", ")}, which leave${named.length === 1 ? "s" : ""} mods/`;
        if (stays && !named.length) continue;
        const line = stays
          ? `keeping layouts/${f} without knowing the layout Herdr shows (${why}): layouts/ is a link, your own folder, so it stays, but its blocks name ${leave}. ${after}`
          : `removing layouts/${f} without knowing the layout Herdr shows (${why}), so it may be the one shown${named.length ? `: its blocks name ${leave} too` : ""}. ${after}`;
        decision.notes.push(line);
        log(line);
      }
    }
  }

  for (const i of kept) { decision.left.push(leaves(ops[i])); drop.add(i); }

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
  // A removed mod folder or layout file may be a link, dangling too: unlinked, its target left.
  for (const at of trash) removePath(at, { recursive: true, force: true });
  decision.done = true;
  return decision;
}
