// scripts/usagemeter-pin.mjs against a fake GitHub: the public release-download route can answer
// 504 (or serve), the API asset route serves the same bytes, and the test pins its own builds (the
// real pins name the release's binaries, not these). No test reaches GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../scripts/usagemeter-pin.mjs";

const TAG = "v0.3.0";
const ASSETS = ["usagemeter-darwin-arm64", "usagemeter-darwin-x86_64", "usagemeter-linux-aarch64", "usagemeter-linux-x86_64"];
const BYTES = Object.fromEntries(ASSETS.map((name) => [name, Buffer.from(`#!/bin/sh\necho ${name}\n`)]));
const HASH = Object.fromEntries(ASSETS.map((name) => [name, createHash("sha256").update(BYTES[name]).digest("hex")]));
const SUMS = `${ASSETS.map((name) => `${HASH[name]}  ${name}`).join("\n")}\n`;
const FILES = { ...BYTES, SHA256SUMS: Buffer.from(SUMS) };

/** install.sh with meter_pin naming the test builds. */
function installFile(dir) {
  const path = join(dir, "install.sh");
  const cases = ASSETS.map((name) => `    ${name}) echo ${HASH[name]} ;;`).join("\n");
  writeFileSync(path, `#!/bin/sh\nmeter_pin() {\n  case $1 in\n${cases}\n  esac\n}\n`);
  return path;
}

const origin = (server) => `http://127.0.0.1:${server.address().port}`;

/**
 * A fake GitHub at 127.0.0.1:0. `<origin>/download/v0.3.0/<name>` answers `publicStatus` (or the
 * bytes when 200); `<origin>/api/releases/tags/v0.3.0` lists each asset at `<origin>/asset/<name>`,
 * which serves `assetBytes` or `assetStatus`. Records every request's path and headers.
 */
async function fakeGithub({ publicStatus = 504, apiStatus = 200, assetStatus = 200, assetBytes = FILES } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    requests.push({ path, headers: req.headers });
    if (path.startsWith(`/download/${TAG}/`)) {
      const name = path.slice(`/download/${TAG}/`.length);
      if (publicStatus === 200 && assetBytes[name]) {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(assetBytes[name]);
      } else {
        res.writeHead(publicStatus);
        res.end("public download failed");
      }
      return;
    }
    if (path === `/api/releases/tags/${TAG}`) {
      res.writeHead(apiStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ assets: ["SHA256SUMS", ...ASSETS].map((name) => ({ name, url: `${origin(server)}/asset/${name}` })) }));
      return;
    }
    if (path.startsWith("/asset/")) {
      const name = path.slice("/asset/".length);
      if (assetStatus === 200 && assetBytes[name]) {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(assetBytes[name]);
      } else {
        res.writeHead(assetStatus === 200 ? 404 : assetStatus);
        res.end("asset failed");
      }
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    requests,
    origin: origin(server),
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
  };
}

/** Run the check against the fake GitHub and this fixture's pins; collects logs and requests. */
async function run({ token = "", fetch: fetchImpl, ...githubOptions } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "usagemeter-pin-test-"));
  const github = await fakeGithub(githubOptions);
  const logs = [];
  const errors = [];
  try {
    const code = await check({
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
      base: `${github.origin}/download/${TAG}`,
      api: `${github.origin}/api`,
      tag: TAG,
      token,
      install: installFile(dir),
      pinned: HASH,
      assets: ASSETS,
      log: (line) => logs.push(line),
      error: (line) => errors.push(line),
    });
    return { code, logs, errors, requests: github.requests };
  } finally {
    await github.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a 504 from the public release download is served by the API asset route", async () => {
  const r = await run({ publicStatus: 504, token: "test-token" });
  assert.equal(r.code, 0, r.errors.join("\n"));
  for (const name of ["SHA256SUMS", ...ASSETS]) {
    assert.ok(r.logs.includes(`${name}: served by the REST API asset route`), `${name} names the API route`);
  }
  assert.ok(r.logs.some((line) => line.endsWith("pin the release's four builds.")), "the pin passes");
  const assets = r.requests.filter((request) => request.path.startsWith("/asset/"));
  assert.equal(assets.length, ASSETS.length + 1, "SHA256SUMS and every binary came from the API");
  assert.ok(assets.every((request) => request.headers.accept === "application/octet-stream"), "the asset url asks for octet-stream");
  assert.ok(assets.every((request) => request.headers.authorization === "Bearer test-token"), "GITHUB_TOKEN is the bearer token");
});

test("a network error from the public release download falls back too", async () => {
  const forwarded = globalThis.fetch;
  const offlinePublic = (url, init) => (String(url).includes(`/download/${TAG}/`) ? Promise.reject(new TypeError("fetch failed")) : forwarded(url, init));
  const r = await run({ fetch: offlinePublic });
  assert.equal(r.code, 0, r.errors.join("\n"));
  assert.ok(r.requests.every((request) => !request.path.startsWith("/download/")), "the public route was unreachable");
  assert.ok(ASSETS.every((name) => r.logs.includes(`${name}: served by the REST API asset route`)), "the API served every binary");
});

test("when both routes fail the check exits 2", async () => {
  const r = await run({ publicStatus: 504, apiStatus: 503 });
  assert.equal(r.code, 2);
  const errors = r.errors.join("\n");
  assert.match(errors, /HTTP 504/, "the public failure is reported");
  assert.match(errors, /the API asset route failed too/, "the fallback failure is reported");
  assert.match(errors, /HTTP 503/, "the API's status is reported");
});

test("wrong bytes from the API asset route still exit 1", async () => {
  const assetBytes = { ...FILES, "usagemeter-linux-x86_64": Buffer.from("not the pinned build\n") };
  const r = await run({ publicStatus: 504, assetBytes });
  assert.equal(r.code, 1, "a hash difference, not a route failure");
  assert.ok(r.logs.includes("usagemeter-linux-x86_64: served by the REST API asset route"), "the bytes came from the API");
  assert.match(r.errors.join("\n"), /usagemeter-linux-x86_64: (?:SHA256SUMS|release\.js|install\.sh)/);
});

test("a public release download that serves names the public route", async () => {
  const r = await run({ publicStatus: 200 });
  assert.equal(r.code, 0, r.errors.join("\n"));
  for (const name of ["SHA256SUMS", ...ASSETS]) {
    assert.ok(r.logs.includes(`${name}: served by the public release download`), `${name} names the public route`);
  }
  assert.ok(r.requests.every((request) => !request.path.startsWith("/asset/")), "the API was not needed");
});
