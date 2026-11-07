# The Automagik server image

The `automagik-web` DeepSeek Harness profile on a host: dsh's base and web app, the Bot team
(`@automagik/bots-dsh`), the welcome (`@automagik/welcome-dsh`) and ACP agents
(`@automagik/acp-dsh`), from one pinned release. Built by CI only and never pushed
(`.github/workflows/server-image.yml`).

Pins: dsh `0.2.2-rc.1` (the desktop runtime's own lock) and the plugins at the release in
`server/Dockerfile` (`AUTOMAGIK_VERSION`, default `3.90.1`). Each tarball is checked against the
release's `plugins.json` (sha512 integrity, size) and `PLUGINS.SHA256SUMS` (sha256) before dsh
installs it. The profile is installed at build time by dsh's own `plugin … install`, so the
image needs no package manager at boot beyond that profile's pnpm.

## Build and smoke

```sh
node server/build.mjs                       # docker build, prints id and size
node server/smoke.mjs automagik-server:local
```

The context is the repository root because the builder reuses
`apps/desktop/runtime/package-lock.json`; `server/Dockerfile.dockerignore` keeps the context
small. The smoke runs the image with a named volume (no published port), waits for `401`, checks
the log has no token, the profile and its three plugins are in `/data`, `launch-url` is `0600`,
the process is uid 1000, Docker's health check turns healthy, and a restart does not reseed.

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
group or other stops the start (Docker's `0444` secrets need the env instead). The value is
never logged. With no key the server still boots; the welcome offers the sign-in tiles.

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

`ryzen` (x86_64, 32 vCPU, 128 GiB RAM, Docker 29.9.1, Linux 7.0), image
`automagik-server:dev`, 2026-11-07. Start-to-401 polls the in-image health script every 50 ms;
the cold figure uses a fresh named volume and includes the first-start profile seed.

| Measure | Value |
|---|---|
| Image size (`docker image inspect .Size`) | 1,172,975,375 bytes (1118.6 MiB), 14 layers |
| Cold start to 401 (fresh `/data`) | 2,906 ms |
| Restart to 401 (seeded `/data`) | 2,621 ms |
| Idle RSS after 5 min | 162.5 MiB (`memory.current`); 157.4 MiB in `docker stats` |
| Idle CPU over 290 s | 0.0049 core (0.11% in a `docker stats` snapshot) |
| Processes / peak RSS | 19 / 317.0 MiB |

The harness is the size: `/opt/automagik/runtime` is 469 MiB (`@deepseek-ai` alone 261 MiB)
and the profile 44 MiB. The base and the shell tools add the rest; there is no npm, curl or
build toolchain.

## Health

```sh
docker inspect --format '{{.State.Health.Status}}' automagik   # healthy
docker exec automagik node /opt/automagik/healthcheck.mjs      # prints 401
docker logs automagik | grep 'startup:'
```

`401` is the healthy answer without a browser session: the auth fence is up. `200` (a launch
URL's token) is healthy too; no answer prints `000` and fails. The check is Node's `http`, not
curl. The entrypoint logs `startup: http://127.0.0.1:3081/ (token in /data/dsh/launch-url)`.

## Files

| File | Role |
|---|---|
| `Dockerfile`, `Dockerfile.dockerignore` | the two-stage image |
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
