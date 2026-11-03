import { beforeEach, describe, expect, it } from '@jest/globals'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}))

jest.mock('@/lib/doc-edit', () => {
  class PathResolutionError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.name = 'PathResolutionError'
      this.code = code
    }
  }

  return {
    resolveDocEditPath: jest.fn(),
    readFileWithMtime: jest.fn(),
    writeFileWithMtimeCheck: jest.fn(),
    getAccessibleMountPoints: jest.fn().mockResolvedValue([]),
    isTextFile: jest.fn().mockReturnValue(true),
    PathResolutionError,
    findUniqueMatch: jest.fn(),
    findAllMatches: jest.fn(),
    reindexSingleFile: jest.fn(),
    parseFrontmatter: jest.fn(),
    updateFrontmatterInContent: jest.fn(),
    findHeadingSection: jest.fn(),
    readHeadingContent: jest.fn(),
    replaceHeadingContent: jest.fn(),
    generateUnifiedDiff: jest.fn().mockReturnValue('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b'),
  }
})

jest.mock('@/lib/doc-edit/mime-registry', () => ({
  detectMimeFromExtension: jest.fn(),
  isJsonFamily: jest.fn().mockReturnValue(false),
  isJsonMime: jest.fn().mockReturnValue(false),
  isJsonlMime: jest.fn().mockReturnValue(false),
  parseContent: jest.fn(),
  serializeContent: jest.fn(),
  validateJson: jest.fn(),
}))

jest.mock('@/lib/mount-index/database-store', () => ({
  databaseDocumentExists: jest.fn().mockResolvedValue(true),
  databaseFolderExists: jest.fn().mockResolvedValue(false),
  deleteDatabaseDocument: jest.fn(),
  moveDatabaseDocument: jest.fn().mockResolvedValue(undefined),
  createDatabaseFolder: jest.fn(),
  deleteDatabaseFolder: jest.fn(),
  moveDatabaseFolder: jest.fn().mockResolvedValue(undefined),
  listDatabaseFiles: jest.fn(),
}))

jest.mock('@/lib/services/librarian-notifications/writer', () => ({
  postLibrarianOpenAnnouncement: jest.fn(),
  postLibrarianDeleteAnnouncement: jest.fn(),
  postLibrarianFolderCreatedAnnouncement: jest.fn(),
  postLibrarianFolderDeletedAnnouncement: jest.fn(),
  postLibrarianWriteAnnouncement: jest.fn(),
  postLibrarianMoveAnnouncement: jest.fn(),
  postLibrarianCopyAnnouncement: jest.fn(),
  postLibrarianBlobWriteAnnouncement: jest.fn(),
  contentHiddenFromCharacters: jest.fn(() => false),
  documentHiddenFromCharacters: jest.fn(async () => false),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn(),
}))

jest.mock('@/lib/file-storage/character-vault-bridge', () => ({
  getCharacterVaultStore: jest.fn(),
}))

jest.mock('@/lib/mount-index/blob-transcode', () => ({
  transcodeToWebP: jest.fn(),
  normaliseBlobRelativePath: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
}))

jest.mock('@/lib/mount-index/document-search', () => ({
  searchDocumentChunks: jest.fn(),
}))

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
  unlink: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
  readdir: jest.fn(),
  rmdir: jest.fn(),
}))

import { executeDocEditTool } from '@/lib/tools/handlers/doc-edit-handler'
import { resolveDocEditPath } from '@/lib/doc-edit'
import { getRepositories } from '@/lib/repositories/factory'
import {
  databaseDocumentExists,
  moveDatabaseDocument,
  moveDatabaseFolder,
} from '@/lib/mount-index/database-store'

const mockResolveDocEditPath = resolveDocEditPath as jest.Mock
const mockGetRepositories = getRepositories as jest.Mock
const mockDatabaseDocumentExists = databaseDocumentExists as jest.Mock
const mockMoveDatabaseDocument = moveDatabaseDocument as jest.Mock
const mockMoveDatabaseFolder = moveDatabaseFolder as jest.Mock

const mockRepos = {
  chats: { findById: jest.fn().mockResolvedValue(null) },
  characters: { findById: jest.fn().mockResolvedValue(null) },
  projects: { findById: jest.fn().mockResolvedValue(null) },
  docMountPoints: { findByName: jest.fn().mockResolvedValue([]) },
  chatDocuments: {
    findByFilePath: jest.fn().mockResolvedValue([]),
    findUnderFolder: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockImplementation(async (id: string) => ({ id })),
  },
  // Per-document policy gates look these up; no protected docs in these tests.
  docMountFileLinks: {
    findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    findByMountPointId: jest.fn().mockResolvedValue([]),
  },
}

const context = {
  userId: 'user-1',
  chatId: 'chat-1',
  characterId: 'char-1',
}

describe('doc-edit move handlers sync chat_documents pointers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReturnValue(mockRepos)
    mockDatabaseDocumentExists.mockImplementation(async (_mountPointId: string, relativePath: string) => relativePath === 'old/name.md')
    mockMoveDatabaseDocument.mockResolvedValue(undefined)
    mockMoveDatabaseFolder.mockResolvedValue(undefined)
    mockRepos.chats.findById.mockResolvedValue(null)
    mockRepos.projects.findById.mockResolvedValue(null)
    mockRepos.docMountPoints.findByName.mockResolvedValue([])
    mockRepos.chatDocuments.findByFilePath.mockResolvedValue([])
    mockRepos.chatDocuments.findUnderFolder.mockResolvedValue([])
    mockRepos.chatDocuments.update.mockImplementation(async (id: string) => ({ id }))
  })

  it('doc_move_file updates chat_documents path in the same store', async () => {
    mockRepos.chatDocuments.findByFilePath.mockResolvedValue([
      { id: 'row-lore', chatId: 'chat-2', scope: 'document_store', mountPoint: 'Lore', filePath: 'old/name.md' },
    ])
    mockResolveDocEditPath
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'old/name.md',
      })
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'new/title.md',
      })

    const result = await executeDocEditTool(
      'doc_move_file',
      {
        scope: 'document_store',
        mount_point: 'Lore',
        path: 'old/name.md',
        new_path: 'new/title.md',
      },
      context,
    )

    expect(result.success).toBe(true)
    expect(mockMoveDatabaseDocument).toHaveBeenCalledWith('mp-1', 'old/name.md', 'new/title.md')
    expect(mockRepos.chatDocuments.findByFilePath).toHaveBeenCalledWith('old/name.md')
    expect(mockRepos.chatDocuments.update).toHaveBeenCalledWith('row-lore', {
      filePath: 'new/title.md',
      displayTitle: 'title.md',
    })
  })

  it('doc_move_file made as `project` follows a row another chat recorded by store name', async () => {
    // The live V4test case: Lorian moved a file as `project`; another chat had
    // it open under the project store's name and was left on the old path.
    const projectStore = { scope: 'project', mountType: 'database', mountPointId: 'mp-proj', mountPointName: 'Project Files: P' }
    mockResolveDocEditPath
      .mockResolvedValueOnce({ ...projectStore, relativePath: 'ledger.md' })
      .mockResolvedValueOnce({ ...projectStore, relativePath: 'Ledgers/ledger.md' })
    mockDatabaseDocumentExists.mockImplementation(async (_mp: string, rel: string) => rel === 'ledger.md')
    mockRepos.chatDocuments.findByFilePath.mockResolvedValue([
      { id: 'row-by-name', chatId: 'chat-2', scope: 'document_store', mountPoint: 'Project Files: P', filePath: 'ledger.md' },
      { id: 'row-other-store', chatId: 'chat-2', scope: 'document_store', mountPoint: 'Lore', filePath: 'ledger.md' },
    ])
    mockRepos.docMountPoints.findByName.mockImplementation(async (name: string) =>
      name === 'Project Files: P' ? [{ id: 'mp-proj' }] : [{ id: 'mp-lore' }])

    const result = await executeDocEditTool(
      'doc_move_file',
      { scope: 'project', path: 'ledger.md', new_path: 'Ledgers/ledger.md' },
      context,
    )

    expect(result.success).toBe(true)
    expect(mockRepos.chatDocuments.update).toHaveBeenCalledWith('row-by-name', {
      filePath: 'Ledgers/ledger.md',
      displayTitle: 'ledger.md',
    })
    expect(mockRepos.chatDocuments.update).not.toHaveBeenCalledWith('row-other-store', expect.anything())
  })

  it('doc_move_file sweeps under the resolved store name, never `self` (bug 256)', async () => {
    const vault = {
      scope: 'document_store',
      mountType: 'database',
      mountPointId: 'mp-vault',
      mountPointName: 'Friday Character Vault',
    }
    mockResolveDocEditPath
      .mockResolvedValueOnce({ ...vault, relativePath: 'old/name.md' })
      .mockResolvedValueOnce({ ...vault, relativePath: 'new/title.md' })

    mockRepos.chatDocuments.findByFilePath.mockResolvedValue([
      { id: 'row-vault', chatId: 'chat-2', scope: 'document_store', mountPoint: 'Friday Character Vault', filePath: 'old/name.md' },
    ])

    const result = await executeDocEditTool(
      'doc_move_file',
      { scope: 'document_store', mount_point: 'self', path: 'old/name.md', new_path: 'new/title.md' },
      context,
    )

    expect(result.success).toBe(true)
    expect(mockRepos.chatDocuments.update).toHaveBeenCalledWith('row-vault', {
      filePath: 'new/title.md',
      displayTitle: 'title.md',
    })
    // Matched by its recorded name, so no lookup of the word `self`.
    expect(mockRepos.docMountPoints.findByName).not.toHaveBeenCalledWith('self')
  })

  it('doc_move_folder updates nested chat_documents paths in the same store', async () => {
    mockRepos.chatDocuments.findUnderFolder.mockResolvedValue([
      { id: 'row-nested', chatId: 'chat-2', scope: 'document_store', mountPoint: 'Lore', filePath: 'old/folder/deep/a.md' },
    ])
    mockResolveDocEditPath
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'old/folder',
      })
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'new/folder',
      })

    const result = await executeDocEditTool(
      'doc_move_folder',
      {
        scope: 'document_store',
        mount_point: 'Lore',
        path: 'old/folder',
        new_path: 'new/folder',
      },
      context,
    )

    expect(result.success).toBe(true)
    expect(mockMoveDatabaseFolder).toHaveBeenCalledWith('mp-1', 'old/folder', 'new/folder')
    expect(mockRepos.chatDocuments.findUnderFolder).toHaveBeenCalledWith('old/folder')
    expect(mockRepos.chatDocuments.update).toHaveBeenCalledWith('row-nested', {
      filePath: 'new/folder/deep/a.md',
      displayTitle: 'a.md',
    })
  })

  it('move still succeeds when chat_documents sync throws (best-effort behavior)', async () => {
    mockResolveDocEditPath
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'old/name.md',
      })
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'new/name.md',
      })

    mockRepos.chatDocuments.findByFilePath.mockRejectedValue(new Error('db unavailable'))

    const result = await executeDocEditTool(
      'doc_move_file',
      {
        scope: 'document_store',
        mount_point: 'Lore',
        path: 'old/name.md',
        new_path: 'new/name.md',
      },
      context,
    )

    expect(result.success).toBe(true)
    expect(result.formattedText).toContain('Moved: old/name.md')
  })
})
