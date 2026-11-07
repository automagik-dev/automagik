// The sidebar loads in Herdr's mod runtime (gpui-shell 0.7.1), which provides exactly the
// modules gpui-kit.d.ts declares and no `node:` prefix. A specifier outside that surface fails
// the whole mod at load ("am-sidebar did not load: cannot load module node:url", #624), so walk
// main.js's static import graph and hold every file to the runtime's names. It checks the small
// named surfaces too: `url` exports only URL and URLSearchParams, so changing the specifier to
// `"url"` while importing fileURLToPath still fails. The list is the `declare module "<name>"`
// names of the gpui-kit.d.ts the Herdr app installs into a mod folder (it is not in this
// repository); when that file is readable, the row checks the list against it. Apache-2.0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GUARD_DIR, guardDirOf } from "../mods/am-sidebar/workers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const MOD = join(ROOT, "mods/am-sidebar");
const ENTRY = join(MOD, "main.js");

// gpui-shell 0.7.1's modules, exactly gpui-kit.d.ts's `declare module` names.
const RUNTIME_MODULES = new Set([
  "gpui-kit", "gpui", "gpui-base", "gpui-component", "gpui-shell", "gpui-fps",
  "buffer", "path", "url", "crypto", "zlib", "console", "process", "os", "fs/promises",
  "net", "websocket", "herdr",
]);

// The runtime modules with a small named surface, as gpui-kit.d.ts declares them. `url` is the
// load-time trap: URL and URLSearchParams exist there, fileURLToPath does not (and both are
// globals, so importing nothing from url is safest). Namespace and default imports of url are
// refused outright: a namespace has no declared use beyond those two names, and url has no
// default export.
const SURFACES = new Map([
  ["url", new Set(["URL", "URLSearchParams"])],
  ["fs/promises", new Set(["readFile", "writeFile", "readdir", "exists", "unlink", "rmdir", "mkdir"])],
  ["path", new Set(["join", "resolve", "dirname", "basename"])],
  ["os", new Set(["platform", "arch", "EOL"])],
  ["process", new Set(["run", "exit", "nextTick", "platform", "arch"])],
  ["crypto", new Set(["createHash", "randomBytes", "randomUUID", "webcrypto"])],
  ["zlib", new Set(["deflateSync", "inflateSync", "gzipSync", "gunzipSync"])],
  ["buffer", new Set(["Buffer"])],
]);
const DEFAULT_EXPORTS = new Set(["path", "console", "process", "os", "net"]);

const IMPORT = /^[ \t]*import\s+([^;]*);/gm;
const REEXPORT = /^[ \t]*export\s+((?:\*|\{)[^;]*);/gm;

/** The names of an import or export list: `{ a, b as c }` -> ["a", "b"]. */
function namesOf(block) {
  return block.replace(/^\{/, "").replace(/\}[\s\S]*$/, "").split(",")
    .map((s) => s.trim().replace(/\s+as\s+[\s\S]+$/, "")).filter(Boolean);
}

/** One declaration's binding: its specifier, and whether it is a namespace/default/named one. */
function declarationOf(clause) {
  const out = { sideEffect: false, namespace: false, defaultImport: false, named: [] };
  const side = clause.match(/^["']([^"']+)["']$/);
  if (side) return { ...out, sideEffect: true, specifier: side[1] };
  const from = clause.match(/\bfrom\s*["']([^"']+)["']\s*$/);
  if (!from) return null;
  out.specifier = from[1];
  let bind = clause.slice(0, from.index).trim();
  if (!bind) return { ...out, sideEffect: true };
  if (bind.startsWith("*")) return { ...out, namespace: true };
  if (bind.startsWith("{")) return { ...out, named: namesOf(bind) };
  const comma = bind.indexOf(",");
  if (comma === -1) return { ...out, defaultImport: true };
  out.defaultImport = true;
  bind = bind.slice(comma + 1).trim();
  if (bind.startsWith("*")) out.namespace = true;
  else if (bind.startsWith("{")) out.named = namesOf(bind);
  return out;
}

/** main.js's static import graph, with every specifier held to the runtime's surface. */
function graphProblems() {
  const problems = [];
  const seen = new Set();
  const queue = [ENTRY];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) { problems.push(`${relative(ROOT, file)}: imported but missing`); continue; }
    const text = readFileSync(file, "utf8");
    const declarations = [];
    for (const m of text.matchAll(IMPORT)) declarations.push(["import", m[1].trim()]);
    for (const m of text.matchAll(REEXPORT)) declarations.push(["export", m[1].trim()]);
    for (const [kind, clause] of declarations) {
      const d = declarationOf(clause);
      if (!d?.specifier) continue;
      const spec = d.specifier;
      const where = `${relative(ROOT, file)}: ${kind} "${spec}"`;
      if (spec.startsWith("./") || spec.startsWith("../")) {
        queue.push(resolve(dirname(file), spec));
        continue;
      }
      if (!RUNTIME_MODULES.has(spec)) {
        problems.push(`${where}: not a gpui-shell 0.7.1 module`);
        continue;
      }
      if (kind === "import" && spec === "url" && (d.namespace || d.defaultImport)) {
        problems.push(`${where}: import URL or URLSearchParams by name`);
      }
      if (kind === "import" && SURFACES.has(spec) && d.defaultImport && !DEFAULT_EXPORTS.has(spec)) {
        problems.push(`${where}: no default export`);
      }
      if (SURFACES.has(spec)) for (const name of d.named) {
        if (!SURFACES.get(spec).has(name)) problems.push(`${where}: ${name} is not exported`);
      }
    }
  }
  return { problems, seen };
}

/** The gpui-kit.d.ts a Herdr app installed, when one is readable from this checkout. */
function installedDeclaration() {
  const candidates = [
    join(MOD, "gpui-kit.d.ts"),
    process.env.HERDR_APP_HOME && join(process.env.HERDR_APP_HOME, "mods/am-sidebar/gpui-kit.d.ts"),
    join(homedir(), ".config/herdr-app/mods/am-sidebar/gpui-kit.d.ts"),
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) ?? null;
}

test("the sidebar's static import graph fits gpui-shell 0.7.1", () => {
  const { problems, seen } = graphProblems();
  assert.ok(seen.size >= 20, `walked only ${seen.size} modules: the import scanner missed the graph`);
  assert.ok(seen.has(join(MOD, "workers.js")), "the graph must reach workers.js, where GUARD_DIR lives");
  assert.deepEqual(problems, [], problems.join("\n"));
  const dts = installedDeclaration();
  if (dts) {
    const declared = [...readFileSync(dts, "utf8").matchAll(/^declare module "([^"]+)"/gm)]
      .map((m) => m[1]).sort();
    assert.deepEqual(declared, [...RUNTIME_MODULES].sort(), `${dts} declares a different module set`);
  }
});

test("guardDirOf: the guard folder beside the module, from either runtime's meta URL", () => {
  assert.equal(GUARD_DIR, join(MOD, "guard"), "Node's file: URL still gives the same path");
  assert.equal(guardDirOf("file:///opt/herdr/mods/am-sidebar/workers.js"),
    "/opt/herdr/mods/am-sidebar/guard");
  assert.equal(guardDirOf("file:///opt/herdr/mods/am-sidebar/workers.js?v=1"),
    "/opt/herdr/mods/am-sidebar/guard");
  assert.equal(guardDirOf("file:///tmp/a%20b/workers.js?v=1"), "/tmp/a b/guard");
  assert.equal(guardDirOf("/Users/me/.config/herdr-app/mods/am-sidebar/workers.js?v=1"),
    "/Users/me/.config/herdr-app/mods/am-sidebar/guard", "the mod runtime's bare path plus ?v=1");
  assert.equal(guardDirOf("/tmp/a b/workers.js?v=1#frag"), "/tmp/a b/guard", "query and hash are stripped");
  assert.equal(guardDirOf("/tmp/a%20b/workers.js?v=1"), "/tmp/a%20b/guard", "a bare path is already a path");
});

test("workers.js loads with the runtime's bare import.meta.url and keeps the guard path", async () => {
  const file = join(MOD, "workers.js");
  const bare = `${file}?v=1`;
  const runtimeUrl = `${pathToFileURL(file).href}?v=1`;
  const hook = registerHooks({
    load: (url, context, next) => {
      if (url !== runtimeUrl) return next(url, context);
      const source = readFileSync(file, "utf8");
      const transformed = source.replace("guardDirOf(import.meta.url)", `guardDirOf(${JSON.stringify(bare)})`);
      assert.notEqual(transformed, source, "the load must exercise a bare import.meta.url");
      return { format: "module", source: transformed, shortCircuit: true };
    },
  });
  try {
    const runtime = await import(runtimeUrl);
    assert.equal(runtime.GUARD_DIR, join(MOD, "guard"));
    assert.equal(runtime.GUARD_DIR, GUARD_DIR);
  } finally {
    hook.deregister();
  }
});
