# syntax=docker/dockerfile:1
# The Automagik server image: the automagik-web dsh profile (dsh-base + dsh-web-app, the Bot
# team, the welcome and ACP) on a pinned DeepSeek Harness, ready for /data on a host. Built by
# CI only (.github/workflows/server-image.yml), never pushed.
#
# Build from the repository root (the builder reuses the desktop's pinned runtime lock):
#   docker build -f server/Dockerfile -t automagik-server .
#
# The release pins are build args; the defaults are the release this image ships. Every plugin
# tarball is checked against the release's plugins.json (sha512 integrity, size) and
# PLUGINS.SHA256SUMS (sha256) before dsh installs it (server/fetch-plugins.mjs).

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

# The runtime stage is the same Debian slim with node, the image's code, and the tools Bots
# need in their shell (bash, git, ripgrep): no npm, no build toolchain, no curl.
FROM node:24.22.2-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS runtime

ARG AUTOMAGIK_VERSION=3.90.1

LABEL org.opencontainers.image.title="Automagik server" \
      org.opencontainers.image.description="The automagik-web DeepSeek Harness profile for a host: the Bot team, the welcome and ACP agents" \
      org.opencontainers.image.source="https://github.com/automagik-dev/automagik" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${AUTOMAGIK_VERSION}"

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends bash ca-certificates git ripgrep; \
    rm -rf /var/lib/apt/lists/*; \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack; \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# The non-root user owns /data and nothing under /opt. uid and gid 1000, for a bind-mounted
# data folder the host can chown to the same.
RUN set -eux; \
    userdel --remove node || true; \
    groupdel node || true; \
    groupadd --gid 1000 automagik; \
    useradd --uid 1000 --gid 1000 --home-dir /data --no-create-home --shell /bin/bash automagik; \
    mkdir -p /data/dsh /data/bots /data/workspace /data/secrets; \
    chmod 0700 /data/secrets; \
    chown -R automagik:automagik /data

COPY --from=builder /build/out/runtime /opt/automagik/runtime
COPY --from=builder /build/out/profile /opt/automagik/profile
COPY --from=builder /build/out/versions.json /opt/automagik/versions.json
COPY server/entrypoint.mjs server/healthcheck.mjs server/lib.mjs /opt/automagik/
COPY server/bin/dsh server/bin/pnpm /usr/local/bin/
RUN chmod 0755 /opt/automagik/entrypoint.mjs /opt/automagik/healthcheck.mjs /usr/local/bin/dsh /usr/local/bin/pnpm

ENV HOME=/data \
    DSH_HOME=/data/dsh \
    AUTOMAGIK_BOTS_HOME=/data/bots \
    AUTOMAGIK_HOME=/data \
    AUTOMAGIK_WORKSPACE=/data/workspace \
    NODE_ENV=production \
    DO_NOT_TRACK=1

USER automagik
WORKDIR /data/workspace

# 401 is the healthy answer without a browser session: the auth fence is up. The script prints
# the code to the container's health log; it uses node, not curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["node", "/opt/automagik/healthcheck.mjs"]

ENTRYPOINT ["/usr/local/bin/node", "/opt/automagik/entrypoint.mjs"]
# The base node image's CMD is ["node"]; the entrypoint takes no arguments.
CMD []
