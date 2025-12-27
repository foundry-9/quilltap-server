# Authentication Provider Plugin Development Guide

This guide covers everything you need to create a new authentication provider plugin for Quilltap.

## Overview

Authentication provider plugins enable Quilltap to support new OAuth providers for user login. Each auth plugin implements a standard interface that handles:

- Arctic OAuth provider creation (required)
- User info fetching from the OAuth provider (required)
- Environment variable validation (required)
- Configuration status reporting (required)
- UI button styling (optional)

## Architecture

Quilltap uses **Arctic** for OAuth 2.0 flows with **custom JWT sessions**:

1. Plugins register during app startup via the Arctic provider registry
2. OAuth routes use plugin-provided Arctic instances for auth flows
3. JWT sessions are created after successful OAuth authentication
4. All `getServerSession()` calls verify the JWT session cookie

This ensures auth provider plugins are fully loaded before any authentication occurs.

## Quick Start

### 1. Create the Plugin Directory

```bash
mkdir -p plugins/dist/qtap-plugin-auth-myprovider
cd plugins/dist/qtap-plugin-auth-myprovider
```

### 2. Create manifest.json

```json
{
  "$schema": "../qtap-plugin-template/schemas/plugin-manifest.schema.json",
  "name": "qtap-plugin-auth-myprovider",
  "title": "MyProvider OAuth",
  "description": "MyProvider OAuth authentication for Quilltap",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "license": "MIT",
  "compatibility": {
    "quilltapVersion": ">=1.8.0",
    "nodeVersion": ">=18.0.0"
  },
  "capabilities": ["AUTH_METHODS"],
  "category": "AUTHENTICATION",
  "main": "index.js",
  "typescript": true,
  "frontend": "REACT",
  "styling": "TAILWIND",
  "enabledByDefault": true,
  "status": "STABLE",
  "keywords": ["myprovider", "oauth", "authentication", "login"],
  "authProviderConfig": {
    "providerId": "myprovider",
    "displayName": "MyProvider",
    "requiredEnvVars": ["MYPROVIDER_CLIENT_ID", "MYPROVIDER_CLIENT_SECRET"],
    "buttonColor": "bg-blue-500 hover:bg-blue-600",
    "buttonTextColor": "text-white"
  },
  "permissions": {
    "network": ["auth.myprovider.com", "api.myprovider.com"],
    "userData": false,
    "database": false
  }
}
```

### 3. Create index.ts

```typescript
/**
 * MyProvider OAuth Authentication Provider Plugin
 * Uses Arctic for OAuth 2.0 flows
 */

// Import the Arctic provider for your OAuth service
// See https://arcticjs.dev/providers for available providers
import { MyProvider } from 'arctic';

// ============================================================================
// TYPES (duplicated to avoid import issues in standalone plugin)
// ============================================================================

interface AuthProviderConfig {
  providerId: string;
  displayName: string;
  icon?: string;
  requiredEnvVars: string[];
  optionalEnvVars?: string[];
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

const REQUIRED_ENV_VARS = ['MYPROVIDER_CLIENT_ID', 'MYPROVIDER_CLIENT_SECRET'];

const config: AuthProviderConfig = {
  providerId: 'myprovider',
  displayName: 'MyProvider',
  icon: 'myprovider',
  requiredEnvVars: REQUIRED_ENV_VARS,
  buttonColor: 'bg-blue-500 hover:bg-blue-600',
  buttonTextColor: 'text-white',
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
 * Create the Arctic provider instance
 * Returns null if not properly configured
 */
function createArcticProvider() {
  if (!isConfigured()) {
    return null;
  }

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const redirectUri = `${baseUrl}/api/auth/oauth/myprovider/callback`;

  return new MyProvider(
    process.env.MYPROVIDER_CLIENT_ID!,
    process.env.MYPROVIDER_CLIENT_SECRET!,
    redirectUri
  );
}

/**
 * Get OAuth scopes for this provider
 */
function getScopes(): string[] {
  return ['openid', 'email', 'profile'];
}

/**
 * Fetch user info from the provider's API
 * Called after successful OAuth token exchange
 */
async function fetchUserInfo(accessToken: string): Promise<ArcticUserInfo> {
  const response = await fetch('https://api.myprovider.com/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user info');
  }

  const data = await response.json();

  return {
    id: data.sub || data.id,
    email: data.email,
    name: data.name,
    image: data.picture || data.avatar,
  };
}

// ============================================================================
// PLUGIN EXPORT
// ============================================================================

module.exports = {
  config,
  isConfigured,
  getConfigStatus,
  createArcticProvider,
  fetchUserInfo,
  getScopes,
};
```

### 4. Create package.json

```json
{
  "name": "qtap-plugin-auth-myprovider",
  "version": "1.0.0",
  "description": "MyProvider OAuth plugin for Quilltap",
  "main": "index.js",
  "types": "index.ts",
  "license": "MIT",
  "dependencies": {
    "arctic": "^2.0.0"
  }
}
```

**Note:** The plugin uses Arctic for OAuth 2.0 flows. The auth system automatically calls your plugin's `createArcticProvider()` and `fetchUserInfo()` functions.

## Plugin Interface

Auth provider plugins must export the following:

```typescript
interface AuthProviderPluginExport {
  /** Provider configuration metadata */
  config: AuthProviderConfig;

  /** Factory function to create the Arctic OAuth provider */
  createArcticProvider: () => ArcticProviderInstance | null;

  /** Fetch user info from the provider after OAuth */
  fetchUserInfo: (accessToken: string) => Promise<ArcticUserInfo>;

  /** Get OAuth scopes for authorization */
  getScopes: () => string[];

  /** Check if the provider is properly configured */
  isConfigured: () => boolean;

  /** Get detailed configuration status */
  getConfigStatus: () => ProviderConfigStatus;
}
```

### AuthProviderConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `providerId` | string | Yes | Lowercase identifier (e.g., 'google', 'github') |
| `displayName` | string | Yes | Human-readable name for UI |
| `requiredEnvVars` | string[] | Yes | Environment variables that must be set |
| `optionalEnvVars` | string[] | No | Additional optional environment variables |
| `buttonColor` | string | No | Tailwind classes for sign-in button background |
| `buttonTextColor` | string | No | Tailwind classes for sign-in button text |
| `icon` | string | No | Icon identifier or SVG name |

### ProviderConfigStatus

| Field | Type | Description |
|-------|------|-------------|
| `isConfigured` | boolean | True if all required env vars are set |
| `missingVars` | string[] | List of missing environment variable names |

## Manifest Schema

The `authProviderConfig` section in manifest.json is validated against this schema:

```typescript
{
  providerId: string;      // Must match pattern /^[a-z][a-z0-9-]*$/
  displayName: string;     // 1-100 characters
  requiredEnvVars: string[]; // At least one required
  optionalEnvVars?: string[];
  buttonColor?: string;    // Tailwind classes
  buttonTextColor?: string; // Tailwind classes
  icon?: string;
}
```

## How It Works

### Registration Flow

1. **Plugin Discovery**: During startup, Quilltap scans `plugins/dist/` for plugins
2. **Manifest Validation**: Each plugin's `manifest.json` is validated
3. **Auth Plugin Detection**: Plugins with `AUTH_METHODS` capability are identified
4. **Registration**: The Arctic provider registry loads and registers the plugin
5. **Configuration Check**: `isConfigured()` is called to check env vars

### Authentication Flow

1. **User visits sign-in page**: The UI shows buttons for configured providers
2. **User clicks OAuth button**: Redirects to `/api/auth/oauth/[provider]/authorize`
3. **Authorization**: Arctic generates auth URL with PKCE, user is redirected to provider
4. **Callback**: Provider redirects to `/api/auth/oauth/[provider]/callback`
5. **Token exchange**: Arctic exchanges code for tokens using PKCE verifier
6. **User info**: Plugin's `fetchUserInfo()` is called to get user data
7. **Account linking**: User is created or linked to existing account
8. **Session creation**: JWT session token is created and set as httpOnly cookie

### Session Access

All routes use `getServerSession()` from `lib/auth/session.ts`:

```typescript
import { getServerSession } from '@/lib/auth/session';

export async function GET() {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  // User is authenticated
  return Response.json({ userId: session.user.id });
}
```

## Built-in Providers

### Google OAuth (qtap-plugin-auth-google)

Reference implementation for OAuth providers:

- **Provider ID**: `google`
- **Required Env Vars**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Arctic Provider**: `Google` from `arctic`
- **User Info Endpoint**: `https://openidconnect.googleapis.com/v1/userinfo`

## Adding Custom OAuth Providers

For providers not built into Arctic, you can create a custom OAuth2 implementation:

```typescript
// In your plugin's index.ts

import { OAuth2Client } from 'arctic';

function createArcticProvider() {
  if (!isConfigured()) {
    return null;
  }

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const redirectUri = `${baseUrl}/api/auth/oauth/custom/callback`;

  // Create a custom OAuth2 client
  return new OAuth2Client(
    process.env.CUSTOM_CLIENT_ID!,
    process.env.CUSTOM_CLIENT_SECRET!,
    redirectUri
  );
}

function getScopes(): string[] {
  return ['openid', 'email', 'profile'];
}

async function fetchUserInfo(accessToken: string): Promise<ArcticUserInfo> {
  const response = await fetch('https://api.custom.com/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();

  return {
    id: data.sub,
    name: data.name,
    email: data.email,
    image: data.picture,
  };
}
```

Arctic provides built-in support for many providers including Google, GitHub, Apple, Discord, and more. See [arcticjs.dev/providers](https://arcticjs.dev/providers) for the full list.

## Best Practices

### 1. Environment Variable Validation

Always validate required environment variables:

```typescript
function isConfigured(): boolean {
  return REQUIRED_ENV_VARS.every(varName => {
    const value = process.env[varName];
    return value && value.length > 0;
  });
}
```

### 2. Provide Detailed Status

Help users troubleshoot configuration issues:

```typescript
function getConfigStatus(): ProviderConfigStatus {
  const missingVars = REQUIRED_ENV_VARS.filter(varName => !process.env[varName]);
  return {
    isConfigured: missingVars.length === 0,
    missingVars,
  };
}
```

### 3. Use Consistent Styling

Follow Quilltap's button conventions:

```json
{
  "buttonColor": "bg-white hover:bg-gray-50 border border-gray-300",
  "buttonTextColor": "text-gray-700"
}
```

### 4. Document Required Setup

In your plugin's README, document:

- How to obtain OAuth credentials from the provider
- Required redirect URI format
- Any provider-specific configuration

## Debugging

Enable debug logging to troubleshoot auth issues:

```bash
LOG_LEVEL=debug npm run dev
```

Look for these log messages:

- `Auth provider registered` - Plugin successfully registered
- `Building authentication providers` - Auth options being built
- `OAuth provider added from plugin` - Provider successfully created

## Common Issues

### Provider Not Appearing

1. Check that `manifest.json` is valid (run build to check)
2. Verify `capabilities` includes `AUTH_METHODS`
3. Check that required env vars are set
4. Look for error logs during startup

### OAuth Callback Errors

1. Verify redirect URI matches exactly in provider console (should be `/api/auth/oauth/[provider]/callback`)
2. Check `BASE_URL` is set correctly
3. Ensure `JWT_SECRET` is set

### Session Errors

1. Clear browser cookies and try again
2. Check JWT session cookie is being set (`quilltap-session`)
3. Verify `JWT_SECRET` environment variable is configured

## Directory Structure

```text
plugins/dist/qtap-plugin-auth-myprovider/
├── manifest.json     # Plugin metadata (required)
├── package.json      # NPM package config (required)
├── index.ts          # Main entry point (required)
├── index.js          # Transpiled entry (auto-generated)
└── README.md         # Documentation (recommended)
```

## Checklist

Before releasing your plugin:

- [ ] `manifest.json` has valid `authProviderConfig`
- [ ] `capabilities` includes `AUTH_METHODS`
- [ ] `category` is set to `AUTHENTICATION`
- [ ] Plugin exports `config`, `isConfigured`, `getConfigStatus`, `createArcticProvider`, `fetchUserInfo`, `getScopes`
- [ ] `createArcticProvider()` returns a valid Arctic provider instance or null
- [ ] `fetchUserInfo()` returns user data in the expected format
- [ ] `package.json` includes `arctic` as a dependency
- [ ] Required env vars are documented
- [ ] OAuth redirect URIs are documented (`/api/auth/oauth/[provider]/callback`)
- [ ] Button styling looks appropriate

## See Also

- [Plugin Developer Guide](./README.md) - General plugin development
- [LLM Provider Guide](./LLM-PROVIDER-GUIDE.md) - LLM provider plugins
- [Auth Provider Interface](../lib/plugins/interfaces/auth-provider-plugin.ts) - TypeScript interface
- [Arctic Provider Registry](../lib/auth/arctic/registry.ts) - Registration system
- [Arctic Documentation](https://arcticjs.dev/) - Arctic OAuth library docs
