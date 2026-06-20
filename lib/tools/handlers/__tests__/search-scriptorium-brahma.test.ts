/**
 * Defense-in-depth test for the operator-surface (Brahma Console) search path:
 * even if a caller smuggles `sources: ['memories']` past the schema, the
 * handler forces memory search OFF when `operatorSurface` is set (no character,
 * no commonplace-book access). It also confirms documents reach the operator's
 * enabled stores and conversations are searched operator-wide (by userId).
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

jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveTieredMountPool: jest.fn(),
  flattenTierPool: jest.fn(() => []),
}))

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { searchConversationChunks } from '@/lib/scriptorium/conversation-search'
import { searchDocumentChunks } from '@/lib/mount-index/document-search'
import { resolveTieredMountPool } from '@/lib/mount-index/tiered-mount-pool'

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getRepositories).mockReturnValue({
    docMountPoints: {
      findEnabled: jest.fn().mockResolvedValue([{ id: 'mp-1' }, { id: 'mp-2' }]),
    },
  } as never)
  jest.mocked(generateEmbeddingForUser).mockResolvedValue({ embedding: new Float32Array([0.1, 0.2]) } as never)
  jest.mocked(searchConversationChunks).mockResolvedValue([])
  jest.mocked(searchDocumentChunks).mockResolvedValue([])
})

describe('executeSearchScriptoriumTool — operator surface (Brahma)', () => {
  it('never searches memories even when the caller requests them', async () => {
    const result = await executeSearchScriptoriumTool(
      { query: 'find it', sources: ['memories', 'conversations', 'documents'] },
      { userId: 'user-1', operatorSurface: true },
    )

    expect(result.success).toBe(true)
    expect(searchMemoriesSemantic).not.toHaveBeenCalled()
    // No per-character tiered pool either — operator surface uses every enabled store.
    expect(resolveTieredMountPool).not.toHaveBeenCalled()
    expect(getRepositories().docMountPoints.findEnabled).toHaveBeenCalled()
  })

  it('searches conversations operator-wide (by userId, not a character)', async () => {
    await executeSearchScriptoriumTool(
      { query: 'find it', sources: ['conversations'] },
      { userId: 'user-1', operatorSurface: true },
    )

    expect(searchConversationChunks).toHaveBeenCalledTimes(1)
    const opts = jest.mocked(searchConversationChunks).mock.calls[0][1]
    expect(opts.userId).toBe('user-1')
    expect(opts.characterId).toBeUndefined()
  })

  it('searches documents across every enabled store', async () => {
    await executeSearchScriptoriumTool(
      { query: 'find it', sources: ['documents'] },
      { userId: 'user-1', operatorSurface: true },
    )

    expect(searchDocumentChunks).toHaveBeenCalledTimes(1)
    const opts = jest.mocked(searchDocumentChunks).mock.calls[0][1]!
    expect(opts.mountPointIds).toEqual(['mp-1', 'mp-2'])
  })
})
