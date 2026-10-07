/**
 * What `applyOutfitSelections` tells the wear ledger's chokepoint.
 *
 * The stored slots hold only leaves (bundles dissolve as they go on), so the
 * ledger can credit an outfit as worn only when the caller says which bundles
 * it dissolved. These cases pin each mode's `source` and `wornBundles`.
 */

import { applyOutfitSelections } from '@/lib/wardrobe/apply-outfit-selections'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { chooseLLMOutfit } from '@/lib/memory/cheap-llm-tasks/outfit-selection'
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped'
import { resolveGroupMountPointIdsForCharacter } from '@/lib/mount-index/tiered-mount-pool'
import { ledgerOver } from '@/__tests__/helpers/wardrobe-wear-ledger'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveGroupMountPointIdsForCharacter: jest.fn(),
  resolveProjectMountPointIds: jest.fn().mockResolvedValue([]),
  resolveProjectMountPointIdsForChat: jest.fn().mockResolvedValue([]),
}))
jest.mock('@/lib/memory/cheap-llm-tasks/outfit-selection', () => ({
  chooseLLMOutfit: jest.fn(),
}))
jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(() => ({ profileId: 'cheap' })),
  DEFAULT_CHEAP_LLM_CONFIG: {},
}))
jest.mock('@/lib/wardrobe/resolve-equipped', () => ({
  resolveEquippedOutfitForCharacter: jest.fn(),
}))
jest.mock('@/lib/wardrobe/wardrobe-instructions', () => ({
  resolveWardrobeInstructions: jest.fn().mockResolvedValue(null),
}))

const mockChooseLLMOutfit = chooseLLMOutfit as jest.MockedFunction<typeof chooseLLMOutfit>
const mockGroupMounts = resolveGroupMountPointIdsForCharacter as jest.MockedFunction<
  typeof resolveGroupMountPointIdsForCharacter
>
const mockResolve = resolveEquippedOutfitForCharacter as jest.MockedFunction<
  typeof resolveEquippedOutfitForCharacter
>

const CHAR_ID = 'c1c1c1c1-0000-0000-0000-000000000001'

function item(id: string, types: WardrobeItemType[], overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id,
    characterId: CHAR_ID,
    title: id,
    types,
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as WardrobeItem
}

const shirt = item('shirt', ['top'])
const slacks = item('slacks', ['bottom'])
const suit = item('suit', ['top', 'bottom'], { componentItemIds: ['shirt', 'slacks'] })

function makeRepos(own: WardrobeItem[], previous: Record<string, string[]> | null = null) {
  const setEquippedOutfit = jest.fn().mockResolvedValue(undefined)
  const wardrobeWear = ledgerOver({ setEquippedOutfit })
  return {
    wardrobeWear,
    repos: {
      characters: {
        findById: jest.fn().mockResolvedValue({ id: CHAR_ID, name: 'Bertie', description: 'd', personality: 'p', manifesto: 'm' }),
      },
      wardrobe: {
        findByCharacterId: jest.fn().mockResolvedValue(own),
        findArchetypes: jest.fn().mockResolvedValue([]),
        findArchetypesInMounts: jest.fn().mockResolvedValue([]),
      },
      connections: { findAll: jest.fn().mockResolvedValue([{ id: 'p1', isDefault: true }]) },
      chats: {
        setEquippedOutfit,
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(previous),
        findById: jest.fn().mockResolvedValue(null),
      },
      wardrobeWear,
    },
  }
}

function lastCommit(wardrobeWear: ReturnType<typeof ledgerOver>) {
  return wardrobeWear.commitEquippedOutfit.mock.calls.at(-1)?.[0]
}

const CTX = { userId: 'u1', projectMountPointIds: [] as string[] }

beforeEach(() => {
  jest.clearAllMocks()
  mockGroupMounts.mockResolvedValue([])
  mockResolve.mockResolvedValue({
    outfitValues: {},
    leafItemsBySlot: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
    itemsById: new Map(),
  } as never)
})

describe('applyOutfitSelections — wear ledger', () => {
  it("default: credits the isDefault bundle it dissolved, as 'chat-start' by default", async () => {
    const { repos, wardrobeWear } = makeRepos([shirt, slacks, { ...suit, isDefault: true }])
    await applyOutfitSelections('chat-1', [{ characterId: CHAR_ID, mode: 'default' }], repos as never, CTX)

    expect(lastCommit(wardrobeWear)).toMatchObject({
      chatId: 'chat-1',
      characterId: CHAR_ID,
      source: 'chat-start',
      wornBundles: [{ id: 'suit', leafIds: ['shirt', 'slacks'] }],
    })
    expect(lastCommit(wardrobeWear)?.nextSlots.top).toEqual(['shirt'])
  })

  it("passes the caller's source through", async () => {
    const { repos, wardrobeWear } = makeRepos([shirt])
    await applyOutfitSelections('chat-1', [{ characterId: CHAR_ID, mode: 'none' }], repos as never, {
      ...CTX,
      source: 'participant-added',
    })
    expect(lastCommit(wardrobeWear)).toMatchObject({ source: 'participant-added', wornBundles: [] })
  })

  it("merge: still goes through the chokepoint, marked 'merge'", async () => {
    const { repos, wardrobeWear } = makeRepos([shirt], { top: ['shirt'], bottom: [], footwear: [], accessories: [], hair: [] })
    await applyOutfitSelections('chat-1', [{ characterId: CHAR_ID, mode: 'previous_chat' }], repos as never, {
      ...CTX,
      sourceChatId: 'chat-0',
      source: 'merge',
    })
    expect(lastCommit(wardrobeWear)).toMatchObject({ source: 'merge', wornBundles: [] })
    expect(lastCommit(wardrobeWear)?.nextSlots.top).toEqual(['shirt'])
  })

  it('previous_chat: a carry-over of leaves claims no bundle', async () => {
    const { repos, wardrobeWear } = makeRepos([shirt, slacks, suit], {
      top: ['shirt'], bottom: ['slacks'], footwear: [], accessories: [], hair: [],
    })
    await applyOutfitSelections('chat-1', [{ characterId: CHAR_ID, mode: 'previous_chat' }], repos as never, {
      ...CTX,
      sourceChatId: 'chat-0',
    })
    expect(lastCommit(wardrobeWear)).toMatchObject({ source: 'chat-start', wornBundles: [] })
  })

  it('manual: credits the quick-picked bundles it can see, expanded server-side', async () => {
    const { repos, wardrobeWear } = makeRepos([shirt, slacks, suit])
    await applyOutfitSelections(
      'chat-1',
      [{
        characterId: CHAR_ID,
        mode: 'manual',
        slots: { top: ['shirt'], bottom: ['slacks'], footwear: [], accessories: [], hair: [] },
        wornBundleIds: ['suit', 'not-in-the-wardrobe'],
      }],
      repos as never,
      CTX,
    )
    expect(lastCommit(wardrobeWear)?.wornBundles).toEqual([{ id: 'suit', leafIds: ['shirt', 'slacks'] }])
  })

  it('manual without wornBundleIds claims nothing', async () => {
    const { repos, wardrobeWear } = makeRepos([shirt])
    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'manual', slots: { top: ['shirt'], bottom: [], footwear: [], accessories: [], hair: [] } }],
      repos as never,
      CTX,
    )
    expect(lastCommit(wardrobeWear)?.wornBundles).toEqual([])
  })

  it('llm_choose: credits the bundle the model picked and the dissolve broke apart', async () => {
    mockChooseLLMOutfit.mockResolvedValue({
      success: true,
      result: {
        slots: { top: ['suit'], bottom: ['suit'], footwear: [], accessories: [], hair: [] },
        deliberatelyUnclothed: false,
      },
    } as never)
    const { repos, wardrobeWear } = makeRepos([shirt, slacks, suit])
    await applyOutfitSelections('chat-1', [{ characterId: CHAR_ID, mode: 'llm_choose' }], repos as never, CTX)

    expect(mockChooseLLMOutfit).toHaveBeenCalled()
    expect(lastCommit(wardrobeWear)).toMatchObject({
      wornBundles: [{ id: 'suit', leafIds: ['shirt', 'slacks'] }],
    })
    expect(lastCommit(wardrobeWear)?.nextSlots).toMatchObject({ top: ['shirt'], bottom: ['slacks'] })
  })
})
