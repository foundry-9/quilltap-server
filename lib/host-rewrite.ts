/**
 * Host URL Rewriting for VM/Container Environments
 *
 * When Quilltap runs inside Docker, Lima VMs, or WSL2, `localhost` and
 * `127.0.0.1` resolve to the container/VM's own loopback — not the host
 * machine where services like Ollama or LM Studio are running.
 *
 * This module provides a single function that transparently rewrites
 * localhost URLs to point at the host gateway IP, so users can configure
 * `http://localhost:11434` and have it Just Work in every environment.
 *
 * Gateway IP resolution order:
 * 1. `QUILLTAP_HOST_IP` env var (explicit override)
 * 2. Resolve `host.docker.internal` from /etc/hosts (Docker)
 * 3. Default gateway from /proc/net/route (Lima vzNAT / WSL2)
 * 4. Give up gracefully — return URL unchanged
 *
 * All strategies use synchronous file reads — no shelling out to `getent`
 * or `ip route`, which are unavailable in Alpine Linux images.
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
// Cached Gateway IP
// ============================================================================

let cachedGatewayIP: string | null | undefined; // undefined = not yet resolved

const rewriteLogger = logger.child({ module: 'host-rewrite' });

/**
 * Check if running in any VM or container environment that needs URL rewriting.
 */
export function isVMEnvironment(): boolean {
  return isDockerEnvironment() || isLimaEnvironment();
}

/**
 * Resolve the host gateway IP address.
 *
 * Tries multiple strategies in order; caches the result so DNS/exec
 * only happens once per process lifetime.
 */
function resolveHostGatewayIP(): string | null {
  // Return cached result if already resolved
  if (cachedGatewayIP !== undefined) {
    return cachedGatewayIP;
  }

  // Strategy 1: Explicit env var override
  const envIP = process.env.QUILLTAP_HOST_IP;
  if (envIP) {
    rewriteLogger.info('Host gateway IP from QUILLTAP_HOST_IP', { ip: envIP });
    cachedGatewayIP = envIP;
    return cachedGatewayIP;
  }

  // Strategy 2: Resolve host.docker.internal from /etc/hosts (Docker)
  // Docker adds a `host.docker.internal` entry to /etc/hosts in containers.
  // We parse the file directly instead of shelling out to `getent`, which
  // is unavailable in Alpine Linux images.
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
        cachedGatewayIP = ip;
        return cachedGatewayIP;
      }
    }
  } catch {
    rewriteLogger.debug('Could not read /etc/hosts for host.docker.internal lookup');
  }

  // Strategy 3: Default gateway from /proc/net/route (Lima/WSL2)
  // Parse the kernel routing table directly instead of shelling out to
  // `ip route`, which is unavailable in Alpine Linux images.
  // The file format is tab-separated with hex-encoded IPs.
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
        cachedGatewayIP = ip;
        return cachedGatewayIP;
      }
    }
  } catch {
    rewriteLogger.debug('Could not read /proc/net/route for default gateway lookup');
  }

  rewriteLogger.warn('Could not resolve host gateway IP — localhost URLs will not be rewritten');
  cachedGatewayIP = null;
  return cachedGatewayIP;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Rewrite a localhost URL to point at the host gateway IP.
 *
 * No-ops when:
 * - Not running in a VM/container environment
 * - The URL doesn't point to localhost or 127.0.0.1
 * - Gateway IP resolution fails
 *
 * @param url The URL to potentially rewrite
 * @returns The original URL or a rewritten version with the gateway IP
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

  // Resolve the gateway IP
  const gatewayIP = resolveHostGatewayIP();
  if (!gatewayIP) {
    return url;
  }

  // Rewrite the hostname
  parsed.hostname = gatewayIP;
  const rewritten = parsed.toString();

  rewriteLogger.debug('Rewrote localhost URL', {
    original: url,
    rewritten,
    gatewayIP,
  });

  return rewritten;
}

/**
 * Reset the cached gateway IP (for testing).
 * @internal
 */
export function _resetGatewayCache(): void {
  cachedGatewayIP = undefined;
}
