/**
 * Regression test for the character PUT handler's wardrobe-permission fields.
 *
 * `updateCharacterSchema` is a `z.object(...)` whose `.parse()` strips keys not
 * declared in the schema. `canDressThemselves` / `canCreateOutfits` were absent,
 * so a PUT carrying them had those keys silently dropped before reaching
 * `repos.characters.update()` — the editor toggles never persisted even though
 * the client showed a success toast.
 *
 * These tests pin that both tri-state flags survive validation and reach
 * update() intact (including the `null` = inherit-from-global case).
 */

// Use global `jest` so module mocks hoist before the handler import.

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextResponse: { json: (body: any) => ({ __kind: 'json', body }) },
}))

jest.mock('@/lib/api/middleware', () => ({
  exists: (entity: unknown) => entity != null,
}))

// These requests carry no `?action=`, so dispatch always takes the fallback
// (the plain PUT update).
jest.mock('@/lib/api/middleware/actions', () => ({
  dispatchAction: (_req: unknown, _handlers: unknown, fallback: () => Promise<unknown>) => fallback(),
}))

jest.mock('@/lib/api/responses', () => ({
  badRequest: (msg: string) => ({ __kind: 'badRequest', status: 400, msg }),
  notFound: (what: string) => ({ __kind: 'notFound', status: 404, what }),
  successResponse: (data: any) => ({ __kind: 'success', data }),
  conflict: (msg: string) => ({ __kind: 'conflict', status: 409, msg }),
}))

jest.mock('@/lib/image-gen/aesthetic', () => ({
  writeStoreFile: jest.fn(),
  DEPICTION_GUIDELINES_FILENAME: 'depiction-guidelines.md',
}))

const publishRealtimeMock = jest.fn()
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: (...args: unknown[]) => publishRealtimeMock(...args) }))

import { handlePut } from '@/app/api/v1/characters/[id]/handlers/put'

const CHAR_ID = 'char-1'
const OWNER_ID = 'user-1'

function buildCtx(updateImpl?: jest.Mock) {
  const update = updateImpl ?? jest.fn().mockImplementation((_id, payload) => ({ id: CHAR_ID, ...payload }))
  const setDefaultSystemPrompt = jest.fn().mockImplementation((id, promptId) => ({
    id,
    defaultSystemPromptId: promptId,
  }))
  return {
    ctx: {
      user: { id: OWNER_ID },
      repos: {
        characters: {
          findByIdRaw: jest.fn().mockResolvedValue({ id: CHAR_ID, userId: OWNER_ID }),
          findById: jest.fn().mockResolvedValue({ id: CHAR_ID, userId: OWNER_ID }),
          update,
          setDefaultSystemPrompt,
        },
      },
    } as any,
    update,
    setDefaultSystemPrompt,
  }
}

function reqWith(body: any) {
  return { json: jest.fn().mockResolvedValue(body) } as any
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('passes canDressThemselves and canCreateOutfits through validation to update()', async () => {
  const { ctx, update } = buildCtx()
  await handlePut(reqWith({ canDressThemselves: false, canCreateOutfits: true }), ctx, CHAR_ID)

  expect(update).toHaveBeenCalledTimes(1)
  const payload = update.mock.calls[0][1]
  expect(payload.canDressThemselves).toBe(false)
  expect(payload.canCreateOutfits).toBe(true)
})

it('preserves the null (inherit-from-global) tri-state, not stripping it', async () => {
  const { ctx, update } = buildCtx()
  await handlePut(reqWith({ canDressThemselves: null }), ctx, CHAR_ID)

  const payload = update.mock.calls[0][1]
  expect('canDressThemselves' in payload).toBe(true)
  expect(payload.canDressThemselves).toBeNull()
})

/**
 * The default system prompt is recorded twice — the character's
 * `defaultSystemPromptId` column and the `isDefault` flag on the prompt itself
 * — and consumers read the column first. Writing the column raw left the flag
 * behind, so the picker and the star in the prompts editor could disagree about
 * which prompt was default. The handler routes it through the repository
 * chokepoint that moves both.
 */
it('routes defaultSystemPromptId through setDefaultSystemPrompt, not the raw update', async () => {
  const { ctx, update, setDefaultSystemPrompt } = buildCtx()
  const promptId = '11111111-2222-4333-8444-555555555555'
  await handlePut(reqWith({ defaultSystemPromptId: promptId, name: 'Baraka Ilunga' }), ctx, CHAR_ID)

  expect(setDefaultSystemPrompt).toHaveBeenCalledWith(CHAR_ID, promptId)
  expect('defaultSystemPromptId' in update.mock.calls[0][1]).toBe(false)
})

/**
 * An empty patch is not a write anyone asked for, and the archive guard reads
 * one as an unsanctioned edit to a tombstone.
 */
it('does not write an empty patch when the default prompt is all that was sent', async () => {
  const { ctx, update } = buildCtx()
  await handlePut(
    reqWith({ defaultSystemPromptId: '11111111-2222-4333-8444-555555555555' }),
    ctx,
    CHAR_ID
  )

  expect(update).not.toHaveBeenCalled()
})

it('passes a null defaultSystemPromptId through as a clear', async () => {
  const { ctx, setDefaultSystemPrompt } = buildCtx()
  await handlePut(reqWith({ defaultSystemPromptId: null }), ctx, CHAR_ID)

  expect(setDefaultSystemPrompt).toHaveBeenCalledWith(CHAR_ID, null)
})

it('leaves the chokepoint alone when the PUT does not mention the default prompt', async () => {
  const { ctx, setDefaultSystemPrompt } = buildCtx()
  await handlePut(reqWith({ name: 'Baraka Ilunga' }), ctx, CHAR_ID)

  expect(setDefaultSystemPrompt).not.toHaveBeenCalled()
})

it('answers 400 when the named prompt is not on the character', async () => {
  const { ctx, setDefaultSystemPrompt } = buildCtx()
  setDefaultSystemPrompt.mockResolvedValueOnce(null)
  const res: any = await handlePut(
    reqWith({ defaultSystemPromptId: '11111111-2222-4333-8444-555555555555' }),
    ctx,
    CHAR_ID
  )

  expect(res.status).toBe(400)
})

/**
 * The PUT schema is derived from the entity and strict (D9): an unknown key is
 * a 400 rather than a silent drop (#146), and the sub-collections are not
 * taken here at all — a whole-array scenarios PUT is what un-archived
 * scenarios (#150); they are written one at a time through their own route.
 */
describe('the strict, derived schema', () => {
  it('refuses an unknown key', async () => {
    const { ctx, update } = buildCtx()
    await expect(handlePut(reqWith({ name: 'Tess', systemPromt: 'typo' }), ctx, CHAR_ID)).rejects.toThrow(/unrecognized|systemPromt/i)
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses the sub-collections as whole arrays', async () => {
    const { ctx, update } = buildCtx()
    await expect(handlePut(reqWith({ scenarios: [] }), ctx, CHAR_ID)).rejects.toThrow()
    await expect(handlePut(reqWith({ systemPrompts: [] }), ctx, CHAR_ID)).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a server-owned field', async () => {
    const { ctx } = buildCtx()
    await expect(handlePut(reqWith({ characterDocumentMountPointId: null }), ctx, CHAR_ID)).rejects.toThrow()
    await expect(handlePut(reqWith({ tags: [] }), ctx, CHAR_ID)).rejects.toThrow()
  })

  it('takes every vault-managed setting without a hand-written list', async () => {
    const { ctx, update } = buildCtx()
    await handlePut(reqWith({
      kind: 'assistant', birthday: '1890-03-14', canDrawDiagrams: true, diagramStyle: 'clean',
      canChooseOutfit: true, aliases: ['Tessie'], metadata: { a: 1 }, talkativeness: 0.7,
    }), ctx, CHAR_ID)
    expect(update.mock.calls[0][1]).toMatchObject({ kind: 'assistant', birthday: '1890-03-14', diagramStyle: 'clean', metadata: { a: 1 } })
  })

  it('reads an empty profile select as "clear"', async () => {
    const { ctx, update } = buildCtx()
    await handlePut(reqWith({ defaultImageProfileId: '' }), ctx, CHAR_ID)
    expect(update.mock.calls[0][1].defaultImageProfileId).toBeNull()
  })

  it('owns the physical description id and passes Clear through as null', async () => {
    const { ctx, update } = buildCtx()
    ctx.repos.characters.findByIdRaw.mockResolvedValue({ id: CHAR_ID, userId: OWNER_ID, characterDocumentMountPointId: '22222222-2222-4222-8222-222222222222' })
    await handlePut(reqWith({ physicalDescription: { fullDescription: 'Tall.' } }), ctx, CHAR_ID)
    const pd = update.mock.calls[0][1].physicalDescription
    expect(pd.fullDescription).toBe('Tall.')
    expect(pd.id).toMatch(/^[0-9a-f-]{36}$/)
    await handlePut(reqWith({ physicalDescription: null }), ctx, CHAR_ID)
    expect(update.mock.calls[1][1].physicalDescription).toBeNull()
  })

  it('publishes the characters topic after a write', async () => {
    const { ctx } = buildCtx()
    await handlePut(reqWith({ name: 'Tess' }), ctx, CHAR_ID)
    expect(publishRealtimeMock).toHaveBeenCalledWith('characters', CHAR_ID)
  })
})
