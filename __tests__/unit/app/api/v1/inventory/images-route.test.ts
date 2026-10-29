/**
 * @jest-environment node
 *
 * `POST /api/v1/inventory/[itemId]/images?action=generate` answers a
 * malformed JSON body with 400 (never a 500), and treats an empty body as
 * "the default profile".
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
jest.mock('@/lib/wardrobe/item-images', () => ({ toWardrobeImageSummary: jest.fn((f: { id: string }) => ({ fileId: f.id })) }))
jest.mock('@/lib/inventory/item-images', () => ({
  addInventoryItemImage: jest.fn(),
  deleteInventoryItemImage: jest.fn(),
  listInventoryImagesWithFallthrough: jest.fn(),
  setCurrentInventoryItemImage: jest.fn(),
  resolveInventoryItemHome: jest.fn(async () => ({ item: { id: 'item-1' } })),
}))
jest.mock('@/lib/inventory/item-image-generation', () => {
  class InventoryImageGenerationError extends Error {}
  class NoInventoryImageProfileError extends Error {}
  return {
    InventoryImageGenerationError,
    NoInventoryImageProfileError,
    generateInventoryItemImage: jest.fn(async () => ({ fileId: 'file-1', prompt: 'p', profile: null, rerouted: false, trail: [] })),
  }
})
jest.mock('@/lib/photos/save-image-to-album', () => ({ saveImageToAlbum: jest.fn(), SaveImageToAlbumError: class extends Error {}, SaveImageRequestSchema: { safeParse: jest.fn() } }))
jest.mock('@/lib/photos/save-image-response', () => ({ savedImageResponse: jest.fn(), saveImageErrorResponse: jest.fn() }))
jest.mock('@/lib/photos/photo-album-options', () => ({ listAllPhotoAlbumOptions: jest.fn() }))
jest.mock('@/lib/mount-index/character-vault', () => ({ getArchivedCharacterVaultMountPointIds: jest.fn(async () => new Set()) }))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/inventory/[itemId]/images/route'
import { generateInventoryItemImage } from '@/lib/inventory/item-image-generation'

type Handler = (req: NextRequest, ctx: unknown, params: unknown) => Promise<Response>
const ctx = { user: { id: 'user-1' }, repos: { files: { findById: jest.fn(async () => ({ id: 'file-1' })) } } }
const generate = (body: string) =>
  (POST as unknown as Handler)(
    new NextRequest('http://localhost/x?action=generate&scope=general', { method: 'POST', body, headers: { 'content-type': 'application/json' } }),
    ctx,
    { itemId: 'item-1' },
  )

describe('inventory images ?action=generate', () => {
  it('answers a malformed JSON body with 400', async () => {
    const res = await generate('{imageProfileId:')
    expect(res.status).toBe(400)
    expect(generateInventoryItemImage).not.toHaveBeenCalled()
  })

  it('treats an empty body as the default profile', async () => {
    const res = await generate('')
    expect(res.status).toBe(201)
    expect(generateInventoryItemImage).toHaveBeenCalledWith(ctx.repos, expect.objectContaining({ imageProfileId: null }))
  })
})
