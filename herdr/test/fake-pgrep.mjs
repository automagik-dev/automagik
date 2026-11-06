// A stand-in for `pgrep -P <pid>` in the CLI tests, so the real one never looks at the host's
// processes: the children of the fake hc terminal (HC_FAKE_STATE) whose pid that is, from its
// `children` (pids, one per line, exit 0; none: exit 1, as the real one). `children: null` is a
// pgrep that can't tell (exit 3 and an error); `children: "exit1"` fails with exit 1 and an
// error on stderr; `children: "killed"` says an error and is killed (SIGTERM, as at a
// timeout) before it exits. A pid no terminal has has no children.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "-P") {
  process.stderr.write(`fake pgrep: only -P <pid>, not ${args.join(" ")}\n`);
  process.exit(2);
}
const state = JSON.parse(readFileSync(process.env.HC_FAKE_STATE, "utf8"));
const t = (state.terminals ?? []).find((x) => String(x.pid) === args[1]);
if (t && t.children === "exit1") {
  process.stderr.write("spawn pgrep EACCES\n");
  process.exit(1);
}
if (t && t.children === "killed") {
  process.stderr.write("pgrep: interrupted\n");
  process.kill(process.pid, "SIGTERM");
}
if (t && t.children === null) {
  process.stderr.write("pgrep: cannot get process list\n");
  process.exit(3);
}
const children = t?.children ?? [];
if (children.length) process.stdout.write(`${children.join("\n")}\n`);
process.exit(children.length ? 0 : 1);
