/** @jest-environment node */

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

const mockFindByIdRaw = jest.fn()
jest.mock('@/lib/api/middleware', () => {
  const { z } = require('zod')
  const { validationError, serverError } = require('@/lib/api/responses')
  return {
    exists: (e: unknown) => e != null,
    createContextParamsHandler: (handler: any) => async (req: any, c: { params: Promise<any> }) => {
      try {
        return await handler(
          req,
          { user: { id: 'user-1' }, repos: { characters: { findByIdRaw: mockFindByIdRaw } } },
          await c.params,
        )
      } catch (e) {
        if (e instanceof z.ZodError) return validationError(e)
        return serverError('unhandled')
      }
    },
  }
})

jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))

jest.mock('@/lib/subprompts/subprompts', () => ({
  ...jest.requireActual('@/lib/subprompts/subprompts'),
  listCharacterSubprompts: jest.fn(),
  createCharacterSubprompt: jest.fn(),
}))

import { GET, POST } from '@/app/api/v1/characters/[id]/subprompts/route'
import { listCharacterSubprompts, createCharacterSubprompt, SubpromptValidationError } from '@/lib/subprompts/subprompts'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'
import { publishRealtime } from '@/lib/realtime/bus'
import { NextRequest } from 'next/server'

const list = listCharacterSubprompts as jest.Mock
const create = createCharacterSubprompt as jest.Mock

const ctx = { params: Promise.resolve({ id: 'c1' }) }
function get() {
  return GET(new NextRequest('http://localhost/api/v1/characters/c1/subprompts'), ctx)
}
function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/v1/characters/c1/subprompts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    ctx,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindByIdRaw.mockResolvedValue({ id: 'c1' })
})

describe('GET subprompts', () => {
  it('lists', async () => {
    list.mockResolvedValue([{ id: 'a' }])
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ subprompts: [{ id: 'a' }] })
    expect(list).toHaveBeenCalledWith('c1')
  })

  it('404 for a missing character', async () => {
    mockFindByIdRaw.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
    expect(list).not.toHaveBeenCalled()
  })

  it('500 when listing fails', async () => {
    list.mockRejectedValue(new Error('x'))
    expect((await get()).status).toBe(500)
  })
})

describe('POST subprompts', () => {
  it('creates and publishes a realtime hint', async () => {
    create.mockResolvedValue({ id: 'new', title: 'T' })
    const res = await post({ title: 'T', content: 'C' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ subprompt: { id: 'new', title: 'T' } })
    expect(create).toHaveBeenCalledWith('c1', { title: 'T', content: 'C' })
    expect(publishRealtime).toHaveBeenCalledWith('characters', 'c1')
  })

  it.each([
    [{}],
    [{ title: '', content: 'C' }],
    [{ title: 'T', content: '' }],
    [{ title: 'x'.repeat(101), content: 'C' }],
    [{ title: 'T' }],
  ])('400 on invalid body %j', async (body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('404 for a missing character', async () => {
    mockFindByIdRaw.mockResolvedValue(null)
    expect((await post({ title: 'T', content: 'C' })).status).toBe(404)
    expect(create).not.toHaveBeenCalled()
  })

  it('409 and no realtime hint for an archived character', async () => {
    create.mockRejectedValue(new CharacterArchivedError('c1', 'update'))
    const res = await post({ title: 'T', content: 'C' })
    expect(res.status).toBe(409)
    expect(publishRealtime).not.toHaveBeenCalled()
  })

  it('400 on a service validation error', async () => {
    create.mockRejectedValue(new SubpromptValidationError('bad title'))
    const res = await post({ title: 'T', content: 'C' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('bad title')
  })

  it('500 on other errors', async () => {
    create.mockRejectedValue(new Error('x'))
    expect((await post({ title: 'T', content: 'C' })).status).toBe(500)
  })
})
