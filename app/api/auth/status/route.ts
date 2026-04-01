/**
 * Auth Status Endpoint
 *
 * Returns information about the authentication configuration,
 * including which OAuth providers are available.
 *
 * Response flags:
 * - authDisabled: true when AUTH_DISABLED=true (complete auth bypass, auto-login)
 * - oauthDisabled: true when OAUTH_DISABLED=true (OAuth hidden, credentials still work)
 * - credentialsEnabled: true when username/password login is available
 */

import { NextResponse } from 'next/server';
import { isAuthDisabled, isOAuthDisabled } from '@/lib/auth/config';
import {
  getConfiguredArcticProviders,
  getAllArcticProviders,
} from '@/lib/auth/arctic/registry';
import { isPluginSystemInitialized, initializePlugins } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const authDisabled = isAuthDisabled();
    const oauthDisabled = isOAuthDisabled();

    // Ensure plugins are initialized before checking auth providers
    // This handles cases where the API request arrives before instrumentation completes
    if (!isPluginSystemInitialized()) {
      logger.info('Plugin system not initialized, initializing now', {
        context: 'auth/status',
      });
      await initializePlugins();
    }

    const pluginsInitialized = isPluginSystemInitialized();

    // If auth is completely disabled, return minimal info
    // This means the app auto-logs in as unauthenticatedLocalUser
    if (authDisabled) {
      logger.debug('Auth status requested - auth completely disabled', {
        context: 'auth/status',
      });
      return NextResponse.json({
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
      logger.debug('Auth status requested - OAuth disabled, credentials enabled', {
        context: 'auth/status',
      });
      return NextResponse.json({
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

    logger.debug('Auth status requested', {
      context: 'auth/status',
      authDisabled,
      oauthDisabled,
      pluginsInitialized,
      configuredProviders: configuredProviders.length,
      totalProviders: allProviders.size,
    });

    return NextResponse.json({
      authDisabled: false,
      oauthDisabled: false,
      hasOAuthProviders: configuredProviders.length > 0,
      providers,
      credentialsEnabled: true,
      pluginsInitialized,
      warning,
    });
  } catch (error) {
    logger.error('Failed to get auth status', { context: 'auth/status' }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      { error: 'Failed to get auth status' },
      { status: 500 }
    );
  }
}
