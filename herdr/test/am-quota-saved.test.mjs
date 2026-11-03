// Saved Claude logins, tested as flows: the shell, the files and the Keychain (the recording
// stand-in, never the real `security`) are real, and what lands is observed. Every token here is
// a made-up string, and the stand-in's log is checked for each of them.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { forgetSaved, nameProblem, previousFile, previousService, readIndex, resaveActive, restorePrevious, saveLogin, savedFile, savedService, useSaved } from "../mods/am-quota/saved.js";
import { payloadDir, sweepScript } from "../mods/am-quota/write.js";
import { fingerprint, TARGETS } from "../mods/am-quota/translate.js";
import { keychain } from "./am-quota-keychain.mjs";

const CLIENT = TARGETS.claude.keychain;
const oauth = (who, n = 0, extra = {}) => ({
  accessToken: `at-${who}-${n}-0123456789abcdef`,
  refreshToken: `rt-${who}-${n}-0123456789abcdef`,
  expiresAt: 1793700000000,
  scopes: ["user:inference", "user:profile"],
  subscriptionType: "max",
  rateLimitTier: "default_claude_max_20x",
  ...extra,
});
const A0 = oauth("a", 0);
const A1 = oauth("a", 1);   // the same account after Claude rotated its refresh token
const B0 = oauth("b", 0);
const C0 = oauth("c", 0);   // a third account on the same plan as A and B
const TOKENS = [A0, A1, B0, C0].flatMap((o) => [o.accessToken, o.refreshToken]);
const item = (o, rest = {}) => JSON.stringify({ claudeAiOauth: o, ...rest });
const mode = (p) => statSync(p).mode & 0o777;
const sha8 = (dir) => createHash("sha256").update(dir).digest("hex").slice(0, 8);

/** A scratch machine: a home, an app home, a Keychain stand-in, and the runtime doubles. */
function world({ env = {}, platform = "macos" } = {}) {
  const kc = keychain();
  const root = mkdtempSync(join(tmpdir(), "am-quota-saved-"));
  const home = join(root, "home");
  const appHome = join(root, "app");
  mkdirSync(home);
  mkdirSync(appHome);
  const shellEnv = { ...process.env, ...kc.env, ...env };
  const io = {
    home, appHome, env, platform,
    exec: async (cmd, args) => {
      const r = spawnSync(cmd, args, { encoding: "utf8", env: shellEnv });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    },
    readTextFile: async (p) => readFileSync(p, "utf8"),
    writeTextFile: async (p, text, before) => { writeFileSync(p, text, { flag: before === null ? "wx" : "w" }); },
    unlink: async (p) => { try { unlinkSync(p); } catch {} },
  };
  const json = (service) => JSON.parse(kc.item(service));
  const adds = () => kc.calls().filter((c) => c.cmd === "add-generic-password").map((c) => c.service);
  /** Nothing secret in the stand-in's log, the payload folder's leftovers, or a value. */
  const clean = (...values) => {
    const log = existsSync(join(kc.root, "log.jsonl")) ? readFileSync(join(kc.root, "log.jsonl"), "utf8") : "";
    for (const t of TOKENS) {
      assert.ok(!log.includes(t), "no token in the recorded security calls");
      for (const v of values) assert.ok(!JSON.stringify(v ?? null).includes(t), "no token in what the flow answered or threw");
    }
    const left = existsSync(payloadDir(appHome)) ? readdirSync(payloadDir(appHome)).filter((n) => n !== "saved.json" && n !== "saved") : [];
    for (const v of values) assert.ok(!JSON.stringify(v ?? null).includes("mcp-secret"));
    assert.deepEqual(left, [], "no payload or item copy is left behind");
  };
  return { root, home, appHome, kc, io, json, adds, clean };
}

test("save: only claudeAiOauth goes into the saved item, the client's item is untouched", async () => {
  const w = world();
  const original = item(A0, { mcpOAuth: { srv: { token: "mcp-secret" } } });
  w.kc.seed(CLIENT, original);

  const out = await saveLogin({ ...w.io, name: "juice" });
  assert.deepEqual(w.json(savedService("juice")), { claudeAiOauth: A0 }, "the tokens and nothing else — no mcpOAuth");
  assert.equal(w.kc.item(CLIENT), original, "the client's login is read, never written");
  assert.deepEqual(w.adds(), [savedService("juice")]);
  assert.equal(out.fingerprint, fingerprint(A0.refreshToken));
  assert.equal(out.plan, "max");
  assert.equal(out.email, null, "the token data carries no email; none is invented");
  const index = await readIndex(w.io);
  assert.deepEqual(Object.keys(index), ["juice"]);
  assert.ok(index.juice.savedAt);
  assert.ok(!readFileSync(join(payloadDir(w.appHome), "saved.json"), "utf8").includes("mcp-secret"));
  assert.equal(existsSync(join(w.home, ".claude")), false, "no plaintext credential file on a Mac");
  w.clean(out);
});

test("save: a CLAUDE_CONFIG_DIR profile's own item is the one read — never the default login", async () => {
  const profile = mkdtempSync(join(tmpdir(), "am-quota-profile-"));
  const w = world({ env: { CLAUDE_CONFIG_DIR: profile } });
  const service = `${CLIENT}-${sha8(profile)}`;
  w.kc.seed(service, item(B0));

  await saveLogin({ ...w.io, name: "work" });
  assert.deepEqual(w.json(savedService("work")), { claudeAiOauth: B0 });
  assert.ok(w.kc.services().every((s) => s === service || s === savedService("work")), w.kc.services().join(" | "));
  w.clean();
});

test("save: no login to save, a bad name, or a taken name is refused before anything is written", async () => {
  const w = world();
  await assert.rejects(saveLogin({ ...w.io, name: "juice" }), /no Claude Code login on this machine/);
  assert.deepEqual(w.adds(), []);

  for (const bad of ["", " ", "../x", 'a"b', "a b", "-x", "x".repeat(33), "a/b"]) {
    assert.ok(nameProblem(bad), `refused: ${JSON.stringify(bad)}`);
    await assert.rejects(saveLogin({ ...w.io, name: bad }), /name/);
  }
  assert.equal(nameProblem("juice.2_x-y"), null);

  w.kc.seed(CLIENT, item(A0));
  await saveLogin({ ...w.io, name: "juice" });
  await assert.rejects(saveLogin({ ...w.io, name: "juice", replace: false }), /already saved — use its Re-save/);
  assert.deepEqual(w.adds(), [savedService("juice")], "only the first save wrote");
  w.clean();
});

test("use: the login in use is re-saved FIRST (newest refresh token), then the chosen one is swapped in", async () => {
  const w = world();
  w.kc.seed(savedService("juice"), item(A0));
  w.kc.seed(savedService("work"), item(B0));
  // Juice is in use, and Claude has rotated its refresh token since it was saved.
  w.kc.seed(CLIENT, item(A1, { mcpOAuth: { keep: "me" } }));

  const out = await useSaved({ ...w.io, name: "work", current: "juice" });
  assert.deepEqual(w.json(savedService("juice")), { claudeAiOauth: A1 }, "juice's copy now holds the rotated token");
  const installed = w.json(CLIENT);
  assert.deepEqual(installed.claudeAiOauth, B0, "the client is on work");
  assert.deepEqual(installed.mcpOAuth, { keep: "me" }, "the client item's other keys survive (merge)");
  assert.deepEqual(w.json(savedService("work")), { claudeAiOauth: B0 }, "the chosen copy is unchanged");
  assert.deepEqual(w.adds(), [previousService("juice"), savedService("juice"), CLIENT], "the replaced copy is kept, then the re-save, then the swap");
  assert.deepEqual(w.json(previousService("juice")), { claudeAiOauth: A0 }, "the copy the re-save replaced is kept one level deep");
  assert.equal(out.resaved, true);
  assert.equal(out.fingerprint, fingerprint(B0.refreshToken));
  w.clean(out);
});

test("use: an unsaved login in use, a missing saved login, or the same one changes nothing", async () => {
  const w = world();
  w.kc.seed(CLIENT, item(A0));
  w.kc.seed(savedService("work"), item(B0));

  await assert.rejects(useSaved({ ...w.io, name: "work", current: null }), (err) => {
    assert.match(err.message, /the login in use is not saved, so it would be lost — save it first/);
    w.clean(err.message);
    return true;
  });
  await assert.rejects(useSaved({ ...w.io, name: "gone", current: "work" }), /no saved login named gone; nothing was changed/);
  await assert.rejects(useSaved({ ...w.io, name: "work", current: "work" }), /work is already in use/);
  assert.deepEqual(w.adds(), [], "no item was written");
  assert.equal(w.kc.item(CLIENT), item(A0));
});

test("use: a login in use that does not look like its saved account is not re-saved over it", async () => {
  const w = world();
  w.kc.seed(savedService("juice"), item(A0));
  w.kc.seed(savedService("work"), item(B0));
  // Someone ran /login as a pro account outside the panel; the record still says juice.
  const other = oauth("c", 0, { subscriptionType: "pro", rateLimitTier: "default_claude_ai" });
  w.kc.seed(CLIENT, item(other));

  await assert.rejects(useSaved({ ...w.io, name: "work", current: "juice" }), /does not look like juice .* Re-save juice to confirm; nothing was changed/);
  assert.deepEqual(w.adds(), []);
  assert.deepEqual(w.json(savedService("juice")), { claudeAiOauth: A0 }, "juice's saved copy is intact");
  w.clean();
});

test("use: unchanged since the save, the login in use is not written again", async () => {
  const w = world();
  w.kc.seed(savedService("juice"), item(A0));
  w.kc.seed(savedService("work"), item(B0));
  w.kc.seed(CLIENT, item(A0));

  const out = await useSaved({ ...w.io, name: "work", current: "juice" });
  assert.equal(out.resaved, false);
  assert.deepEqual(w.adds(), [CLIENT]);
});

test("use: a failure after the client item was written puts the old login back", async () => {
  const blocked = join(mkdtempSync(join(tmpdir(), "am-quota-blocked-")), "not-a-directory");
  writeFileSync(blocked, "the profile path is a file, so the profile's file write must fail");
  const w = world({ env: { CLAUDE_CONFIG_DIR: blocked } });
  const service = `${CLIENT}-${sha8(blocked)}`;
  const original = item(A0, { mcpOAuth: { keep: "me" } });
  w.kc.seed(service, original);
  w.kc.seed(savedService("juice"), item(A0));
  w.kc.seed(savedService("work"), item(B0));

  await assert.rejects(useSaved({ ...w.io, name: "work", current: "juice" }), (err) => {
    assert.match(err.message, /put back/);
    w.clean(err.message);
    return true;
  });
  assert.equal(w.kc.item(service), original, "Claude is back on juice");
  assert.equal(w.kc.item(CLIENT), null, "the default login was never touched");
});

test("re-save before a proxy switch keeps the newest token of the saved login in use", async () => {
  const w = world();
  w.kc.seed(savedService("juice"), item(A0));
  w.kc.seed(CLIENT, item(A1));
  assert.deepEqual(await resaveActive({ ...w.io, name: "juice" }), { resaved: true });
  assert.deepEqual(w.json(savedService("juice")), { claudeAiOauth: A1 });
  assert.deepEqual(w.json(previousService("juice")), { claudeAiOauth: A0 });
  assert.equal(w.kc.item(CLIENT), item(A1), "the client item is only read");
  w.clean();
});

test("review M1: a wrong record re-saves another same-plan account over juice — and juice is not lost", async () => {
  const w = world();
  w.kc.seed(savedService("juice"), item(A0));
  w.kc.seed(savedService("side"), item(C0));
  // The client holds B (signed in outside the panel), but the record still says juice. B is on
  // the same plan as A, so the shape check cannot tell them apart.
  w.kc.seed(CLIENT, item(B0));

  const out = await useSaved({ ...w.io, name: "side", current: "juice" });
  assert.equal(out.resaved, true);
  assert.deepEqual(w.json(savedService("juice")), { claudeAiOauth: B0 }, "the wrong re-save happened, as reproduced");
  assert.deepEqual(w.json(previousService("juice")), { claudeAiOauth: A0 }, "but A is kept as juice's previous copy");
  assert.deepEqual(w.json(CLIENT).claudeAiOauth, C0, "the switch itself went through");
  assert.ok((await readIndex(w.io)).juice.previousAt, "the row can offer Restore previous");

  await restorePrevious({ ...w.io, name: "juice" });
  assert.deepEqual(w.json(savedService("juice")), { claudeAiOauth: A0 }, "A is back under juice");
  assert.deepEqual(w.json(previousService("juice")), { claudeAiOauth: B0 }, "a swap: the restore can be undone too");
  assert.deepEqual(w.json(CLIENT).claudeAiOauth, C0, "restoring never touches the login in use");
  w.clean(out);
});

test("restore previous: with none, nothing changes; an unchanged re-save keeps no previous", async () => {
  const w = world();
  w.kc.seed(CLIENT, item(A0));
  await saveLogin({ ...w.io, name: "juice" });
  await saveLogin({ ...w.io, name: "juice" });   // the same token: nothing worth keeping
  assert.equal(w.kc.item(previousService("juice")), null);
  assert.equal((await readIndex(w.io)).juice.previousAt, null);
  await assert.rejects(restorePrevious({ ...w.io, name: "juice" }), /no previous copy of juice; nothing was changed/);
  assert.deepEqual(w.json(savedService("juice")), { claudeAiOauth: A0 });
  w.clean();
});

test("forget: the saved item is removed and proved gone; the login in use stays", async () => {
  const w = world();
  w.kc.seed(CLIENT, item(A0));
  await saveLogin({ ...w.io, name: "juice" });

  w.kc.seed(CLIENT, item(A1));
  await saveLogin({ ...w.io, name: "juice" });   // a rotated re-save: A0 becomes the previous copy
  assert.ok(w.kc.item(previousService("juice")));

  await forgetSaved({ ...w.io, name: "juice" });
  assert.equal(w.kc.item(savedService("juice")), null);
  assert.equal(w.kc.item(previousService("juice")), null, "the previous copy goes with it");
  assert.deepEqual(await readIndex(w.io), {});
  assert.equal(w.kc.item(CLIENT), item(A1));
  await forgetSaved({ ...w.io, name: "juice" });   // already gone: nothing to do, not an error
  const deleted = new Set(w.kc.calls().filter((c) => c.cmd === "delete-generic-password").map((c) => c.service));
  assert.deepEqual([...deleted].sort(), [savedService("juice"), previousService("juice")].sort(), "only juice's own items");
  w.clean();
});

test("linux: a saved login is a 0600 file in a 0700 folder, and no security call is ever made", async () => {
  const w = world({ platform: "linux" });
  const creds = join(w.home, ".claude", ".credentials.json");
  mkdirSync(join(w.home, ".claude"));
  writeFileSync(creds, item(A0, { mcpOAuth: { keep: "me" } }));

  await saveLogin({ ...w.io, name: "juice" });
  const file = savedFile(w.appHome, "juice");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { claudeAiOauth: A0 });
  assert.equal(mode(file), 0o600);
  assert.equal(mode(join(payloadDir(w.appHome), "saved")), 0o700);
  assert.deepEqual(readdirSync(join(payloadDir(w.appHome), "saved")), ["juice.json"], "no dated backups of a saved copy");

  writeFileSync(creds, item(B0));   // signed in as work
  await saveLogin({ ...w.io, name: "work" });
  writeFileSync(creds, item(oauth("b", 1), { mcpOAuth: { keep: "me" } }));   // work rotated

  const out = await useSaved({ ...w.io, name: "juice", current: "work" });
  assert.equal(out.resaved, true);
  assert.deepEqual(JSON.parse(readFileSync(savedFile(w.appHome, "work"), "utf8")).claudeAiOauth, oauth("b", 1));
  const prev = previousFile(w.appHome, "work");
  assert.deepEqual(JSON.parse(readFileSync(prev, "utf8")), { claudeAiOauth: B0 }, "the replaced copy, kept");
  assert.equal(mode(prev), 0o600);
  assert.equal(mode(join(payloadDir(w.appHome), "saved", "previous")), 0o700);
  assert.equal(existsSync(join(payloadDir(w.appHome), "saved", "juice.previous.json")), false, "no name can collide with it");
  const now = JSON.parse(readFileSync(creds, "utf8"));
  assert.deepEqual(now.claudeAiOauth, A0, "the client file is on juice");
  assert.deepEqual(now.mcpOAuth, { keep: "me" }, "the file's other keys survive");
  assert.equal(mode(creds), 0o600);

  await forgetSaved({ ...w.io, name: "juice" });
  assert.equal(existsSync(file), false);
  await forgetSaved({ ...w.io, name: "work" });
  assert.equal(existsSync(prev), false, "the previous copy goes with it");
  assert.deepEqual(w.kc.calls(), [], "security was never called");
});

test("sweep: old payloads and item copies go; the panel's records stay", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "am-quota-sweep-")), "data");
  mkdirSync(dir);
  const names = ["claude-2026-11-01T00-00-00-000Z.json", "codex-2026-11-01T00-00-00-000Z.json", "keychain-read-x.hex", "keychain-claude-x.hex", "active.json", "saved.json"];
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  for (const n of names) {
    writeFileSync(join(dir, n), "{}");
    utimesSync(join(dir, n), old, old);
  }
  assert.equal(spawnSync("/bin/sh", ["-c", sweepScript(), "sh", dir]).status, 0);
  assert.deepEqual(readdirSync(dir).sort(), ["active.json", "saved.json"]);
});
