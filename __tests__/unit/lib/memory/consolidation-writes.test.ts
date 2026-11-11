/**
 * Refactor 4.13, A9 — consolidation writes as deltas.
 *
 * A maintenance run reads the corpus, plans (`planConsolidationWrites`, pure)
 * and only then writes. These tests interleave admission's writes between the
 * read and the write, against an in-memory table whose writes land at once
 * and whose delta methods behave as the repository's do, and check that
 * `applyConsolidationPlan` keeps every one of them:
 *
 *  - a reinforcement of the digest is not rewound;
 *  - a link admission added to the digest is not dropped (no one-way link);
 *  - a link admission added to a member after the read is re-aimed at the
 *    digest, not left on a cold row;
 *  - a retired id is never written back into `relatedMemoryIds` or
 *    `consolidatedFrom`;
 *  - a cluster whose member was retired, or whose digest text changed, is
 *    skipped whole and stays unconsidered.
 *
 * On `HEAD` before this change the first three were overwritten by absolute
 * values from the snapshot.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: {},
  embeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').embeddingTextFor,
  lexicalEmbeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').lexicalEmbeddingTextFor,
}))
jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
}))
jest.mock('@/lib/background-jobs/activity-registry', () => ({ trackActivity: (_k: string, fn: () => unknown) => fn() }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/background-jobs/host/processor-host', () => ({ notifyChild: jest.fn(), patchChildMemoryIndex: jest.fn() }))
jest.mock('@/lib/memory/maintenance/triggers', () => ({ maybeEnqueueMaintenance: jest.fn(async () => []) }))
jest.mock('@/lib/memory/time/calendar-refresh', () => ({ refreshMemoryTimeZone: jest.fn(async () => 'UTC') }))

import type { Memory } from '@/lib/schemas/types'
import { applyConsolidationPlan } from '@/lib/memory/admission/consolidation-writes'
import { resetAdmissionStateForTests } from '@/lib/memory/admission/admit'
import { planConsolidationWrites, type ResolvedClusterOutcome } from '@/lib/memory/consolidation-plan'
import { createFakeMemoryStore, fakeMemoryIndex, fakeRepositories, seedMemory, type FakeMemoryStore } from '../../../helpers/memory-admission-fake'

const factoryMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
const indexMock = jest.requireMock('@/lib/memory/index-store') as { memoryIndex: Record<string, unknown> }

const CHAR = 'char-1'
const NOW = '2026-11-10T12:00:00.000Z'
const VEC = new Float32Array([1, 0, 0])
const DIGEST_VEC = new Float32Array([0, 1, 0])

function snapshot(store: FakeMemoryStore): Map<string, Memory> {
  return new Map(Array.from(store.rows.values()).map((m) => [m.id, { ...m, relatedMemoryIds: [...(m.relatedMemoryIds ?? [])], consolidatedFrom: [...(m.consolidatedFrom ?? [])] }]))
}

/** Plan one cluster from the rows as they stood at `read`. */
function planFrom(read: Map<string, Memory>, cluster: Omit<ResolvedClusterOutcome, 'members' | 'existingDigest'> & { memberIds: string[]; existingDigestId?: string }) {
  const outcome: ResolvedClusterOutcome = {
    aboutCharacterId: cluster.aboutCharacterId,
    clusterKind: cluster.clusterKind,
    existingDigest: cluster.existingDigestId ? read.get(cluster.existingDigestId)! : null,
    members: cluster.memberIds.map((id) => read.get(id)!),
    digests: cluster.digests,
    keepStandalone: cluster.keepStandalone,
    contradictions: cluster.contradictions,
    embeddings: cluster.embeddings,
  }
  let n = 0
  return planConsolidationWrites({
    characterId: CHAR,
    clusters: [outcome],
    rowIndex: new Map(Array.from(read.values()).map((m) => [m.id, { id: m.id, relatedMemoryIds: m.relatedMemoryIds ?? [] }])),
    nowIso: NOW,
    newId: () => `new-${++n}`,
  })
}

describe('applyConsolidationPlan (A9)', () => {
  let store: FakeMemoryStore

  beforeEach(() => {
    resetAdmissionStateForTests()
    store = createFakeMemoryStore()
    factoryMock.getRepositories.mockReturnValue(fakeRepositories(store))
    Object.assign(indexMock.memoryIndex, fakeMemoryIndex(store))
  })

  describe('an existing digest taking a new member', () => {
    beforeEach(() => {
      seedMemory(store, {
        id: 'd1', source: 'CONSOLIDATED', content: 'Friday keeps the ledger.', embedding: VEC,
        consolidatedFrom: ['old-1'], reinforcementCount: 3, relatedMemoryIds: ['x'], lastReinforcedAt: '2026-10-01T00:00:00.000Z',
      })
      seedMemory(store, { id: 'old-1', tier: 'cold', supersededById: 'd1', embedding: VEC })
      seedMemory(store, { id: 'm1', content: 'Friday audits the ledger.', embedding: VEC, reinforcementCount: 2, relatedMemoryIds: ['y'] })
      seedMemory(store, { id: 'x', embedding: VEC, relatedMemoryIds: ['d1'] })
      seedMemory(store, { id: 'y', embedding: VEC, relatedMemoryIds: ['m1'] })
      seedMemory(store, { id: 'z', embedding: VEC })
      seedMemory(store, { id: 'gone', embedding: VEC })
    })

    function plan(read: Map<string, Memory>) {
      return planFrom(read, {
        aboutCharacterId: null,
        clusterKind: 'semantic',
        existingDigestId: 'd1',
        memberIds: ['m1'],
        digests: [{ content: 'Friday keeps and audits the ledger.', summary: 's', keywords: [], importance: 0.5, kind: 'semantic', memberIds: ['m1'] }],
        keepStandalone: [],
        contradictions: [],
        embeddings: [DIGEST_VEC],
      })
    }

    it('keeps a reinforcement, a link and a re-aim admission wrote between the read and the write', async () => {
      const read = snapshot(store)
      const p = plan(read)

      // ── Admission, meanwhile ────────────────────────────────────────────
      // A near-duplicate absorbed into the digest by count only (text unchanged).
      const repos = fakeRepositories(store)
      await repos.memories.incrementReinforcement(CHAR, 'd1', '2026-11-09T00:00:00.000Z', 1)
      // A new row linked both ways to the digest.
      await repos.memories.addRelatedMemoryIds(CHAR, 'd1', ['z'])
      await repos.memories.addRelatedMemoryIds(CHAR, 'z', ['d1'])
      // A new row linked to the member about to go cold.
      seedMemory(store, { id: 'w', embedding: VEC, relatedMemoryIds: ['m1'] })
      await repos.memories.addRelatedMemoryIds(CHAR, 'm1', ['w'])

      const applied = await applyConsolidationPlan({ characterId: CHAR, plan: p, extraConsidered: [], nowIso: NOW })
      expect(applied.landedClusters).toEqual([0])

      const d1 = store.rows.get('d1')!
      // 3 (read) + 1 (admission) + 2 (m1) — the snapshot's absolute 5 would have rewound it.
      expect(d1.reinforcementCount).toBe(6)
      expect(d1.lastReinforcedAt).toBe(NOW)
      expect(d1.consolidatedFrom).toEqual(['old-1', 'm1'])
      expect(d1.content).toBe('Friday keeps and audits the ledger.')
      // Admission's link survives; the member's links are taken over, both ways.
      expect(new Set(d1.relatedMemoryIds)).toEqual(new Set(['x', 'z', 'y', 'w']))
      expect(store.rows.get('z')!.relatedMemoryIds).toContain('d1')
      // Inbound links to the cold member are re-aimed, including the one added after the read.
      expect(store.rows.get('y')!.relatedMemoryIds).toEqual(['d1'])
      expect(store.rows.get('w')!.relatedMemoryIds).toEqual(['d1'])
      expect(store.rows.get('m1')).toMatchObject({ tier: 'cold', supersededById: 'd1' })
      expect(applied.linksRewired).toBe(2)
    })

    it('never writes a retired id back', async () => {
      store.rows.get('m1')!.relatedMemoryIds = ['y', 'gone']
      const read = snapshot(store)
      const p = plan(read)
      // Retired meanwhile (retireMemories scrubs links to it).
      store.rows.delete('gone')
      store.rows.get('m1')!.relatedMemoryIds = ['y']

      await applyConsolidationPlan({ characterId: CHAR, plan: p, extraConsidered: [], nowIso: NOW })
      expect(store.rows.get('d1')!.relatedMemoryIds).not.toContain('gone')
    })

    it('caps the count against the digest as it stands at write time', async () => {
      store.rows.get('d1')!.reinforcementCount = 49
      const p = plan(snapshot(store))
      await applyConsolidationPlan({ characterId: CHAR, plan: p, extraConsidered: [], nowIso: NOW })
      expect(store.rows.get('d1')!.reinforcementCount).toBe(50)
    })

    it('skips the batch when the digest text changed since the read (a footnote landed)', async () => {
      const p = plan(snapshot(store))
      store.rows.get('d1')!.content = 'Friday keeps the ledger.\n[+] in green ink'
      const applied = await applyConsolidationPlan({ characterId: CHAR, plan: p, extraConsidered: [], nowIso: NOW })
      expect(applied.staleClusters).toEqual([0])
      expect(store.rows.get('d1')!.content).toBe('Friday keeps the ledger.\n[+] in green ink')
      expect(store.rows.get('m1')!.tier).toBe('hot')
    })
  })

  describe('a new digest', () => {
    beforeEach(() => {
      seedMemory(store, { id: 'a', embedding: VEC, reinforcementCount: 2 })
      seedMemory(store, { id: 'b', embedding: VEC })
      seedMemory(store, { id: 'c', embedding: VEC })
    })

    function plan() {
      return planFrom(snapshot(store), {
        aboutCharacterId: null,
        clusterKind: 'semantic',
        memberIds: ['a', 'b', 'c'],
        digests: [{ content: 'A and B.', summary: 's', keywords: [], importance: 0.5, kind: 'semantic', memberIds: ['a', 'b'] }],
        keepStandalone: ['c'],
        contradictions: [],
        embeddings: [DIGEST_VEC],
      })
    }

    it('counts its members as they stand at write time', async () => {
      const p = plan()
      await fakeRepositories(store).memories.incrementReinforcement(CHAR, 'a', NOW, 1)
      await applyConsolidationPlan({ characterId: CHAR, plan: p, extraConsidered: [], nowIso: NOW })
      const digest = store.rows.get('new-1')!
      expect(digest.source).toBe('CONSOLIDATED')
      expect(digest.reinforcementCount).toBe(4) // a: 3, b: 1
      expect(digest.consolidatedFrom).toEqual(['a', 'b'])
      expect(store.rows.get('c')!.consolidatedAt).toBe(NOW)
    })

    it('skips the cluster whole when a member was retired, leaving its rows unconsidered', async () => {
      const p = plan()
      store.rows.delete('b')
      const applied = await applyConsolidationPlan({ characterId: CHAR, plan: p, extraConsidered: ['other'], nowIso: NOW })
      expect(applied.staleClusters).toEqual([0])
      expect(store.rows.has('new-1')).toBe(false)
      expect(store.rows.get('a')!.tier).toBe('hot')
      expect(store.rows.get('c')!.consolidatedAt ?? null).toBeNull()
    })
  })

  it('refuses to run in the job child', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1'
    try {
      await expect(
        applyConsolidationPlan({ characterId: CHAR, plan: planFrom(new Map(), { aboutCharacterId: null, clusterKind: 'semantic', memberIds: [], digests: [], keepStandalone: [], contradictions: [], embeddings: [] }), extraConsidered: [], nowIso: NOW }),
      ).rejects.toThrow(/parent/)
    } finally {
      delete process.env.QUILLTAP_JOB_CHILD
    }
  })
})
