/**
 * Unit tests for LLM logs API routes
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { GET as listLLMLogs } from '../../app/api/v1/llm-logs/route'
import { GET as getLLMLog, DELETE as deleteLLMLog } from '../../app/api/v1/llm-logs/[id]/route'
import { getServerSession } from '../../lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '../../lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks } from './lib/fixtures/mock-repositories'

const mockRepos = createMockRepositoryContainer()

const mockGetServerSession = jest.mocked(getServerSession)
const mockGetRepositories = jest.mocked(getRepositories)
const mockGetRepositoriesSafe = jest.mocked(getRepositoriesSafe)

function createMockRequest(url: string) {
  return {
    url,
    nextUrl: new URL(url),
    method: 'GET',
    headers: new Headers(),
  } as any
}

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const baseLog = {
  id: 'log-1',
  userId: 'user-123',
  type: 'chat',
  messageId: 'msg-1',
  chatId: 'chat-1',
  characterId: 'char-1',
  provider: 'openai',
  modelName: 'gpt-4o',
  request: { messageCount: 1, messages: [], temperature: null, maxTokens: null, toolCount: 0 },
  response: { content: 'Hello', contentLength: 5, error: null },
  usage: null,
  cacheUsage: null,
  durationMs: 1000,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()

  mockGetRepositories.mockReturnValue(mockRepos as any)
  mockGetRepositoriesSafe.mockResolvedValue(mockRepos as any)

  setupAuthMocks(mockGetServerSession as jest.Mock, mockRepos)

  mockRepos.llmLogs.findByMessageId.mockResolvedValue([baseLog])
  mockRepos.llmLogs.findByChatId.mockResolvedValue([baseLog])
  mockRepos.llmLogs.findByCharacterId.mockResolvedValue([baseLog])
  mockRepos.llmLogs.findStandalone.mockResolvedValue([baseLog])
  mockRepos.llmLogs.findByType.mockResolvedValue([baseLog])
  mockRepos.llmLogs.findRecent.mockResolvedValue([baseLog])
  mockRepos.llmLogs.findById.mockResolvedValue(baseLog)
  mockRepos.llmLogs.delete.mockResolvedValue(true)
  mockRepos.chats.findById.mockResolvedValue({ id: 'chat-1', userId: 'user-123', participants: [] })
  mockRepos.characters.findById.mockResolvedValue({ id: 'char-1', userId: 'user-123' })
})

describe('GET /api/v1/llm-logs', () => {
  it('returns logs filtered by messageId', async () => {
    const res = await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?messageId=msg-1'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(mockRepos.llmLogs.findByMessageId).toHaveBeenCalledWith('msg-1')
    expect(data.logs).toHaveLength(1)
  })

  it('returns 404 when chat is not owned by user', async () => {
    mockRepos.chats.findById.mockResolvedValue({ id: 'chat-1', userId: 'user-999', participants: [] })

    const res = await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?chatId=chat-1'))

    expect(res.status).toBe(404)
  })

  it('returns logs filtered by characterId', async () => {
    const res = await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?characterId=char-1'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(mockRepos.llmLogs.findByCharacterId).toHaveBeenCalledWith('char-1')
    expect(data.count).toBe(1)
  })

  it('returns standalone logs when standalone=true', async () => {
    const res = await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?standalone=true&limit=10'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(mockRepos.llmLogs.findStandalone).toHaveBeenCalledWith('user-123', 10)
    expect(data.count).toBe(1)
  })

  it('returns logs by type when type provided', async () => {
    const res = await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?type=tool'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(mockRepos.llmLogs.findByType).toHaveBeenCalledWith('user-123', 'tool', 50)
    expect(data.count).toBe(1)
  })

  it('applies limit and offset pagination', async () => {
    mockRepos.llmLogs.findRecent.mockResolvedValue([
      { ...baseLog, id: 'log-1' },
      { ...baseLog, id: 'log-2' },
      { ...baseLog, id: 'log-3' },
    ])

    const res = await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?limit=1&offset=1'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.count).toBe(1)
    expect(data.total).toBe(3)
    expect(data.logs[0].id).toBe('log-2')
  })
})

describe('GET /api/v1/llm-logs/[id]', () => {
  it('returns 404 when log not found', async () => {
    mockRepos.llmLogs.findById.mockResolvedValue(null)

    const res = await getLLMLog(createMockRequest('http://localhost/api/v1/llm-logs/log-404'), createParams('log-404') as any)

    expect(res.status).toBe(404)
  })

  it('returns 403 when log belongs to another user', async () => {
    mockRepos.llmLogs.findById.mockResolvedValue({ ...baseLog, userId: 'user-999' })

    const res = await getLLMLog(createMockRequest('http://localhost/api/v1/llm-logs/log-2'), createParams('log-2') as any)

    expect(res.status).toBe(403)
  })

  it('returns log when found and owned', async () => {
    const res = await getLLMLog(createMockRequest('http://localhost/api/v1/llm-logs/log-1'), createParams('log-1') as any)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.id).toBe('log-1')
  })
})

describe('DELETE /api/v1/llm-logs/[id]', () => {
  it('returns 404 when log not found', async () => {
    mockRepos.llmLogs.findById.mockResolvedValue(null)

    const res = await deleteLLMLog(createMockRequest('http://localhost/api/v1/llm-logs/log-404'), createParams('log-404') as any)

    expect(res.status).toBe(404)
  })

  it('returns 403 when log belongs to another user', async () => {
    mockRepos.llmLogs.findById.mockResolvedValue({ ...baseLog, userId: 'user-999' })

    const res = await deleteLLMLog(createMockRequest('http://localhost/api/v1/llm-logs/log-2'), createParams('log-2') as any)

    expect(res.status).toBe(403)
  })

  it('returns 500 when delete fails', async () => {
    mockRepos.llmLogs.delete.mockResolvedValue(false)

    const res = await deleteLLMLog(createMockRequest('http://localhost/api/v1/llm-logs/log-1'), createParams('log-1') as any)

    expect(res.status).toBe(500)
  })

  it('deletes log when owned', async () => {
    const res = await deleteLLMLog(createMockRequest('http://localhost/api/v1/llm-logs/log-1'), createParams('log-1') as any)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.deletedId).toBe('log-1')
  })
})
