/**
 * Image Generation API Tests (v1)
 * Tests POST /api/v1/images?action=generate
 */

import { POST } from '@/app/api/v1/images/route'
import { getServerSession } from '@/lib/auth/session'
import { createLLMProvider } from '@/lib/llm'
import { getRepositories, getRepositoriesSafe } from '@/lib/repositories/factory'
import { fileStorageManager } from '@/lib/file-storage/manager'
import { getInheritedTags } from '@/lib/files/tag-inheritance'
import { createMockRepositoryContainer, setupAuthMocks, type MockRepositoryContainer } from '@/__tests__/unit/lib/fixtures/mock-repositories'
import { NextRequest } from 'next/server'

// Create mock repos before jest.mock
const mockRepos = createMockRepositoryContainer()

// Note: Mocks for next-auth, @/lib/encryption, @/lib/llm, @/lib/repositories/factory,
// @/lib/file-storage/manager, and @/lib/files/tag-inheritance are defined in jest.setup.ts

const mockGetServerSession = jest.mocked(getServerSession)
const mockCreateLLMProvider = jest.mocked(createLLMProvider)
const mockGetRepositories = jest.mocked(getRepositories)
const mockGetRepositoriesSafe = jest.mocked(getRepositoriesSafe)
const mockFileStorageManager = jest.mocked(fileStorageManager)
const mockGetInheritedTags = jest.mocked(getInheritedTags)

// Helper to create a mock NextRequest with action=generate query parameter
function createMockRequest(body: any) {
  const url = new URL('http://localhost:3000/api/v1/images?action=generate')
  return {
    json: jest.fn().mockResolvedValue(body),
    nextUrl: url,
    url: url.toString(),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as NextRequest
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('POST /api/v1/images?action=generate', () => {
  let mockConnectionsRepo: any
  let mockImagesRepo: any
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    // Setup getRepositories and getRepositoriesSafe to return mockRepos
    mockGetRepositories.mockReturnValue(mockRepos)
    mockGetRepositoriesSafe.mockResolvedValue(mockRepos)

    // Setup auth mocks with the user ID used by these tests
    setupAuthMocks(mockGetServerSession as jest.Mock, mockRepos, {
      id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
    })

    // Setup repository mocks structure
    mockConnectionsRepo = {
      findById: jest.fn(),
      findFirst: jest.fn(),
      getAllApiKeys: jest.fn(),
      findApiKeyById: jest.fn(),
      createApiKey: jest.fn(),
      updateApiKey: jest.fn(),
      deleteApiKey: jest.fn(),
      findByUserId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    }

    mockImagesRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByUserId: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    }

    // Update the mock repos with specific test repo instances
    mockRepos.connections = mockConnectionsRepo as any
    mockRepos.images = mockImagesRepo as any
    mockRepos.files = mockImagesRepo as any

    // Setup file storage and tag inheritance mocks (base mocks are in jest.setup.ts, but reset here)
    mockFileStorageManager.uploadFile.mockResolvedValue({ storageKey: 'mock-storage-key' })
    mockGetInheritedTags.mockResolvedValue([])
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('should return 500 when session fails (should not happen in single-user mode)', async () => {
    mockGetServerSession.mockResolvedValueOnce(null)

    const request = createMockRequest({
      prompt: 'test prompt',
      profileId: VALID_UUID,
    })

    const response = await POST(request)
    expect(response.status).toBe(500)
  })

  it('should return 400 if validation fails', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: 'test-user-id', email: 'test@example.com' },
    } as any)

    const request = createMockRequest({
      prompt: '', // Empty prompt should fail validation
      profileId: VALID_UUID,
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('should return 400 if connection profile not found', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: 'test-user-id', email: 'test@example.com' },
    } as any)

    mockConnectionsRepo.findById.mockResolvedValueOnce(null)

    const request = createMockRequest({
      prompt: 'test prompt',
      profileId: VALID_UUID,
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('should return 400 if provider does not support image generation', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: 'test-user-id', email: 'test@example.com' },
    } as any)

    mockConnectionsRepo.findById.mockResolvedValueOnce({
      id: VALID_UUID,
      userId: 'test-user-id',
      name: 'Test Profile',
      provider: 'ANTHROPIC', // Anthropic doesn't support image generation
      modelName: 'claude-3-opus',
      parameters: {},
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      apiKeyId: null,
      baseUrl: null,
      apiKey: null,
    } as any)

    const mockProvider = {
      supportsImageGeneration: false,
    } as any

    mockCreateLLMProvider.mockReturnValueOnce(mockProvider)

    const request = createMockRequest({
      prompt: 'test prompt',
      profileId: VALID_UUID,
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('should successfully generate images', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: 'test-user-id', email: 'test@example.com' },
    } as any)

    mockConnectionsRepo.findById.mockResolvedValueOnce({
      id: VALID_UUID,
      userId: 'test-user-id',
      name: 'Test Profile',
      provider: 'OPENAI',
      modelName: 'dall-e-3',
      parameters: {},
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      apiKeyId: 'test-key-id',
      baseUrl: null,
    } as any)
    mockConnectionsRepo.findApiKeyById.mockResolvedValueOnce({
      id: 'test-key-id',
      userId: 'test-user-id',
      provider: 'OPENAI',
      label: 'Test Key',
      key_value: 'sk-test-api-key',
      isActive: true,
      lastUsed: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)


    const mockProvider = {
      supportsImageGeneration: true,
      generateImage: jest.fn().mockResolvedValueOnce({
        images: [
          {
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', // 1x1 PNG
            mimeType: 'image/png',
            revisedPrompt: 'A test image',
          },
        ],
        raw: {},
      }),
    }

    mockCreateLLMProvider.mockReturnValueOnce(mockProvider)

    mockImagesRepo.create.mockResolvedValueOnce({
      id: 'test-image-id',
      userId: 'test-user-id',
      originalFilename: 'test.png',
      mimeType: 'image/png',
      size: 67,
      width: null,
      height: null,
      source: 'GENERATED',
      generationPrompt: 'a beautiful landscape',
      generationModel: 'dall-e-3',
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      storageKey: 'users/test-user-id/images/test-image-id/test.png',
    } as any)

    const request = createMockRequest({
      prompt: 'a beautiful landscape',
      profileId: VALID_UUID,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.data).toBeDefined()
    expect(data.data).toHaveLength(1)
    expect(data.metadata.prompt).toBe('a beautiful landscape')
    expect(data.metadata.provider).toBe('OPENAI')
    expect(mockProvider.generateImage).toHaveBeenCalled()
    expect(mockFileStorageManager.uploadFile).toHaveBeenCalled()

    // Verify fields are set correctly
    // Second argument is { id: fileId } to ensure metadata ID matches S3 path
    expect(mockRepos.files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'GENERATED',
        generationPrompt: 'a beautiful landscape',
        generationModel: 'dall-e-3',
      }),
      expect.objectContaining({ id: expect.any(String) })
    )
  })

  it('should handle image generation with tags', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: 'test-user-id', email: 'test@example.com' },
    } as any)

    mockConnectionsRepo.findById.mockResolvedValueOnce({
      id: VALID_UUID,
      userId: 'test-user-id',
      name: 'Test Profile',
      provider: 'OPENAI',
      modelName: 'dall-e-3',
      parameters: {},
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      apiKeyId: 'test-key-id',
      baseUrl: null,
    } as any)
    mockConnectionsRepo.findApiKeyById.mockResolvedValueOnce({
      id: 'test-key-id',
      userId: 'test-user-id',
      provider: 'OPENAI',
      label: 'Test Key',
      key_value: 'sk-test-api-key',
      isActive: true,
      lastUsed: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)


    const mockProvider = {
      supportsImageGeneration: true,
      generateImage: jest.fn().mockResolvedValueOnce({
        images: [
          {
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            mimeType: 'image/png',
          },
        ],
        raw: {},
      }),
    }

    mockCreateLLMProvider.mockReturnValueOnce(mockProvider)

    mockImagesRepo.create.mockResolvedValueOnce({
      id: 'test-image-id',
      userId: 'test-user-id',
      originalFilename: 'test.png',
      mimeType: 'image/png',
      size: 67,
      width: null,
      height: null,
      source: 'GENERATED',
      generationPrompt: 'a warrior character',
      generationModel: 'dall-e-3',
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: ['inherited-tag-1'],
      storageKey: 'users/test-user-id/images/test-image-id/test.png',
    } as any)

    // Mock inherited tags from the character
    mockGetInheritedTags.mockResolvedValueOnce(['inherited-tag-1'])

    const request = createMockRequest({
      prompt: 'a warrior character',
      profileId: VALID_UUID,
      tags: [
        {
          tagType: 'CHARACTER',
          tagId: 'char-1',
        },
      ],
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.data[0].tags).toHaveLength(1)
    expect(data.data[0].tags[0].tagType).toBe('CHARACTER')
  })

  it('should handle generation options', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: 'test-user-id', email: 'test@example.com' },
    } as any)

    mockConnectionsRepo.findById.mockResolvedValueOnce({
      id: VALID_UUID,
      userId: 'test-user-id',
      name: 'Test Profile',
      provider: 'OPENAI',
      modelName: 'dall-e-3',
      parameters: {},
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      apiKeyId: 'test-key-id',
      baseUrl: null,
    } as any)
    mockConnectionsRepo.findApiKeyById.mockResolvedValueOnce({
      id: 'test-key-id',
      userId: 'test-user-id',
      provider: 'OPENAI',
      label: 'Test Key',
      key_value: 'sk-test-api-key',
      isActive: true,
      lastUsed: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)


    const mockProvider = {
      supportsImageGeneration: true,
      generateImage: jest.fn().mockResolvedValueOnce({
        images: [
          {
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            mimeType: 'image/png',
          },
        ],
        raw: {},
      }),
    }

    mockCreateLLMProvider.mockReturnValueOnce(mockProvider)

    mockImagesRepo.create.mockResolvedValueOnce({
      id: 'test-image-id',
      userId: 'test-user-id',
      originalFilename: 'test.png',
      mimeType: 'image/png',
      size: 67,
      width: null,
      height: null,
      source: 'GENERATED',
      generationPrompt: 'a test image',
      generationModel: 'dall-e-3',
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      storageKey: 'users/test-user-id/images/test-image-id/test.png',
    } as any)

    const request = createMockRequest({
      prompt: 'a test image',
      profileId: VALID_UUID,
      options: {
        size: '1024x1024',
        quality: 'hd',
        style: 'vivid',
      },
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(mockProvider.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'a test image',
        size: '1024x1024',
        quality: 'hd',
        style: 'vivid',
      }),
      'sk-test-api-key'
    )
  })
})
