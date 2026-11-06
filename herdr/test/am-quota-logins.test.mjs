// am-quota/logins.js (#453, mods/am-quota/docs/local-logins.md): the panel's side of the Claude
// logins on this Mac. Its record rules against the CLI's (am-sidebar/logins.js) over one corpus,
// its shell scripts under a real sh, `claude auth status` only ever a stub in a temp folder that
// prints canned JSON, and a pane's login read by value. Temp homes only: no real login folder,
// credential or Keychain item is read, and no real `claude` can be on the PATH these scripts get.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as cli from "../mods/am-sidebar/logins.js";
import { AUTH_SCRIPT, CONFIG_VAR, CREDENTIAL_VARS, DEFAULT_LOGIN, DEFAULT_WORDS, FOLDER_SCRIPT, PRESENT_SCRIPT, accountEmail, loginWords,
  methodLine, nextSlot, paneLogin, parseLogins, probeLogin, readRecord, readStatus, shapeProblem, typed, writeRecord } from "../mods/am-quota/logins.js";

const ENV = "/usr/bin/env";
const SYSTEM_PATH = "/usr/bin:/bin";

/** A scratch root (realpath'd: the Mac's tmpdir is reached through a link), removed after. */
function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hb-quota-logins-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const sh = (script, args, env = {}) => spawnSync("sh", ["-c", script, "sh", ...args], { encoding: "utf8", env: { PATH: SYSTEM_PATH, ...env } });
/** The panel's folder check under a real sh, as logins.js's exec would run it. */
const realExec = (env) => async (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", env });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

test("the record's rules say what the CLI says: parse problems, the form rule's words, and its file-system part by sh", (t) => {
  for (const text of ["{", "[]", "null", '{"logins":[]}', '{"use":"x"}', '{"use":"2","logins":[{"id":"default","dir":"/a"}]}',
    '{"use":"2","logins":[{"id":"2","dir":"/a"},{"id":"2","dir":"/b"}]}', '{"use":"2","logins":[{"id":"-x","dir":"/a"}]}',
    '{"use":"2","logins":[{"id":"2","dir":"/a","extra":1}]}']) {
    assert.deepEqual(parseLogins(text), cli.parseLogins(text), text);
  }
  const root = scratch(t);
  const home = join(root, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const good = join(home, ".claude-2");
  mkdirSync(good);
  writeFileSync(join(root, "file"), "");
  symlinkSync(good, join(root, "link"));
  symlinkSync(home, join(root, "via"));
  const io = { realpath: realpathSync, isDir: (p) => statSync(p).isDirectory(), home };
  const cases = [good, join(root, "missing"), join(root, "file"), join(root, "link"), join(root, "via", ".claude-2"), `${good}/`, "rel/x", "~/x",
    `${root}/a/../b`, join(home, ".claude"), "", join(root, "dangling")];
  symlinkSync(join(root, "nowhere"), join(root, "dangling"));
  for (const dir of cases) {
    const theirs = cli.formProblem(dir, io);
    let mine = shapeProblem(dir, home);
    if (!mine && dir) {
      const r = sh(FOLDER_SCRIPT, [dir]);
      const last = r.stdout.trim().split("\n").at(-1);
      mine = last === "ok" ? null : `folder ${dir} ${{ missing: "does not exist", symlink: "goes through a symlink", notdir: "is not a folder" }[last]}`;
    }
    assert.equal(mine, theirs, dir);
  }
});

test("FOLDER_SCRIPT names a linked file that became a file of its own; a missing or linked one is fine", (t) => {
  const root = scratch(t);
  const a = join(root, "a"), b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "settings.json"), "{}");
  symlinkSync(join(a, "settings.json"), join(b, "settings.json"));
  assert.equal(sh(FOLDER_SCRIPT, [b]).stdout, "ok\n", "linked settings.json, no CLAUDE.md");
  writeFileSync(join(b, "CLAUDE.md"), "mine");
  rmSync(join(b, "settings.json"));
  writeFileSync(join(b, "settings.json"), "{}");
  assert.equal(sh(FOLDER_SCRIPT, [b]).stdout, "unlinked settings.json\nunlinked CLAUDE.md\nok\n");
});

test("a pane's login by value from its launch argv (section 3): the folder's value, -u for login A, never the name alone", () => {
  const logins = [{ id: "2", dir: "/h/.claude-2" }];
  const rows = [
    [[ENV, "PATH=/b", `${CONFIG_VAR}=/h/.claude-2`, "claude"], { id: "2" }],
    [[ENV, `${CONFIG_VAR}=/h/.claude-2`, "sh", "-c", 'claude "$@"', "sh", "task"], { id: "2" }],
    [[ENV, "PATH=/b", `${CONFIG_VAR}=/h/.claude-9`, "claude"], { unknown: "/h/.claude-9" }],
    [[ENV, ...DEFAULT_WORDS, "PATH=/b", "claude"], { id: DEFAULT_LOGIN }],
    [[ENV, "--unset", CONFIG_VAR, "PATH=/b", "claude"], { id: DEFAULT_LOGIN }],
    [[ENV, "-u", CONFIG_VAR, `${CONFIG_VAR}=/h/.claude-2`, "claude"], { id: "2" }, "an assignment wins over the unset"],
    [[ENV, "-u", "OTHER", "PATH=/b", "claude"], { why: "started before logins were tracked" }, "another name unset says nothing"],
    [[ENV, "PATH=/b", "claude"], { why: "started before logins were tracked" }],
    [[ENV, "PATH=/b", "sh", "-c", `${CONFIG_VAR}=/h/.claude-2 claude`], { why: "started before logins were tracked" }, "inside a command is not env's"],
    [["claude", `${CONFIG_VAR}=/h/.claude-2`], { why: "started before logins were tracked" }],
    [[], { why: "hc gave no launch argv" }],
    [undefined, { why: "hc gave no launch argv" }],
  ];
  for (const [argv, want, note] of rows) assert.deepEqual(paneLogin(argv, logins), want, note ?? JSON.stringify(argv));
});

test("claude auth status, run as a launch would: a stub claude on PATH sees the login's folder, or the variable unset", async (t) => {
  const root = scratch(t);
  const home = join(root, "home"), bin = join(root, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  // The stub prints canned JSON naming the folder it was given ("unset" for none), plus a field
  // that must never reach the panel.
  writeFileSync(join(bin, "claude"), `#!/bin/sh\n[ "$1 $2" = "auth status" ] || exit 9\nprintf '{"loggedIn":true,"authMethod":"claude.ai","email":"ana@example.com","configDirectory":"%s","token":"never-this"}' "\${CLAUDE_CONFIG_DIR:-unset}"\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const exec = realExec({ PATH: `${bin}:${SYSTEM_PATH}`, HOME: home, [CONFIG_VAR]: "/inherited" });
  const a = await probeLogin({ id: DEFAULT_LOGIN, dir: null }, { exec, home, readTextFile: async () => null });
  assert.deepEqual(a.status, { state: "in", email: "ana@example.com", configDirectory: "unset", authMethod: "claude.ai" }, "-u cleared the inherited variable");
  assert.equal(JSON.stringify(a).includes("never-this"), false, "only four fields are kept");
  const two = join(home, ".claude-2");
  mkdirSync(two);
  const b = await probeLogin({ id: "2", dir: two }, { exec, home, readTextFile: async () => null });
  assert.equal(b.status.configDirectory, two);
  assert.deepEqual(loginWords({ id: "2", dir: two }), [`${CONFIG_VAR}=${two}`]);
  // No claude on PATH (the fake home's ~/.local/bin has none): 127, never a sign-in prompt.
  const none = await probeLogin({ id: DEFAULT_LOGIN, dir: null }, { exec: realExec({ PATH: SYSTEM_PATH, HOME: home }), home, readTextFile: async () => null });
  assert.equal(none.status.state, "nobin");
  // ~/.local/bin is looked in, as the CLI does.
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "claude"), "#!/bin/sh\necho '{\"loggedIn\":false}'; exit 1\n");
  chmodSync(join(home, ".local", "bin", "claude"), 0o755);
  const out = await probeLogin({ id: DEFAULT_LOGIN, dir: null }, { exec: realExec({ PATH: SYSTEM_PATH, HOME: home }), home, readTextFile: async () => null });
  assert.equal(out.status.state, "out");
  assert.equal(sh(AUTH_SCRIPT, DEFAULT_WORDS, { HOME: home }).status, 1);
});

test("readStatus: exit 1 or loggedIn false is signed out; 127 no claude; anything unreadable is unread; the email falls back to .claude.json's one field", async () => {
  assert.equal(readStatus({ code: 127 }).state, "nobin");
  assert.equal(readStatus({ code: 1, stdout: "" }).state, "out");
  assert.equal(readStatus({ code: 0, stdout: '{"loggedIn":false}' }).state, "out");
  assert.deepEqual(readStatus({ code: 0, stdout: "Logged in as someone" }), { state: "unread" });
  assert.deepEqual(readStatus({ code: 2, stdout: "{}" }), { state: "unread" });
  assert.equal(accountEmail('{"oauthAccount":{"emailAddress":"bo@example.com","accountUuid":"x"},"mcpServers":{"s":{"env":{"K":"v"}}}}'), "bo@example.com");
  assert.equal(accountEmail("{ broken"), null);
  const exec = async (_c, args) => (args[1] === FOLDER_SCRIPT ? { code: 0, stdout: "ok\n" } : { code: 0, stdout: '{"loggedIn":true,"authMethod":"claude.ai"}' });
  const read = [];
  const p = await probeLogin({ id: "2", dir: "/h/.claude-2" }, { exec, home: "/h", readTextFile: async (f) => { read.push(f); return '{"oauthAccount":{"emailAddress":"bo@example.com"}}'; } });
  assert.equal(p.email, "bo@example.com");
  assert.deepEqual(read, ["/h/.claude-2/.claude.json"], "that login's own account record");
  assert.equal(methodLine("api_key"), "an API key outranks this sign-in");
  assert.equal(methodLine("oauth_token"), "a token variable outranks this sign-in");
  assert.equal(methodLine("bedrock"), "a third-party provider is set");
});

test("the credential variables Herdr has: names only, never a value", () => {
  const r = sh(PRESENT_SCRIPT, CREDENTIAL_VARS, { ANTHROPIC_API_KEY: "sk-example-not-real", CLAUDE_CODE_OAUTH_TOKEN: "" });
  assert.equal(r.stdout, "ANTHROPIC_API_KEY\nCLAUDE_CODE_OAUTH_TOKEN\n");
  assert.equal(r.stdout.includes("sk-example"), false);
});

test("readRecord and writeRecord: no file is login A; the write is { use, logins } with the snapshot it replaces", async () => {
  const files = new Map();
  const readTextFile = async (p) => (files.has(p) ? files.get(p) : null);
  const writes = [];
  const writeTextFile = async (p, text, before) => {
    writes.push(before);
    if ((files.get(p) ?? null) !== before) throw new Error("stale");
    files.set(p, text);
  };
  assert.deepEqual(await readRecord("/app/", readTextFile), { text: null, use: DEFAULT_LOGIN, logins: [], problem: null });
  const first = await writeRecord("/app", { use: "2", logins: [{ id: "2", dir: "/h/.claude-2", extra: 1 }] }, null, writeTextFile);
  assert.deepEqual(JSON.parse(files.get("/app/claude-logins.json")), { use: "2", logins: [{ id: "2", dir: "/h/.claude-2" }] });
  const read = await readRecord("/app", readTextFile);
  assert.equal(read.text, first);
  await assert.rejects(writeRecord("/app", { use: DEFAULT_LOGIN, logins: [] }, null, writeTextFile), /stale/, "an edit since the read is never overwritten");
  assert.deepEqual(writes, [null, null]);
  files.set("/app/claude-logins.json", '{"use":"3","logins":[]}');
  assert.equal((await readRecord("/app", readTextFile)).problem, "use names 3 that it doesn't list");
  assert.equal((await readRecord("/app", async () => { throw Object.assign(new Error("x"), { code: "EACCES" }); })).problem, "can't be read (EACCES)");
  assert.deepEqual(nextSlot([{ id: "2", dir: "/h/.claude-2" }], "/h/"), { id: "3", dir: "/h/.claude-3" });
  assert.equal(typed("/h/.claude-2", "/h"), '"$HOME/.claude-2"');
  assert.equal(typed("/elsewhere/it's", "/h"), "'/elsewhere/it'\\''s'");
});
