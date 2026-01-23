/**
 * Google OAuth Authentication Provider Plugin
 *
 * Provides Google OAuth authentication for Quilltap using Arctic.
 * This plugin is loaded by the Arctic auth provider registry.
 */

import { Google } from 'arctic';

// ============================================================================
// TYPES (duplicated to avoid import issues in standalone plugin)
// ============================================================================

interface AuthProviderConfig {
  providerId: string;
  displayName: string;
  icon?: string;
  requiredEnvVars: string[];
  optionalEnvVars?: string[];
  scopes?: string[];
  buttonColor?: string;
  buttonTextColor?: string;
}

interface ProviderConfigStatus {
  isConfigured: boolean;
  missingVars: string[];
}

interface ArcticUserInfo {
  id: string;
  email?: string;
  name?: string;
  image?: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const REQUIRED_ENV_VARS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const DEFAULT_SCOPES = ['openid', 'email', 'profile'];

const config: AuthProviderConfig = {
  providerId: 'google',
  displayName: 'Google',
  icon: 'google',
  requiredEnvVars: REQUIRED_ENV_VARS,
  scopes: DEFAULT_SCOPES,
  buttonColor: 'bg-white hover:bg-gray-50 border border-gray-300',
  buttonTextColor: 'text-gray-700',
};

// ============================================================================
// HELPERS
// ============================================================================

function checkEnvVars(requiredVars: string[]): ProviderConfigStatus {
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  return {
    isConfigured: missingVars.length === 0,
    missingVars,
  };
}

/**
 * Get the callback URL for OAuth
 */
function getCallbackUrl(): string {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  return `${baseUrl}/api/v1/auth/oauth/google/callback`;
}

// ============================================================================
// PROVIDER FUNCTIONS
// ============================================================================

/**
 * Check if the provider is properly configured
 */
function isConfigured(): boolean {
  const status = getConfigStatus();
  return status.isConfigured;
}

/**
 * Get detailed configuration status
 */
function getConfigStatus(): ProviderConfigStatus {
  return checkEnvVars(REQUIRED_ENV_VARS);
}

/**
 * Get OAuth scopes to request
 */
function getScopes(): string[] {
  return DEFAULT_SCOPES;
}

/**
 * Create the Arctic Google OAuth provider
 * Returns null if not properly configured
 */
function createArcticProvider() {
  if (!isConfigured()) {
    return null;
  }

  return new Google(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    getCallbackUrl()
  );
}

/**
 * Fetch user info from Google using access token
 */
async function fetchUserInfo(accessToken: string): Promise<ArcticUserInfo> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google user info: ${response.status}`);
  }

  const data = await response.json();

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    image: data.picture,
  };
}

// ============================================================================
// PLUGIN EXPORT
// ============================================================================

module.exports = {
  config,
  isConfigured,
  getConfigStatus,
  getScopes,
  createArcticProvider,
  fetchUserInfo,
};
