/**
 * Regression test for the character-wardrobe DELETE route (commit fafd5449).
 *
 * The DELETE pre-check once queried the legacy `wardrobe_items` SQL table via
 * repos.wardrobe.findById(itemId). That table was emptied when wardrobe storage
 * cut over to the vault, so the pre-check always 404'd even for items the vault
 * still listed.
 *
 * The route now resolves the character's vault as a wardrobe location
 * (`resolveWardrobeLocation`) and looks the item up in the vault folder
 * itself. These tests pin that DELETE finds the item in the vault (never the
 * stale SQL table), deletes through the vault writer, and only when the vault
 * confirms the item and the character is the requesting user's.
 */

// Use global `jest` so module mocks hoist before the route import.

let mockCtx: any

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: (req: any, ctx: any, params: any) => Promise<any>) => {
    return async (req: any, routeCtx: any) => handler(req, mockCtx, await routeCtx.params)
  },
  withActionDispatch: (_actions: Record<string, any>, defaultHandler: any) => defaultHandler,
}))

jest.mock('@/lib/api/responses', () => ({
  badRequest: (msg: string) => ({ __kind: 'badRequest', status: 400, msg }),
  conflict: (msg: string) => ({ __kind: 'conflict', status: 409, msg }),
  created: (data: any) => ({ body: data, status: 201 }),
  notFound: (what: string) => ({ __kind: 'notFound', status: 404, what }),
  serverError: (msg: string) => ({ __kind: 'serverError', status: 500, msg }),
  successResponse: (data: any, status = 200) => ({ body: data, status }),
}))

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  WardrobeComponentCycleError: class WardrobeComponentCycleError extends Error {},
  readMountItems: jest.fn(),
  createInMount: jest.fn(),
  updateInMount: jest.fn(),
  deleteInMount: jest.fn(),
  resolveWardrobeMount: jest.fn(),
}))

jest.mock('@/lib/database/repositories/characters.repository', () => ({
  CharacterArchivedError: class CharacterArchivedError extends Error {},
}))

jest.mock('@/lib/instance-settings', () => ({ getGeneralMountPointId: jest.fn() }))
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }))
jest.mock('@/lib/mount-index/shared-wardrobe', () => ({ ensureSharedWardrobeFolder: jest.fn() }))
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({ resolveGroupMountsForCharacter: jest.fn() }))
jest.mock('@/lib/wardrobe/pool', () => ({ loadWearablePool: jest.fn() }))

jest.mock('@/lib/wardrobe/item-images', () => {
  class ForeignWardrobeImageError extends Error {}
  return {
    ForeignWardrobeImageError,
    assertItemImageChoice: jest.fn(async () => undefined),
    cleanupItemImages: jest.fn(async () => undefined),
  }
})

import { DELETE } from '@/app/api/v1/characters/[id]/wardrobe/[itemId]/route'
import {
  deleteInMount,
  readMountItems,
  resolveWardrobeMount,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes'

const CHAR_ID = 'char-1'
const ITEM_ID = 'item-1'
const OWNER_ID = 'user-1'
const VAULT = { mountPointId: 'vault-1', scope: 'character', characterId: CHAR_ID }

function buildRepos() {
  return {
    characters: {
      findByIdRaw: jest.fn().mockResolvedValue({
        id: CHAR_ID,
        name: 'Vivienne',
        userId: OWNER_ID,
        characterDocumentMountPointId: 'vault-1',
      }),
    },
    wardrobe: {
      // The stale SQL-table lookup — must never be used.
      findById: jest.fn().mockResolvedValue(null),
    },
    chats: {
      removeEquippedItemFromAllChats: jest.fn().mockResolvedValue(undefined),
    },
    wardrobeWear: {
      deleteByItemIds: jest.fn().mockResolvedValue(undefined),
    },
  }
}

const params = { params: Promise.resolve({ id: CHAR_ID, itemId: ITEM_ID }) }
const req = {}

beforeEach(() => {
  jest.clearAllMocks()
  ;(readMountItems as jest.Mock).mockResolvedValue([{ id: ITEM_ID, characterId: CHAR_ID }])
  ;(resolveWardrobeMount as jest.Mock).mockResolvedValue(VAULT)
  ;(deleteInMount as jest.Mock).mockResolvedValue(true)
})

it('resolves the item in the vault folder, not the stale wardrobe_items table', async () => {
  const repos = buildRepos()
  mockCtx = { user: { id: OWNER_ID }, repos }

  const res: any = await DELETE(req, params)

  expect(readMountItems).toHaveBeenCalledWith(VAULT)
  expect(repos.wardrobe.findById).not.toHaveBeenCalled()
  expect(deleteInMount).toHaveBeenCalledWith(VAULT, ITEM_ID)
  expect(repos.wardrobeWear.deleteByItemIds).toHaveBeenCalledWith([ITEM_ID])
  expect(res.body).toEqual({ success: true })
})

it('404s when the vault does not hold the item (and never deletes)', async () => {
  ;(readMountItems as jest.Mock).mockResolvedValue([])
  const repos = buildRepos()
  mockCtx = { user: { id: OWNER_ID }, repos }

  const res: any = await DELETE(req, params)

  expect(res.__kind).toBe('notFound')
  expect(res.what).toBe('Wardrobe item')
  expect(deleteInMount).not.toHaveBeenCalled()
  expect(repos.chats.removeEquippedItemFromAllChats).not.toHaveBeenCalled()
})

it('404s Character when the character does not exist (and never reaches the vault)', async () => {
  const repos = buildRepos()
  repos.characters.findByIdRaw = jest.fn().mockResolvedValue(null)
  mockCtx = { user: { id: OWNER_ID }, repos }

  const res: any = await DELETE(req, params)

  expect(res.__kind).toBe('notFound')
  expect(res.what).toBe('Character')
  expect(readMountItems).not.toHaveBeenCalled()
})

it("404s Character for another user's character (and never reaches the vault)", async () => {
  const repos = buildRepos()
  mockCtx = { user: { id: 'someone-else' }, repos }

  const res: any = await DELETE(req, params)

  expect(res.__kind).toBe('notFound')
  expect(res.what).toBe('Character')
  expect(readMountItems).not.toHaveBeenCalled()
  expect(deleteInMount).not.toHaveBeenCalled()
})
