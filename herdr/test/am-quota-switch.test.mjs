// The switch, tested as a flow: the shell and the files are real, `security` is the recording
// stand-in, and what lands — or is refused — is observed rather than asserted about source text.
// Only Codex has a writer; the Claude path is proved to reach neither `security` nor the download.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { install, place } from "../mods/am-quota/switch.js";
import { payloadDir } from "../mods/am-quota/write.js";
import { fingerprint, TARGETS } from "../mods/am-quota/translate.js";
import { keychain } from "./am-quota-keychain.mjs";

const PROXY = {
  access_token: "at-0123456789abcdef", refresh_token: "rt-0123456789abcdef", account_id: "acc-1",
  id_token: "idt", expired: "2026-11-01T13:00:00Z", plan_type: "max",
};
const mode = (p) => statSync(p).mode & 0o777;

/**
 * A scratch machine: a home, an app home, a Keychain stand-in, and the runtime doubles the flow
 * takes. `env` is what the flow is told the client's environment is; `execEnv` is what the shell
 * actually sees (they differ only in the test that proves a mismatch is refused).
 */
function world({ env = {}, execEnv = env, kc = keychain() } = {}) {
  const root = mkdtempSync(join(tmpdir(), "am-quota-switch-"));
  const home = join(root, "home");
  const appHome = join(root, "app");
  mkdirSync(home);
  mkdirSync(appHome);
  const shellEnv = { ...process.env, ...kc.env, ...execEnv };
  const io = {
    exec: async (cmd, args) => {
      const r = spawnSync(cmd, args, { encoding: "utf8", env: shellEnv });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    readTextFile: async (p) => readFileSync(p, "utf8"),
    writeTextFile: async (p, text, before) => { writeFileSync(p, text, { flag: before === null ? "wx" : "w" }); },
    unlink: async (p) => { try { unlinkSync(p); } catch {} },
  };
  const run = (extra = {}) => install({
    api: { credential: async () => JSON.stringify(PROXY) },
    provider: "codex", account: { name: "codex-a.json" },
    home, appHome, env, ...io, ...extra,
  });
  return { root, home, appHome, kc, env, io, run };
}

test("claude: no writer. The Claude path never downloads a credential and never reaches security (#453)", async () => {
  // The stand-in `security` is first on the shell's PATH and records every call; the proxy's
  // download is a spy. Either one being reached turns this red.
  const w = world();
  const downloads = [];
  const api = { credential: async (name) => { downloads.push(name); return JSON.stringify(PROXY); } };
  await assert.rejects(w.run({ api, provider: "claude", account: { name: "claude-a.json" } }), /no writer for that provider/);
  await assert.rejects(place({ provider: "claude", body: '{"claudeAiOauth":{}}', home: w.home, appHome: w.appHome, ...w.io }),
    /no writer for that provider/);
  assert.deepEqual(downloads, [], "no credential download on the Claude path");
  assert.deepEqual(w.kc.calls(), [], "no Keychain call on the Claude path");
  assert.equal(existsSync(payloadDir(w.appHome)), false, "nothing was even prepared");
  assert.equal(existsSync(join(w.home, ".claude")), false, "no Claude folder or file was written");
  assert.deepEqual(Object.keys(TARGETS), ["codex"], "Codex is the only provider with a writer");
});

test("codex: $CODEX_HOME/auth.json is written 0600 with a dated backup and no Keychain call", async () => {
  const w = world();
  const codexHome = join(w.root, "codex");
  const auth = join(codexHome, "auth.json");
  mkdirSync(codexHome);
  writeFileSync(auth, '{"old":true}');
  chmodSync(auth, 0o644);

  const out = await w.run({ provider: "codex", account: { name: "codex-a.json" }, env: { CODEX_HOME: codexHome } });
  const written = JSON.parse(readFileSync(auth, "utf8"));
  assert.equal(written.auth_mode, "chatgpt");
  assert.equal(written.tokens.account_id, "acc-1");
  assert.equal(mode(auth), 0o600);
  assert.equal(out.fingerprint, fingerprint("acc-1"), "Codex's identity is the account id");
  const backups = readdirSync(codexHome).filter((n) => n.startsWith("auth.json.bak-"));
  assert.equal(backups.length, 1, "the previous file is kept");
  assert.equal(readFileSync(join(codexHome, backups[0]), "utf8"), '{"old":true}');
  assert.equal(w.kc.calls().length, 0, "no Keychain on the Codex path");
});

test("a credential that is not JSON is named, not quoted, and no token is ever in the error", async () => {
  const w = world();
  const token = "at-SECRET-0123456789abcdef";
  await assert.rejects(
    w.run({ api: { credential: async () => `<html>${token}</html>` } }),
    (err) => {
      assert.match(err.message, /not JSON/);
      assert.ok(!err.message.includes(token), "the response body never reaches the message");
      return true;
    },
  );
  assert.equal(existsSync(payloadDir(w.appHome)), false, "nothing was even prepared");
});
