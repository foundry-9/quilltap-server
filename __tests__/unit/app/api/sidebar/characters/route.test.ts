/**
 * Unit tests for Sidebar Characters API Route
 * Tests: GET /api/sidebar/characters
 *
 * Tests the sidebar characters endpoint for getting characters
 * for the left sidebar (favorites + top participants).
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
let GET: typeof import('@/app/api/v1/ui/sidebar/route').GET

/**
 * Helper to create a mock NextRequest
 */
const createRequest = (type: 'characters' | 'chats' = 'characters'): NextRequest =>
  ({
    url: `https://localhost:3000/api/v1/ui/sidebar?type=${type}`,
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
const mockCharacters = [
  {
    id: 'char-1',
    userId: 'user-123',
    name: 'Alice',
    avatarUrl: 'https://example.com/alice.png',
    isFavorite: true,
    npc: false,
    controlledBy: 'llm',
    tags: ['fantasy'],
    defaultImageId: null,
  },
  {
    id: 'char-2',
    userId: 'user-123',
    name: 'Bob',
    avatarUrl: null,
    isFavorite: false,
    npc: false,
    controlledBy: 'llm',
    tags: ['sci-fi'],
    defaultImageId: 'img-1',
  },
  {
    id: 'char-3',
    userId: 'user-123',
    name: 'Charlie',
    avatarUrl: null,
    isFavorite: false,
    npc: true, // NPC should be excluded
    controlledBy: 'llm',
    tags: [],
    defaultImageId: null,
  },
  {
    id: 'char-4',
    userId: 'user-123',
    name: 'Diana',
    avatarUrl: null,
    isFavorite: false,
    npc: false,
    controlledBy: 'user', // User-controlled should be excluded
    tags: [],
    defaultImageId: null,
  },
]

// Mock chats
const mockChats = [
  {
    id: 'chat-1',
    participants: [{ characterId: 'char-1' }, { characterId: 'char-2' }],
  },
  {
    id: 'chat-2',
    participants: [{ characterId: 'char-1' }],
  },
  {
    id: 'chat-3',
    participants: [{ characterId: 'char-2' }],
  },
]

// Mock files/images
const mockFiles = [
  {
    id: 'img-1',
    linkedTo: 'char-2',
    tags: ['avatar'],
  },
  {
    id: 'img-2',
    linkedTo: 'char-2',
    tags: [],
  },
]

// Tests for v1 API sidebar route - /api/v1/ui/sidebar?type=characters
describe('Sidebar Characters API Route (v1)', () => {
  let mockCharactersRepo: {
    findByUserId: jest.Mock
  }
  let mockChatsRepo: {
    findByUserId: jest.Mock
  }
  let mockFilesRepo: {
    findById: jest.Mock
    findByLinkedTo: jest.Mock
  }
  let mockUsersRepo: {
    findById: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock repositories
    mockCharactersRepo = {
      findByUserId: jest.fn(),
    }
    mockChatsRepo = {
      findByUserId: jest.fn(),
    }
    mockFilesRepo = {
      findById: jest.fn(),
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
      characters: mockCharactersRepo,
      chats: mockChatsRepo,
      files: mockFilesRepo,
      users: mockUsersRepo,
    } as any)

    // Default session mock
    mockGetServerSession.mockResolvedValue(mockSession)

    // Fresh import of route handlers for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/v1/ui/sidebar/route')
      GET = routeModule.GET
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ============================================================================
  // GET /api/v1/ui/sidebar?type=characters Tests
  // ============================================================================
  describe('GET /api/v1/ui/sidebar?type=characters', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null)

        const request = createRequest('characters')
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })

      it('should return 401 when session has no user id', async () => {
        mockGetServerSession.mockResolvedValue({ user: {}, expires: '2024-12-31' })

        const request = createRequest('characters')
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })
    })

    describe('Successful Retrieval', () => {
      it('should return characters for sidebar', async () => {
        mockCharactersRepo.findByUserId.mockResolvedValue(mockCharacters)
        mockChatsRepo.findByUserId.mockResolvedValue(mockChats)
        mockFilesRepo.findById.mockResolvedValue(mockFiles[0])
        mockFilesRepo.findByLinkedTo.mockResolvedValue([])

        const request = createRequest('characters')
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.characters).toBeDefined()
        // Should exclude NPC (char-3) and user-controlled (char-4)
        expect(body.characters.length).toBe(2)
      })

      it('should prioritize favorite characters', async () => {
        mockCharactersRepo.findByUserId.mockResolvedValue(mockCharacters)
        mockChatsRepo.findByUserId.mockResolvedValue(mockChats)
        mockFilesRepo.findById.mockResolvedValue(null)
        mockFilesRepo.findByLinkedTo.mockResolvedValue([])

        const request = createRequest('characters')
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        // Alice (favorite) should be first
        expect(body.characters[0].name).toBe('Alice')
        expect(body.characters[0].isFavorite).toBe(true)
      })

      it('should sort by chat count after favorites', async () => {
        mockCharactersRepo.findByUserId.mockResolvedValue([
          { ...mockCharacters[1], name: 'Bob' }, // Not favorite, appears in 2 chats
          { ...mockCharacters[0], isFavorite: false, name: 'Alice' }, // Not favorite, appears in 2 chats
        ])
        mockChatsRepo.findByUserId.mockResolvedValue([
          { id: 'chat-1', participants: [{ characterId: 'char-2' }] },
          { id: 'chat-2', participants: [{ characterId: 'char-2' }] },
          { id: 'chat-3', participants: [{ characterId: 'char-1' }] },
        ])
        mockFilesRepo.findById.mockResolvedValue(null)
        mockFilesRepo.findByLinkedTo.mockResolvedValue([])

        const request = createRequest('characters')
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        // Bob has 2 chat appearances, Alice has 1
        expect(body.characters[0].chatCount).toBeGreaterThanOrEqual(body.characters[1].chatCount)
      })

      it('should use avatarUrl when available', async () => {
        mockCharactersRepo.findByUserId.mockResolvedValue([mockCharacters[0]])
        mockChatsRepo.findByUserId.mockResolvedValue([])
        mockFilesRepo.findById.mockResolvedValue(null)
        mockFilesRepo.findByLinkedTo.mockResolvedValue([])

        const request = createRequest('characters')
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.characters[0].avatarUrl).toBe('https://example.com/alice.png')
      })

      it('should use defaultImageId when no avatarUrl', async () => {
        mockCharactersRepo.findByUserId.mockResolvedValue([mockCharacters[1]])
        mockChatsRepo.findByUserId.mockResolvedValue([])
        mockFilesRepo.findById.mockResolvedValue(mockFiles[0])
        mockFilesRepo.findByLinkedTo.mockResolvedValue([])

        const request = createRequest('characters')
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.characters[0].defaultImage).toBe('/api/files/img-1')
      })

      it('should fallback to avatar-tagged image', async () => {
        const charWithoutAvatar = { ...mockCharacters[1], defaultImageId: null }
        mockCharactersRepo.findByUserId.mockResolvedValue([charWithoutAvatar])
        mockChatsRepo.findByUserId.mockResolvedValue([])
        mockFilesRepo.findById.mockResolvedValue(null)
        mockFilesRepo.findByLinkedTo.mockResolvedValue(mockFiles)

        const request = createRequest('characters')
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.characters[0].defaultImage).toBe('/api/files/img-1')
      })

      it('should limit to 10 characters', async () => {
        const manyCharacters = Array.from({ length: 15 }, (_, i) => ({
          id: `char-${i}`,
          userId: 'user-123',
          name: `Character ${i}`,
          avatarUrl: null,
          isFavorite: false,
          npc: false,
          controlledBy: 'llm',
          tags: [],
          defaultImageId: null,
        }))
        mockCharactersRepo.findByUserId.mockResolvedValue(manyCharacters)
        mockChatsRepo.findByUserId.mockResolvedValue([])
        mockFilesRepo.findById.mockResolvedValue(null)
        mockFilesRepo.findByLinkedTo.mockResolvedValue([])

        const request = createRequest('characters')
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.characters.length).toBe(10)
      })

      it('should return empty array when no characters exist', async () => {
        mockCharactersRepo.findByUserId.mockResolvedValue([])
        mockChatsRepo.findByUserId.mockResolvedValue([])

        const request = createRequest('characters')
        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.characters).toEqual([])
      })
    })

    // Error handling is tested through the v1 route's error handling
    // which wraps the handlers with error catching
  })
})
