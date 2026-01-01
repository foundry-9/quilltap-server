/**
 * Unit tests for Message Memories API Route
 * Tests: GET /api/messages/:id/memories
 *
 * Tests the message memories endpoint for getting memory count
 * and info associated with a specific message.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { NextRequest } from 'next/server'

// Mock dependencies before imports
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/auth/session', () => ({
  getServerSession: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Get mocked modules using requireMock
const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
}
const sessionMock = jest.requireMock('@/lib/auth/session') as {
  getServerSession: jest.Mock
}
const loggerMock = jest.requireMock('@/lib/logger') as {
  logger: {
    info: jest.Mock
    debug: jest.Mock
    warn: jest.Mock
    error: jest.Mock
  }
}

const mockGetRepositories = repositoriesMock.getRepositories
const mockGetServerSession = sessionMock.getServerSession
const mockLogger = loggerMock.logger

// Declare route handlers
let GET: typeof import('@/app/api/messages/[id]/memories/route').GET

/**
 * Helper to create a mock NextRequest
 */
const createRequest = (): NextRequest =>
  ({
    json: async () => ({}),
  }) as unknown as NextRequest

/**
 * Helper to create mock params promise
 */
const createParams = (id: string): Promise<{ id: string }> =>
  Promise.resolve({ id })

// Mock session data
const mockSession = {
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2024-12-31T00:00:00.000Z',
}

// Mock chat data
const mockChat = {
  id: 'chat-123',
  userId: 'user-123',
  title: 'Test Chat',
  participants: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

// Mock messages
const mockMessages = [
  {
    id: 'msg-1',
    type: 'message' as const,
    content: 'Hello world',
    role: 'assistant',
    swipeGroupId: null,
  },
  {
    id: 'msg-2',
    type: 'message' as const,
    content: 'Hello response',
    role: 'assistant',
    swipeGroupId: 'swipe-group-1',
  },
  {
    id: 'msg-3',
    type: 'message' as const,
    content: 'Alternative response',
    role: 'assistant',
    swipeGroupId: 'swipe-group-1',
  },
]

// Mock memories
const mockMemories = [
  {
    id: 'memory-1',
    summary: 'User said hello',
    characterId: 'char-1',
    importance: 0.7,
    sourceMessageId: 'msg-1',
  },
  {
    id: 'memory-2',
    summary: 'Response was helpful',
    characterId: 'char-2',
    importance: 0.5,
    sourceMessageId: 'msg-2',
  },
]

describe('Message Memories API Route', () => {
  let mockChatsRepo: {
    findByUserId: jest.Mock
    getMessages: jest.Mock
  }
  let mockMemoriesRepo: {
    countBySourceMessageIds: jest.Mock
    findBySourceMessageId: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock repositories
    mockChatsRepo = {
      findByUserId: jest.fn(),
      getMessages: jest.fn(),
    }
    mockMemoriesRepo = {
      countBySourceMessageIds: jest.fn(),
      findBySourceMessageId: jest.fn(),
    }

    mockGetRepositories.mockReturnValue({
      chats: mockChatsRepo,
      memories: mockMemoriesRepo,
    } as any)

    // Default session mock
    mockGetServerSession.mockResolvedValue(mockSession)

    // Fresh import of route handlers for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/messages/[id]/memories/route')
      GET = routeModule.GET
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ============================================================================
  // GET /api/messages/:id/memories Tests
  // ============================================================================
  describe('GET /api/messages/:id/memories', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null)

        const request = createRequest()
        const response = await GET(request, { params: createParams('msg-1') })
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })

      it('should return 401 when session has no user id', async () => {
        mockGetServerSession.mockResolvedValue({ user: {}, expires: '2024-12-31' })

        const request = createRequest()
        const response = await GET(request, { params: createParams('msg-1') })
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })
    })

    describe('Message Not Found', () => {
      it('should return 404 when message does not exist', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue([mockChat])
        mockChatsRepo.getMessages.mockResolvedValue([])

        const request = createRequest()
        const response = await GET(request, { params: createParams('nonexistent') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Message not found')
      })

      it('should return 404 when user has no chats', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue([])

        const request = createRequest()
        const response = await GET(request, { params: createParams('msg-1') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Message not found')
      })
    })

    describe('Successful Retrieval', () => {
      it('should return memory count for a single message', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue([mockChat])
        mockChatsRepo.getMessages.mockResolvedValue(mockMessages)
        mockMemoriesRepo.countBySourceMessageIds.mockResolvedValue(1)
        mockMemoriesRepo.findBySourceMessageId.mockResolvedValue([mockMemories[0]])

        const request = createRequest()
        const response = await GET(request, { params: createParams('msg-1') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.memoryCount).toBe(1)
        expect(body.isSwipeGroup).toBe(false)
        expect(body.swipeCount).toBe(1)
        expect(body.memories).toHaveLength(1)
        expect(body.memories[0].id).toBe('memory-1')
      })

      it('should return memory count for a swipe group', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue([mockChat])
        mockChatsRepo.getMessages.mockResolvedValue(mockMessages)
        mockMemoriesRepo.countBySourceMessageIds.mockResolvedValue(2)
        mockMemoriesRepo.findBySourceMessageId.mockResolvedValue([mockMemories[1]])

        const request = createRequest()
        const response = await GET(request, { params: createParams('msg-2') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.isSwipeGroup).toBe(true)
        expect(body.swipeCount).toBe(2) // msg-2 and msg-3 are in the same swipe group
      })

      it('should return zero memories when none exist', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue([mockChat])
        mockChatsRepo.getMessages.mockResolvedValue(mockMessages)
        mockMemoriesRepo.countBySourceMessageIds.mockResolvedValue(0)

        const request = createRequest()
        const response = await GET(request, { params: createParams('msg-1') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.memoryCount).toBe(0)
        expect(body.memories).toEqual([])
      })

      it('should search across multiple chats', async () => {
        const secondChat = { ...mockChat, id: 'chat-456' }
        mockChatsRepo.findByUserId.mockResolvedValue([mockChat, secondChat])
        // First chat has no matching message
        mockChatsRepo.getMessages
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(mockMessages)
        mockMemoriesRepo.countBySourceMessageIds.mockResolvedValue(1)
        mockMemoriesRepo.findBySourceMessageId.mockResolvedValue([mockMemories[0]])

        const request = createRequest()
        const response = await GET(request, { params: createParams('msg-1') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.memoryCount).toBe(1)
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on unexpected error', async () => {
        mockChatsRepo.findByUserId.mockRejectedValue(new Error('Database error'))

        const request = createRequest()
        const response = await GET(request, { params: createParams('msg-1') })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to get message memories')
      })

      it('should log error on failure', async () => {
        const testError = new Error('Database connection lost')
        mockChatsRepo.findByUserId.mockRejectedValue(testError)

        const request = createRequest()
        await GET(request, { params: createParams('msg-1') })

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error getting message memories',
          expect.objectContaining({
            endpoint: '/api/messages/[id]/memories',
            method: 'GET',
          }),
          testError
        )
      })
    })
  })
})
