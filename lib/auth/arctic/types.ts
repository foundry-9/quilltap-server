/**
 * Arctic OAuth Types
 *
 * Type definitions for Arctic OAuth integration.
 */

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
 * OAuth provider configuration
 */
export interface ArcticProviderConfig {
  providerId: string;
  displayName: string;
  icon?: string;
  requiredEnvVars: string[];
  optionalEnvVars?: string[];
  scopes: string[];
  buttonColor?: string;
  buttonTextColor?: string;
}

/**
 * Token result from Arctic OAuth flow
 */
export interface ArcticTokenResult {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date;
  idToken?: string;
}

/**
 * Convert Arctic OAuth2Tokens to our token result type
 */
export function toArcticTokenResult(tokens: OAuth2Tokens): ArcticTokenResult {
  let idToken: string | undefined;
  try {
    // idToken() throws if not available, so we wrap in try-catch
    idToken = tokens.idToken();
  } catch {
    // ID token not available for this provider
    idToken = undefined;
  }

  return {
    accessToken: tokens.accessToken(),
    refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : undefined,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt(),
    idToken,
  };
}

/**
 * Provider configuration status
 */
export interface ProviderConfigStatus {
  isConfigured: boolean;
  missingVars: string[];
}

/**
 * Arctic provider plugin export interface
 */
export interface ArcticProviderPlugin {
  /** Provider configuration metadata */
  config: ArcticProviderConfig;

  /** Create the Arctic provider instance */
  createArcticProvider: () => ArcticProviderInstance | null;

  /** Fetch user info from the provider using access token */
  fetchUserInfo: (accessToken: string) => Promise<ArcticUserInfo>;

  /** Get OAuth scopes to request */
  getScopes: () => string[];

  /** Check if the provider is properly configured */
  isConfigured: () => boolean;

  /** Get detailed configuration status */
  getConfigStatus: () => ProviderConfigStatus;
}

/**
 * Arctic provider instance (generic wrapper for Arctic providers)
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
 * Check if required environment variables are set
 */
export function checkEnvVars(requiredVars: string[]): ProviderConfigStatus {
  const missingVars = requiredVars.filter((varName) => !process.env[varName]);
  return {
    isConfigured: missingVars.length === 0,
    missingVars,
  };
}
