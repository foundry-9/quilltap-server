/**
 * Tests for the AI Import Service helpers
 */

import { stripCodeFences, parseLLMJson, repairTruncatedJson } from '@/lib/services/ai-import.service';

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

  // ====================================================================
  // Regression: truncated JSON repair
  // ====================================================================

  describe('repairTruncatedJson', () => {
    it('returns valid JSON unchanged', () => {
      const input = '{"name": "Alice"}';
      expect(repairTruncatedJson(input)).toBe(input);
    });

    it('closes a single unclosed brace', () => {
      const input = '{"name": "Alice"';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      expect(JSON.parse(repaired)).toEqual({ name: 'Alice' });
    });

    it('closes multiple unclosed braces', () => {
      const input = '{"outer": {"inner": "value"';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      const parsed = JSON.parse(repaired);
      expect(parsed.outer.inner).toBe('value');
    });

    it('closes unclosed array bracket', () => {
      const input = '[1, 2, 3';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      expect(JSON.parse(repaired)).toEqual([1, 2, 3]);
    });

    it('closes mixed unclosed braces and brackets', () => {
      const input = '{"items": [{"name": "a"}, {"name": "b"';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      const parsed = JSON.parse(repaired);
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[1].name).toBe('b');
    });

    it('removes trailing comma before closing', () => {
      const input = '{"items": [1, 2,';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      expect(JSON.parse(repaired)).toEqual({ items: [1, 2] });
    });

    it('closes an unclosed string', () => {
      const input = '{"name": "Alice';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      expect(JSON.parse(repaired).name).toBe('Alice');
    });

    it('removes trailing key without value', () => {
      const input = '{"name": "Alice", "age":';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      expect(JSON.parse(repaired)).toEqual({ name: 'Alice' });
    });
  });

  describe('parseLLMJson truncation regression', () => {
    it('handles truncated JSON with missing closing braces', () => {
      const input = '{"behavioralPatterns": [{"pattern": "speaks softly", "evidence": "whispers", "frequency": "often"}], "summary": "The character is quiet"';
      const result = parseLLMJson<{ behavioralPatterns: Array<{ pattern: string }>; summary: string }>(input);
      expect(result.behavioralPatterns[0].pattern).toBe('speaks softly');
      expect(result.summary).toBe('The character is quiet');
    });

    it('handles truncated JSON array with missing closing bracket', () => {
      const input = '[{"field": "description", "proposedValue": "A quiet soul", "significance": 0.5}';
      const result = parseLLMJson<Array<{ field: string; proposedValue: string }>>(input);
      expect(result).toHaveLength(1);
      expect(result[0].field).toBe('description');
    });

    it('handles JSON wrapped in markdown code fences (```json)', () => {
      const input = '```json\n{"behavioralPatterns": [], "summary": "No patterns found"}\n```';
      const result = parseLLMJson<{ summary: string }>(input);
      expect(result.summary).toBe('No patterns found');
    });

    it('handles JSON wrapped in plain code fences (```)', () => {
      const input = '```\n[{"field": "personality", "proposedValue": "Bold"}]\n```';
      const result = parseLLMJson<Array<{ field: string }>>(input);
      expect(result[0].field).toBe('personality');
    });

    it('handles truncated JSON inside markdown code fences', () => {
      const input = '```json\n{"patterns": [{"name": "verbose"';
      const result = parseLLMJson<{ patterns: Array<{ name: string }> }>(input);
      expect(result.patterns[0].name).toBe('verbose');
    });
  });
});
