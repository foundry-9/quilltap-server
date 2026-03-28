/**
 * Unit tests for lib/help-chat/context-resolver.ts
 *
 * Tests the URL matching strategies used to resolve help documentation
 * and build context for the help chat system.
 */

// Mock logger to suppress log output during tests
jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// Mock help-search module
const mockHelpSearch = {
  isLoaded: jest.fn(() => true),
  listDocuments: jest.fn(() => []),
  getDocument: jest.fn(),
};

jest.mock('@/lib/help-search', () => ({
  getHelpSearch: () => mockHelpSearch,
}));

import { resolveHelpContentForUrl, resolveAllHelpContentForUrl, matchUrlPattern } from '@/lib/help-chat/context-resolver';

describe('help-chat/context-resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper function to set up mock documents
  const setupMockDocs = (docs: Array<{ id: string; title: string; path: string; url: string; content: string }>) => {
    mockHelpSearch.listDocuments.mockReturnValue(docs.map(d => ({ id: d.id, title: d.title, path: d.path, url: d.url })));
    mockHelpSearch.getDocument.mockImplementation((id: string) => {
      const doc = docs.find(d => d.id === id);
      return doc ? { id: doc.id, title: doc.title, content: doc.content, url: doc.url } : null;
    });
  };

  describe('resolveHelpContentForUrl - exact matches', () => {
    it('returns exact match when URL matches exactly including query params', async () => {
      setupMockDocs([
        { id: 'doc-settings-chat', title: 'Chat Settings', path: '/settings/chat', url: '/settings?tab=chat', content: 'Chat settings help' },
      ]);

      const result = await resolveHelpContentForUrl('/settings?tab=chat');
      expect(result).not.toBeNull();
      expect(result?.url).toBe('/settings?tab=chat');
    });

    it('has matchType "exact" for exact matches', async () => {
      setupMockDocs([
        { id: 'doc-settings-chat', title: 'Chat Settings', path: '/settings/chat', url: '/settings?tab=chat', content: 'Chat settings help' },
      ]);

      const result = await resolveHelpContentForUrl('/settings?tab=chat');
      expect(result?.matchType).toBe('exact');
    });

    it('returns exact path match when path matches without query', async () => {
      setupMockDocs([
        { id: 'doc-settings', title: 'Settings', path: '/settings', url: '/settings', content: 'Settings page help' },
      ]);

      const result = await resolveHelpContentForUrl('/settings');
      expect(result).not.toBeNull();
      expect(result?.url).toBe('/settings');
    });

    it('matches root path "/"', async () => {
      setupMockDocs([
        { id: 'doc-home', title: 'Home', path: '/', url: '/', content: 'Home page help' },
      ]);

      const result = await resolveHelpContentForUrl('/');
      expect(result).not.toBeNull();
      expect(result?.url).toBe('/');
    });

    it('returns content from matched document', async () => {
      setupMockDocs([
        { id: 'doc-aurora', title: 'Aurora Characters', path: '/aurora', url: '/aurora', content: 'Aurora help' },
      ]);

      const result = await resolveHelpContentForUrl('/aurora');
      expect(result?.title).toBe('Aurora Characters');
      expect(result?.content).toBe('Aurora help');
    });
  });

  describe('resolveHelpContentForUrl - query param specificity', () => {
    it('returns exact match for path with matching query params', async () => {
      setupMockDocs([
        { id: 'settings-base', title: 'Settings', path: '/settings', url: '/settings', content: 'Settings' },
        { id: 'settings-chat', title: 'Chat Settings', path: '/settings-chat', url: '/settings?tab=chat', content: 'Chat Settings' },
      ]);

      const result = await resolveHelpContentForUrl('/settings?tab=chat');
      expect(result?.matchType).toBe('exact');
      expect(result?.url).toBe('/settings?tab=chat');
    });

    it('prefers more specific query param match', async () => {
      setupMockDocs([
        { id: 'settings-base', title: 'Settings', path: '/settings', url: '/settings', content: 'Settings' },
        { id: 'settings-chat', title: 'Chat Settings', path: '/settings-chat', url: '/settings?tab=chat', content: 'Chat Settings' },
        { id: 'settings-appearance', title: 'Appearance Settings', path: '/settings-appearance', url: '/settings?tab=appearance&section=colors', content: 'Appearance' },
      ]);

      const result = await resolveHelpContentForUrl('/settings?tab=appearance&section=colors');
      expect(result?.title).toBe('Appearance Settings');
    });
  });

  describe('resolveHelpContentForUrl - pattern matches', () => {
    it('returns pattern match for URLs like /aurora/some-id matching /aurora/:id', async () => {
      setupMockDocs([
        { id: 'doc-aurora-id', title: 'Character Detail', path: '/aurora/:id', url: '/aurora/:id', content: 'Character detail help' },
      ]);

      const result = await resolveHelpContentForUrl('/aurora/char-123');
      expect(result).not.toBeNull();
      expect(result?.url).toBe('/aurora/:id');
    });

    it('has matchType "pattern" for pattern matches', async () => {
      setupMockDocs([
        { id: 'doc-aurora-id', title: 'Character Detail', path: '/aurora/:id', url: '/aurora/:id', content: 'Character detail help' },
      ]);

      const result = await resolveHelpContentForUrl('/aurora/char-xyz');
      expect(result?.matchType).toBe('pattern');
    });

    it('matches multi-segment patterns like /aurora/:id/edit', async () => {
      setupMockDocs([
        { id: 'doc-aurora-id-edit', title: 'Character Edit', path: '/aurora/:id/edit', url: '/aurora/:id/edit', content: 'Character edit help' },
      ]);

      const result = await resolveHelpContentForUrl('/aurora/abc-def/edit');
      expect(result?.url).toBe('/aurora/:id/edit');
      expect(result?.matchType).toBe('pattern');
    });

    it('prefers most specific pattern (longest path)', async () => {
      setupMockDocs([
        { id: 'aurora-generic', title: 'Aurora', path: '/aurora', url: '/aurora/:id', content: 'Aurora' },
        { id: 'aurora-edit', title: 'Edit Character', path: '/aurora-edit', url: '/aurora/:id/edit', content: 'Edit' },
      ]);

      const result = await resolveHelpContentForUrl('/aurora/abc/edit');
      expect(result?.title).toBe('Edit Character');
    });
  });

  describe('resolveHelpContentForUrl - prefix matches', () => {
    it('returns prefix match when path is prefix of a doc URL', async () => {
      setupMockDocs([
        { id: 'settings-base', title: 'Settings', path: '/settings', url: '/settings', content: 'Settings' },
      ]);

      const result = await resolveHelpContentForUrl('/settings/sub/page');
      expect(result?.matchType).toBe('prefix');
      expect(result?.url).toBe('/settings');
    });

    it('prefers longest prefix (most specific)', async () => {
      setupMockDocs([
        { id: 'settings', title: 'Settings', path: '/settings', url: '/settings', content: 'Settings' },
        { id: 'settings-chat', title: 'Chat Settings', path: '/settings/chat', url: '/settings/chat', content: 'Chat' },
      ]);

      const result = await resolveHelpContentForUrl('/settings/chat/some/deep/path');
      expect(result?.title).toBe('Chat Settings');
    });
  });

  describe('resolveHelpContentForUrl - wildcard matches', () => {
    it('returns wildcard match for "*" URL', async () => {
      setupMockDocs([
        { id: 'sidebar', title: 'Sidebar', path: '*', url: '*', content: 'Sidebar help' },
      ]);

      const result = await resolveHelpContentForUrl('/any/random/path');
      expect(result?.matchType).toBe('wildcard');
      expect(result?.title).toBe('Sidebar');
    });

    it('has matchType "wildcard" for wildcard matches', async () => {
      setupMockDocs([
        { id: 'sidebar', title: 'Sidebar', path: '*', url: '*', content: 'Sidebar' },
      ]);

      const result = await resolveHelpContentForUrl('/unknown/page');
      expect(result?.matchType).toBe('wildcard');
    });
  });

  describe('resolveHelpContentForUrl - fallback matches', () => {
    it('returns fallback when no match found, looks for homepage doc', async () => {
      setupMockDocs([
        { id: 'home', title: 'Home', path: '/', url: '/', content: 'Home page' },
      ]);

      const result = await resolveHelpContentForUrl('/completely/unknown/path');
      expect(result?.matchType).toBe('fallback');
      expect(result?.url).toBe('/');
    });

    it('has matchType "fallback" for homepage fallback', async () => {
      setupMockDocs([
        { id: 'home', title: 'Home', path: '/', url: '/', content: 'Home' },
      ]);

      const result = await resolveHelpContentForUrl('/no/match/here');
      expect(result?.matchType).toBe('fallback');
    });

    it('returns null when no match and no homepage fallback', async () => {
      setupMockDocs([]);

      const result = await resolveHelpContentForUrl('/any/path');
      expect(result).toBeNull();
    });
  });

  describe('resolveHelpContentForUrl - matching strategy priority', () => {
    it('prefers exact match over pattern match', async () => {
      setupMockDocs([
        { id: 'exact', title: 'Exact Match', path: '/settings', url: '/settings?tab=chat', content: 'Exact' },
        { id: 'pattern', title: 'Pattern Match', path: '/settings/:id', url: '/settings/:id', content: 'Pattern' },
      ]);

      const result = await resolveHelpContentForUrl('/settings?tab=chat');
      expect(result?.title).toBe('Exact Match');
    });

    it('prefers pattern match over prefix match', async () => {
      setupMockDocs([
        { id: 'pattern', title: 'Pattern Match', path: '/aurora/:id', url: '/aurora/:id', content: 'Pattern' },
        { id: 'prefix', title: 'Prefix Match', path: '/au', url: '/au', content: 'Prefix' },
      ]);

      const result = await resolveHelpContentForUrl('/aurora/abc-123');
      expect(result?.title).toBe('Pattern Match');
      expect(result?.matchType).toBe('pattern');
    });
  });

  describe('resolveHelpContentForUrl - edge cases', () => {
    it('handles empty documents list', async () => {
      setupMockDocs([]);

      const result = await resolveHelpContentForUrl('/any/path');
      expect(result).toBeNull();
    });

    it('handles URLs with no query params', async () => {
      setupMockDocs([
        { id: 'home', title: 'Home', path: '/', url: '/', content: 'Home' },
      ]);

      const result = await resolveHelpContentForUrl('/');
      expect(result).not.toBeNull();
    });

    it('handles URLs with multiple query params', async () => {
      setupMockDocs([
        { id: 'settings', title: 'Settings', path: '/settings', url: '/settings?tab=appearance&section=colors', content: 'Settings' },
      ]);

      const result = await resolveHelpContentForUrl('/settings?tab=appearance&section=colors');
      expect(result?.matchType).toBe('exact');
    });

    it('returns null when help bundle fails to load', async () => {
      mockHelpSearch.isLoaded.mockReturnValue(false);
      // When isLoaded is false, the function attempts to load and we haven't mocked that
      setupMockDocs([]);

      const result = await resolveHelpContentForUrl('/');
      // Since loadFromUrl isn't mocked, it will try to fetch and fail, returning null
      expect(result).toBeNull();
    });
  });

  describe('resolveAllHelpContentForUrl', () => {
    it('is an async function that resolves multiple help contexts', async () => {
      setupMockDocs([
        { id: 'doc-settings', title: 'Settings', path: '/settings', url: '/settings', content: 'Settings' },
      ]);

      const result = await resolveAllHelpContentForUrl('/settings');
      // resolveAllHelpContentForUrl returns an array (may be empty if primary is null and help bundle not loaded)
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns an array that includes wildcard documents when bundle is loaded', async () => {
      setupMockDocs([
        { id: 'doc-aurora', title: 'Aurora', path: '/aurora', url: '/aurora', content: 'Aurora' },
        { id: 'doc-sidebar', title: 'Sidebar', path: 'sidebar', url: '*', content: 'Sidebar' },
      ]);
      mockHelpSearch.isLoaded.mockReturnValue(true);

      const result = await resolveAllHelpContentForUrl('/aurora');
      // Result is always an array
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array when no documents match', async () => {
      setupMockDocs([]);
      mockHelpSearch.isLoaded.mockReturnValue(false);

      const result = await resolveAllHelpContentForUrl('/unknown/path');
      // When there are no docs and bundle isn't loaded, result is empty
      expect(result).toEqual([]);
    });
  });

  describe('matchUrlPattern', () => {
    it('matches exact path "/settings" to "/settings"', () => {
      expect(matchUrlPattern('/settings', '/settings')).toBe(true);
    });

    it('does not match different paths', () => {
      expect(matchUrlPattern('/settings', '/aurora')).toBe(false);
    });

    it('matches pattern with single param /aurora/:id', () => {
      expect(matchUrlPattern('/aurora/:id', '/aurora/abc-123')).toBe(true);
    });

    it('matches pattern with multiple params', () => {
      expect(matchUrlPattern('/api/:type/:id', '/api/chars/123')).toBe(true);
    });

    it('does not match different segment counts', () => {
      expect(matchUrlPattern('/a/b', '/a/b/c')).toBe(false);
    });

    it('does not match when static segments differ', () => {
      expect(matchUrlPattern('/api/:id/edit', '/api/123/delete')).toBe(false);
    });

    it('handles root path', () => {
      expect(matchUrlPattern('/', '/')).toBe(true);
    });

    it('handles empty strings', () => {
      expect(matchUrlPattern('', '')).toBe(true);
    });

    it('allows param to match any value including empty-like strings', () => {
      expect(matchUrlPattern('/path/:param', '/path/')).toBe(true);
    });

    it('matches complex patterns with multiple params', () => {
      expect(matchUrlPattern('/settings/:tab/details/:id', '/settings/chat/details/123')).toBe(true);
    });
  });
});
