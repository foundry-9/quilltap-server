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
    expect(mockRepos.llmLogs.findStandalone).toHaveBeenCalledWith('user-123', 10, 0)
    expect(data.count).toBe(1)
  })

  it('returns logs by type when type provided', async () => {
    const res = await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?type=tool'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(mockRepos.llmLogs.findByType).toHaveBeenCalledWith('user-123', 'tool', 50, 0)
    expect(data.count).toBe(1)
  })

  // #167: the user-wide listings page in SQL, so the offset goes to the
  // repository and the total comes from a count, never from the page.
  it('passes limit and offset to the repository and totals with a count', async () => {
    mockRepos.llmLogs.findRecent.mockResolvedValue([{ ...baseLog, id: 'log-2' }])
    mockRepos.llmLogs.countByScope.mockResolvedValue(3)

    const res = await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?limit=1&offset=1'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(mockRepos.llmLogs.findRecent).toHaveBeenCalledWith('user-123', 1, 1)
    expect(mockRepos.llmLogs.countByScope).toHaveBeenCalledWith('user-123', { kind: 'recent' })
    expect(data.count).toBe(1)
    expect(data.total).toBe(3)
    expect(data.offset).toBe(1)
    expect(data.logs[0].id).toBe('log-2')
  })

  it('counts the same scope it pages for type and standalone', async () => {
    await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?type=tool&offset=50'))
    expect(mockRepos.llmLogs.findByType).toHaveBeenCalledWith('user-123', 'tool', 50, 50)
    expect(mockRepos.llmLogs.countByScope).toHaveBeenCalledWith('user-123', { kind: 'type', type: 'tool' })

    await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?standalone=true'))
    expect(mockRepos.llmLogs.countByScope).toHaveBeenCalledWith('user-123', { kind: 'standalone' })
  })

  it('clamps a negative or non-numeric limit to the default rather than reading every row', async () => {
    for (const bad of ['-1', 'abc', '0']) {
      mockRepos.llmLogs.findRecent.mockClear()
      const res = await listLLMLogs(createMockRequest(`http://localhost/api/v1/llm-logs?limit=${bad}&offset=-5`))
      expect(res.status).toBe(200)
      expect(mockRepos.llmLogs.findRecent).toHaveBeenCalledWith('user-123', 50, 0)
    }
  })

  it('caps the limit at 100', async () => {
    await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?limit=5000'))
    expect(mockRepos.llmLogs.findRecent).toHaveBeenCalledWith('user-123', 100, 0)
  })

  it('pages the per-entity listings in memory', async () => {
    mockRepos.llmLogs.findByChatId.mockResolvedValue([
      { ...baseLog, id: 'log-1' },
      { ...baseLog, id: 'log-2' },
      { ...baseLog, id: 'log-3' },
    ])
    const res = await listLLMLogs(createMockRequest('http://localhost/api/v1/llm-logs?chatId=chat-1&limit=1&offset=1'))
    const data = await res.json()
    expect(data.total).toBe(3)
    expect(data.logs.map((l: { id: string }) => l.id)).toEqual(['log-2'])
    expect(mockRepos.llmLogs.countByScope).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/llm-logs/[id]', () => {
  it('returns 404 when log not found', async () => {
    mockRepos.llmLogs.findById.mockResolvedValue(null)

    const res = await getLLMLog(createMockRequest('http://localhost/api/v1/llm-logs/log-404'), createParams('log-404') as any)

    expect(res.status).toBe(404)
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
