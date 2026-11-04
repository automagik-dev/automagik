// hc's `file read|edit --on M` for herdr-stub's state.hcAnswer: "another machine" is this one
// (its files are scratch paths here), with hc's answers: the text as { first, last, lines,
// text }; errors as JSON on stderr, exit 3 not_found, 1 edit_failed or unavailable (a machine
// in state.offline). Anything else goes to `rest`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const fail = (code, kind, message) => ({ code, stdout: "", stderr: JSON.stringify({ error: { kind, message } }) });

export function hcFileOps(state, rest = () => ({ code: 0, stdout: "{}", stderr: "" })) {
  return (args) => {
    if (args[0] !== "file") return rest(args);
    const on = args.includes("--on") ? args[args.indexOf("--on") + 1] : null;
    if (on && state.offline.has(on)) return fail(1, "unavailable", `${on} isn't connected`);
    const path = args.at(-1);
    if (!existsSync(path)) return fail(3, "not_found", `no file ${path}`);
    const text = readFileSync(path, "utf8");
    if (args[1] === "read") {
      const lines = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
      return { code: 0, stdout: JSON.stringify({ first: 1, last: lines, lines, text }), stderr: "" };
    }
    if (args[1] !== "edit") return fail(2, "invalid_params", `no file ${args[1]}`);
    const old = args.find((a) => a.startsWith("--old=")).slice(6), now = args.find((a) => a.startsWith("--new=")).slice(6);
    const at = text.indexOf(old);
    if (at < 0 || text.indexOf(old, at + 1) >= 0) return fail(1, "edit_failed", "the old text is not in the file");
    writeFileSync(path, text.slice(0, at) + now + text.slice(at + old.length));
    return { code: 0, stdout: JSON.stringify({ bytes: now.length, path }), stderr: "" };
  };
}
