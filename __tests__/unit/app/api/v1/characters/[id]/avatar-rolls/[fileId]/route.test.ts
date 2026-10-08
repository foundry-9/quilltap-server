/** @jest-environment node */

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: any) => async (req: any, c: { params: Promise<any> }) =>
    handler(req, { user: { id: 'user-1' }, repos: { tag: 'repos' } }, await c.params),
}))

jest.mock('@/lib/photos/avatar-rolls-service', () => ({
  saveAvatarRollToAlbum: jest.fn(),
  setAvatarRollAsPortrait: jest.fn(),
  deleteAvatarRoll: jest.fn(),
}))

import { POST, DELETE } from '@/app/api/v1/characters/[id]/avatar-rolls/[fileId]/route'
import {
  saveAvatarRollToAlbum,
  setAvatarRollAsPortrait,
  deleteAvatarRoll,
} from '@/lib/photos/avatar-rolls-service'
import { NextRequest } from 'next/server'

const save = saveAvatarRollToAlbum as jest.Mock
const setAv = setAvatarRollAsPortrait as jest.Mock
const del = deleteAvatarRoll as jest.Mock

function url(qs = '') {
  return `http://localhost/api/v1/characters/c1/avatar-rolls/f1${qs}`
}
function post(qs = '', params = { id: 'c1', fileId: 'f1' }) {
  return POST(new NextRequest(url(qs), { method: 'POST' }), { params: Promise.resolve(params) })
}
function remove(params = { id: 'c1', fileId: 'f1' }) {
  return DELETE(new NextRequest(url(), { method: 'DELETE' }), { params: Promise.resolve(params) })
}

beforeEach(() => jest.clearAllMocks())

describe('POST ?action=save-to-album', () => {
  it('happy path', async () => {
    save.mockResolvedValue({ saved: true })
    const res = await post('?action=save-to-album')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ saved: true })
    expect(save).toHaveBeenCalledWith({ characterId: 'c1', fileId: 'f1', repos: { tag: 'repos' } })
    expect(setAv).not.toHaveBeenCalled()
  })

  it.each([
    ['Character not found: c1', 404],
    ['Avatar roll not found: f1', 404],
    ['Character has no linked database-backed vault', 400],
    ['File is not an image', 400],
    ['File has empty bytes', 400],
    ['Photo already in the album', 400],
    ['disk exploded', 500],
  ])('maps "%s" to %i', async (message, status) => {
    save.mockRejectedValue(new Error(message))
    const res = await post('?action=save-to-album')
    expect(res.status).toBe(status)
  })

  it('500 with the fallback message on a non-Error rejection', async () => {
    save.mockRejectedValue('nope')
    const res = await post('?action=save-to-album')
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to save the roll to the album')
  })
})

describe('POST ?action=set-avatar', () => {
  it('happy path', async () => {
    setAv.mockResolvedValue({ avatarSet: true })
    const res = await post('?action=set-avatar')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ avatarSet: true })
    expect(setAv).toHaveBeenCalledWith({ characterId: 'c1', fileId: 'f1', repos: { tag: 'repos' } })
  })

  it('404 for an unknown roll', async () => {
    setAv.mockRejectedValue(new Error('Avatar roll not found'))
    expect((await post('?action=set-avatar')).status).toBe(404)
  })

  it('404 for an unknown character', async () => {
    setAv.mockRejectedValue(new Error('Character not found'))
    expect((await post('?action=set-avatar')).status).toBe(404)
  })

  it('500 with fallback message on a non-Error rejection', async () => {
    setAv.mockRejectedValue(42)
    const res = await post('?action=set-avatar')
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed to set the roll as the portrait')
  })
})

describe('POST action dispatch', () => {
  it('unknown action is 400 and calls nothing', async () => {
    const res = await post('?action=bogus')
    expect(res.status).toBe(400)
    expect((await res.json()).availableActions).toEqual(['save-to-album', 'set-avatar'])
    expect(save).not.toHaveBeenCalled()
    expect(setAv).not.toHaveBeenCalled()
  })

  it('missing action is 400', async () => {
    const res = await post()
    expect(res.status).toBe(400)
  })
})

describe('DELETE', () => {
  it('deletes the roll', async () => {
    del.mockResolvedValue({ deleted: true })
    const res = await remove()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true })
    expect(del).toHaveBeenCalledWith({ characterId: 'c1', fileId: 'f1', repos: { tag: 'repos' } })
  })

  it('404 when nothing was deleted', async () => {
    del.mockResolvedValue({ deleted: false })
    expect((await remove()).status).toBe(404)
  })

  it('400 on missing ids', async () => {
    expect((await remove({ id: '', fileId: 'f1' })).status).toBe(400)
    expect((await remove({ id: 'c1', fileId: '' })).status).toBe(400)
    expect(del).not.toHaveBeenCalled()
  })

  it('404 for unknown character', async () => {
    del.mockRejectedValue(new Error('Character not found'))
    expect((await remove()).status).toBe(404)
  })

  it('500 on unexpected error', async () => {
    del.mockRejectedValue(new Error('boom'))
    expect((await remove()).status).toBe(500)
  })
})
