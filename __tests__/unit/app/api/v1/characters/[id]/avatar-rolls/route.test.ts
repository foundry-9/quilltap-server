/** @jest-environment node */

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: any) => async (req: any, c: { params: Promise<any> }) =>
    handler(req, { user: { id: 'user-1' }, repos: { tag: 'repos' } }, await c.params),
}))

jest.mock('@/lib/photos/avatar-rolls-service', () => ({
  listAvatarRolls: jest.fn(),
}))

import { GET } from '@/app/api/v1/characters/[id]/avatar-rolls/route'
import { listAvatarRolls } from '@/lib/photos/avatar-rolls-service'
import { NextRequest } from 'next/server'

const list = listAvatarRolls as jest.Mock

function call(qs = '', id = 'char-1') {
  return GET(new NextRequest(`http://localhost/api/v1/characters/${id}/avatar-rolls${qs}`), {
    params: Promise.resolve({ id }),
  })
}

beforeEach(() => jest.clearAllMocks())

describe('GET avatar-rolls', () => {
  it('lists rolls and forwards repos', async () => {
    list.mockResolvedValue({ entries: [{ id: 'f1' }], total: 1 })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ entries: [{ id: 'f1' }], total: 1 })
    expect(list).toHaveBeenCalledWith({
      characterId: 'char-1',
      limit: undefined,
      offset: undefined,
      repos: { tag: 'repos' },
    })
  })

  it('passes limit and offset as numbers', async () => {
    list.mockResolvedValue({ entries: [], total: 0 })
    await call('?limit=10&offset=20')
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 20 }))
  })

  it.each(['?limit=0', '?limit=201', '?limit=abc', '?offset=-1', '?limit=1.5'])('rejects %s with 400', async (qs) => {
    const res = await call(qs)
    expect(res.status).toBe(400)
    expect(list).not.toHaveBeenCalled()
  })

  it('400 on empty id', async () => {
    const res = await call('', '')
    expect(res.status).toBe(400)
  })

  it('404 when the service reports Character not found', async () => {
    list.mockRejectedValue(new Error('Character not found: x'))
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('500 on any other error', async () => {
    list.mockRejectedValue(new Error('boom'))
    const res = await call()
    expect(res.status).toBe(500)
  })

  it('500 on a non-Error rejection', async () => {
    list.mockRejectedValue('weird')
    const res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to list avatar rolls')
  })
})
