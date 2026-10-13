/**
 * Protection score and memory age labels.
 * Tests lib/memory/scoring/protection.ts and lib/memory/time/age-label.ts.
 *
 * (The floored `calculateEffectiveWeight` and `rankMemoriesByWeight` these
 * tests once covered are gone; salience is pinned in scoring-formulas.test.ts.)
 */

import { describe, it, expect } from '@jest/globals'
import {
  calculateProtectionScore,
  DEFAULT_PROTECTION_CONFIG,
} from '@/lib/memory/scoring'
import { formatMemoryAge as formatRelativeAge } from '@/lib/memory/time'
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
// calculateProtectionScore() — housekeeping gate scoring
// =============================================================================

describe('calculateProtectionScore()', () => {
  it('caps the content contribution of a fresh high-importance memory', () => {
    // A fresh 0.8-importance memory with no usage signals used to score
    // ~0.88 (content 0.80 + default reinforcement bonus 0.08), putting it
    // above the 0.5 protection threshold on content alone. The cap means
    // content contributes at most 0.40 and the memory has to earn the
    // rest from usage (reinforcement, graph, or access) to be protected.
    const memory = makeMemory({
      importance: 0.8,
      reinforcedImportance: 0.8,
      createdAt: daysAgo(0),
    })
    const { score, contentComponent } = calculateProtectionScore(memory, undefined, NOW)

    expect(contentComponent).toBeCloseTo(DEFAULT_PROTECTION_CONFIG.maxContentContribution, 3)
    // content 0.40 + default reinforcement bonus 0.08 = 0.48 — below threshold
    expect(score).toBeLessThan(0.5)
  })

  it('does not cap content when decay has brought it below the cap', () => {
    // baseImportance * decay only crosses maxContentContribution for young,
    // high-importance memories. Older or lower-importance ones score their
    // actual decayed value.
    const memory = makeMemory({
      importance: 0.5,
      reinforcedImportance: 0.5,
      createdAt: daysAgo(30),
    })
    const { contentComponent } = calculateProtectionScore(memory, undefined, NOW)
    // decay at 30 days = 0.5, times 0.5 baseImportance = 0.25, below the 0.40 cap
    expect(contentComponent).toBeCloseTo(0.25, 2)
  })

  it('decays the content score over time with a 30-day half-life', () => {
    const memory = makeMemory({
      importance: 0.8,
      reinforcedImportance: 0.8,
      createdAt: daysAgo(30),
    })
    const { contentComponent } = calculateProtectionScore(memory, undefined, NOW)

    // decay at 30 days = 0.5, times baseImportance 0.8 = 0.4, exactly at the cap
    expect(contentComponent).toBeCloseTo(0.4, 2)
  })

  it('floors the content decay at 10% of base importance', () => {
    const memory = makeMemory({
      importance: 0.8,
      reinforcedImportance: 0.8,
      createdAt: daysAgo(3650), // 10 years
    })
    const { contentComponent } = calculateProtectionScore(memory, undefined, NOW)

    // 10-year decay is ~1e-3 — floor kicks in at 0.10 * 0.8 = 0.08
    expect(contentComponent).toBeCloseTo(0.08, 3)
  })

  it('awards a reinforcement bonus that saturates', () => {
    const saturated = calculateProtectionScore(
      makeMemory({ reinforcementCount: 1000 }),
      undefined,
      NOW
    )
    expect(saturated.reinforcementBonus).toBeCloseTo(
      DEFAULT_PROTECTION_CONFIG.maxReinforcementBonus,
      3
    )
  })

  it('awards a graph-degree bonus that saturates at four links', () => {
    const r = calculateProtectionScore(
      makeMemory({ relatedMemoryIds: ['a', 'b', 'c', 'd', 'e', 'f'] }),
      undefined,
      NOW
    )
    expect(r.graphDegreeBonus).toBeCloseTo(DEFAULT_PROTECTION_CONFIG.maxGraphDegreeBonus, 3)
  })

  it('adds a recent-access bonus when accessed within the recency window', () => {
    const recentlyAccessed = calculateProtectionScore(
      makeMemory({ lastAccessedAt: daysAgo(30) }),
      undefined,
      NOW
    )
    expect(recentlyAccessed.recentAccessBonus).toBe(DEFAULT_PROTECTION_CONFIG.recentAccessBonus)

    const staleAccess = calculateProtectionScore(
      makeMemory({ lastAccessedAt: daysAgo(200) }),
      undefined,
      NOW
    )
    expect(staleAccess.recentAccessBonus).toBe(0)
  })

  it('sums capped components and never exceeds 1.0', () => {
    // With the default config each component has its own ceiling — content
    // 0.40, reinforcement 0.25, graph 0.10, access 0.10 — so the realistic
    // max with a maximally-reinforced, heavily-linked, recently-accessed
    // memory is 0.85. The Math.min(1, …) clamp at the end is a safety
    // net for future configs whose contributions might sum above 1.
    const { score } = calculateProtectionScore(
      makeMemory({
        importance: 1.0,
        reinforcedImportance: 1.0,
        reinforcementCount: 1000,
        relatedMemoryIds: ['a', 'b', 'c', 'd'],
        lastAccessedAt: daysAgo(1),
      }),
      undefined,
      NOW
    )
    expect(score).toBeLessThanOrEqual(1.0)
    expect(score).toBeCloseTo(
      DEFAULT_PROTECTION_CONFIG.maxContentContribution
        + DEFAULT_PROTECTION_CONFIG.maxReinforcementBonus
        + DEFAULT_PROTECTION_CONFIG.maxGraphDegreeBonus
        + DEFAULT_PROTECTION_CONFIG.recentAccessBonus,
      3,
    )
  })

  it('uses max(createdAt, lastReinforcedAt) as the decay reference', () => {
    // Created a year ago but reinforced today — decay should be near zero,
    // giving a raw contentComponent of 0.8 that the cap then clips to 0.40.
    const memory = makeMemory({
      importance: 0.8,
      reinforcedImportance: 0.8,
      createdAt: daysAgo(365),
      lastReinforcedAt: daysAgo(0),
    })
    const { contentComponent } = calculateProtectionScore(memory, undefined, NOW)
    expect(contentComponent).toBeCloseTo(DEFAULT_PROTECTION_CONFIG.maxContentContribution, 3)
  })

  it('drops a stale, low-importance, unused memory below a reasonable protection threshold', () => {
    const memory = makeMemory({
      importance: 0.3,
      reinforcedImportance: 0.3,
      createdAt: daysAgo(365),
      lastAccessedAt: null,
      reinforcementCount: 1,
      relatedMemoryIds: [],
    })
    const { score } = calculateProtectionScore(memory, undefined, NOW)
    expect(score).toBeLessThan(0.5)
  })

  it('rescues a stale memory whose usage signals all fire', () => {
    const memory = makeMemory({
      importance: 0.2,
      reinforcedImportance: 0.4,
      createdAt: daysAgo(365),
      lastReinforcedAt: daysAgo(15),
      lastAccessedAt: daysAgo(10),
      reinforcementCount: 12,
      relatedMemoryIds: ['a', 'b', 'c', 'd'],
    })
    const { score } = calculateProtectionScore(memory, undefined, NOW)
    expect(score).toBeGreaterThanOrEqual(0.5)
  })
})

describe('DEFAULT_PROTECTION_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_PROTECTION_CONFIG.contentHalfLifeDays).toBe(30)
    expect(DEFAULT_PROTECTION_CONFIG.contentFloor).toBe(0.10)
    expect(DEFAULT_PROTECTION_CONFIG.maxReinforcementBonus).toBe(0.25)
    expect(DEFAULT_PROTECTION_CONFIG.recentAccessWindowDays).toBe(90)
    expect(DEFAULT_PROTECTION_CONFIG.maxContentContribution).toBe(0.40)
  })
})
