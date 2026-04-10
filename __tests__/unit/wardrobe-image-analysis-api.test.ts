import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { getServerSession } from '@/lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '@/lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks } from '@/__tests__/unit/lib/fixtures/mock-repositories'
import type { NextRequest } from 'next/server'

const mockRepos = createMockRepositoryContainer()
const mockAnalyzeImageForWardrobeItems = jest.fn()

jest.mock('@/lib/wardrobe/image-analysis', () => ({
  analyzeImageForWardrobeItems: (...args: unknown[]) => mockAnalyzeImageForWardrobeItems(...args),
}))

const { POST } = require('@/app/api/v1/wardrobe/analyze-image/route') as {
  POST: typeof import('@/app/api/v1/wardrobe/analyze-image/route').POST
}

const mockGetServerSession = jest.mocked(getServerSession)
const mockGetRepositories = jest.mocked(getRepositories)
const mockGetRepositoriesSafe = jest.mocked(getRepositoriesSafe)

function createMockRequest(body: unknown): NextRequest {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/wardrobe/analyze-image',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: jest.fn().mockResolvedValue(body),
  } as unknown as NextRequest
}

describe('POST /api/v1/wardrobe/analyze-image', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReturnValue(mockRepos)
    mockGetRepositoriesSafe.mockResolvedValue(mockRepos)
    setupAuthMocks(mockGetServerSession as jest.Mock, mockRepos)
  })

  it('returns a validation error for unsupported image formats', async () => {
    const response = await POST(createMockRequest({
      image: 'abc123',
      mimeType: 'image/svg+xml',
    }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation error')
    expect(mockAnalyzeImageForWardrobeItems).not.toHaveBeenCalled()
  })

  it('rejects oversized base64 payloads before analysis runs', async () => {
    const response = await POST(createMockRequest({
      image: 'a'.repeat(14_000_001),
      mimeType: 'image/png',
    }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Image is too large. Maximum file size is 10 MB.' })
    expect(mockAnalyzeImageForWardrobeItems).not.toHaveBeenCalled()
  })

  it('returns proposed wardrobe items from the vision analysis service', async () => {
    mockAnalyzeImageForWardrobeItems.mockResolvedValue({
      proposedItems: [
        { name: 'velvet blazer', type: 'top', description: 'A deep green velvet blazer with brass buttons' },
        { name: 'lace gloves', type: 'accessory', description: 'Short black gloves with lace trim' },
      ],
      provider: 'OPENAI',
      model: 'gpt-4o',
    })

    const response = await POST(createMockRequest({
      image: 'abc123',
      mimeType: 'image/png',
      guidance: 'Focus on the jacket and accessories.',
    }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockAnalyzeImageForWardrobeItems).toHaveBeenCalledWith(
      {
        image: 'abc123',
        mimeType: 'image/png',
        guidance: 'Focus on the jacket and accessories.',
      },
      mockRepos,
      'user-123',
    )
    expect(data).toEqual({
      proposedItems: [
        { name: 'velvet blazer', type: 'top', description: 'A deep green velvet blazer with brass buttons' },
        { name: 'lace gloves', type: 'accessory', description: 'Short black gloves with lace trim' },
      ],
      provider: 'OPENAI',
      model: 'gpt-4o',
    })
  })

  it('surfaces user-facing analysis failures as bad requests', async () => {
    mockAnalyzeImageForWardrobeItems.mockRejectedValue(
      new Error('No vision-capable provider is configured. Configure one in your provider settings.'),
    )

    const response = await POST(createMockRequest({
      image: 'abc123',
      mimeType: 'image/jpeg',
    }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({
      error: 'No vision-capable provider is configured. Configure one in your provider settings.',
    })
  })
})
