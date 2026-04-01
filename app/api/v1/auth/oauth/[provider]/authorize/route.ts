/**
 * Auth API v1 - OAuth Authorization Endpoint
 *
 * GET /api/v1/auth/oauth/[provider]/authorize
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
import { env } from '@/lib/env';
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
    // Get callback URL from query params (default to /)
    const callbackUrl = request.nextUrl.searchParams.get('callbackUrl') || '/';

    logger.debug('[Auth v1] OAuth authorize request', {
      provider: providerId,
      callbackUrl,
    });

    // Check if provider exists and is configured
    const plugin = getArcticProviderPlugin(providerId);
    if (!plugin) {
      logger.warn('[Auth v1] OAuth provider not found', { provider: providerId });
      return NextResponse.redirect(
        new URL(`/auth/signin?error=ProviderNotFound`, env.BASE_URL)
      );
    }

    if (!plugin.isConfigured()) {
      logger.warn('[Auth v1] OAuth provider not configured', {
        provider: providerId,
        missingVars: plugin.getConfigStatus().missingVars,
      });
      return NextResponse.redirect(
        new URL(`/auth/signin?error=ProviderNotConfigured`, env.BASE_URL)
      );
    }

    // Get the Arctic provider instance
    const arcticProvider = getArcticProvider(providerId);
    if (!arcticProvider) {
      logger.error('[Auth v1] Failed to create Arctic provider instance', {
        provider: providerId,
      });
      return NextResponse.redirect(
        new URL(`/auth/signin?error=ProviderError`, env.BASE_URL)
      );
    }

    // Create redirect response to store state cookies (uses BASE_URL for correct domain behind proxies)
    const redirectResponse = NextResponse.redirect(new URL('/loading', env.BASE_URL));

    // Generate OAuth state and store in cookies
    const { state, codeVerifier } = generateOAuthState(redirectResponse, callbackUrl);

    // Get scopes for this provider
    const scopes = getProviderScopes(providerId);

    // Create authorization URL
    const authUrl = arcticProvider.createAuthorizationURL(state, codeVerifier, scopes);

    logger.info('[Auth v1] Redirecting to OAuth provider', {
      provider: providerId,
      authUrl: authUrl.toString().substring(0, 100) + '...',
    });

    // Update redirect location to the provider's auth URL
    return NextResponse.redirect(authUrl, {
      headers: redirectResponse.headers,
    });
  } catch (error) {
    logger.error(
      '[Auth v1] OAuth authorization error',
      { provider: providerId },
      error instanceof Error ? error : undefined
    );

    return NextResponse.redirect(
      new URL(`/auth/signin?error=AuthorizationError`, env.BASE_URL)
    );
  }
}
