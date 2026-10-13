/**
 * The probe fixture (memory refactor §5.1, decision 14): the recall stages,
 * run over the synthetic probe corpus, reproduce every row the pre-Phase-E
 * search returned under the shipped `cap14` tuning — order, relevance,
 * salience, multiplier labels and blended score — and the gold-at-head total.
 * See `__tests__/fixtures/recall-probes/README.md`.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
  cosineSimilarity: jest.fn(),
}))
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: { search: jest.fn(), shape: jest.fn() },
  embeddingTextFor: jest.fn(),
}))

import { searchRecall } from '@/lib/memory/recall/search'
import type { RecallQuery } from '@/lib/memory/recall/query'
import { DEFAULT_RECALL_TUNING } from '@/lib/memory/recall/tags'
import { getRepositories } from '@/lib/repositories/factory'
import { generateEmbeddingForUser, cosineSimilarity } from '@/lib/embedding/embedding-service'
import { memoryIndex } from '@/lib/memory/index-store'
import { loadProbeFixture, probeWorld } from '../../../../fixtures/recall-probes/harness'

const fixture = loadProbeFixture()
const world = probeWorld(fixture)

beforeEach(() => {
  ;(getRepositories as jest.Mock).mockReturnValue({ memories: world.memories })
  ;(generateEmbeddingForUser as jest.Mock).mockImplementation((text: string) => world.embed(text))
  ;(cosineSimilarity as jest.Mock).mockImplementation(world.cosine)
  ;(memoryIndex.search as jest.Mock).mockImplementation(world.index.search)
  ;(memoryIndex.shape as jest.Mock).mockImplementation(world.index.shape)
})

async function queryFor(turn: (typeof fixture.turns)[number]): Promise<RecallQuery> {
  const probes = []
  for (const text of turn.extraProbes) probes.push({ text, embedding: await world.embed(text) })
  return {
    text: turn.query,
    embedding: await world.embed(turn.query) as never,
    probes: probes as never,
    signals: null,
    anchors: turn.entityAnchors,
    window: turn.occurredWithin,
    retrospective: turn.recallContext.turnRetrospective,
  }
}

describe('recall probe fixture', () => {
  it('ships the cap14 tuning', () => {
    expect(DEFAULT_RECALL_TUNING.boostCap).toBe(1.4)
    expect(DEFAULT_RECALL_TUNING.boostGate).toEqual({ abs: 0.45, margin: 0.15, ramp: 0.1 })
  })

  it.each(fixture.turns.map(t => [t.slot, t] as const))('slot %s reproduces the captured ranking', async (_slot, turn) => {
    const { candidates } = await searchRecall(fixture.characterId, await queryFor(turn), {
      limit: turn.limit,
      minImportance: turn.minImportance,
      headSize: turn.headSize,
      nowMs: turn.weightClockMs,
      recallContext: {
        ...turn.recallContext,
        recentlyWhisperedIds: new Set(turn.recallContext.recentlyWhisperedIds),
      } as never,
    })
    const actual = candidates.map(c => ({
      id: c.memory.id,
      score: c.score,
      salience: c.salience,
      blendedAfter: c.recallAdjustment?.blendedAfter ?? null,
      fired: c.recallAdjustment?.fired ?? [],
      usedEmbedding: c.usedEmbedding,
    }))
    expect(actual.map(r => r.id)).toEqual(turn.expected.map(r => r.id))
    actual.forEach((row, i) => {
      const want = turn.expected[i]
      expect(row.fired).toEqual(want.fired)
      expect(row.usedEmbedding).toBe(want.usedEmbedding)
      expect(row.score).toBeCloseTo(want.score, 9)
      expect(row.salience).toBeCloseTo(want.salience, 9)
      if (want.blendedAfter === null) expect(row.blendedAfter).toBeNull()
      else expect(row.blendedAfter).toBeCloseTo(want.blendedAfter, 9)
    })
  })

  it('keeps the gold-at-head total', async () => {
    let goldAtHead = 0
    for (const turn of fixture.turns) {
      const { candidates } = await searchRecall(fixture.characterId, await queryFor(turn), {
        limit: turn.limit,
        minImportance: turn.minImportance,
        headSize: turn.headSize,
        nowMs: turn.weightClockMs,
        recallContext: { ...turn.recallContext, recentlyWhisperedIds: new Set(turn.recallContext.recentlyWhisperedIds) } as never,
      })
      const head = new Set(candidates.slice(0, turn.headSize).map(c => c.memory.id))
      goldAtHead += turn.gold.filter(id => head.has(id)).length
    }
    expect(goldAtHead).toBe(fixture.goldAtHead)
  })
})
