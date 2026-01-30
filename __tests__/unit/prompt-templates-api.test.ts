/**
 * Unit tests for prompt template API routes
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PromptTemplate } from '@/lib/schemas/types'
import { GET as listPromptTemplates, POST as createPromptTemplate } from '@/app/api/v1/prompt-templates/route'
import {
  GET as getPromptTemplate,
  PUT as updatePromptTemplate,
  DELETE as deletePromptTemplate,
} from '@/app/api/v1/prompt-templates/[id]/route'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '@/lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks, type MockRepositoryContainer } from '@/__tests__/unit/lib/fixtures/mock-repositories'

// Create mock repos before jest.mock
const mockRepos = createMockRepositoryContainer()

const mockGetServerSession = jest.mocked(getServerSession)
const mockGetRepositories = jest.mocked(getRepositories)
const mockGetRepositoriesSafe = jest.mocked(getRepositoriesSafe)

type PromptTemplateRepo = {
  findAllForUser: jest.Mock
  create: jest.Mock
  findById: jest.Mock
  update: jest.Mock
  delete: jest.Mock
}

const defaultSession = {
  user: {
    id: 'user-123',
    email: 'user@example.com',
  },
}

function createMockRequest(url: string, body?: Record<string, any> | null, method = 'GET') {
  return {
    url,
    method,
    headers: new Map(),
    json: async () => body ?? {},
    text: async () => (body ? JSON.stringify(body) : ''),
  } as any
}

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

let templateCounter = 0
function buildTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  templateCounter += 1
  const timestamp = overrides.createdAt ?? '2024-01-01T00:00:00.000Z'
  const hasUserId = Object.prototype.hasOwnProperty.call(overrides, 'userId')
  const userId = hasUserId ? overrides.userId ?? null : defaultSession.user.id

  return {
    id: overrides.id ?? `template-${templateCounter}`,
    userId,
    name: overrides.name ?? `Template ${templateCounter}`,
    content: overrides.content ?? 'Template content',
    description: overrides.description ?? 'Template description',
    isBuiltIn: overrides.isBuiltIn ?? false,
    category: overrides.category ?? null,
    modelHint: overrides.modelHint ?? null,
    tags: overrides.tags ?? [],
    createdAt: timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
  }
}

let mockPromptRepo: PromptTemplateRepo

beforeEach(() => {
  templateCounter = 0
  mockPromptRepo = {
    findAllForUser: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  }

  // Setup getRepositories and getRepositoriesSafe to return mockRepos
  mockGetRepositories.mockReturnValue(mockRepos)
  mockGetRepositoriesSafe.mockResolvedValue(mockRepos)

  // Setup auth mocks
  setupAuthMocks(mockGetServerSession as jest.Mock, mockRepos)

  // Update the mock repos with specific test repo instances
  mockRepos.promptTemplates = mockPromptRepo as any

  mockGetServerSession.mockResolvedValue(defaultSession as any)
})

describe('Prompt Template Routes', () => {
  describe('GET /api/v1/prompt-templates', () => {
    it('returns 500 when session fails (should not happen in single-user mode)', async () => {
      mockGetServerSession.mockResolvedValueOnce(null as any)

      const res = await listPromptTemplates(createMockRequest('http://localhost/api/v1/prompt-templates'))
      const data = await res.json()

      expect(res.status).toBe(500)
      expect(data).toEqual({ error: 'Internal server error' })
      expect(mockPromptRepo.findAllForUser).not.toHaveBeenCalled()
    })

    it('returns all templates available to user', async () => {
      const builtIn = buildTemplate({ id: 'built-in-1', name: 'Standard', isBuiltIn: true, userId: null })
      const userTemplate = buildTemplate({ id: 'user-1', name: 'My Template', isBuiltIn: false })

      mockPromptRepo.findAllForUser.mockResolvedValue([builtIn, userTemplate])

      const res = await listPromptTemplates(createMockRequest('http://localhost/api/v1/prompt-templates'))
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(mockPromptRepo.findAllForUser).toHaveBeenCalledWith('user-123')
      expect(data.templates).toHaveLength(2)
      expect(data.count).toBe(2)
    })
  })

  describe('POST /api/v1/prompt-templates', () => {
    it('rejects empty names', async () => {
      const req = createMockRequest(
        'http://localhost/api/v1/prompt-templates',
        { name: '', content: 'some content' },
        'POST',
      )

      const res = await createPromptTemplate(req)
      const data = await res.json()

      expect(res.status).toBe(400)
      expect(data.error).toBe('Validation error')
      expect(mockPromptRepo.create).not.toHaveBeenCalled()
    })

    it('creates template with valid data', async () => {
      const createdTemplate = buildTemplate({
        id: 'template-created',
        name: 'Lore Helper',
        content: 'Explain the lore of {{char}} for {{user}}.',
        description: 'Great for immersive chats',
        category: 'Storytelling',
        modelHint: 'gpt-4o',
      })

      mockPromptRepo.create.mockResolvedValue(createdTemplate)

      const req = createMockRequest(
        'http://localhost/api/v1/prompt-templates',
        {
          name: 'Lore Helper',
          content: 'Explain the lore of {{char}} for {{user}}.',
          description: 'Great for immersive chats',
          category: 'Storytelling',
          modelHint: 'gpt-4o',
        },
        'POST',
      )

      const res = await createPromptTemplate(req)
      const data = await res.json()

      expect(res.status).toBe(201)
      expect(mockPromptRepo.create).toHaveBeenCalledWith({
        userId: 'user-123',
        name: 'Lore Helper',
        content: 'Explain the lore of {{char}} for {{user}}.',
        description: 'Great for immersive chats',
        isBuiltIn: false,
        category: 'Storytelling',
        modelHint: 'gpt-4o',
        tags: [],
      })
      expect(data.template).toMatchObject({ id: 'template-created', name: 'Lore Helper' })
    })
  })

  describe('GET /api/v1/prompt-templates/[id]', () => {
    it('returns 500 when session fails (should not happen in single-user mode)', async () => {
      mockGetServerSession.mockResolvedValueOnce(null as any)

      const res = await getPromptTemplate(
        createMockRequest('http://localhost/api/v1/prompt-templates/template-1'),
        createParams('template-1') as any,
      )

      expect(res.status).toBe(500)
      expect(mockPromptRepo.findById).not.toHaveBeenCalled()
    })

    it('returns 404 when template not found', async () => {
      mockPromptRepo.findById.mockResolvedValue(null)

      const res = await getPromptTemplate(
        createMockRequest('http://localhost/api/v1/prompt-templates/template-1'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(404)
      expect(data).toEqual({ error: 'Template not found' })
    })

    it('denies access to other user templates', async () => {
      mockPromptRepo.findById.mockResolvedValue(buildTemplate({ userId: 'other-user', isBuiltIn: false }))

      const res = await getPromptTemplate(
        createMockRequest('http://localhost/api/v1/prompt-templates/template-1'),
        createParams('template-1') as any,
      )

      expect(res.status).toBe(403)
    })

    it('returns template when accessible', async () => {
      const template = buildTemplate({ id: 'template-1', isBuiltIn: true, userId: null })
      mockPromptRepo.findById.mockResolvedValue(template)

      const res = await getPromptTemplate(
        createMockRequest('http://localhost/api/v1/prompt-templates/template-1'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.template).toEqual(template)
    })
  })

  describe('PUT /api/v1/prompt-templates/[id]', () => {
    it('rejects updates when user does not own template', async () => {
      mockPromptRepo.findById.mockResolvedValue(buildTemplate({ userId: 'other-user', isBuiltIn: false }))

      const res = await updatePromptTemplate(
        createMockRequest('http://localhost/api/v1/prompt-templates/template-1', { name: 'New Name' }, 'PUT'),
        createParams('template-1') as any,
      )

      expect(res.status).toBe(403)
      expect(mockPromptRepo.update).not.toHaveBeenCalled()
    })

    it('prevents built-in templates from being edited', async () => {
      mockPromptRepo.findById.mockResolvedValue(
        buildTemplate({ id: 'template-1', userId: 'user-123', isBuiltIn: true }),
      )

      const res = await updatePromptTemplate(
        createMockRequest('http://localhost/api/v1/prompt-templates/template-1', { name: 'New Name' }, 'PUT'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(403)
      expect(data).toEqual({ error: 'Cannot update built-in templates' })
      expect(mockPromptRepo.update).not.toHaveBeenCalled()
    })

    it('updates template with valid values', async () => {
      const existing = buildTemplate({ id: 'template-1', name: 'Old Name', userId: 'user-123' })
      const updated = { ...existing, name: 'New Name', content: 'New content' }
      mockPromptRepo.findById.mockResolvedValue(existing)
      mockPromptRepo.update.mockResolvedValue(updated)

      const res = await updatePromptTemplate(
        createMockRequest(
          'http://localhost/api/v1/prompt-templates/template-1',
          { name: 'New Name', content: 'New content' },
          'PUT',
        ),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(mockPromptRepo.update).toHaveBeenCalledWith('template-1', expect.objectContaining({
        name: 'New Name',
        content: 'New content',
      }))
      expect(data.template).toEqual(updated)
    })
  })

  describe('DELETE /api/v1/prompt-templates/[id]', () => {
    it('denies deleting templates from other users', async () => {
      mockPromptRepo.findById.mockResolvedValue(buildTemplate({ userId: 'other-user', isBuiltIn: false }))

      const res = await deletePromptTemplate(
        createMockRequest('http://localhost/api/v1/prompt-templates/template-1', undefined, 'DELETE'),
        createParams('template-1') as any,
      )

      expect(res.status).toBe(403)
      expect(mockPromptRepo.delete).not.toHaveBeenCalled()
    })

    it('prevents deleting built-in templates', async () => {
      mockPromptRepo.findById.mockResolvedValue(
        buildTemplate({ id: 'template-1', userId: 'user-123', isBuiltIn: true }),
      )

      const res = await deletePromptTemplate(
        createMockRequest('http://localhost/api/v1/prompt-templates/template-1', undefined, 'DELETE'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(403)
      expect(data).toEqual({ error: 'Cannot delete built-in templates' })
      expect(mockPromptRepo.delete).not.toHaveBeenCalled()
    })

    it('deletes template successfully', async () => {
      mockPromptRepo.findById.mockResolvedValue(buildTemplate({ id: 'template-1', userId: 'user-123' }))
      mockPromptRepo.delete.mockResolvedValue(true)

      const res = await deletePromptTemplate(
        createMockRequest('http://localhost/api/v1/prompt-templates/template-1', undefined, 'DELETE'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(mockPromptRepo.delete).toHaveBeenCalledWith('template-1')
      expect(data).toEqual({ success: true })
    })
  })
})
