# syntax=docker/dockerfile:1
# The Automagik server image: the automagik-web dsh profile (dsh-base + dsh-web-app, the Bot
# team, the welcome and ACP) on a pinned DeepSeek Harness, ready for /data on a host. Built by
# CI only (.github/workflows/server-image.yml), which extracts the rootfs, scans it
# (server/secrecy.mjs) and only then publishes it to ghcr.io/automagik-dev/automagik-server.
#
# Build from the repository root (the builder reuses the desktop's pinned runtime lock):
#   docker build -f server/Dockerfile -t automagik-server .
#
# The runtime is distroless: node and glibc, the image's code, and the tools Bots need in their
# shell (bash, dash as /bin/sh, git core, ripgrep). No npm, apt, curl or build
# toolchain. The release pins are build args; every plugin tarball is checked against the
# release's plugins.json (sha512 integrity, size) and PLUGINS.SHA256SUMS (sha256) before dsh
# installs it (server/fetch-plugins.mjs).

FROM node:24.22.2-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS builder

ARG AUTOMAGIK_VERSION=3.90.1
ARG DSH_VERSION=0.2.2-rc.1
ARG AUTOMAGIK_REPOSITORY=https://github.com/automagik-dev/automagik

ENV DO_NOT_TRACK=1 \
    npm_config_fund=false \
    npm_config_audit=false \
    npm_config_update_notifier=false

WORKDIR /build
# The desktop's own runtime pins (dsh 0.2.2-rc.1, pnpm 10.34.6, zod 4.4.3) and the pruner the
# desktop build uses. The same pins keep this image on the harness the plugins are tested on.
COPY apps/desktop/runtime/package.json apps/desktop/runtime/package-lock.json /build/apps/desktop/runtime/
COPY apps/desktop/scripts/prune-runtime.mjs /build/apps/desktop/scripts/prune-runtime.mjs
COPY server /build/server

RUN node /build/server/assemble.mjs \
      --out /build/out \
      --version "$AUTOMAGIK_VERSION" \
      --dsh "$DSH_VERSION" \
      --repository "$AUTOMAGIK_REPOSITORY"

# The shell tools Bots need, prepared for the distroless base: the binaries, the shared-library
# closure ldd names for them, and the /data ownership. Git core only: perl-based git
# subcommands are not shipped. Debian 12 here matches
# the distroless nodejs24-debian12 base.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS tools

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends bash dash git ripgrep ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /out/bin /out/lib /out/data/dsh /out/data/bots /out/data/workspace /out/data/secrets; \
    for f in /bin/bash /bin/dash /usr/bin/git /usr/bin/rg /usr/lib/git-core/*; do ldd "$f" 2>/dev/null || true; done \
      | awk '/=>/ {print $3}' | sort -u > /tmp/libs; \
    while read -r lib; do \
      case "$lib" in \
        */libc.so.6|*/libm.so.6|*/libpthread.so.0|*/libdl.so.2|*/librt.so.1|*/libstdc++.so.6|*/libgcc_s.so.1|*/ld-linux*) continue;; \
      esac; \
      cp -L "$lib" /out/lib/; \
    done < /tmp/libs; \
    cp /bin/bash /bin/dash /usr/bin/git /usr/bin/rg /out/bin/; \
    ln -s /bin/dash /out/bin/sh; \
    cp -a /usr/lib/git-core /out/git-core; \
    cp -a /usr/share/git-core /out/git-core-share; \
    cp -a /etc/ssl/certs /out/certs; \
    chmod 0700 /out/data/secrets; \
    chown -R 1000:1000 /out/data

FROM gcr.io/distroless/nodejs24-debian12@sha256:61f4f4341db81820c24ce771b83d202eb6452076f58628cd536cc7d94a10978b AS runtime

ARG AUTOMAGIK_VERSION=3.90.1

LABEL org.opencontainers.image.title="Automagik server" \
      org.opencontainers.image.description="The automagik-web DeepSeek Harness profile for a host: the Bot team, the welcome and ACP agents" \
      org.opencontainers.image.source="https://github.com/automagik-dev/automagik" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${AUTOMAGIK_VERSION}"

COPY --from=tools /out/bin/bash /bin/bash
COPY --from=tools /out/bin/dash /bin/dash
COPY --from=tools /out/bin/sh /bin/sh
COPY --from=tools /out/bin/git /usr/bin/git
COPY --from=tools /out/bin/rg /usr/bin/rg
COPY --from=tools /out/git-core /usr/lib/git-core
COPY --from=tools /out/git-core-share /usr/share/git-core
COPY --from=tools /out/certs /etc/ssl/certs
COPY --from=tools /out/lib/ /usr/lib/x86_64-linux-gnu/
COPY --from=tools --chown=1000:1000 /out/data /data

COPY --from=builder /build/out/runtime /opt/automagik/runtime
COPY --from=builder /build/out/profile /opt/automagik/profile
COPY --from=builder /build/out/versions.json /opt/automagik/versions.json
COPY server/entrypoint.mjs server/healthcheck.mjs server/lib.mjs /opt/automagik/
# No /home/<user> in the image's account record: the distroless nonroot home is replaced with
# the uid the image actually runs as. The scanner's home check then has nothing to excuse.
COPY server/passwd /etc/passwd
COPY --chmod=0755 server/bin/dsh server/bin/pnpm /usr/local/bin/

ENV HOME=/data \
    DSH_HOME=/data/dsh \
    AUTOMAGIK_BOTS_HOME=/data/bots \
    AUTOMAGIK_HOME=/data \
    AUTOMAGIK_WORKSPACE=/data/workspace \
    NODE_ENV=production \
    DO_NOT_TRACK=1 \
    PATH=/nodejs/bin:/usr/local/bin:/usr/bin:/bin

# Distroless has no useradd: the uid/gid are numeric, and /data is already theirs.
USER 1000:1000
WORKDIR /data/workspace

# 401 is the healthy answer without a browser session: the auth fence is up. The script prints
# the code to the container's health log; it uses node, not curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["/nodejs/bin/node", "/opt/automagik/healthcheck.mjs"]

ENTRYPOINT ["/nodejs/bin/node", "/opt/automagik/entrypoint.mjs"]
CMD []
