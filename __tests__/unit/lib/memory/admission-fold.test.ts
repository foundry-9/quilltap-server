/**
 * The one combine (memory refactor Phase C): `foldInto` plans, `applyFold`
 * writes.
 *
 * Pins the footnote cap, counts as a delta (bugs 182, 226), the link union
 * minus the group, the anchor merge (earliest `occurredAt`, filled
 * `narrativeTime`, entities unioned to the cap), the re-embed rule (only when
 * the embedded text changed, never past the footnote cap), and the commit
 * point: once a write lands, a later miss does not report the fold as failed.
 */



jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/database/backends/sqlite/client', () => ({ getRawDatabase: jest.fn() }))
jest.mock('@/lib/database/manager', () => ({
  __esModule: true,
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getDatabaseAsync: jest.fn(),
  initializeDatabase: jest.fn(),
}))
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: { upsert: jest.fn() },
  embeddingTextFor: (jest.requireActual('@/lib/memory/index-store/embedding-text') as any).embeddingTextFor,
  lexicalEmbeddingTextFor: (jest.requireActual('@/lib/memory/index-store/embedding-text') as any).lexicalEmbeddingTextFor,
}))
jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class extends Error {},
}))
jest.mock('@/lib/logger', () => {
  const make = (): any => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn(() => make()) })
  return { logger: make() }
})

import type { Memory } from '@/lib/schemas/types'
import { foldInto, type FoldCaps } from '@/lib/memory/admission/fold'
import { applyFold } from '@/lib/memory/admission/apply'
import { calculateReinforcedImportance } from '@/lib/memory/scoring'
import {
  MAX_REINFORCEMENT_FOOTNOTES,
  appendCappedFootnotes,
  countReinforcementFootnotes,
} from '@/lib/memory/reinforcement-footnotes'

const factoryMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
const indexMock = jest.requireMock('@/lib/memory/index-store') as { memoryIndex: { upsert: jest.Mock } }
const embedMock = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock }

const CAPS: FoldCaps = { footnoteCap: MAX_REINFORCEMENT_FOOTNOTES, entityCap: 12 }
const EMBEDDING = new Float32Array([0.6, 0.8])
const footnotes = (n: number) => Array.from({ length: n }, (_, i) => `[+] Detail${i}`).join('\n')

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'keep',
    characterId: 'char-1',
    content: 'Friday keeps the ledger.',
    summary: 'Friday keeps the ledger.',
    keywords: [],
    tags: [],
    importance: 0.6,
    source: 'AUTO',
    reinforcementCount: 1,
    lastReinforcedAt: null,
    relatedMemoryIds: [],
    reinforcedImportance: 0.6,
    entities: [],
    occurredAt: null,
    narrativeTime: null,
    tier: 'hot',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Memory
}

// =============================================================================
// foldInto — pure
// =============================================================================

describe('foldInto', () => {
  it('folds details, counts, links and the earliest occurredAt into the survivor', () => {
    const survivor = makeMemory({
      reinforcementCount: 2,
      relatedMemoryIds: ['n1', 'loser'],
      occurredAt: '2026-03-10T00:00:00.000Z',
    })
    const loser = makeMemory({
      id: 'loser',
      content: 'Friday keeps the ledger for Marguerite.',
      reinforcementCount: 3,
      relatedMemoryIds: ['keep', 'n1', 'n2'],
      occurredAt: '2026-03-08T00:00:00.000Z',
    })

    const plan = foldInto(survivor, [loser], CAPS)

    expect(plan.footnotes).toEqual(['Marguerite'])
    expect(plan.content).toBe('Friday keeps the ledger.\n[+] Marguerite')
    // Bug 226: counts ride as a delta, never an absolute total.
    expect(plan.reinforcementDelta).toBe(3)
    expect(plan.patch).not.toHaveProperty('reinforcementCount')
    expect(plan.patch).not.toHaveProperty('reinforcedImportance')
    expect(plan.patch).not.toHaveProperty('content')
    // Union minus the group and what the survivor already names.
    expect(plan.addLinks).toEqual(['n2'])
    expect(plan.patch.occurredAt).toBe('2026-03-08T00:00:00.000Z')
    expect(plan.reembed).toBe(true)
  })

  it('judges details against the growing content, so two sources add one footnote', () => {
    const plan = foldInto(
      makeMemory(),
      [{ content: 'Seen with Marguerite.' }, { content: 'Again with Marguerite and Valparaiso.' }],
      CAPS,
    )
    expect(plan.footnotes).toEqual(['Marguerite', 'Valparaiso'])
    expect(plan.reinforcementDelta).toBe(2)
  })

  it('appends up to the footnote cap and no further', () => {
    const survivor = makeMemory({ content: `Body\n${footnotes(MAX_REINFORCEMENT_FOOTNOTES - 2)}` })
    const plan = foldInto(survivor, [{ content: 'Body with Alpha, Beta and Gamma.' }], CAPS)
    expect(plan.footnotes).toHaveLength(2)
    expect(countReinforcementFootnotes(plan.content)).toBe(MAX_REINFORCEMENT_FOOTNOTES)
    expect(plan.atCap).toBe(false)
    expect(plan.reembed).toBe(true)
  })

  it('past the cap: counts and unions entities, appends nothing, and re-embeds the changed anchor line (review #5)', () => {
    const survivor = makeMemory({
      content: `Friday keeps the ledger.\n${footnotes(MAX_REINFORCEMENT_FOOTNOTES)}`,
      entities: ['Friday'],
    })
    const plan = foldInto(survivor, [{ content: 'Friday keeps the ledger with Marguerite in Valparaiso.', entities: ['Marguerite'] }], CAPS)
    expect(plan.atCap).toBe(true)
    expect(plan.footnotes).toEqual([])
    expect(plan.patch.entities).toEqual(['Friday', 'Marguerite'])
    expect(plan.reinforcementDelta).toBe(1)
    // The entities are on the anchor line, so the stored vector must follow (bug 204).
    expect(plan.reembed).toBe(true)
  })

  it('past the cap with nothing new to the anchor line: no re-embed', () => {
    const survivor = makeMemory({ content: `Body\n${footnotes(MAX_REINFORCEMENT_FOOTNOTES)}` })
    const plan = foldInto(survivor, [{ content: 'Body with Marguerite.' }], CAPS)
    expect(plan.atCap).toBe(true)
    expect(plan.reembed).toBe(false)
  })

  it('unions entities case-insensitively, survivor first, up to the cap', () => {
    const survivor = makeMemory({ entities: ['Friday', 'Lighthouse'] })
    const many = Array.from({ length: 20 }, (_, i) => `Place${i}`)
    const plan = foldInto(survivor, [{ content: 'x', entities: ['friday', ...many] }], CAPS)
    expect(plan.patch.entities?.slice(0, 3)).toEqual(['Friday', 'Lighthouse', 'Place0'])
    expect(plan.patch.entities).toHaveLength(12)
  })

  it('fills a missing narrativeTime and never overwrites one', () => {
    expect(foldInto(makeMemory(), [{ content: 'x', narrativeTime: 'the third bell' }], CAPS).patch.narrativeTime).toBe('the third bell')
    expect(foldInto(makeMemory({ narrativeTime: 'dawn' }), [{ content: 'x', narrativeTime: 'dusk' }], CAPS).patch).not.toHaveProperty('narrativeTime')
  })

  it('takes the latest observation time and counts an unreinforced row from its creation', () => {
    const survivor = makeMemory({ lastReinforcedAt: '2026-02-01T00:00:00.000Z' })
    const plan = foldInto(survivor, [makeMemory({ id: 'l', createdAt: '2026-05-01T00:00:00.000Z' })], CAPS)
    expect(plan.reinforcedAt).toBe('2026-05-01T00:00:00.000Z')
  })

  it('changes nothing but the count for an identical source', () => {
    const plan = foldInto(makeMemory({ content: 'Same words.' }), [{ content: 'Same words.' }], CAPS)
    expect(plan.footnotes).toEqual([])
    expect(plan.patch).toEqual({})
    expect(plan.addLinks).toEqual([])
    expect(plan.reembed).toBe(false)
    expect(plan.reinforcementDelta).toBe(1)
  })
})

// =============================================================================
// applyFold — the writes
// =============================================================================

describe('applyFold', () => {
  let updateForCharacter: jest.Mock
  let incrementReinforcement: jest.Mock
  let appendReinforcementFootnotes: jest.Mock
  let addRelatedMemoryIds: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    updateForCharacter = jest.fn(async (characterId: string, id: string, patch: Partial<Memory>) => ({ ...makeMemory({ id, characterId }), ...patch }))
    // The committed row's count (7 → 8), deliberately not the snapshot's.
    incrementReinforcement = jest.fn(async (_c: string, _id: string, at: string) => ({
      reinforcementCount: 8,
      reinforcedImportance: calculateReinforcedImportance(0.6, 8),
      lastReinforcedAt: at,
    }))
    appendReinforcementFootnotes = jest.fn(async (_c: string, _id: string, details: string[]) => appendCappedFootnotes('Friday keeps the ledger.', details))
    addRelatedMemoryIds = jest.fn(async (_c: string, _id: string, ids: string[]) => ids)
    factoryMock.getRepositories.mockReturnValue({
      memories: { updateForCharacter, incrementReinforcement, appendReinforcementFootnotes, addRelatedMemoryIds },
    })
    indexMock.memoryIndex.upsert.mockResolvedValue([])
    embedMock.generateEmbeddingForUser.mockResolvedValue({ embedding: EMBEDDING })
  })

  it('writes footnotes, links and the count as deltas and re-embeds through the index', async () => {
    const survivor = makeMemory()
    const loser = makeMemory({ id: 'loser', content: 'Friday keeps the ledger for Marguerite.', relatedMemoryIds: ['n2'] })
    const plan = foldInto(survivor, [loser], CAPS)

    const updated = await applyFold(survivor, plan, { userId: 'user-1' })

    expect(appendReinforcementFootnotes).toHaveBeenCalledWith('char-1', 'keep', ['Marguerite'])
    expect(addRelatedMemoryIds).toHaveBeenCalledWith('char-1', 'keep', ['n2'])
    expect(incrementReinforcement.mock.calls[0]).toEqual(['char-1', 'keep', loser.createdAt, 1])
    // No absolute count and no whole content ever reaches a patch.
    expect(updateForCharacter).not.toHaveBeenCalled()
    expect(updated?.content).toContain('[+] Marguerite')
    expect(updated?.reinforcementCount).toBe(8)
    expect(updated?.relatedMemoryIds).toEqual(['n2'])
    expect(embedMock.generateEmbeddingForUser).toHaveBeenCalledTimes(1)
    expect(indexMock.memoryIndex.upsert).toHaveBeenCalledWith('char-1', [{ id: 'keep', embedding: EMBEDDING, tier: 'hot' }])
  })

  it('writes anchor changes in one row update', async () => {
    const survivor = makeMemory({ occurredAt: '2026-03-10T00:00:00.000Z' })
    const plan = foldInto(survivor, [{ content: 'Friday keeps the ledger.', occurredAt: '2026-03-08T00:00:00.000Z' }], CAPS)
    await applyFold(survivor, plan, { userId: 'user-1' })
    expect(updateForCharacter).toHaveBeenCalledWith('char-1', 'keep', { occurredAt: '2026-03-08T00:00:00.000Z' })
    expect(embedMock.generateEmbeddingForUser).toHaveBeenCalledTimes(1)
  })

  it('does not re-embed when only the count changes', async () => {
    const survivor = makeMemory({ content: 'Same words.' })
    await applyFold(survivor, foldInto(survivor, [{ content: 'Same words.' }], CAPS), { userId: 'user-1' })
    expect(incrementReinforcement).toHaveBeenCalledTimes(1)
    expect(embedMock.generateEmbeddingForUser).not.toHaveBeenCalled()
  })

  it('commit point: once the footnotes landed, a missed count still returns the survivor', async () => {
    incrementReinforcement.mockResolvedValue(null)
    const survivor = makeMemory()
    const plan = foldInto(survivor, [{ content: 'Friday keeps the ledger for Marguerite.' }], CAPS)

    const updated = await applyFold(survivor, plan, { userId: 'user-1' })

    expect(updated).not.toBeNull()
    expect(updated?.content).toContain('[+] Marguerite')
    expect(embedMock.generateEmbeddingForUser).toHaveBeenCalledTimes(1)
  })

  it('reports failure when nothing landed (the survivor is gone)', async () => {
    incrementReinforcement.mockResolvedValue(null)
    const survivor = makeMemory({ content: 'Same words.' })
    const updated = await applyFold(survivor, foldInto(survivor, [{ content: 'Same words.' }], CAPS), { userId: 'user-1' })
    expect(updated).toBeNull()
  })

  it('refuses to run in the job child, where buffered writes read back as missing (review #4)', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1'
    try {
      const survivor = makeMemory()
      await expect(applyFold(survivor, foldInto(survivor, [{ content: 'x' }], CAPS), { userId: 'user-1' })).rejects.toThrow(/parent only/)
      expect(appendReinforcementFootnotes).not.toHaveBeenCalled()
    } finally {
      delete process.env.QUILLTAP_JOB_CHILD
    }
  })

  it('bug 226: the delta lands on the committed row, so a concurrent reinforcement survives', async () => {
    const Database = require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'))
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE "memories" (
      "id" TEXT PRIMARY KEY, "characterId" TEXT NOT NULL, "importance" REAL DEFAULT 0.5,
      "reinforcementCount" INTEGER DEFAULT 1, "lastReinforcedAt" TEXT DEFAULT NULL,
      "reinforcedImportance" REAL DEFAULT 0.5, "updatedAt" TEXT NOT NULL)`)
    db.prepare(`INSERT INTO "memories" VALUES ('keep', 'char-1', 0.6, 3, '2026-05-01T00:00:00.000Z', 0.6, 'x')`).run()
    const clientMock = jest.requireMock('@/lib/database/backends/sqlite/client') as { getRawDatabase: jest.Mock }
    clientMock.getRawDatabase.mockReturnValue(db)
    const { MemoriesRepository } = require('@/lib/database/repositories/memories.repository')
    const repo = new MemoriesRepository()
    factoryMock.getRepositories.mockReturnValue({ memories: { incrementReinforcement: repo.incrementReinforcement.bind(repo) } })

    // The dedup run read the survivor at count 3 …
    const survivor = makeMemory({ content: 'Same words.', reinforcementCount: 3 })
    const loser = makeMemory({ id: 'loser', content: 'Same words.', reinforcementCount: 2, createdAt: '2026-04-01T00:00:00.000Z' })
    const plan = foldInto(survivor, [loser], CAPS)
    // … an extraction commits a reinforcement before the fold writes …
    await repo.incrementReinforcement('char-1', 'keep', '2026-06-01T00:00:00.000Z')
    // … and the fold's delta still counts it: 3 + 1 + 2 = 6.
    const updated = await applyFold(survivor, plan, { userId: 'user-1' })

    const row = db.prepare(`SELECT * FROM "memories" WHERE "id" = 'keep'`).get()
    expect(row.reinforcementCount).toBe(6)
    expect(row.reinforcedImportance).toBeCloseTo(calculateReinforcedImportance(0.6, 6))
    // The loser's older timestamp does not rewind the concurrent one.
    expect(row.lastReinforcedAt).toBe('2026-06-01T00:00:00.000Z')
    expect(updated?.reinforcementCount).toBe(6)
    db.close()
  })
})
