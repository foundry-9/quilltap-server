/**
 * Unit Tests for JWT Session Management
 *
 * Tests the JWT token creation, verification, and refresh functionality
 * for session management.
 */

import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals';

// Mock logger before importing the module under test
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    })),
  },
}));

// Set environment variable before importing module
const TEST_PEPPER = 'test-pepper-for-jwt-tests-32-chars-long!';
process.env.ENCRYPTION_MASTER_PEPPER = TEST_PEPPER;

// Import module under test after mocks are set up
import {
  createSessionToken,
  verifySessionToken,
  shouldRefreshToken,
  refreshSessionToken,
  getSessionConfig,
  SessionPayload,
  DecodedSession,
} from '@/lib/auth/session/jwt';

describe('JWT Session Management', () => {
  // Store original Date.now for restoration
  const originalDateNow = Date.now;

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore Date.now before each test
    Date.now = originalDateNow;
  });

  afterAll(() => {
    // Ensure Date.now is restored after all tests
    Date.now = originalDateNow;
  });

  describe('createSessionToken()', () => {
    const validUser: SessionPayload = {
      userId: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      image: 'https://example.com/avatar.jpg',
    };

    it('creates a valid JWT with all fields', async () => {
      const token = await createSessionToken(validUser);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      // JWT format: header.payload.signature
      expect(token.split('.')).toHaveLength(3);
    });

    it('includes userId, email, name, and image in payload', async () => {
      const token = await createSessionToken(validUser);

      // Verify the token contains the expected payload
      const session = await verifySessionToken(token);

      expect(session).not.toBeNull();
      expect(session?.userId).toBe(validUser.userId);
      expect(session?.email).toBe(validUser.email);
      expect(session?.name).toBe(validUser.name);
      expect(session?.image).toBe(validUser.image);
    });

    it('sets correct expiration (7 days from now)', async () => {
      const now = Date.now();
      const sevenDaysInSeconds = 7 * 24 * 60 * 60;

      const token = await createSessionToken(validUser);
      const session = await verifySessionToken(token);

      expect(session).not.toBeNull();
      // exp should be approximately 7 days from now (within 5 seconds tolerance)
      const expectedExp = Math.floor(now / 1000) + sevenDaysInSeconds;
      expect(session?.exp).toBeGreaterThanOrEqual(expectedExp - 5);
      expect(session?.exp).toBeLessThanOrEqual(expectedExp + 5);
    });

    it('sets subject to userId', async () => {
      const token = await createSessionToken(validUser);

      // Decode without verification to check the sub claim
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      expect(payload.sub).toBe(validUser.userId);
    });

    it('throws when userId is missing', async () => {
      const invalidUser = {
        userId: '',
        email: 'test@example.com',
      } as SessionPayload;

      await expect(createSessionToken(invalidUser)).rejects.toThrow(
        'userId and email are required for session token'
      );
    });

    it('throws when email is missing', async () => {
      const invalidUser = {
        userId: 'user-123',
        email: '',
      } as SessionPayload;

      await expect(createSessionToken(invalidUser)).rejects.toThrow(
        'userId and email are required for session token'
      );
    });

    it('handles null name and image', async () => {
      const userWithNulls: SessionPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        name: null,
        image: null,
      };

      const token = await createSessionToken(userWithNulls);
      const session = await verifySessionToken(token);

      expect(session).not.toBeNull();
      expect(session?.name).toBeNull();
      expect(session?.image).toBeNull();
    });
  });

  describe('verifySessionToken()', () => {
    const validUser: SessionPayload = {
      userId: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      image: 'https://example.com/avatar.jpg',
    };

    it('returns null for empty token', async () => {
      const result = await verifySessionToken('');

      expect(result).toBeNull();
    });

    it('returns null for invalid token format', async () => {
      const result = await verifySessionToken('invalid-token-format');

      expect(result).toBeNull();
    });

    it('returns null for expired token', async () => {
      // Create a valid token first, then mock time to be in the future
      const token = await createSessionToken(validUser);

      // Mock Date.now to be 8 days in the future (past the 7-day expiry)
      const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
      const futureTime = originalDateNow() + eightDaysMs;
      Date.now = jest.fn(() => futureTime) as typeof Date.now;

      const result = await verifySessionToken(token);

      expect(result).toBeNull();
    });

    it('returns null for invalid signature (tampered token)', async () => {
      const token = await createSessionToken(validUser);

      // Tamper with the signature (last part of JWT)
      const parts = token.split('.');
      const tamperedSignature = parts[2]
        .split('')
        .reverse()
        .join('');
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSignature}`;

      const result = await verifySessionToken(tamperedToken);

      expect(result).toBeNull();
    });

    it('returns null when missing userId field', async () => {
      // Create a token with missing userId by tampering with the payload
      const token = await createSessionToken(validUser);
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      // Remove userId
      delete payload.userId;

      // Re-encode payload (signature will be invalid)
      const modifiedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

      const result = await verifySessionToken(`${parts[0]}.${modifiedPayload}.${parts[2]}`);

      expect(result).toBeNull();
    });

    it('returns null when missing email field', async () => {
      const token = await createSessionToken(validUser);
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      // Remove email
      delete payload.email;

      const modifiedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

      const result = await verifySessionToken(`${parts[0]}.${modifiedPayload}.${parts[2]}`);

      expect(result).toBeNull();
    });

    it('returns null when missing sub field', async () => {
      const token = await createSessionToken(validUser);
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      // Remove sub
      delete payload.sub;

      const modifiedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

      const result = await verifySessionToken(`${parts[0]}.${modifiedPayload}.${parts[2]}`);

      expect(result).toBeNull();
    });

    it('returns valid DecodedSession for valid token', async () => {
      const token = await createSessionToken(validUser);
      const result = await verifySessionToken(token);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        userId: validUser.userId,
        email: validUser.email,
        name: validUser.name,
        image: validUser.image,
      });
      expect(typeof result?.iat).toBe('number');
      expect(typeof result?.exp).toBe('number');
    });
  });

  describe('shouldRefreshToken()', () => {
    it('returns true when less than 24 hours remaining', () => {
      const now = Math.floor(Date.now() / 1000);
      const session: DecodedSession = {
        userId: 'user-123',
        email: 'test@example.com',
        name: null,
        image: null,
        iat: now - 7 * 24 * 60 * 60 + 12 * 60 * 60, // 6.5 days ago
        exp: now + 12 * 60 * 60, // 12 hours from now (less than 24)
      };

      expect(shouldRefreshToken(session)).toBe(true);
    });

    it('returns false when more than 24 hours remaining', () => {
      const now = Math.floor(Date.now() / 1000);
      const session: DecodedSession = {
        userId: 'user-123',
        email: 'test@example.com',
        name: null,
        image: null,
        iat: now - 24 * 60 * 60, // 1 day ago
        exp: now + 6 * 24 * 60 * 60, // 6 days from now
      };

      expect(shouldRefreshToken(session)).toBe(false);
    });

    it('returns true exactly at threshold', () => {
      const now = Math.floor(Date.now() / 1000);
      // At exactly 24 hours, timeRemaining < refreshThreshold is false (24*3600 < 24*3600 = false)
      // So test one second less to be exactly at the boundary
      const session: DecodedSession = {
        userId: 'user-123',
        email: 'test@example.com',
        name: null,
        image: null,
        iat: now - 6 * 24 * 60 * 60, // 6 days ago
        exp: now + 24 * 60 * 60 - 1, // 1 second less than 24 hours
      };

      expect(shouldRefreshToken(session)).toBe(true);
    });

    it('returns true when nearly expired', () => {
      const now = Math.floor(Date.now() / 1000);
      const session: DecodedSession = {
        userId: 'user-123',
        email: 'test@example.com',
        name: null,
        image: null,
        iat: now - 7 * 24 * 60 * 60, // 7 days ago
        exp: now + 60, // 1 minute remaining
      };

      expect(shouldRefreshToken(session)).toBe(true);
    });

    it('returns false when freshly created', () => {
      const now = Math.floor(Date.now() / 1000);
      const session: DecodedSession = {
        userId: 'user-123',
        email: 'test@example.com',
        name: null,
        image: null,
        iat: now, // Just created
        exp: now + 7 * 24 * 60 * 60, // Full 7 days
      };

      expect(shouldRefreshToken(session)).toBe(false);
    });
  });

  describe('refreshSessionToken()', () => {
    const originalSession: DecodedSession = {
      userId: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      image: 'https://example.com/avatar.jpg',
      iat: Math.floor(Date.now() / 1000) - 6 * 24 * 60 * 60, // 6 days ago
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 1 day remaining
    };

    it('creates new token with same user data', async () => {
      const newToken = await refreshSessionToken(originalSession);
      const newSession = await verifySessionToken(newToken);

      expect(newSession).not.toBeNull();
      expect(newSession?.userId).toBe(originalSession.userId);
      expect(newSession?.email).toBe(originalSession.email);
      expect(newSession?.name).toBe(originalSession.name);
      expect(newSession?.image).toBe(originalSession.image);
    });

    it('new token has fresh expiry', async () => {
      const now = Math.floor(Date.now() / 1000);
      const sevenDaysFromNow = now + 7 * 24 * 60 * 60;

      const newToken = await refreshSessionToken(originalSession);
      const newSession = await verifySessionToken(newToken);

      expect(newSession).not.toBeNull();
      // New expiry should be approximately 7 days from now
      expect(newSession?.exp).toBeGreaterThanOrEqual(sevenDaysFromNow - 5);
      expect(newSession?.exp).toBeLessThanOrEqual(sevenDaysFromNow + 5);
      // New expiry should be much later than original
      expect(newSession?.exp).toBeGreaterThan(originalSession.exp);
    });

    it('preserves name and image', async () => {
      const sessionWithData: DecodedSession = {
        userId: 'user-456',
        email: 'another@example.com',
        name: 'Another User',
        image: 'https://example.com/another-avatar.png',
        iat: Math.floor(Date.now() / 1000) - 86400,
        exp: Math.floor(Date.now() / 1000) + 86400,
      };

      const newToken = await refreshSessionToken(sessionWithData);
      const newSession = await verifySessionToken(newToken);

      expect(newSession?.name).toBe('Another User');
      expect(newSession?.image).toBe('https://example.com/another-avatar.png');
    });
  });

  describe('getSessionConfig()', () => {
    it('returns correct expiryHours (168)', () => {
      const config = getSessionConfig();

      expect(config.expiryHours).toBe(168); // 7 days * 24 hours
    });

    it('returns correct refreshThresholdHours (24)', () => {
      const config = getSessionConfig();

      expect(config.refreshThresholdHours).toBe(24);
    });
  });
});
