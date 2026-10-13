/**
 * The three numbers (memory refactor §3.4, Phase A): relevance, salience and
 * protection, plus the stored reinforcedImportance and the importance bands.
 * Each formula is pinned by a table of inputs → outputs, so a change to any
 * of them is a visible diff here first.
 */

import { describe, it, expect } from '@jest/globals'
import {
  reinforcedImportance,
  salience,
  sortBySalience,
  referenceTimeMs,
  protection,
  PROTECTION_THRESHOLD,
  relevance,
  computeRankingBlend,
  defaultMinCosineForProvider,
  importanceBand,
  filterImportance,
  RECALL_MIN_IMPORTANCE,
  TOOL_MIN_IMPORTANCE,
} from '@/lib/memory/scoring'

const NOW_MS = Date.parse('2026-03-01T00:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW_MS - d * 86_400_000).toISOString()

describe('reinforcedImportance(i, n) = min(1, i + log2(n) × 0.05)', () => {
  it.each([
    [0.5, 1, 0.5],
    [0.5, 2, 0.55],
    [0.5, 4, 0.6],
    [0.5, 8, 0.65],
    [0.6, 3, 0.6 + Math.log2(3) * 0.05],
    [0.98, 4, 1],
    [0.5, 0, 0.5], // a count below 1 reads as 1
    [0.5, Number.NaN, 0.5],
  ])('importance %f at count %f → %f', (i, n, expected) => {
    expect(reinforcedImportance(i, n)).toBeCloseTo(expected, 10)
  })

  it('a fresh row (count 1) equals its importance — no first-reinforcement step (bug 216)', () => {
    for (const i of [0, 0.25, 0.5, 0.75, 1]) expect(reinforcedImportance(i, 1)).toBe(i)
  })
})

describe('salience = reinforcedImportance × 0.5^(days / 30), no floor', () => {
  it.each([
    // [reinforcedImportance, createdDaysAgo, lastReinforcedDaysAgo, expected]
    [0.8, 0, null, 0.8],
    [0.8, 30, null, 0.4],
    [0.8, 60, null, 0.2],
    [0.8, 90, null, 0.1],
    [0.8, 365, null, 0.8 * Math.pow(0.5, 365 / 30)], // far below the old 0.70 floor
    [0.6, 60, 30, 0.3], // reinforcement resets the clock
    [0.6, 60, 90, 0.15], // an older reinforcement does not
  ])('ri %f created %f days ago, reinforced %p → %f', (ri, created, reinforced, expected) => {
    const s = salience(
      {
        importance: 0.1,
        reinforcedImportance: ri,
        createdAt: daysAgo(created),
        lastReinforcedAt: reinforced === null ? null : daysAgo(reinforced),
      },
      { nowMs: NOW_MS },
    )
    expect(s.salience).toBeCloseTo(expected, 10)
    expect(s.base).toBe(ri)
  })

  it('falls back to importance when reinforcedImportance is absent', () => {
    expect(salience({ importance: 0.4, createdAt: daysAgo(0) }, { nowMs: NOW_MS }).salience).toBeCloseTo(0.4)
  })

  it('never reads lastAccessedAt and never decays a future-dated row above its base', () => {
    const s = salience({ importance: 0.5, createdAt: daysAgo(-5) }, { nowMs: NOW_MS })
    expect(s.daysSince).toBe(0)
    expect(s.salience).toBe(0.5)
  })

  it('referenceTimeMs is max(createdAt, lastReinforcedAt)', () => {
    expect(referenceTimeMs({ createdAt: daysAgo(10), lastReinforcedAt: daysAgo(2) })).toBe(NOW_MS - 2 * 86_400_000)
    expect(referenceTimeMs({ createdAt: daysAgo(10), lastReinforcedAt: null })).toBe(NOW_MS - 10 * 86_400_000)
  })

  it('sortBySalience orders highest first and keeps ties stable', () => {
    const rows = [
      { id: 'old-high', importance: 0.9, createdAt: daysAgo(120) }, // 0.05625
      { id: 'new-low', importance: 0.3, createdAt: daysAgo(0) }, // 0.3
      { id: 'tie-a', importance: 0.6, createdAt: daysAgo(30) }, // 0.3
      { id: 'mid', importance: 0.5, createdAt: daysAgo(0) }, // 0.5
    ]
    expect(sortBySalience(rows, { nowMs: NOW_MS }).map(r => r.id)).toEqual(['mid', 'new-low', 'tie-a', 'old-high'])
  })
})

describe('protection — formula unchanged, MANUAL and digests always protected', () => {
  const base = {
    importance: 0.6,
    reinforcedImportance: 0.6,
    createdAt: daysAgo(0),
    reinforcementCount: 1,
    relatedMemoryIds: [] as string[],
    lastAccessedAt: null as string | null,
    kind: 'semantic' as const,
    source: 'AUTO' as const,
  }

  it.each([
    // [label, overrides, expected score]
    ['fresh, content capped at 0.40', {}, 0.4 + Math.log2(2) * 0.08],
    ['60 days old', { createdAt: daysAgo(60) }, 0.6 * 0.25 + 0.08],
    ['very old hits the content floor', { createdAt: daysAgo(3650) }, 0.6 * 0.1 + 0.08],
    ['reinforced 7 times', { reinforcementCount: 7 }, 0.4 + 0.24],
    ['reinforcement bonus caps at 0.25', { reinforcementCount: 63 }, 0.4 + 0.25],
    ['three links', { relatedMemoryIds: ['a', 'b', 'c'] }, 0.4 + 0.08 + 0.075],
    ['graph bonus caps at 0.10', { relatedMemoryIds: ['a', 'b', 'c', 'd', 'e', 'f'] }, 0.4 + 0.08 + 0.1],
    ['accessed recently', { lastAccessedAt: daysAgo(10) }, 0.4 + 0.08 + 0.1],
    ['accessed long ago', { lastAccessedAt: daysAgo(120) }, 0.4 + 0.08],
    ['episodic', { kind: 'episodic' as const }, 0.4 + 0.08 + 0.1],
  ])('%s', (_label, overrides, expected) => {
    const result = protection({ ...base, ...overrides }, { nowMs: NOW_MS })
    expect(result.score).toBeCloseTo(expected, 10)
    expect(result.protected).toBe(result.score >= PROTECTION_THRESHOLD)
    expect(result.protectedBySource).toBe(false)
  })

  it.each(['MANUAL', 'CONSOLIDATED'] as const)('%s rows are protected with score 1', (source) => {
    const result = protection({ ...base, source, createdAt: daysAgo(3650), importance: 0.01, reinforcedImportance: 0.01 }, { nowMs: NOW_MS })
    expect(result).toMatchObject({ score: 1, protected: true, protectedBySource: true })
  })
})

describe('relevance and the blend', () => {
  it('relevance is the cosine', () => {
    expect(relevance(0.42)).toBe(0.42)
  })

  it.each([
    [1, 0, 0.75],
    [0, 1, 0.25],
    [0.6, 0.4, 0.55],
  ])('blend(%f, %f) = %f', (cos, sal, expected) => {
    expect(computeRankingBlend(cos, sal)).toBeCloseTo(expected, 10)
  })

  it('the cosine floor is provider-aware', () => {
    expect(defaultMinCosineForProvider('BUILTIN')).toBe(0.1)
    expect(defaultMinCosineForProvider('OPENAI')).toBe(0.3)
    expect(defaultMinCosineForProvider(null)).toBe(0.3)
  })
})

describe('importance filters and bands', () => {
  it('two named floors', () => {
    expect(RECALL_MIN_IMPORTANCE).toBe(0.3)
    expect(TOOL_MIN_IMPORTANCE).toBe(0)
  })

  it.each([
    [1, 'high'],
    [0.7, 'high'],
    [0.69, 'medium'],
    [0.3, 'medium'],
    [0.29, 'low'],
    [0, 'low'],
  ])('importanceBand(%f) = %s', (value, band) => {
    expect(importanceBand(value)).toBe(band)
  })

  it('filters read reinforcedImportance, then importance', () => {
    expect(filterImportance({ importance: 0.65, reinforcedImportance: 0.73 })).toBe(0.73)
    expect(filterImportance({ importance: 0.65 })).toBe(0.65)
    expect(filterImportance({ importance: 0.65, reinforcedImportance: null })).toBe(0.65)
  })
})
