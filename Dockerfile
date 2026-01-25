FROM node:22-alpine AS base

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Development stage
FROM base AS development
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

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
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build plugins first (transpile TypeScript to JavaScript)
# SKIP_ENV_VALIDATION=true skips runtime env var validation during build
RUN SKIP_ENV_VALIDATION=true npm run build:plugins

# Build Next.js
# SKIP_ENV_VALIDATION=true skips runtime env var validation during build
RUN SKIP_ENV_VALIDATION=true npm run build

# Production stage
FROM base AS production
WORKDIR /app

ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Create data directories (data, files, logs)
RUN mkdir -p /app/quilltap/data /app/quilltap/files /app/quilltap/logs && \
    chown -R nextjs:nodejs /app/quilltap

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy plugins (required for LLM providers, auth, themes, etc.)
COPY --from=builder --chown=nextjs:nodejs /app/plugins/dist ./plugins/dist

# Copy native modules (better-sqlite3 needs to be rebuilt in production container)
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
