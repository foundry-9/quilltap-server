/**
 * Auth API v1 - OAuth Callback Endpoint
 *
 * GET /api/v1/auth/oauth/[provider]/callback
 *
 * Handles the OAuth callback from the provider, exchanges the code for tokens,
 * creates/links the user, and sets the session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getArcticProvider, fetchProviderUserInfo } from '@/lib/auth/arctic/registry';
import { retrieveOAuthState, clearOAuthState } from '@/lib/auth/arctic/state';
import { toArcticTokenResult } from '@/lib/auth/arctic/types';
import { createOrFindOAuthUser } from '@/lib/auth/arctic/user-service';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { runPostLoginMigrations } from '@/lib/auth/user-migrations';
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
    // Get query parameters
    const code = request.nextUrl.searchParams.get('code');
    const state = request.nextUrl.searchParams.get('state');
    const error = request.nextUrl.searchParams.get('error');
    const errorDescription = request.nextUrl.searchParams.get('error_description');

    // Check for OAuth errors from provider
    if (error) {
      logger.warn('[Auth v1] OAuth provider returned error', {
        provider: providerId,
        error,
        errorDescription,
      });
      return NextResponse.redirect(
        new URL(`/auth/signin?error=${encodeURIComponent(error)}`, env.BASE_URL)
      );
    }

    // Validate required parameters
    if (!code || !state) {
      logger.warn('[Auth v1] OAuth callback missing code or state', {
        provider: providerId,
        hasCode: !!code,
        hasState: !!state,
      });
      return NextResponse.redirect(
        new URL('/auth/signin?error=InvalidCallback', env.BASE_URL)
      );
    }

    // Retrieve and verify OAuth state
    const storedState = retrieveOAuthState(request, state);
    if (!storedState) {
      logger.warn('[Auth v1] OAuth state verification failed', {
        provider: providerId,
      });
      return NextResponse.redirect(
        new URL('/auth/signin?error=InvalidState', env.BASE_URL)
      );
    }

    const { codeVerifier, callbackUrl } = storedState;// Get the Arctic provider instance
    const arcticProvider = getArcticProvider(providerId);
    if (!arcticProvider) {
      logger.error('[Auth v1] Arctic provider not found for callback', {
        provider: providerId,
      });
      return NextResponse.redirect(
        new URL('/auth/signin?error=ProviderError', env.BASE_URL)
      );
    }

    // Exchange code for tokens
    let tokens;
    try {
      tokens = await arcticProvider.validateAuthorizationCode(code, codeVerifier);
    } catch (tokenError) {
      logger.error(
        '[Auth v1] Failed to exchange OAuth code for tokens',
        { provider: providerId },
        tokenError instanceof Error ? tokenError : undefined
      );
      return NextResponse.redirect(
        new URL('/auth/signin?error=TokenExchangeFailed', env.BASE_URL)
      );
    }

    const tokenResult = toArcticTokenResult(tokens);

    // Fetch user info from provider
    const userInfo = await fetchProviderUserInfo(providerId, tokenResult.accessToken);
    if (!userInfo) {
      logger.error('[Auth v1] Failed to fetch user info from OAuth provider', {
        provider: providerId,
      });
      return NextResponse.redirect(
        new URL('/auth/signin?error=UserInfoFailed', env.BASE_URL)
      );
    }// Create or find user and link account
    const user = await createOrFindOAuthUser(providerId, userInfo, tokenResult);

    // Run post-login migrations
    try {
      await runPostLoginMigrations(user.id);
    } catch (migrationError) {
      // Log but don't block login if migrations fail
      logger.error(
        '[Auth v1] Post-login migrations failed',
        { userId: user.id },
        migrationError instanceof Error ? migrationError : undefined
      );
    }

    // Create session token
    const sessionToken = await createSessionToken({
      userId: user.id,
      email: user.email || user.username,
      name: user.name,
      image: user.image,
    });

    logger.info('[Auth v1] OAuth login successful', {
      provider: providerId,
      userId: user.id,
      email: user.email,
    });

    // Create redirect response using BASE_URL to ensure correct domain behind proxies
    const response = NextResponse.redirect(new URL(callbackUrl, env.BASE_URL));

    // Set session cookie and clear OAuth state cookies
    setSessionCookie(response, sessionToken);
    clearOAuthState(response);

    return response;
  } catch (error) {
    logger.error(
      '[Auth v1] OAuth callback error',
      { provider: providerId },
      error instanceof Error ? error : undefined
    );

    return NextResponse.redirect(
      new URL('/auth/signin?error=CallbackError', env.BASE_URL)
    );
  }
}
