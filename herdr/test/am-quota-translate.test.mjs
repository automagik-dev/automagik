// The one place that knows the proxy's credential shape vs each client's, pinned by tests.
import test from "node:test";
import assert from "node:assert/strict";

import { toCodex, problems, credentialTarget, TARGETS, itemText, hexToUtf8, fingerprint, tokenIdentity } from "../mods/am-quota/translate.js";

const NOW = new Date("2026-11-01T12:00:00Z");

const codex = {
  access_token: "at-codex-0123456789abcdef", account_id: "acc-1", id_token: "idt", refresh_token: "rt-codex-0123456789abcdef",
  expired: "2026-11-01T13:00:00Z", email: "x@y.z", last_refresh: "2026-11-01T11:00:00Z", plan_type: "pro",
};

const hex = (s) => Buffer.from(s, "utf8").toString("hex");

test("codex: flat proxy credential becomes auth.json's nested shape", () => {
  const out = toCodex(codex, { now: NOW });
  assert.equal(out.auth_mode, "chatgpt");
  assert.equal(out.OPENAI_API_KEY, null);
  assert.equal(out.last_refresh, "2026-11-01T11:00:00Z");
  assert.deepEqual(out.tokens, { access_token: "at-codex-0123456789abcdef", refresh_token: "rt-codex-0123456789abcdef", account_id: "acc-1", id_token: "idt" });
  // Optional fields do not become undefined keys in the JSON.
  const minimal = toCodex({ access_token: "at-0123456789abcdef", refresh_token: "rt-0123456789abcdef", account_id: "acc-2" }, { now: NOW });
  assert.deepEqual(Object.keys(minimal.tokens).sort(), ["access_token", "account_id", "refresh_token"]);
  assert.equal(minimal.last_refresh, NOW.toISOString());
  // And a credential with no account identity is refused rather than written half-usable.
  assert.throws(() => toCodex({ access_token: "at-0123456789abcdef", refresh_token: "rt-0123456789abcdef" }, { now: NOW }), /no account id or id token/);
});

test("problems name what is missing, before anything is written", () => {
  assert.deepEqual(problems("codex", codex), []);
  assert.deepEqual(problems("codex", {}), ["no access token", "no refresh token", "no account id or id token"]);
  assert.deepEqual(problems("codex", null), ["the proxy returned no credential"]);
  assert.throws(() => toCodex({ access_token: "" }), /no access token/);
});

test("a token-shaped string is required: garbage never becomes a credential the client trusts", () => {
  // Short, whitespace-bearing or non-string values are refused by name, not silently defaulted.
  assert.deepEqual(problems("codex", { access_token: "short", refresh_token: "rt-" + "0".repeat(20), account_id: "a" }),
    ["the access token is not a token"]);
  assert.deepEqual(problems("codex", { access_token: "at-" + "0".repeat(20), refresh_token: "two words here!", account_id: "a" }),
    ["the refresh token is not a token"]);
  // And a real-looking pair still passes.
  assert.deepEqual(problems("codex", { access_token: "at-" + "0".repeat(24), refresh_token: "rt-" + "0".repeat(24), account_id: "a" }), []);
});

test("the write target follows CODEX_HOME; Claude has no target, as it is never installed from the proxy (#453)", () => {
  const home = "/Users/ada";
  assert.equal(credentialTarget("codex", { home }).file, "/Users/ada/.codex/auth.json");
  assert.equal(credentialTarget("codex", { home, env: { CODEX_HOME: "/srv/codex/" } }).file, "/srv/codex/auth.json");
  assert.equal(credentialTarget("codex", { home, env: { CODEX_HOME: "" } }).file, "/Users/ada/.codex/auth.json", "empty means default");
  assert.deepEqual(credentialTarget("codex", { home }), { label: "Codex", file: "/Users/ada/.codex/auth.json" }, "no Keychain field at all");
  assert.equal(credentialTarget("claude", { home }), null);
  assert.equal(credentialTarget("claude", { home, env: { CLAUDE_CONFIG_DIR: "/p" } }), null);
  assert.equal(credentialTarget("nope", { home }), null);
  assert.deepEqual(Object.keys(TARGETS), ["codex"]);
});

test("an item's bytes are read back as text, or as hex when it holds a newline", () => {
  const item = JSON.stringify({ claudeAiOauth: { accessToken: "t" }, mcpOAuth: {} }, null, 2);
  assert.equal(itemText(JSON.stringify({ a: 1 })), '{"a":1}');
  assert.equal(itemText(`${JSON.stringify({ a: 1 })}\n`), '{"a":1}', "security -w appends one newline");
  assert.equal(itemText(`${hex(item)}\n`), item, "hex is what -w prints for a value holding 0x0a");
  assert.equal(hexToUtf8(hex(item)), item, "and it decodes through the same reader the tests use");
  assert.equal(itemText("") , null);
  assert.equal(itemText("nonsense"), null);
  assert.equal(itemText("7b"), null, "hex that is not JSON is not an item");
  assert.equal(itemText(null), null);
});

test("hex item text decodes as UTF-8: a non-ASCII key is not mojibake", () => {
  const item = JSON.stringify({ claudeAiOauth: { accessToken: "t" }, mcpOAuth: { "café": { token: "x" } }, note: "Café ☕" });
  assert.equal(itemText(hex(item)), item, "a byte is not a character");
  assert.equal(hexToUtf8(hex("Café ☕")), "Café ☕", "two-, three- and four-byte runes");
  assert.equal(hexToUtf8(hex("😀")), "😀", "astral runes become a surrogate pair");
  assert.equal(hexToUtf8(""), "");
  assert.equal(hexToUtf8("7"), null, "half a byte is not hex");
  assert.equal(hexToUtf8("zz"), null);
  assert.equal(hexToUtf8(null), null);
  assert.equal(hexToUtf8("ff"), "\ufffd", "invalid UTF-8 degrades, it never throws");
});

test("a fingerprint identifies a token without keeping it, so the badge can be checked", () => {
  const a = fingerprint("rt-one-0123456789abcdef");
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(fingerprint("rt-one-0123456789abcdef"), a, "stable across calls");
  assert.notEqual(fingerprint("rt-two-0123456789abcdef"), a);
  assert.equal(fingerprint(""), null);
  assert.ok(!a.includes("0123456789"), "the token is not in its fingerprint");

  assert.equal(tokenIdentity("claude", JSON.stringify({ claudeAiOauth: { refreshToken: "rt-x-0123456789abcdef" } })), null,
    "a Claude credential is never read for an identity");
  assert.equal(tokenIdentity("codex", JSON.stringify({ tokens: { refresh_token: "rt-c-0123456789abcdef", account_id: "acc-7" } })), fingerprint("acc-7"), "the account id survives a token refresh");
  assert.equal(tokenIdentity("codex", JSON.stringify({ tokens: { refresh_token: "rt-c-0123456789abcdef" } })), fingerprint("rt-c-0123456789abcdef"));
  assert.equal(tokenIdentity("codex", "not json"), null);
  assert.equal(tokenIdentity("codex", null), null);
  assert.equal(tokenIdentity("codex", hex(JSON.stringify({ tokens: { account_id: "acc-8" }, note: "café" }))),
    fingerprint("acc-8"), "a hex text is read too");
});
