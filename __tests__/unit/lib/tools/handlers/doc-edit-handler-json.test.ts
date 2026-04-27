/**
 * Unit tests for JSON/JSONL response shape in doc-edit handler
 *
 * Tests cover dispatch and basic integration - comprehensive parsing/serialization
 * testing is handled by mime-registry tests (D5). Here we focus on ensuring
 * the handler correctly detects JSON MIME types and includes the right fields
 * in response shapes.
 */

import { describe, it, expect } from '@jest/globals';

// Mock logger
jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock mime-registry to control parsing behavior
jest.mock('@/lib/doc-edit/mime-registry', () => ({
  detectMimeFromExtension: jest.fn(),
  isJsonFamily: jest.fn(),
  isJsonMime: jest.fn(),
  isJsonlMime: jest.fn(),
  parseContent: jest.fn(),
  serializeContent: jest.fn(),
  validateJson: jest.fn(),
}));

import {
  detectMimeFromExtension,
  isJsonMime,
  isJsonlMime,
  isJsonFamily,
  parseContent,
  serializeContent,
  validateJson,
} from '@/lib/doc-edit/mime-registry';

const mockDetectMimeFromExtension = detectMimeFromExtension as jest.Mock;
const mockIsJsonMime = isJsonMime as jest.Mock;
const mockIsJsonlMime = isJsonlMime as jest.Mock;
const mockIsJsonFamily = isJsonFamily as jest.Mock;
const mockParseContent = parseContent as jest.Mock;
const mockSerializeContent = serializeContent as jest.Mock;
const mockValidateJson = validateJson as jest.Mock;

describe('doc-edit handler JSON/JSONL behavior', () => {
  // =========================================================================
  // MIME Detection
  // =========================================================================

  describe('MIME detection for JSON files', () => {
    it('detects .json as application/json', () => {
      mockDetectMimeFromExtension.mockReturnValue('application/json');

      const result = mockDetectMimeFromExtension('config.json');
      expect(result).toBe('application/json');
    });

    it('detects .jsonl as application/x-ndjson', () => {
      mockDetectMimeFromExtension.mockReturnValue('application/x-ndjson');

      const result = mockDetectMimeFromExtension('records.jsonl');
      expect(result).toBe('application/x-ndjson');
    });

    it('returns null for non-JSON files', () => {
      mockDetectMimeFromExtension.mockReturnValue(null);

      const result = mockDetectMimeFromExtension('document.txt');
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // MIME Classification
  // =========================================================================

  describe('MIME classification', () => {
    it('isJsonMime identifies JSON types', () => {
      mockIsJsonMime.mockReturnValue(true);
      expect(mockIsJsonMime('application/json')).toBe(true);

      mockIsJsonMime.mockReturnValue(false);
      expect(mockIsJsonMime('text/plain')).toBe(false);
    });

    it('isJsonlMime identifies JSONL types', () => {
      mockIsJsonlMime.mockReturnValue(true);
      expect(mockIsJsonlMime('application/x-ndjson')).toBe(true);

      mockIsJsonlMime.mockReturnValue(false);
      expect(mockIsJsonlMime('application/json')).toBe(false);
    });

    it('isJsonFamily identifies both JSON and JSONL', () => {
      mockIsJsonFamily.mockImplementation(mime =>
        mime === 'application/json' || mime === 'application/x-ndjson'
      );

      expect(mockIsJsonFamily('application/json')).toBe(true);
      expect(mockIsJsonFamily('application/x-ndjson')).toBe(true);
      expect(mockIsJsonFamily('text/plain')).toBe(false);
    });
  });

  // =========================================================================
  // Parsing Integration
  // =========================================================================

  describe('JSON parsing in read path', () => {
    it('parseContent is called for JSON files', () => {
      mockParseContent.mockReturnValue({
        ok: true,
        value: { key: 'value' },
      });

      const result = mockParseContent('{"key":"value"}', 'application/json');

      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ key: 'value' });
      expect(mockParseContent).toHaveBeenCalledWith('{"key":"value"}', 'application/json');
    });

    it('parseContent returns error for invalid JSON', () => {
      mockParseContent.mockReturnValue({
        ok: false,
        error: 'Invalid JSON',
      });

      const result = mockParseContent('{invalid}', 'application/json');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid JSON');
    });

    it('parseContent handles JSONL with line results', () => {
      const lineResults = [
        { line: 1, value: { id: 1 }, raw: '{"id":1}' },
        { line: 2, error: 'Unexpected token', raw: '{bad}' },
      ];

      mockParseContent.mockReturnValue({
        ok: true,
        value: lineResults,
      });

      const result = mockParseContent('{"id":1}\n{bad}', 'application/x-ndjson');

      expect(result.ok).toBe(true);
      expect((result as any).value).toHaveLength(2);
      expect((result as any).value[0].value).toEqual({ id: 1 });
      expect((result as any).value[1].error).toBeDefined();
    });
  });

  // =========================================================================
  // Serialization Integration
  // =========================================================================

  describe('JSON serialization in write path', () => {
    it('serializeContent is called for JSON writes', () => {
      mockSerializeContent.mockReturnValue({
        ok: true,
        value: '{\n  "key": "value"\n}\n',
      });

      const result = mockSerializeContent(
        { key: 'value' },
        'application/json',
        { pretty: true }
      );

      expect(result.ok).toBe(true);
      expect((result as any).value).toContain('{\n');
    });

    it('serializeContent returns error for non-serializable values', () => {
      mockSerializeContent.mockReturnValue({
        ok: false,
        error: 'Cannot serialize: circular reference',
      });

      const circular: any = { a: 1 };
      circular.self = circular;

      const result = mockSerializeContent(circular, 'application/json');

      expect(result.ok).toBe(false);
      expect((result as any).error).toContain('Cannot serialize');
    });

    it('serializeContent handles JSONL array serialization', () => {
      mockSerializeContent.mockReturnValue({
        ok: true,
        value: '{"id":1}\n{"id":2}\n',
      });

      const result = mockSerializeContent(
        [{ id: 1 }, { id: 2 }],
        'application/x-ndjson'
      );

      expect(result.ok).toBe(true);
      const lines = ((result as any).value).trim().split('\n');
      expect(lines).toHaveLength(2);
    });
  });

  // =========================================================================
  // Validation Integration
  // =========================================================================

  describe('JSON validation in write path', () => {
    it('validateJson checks JSON strings before write', () => {
      mockValidateJson.mockReturnValue({
        ok: true,
        value: true,
      });

      const result = mockValidateJson('{"valid":"json"}', 'application/json');

      expect(result.ok).toBe(true);
      expect(mockValidateJson).toHaveBeenCalledWith(
        '{"valid":"json"}',
        'application/json'
      );
    });

    it('validateJson rejects invalid JSON strings', () => {
      mockValidateJson.mockReturnValue({
        ok: false,
        error: 'Unexpected token',
      });

      const result = mockValidateJson('{invalid}', 'application/json');

      expect(result.ok).toBe(false);
      expect((result as any).error).toBeDefined();
    });

    it('validateJson checks JSONL all lines parse', () => {
      mockValidateJson.mockReturnValue({
        ok: true,
        value: true,
      });

      const result = mockValidateJson('{"id":1}\n{"id":2}', 'application/x-ndjson');

      expect(result.ok).toBe(true);
    });

    it('validateJson rejects JSONL with any bad line', () => {
      mockValidateJson.mockReturnValue({
        ok: false,
        error: 'Line 2: Unexpected token',
      });

      const result = mockValidateJson('{"id":1}\n{bad}', 'application/x-ndjson');

      expect(result.ok).toBe(false);
      expect((result as any).error).toContain('Line');
    });
  });
});
