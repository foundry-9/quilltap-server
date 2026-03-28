/**
 * Unit tests for Help Guide Categories
 *
 * Tests cover:
 * - HELP_CATEGORIES structure validation
 * - EXCLUDED_DOCUMENTS validation
 * - getCategoryForUrl URL matching logic
 * - URL_CATEGORY_MAP completeness
 */

import { describe, it, expect } from '@jest/globals';
import {
  HELP_CATEGORIES,
  EXCLUDED_DOCUMENTS,
  URL_CATEGORY_MAP,
  getCategoryForUrl,
} from '@/lib/help-guide/categories';

describe('Help Guide Categories', () => {
  describe('HELP_CATEGORIES', () => {
    it('should have 11 categories', () => {
      expect(HELP_CATEGORIES).toHaveLength(11);
    });

    it('should have unique category IDs', () => {
      const ids = HELP_CATEGORIES.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have non-empty documents array for every category', () => {
      for (const category of HELP_CATEGORIES) {
        expect(category.documents.length).toBeGreaterThan(0);
      }
    });

    it('should have id, label, and documents on every category', () => {
      for (const category of HELP_CATEGORIES) {
        expect(typeof category.id).toBe('string');
        expect(typeof category.label).toBe('string');
        expect(Array.isArray(category.documents)).toBe(true);
      }
    });

    it('should include expected category IDs', () => {
      const ids = HELP_CATEGORIES.map((c) => c.id);
      expect(ids).toContain('getting-started');
      expect(ids).toContain('characters');
      expect(ids).toContain('chats');
      expect(ids).toContain('projects');
      expect(ids).toContain('files');
      expect(ids).toContain('memory-search');
      expect(ids).toContain('ai-providers');
      expect(ids).toContain('appearance');
      expect(ids).toContain('settings-system');
      expect(ids).toContain('account');
      expect(ids).toContain('content-routing');
    });
  });

  describe('EXCLUDED_DOCUMENTS', () => {
    it('should contain help-chat', () => {
      expect(EXCLUDED_DOCUMENTS).toContain('help-chat');
    });
  });

  describe('getCategoryForUrl', () => {
    // Root matching
    it('should return getting-started for exact /', () => {
      expect(getCategoryForUrl('/')).toBe('getting-started');
    });

    it('should not match root for other paths', () => {
      // /something should not match '/' pattern
      expect(getCategoryForUrl('/something')).toBeNull();
    });

    // Basic path matching
    it('should return characters for /aurora', () => {
      expect(getCategoryForUrl('/aurora')).toBe('characters');
    });

    it('should return characters for /aurora/123/edit (prefix matching)', () => {
      expect(getCategoryForUrl('/aurora/123/edit')).toBe('characters');
    });

    it('should return chats for /salon', () => {
      expect(getCategoryForUrl('/salon')).toBe('chats');
    });

    it('should return projects for /prospero', () => {
      expect(getCategoryForUrl('/prospero')).toBe('projects');
    });

    it('should return files for /files', () => {
      expect(getCategoryForUrl('/files')).toBe('files');
    });

    it('should return account for /profile', () => {
      expect(getCategoryForUrl('/profile')).toBe('account');
    });

    it('should return getting-started for /setup', () => {
      expect(getCategoryForUrl('/setup')).toBe('getting-started');
    });

    // Settings with tab query params
    it('should return settings-system for /settings (no tab)', () => {
      expect(getCategoryForUrl('/settings')).toBe('settings-system');
    });

    it('should return settings-system for /settings?tab=system', () => {
      expect(getCategoryForUrl('/settings?tab=system')).toBe('settings-system');
    });

    it('should return settings-system for /settings?tab=templates', () => {
      expect(getCategoryForUrl('/settings?tab=templates')).toBe('settings-system');
    });

    it('should return content-routing for /settings?tab=images', () => {
      expect(getCategoryForUrl('/settings?tab=images')).toBe('content-routing');
    });

    it('should return memory-search for /settings?tab=memory', () => {
      expect(getCategoryForUrl('/settings?tab=memory')).toBe('memory-search');
    });

    it('should return appearance for /settings?tab=appearance', () => {
      expect(getCategoryForUrl('/settings?tab=appearance')).toBe('appearance');
    });

    it('should return chats for /settings?tab=chat', () => {
      expect(getCategoryForUrl('/settings?tab=chat')).toBe('chats');
    });

    it('should return ai-providers for /settings?tab=providers', () => {
      expect(getCategoryForUrl('/settings?tab=providers')).toBe('ai-providers');
    });

    // Specificity: tab query param wins over bare /settings
    it('should pick the most specific match (tab param over bare path)', () => {
      // /settings?tab=system should match '/settings?tab=system' (more specific)
      // not bare '/settings'
      expect(getCategoryForUrl('/settings?tab=system')).toBe('settings-system');
      expect(getCategoryForUrl('/settings?tab=images')).toBe('content-routing');
    });

    // Extra query params should still match
    it('should match with extra query params', () => {
      expect(getCategoryForUrl('/settings?tab=system&foo=bar')).toBe('settings-system');
    });

    // No match cases
    it('should return null for unknown URL', () => {
      expect(getCategoryForUrl('/unknown-page')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(getCategoryForUrl('')).toBeNull();
    });

    // Settings with unknown tab falls back to bare /settings
    it('should fall back to settings-system for unknown tab', () => {
      expect(getCategoryForUrl('/settings?tab=unknown')).toBe('settings-system');
    });
  });

  describe('URL_CATEGORY_MAP', () => {
    it('should have entries for all major routes', () => {
      const patterns = URL_CATEGORY_MAP.map((e) => e.pattern);
      expect(patterns).toContain('/');
      expect(patterns).toContain('/aurora');
      expect(patterns).toContain('/salon');
      expect(patterns).toContain('/prospero');
      expect(patterns).toContain('/files');
      expect(patterns).toContain('/profile');
      expect(patterns).toContain('/settings');
      expect(patterns).toContain('/setup');
    });

    it('should reference only valid category IDs', () => {
      const validIds = new Set(HELP_CATEGORIES.map((c) => c.id));
      for (const entry of URL_CATEGORY_MAP) {
        expect(validIds.has(entry.categoryId)).toBe(true);
      }
    });
  });
});
