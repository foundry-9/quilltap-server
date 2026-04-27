/**
 * Unit Tests for Memory Gate
 * Tests lib/memory/memory-gate.ts
 *
 * Covers:
 * - extractNovelDetails() — deterministic regex-based novel detail extraction
 * - calculateReinforcedImportance() — reinforced importance formula
 * - Type structure verification for GateDecision, GateResult, MemoryGateOutcome
 * - Exported constants MERGE_THRESHOLD, RELATED_THRESHOLD
 */

import { describe, it, expect } from '@jest/globals'
import {
  extractNovelDetails,
  calculateReinforcedImportance,
  MERGE_THRESHOLD,
  NEAR_DUPLICATE_THRESHOLD,
  RELATED_THRESHOLD,
  type GateDecision,
  type GateResult,
  type MemoryGateOutcome,
} from '@/lib/memory/memory-gate'
import type { Memory } from '@/lib/schemas/types'

// =============================================================================
// Test Fixtures
// =============================================================================

const makeMemory = (overrides: Partial<Memory> = {}): Memory => ({
  id: 'mem-test-001',
  characterId: 'char-test-001',
  content: 'Test memory content',
  summary: 'Test summary',
  keywords: ['test'],
  tags: [],
  importance: 0.5,
  embedding: null,
  source: 'AUTO',
  sourceMessageId: 'msg-001',
  lastAccessedAt: null,
  reinforcementCount: 1,
  lastReinforcedAt: null,
  relatedMemoryIds: [],
  reinforcedImportance: 0.5,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
})

// =============================================================================
// extractNovelDetails()
// =============================================================================

describe('extractNovelDetails', () => {
  it('extracts proper nouns absent from existing content', () => {
    const candidate = 'She went to Paris with Marcus.'
    const existing = 'She went somewhere.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toContain('Paris')
    expect(result).toContain('Marcus')
  })

  it('extracts numbers with context absent from existing content', () => {
    const candidate = 'He is 25 years old and has been there for 3 months.'
    const existing = 'He is a person.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toEqual(
      expect.arrayContaining([
        expect.stringContaining('25 years'),
      ])
    )
  })

  it('extracts dates absent from existing content', () => {
    const candidate = 'The event is on 2024-01-15 at the park.'
    const existing = 'The event is at the park.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toContain('2024-01-15')
  })

  it('extracts currency amounts absent from existing content', () => {
    const candidate = 'It costs $1,234.56 to repair.'
    const existing = 'It costs a lot to repair.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toContain('$1,234.56')
  })

  it('returns empty when no novel details exist', () => {
    const content = 'She went somewhere yesterday.'
    const result = extractNovelDetails(content, content)

    expect(result).toEqual([])
  })

  it('filters out stop words and single-letter words', () => {
    // "The" at sentence start is skipped by index 0 logic.
    // "and", "or", "with" etc. are stop words. "A" is single-letter.
    const candidate = 'The cat sat. A dog and the bird with it.'
    const existing = 'Nothing relevant.'
    const result = extractNovelDetails(candidate, existing)

    // None of these common words should appear as proper nouns
    expect(result).not.toContain('The')
    expect(result).not.toContain('A')
    expect(result).not.toContain('And')
  })

  it('handles sentence-initial capitalization correctly', () => {
    // Words at the start of a sentence should NOT be treated as proper nouns
    const candidate = 'Running is fun. Walking is good too.'
    const existing = 'Exercise is important.'
    const result = extractNovelDetails(candidate, existing)

    // "Running" and "Walking" are sentence-initial, should not be detected as proper nouns
    expect(result).not.toContain('Running')
    expect(result).not.toContain('Walking')
  })

  it('extracts CamelCase technical terms', () => {
    const candidate = 'She is using TypeScript and JavaScript for the project.'
    const existing = 'She is working on a project.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toContain('TypeScript')
    expect(result).toContain('JavaScript')
  })

  it('extracts acronyms', () => {
    const candidate = 'The FBI investigated the case with help from the CIA.'
    const existing = 'Someone investigated the case.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toContain('FBI')
    expect(result).toContain('CIA')
  })

  it('does not extract details already present in existing content', () => {
    const candidate = 'She went to Paris with Marcus on 2024-01-15.'
    const existing = 'She went to Paris with Marcus on 2024-01-15.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toEqual([])
  })

  it('handles empty candidate content', () => {
    const result = extractNovelDetails('', 'Some existing content.')
    expect(result).toEqual([])
  })

  it('handles empty existing content', () => {
    const candidate = 'She met Marcus in Paris.'
    const result = extractNovelDetails(candidate, '')

    expect(result).toContain('Marcus')
    expect(result).toContain('Paris')
  })
})

// =============================================================================
// calculateReinforcedImportance()
// =============================================================================

describe('calculateReinforcedImportance', () => {
  it('calculates correctly for reinforcementCount=1', () => {
    // base 0.5, count 1 -> 0.5 + log2(2) * 0.05 = 0.5 + 1 * 0.05 = 0.55
    const result = calculateReinforcedImportance(0.5, 1)
    expect(result).toBeCloseTo(0.55, 10)
  })

  it('calculates correctly for reinforcementCount=10 and stays below 1.0', () => {
    // base 0.5, count 10 -> 0.5 + log2(11) * 0.05 ~= 0.5 + 3.459 * 0.05 ~= 0.673
    const result = calculateReinforcedImportance(0.5, 10)
    expect(result).toBeCloseTo(0.5 + Math.log2(11) * 0.05, 10)
    expect(result).toBeLessThan(1.0)
  })

  it('caps at 1.0 for large count with high base importance', () => {
    // base 0.9, count 100 -> 0.9 + log2(101) * 0.05 ~= 0.9 + 6.658 * 0.05 ~= 1.233 -> capped at 1.0
    const result = calculateReinforcedImportance(0.9, 100)
    expect(result).toBe(1.0)
  })

  it('applies minimal boost for count of 0', () => {
    // base 0.5, count 0 -> 0.5 + log2(1) * 0.05 = 0.5 + 0 * 0.05 = 0.5
    const result = calculateReinforcedImportance(0.5, 0)
    expect(result).toBeCloseTo(0.5, 10)
  })

  it('handles base importance of 0', () => {
    // base 0, count 5 -> 0 + log2(6) * 0.05 ~= 0 + 2.585 * 0.05 ~= 0.129
    const result = calculateReinforcedImportance(0, 5)
    expect(result).toBeCloseTo(Math.log2(6) * 0.05, 10)
    expect(result).toBeGreaterThan(0)
  })

  it('handles base importance of 1.0 (already at cap)', () => {
    const result = calculateReinforcedImportance(1.0, 10)
    expect(result).toBe(1.0)
  })
})

// =============================================================================
// Type Structure Tests
// =============================================================================

describe('Type structure verification', () => {
  describe('GateDecision', () => {
    it('INSERT has action field and no extra fields', () => {
      const decision: GateDecision = { action: 'INSERT' }

      expect(decision.action).toBe('INSERT')
      expect(Object.keys(decision)).toEqual(['action'])
    })

    it('REINFORCE has existingMemory and similarity', () => {
      const memory = makeMemory()
      const decision: GateDecision = {
        action: 'REINFORCE',
        existingMemory: memory,
        similarity: 0.85,
      }

      expect(decision.action).toBe('REINFORCE')
      expect(decision.existingMemory).toBe(memory)
      expect(decision.similarity).toBe(0.85)
    })

    it('INSERT_RELATED has relatedMemories array', () => {
      const memory1 = makeMemory({ id: 'mem-1' })
      const memory2 = makeMemory({ id: 'mem-2' })
      const decision: GateDecision = {
        action: 'INSERT_RELATED',
        relatedMemories: [
          { memory: memory1, similarity: 0.75 },
          { memory: memory2, similarity: 0.72 },
        ],
      }

      expect(decision.action).toBe('INSERT_RELATED')
      expect(decision.relatedMemories).toHaveLength(2)
      expect(decision.relatedMemories[0].memory.id).toBe('mem-1')
      expect(decision.relatedMemories[0].similarity).toBe(0.75)
      expect(decision.relatedMemories[1].memory.id).toBe('mem-2')
    })

    it('SKIP_NEAR_DUPLICATE has existingMemory and similarity', () => {
      const memory = makeMemory()
      const decision: GateDecision = {
        action: 'SKIP_NEAR_DUPLICATE',
        existingMemory: memory,
        similarity: 0.93,
      }

      expect(decision.action).toBe('SKIP_NEAR_DUPLICATE')
      expect(decision.existingMemory).toBe(memory)
      expect(decision.similarity).toBe(0.93)
    })

    it('SKIP_EMBEDDING_FAILED has a reason string', () => {
      const decision: GateDecision = {
        action: 'SKIP_EMBEDDING_FAILED',
        reason: 'Embedding failed after retry: ECONNREFUSED',
      }

      expect(decision.action).toBe('SKIP_EMBEDDING_FAILED')
      expect(decision.reason).toContain('ECONNREFUSED')
    })
  })

  describe('GateResult', () => {
    it('has decision, embedding, and debugInfo', () => {
      const result: GateResult = {
        decision: { action: 'INSERT' },
        embedding: [0.1, 0.2, 0.3],
        debugInfo: ['[Gate] Generated embedding', '[Gate] No existing memories'],
      }

      expect(result.decision).toBeDefined()
      expect(result.decision.action).toBe('INSERT')
      expect(result.embedding).toEqual([0.1, 0.2, 0.3])
      expect(result.debugInfo).toHaveLength(2)
    })

    it('supports null embedding', () => {
      const result: GateResult = {
        decision: { action: 'INSERT' },
        embedding: null,
        debugInfo: ['[Gate/keyword] No candidate keywords'],
      }

      expect(result.embedding).toBeNull()
    })
  })

  describe('MemoryGateOutcome', () => {
    it('has memory, action, and optional novelDetails and relatedMemoryIds', () => {
      const memory = makeMemory()
      const outcome: MemoryGateOutcome = {
        memory,
        action: 'REINFORCE',
        novelDetails: ['Paris', 'Marcus'],
        relatedMemoryIds: ['mem-rel-1', 'mem-rel-2'],
      }

      expect(outcome.memory).toBe(memory)
      expect(outcome.action).toBe('REINFORCE')
      expect(outcome.novelDetails).toEqual(['Paris', 'Marcus'])
      expect(outcome.relatedMemoryIds).toEqual(['mem-rel-1', 'mem-rel-2'])
    })

    it('allows novelDetails and relatedMemoryIds to be undefined', () => {
      const memory = makeMemory()
      const outcome: MemoryGateOutcome = {
        memory,
        action: 'INSERT',
      }

      expect(outcome.novelDetails).toBeUndefined()
      expect(outcome.relatedMemoryIds).toBeUndefined()
    })

    it('supports SKIP_GATE action', () => {
      const memory = makeMemory()
      const outcome: MemoryGateOutcome = {
        memory,
        action: 'SKIP_GATE',
      }

      expect(outcome.action).toBe('SKIP_GATE')
    })

    it('supports INSERT_RELATED action with relatedMemoryIds', () => {
      const memory = makeMemory()
      const outcome: MemoryGateOutcome = {
        memory,
        action: 'INSERT_RELATED',
        relatedMemoryIds: ['mem-related-1'],
      }

      expect(outcome.action).toBe('INSERT_RELATED')
      expect(outcome.relatedMemoryIds).toEqual(['mem-related-1'])
    })

    it('supports SKIP_NEAR_DUPLICATE action with the absorbing memory and similarity', () => {
      const memory = makeMemory()
      const outcome: MemoryGateOutcome = {
        memory,
        action: 'SKIP_NEAR_DUPLICATE',
        similarity: 0.95,
      }

      expect(outcome.action).toBe('SKIP_NEAR_DUPLICATE')
      expect(outcome.similarity).toBe(0.95)
      expect(outcome.memory).toBe(memory)
    })

    it('supports SKIP_EMBEDDING_FAILED action with null memory and reason', () => {
      const outcome: MemoryGateOutcome = {
        memory: null,
        action: 'SKIP_EMBEDDING_FAILED',
        reason: 'Embedding failed after retry: ECONNREFUSED',
      }

      expect(outcome.action).toBe('SKIP_EMBEDDING_FAILED')
      expect(outcome.memory).toBeNull()
      expect(outcome.reason).toContain('Embedding failed')
    })
  })

  describe('Exported constants', () => {
    it('MERGE_THRESHOLD is 0.85', () => {
      expect(MERGE_THRESHOLD).toBe(0.85)
    })

    it('NEAR_DUPLICATE_THRESHOLD is 0.90', () => {
      expect(NEAR_DUPLICATE_THRESHOLD).toBe(0.90)
    })

    it('RELATED_THRESHOLD is 0.70', () => {
      expect(RELATED_THRESHOLD).toBe(0.70)
    })

    it('thresholds are ordered RELATED < MERGE < NEAR_DUPLICATE', () => {
      expect(MERGE_THRESHOLD).toBeGreaterThan(RELATED_THRESHOLD)
      expect(NEAR_DUPLICATE_THRESHOLD).toBeGreaterThan(MERGE_THRESHOLD)
    })
  })
})
