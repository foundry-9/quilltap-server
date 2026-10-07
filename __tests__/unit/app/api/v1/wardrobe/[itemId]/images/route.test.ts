/**
 * @jest-environment node
 */
/**
 * Wardrobe item images route (app/api/v1/wardrobe/[itemId]/images/route.ts).
 *
 * The node environment gives real Request / FormData / File, so the upload
 * path parses a genuine multipart body. The item-images and generation
 * modules are mocked; the error classes the route maps are declared in those
 * mocks and thrown from them, so `instanceof` sees the same constructors.
 */

let mockCtx: any

jest.mock('@/lib/logger', () => {
  const base: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  base.child = jest.fn(() => base)
  return { logger: base }
})

jest.mock('@/lib/api/middleware', () => {
  const actions = jest.requireActual('@/lib/api/middleware/actions')
  return {
    createContextParamsHandler: (handler: (req: any, ctx: any, params: any) => Promise<any>) =>
      async (req: any, routeCtx: any) => handler(req, mockCtx, await routeCtx.params),
    withActionDispatch: actions.withActionDispatch,
  }
})

jest.mock('@/lib/background-jobs/activity-registry', () => ({
  trackActivity: jest.fn((_kind: string, fn: () => Promise<unknown>) => fn()),
}))

jest.mock('@/lib/database/repositories/characters.repository', () => ({
  CharacterArchivedError: class CharacterArchivedError extends Error {
    constructor(id: string) {
      super(`Character ${id} is archived`)
      this.name = 'CharacterArchivedError'
    }
  },
}))

jest.mock('@/lib/files/webp-conversion', () => ({
  convertToWebP: jest.fn(async (buffer: Buffer) => ({ buffer, mimeType: 'image/webp', width: 10, height: 10 })),
}))

jest.mock('@/lib/wardrobe/item-images', () => ({
  ForeignWardrobeImageError: class ForeignWardrobeImageError extends Error {},
  addWardrobeItemImage: jest.fn(),
  deleteWardrobeItemImage: jest.fn(),
  listWardrobeItemImages: jest.fn(),
  resolveWardrobeItemHome: jest.fn(),
  setCurrentWardrobeItemImage: jest.fn(),
  toWardrobeImageSummary: (f: { id: string }) => ({ fileId: f.id, url: `/api/v1/files/${f.id}` }),
}))

jest.mock('@/lib/wardrobe/item-image-generation', () => ({
  NoWardrobeImageProfileError: class NoWardrobeImageProfileError extends Error {},
  WardrobeImageGenerationError: class WardrobeImageGenerationError extends Error {
    constructor(message: string, readonly trail: unknown, readonly refused: boolean) {
      super(message)
    }
  },
  generateWardrobeItemImage: jest.fn(),
}))

import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/v1/wardrobe/[itemId]/images/route'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'
import {
  ForeignWardrobeImageError,
  addWardrobeItemImage,
  deleteWardrobeItemImage,
  listWardrobeItemImages,
  resolveWardrobeItemHome,
  setCurrentWardrobeItemImage,
} from '@/lib/wardrobe/item-images'
import {
  NoWardrobeImageProfileError,
  WardrobeImageGenerationError,
  generateWardrobeItemImage,
} from '@/lib/wardrobe/item-image-generation'

const mockResolveHome = resolveWardrobeItemHome as jest.Mock
const mockList = listWardrobeItemImages as jest.Mock
const mockAdd = addWardrobeItemImage as jest.Mock
const mockSetCurrent = setCurrentWardrobeItemImage as jest.Mock
const mockDelete = deleteWardrobeItemImage as jest.Mock
const mockGenerate = generateWardrobeItemImage as jest.Mock

const ITEM_ID = 'item-1'
const BASE = `http://localhost:3000/api/v1/wardrobe/${ITEM_ID}/images`
const routeCtx = { params: Promise.resolve({ itemId: ITEM_ID }) }

const home = {
  scope: 'character',
  characterId: 'char-1',
  item: { id: ITEM_ID, title: 'Opera coat', imageFileId: 'file-b' },
  containerItems: [],
  resolveMount: jest.fn(),
  update: jest.fn(),
}

function jsonPost(query: string, body: unknown): NextRequest {
  return new NextRequest(`${BASE}?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// The multipart body is handed over already parsed (a real FormData holding a
// real File), the way the other upload route tests do: the request plumbing
// under test is the route's, not the runtime's multipart parser.
function uploadPost(query: string, file: File): NextRequest {
  const form = new FormData()
  form.append('file', file)
  return {
    method: 'POST',
    url: `${BASE}?${query}`,
    nextUrl: new URL(`${BASE}?${query}`),
    formData: async () => form,
  } as unknown as NextRequest
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCtx = {
    user: { id: 'user-1' },
    repos: { files: { findById: jest.fn(async (id: string) => ({ id })) } },
  }
  mockResolveHome.mockResolvedValue(home)
  mockList.mockResolvedValue([{ id: 'file-b' }, { id: 'file-a' }])
})

describe('GET', () => {
  it('lists the pictures and the current one', async () => {
    const res = await GET(new NextRequest(`${BASE}?scope=character&id=char-1`), routeCtx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.current).toBe('file-b')
    expect(body.images.map((i: { fileId: string }) => i.fileId)).toEqual(['file-b', 'file-a'])
    expect(mockResolveHome).toHaveBeenCalledWith(mockCtx.repos, 'user-1', 'character', 'char-1', ITEM_ID)
  })

  it('404s for an item not in the named container', async () => {
    mockResolveHome.mockResolvedValue(null)
    const res = await GET(new NextRequest(`${BASE}?scope=project&id=proj-1`), routeCtx)
    expect(res.status).toBe(404)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('400s when a non-general scope has no id', async () => {
    const res = await GET(new NextRequest(`${BASE}?scope=character`), routeCtx)
    expect(res.status).toBe(400)
    expect(mockResolveHome).not.toHaveBeenCalled()
  })
})

describe('POST', () => {
  it('400s on a bare POST without an action', async () => {
    const res = await POST(jsonPost('scope=character&id=char-1', {}), routeCtx)
    expect(res.status).toBe(400)
    expect(mockResolveHome).not.toHaveBeenCalled()
  })

  it('400s on an unknown action', async () => {
    const res = await POST(jsonPost('action=destroy&scope=character&id=char-1', {}), routeCtx)
    expect(res.status).toBe(400)
  })

  it('404s for an item not in the named container', async () => {
    mockResolveHome.mockResolvedValue(null)
    const res = await POST(jsonPost('action=set-current&scope=group&id=group-1', { fileId: 'file-a' }), routeCtx)
    expect(res.status).toBe(404)
    expect(mockSetCurrent).not.toHaveBeenCalled()
  })

  describe('set-current', () => {
    it('sets one of the item\'s own pictures', async () => {
      mockSetCurrent.mockResolvedValue('file-a')
      const res = await POST(jsonPost('action=set-current&scope=character&id=char-1', { fileId: 'file-a' }), routeCtx)
      expect(res.status).toBe(200)
      expect((await res.json()).current).toBe('file-a')
      expect(mockSetCurrent).toHaveBeenCalledWith(mockCtx.repos, home, 'file-a')
    })

    it('400s for a foreign file', async () => {
      mockSetCurrent.mockRejectedValue(new ForeignWardrobeImageError('nope'))
      const res = await POST(jsonPost('action=set-current&scope=character&id=char-1', { fileId: 'file-x' }), routeCtx)
      expect(res.status).toBe(400)
    })

    it('400s without a fileId', async () => {
      const res = await POST(jsonPost('action=set-current&scope=character&id=char-1', {}), routeCtx)
      expect(res.status).toBe(400)
      expect(mockSetCurrent).not.toHaveBeenCalled()
    })

    it('409s for an archived character', async () => {
      mockSetCurrent.mockRejectedValue(new CharacterArchivedError('char-1'))
      const res = await POST(jsonPost('action=set-current&scope=character&id=char-1', { fileId: 'file-a' }), routeCtx)
      expect(res.status).toBe(409)
    })
  })

  describe('delete-image', () => {
    it('answers the promoted current picture', async () => {
      mockDelete.mockResolvedValue('file-a')
      const res = await POST(jsonPost('action=delete-image&scope=character&id=char-1', { fileId: 'file-b' }), routeCtx)
      expect(res.status).toBe(200)
      expect((await res.json()).current).toBe('file-a')
      expect(mockDelete).toHaveBeenCalledWith(mockCtx.repos, home, 'file-b')
    })

    it('409s for an archived character', async () => {
      mockDelete.mockRejectedValue(new CharacterArchivedError('char-1'))
      const res = await POST(jsonPost('action=delete-image&scope=character&id=char-1', { fileId: 'file-b' }), routeCtx)
      expect(res.status).toBe(409)
    })
  })

  describe('upload', () => {
    it('stores a small image and answers 201', async () => {
      mockAdd.mockResolvedValue({ file: { id: 'file-new', size: 4 }, item: null })
      const file = new File([new Uint8Array(1024)], 'coat.png', { type: 'image/png' })
      const res = await POST(uploadPost('action=upload&scope=character&id=char-1', file), routeCtx)
      expect(res.status).toBe(201)
      expect((await res.json()).current).toBe('file-new')
      expect(mockAdd).toHaveBeenCalledWith(mockCtx.repos, home, expect.objectContaining({ kind: 'uploaded', contentType: 'image/webp' }))
    })

    it('rejects an 11 MB file with 400, writing nothing', async () => {
      const file = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.png', { type: 'image/png' })
      const res = await POST(uploadPost('action=upload&scope=character&id=char-1', file), routeCtx)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/size/i)
      expect(mockAdd).not.toHaveBeenCalled()
    })

    it('rejects a non-image with 400', async () => {
      const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
      const res = await POST(uploadPost('action=upload&scope=character&id=char-1', file), routeCtx)
      expect(res.status).toBe(400)
      expect(mockAdd).not.toHaveBeenCalled()
    })

    it('409s for an archived character', async () => {
      mockAdd.mockRejectedValue(new CharacterArchivedError('char-1'))
      const file = new File([new Uint8Array(16)], 'coat.png', { type: 'image/png' })
      const res = await POST(uploadPost('action=upload&scope=character&id=char-1', file), routeCtx)
      expect(res.status).toBe(409)
    })
  })

  describe('generate', () => {
    it('answers 201 with the reroute report', async () => {
      mockGenerate.mockResolvedValue({
        fileId: 'file-gen',
        url: '/api/v1/files/file-gen',
        prompt: 'the prompt',
        subject: 'worn',
        profile: { id: 'p2', name: 'Understudy' },
        rerouted: true,
        trail: [{ outcome: 'refused' }, { outcome: 'answered' }],
        item: null,
      })
      const res = await POST(jsonPost('action=generate&scope=character&id=char-1', { imageProfileId: 'p1' }), routeCtx)
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body).toMatchObject({ current: 'file-gen', rerouted: true, profile: { id: 'p2' }, prompt: 'the prompt' })
      expect(mockGenerate).toHaveBeenCalledWith(mockCtx.repos, {
        userId: 'user-1',
        home,
        containerId: 'char-1',
        imageProfileId: 'p1',
      })
    })

    it('400s when no image profile is configured', async () => {
      mockGenerate.mockRejectedValue(new NoWardrobeImageProfileError('No image profile is configured'))
      const res = await POST(jsonPost('action=generate&scope=general', {}), routeCtx)
      expect(res.status).toBe(400)
    })

    it('422s with the trail on a refusal', async () => {
      const trail = [{ outcome: 'refused' }]
      mockGenerate.mockRejectedValue(new (WardrobeImageGenerationError as any)('declined', trail, true))
      const res = await POST(jsonPost('action=generate&scope=character&id=char-1', {}), routeCtx)
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.details).toEqual({ trail, refused: true })
    })

    it('409s for an archived character', async () => {
      mockGenerate.mockRejectedValue(new CharacterArchivedError('char-1'))
      const res = await POST(jsonPost('action=generate&scope=character&id=char-1', {}), routeCtx)
      expect(res.status).toBe(409)
    })
  })
})
