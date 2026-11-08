#!/usr/bin/env node
// Test-only entry: run the proxy CLI in a child with the scene's forbidden roots passed as an
// object (never env, a flag or a file the pack reads). The scene's cwd is its temp root.
import { join } from "node:path";
import { main } from "../mods/am-sidebar/hcProxy.mjs";

const root = process.cwd();
const forbiddenRoots = [
  ["the project", join(root, "project")],
  ["the app home", join(root, "app")],
  ["the temp folder", join(root, "pane-tmp")],
  ["the runtime folder", join(root, "run")],
];
main(process.argv.slice(2), process.env, { forbiddenRoots }).then((code) => {
  if (typeof code === "number") process.exitCode = code;
}).catch((e) => {
  process.stderr.write(`hc-proxy: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
  process.exitCode = 1;
});
