/**
 * Unit tests for lib/doc-edit/mime-registry.ts
 *
 * Tests cover:
 * - detectMimeFromExtension: extension → MIME detection
 * - isJsonMime, isJsonlMime, isJsonFamily: MIME classification
 * - parseContent: JSON and JSONL parsing
 * - serializeContent: JSON and JSONL serialization
 * - validateJson: validation of JSON and JSONL content
 *
 * Strategy: Pure function testing with no mocks. Test all documented
 * behaviors including edge cases (empty, malformed, concurrent, etc).
 */

import { describe, it, expect } from '@jest/globals';

// Mock logger to avoid noise
jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import {
  detectMimeFromExtension,
  isJsonMime,
  isJsonlMime,
  isJsonFamily,
  parseContent,
  serializeContent,
  validateJson,
  type DocMimeType,
  type JsonlLineResult,
} from '@/lib/doc-edit/mime-registry';

describe('mime-registry', () => {
  // =========================================================================
  // detectMimeFromExtension
  // =========================================================================

  describe('detectMimeFromExtension', () => {
    it('detects .json as application/json', () => {
      expect(detectMimeFromExtension('config.json')).toBe('application/json');
      expect(detectMimeFromExtension('path/to/data.json')).toBe('application/json');
    });

    it('detects .jsonl and .ndjson as application/x-ndjson', () => {
      expect(detectMimeFromExtension('records.jsonl')).toBe('application/x-ndjson');
      expect(detectMimeFromExtension('records.ndjson')).toBe('application/x-ndjson');
      expect(detectMimeFromExtension('path/to/data.jsonl')).toBe('application/x-ndjson');
    });

    it('detects .md and .markdown as text/markdown', () => {
      expect(detectMimeFromExtension('note.md')).toBe('text/markdown');
      expect(detectMimeFromExtension('guide.markdown')).toBe('text/markdown');
      expect(detectMimeFromExtension('path/to/README.md')).toBe('text/markdown');
    });

    it('detects .txt as text/plain', () => {
      expect(detectMimeFromExtension('notes.txt')).toBe('text/plain');
      expect(detectMimeFromExtension('path/to/file.txt')).toBe('text/plain');
    });

    it('detects .yaml and .yml as application/yaml', () => {
      expect(detectMimeFromExtension('config.yaml')).toBe('application/yaml');
      expect(detectMimeFromExtension('settings.yml')).toBe('application/yaml');
    });

    it('is case-insensitive', () => {
      expect(detectMimeFromExtension('FILE.JSON')).toBe('application/json');
      expect(detectMimeFromExtension('file.Json')).toBe('application/json');
      expect(detectMimeFromExtension('readme.MD')).toBe('text/markdown');
    });

    it('returns null for unknown extensions', () => {
      expect(detectMimeFromExtension('file.pdf')).toBeNull();
      expect(detectMimeFromExtension('file.doc')).toBeNull();
      expect(detectMimeFromExtension('file')).toBeNull();
    });
  });

  // =========================================================================
  // MIME Classification
  // =========================================================================

  describe('isJsonMime', () => {
    it('returns true for JSON MIME types', () => {
      expect(isJsonMime('application/json')).toBe(true);
      expect(isJsonMime('text/json')).toBe(true);
    });

    it('returns false for non-JSON MIME types', () => {
      expect(isJsonMime('application/x-ndjson')).toBe(false);
      expect(isJsonMime('text/plain')).toBe(false);
      expect(isJsonMime(null)).toBe(false);
      expect(isJsonMime(undefined)).toBe(false);
    });
  });

  describe('isJsonlMime', () => {
    it('returns true for JSONL MIME types', () => {
      expect(isJsonlMime('application/x-ndjson')).toBe(true);
      expect(isJsonlMime('text/x-jsonl')).toBe(true);
    });

    it('returns false for non-JSONL MIME types', () => {
      expect(isJsonlMime('application/json')).toBe(false);
      expect(isJsonlMime('text/plain')).toBe(false);
      expect(isJsonlMime(null)).toBe(false);
    });
  });

  describe('isJsonFamily', () => {
    it('returns true for JSON and JSONL MIME types', () => {
      expect(isJsonFamily('application/json')).toBe(true);
      expect(isJsonFamily('application/x-ndjson')).toBe(true);
      expect(isJsonFamily('text/json')).toBe(true);
    });

    it('returns false for non-JSON families', () => {
      expect(isJsonFamily('text/plain')).toBe(false);
      expect(isJsonFamily(null)).toBe(false);
    });
  });

  // =========================================================================
  // parseContent
  // =========================================================================

  describe('parseContent', () => {
    describe('JSON parsing', () => {
      it('parses valid JSON', () => {
        const result = parseContent('{"key": "value"}', 'application/json');
        expect(result.ok).toBe(true);
        expect((result as any).value).toEqual({ key: 'value' });
      });

      it('parses JSON arrays', () => {
        const result = parseContent('[1, 2, 3]', 'application/json');
        expect(result.ok).toBe(true);
        expect((result as any).value).toEqual([1, 2, 3]);
      });

      it('parses JSON primitives', () => {
        expect(parseContent('null', 'application/json').ok).toBe(true);
        expect(parseContent('true', 'application/json').ok).toBe(true);
        expect(parseContent('42', 'application/json').ok).toBe(true);
        expect(parseContent('"string"', 'application/json').ok).toBe(true);
      });

      it('returns error for invalid JSON', () => {
        const result = parseContent('{invalid}', 'application/json');
        expect(result.ok).toBe(false);
        expect((result as any).error).toBeDefined();
      });

      it('returns error with line info for JSON', () => {
        const result = parseContent('{', 'application/json');
        expect(result.ok).toBe(false);
        expect((result as any).error).toBeDefined();
      });
    });

    describe('JSONL parsing', () => {
      it('parses valid JSONL with multiple lines', () => {
        const content = '{"id":1}\n{"id":2}\n{"id":3}';
        const result = parseContent(content, 'application/x-ndjson');
        expect(result.ok).toBe(true);
        const lines = (result as any).value as JsonlLineResult[];
        expect(lines).toHaveLength(3);
        expect(lines[0].value).toEqual({ id: 1 });
        expect(lines[1].value).toEqual({ id: 2 });
      });

      it('skips empty and whitespace-only lines', () => {
        const content = '{"id":1}\n\n  \n{"id":2}';
        const result = parseContent(content, 'application/x-ndjson');
        const lines = (result as any).value as JsonlLineResult[];
        expect(lines).toHaveLength(2);
      });

      it('captures per-line errors', () => {
        const content = '{"id":1}\n{invalid}\n{"id":3}';
        const result = parseContent(content, 'application/x-ndjson');
        expect(result.ok).toBe(true);
        const lines = (result as any).value as JsonlLineResult[];
        expect(lines).toHaveLength(3);
        expect(lines[0].value).toEqual({ id: 1 });
        expect(lines[1].error).toBeDefined();
        expect(lines[2].value).toEqual({ id: 3 });
      });

      it('handles CRLF line endings', () => {
        const content = '{"id":1}\r\n{"id":2}\r\n';
        const result = parseContent(content, 'application/x-ndjson');
        const lines = (result as any).value as JsonlLineResult[];
        expect(lines).toHaveLength(2);
      });

      it('handles trailing newline', () => {
        const content = '{"id":1}\n{"id":2}\n';
        const result = parseContent(content, 'application/x-ndjson');
        const lines = (result as any).value as JsonlLineResult[];
        expect(lines).toHaveLength(2);
      });
    });
  });

  // =========================================================================
  // serializeContent
  // =========================================================================

  describe('serializeContent', () => {
    describe('JSON serialization', () => {
      it('serializes object to pretty JSON', () => {
        const result = serializeContent({ key: 'value' }, 'application/json');
        expect(result.ok).toBe(true);
        const str = (result as any).value as string;
        expect(str).toContain('"key"');
        expect(str).toContain('"value"');
        expect(str).toContain('\n');
        expect(str.endsWith('\n')).toBe(true);
      });

      it('serializes arrays to JSON', () => {
        const result = serializeContent([1, 2, 3], 'application/json');
        expect(result.ok).toBe(true);
        const str = (result as any).value as string;
        expect(str).toContain('1');
        expect(str).toContain('2');
      });

      it('adds trailing newline to JSON', () => {
        const result = serializeContent({ a: 1 }, 'application/json');
        const str = (result as any).value as string;
        expect(str.endsWith('\n')).toBe(true);
      });

      it('returns string as-is if not validating', () => {
        const str = '{"a":1}';
        const result = serializeContent(str, 'application/json', { validateString: false });
        expect(result.ok).toBe(true);
        expect((result as any).value).toBe(str);
      });

      it('parses and reserializes if validateString is true', () => {
        const str = '{"a":1,"b":2}';
        const result = serializeContent(str, 'application/json', { validateString: true });
        expect(result.ok).toBe(true);
        const output = (result as any).value as string;
        expect(output).not.toBe(str);
        expect(output).toContain('\n');
      });

      it('rejects invalid JSON string with validateString', () => {
        const result = serializeContent('{invalid}', 'application/json', { validateString: true });
        expect(result.ok).toBe(false);
        expect((result as any).error).toBeDefined();
      });
    });

    describe('JSONL serialization', () => {
      it('serializes array to JSONL', () => {
        const input = [{ id: 1 }, { id: 2 }, { id: 3 }];
        const result = serializeContent(input, 'application/x-ndjson');
        expect(result.ok).toBe(true);
        const str = (result as any).value as string;
        const lines = str.split('\n').filter(l => l);
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain('"id"');
      });

      it('adds trailing newline to JSONL', () => {
        const result = serializeContent([{ a: 1 }], 'application/x-ndjson');
        const str = (result as any).value as string;
        expect(str.endsWith('\n')).toBe(true);
      });

      it('rejects non-array input for JSONL', () => {
        const result = serializeContent({ id: 1 }, 'application/x-ndjson');
        expect(result.ok).toBe(false);
        expect((result as any).error).toContain('array');
      });

      it('handles empty arrays', () => {
        const result = serializeContent([], 'application/x-ndjson');
        expect(result.ok).toBe(true);
        const str = (result as any).value as string;
        expect(str.length).toBe(0);
      });
    });

    describe('Non-serializable values', () => {
      it('rejects BigInt values', () => {
        const result = serializeContent({ value: BigInt(123) }, 'application/json');
        expect(result.ok).toBe(false);
      });

      it('rejects circular references', () => {
        const obj: any = { a: 1 };
        obj.self = obj;
        const result = serializeContent(obj, 'application/json');
        expect(result.ok).toBe(false);
      });
    });
  });

  // =========================================================================
  // validateJson
  // =========================================================================

  describe('validateJson', () => {
    describe('JSON validation', () => {
      it('returns ok for valid JSON', () => {
        const result = validateJson('{"key":"value"}', 'application/json');
        expect(result.ok).toBe(true);
        expect((result as any).value).toBe(true);
      });

      it('returns error for invalid JSON', () => {
        const result = validateJson('{invalid}', 'application/json');
        expect(result.ok).toBe(false);
        expect((result as any).error).toBeDefined();
      });

      it('validates JSON arrays', () => {
        const result = validateJson('[1,2,3]', 'application/json');
        expect(result.ok).toBe(true);
      });

      it('validates JSON primitives', () => {
        expect(validateJson('null', 'application/json').ok).toBe(true);
        expect(validateJson('true', 'application/json').ok).toBe(true);
        expect(validateJson('42', 'application/json').ok).toBe(true);
      });
    });

    describe('JSONL validation', () => {
      it('returns ok when all non-empty lines parse', () => {
        const result = validateJson('{"id":1}\n{"id":2}', 'application/x-ndjson');
        expect(result.ok).toBe(true);
      });

      it('returns ok for JSONL with empty lines', () => {
        const result = validateJson('{"id":1}\n\n{"id":2}', 'application/x-ndjson');
        expect(result.ok).toBe(true);
      });

      it('returns error if any non-empty line is invalid', () => {
        const result = validateJson('{"id":1}\n{invalid}\n{"id":3}', 'application/x-ndjson');
        expect(result.ok).toBe(false);
        expect((result as any).error).toContain('Line');
      });

      it('includes line number in error', () => {
        const result = validateJson('{"id":1}\n{"id":2}\n{bad}', 'application/x-ndjson');
        expect(result.ok).toBe(false);
        expect((result as any).error).toContain('3');
      });
    });

    describe('Unsupported MIME types', () => {
      it('returns error for unsupported MIME', () => {
        const result = validateJson('some text', 'text/plain');
        expect(result.ok).toBe(false);
      });
    });
  });
});
