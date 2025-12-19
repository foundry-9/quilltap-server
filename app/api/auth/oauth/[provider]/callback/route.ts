/**
 * OAuth Callback Route
 *
 * GET /api/auth/oauth/[provider]/callback
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
import { runPostLoginMigrations } from '@/lib/auth/post-login-migrations';
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
      logger.warn('OAuth provider returned error', {
        context: 'oauth.callback.GET',
        provider: providerId,
        error,
        errorDescription,
      });
      return NextResponse.redirect(
        new URL(`/auth/signin?error=${encodeURIComponent(error)}`, request.url)
      );
    }

    // Validate required parameters
    if (!code || !state) {
      logger.warn('OAuth callback missing code or state', {
        context: 'oauth.callback.GET',
        provider: providerId,
        hasCode: !!code,
        hasState: !!state,
      });
      return NextResponse.redirect(
        new URL('/auth/signin?error=InvalidCallback', request.url)
      );
    }

    // Retrieve and verify OAuth state
    const storedState = retrieveOAuthState(request, state);
    if (!storedState) {
      logger.warn('OAuth state verification failed', {
        context: 'oauth.callback.GET',
        provider: providerId,
      });
      return NextResponse.redirect(
        new URL('/auth/signin?error=InvalidState', request.url)
      );
    }

    const { codeVerifier, callbackUrl } = storedState;

    logger.debug('OAuth callback processing', {
      context: 'oauth.callback.GET',
      provider: providerId,
      callbackUrl,
    });

    // Get the Arctic provider instance
    const arcticProvider = getArcticProvider(providerId);
    if (!arcticProvider) {
      logger.error('Arctic provider not found for callback', {
        context: 'oauth.callback.GET',
        provider: providerId,
      });
      return NextResponse.redirect(
        new URL('/auth/signin?error=ProviderError', request.url)
      );
    }

    // Exchange code for tokens
    let tokens;
    try {
      tokens = await arcticProvider.validateAuthorizationCode(code, codeVerifier);
    } catch (tokenError) {
      logger.error(
        'Failed to exchange OAuth code for tokens',
        { context: 'oauth.callback.GET', provider: providerId },
        tokenError instanceof Error ? tokenError : undefined
      );
      return NextResponse.redirect(
        new URL('/auth/signin?error=TokenExchangeFailed', request.url)
      );
    }

    const tokenResult = toArcticTokenResult(tokens);

    // Fetch user info from provider
    const userInfo = await fetchProviderUserInfo(providerId, tokenResult.accessToken);
    if (!userInfo) {
      logger.error('Failed to fetch user info from OAuth provider', {
        context: 'oauth.callback.GET',
        provider: providerId,
      });
      return NextResponse.redirect(
        new URL('/auth/signin?error=UserInfoFailed', request.url)
      );
    }

    logger.debug('OAuth user info received', {
      context: 'oauth.callback.GET',
      provider: providerId,
      providerUserId: userInfo.id,
      email: userInfo.email,
    });

    // Create or find user and link account
    const user = await createOrFindOAuthUser(providerId, userInfo, tokenResult);

    // Run post-login migrations
    try {
      await runPostLoginMigrations(user.id);
    } catch (migrationError) {
      // Log but don't block login if migrations fail
      logger.error(
        'Post-login migrations failed',
        { context: 'oauth.callback.GET', userId: user.id },
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

    logger.info('OAuth login successful', {
      context: 'oauth.callback.GET',
      provider: providerId,
      userId: user.id,
      email: user.email,
    });

    // Create redirect response
    const response = NextResponse.redirect(new URL(callbackUrl, request.url));

    // Set session cookie and clear OAuth state cookies
    setSessionCookie(response, sessionToken);
    clearOAuthState(response);

    return response;
  } catch (error) {
    logger.error(
      'OAuth callback error',
      { context: 'oauth.callback.GET', provider: providerId },
      error instanceof Error ? error : undefined
    );

    return NextResponse.redirect(
      new URL('/auth/signin?error=CallbackError', request.url)
    );
  }
}
