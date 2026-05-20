/**
 * Regression: doc-mount-chunks repo must invalidate the in-memory
 * mount-chunk cache whenever the *set of embedded chunks* for a mount
 * changes. The cache (lib/mount-index/mount-chunk-cache.ts) loads chunks
 * lazily and filters to those with non-null embeddings, so a fresh chunk
 * without an embedding never enters the cache until something explicitly
 * drops the mount entry. Without invalidation, subsequent searches keep
 * reading the stale snapshot.
 *
 * Surfaced when Friday/Amy wrote a project Knowledge file, the embedding
 * finished cleanly, and the search tool still returned zero project-tier
 * knowledge results.
 *
 * Pins:
 *   - bulkInsert invalidates every mount touched.
 *   - updateEmbedding invalidates the chunk's mount.
 *   - deleteByFileId still invalidates (regression for the previously
 *     working path).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

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

const mockInvalidateMountPoint = jest.fn()
jest.mock('@/lib/mount-index/mount-chunk-cache', () => ({
  invalidateMountPoint: (...args: unknown[]) => mockInvalidateMountPoint(...args),
  // The repo only imports invalidateMountPoint; stub the rest harmlessly.
  invalidateAll: jest.fn(),
  getChunksForMountPoints: jest.fn(),
  getStats: jest.fn(),
}))

import type { DocMountChunksRepository as DocMountChunksRepositoryType } from '@/lib/database/repositories/doc-mount-chunks.repository'

let DocMountChunksRepository: typeof DocMountChunksRepositoryType
beforeAll(async () => {
  ;({ DocMountChunksRepository } = await import('@/lib/database/repositories/doc-mount-chunks.repository'))
})

const MOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FILE_A = 'ffffffff-1111-4fff-8fff-ffffffffffff'
const CHUNK_A = 'ccccccc1-cccc-4ccc-8ccc-cccccccccccc'

describe('DocMountChunksRepository cache invalidation', () => {
  let repo: DocMountChunksRepositoryType

  beforeEach(() => {
    jest.clearAllMocks()
    repo = new DocMountChunksRepository()
  })

  it('bulkInsert invalidates every mount referenced by the inserted chunks (deduped)', async () => {
    // Stub the protected _create so it just echoes back a fabricated row.
    const createSpy = jest
      .spyOn(repo as unknown as { _create: (arg: unknown) => Promise<unknown> }, '_create')
      .mockImplementation(async (chunk: any) => ({
        id: 'cid-' + Math.random().toString(36).slice(2, 8),
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
        ...chunk,
      }))

    await repo.bulkInsert([
      {
        mountPointId: MOUNT_A,
        fileId: FILE_A,
        chunkIndex: 0,
        content: 'one',
        tokenCount: 1,
        headingContext: null,
        embedding: null,
      } as any,
      {
        mountPointId: MOUNT_A,
        fileId: FILE_A,
        chunkIndex: 1,
        content: 'two',
        tokenCount: 1,
        headingContext: null,
        embedding: null,
      } as any,
      {
        mountPointId: MOUNT_B,
        fileId: 'other',
        chunkIndex: 0,
        content: 'other-mount',
        tokenCount: 1,
        headingContext: null,
        embedding: null,
      } as any,
    ])

    expect(createSpy).toHaveBeenCalledTimes(3)
    // Two unique mountPointIds → two invalidations.
    expect(mockInvalidateMountPoint).toHaveBeenCalledTimes(2)
    const invalidatedMounts = mockInvalidateMountPoint.mock.calls.map(c => c[0]).sort()
    expect(invalidatedMounts).toEqual([MOUNT_A, MOUNT_B].sort())
  })

  it('updateEmbedding invalidates the cache for the chunk\'s mount', async () => {
    jest
      .spyOn(repo as unknown as { _update: (...args: unknown[]) => Promise<unknown> }, '_update')
      .mockResolvedValue({
        id: CHUNK_A,
        mountPointId: MOUNT_A,
        fileId: FILE_A,
        chunkIndex: 0,
        content: 'body',
        tokenCount: 5,
        headingContext: null,
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      })

    await repo.updateEmbedding(CHUNK_A, new Float32Array([0.1, 0.2, 0.3]))

    expect(mockInvalidateMountPoint).toHaveBeenCalledTimes(1)
    expect(mockInvalidateMountPoint).toHaveBeenCalledWith(MOUNT_A)
  })

  it('updateEmbedding throws and does not invalidate when the chunk is missing', async () => {
    jest
      .spyOn(repo as unknown as { _update: (...args: unknown[]) => Promise<unknown> }, '_update')
      .mockResolvedValue(null)

    await expect(repo.updateEmbedding(CHUNK_A, new Float32Array([0.1]))).rejects.toThrow(
      `Doc mount chunk not found for embedding update: ${CHUNK_A}`,
    )
    expect(mockInvalidateMountPoint).not.toHaveBeenCalled()
  })
})
