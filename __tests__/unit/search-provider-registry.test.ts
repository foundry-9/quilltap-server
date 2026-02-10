/**
 * Search Provider Registry Tests
 *
 * Tests for the SearchProviderRegistry singleton, including registration,
 * lookup, metadata, initialization, reset, stats, and convenience functions.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  searchProviderRegistry,
  registerSearchProvider,
  getSearchProvider,
  getAllSearchProviders,
  hasSearchProvider,
  getSearchProviderNames,
  getSearchProviderMetadata,
  getAllSearchProviderMetadata,
  getSearchProviderConfigRequirements,
  getDefaultSearchProvider,
  isSearchConfigured,
  initializeSearchProviderRegistry,
  getSearchProviderRegistryStats,
  getSearchProviderRegistryErrors,
  isSearchProviderRegistryInitialized,
} from '@/lib/plugins/search-provider-registry';
import type { SearchProviderPlugin, SearchResult } from '@quilltap/plugin-types';

// ============================================================================
// MOCK DATA
// ============================================================================

function createMockSearchProvider(overrides: Partial<{
  providerName: string;
  displayName: string;
  description: string;
  abbreviation: string;
  requiresApiKey: boolean;
  apiKeyLabel: string;
  requiresBaseUrl: boolean;
}> = {}): SearchProviderPlugin {
  return {
    metadata: {
      providerName: overrides.providerName ?? 'TEST_SEARCH',
      displayName: overrides.displayName ?? 'Test Search Provider',
      description: overrides.description ?? 'A test search provider',
      abbreviation: overrides.abbreviation ?? 'TST',
      colors: { bg: 'bg-blue-100', text: 'text-blue-800', icon: 'text-blue-600' },
    },
    config: {
      requiresApiKey: overrides.requiresApiKey ?? true,
      apiKeyLabel: overrides.apiKeyLabel ?? 'Test API Key',
      requiresBaseUrl: overrides.requiresBaseUrl ?? false,
    },
    async executeSearch(query: string, maxResults: number, apiKey: string) {
      return { success: true, results: [], totalFound: 0, query };
    },
    formatResults(results: SearchResult[]) {
      return 'formatted results';
    },
  };
}

const mockSearchProvider = createMockSearchProvider();

const mockSearchProvider2 = createMockSearchProvider({
  providerName: 'ANOTHER_SEARCH',
  displayName: 'Another Search Provider',
  description: 'A second test search provider',
  abbreviation: 'ANT',
  requiresApiKey: false,
  requiresBaseUrl: true,
});

// ============================================================================
// TESTS
// ============================================================================

describe('SearchProviderRegistry', () => {
  beforeEach(() => {
    searchProviderRegistry.reset();
  });

  // --------------------------------------------------------------------------
  // Registration
  // --------------------------------------------------------------------------

  describe('registerProvider', () => {
    it('should register a provider and make it accessible', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      expect(searchProviderRegistry.hasProvider('TEST_SEARCH')).toBe(true);
      expect(searchProviderRegistry.getProvider('TEST_SEARCH')).toBe(mockSearchProvider);
      expect(searchProviderRegistry.getProviderNames()).toContain('TEST_SEARCH');
    });

    it('should register multiple providers', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);
      searchProviderRegistry.registerProvider(mockSearchProvider2);

      expect(searchProviderRegistry.getProviderNames()).toHaveLength(2);
      expect(searchProviderRegistry.getProviderNames()).toContain('TEST_SEARCH');
      expect(searchProviderRegistry.getProviderNames()).toContain('ANOTHER_SEARCH');
    });

    it('should throw when registering a duplicate provider name', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      expect(() => {
        searchProviderRegistry.registerProvider(mockSearchProvider);
      }).toThrow("Search provider 'TEST_SEARCH' is already registered");
    });
  });

  // --------------------------------------------------------------------------
  // getProvider / hasProvider
  // --------------------------------------------------------------------------

  describe('getProvider', () => {
    it('should return the provider when it exists', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      const provider = searchProviderRegistry.getProvider('TEST_SEARCH');
      expect(provider).toBe(mockSearchProvider);
    });

    it('should return null for a non-existent provider', () => {
      const provider = searchProviderRegistry.getProvider('NONEXISTENT');
      expect(provider).toBeNull();
    });
  });

  describe('hasProvider', () => {
    it('should return true for a registered provider', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      expect(searchProviderRegistry.hasProvider('TEST_SEARCH')).toBe(true);
    });

    it('should return false for a non-existent provider', () => {
      expect(searchProviderRegistry.hasProvider('NONEXISTENT')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getAllProviders
  // --------------------------------------------------------------------------

  describe('getAllProviders', () => {
    it('should return an empty array when no providers are registered', () => {
      expect(searchProviderRegistry.getAllProviders()).toEqual([]);
    });

    it('should return all registered providers', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);
      searchProviderRegistry.registerProvider(mockSearchProvider2);

      const all = searchProviderRegistry.getAllProviders();
      expect(all).toHaveLength(2);
      expect(all).toContain(mockSearchProvider);
      expect(all).toContain(mockSearchProvider2);
    });
  });

  // --------------------------------------------------------------------------
  // getProviderMetadata / getAllProviderMetadata
  // --------------------------------------------------------------------------

  describe('getProviderMetadata', () => {
    it('should return metadata for a registered provider', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      const metadata = searchProviderRegistry.getProviderMetadata('TEST_SEARCH');
      expect(metadata).not.toBeNull();
      expect(metadata?.providerName).toBe('TEST_SEARCH');
      expect(metadata?.displayName).toBe('Test Search Provider');
      expect(metadata?.description).toBe('A test search provider');
      expect(metadata?.abbreviation).toBe('TST');
      expect(metadata?.colors).toEqual({
        bg: 'bg-blue-100',
        text: 'text-blue-800',
        icon: 'text-blue-600',
      });
    });

    it('should return null for a non-existent provider', () => {
      const metadata = searchProviderRegistry.getProviderMetadata('NONEXISTENT');
      expect(metadata).toBeNull();
    });
  });

  describe('getAllProviderMetadata', () => {
    it('should return an empty array when no providers are registered', () => {
      expect(searchProviderRegistry.getAllProviderMetadata()).toEqual([]);
    });

    it('should return metadata for all registered providers', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);
      searchProviderRegistry.registerProvider(mockSearchProvider2);

      const allMetadata = searchProviderRegistry.getAllProviderMetadata();
      expect(allMetadata).toHaveLength(2);

      const names = allMetadata.map(m => m.providerName);
      expect(names).toContain('TEST_SEARCH');
      expect(names).toContain('ANOTHER_SEARCH');
    });
  });

  // --------------------------------------------------------------------------
  // getConfigRequirements
  // --------------------------------------------------------------------------

  describe('getConfigRequirements', () => {
    it('should return config requirements for a registered provider', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      const config = searchProviderRegistry.getConfigRequirements('TEST_SEARCH');
      expect(config).not.toBeNull();
      expect(config?.requiresApiKey).toBe(true);
      expect(config?.apiKeyLabel).toBe('Test API Key');
      expect(config?.requiresBaseUrl).toBe(false);
    });

    it('should return config with different values for another provider', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider2);

      const config = searchProviderRegistry.getConfigRequirements('ANOTHER_SEARCH');
      expect(config).not.toBeNull();
      expect(config?.requiresApiKey).toBe(false);
      expect(config?.requiresBaseUrl).toBe(true);
    });

    it('should return null for a non-existent provider', () => {
      const config = searchProviderRegistry.getConfigRequirements('NONEXISTENT');
      expect(config).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // getDefaultProvider
  // --------------------------------------------------------------------------

  describe('getDefaultProvider', () => {
    it('should return null when no providers are registered', () => {
      expect(searchProviderRegistry.getDefaultProvider()).toBeNull();
    });

    it('should return the first registered provider', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);
      searchProviderRegistry.registerProvider(mockSearchProvider2);

      const defaultProvider = searchProviderRegistry.getDefaultProvider();
      expect(defaultProvider).toBe(mockSearchProvider);
    });
  });

  // --------------------------------------------------------------------------
  // isSearchConfigured
  // --------------------------------------------------------------------------

  describe('isSearchConfigured', () => {
    it('should return false when no providers are registered', () => {
      expect(searchProviderRegistry.isSearchConfigured()).toBe(false);
    });

    it('should return true after a provider is registered', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      expect(searchProviderRegistry.isSearchConfigured()).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // initialize
  // --------------------------------------------------------------------------

  describe('initialize', () => {
    it('should clear existing state and register new providers', async () => {
      // Pre-register a provider
      searchProviderRegistry.registerProvider(mockSearchProvider);
      expect(searchProviderRegistry.getProviderNames()).toContain('TEST_SEARCH');

      // Initialize with a different set
      await searchProviderRegistry.initialize([mockSearchProvider2]);

      expect(searchProviderRegistry.getProviderNames()).not.toContain('TEST_SEARCH');
      expect(searchProviderRegistry.getProviderNames()).toContain('ANOTHER_SEARCH');
      expect(searchProviderRegistry.getAllProviders()).toHaveLength(1);
    });

    it('should mark the registry as initialized', async () => {
      expect(searchProviderRegistry.isInitialized()).toBe(false);

      await searchProviderRegistry.initialize([]);

      expect(searchProviderRegistry.isInitialized()).toBe(true);
    });

    it('should set the lastInitTime', async () => {
      const before = new Date();
      await searchProviderRegistry.initialize([mockSearchProvider]);
      const after = new Date();

      const stats = searchProviderRegistry.getStats();
      expect(stats.lastInitTime).not.toBeNull();

      const initTime = new Date(stats.lastInitTime!);
      expect(initTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(initTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should register multiple providers via initialize', async () => {
      await searchProviderRegistry.initialize([mockSearchProvider, mockSearchProvider2]);

      expect(searchProviderRegistry.getAllProviders()).toHaveLength(2);
      expect(searchProviderRegistry.hasProvider('TEST_SEARCH')).toBe(true);
      expect(searchProviderRegistry.hasProvider('ANOTHER_SEARCH')).toBe(true);
    });

    it('should capture errors for duplicate providers during initialization', async () => {
      // Pass duplicate providers to initialize
      await searchProviderRegistry.initialize([mockSearchProvider, mockSearchProvider]);

      // The first should register; the second should fail and be recorded as an error
      expect(searchProviderRegistry.getAllProviders()).toHaveLength(1);
      expect(searchProviderRegistry.hasProvider('TEST_SEARCH')).toBe(true);

      const errors = searchProviderRegistry.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].provider).toBe('TEST_SEARCH');
      expect(errors[0].error).toContain('already registered');
    });

    it('should clear previous errors on re-initialization', async () => {
      // First init with a duplicate to produce an error
      await searchProviderRegistry.initialize([mockSearchProvider, mockSearchProvider]);
      expect(searchProviderRegistry.getErrors()).toHaveLength(1);

      // Re-initialize with clean data
      await searchProviderRegistry.initialize([mockSearchProvider2]);
      expect(searchProviderRegistry.getErrors()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // reset
  // --------------------------------------------------------------------------

  describe('reset', () => {
    it('should clear all providers', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);
      searchProviderRegistry.registerProvider(mockSearchProvider2);

      searchProviderRegistry.reset();

      expect(searchProviderRegistry.getAllProviders()).toHaveLength(0);
      expect(searchProviderRegistry.hasProvider('TEST_SEARCH')).toBe(false);
      expect(searchProviderRegistry.hasProvider('ANOTHER_SEARCH')).toBe(false);
    });

    it('should reset initialized state', async () => {
      await searchProviderRegistry.initialize([mockSearchProvider]);
      expect(searchProviderRegistry.isInitialized()).toBe(true);

      searchProviderRegistry.reset();

      expect(searchProviderRegistry.isInitialized()).toBe(false);
    });

    it('should clear errors', async () => {
      await searchProviderRegistry.initialize([mockSearchProvider, mockSearchProvider]);
      expect(searchProviderRegistry.getErrors().length).toBeGreaterThan(0);

      searchProviderRegistry.reset();

      expect(searchProviderRegistry.getErrors()).toHaveLength(0);
    });

    it('should clear lastInitTime', async () => {
      await searchProviderRegistry.initialize([mockSearchProvider]);
      expect(searchProviderRegistry.getStats().lastInitTime).not.toBeNull();

      searchProviderRegistry.reset();

      expect(searchProviderRegistry.getStats().lastInitTime).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // getStats
  // --------------------------------------------------------------------------

  describe('getStats', () => {
    it('should return correct statistics for empty registry', () => {
      const stats = searchProviderRegistry.getStats();

      expect(stats.total).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.initialized).toBe(false);
      expect(stats.lastInitTime).toBeNull();
      expect(stats.providers).toEqual([]);
    });

    it('should return correct statistics after registration', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);
      searchProviderRegistry.registerProvider(mockSearchProvider2);

      const stats = searchProviderRegistry.getStats();

      expect(stats.total).toBe(2);
      expect(stats.providers).toContain('TEST_SEARCH');
      expect(stats.providers).toContain('ANOTHER_SEARCH');
    });

    it('should return correct statistics after initialize with errors', async () => {
      await searchProviderRegistry.initialize([
        mockSearchProvider,
        mockSearchProvider2,
        mockSearchProvider, // duplicate - will cause an error
      ]);

      const stats = searchProviderRegistry.getStats();

      expect(stats.total).toBe(2);
      expect(stats.errors).toBe(1);
      expect(stats.initialized).toBe(true);
      expect(stats.lastInitTime).not.toBeNull();
      expect(stats.providers).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // getErrors
  // --------------------------------------------------------------------------

  describe('getErrors', () => {
    it('should return empty array when no errors exist', () => {
      expect(searchProviderRegistry.getErrors()).toEqual([]);
    });

    it('should capture registration errors from initialize', async () => {
      await searchProviderRegistry.initialize([mockSearchProvider, mockSearchProvider]);

      const errors = searchProviderRegistry.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        provider: 'TEST_SEARCH',
        error: expect.stringContaining('already registered'),
      });
    });
  });

  // --------------------------------------------------------------------------
  // exportState
  // --------------------------------------------------------------------------

  describe('exportState', () => {
    it('should export complete state for empty registry', () => {
      const state = searchProviderRegistry.exportState();

      expect(state.initialized).toBe(false);
      expect(state.lastInitTime).toBeNull();
      expect(state.providers).toEqual([]);
      expect(state.errors).toEqual([]);
      expect(state.stats).toBeDefined();
    });

    it('should export complete state after initialization', async () => {
      await searchProviderRegistry.initialize([mockSearchProvider, mockSearchProvider2]);

      const state = searchProviderRegistry.exportState();

      expect(state.initialized).toBe(true);
      expect(state.lastInitTime).not.toBeNull();
      expect(state.providers).toHaveLength(2);

      const providerNames = state.providers.map(p => p.name);
      expect(providerNames).toContain('TEST_SEARCH');
      expect(providerNames).toContain('ANOTHER_SEARCH');

      // Verify provider detail structure
      const testProvider = state.providers.find(p => p.name === 'TEST_SEARCH');
      expect(testProvider?.displayName).toBe('Test Search Provider');
      expect(testProvider?.description).toBe('A test search provider');
      expect(testProvider?.configRequirements.requiresApiKey).toBe(true);
      expect(testProvider?.configRequirements.requiresBaseUrl).toBe(false);
    });

    it('should include errors in exported state', async () => {
      await searchProviderRegistry.initialize([mockSearchProvider, mockSearchProvider]);

      const state = searchProviderRegistry.exportState();
      expect(state.errors).toHaveLength(1);
      expect(state.errors[0].provider).toBe('TEST_SEARCH');
      expect(state.errors[0].error).toContain('already registered');
    });
  });

  // --------------------------------------------------------------------------
  // isInitialized
  // --------------------------------------------------------------------------

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      expect(searchProviderRegistry.isInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      await searchProviderRegistry.initialize([]);

      expect(searchProviderRegistry.isInitialized()).toBe(true);
    });

    it('should return false after reset', async () => {
      await searchProviderRegistry.initialize([mockSearchProvider]);
      searchProviderRegistry.reset();

      expect(searchProviderRegistry.isInitialized()).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getProviderNames
  // --------------------------------------------------------------------------

  describe('getProviderNames', () => {
    it('should return empty array when no providers are registered', () => {
      expect(searchProviderRegistry.getProviderNames()).toEqual([]);
    });

    it('should return names of all registered providers', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);
      searchProviderRegistry.registerProvider(mockSearchProvider2);

      const names = searchProviderRegistry.getProviderNames();
      expect(names).toHaveLength(2);
      expect(names).toContain('TEST_SEARCH');
      expect(names).toContain('ANOTHER_SEARCH');
    });
  });
});

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

describe('Search Provider Registry Convenience Functions', () => {
  beforeEach(() => {
    searchProviderRegistry.reset();
  });

  describe('registerSearchProvider', () => {
    it('should register a provider via the convenience function', () => {
      registerSearchProvider(mockSearchProvider);

      expect(searchProviderRegistry.hasProvider('TEST_SEARCH')).toBe(true);
    });

    it('should throw on duplicate registration', () => {
      registerSearchProvider(mockSearchProvider);

      expect(() => {
        registerSearchProvider(mockSearchProvider);
      }).toThrow("Search provider 'TEST_SEARCH' is already registered");
    });
  });

  describe('getSearchProvider', () => {
    it('should return the provider when it exists', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      expect(getSearchProvider('TEST_SEARCH')).toBe(mockSearchProvider);
    });

    it('should return null for a non-existent provider', () => {
      expect(getSearchProvider('NONEXISTENT')).toBeNull();
    });
  });

  describe('getAllSearchProviders', () => {
    it('should return all registered providers', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);
      searchProviderRegistry.registerProvider(mockSearchProvider2);

      const all = getAllSearchProviders();
      expect(all).toHaveLength(2);
    });
  });

  describe('hasSearchProvider', () => {
    it('should return true for an existing provider', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      expect(hasSearchProvider('TEST_SEARCH')).toBe(true);
    });

    it('should return false for a non-existent provider', () => {
      expect(hasSearchProvider('NONEXISTENT')).toBe(false);
    });
  });

  describe('getSearchProviderNames', () => {
    it('should return names of all registered providers', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      const names = getSearchProviderNames();
      expect(names).toContain('TEST_SEARCH');
    });
  });

  describe('getSearchProviderMetadata', () => {
    it('should return metadata for a registered provider', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      const metadata = getSearchProviderMetadata('TEST_SEARCH');
      expect(metadata).not.toBeNull();
      expect(metadata?.providerName).toBe('TEST_SEARCH');
      expect(metadata?.displayName).toBe('Test Search Provider');
    });

    it('should return null for a non-existent provider', () => {
      expect(getSearchProviderMetadata('NONEXISTENT')).toBeNull();
    });
  });

  describe('getAllSearchProviderMetadata', () => {
    it('should return metadata for all registered providers', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);
      searchProviderRegistry.registerProvider(mockSearchProvider2);

      const allMetadata = getAllSearchProviderMetadata();
      expect(allMetadata).toHaveLength(2);
    });
  });

  describe('getSearchProviderConfigRequirements', () => {
    it('should return config requirements for a registered provider', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      const config = getSearchProviderConfigRequirements('TEST_SEARCH');
      expect(config).not.toBeNull();
      expect(config?.requiresApiKey).toBe(true);
    });

    it('should return null for a non-existent provider', () => {
      expect(getSearchProviderConfigRequirements('NONEXISTENT')).toBeNull();
    });
  });

  describe('getDefaultSearchProvider', () => {
    it('should return null when no providers are registered', () => {
      expect(getDefaultSearchProvider()).toBeNull();
    });

    it('should return the first registered provider', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);
      searchProviderRegistry.registerProvider(mockSearchProvider2);

      expect(getDefaultSearchProvider()).toBe(mockSearchProvider);
    });
  });

  describe('isSearchConfigured', () => {
    it('should return false when no providers are registered', () => {
      expect(isSearchConfigured()).toBe(false);
    });

    it('should return true after registration', () => {
      searchProviderRegistry.registerProvider(mockSearchProvider);

      expect(isSearchConfigured()).toBe(true);
    });
  });

  describe('initializeSearchProviderRegistry', () => {
    it('should initialize the registry with providers', async () => {
      await initializeSearchProviderRegistry([mockSearchProvider, mockSearchProvider2]);

      expect(searchProviderRegistry.isInitialized()).toBe(true);
      expect(searchProviderRegistry.getAllProviders()).toHaveLength(2);
    });
  });

  describe('getSearchProviderRegistryStats', () => {
    it('should return registry statistics', async () => {
      await searchProviderRegistry.initialize([mockSearchProvider]);

      const stats = getSearchProviderRegistryStats();
      expect(stats.total).toBe(1);
      expect(stats.initialized).toBe(true);
      expect(stats.providers).toContain('TEST_SEARCH');
    });
  });

  describe('getSearchProviderRegistryErrors', () => {
    it('should return empty array when no errors', () => {
      expect(getSearchProviderRegistryErrors()).toEqual([]);
    });

    it('should return errors after failed registration', async () => {
      await searchProviderRegistry.initialize([mockSearchProvider, mockSearchProvider]);

      const errors = getSearchProviderRegistryErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].provider).toBe('TEST_SEARCH');
    });
  });

  describe('isSearchProviderRegistryInitialized', () => {
    it('should return false before initialization', () => {
      expect(isSearchProviderRegistryInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      await searchProviderRegistry.initialize([]);

      expect(isSearchProviderRegistryInitialized()).toBe(true);
    });
  });
});
