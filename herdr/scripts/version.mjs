#!/usr/bin/env node
/**
 * The herdr pack's version is the Automagik monorepo's one version (AGENTS.md at the repository
 * root): `bun scripts/version.ts set` writes it into herdr/package.json and the pack's
 * mods/am-sidebar/VERSION (which the release tarball carries and update.mjs reads), and the release
 * workflow tags it `vX.Y.Z`. The pack has no version, bump or release logic of its own; this file
 * only checks, from herdr/, that the pack carries the root's version.
 *
 *   node scripts/version.mjs check     package.json and VERSION carry the monorepo's version; exit 1 when not
 *   node scripts/version.mjs current   the monorepo's version (the root package.json's)
 */
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** herdr/, the pack's folder in the monorepo. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** A release version: X.Y.Z, whole numbers without leading zeros (the monorepo's are 3.N.P). */
export const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Every file of the pack that carries the version: JSON at `path`, or a text file holding only it. */
export const FIELDS = [
  { file: "package.json", path: ["version"] },
  { file: "mods/am-sidebar/VERSION" },
];

const readField = (root, { file, path }) => {
  const text = readFileSync(join(root, file), "utf8");
  if (!path) return text.trim();
  return path.reduce((node, key) => node?.[key], JSON.parse(text));
};

/** The monorepo's version: the package.json one folder above the pack. */
export const monorepoVersion = (root = ROOT) => JSON.parse(readFileSync(join(root, "..", "package.json"), "utf8")).version;

/** The pack's fields that do not carry `version`, as `file:path = value`. */
export function drift(version, root = ROOT) {
  return FIELDS.flatMap((field) => {
    let value;
    try { value = readField(root, field); } catch (error) { value = `unreadable (${error.code ?? error.message})`; }
    return value === version ? [] : [`herdr/${field.file}${field.path ? `:${field.path.join(".")}` : ""} = ${String(value)}`];
  });
}

const invoked = (() => { try { return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invoked) {
  const [command] = process.argv.slice(2);
  if (command === "check") {
    const version = monorepoVersion();
    const problems = drift(version);
    if (!VERSION.test(String(version))) problems.unshift(`package.json:version = ${version} is not X.Y.Z`);
    for (const problem of problems) console.error(`version: ${problem}, not ${version} (bun scripts/version.ts set, at the repository root)`);
    if (problems.length > 0) process.exit(1);
    console.log(`version: the pack carries ${version}`);
  } else if (command === "current") {
    console.log(monorepoVersion());
  } else {
    console.error("usage: node scripts/version.mjs check | current");
    process.exit(2);
  }
}
