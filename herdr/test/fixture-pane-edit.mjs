import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { maskArgs } from "../mods/am-sidebar/bin/hc-socket-mask.mjs";
import { stableRootOf } from "../mods/am-sidebar/workers.js";

// A fixture pane behind the real wrapper's mount plan. The bwrap stand-in executes only
// the requested fixture edit: no real socket, owner data, or sandbox escape attempt.
export function fixturePaneEdit(s, remove, index = 0) {
  const stable = stableRootOf(s.env);
  mkdirSync(stable, { recursive: true });
  const command = [process.execPath, "-e",
    'const fs = require("node:fs"); const p = process.argv[1]; '
    + 'const f = JSON.parse(fs.readFileSync(p)); '
    + (remove ? `delete f.bots[${index}].hcProxy; ` : `f.bots[${index}].hcProxy = false; `)
    + 'fs.writeFileSync(p, JSON.stringify(f));', join(s.project, ".herdr/bots.json")];
  const masked = maskArgs(["--bind", s.project, s.project, "--", ...command], {
    HOME: join(s.root, "home"), DSH_SANDBOX_MASK: "1",
    AM_HC_REAL_SOCKET: join(s.root, "core/hc.sock"),
    AM_HC_PROXY_SOCKET: join(s.root, "run/automagik-hc-proxy/t5/hc.sock"),
  }, { containerSockets: [], packRoot: stable });
  assert.equal(masked.fatal, null);
  assert.equal(masked.masked, true);
  assert.ok(masked.args.includes("--ro-bind"), "the wrapper protects the fixture approval parent");
  const cut = masked.args.indexOf("--");
  const child = spawnSync(masked.args[cut + 1], masked.args.slice(cut + 2), {
    env: { ...s.env, HC_TERMINAL_ID: "t5" }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
}

