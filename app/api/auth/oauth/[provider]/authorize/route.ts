/**
 * OAuth Authorization Route
 *
 * GET /api/auth/oauth/[provider]/authorize
 *
 * Initiates the OAuth flow by redirecting to the provider's authorization URL.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getArcticProvider,
  getProviderScopes,
  getArcticProviderPlugin,
} from '@/lib/auth/arctic/registry';
import { generateOAuthState } from '@/lib/auth/arctic/state';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{
    provider: string;
  }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const { provider: providerId } = await params;

  try {
    // Get callback URL from query params (default to /dashboard)
    const callbackUrl = request.nextUrl.searchParams.get('callbackUrl') || '/dashboard';

    logger.debug('OAuth authorize request', {
      context: 'oauth.authorize.GET',
      provider: providerId,
      callbackUrl,
    });

    // Check if provider exists and is configured
    const plugin = getArcticProviderPlugin(providerId);
    if (!plugin) {
      logger.warn('OAuth provider not found', {
        context: 'oauth.authorize.GET',
        provider: providerId,
      });
      return NextResponse.redirect(
        new URL(`/auth/signin?error=ProviderNotFound`, request.url)
      );
    }

    if (!plugin.isConfigured()) {
      logger.warn('OAuth provider not configured', {
        context: 'oauth.authorize.GET',
        provider: providerId,
        missingVars: plugin.getConfigStatus().missingVars,
      });
      return NextResponse.redirect(
        new URL(`/auth/signin?error=ProviderNotConfigured`, request.url)
      );
    }

    // Get the Arctic provider instance
    const arcticProvider = getArcticProvider(providerId);
    if (!arcticProvider) {
      logger.error('Failed to create Arctic provider instance', {
        context: 'oauth.authorize.GET',
        provider: providerId,
      });
      return NextResponse.redirect(
        new URL(`/auth/signin?error=ProviderError`, request.url)
      );
    }

    // Create redirect response to store state cookies
    const redirectResponse = NextResponse.redirect(new URL('/loading', request.url));

    // Generate OAuth state and store in cookies
    const { state, codeVerifier } = generateOAuthState(redirectResponse, callbackUrl);

    // Get scopes for this provider
    const scopes = getProviderScopes(providerId);

    // Create authorization URL
    const authUrl = arcticProvider.createAuthorizationURL(state, codeVerifier, scopes);

    logger.info('Redirecting to OAuth provider', {
      context: 'oauth.authorize.GET',
      provider: providerId,
      authUrl: authUrl.toString().substring(0, 100) + '...',
    });

    // Update redirect location to the provider's auth URL
    return NextResponse.redirect(authUrl, {
      headers: redirectResponse.headers,
    });
  } catch (error) {
    logger.error(
      'OAuth authorization error',
      { context: 'oauth.authorize.GET', provider: providerId },
      error instanceof Error ? error : undefined
    );

    return NextResponse.redirect(
      new URL(`/auth/signin?error=AuthorizationError`, request.url)
    );
  }
}
