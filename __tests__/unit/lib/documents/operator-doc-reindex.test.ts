/**
 * #133 — a Document Mode save in `project` scope into a project's official
 * store skipped the chunk/embed pass that the same write from a `doc_*` tool
 * gets. The re-index gate is the resolved path's `mountPointId`, never its
 * scope, and hard-link siblings are re-indexed too.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  logger.child = jest.fn(() => logger)
  return { logger }
})

jest.mock('@/lib/doc-edit', () => ({
  readFileWithMtime: jest.fn(),
  resolveDocEditPath: jest.fn(),
  writeFileWithMtimeCheck: jest.fn(),
  reindexSingleFile: jest.fn(),
  statResolvedFile: jest.fn(),
  moveResolvedFile: jest.fn(),
  isTextFile: () => true,
}))
jest.mock('@/lib/mount-index/embedding-scheduler', () => ({ enqueueEmbeddingJobsForMountPoint: jest.fn() }))
jest.mock('@/lib/mount-index/link-groups', () => ({ reindexLinkGroupSiblings: jest.fn() }))
jest.mock('@/lib/mount-index/database-store', () => ({
  DatabaseStoreError: class extends Error {},
  moveDatabaseDocument: jest.fn(),
  deleteDatabaseDocument: jest.fn(),
  readDatabaseDocument: jest.fn(),
  readDatabaseBlobAsDocument: jest.fn(),
  readDatabaseBlobText: jest.fn(),
  databaseDocumentExists: jest.fn(),
  databaseFolderExists: jest.fn(),
}))
const mockRefreshStats = jest.fn()
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    docMountFileLinks: { findByMountPointAndPath: jest.fn().mockResolvedValue(null) },
    docMountPoints: { refreshStats: mockRefreshStats },
  }),
}))

import { resolveDocEditPath, writeFileWithMtimeCheck, reindexSingleFile } from '@/lib/doc-edit'
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler'
import { reindexLinkGroupSiblings } from '@/lib/mount-index/link-groups'
import { writeDocumentFile } from '@/lib/documents/operator-doc-actions'

const flush = () => new Promise(resolve => setImmediate(resolve))

function resolved(fields: Record<string, unknown>) {
  return {
    absolutePath: '/store/notes.md',
    scope: 'project',
    mountType: 'filesystem',
    basePath: '/store',
    relativePath: 'notes.md',
    ...fields,
  }
}

const repos = { docMountPoints: { refreshStats: mockRefreshStats } } as never

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(writeFileWithMtimeCheck).mockResolvedValue({ mtime: 5 })
  jest.mocked(reindexSingleFile).mockResolvedValue(undefined as never)
  jest.mocked(reindexLinkGroupSiblings).mockResolvedValue(undefined as never)
})

describe('writeDocumentFile re-index gate (#133)', () => {
  it('re-indexes a project-scope save into the project store, link siblings included', async () => {
    jest.mocked(resolveDocEditPath).mockResolvedValue(resolved({ mountPointId: 'mp-project' }) as never)

    await writeDocumentFile({ characterIds: [], projectId: 'p1' }, repos, {
      filePath: 'notes.md',
      scope: 'project',
      content: 'hello',
    })
    await flush()

    expect(reindexSingleFile).toHaveBeenCalledWith('mp-project', 'notes.md', '/store/notes.md')
    expect(reindexLinkGroupSiblings).toHaveBeenCalledWith('mp-project', 'notes.md')
    expect(enqueueEmbeddingJobsForMountPoint).toHaveBeenCalledWith('mp-project')
    expect(mockRefreshStats).toHaveBeenCalledWith('mp-project')
  })

  it('does nothing for a legacy project path outside any store', async () => {
    jest.mocked(resolveDocEditPath).mockResolvedValue(resolved({}) as never)

    await writeDocumentFile({ characterIds: [], projectId: 'p1' }, repos, {
      filePath: 'notes.md',
      scope: 'project',
      content: 'hello',
    })
    await flush()

    expect(reindexSingleFile).not.toHaveBeenCalled()
  })
})
