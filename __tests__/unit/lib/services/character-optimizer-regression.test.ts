/**
 * Regression tests for Character Optimizer edge cases
 *
 * Covers:
 * - BehavioralPattern with undefined/null frequency values
 * - Characters with no talkativeness data
 * - Per-item suggestion prompts' resilience to malformed analysis data
 */

import {
  buildCharacterContext,
  getGeneralFieldsSuggestionsPrompt,
} from '@/lib/services/character-optimizer.service';
import { createMockCharacter } from '../fixtures/test-factories';
import type { OptimizerAnalysis, BehavioralPattern } from '@/lib/services/character-optimizer.service';

describe('Character Optimizer regression', () => {
  describe('frequency handling in behavioral patterns', () => {
    it('suggestion prompt handles undefined frequency without crashing', () => {
      const analysis: OptimizerAnalysis = {
        behavioralPatterns: [
          {
            pattern: 'Uses formal language',
            evidence: 'Always says "Good day"',
            frequency: undefined as unknown as string,
          },
        ],
        summary: 'The character is formal.',
      };

      // Must not throw — the prompt is built via JSON.stringify which handles undefined
      expect(() => getGeneralFieldsSuggestionsPrompt(analysis)).not.toThrow();
      const result = getGeneralFieldsSuggestionsPrompt(analysis);
      expect(result).toContain('Uses formal language');
      expect(result).toContain('The character is formal.');
    });

    it('suggestion prompt handles null frequency without crashing', () => {
      const analysis: OptimizerAnalysis = {
        behavioralPatterns: [
          {
            pattern: 'Speaks in riddles',
            evidence: 'Never gives a straight answer',
            frequency: null as unknown as string,
          },
        ],
        summary: 'The character is cryptic.',
      };

      expect(() => getGeneralFieldsSuggestionsPrompt(analysis)).not.toThrow();
      const result = getGeneralFieldsSuggestionsPrompt(analysis);
      expect(result).toContain('Speaks in riddles');
    });

    it('suggestion prompt handles empty string frequency', () => {
      const analysis: OptimizerAnalysis = {
        behavioralPatterns: [
          {
            pattern: 'Laughs nervously',
            evidence: 'Giggles in tense situations',
            frequency: '',
          },
        ],
        summary: 'Nervous character.',
      };

      expect(() => getGeneralFieldsSuggestionsPrompt(analysis)).not.toThrow();
    });

    it('suggestion prompt handles mixed valid and undefined frequencies', () => {
      const analysis: OptimizerAnalysis = {
        behavioralPatterns: [
          {
            pattern: 'Speaks softly',
            evidence: 'Whispers in conversations',
            frequency: 'Very often',
          },
          {
            pattern: 'Fidgets with hands',
            evidence: 'Always moving fingers',
            frequency: undefined as unknown as string,
          },
          {
            pattern: 'Avoids eye contact',
            evidence: 'Looks away during dialogue',
            frequency: null as unknown as string,
          },
        ],
        summary: 'An anxious and introverted character.',
      };

      expect(() => getGeneralFieldsSuggestionsPrompt(analysis)).not.toThrow();
      const result = getGeneralFieldsSuggestionsPrompt(analysis);
      expect(result).toContain('Speaks softly');
      expect(result).toContain('Fidgets with hands');
      expect(result).toContain('Avoids eye contact');
    });

    it('suggestion prompt handles empty behavioralPatterns array', () => {
      const analysis: OptimizerAnalysis = {
        behavioralPatterns: [],
        summary: 'No patterns detected.',
      };

      expect(() => getGeneralFieldsSuggestionsPrompt(analysis)).not.toThrow();
      const result = getGeneralFieldsSuggestionsPrompt(analysis);
      expect(result).toContain('No patterns detected.');
    });
  });

  describe('talkativeness edge cases in buildCharacterContext', () => {
    it('handles undefined talkativeness without crashing', () => {
      const character = createMockCharacter({
        talkativeness: undefined as unknown as number,
      });

      expect(() => buildCharacterContext(character)).not.toThrow();
      const result = buildCharacterContext(character);
      expect(result).toContain('Talkativeness:');
    });

    it('handles null talkativeness without crashing', () => {
      const character = createMockCharacter({
        talkativeness: null as unknown as number,
      });

      expect(() => buildCharacterContext(character)).not.toThrow();
      const result = buildCharacterContext(character);
      expect(result).toContain('Talkativeness:');
    });

    it('handles zero talkativeness correctly', () => {
      const character = createMockCharacter({ talkativeness: 0 });
      const result = buildCharacterContext(character);
      expect(result).toContain('Talkativeness: 0');
    });

    it('handles normal talkativeness values', () => {
      const character = createMockCharacter({ talkativeness: 0.8 });
      const result = buildCharacterContext(character);
      expect(result).toContain('Talkativeness: 0.8');
    });

    it('character with no optional fields does not cause optimizer helpers to fail', () => {
      const character = createMockCharacter({
        name: 'Minimal Character',
        description: null,
        personality: null,
        scenarios: [],
        exampleDialogues: null,
        systemPrompts: [],
        physicalDescriptions: [],
        clothingRecords: [],
        talkativeness: undefined as unknown as number,
      });

      expect(() => buildCharacterContext(character)).not.toThrow();
      const result = buildCharacterContext(character);
      expect(result).toContain('=== Character: Minimal Character ===');
      // Should show (empty) for all missing fields
      expect(result).toContain('(empty)');
    });
  });
});
