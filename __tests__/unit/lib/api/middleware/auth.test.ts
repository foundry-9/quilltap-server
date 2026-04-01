/**
 * Unit Tests for API Auth Middleware
 * Tests lib/api/middleware/auth.ts
 * v2.7-dev: Authentication wrapper middleware
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies before importing
jest.mock('@/lib/auth/session');
jest.mock('@/lib/repositories/factory');

const {
  withAuth,
  withAuthParams,
  createAuthenticatedHandler,
  createAuthenticatedParamsHandler,
  checkOwnership,
} = require('@/lib/api/middleware/auth');

const { getServerSession } = require('@/lib/auth/session');
const { getRepositoriesSafe } = require('@/lib/repositories/factory');

const mockGetServerSession = jest.mocked(getServerSession);
const mockGetRepositoriesSafe = jest.mocked(getRepositoriesSafe);

describe('API Auth Middleware', () => {
  let mockRepos: any;
  let mockUser: any;
  let mockSession: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      username: 'testuser',
    };

    mockSession = {
      user: {
        id: 'user-123',
        email: 'test@example.com',
      },
    };

    mockRepos = {
      users: {
        findById: jest.fn().mockResolvedValue(mockUser),
      },
      characters: {
        findById: jest.fn(),
      },
    };

    mockGetServerSession.mockResolvedValue(mockSession);
    mockGetRepositoriesSafe.mockResolvedValue(mockRepos);
  });

  describe('withAuth', () => {
    it('should call handler with authenticated context', async () => {
      const handler = jest.fn().mockResolvedValue(NextResponse.json({ success: true }));
      const response = await withAuth(handler);

      expect(mockGetServerSession).toHaveBeenCalled();
      expect(mockGetRepositoriesSafe).toHaveBeenCalled();
      expect(mockRepos.users.findById).toHaveBeenCalledWith('user-123');
      expect(handler).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          user: mockUser,
          repos: mockRepos,
          session: mockSession,
        })
      );

      const body = await response.json();
      expect(body).toEqual({ success: true });
    });

    it('should return 401 when no session', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const handler = jest.fn();

      const response = await withAuth(handler);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({ error: 'Unauthorized' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 401 when session missing user ID', async () => {
      mockGetServerSession.mockResolvedValue({ user: {} });
      const handler = jest.fn();

      const response = await withAuth(handler);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({ error: 'Unauthorized' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 404 when user not found in database', async () => {
      mockRepos.users.findById.mockResolvedValue(null);
      const handler = jest.fn();

      const response = await withAuth(handler);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toEqual({ error: 'User not found' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should propagate handler errors', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Handler error'));

      await expect(withAuth(handler)).rejects.toThrow('Handler error');
    });
  });

  describe('withAuthParams', () => {
    it('should call handler with params and authenticated context', async () => {
      const request = new NextRequest('https://example.com/api/characters/char-1');
      const params = { id: 'char-1' };
      const handler = jest.fn().mockResolvedValue(NextResponse.json({ id: 'char-1' }));

      const response = await withAuthParams(request, params, handler);

      expect(handler).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          user: mockUser,
          repos: mockRepos,
          session: mockSession,
        }),
        params
      );

      const body = await response.json();
      expect(body).toEqual({ id: 'char-1' });
    });

    it('should return 401 when no session with params', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const request = new NextRequest('https://example.com/api/test');
      const params = { id: 'test-1' };
      const handler = jest.fn();

      const response = await withAuthParams(request, params, handler);

      expect(response.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 404 when user not found with params', async () => {
      mockRepos.users.findById.mockResolvedValue(null);
      const request = new NextRequest('https://example.com/api/test');
      const params = { id: 'test-1' };
      const handler = jest.fn();

      const response = await withAuthParams(request, params, handler);

      expect(response.status).toBe(404);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle multiple params', async () => {
      const request = new NextRequest('https://example.com/api/test');
      const params = { id: 'char-1', action: 'favorite' };
      const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));

      await withAuthParams(request, params, handler);

      expect(handler).toHaveBeenCalledWith(
        request,
        expect.anything(),
        params
      );
    });
  });

  describe('createAuthenticatedHandler', () => {
    it('should create handler that authenticates and calls inner handler', async () => {
      const innerHandler = jest.fn().mockResolvedValue(
        NextResponse.json({ data: 'test' })
      );
      const handler = createAuthenticatedHandler(innerHandler);
      const request = new NextRequest('https://example.com/api/test');

      const response = await handler(request);

      expect(mockGetServerSession).toHaveBeenCalled();
      expect(mockRepos.users.findById).toHaveBeenCalledWith('user-123');
      expect(innerHandler).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          user: mockUser,
          repos: mockRepos,
          session: mockSession,
        })
      );

      const body = await response.json();
      expect(body).toEqual({ data: 'test' });
    });

    it('should return 401 for unauthenticated request', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const innerHandler = jest.fn();
      const handler = createAuthenticatedHandler(innerHandler);
      const request = new NextRequest('https://example.com/api/test');

      const response = await handler(request);

      expect(response.status).toBe(401);
      expect(innerHandler).not.toHaveBeenCalled();
    });

    it('should be usable as Next.js route handler', async () => {
      // This is the pattern used in actual routes:
      // export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {...})
      const handler = createAuthenticatedHandler(async (req, { user, repos }) => {
        return NextResponse.json({ userId: user.id });
      });

      const request = new NextRequest('https://example.com/api/test');
      const response = await handler(request);

      const body = await response.json();
      expect(body).toEqual({ userId: 'user-123' });
    });
  });

  describe('createAuthenticatedParamsHandler', () => {
    it('should create handler that authenticates with params', async () => {
      const innerHandler = jest.fn().mockResolvedValue(
        NextResponse.json({ id: 'char-1' })
      );
      const handler = createAuthenticatedParamsHandler<{ id: string }>(innerHandler);
      const request = new NextRequest('https://example.com/api/characters/char-1');
      const context = { params: Promise.resolve({ id: 'char-1' }) };

      const response = await handler(request, context);

      expect(innerHandler).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          user: mockUser,
          repos: mockRepos,
        }),
        { id: 'char-1' }
      );

      const body = await response.json();
      expect(body).toEqual({ id: 'char-1' });
    });

    it('should await params promise before processing', async () => {
      let resolveParams: any;
      const paramsPromise = new Promise<{ id: string }>((resolve) => {
        resolveParams = resolve;
      });

      const innerHandler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));
      const handler = createAuthenticatedParamsHandler(innerHandler);
      const request = new NextRequest('https://example.com/api/test');
      const context = { params: paramsPromise };

      const responsePromise = handler(request, context);

      // Handler shouldn't be called yet
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(innerHandler).not.toHaveBeenCalled();

      // Resolve params
      resolveParams({ id: 'test-1' });
      await responsePromise;

      expect(innerHandler).toHaveBeenCalledWith(
        request,
        expect.anything(),
        { id: 'test-1' }
      );
    });

    it('should return 401 before awaiting params if no session', async () => {
      mockGetServerSession.mockResolvedValue(null);
      
      const innerHandler = jest.fn();
      const handler = createAuthenticatedParamsHandler(innerHandler);
      const request = new NextRequest('https://example.com/api/test');
      const context = { params: Promise.resolve({ id: 'test-1' }) };

      const response = await handler(request, context);

      expect(response.status).toBe(401);
      expect(innerHandler).not.toHaveBeenCalled();
    });

    it('should be usable as Next.js route handler with params', async () => {
      // Pattern: export const GET = createAuthenticatedParamsHandler<{ id: string }>(...)
      const handler = createAuthenticatedParamsHandler<{ id: string }>(
        async (req, { user }, { id }) => {
          return NextResponse.json({ userId: user.id, characterId: id });
        }
      );

      const request = new NextRequest('https://example.com/api/characters/char-1');
      const context = { params: Promise.resolve({ id: 'char-1' }) };
      const response = await handler(request, context);

      const body = await response.json();
      expect(body).toEqual({ userId: 'user-123', characterId: 'char-1' });
    });
  });

  describe('checkOwnership', () => {
    const userId = 'user-123';

    it('should return true for resource owned by user', () => {
      const resource = { id: 'res-1', userId: 'user-123', name: 'Test' };
      expect(checkOwnership(resource, userId)).toBe(true);
    });

    it('should return false for resource owned by different user', () => {
      const resource = { id: 'res-1', userId: 'user-456', name: 'Test' };
      expect(checkOwnership(resource, userId)).toBe(false);
    });

    it('should return false for null resource', () => {
      expect(checkOwnership(null, userId)).toBe(false);
    });

    it('should return false for undefined resource', () => {
      expect(checkOwnership(undefined, userId)).toBe(false);
    });

    it('should return false for resource without userId', () => {
      const resource = { id: 'res-1', name: 'Test' };
      expect(checkOwnership(resource, userId)).toBe(false);
    });

    it('should work as type guard', () => {
      const resource: { id: string; userId?: string } | null = {
        id: 'res-1',
        userId: 'user-123',
      };

      if (checkOwnership(resource, userId)) {
        // TypeScript should know resource is not null and has userId
        expect(resource.userId).toBe('user-123');
      }
    });
  });
});
