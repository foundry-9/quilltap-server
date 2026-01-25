/**
 * Unit Tests for Arctic OAuth State Management
 * Tests lib/auth/arctic/state.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NextRequest, NextResponse } from 'next/server';

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock Next.js cookies
const mockCookies = new Map<string, { value: string; options: any }>();
const mockCookieStore = {
  get: jest.fn((name: string) => {
    const cookie = mockCookies.get(name);
    return cookie ? { name, value: cookie.value } : undefined;
  }),
  set: jest.fn((name: string, value: string, options: any) => {
    mockCookies.set(name, { value, options });
  }),
};

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve(mockCookieStore)),
}));

// Mock Arctic functions
jest.mock('arctic', () => ({
  generateState: jest.fn(() => 'test-state-token'),
  generateCodeVerifier: jest.fn(() => 'test-code-verifier'),
}));

// Mock crypto for encryption
const mockEncrypt = jest.fn((value: string) => `encrypted:${value}`);
const mockDecrypt = jest.fn((encrypted: string) => {
  if (encrypted.startsWith('encrypted:')) {
    return encrypted.replace('encrypted:', '');
  }
  return null;
});

// We need to mock crypto at module level before importing state
let originalProcessEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalProcessEnv = process.env;
  process.env = { 
    ...originalProcessEnv, 
    ENCRYPTION_MASTER_PEPPER: 'test-pepper-12345' 
  };
});

// Import after mocks are set up
const {
  generateOAuthState,
  retrieveOAuthState,
  clearOAuthState,
  clearOAuthStateFromAction,
} = require('@/lib/auth/arctic/state') as typeof import('@/lib/auth/arctic/state');

describe('Arctic OAuth State Management', () => {
  let mockRequest: NextRequest;
  let mockResponse: NextResponse;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCookies.clear();
    
    // Create mock request
    mockRequest = {
      cookies: {
        get: jest.fn((name: string) => {
          const cookie = mockCookies.get(name);
          return cookie ? { name, value: cookie.value } : undefined;
        }),
      },
    } as unknown as NextRequest;

    // Create mock response with cookies API
    const responseCookies = new Map<string, { value: string; options: any }>();
    mockResponse = {
      cookies: {
        set: jest.fn((name: string, value: string, options: any) => {
          responseCookies.set(name, { value, options });
          mockCookies.set(name, { value, options }); // Also update global for retrieval
        }),
        get: jest.fn((name: string) => {
          const cookie = responseCookies.get(name);
          return cookie ? { name, value: cookie.value } : undefined;
        }),
      },
    } as unknown as NextResponse;
  });

  describe('generateOAuthState', () => {
    it('generates state and code verifier', () => {
      const result = generateOAuthState(mockResponse, '/dashboard');

      expect(result.state).toBe('test-state-token');
      expect(result.codeVerifier).toBe('test-code-verifier');
      expect(result.callbackUrl).toBe('/dashboard');
    });

    it('defaults callback URL to /', () => {
      const result = generateOAuthState(mockResponse);

      expect(result.callbackUrl).toBe('/');
    });

    it('sets encrypted state cookie', () => {
      generateOAuthState(mockResponse, '/dashboard');

      expect(mockResponse.cookies.set).toHaveBeenCalledWith(
        'qt_oauth_state',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 600, // 10 minutes
        })
      );
    });

    it('sets encrypted verifier cookie', () => {
      generateOAuthState(mockResponse, '/dashboard');

      expect(mockResponse.cookies.set).toHaveBeenCalledWith(
        'qt_oauth_verifier',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
        })
      );
    });

    it('sets encrypted callback cookie', () => {
      generateOAuthState(mockResponse, '/dashboard');

      expect(mockResponse.cookies.set).toHaveBeenCalledWith(
        'qt_oauth_callback',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
        })
      );
    });

    it('uses secure cookies in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      generateOAuthState(mockResponse, '/');

      expect(mockResponse.cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ secure: true })
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('uses non-secure cookies in development', () => {
      process.env.NODE_ENV = 'development';

      generateOAuthState(mockResponse, '/');

      expect(mockResponse.cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ secure: false })
      );
    });

  });

  describe('retrieveOAuthState', () => {
    beforeEach(() => {
      // Set up real encrypted cookies by generating state first
      generateOAuthState(mockResponse, '/dashboard');
    });

    it('retrieves and validates state successfully', () => {
      const result = retrieveOAuthState(mockRequest, 'test-state-token');

      expect(result).toEqual({
        codeVerifier: 'test-code-verifier',
        callbackUrl: '/dashboard',
      });
    });

    it('defaults to / when callback cookie missing', () => {
      // Regenerate with default callback
      jest.clearAllMocks();
      mockCookies.clear();
      generateOAuthState(mockResponse);

      const result = retrieveOAuthState(mockRequest, 'test-state-token');

      expect(result?.callbackUrl).toBe('/');
    });

    it('returns null when state cookie missing', () => {
      mockCookies.delete('qt_oauth_state');
      // Regenerate request with missing cookie
      mockRequest = {
        cookies: {
          get: jest.fn((name: string) => {
            const cookie = mockCookies.get(name);
            return cookie ? { name, value: cookie.value } : undefined;
          }),
        },
      } as unknown as NextRequest;

      const result = retrieveOAuthState(mockRequest, 'test-state-token');

      expect(result).toBeNull();
    });

    it('returns null when verifier cookie missing', () => {
      mockCookies.delete('qt_oauth_verifier');
      mockRequest = {
        cookies: {
          get: jest.fn((name: string) => {
            const cookie = mockCookies.get(name);
            return cookie ? { name, value: cookie.value } : undefined;
          }),
        },
      } as unknown as NextRequest;

      const result = retrieveOAuthState(mockRequest, 'test-state-token');

      expect(result).toBeNull();
    });

    it('returns null when state does not match', () => {
      const result = retrieveOAuthState(mockRequest, 'wrong-state-token');

      expect(result).toBeNull();
    });

    it('logs warning on state mismatch', () => {
      const { logger } = require('@/lib/logger');

      retrieveOAuthState(mockRequest, 'wrong-state');

      expect(logger.warn).toHaveBeenCalledWith(
        'OAuth state mismatch',
        expect.any(Object)
      );
    });

    it('returns null when decryption fails', () => {
      // Set invalid encrypted data
      mockCookies.set('qt_oauth_state', { value: 'invalid', options: {} });
      mockRequest = {
        cookies: {
          get: jest.fn((name: string) => {
            const cookie = mockCookies.get(name);
            return cookie ? { name, value: cookie.value } : undefined;
          }),
        },
      } as unknown as NextRequest;

      const result = retrieveOAuthState(mockRequest, 'test-state-token');

      expect(result).toBeNull();
    });

    it('handles empty callback value', () => {
      jest.clearAllMocks();
      mockCookies.clear();
      // Generate without callback
      generateOAuthState(mockResponse);

      const result = retrieveOAuthState(mockRequest, 'test-state-token');

      expect(result?.callbackUrl).toBe('/');
    });
  });

  describe('clearOAuthState', () => {
    it('clears all OAuth cookies', () => {
      clearOAuthState(mockResponse);

      expect(mockResponse.cookies.set).toHaveBeenCalledWith(
        'qt_oauth_state',
        '',
        expect.objectContaining({ maxAge: 0 })
      );
      expect(mockResponse.cookies.set).toHaveBeenCalledWith(
        'qt_oauth_verifier',
        '',
        expect.objectContaining({ maxAge: 0 })
      );
      expect(mockResponse.cookies.set).toHaveBeenCalledWith(
        'qt_oauth_callback',
        '',
        expect.objectContaining({ maxAge: 0 })
      );
    });

    it('maintains other cookie options when clearing', () => {
      clearOAuthState(mockResponse);

      expect(mockResponse.cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        '',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
        })
      );
    });

  });

  describe('clearOAuthStateFromAction', () => {
    it('clears all OAuth cookies using cookies() API', async () => {
      await clearOAuthStateFromAction();

      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'qt_oauth_state',
        '',
        expect.objectContaining({ maxAge: 0 })
      );
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'qt_oauth_verifier',
        '',
        expect.objectContaining({ maxAge: 0 })
      );
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'qt_oauth_callback',
        '',
        expect.objectContaining({ maxAge: 0 })
      );
    });

  });

  describe('encryption', () => {
    it('encrypts values before storing in cookies', () => {
      generateOAuthState(mockResponse, '/dashboard');

      const stateCookie = mockCookies.get('qt_oauth_state');
      expect(stateCookie?.value).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
    });

    it('handles encryption with empty pepper gracefully', () => {
      process.env.ENCRYPTION_MASTER_PEPPER = '';

      const result = generateOAuthState(mockResponse, '/');

      expect(result.state).toBe('test-state-token');
    });
  });

  describe('cookie expiry', () => {
    it('sets 10 minute expiry on OAuth cookies', () => {
      generateOAuthState(mockResponse, '/');

      expect(mockResponse.cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ maxAge: 600 })
      );
    });

    it('sets maxAge to 0 when clearing cookies', () => {
      clearOAuthState(mockResponse);

      expect(mockResponse.cookies.set).toHaveBeenCalledWith(
        expect.any(String),
        '',
        expect.objectContaining({ maxAge: 0 })
      );
    });
  });
});
