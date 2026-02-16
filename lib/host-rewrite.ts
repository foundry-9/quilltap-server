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
 * 2. Resolve `host.docker.internal` via getent (Docker)
 * 3. Default gateway from `ip route` (Lima vzNAT / WSL2)
 * 4. Give up gracefully — return URL unchanged
 *
 * @module lib/host-rewrite
 */

import { logger } from '@/lib/logger';
import { isDockerEnvironment, isLimaEnvironment } from '@/lib/paths';
import { execSync } from 'child_process';

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

  // Strategy 2: Resolve host.docker.internal via getent (works in Docker)
  try {
    const result = execSync(
      'getent hosts host.docker.internal 2>/dev/null | awk \'{print $1}\'',
      { encoding: 'utf-8', timeout: 2000 }
    ).trim();
    if (result && result !== '') {
      rewriteLogger.info('Host gateway IP from host.docker.internal', { ip: result });
      cachedGatewayIP = result;
      return cachedGatewayIP;
    }
  } catch {
    // getent not available or lookup failed
  }

  // Strategy 3: Default gateway from `ip route` (Lima/WSL2)
  try {
    const result = execSync(
      'ip route 2>/dev/null | grep default | awk \'{print $3}\' | head -1',
      { encoding: 'utf-8', timeout: 2000 }
    ).trim();
    if (result && result !== '') {
      rewriteLogger.info('Host gateway IP from default route', { ip: result });
      cachedGatewayIP = result;
      return cachedGatewayIP;
    }
  } catch {
    // `ip` command not available (macOS bare metal, Windows)
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
