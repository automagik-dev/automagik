# The Automagik server image

The `automagik-web` DeepSeek Harness profile on a host: dsh's base and web app, the Bot team
(`@automagik/bots-dsh`), the welcome (`@automagik/welcome-dsh`) and ACP agents
(`@automagik/acp-dsh`), from one pinned release. Built by CI only
(`.github/workflows/server-image.yml`): every change builds, smokes and scans it, and a dispatch
or a published release pushes it to `ghcr.io/automagik-dev/automagik-server` as `:<version>` and
`:latest`. There is no laptop push. Tracked in #620.

Pins: dsh `0.2.2-rc.1` (the desktop runtime's own lock) and the plugins at the release in
`server/Dockerfile` (`AUTOMAGIK_VERSION`, default `3.90.1` for a manual build). CI sets
`AUTOMAGIK_VERSION` to the newest stable release that carries `plugins.json`, because a herdr,
Pocket or am patch carries no plugin tarballs (a build-only run falls back to that release; a
publish dispatch requires the dispatched version's own release to carry the plugin tarballs).
The image's `:<version>` tag and its `org.opencontainers.image.version` label are the repository
version (`IMAGE_VERSION`). A `versions.json` inside the image names the plugin release it
installed. Each tarball is checked against the release's `plugins.json` (sha512 integrity, size)
and `PLUGINS.SHA256SUMS` (sha256) before dsh installs it.

The builder also applies the desktop app's DSH runtime patches
(`apps/desktop/runtime/patches` via `apps/desktop/scripts/runtime-patches.mjs`) to the same
pinned packages, and fails the build on any version or hash mismatch. Today that includes
`frontend-static-index-cache.patch`: the SPA index gets `cache-control: no-cache` with a weak
ETag of the rendered bytes, and a matching `If-None-Match` gets an empty 304, so a reload after
a plugin update cannot keep a stale manifest.

## Pull

```sh
docker pull ghcr.io/automagik-dev/automagik-server@sha256:…
```

The publish job prints the manifest digest in its summary and saves it as `image-digest.txt`; pin
that digest, not a tag. `:<version>` is the repository version whose release supplied the plugin
tarballs (the same value `scripts/version.ts` writes). `:latest` moves only on a non-prerelease
publish and never to an older version. GitHub creates a new package private, so the first publish
needs the one-time visibility flip below before an anonymous pull works.

## The image

Three stages, every base digest-pinned:

| Stage | What it does |
|---|---|
| `builder` | `node:24.22.2-trixie-slim`: installs the pinned harness and pnpm, fetches and verifies the release tarballs, installs the profile with dsh's own `plugin … install`, prunes what the profile does not compose, writes `versions.json` |
| `tools` | `debian:bookworm-slim`: `bash`, `dash` as `/bin/sh`, git core, `ripgrep`, their `ldd` closure, and the empty `/data` tree owned by uid 1000. No perl: git's perl subcommands are not shipped |
| `runtime` | `scratch` holding the distroless nodejs24 rootfs (node and glibc), cleaned in the `tools` stage (man pages and changelogs stripped there with coreutils), plus the tools above, the code, nothing else — no apt, npm, curl or build toolchain |

The distroless tag ships Node 24.14.0 (above dsh's 24.9 floor); the builder is 24.22.2. The
pruned payload keeps everything the composed tree names — office-to-pdf and its
`libreoffice-kit-wasm` included — and drops the inspector, the voice engine, the musl sharp
variants, the win32/darwin node-pty prebuilds and the experimental bundles the profile never
composes.

## Build and smoke

```sh
node server/build.mjs --tag automagik-server:local --version 3.93.0 --image-version 3.93.1
node server/smoke.mjs automagik-server:local
```

`--version` is the release whose plugin tarballs are installed; `--image-version` is the version
label (the repository's). With no arguments both are `3.90.1`.

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
  ghcr.io/automagik-dev/automagik-server@sha256:…
```

Use `automagik-server:local` here after `node server/build.mjs --tag automagik-server:local` to
run a build from this checkout.

No port is published: dsh binds `127.0.0.1:3081` inside the container, as the production host's
layout does. That is reachable with `--network host` on Linux, or by running the reverse proxy in
the same network namespace; `-p 3081:3081` does not reach a loopback bind. There is no `EXPOSE`.

The key comes from `DEEPSEEK_API_KEY`, or from a `0400`/`0600` file: `DEEPSEEK_API_KEY_FILE`,
else `/data/secrets/deepseek-api-key`, else `/run/secrets/deepseek_api_key`. A file readable by
group or other, or executable, stops the start (Docker's `0444` secrets need the env instead).
The value is never logged.

`DEEPSEEK_API_KEY` is optional for the idle server: without it the image still boots, the auth
fence answers `401` and the welcome offers the sign-in tiles. A model turn needs the key; a
healthy `401` says the fence is up, not that a model is configured.

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

## Visibility

GitHub creates a new Container package private even when the repository is public, and its REST
API has no endpoint for a Container package's visibility (as of 2026-11). Make it public once, as
an organization owner:

1. Open <https://github.com/orgs/automagik-dev/packages/container/automagik-server>.
2. **Package settings → Danger Zone → Change visibility → Public**.

The publish job checks the package with `GITHUB_TOKEN` and, when it is not public (or the token
cannot read packages), leaves this path in the job summary and warns. The image is still pushed,
but anonymous pulls fail until the flip; the login-less pull is the verification:

```sh
docker logout ghcr.io 2>/dev/null || true
docker pull ghcr.io/automagik-dev/automagik-server@sha256:…
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

## Secrecy gate

The workflow extracts the built image's rootfs (`docker export`; the image is never run), lists
every file and scans it before logging in or pushing (`server/secrecy.mjs`). Every file gets the
repository's own privacy grep (`herdr/scripts/privacy-check.mjs`, same deny list) plus the image
rules: a provider key, a `token=` or JSON token field, a private-key block with a real body (a
base64 line of any length, a short final line, or a `Proc-Type`/`DEK-Info` header; a bare
`BEGIN`/`END` label is not a key), a `.env` or `launch-url` file, any file under `/data` (the
image bakes no profile, bot/team state, workspace or secret), a home or `/mnt/ai` path, a
credential URL, an archive (not opened by this scan), or an environment variable named like a
secret. The image's config is scanned too. A hit fails the job.

The only exceptions are exact entries in `server/secrecy-allowlist.json`: one file, one rule and
the exact matched string (or its sha256), each with a reason. There are no path patterns, and a
key, `/data`, this repository's own code, `/etc` or a config file may never be allowlisted. A
private-key block is an entry only for the six reviewed gnutls test vectors in
`usr/lib/x86_64-linux-gnu/libgnutls.so.30`; each names its gnutls source and pins both the block
sha256 and the containing library's `sha256sum` (so a library update stops matching). The Node
binary's `/home/iojs` is excused only when that binary's `sha256sum` matches the entry's pin. The
workflow lists the entries used and reports a stale entry.

The image is shrunk before the scan: third-party test, example and docs folders, non-Linux
prebuilds and the profile's `vendor/*.tgz` install inputs are pruned (`assemble.mjs`), and the
`tools` stage copies the distroless rootfs, strips `usr/share/doc`, `man`, `info` and `lintian`
there with coreutils, and the final `scratch` copies that cleaned rootfs. There is no `rm` in
the runtime image. The `archive` rule never allows an archive that is left.

The image's `/etc/passwd` is the repository's own (`server/passwd`), with no `/home/<user>`; the
distroless `nonroot` home is not in the image. The layer list is the image's RootFS plus
`docker save`'s manifest blobs (the content scan is the final flattened rootfs, which is what
runs), and external/dangling symlinks are listed rather than followed. The inventory, the exact
allowlist used and the symlink list are uploaded as an artifact. Before the real build, CI also
runs the gate in image mode against a small image with a planted key and requires it to fail.

Run it on an already-extracted tree without Docker:

```sh
node server/secrecy.mjs --rootfs /tmp/rootfs --inventory secrecy
```

## Files

| File | Role |
|---|---|
| `Dockerfile`, `Dockerfile.dockerignore` | the builder, tools and distroless runtime stages |
| `assemble.mjs` | builder stage: runtime, release tarballs, profile, prune |
| `fetch-plugins.mjs` | downloads and verifies the pinned release's tarballs |
| `entrypoint.mjs`, `lib.mjs` | seed `/data`, key file, pnpm store, dsh, redacted log |
| `healthcheck.mjs` | the Docker health check |
| `secrecy.mjs`, `secrecy-allowlist.json` | pre-push scan: rootfs extraction, inventory, rules and the exact reviewed exceptions |
| `passwd` | the image's account record (no `/home/<user>`; `automagik` is uid 1000) |
| `bin/dsh`, `bin/pnpm` | the image's pinned commands for `docker exec` |
| `profile/` | the seed profile: `package.json`, `cordis.patch.yml`, `pnpm-workspace.yaml` |
| `build.mjs`, `smoke.mjs`, `test/` | build, end-to-end smoke, unit tests |

## Tests

```sh
node --test 'server/test/*.test.mjs'
```

The unit tests cover the token redaction, the startup-line match, the private-key rule, the
first-start-only seed, the pnpm-store pin, the tarball verification, the third-party prune, and
the secrecy gate: 17 negative probes (keys, tokens, a real-shaped fake private key, `/mnt/ai`,
homes, a private name, credentials, `.env`, `launch-url`, `/data` state, an archive, and a key
that the allowlist may never excuse), that a bare PEM label is not a key while a short final
line and a `Proc-Type`/`DEK-Info` header are, that a private-key entry is allowed only for the
gnutls library, that the Node build account is excused only for the pinned binary hash, the exact
allowlist, and that the image's own redaction regex is not mistaken for a token. The smoke is
the real check of the image; the workflow runs the scan on the real rootfs before pushing.
