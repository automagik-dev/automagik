// Reading a herdr-core doc (doc.get) for `automagik-herdr doc get`, so a mod that can only exec a
// program reads one: herdr-core's JSON-RPC spoken through `hc connect` (one request per line on
// its stdin, one answer per line on its stdout; it ends at stdin's end). Read-only: doc.get is
// the one method this file ever sends. Apache-2.0.
import { spawn } from "node:child_process";

/** The names `doc get` accepts (herdr-core's own rule is narrower; it refuses the rest itself). */
export const DOC_NAME = /^[A-Za-z0-9._-]{1,128}$/;
export const DOC_TIMEOUT_MS = 10_000;

/** A failure: `code` 3 when the doc is not there, else 1. */
export class DocError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

/**
 * The doc `name` holds (on `machine`, herdr-core's `on`, when given): its value. Throws a
 * DocError: 3 when it was never written or was deleted (herdr-core answers value null), 1 for a
 * bad name, hc missing or failing, an error answer, or no answer within `timeoutMs` (hc connect
 * is then ended). `hc` is the program's path.
 */
export function docGet(name, { machine, hc = "hc", timeoutMs = DOC_TIMEOUT_MS, env = process.env } = {}) {
  if (typeof name !== "string" || !DOC_NAME.test(name)) {
    return Promise.reject(new DocError(`"${name ?? ""}" is not a doc name: use 1-128 of A-Z a-z 0-9 . _ -.`));
  }
  const params = machine === undefined ? { name } : { name, on: machine };
  const request = { jsonrpc: "2.0", id: 1, method: "doc.get", params };
  return new Promise((resolve, reject) => {
    let settled = false, out = "", err = "";
    const child = spawn(hc, ["connect"], { env, stdio: ["pipe", "pipe", "pipe"] });
    // Settles once; the child is ended either way (stdin's end asks it to go; a kill makes sure).
    const settle = (fail, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) {
        const grace = setTimeout(() => child.kill("SIGKILL"), 1000);
        grace.unref();
        if (fail?.timedOut) child.kill("SIGTERM");
        child.once("exit", () => clearTimeout(grace));
      }
      if (fail) reject(fail); else resolve(value);
    };
    const timer = setTimeout(() => {
      const e = new DocError(`hc connect gave no answer for doc ${name} in ${Math.round(timeoutMs / 1000)} s.`);
      e.timedOut = true;
      settle(e);
    }, timeoutMs);
    child.on("error", (e) => settle(new DocError(e?.code === "ENOENT" ? "hc (herdr-core) is not on PATH."
      : `hc connect could not start: ${e?.message ?? e}`)));
    child.stdin.on("error", () => { /* hc went away: its exit says why */ });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
      let at;
      while ((at = out.indexOf("\n")) >= 0) {
        const line = out.slice(0, at).trim();
        out = out.slice(at + 1);
        if (line) answer(line);
      }
    });
    child.on("close", (code) => {
      if (out.trim()) answer(out.trim());
      const why = err.trim().split("\n").pop() || `exit ${code}`;
      settle(new DocError(`hc connect ended without an answer for doc ${name}: ${why}`));
    });
    function answer(line) {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      // Anything that isn't the answer to this request (a notification) is not ours.
      if (msg?.id !== request.id) return;
      if (msg.error) {
        const kind = msg.error.data?.kind ?? msg.error.message;
        return settle(new DocError(`hc: doc.get ${name}${machine === undefined ? "" : ` on ${machine}`} failed (${kind}): ${msg.error.message}`));
      }
      const result = msg.result;
      if (!result || typeof result !== "object" || !("value" in result)) {
        return settle(new DocError(`hc: doc.get ${name} answered no value.`));
      }
      if (result.value === null) {
        return settle(new DocError(`No doc ${name}${machine === undefined ? "" : ` on ${machine}`}.`, 3));
      }
      settle(null, result.value);
    }
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}
