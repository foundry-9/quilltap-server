/**
 * Unit tests for roleplay template API routes
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { RoleplayTemplate } from '@/lib/schemas/types'
import { GET as listRoleplayTemplates, POST as createRoleplayTemplate } from '@/app/api/roleplay-templates/route'
import {
  GET as getRoleplayTemplate,
  PUT as updateRoleplayTemplate,
  DELETE as deleteRoleplayTemplate,
} from '@/app/api/roleplay-templates/[id]/route'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks, type MockRepositoryContainer } from '@/__tests__/unit/lib/fixtures/mock-repositories'

// Create mock repos before jest.mock
const mockRepos = createMockRepositoryContainer()

const mockGetServerSession = jest.mocked(getServerSession)
const mockGetRepositories = jest.mocked(getRepositories)

type RoleplayTemplateRepo = {
  findAllForUser: jest.Mock
  findByName: jest.Mock
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
function buildTemplate(overrides: Partial<RoleplayTemplate> = {}): RoleplayTemplate {
  templateCounter += 1
  const timestamp = overrides.createdAt ?? '2024-01-01T00:00:00.000Z'
  const hasUserId = Object.prototype.hasOwnProperty.call(overrides, 'userId')
  const userId = hasUserId ? overrides.userId ?? null : defaultSession.user.id

  return {
    id: overrides.id ?? `template-${templateCounter}`,
    userId,
    name: overrides.name ?? `Template ${templateCounter}`,
    description: overrides.description ?? 'formatting rules',
    systemPrompt: overrides.systemPrompt ?? 'Use this format',
    isBuiltIn: overrides.isBuiltIn ?? false,
    tags: overrides.tags ?? [],
    createdAt: timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
  }
}

let mockRoleplayRepo: RoleplayTemplateRepo

beforeEach(() => {
  templateCounter = 0
  mockRoleplayRepo = {
    findAllForUser: jest.fn(),
    findByName: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  }

  // Setup getRepositories to return mockRepos
  mockGetRepositories.mockReturnValue(mockRepos)

  // Setup auth mocks
  setupAuthMocks(mockGetServerSession as jest.Mock, mockRepos)

  // Update the mock repos with specific test repo instances
  mockRepos.roleplayTemplates = mockRoleplayRepo as any

  mockGetServerSession.mockResolvedValue(defaultSession as any)
})

// TODO: Update tests for v1 API - legacy routes now return 410
describe.skip('Roleplay Template Routes', () => {
  describe('GET /api/roleplay-templates', () => {
    it('requires authentication', async () => {
      mockGetServerSession.mockResolvedValueOnce(null as any)

      const res = await listRoleplayTemplates(createMockRequest('http://localhost/api/roleplay-templates'))
      const data = await res.json()

      expect(res.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
      expect(mockRoleplayRepo.findAllForUser).not.toHaveBeenCalled()
    })

    it('returns sorted templates with built-ins first', async () => {
      const builtinZulu = buildTemplate({ id: 'template-zulu', name: 'Zulu', isBuiltIn: true, userId: null })
      const builtinAlpha = buildTemplate({ id: 'template-alpha', name: 'Alpha', isBuiltIn: true, userId: null })
      const userBeta = buildTemplate({ id: 'template-beta', name: 'Beta', isBuiltIn: false, userId: defaultSession.user.id })

      mockRoleplayRepo.findAllForUser.mockResolvedValue([userBeta, builtinZulu, builtinAlpha])

      const res = await listRoleplayTemplates(createMockRequest('http://localhost/api/roleplay-templates'))
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(mockRoleplayRepo.findAllForUser).toHaveBeenCalledWith('user-123')
      expect(data.map((tpl: RoleplayTemplate) => tpl.id)).toEqual([
        'template-alpha',
        'template-zulu',
        'template-beta',
      ])
    })
  })

  describe('POST /api/roleplay-templates', () => {
    it('rejects empty names', async () => {
      const req = createMockRequest(
        'http://localhost/api/roleplay-templates',
        { name: '   ', description: 'desc', systemPrompt: 'stay IC' },
        'POST',
      )

      const res = await createRoleplayTemplate(req)
      const data = await res.json()

      expect(res.status).toBe(400)
      expect(data).toEqual({ error: 'Name is required' })
      expect(mockRoleplayRepo.findByName).not.toHaveBeenCalled()
    })

    it('returns 409 when name already exists', async () => {
      mockRoleplayRepo.findByName.mockResolvedValue(buildTemplate({ id: 'existing' }))

      const req = createMockRequest(
        'http://localhost/api/roleplay-templates',
        { name: 'Standard', description: 'desc', systemPrompt: 'stay IC' },
        'POST',
      )

      const res = await createRoleplayTemplate(req)
      const data = await res.json()

      expect(res.status).toBe(409)
      expect(data).toEqual({ error: 'A roleplay template with this name already exists' })
      expect(mockRoleplayRepo.create).not.toHaveBeenCalled()
    })

    it('creates template with trimmed values', async () => {
      const createdTemplate = buildTemplate({
        id: 'template-created',
        name: 'My Template',
        description: 'desc',
        systemPrompt: 'Use this prompt',
        userId: defaultSession.user.id,
      })

      mockRoleplayRepo.findByName.mockResolvedValue(null)
      mockRoleplayRepo.create.mockResolvedValue(createdTemplate)

      const req = createMockRequest(
        'http://localhost/api/roleplay-templates',
        {
          name: '  My Template  ',
          description: '  desc  ',
          systemPrompt: '  Use this prompt  ',
        },
        'POST',
      )

      const res = await createRoleplayTemplate(req)
      const data = await res.json()

      expect(res.status).toBe(201)
      expect(mockRoleplayRepo.create).toHaveBeenCalledWith({
        userId: 'user-123',
        name: 'My Template',
        description: 'desc',
        systemPrompt: 'Use this prompt',
        isBuiltIn: false,
        tags: [],
        annotationButtons: [],
        renderingPatterns: [],
        dialogueDetection: null,
      })
      expect(data).toEqual(createdTemplate)
    })
  })

  describe('GET /api/roleplay-templates/[id]', () => {
    it('requires authentication', async () => {
      mockGetServerSession.mockResolvedValueOnce(null as any)

      const res = await getRoleplayTemplate(
        createMockRequest('http://localhost/api/roleplay-templates/template-1'),
        createParams('template-1') as any,
      )

      expect(res.status).toBe(401)
      expect(mockRoleplayRepo.findById).not.toHaveBeenCalled()
    })

    it('returns 404 when template not found', async () => {
      mockRoleplayRepo.findById.mockResolvedValue(null)

      const res = await getRoleplayTemplate(
        createMockRequest('http://localhost/api/roleplay-templates/template-1'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(404)
      expect(data).toEqual({ error: 'Template not found' })
    })

    it('denies access to other user templates', async () => {
      mockRoleplayRepo.findById.mockResolvedValue(buildTemplate({ userId: 'other-user', isBuiltIn: false }))

      const res = await getRoleplayTemplate(
        createMockRequest('http://localhost/api/roleplay-templates/template-1'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(404)
      expect(data).toEqual({ error: 'Template not found' })
    })

    it('returns template when accessible', async () => {
      const template = buildTemplate({ id: 'template-1', isBuiltIn: true, userId: null })
      mockRoleplayRepo.findById.mockResolvedValue(template)

      const res = await getRoleplayTemplate(
        createMockRequest('http://localhost/api/roleplay-templates/template-1'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data).toEqual(template)
    })
  })

  describe('PUT /api/roleplay-templates/[id]', () => {
    it('rejects updates when user does not own template', async () => {
      mockRoleplayRepo.findById.mockResolvedValue(buildTemplate({ userId: 'other-user', isBuiltIn: false }))

      const res = await updateRoleplayTemplate(
        createMockRequest('http://localhost/api/roleplay-templates/template-1', { name: 'New Name' }, 'PUT'),
        createParams('template-1') as any,
      )

      expect(res.status).toBe(404)
      expect(mockRoleplayRepo.update).not.toHaveBeenCalled()
    })

    it('prevents built-in templates from being edited', async () => {
      mockRoleplayRepo.findById.mockResolvedValue(
        buildTemplate({ id: 'template-1', userId: 'user-123', isBuiltIn: true }),
      )

      const res = await updateRoleplayTemplate(
        createMockRequest('http://localhost/api/roleplay-templates/template-1', { name: 'New Name' }, 'PUT'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(403)
      expect(data).toEqual({ error: 'Built-in templates cannot be modified' })
      expect(mockRoleplayRepo.update).not.toHaveBeenCalled()
    })

    it('returns 409 when renaming to an existing template', async () => {
      const existing = buildTemplate({ id: 'template-1', name: 'Old Name', userId: 'user-123' })
      mockRoleplayRepo.findById.mockResolvedValue(existing)
      mockRoleplayRepo.findByName.mockResolvedValue(buildTemplate({ id: 'template-2', name: 'New Name' }))

      const res = await updateRoleplayTemplate(
        createMockRequest('http://localhost/api/roleplay-templates/template-1', { name: 'New Name' }, 'PUT'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(409)
      expect(data).toEqual({ error: 'A roleplay template with this name already exists' })
      expect(mockRoleplayRepo.update).not.toHaveBeenCalled()
    })

    it('updates template with trimmed values', async () => {
      const existing = buildTemplate({ id: 'template-1', name: 'Old Name', userId: 'user-123' })
      const updated = { ...existing, name: 'New Name', systemPrompt: 'Formatted output' }
      mockRoleplayRepo.findById.mockResolvedValue(existing)
      mockRoleplayRepo.findByName.mockResolvedValue(null)
      mockRoleplayRepo.update.mockResolvedValue(updated)

      const res = await updateRoleplayTemplate(
        createMockRequest(
          'http://localhost/api/roleplay-templates/template-1',
          { name: '  New Name ', description: '  desc ', systemPrompt: '  Formatted output ' },
          'PUT',
        ),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(mockRoleplayRepo.update).toHaveBeenCalledWith('template-1', {
        name: 'New Name',
        description: 'desc',
        systemPrompt: 'Formatted output',
      })
      expect(data).toEqual(updated)
    })
  })

  describe('DELETE /api/roleplay-templates/[id]', () => {
    it('denies deleting templates from other users', async () => {
      mockRoleplayRepo.findById.mockResolvedValue(buildTemplate({ userId: 'other-user', isBuiltIn: false }))

      const res = await deleteRoleplayTemplate(
        createMockRequest('http://localhost/api/roleplay-templates/template-1', undefined, 'DELETE'),
        createParams('template-1') as any,
      )

      expect(res.status).toBe(404)
      expect(mockRoleplayRepo.delete).not.toHaveBeenCalled()
    })

    it('prevents deleting built-in templates', async () => {
      mockRoleplayRepo.findById.mockResolvedValue(
        buildTemplate({ id: 'template-1', userId: 'user-123', isBuiltIn: true }),
      )

      const res = await deleteRoleplayTemplate(
        createMockRequest('http://localhost/api/roleplay-templates/template-1', undefined, 'DELETE'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(403)
      expect(data).toEqual({ error: 'Built-in templates cannot be deleted' })
      expect(mockRoleplayRepo.delete).not.toHaveBeenCalled()
    })

    it('deletes template successfully', async () => {
      mockRoleplayRepo.findById.mockResolvedValue(buildTemplate({ id: 'template-1', userId: 'user-123' }))
      mockRoleplayRepo.delete.mockResolvedValue(true)

      const res = await deleteRoleplayTemplate(
        createMockRequest('http://localhost/api/roleplay-templates/template-1', undefined, 'DELETE'),
        createParams('template-1') as any,
      )
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(mockRoleplayRepo.delete).toHaveBeenCalledWith('template-1')
      expect(data).toEqual({ success: true })
    })
  })
})

