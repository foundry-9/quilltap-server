import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { GET as getPluginDataCollection, POST as postPluginData } from '@/app/api/v1/characters/[id]/plugin-data/route'
import {
  GET as getPluginDataItem,
  PUT as putPluginDataItem,
  DELETE as deletePluginDataItem,
} from '@/app/api/v1/characters/[id]/plugin-data/[pluginName]/route'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '@/lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks } from '@/__tests__/unit/lib/fixtures/mock-repositories'

const mockRepos = createMockRepositoryContainer()
const mockGetServerSession = jest.mocked(getServerSession)
const mockGetRepositories = jest.mocked(getRepositories)
const mockGetRepositoriesSafe = jest.mocked(getRepositoriesSafe)

type CharacterPluginDataRepo = {
  getPluginDataMap: jest.Mock
  upsert: jest.Mock
  findByCharacterAndPlugin: jest.Mock
  deleteByCharacterAndPlugin: jest.Mock
}

function createMockRequest(
  url: string,
  bodyOrOptions: unknown = {},
  method = 'GET',
) {
  const options =
    bodyOrOptions &&
    typeof bodyOrOptions === 'object' &&
    ('body' in (bodyOrOptions as Record<string, unknown>) ||
      'method' in (bodyOrOptions as Record<string, unknown>) ||
      'jsonError' in (bodyOrOptions as Record<string, unknown>))
      ? (bodyOrOptions as { body?: unknown; method?: string; jsonError?: Error })
      : { body: bodyOrOptions, method }

  return {
    url,
    method: options.method ?? 'GET',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: options.jsonError
      ? jest.fn().mockRejectedValue(options.jsonError)
      : jest.fn().mockResolvedValue(options.body ?? {}),
  } as any
}

function createParams(id: string, pluginName?: string) {
  return {
    params: Promise.resolve(pluginName ? { id, pluginName } : { id }),
  }
}

describe('Character Plugin Data API routes', () => {
  let mockCharacterPluginDataRepo: CharacterPluginDataRepo

  beforeEach(() => {
    jest.clearAllMocks()

    mockGetRepositories.mockReturnValue(mockRepos)
    mockGetRepositoriesSafe.mockResolvedValue(mockRepos)
    setupAuthMocks(mockGetServerSession as jest.Mock, mockRepos)

    mockRepos.characters.findById.mockResolvedValue({
      id: 'char-1',
      userId: 'user-123',
      name: 'Aurelia',
    } as any)

    mockCharacterPluginDataRepo = {
      getPluginDataMap: jest.fn().mockResolvedValue({}),
      upsert: jest.fn(),
      findByCharacterAndPlugin: jest.fn().mockResolvedValue(null),
      deleteByCharacterAndPlugin: jest.fn().mockResolvedValue(false),
    }

    ;(mockRepos as any).characterPluginData = mockCharacterPluginDataRepo
  })

  it('lists all plugin data entries for a character', async () => {
    mockCharacterPluginDataRepo.getPluginDataMap.mockResolvedValue({
      'qtap-plugin-lorebook': { enabled: true, slots: ['history'] },
      'qtap-plugin-voice': { voiceId: 'violet' },
    })

    const response = await getPluginDataCollection(
      createMockRequest('http://localhost/api/v1/characters/char-1/plugin-data'),
      createParams('char-1') as any,
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockCharacterPluginDataRepo.getPluginDataMap).toHaveBeenCalledWith('char-1')
    expect(data).toEqual({
      pluginData: {
        'qtap-plugin-lorebook': { enabled: true, slots: ['history'] },
        'qtap-plugin-voice': { voiceId: 'violet' },
      },
    })
  })

  it('creates or updates nested plugin JSON for the collection endpoint', async () => {
    const entry = {
      id: 'entry-1',
      characterId: 'char-1',
      pluginName: 'qtap-plugin-lorebook',
      data: {
        enabled: true,
        settings: {
          mood: 'mysterious',
          aliases: ['The Raven', 'Midnight'],
        },
      },
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z',
    }
    mockCharacterPluginDataRepo.upsert.mockResolvedValue(entry)

    const response = await postPluginData(
      createMockRequest(
        'http://localhost/api/v1/characters/char-1/plugin-data',
        {
          pluginName: 'qtap-plugin-lorebook',
          data: entry.data,
        },
        'POST',
      ),
      createParams('char-1') as any,
    )
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(mockCharacterPluginDataRepo.upsert).toHaveBeenCalledWith(
      'char-1',
      'qtap-plugin-lorebook',
      entry.data,
    )
    expect(data).toEqual({ pluginData: entry })
  })

  it('rejects invalid JSON bodies for collection upserts', async () => {
    const response = await postPluginData(
      createMockRequest('http://localhost/api/v1/characters/char-1/plugin-data', {
        method: 'POST',
        jsonError: new Error('Unexpected token'),
      }),
      createParams('char-1') as any,
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Invalid JSON body' })
    expect(mockCharacterPluginDataRepo.upsert).not.toHaveBeenCalled()
  })

  it('rejects non-serializable plugin data values', async () => {
    const response = await postPluginData(
      createMockRequest(
        'http://localhost/api/v1/characters/char-1/plugin-data',
        {
          pluginName: 'qtap-plugin-lorebook',
          data: { brokenValue: BigInt(42) },
        },
        'POST',
      ),
      createParams('char-1') as any,
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Data must be a valid JSON value' })
    expect(mockCharacterPluginDataRepo.upsert).not.toHaveBeenCalled()
  })

  it('returns 404 when a specific plugin entry is missing', async () => {
    mockCharacterPluginDataRepo.findByCharacterAndPlugin.mockResolvedValue(null)

    const response = await getPluginDataItem(
      createMockRequest('http://localhost/api/v1/characters/char-1/plugin-data/qtap-plugin-voice'),
      createParams('char-1', 'qtap-plugin-voice') as any,
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Plugin data not found' })
  })

  it('replaces a plugin entry using the route parameter plugin name', async () => {
    const entry = {
      id: 'entry-2',
      characterId: 'char-1',
      pluginName: 'qtap-plugin-voice',
      data: ['alto', 'studio-mic'],
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z',
    }
    mockCharacterPluginDataRepo.upsert.mockResolvedValue(entry)

    const response = await putPluginDataItem(
      createMockRequest(
        'http://localhost/api/v1/characters/char-1/plugin-data/qtap-plugin-voice',
        ['alto', 'studio-mic'],
        'PUT',
      ),
      createParams('char-1', 'qtap-plugin-voice') as any,
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockCharacterPluginDataRepo.upsert).toHaveBeenCalledWith(
      'char-1',
      'qtap-plugin-voice',
      ['alto', 'studio-mic'],
    )
    expect(data).toEqual({ pluginData: entry })
  })

  it('deletes a plugin entry and returns success', async () => {
    mockCharacterPluginDataRepo.deleteByCharacterAndPlugin.mockResolvedValue(true)

    const response = await deletePluginDataItem(
      createMockRequest(
        'http://localhost/api/v1/characters/char-1/plugin-data/qtap-plugin-voice',
        undefined,
        'DELETE',
      ),
      createParams('char-1', 'qtap-plugin-voice') as any,
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockCharacterPluginDataRepo.deleteByCharacterAndPlugin).toHaveBeenCalledWith(
      'char-1',
      'qtap-plugin-voice',
    )
    expect(data).toEqual({ success: true })
  })
})
