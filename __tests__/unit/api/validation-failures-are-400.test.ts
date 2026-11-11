/**
 * #166: a Zod parse inside the route's own catch-all turned every validation
 * failure into a 500 "Failed to …", and hid the middleware's 503 for an
 * unavailable store. The middleware already maps a ZodError to 400; these
 * routes now let it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { z } from 'zod'
import { POST as linkProjectMount, DELETE as unlinkProjectMount } from '../../../app/api/v1/projects/[id]/mount-points/route'
import { PATCH as patchMountPoint } from '../../../app/api/v1/mount-points/[id]/route'
import { handleCloseDocument } from '../../../app/api/v1/chats/[id]/actions/documents'
import { getServerSession } from '../../../lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '../../../lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks } from '../lib/fixtures/mock-repositories'

const mockRepos = createMockRepositoryContainer() as any

function jsonRequest(url: string, method: string, body: unknown) {
  return {
    url,
    nextUrl: new URL(url),
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as any
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getRepositories).mockReturnValue(mockRepos)
  jest.mocked(getRepositoriesSafe).mockResolvedValue(mockRepos)
  setupAuthMocks(jest.mocked(getServerSession) as jest.Mock, mockRepos)
  mockRepos.projects = { findById: jest.fn(async () => ({ id: 'proj-1', userId: 'user-123' })) }
  mockRepos.docMountPoints = { findById: jest.fn(async () => ({ id: 'mp-1', name: 'Store', storeType: 'documents', mountType: 'database' })) }
  mockRepos.projectDocMountLinks = { link: jest.fn(), unlink: jest.fn() }
})

describe('validation failures are 400 (#166)', () => {
  it('POST /projects/[id]/mount-points with {} is a 400', async () => {
    const res = await linkProjectMount(jsonRequest('http://localhost/api/v1/projects/proj-1/mount-points', 'POST', {}), params('proj-1'))
    expect(res.status).toBe(400)
    expect(mockRepos.projectDocMountLinks.link).not.toHaveBeenCalled()
  })

  it('DELETE /projects/[id]/mount-points with {} is a 400', async () => {
    const res = await unlinkProjectMount(jsonRequest('http://localhost/api/v1/projects/proj-1/mount-points', 'DELETE', {}), params('proj-1'))
    expect(res.status).toBe(400)
    expect(mockRepos.projectDocMountLinks.unlink).not.toHaveBeenCalled()
  })

  it('PATCH /mount-points/[id] with a bad field is a 400', async () => {
    const res = await patchMountPoint(jsonRequest('http://localhost/api/v1/mount-points/mp-1', 'PATCH', { enabled: 'yes' }), params('mp-1'))
    expect(res.status).toBe(400)
  })

  it('close-document lets a ZodError reach the middleware', async () => {
    const ctx = { user: { id: 'user-123' }, repos: mockRepos } as any
    await expect(
      handleCloseDocument(jsonRequest('http://localhost/api/v1/chats/c1?action=close-document', 'POST', { chatDocumentId: 7 }), 'c1', ctx),
    ).rejects.toBeInstanceOf(z.ZodError)
  })
})
