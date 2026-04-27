# Build base — includes native-module compilation tools (NOT used in production)
FROM node:22-alpine AS build-base

# Upgrade all Alpine packages to latest security patches
RUN apk upgrade --no-cache

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install all dependencies (for building)
FROM build-base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Install production-only dependencies (for the final image)
FROM build-base AS deps-prod
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm rebuild

# Development stage
FROM build-base AS development
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including dev dependencies for development)
RUN npm ci

# Copy source code
COPY . .

# Rebuild native modules for the current Alpine Linux platform
RUN npm rebuild

# Generate self-signed localhost certificate for dev SSL usage
RUN apk add --no-cache openssl && \
    mkdir -p certs && \
    openssl req -x509 -nodes -newkey rsa:2048 \
      -keyout certs/localhost-key.pem \
      -out certs/localhost.pem \
      -days 365 \
      -subj "/C=US/ST=Development/L=Local/O=Quilltap Dev/OU=Dev/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

EXPOSE 3000
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

# Production stage — clean image WITHOUT build tools (python3/make/g++/binutils)
FROM node:22-alpine AS production
WORKDIR /app

# Upgrade all Alpine packages to latest security patches
RUN apk upgrade --no-cache

ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

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

# Install zip for backup/restore and common tools for LLM shell agent use
# (busybox provides unzip, avoiding CVE-2008-0888 in alpine/unzip)
# All packages pulled from the already-upgraded Alpine index (see apk upgrade above)
RUN apk add --no-cache zip git curl wget jq

# Copy pre-compiled production node_modules from build stage (native modules already built)
COPY --from=deps-prod /app/node_modules ./node_modules

# Copy entrypoint script
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=4096"

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server.js"]
