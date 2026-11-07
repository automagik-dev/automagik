# The Automagik server image

The `automagik-web` DeepSeek Harness profile on a host: dsh's base and web app, the Bot team
(`@automagik/bots-dsh`), the welcome (`@automagik/welcome-dsh`) and ACP agents
(`@automagik/acp-dsh`), from one pinned release. Built by CI only and never pushed
(`.github/workflows/server-image.yml`). Tracked in #620.

Pins: dsh `0.2.2-rc.1` (the desktop runtime's own lock) and the plugins at the release in
`server/Dockerfile` (`AUTOMAGIK_VERSION`, default `3.90.1`). Each tarball is checked against the
release's `plugins.json` (sha512 integrity, size) and `PLUGINS.SHA256SUMS` (sha256) before dsh
installs it.

## The image

Three stages, every base digest-pinned:

| Stage | What it does |
|---|---|
| `builder` | `node:24.22.2-trixie-slim`: installs the pinned harness and pnpm, fetches and verifies the release tarballs, installs the profile with dsh's own `plugin … install`, prunes what the profile does not compose, writes `versions.json` |
| `tools` | `debian:bookworm-slim`: `bash`, `dash` as `/bin/sh`, git core, `ripgrep`, their `ldd` closure, and the empty `/data` tree owned by uid 1000. No perl: git's perl subcommands are not shipped |
| `runtime` | `gcr.io/distroless/nodejs24-debian12`: node and glibc, the code, the tools above, nothing else — no apt, npm, curl or build toolchain |

The distroless tag ships Node 24.14.0 (above dsh's 24.9 floor); the builder is 24.22.2. The
pruned payload keeps everything the composed tree names — office-to-pdf and its
`libreoffice-kit-wasm` included — and drops the inspector, the voice engine, the musl sharp
variants, the win32/darwin node-pty prebuilds and the experimental bundles the profile never
composes.

## Build and smoke

```sh
node server/build.mjs --tag automagik-server:local
node server/smoke.mjs automagik-server:local
```

The context is the repository root because the builder reuses
`apps/desktop/runtime/package-lock.json`; `server/Dockerfile.dockerignore` keeps the context
small. The smoke runs the image with a named volume (no published port), waits for `401`, checks
the log has no token (it reads the real token from `/data/dsh/launch-url`), the profile and its
three plugins are in `/data`, `launch-url` is `0600`, the process is uid 1000, Docker's health
check turns healthy, the composed tree still has its 200 entries (bots, welcome, ACP, web app,
office), no composed plugin failed to import, koffi and node-pty load and a PTY spawns, and a
restart does not reseed. No coreutils are assumed: the checks use node and bash.

## Run

```sh
docker volume create automagik-data
docker run -d --name automagik --network host \
  --volume automagik-data:/data \
  --env DEEPSEEK_API_KEY=sk-… \
  automagik-server:local
```

dsh binds `127.0.0.1:3081` inside the container, as the production host's layout does. That is
reachable with `--network host` on Linux, or by running the reverse proxy in the same network
namespace; `-p 3081:3081` does not reach a loopback bind. There is no `EXPOSE`.

The key comes from `DEEPSEEK_API_KEY`, or from a `0400`/`0600` file: `DEEPSEEK_API_KEY_FILE`,
else `/data/secrets/deepseek-api-key`, else `/run/secrets/deepseek_api_key`. A file readable by
group or other, or executable, stops the start (Docker's `0444` secrets need the env instead).
The value is never logged. With no key the server still boots; the welcome offers the sign-in
tiles.

| Mount | What it holds |
|---|---|
| `/data` | the volume: `dsh/`, `bots/`, `workspace/`, `secrets/`, `dsh/launch-url` |
| `/data/dsh` | `DSH_HOME`: the `automagik-web` profile, dsh settings, `pnpm-store` |
| `/data/bots` | `AUTOMAGIK_BOTS_HOME`: the Bot team's state |
| `/data/workspace` | the working directory (the workspace root dsh gives its Sessions) |
| `/data/secrets/deepseek-api-key` | optional model key, `0400` |

`/opt/automagik` is read-only code. The image bakes nothing into `/data`: the profile is seeded
at the first start only, and an existing profile is the user's and is never replaced. To reseed
from a newer image, move `/data/dsh/profiles/automagik-web` aside first.

The first launch URL, token included, is written to `/data/dsh/launch-url` (`0600`) and printed
redacted in the log:

```sh
docker exec automagik cat /data/dsh/launch-url
```

## Measured

One named store: the **OCI image** (`docker buildx build --output type=oci`, the path a registry
and Arca pull). Uncompressed is the sum of regular file payloads across the 35 layers — the
number CI's `docker image inspect .Size` reports; compressed is the sum of their gzip blobs.
`docker image inspect .Size` on the classic store reports 785.0 MiB for the same content; that
is layer accounting and is not used.

`ryzen` (x86_64, 32 vCPU, 128 GiB RAM, Docker 29.9.1, Linux 7.0), 2026-11-07. Start-to-401
polls the in-image health script every 50 ms; the cold figure uses a fresh named volume and
includes the first-start profile seed.

| Measure | Value |
|---|---|
| Image content (OCI, 35 layers) | 571,644,590 bytes (545.2 MiB) |
| Compressed OCI blobs | 195,678,897 bytes (186.6 MiB) |
| Cold start to 401 (fresh `/data`) | 2,908 ms (CI smoke: 1,965 ms) |
| Restart to 401 (seeded `/data`) | 2,169 ms (CI smoke: 1,430 ms) |
| Idle RSS after 5 min | 166.5 MiB (`memory.current`); 154.9 MiB in `docker stats` |
| Idle CPU over 291 s | 0.0050 core (0.11% in a `docker stats` snapshot) |
| Processes / peak RSS | 25 / 317.4 MiB |

f657be63 measured 562.0 MiB content / 190.0 MiB compressed before the dead perl dirs were
dropped. The **350 MB uncompressed target is not reachable**: 545.2 MiB content, of which the
office stack alone is 146 MiB; removing it leaves ~399 MiB, still above 350. **350 MB compressed
is met** (186.6 MiB).

## Health

```sh
docker inspect --format '{{.State.Health.Status}}' automagik   # healthy
docker exec automagik /nodejs/bin/node /opt/automagik/healthcheck.mjs   # prints 401
docker logs automagik | grep 'startup:'
```

**Only `401` is healthy**: the auth fence is up. A `200` means the fence answered without a
session, so it fails; no answer prints `000` and fails. The check is Node's `http`, not curl. The
entrypoint logs `startup: http://127.0.0.1:3081/ (token in /data/dsh/launch-url)`.

## Files

| File | Role |
|---|---|
| `Dockerfile`, `Dockerfile.dockerignore` | the builder, tools and distroless runtime stages |
| `assemble.mjs` | builder stage: runtime, release tarballs, profile, prune |
| `fetch-plugins.mjs` | downloads and verifies the pinned release's tarballs |
| `entrypoint.mjs`, `lib.mjs` | seed `/data`, key file, pnpm store, dsh, redacted log |
| `healthcheck.mjs` | the Docker health check |
| `bin/dsh`, `bin/pnpm` | the image's pinned commands for `docker exec` |
| `profile/` | the seed profile: `package.json`, `cordis.patch.yml`, `pnpm-workspace.yaml` |
| `build.mjs`, `smoke.mjs`, `test/` | build, end-to-end smoke, unit tests |

## Tests

```sh
node --test 'server/test/*.test.mjs'
```

The unit tests cover the token redaction, the startup-line match, the private-key rule, the
first-start-only seed, the pnpm-store pin, and the tarball verification. The smoke is the real
check of the image.
