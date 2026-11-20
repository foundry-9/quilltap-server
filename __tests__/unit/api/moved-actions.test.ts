/**
 * Path-segment actions moved to `?action=` (refactor 4.13 §4.6). The old
 * paths were removed in 4.14; the new actions answer, unknown ones are a 400.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

jest.mock('@/lib/startup/plugin-initialization', () => ({
  initializePlugins: jest.fn(async () => ({ success: true, warnings: [], errors: [] })),
  getPluginSystemState: jest.fn(() => ({ initialized: true })),
}))

import * as plugins from '../../../app/api/v1/system/plugins/route'
import * as directories from '../../../app/api/v1/system/directories/route'
import { getServerSession } from '../../../lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '../../../lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks } from '../lib/fixtures/mock-repositories'

const mockRepos = createMockRepositoryContainer() as any

function req(url: string, method = 'GET') {
  return { url, nextUrl: new URL(url), method, headers: new Headers(), json: async () => ({}) } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getRepositories).mockReturnValue(mockRepos)
  jest.mocked(getRepositoriesSafe).mockResolvedValue(mockRepos)
  setupAuthMocks(jest.mocked(getServerSession) as jest.Mock, mockRepos)
})

describe('system plugins', () => {
  it('?action=initialize initializes', async () => {
    const fresh = await plugins.POST(req('http://localhost/api/v1/system/plugins?action=initialize', 'POST'))
    expect(fresh.status).toBe(200)
    expect(fresh.headers.get('Deprecation')).toBeNull()
  })

  it('?action=state answers without the request context', async () => {
    const res = await plugins.GET(req('http://localhost/api/v1/system/plugins?action=state'))
    expect(res.status).toBe(200)
  })

  it('an unknown action is a 400', async () => {
    expect((await plugins.GET(req('http://localhost/api/v1/system/plugins?action=nope'))).status).toBe(400)
  })
})

describe('system directories', () => {
  it('lists a directory', async () => {
    const url = `?path=${encodeURIComponent(process.cwd())}`
    const fresh = await directories.GET(req(`http://localhost/api/v1/system/directories${url}`))
    expect(fresh.status).toBe(200)
  })
})
