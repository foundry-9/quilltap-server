/**
 * Unit tests for tools API route
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { GET as listTools } from '../../app/api/v1/tools/route'
import { getServerSession } from '../../lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '../../lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks } from './lib/fixtures/mock-repositories'

const mockGetConfiguredToolDefinitions = jest.fn()
const mockGetAllPluginMetadata = jest.fn()
const mockGetAllPlugins = jest.fn()

jest.mock('../../lib/plugins/tool-registry', () => ({
  toolRegistry: {
    getConfiguredToolDefinitions: mockGetConfiguredToolDefinitions,
    getAllPluginMetadata: mockGetAllPluginMetadata,
    getAllPlugins: mockGetAllPlugins,
  },
}))

const mockRepos = createMockRepositoryContainer()

const mockGetServerSession = jest.mocked(getServerSession)
const mockGetRepositories = jest.mocked(getRepositories)
const mockGetRepositoriesSafe = jest.mocked(getRepositoriesSafe)

function createMockRequest(url: string) {
  const nextUrl = new URL(url)
  return {
    url: nextUrl.toString(),
    nextUrl,
    method: 'GET',
    headers: new Headers(),
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()

  mockGetRepositories.mockReturnValue(mockRepos as any)
  mockGetRepositoriesSafe.mockResolvedValue(mockRepos as any)

  setupAuthMocks(mockGetServerSession as jest.Mock, mockRepos)

  mockRepos.pluginConfigs.findByUserId.mockResolvedValue([] as any)

  mockGetConfiguredToolDefinitions.mockResolvedValue([])
  mockGetAllPluginMetadata.mockReturnValue([])
  mockGetAllPlugins.mockReturnValue([])
})

describe('GET /api/v1/tools', () => {
  it('returns built-in tools successfully', async () => {
    const res = await listTools(createMockRequest('http://localhost/api/v1/tools'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.tools).toBeInstanceOf(Array)
    expect(data.tools.length).toBeGreaterThan(0)
    expect(data.count).toBe(data.tools.length)

    // Check we got built-in tools
    const toolIds = data.tools.map((tool: any) => tool.id)
    expect(toolIds).toContain('generate_image')
    expect(toolIds).toContain('search')
    expect(toolIds).toContain('search_web')
    expect(toolIds).toContain('project_info')
    expect(toolIds).toContain('help_search')
    expect(toolIds).toContain('help_settings')

    // request_full_context should never be in user-facing tool list
    expect(toolIds).not.toContain('request_full_context')
    expect(toolIds).not.toContain('search_memories')
  })

  it('returns schema for the unified search tool and not the removed legacy tool', async () => {
    const res = await listTools(createMockRequest('http://localhost/api/v1/tools?includeSchemas=true'))
    const data = await res.json()

    expect(res.status).toBe(200)

    const searchTool = data.tools.find((tool: any) => tool.id === 'search')
    expect(searchTool).toBeDefined()
    expect(searchTool.parameters).toMatchObject({
      required: ['query'],
      properties: expect.objectContaining({
        query: expect.objectContaining({ type: 'string' }),
        sources: expect.objectContaining({ type: 'array' }),
      }),
    })

    expect(data.tools.find((tool: any) => tool.id === 'search_memories')).toBeUndefined()
  })

  it('flags unavailable tools based on chat context', async () => {
    mockRepos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      userId: 'user-123',
      projectId: null,
      participants: [
        {
          id: 'participant-1',
          type: 'CHARACTER',
          isActive: true,
          imageProfileId: null,
          connectionProfileId: 'conn-1',
        },
      ],
    })

    mockRepos.connections.findById.mockResolvedValue({
      id: 'conn-1',
      allowWebSearch: false,
    })

    const res = await listTools(createMockRequest('http://localhost/api/v1/tools?chatId=chat-1'))
    const data = await res.json()

    const generateImage = data.tools.find((tool: any) => tool.id === 'generate_image')
    const projectInfo = data.tools.find((tool: any) => tool.id === 'project_info')
    const searchWeb = data.tools.find((tool: any) => tool.id === 'search_web')

    expect(generateImage.available).toBe(false)
    expect(generateImage.unavailableReason).toContain('image generation profile')

    expect(projectInfo.available).toBe(false)
    expect(projectInfo.unavailableReason).toContain('project')

    expect(searchWeb.available).toBe(false)
    expect(searchWeb.unavailableReason).toContain('Web search')
  })
})
