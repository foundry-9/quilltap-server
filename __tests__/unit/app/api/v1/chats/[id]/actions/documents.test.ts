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

const { handleRecentDocuments, handleActiveDocument } = require('@/app/api/v1/chats/[id]/actions/documents')

describe('chats [id] document actions', () => {
  let ctx: any

  beforeEach(() => {
    jest.clearAllMocks()

    ctx = {
      repos: {
        chatDocuments: {
          findByChatId: jest.fn(),
          findActiveForChat: jest.fn(),
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
})
