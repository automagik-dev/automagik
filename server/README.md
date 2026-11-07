# The Automagik server image

The `automagik-web` DeepSeek Harness profile on a host: dsh's base and web app, the Bot team
(`@automagik/bots-dsh`), the welcome (`@automagik/welcome-dsh`) and ACP agents
(`@automagik/acp-dsh`), from one chosen release. Built by CI only
(`.github/workflows/server-image.yml`): every change builds, smokes and scans it, and a dispatch
or a published release pushes it to `ghcr.io/automagik-dev/automagik-server` as
`:<content>-<short sha>` and, when allowed, `:latest`. There is no laptop push. Tracked in #620.

Pins: dsh `0.2.2-rc.1` (the desktop runtime's own lock) and the plugins at one release, the
content. A dispatch takes `-f content=<tag>`, a release whose assets include `plugins.json`
(e.g. `v3.93.0`); empty picks the newest stable release that carries it, within the last 30
releases. A release event uses its own version as the content. A herdr, Pocket or am patch
carries no plugin tarballs: a dispatch whose content has none is refused, naming the tag, and a
release event for such a version builds and pushes nothing. The `Dockerfile`'s
`AUTOMAGIK_VERSION` is that plugin release (default `3.90.1` for a manual build); CI passes it as
both `--version` and `--image-version`. The identity names the content and the tree: the tag
`:<content>-<short sha>` (e.g. `3.93.0-91cf4862`), `org.opencontainers.image.version` = the
content version, and `org.opencontainers.image.revision` = the full workflow commit. A
`versions.json` inside the image names the plugin release it installed. Each tarball is checked
against the release's `plugins.json` (sha512 integrity, size) and `PLUGINS.SHA256SUMS` (sha256)
before dsh installs it.

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
that digest, not a tag. `:<content>-<short sha>` identifies one build of one content release from
one commit; the version label is the content release and the revision label the commit. `:latest`
moves only when the content release is not a prerelease and its version is not older than the
published `:latest` (compared by that label). GitHub creates a new package private, so the first
publish needs the one-time visibility flip below before an anonymous pull works.

## Publish

A published release for a version that carries `plugins.json` publishes the image. A cut's own
release starts no workflow (GitHub suppresses events made with `GITHUB_TOKEN`), so dispatch it
after merge:

```sh
gh workflow run server-image.yml --ref dev -f content=v3.93.0
```

`content` is the release tag whose plugin tarballs are installed; empty means the newest stable
release that has `plugins.json`. The dispatch runs on `dev` or on a `v<version>` tag equal to
`package.json`'s version. A pull request or a push to `dev` only builds and scans.

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
node server/build.mjs --tag automagik-server:local --version 3.93.0 --image-version 3.93.0 \
  --revision "$(git rev-parse HEAD)"
node server/smoke.mjs automagik-server:local
```

`--version` is the release whose plugin tarballs are installed; `--image-version` is the content
version label (normally the same release, without its `v`); `--revision` is the commit label. With
no arguments the release is `3.90.1` and the revision label `unknown`.

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

### Incus

Incus creates a custom volume root-owned, and the image runs as uid 1000: the first start cannot
write `/data` unless the volume is created for that uid, and the image cannot chown (it runs as
1000 and has no root). Create and attach the volume with its initial owner:

```sh
incus storage volume create <pool> automagik-data initial.uid=1000 initial.gid=1000
incus storage volume attach <pool> automagik-data <instance> data /data
```

`attach` takes a device name (`data`) and then the mount path (`/data`); a filesystem volume
requires the path. Incus takes `initial.uid` and `initial.gid` as positional `key=value` config
on `create`. For an existing root-owned volume, chown it to `1000:1000` on the host instead
(`chown -R 1000:1000 <the volume's path>`). Docker's named volume needs neither: Docker seeds a
fresh volume with the image's `/data` ownership (1000:1000).

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

The **compressed** figure is the sum of the registry manifest's layer sizes (`.layers[].size`),
the compressed blobs a pull fetches; it is not a `docker save | gzip` artifact. **Unpacked** is
the sum of the layers' regular file payloads. The earlier 193 MiB figure was a `docker save` gzip
artifact of 202,734,124 bytes, a different count and never the image size.

`yoga` (IncusOS, Incus 7.6, ZFS), 2026-11-07, on the image in the table below. Pull and create
are the Incus timings for the launch. Memory is the instance's cgroup (`memory.current`) unless
the row says RSS; anon and file are the 5-minute split.

| Measure | Value |
|---|---|
| Image | `sha256:f3ba1643b147fa78f76bf05e736d17c11c5e4f3fd2589469f327093c225fba09` |
| Layers | 18 |
| Unpacked | 516.8 MiB |
| Compressed OCI blobs | 185,312,829 bytes (176.7 MiB) |
| Pull | 21.3 s |
| Create | 4.3 s |
| First 401 | 4.1 s (polled every 1.6 s, likely 2.5–4 s) |
| Idle at 5 min | 198.9 MiB cgroup (anon 163 MiB, file 35 MiB) |
| Largest RSS | 174 MiB |
| First minute | ~341 MiB |
| By minute 2 | ~206 MiB |
| CPU | 0.09% of one core |
| Warnings | none |

The **350 MB unpacked target is not reachable** (516.8 MiB). The **350 MB compressed target is
met** (176.7 MiB).

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
