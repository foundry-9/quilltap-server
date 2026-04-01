/**
 * Auth API v1 - Auth Status Endpoint
 *
 * GET /api/v1/auth/status - Check authentication status and auth mode
 *
 * Returns information about the authentication configuration,
 * including which OAuth providers are available.
 *
 * Response flags:
 * - authDisabled: true when AUTH_DISABLED=true (complete auth bypass, auto-login)
 * - oauthDisabled: true when OAUTH_DISABLED=true (OAuth hidden, credentials still work)
 * - credentialsEnabled: true when username/password login is available
 */

import { NextRequest } from 'next/server';
import { isAuthDisabled, isOAuthDisabled } from '@/lib/auth/config';
import {
  getConfiguredArcticProviders,
  getAllArcticProviders,
} from '@/lib/auth/arctic/registry';
import { isPluginSystemInitialized, initializePlugins } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import { successResponse, serverError } from '@/lib/api/responses';

// ============================================================================
// GET Handler
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const authDisabled = isAuthDisabled();
    const oauthDisabled = isOAuthDisabled();

    // Ensure plugins are initialized before checking auth providers
    // This handles cases where the API request arrives before instrumentation completes
    if (!isPluginSystemInitialized()) {
      logger.info('[Auth v1] Plugin system not initialized, initializing now');
      await initializePlugins();
    }

    const pluginsInitialized = isPluginSystemInitialized();

    // If auth is completely disabled, return minimal info
    // This means the app auto-logs in as unauthenticatedLocalUser
    if (authDisabled) {
      logger.debug('[Auth v1] Auth status - auth completely disabled');
      return successResponse({
        authDisabled: true,
        oauthDisabled: true, // Implied when auth is completely disabled
        hasOAuthProviders: false,
        providers: [],
        credentialsEnabled: false,
        warning: null,
      });
    }

    // If only OAuth is disabled, credentials login still works
    if (oauthDisabled) {
      logger.debug('[Auth v1] Auth status - OAuth disabled, credentials enabled');
      return successResponse({
        authDisabled: false,
        oauthDisabled: true,
        hasOAuthProviders: false,
        providers: [],
        credentialsEnabled: true,
        pluginsInitialized,
        warning: 'OAuth providers are disabled. Only username/password login is available.',
      });
    }

    // Normal mode - get OAuth provider information from Arctic registry
    const configuredProviders = pluginsInitialized ? getConfiguredArcticProviders() : [];
    const allProviders = pluginsInitialized ? getAllArcticProviders() : new Map();

    // Build provider info for response
    const providers = configuredProviders.map(p => ({
      id: p.config.providerId,
      name: p.config.displayName,
      icon: p.config.icon,
      buttonColor: p.config.buttonColor,
      buttonTextColor: p.config.buttonTextColor,
    }));

    // Determine warning message
    let warning: string | null = null;
    if (!pluginsInitialized) {
      warning = 'Plugin system is still initializing. OAuth providers may not be available yet.';
    } else if (configuredProviders.length === 0) {
      const unconfiguredCount = Array.from(allProviders.values()).filter(p => !p.isConfigured()).length;
      if (unconfiguredCount > 0) {
        warning = `${unconfiguredCount} authentication plugin(s) are registered but not configured. Check environment variables.`;
      } else if (allProviders.size === 0) {
        warning = 'No OAuth authentication plugins are registered. Only credentials-based login is available.';
      }
    }

    logger.debug('[Auth v1] Auth status requested', {
      authDisabled,
      oauthDisabled,
      pluginsInitialized,
      configuredProviders: configuredProviders.length,
      totalProviders: allProviders.size,
    });

    return successResponse({
      authDisabled: false,
      oauthDisabled: false,
      hasOAuthProviders: configuredProviders.length > 0,
      providers,
      credentialsEnabled: true,
      pluginsInitialized,
      warning,
    });
  } catch (error) {
    logger.error('[Auth v1] Failed to get auth status', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to get auth status');
  }
}
