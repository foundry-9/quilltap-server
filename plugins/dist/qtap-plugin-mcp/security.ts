/**
 * Security utilities for MCP plugin
 *
 * Provides URL validation and sanitization to prevent SSRF attacks
 * and ensure secure connections to MCP servers.
 */

import type { MCPServerConfig } from './types';

/**
 * Result of URL validation
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Check if a hostname is a private/local address
 *
 * Blocks access to:
 * - Localhost (127.0.0.0/8, ::1)
 * - Private Class A (10.0.0.0/8)
 * - Private Class B (172.16.0.0/12)
 * - Private Class C (192.168.0.0/16)
 * - Link-local (169.254.0.0/16, fe80::/10)
 * - IPv6 unique local (fc00::/7)
 *
 * @param hostname - Hostname to check
 * @returns true if hostname is private/local
 */
export function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Localhost names
  if (lower === 'localhost' || lower === 'localhost.localdomain') {
    return true;
  }

  // IPv4 patterns
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);

    // Loopback (127.0.0.0/8)
    if (a === 127) return true;

    // Private Class A (10.0.0.0/8)
    if (a === 10) return true;

    // Private Class B (172.16.0.0/12)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // Private Class C (192.168.0.0/16)
    if (a === 192 && b === 168) return true;

    // Link-local (169.254.0.0/16)
    if (a === 169 && b === 254) return true;

    // Current network (0.0.0.0/8) - often used for localhost
    if (a === 0) return true;
  }

  // IPv6 patterns
  const lowerHostname = hostname.toLowerCase();

  // IPv6 loopback
  if (lowerHostname === '::1' || lowerHostname === '[::1]') return true;

  // IPv6 link-local (fe80::/10)
  if (lowerHostname.startsWith('fe80:') || lowerHostname.startsWith('[fe80:')) return true;

  // IPv6 unique local (fc00::/7)
  if (
    lowerHostname.startsWith('fc') ||
    lowerHostname.startsWith('fd') ||
    lowerHostname.startsWith('[fc') ||
    lowerHostname.startsWith('[fd')
  ) {
    return true;
  }

  return false;
}

/**
 * Validate an MCP server URL
 *
 * @param url - URL to validate
 * @returns Validation result with error message if invalid
 */
export function validateMCPServerUrl(url: string): ValidationResult {
  try {
    const parsed = new URL(url);

    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        valid: false,
        error: `Invalid protocol: ${parsed.protocol}. Only http and https are allowed.`,
      };
    }

    // Block credentials in URL
    if (parsed.username || parsed.password) {
      return {
        valid: false,
        error: 'URLs with embedded credentials are not allowed. Use authentication headers instead.',
      };
    }

    // Block private/local addresses (SSRF protection)
    if (isPrivateHost(parsed.hostname)) {
      return {
        valid: false,
        error: `Access to private/local addresses is blocked: ${parsed.hostname}`,
      };
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      error: 'Invalid URL format',
    };
  }
}

/**
 * Dangerous headers that should not be set by users
 */
const DANGEROUS_HEADERS = [
  'host',
  'cookie',
  'set-cookie',
  'authorization', // Handled separately via authType
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
];

/**
 * Parse and sanitize custom headers
 *
 * Removes potentially dangerous headers that could be used for attacks.
 *
 * @param headersJson - JSON string containing headers object
 * @returns Sanitized headers object or null if invalid
 */
export function sanitizeCustomHeaders(
  headersJson: string | undefined
): Record<string, string> | null {
  if (!headersJson) return null;

  try {
    const parsed = JSON.parse(headersJson);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      // Skip non-string values
      if (typeof value !== 'string') continue;

      // Skip dangerous headers
      if (DANGEROUS_HEADERS.includes(key.toLowerCase())) continue;

      // Skip headers with invalid characters
      if (!/^[\w-]+$/.test(key)) continue;

      sanitized[key] = value;
    }

    return Object.keys(sanitized).length > 0 ? sanitized : null;
  } catch {
    return null;
  }
}

/**
 * Sanitize server name for use as tool prefix
 *
 * Converts to lowercase and replaces invalid characters with underscores.
 *
 * @param name - Server name to sanitize
 * @returns Sanitized name safe for tool prefix
 */
export function sanitizeServerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, '') // Trim leading/trailing underscores
    .slice(0, 50); // Limit length
}

/**
 * Validate and sanitize a complete server configuration
 *
 * @param config - Server configuration to validate
 * @returns Validation result with sanitized config or error
 */
export function validateServerConfig(
  config: unknown
): { valid: true; config: MCPServerConfig } | { valid: false; error: string } {
  if (typeof config !== 'object' || config === null) {
    return { valid: false, error: 'Server configuration must be an object' };
  }

  const obj = config as Record<string, unknown>;

  // Required fields
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    return { valid: false, error: 'Server name is required' };
  }

  if (typeof obj.url !== 'string' || obj.url.length === 0) {
    return { valid: false, error: 'Server URL is required' };
  }

  // Validate URL
  const urlValidation = validateMCPServerUrl(obj.url);
  if (!urlValidation.valid) {
    return { valid: false, error: urlValidation.error! };
  }

  // Validate authType
  const validAuthTypes = ['none', 'bearer', 'api-key', 'custom-header'];
  const authType = obj.authType ?? 'none';
  if (typeof authType !== 'string' || !validAuthTypes.includes(authType)) {
    return { valid: false, error: `Invalid authType: ${authType}` };
  }

  // Validate auth credentials based on type
  if (authType === 'bearer' && typeof obj.bearerToken !== 'string') {
    return { valid: false, error: 'Bearer token required for bearer auth' };
  }

  if (authType === 'api-key' && typeof obj.apiKey !== 'string') {
    return { valid: false, error: 'API key required for api-key auth' };
  }

  if (authType === 'custom-header') {
    const headers = sanitizeCustomHeaders(obj.customHeaders as string | undefined);
    if (!headers) {
      return { valid: false, error: 'Valid custom headers JSON required for custom-header auth' };
    }
  }

  // Build sanitized config
  const sanitizedConfig: MCPServerConfig = {
    name: sanitizeServerName(obj.name),
    displayName:
      typeof obj.displayName === 'string' ? obj.displayName : sanitizeServerName(obj.name),
    url: obj.url,
    authType: authType as MCPServerConfig['authType'],
    enabled: obj.enabled !== false, // Default to enabled
    timeout: typeof obj.timeout === 'number' ? Math.max(5, Math.min(120, obj.timeout)) : 30,
  };

  // Add auth credentials
  if (authType === 'bearer') {
    sanitizedConfig.bearerToken = obj.bearerToken as string;
  } else if (authType === 'api-key') {
    sanitizedConfig.apiKey = obj.apiKey as string;
    sanitizedConfig.apiKeyHeader =
      typeof obj.apiKeyHeader === 'string' ? obj.apiKeyHeader : 'X-API-Key';
  } else if (authType === 'custom-header') {
    sanitizedConfig.customHeaders = obj.customHeaders as string;
  }

  return { valid: true, config: sanitizedConfig };
}

/**
 * Parse and validate server configurations from JSON
 *
 * @param serversJson - JSON string containing array of server configs
 * @returns Array of validated server configs and any errors
 */
export function parseServerConfigs(serversJson: string): {
  servers: MCPServerConfig[];
  errors: string[];
} {
  const servers: MCPServerConfig[] = [];
  const errors: string[] = [];

  try {
    const parsed = JSON.parse(serversJson);

    if (!Array.isArray(parsed)) {
      return { servers: [], errors: ['Server configuration must be a JSON array'] };
    }

    for (let i = 0; i < parsed.length; i++) {
      const result = validateServerConfig(parsed[i]);
      if (result.valid) {
        servers.push(result.config);
      } else {
        errors.push(`Server ${i + 1}: ${result.error}`);
      }
    }
  } catch (e) {
    errors.push(`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
  }

  return { servers, errors };
}
