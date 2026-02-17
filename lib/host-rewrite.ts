/**
 * Host URL Rewriting for VM/Container Environments
 *
 * When Quilltap runs inside Docker, Lima VMs, or WSL2, `localhost` and
 * `127.0.0.1` resolve to the container/VM's own loopback — not the host
 * machine where services like Ollama or LM Studio are running.
 *
 * This module provides a single function that transparently rewrites
 * localhost URLs to point at the host, so users can configure
 * `http://localhost:11434` and have it Just Work in every environment.
 *
 * Gateway resolution order:
 * 1. `QUILLTAP_HOST_IP` env var (explicit override) → rewrite to that IP
 * 2. Default gateway from /proc/net/route (works in Lima, WSL2, and Docker)
 * 3. In Docker: rewrite `localhost` → `host.docker.internal` (let DNS resolve it)
 * 4. Fallback: try DNS lookup of `host.docker.internal` via /etc/hosts
 * 5. Give up gracefully — return URL unchanged
 *
 * @module lib/host-rewrite
 */

import { logger } from '@/lib/logger';
import { isDockerEnvironment, isLimaEnvironment } from '@/lib/paths';
import { readFileSync } from 'node:fs';

// ============================================================================
// Types
// ============================================================================

/** Hostnames that refer to the local loopback */
const LOCALHOST_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '::1',
]);

// ============================================================================
// Cached Gateway Host
// ============================================================================

let cachedGatewayHost: string | null | undefined; // undefined = not yet resolved

const rewriteLogger = logger.child({ module: 'host-rewrite' });

/**
 * Check if running in any VM or container environment that needs URL rewriting.
 */
export function isVMEnvironment(): boolean {
  return isDockerEnvironment() || isLimaEnvironment();
}

/**
 * Resolve the host gateway address (IP or hostname).
 *
 * Tries multiple strategies in order; caches the result so file reads
 * only happen once per process lifetime.
 */
function resolveHostGateway(): string | null {
  // Return cached result if already resolved
  if (cachedGatewayHost !== undefined) {
    return cachedGatewayHost;
  }

  // Strategy 1: Explicit env var override
  const envIP = process.env.QUILLTAP_HOST_IP;
  if (envIP) {
    rewriteLogger.info('Host gateway from QUILLTAP_HOST_IP', { host: envIP });
    cachedGatewayHost = envIP;
    return cachedGatewayHost;
  }

  // Strategy 2: Default gateway from /proc/net/route (Lima/WSL2/Docker)
  // Parse the kernel routing table directly instead of shelling out to
  // `ip route`, which is unavailable in Alpine Linux images.
  // The file format is tab-separated with hex-encoded IPs.
  // This runs before the Docker host.docker.internal strategy because Lima
  // VMs also have /app (triggering isDockerEnvironment()) but do NOT have
  // host.docker.internal in DNS.
  try {
    const routeTable = readFileSync('/proc/net/route', 'utf-8');
    for (const line of routeTable.split('\n').slice(1)) { // skip header
      const fields = line.trim().split('\t');
      // fields[1] = Destination, fields[2] = Gateway
      // Default route has destination 00000000
      if (fields.length >= 3 && fields[1] === '00000000') {
        const hexGateway = fields[2];
        // Convert hex gateway to dotted-quad IP (little-endian on Linux)
        const ip = [
          parseInt(hexGateway.substring(6, 8), 16),
          parseInt(hexGateway.substring(4, 6), 16),
          parseInt(hexGateway.substring(2, 4), 16),
          parseInt(hexGateway.substring(0, 2), 16),
        ].join('.');
        rewriteLogger.info('Host gateway IP from /proc/net/route', { ip });
        cachedGatewayHost = ip;
        return cachedGatewayHost;
      }
    }
  } catch {
    rewriteLogger.debug('Could not read /proc/net/route for default gateway lookup');
  }

  // Strategy 3: Docker — use host.docker.internal directly as a hostname
  // Docker Desktop provides built-in DNS resolution for host.docker.internal
  // via its DNS server (127.0.0.11), so we don't need to resolve it to an IP.
  // This is more reliable than parsing /etc/hosts, which may not contain the entry
  // when Docker's built-in DNS handles the resolution.
  // NOTE: This runs AFTER /proc/net/route because Lima VMs trigger
  // isDockerEnvironment() (they have /app) but don't have host.docker.internal.
  if (isDockerEnvironment()) {
    rewriteLogger.info('Docker environment detected — using host.docker.internal as gateway hostname');
    cachedGatewayHost = 'host.docker.internal';
    return cachedGatewayHost;
  }

  // Strategy 4: Fallback — resolve host.docker.internal from /etc/hosts
  // Covers edge cases where Docker adds it to /etc/hosts but we're not
  // detected as Docker (e.g., custom container runtimes).
  try {
    const hosts = readFileSync('/etc/hosts', 'utf-8');
    for (const line of hosts.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed === '') continue;
      // /etc/hosts format: <IP> <hostname1> [hostname2] ...
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2 && parts.slice(1).includes('host.docker.internal')) {
        const ip = parts[0];
        rewriteLogger.info('Host gateway IP from /etc/hosts (host.docker.internal)', { ip });
        cachedGatewayHost = ip;
        return cachedGatewayHost;
      }
    }
  } catch {
    rewriteLogger.debug('Could not read /etc/hosts for host.docker.internal lookup');
  }

  rewriteLogger.warn('Could not resolve host gateway — localhost URLs will not be rewritten');
  cachedGatewayHost = null;
  return cachedGatewayHost;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Rewrite a localhost URL to point at the host gateway.
 *
 * No-ops when:
 * - Not running in a VM/container environment
 * - The URL doesn't point to localhost or 127.0.0.1
 * - Gateway resolution fails
 *
 * @param url The URL to potentially rewrite
 * @returns The original URL or a rewritten version with the gateway host
 */
export function rewriteLocalhostUrl(url: string): string {
  // No-op on bare metal
  if (!isVMEnvironment()) {
    return url;
  }

  // Parse the URL to check the hostname
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a valid URL — return unchanged
    return url;
  }

  // Check if hostname is a localhost variant
  if (!LOCALHOST_HOSTS.has(parsed.hostname)) {
    return url;
  }

  // Resolve the gateway host
  const gatewayHost = resolveHostGateway();
  if (!gatewayHost) {
    return url;
  }

  // Rewrite the hostname
  parsed.hostname = gatewayHost;
  const rewritten = parsed.toString();

  rewriteLogger.debug('Rewrote localhost URL', {
    original: url,
    rewritten,
    gatewayHost,
  });

  return rewritten;
}

/**
 * Reset the cached gateway host (for testing).
 * @internal
 */
export function _resetGatewayCache(): void {
  cachedGatewayHost = undefined;
}
