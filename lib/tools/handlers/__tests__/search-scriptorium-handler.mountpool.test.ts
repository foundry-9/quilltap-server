/**
 * Scenario Builder mount-pool path for the search-scriptorium handler.
 *
 * When `SearchScriptoriumToolContext.mountPool` is provided (a pre-built
 * `TieredMountPool` — "what this chat could see" before the chat exists),
 * the handler must:
 *   - use the pool as-is instead of resolving one via `resolveTieredMountPool`
 *   - run the `documents` source over `flattenTierPool(pool, { includeParticipants: true })`
 *   - run the `knowledge` source per-tier (participants/character, group,
 *     project, global), each scoped to `pathPrefix: 'Knowledge/'`
 *   - never search memories or conversations, even if requested
 *
 * `flattenTierPool` is the REAL implementation (not mocked) — only
 * `resolveTieredMountPool` is replaced, via a partial mock that spreads the
 * actual module.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { executeSearchScriptoriumTool } from '../search-scriptorium-handler'

// ── Mocks ─────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory'

jest.mock('@/lib/memory/memory-service', () => ({
  searchMemoriesSemantic: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
}))

jest.mock('@/lib/scriptorium/conversation-search', () => ({
  searchConversationChunks: jest.fn(),
}))

jest.mock('@/lib/mount-index/document-search', () => ({
  searchDocumentChunks: jest.fn(),
}))

jest.mock('@/lib/mount-index/tiered-mount-pool', () => {
  const actual = jest.requireActual('@/lib/mount-index/tiered-mount-pool')
  return {
    ...actual,
    resolveTieredMountPool: jest.fn(),
  }
})

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { searchConversationChunks } from '@/lib/scriptorium/conversation-search'
import { searchDocumentChunks } from '@/lib/mount-index/document-search'
import {
  resolveTieredMountPool,
  flattenTierPool,
  type TieredMountPool,
} from '@/lib/mount-index/tiered-mount-pool'
import { searchScriptoriumScenarioToolInputSchema } from '../../search-scriptorium-tool'

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getRepositories).mockReturnValue({
    docMountPoints: {
      findEnabled: jest.fn().mockResolvedValue([]),
      countByName: jest.fn().mockResolvedValue(0),
    },
    characters: {
      findById: jest.fn().mockResolvedValue(null),
      findByIdRaw: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
    },
    chats: {
      findById: jest.fn().mockResolvedValue(null),
    },
  } as never)
  jest.mocked(generateEmbeddingForUser).mockResolvedValue({ embedding: new Float32Array([0.1, 0.2]) } as never)
  jest.mocked(searchConversationChunks).mockResolvedValue([])
  jest.mocked(searchDocumentChunks).mockResolvedValue([])
})

describe('executeSearchScriptoriumTool — Scenario Builder mount pool', () => {
  // A realistic pre-built pool: no acting character (the Scenario Builder has
  // none — cast vaults ride the participant tier instead), a couple of cast
  // vaults, one group store, one project store, and the global store.
  const pool: TieredMountPool = {
    characterMountPointId: null,
    participantMountPointIds: ['participant-mp-1', 'participant-mp-2'],
    groupMountPointIds: ['group-mp-1'],
    projectMountPointIds: ['project-mp-1'],
    globalMountPointId: 'global-mp',
  }

  it('searches documents over flattenTierPool(pool, { includeParticipants: true }) and never resolves a pool', async () => {
    const expectedIds = flattenTierPool(pool, { scope: 'all', includeParticipants: true })
    // Sanity: the fixture actually exercises every tier.
    expect([...expectedIds].sort()).toEqual(
      ['participant-mp-1', 'participant-mp-2', 'group-mp-1', 'project-mp-1', 'global-mp'].sort(),
    )

    const result = await executeSearchScriptoriumTool(
      { query: 'find it', sources: ['documents'] },
      { userId: 'user-1', mountPool: pool },
    )

    expect(result.success).toBe(true)
    expect(searchDocumentChunks).toHaveBeenCalledTimes(1)
    const opts = jest.mocked(searchDocumentChunks).mock.calls[0][1]!
    expect(opts.mountPointIds).toEqual(expectedIds)
    expect(resolveTieredMountPool).not.toHaveBeenCalled()
  })

  it('searches each knowledge tier (participants-as-character, group, project, global) under Knowledge/', async () => {
    const result = await executeSearchScriptoriumTool(
      { query: 'find it', sources: ['knowledge'] },
      { userId: 'user-1', mountPool: pool },
    )

    expect(result.success).toBe(true)
    expect(resolveTieredMountPool).not.toHaveBeenCalled()

    const calls = jest.mocked(searchDocumentChunks).mock.calls
    expect(calls).toHaveLength(4)

    // Every knowledge-tier call is confined to Knowledge/.
    for (const call of calls) {
      expect(call[1]!.pathPrefix).toBe('Knowledge/')
    }

    const mountPointIdSets = calls.map((call) => [...(call[1]!.mountPointIds ?? [])].sort())

    // Participant vaults stand in for the (absent) character tier.
    expect(mountPointIdSets).toContainEqual([...pool.participantMountPointIds].sort())
    expect(mountPointIdSets).toContainEqual([...pool.groupMountPointIds].sort())
    expect(mountPointIdSets).toContainEqual([...pool.projectMountPointIds].sort())
    expect(mountPointIdSets).toContainEqual([pool.globalMountPointId])
  })

  it('never searches memories or conversations, even when requested alongside a mount pool', async () => {
    const result = await executeSearchScriptoriumTool(
      { query: 'find it', sources: ['memories', 'conversations', 'documents'] },
      { userId: 'user-1', characterId: 'char-1', mountPool: pool },
    )

    expect(result.success).toBe(true)
    expect(searchMemoriesSemantic).not.toHaveBeenCalled()
    expect(searchConversationChunks).not.toHaveBeenCalled()
    // documents still ran, so the exclusion above isn't just "handler threw".
    expect(searchDocumentChunks).toHaveBeenCalled()
    expect(resolveTieredMountPool).not.toHaveBeenCalled()
  })
})

describe('searchScriptoriumScenarioToolInputSchema', () => {
  it('rejects a "memories" source', () => {
    const parsed = searchScriptoriumScenarioToolInputSchema.safeParse({
      query: 'the old lighthouse',
      sources: ['memories'],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a "conversations" source', () => {
    const parsed = searchScriptoriumScenarioToolInputSchema.safeParse({
      query: 'the old lighthouse',
      sources: ['conversations'],
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts "documents" and "knowledge" sources', () => {
    const parsed = searchScriptoriumScenarioToolInputSchema.safeParse({
      query: 'the old lighthouse',
      sources: ['documents', 'knowledge'],
    })
    expect(parsed.success).toBe(true)
  })
})
