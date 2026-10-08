/**
 * Consolidation write planning (memory-consolidation-and-tiers.md §C5) — pure.
 */

jest.mock('@/lib/embedding/embedding-service', () => ({
  __esModule: true,
  EmbeddingError: class EmbeddingError extends Error {},
  generateEmbeddingForUser: jest.fn(),
}))
jest.mock('@/lib/background-jobs/activity-registry', () => ({
  __esModule: true,
  trackActivity: (_kind: string, fn: () => unknown) => fn(),
}))

import {
  clampDigestImportance,
  deriveWitnessedContext,
  normalizeDigestKeywords,
  planConsolidationWrites,
  sharedValue,
  DIGEST_REINFORCEMENT_CAP,
  type LinkIndexRow,
  type ResolvedClusterOutcome,
} from '../consolidation-plan'
import { calculateReinforcedImportance } from '../memory-gate'
import type { Memory } from '@/lib/schemas/types'

const HOLDER = 'holder-1'
const LAURA = 'laura-1'
const NOW = '2026-10-08T12:00:00.000Z'

function mem(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    characterId: HOLDER,
    aboutCharacterId: LAURA,
    content: `content ${id}`,
    summary: `summary ${id}`,
    keywords: ['present', 'scope: wide', 'information'],
    tags: [],
    importance: 0.6,
    source: 'AUTO',
    entities: [],
    kind: 'semantic',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: 0.6,
    tier: 'hot',
    supersededById: null,
    consolidatedFrom: [],
    consolidatedAt: null,
    chatId: 'chat-a',
    projectId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Memory
}

function outcome(overrides: Partial<ResolvedClusterOutcome>): ResolvedClusterOutcome {
  return {
    aboutCharacterId: LAURA,
    clusterKind: 'semantic',
    existingDigest: null,
    members: [],
    digests: [],
    keepStandalone: [],
    contradictions: [],
    embeddings: [],
    ...overrides,
  }
}

function digestOut(memberIds: string[], extra: Partial<ResolvedClusterOutcome['digests'][number]> = {}) {
  return {
    content: 'Laura keeps the charts and prefers tea now.',
    summary: 'laura keeps charts prefers tea',
    keywords: ['charts', 'tea'],
    importance: 0.95,
    kind: 'semantic' as const,
    memberIds,
    ...extra,
  }
}

function index(rows: Memory[], extra: LinkIndexRow[] = []): Map<string, LinkIndexRow> {
  const map = new Map<string, LinkIndexRow>()
  for (const r of rows) map.set(r.id, { id: r.id, relatedMemoryIds: r.relatedMemoryIds })
  for (const r of extra) map.set(r.id, r)
  return map
}

function ids(): () => string {
  let n = 0
  return () => `new-${++n}`
}

describe('planConsolidationWrites — a new digest', () => {
  const m1 = mem('m1', { reinforcementCount: 2, reinforcedImportance: 0.55, relatedMemoryIds: ['m2', 'x1'] })
  const m2 = mem('m2', { reinforcementCount: 3, reinforcedImportance: 0.75, relatedMemoryIds: ['m1', 'x2'], chatId: 'chat-b' })
  const m3 = mem('m3', { reinforcedImportance: 0.65 })
  const x1 = mem('x1', { relatedMemoryIds: ['m1'] })
  const x2 = mem('x2', { relatedMemoryIds: ['m2', 'x1'] })

  const plan = planConsolidationWrites({
    characterId: HOLDER,
    clusters: [
      outcome({
        members: [m1, m2, m3],
        digests: [digestOut(['m1', 'm2'])],
        keepStandalone: ['m3'],
        embeddings: [new Float32Array([1, 0])],
      }),
    ],
    rowIndex: index([m1, m2, m3, x1, x2]),
    nowIso: NOW,
    newId: ids(),
  })

  it('creates one CONSOLIDATED digest carrying its members', () => {
    expect(plan.creates).toHaveLength(1)
    expect(plan.updates).toHaveLength(0)
    const create = plan.creates[0]
    expect(create.id).toBe('new-1')
    expect(create.data.source).toBe('CONSOLIDATED')
    expect(create.data.tier).toBe('hot')
    expect(create.data.consolidatedFrom).toEqual(['m1', 'm2'])
    expect(create.data.aboutCharacterId).toBe(LAURA)
    expect(create.embedding).toEqual(new Float32Array([1, 0]))
  })

  it('sums reinforcement counts and clamps importance to the members’ range', () => {
    const create = plan.creates[0]
    expect(create.data.reinforcementCount).toBe(5)
    expect(create.data.importance).toBe(0.75) // model said 0.95; members max 0.75
    expect(create.data.reinforcedImportance).toBeCloseTo(calculateReinforcedImportance(0.75, 5))
  })

  it('keeps chatId only when every member shares one', () => {
    expect(plan.creates[0].data.chatId).toBeNull()
  })

  it('links the digest to everything its members linked outside it', () => {
    expect(plan.creates[0].data.relatedMemoryIds.sort()).toEqual(['x1', 'x2'])
  })

  it('sends members cold under the digest and marks the standalone considered', () => {
    expect(plan.tierMoves).toEqual([{ supersededById: 'new-1', ids: ['m1', 'm2'] }])
    expect(plan.considered).toEqual(['m3'])
  })

  it('re-aims inbound links at the digest, de-duplicated', () => {
    const rewrites = new Map(plan.linkRewrites.map((r) => [r.id, r.relatedMemoryIds]))
    expect(rewrites.get('x1')).toEqual(['new-1'])
    expect(rewrites.get('x2')).toEqual(['new-1', 'x1'])
    expect(rewrites.has('m3')).toBe(false)
  })

  it('ends the keywords with exactly one value per targeting axis', () => {
    expect(plan.creates[0].data.keywords).toEqual(['charts', 'tea', 'present', 'scope: wide', 'information'])
  })
})

describe('planConsolidationWrites — reinforcement cap and episodes', () => {
  it('caps the digest count at DIGEST_REINFORCEMENT_CAP', () => {
    const members = [mem('a', { reinforcementCount: 40 }), mem('b', { reinforcementCount: 30 })]
    const plan = planConsolidationWrites({
      characterId: HOLDER,
      clusters: [outcome({ members, digests: [digestOut(['a', 'b'])], embeddings: [null] })],
      rowIndex: index(members),
      nowIso: NOW,
      newId: ids(),
    })
    expect(plan.creates[0].data.reinforcementCount).toBe(DIGEST_REINFORCEMENT_CAP)
  })

  it('stamps an episode digest with the earliest member event time', () => {
    const members = [
      mem('e1', { kind: 'episodic', occurredAt: '2026-07-14T18:00:00.000Z', entities: ['Lighthouse Point'] }),
      mem('e2', { kind: 'episodic', occurredAt: '2026-07-14T09:00:00.000Z', entities: ['Amy'] }),
    ]
    const plan = planConsolidationWrites({
      characterId: HOLDER,
      clusters: [outcome({ clusterKind: 'episodic', members, digests: [digestOut(['e1', 'e2'])], embeddings: [null] })],
      rowIndex: index(members),
      nowIso: NOW,
      newId: ids(),
    })
    const data = plan.creates[0].data
    expect(data.kind).toBe('episodic')
    expect(data.occurredAt).toBe('2026-07-14T09:00:00.000Z')
    expect(data.entities).toEqual(['Lighthouse Point', 'Amy'])
    expect(data.keywords).toContain('past')
  })
})

describe('planConsolidationWrites — existing digest updated in place', () => {
  const digest = mem('d1', {
    source: 'CONSOLIDATED',
    consolidatedFrom: ['old-1', 'old-2'],
    reinforcementCount: 6,
    reinforcedImportance: 0.8,
    relatedMemoryIds: ['y1'],
  })
  const m1 = mem('m1', { reinforcedImportance: 0.5 })
  const y1 = mem('y1')
  const plan = planConsolidationWrites({
    characterId: HOLDER,
    clusters: [
      outcome({
        existingDigest: digest,
        members: [m1],
        digests: [digestOut(['m1'], { importance: 0.3 })],
        embeddings: [new Float32Array([0, 1])],
      }),
    ],
    rowIndex: index([digest, m1, y1]),
    nowIso: NOW,
    newId: ids(),
  })

  it('revises the digest instead of minting a second row', () => {
    expect(plan.creates).toHaveLength(0)
    expect(plan.updates).toHaveLength(1)
    const update = plan.updates[0]
    expect(update.id).toBe('d1')
    expect(update.patch.consolidatedFrom).toEqual(['old-1', 'old-2', 'm1'])
    expect(update.patch.reinforcementCount).toBe(7)
    expect(update.patch.importance).toBe(0.5) // clamped up to the members' (digest included) floor
    expect(update.patch.relatedMemoryIds).toEqual(['y1'])
    expect(update.embedding).toEqual(new Float32Array([0, 1]))
  })

  it('sends the new member cold under the existing digest', () => {
    expect(plan.tierMoves).toEqual([{ supersededById: 'd1', ids: ['m1'] }])
  })
})

describe('planConsolidationWrites — contradictions and cross-cluster links', () => {
  it('sends the older side of a contradiction cold under the digest carrying the newer fact', () => {
    const older = mem('old', { content: 'Laura prefers coffee.' })
    const newer = mem('new', { content: 'Laura prefers tea now.' })
    const other = mem('other')
    const plan = planConsolidationWrites({
      characterId: HOLDER,
      clusters: [
        outcome({
          members: [older, newer, other],
          digests: [digestOut(['new', 'other'])],
          keepStandalone: ['old'],
          contradictions: [{ olderId: 'old', newerId: 'new', note: 'changed drink' }],
          embeddings: [null],
        }),
      ],
      rowIndex: index([older, newer, other]),
      nowIso: NOW,
      newId: ids(),
    })
    expect(plan.supersededBy.get('old')).toBe('new-1')
    expect(plan.tierMoves).toEqual([{ supersededById: 'new-1', ids: ['new', 'other', 'old'] }])
    expect(plan.considered).toEqual([])
  })

  it('falls back to the newer row itself when the newer fact stands alone', () => {
    const older = mem('old')
    const newer = mem('new')
    const plan = planConsolidationWrites({
      characterId: HOLDER,
      clusters: [
        outcome({
          members: [older, newer],
          digests: [],
          keepStandalone: ['old', 'new'],
          contradictions: [{ olderId: 'old', newerId: 'new', note: '' }],
          embeddings: [],
        }),
      ],
      rowIndex: index([older, newer]),
      nowIso: NOW,
      newId: ids(),
    })
    expect(plan.tierMoves).toEqual([{ supersededById: 'new', ids: ['old'] }])
    expect(plan.considered).toEqual(['new'])
  })

  it('re-aims a digest link at the digest that absorbed its target in another cluster', () => {
    const a1 = mem('a1', { relatedMemoryIds: ['b1'] })
    const a2 = mem('a2')
    const b1 = mem('b1', { relatedMemoryIds: ['a1'] })
    const b2 = mem('b2')
    const plan = planConsolidationWrites({
      characterId: HOLDER,
      clusters: [
        outcome({ members: [a1, a2], digests: [digestOut(['a1', 'a2'])], embeddings: [null] }),
        outcome({ members: [b1, b2], digests: [digestOut(['b1', 'b2'])], embeddings: [null] }),
      ],
      rowIndex: index([a1, a2, b1, b2]),
      nowIso: NOW,
      newId: ids(),
    })
    const [da, db] = plan.creates
    expect(da.data.relatedMemoryIds).toEqual([db.id])
    expect(db.data.relatedMemoryIds).toEqual([da.id])
    expect(plan.linkRewrites).toEqual([])
  })
})

describe('field helpers', () => {
  it('sharedValue needs every value to agree and be non-empty', () => {
    expect(sharedValue(['a', 'a'])).toBe('a')
    expect(sharedValue(['a', 'b'])).toBeNull()
    expect(sharedValue(['a', null])).toBeNull()
    expect(sharedValue([])).toBeNull()
  })

  it('deriveWitnessedContext prefers the shared value, then user_present', () => {
    expect(deriveWitnessedContext(['autonomous_room', 'autonomous_room'])).toBe('autonomous_room')
    expect(deriveWitnessedContext(['autonomous_room', 'user_present'])).toBe('user_present')
    expect(deriveWitnessedContext(['autonomous_room', 'manual'])).toBeNull()
  })

  it('clampDigestImportance holds the model to 0.2–1.0, then to the members’ range', () => {
    const rows = [mem('a', { reinforcedImportance: 0.4 }), mem('b', { reinforcedImportance: 0.7 })]
    expect(clampDigestImportance(0.9, rows)).toBe(0.7)
    expect(clampDigestImportance(0.1, rows)).toBe(0.4)
    expect(clampDigestImportance(0.55, rows)).toBe(0.55)
  })

  it('normalizeDigestKeywords keeps the model’s tags and fills missing axes from the members', () => {
    expect(
      normalizeDigestKeywords(['Tea', 'future', 'tea'], [['past', 'scope: narrow', 'banter'], ['past', 'scope: narrow', 'trivia'], ['present', 'scope: narrow', 'banter']], 'semantic'),
    ).toEqual(['tea', 'future', 'scope: narrow', 'banter'])
  })
})
