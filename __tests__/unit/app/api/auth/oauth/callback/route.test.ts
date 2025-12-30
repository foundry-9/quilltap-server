/**
 * Unit tests for OAuth Callback Route
 * Tests: GET /api/auth/oauth/[provider]/callback
 *
 * This route handles OAuth callbacks from providers (Google, etc.),
 * exchanges authorization codes for tokens, creates/finds users,
 * and sets up sessions.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { NextRequest, NextResponse } from 'next/server';

// Mock NextResponse.redirect to return a proper mock response
const mockRedirect = jest.fn((url: URL | string) => {
  const headers = new Map<string, string>();
  headers.set('location', url.toString());
  return {
    status: 307,
    headers: {
      get: (key: string) => headers.get(key.toLowerCase()) ?? null,
      set: (key: string, value: string) => headers.set(key.toLowerCase(), value),
    },
  };
});
(NextResponse as any).redirect = mockRedirect;

// Mock arctic module (ESM module) to prevent import errors
jest.mock('arctic', () => ({
  generateState: jest.fn(() => 'mock-state'),
  generateCodeVerifier: jest.fn(() => 'mock-code-verifier'),
}));

// Mock dependencies before importing the route
jest.mock('@/lib/auth/arctic/registry', () => ({
  getArcticProvider: jest.fn(),
  fetchProviderUserInfo: jest.fn(),
}));

jest.mock('@/lib/auth/arctic/state', () => ({
  retrieveOAuthState: jest.fn(),
  clearOAuthState: jest.fn(),
}));

jest.mock('@/lib/auth/arctic/types', () => ({
  toArcticTokenResult: jest.fn(),
}));

jest.mock('@/lib/auth/arctic/user-service', () => ({
  createOrFindOAuthUser: jest.fn(),
}));

jest.mock('@/lib/auth/session', () => ({
  createSessionToken: jest.fn(),
  setSessionCookie: jest.fn(),
}));

jest.mock('@/lib/auth/user-migrations', () => ({
  runPostLoginMigrations: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}));

// Get mocks using jest.requireMock
const registryMock = jest.requireMock('@/lib/auth/arctic/registry') as {
  getArcticProvider: jest.Mock;
  fetchProviderUserInfo: jest.Mock;
};
const stateMock = jest.requireMock('@/lib/auth/arctic/state') as {
  retrieveOAuthState: jest.Mock;
  clearOAuthState: jest.Mock;
};
const typesMock = jest.requireMock('@/lib/auth/arctic/types') as {
  toArcticTokenResult: jest.Mock;
};
const userServiceMock = jest.requireMock('@/lib/auth/arctic/user-service') as {
  createOrFindOAuthUser: jest.Mock;
};
const sessionMock = jest.requireMock('@/lib/auth/session') as {
  createSessionToken: jest.Mock;
  setSessionCookie: jest.Mock;
};
const migrationsMock = jest.requireMock('@/lib/auth/user-migrations') as {
  runPostLoginMigrations: jest.Mock;
};
const loggerMock = jest.requireMock('@/lib/logger') as {
  logger: { info: jest.Mock; debug: jest.Mock; warn: jest.Mock; error: jest.Mock };
};

// Create aliases for cleaner test code
const mockGetArcticProvider = registryMock.getArcticProvider;
const mockFetchProviderUserInfo = registryMock.fetchProviderUserInfo;
const mockRetrieveOAuthState = stateMock.retrieveOAuthState;
const mockClearOAuthState = stateMock.clearOAuthState;
const mockToArcticTokenResult = typesMock.toArcticTokenResult;
const mockCreateOrFindOAuthUser = userServiceMock.createOrFindOAuthUser;
const mockCreateSessionToken = sessionMock.createSessionToken;
const mockSetSessionCookie = sessionMock.setSessionCookie;
const mockRunPostLoginMigrations = migrationsMock.runPostLoginMigrations;
const mockLogger = loggerMock.logger;

// Route handler, loaded fresh in beforeEach
let GET: typeof import('@/app/api/auth/oauth/[provider]/callback/route').GET;

/**
 * Helper to create a mock NextRequest with URL search params
 */
function createRequest(searchParams: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/auth/oauth/google/callback');
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return {
    nextUrl: {
      searchParams: url.searchParams,
    },
    url: url.toString(),
    cookies: {
      get: jest.fn(),
    },
  } as unknown as NextRequest;
}

/**
 * Helper to create route params
 */
function createParams(provider: string = 'google') {
  return {
    params: Promise.resolve({ provider }),
  };
}

/**
 * Helper to extract redirect URL from NextResponse
 */
function getRedirectUrl(response: NextResponse): string {
  const locationHeader = response.headers.get('location');
  return locationHeader || '';
}

describe('OAuth Callback Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedirect.mockClear();

    // Reload the route module fresh for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/auth/oauth/[provider]/callback/route');
      GET = routeModule.GET;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================================
  // 1. OAuth Provider Errors (2 tests)
  // ============================================================================
  describe('OAuth Provider Errors', () => {
    it('should redirect to signin with error when OAuth provider returns an error', async () => {
      const request = createRequest({
        error: 'access_denied',
      });
      const params = createParams();

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/auth/signin?error=access_denied');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'OAuth provider returned error',
        expect.objectContaining({
          context: 'oauth.callback.GET',
          provider: 'google',
          error: 'access_denied',
        })
      );
    });

    it('should include error_description in redirect when provider returns it', async () => {
      const request = createRequest({
        error: 'access_denied',
        error_description: 'User denied access',
      });
      const params = createParams();

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/auth/signin?error=access_denied');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'OAuth provider returned error',
        expect.objectContaining({
          errorDescription: 'User denied access',
        })
      );
    });
  });

  // ============================================================================
  // 2. Parameter Validation (3 tests)
  // ============================================================================
  describe('Parameter Validation', () => {
    it('should redirect with InvalidCallback when code is missing', async () => {
      const request = createRequest({
        state: 'valid-state',
      });
      const params = createParams();

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/auth/signin?error=InvalidCallback');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'OAuth callback missing code or state',
        expect.objectContaining({
          hasCode: false,
          hasState: true,
        })
      );
    });

    it('should redirect with InvalidCallback when state is missing', async () => {
      const request = createRequest({
        code: 'authorization-code',
      });
      const params = createParams();

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/auth/signin?error=InvalidCallback');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'OAuth callback missing code or state',
        expect.objectContaining({
          hasCode: true,
          hasState: false,
        })
      );
    });

    it('should redirect with InvalidState when state verification fails', async () => {
      const request = createRequest({
        code: 'authorization-code',
        state: 'invalid-state',
      });
      const params = createParams();

      mockRetrieveOAuthState.mockReturnValue(null);

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/auth/signin?error=InvalidState');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'OAuth state verification failed',
        expect.objectContaining({
          context: 'oauth.callback.GET',
          provider: 'google',
        })
      );
    });
  });

  // ============================================================================
  // 3. Provider Handling (2 tests)
  // ============================================================================
  describe('Provider Handling', () => {
    it('should redirect with ProviderError when Arctic provider is not found', async () => {
      const request = createRequest({
        code: 'authorization-code',
        state: 'valid-state',
      });
      const params = createParams('unknown-provider');

      mockRetrieveOAuthState.mockReturnValue({
        codeVerifier: 'verifier-123',
        callbackUrl: '/dashboard',
      });
      mockGetArcticProvider.mockReturnValue(null);

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/auth/signin?error=ProviderError');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Arctic provider not found for callback',
        expect.objectContaining({
          provider: 'unknown-provider',
        })
      );
    });

    it('should redirect with TokenExchangeFailed when code exchange fails', async () => {
      const request = createRequest({
        code: 'invalid-code',
        state: 'valid-state',
      });
      const params = createParams();

      mockRetrieveOAuthState.mockReturnValue({
        codeVerifier: 'verifier-123',
        callbackUrl: '/dashboard',
      });

      const mockProviderInstance = {
        validateAuthorizationCode: jest.fn().mockRejectedValue(new Error('Invalid code')),
        createAuthorizationURL: jest.fn(),
      };
      mockGetArcticProvider.mockReturnValue(mockProviderInstance as any);

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/auth/signin?error=TokenExchangeFailed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to exchange OAuth code for tokens',
        expect.objectContaining({
          context: 'oauth.callback.GET',
          provider: 'google',
        }),
        expect.any(Error)
      );
    });
  });

  // ============================================================================
  // 4. User Info Fetching (2 tests)
  // ============================================================================
  describe('User Info Fetching', () => {
    it('should redirect with UserInfoFailed when fetchProviderUserInfo returns null', async () => {
      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams();

      mockRetrieveOAuthState.mockReturnValue({
        codeVerifier: 'verifier-123',
        callbackUrl: '/dashboard',
      });

      const mockTokens = {
        accessToken: () => 'access-token',
        refreshToken: () => 'refresh-token',
        hasRefreshToken: () => true,
        accessTokenExpiresAt: () => new Date(),
        idToken: () => 'id-token',
      };
      const mockProviderInstance = {
        validateAuthorizationCode: jest.fn().mockResolvedValue(mockTokens),
        createAuthorizationURL: jest.fn(),
      };
      mockGetArcticProvider.mockReturnValue(mockProviderInstance as any);
      mockToArcticTokenResult.mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(),
        idToken: 'id-token',
      });
      mockFetchProviderUserInfo.mockResolvedValue(null);

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/auth/signin?error=UserInfoFailed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to fetch user info from OAuth provider',
        expect.objectContaining({
          context: 'oauth.callback.GET',
          provider: 'google',
        })
      );
    });

    it('should proceed with valid user info from provider', async () => {
      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams();

      mockRetrieveOAuthState.mockReturnValue({
        codeVerifier: 'verifier-123',
        callbackUrl: '/dashboard',
      });

      const mockTokens = {
        accessToken: () => 'access-token',
        refreshToken: () => 'refresh-token',
        hasRefreshToken: () => true,
        accessTokenExpiresAt: () => new Date(),
        idToken: () => 'id-token',
      };
      const mockProviderInstance = {
        validateAuthorizationCode: jest.fn().mockResolvedValue(mockTokens),
        createAuthorizationURL: jest.fn(),
      };
      mockGetArcticProvider.mockReturnValue(mockProviderInstance as any);
      mockToArcticTokenResult.mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(),
        idToken: 'id-token',
      });

      const userInfo = {
        id: 'provider-user-123',
        email: 'user@example.com',
        name: 'Test User',
        image: 'https://example.com/avatar.jpg',
      };
      mockFetchProviderUserInfo.mockResolvedValue(userInfo);

      const user = {
        id: 'user-123',
        username: 'testuser',
        email: 'user@example.com',
        name: 'Test User',
        image: 'https://example.com/avatar.jpg',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockCreateOrFindOAuthUser.mockResolvedValue(user);
      mockRunPostLoginMigrations.mockResolvedValue(undefined);
      mockCreateSessionToken.mockResolvedValue('session-token-abc');

      const response = await GET(request, params);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'OAuth user info received',
        expect.objectContaining({
          providerUserId: 'provider-user-123',
          email: 'user@example.com',
        })
      );
      expect(mockCreateOrFindOAuthUser).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 5. Successful OAuth Flow (6 tests)
  // ============================================================================
  describe('Successful OAuth Flow', () => {
    // Setup common mocks for successful flow
    function setupSuccessfulFlow() {
      mockRetrieveOAuthState.mockReturnValue({
        codeVerifier: 'verifier-123',
        callbackUrl: '/custom-callback',
      });

      const mockTokens = {
        accessToken: () => 'access-token',
        refreshToken: () => 'refresh-token',
        hasRefreshToken: () => true,
        accessTokenExpiresAt: () => new Date(),
        idToken: () => 'id-token',
      };
      const mockProviderInstance = {
        validateAuthorizationCode: jest.fn().mockResolvedValue(mockTokens),
        createAuthorizationURL: jest.fn(),
      };
      mockGetArcticProvider.mockReturnValue(mockProviderInstance as any);

      mockToArcticTokenResult.mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(),
        idToken: 'id-token',
      });

      const userInfo = {
        id: 'provider-user-123',
        email: 'user@example.com',
        name: 'Test User',
        image: 'https://example.com/avatar.jpg',
      };
      mockFetchProviderUserInfo.mockResolvedValue(userInfo);

      const user = {
        id: 'user-123',
        username: 'testuser',
        email: 'user@example.com',
        name: 'Test User',
        image: 'https://example.com/avatar.jpg',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockCreateOrFindOAuthUser.mockResolvedValue(user);
      mockRunPostLoginMigrations.mockResolvedValue(undefined);
      mockCreateSessionToken.mockResolvedValue('session-token-abc');

      return { user, userInfo };
    }

    it('should create or find OAuth user with correct parameters', async () => {
      const { userInfo } = setupSuccessfulFlow();
      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams();

      await GET(request, params);

      expect(mockCreateOrFindOAuthUser).toHaveBeenCalledWith(
        'google',
        userInfo,
        expect.objectContaining({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        })
      );
    });

    it('should run post-login migrations after user creation', async () => {
      const { user } = setupSuccessfulFlow();
      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams();

      await GET(request, params);

      expect(mockRunPostLoginMigrations).toHaveBeenCalledWith(user.id);
    });

    it('should continue login even if post-login migrations fail', async () => {
      setupSuccessfulFlow();
      mockRunPostLoginMigrations.mockRejectedValue(new Error('Migration failed'));

      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams();

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      // Should still redirect to callback URL, not an error
      expect(redirectUrl).toContain('/custom-callback');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Post-login migrations failed',
        expect.objectContaining({
          context: 'oauth.callback.GET',
          userId: 'user-123',
        }),
        expect.any(Error)
      );
      // Session should still be created
      expect(mockCreateSessionToken).toHaveBeenCalled();
    });

    it('should create session token with correct user data', async () => {
      const { user } = setupSuccessfulFlow();
      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams();

      await GET(request, params);

      expect(mockCreateSessionToken).toHaveBeenCalledWith({
        userId: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      });
    });

    it('should set session cookie and clear OAuth state cookies', async () => {
      setupSuccessfulFlow();
      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams();

      const response = await GET(request, params);

      expect(mockSetSessionCookie).toHaveBeenCalledWith(response, 'session-token-abc');
      expect(mockClearOAuthState).toHaveBeenCalledWith(response);
    });

    it('should redirect to callbackUrl from stored state', async () => {
      setupSuccessfulFlow();
      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams();

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/custom-callback');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'OAuth login successful',
        expect.objectContaining({
          provider: 'google',
          userId: 'user-123',
          email: 'user@example.com',
        })
      );
    });
  });

  // ============================================================================
  // 6. Error Handling (2 tests)
  // ============================================================================
  describe('Error Handling', () => {
    it('should catch and log unexpected errors', async () => {
      mockRetrieveOAuthState.mockReturnValue({
        codeVerifier: 'verifier-123',
        callbackUrl: '/dashboard',
      });

      const mockProviderInstance = {
        validateAuthorizationCode: jest.fn().mockResolvedValue({}),
        createAuthorizationURL: jest.fn(),
      };
      mockGetArcticProvider.mockReturnValue(mockProviderInstance as any);

      // Make toArcticTokenResult throw an unexpected error
      mockToArcticTokenResult.mockImplementation(() => {
        throw new Error('Unexpected internal error');
      });

      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams();

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/auth/signin?error=CallbackError');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'OAuth callback error',
        expect.objectContaining({
          context: 'oauth.callback.GET',
          provider: 'google',
        }),
        expect.any(Error)
      );
    });

    it('should redirect to signin with CallbackError on unexpected errors', async () => {
      // Simulate an error in retrieveOAuthState after validation passes
      mockRetrieveOAuthState.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams();

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/auth/signin?error=CallbackError');
    });
  });

  // ============================================================================
  // Additional Edge Cases
  // ============================================================================
  describe('Edge Cases', () => {
    it('should handle user without email (use username as fallback)', async () => {
      mockRetrieveOAuthState.mockReturnValue({
        codeVerifier: 'verifier-123',
        callbackUrl: '/dashboard',
      });

      const mockTokens = {
        accessToken: () => 'access-token',
        refreshToken: () => 'refresh-token',
        hasRefreshToken: () => true,
        accessTokenExpiresAt: () => new Date(),
        idToken: () => 'id-token',
      };
      const mockProviderInstance = {
        validateAuthorizationCode: jest.fn().mockResolvedValue(mockTokens),
        createAuthorizationURL: jest.fn(),
      };
      mockGetArcticProvider.mockReturnValue(mockProviderInstance as any);

      mockToArcticTokenResult.mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(),
        idToken: 'id-token',
      });

      const userInfo = {
        id: 'provider-user-123',
        name: 'Test User',
        // No email
      };
      mockFetchProviderUserInfo.mockResolvedValue(userInfo);

      // User without email
      const user = {
        id: 'user-123',
        username: 'testuser',
        email: null,
        name: 'Test User',
        image: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockCreateOrFindOAuthUser.mockResolvedValue(user);
      mockRunPostLoginMigrations.mockResolvedValue(undefined);
      mockCreateSessionToken.mockResolvedValue('session-token-abc');

      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams();

      await GET(request, params);

      // Should fall back to username when email is null
      expect(mockCreateSessionToken).toHaveBeenCalledWith({
        userId: 'user-123',
        email: 'testuser', // Falls back to username
        name: 'Test User',
        image: null,
      });
    });

    it('should work with different OAuth providers', async () => {
      mockRetrieveOAuthState.mockReturnValue({
        codeVerifier: 'verifier-123',
        callbackUrl: '/dashboard',
      });

      const mockTokens = {
        accessToken: () => 'access-token',
        refreshToken: () => 'refresh-token',
        hasRefreshToken: () => true,
        accessTokenExpiresAt: () => new Date(),
        idToken: () => 'id-token',
      };
      const mockProviderInstance = {
        validateAuthorizationCode: jest.fn().mockResolvedValue(mockTokens),
        createAuthorizationURL: jest.fn(),
      };
      mockGetArcticProvider.mockReturnValue(mockProviderInstance as any);

      mockToArcticTokenResult.mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      const userInfo = {
        id: 'github-user-456',
        email: 'dev@github.com',
        name: 'GitHub Developer',
      };
      mockFetchProviderUserInfo.mockResolvedValue(userInfo);

      const user = {
        id: 'user-456',
        username: 'githubdev',
        email: 'dev@github.com',
        name: 'GitHub Developer',
        image: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockCreateOrFindOAuthUser.mockResolvedValue(user);
      mockRunPostLoginMigrations.mockResolvedValue(undefined);
      mockCreateSessionToken.mockResolvedValue('session-token-xyz');

      const request = createRequest({
        code: 'valid-code',
        state: 'valid-state',
      });
      const params = createParams('github');

      await GET(request, params);

      expect(mockGetArcticProvider).toHaveBeenCalledWith('github');
      expect(mockCreateOrFindOAuthUser).toHaveBeenCalledWith(
        'github',
        userInfo,
        expect.any(Object)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'OAuth login successful',
        expect.objectContaining({
          provider: 'github',
        })
      );
    });

    it('should handle URL-encoded error messages from provider', async () => {
      const request = createRequest({
        error: 'invalid_scope',
        error_description: 'The+requested+scope+is+invalid',
      });
      const params = createParams();

      const response = await GET(request, params);
      const redirectUrl = getRedirectUrl(response);

      expect(response.status).toBe(307);
      expect(redirectUrl).toContain('/auth/signin?error=invalid_scope');
    });
  });
});
