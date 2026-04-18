import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/doc-edit', () => ({
  resolveDocEditPath: jest.fn(),
  readFileWithMtime: jest.fn(),
  writeFileWithMtimeCheck: jest.fn(),
  reindexSingleFile: jest.fn(),
}))

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn(),
}))

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  stat: jest.fn(),
}))

const {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
} = require('@/lib/doc-edit')

const {
  handleRecentDocuments,
  handleActiveDocument,
  handleOpenDocument,
  handleWriteDocument,
} = require('@/app/api/v1/chats/[id]/actions/documents')

describe('chats [id] document actions', () => {
  let ctx: any

  beforeEach(() => {
    jest.clearAllMocks()

    ctx = {
      repos: {
        chats: {
          findById: jest.fn(),
          update: jest.fn(),
        },
        chatDocuments: {
          findByChatId: jest.fn(),
          findActiveForChat: jest.fn(),
          openDocument: jest.fn(),
        },
        docMountPoints: {
          refreshStats: jest.fn(),
        },
      },
    }
  })

  it('returns recent documents sorted by newest first, including active and inactive documents', async () => {
    const chatId = 'chat-1'
    const now = new Date('2026-04-15T10:00:00.000Z')
    const docs = Array.from({ length: 12 }, (_, index) => {
      const isActive = index % 2 === 0
      const updatedAt = new Date(now.getTime() - index * 60000).toISOString()
      return {
        id: `doc-${index}`,
        chatId,
        filePath: `file-${index}.md`,
        scope: index % 3 === 0 ? 'document_store' : 'project',
        mountPoint: index % 3 === 0 ? 'Docs' : null,
        displayTitle: `File ${index}`,
        isActive,
        updatedAt,
        createdAt: updatedAt,
      }
    }).reverse()

    ctx.repos.chatDocuments.findByChatId.mockResolvedValueOnce(docs)

    const response = await handleRecentDocuments(chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(ctx.repos.chatDocuments.findByChatId).toHaveBeenCalledWith(chatId)
    expect(body.documents).toHaveLength(10)
    expect(body.documents[0].id).toBe('doc-0')
    expect(body.documents[1].id).toBe('doc-1')
    expect(body.documents.some((doc: any) => doc.isActive === true)).toBe(true)
    expect(body.documents.some((doc: any) => doc.isActive === false)).toBe(true)
  })

  it('returns active document metadata when one exists', async () => {
    const chatId = 'chat-1'
    ctx.repos.chatDocuments.findActiveForChat.mockResolvedValueOnce({
      id: 'doc-1',
      chatId,
      filePath: 'notes/outline.md',
      scope: 'document_store',
      mountPoint: 'Docs',
      displayTitle: 'outline.md',
      isActive: true,
      createdAt: '2026-04-15T10:00:00.000Z',
      updatedAt: '2026-04-15T10:00:00.000Z',
    })

    const response = await handleActiveDocument(chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.document).toEqual({
      id: 'doc-1',
      filePath: 'notes/outline.md',
      scope: 'document_store',
      mountPoint: 'Docs',
      displayTitle: 'outline.md',
    })
  })

  it('returns null active document when no document is open', async () => {
    const chatId = 'chat-1'
    ctx.repos.chatDocuments.findActiveForChat.mockResolvedValueOnce(null)

    const response = await handleActiveDocument(chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.document).toBeNull()
  })

  it('stores blank documents under general scope when the chat has no project', async () => {
    const chatId = 'chat-blank'
    ctx.repos.chats.findById.mockResolvedValueOnce({ id: chatId, projectId: null })
    resolveDocEditPath.mockResolvedValueOnce({
      absolutePath: '/tmp/blank-doc.md',
      scope: 'general',
      relativePath: 'blank-doc.md',
    })
    writeFileWithMtimeCheck.mockResolvedValueOnce({ mtime: 987654321 })
    ctx.repos.chatDocuments.openDocument.mockImplementationOnce(async (_chatId: string, data: any) => ({
      id: 'doc-blank',
      ...data,
    }))

    const request = {
      json: jest.fn().mockResolvedValue({ title: 'Blank draft' }),
    } as any

    const response = await handleOpenDocument(request, chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(ctx.repos.chatDocuments.openDocument).toHaveBeenCalledWith(
      chatId,
      expect.objectContaining({
        scope: 'general',
        displayTitle: 'Blank draft',
      })
    )
    expect(body.document.scope).toBe('general')
  })

  it('writes document content with mtime conflict protection when provided', async () => {
    const chatId = 'chat-write'
    ctx.repos.chats.findById.mockResolvedValueOnce({ id: chatId, projectId: 'project-1' })
    resolveDocEditPath.mockResolvedValueOnce({
      absolutePath: '/tmp/project/doc.md',
      scope: 'project',
      relativePath: 'doc.md',
      mountPointId: null,
    })
    writeFileWithMtimeCheck.mockResolvedValueOnce({ mtime: 123456789 })

    const request = {
      json: jest.fn().mockResolvedValue({
        filePath: 'doc.md',
        scope: 'project',
        content: '# Updated',
        mtime: 111,
      }),
    } as any

    const response = await handleWriteDocument(request, chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(writeFileWithMtimeCheck).toHaveBeenCalledWith(
      expect.objectContaining({ absolutePath: '/tmp/project/doc.md', scope: 'project', relativePath: 'doc.md' }),
      '# Updated',
      111
    )
    expect(body).toMatchObject({ success: true, mtime: 123456789 })
  })

  it('passes participant character IDs into path resolution so character vaults are reachable', async () => {
    const chatId = 'chat-vault'
    ctx.repos.chats.findById.mockResolvedValueOnce({
      id: chatId,
      projectId: 'project-1',
      participants: [
        { characterId: 'char-friday', type: 'CHARACTER', status: 'active' },
        { characterId: 'char-user', type: 'CHARACTER', status: 'active' },
      ],
    })
    resolveDocEditPath.mockResolvedValueOnce({
      absolutePath: '',
      scope: 'document_store',
      mountPointId: 'mount-1',
      mountPointName: 'Friday Character Vault',
      mountType: 'database',
      basePath: '',
      relativePath: 'properties.json',
    })
    readFileWithMtime.mockResolvedValueOnce({ content: '{}', mtime: 42, size: 2 })
    ctx.repos.chatDocuments.openDocument.mockImplementationOnce(async (_chatId: string, data: any) => ({
      id: 'doc-vault',
      ...data,
    }))

    const request = {
      json: jest.fn().mockResolvedValue({
        filePath: 'properties.json',
        scope: 'document_store',
        mountPoint: 'Friday Character Vault',
      }),
    } as any

    const response = await handleOpenDocument(request, chatId, ctx)
    expect(response.status).toBe(200)
    expect(resolveDocEditPath).toHaveBeenCalledWith(
      'document_store',
      'properties.json',
      expect.objectContaining({
        projectId: 'project-1',
        characterIds: ['char-friday', 'char-user'],
        mountPoint: 'Friday Character Vault',
      })
    )
  })

  it('returns a conflict when the document changed on disk before saving', async () => {
    const chatId = 'chat-conflict'
    ctx.repos.chats.findById.mockResolvedValueOnce({ id: chatId, projectId: 'project-1' })
    resolveDocEditPath.mockResolvedValueOnce({
      absolutePath: '/tmp/project/doc.md',
      scope: 'project',
      relativePath: 'doc.md',
      mountPointId: null,
    })
    writeFileWithMtimeCheck.mockRejectedValueOnce(new Error('File was modified by another process (mtime mismatch). Please reload and try again.'))

    const request = {
      json: jest.fn().mockResolvedValue({
        filePath: 'doc.md',
        scope: 'project',
        content: '# Updated again',
        mtime: 222,
      }),
    } as any

    const response = await handleWriteDocument(request, chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toMatch(/reload/i)
  })
})
