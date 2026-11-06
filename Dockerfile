# Build base — includes native-module compilation tools (NOT used in production)
# Debian bookworm-slim on Node 24 LTS (glibc, not musl) — picked over Alpine for
# fewer unfixed-CVE flags and a more conventional native-module build environment.
FROM node:24-bookworm-slim AS build-base

# Refresh package index and apply security patches
RUN apt-get update \
    && apt-get -y upgrade \
    && rm -rf /var/lib/apt/lists/*

# Install build dependencies for node-pty (no Linux prebuild). The SQLite3 Multiple Ciphers
# driver ships prebuilt Node-API binaries and needs no compiler.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install all dependencies (for building)
FROM build-base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/fix-node-pty-permissions.js scripts/sync-pdf-worker.js ./scripts/
RUN npm ci

# Install production-only dependencies (for the final image)
FROM build-base AS deps-prod
WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/fix-node-pty-permissions.js scripts/sync-pdf-worker.js ./scripts/
RUN npm ci --omit=dev && npm rebuild

# Development stage
FROM build-base AS development
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY scripts/fix-node-pty-permissions.js scripts/sync-pdf-worker.js ./scripts/

# Install all dependencies (including dev dependencies for development)
RUN npm ci

# Copy source code
COPY . .

# Rebuild native modules for the current Debian/glibc platform (node-pty)
RUN npm rebuild

# Generate self-signed localhost certificate for dev SSL usage
# (openssl ships in bookworm-slim, but install explicitly for clarity)
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p certs && \
    openssl req -x509 -nodes -newkey rsa:2048 \
      -keyout certs/localhost-key.pem \
      -out certs/localhost.pem \
      -days 365 \
      -subj "/C=US/ST=Development/L=Local/O=Quilltap Dev/OU=Dev/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# Same entrypoint as production, so the timezone knobs stay in lockstep here too
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
CMD ["npm", "run", "dev"]

# Build stage
FROM build-base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build plugins first (transpile TypeScript to JavaScript)
# SKIP_ENV_VALIDATION=true skips runtime env var validation during build
RUN SKIP_ENV_VALIDATION=true npm run build:plugins

# Remove plugin node_modules (dependencies are bundled during build)
RUN rm -rf /app/plugins/dist/*/node_modules

# Build Next.js using webpack (Turbopack default in Next 16+ exceeds Docker memory limits)
# SKIP_ENV_VALIDATION=true skips runtime env var validation during build
# NODE_OPTIONS caps V8 heap to prevent OOM-kills in memory-constrained containers
RUN SKIP_ENV_VALIDATION=true NODE_OPTIONS="--max-old-space-size=3072" npx next build --webpack

# Overlay our custom server entry, terminal WS handler, child entry, and bootstrap
# shim onto the Next.js standalone tree. Single source of truth lives in
# scripts/build-standalone-overlay.mjs — the same script is invoked from
# .github/workflows/release.yml and scripts/build-standalone-tarball.mjs so the
# esbuild flags and the child's externals list can't drift between call sites.
RUN node scripts/build-standalone-overlay.mjs .next/standalone

# Production stage — Wolfi, not Debian. Clean image WITHOUT build tools.
#
# Every finding left in the bookworm image was a Debian OS package with no fix
# available (util-linux, zlib, ncurses, systemd libs, gzip, acl — "affected",
# "fix_deferred" or "will_not_fix"), and trixie scanned worse. Wolfi is glibc
# (2.44, above the SQLite driver's 2.35 floor), rebuilds its packages
# continuously, and scans clean. Only this stage ships, so the build stages
# above stay on node:24-bookworm-slim — Wolfi only packages npm 12, and the
# lockfile is installed with the same npm 11 that CI uses. node_modules built
# there (glibc 2.36) load unchanged on Wolfi's newer glibc; all three native
# modules are Node-API.
#
# Unpinned on purpose: wolfi-base is rebuilt daily, and a moving tag is what
# invalidates the build cache so `apk upgrade` actually fetches new fixes.
FROM cgr.dev/chainguard/wolfi-base:latest AS production
WORKDIR /app

# Runtime packages, upgraded on every build:
#   - nodejs-24 — the runtime (npm is a separate package and is NOT installed)
#   - libstdc++ — node-pty's native binding links it
#   - bash — required by Ariel's terminal (PTY hard-codes /bin/bash)
#   - zip + unzip — backup/restore (lib/backup/restore/archive.ts and
#     lib/backup/backup-service.ts shell out to `unzip` / `zip`)
#
# git/curl/wget/jq were previously pre-installed here as a convenience toolbox for
# the LLM shell agent. They were removed for CVE surface (git dragged in perl,
# curl/git pulled libssh2) and none of them are on a code path — the `curl`
# *tool* is qtap-plugin-curl, which uses Node's fetch(), not the binary.
RUN apk upgrade --no-cache \
    && apk add --no-cache nodejs-24 libstdc++ bash zip unzip \
    && mkdir -p /usr/local/bin

ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true

# Create non-root user (busybox addgroup/adduser). UID/GID 1001 is kept from the
# Debian image so existing volumes stay writable.
RUN addgroup -S -g 1001 nodejs \
    && adduser -S -D -H -u 1001 -G nodejs -s /sbin/nologin nextjs

# Create data directories (data, files, logs, plugins/npm)
RUN mkdir -p /app/quilltap/data /app/quilltap/files /app/quilltap/logs /app/quilltap/plugins/npm && \
    chown -R nextjs:nodejs /app/quilltap

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy plugins (required for LLM providers, auth, themes, etc.)
COPY --from=builder --chown=nextjs:nodejs /app/plugins/dist ./plugins/dist

# Copy package files for native module dependencies
COPY package.json package-lock.json ./

# Copy production node_modules from the build stage (node-pty already compiled)
COPY --from=deps-prod /app/node_modules ./node_modules

# Keep only this image's SQLite3 Multiple Ciphers driver prebuild. better-sqlite3-multiple-ciphers
# ships eight per-platform binaries plus its compile-time sources; the loader
# only ever reads lib/ and prebuilds/<platform>-<arch>.node. Each arch builds on
# a native runner, so process.arch is the image's arch. Fails the build if the
# expected prebuild is missing.
RUN node -e "const fs=require('fs'),p=require('path');const d='node_modules/better-sqlite3';const keep='linux-'+process.arch+'.node';const pb=p.join(d,'prebuilds');if(!fs.existsSync(p.join(pb,keep))){console.error('missing SQLCipher prebuild '+keep);process.exit(1)}for(const f of fs.readdirSync(pb))if(f!==keep)fs.rmSync(p.join(pb,f));for(const x of ['deps','src','binding.gyp'])fs.rmSync(p.join(d,x),{recursive:true,force:true});console.log('kept '+keep)"

# Bundle the quilltap CLI so debugging inside the container can use
# `quilltap db --tables`, `quilltap db --mount-points "..."`, etc. The CLI's
# runtime deps (better-sqlite3-multiple-ciphers, sharp, tar, yauzl) all live
# in the root /app/node_modules above, so Node's module resolution walking
# up from /app/packages/quilltap/bin reuses them — no duplicate install.
COPY --from=builder --chown=nextjs:nodejs /app/packages/quilltap ./packages/quilltap
RUN ln -s /app/packages/quilltap/bin/quilltap.js /usr/local/bin/quilltap

# Copy entrypoint script
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# No npm / npx / corepack / yarn and no perl in this image: npm is a separate
# Wolfi package that is never installed, and nothing pulls perl in. The container's
# only command is `node server.js`, and plugin installs go through
# lib/plugins/registry-client.ts, which downloads and extracts registry tarballs
# over HTTP rather than shelling out to the npm CLI.

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=4096"

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server.js"]
