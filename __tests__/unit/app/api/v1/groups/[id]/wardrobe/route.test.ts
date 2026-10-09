/**
 * Tests for the group wardrobe routes — the group tier's own CRUD endpoints
 * (before these existed, group items could only be created via a transfer).
 *
 * Pins that:
 *  - GET ensures the group's official store + `Wardrobe/` folder and lists it
 *    (through the shared route factory and `resolveWardrobeLocation`).
 *  - POST creates a shared (characterId: null) item in the group's mount.
 *  - PUT/DELETE on the item route target the group's mount, and DELETE first
 *    scrubs equipped references.
 *  - An unknown group 404s everywhere.
 */

// Use global `jest` so module mocks hoist before the route import.

let mockCtx: any

jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'new-item-uuid'),
}))

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: (req: any, ctx: any, params: any) => Promise<any>) => {
    return async (req: any, routeCtx: any) => handler(req, mockCtx, await routeCtx.params)
  },
  // Minimal dispatch mirror: route on ?action= when the fake request carries
  // one, else fall through to the default handler (as the real middleware does).
  withActionDispatch: (actions: Record<string, any>, defaultHandler: any) => {
    return async (req: any, ctx: any, params: any) => {
      const action = req?.nextUrl?.searchParams?.get?.('action') ?? null
      if (action && actions[action]) return actions[action](req, ctx, params)
      return defaultHandler(req, ctx, params)
    }
  },
}))

jest.mock('@/lib/wardrobe/wardrobe-instructions', () => ({
  readWardrobeInstructionsFile: jest.fn(),
  writeWardrobeInstructionsFile: jest.fn(),
}))

jest.mock('@/lib/api/responses', () => ({
  badRequest: (msg: string) => ({ __kind: 'badRequest', status: 400, msg }),
  notFound: (what: string) => ({ __kind: 'notFound', status: 404, what }),
  serverError: (msg: string) => ({ __kind: 'serverError', status: 500, msg }),
  created: (data: any) => ({ body: data, status: 201 }),
  successResponse: (data: any, status = 200) => ({ body: data, status }),
  conflict: (msg: string) => ({ __kind: 'conflict', status: 409, msg }),
}))

jest.mock('@/lib/mount-index/ensure-owner-store', () => ({
  ensureOwnerOfficialStore: jest.fn(),
}))

jest.mock('@/lib/mount-index/shared-wardrobe', () => ({
  ensureSharedWardrobeFolder: jest.fn(),
}))

jest.mock('@/lib/instance-settings', () => ({ getGeneralMountPointId: jest.fn() }))
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({ resolveGroupMountsForCharacter: jest.fn() }))
jest.mock('@/lib/mount-index/general-wardrobe', () => ({ readGeneralWardrobe: jest.fn(async () => []) }))
jest.mock('@/lib/wardrobe/pool', () => ({ loadWearablePool: jest.fn() }))

jest.mock('@/lib/wardrobe/item-images', () => {
  class ForeignWardrobeImageError extends Error {}
  return {
    ForeignWardrobeImageError,
    assertItemImageChoice: jest.fn(async () => undefined),
    cleanupItemImages: jest.fn(async () => undefined),
  }
})

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  WardrobeComponentCycleError: class WardrobeComponentCycleError extends Error {},
  readMountItems: jest.fn(),
  createInMount: jest.fn(),
  updateInMount: jest.fn(),
  deleteInMount: jest.fn(),
  resolveWardrobeMount: jest.fn(),
}))

import { GET, POST } from '@/app/api/v1/groups/[id]/wardrobe/route'
import { GET as GET_ITEM, PUT, DELETE } from '@/app/api/v1/groups/[id]/wardrobe/[itemId]/route'
import { ensureOwnerOfficialStore } from '@/lib/mount-index/ensure-owner-store'
import { ensureSharedWardrobeFolder } from '@/lib/mount-index/shared-wardrobe'
import {
  readWardrobeInstructionsFile,
  writeWardrobeInstructionsFile,
} from '@/lib/wardrobe/wardrobe-instructions'
import {
  createInMount,
  deleteInMount,
  readMountItems,
  updateInMount,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes'

const GROUP_ID = 'group-1'
const MOUNT_ID = 'group-mount-1'
const ITEM_ID = 'item-1'
const GROUP_MOUNT = { mountPointId: MOUNT_ID, scope: 'group', characterId: null }

const storedItem = {
  id: ITEM_ID,
  characterId: null,
  title: 'Regimental sash',
  description: null,
  imagePrompt: null,
  types: ['accessories'],
  componentItemIds: [],
  appropriateness: null,
  isDefault: false,
  replace: false,
  migratedFromClothingRecordId: null,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const NEVER_WORN = { wearCount: 0, firstWornAt: null, lastWornAt: null, lastWornChatId: null }

function routeCtx(params: Record<string, string>): any {
  return { params: Promise.resolve(params) }
}

beforeEach(() => {
  jest.clearAllMocks()

  mockCtx = {
    user: { id: 'user-1' },
    repos: {
      groups: {
        findById: jest.fn().mockResolvedValue({ id: GROUP_ID, name: 'Main Cast', officialMountPointId: MOUNT_ID }),
      },
      chats: {
        removeEquippedItemFromAllChats: jest.fn().mockResolvedValue(undefined),
      },
      wardrobeWear: {
        deleteByItemIds: jest.fn().mockResolvedValue(undefined),
        findSummaries: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, NEVER_WORN]))),
      },
    },
  }

  ;(ensureOwnerOfficialStore as jest.Mock).mockResolvedValue({ mountPointId: MOUNT_ID, created: false })
  ;(ensureSharedWardrobeFolder as jest.Mock).mockResolvedValue({ folderId: 'folder-1' })
  ;(readMountItems as jest.Mock).mockResolvedValue([storedItem])
  ;(createInMount as jest.Mock).mockImplementation(async (_mount: unknown, item: any) => item)
  ;(updateInMount as jest.Mock).mockResolvedValue({ ...storedItem, title: 'Renamed sash' })
  ;(deleteInMount as jest.Mock).mockResolvedValue(true)
})

it('GET lists the group mount wardrobe after ensuring store and folder', async () => {
  const res: any = await GET(
    { url: `http://localhost/api/v1/groups/${GROUP_ID}/wardrobe` } as any,
    routeCtx({ id: GROUP_ID }),
  )

  expect(res.status).toBe(200)
  expect(res.body.mountPointId).toBe(MOUNT_ID)
  expect(res.body.wardrobeItems).toEqual([
    { ...storedItem, origin: { scope: 'group', id: GROUP_ID, name: 'Main Cast' }, wear: NEVER_WORN },
  ])
  expect(mockCtx.repos.wardrobeWear.findSummaries).toHaveBeenCalledWith([ITEM_ID])
  expect(ensureOwnerOfficialStore).toHaveBeenCalledWith('group', GROUP_ID, 'Main Cast')
  expect(ensureSharedWardrobeFolder).toHaveBeenCalledWith(MOUNT_ID)
  expect(readMountItems).toHaveBeenCalledWith(GROUP_MOUNT)
})

it('GET hides archived garments unless asked', async () => {
  ;(readMountItems as jest.Mock).mockResolvedValue([
    storedItem,
    { ...storedItem, id: 'item-2', archivedAt: '2026-02-01T00:00:00.000Z' },
  ])

  const res: any = await GET(
    { url: `http://localhost/api/v1/groups/${GROUP_ID}/wardrobe` } as any,
    routeCtx({ id: GROUP_ID }),
  )

  expect(res.body.wardrobeItems.map((i: any) => i.id)).toEqual([ITEM_ID])
})

it('GET includes archived garments when asked', async () => {
  ;(readMountItems as jest.Mock).mockResolvedValue([
    storedItem,
    { ...storedItem, id: 'item-2', archivedAt: '2026-02-01T00:00:00.000Z' },
  ])

  const res: any = await GET(
    { url: `http://localhost/api/v1/groups/${GROUP_ID}/wardrobe?includeArchived=true` } as any,
    routeCtx({ id: GROUP_ID }),
  )

  expect(res.status).toBe(200)
  expect(res.body.wardrobeItems.map((i: any) => i.id)).toEqual([ITEM_ID, 'item-2'])
})

it('GET 404s for an unknown group', async () => {
  mockCtx.repos.groups.findById.mockResolvedValue(null)
  const res: any = await GET({ url: 'http://localhost/api/v1/groups/nope/wardrobe' } as any, routeCtx({ id: 'nope' }))
  expect(res.status).toBe(404)
  expect(ensureOwnerOfficialStore).not.toHaveBeenCalled()
})

it('POST creates a shared item in the group mount', async () => {
  const res: any = await POST(
    { json: async () => ({ title: 'Parade gloves', types: ['accessories'] }) } as any,
    routeCtx({ id: GROUP_ID }),
  )

  expect(res.status).toBe(201)
  expect(createInMount).toHaveBeenCalledWith(
    GROUP_MOUNT,
    expect.objectContaining({ id: 'new-item-uuid', characterId: null, title: 'Parade gloves' }),
  )
  expect(res.body).toEqual({
    wardrobeItem: expect.objectContaining({
      title: 'Parade gloves',
      origin: { scope: 'group', id: GROUP_ID, name: 'Main Cast' },
      wear: NEVER_WORN,
    }),
  })
})

it('GET item returns one item from the group mount', async () => {
  const res: any = await GET_ITEM({} as any, routeCtx({ id: GROUP_ID, itemId: ITEM_ID }))
  expect(res.status).toBe(200)
  expect(res.body.wardrobeItem.id).toBe(ITEM_ID)
  // An item read never provisions the store.
  expect(ensureOwnerOfficialStore).not.toHaveBeenCalled()
})

it('PUT updates the item through the group mount', async () => {
  const res: any = await PUT(
    { json: async () => ({ title: 'Renamed sash' }) } as any,
    routeCtx({ id: GROUP_ID, itemId: ITEM_ID }),
  )

  expect(res.status).toBe(200)
  expect(updateInMount).toHaveBeenCalledWith(
    GROUP_MOUNT,
    ITEM_ID,
    expect.objectContaining({ title: 'Renamed sash' }),
  )
  expect(res.body.wardrobeItem).toMatchObject({
    title: 'Renamed sash',
    origin: { scope: 'group', id: GROUP_ID, name: 'Main Cast' },
    wear: NEVER_WORN,
  })
})

it('DELETE scrubs equipped references then deletes from the group mount', async () => {
  const res: any = await DELETE({} as any, routeCtx({ id: GROUP_ID, itemId: ITEM_ID }))

  expect(res.status).toBe(200)
  expect(mockCtx.repos.chats.removeEquippedItemFromAllChats).toHaveBeenCalledWith(ITEM_ID)
  expect(mockCtx.repos.wardrobeWear.deleteByItemIds).toHaveBeenCalledWith([ITEM_ID])
  expect(deleteInMount).toHaveBeenCalledWith(GROUP_MOUNT, ITEM_ID)
})

it('DELETE 404s when the item is not in the group mount, before scrubbing anything', async () => {
  const res: any = await DELETE({} as any, routeCtx({ id: GROUP_ID, itemId: 'missing' }))
  expect(res.status).toBe(404)
  expect(mockCtx.repos.chats.removeEquippedItemFromAllChats).not.toHaveBeenCalled()
  expect(deleteInMount).not.toHaveBeenCalled()
})

it('DELETE 404s when the writer finds nothing to delete', async () => {
  ;(deleteInMount as jest.Mock).mockResolvedValue(false)
  const res: any = await DELETE({} as any, routeCtx({ id: GROUP_ID, itemId: ITEM_ID }))
  expect(res.status).toBe(404)
})

// --- ?action=instructions — the group's Wardrobe/instructions.md ------------

function actionReq(body?: unknown): any {
  return {
    nextUrl: { searchParams: new URLSearchParams('action=instructions') },
    json: async () => body,
  }
}

it('GET ?action=instructions reads the group store instructions (null when absent)', async () => {
  ;(readWardrobeInstructionsFile as jest.Mock).mockResolvedValue(null)
  const res: any = await GET(actionReq(), routeCtx({ id: GROUP_ID }))
  expect(res.status).toBe(200)
  expect(res.body.instructions).toBeNull()
  expect(readWardrobeInstructionsFile).toHaveBeenCalledWith(MOUNT_ID)
  expect(readMountItems).not.toHaveBeenCalled()
})

it('POST ?action=instructions writes to the group mount after ensuring the folder', async () => {
  const res: any = await POST(
    actionReq({ instructions: 'You favour the regimental colours.' }),
    routeCtx({ id: GROUP_ID }),
  )
  expect(res.status).toBe(200)
  expect(res.body.instructions).toBe('You favour the regimental colours.')
  expect(ensureSharedWardrobeFolder).toHaveBeenCalledWith(MOUNT_ID)
  expect(writeWardrobeInstructionsFile).toHaveBeenCalledWith(
    MOUNT_ID,
    'You favour the regimental colours.',
  )
})

it('POST ?action=instructions with null clears and reports null', async () => {
  const res: any = await POST(actionReq({ instructions: null }), routeCtx({ id: GROUP_ID }))
  expect(res.status).toBe(200)
  expect(res.body.instructions).toBeNull()
  expect(writeWardrobeInstructionsFile).toHaveBeenCalledWith(MOUNT_ID, null)
})

it('instructions handlers 404 for an unknown group', async () => {
  mockCtx.repos.groups.findById.mockResolvedValue(null)
  const getRes: any = await GET(actionReq(), routeCtx({ id: 'nope' }))
  const postRes: any = await POST(actionReq({ instructions: 'x' }), routeCtx({ id: 'nope' }))
  expect(getRes.status).toBe(404)
  expect(postRes.status).toBe(404)
})
