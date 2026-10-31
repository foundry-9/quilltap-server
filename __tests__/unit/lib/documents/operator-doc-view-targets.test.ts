/**
 * Document Mode shows a store file that is not text (an image, a PDF, a
 * .docx, any other binary) read-only. `documentViewTargetFor` decides which
 * those are; opening one returns a view target and no text (its bytes are
 * never read as text), and an editor write to one is refused.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  logger.child = jest.fn(() => logger)
  return { logger }
})

const TEXT = new Set(['.md', '.txt', '.json'])
jest.mock('@/lib/doc-edit', () => ({
  readFileWithMtime: jest.fn(),
  resolveDocEditPath: jest.fn(),
  writeFileWithMtimeCheck: jest.fn(),
  reindexSingleFile: jest.fn(),
  isTextFile: (p: string) => TEXT.has(p.slice(p.lastIndexOf('.')).toLowerCase()),
}))
jest.mock('@/lib/mount-index/embedding-scheduler', () => ({ enqueueEmbeddingJobsForMountPoint: jest.fn() }))
jest.mock('@/lib/mount-index/database-store', () => ({
  DatabaseStoreError: class extends Error {},
  moveDatabaseDocument: jest.fn(),
  deleteDatabaseDocument: jest.fn(),
  readDatabaseDocument: jest.fn(),
  readDatabaseBlobAsDocument: jest.fn(),
}))
const mockFindLink = jest.fn()
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({ docMountFileLinks: { findByMountPointAndPath: mockFindLink } }),
}))

import { readFileWithMtime, resolveDocEditPath, writeFileWithMtimeCheck } from '@/lib/doc-edit'
import { readDatabaseBlobAsDocument } from '@/lib/mount-index/database-store'
import {
  documentViewTargetFor,
  DocumentReadOnlyError,
  openDocumentFile,
  writeDocumentFile,
  STANDALONE_ACCESS_CONTEXT,
} from '@/lib/documents/operator-doc-actions'

const T = '2026-10-31T00:00:00.000Z'

function resolved(relativePath: string, fields: Record<string, unknown> = {}) {
  return {
    absolutePath: '',
    scope: 'document_store',
    mountPointId: 'mp-1',
    mountPointName: 'Archive',
    mountType: 'database',
    basePath: '',
    relativePath,
    ...fields,
  }
}

const PDF_LINK = {
  relativePath: 'uploads/scan.pdf',
  fileName: 'scan.pdf',
  fileType: 'pdf',
  fileSizeBytes: 1213,
  originalMimeType: 'application/pdf',
  updatedAt: T,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindLink.mockResolvedValue(PDF_LINK)
})

describe('documentViewTargetFor', () => {
  it('names a store file that is not text, from its index row', async () => {
    await expect(documentViewTargetFor(resolved('uploads/scan.pdf') as never)).resolves.toEqual({
      mountPointId: 'mp-1',
      ...PDF_LINK,
    })
  })

  it('leaves text files, files outside a store and missing database files to the editor', async () => {
    await expect(documentViewTargetFor(resolved('notes.md') as never)).resolves.toBeNull()
    await expect(documentViewTargetFor(resolved('scan.pdf', { mountPointId: undefined, scope: 'project' }) as never)).resolves.toBeNull()
    mockFindLink.mockResolvedValue(null)
    await expect(documentViewTargetFor(resolved('gone.pdf') as never)).resolves.toBeNull()
  })

  it('shows text a database store cannot save read-only, but leaves it to the editor on disk', async () => {
    mockFindLink.mockResolvedValue({ ...PDF_LINK, relativePath: 'notes.yaml', fileName: 'notes.yaml', fileType: 'blob' })
    TEXT.add('.yaml')
    try {
      await expect(documentViewTargetFor(resolved('notes.yaml') as never)).resolves.toMatchObject({ fileName: 'notes.yaml' })
      await expect(
        documentViewTargetFor(resolved('notes.yaml', { mountType: 'filesystem', absolutePath: '/x/notes.yaml' }) as never),
      ).resolves.toBeNull()
    } finally {
      TEXT.delete('.yaml')
    }
  })
})

describe('opening and writing a viewed file', () => {
  it('opens it with a view target and never reads its bytes as text', async () => {
    ;(resolveDocEditPath as jest.Mock).mockResolvedValue(resolved('uploads/scan.pdf'))
    const opened = await openDocumentFile(STANDALONE_ACCESS_CONTEXT, {
      scope: 'document_store',
      filePath: 'uploads/scan.pdf',
      mountPoint: 'Archive',
    })
    expect(opened).toMatchObject({ filePath: 'uploads/scan.pdf', content: '', isNew: false, viewer: { fileType: 'pdf' } })
    expect(readFileWithMtime).not.toHaveBeenCalled()
  })

  it('still opens a text file in the editor', async () => {
    ;(resolveDocEditPath as jest.Mock).mockResolvedValue(resolved('notes.md'))
    ;(readFileWithMtime as jest.Mock).mockResolvedValue({ content: '# Notes', mtime: 5, size: 7 })
    const opened = await openDocumentFile(STANDALONE_ACCESS_CONTEXT, {
      scope: 'document_store',
      filePath: 'notes.md',
      mountPoint: 'Archive',
    })
    expect(opened).toMatchObject({ content: '# Notes', mtime: 5 })
    expect(opened.viewer).toBeUndefined()
  })

  it('opens a text file uploaded as a blob from its own bytes', async () => {
    ;(resolveDocEditPath as jest.Mock).mockResolvedValue(resolved('uploads/notes.md'))
    ;(readFileWithMtime as jest.Mock).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    ;(readDatabaseBlobAsDocument as jest.Mock).mockResolvedValue({ content: '# Uploaded', mtime: 9, size: 10 })
    const opened = await openDocumentFile(STANDALONE_ACCESS_CONTEXT, {
      scope: 'document_store',
      filePath: 'uploads/notes.md',
      mountPoint: 'Archive',
    })
    expect(opened).toMatchObject({ content: '# Uploaded', mtime: 9, isNew: false })
    expect(opened.viewer).toBeUndefined()
    expect(readDatabaseBlobAsDocument).toHaveBeenCalledWith('mp-1', 'uploads/notes.md')
  })

  it('refuses an editor write to it', async () => {
    ;(resolveDocEditPath as jest.Mock).mockResolvedValue(resolved('uploads/scan.pdf'))
    await expect(
      writeDocumentFile(STANDALONE_ACCESS_CONTEXT, {} as never, {
        scope: 'document_store',
        filePath: 'uploads/scan.pdf',
        mountPoint: 'Archive',
        content: '',
      }),
    ).rejects.toBeInstanceOf(DocumentReadOnlyError)
    expect(writeFileWithMtimeCheck).not.toHaveBeenCalled()
  })
})
