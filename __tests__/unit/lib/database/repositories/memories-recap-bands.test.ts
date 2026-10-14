/**
 * Bug 215 — MemoriesRepository.findRecentByImportanceTier puts every hot row
 * in exactly one band, judged on one column: reinforcedImportance.
 *
 * The high and low bands used to filter raw `importance` while the medium
 * ceiling read reinforced importance, so a 0.65 row reinforced to 0.73 fell
 * through both. `findByFilter` is stubbed with a tiny evaluator over an
 * in-memory row set so the filters the method builds are what decide.
 */

import { describe, it, expect, jest, beforeAll, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getCollection: jest.fn(),
  getDatabaseAsync: jest.fn(),
  ensureCollection: jest.fn(),
}))

import type { MemoriesRepository as MemoriesRepositoryType } from '@/lib/database/repositories/memories.repository'

let MemoriesRepository: typeof MemoriesRepositoryType
beforeAll(async () => {
  ;({ MemoriesRepository } = await import('@/lib/database/repositories/memories.repository'))
})

const CHARACTER = 'char-1'

interface Row {
  id: string
  characterId: string
  tier: 'hot' | 'cold'
  importance: number
  reinforcedImportance: number
  createdAt: string
}

function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, cond] of Object.entries(filter)) {
    const value = row[field] as number | string
    if (cond !== null && typeof cond === 'object') {
      for (const [op, operand] of Object.entries(cond as Record<string, number>)) {
        const v = value as number
        if (op === '$gte' && !(v >= operand)) return false
        if (op === '$gt' && !(v > operand)) return false
        if (op === '$lt' && !(v < operand)) return false
        if (op === '$lte' && !(v <= operand)) return false
      }
    } else if (value !== cond) {
      return false
    }
  }
  return true
}

function stubRows(repo: InstanceType<typeof MemoriesRepositoryType>, rows: Row[]) {
  const spy = jest.fn(async (filter: Record<string, unknown>, opts?: { limit?: number }) => {
    const hits = rows
      .filter((r) => matches(r as unknown as Record<string, unknown>, filter))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return opts?.limit ? hits.slice(0, opts.limit) : hits
  })
  ;(repo as unknown as { findByFilter: typeof spy }).findByFilter = spy
  return spy
}

const at = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString()

describe('MemoriesRepository.findRecentByImportanceTier (bug 215)', () => {
  let repo: InstanceType<typeof MemoriesRepositoryType>

  beforeEach(() => {
    repo = new MemoriesRepository()
  })

  it('files a reinforced mid-importance row in exactly one band (high)', async () => {
    stubRows(repo, [
      { id: 'reinforced', characterId: CHARACTER, tier: 'hot', importance: 0.65, reinforcedImportance: 0.73, createdAt: at(1) },
    ])
    const { high, medium, low } = await repo.findRecentByImportanceTier(CHARACTER)
    expect(high.map((m) => m.id)).toEqual(['reinforced'])
    expect(medium).toEqual([])
    expect(low).toEqual([])
  })

  it('bands rows on both sides of each boundary by reinforcedImportance alone', async () => {
    const rows: Row[] = [
      { id: 'hi-raw-hi', characterId: CHARACTER, tier: 'hot', importance: 0.8, reinforcedImportance: 0.8, createdAt: at(1) },
      { id: 'mid-to-hi', characterId: CHARACTER, tier: 'hot', importance: 0.69, reinforcedImportance: 0.7, createdAt: at(2) },
      { id: 'mid', characterId: CHARACTER, tier: 'hot', importance: 0.5, reinforcedImportance: 0.69, createdAt: at(3) },
      { id: 'low-to-mid', characterId: CHARACTER, tier: 'hot', importance: 0.25, reinforcedImportance: 0.3, createdAt: at(4) },
      { id: 'low', characterId: CHARACTER, tier: 'hot', importance: 0.1, reinforcedImportance: 0.29, createdAt: at(5) },
      { id: 'cold', characterId: CHARACTER, tier: 'cold', importance: 0.9, reinforcedImportance: 0.9, createdAt: at(6) },
    ]
    stubRows(repo, rows)
    const { high, medium, low } = await repo.findRecentByImportanceTier(CHARACTER)
    expect(high.map((m) => m.id).sort()).toEqual(['hi-raw-hi', 'mid-to-hi'])
    expect(medium.map((m) => m.id).sort()).toEqual(['low-to-mid', 'mid'])
    expect(low.map((m) => m.id)).toEqual(['low'])

    const all = [...high, ...medium, ...low].map((m) => m.id)
    expect(new Set(all).size).toBe(all.length)
    expect(all).not.toContain('cold')
  })

  it('pushes every band limit into the query (no unbounded medium fetch)', async () => {
    const spy = stubRows(repo, [])
    await repo.findRecentByImportanceTier(CHARACTER, { high: 3, medium: 4, low: 5 })
    expect(spy).toHaveBeenCalledTimes(3)
    const calls = spy.mock.calls.map(([filter, opts]) => ({ filter, opts }))
    for (const { filter, opts } of calls) {
      expect(filter).not.toHaveProperty('importance')
      expect(filter).toHaveProperty('reinforcedImportance')
      expect(opts?.limit).toBeGreaterThan(0)
    }
    expect(calls.map((c) => c.opts?.limit).sort()).toEqual([3, 4, 5])
  })
})
