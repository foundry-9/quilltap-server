/**
 * The document core (`lib/documents/core`): every file-level job on a
 * document in a store, against both store kinds — a database-backed store and
 * a filesystem-backed one. The operator's Document Mode routes and the
 * `doc_*` tools both call these, so their behaviour is pinned here once.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  logger.child = jest.fn(() => logger)
  return { logger }
})

jest.mock('@/lib/doc-edit', () => ({
  readFileWithMtime: jest.fn(),
  writeFileWithMtimeCheck: jest.fn(),
  statResolvedFile: jest.fn(),
  moveResolvedFile: jest.fn(),
  deleteResolvedFile: jest.fn(),
  reindexSingleFile: jest.fn(),
  isTextFile: (p: string) => /\.(md|txt|json|yaml)$/i.test(p),
}))
jest.mock('@/lib/mount-index/embedding-scheduler', () => ({ enqueueEmbeddingJobsForMountPoint: jest.fn() }))
jest.mock('@/lib/mount-index/link-groups', () => ({ reindexLinkGroupSiblings: jest.fn() }))
jest.mock('@/lib/mount-index/database-store', () => {
  class DatabaseStoreError extends Error {
    constructor(message: string, public code: string) {
      super(message)
    }
  }
  return {
    DatabaseStoreError,
    readDatabaseBlobForDocument: jest.fn(),
    databaseDocumentExists: jest.fn(),
    databaseFolderExists: jest.fn(),
    moveDatabaseDocument: jest.fn(),
    deleteDatabaseDocument: jest.fn(),
  }
})
const mockRefreshStats = jest.fn()
const mockFindByName = jest.fn()
const mockFindByFilePath = jest.fn()
const mockFindUnderFolder = jest.fn()
const mockUpdateChatDocument = jest.fn()
const mockFindChat = jest.fn()
const mockFindProject = jest.fn()
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    docMountPoints: { refreshStats: mockRefreshStats, findByName: mockFindByName },
    chatDocuments: {
      findByFilePath: mockFindByFilePath,
      findUnderFolder: mockFindUnderFolder,
      update: mockUpdateChatDocument,
    },
    chats: { findById: mockFindChat },
    projects: { findById: mockFindProject },
  }),
}))

import {
  readFileWithMtime,
  writeFileWithMtimeCheck,
  statResolvedFile,
  moveResolvedFile,
  deleteResolvedFile,
  reindexSingleFile,
} from '@/lib/doc-edit'
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler'
import { reindexLinkGroupSiblings } from '@/lib/mount-index/link-groups'
import {
  readDatabaseBlobForDocument,
  databaseDocumentExists,
  databaseFolderExists,
  moveDatabaseDocument,
  deleteDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store'
import {
  readDocument,
  statDocument,
  documentExists,
  writeDocument,
  ensureDocument,
  afterDocumentWrite,
  renameDocument,
  deleteDocument,
  computeRenameTarget,
  sweepChatDocumentsAfterMove,
  sweepChatDocumentsAfterFolderMove,
  DocumentConflictError,
} from '@/lib/documents/core'

const flush = () => new Promise(resolve => setImmediate(resolve))

const enoent = () => Object.assign(new Error('ENOENT: not found'), { code: 'ENOENT' })

function db(relativePath: string) {
  return {
    absolutePath: '',
    scope: 'document_store',
    mountPointId: 'mp-db',
    mountPointName: 'Archive',
    mountType: 'database',
    basePath: '',
    relativePath,
  } as never
}

function disk(relativePath: string, fields: Record<string, unknown> = {}) {
  return {
    absolutePath: `/store/${relativePath}`,
    scope: 'document_store',
    mountPointId: 'mp-fs',
    mountPointName: 'Shelf',
    mountType: 'filesystem',
    basePath: '/store',
    relativePath,
    ...fields,
  } as never
}

const FILE = { isFile: true, size: 3, mtime: new Date(0) }
const DIR = { isFile: false, size: 0, mtime: new Date(0) }

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(reindexSingleFile).mockResolvedValue(undefined as never)
  jest.mocked(reindexLinkGroupSiblings).mockResolvedValue(undefined as never)
  jest.mocked(databaseDocumentExists).mockResolvedValue(false)
  jest.mocked(databaseFolderExists).mockResolvedValue(false)
  jest.mocked(statResolvedFile).mockResolvedValue(null)
})

describe('readDocument', () => {
  it('reads the document at the path', async () => {
    jest.mocked(readFileWithMtime).mockResolvedValue({ content: 'hi', mtime: 1, size: 2 })

    await expect(readDocument(disk('a.md'))).resolves.toEqual({ content: 'hi', mtime: 1, size: 2, source: 'document' })
    expect(readDatabaseBlobForDocument).not.toHaveBeenCalled()
  })

  it('falls back to an uploaded blob in a database store (#134)', async () => {
    jest.mocked(readFileWithMtime).mockRejectedValue(enoent())
    jest.mocked(readDatabaseBlobForDocument).mockResolvedValue({ content: '# Up', mtime: 2, size: 4, source: 'blob-bytes' })

    await expect(readDocument(db('up.md'))).resolves.toEqual({ content: '# Up', mtime: 2, size: 4, source: 'blob-bytes' })
    expect(readDatabaseBlobForDocument).toHaveBeenCalledWith('mp-db', 'up.md')
  })

  it('carries a converted blob\'s MIME type', async () => {
    jest.mocked(readFileWithMtime).mockRejectedValue(enoent())
    jest.mocked(readDatabaseBlobForDocument).mockResolvedValue({
      content: 'text', mtime: 2, size: 900, source: 'blob-text', storedMimeType: 'application/pdf',
    })

    await expect(readDocument(db('scan.pdf'))).resolves.toMatchObject({ source: 'blob-text', storedMimeType: 'application/pdf' })
  })

  it('throws ENOENT when neither a document nor a blob is there', async () => {
    jest.mocked(readFileWithMtime).mockRejectedValue(enoent())
    jest.mocked(readDatabaseBlobForDocument).mockResolvedValue(null)

    await expect(readDocument(db('gone.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never looks for a blob on disk', async () => {
    jest.mocked(readFileWithMtime).mockRejectedValue(enoent())

    await expect(readDocument(disk('gone.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(readDatabaseBlobForDocument).not.toHaveBeenCalled()
  })

  it('rethrows any failure other than absence', async () => {
    jest.mocked(readFileWithMtime).mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }))

    await expect(readDocument(db('a.md'))).rejects.toMatchObject({ code: 'EACCES' })
    expect(readDatabaseBlobForDocument).not.toHaveBeenCalled()
  })
})

describe('statDocument / documentExists', () => {
  it('database: a document is a file, a folder row a folder', async () => {
    jest.mocked(databaseDocumentExists).mockResolvedValueOnce(true)
    await expect(statDocument(db('a.md'))).resolves.toBe('file')
    jest.mocked(databaseFolderExists).mockResolvedValueOnce(true)
    await expect(statDocument(db('Notes'))).resolves.toBe('folder')
    await expect(statDocument(db('gone.md'))).resolves.toBeNull()
  })

  it('disk: a regular file is a file, anything else a folder', async () => {
    jest.mocked(statResolvedFile).mockResolvedValueOnce(FILE)
    await expect(statDocument(disk('a.md'))).resolves.toBe('file')
    jest.mocked(statResolvedFile).mockResolvedValueOnce(DIR)
    await expect(statDocument(disk('Notes'))).resolves.toBe('folder')
    await expect(statDocument(disk('gone.md'))).resolves.toBeNull()
  })

  it('a path is taken by a database document, or by anything on disk', async () => {
    jest.mocked(databaseFolderExists).mockResolvedValueOnce(true)
    await expect(documentExists(db('Notes'))).resolves.toBe(false)
    jest.mocked(statResolvedFile).mockResolvedValueOnce(DIR)
    await expect(documentExists(disk('Notes'))).resolves.toBe(true)
  })
})

describe('writeDocument / afterDocumentWrite', () => {
  it.each([['database', db('a.md'), 'mp-db'], ['filesystem', disk('a.md'), 'mp-fs']])(
    'writes into a %s store and refreshes it, link siblings included',
    async (_kind, resolved, mountPointId) => {
      jest.mocked(writeFileWithMtimeCheck).mockResolvedValue({ mtime: 7 })

      await expect(writeDocument(resolved, 'body', 6)).resolves.toEqual({ mtime: 7 })
      await flush()

      expect(writeFileWithMtimeCheck).toHaveBeenCalledWith(resolved, 'body', 6)
      expect(reindexSingleFile).toHaveBeenCalledWith(mountPointId, 'a.md', expect.any(String))
      expect(reindexLinkGroupSiblings).toHaveBeenCalledWith(mountPointId, 'a.md')
      expect(enqueueEmbeddingJobsForMountPoint).toHaveBeenCalledWith(mountPointId)
      expect(mockRefreshStats).toHaveBeenCalledWith(mountPointId)
    },
  )

  it('refreshes by mountPointId whatever the scope says (#133)', async () => {
    afterDocumentWrite(disk('a.md', { scope: 'project' }))
    await flush()
    expect(reindexSingleFile).toHaveBeenCalledWith('mp-fs', 'a.md', '/store/a.md')
  })

  it('leaves a path outside any store alone', async () => {
    afterDocumentWrite(disk('a.md', { scope: 'project', mountPointId: undefined }))
    await flush()
    expect(reindexSingleFile).not.toHaveBeenCalled()
  })

  it('swallows a refresh failure', async () => {
    jest.mocked(reindexSingleFile).mockRejectedValue(new Error('index locked'))
    afterDocumentWrite(db('a.md'))
    await flush()
    expect(enqueueEmbeddingJobsForMountPoint).not.toHaveBeenCalled()
  })

  it.each([
    'mtime mismatch: expected 1, found 2',
    'File was modified by another process (mtime mismatch). Please reload and try again.',
  ])('turns a stale mtime into a DocumentConflictError (%s)', async message => {
    jest.mocked(writeFileWithMtimeCheck).mockRejectedValue(new Error(message))

    const error = await writeDocument(disk('a.md'), 'x', 1).catch(e => e)
    expect(error).toBeInstanceOf(DocumentConflictError)
    expect(error.message).toBe(message)
    expect(reindexSingleFile).not.toHaveBeenCalled()
  })

  it('rethrows any other write failure untouched', async () => {
    jest.mocked(writeFileWithMtimeCheck).mockRejectedValue(new Error('disk full'))
    await expect(writeDocument(disk('a.md'), 'x')).rejects.toThrow('disk full')
  })
})

describe('ensureDocument', () => {
  it.each([['database', db('new.md')], ['filesystem', disk('new.md')]])(
    'creates a blank document in a %s store through the writer',
    async (_kind, resolved) => {
      jest.mocked(writeFileWithMtimeCheck).mockResolvedValue({ mtime: 9 })

      await expect(ensureDocument(resolved)).resolves.toEqual({ created: true, mtime: 9 })
      expect(writeFileWithMtimeCheck).toHaveBeenCalledWith(resolved, '', undefined)
    },
  )

  it('leaves an existing document untouched', async () => {
    jest.mocked(databaseDocumentExists).mockResolvedValue(true)

    await expect(ensureDocument(db('a.md'))).resolves.toEqual({ created: false })
    expect(writeFileWithMtimeCheck).not.toHaveBeenCalled()
  })
})

describe('renameDocument', () => {
  describe('database store', () => {
    it('moves the document', async () => {
      jest.mocked(databaseDocumentExists).mockImplementation(async (_mp, rel) => rel === 'a.md')

      await expect(renameDocument(db('a.md'), db('b.md'))).resolves.toEqual({ ok: true })
      expect(moveDatabaseDocument).toHaveBeenCalledWith('mp-db', 'a.md', 'b.md')
    })

    it('refuses a taken destination', async () => {
      jest.mocked(databaseDocumentExists).mockResolvedValue(true)

      await expect(renameDocument(db('a.md'), db('b.md'))).resolves.toEqual({ ok: false, reason: 'destination-taken' })
      expect(moveDatabaseDocument).not.toHaveBeenCalled()
    })

    it('allows a case-only rename', async () => {
      jest.mocked(databaseDocumentExists).mockResolvedValue(true)

      await expect(renameDocument(db('notes.md'), db('Notes.md'))).resolves.toEqual({ ok: true })
      expect(moveDatabaseDocument).toHaveBeenCalledWith('mp-db', 'notes.md', 'Notes.md')
    })

    it('reports a store CONFLICT as a taken destination', async () => {
      jest.mocked(databaseDocumentExists).mockImplementation(async (_mp, rel) => rel === 'a.md')
      jest.mocked(moveDatabaseDocument).mockRejectedValue(new DatabaseStoreError('taken', 'CONFLICT'))

      await expect(renameDocument(db('a.md'), db('b.md'))).resolves.toEqual({ ok: false, reason: 'destination-taken' })
    })

    it('lets UNSUPPORTED bubble', async () => {
      jest.mocked(databaseDocumentExists).mockImplementation(async (_mp, rel) => rel === 'a.md')
      jest.mocked(moveDatabaseDocument).mockRejectedValue(new DatabaseStoreError('no .pdf', 'UNSUPPORTED'))

      await expect(renameDocument(db('a.md'), db('b.pdf'))).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    })

    it('reports a missing source and a folder source', async () => {
      await expect(renameDocument(db('gone.md'), db('b.md'))).resolves.toEqual({ ok: false, reason: 'source-missing' })
      jest.mocked(databaseFolderExists).mockResolvedValue(true)
      await expect(renameDocument(db('Notes'), db('Other'))).resolves.toEqual({ ok: false, reason: 'source-not-a-file' })
    })
  })

  describe('filesystem store', () => {
    it('moves the file and refreshes the new path', async () => {
      jest.mocked(statResolvedFile).mockImplementation(async r => ((r as { relativePath: string }).relativePath === 'a.md' ? FILE : null))

      await expect(renameDocument(disk('a.md'), disk('b.md'))).resolves.toEqual({ ok: true })
      await flush()

      expect(moveResolvedFile).toHaveBeenCalled()
      expect(reindexSingleFile).toHaveBeenCalledWith('mp-fs', 'b.md', '/store/b.md')
    })

    it('refuses a taken destination', async () => {
      jest.mocked(statResolvedFile).mockResolvedValue(FILE)

      await expect(renameDocument(disk('a.md'), disk('b.md'))).resolves.toEqual({ ok: false, reason: 'destination-taken' })
      expect(moveResolvedFile).not.toHaveBeenCalled()
    })

    it('allows a case-only rename', async () => {
      jest.mocked(statResolvedFile).mockResolvedValue(FILE)

      await expect(renameDocument(disk('notes.md'), disk('Notes.md'))).resolves.toEqual({ ok: true })
    })
  })
})

describe('deleteDocument', () => {
  it('database: deletes, or tells a folder from nothing', async () => {
    jest.mocked(deleteDatabaseDocument).mockResolvedValueOnce(true)
    await expect(deleteDocument(db('a.md'))).resolves.toBe('deleted')

    jest.mocked(deleteDatabaseDocument).mockResolvedValue(false)
    await expect(deleteDocument(db('gone.md'))).resolves.toBe('not-found')
    jest.mocked(databaseFolderExists).mockResolvedValueOnce(true)
    await expect(deleteDocument(db('Notes'))).resolves.toBe('not-a-file')
  })

  it('filesystem: unlinks a file, refuses a directory, reports nothing', async () => {
    jest.mocked(statResolvedFile).mockResolvedValueOnce(FILE)
    await expect(deleteDocument(disk('a.md'))).resolves.toBe('deleted')
    expect(deleteResolvedFile).toHaveBeenCalledTimes(1)

    jest.mocked(statResolvedFile).mockResolvedValueOnce(DIR)
    await expect(deleteDocument(disk('Notes'))).resolves.toBe('not-a-file')
    await expect(deleteDocument(disk('gone.md'))).resolves.toBe('not-found')
    expect(deleteResolvedFile).toHaveBeenCalledTimes(1)
  })
})

describe('computeRenameTarget', () => {
  it('keeps the directory and inherits the extension', () => {
    expect(computeRenameTarget('Notes/a.md', 'Better')).toEqual({
      ok: true,
      newFilePath: 'Notes/Better.md',
      newDisplayTitle: 'Better.md',
    })
  })

  it.each(['', 'a/b', 'a\\b', '..'])('rejects %j', title => {
    expect(computeRenameTarget('a.md', title).ok).toBe(false)
  })
})

describe('sweepChatDocumentsAfterMove', () => {
  // The same file in the project's official store ("Project Files: P",
  // mp-proj), recorded three ways by three chats, plus a namesake path in an
  // unrelated store and one in the filesystem `general` directory.
  const rows = [
    { id: 'r-name', chatId: 'chat-other', scope: 'document_store', mountPoint: 'Project Files: P', filePath: 'a.md' },
    { id: 'r-case', chatId: 'chat-third', scope: 'document_store', mountPoint: 'project files: p', filePath: 'a.md' },
    { id: 'r-project', chatId: 'chat-in-project', scope: 'project', mountPoint: null, filePath: 'a.md' },
    { id: 'r-elsewhere', chatId: 'chat-other', scope: 'document_store', mountPoint: 'Shelf', filePath: 'a.md' },
    { id: 'r-general', chatId: 'chat-other', scope: 'general', mountPoint: null, filePath: 'a.md' },
    { id: 'r-loose-project', chatId: 'chat-no-project', scope: 'project', mountPoint: null, filePath: 'a.md' },
  ]

  beforeEach(() => {
    mockFindByFilePath.mockResolvedValue(rows)
    mockUpdateChatDocument.mockImplementation(async (id: string) => ({ id }))
    mockFindByName.mockImplementation(async (name: string) => {
      const n = name.trim().toLowerCase()
      if (n === 'project files: p') return [{ id: 'mp-proj' }]
      if (n === 'shelf') return [{ id: 'mp-shelf' }]
      return []
    })
    mockFindChat.mockImplementation(async (id: string) =>
      id === 'chat-in-project' ? { id, projectId: 'proj-1' } : { id, projectId: null })
    mockFindProject.mockResolvedValue({ id: 'proj-1', officialMountPointId: 'mp-proj' })
  })

  const updatedIds = () => mockUpdateChatDocument.mock.calls.map(c => c[0]).sort()

  it('follows a move made as `project` into rows recorded by store name', async () => {
    await expect(sweepChatDocumentsAfterMove({
      scope: 'project',
      mountPoint: null,
      mountPointId: 'mp-proj',
      oldFilePath: 'a.md',
      newFilePath: 'Ledgers/a.md',
    })).resolves.toBe(3)

    expect(updatedIds()).toEqual(['r-case', 'r-name', 'r-project'])
    expect(mockUpdateChatDocument).toHaveBeenCalledWith('r-name', { filePath: 'Ledgers/a.md', displayTitle: 'a.md' })
  })

  it('leaves a `project` row from a chat outside that project alone', async () => {
    mockFindByFilePath.mockResolvedValue([rows[2], rows[5]])
    await sweepChatDocumentsAfterMove({
      scope: 'project', mountPoint: null, mountPointId: 'mp-proj', oldFilePath: 'a.md', newFilePath: 'b.md',
    })
    expect(updatedIds()).toEqual(['r-project'])
  })

  it('follows a move made by store name into rows recorded as `project`', async () => {
    await sweepChatDocumentsAfterMove({
      scope: 'document_store',
      mountPoint: 'Project Files: P',
      mountPointId: 'mp-proj',
      oldFilePath: 'a.md',
      newFilePath: 'b.md',
      newDisplayTitle: 'B',
    })
    expect(updatedIds()).toEqual(['r-case', 'r-name', 'r-project'])
    expect(mockUpdateChatDocument).toHaveBeenCalledWith('r-project', { filePath: 'b.md', displayTitle: 'B' })
  })

  it('without a store id, matches only the exact address it was given', async () => {
    await sweepChatDocumentsAfterMove({
      scope: 'general', mountPoint: undefined, oldFilePath: 'a.md', newFilePath: 'b.md',
    })
    expect(updatedIds()).toEqual(['r-general'])
    expect(mockFindByName).not.toHaveBeenCalled()
  })

  it('treats an ambiguous store name as no match', async () => {
    mockFindByName.mockResolvedValue([{ id: 'mp-proj' }, { id: 'mp-twin' }])
    mockFindByFilePath.mockResolvedValue([rows[0]])
    await expect(sweepChatDocumentsAfterMove({
      scope: 'project', mountPoint: null, mountPointId: 'mp-proj', oldFilePath: 'a.md', newFilePath: 'b.md',
    })).resolves.toBe(0)
  })

  it('looks each store name and chat up once per sweep', async () => {
    mockFindByFilePath.mockResolvedValue([rows[0], { ...rows[0], id: 'r-name-2' }, rows[2], { ...rows[2], id: 'r-project-2' }])
    await sweepChatDocumentsAfterMove({
      scope: 'general', mountPoint: null, mountPointId: 'mp-proj', oldFilePath: 'a.md', newFilePath: 'b.md',
    })
    expect(mockFindByName).toHaveBeenCalledTimes(1)
    expect(mockFindChat).toHaveBeenCalledTimes(1)
    expect(updatedIds()).toEqual(['r-name', 'r-name-2', 'r-project', 'r-project-2'])
  })

  it('uses the repositories it is handed', async () => {
    const findByFilePath = jest.fn().mockResolvedValue([rows[4]])
    const update = jest.fn().mockResolvedValue({})
    await sweepChatDocumentsAfterMove(
      { scope: 'general', mountPoint: undefined, oldFilePath: 'a.md', newFilePath: 'b.md' },
      { repos: { chatDocuments: { findByFilePath, update } } as never },
    )
    expect(update).toHaveBeenCalledWith('r-general', { filePath: 'b.md', displayTitle: 'b.md' })
    expect(mockFindByFilePath).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    mockFindByFilePath.mockRejectedValue(new Error('locked'))
    await expect(sweepChatDocumentsAfterMove({
      scope: 'general', mountPoint: null, oldFilePath: 'a.md', newFilePath: 'b.md',
    })).resolves.toBe(0)
  })
})

describe('sweepChatDocumentsAfterFolderMove', () => {
  beforeEach(() => {
    mockUpdateChatDocument.mockImplementation(async (id: string) => ({ id }))
    mockFindByName.mockImplementation(async (name: string) =>
      name.toLowerCase() === 'project files: p' ? [{ id: 'mp-proj' }] : [{ id: 'mp-shelf' }])
    mockFindChat.mockResolvedValue({ id: 'chat-in-project', projectId: 'proj-1' })
    mockFindProject.mockResolvedValue({ id: 'proj-1', officialMountPointId: 'mp-proj' })
    mockFindUnderFolder.mockResolvedValue([
      { id: 'f-name', chatId: 'c1', scope: 'document_store', mountPoint: 'Project Files: P', filePath: 'Old/x.md' },
      { id: 'f-deep', chatId: 'chat-in-project', scope: 'project', mountPoint: null, filePath: 'Old/Sub/y.md' },
      { id: 'f-shelf', chatId: 'c1', scope: 'document_store', mountPoint: 'Shelf', filePath: 'Old/z.md' },
    ])
  })

  it('rewrites the prefix on every row in the same store, whatever address it was recorded under', async () => {
    await expect(sweepChatDocumentsAfterFolderMove({
      scope: 'project', mountPoint: null, mountPointId: 'mp-proj', oldFolderPath: 'Old', newFolderPath: 'New/Place',
    })).resolves.toBe(2)

    expect(mockFindUnderFolder).toHaveBeenCalledWith('Old')
    expect(mockUpdateChatDocument).toHaveBeenCalledWith('f-name', { filePath: 'New/Place/x.md', displayTitle: 'x.md' })
    expect(mockUpdateChatDocument).toHaveBeenCalledWith('f-deep', { filePath: 'New/Place/Sub/y.md', displayTitle: 'y.md' })
    expect(mockUpdateChatDocument).not.toHaveBeenCalledWith('f-shelf', expect.anything())
  })

  it('never throws', async () => {
    mockFindUnderFolder.mockRejectedValue(new Error('locked'))
    await expect(sweepChatDocumentsAfterFolderMove({
      scope: 'general', mountPoint: null, oldFolderPath: 'a', newFolderPath: 'b',
    })).resolves.toBe(0)
  })
})
