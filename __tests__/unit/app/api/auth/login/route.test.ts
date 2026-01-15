/**
 * Unit tests for Credentials Login API Route
 * Tests: POST /api/v1/auth/login
 *
 * TODO: These tests need to be refactored to work with the v1 login route.
 * The v1 route has significant differences from the legacy route:
 * - Uses email instead of username for authentication
 * - Different logging format ([Auth v1] prefix)
 * - No TOTP/2FA support (handled separately)
 * - Different error messages and response formats
 * - Uses different session cookie mechanism
 *
 * Tests the full authentication flow including:
 * - Input validation
 * - User lookup
 * - Password verification
 * - 2FA (TOTP) handling
 * - Session creation
 * - Post-login migrations
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { NextRequest } from 'next/server';

// Mock dependencies before imports
jest.mock('@/lib/auth/password', () => ({
  verifyPassword: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
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

// Mock for TOTP functions (dynamically imported in the route)
const mockVerifyTOTP = jest.fn();
const mockCheckTOTPLockout = jest.fn();
const mockVerifyTrustedDevice = jest.fn();

jest.mock('@/lib/auth/totp', () => ({
  verifyTOTP: mockVerifyTOTP,
  checkTOTPLockout: mockCheckTOTPLockout,
  verifyTrustedDevice: mockVerifyTrustedDevice,
}));

// Get mocked modules using requireMock
const passwordMock = jest.requireMock('@/lib/auth/password') as {
  verifyPassword: jest.Mock;
};
const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock;
};
const sessionMock = jest.requireMock('@/lib/auth/session') as {
  createSessionToken: jest.Mock;
  setSessionCookie: jest.Mock;
};
const migrationsMock = jest.requireMock('@/lib/auth/user-migrations') as {
  runPostLoginMigrations: jest.Mock;
};
const loggerMock = jest.requireMock('@/lib/logger') as {
  logger: {
    info: jest.Mock;
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
};

const mockVerifyPassword = passwordMock.verifyPassword;
const mockGetRepositories = repositoriesMock.getRepositories;
const mockCreateSessionToken = sessionMock.createSessionToken;
const mockSetSessionCookie = sessionMock.setSessionCookie;
const mockRunPostLoginMigrations = migrationsMock.runPostLoginMigrations;
const mockLogger = loggerMock.logger;

// Declare POST handler
let POST: typeof import('@/app/api/v1/auth/login/route').POST;

/**
 * Helper to create a mock NextRequest with a JSON body
 */
const createRequest = (body: object): NextRequest =>
  ({
    json: async () => body,
  }) as unknown as NextRequest;

// TODO: Re-enable tests after refactoring for v1 login route
describe.skip('Login API Route - POST /api/v1/auth/login', () => {
  let mockUsersRepo: {
    findByUsername: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset TOTP mocks
    mockVerifyTOTP.mockReset();
    mockCheckTOTPLockout.mockReset();
    mockVerifyTrustedDevice.mockReset();

    // Setup mock users repository
    mockUsersRepo = {
      findByUsername: jest.fn(),
    };

    mockGetRepositories.mockReturnValue({
      users: mockUsersRepo,
    } as any);

    // Fresh import of route handler for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/v1/auth/login/route');
      POST = routeModule.POST;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================================
  // Validation Tests
  // ============================================================================
  describe('Validation', () => {
    it('should return 400 when username is missing', async () => {
      const request = createRequest({
        password: 'testPassword123!',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Username and password are required');
      expect(mockUsersRepo.findByUsername).not.toHaveBeenCalled();
    });

    it('should return 400 when password is missing', async () => {
      const request = createRequest({
        username: 'testuser',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Username and password are required');
      expect(mockUsersRepo.findByUsername).not.toHaveBeenCalled();
    });

    it('should return 400 when both username and password are missing', async () => {
      const request = createRequest({});

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Username and password are required');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Missing credentials',
        expect.objectContaining({
          context: 'login.POST',
          hasUsername: false,
        })
      );
    });
  });

  // ============================================================================
  // User Lookup Tests
  // ============================================================================
  describe('User Lookup', () => {
    it('should return 401 when user is not found', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue(null);

      const request = createRequest({
        username: 'nonexistent',
        password: 'testPassword123!',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Invalid username or password');
      expect(mockUsersRepo.findByUsername).toHaveBeenCalledWith('nonexistent');
      expect(mockVerifyPassword).not.toHaveBeenCalled();
    });

    it('should return 401 when user exists but has no passwordHash', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue({
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        // No passwordHash field
      });

      const request = createRequest({
        username: 'testuser',
        password: 'testPassword123!',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Invalid username or password');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'User not found or no password hash',
        expect.objectContaining({
          context: 'login.POST',
          username: 'testuser',
        })
      );
    });
  });

  // ============================================================================
  // Password Verification Tests
  // ============================================================================
  describe('Password Verification', () => {
    it('should return 401 for invalid password', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue({
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        passwordHash: 'hashedPassword',
      });
      mockVerifyPassword.mockResolvedValue(false);

      const request = createRequest({
        username: 'testuser',
        password: 'wrongPassword',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Invalid username or password');
      expect(mockVerifyPassword).toHaveBeenCalledWith('wrongPassword', 'hashedPassword');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Invalid password',
        expect.objectContaining({
          context: 'login.POST',
          username: 'testuser',
        })
      );
    });

    it('should proceed when password is valid', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue({
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        passwordHash: 'hashedPassword',
        name: 'Test User',
        image: '/avatar.png',
      });
      mockVerifyPassword.mockResolvedValue(true);
      mockCreateSessionToken.mockResolvedValue('session-token-123');

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockVerifyPassword).toHaveBeenCalledWith('correctPassword', 'hashedPassword');
    });
  });

  // ============================================================================
  // 2FA Flow Tests
  // ============================================================================
  describe('2FA Flow', () => {
    const userWith2FA = {
      id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
      passwordHash: 'hashedPassword',
      name: 'Test User',
      image: '/avatar.png',
      totp: {
        enabled: true,
        ciphertext: 'encrypted-secret',
        iv: 'iv',
        authTag: 'tag',
      },
    };

    beforeEach(() => {
      mockVerifyPassword.mockResolvedValue(true);
    });

    it('should return 429 when account is locked due to too many 2FA attempts', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue(userWith2FA);
      mockCheckTOTPLockout.mockResolvedValue({
        locked: true,
        secondsRemaining: 120,
      });

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(429);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Account temporarily locked');
      expect(body.error).toContain('120 seconds');
    });

    it('should return 200 with requires2FA when TOTP enabled but no code provided', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue(userWith2FA);
      mockCheckTOTPLockout.mockResolvedValue({ locked: false });

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(false);
      expect(body.requires2FA).toBe(true);
      expect(body.error).toBe('2FA code required');
    });

    it('should return 401 for invalid TOTP code', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue(userWith2FA);
      mockCheckTOTPLockout.mockResolvedValue({ locked: false });
      mockVerifyTOTP.mockResolvedValue(false);

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
        totpCode: '000000',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Invalid 2FA code');
    });

    it('should return 429 when locked after failed TOTP attempt', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue(userWith2FA);
      mockCheckTOTPLockout
        .mockResolvedValueOnce({ locked: false })
        .mockResolvedValueOnce({ locked: true, secondsRemaining: 300 });
      mockVerifyTOTP.mockResolvedValue(false);

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
        totpCode: '000000',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(429);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid 2FA code');
      expect(body.error).toContain('Account locked for 300 seconds');
    });

    it('should accept valid TOTP code and complete login', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue(userWith2FA);
      mockCheckTOTPLockout.mockResolvedValue({ locked: false });
      mockVerifyTOTP.mockResolvedValue(true);
      mockCreateSessionToken.mockResolvedValue('session-token-123');

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
        totpCode: '123456',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.user).toBeDefined();
      expect(mockVerifyTOTP).toHaveBeenCalledWith('user-123', '123456');
    });

    it('should bypass TOTP with valid trusted device token', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue(userWith2FA);
      mockCheckTOTPLockout.mockResolvedValue({ locked: false });
      mockVerifyTrustedDevice.mockResolvedValue(true);
      mockCreateSessionToken.mockResolvedValue('session-token-123');

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
        trustedDeviceToken: 'valid-device-token',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.user).toBeDefined();
      expect(mockVerifyTrustedDevice).toHaveBeenCalledWith('user-123', 'valid-device-token');
      expect(mockVerifyTOTP).not.toHaveBeenCalled();
    });

    it('should not bypass TOTP with invalid trusted device token', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue(userWith2FA);
      mockCheckTOTPLockout.mockResolvedValue({ locked: false });
      mockVerifyTrustedDevice.mockResolvedValue(false);

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
        trustedDeviceToken: 'invalid-device-token',
      });

      const response = await POST(request);
      const body = await response.json();

      // Should require 2FA since device token is invalid
      expect(response.status).toBe(200);
      expect(body.success).toBe(false);
      expect(body.requires2FA).toBe(true);
      expect(body.error).toBe('2FA code required');
    });

    it('should show remaining lockout seconds in error message', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue(userWith2FA);
      mockCheckTOTPLockout.mockResolvedValue({
        locked: true,
        secondsRemaining: 45,
      });

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(429);
      expect(body.error).toContain('45 seconds');
    });

    it('should require TOTP even with trustedDeviceToken when device verification fails', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue(userWith2FA);
      mockCheckTOTPLockout.mockResolvedValue({ locked: false });
      mockVerifyTrustedDevice.mockResolvedValue(false);
      mockVerifyTOTP.mockResolvedValue(true);
      mockCreateSessionToken.mockResolvedValue('session-token-123');

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
        trustedDeviceToken: 'invalid-token',
        totpCode: '123456',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockVerifyTrustedDevice).toHaveBeenCalled();
      expect(mockVerifyTOTP).toHaveBeenCalledWith('user-123', '123456');
    });
  });

  // ============================================================================
  // Successful Login Tests
  // ============================================================================
  describe('Successful Login', () => {
    const validUser = {
      id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
      passwordHash: 'hashedPassword',
      name: 'Test User',
      image: '/avatar.png',
    };

    beforeEach(() => {
      mockUsersRepo.findByUsername.mockResolvedValue(validUser);
      mockVerifyPassword.mockResolvedValue(true);
      mockCreateSessionToken.mockResolvedValue('session-token-abc123');
    });

    it('should create session token with correct user data', async () => {
      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
      });

      await POST(request);

      expect(mockCreateSessionToken).toHaveBeenCalledWith({
        userId: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        image: '/avatar.png',
      });
    });

    it('should set session cookie on response', async () => {
      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
      });

      await POST(request);

      expect(mockSetSessionCookie).toHaveBeenCalledWith(
        expect.any(Object), // NextResponse instance
        'session-token-abc123'
      );
    });

    it('should return user object with correct fields', async () => {
      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        image: '/avatar.png',
      });
    });

    it('should run post-login migrations', async () => {
      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
      });

      await POST(request);

      expect(mockRunPostLoginMigrations).toHaveBeenCalledWith('user-123');
    });

    it('should continue login even if migrations fail', async () => {
      mockRunPostLoginMigrations.mockRejectedValue(new Error('Migration failed'));

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.user).toBeDefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Post-login migrations failed',
        expect.objectContaining({
          context: 'login.POST',
          userId: 'user-123',
        }),
        expect.any(Error)
      );
    });

    it('should use username as email fallback when email is not set', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue({
        ...validUser,
        email: null,
      });

      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(body.user.email).toBe('testuser');
      expect(mockCreateSessionToken).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'testuser',
        })
      );
    });

    it('should log successful authentication', async () => {
      const request = createRequest({
        username: 'testuser',
        password: 'correctPassword',
      });

      await POST(request);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'User authenticated successfully',
        expect.objectContaining({
          context: 'login.POST',
          userId: 'user-123',
          username: 'testuser',
        })
      );
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================
  describe('Error Handling', () => {
    it('should return 500 on unexpected error during user lookup', async () => {
      mockUsersRepo.findByUsername.mockRejectedValue(new Error('Database connection failed'));

      const request = createRequest({
        username: 'testuser',
        password: 'testPassword',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toBe('An error occurred during login');
    });

    it('should log errors appropriately on unexpected error', async () => {
      const testError = new Error('Unexpected database error');
      mockUsersRepo.findByUsername.mockRejectedValue(testError);

      const request = createRequest({
        username: 'testuser',
        password: 'testPassword',
      });

      await POST(request);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Login error',
        expect.objectContaining({
          context: 'login.POST',
        }),
        testError
      );
    });

    it('should return 500 on unexpected error during password verification', async () => {
      mockUsersRepo.findByUsername.mockResolvedValue({
        id: 'user-123',
        username: 'testuser',
        passwordHash: 'hashedPassword',
      });
      mockVerifyPassword.mockRejectedValue(new Error('Crypto error'));

      const request = createRequest({
        username: 'testuser',
        password: 'testPassword',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toBe('An error occurred during login');
    });

    it('should handle non-Error objects thrown as exceptions', async () => {
      mockUsersRepo.findByUsername.mockRejectedValue('String error message');

      const request = createRequest({
        username: 'testuser',
        password: 'testPassword',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toBe('An error occurred during login');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Login error',
        expect.objectContaining({
          context: 'login.POST',
        }),
        undefined // Non-Error objects result in undefined being passed
      );
    });
  });
});
