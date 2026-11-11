/**
 * Projects and groups link document stores through one route
 * (`createOwnerMountLinkRoutes`). The two copies it replaced disagreed on
 * error handling (#166), the GET payload and logging; unlink now takes
 * `?mountPointId=` instead of a DELETE body (still read for one release).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import * as projectRoute from '../../../app/api/v1/projects/[id]/mount-points/route'
import * as groupRoute from '../../../app/api/v1/groups/[id]/mount-points/route'
import { getServerSession } from '../../../lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '../../../lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks } from '../lib/fixtures/mock-repositories'

const mockRepos = createMockRepositoryContainer() as any

function req(url: string, method: string, body?: unknown) {
  return {
    url, nextUrl: new URL(url), method, headers: new Headers(),
    json: async () => { if (body === undefined) throw new SyntaxError('no body'); return body },
  } as any
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

function linkRepo(ownerKey: 'projectId' | 'groupId') {
  return {
    [ownerKey === 'projectId' ? 'findByProjectId' : 'findByGroupId']: jest.fn(async () => [{ mountPointId: 'mp-1' }, { mountPointId: 'gone' }]),
    link: jest.fn(async () => ({ id: 'link-1' })),
    unlink: jest.fn(async (_o: string, mp: string) => mp === 'mp-1'),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getRepositories).mockReturnValue(mockRepos)
  jest.mocked(getRepositoriesSafe).mockResolvedValue(mockRepos)
  setupAuthMocks(jest.mocked(getServerSession) as jest.Mock, mockRepos)
  mockRepos.projects = { findById: jest.fn(async (id: string) => (id === 'p1' ? { id, officialMountPointId: 'own-p' } : null)) }
  mockRepos.groups = { findById: jest.fn(async (id: string) => (id === 'g1' ? { id, officialMountPointId: 'own-g' } : null)) }
  mockRepos.docMountPoints = { findById: jest.fn(async (id: string) => (id === 'mp-1' ? { id, name: 'Store' } : null)) }
  mockRepos.projectDocMountLinks = linkRepo('projectId')
  mockRepos.groupDocMountLinks = linkRepo('groupId')
})

describe.each([
  ['projects', projectRoute, 'p1', 'own-p', () => mockRepos.projectDocMountLinks],
  ['groups', groupRoute, 'g1', 'own-g', () => mockRepos.groupDocMountLinks],
] as const)('/api/v1/%s/[id]/mount-points', (kind, route, ownerId, official, links) => {
  const base = `http://localhost/api/v1/${kind}/${ownerId}/mount-points`

  it('GET lists live linked stores and the owner\'s own store', async () => {
    const res = await route.GET(req(base, 'GET'), params(ownerId))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mountPoints: [{ id: 'mp-1', name: 'Store' }], officialMountPointId: official })
  })

  it('GET 404s an unknown owner', async () => {
    expect((await route.GET(req(base, 'GET'), params('nope'))).status).toBe(404)
  })

  it('POST links and answers 201', async () => {
    const res = await route.POST(req(base, 'POST', { mountPointId: 'mp-1' }), params(ownerId))
    expect(res.status).toBe(201)
    expect(links().link).toHaveBeenCalledWith(ownerId, 'mp-1')
  })

  it('POST with {} is a 400', async () => {
    expect((await route.POST(req(base, 'POST', {}), params(ownerId))).status).toBe(400)
  })

  it('DELETE unlinks by ?mountPointId=', async () => {
    const res = await route.DELETE(req(`${base}?mountPointId=mp-1`, 'DELETE'), params(ownerId))
    expect(res.status).toBe(200)
    expect(links().unlink).toHaveBeenCalledWith(ownerId, 'mp-1')
  })

  it('DELETE still reads the old JSON body', async () => {
    const res = await route.DELETE(req(base, 'DELETE', { mountPointId: 'mp-1' }), params(ownerId))
    expect(res.status).toBe(200)
  })

  it('DELETE with no target is a 400; with no such link, a 400', async () => {
    expect((await route.DELETE(req(base, 'DELETE'), params(ownerId))).status).toBe(400)
    expect((await route.DELETE(req(`${base}?mountPointId=`, 'DELETE'), params(ownerId))).status).toBe(400)
    expect((await route.DELETE(req(`${base}?mountPointId=other`, 'DELETE'), params(ownerId))).status).toBe(400)
  })
})
