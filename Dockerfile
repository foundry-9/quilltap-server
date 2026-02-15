FROM node:22-alpine AS base

# Upgrade npm to latest version (fixes "Invalid Version" bug in npm 10.x)
RUN npm install -g npm@latest

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

# Install socat for optional host port forwarding
RUN apk add --no-cache socat

# Install only production dependencies (including better-sqlite3)
RUN npm ci --omit=dev

# Rebuild native modules for the current Alpine Linux platform
RUN npm rebuild

# Copy entrypoint script
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server.js"]

# WSL2 stage — extends production with baked-in provisioning for Windows
FROM production AS wsl2

USER root

# Bake in the WSL init script
COPY lima/wsl-init.sh /usr/local/bin/wsl-init.sh
RUN chmod +x /usr/local/bin/wsl-init.sh

# Pre-install runtime dependencies (Lima YAML does this at provision time)
RUN apk add --no-cache libstdc++ libgcc

# Set environment defaults
RUN printf 'export LIMA_CONTAINER=true\nexport NODE_ENV=production\nexport PORT=5050\nexport HOSTNAME=0.0.0.0\n' \
    > /etc/profile.d/quilltap.sh && chmod 644 /etc/profile.d/quilltap.sh

# Remove Docker entrypoint — WSL2 uses wsl-init.sh directly
ENTRYPOINT []
CMD ["/usr/local/bin/wsl-init.sh"]
