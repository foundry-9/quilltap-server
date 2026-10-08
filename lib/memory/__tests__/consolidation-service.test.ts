/**
 * runConsolidation end to end with the I/O mocked (memory-consolidation-and-tiers.md §C3–C6).
 */

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
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/instance-settings', () => ({ getMemoryConsolidationSettings: jest.fn() }))
jest.mock('@/lib/embedding/embedding-service', () => ({
  __esModule: true,
  EmbeddingError: class EmbeddingError extends Error {},
  generateEmbeddingForUser: jest.fn(),
}))
jest.mock('@/lib/embedding/vector-store', () => ({ getCharacterVectorStore: jest.fn() }))
jest.mock('@/lib/background-jobs/activity-registry', () => ({
  __esModule: true,
  trackActivity: (_kind: string, fn: () => unknown) => fn(),
}))
jest.mock('@/lib/file-storage/commonplace-digest-vault-bridge', () => ({
  writeCommonplaceDigestsToVault: jest.fn(),
}))
jest.mock('@/lib/llm/cheap-llm-user-selection', () => ({ selectCheapLLMFromProfiles: jest.fn() }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('../frozen-archive-cache', () => ({ invalidateFrozenArchive: jest.fn() }))
jest.mock('@/lib/database/repositories/character-properties-overlay', () => ({
  readVaultTextFile: jest.fn(async () => null),
}))
jest.mock('../cheap-llm-tasks/consolidation-tasks', () => ({
  ...jest.requireActual('../cheap-llm-tasks/consolidation-tasks'),
  consolidateMemoryCluster: jest.fn(),
}))

import { runConsolidation } from '../consolidation'
import { getRepositories } from '@/lib/repositories/factory'
import { getMemoryConsolidationSettings } from '@/lib/instance-settings'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { getCharacterVectorStore } from '@/lib/embedding/vector-store'
import { writeCommonplaceDigestsToVault } from '@/lib/file-storage/commonplace-digest-vault-bridge'
import { selectCheapLLMFromProfiles } from '@/lib/llm/cheap-llm-user-selection'
import { consolidateMemoryCluster, validateConsolidationOutput } from '../cheap-llm-tasks/consolidation-tasks'
import type { Memory } from '@/lib/schemas/types'

const HOLDER = 'holder-1'
const LAURA = 'laura-1'
const NOW = new Date('2026-10-08T12:00:00.000Z')
const OLD = '2026-08-01T00:00:00.000Z'

function at(deg: number): Float32Array {
  const r = (deg * Math.PI) / 180
  return new Float32Array([Math.cos(r), Math.sin(r), 0])
}

function mem(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    characterId: HOLDER,
    aboutCharacterId: LAURA,
    content: `content ${id}`,
    summary: `summary ${id}`,
    keywords: [],
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
    chatId: null,
    projectId: null,
    embedding: at(0),
    createdAt: OLD,
    updatedAt: OLD,
    ...overrides,
  } as Memory
}

const corpus: Memory[] = [
  mem('l1', { embedding: at(0) }),
  mem('l2', { embedding: at(2) }),
  mem('l3', { embedding: at(4) }),
  mem('manual', { embedding: at(1), source: 'MANUAL' }), // never a candidate
  mem('young', { embedding: at(1), createdAt: '2026-10-07T00:00:00.000Z' }), // immature
  mem('cold', { embedding: at(1), tier: 'cold' }), // not hot
  mem('self-1', { aboutCharacterId: HOLDER, embedding: at(90) }),
]

let repos: any
let store: any

beforeEach(() => {
  jest.clearAllMocks()
  store = {
    hasVector: jest.fn(() => false),
    addVector: jest.fn(),
    updateVector: jest.fn(),
    setTier: jest.fn(),
    save: jest.fn(),
  }
  ;(getCharacterVectorStore as jest.Mock).mockResolvedValue(store)
  repos = {
    memories: {
      findByCharacterIdInBatches: jest.fn(async function* () {
        yield corpus
      }),
      create: jest.fn(async (data: any, opts: any) => ({ ...data, id: opts.id })),
      updateForCharacter: jest.fn(),
      updateTierBulk: jest.fn(),
      markConsidered: jest.fn(),
    },
    characters: {
      findByIdRaw: jest.fn(async (id: string) =>
        id === HOLDER
          ? { id: HOLDER, name: 'Friday', userId: 'user-1', archivedAt: null, characterDocumentMountPointId: 'mp-1' }
          : id === LAURA
            ? { id: LAURA, name: 'Laura', userId: 'user-1' }
            : null,
      ),
      findById: jest.fn(async (id: string) => (id === HOLDER ? { id: HOLDER, name: 'Friday', characterDocumentMountPointId: 'mp-1' } : { id: LAURA, name: 'Laura', identity: 'A cartographer.' })),
    },
    chatSettings: { findByUserId: jest.fn(async () => null) },
    connections: { findByUserId: jest.fn(async () => []) },
    chats: { findById: jest.fn(async () => null) },
  }
  ;(getRepositories as jest.Mock).mockReturnValue(repos)
  ;(getMemoryConsolidationSettings as jest.Mock).mockResolvedValue({
    enabled: true,
    connectionProfileId: null,
    clusterThreshold: 0.9,
    minClusterSize: 3,
    maxClusterSize: 30,
    matureAfterDays: 7,
    maxClustersPerRun: 40,
    watermark: 150,
    coldRetentionDays: null,
  })
  ;(selectCheapLLMFromProfiles as jest.Mock).mockReturnValue({
    selection: { provider: 'OPENAI', modelName: 'cheap', isLocal: false },
    defaultProfile: {},
    allProfiles: [],
  })
  ;(generateEmbeddingForUser as jest.Mock).mockResolvedValue({ embedding: new Float32Array([0, 0, 1]) })
  ;(consolidateMemoryCluster as jest.Mock).mockImplementation(async (input: any) => {
    const handles = input.members.map((m: any) => m.handle)
    return {
      success: true,
      result: validateConsolidationOutput(
        {
          digests: [
            {
              content: 'Laura keeps the charts.',
              summary: 'laura keeps charts',
              keywords: ['charts'],
              importance: 0.6,
              kind: 'semantic',
              memberIds: handles.slice(0, 2),
            },
          ],
          keepStandalone: handles.slice(2),
        },
        handles,
      ),
    }
  })
  ;(writeCommonplaceDigestsToVault as jest.Mock).mockResolvedValue({ written: 1, unchanged: 0, skipped: 0 })
})

describe('runConsolidation', () => {
  it('dry run: clusters, calls the model, reports — and writes nothing', async () => {
    const report = await runConsolidation(HOLDER, { dryRun: true, now: NOW })

    expect(report.dryRun).toBe(true)
    expect(report.stats.candidates).toBe(4) // l1, l2, l3, self-1
    expect(report.stats.immatureSkipped).toBe(1)
    expect(consolidateMemoryCluster).toHaveBeenCalledTimes(1)
    const call = (consolidateMemoryCluster as jest.Mock).mock.calls[0][0]
    expect(call.subjectName).toBe('Laura')
    expect(call.bucket).toBe('other')
    expect(call.members).toHaveLength(3)

    expect(report.clusters).toHaveLength(1)
    const cluster = report.clusters[0]
    expect(cluster.status).toBe('planned')
    expect(cluster.memberIds.sort()).toEqual(['l1', 'l2', 'l3'])
    expect(cluster.digests).toHaveLength(1)
    expect(cluster.digests[0].memberIds).toHaveLength(2)
    expect(cluster.keepStandalone).toHaveLength(1)

    expect(repos.memories.create).not.toHaveBeenCalled()
    expect(repos.memories.updateForCharacter).not.toHaveBeenCalled()
    expect(repos.memories.updateTierBulk).not.toHaveBeenCalled()
    expect(repos.memories.markConsidered).not.toHaveBeenCalled()
    expect(generateEmbeddingForUser).not.toHaveBeenCalled()
    expect(writeCommonplaceDigestsToVault).not.toHaveBeenCalled()
  })

  it('real run: inserts the digest with its vector, sends members cold, marks the rest considered, mirrors', async () => {
    const report = await runConsolidation(HOLDER, { now: NOW })

    expect(repos.memories.create).toHaveBeenCalledTimes(1)
    const [data, opts] = repos.memories.create.mock.calls[0]
    expect(data.source).toBe('CONSOLIDATED')
    expect(data.aboutCharacterId).toBe(LAURA)
    expect(data.consolidatedFrom).toHaveLength(2)
    expect(opts.id).toBe(report.clusters[0].digests[0].id)
    expect(repos.memories.updateForCharacter).toHaveBeenCalledWith(HOLDER, opts.id, { embedding: expect.any(Float32Array) })
    expect(store.addVector).toHaveBeenCalledWith(opts.id, expect.any(Float32Array), expect.objectContaining({ memoryId: opts.id }))

    expect(repos.memories.updateTierBulk).toHaveBeenCalledWith(
      HOLDER,
      data.consolidatedFrom,
      'cold',
      { supersededById: opts.id, consolidatedAt: NOW.toISOString() },
    )
    expect(store.setTier).toHaveBeenCalledWith(data.consolidatedFrom, 'cold')

    // The Laura standalone, plus the lone self row (a cluster of one).
    const considered = repos.memories.markConsidered.mock.calls[0][1].sort()
    expect(considered).toHaveLength(2)
    expect(considered).toContain('self-1')
    expect(store.save).toHaveBeenCalled()

    expect(writeCommonplaceDigestsToVault).toHaveBeenCalledWith(
      expect.objectContaining({
        holderCharacterId: HOLDER,
        files: [expect.objectContaining({ subjectCharacterId: LAURA, subjectName: 'Laura', isSelf: false })],
      }),
    )
    expect(report.stats.digestsCreated).toBe(1)
    expect(report.stats.membersSuperseded).toBe(2)
    expect(report.clusters[0].status).toBe('written')
  })

  it('skips a cluster whose answer fails validation, writing nothing for it', async () => {
    ;(consolidateMemoryCluster as jest.Mock).mockResolvedValue({
      success: true,
      result: { ok: false, reason: 'digest 1 names unknown member "m9"' },
    })
    const report = await runConsolidation(HOLDER, { now: NOW })
    expect(report.clusters[0].status).toBe('invalid')
    expect(repos.memories.create).not.toHaveBeenCalled()
    expect(repos.memories.updateTierBulk).not.toHaveBeenCalled()
    // The lone self row is still stamped; the failed cluster's rows are not.
    expect(repos.memories.markConsidered.mock.calls[0][1]).toEqual(['self-1'])
  })

  it('drops a cluster whose digest cannot be embedded', async () => {
    ;(generateEmbeddingForUser as jest.Mock).mockRejectedValue(new Error('provider down'))
    const report = await runConsolidation(HOLDER, { now: NOW })
    expect(report.clusters[0].status).toBe('embedding-failed')
    expect(repos.memories.create).not.toHaveBeenCalled()
    expect(repos.memories.updateTierBulk).not.toHaveBeenCalled()
  })

  it('leaves archived characters alone', async () => {
    repos.characters.findByIdRaw.mockResolvedValue({ id: HOLDER, name: 'Friday', userId: 'user-1', archivedAt: '2026-09-01T00:00:00.000Z' })
    const report = await runConsolidation(HOLDER, { now: NOW })
    expect(report.skippedReason).toBe('archived')
    expect(repos.memories.findByCharacterIdInBatches).not.toHaveBeenCalled()
    expect(consolidateMemoryCluster).not.toHaveBeenCalled()
  })

  it('stops issuing calls when the time budget is spent', async () => {
    const report = await runConsolidation(HOLDER, { now: NOW, timeBudgetMs: -1 })
    expect(consolidateMemoryCluster).not.toHaveBeenCalled()
    expect(report.stats.budgetExhausted).toBe(true)
    expect(report.stats.clustersDeferred).toBe(1)
  })
})
