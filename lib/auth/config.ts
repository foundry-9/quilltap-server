/**
 * Authentication configuration module
 * Handles auth-related environment variables and feature flags
 */

import { logger } from '@/lib/logger';

// ============================================================================
// AUTH_DISABLED - Complete authentication bypass
// ============================================================================

// Cache the auth disabled state after first check
let cachedAuthDisabled: boolean | null = null;

/**
 * Determine if authentication is completely disabled
 * When disabled, the app auto-logs in as "unauthenticatedLocalUser"
 * and the signin page redirects to dashboard automatically.
 *
 * @returns {boolean} True if AUTH_DISABLED env var is set to 'true', false otherwise
 */
export function isAuthDisabled(): boolean {
  // Return cached value to avoid repeated env checks and logging
  if (cachedAuthDisabled !== null) {
    return cachedAuthDisabled;
  }

  cachedAuthDisabled = process.env.AUTH_DISABLED === 'true';

  // Only log once when the value is first determined
  logger.debug('Auth disabled state determined', {
    context: 'isAuthDisabled',
    authDisabled: cachedAuthDisabled,
  });

  return cachedAuthDisabled;
}

// ============================================================================
// OAUTH_DISABLED - OAuth providers disabled, credentials still work
// ============================================================================

// Cache the OAuth disabled state after first check
let cachedOAuthDisabled: boolean | null = null;

/**
 * Determine if OAuth providers are disabled
 * When disabled, OAuth buttons are hidden but credentials login still works.
 * Useful when OAuth providers aren't configured or not desired.
 *
 * @returns {boolean} True if OAUTH_DISABLED env var is set to 'true', false otherwise
 */
export function isOAuthDisabled(): boolean {
  // Return cached value to avoid repeated env checks and logging
  if (cachedOAuthDisabled !== null) {
    return cachedOAuthDisabled;
  }

  cachedOAuthDisabled = process.env.OAUTH_DISABLED === 'true';

  // Only log once when the value is first determined
  logger.debug('OAuth disabled state determined', {
    context: 'isOAuthDisabled',
    oauthDisabled: cachedOAuthDisabled,
  });

  return cachedOAuthDisabled;
}

// ============================================================================
// Unauthenticated User Configuration (used when AUTH_DISABLED=true)
// ============================================================================

// Cache for unauthenticated user config
let cachedUnauthenticatedUserName: string | null = null;

/**
 * Get the unauthenticated user display name
 * Used when AUTH_DISABLED=true for the auto-login user
 *
 * @returns {string} The unauthenticated user name from AUTH_UNAUTHENTICATED_USER_NAME env var,
 *                   or default "Unauthenticated Local User"
 */
export function getUnauthenticatedUserName(): string {
  if (cachedUnauthenticatedUserName !== null) {
    return cachedUnauthenticatedUserName;
  }

  cachedUnauthenticatedUserName =
    process.env.AUTH_UNAUTHENTICATED_USER_NAME || 'Unauthenticated Local User';
  return cachedUnauthenticatedUserName;
}

/**
 * Get a consistent email address for the unauthenticated user
 * Used for database records and session management when AUTH_DISABLED=true
 *
 * Note: Must be a valid email format to pass Zod validation
 *
 * @returns {string} A consistent unauthenticated user email address
 */
export function getUnauthenticatedUserEmail(): string {
  return 'unauthenticated@localhost.localdomain';
}

// ============================================================================
// DEPRECATED - Backward compatibility aliases
// These functions will be removed in a future version
// ============================================================================

/**
 * @deprecated Use getUnauthenticatedUserName() instead
 */
export function getAnonymousUserName(): string {
  logger.warn('getAnonymousUserName() is deprecated, use getUnauthenticatedUserName()', {
    context: 'getAnonymousUserName',
  });
  return getUnauthenticatedUserName();
}

/**
 * @deprecated Use getUnauthenticatedUserEmail() instead
 */
export function getAnonymousUserEmail(): string {
  // Note: Not logging deprecation warning here to avoid log spam during validation
  return getUnauthenticatedUserEmail();
}
