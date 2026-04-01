/**
 * Unit Tests for Memory Weighting
 * Tests lib/memory/memory-weighting.ts
 *
 * Covers:
 * - calculateEffectiveWeight() — time-decay based on max(createdAt, lastReinforcedAt)
 * - rankMemoriesByWeight() — sorting and filtering by effective weight
 * - formatRelativeAge() — human-readable age labels
 * - Config overrides (custom half-life, custom floor)
 * - Edge cases (no lastReinforcedAt, very old memories, fresh memories)
 */

import { describe, it, expect } from '@jest/globals'
import {
  calculateEffectiveWeight,
  rankMemoriesByWeight,
  formatRelativeAge,
  DEFAULT_WEIGHTING_CONFIG,
  type MemoryWeightingConfig,
} from '@/lib/memory/memory-weighting'
import type { Memory } from '@/lib/schemas/types'

// =============================================================================
// Test Fixtures
// =============================================================================

const NOW = new Date('2026-03-01T00:00:00.000Z')

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
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  ...overrides,
})

// Helper: create a date N days before NOW
const daysAgo = (days: number): string => {
  const d = new Date(NOW)
  d.setTime(d.getTime() - days * 86400000)
  return d.toISOString()
}

// =============================================================================
// calculateEffectiveWeight()
// =============================================================================

describe('calculateEffectiveWeight', () => {
  it('returns full importance for a memory created just now', () => {
    const memory = makeMemory({
      reinforcedImportance: 0.95,
      createdAt: NOW.toISOString(),
    })
    const result = calculateEffectiveWeight(memory, DEFAULT_WEIGHTING_CONFIG, NOW)

    expect(result.effectiveWeight).toBeCloseTo(0.95, 2)
    expect(result.timeDecayFactor).toBeCloseTo(1.0, 2)
    expect(result.daysOld).toBeCloseTo(0, 1)
  })

  it('high-value memory created yesterday has weight ≈ 0.928', () => {
    const memory = makeMemory({
      reinforcedImportance: 0.95,
      createdAt: daysAgo(1),
    })
    const result = calculateEffectiveWeight(memory, DEFAULT_WEIGHTING_CONFIG, NOW)

    // 0.95 * 0.5^(1/30) ≈ 0.95 * 0.9772 ≈ 0.928
    expect(result.effectiveWeight).toBeCloseTo(0.928, 2)
    expect(result.baseImportance).toBe(0.95)
  })

  it('medium-value memory 30 days old has floor kick in', () => {
    const memory = makeMemory({
      reinforcedImportance: 0.7,
      createdAt: daysAgo(30),
    })
    const result = calculateEffectiveWeight(memory, DEFAULT_WEIGHTING_CONFIG, NOW)

    // rawWeight = 0.7 * 0.5 = 0.35
    // minWeight = 0.7 * 0.70 = 0.49
    // Floor kicks in: effectiveWeight = 0.49
    expect(result.rawWeight).toBeCloseTo(0.35, 2)
    expect(result.minWeight).toBeCloseTo(0.49, 2)
    expect(result.effectiveWeight).toBeCloseTo(0.49, 2)
  })

  it('high-value memory 270 days old triggers floor at importance × 0.70', () => {
    const memory = makeMemory({
      reinforcedImportance: 0.95,
      createdAt: daysAgo(270),
    })
    const result = calculateEffectiveWeight(memory, DEFAULT_WEIGHTING_CONFIG, NOW)

    // rawWeight = 0.95 * 0.5^(270/30) = 0.95 * 0.5^9 ≈ 0.001856
    // minWeight = 0.95 * 0.70 = 0.665
    // Floor kicks in: effectiveWeight = 0.665
    expect(result.rawWeight).toBeCloseTo(0.00186, 2)
    expect(result.effectiveWeight).toBeCloseTo(0.665, 2)
  })

  it('uses lastReinforcedAt when more recent than createdAt', () => {
    const memory = makeMemory({
      reinforcedImportance: 0.8,
      createdAt: daysAgo(60),       // Created 60 days ago
      lastReinforcedAt: daysAgo(5), // But reinforced 5 days ago
    })
    const result = calculateEffectiveWeight(memory, DEFAULT_WEIGHTING_CONFIG, NOW)

    // Should use lastReinforcedAt (5 days ago), not createdAt (60 days ago)
    expect(result.daysOld).toBeCloseTo(5, 0)
    // 0.5^(5/30) ≈ 0.891
    expect(result.timeDecayFactor).toBeCloseTo(0.891, 2)
    // 0.8 * 0.891 ≈ 0.713
    expect(result.effectiveWeight).toBeCloseTo(0.713, 2)
  })

  it('uses createdAt when lastReinforcedAt is null', () => {
    const memory = makeMemory({
      reinforcedImportance: 0.8,
      createdAt: daysAgo(15),
      lastReinforcedAt: null,
    })
    const result = calculateEffectiveWeight(memory, DEFAULT_WEIGHTING_CONFIG, NOW)

    expect(result.daysOld).toBeCloseTo(15, 0)
    // 0.5^(15/30) = 0.5^0.5 ≈ 0.7071
    expect(result.timeDecayFactor).toBeCloseTo(0.7071, 3)
    // 0.8 * 0.7071 ≈ 0.5657
    // minWeight = 0.8 * 0.70 = 0.56
    // rawWeight > minWeight, so no floor
    expect(result.effectiveWeight).toBeCloseTo(0.5657, 2)
  })

  it('ignores lastAccessedAt for decay calculation', () => {
    // Two identical memories — one accessed recently, one never accessed
    const recentlyAccessed = makeMemory({
      reinforcedImportance: 0.8,
      createdAt: daysAgo(60),
      lastAccessedAt: daysAgo(1), // Accessed yesterday — should NOT matter
      lastReinforcedAt: null,
    })
    const neverAccessed = makeMemory({
      reinforcedImportance: 0.8,
      createdAt: daysAgo(60),
      lastAccessedAt: null,
      lastReinforcedAt: null,
    })

    const resultA = calculateEffectiveWeight(recentlyAccessed, DEFAULT_WEIGHTING_CONFIG, NOW)
    const resultB = calculateEffectiveWeight(neverAccessed, DEFAULT_WEIGHTING_CONFIG, NOW)

    // Both should have the same effective weight since lastAccessedAt is ignored
    expect(resultA.effectiveWeight).toBeCloseTo(resultB.effectiveWeight, 4)
    expect(resultA.daysOld).toBeCloseTo(60, 0)
    expect(resultB.daysOld).toBeCloseTo(60, 0)
  })

  it('falls back to importance when reinforcedImportance is undefined', () => {
    const memory = makeMemory({
      importance: 0.6,
      reinforcedImportance: undefined as unknown as number,
      createdAt: NOW.toISOString(),
    })
    // Force reinforcedImportance to be actually missing
    delete (memory as Record<string, unknown>).reinforcedImportance
    const result = calculateEffectiveWeight(memory, DEFAULT_WEIGHTING_CONFIG, NOW)

    expect(result.baseImportance).toBe(0.6)
    expect(result.effectiveWeight).toBeCloseTo(0.6, 2)
  })

  it('weight never drops below importance × importanceFloor', () => {
    const memory = makeMemory({
      reinforcedImportance: 0.5,
      createdAt: daysAgo(365),
    })
    const result = calculateEffectiveWeight(memory, DEFAULT_WEIGHTING_CONFIG, NOW)

    // minWeight = 0.5 * 0.70 = 0.35
    expect(result.effectiveWeight).toBe(result.minWeight)
    expect(result.effectiveWeight).toBeCloseTo(0.35, 2)
  })

  it('respects custom config: shorter half-life', () => {
    const config: MemoryWeightingConfig = {
      halfLifeDays: 7,
      importanceFloor: 0.70,
      minWeightThreshold: 0.05,
    }
    const memory = makeMemory({
      reinforcedImportance: 0.8,
      createdAt: daysAgo(7),
    })
    const result = calculateEffectiveWeight(memory, config, NOW)

    // 0.5^(7/7) = 0.5, rawWeight = 0.8 * 0.5 = 0.4
    // minWeight = 0.8 * 0.70 = 0.56
    // Floor kicks in
    expect(result.rawWeight).toBeCloseTo(0.4, 2)
    expect(result.effectiveWeight).toBeCloseTo(0.56, 2)
  })

  it('respects custom config: lower floor', () => {
    const config: MemoryWeightingConfig = {
      halfLifeDays: 30,
      importanceFloor: 0.3,
      minWeightThreshold: 0.05,
    }
    const memory = makeMemory({
      reinforcedImportance: 0.8,
      createdAt: daysAgo(90),
    })
    const result = calculateEffectiveWeight(memory, config, NOW)

    // 0.5^(90/30) = 0.5^3 = 0.125, rawWeight = 0.8 * 0.125 = 0.1
    // minWeight = 0.8 * 0.3 = 0.24
    // Floor kicks in
    expect(result.rawWeight).toBeCloseTo(0.1, 2)
    expect(result.minWeight).toBeCloseTo(0.24, 2)
    expect(result.effectiveWeight).toBeCloseTo(0.24, 2)
  })
})

// =============================================================================
// formatRelativeAge()
// =============================================================================

describe('formatRelativeAge', () => {
  it('returns "today" for a memory created now', () => {
    const memory = makeMemory({ createdAt: NOW.toISOString() })
    expect(formatRelativeAge(memory, NOW)).toBe('today')
  })

  it('returns "yesterday" for a memory created 1 day ago', () => {
    const memory = makeMemory({ createdAt: daysAgo(1) })
    expect(formatRelativeAge(memory, NOW)).toBe('yesterday')
  })

  it('returns "N days ago" for memories 2-6 days old', () => {
    const memory = makeMemory({ createdAt: daysAgo(4) })
    expect(formatRelativeAge(memory, NOW)).toBe('4 days ago')
  })

  it('returns "last week" for memories 7-13 days old', () => {
    const memory = makeMemory({ createdAt: daysAgo(10) })
    expect(formatRelativeAge(memory, NOW)).toBe('last week')
  })

  it('returns "N weeks ago" for memories 14-29 days old', () => {
    const memory = makeMemory({ createdAt: daysAgo(21) })
    expect(formatRelativeAge(memory, NOW)).toBe('3 weeks ago')
  })

  it('returns "last month" for memories 30-59 days old', () => {
    const memory = makeMemory({ createdAt: daysAgo(45) })
    expect(formatRelativeAge(memory, NOW)).toBe('last month')
  })

  it('returns "N months ago" for memories 60-364 days old', () => {
    const memory = makeMemory({ createdAt: daysAgo(90) })
    expect(formatRelativeAge(memory, NOW)).toBe('3 months ago')
  })

  it('returns "1 year ago" for memories 365+ days old', () => {
    const memory = makeMemory({ createdAt: daysAgo(400) })
    expect(formatRelativeAge(memory, NOW)).toBe('1 year ago')
  })

  it('returns "2 years ago" for memories 730+ days old', () => {
    const memory = makeMemory({ createdAt: daysAgo(800) })
    expect(formatRelativeAge(memory, NOW)).toBe('2 years ago')
  })

  it('uses lastReinforcedAt when more recent than createdAt', () => {
    const memory = makeMemory({
      createdAt: daysAgo(90),       // 3 months ago
      lastReinforcedAt: daysAgo(2), // 2 days ago
    })
    expect(formatRelativeAge(memory, NOW)).toBe('2 days ago')
  })
})

// =============================================================================
// rankMemoriesByWeight()
// =============================================================================

describe('rankMemoriesByWeight', () => {
  it('sorts memories by effective weight descending', () => {
    const memories = [
      makeMemory({ id: 'low', reinforcedImportance: 0.3, createdAt: daysAgo(60) }),
      makeMemory({ id: 'high', reinforcedImportance: 0.95, createdAt: daysAgo(1) }),
      makeMemory({ id: 'mid', reinforcedImportance: 0.6, createdAt: daysAgo(10) }),
    ]

    const ranked = rankMemoriesByWeight(memories, DEFAULT_WEIGHTING_CONFIG, NOW)

    expect(ranked.map(r => r.memory.id)).toEqual(['high', 'mid', 'low'])
  })

  it('filters out memories below minWeightThreshold', () => {
    const config: MemoryWeightingConfig = {
      halfLifeDays: 30,
      importanceFloor: 0.0, // no floor — let things decay fully
      minWeightThreshold: 0.1,
    }
    const memories = [
      makeMemory({ id: 'recent', reinforcedImportance: 0.5, createdAt: daysAgo(1) }),
      makeMemory({ id: 'ancient', reinforcedImportance: 0.05, createdAt: daysAgo(300) }),
    ]

    const ranked = rankMemoriesByWeight(memories, config, NOW)

    // ancient: 0.05 * 0.5^(300/30) = 0.05 * 0.5^10 ≈ 0.0000488 < 0.1 → filtered
    expect(ranked).toHaveLength(1)
    expect(ranked[0].memory.id).toBe('recent')
  })

  it('returns empty array for empty input', () => {
    const ranked = rankMemoriesByWeight([], DEFAULT_WEIGHTING_CONFIG, NOW)
    expect(ranked).toEqual([])
  })

  it('includes weight result details for each ranked memory', () => {
    const memories = [
      makeMemory({ reinforcedImportance: 0.8, createdAt: daysAgo(15) }),
    ]
    const ranked = rankMemoriesByWeight(memories, DEFAULT_WEIGHTING_CONFIG, NOW)

    expect(ranked).toHaveLength(1)
    expect(ranked[0].weightResult).toHaveProperty('effectiveWeight')
    expect(ranked[0].weightResult).toHaveProperty('rawWeight')
    expect(ranked[0].weightResult).toHaveProperty('minWeight')
    expect(ranked[0].weightResult).toHaveProperty('timeDecayFactor')
    expect(ranked[0].weightResult).toHaveProperty('daysOld')
    expect(ranked[0].weightResult).toHaveProperty('baseImportance')
  })

  it('ranks recently reinforced memories higher than old unreinforced ones', () => {
    const memories = [
      makeMemory({
        id: 'old-reinforced',
        reinforcedImportance: 0.8,
        createdAt: daysAgo(90),
        lastReinforcedAt: daysAgo(2),
      }),
      makeMemory({
        id: 'old-stale',
        reinforcedImportance: 0.8,
        createdAt: daysAgo(90),
        lastReinforcedAt: null,
      }),
    ]

    const ranked = rankMemoriesByWeight(memories, DEFAULT_WEIGHTING_CONFIG, NOW)

    expect(ranked[0].memory.id).toBe('old-reinforced')
    expect(ranked[1].memory.id).toBe('old-stale')
  })
})

// =============================================================================
// DEFAULT_WEIGHTING_CONFIG
// =============================================================================

describe('DEFAULT_WEIGHTING_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_WEIGHTING_CONFIG.halfLifeDays).toBe(30)
    expect(DEFAULT_WEIGHTING_CONFIG.importanceFloor).toBe(0.70)
    expect(DEFAULT_WEIGHTING_CONFIG.minWeightThreshold).toBe(0.05)
  })
})
