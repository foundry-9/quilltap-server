/**
 * Tests for the AI Import Service helpers
 */

import { stripCodeFences, parseLLMJson } from '@/lib/services/ai-import.service';

describe('ai-import.service', () => {
  describe('stripCodeFences', () => {
    it('strips ```json ... ``` fences', () => {
      const input = '```json\n{"name": "Test"}\n```';
      expect(stripCodeFences(input)).toBe('{"name": "Test"}');
    });

    it('strips ``` ... ``` fences without language hint', () => {
      const input = '```\n{"name": "Test"}\n```';
      expect(stripCodeFences(input)).toBe('{"name": "Test"}');
    });

    it('returns plain JSON unchanged', () => {
      const input = '{"name": "Test"}';
      expect(stripCodeFences(input)).toBe('{"name": "Test"}');
    });

    it('trims surrounding whitespace', () => {
      const input = '  \n{"name": "Test"}\n  ';
      expect(stripCodeFences(input)).toBe('{"name": "Test"}');
    });

    it('handles empty string', () => {
      expect(stripCodeFences('')).toBe('');
    });

    it('handles fences with extra content after language hint', () => {
      const input = '```json\n[{"a": 1}, {"b": 2}]\n```';
      expect(stripCodeFences(input)).toBe('[{"a": 1}, {"b": 2}]');
    });
  });

  describe('parseLLMJson', () => {
    it('parses plain JSON object', () => {
      const result = parseLLMJson<{ name: string }>('{"name": "Test"}');
      expect(result).toEqual({ name: 'Test' });
    });

    it('parses JSON array', () => {
      const result = parseLLMJson<number[]>('[1, 2, 3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('parses JSON with code fences', () => {
      const result = parseLLMJson<{ name: string }>('```json\n{"name": "Test"}\n```');
      expect(result).toEqual({ name: 'Test' });
    });

    it('throws on invalid JSON', () => {
      expect(() => parseLLMJson('not json at all')).toThrow();
    });

    it('throws on empty string', () => {
      expect(() => parseLLMJson('')).toThrow();
    });

    it('parses nested objects', () => {
      const input = '```json\n{"character": {"name": "Alice", "traits": ["brave", "kind"]}}\n```';
      const result = parseLLMJson<{ character: { name: string; traits: string[] } }>(input);
      expect(result.character.name).toBe('Alice');
      expect(result.character.traits).toEqual(['brave', 'kind']);
    });

    it('handles JSON with unicode characters', () => {
      const result = parseLLMJson<{ name: string }>('{"name": "Ren\\u00e9e"}');
      expect(result.name).toBe('Ren\u00e9e');
    });
  });
});
