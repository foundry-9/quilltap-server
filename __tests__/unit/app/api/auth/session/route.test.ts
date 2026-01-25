/**
 * Unit tests for Session API Route
 * Tests: GET /api/v1/auth/session
 *
 * Tests the session endpoint that returns the current session for authenticated users.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import type { ExtendedSession } from '@/lib/auth/session';

// Mock NextResponse for unit tests
class MockNextResponse {
  status: number;
  private body: string;

  constructor(body: string, init?: { status?: number }) {
    this.body = body;
    this.status = init?.status ?? 200;
  }

  async json() {
    return JSON.parse(this.body);
  }

  static json(data: unknown, init?: { status?: number }) {
    return new MockNextResponse(JSON.stringify(data), init);
  }
}

jest.mock('next/server', () => ({
  NextResponse: MockNextResponse,
}));

// Mock dependencies
jest.mock('@/lib/auth/session', () => ({
  getServerSession: jest.fn(),
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

// Import mocked functions after mocking
import { getServerSession } from '@/lib/auth/session';

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;

// Get the mocked logger module
const loggerMock = jest.requireMock('@/lib/logger') as {
  logger: {
    info: jest.Mock;
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
};
const mockLogger = loggerMock.logger;

// Handler function reference
let GET: typeof import('@/app/api/v1/auth/session/route').GET;

// Mock session data
const mockSession: ExtendedSession = {
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    image: 'https://example.com/image.jpg',
  },
  expires: '2024-01-08T00:00:00.000Z',
};

describe('Session API Route - GET /api/v1/auth/session', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Re-import the route module to reset state
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/v1/auth/session/route');
      GET = routeModule.GET;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================================
  // No Session Tests
  // ============================================================================
  describe('No Session', () => {
    it('should return { user: null, expires: null } when getServerSession returns null', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        user: null,
        expires: null,
      });
    });

  });

  // ============================================================================
  // Valid Session Tests
  // ============================================================================
  describe('Valid Session', () => {
    it('should return user object from session', async () => {
      mockGetServerSession.mockResolvedValue(mockSession);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.user).toEqual(mockSession.user);
    });

    it('should return expires from session', async () => {
      mockGetServerSession.mockResolvedValue(mockSession);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.expires).toBe(mockSession.expires);
    });

    it('should return correct SessionResponse shape', async () => {
      mockGetServerSession.mockResolvedValue(mockSession);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        user: mockSession.user,
        expires: mockSession.expires,
      });
      expect(Object.keys(body)).toHaveLength(2);
      expect(body).toHaveProperty('user');
      expect(body).toHaveProperty('expires');
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================
  describe('Error Handling', () => {
    it('should return { user: null, expires: null } on error', async () => {
      mockGetServerSession.mockRejectedValue(new Error('Session fetch failed'));

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        user: null,
        expires: null,
      });
    });

    it('should log error appropriately when exception occurs', async () => {
      const testError = new Error('Database connection lost');
      mockGetServerSession.mockRejectedValue(testError);

      await GET();

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[Auth v1] Error checking session',
        {},
        testError
      );
    });

    it('should not throw to caller when an error occurs', async () => {
      mockGetServerSession.mockRejectedValue(new Error('Unexpected error'));

      // Should not throw
      await expect(GET()).resolves.toBeDefined();
    });
  });

  // ============================================================================
  // User Object Shape Tests
  // ============================================================================
  describe('User Object Shape', () => {
    it('should include id, email, name, image in user response', async () => {
      mockGetServerSession.mockResolvedValue(mockSession);

      const response = await GET();
      const body = await response.json();

      expect(body.user).toHaveProperty('id', 'user-123');
      expect(body.user).toHaveProperty('email', 'test@example.com');
      expect(body.user).toHaveProperty('name', 'Test User');
      expect(body.user).toHaveProperty('image', 'https://example.com/image.jpg');
    });

    it('should handle session with optional fields as null', async () => {
      const sessionWithNulls: ExtendedSession = {
        user: {
          id: 'user-456',
          email: 'minimal@example.com',
          name: null,
          image: null,
        },
        expires: '2024-02-15T12:00:00.000Z',
      };
      mockGetServerSession.mockResolvedValue(sessionWithNulls);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.user.id).toBe('user-456');
      expect(body.user.email).toBe('minimal@example.com');
      expect(body.user.name).toBeNull();
      expect(body.user.image).toBeNull();
    });
  });
});
