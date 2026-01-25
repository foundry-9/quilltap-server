/**
 * Unit Tests for Arctic OAuth Registry
 * Tests lib/auth/arctic/registry.ts
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { ArcticProviderPlugin, ArcticProviderInstance, ArcticUserInfo } from '@/lib/auth/arctic/types';

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import after mocking
const {
  registerArcticProvider,
  unregisterArcticProvider,
  getAllArcticProviders,
  getArcticProviderPlugin,
  getArcticProvider,
  fetchProviderUserInfo,
  getProviderScopes,
  getConfiguredArcticProviders,
  getArcticProviderConfigs,
  clearArcticProviders,
  refreshArcticProviderStatus,
} = require('@/lib/auth/arctic/registry') as typeof import('@/lib/auth/arctic/registry');

// Test fixtures
const createMockProvider = (providerId: string, isConfigured = true): ArcticProviderPlugin => ({
  config: {
    providerId,
    displayName: `${providerId} Provider`,
    icon: `${providerId}-icon`,
    requiredEnvVars: [`${providerId.toUpperCase()}_CLIENT_ID`, `${providerId.toUpperCase()}_CLIENT_SECRET`],
    scopes: ['email', 'profile'],
    buttonColor: '#4285f4',
    buttonTextColor: '#ffffff',
  },
  createArcticProvider: jest.fn(() => ({
    createAuthorizationURL: jest.fn((state: string, verifier: string, scopes: string[]) => 
      new URL(`https://${providerId}.com/oauth/authorize`)
    ),
    validateAuthorizationCode: jest.fn(),
  } as unknown as ArcticProviderInstance)),
  fetchUserInfo: jest.fn(async (accessToken: string) => ({
    id: `${providerId}-user-123`,
    email: `user@${providerId}.com`,
    name: `${providerId} User`,
    image: `https://${providerId}.com/avatar.jpg`,
  } as ArcticUserInfo)),
  getScopes: jest.fn(() => ['email', 'profile']),
  isConfigured: jest.fn(() => isConfigured),
  getConfigStatus: jest.fn(() => ({
    isConfigured,
    missingVars: isConfigured ? [] : [`${providerId.toUpperCase()}_CLIENT_ID`],
  })),
});

describe('Arctic OAuth Registry', () => {
  beforeEach(() => {
    clearArcticProviders();
    jest.clearAllMocks();
  });

  afterEach(() => {
    clearArcticProviders();
  });

  describe('registerArcticProvider', () => {
    it('registers a new provider', () => {
      const provider = createMockProvider('google');
      
      registerArcticProvider(provider);
      
      const registered = getArcticProviderPlugin('google');
      expect(registered).toBe(provider);
    });

    it('warns when replacing existing provider', () => {
      const provider1 = createMockProvider('google');
      const provider2 = createMockProvider('google');
      const { logger } = require('@/lib/logger');
      
      registerArcticProvider(provider1);
      registerArcticProvider(provider2);
      
      expect(logger.warn).toHaveBeenCalledWith(
        'Arctic provider already registered, replacing',
        expect.objectContaining({ providerId: 'google' })
      );
    });

    it('clears cached instance when replacing provider', () => {
      const provider1 = createMockProvider('google');
      const provider2 = createMockProvider('google');
      
      registerArcticProvider(provider1);
      getArcticProvider('google'); // Cache the instance
      registerArcticProvider(provider2);
      const instance = getArcticProvider('google');
      
      // Should call createArcticProvider from provider2
      expect(provider2.createArcticProvider).toHaveBeenCalled();
    });

    it('logs provider registration with config status', () => {
      const provider = createMockProvider('github');
      const { logger } = require('@/lib/logger');
      
      registerArcticProvider(provider);
      
      expect(logger.info).toHaveBeenCalledWith(
        'Arctic provider registered',
        expect.objectContaining({
          providerId: 'github',
          displayName: 'github Provider',
          isConfigured: true,
        })
      );
    });
  });

  describe('unregisterArcticProvider', () => {
    it('removes registered provider', () => {
      const provider = createMockProvider('google');
      
      registerArcticProvider(provider);
      unregisterArcticProvider('google');
      
      const result = getArcticProviderPlugin('google');
      expect(result).toBeNull();
    });

    it('clears cached provider instance', () => {
      const provider = createMockProvider('google');
      
      registerArcticProvider(provider);
      getArcticProvider('google'); // Cache instance
      unregisterArcticProvider('google');
      registerArcticProvider(provider);
      const instance = getArcticProvider('google');
      
      // Should create new instance
      expect(provider.createArcticProvider).toHaveBeenCalledTimes(2);
    });

    it('handles unregistering non-existent provider gracefully', () => {
      unregisterArcticProvider('nonexistent');
      
      // Should not throw
      expect(getArcticProviderPlugin('nonexistent')).toBeNull();
    });
  });

  describe('getAllArcticProviders', () => {
    it('returns all registered providers', () => {
      const google = createMockProvider('google');
      const github = createMockProvider('github');
      
      registerArcticProvider(google);
      registerArcticProvider(github);
      
      const all = getAllArcticProviders();
      expect(all.size).toBe(2);
      expect(all.get('google')).toBe(google);
      expect(all.get('github')).toBe(github);
    });

    it('returns empty map when no providers registered', () => {
      const all = getAllArcticProviders();
      expect(all.size).toBe(0);
    });

    it('returns a new Map instance (not reference)', () => {
      const google = createMockProvider('google');
      registerArcticProvider(google);
      
      const all1 = getAllArcticProviders();
      const all2 = getAllArcticProviders();
      
      expect(all1).not.toBe(all2);
    });
  });

  describe('getArcticProviderPlugin', () => {
    it('returns provider when found', () => {
      const provider = createMockProvider('google');
      registerArcticProvider(provider);
      
      const result = getArcticProviderPlugin('google');
      expect(result).toBe(provider);
    });

    it('returns null when provider not found', () => {
      const result = getArcticProviderPlugin('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getArcticProvider', () => {
    it('creates and returns provider instance', () => {
      const provider = createMockProvider('google');
      registerArcticProvider(provider);
      
      const instance = getArcticProvider('google');
      
      expect(instance).not.toBeNull();
      expect(provider.createArcticProvider).toHaveBeenCalled();
    });

    it('caches provider instance on subsequent calls', () => {
      const provider = createMockProvider('google');
      registerArcticProvider(provider);
      
      const instance1 = getArcticProvider('google');
      const instance2 = getArcticProvider('google');
      
      expect(instance1).toBe(instance2);
      expect(provider.createArcticProvider).toHaveBeenCalledTimes(1);
    });

    it('returns null when provider not registered', () => {
      const instance = getArcticProvider('nonexistent');
      
      expect(instance).toBeNull();
    });

    it('returns null when provider not configured', () => {
      const provider = createMockProvider('google', false);
      registerArcticProvider(provider);
      
      const instance = getArcticProvider('google');
      
      expect(instance).toBeNull();
    });

    it('returns null when createArcticProvider returns null', () => {
      const provider = createMockProvider('google');
      (provider.createArcticProvider as jest.Mock).mockReturnValue(null);
      registerArcticProvider(provider);
      
      const instance = getArcticProvider('google');
      
      expect(instance).toBeNull();
    });
  });

  describe('fetchProviderUserInfo', () => {
    it('fetches user info from provider', async () => {
      const provider = createMockProvider('google');
      registerArcticProvider(provider);
      
      const userInfo = await fetchProviderUserInfo('google', 'access-token-123');
      
      expect(userInfo).toEqual({
        id: 'google-user-123',
        email: 'user@google.com',
        name: 'google User',
        image: 'https://google.com/avatar.jpg',
      });
      expect(provider.fetchUserInfo).toHaveBeenCalledWith('access-token-123');
    });

    it('returns null when provider not found', async () => {
      const userInfo = await fetchProviderUserInfo('nonexistent', 'token');
      
      expect(userInfo).toBeNull();
    });

    it('returns null on fetch error', async () => {
      const provider = createMockProvider('google');
      (provider.fetchUserInfo as jest.Mock).mockRejectedValue(new Error('API error'));
      registerArcticProvider(provider);
      
      const userInfo = await fetchProviderUserInfo('google', 'token');
      
      expect(userInfo).toBeNull();
    });

    it('logs error on fetch failure', async () => {
      const provider = createMockProvider('google');
      const error = new Error('Network error');
      (provider.fetchUserInfo as jest.Mock).mockRejectedValue(error);
      registerArcticProvider(provider);
      const { logger } = require('@/lib/logger');
      
      await fetchProviderUserInfo('google', 'token');
      
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to fetch user info from provider',
        expect.objectContaining({ providerId: 'google' }),
        error
      );
    });
  });

  describe('getProviderScopes', () => {
    it('returns scopes for registered provider', () => {
      const provider = createMockProvider('google');
      registerArcticProvider(provider);
      
      const scopes = getProviderScopes('google');
      
      expect(scopes).toEqual(['email', 'profile']);
    });

    it('returns empty array for non-existent provider', () => {
      const scopes = getProviderScopes('nonexistent');
      
      expect(scopes).toEqual([]);
    });
  });

  describe('getConfiguredArcticProviders', () => {
    it('returns only configured providers', () => {
      const google = createMockProvider('google', true);
      const github = createMockProvider('github', false);
      const microsoft = createMockProvider('microsoft', true);
      
      registerArcticProvider(google);
      registerArcticProvider(github);
      registerArcticProvider(microsoft);
      
      const configured = getConfiguredArcticProviders();
      
      expect(configured).toHaveLength(2);
      expect(configured).toContain(google);
      expect(configured).toContain(microsoft);
      expect(configured).not.toContain(github);
    });

    it('returns empty array when no providers configured', () => {
      const google = createMockProvider('google', false);
      registerArcticProvider(google);
      
      const configured = getConfiguredArcticProviders();
      
      expect(configured).toEqual([]);
    });
  });

  describe('getArcticProviderConfigs', () => {
    it('returns configs for configured providers', () => {
      const google = createMockProvider('google', true);
      const github = createMockProvider('github', false);
      
      registerArcticProvider(google);
      registerArcticProvider(github);
      
      const configs = getArcticProviderConfigs();
      
      expect(configs).toHaveLength(1);
      expect(configs[0]).toEqual(google.config);
    });

    it('returns empty array when no configured providers', () => {
      const configs = getArcticProviderConfigs();
      
      expect(configs).toEqual([]);
    });
  });

  describe('clearArcticProviders', () => {
    it('removes all registered providers', () => {
      registerArcticProvider(createMockProvider('google'));
      registerArcticProvider(createMockProvider('github'));
      
      clearArcticProviders();
      
      expect(getAllArcticProviders().size).toBe(0);
    });

    it('clears all cached instances', () => {
      const provider = createMockProvider('google');
      registerArcticProvider(provider);
      getArcticProvider('google'); // Cache instance
      
      clearArcticProviders();
      registerArcticProvider(provider);
      getArcticProvider('google');
      
      // Should create new instance after clear
      expect(provider.createArcticProvider).toHaveBeenCalledTimes(2);
    });
  });

  describe('refreshArcticProviderStatus', () => {
    it('clears cached instances', () => {
      const provider = createMockProvider('google');
      registerArcticProvider(provider);
      getArcticProvider('google'); // Cache instance
      
      refreshArcticProviderStatus();
      getArcticProvider('google');
      
      // Should create new instance after refresh
      expect(provider.createArcticProvider).toHaveBeenCalledTimes(2);
    });

    it('re-checks configuration status for all providers', () => {
      const google = createMockProvider('google');
      const github = createMockProvider('github');
      
      registerArcticProvider(google);
      registerArcticProvider(github);
      
      refreshArcticProviderStatus();
      
      expect(google.getConfigStatus).toHaveBeenCalled();
      expect(github.getConfigStatus).toHaveBeenCalled();
    });

  });
});
