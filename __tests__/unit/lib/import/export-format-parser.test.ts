/**
 * Unit Tests for Export Format Parser
 * Tests lib/import/quilltap-import-service.ts - parseExportFile and validateExportFormat functions
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  createMockQuilltapExport,
  createMockExportManifest,
  createMockExportedCharacter,
  createMockExportedChat,
  createMockTag,
  createMockSanitizedConnectionProfile,
  generateId,
} from '../fixtures/test-factories';

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// Import after mocking
import {
  parseExportFile,
  validateExportFormat,
} from '@/lib/import/quilltap-import-service';

describe('Export Format Parser', () => {
  // ============================================================================
  // parseExportFile() Tests
  // ============================================================================

  describe('parseExportFile()', () => {
    it('should parse valid JSON export with minimal data', () => {
      const exportData = createMockQuilltapExport();
      const jsonString = JSON.stringify(exportData);

      const result = parseExportFile(jsonString);

      expect(result).toEqual(exportData);
      expect(result.manifest.format).toBe('quilltap-export');
      expect(result.manifest.version).toBe('1.0');
    });

    it('should parse export with multiple characters', () => {
      const characters = [
        createMockExportedCharacter({ name: 'Character 1' }),
        createMockExportedCharacter({ name: 'Character 2' }),
        createMockExportedCharacter({ name: 'Character 3' }),
      ];
      const exportData = createMockQuilltapExport();
      exportData.data = { characters };
      const jsonString = JSON.stringify(exportData);

      const result = parseExportFile(jsonString);

      expect(result.data.characters).toHaveLength(3);
      expect(result.data.characters?.[0].name).toBe('Character 1');
      expect(result.data.characters?.[2].name).toBe('Character 3');
    });

    it('should parse export with chats and tags', () => {
      const chats = [createMockExportedChat()];
      const tags = [createMockTag({ name: 'Adventure' })];
      const exportData = createMockQuilltapExport();
      exportData.data = { chats, tags };
      const jsonString = JSON.stringify(exportData);

      const result = parseExportFile(jsonString);

      expect(result.data.chats).toHaveLength(1);
      expect(result.data.tags).toHaveLength(1);
      expect(result.data.tags?.[0].name).toBe('Adventure');
    });

    it('should parse export with connection profiles', () => {
      const connectionProfiles = [
        createMockSanitizedConnectionProfile({ name: 'GPT-4' }),
        createMockSanitizedConnectionProfile({ name: 'Claude' }),
      ];
      const exportData = createMockQuilltapExport();
      exportData.data = { connectionProfiles };
      const jsonString = JSON.stringify(exportData);

      const result = parseExportFile(jsonString);

      expect(result.data.connectionProfiles).toHaveLength(2);
      expect(result.data.connectionProfiles?.[0].name).toBe('GPT-4');
    });

    it('should parse export with custom manifest metadata', () => {
      const manifest = createMockExportManifest({
        exportedBy: 'test-user-123',
        exportedAt: '2026-01-15T12:00:00.000Z',
      });
      const exportData = createMockQuilltapExport({ manifest });
      const jsonString = JSON.stringify(exportData);

      const result = parseExportFile(jsonString);

      expect(result.manifest.exportedBy).toBe('test-user-123');
      expect(result.manifest.exportedAt).toBe('2026-01-15T12:00:00.000Z');
    });

    it('should throw error for invalid JSON', () => {
      const invalidJson = '{ invalid json structure';

      expect(() => parseExportFile(invalidJson)).toThrow('Invalid export file');
    });

    it('should throw error for malformed JSON with trailing comma', () => {
      const malformedJson = '{"manifest": {"format": "quilltap-export",},}';

      expect(() => parseExportFile(malformedJson)).toThrow();
    });

    it('should throw error for empty string', () => {
      expect(() => parseExportFile('')).toThrow('Invalid export file');
    });

    it('should throw error for non-JSON string', () => {
      expect(() => parseExportFile('not json at all')).toThrow('Invalid export file');
    });

    it('should throw error for valid JSON but invalid format', () => {
      const invalidFormat = JSON.stringify({
        manifest: { format: 'wrong-format', version: '1.0' },
        data: {},
      });

      expect(() => parseExportFile(invalidFormat)).toThrow('Invalid format');
    });
  });

  // ============================================================================
  // validateExportFormat() Tests
  // ============================================================================

  describe('validateExportFormat()', () => {
    it('should validate correct export format', () => {
      const validExport = createMockQuilltapExport();

      expect(() => validateExportFormat(validExport)).not.toThrow();
    });

    it('should throw error for null data', () => {
      expect(() => validateExportFormat(null)).toThrow(
        'Export data must be a JSON object'
      );
    });

    it('should throw error for undefined data', () => {
      expect(() => validateExportFormat(undefined)).toThrow(
        'Export data must be a JSON object'
      );
    });

    it('should throw error for non-object data', () => {
      expect(() => validateExportFormat('string')).toThrow(
        'Export data must be a JSON object'
      );
      expect(() => validateExportFormat(123)).toThrow(
        'Export data must be a JSON object'
      );
      // Note: Arrays are typeof 'object' in JavaScript, so they pass the first check
      // but fail on manifest validation
      expect(() => validateExportFormat([])).toThrow(
        'Missing or invalid manifest'
      );
    });

    it('should throw error for missing manifest', () => {
      const noManifest = { data: {} };

      expect(() => validateExportFormat(noManifest)).toThrow(
        'Missing or invalid manifest'
      );
    });

    it('should throw error for null manifest', () => {
      const nullManifest = { manifest: null, data: {} };

      expect(() => validateExportFormat(nullManifest)).toThrow(
        'Missing or invalid manifest'
      );
    });

    it('should throw error for non-object manifest', () => {
      const stringManifest = { manifest: 'not an object', data: {} };

      expect(() => validateExportFormat(stringManifest)).toThrow(
        'Missing or invalid manifest'
      );
    });

    it('should throw error for wrong format identifier', () => {
      const wrongFormat = {
        manifest: { format: 'sillytavern-export', version: '1.0' },
        data: {},
      };

      expect(() => validateExportFormat(wrongFormat)).toThrow(
        "Invalid format: expected 'quilltap-export', got 'sillytavern-export'"
      );
    });

    it('should throw error for missing format field', () => {
      const noFormat = {
        manifest: { version: '1.0' },
        data: {},
      };

      expect(() => validateExportFormat(noFormat)).toThrow('Invalid format');
    });

    it('should throw error for unsupported version', () => {
      const wrongVersion = {
        manifest: { format: 'quilltap-export', version: '2.0' },
        data: {},
      };

      expect(() => validateExportFormat(wrongVersion)).toThrow(
        'Unsupported version: 2.0. Only 1.0 is supported.'
      );
    });

    it('should throw error for version 0.9', () => {
      const oldVersion = {
        manifest: { format: 'quilltap-export', version: '0.9' },
        data: {},
      };

      expect(() => validateExportFormat(oldVersion)).toThrow('Unsupported version');
    });

    it('should throw error for missing version', () => {
      const noVersion = {
        manifest: { format: 'quilltap-export' },
        data: {},
      };

      expect(() => validateExportFormat(noVersion)).toThrow('Unsupported version');
    });

    it('should throw error for missing data section', () => {
      const noData = {
        manifest: { format: 'quilltap-export', version: '1.0' },
      };

      expect(() => validateExportFormat(noData)).toThrow(
        'Missing or invalid data section'
      );
    });

    it('should throw error for null data section', () => {
      const nullData = {
        manifest: { format: 'quilltap-export', version: '1.0' },
        data: null,
      };

      expect(() => validateExportFormat(nullData)).toThrow(
        'Missing or invalid data section'
      );
    });

    it('should accept data with empty object (arrays are valid)', () => {
      const emptyData = {
        manifest: { format: 'quilltap-export', version: '1.0' },
        data: {},
      };

      expect(() => validateExportFormat(emptyData)).not.toThrow();
    });

    it('should accept data section as array (JavaScript quirk)', () => {
      // In JavaScript, arrays pass typeof === 'object' check
      // This documents actual behavior, not necessarily desired behavior
      const arrayData = {
        manifest: { format: 'quilltap-export', version: '1.0' },
        data: [],
      };

      expect(() => validateExportFormat(arrayData)).not.toThrow();
    });

    it('should accept data with empty arrays', () => {
      const emptyData = {
        manifest: { format: 'quilltap-export', version: '1.0' },
        data: { characters: [], chats: [], tags: [] },
      };

      expect(() => validateExportFormat(emptyData)).not.toThrow();
    });

    it('should accept data with populated arrays', () => {
      const exportData = createMockQuilltapExport({
        data: {
          characters: [createMockExportedCharacter()],
          chats: [createMockExportedChat()],
          tags: [createMockTag()],
        },
      });

      expect(() => validateExportFormat(exportData)).not.toThrow();
    });
  });
});
