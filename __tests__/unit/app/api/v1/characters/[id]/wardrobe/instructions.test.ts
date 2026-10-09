/**
 * `?action=instructions` on the character wardrobe collection route.
 *
 * Pins that:
 *  - GET reads the vault's `Wardrobe/instructions.md` (null when absent)
 *    without touching the item list.
 *  - POST writes through the location's `writableMountPointId()`, which
 *    re-resolves via `resolveWardrobeMount`, so the archived-character
 *    tombstone is honoured (409).
 *  - A character with no vault has no wardrobe location: both 404 (the
 *    shared route factory treats it like a missing character).
 *  - An unknown character, or another user's, 404s.
 */

// Use global `jest` so module mocks hoist before the route import.

let mockCtx: any

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  exists: (v: unknown) => v !== null && v !== undefined,
  createContextParamsHandler: (handler: (req: any, ctx: any, params: any) => Promise<any>) => {
    return async (req: any, routeCtx: any) => handler(req, mockCtx, await routeCtx.params)
  },
  withActionDispatch: (actions: Record<string, any>, defaultHandler: any) => {
    return async (req: any, ctx: any, params: any) => {
      const action = req?.nextUrl?.searchParams?.get?.('action') ?? null
      if (action && actions[action]) return actions[action](req, ctx, params)
      return defaultHandler(req, ctx, params)
    }
  },
}))

jest.mock('@/lib/api/responses', () => ({
  notFound: (what: string) => ({ __kind: 'notFound', status: 404, what }),
  serverError: (msg: string) => ({ __kind: 'serverError', status: 500, msg }),
  conflict: (msg: string) => ({ __kind: 'conflict', status: 409, msg }),
  created: (data: any) => ({ body: data, status: 201 }),
  successResponse: (data: any, status = 200) => ({ body: data, status }),
}))

jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveGroupMountsForCharacter: jest.fn(),
}))

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  WardrobeComponentCycleError: class WardrobeComponentCycleError extends Error {},
  readMountItems: jest.fn(),
  createInMount: jest.fn(),
  updateInMount: jest.fn(),
  deleteInMount: jest.fn(),
  resolveWardrobeMount: jest.fn(),
}))

jest.mock('@/lib/instance-settings', () => ({ getGeneralMountPointId: jest.fn() }))
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }))
jest.mock('@/lib/mount-index/shared-wardrobe', () => ({ ensureSharedWardrobeFolder: jest.fn() }))
jest.mock('@/lib/wardrobe/pool', () => ({ loadWearablePool: jest.fn() }))

jest.mock('@/lib/database/repositories/characters.repository', () => ({
  CharacterArchivedError: class CharacterArchivedError extends Error {
    constructor(id: string) {
      super(`archived: ${id}`)
      this.name = 'CharacterArchivedError'
    }
  },
}))

jest.mock('@/lib/wardrobe/wardrobe-instructions', () => ({
  readWardrobeInstructionsFile: jest.fn(),
  writeWardrobeInstructionsFile: jest.fn(),
}))

import { GET, POST } from '@/app/api/v1/characters/[id]/wardrobe/route'
import {
  readMountItems,
  resolveWardrobeMount,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'
import {
  readWardrobeInstructionsFile,
  writeWardrobeInstructionsFile,
} from '@/lib/wardrobe/wardrobe-instructions'

const CHAR_ID = 'char-1'
const MOUNT_ID = 'vault-mount-1'

function routeCtx(params: Record<string, string>): any {
  return { params: Promise.resolve(params) }
}

function actionReq(body?: unknown): any {
  return {
    nextUrl: { searchParams: new URLSearchParams('action=instructions') },
    json: async () => body,
  }
}

beforeEach(() => {
  jest.clearAllMocks()

  mockCtx = {
    user: { id: 'user-1' },
    repos: {
      characters: {
        findByIdRaw: jest.fn().mockResolvedValue({
          id: CHAR_ID,
          name: 'Bertie',
          userId: 'user-1',
          characterDocumentMountPointId: MOUNT_ID,
        }),
      },
    },
  }

  ;(resolveWardrobeMount as jest.Mock).mockResolvedValue({
    mountPointId: MOUNT_ID,
    characterId: CHAR_ID,
    scope: 'character',
  })
  ;(readWardrobeInstructionsFile as jest.Mock).mockResolvedValue(null)
  ;(writeWardrobeInstructionsFile as jest.Mock).mockResolvedValue(undefined)
})

it('GET reads the vault instructions and reports null when absent', async () => {
  const res: any = await GET(actionReq(), routeCtx({ id: CHAR_ID }))
  expect(res.status).toBe(200)
  expect(res.body.instructions).toBeNull()
  expect(readWardrobeInstructionsFile).toHaveBeenCalledWith(MOUNT_ID)
  expect(readMountItems).not.toHaveBeenCalled()
})

it('GET reports the stored instructions', async () => {
  ;(readWardrobeInstructionsFile as jest.Mock).mockResolvedValue('Tweeds, always.')
  const res: any = await GET(actionReq(), routeCtx({ id: CHAR_ID }))
  expect(res.body.instructions).toBe('Tweeds, always.')
})

it('POST writes to the resolved vault mount', async () => {
  const res: any = await POST(
    actionReq({ instructions: 'You prefer tweeds for fieldwork.' }),
    routeCtx({ id: CHAR_ID }),
  )
  expect(res.status).toBe(200)
  expect(res.body.instructions).toBe('You prefer tweeds for fieldwork.')
  expect(resolveWardrobeMount).toHaveBeenCalledWith(CHAR_ID)
  expect(writeWardrobeInstructionsFile).toHaveBeenCalledWith(
    MOUNT_ID,
    'You prefer tweeds for fieldwork.',
  )
})

it('POST 409s for an archived character (tombstone respected)', async () => {
  ;(resolveWardrobeMount as jest.Mock).mockRejectedValue(new CharacterArchivedError(CHAR_ID))
  const res: any = await POST(actionReq({ instructions: 'x' }), routeCtx({ id: CHAR_ID }))
  expect(res.status).toBe(409)
  expect(writeWardrobeInstructionsFile).not.toHaveBeenCalled()
})

it('GET and POST 404 for a character with no vault, without reading or writing', async () => {
  mockCtx.repos.characters.findByIdRaw.mockResolvedValue({ id: CHAR_ID, name: 'Bertie', userId: 'user-1' })
  const getRes: any = await GET(actionReq(), routeCtx({ id: CHAR_ID }))
  const cleared: any = await POST(actionReq({ instructions: null }), routeCtx({ id: CHAR_ID }))
  const write: any = await POST(actionReq({ instructions: 'x' }), routeCtx({ id: CHAR_ID }))
  expect(getRes.status).toBe(404)
  expect(cleared.status).toBe(404)
  expect(write.status).toBe(404)
  expect(readWardrobeInstructionsFile).not.toHaveBeenCalled()
  expect(writeWardrobeInstructionsFile).not.toHaveBeenCalled()
})

it('GET and POST 404 for an unknown character', async () => {
  mockCtx.repos.characters.findByIdRaw.mockResolvedValue(null)
  const getRes: any = await GET(actionReq(), routeCtx({ id: 'nope' }))
  const postRes: any = await POST(actionReq({ instructions: 'x' }), routeCtx({ id: 'nope' }))
  expect(getRes.status).toBe(404)
  expect(postRes.status).toBe(404)
})

it("GET and POST 404 for another user's character", async () => {
  mockCtx.user = { id: 'someone-else' }
  const getRes: any = await GET(actionReq(), routeCtx({ id: CHAR_ID }))
  const postRes: any = await POST(actionReq({ instructions: 'x' }), routeCtx({ id: CHAR_ID }))
  expect(getRes.status).toBe(404)
  expect(postRes.status).toBe(404)
  expect(readWardrobeInstructionsFile).not.toHaveBeenCalled()
  expect(writeWardrobeInstructionsFile).not.toHaveBeenCalled()
})
