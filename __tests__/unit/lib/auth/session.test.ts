/**
 * Unit tests for session utilities
 *
 * Tests the session management functions including:
 * - getServerSession() - handles both AUTH_DISABLED and normal auth modes
 * - getRequiredSession() - throws if no valid session
 * - getCurrentUserId() - returns user ID or null
 * - getRequiredUserId() - throws if no session
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { User } from '@/lib/schemas/types';
import type { DecodedSession } from '@/lib/auth/session/jwt';

// Unmock the session module from jest.setup.ts so we can test the actual implementation
jest.unmock('@/lib/auth/session');

// Mock dependencies
jest.mock('@/lib/auth/config', () => ({
  isAuthDisabled: jest.fn(),
}));

jest.mock('@/lib/auth/unauthenticated-user', () => ({
  getOrCreateUnauthenticatedUser: jest.fn(),
  UNAUTHENTICATED_USER_ID: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

jest.mock('@/lib/auth/session/jwt', () => ({
  verifySessionToken: jest.fn(),
  shouldRefreshToken: jest.fn(),
  refreshSessionToken: jest.fn(),
}));

jest.mock('@/lib/auth/session/cookies', () => ({
  getSessionCookie: jest.fn(),
  setSessionCookieFromAction: jest.fn(),
}));

// Get mocks
const configMock = jest.requireMock('@/lib/auth/config') as { isAuthDisabled: jest.Mock };
const unauthUserMock = jest.requireMock('@/lib/auth/unauthenticated-user') as {
  getOrCreateUnauthenticatedUser: jest.Mock;
};
const loggerMock = jest.requireMock('@/lib/logger') as {
  logger: { info: jest.Mock; warn: jest.Mock; debug: jest.Mock; error: jest.Mock };
};
const jwtMock = jest.requireMock('@/lib/auth/session/jwt') as {
  verifySessionToken: jest.Mock;
  shouldRefreshToken: jest.Mock;
  refreshSessionToken: jest.Mock;
};
const cookiesMock = jest.requireMock('@/lib/auth/session/cookies') as {
  getSessionCookie: jest.Mock;
  setSessionCookieFromAction: jest.Mock;
};

// Type definitions
let getServerSession: typeof import('@/lib/auth/session').getServerSession;
let getRequiredSession: typeof import('@/lib/auth/session').getRequiredSession;
let getCurrentUserId: typeof import('@/lib/auth/session').getCurrentUserId;
let getRequiredUserId: typeof import('@/lib/auth/session').getRequiredUserId;

describe('Session utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Import module fresh for each test
    jest.isolateModules(() => {
      const sessionModule = require('@/lib/auth/session');
      getServerSession = sessionModule.getServerSession;
      getRequiredSession = sessionModule.getRequiredSession;
      getCurrentUserId = sessionModule.getCurrentUserId;
      getRequiredUserId = sessionModule.getRequiredUserId;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ============================================================================
  // getServerSession() with AUTH_DISABLED=true
  // ============================================================================
  describe('getServerSession() with AUTH_DISABLED=true', () => {
    const mockUnauthenticatedUser: User = {
      id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      username: 'unauthenticatedLocalUser',
      email: 'unauthenticated@localhost.localdomain',
      name: 'Unauthenticated Local User',
      image: '/images/default-avatar.png',
      passwordHash: null,
      totp: { ciphertext: '', iv: '', authTag: '', enabled: false },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    it('returns unauthenticated user session when auth is disabled', async () => {
      configMock.isAuthDisabled.mockReturnValue(true);
      unauthUserMock.getOrCreateUnauthenticatedUser.mockResolvedValue(mockUnauthenticatedUser);

      const session = await getServerSession();

      expect(session).not.toBeNull();
      expect(session?.user.id).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
      expect(session?.user.email).toBe('unauthenticated@localhost.localdomain');
      expect(session?.user.name).toBe('Unauthenticated Local User');
    });

    it('returns null and logs error when getOrCreateUnauthenticatedUser fails', async () => {
      configMock.isAuthDisabled.mockReturnValue(true);
      const error = new Error('Database connection failed');
      unauthUserMock.getOrCreateUnauthenticatedUser.mockRejectedValue(error);

      const session = await getServerSession();

      expect(session).toBeNull();
      expect(loggerMock.logger.error).toHaveBeenCalledWith(
        'Failed to get unauthenticated user session',
        expect.objectContaining({ context: 'getServerSession' }),
        error
      );
    });

    it('sets 30-day expiry for unauthenticated session', async () => {
      configMock.isAuthDisabled.mockReturnValue(true);
      unauthUserMock.getOrCreateUnauthenticatedUser.mockResolvedValue(mockUnauthenticatedUser);

      const now = Date.now();
      jest.useFakeTimers();
      jest.setSystemTime(now);

      const session = await getServerSession();

      expect(session).not.toBeNull();
      const expiryDate = new Date(session!.expires);
      const expectedExpiry = new Date(now + 30 * 24 * 60 * 60 * 1000);
      expect(expiryDate.getTime()).toBe(expectedExpiry.getTime());
    });

    it('returns correct user shape from unauthenticated user', async () => {
      configMock.isAuthDisabled.mockReturnValue(true);
      const userWithoutEmail: User = {
        ...mockUnauthenticatedUser,
        email: undefined as unknown as string,
      };
      unauthUserMock.getOrCreateUnauthenticatedUser.mockResolvedValue(userWithoutEmail);

      const session = await getServerSession();

      expect(session).not.toBeNull();
      // When email is undefined, it falls back to username
      expect(session?.user.email).toBe('unauthenticatedLocalUser');
    });
  });

  // ============================================================================
  // getServerSession() normal auth flow
  // ============================================================================
  describe('getServerSession() normal auth', () => {
    const mockDecodedSession: DecodedSession = {
      userId: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      image: '/images/test-avatar.png',
      iat: Math.floor(Date.now() / 1000) - 3600,
      exp: Math.floor(Date.now() / 1000) + 86400,
    };

    beforeEach(() => {
      configMock.isAuthDisabled.mockReturnValue(false);
    });

    it('returns null when no session cookie is found', async () => {
      cookiesMock.getSessionCookie.mockResolvedValue(null);

      const session = await getServerSession();

      expect(session).toBeNull();
    });

    it('returns null when token verification fails', async () => {
      cookiesMock.getSessionCookie.mockResolvedValue('invalid-token');
      jwtMock.verifySessionToken.mockResolvedValue(null);

      const session = await getServerSession();

      expect(session).toBeNull();
    });

    it('returns valid session from JWT', async () => {
      cookiesMock.getSessionCookie.mockResolvedValue('valid-token');
      jwtMock.verifySessionToken.mockResolvedValue(mockDecodedSession);
      jwtMock.shouldRefreshToken.mockReturnValue(false);

      const session = await getServerSession();

      expect(session).not.toBeNull();
      expect(session?.user.id).toBe('user-123');
      expect(session?.user.email).toBe('test@example.com');
      expect(session?.user.name).toBe('Test User');
    });

    it('refreshes token when shouldRefreshToken returns true', async () => {
      cookiesMock.getSessionCookie.mockResolvedValue('old-token');
      jwtMock.verifySessionToken.mockResolvedValue(mockDecodedSession);
      jwtMock.shouldRefreshToken.mockReturnValue(true);
      jwtMock.refreshSessionToken.mockResolvedValue('new-token');
      cookiesMock.setSessionCookieFromAction.mockResolvedValue(undefined);

      const session = await getServerSession();

      expect(session).not.toBeNull();
      expect(jwtMock.refreshSessionToken).toHaveBeenCalledWith(mockDecodedSession);
      expect(cookiesMock.setSessionCookieFromAction).toHaveBeenCalledWith('new-token');
    });

    it('handles refresh errors gracefully', async () => {
      cookiesMock.getSessionCookie.mockResolvedValue('valid-token');
      jwtMock.verifySessionToken.mockResolvedValue(mockDecodedSession);
      jwtMock.shouldRefreshToken.mockReturnValue(true);
      jwtMock.refreshSessionToken.mockRejectedValue(new Error('Refresh failed'));

      const session = await getServerSession();

      // Should still return the session even if refresh fails
      expect(session).not.toBeNull();
      expect(session?.user.id).toBe('user-123');
      expect(loggerMock.logger.warn).toHaveBeenCalledWith(
        'Failed to refresh session token',
        expect.objectContaining({ context: 'getServerSession', error: 'Refresh failed' })
      );
    });

    it('returns null for Dynamic server usage errors without logging error', async () => {
      cookiesMock.getSessionCookie.mockRejectedValue(new Error('Dynamic server usage: cookies'));

      const session = await getServerSession();

      expect(session).toBeNull();
      expect(loggerMock.logger.error).not.toHaveBeenCalled();
    });

    it('logs error for other exceptions and returns null', async () => {
      const error = new Error('Unexpected error');
      cookiesMock.getSessionCookie.mockRejectedValue(error);

      const session = await getServerSession();

      expect(session).toBeNull();
      expect(loggerMock.logger.error).toHaveBeenCalledWith(
        'Failed to verify session',
        expect.objectContaining({ context: 'getServerSession' }),
        error
      );
    });

    it('returns correct ExtendedSession shape with proper expiry', async () => {
      const expTimestamp = Math.floor(Date.now() / 1000) + 86400;
      const decodedWithExpiry: DecodedSession = {
        ...mockDecodedSession,
        exp: expTimestamp,
      };

      cookiesMock.getSessionCookie.mockResolvedValue('valid-token');
      jwtMock.verifySessionToken.mockResolvedValue(decodedWithExpiry);
      jwtMock.shouldRefreshToken.mockReturnValue(false);

      const session = await getServerSession();

      expect(session).not.toBeNull();
      expect(session?.expires).toBe(new Date(expTimestamp * 1000).toISOString());
    });
  });

  // ============================================================================
  // getRequiredSession()
  // ============================================================================
  describe('getRequiredSession()', () => {
    beforeEach(() => {
      configMock.isAuthDisabled.mockReturnValue(false);
    });

    it('returns session when valid', async () => {
      const mockDecodedSession: DecodedSession = {
        userId: 'user-456',
        email: 'valid@example.com',
        name: 'Valid User',
        image: null,
        iat: Math.floor(Date.now() / 1000) - 3600,
        exp: Math.floor(Date.now() / 1000) + 86400,
      };

      cookiesMock.getSessionCookie.mockResolvedValue('valid-token');
      jwtMock.verifySessionToken.mockResolvedValue(mockDecodedSession);
      jwtMock.shouldRefreshToken.mockReturnValue(false);

      const session = await getRequiredSession();

      expect(session.user.id).toBe('user-456');
      expect(session.user.email).toBe('valid@example.com');
    });

    it('throws "Unauthorized: No valid session" when session is null', async () => {
      cookiesMock.getSessionCookie.mockResolvedValue(null);

      await expect(getRequiredSession()).rejects.toThrow('Unauthorized: No valid session');
    });

    it('throws when session.user.id is missing', async () => {
      const sessionWithoutId: DecodedSession = {
        userId: '',
        email: 'test@example.com',
        name: 'Test',
        image: null,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      };

      cookiesMock.getSessionCookie.mockResolvedValue('token');
      jwtMock.verifySessionToken.mockResolvedValue(sessionWithoutId);
      jwtMock.shouldRefreshToken.mockReturnValue(false);

      await expect(getRequiredSession()).rejects.toThrow('Unauthorized: No valid session');
    });
  });

  // ============================================================================
  // getCurrentUserId()
  // ============================================================================
  describe('getCurrentUserId()', () => {
    beforeEach(() => {
      configMock.isAuthDisabled.mockReturnValue(false);
    });

    it('returns user ID from valid session', async () => {
      const mockDecodedSession: DecodedSession = {
        userId: 'user-789',
        email: 'user@example.com',
        name: 'User',
        image: null,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      };

      cookiesMock.getSessionCookie.mockResolvedValue('valid-token');
      jwtMock.verifySessionToken.mockResolvedValue(mockDecodedSession);
      jwtMock.shouldRefreshToken.mockReturnValue(false);

      const userId = await getCurrentUserId();

      expect(userId).toBe('user-789');
    });

    it('returns null when no session exists', async () => {
      cookiesMock.getSessionCookie.mockResolvedValue(null);

      const userId = await getCurrentUserId();

      expect(userId).toBeNull();
    });

    it('returns null when session.user is null', async () => {
      cookiesMock.getSessionCookie.mockResolvedValue('invalid-token');
      jwtMock.verifySessionToken.mockResolvedValue(null);

      const userId = await getCurrentUserId();

      expect(userId).toBeNull();
    });

    it('handles errors gracefully and returns null', async () => {
      cookiesMock.getSessionCookie.mockRejectedValue(new Error('Cookie error'));

      const userId = await getCurrentUserId();

      expect(userId).toBeNull();
    });
  });

  // ============================================================================
  // getRequiredUserId()
  // ============================================================================
  describe('getRequiredUserId()', () => {
    beforeEach(() => {
      configMock.isAuthDisabled.mockReturnValue(false);
    });

    it('returns user ID from valid session', async () => {
      const mockDecodedSession: DecodedSession = {
        userId: 'user-abc',
        email: 'abc@example.com',
        name: 'ABC User',
        image: null,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      };

      cookiesMock.getSessionCookie.mockResolvedValue('valid-token');
      jwtMock.verifySessionToken.mockResolvedValue(mockDecodedSession);
      jwtMock.shouldRefreshToken.mockReturnValue(false);

      const userId = await getRequiredUserId();

      expect(userId).toBe('user-abc');
    });

    it('throws when no session exists', async () => {
      cookiesMock.getSessionCookie.mockResolvedValue(null);

      await expect(getRequiredUserId()).rejects.toThrow('Unauthorized: No valid session');
    });

    it('propagates error from getRequiredSession', async () => {
      cookiesMock.getSessionCookie.mockResolvedValue('invalid-token');
      jwtMock.verifySessionToken.mockResolvedValue(null);

      await expect(getRequiredUserId()).rejects.toThrow('Unauthorized: No valid session');
    });
  });
});
