/**
 * Unit tests for Sidebar Chats API Route
 * Tests: GET /api/sidebar/chats
 *
 * Tests the sidebar chats endpoint for getting recent chats
 * for the left sidebar with participant info.
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

jest.mock('@/lib/logger', () => {
  const mockLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => mockLogger),
  }
  return { logger: mockLogger }
})

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
let GET: typeof import('@/app/api/sidebar/chats/route').GET

/**
 * Helper to create a mock NextRequest
 */
const createRequest = (): NextRequest =>
  ({
    json: async () => ({}),
  }) as unknown as NextRequest

// Mock session data
const mockSession = {
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2024-12-31T00:00:00.000Z',
}

// Mock characters
const mockCharacters = {
  'char-1': {
    id: 'char-1',
    name: 'Alice',
    avatarUrl: 'https://example.com/alice.png',
    tags: ['fantasy', 'adventure'],
  },
  'char-2': {
    id: 'char-2',
    name: 'Bob',
    avatarUrl: null,
    tags: ['sci-fi'],
  },
}

// Mock chats
const mockChats = [
  {
    id: 'chat-1',
    title: 'Adventure Chat',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-03T00:00:00.000Z',
    participants: [
      { characterId: 'char-1' },
      { characterId: 'char-2' },
    ],
    messageCount: 10,
  },
  {
    id: 'chat-2',
    title: 'Solo Chat',
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    participants: [
      { characterId: 'char-1' },
    ],
    messageCount: 5,
  },
  {
    id: 'chat-3',
    title: 'Old Chat',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: null, // No updates, uses createdAt
    participants: [],
    messageCount: 0,
  },
]

// Mock files/images
const mockFiles = [
  {
    id: 'img-1',
    linkedTo: 'char-2',
    tags: ['avatar'],
  },
]

describe('Sidebar Chats API Route', () => {
  let mockChatsRepo: {
    findByUserId: jest.Mock
  }
  let mockCharactersRepo: {
    findById: jest.Mock
  }
  let mockFilesRepo: {
    findByLinkedTo: jest.Mock
  }
  let mockUsersRepo: {
    findById: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock repositories
    mockChatsRepo = {
      findByUserId: jest.fn(),
    }
    mockCharactersRepo = {
      findById: jest.fn(),
    }
    mockFilesRepo = {
      findByLinkedTo: jest.fn(),
    }
    mockUsersRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      }),
    }

    mockGetRepositories.mockReturnValue({
      chats: mockChatsRepo,
      characters: mockCharactersRepo,
      files: mockFilesRepo,
      users: mockUsersRepo,
    } as any)

    // Default session mock
    mockGetServerSession.mockResolvedValue(mockSession)

    // Fresh import of route handlers for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/sidebar/chats/route')
      GET = routeModule.GET
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ============================================================================
  // GET /api/sidebar/chats Tests
  // ============================================================================
  describe('GET /api/sidebar/chats', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null)

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })

      it('should return 401 when session has no user id', async () => {
        mockGetServerSession.mockResolvedValue({ user: {}, expires: '2024-12-31' })

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })
    })

    describe('Successful Retrieval', () => {
      it('should return recent chats sorted by updatedAt', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue(mockChats)
        mockCharactersRepo.findById.mockImplementation((id: string) =>
          Promise.resolve(mockCharacters[id as keyof typeof mockCharacters] || null)
        )
        mockFilesRepo.findByLinkedTo.mockResolvedValue(mockFiles)

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.chats).toBeDefined()
        expect(body.chats.length).toBe(3)
        // chat-1 has most recent updatedAt
        expect(body.chats[0].id).toBe('chat-1')
      })

      it('should include participant info with names and avatars', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue([mockChats[0]])
        mockCharactersRepo.findById.mockImplementation((id: string) =>
          Promise.resolve(mockCharacters[id as keyof typeof mockCharacters] || null)
        )
        mockFilesRepo.findByLinkedTo.mockResolvedValue(mockFiles)

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        const chat = body.chats[0]
        expect(chat.participants.length).toBe(2)
        expect(chat.participants[0].name).toBe('Alice')
        expect(chat.participants[0].avatarUrl).toBe('https://example.com/alice.png')
        expect(chat.participants[1].name).toBe('Bob')
        expect(chat.participants[1].avatarUrl).toBe('/api/files/img-1')
      })

      it('should collect character tags for filtering', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue([mockChats[0]])
        mockCharactersRepo.findById.mockImplementation((id: string) =>
          Promise.resolve(mockCharacters[id as keyof typeof mockCharacters] || null)
        )
        mockFilesRepo.findByLinkedTo.mockResolvedValue([])

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        const chat = body.chats[0]
        expect(chat.characterTags).toContain('fantasy')
        expect(chat.characterTags).toContain('adventure')
        expect(chat.characterTags).toContain('sci-fi')
      })

      it('should deduplicate character tags', async () => {
        const charsWithDupeTags = {
          'char-1': { ...mockCharacters['char-1'], tags: ['fantasy'] },
          'char-2': { ...mockCharacters['char-2'], tags: ['fantasy'] },
        }
        mockChatsRepo.findByUserId.mockResolvedValue([mockChats[0]])
        mockCharactersRepo.findById.mockImplementation((id: string) =>
          Promise.resolve(charsWithDupeTags[id as keyof typeof charsWithDupeTags] || null)
        )
        mockFilesRepo.findByLinkedTo.mockResolvedValue([])

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        const chat = body.chats[0]
        const fantasyCount = chat.characterTags.filter((t: string) => t === 'fantasy').length
        expect(fantasyCount).toBe(1)
      })

      it('should use createdAt when updatedAt is null', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue([mockChats[2]])
        mockCharactersRepo.findById.mockResolvedValue(null)
        mockFilesRepo.findByLinkedTo.mockResolvedValue([])

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.chats[0].updatedAt).toBe('2024-01-01T00:00:00.000Z')
      })

      it('should limit to 15 chats', async () => {
        const manyChats = Array.from({ length: 20 }, (_, i) => ({
          id: `chat-${i}`,
          title: `Chat ${i}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          participants: [],
          messageCount: i,
        }))
        mockChatsRepo.findByUserId.mockResolvedValue(manyChats)

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.chats.length).toBe(15)
      })

      it('should return empty array when no chats exist', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue([])

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.chats).toEqual([])
      })

      it('should handle deleted characters gracefully', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue([mockChats[0]])
        mockCharactersRepo.findById.mockResolvedValue(null) // Character deleted
        mockFilesRepo.findByLinkedTo.mockResolvedValue([])

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        // Participants should be empty since characters don't exist
        expect(body.chats[0].participants).toEqual([])
      })

      it('should include message count', async () => {
        mockChatsRepo.findByUserId.mockResolvedValue([mockChats[0]])
        mockCharactersRepo.findById.mockImplementation((id: string) =>
          Promise.resolve(mockCharacters[id as keyof typeof mockCharacters] || null)
        )
        mockFilesRepo.findByLinkedTo.mockResolvedValue([])

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.chats[0].messageCount).toBe(10)
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on unexpected error', async () => {
        mockChatsRepo.findByUserId.mockRejectedValue(new Error('Database error'))

        const request = createRequest()
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to fetch chats')
      })

      it('should log error on failure', async () => {
        const testError = new Error('Database connection lost')
        mockChatsRepo.findByUserId.mockRejectedValue(testError)

        const request = createRequest()
        await GET(request)

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error fetching sidebar chats',
          expect.objectContaining({
            userId: 'user-123',
          })
        )
      })
    })
  })
})
