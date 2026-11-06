// The credential write, tested as it runs: the shell is executed against temp dirs, so claims about
// modes, atomicity and cleanup are observed, not asserted about source text alone.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installScript, payload as credentialPayload, payloadDir, payloadPath, prepareScript, sweepScript } from "../mods/am-quota/write.js";

const STAMP = "2026-11-01T12-00-00-000Z";
const SECRET = '{"claudeAiOauth":{"accessToken":"at-SECRET-0123456789abcdef"}}';
// A credential in the proxy's shape, and the two payloads the mod builds from it.
const PROXY_CRED = { access_token: "at-" + "0".repeat(1200), refresh_token: "rt-" + "0".repeat(200), account_id: "acc-1", expired: "2026-11-01T13:00:00Z" };
const sh = (script, ...args) => spawnSync("sh", ["-c", script, "sh", ...args], { encoding: "utf8" });
const mode = (p) => statSync(p).mode & 0o777;
const dir = () => mkdtempSync(join(tmpdir(), "am-quota-write-"));

test("prepare: the payload folder is 0700 before any payload exists", () => {
  const home = dir();
  const p = payloadPath(home, "claude", STAMP);
  const out = sh(prepareScript(), payloadDir(home), p);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(mode(payloadDir(home)), 0o700, "nobody else can traverse to the file");
  // The file cannot be pre-made: writeTextFile(path, text, null) is create-only, so the mod
  // creates it into the private folder and narrows it to 0600 right after.
  assert.equal(existsSync(p), false);
  writeFileSync(p, SECRET);
  assert.equal(sh(`chmod 600 "${p}"`).status, 0);
  assert.equal(mode(p), 0o600);
});

test("install: 0600 target, a tightened backup, an atomic rename, and the payload removed", () => {
  const home = dir();
  const payload = payloadPath(home, "claude", STAMP);
  assert.equal(sh(prepareScript(), payloadDir(home), payload).status, 0);
  writeFileSync(payload, SECRET);   // what the mod does with writeTextFile

  const target = join(home, "target.json");
  writeFileSync(target, '{"old":true}');
  chmodSync(target, 0o644);   // a loose file from elsewhere, to prove the backup is tightened

  const out = sh(installScript(STAMP), payload, target);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(readFileSync(target, "utf8"), SECRET);
  assert.equal(mode(target), 0o600);
  assert.equal(readFileSync(`${target}.bak-${STAMP}`, "utf8"), '{"old":true}');
  assert.equal(mode(`${target}.bak-${STAMP}`), 0o600, "the backup of a loose file is 0600 too");
  assert.equal(existsSync(payload), false, "the payload does not outlive the write");
  assert.equal(readdirSync(join(home)).filter((n) => n.includes(".tmp-")).length, 0, "no temp file left");
});

test("install: a failed backup aborts instead of overwriting unbacked-up", () => {
  const home = dir();
  const payload = payloadPath(home, "claude", STAMP);
  assert.equal(sh(prepareScript(), payloadDir(home), payload).status, 0);
  writeFileSync(payload, SECRET);
  const target = join(home, "locked", "target.json");   // the parent cannot be created: it is a file
  writeFileSync(join(home, "locked"), "not a directory");
  const out = sh(installScript(STAMP), payload, target);
  assert.notEqual(out.status, 0, "the script fails loudly");
  assert.equal(existsSync(target), false);
});

test("install: an interrupted run leaves no temp file and no partial target", () => {
  const home = dir();
  const payload = payloadPath(home, "codex", STAMP);
  assert.equal(sh(prepareScript(), payloadDir(home), payload).status, 0);
  writeFileSync(payload, SECRET);
  const target = join(home, "sub", "auth.json");
  // The copy step is made to fail by a read-only parent: the trap must clean the temp name.
  assert.equal(sh(`mkdir -p "${join(home, "sub")}"`, "").status, 0);
  chmodSync(join(home, "sub"), 0o500);
  const out = sh(installScript(STAMP), payload, target);
  chmodSync(join(home, "sub"), 0o700);
  assert.notEqual(out.status, 0);
  assert.equal(existsSync(target), false);
  assert.equal(readdirSync(join(home, "sub")).filter((n) => n.includes(".tmp-")).length, 0, "the trap removed the temp file");
});

test("install: three backups are kept, not one per click", () => {
  const home = dir();
  const target = join(home, "auth.json");
  for (let n = 0; n < 5; n++) {
    const stamp = `2026-11-0${n + 1}T12-00-00-000Z`;
    const payload = payloadPath(home, "codex", stamp);
    assert.equal(sh(prepareScript(), payloadDir(home), payload).status, 0);
    writeFileSync(payload, `${SECRET}-${n}`);
    assert.equal(sh(installScript(stamp), payload, target).status, 0);
  }
  const backups = readdirSync(home).filter((n) => n.startsWith("auth.json.bak-")).sort();
  assert.equal(backups.length, 3, "the three newest");
  assert.deepEqual(backups, ["auth.json.bak-2026-11-03T12-00-00-000Z", "auth.json.bak-2026-11-04T12-00-00-000Z", "auth.json.bak-2026-11-05T12-00-00-000Z"]);
  for (const b of backups) assert.equal(mode(join(home, b)), 0o600);
});

test("payload: Codex is pretty-printed; Claude has none, as it is never installed from the proxy (#453)", () => {
  assert.throws(() => credentialPayload("claude", PROXY_CRED), /no writer for that provider/);
  const codex = credentialPayload("codex", PROXY_CRED);
  assert.ok(codex.endsWith("\n") && codex.split("\n").length > 3, "the file the client reads, as the client writes it");
  assert.deepEqual(JSON.parse(codex).tokens.account_id, "acc-1");
});

test("sweep: payloads and item backups older than an hour are removed, and a missing folder is fine", () => {
  const home = dir();
  const p = payloadPath(home, "claude", STAMP);
  assert.equal(sh(prepareScript(), payloadDir(home), p).status, 0);
  writeFileSync(p, SECRET);
  // Left by an older version's Claude switch: still swept.
  const b = `${payloadDir(home)}/keychain-claude-${STAMP}.hex`;
  writeFileSync(b, "7b7d");
  // Backdate both past the hour the sweep looks for.
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  const stampOf = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  spawnSync("touch", ["-t", stampOf(old), p, b]);
  assert.equal(sh(sweepScript(), payloadDir(home)).status, 0);
  assert.equal(existsSync(p), false, "an interrupted switch does not leave a token file behind");
  assert.equal(existsSync(b), false, "nor the copy of the item it saved");
  assert.equal(sh(sweepScript(), join(home, "does-not-exist")).status, 0, "a missing folder is not an error");
});

