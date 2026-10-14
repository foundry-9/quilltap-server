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
jest.mock('@/lib/subprompts/chat-fanout', () => ({ fanOutSubpromptChange: jest.fn() }))
jest.mock('@/lib/subprompts/subprompts', () => ({
  ...jest.requireActual('@/lib/subprompts/subprompts'),
  readCharacterSubprompt: jest.fn(),
  updateCharacterSubprompt: jest.fn(),
  deleteCharacterSubprompt: jest.fn(),
}))

import { GET, PUT, DELETE } from '@/app/api/v1/characters/[id]/subprompts/[subpromptId]/route'
import {
  readCharacterSubprompt,
  updateCharacterSubprompt,
  deleteCharacterSubprompt,
  SubpromptNotFoundError,
  SubpromptValidationError,
} from '@/lib/subprompts/subprompts'
import { fanOutSubpromptChange } from '@/lib/subprompts/chat-fanout'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'
import { publishRealtime } from '@/lib/realtime/bus'
import { NextRequest } from 'next/server'

const read = readCharacterSubprompt as jest.Mock
const update = updateCharacterSubprompt as jest.Mock
const del = deleteCharacterSubprompt as jest.Mock
const fanout = fanOutSubpromptChange as jest.Mock

const p = (subpromptId = 'sp1') => ({ params: Promise.resolve({ id: 'c1', subpromptId }) })
const mk = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/v1/characters/c1/subprompts/sp1', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  jest.clearAllMocks()
  mockFindByIdRaw.mockResolvedValue({ id: 'c1' })
  fanout.mockResolvedValue({ chatsRecompiled: 2 })
})

describe('GET', () => {
  it('reads', async () => {
    read.mockResolvedValue({ id: 'sp1' })
    const res = await GET(mk('GET'), p())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ subprompt: { id: 'sp1' } })
  })
  it('400 on invalid id', async () => {
    expect((await GET(mk('GET'), p('..'))).status).toBe(400)
    expect(read).not.toHaveBeenCalled()
  })
  it('404 for missing character', async () => {
    mockFindByIdRaw.mockResolvedValue(null)
    expect((await GET(mk('GET'), p())).status).toBe(404)
  })
  it('404 for missing subprompt', async () => {
    read.mockResolvedValue(null)
    expect((await GET(mk('GET'), p())).status).toBe(404)
  })
  it('500 on read failure', async () => {
    read.mockRejectedValue(new Error('x'))
    expect((await GET(mk('GET'), p())).status).toBe(500)
  })
})

describe('PUT', () => {
  it('updates, fans out and publishes', async () => {
    update.mockResolvedValue({ id: 'sp1', title: 'N' })
    const res = await PUT(mk('PUT', { title: 'N' }), p())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ subprompt: { id: 'sp1', title: 'N' } })
    expect(update).toHaveBeenCalledWith('c1', 'sp1', { title: 'N' })
    expect(fanout).toHaveBeenCalledWith('c1', 'sp1')
    expect(publishRealtime).toHaveBeenCalledWith('characters', 'c1')
  })
  it.each([[{ title: '' }], [{ content: '' }], [{ title: 'x'.repeat(101) }]])('400 on invalid body %j', async (b) => {
    expect((await PUT(mk('PUT', b), p())).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
  it('400 on invalid id', async () => {
    expect((await PUT(mk('PUT', { title: 'N' }), p('a/b'))).status).toBe(400)
  })
  it('404 for missing character', async () => {
    mockFindByIdRaw.mockResolvedValue(null)
    expect((await PUT(mk('PUT', { title: 'N' }), p())).status).toBe(404)
  })
  it('404 for missing subprompt', async () => {
    update.mockRejectedValue(new SubpromptNotFoundError('c1', 'sp1'))
    expect((await PUT(mk('PUT', { title: 'N' }), p())).status).toBe(404)
    expect(fanout).not.toHaveBeenCalled()
  })
  it('409 for an archived character, with no fanout or hint', async () => {
    update.mockRejectedValue(new CharacterArchivedError('c1', 'update'))
    expect((await PUT(mk('PUT', { title: 'N' }), p())).status).toBe(409)
    expect(fanout).not.toHaveBeenCalled()
    expect(publishRealtime).not.toHaveBeenCalled()
  })
  it('400 on service validation error', async () => {
    update.mockRejectedValue(new SubpromptValidationError('bad'))
    expect((await PUT(mk('PUT', { title: 'N' }), p())).status).toBe(400)
  })
  it('500 on other errors', async () => {
    update.mockRejectedValue(new Error('x'))
    expect((await PUT(mk('PUT', { title: 'N' }), p())).status).toBe(500)
  })
})

describe('DELETE', () => {
  it('deletes, strikes selection and publishes', async () => {
    del.mockResolvedValue(true)
    const res = await DELETE(mk('DELETE'), p())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(fanout).toHaveBeenCalledWith('c1', 'sp1', { removeSelection: true })
    expect(publishRealtime).toHaveBeenCalledWith('characters', 'c1')
  })
  it('400 on invalid id', async () => {
    expect((await DELETE(mk('DELETE'), p('..'))).status).toBe(400)
  })
  it('404 for missing character', async () => {
    mockFindByIdRaw.mockResolvedValue(null)
    expect((await DELETE(mk('DELETE'), p())).status).toBe(404)
  })
  it('404 when nothing was deleted', async () => {
    del.mockResolvedValue(false)
    expect((await DELETE(mk('DELETE'), p())).status).toBe(404)
    expect(fanout).not.toHaveBeenCalled()
  })
  it('409 for an archived character', async () => {
    del.mockRejectedValue(new CharacterArchivedError('c1', 'update'))
    expect((await DELETE(mk('DELETE'), p())).status).toBe(409)
    expect(publishRealtime).not.toHaveBeenCalled()
  })
  it('500 on other errors', async () => {
    del.mockRejectedValue(new Error('x'))
    expect((await DELETE(mk('DELETE'), p())).status).toBe(500)
  })
})
