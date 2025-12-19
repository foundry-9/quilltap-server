/**
 * Auth Provider Plugin Interface
 *
 * Defines the contract for authentication provider plugins.
 * OAuth providers (Google, Apple, GitHub, etc.) implement this interface.
 *
 * Uses Arctic for OAuth flows instead of NextAuth.
 */

import { logger } from '@/lib/logger';
import type { OAuth2Tokens } from 'arctic';

/**
 * User info returned by OAuth provider
 */
export interface ArcticUserInfo {
  id: string;
  email?: string;
  name?: string;
  image?: string;
}

/**
 * Arctic provider instance interface
 * Different providers have different methods, so we define a generic interface
 */
export interface ArcticProviderInstance {
  /** Create authorization URL with PKCE */
  createAuthorizationURL: (
    state: string,
    codeVerifier: string,
    scopes: string[]
  ) => URL;

  /** Validate authorization code and get tokens */
  validateAuthorizationCode: (
    code: string,
    codeVerifier: string
  ) => Promise<OAuth2Tokens>;
}

/**
 * Configuration for an OAuth authentication provider
 */
export interface AuthProviderConfig {
  /** Provider identifier (e.g., 'google', 'github') */
  providerId: string;

  /** Display name for UI */
  displayName: string;

  /** Icon name or SVG for UI */
  icon?: string;

  /** Environment variables required for this provider */
  requiredEnvVars: string[];

  /** Optional environment variables */
  optionalEnvVars?: string[];

  /** OAuth scopes to request */
  scopes?: string[];

  /** Button color for sign-in page (Tailwind classes) */
  buttonColor?: string;

  /** Button text color (Tailwind classes) */
  buttonTextColor?: string;
}

/**
 * Result of checking if a provider is configured
 */
export interface ProviderConfigStatus {
  isConfigured: boolean;
  missingVars: string[];
}

/**
 * Auth provider plugin export structure
 * This is what plugin index.ts should export
 */
export interface AuthProviderPluginExport {
  /** Provider configuration metadata */
  config: AuthProviderConfig;

  /** Factory function to create the Arctic provider instance */
  createArcticProvider: () => ArcticProviderInstance | null;

  /** Fetch user info from the provider using access token */
  fetchUserInfo: (accessToken: string) => Promise<ArcticUserInfo>;

  /** Get OAuth scopes to request */
  getScopes: () => string[];

  /** Check if the provider is properly configured */
  isConfigured: () => boolean;

  /** Get detailed configuration status */
  getConfigStatus: () => ProviderConfigStatus;

  /**
   * @deprecated Legacy NextAuth provider - will be removed
   * Keep for backwards compatibility during migration
   */
  createProvider?: () => unknown | null;
}

/**
 * Helper to check if required environment variables are set
 */
export function checkEnvVars(requiredVars: string[]): ProviderConfigStatus {
  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  const status: ProviderConfigStatus = {
    isConfigured: missingVars.length === 0,
    missingVars,
  };

  logger.debug('Auth provider env vars check', {
    context: 'checkEnvVars',
    requiredVars,
    missingVars,
    isConfigured: status.isConfigured,
  });

  return status;
}

/**
 * Create a logger for auth provider plugins
 */
export function createAuthProviderLogger(providerId: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) =>
      logger.debug(message, { context: `AuthProvider:${providerId}`, ...data }),
    info: (message: string, data?: Record<string, unknown>) =>
      logger.info(message, { context: `AuthProvider:${providerId}`, ...data }),
    warn: (message: string, data?: Record<string, unknown>) =>
      logger.warn(message, { context: `AuthProvider:${providerId}`, ...data }),
    error: (message: string, data?: Record<string, unknown>, error?: Error) =>
      logger.error(message, { context: `AuthProvider:${providerId}`, ...data }, error),
  };
}
