/**
 * URL Validation and Allowlist Checking
 *
 * Provides security checks for URLs before making HTTP requests.
 */

import type { UrlPattern } from './types';

/**
 * Private IP address ranges to block
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./,                         // Loopback
  /^10\./,                          // Private Class A
  /^192\.168\./,                    // Private Class C
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // Private Class B (172.16-31.x.x)
  /^169\.254\./,                    // Link-local
  /^0\./,                           // Current network
  /^::1$/,                          // IPv6 loopback
  /^fe80:/i,                        // IPv6 link-local
  /^fc00:/i,                        // IPv6 unique local
  /^fd[0-9a-f]{2}:/i,               // IPv6 unique local
];

/**
 * Blocked hostnames
 */
const BLOCKED_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  'local',
  '0.0.0.0',
  '::',
  '::1',
];

/**
 * Parse URL patterns from configuration string
 *
 * @param patternsString Newline-separated list of patterns
 * @returns Array of parsed URL patterns
 */
export function parseUrlPatterns(patternsString: string): UrlPattern[] {
  if (!patternsString || typeof patternsString !== 'string') {
    return [];
  }

  return patternsString
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(pattern => {
      const isWildcard = pattern.includes('*');

      // Convert glob pattern to regex
      let regexStr = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars except *
        .replace(/\*/g, '.*');                   // Convert * to .*

      // If pattern doesn't have protocol, match any
      if (!regexStr.startsWith('http')) {
        regexStr = `^https?://${regexStr}`;
      } else {
        regexStr = `^${regexStr}`;
      }

      // Ensure it matches the full hostname
      if (!regexStr.endsWith('.*')) {
        regexStr = `${regexStr}($|/|\\?|#)`;
      }

      return {
        pattern,
        isWildcard,
        regex: new RegExp(regexStr, 'i'),
      };
    });
}

/**
 * Check if a URL matches any of the allowed patterns
 *
 * @param url The URL to check
 * @param patterns Parsed URL patterns
 * @returns true if URL is allowed, false otherwise
 */
export function urlMatchesPatterns(url: string, patterns: UrlPattern[]): boolean {
  if (patterns.length === 0) {
    return false; // No patterns = nothing allowed
  }

  return patterns.some(pattern => pattern.regex.test(url));
}

/**
 * Check if a hostname is a private/local address
 *
 * @param hostname The hostname to check
 * @returns true if hostname is private/local
 */
export function isPrivateHost(hostname: string): boolean {
  // Check blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) {
    return true;
  }

  // Check private IP patterns
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(hostname));
}

/**
 * Validate a URL for security concerns
 *
 * @param urlString The URL to validate
 * @returns Object with validation result and error message
 */
export function validateUrlSecurity(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);

    // Only allow http and https
    if (!['http:', 'https:'].includes(url.protocol)) {
      return {
        valid: false,
        error: `Invalid protocol: ${url.protocol}. Only http and https are allowed.`,
      };
    }

    // Check for private/local hosts
    if (isPrivateHost(url.hostname)) {
      return {
        valid: false,
        error: `Access to private/local addresses is blocked: ${url.hostname}`,
      };
    }

    // Additional security checks
    if (url.username || url.password) {
      return {
        valid: false,
        error: 'URLs with embedded credentials are not allowed.',
      };
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      error: 'Invalid URL format.',
    };
  }
}

/**
 * Full URL validation including allowlist check
 *
 * @param urlString The URL to validate
 * @param allowedPatterns Parsed URL patterns from config
 * @returns Object with validation result and error message
 */
export function validateUrl(
  urlString: string,
  allowedPatterns: UrlPattern[]
): { valid: boolean; error?: string } {
  // First check security constraints
  const securityCheck = validateUrlSecurity(urlString);
  if (!securityCheck.valid) {
    return securityCheck;
  }

  // Then check allowlist
  if (!urlMatchesPatterns(urlString, allowedPatterns)) {
    return {
      valid: false,
      error: `URL not in allowlist. Configure allowed URL patterns in tool settings.`,
    };
  }

  return { valid: true };
}
