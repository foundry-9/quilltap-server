/**
 * @jest-environment node
 *
 * createItemImagesRoute — the one images route behind the wardrobe's and the
 * Inventory's `[itemId]/images`. Run for two kind adapters shaped like the
 * real ones: the shared actions behave the same for both, and the kind
 * options carry the differences (the wardrobe's `link-image`, the
 * Inventory's fall-through list deciding what save-to-store lets out, each
 * kind's generate extras, 404 wording and error mapping).
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: unknown) => handler,
  withActionDispatch: jest.requireActual('@/lib/api/middleware/actions').withActionDispatch,
}))
jest.mock('@/lib/background-jobs/activity-registry', () => ({ trackActivity: (_k: string, fn: () => unknown) => fn() }))
jest.mock('@/lib/images-v2', () => ({ validateImageFile: jest.fn() }))
jest.mock('@/lib/files/webp-conversion', () => ({ convertToWebP: jest.fn() }))
jest.mock('@/lib/photos/save-image-to-album', () => {
  const { z } = jest.requireActual('zod')
  return {
    SaveImageRequestSchema: z.object({ fileId: z.string().min(1), mountPointId: z.string().min(1), caption: z.string().optional(), tags: z.array(z.string()).optional() }),
    SaveImageToAlbumError: class extends Error {},
    saveImageToAlbum: jest.fn(async () => ({ relativePath: 'photos/x.webp', linkId: 'l-1' })),
  }
})
jest.mock('@/lib/photos/save-image-response', () => {
  const { NextResponse } = jest.requireActual('next/server')
  return { savedImageResponse: jest.fn(() => NextResponse.json({ saved: true })), saveImageErrorResponse: jest.fn() }
})
jest.mock('@/lib/photos/photo-album-options', () => ({ listAllPhotoAlbumOptions: jest.fn(async () => [{ mountPointId: 'mp-1' }]) }))
jest.mock('@/lib/mount-index/character-vault', () => ({ getArchivedCharacterVaultMountPointIds: jest.fn(async () => ['mp-tomb']) }))

import { NextRequest, NextResponse } from 'next/server'
import { createItemImagesRoute, type ItemImagesKind } from '@/lib/mount-index/item-images-route'
import { saveImageToAlbum } from '@/lib/photos/save-image-to-album'

type Home = { item: { id: string; title: string; imageFileId: string | null } }
type Handler = (req: NextRequest, ctx: unknown, params: unknown) => Promise<Response>

class NoProfile extends Error {}
class GenFailed extends Error {
  constructor(message: string, readonly trail: unknown, readonly refused: boolean) {
    super(message)
  }
}
class Archived extends Error {}

function kindFor(name: 'wardrobe' | 'inventory'): ItemImagesKind<Home> & { mocks: Record<string, jest.Mock> } {
  const mocks = {
    resolveHome: jest.fn(async (_r, _u, _s, _id, itemId: string) =>
      itemId === 'item-1' ? { item: { id: 'item-1', title: 'Opera coat', imageFileId: 'f-own' } } : null,
    ),
    // The Inventory's list falls through to an archetype's pictures, marked inherited.
    listImages: jest.fn(async () =>
      name === 'inventory' ? [{ fileId: 'f-arch', inherited: true }] : [{ fileId: 'f-own' }, { fileId: 'f-old' }],
    ),
    generate: jest.fn(async () => ({ fileId: 'f-new', extras: name === 'wardrobe' ? { prompt: 'p', subject: 'worn' } : { prompt: 'p' } })),
    setCurrent: jest.fn(async (_r, _h, fileId: string) => fileId),
    deleteImage: jest.fn(async () => null),
    addImage: jest.fn(),
    link: jest.fn(async () => NextResponse.json({ linked: true }, { status: 201 })),
  }
  return {
    mocks,
    logTag: `[${name}]`,
    context: name,
    messages: {
      itemNotFound: name === 'wardrobe' ? 'Wardrobe item' : 'Inventory object',
      foreignPicture: 'Not yours',
      invalidJson: 'Bad JSON',
      refusedSubject: name === 'wardrobe' ? 'this garment' : 'this object',
    },
    resolveHome: mocks.resolveHome,
    listImages: mocks.listImages,
    captionOf: (home) => home.item.title,
    summarize: (file) => ({ fileId: file.id }),
    generate: mocks.generate,
    noProfileError: NoProfile,
    generationError: GenFailed,
    addImage: mocks.addImage,
    setCurrent: mocks.setCurrent,
    deleteImage: mocks.deleteImage,
    errorResponse: (error) => {
      if (error instanceof Archived) return NextResponse.json({ error: `archived ${name}` }, { status: 409 })
      throw error
    },
    ...(name === 'wardrobe' && { extraPostActions: { 'link-image': mocks.link } }),
  }
}

const ctx = { user: { id: 'user-1', name: 'Ada' }, repos: { files: { findById: jest.fn(async (id: string) => ({ id })) } } }
const params = { itemId: 'item-1' }
const url = (query: string) => `http://localhost/api/v1/x/item-1/images?${query}`
const get = (query: string) => new NextRequest(url(query))
const post = (query: string, body?: unknown) =>
  new NextRequest(url(query), { method: 'POST', body: body === undefined ? '' : JSON.stringify(body), headers: { 'content-type': 'application/json' } })

beforeEach(() => jest.clearAllMocks())

describe.each(['wardrobe', 'inventory'] as const)('createItemImagesRoute (%s)', (name) => {
  const build = () => {
    const kind = kindFor(name)
    const route = createItemImagesRoute(kind) as unknown as Record<'GET' | 'POST', Handler>
    return { kind, ...route }
  }

  it("lists the kind's pictures with the current one only when it is among them", async () => {
    const { GET } = build()
    const res = await GET(get('scope=character&id=c-1'), ctx, params)
    const body = await res.json()
    expect(body.current).toBe(name === 'wardrobe' ? 'f-own' : null)
    expect(body.images.length).toBeGreaterThan(0)
  })

  it('400s a non-general scope without an id, and 404s an item not in the container in the kind’s words', async () => {
    const { GET } = build()
    expect((await GET(get('scope=project'), ctx, params)).status).toBe(400)
    const missing = await GET(get('scope=general'), ctx, { itemId: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({ error: `${name === 'wardrobe' ? 'Wardrobe item' : 'Inventory object'} not found` })
  })

  it('generate spreads the kind’s extras and maps a refusal to 422, a failure to 502', async () => {
    const { POST, kind } = build()
    const ok = await POST(post('action=generate&scope=general'), ctx, params)
    expect(ok.status).toBe(201)
    expect(await ok.json()).toMatchObject({ image: { fileId: 'f-new' }, current: 'f-new', prompt: 'p' })
    expect(kind.mocks.generate).toHaveBeenCalledWith(ctx.repos, expect.objectContaining({ imageProfileId: null, containerId: null }))

    kind.mocks.generate.mockRejectedValueOnce(new GenFailed('declined', ['t'], true))
    const refused = await POST(post('action=generate&scope=general', {}), ctx, params)
    expect(refused.status).toBe(422)
    expect((await refused.json()).error).toContain(name === 'wardrobe' ? 'this garment' : 'this object')

    kind.mocks.generate.mockRejectedValueOnce(new GenFailed('rate limited', null, false))
    expect((await POST(post('action=generate&scope=general', {}), ctx, params)).status).toBe(502)

    kind.mocks.generate.mockRejectedValueOnce(new NoProfile('none'))
    expect((await POST(post('action=generate&scope=general', {}), ctx, params)).status).toBe(400)

    const bad = await POST(new NextRequest(url('action=generate&scope=general'), { method: 'POST', body: '{nope' }), ctx, params)
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toEqual({ error: 'Bad JSON' })
  })

  it("set-current and delete-image answer the new current, and a write refusal goes through the kind's mapping", async () => {
    const { POST, kind } = build()
    const set = await POST(post('action=set-current&scope=general', { fileId: 'f-old' }), ctx, params)
    await expect(set.json()).resolves.toEqual({ current: 'f-old' })
    const del = await POST(post('action=delete-image&scope=general', { fileId: 'f-old' }), ctx, params)
    await expect(del.json()).resolves.toEqual({ current: null })

    kind.mocks.setCurrent.mockRejectedValueOnce(new Archived())
    const archived = await POST(post('action=set-current&scope=general', { fileId: 'f-old' }), ctx, params)
    expect(archived.status).toBe(409)
    await expect(archived.json()).resolves.toEqual({ error: `archived ${name}` })
  })

  it('save-to-store lets out only what the list shows, and never into an archived vault', async () => {
    const { POST } = build()
    const shown = name === 'wardrobe' ? 'f-own' : 'f-arch'
    const ok = await POST(post('action=save-to-store&scope=general', { fileId: shown, mountPointId: 'mp-1' }), ctx, params)
    expect(ok.status).toBe(200)
    expect(saveImageToAlbum).toHaveBeenCalledWith(expect.objectContaining({ fileId: shown, caption: 'Opera coat' }))

    const foreign = await POST(post('action=save-to-store&scope=general', { fileId: 'f-else', mountPointId: 'mp-1' }), ctx, params)
    expect(foreign.status).toBe(400)
    const tomb = await POST(post('action=save-to-store&scope=general', { fileId: shown, mountPointId: 'mp-tomb' }), ctx, params)
    expect(tomb.status).toBe(409)
    expect(saveImageToAlbum).toHaveBeenCalledTimes(1)
  })

  it('save-targets lists every album', async () => {
    const { GET } = build()
    await expect((await GET(get('action=save-targets&scope=general'), ctx, params)).json()).resolves.toEqual({
      albums: [{ mountPointId: 'mp-1' }],
    })
  })

  it(`${name === 'wardrobe' ? 'offers' : 'does not offer'} link-image`, async () => {
    const { POST, kind } = build()
    const res = await POST(post('action=link-image&scope=general', { fileId: 'f-x' }), ctx, params)
    if (name === 'wardrobe') {
      expect(res.status).toBe(201)
      expect(kind.mocks.link).toHaveBeenCalledWith(expect.anything(), ctx, expect.objectContaining({ query: { scope: 'general' } }), 'item-1')
    } else {
      expect(res.status).toBe(400)
    }
  })

  it('a bare POST is a 400, never a default action', async () => {
    const { POST } = build()
    expect((await POST(post('scope=general', {}), ctx, params)).status).toBe(400)
  })
})
