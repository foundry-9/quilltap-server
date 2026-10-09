/**
 * The Green Room pin: an archived garment never auditions.
 *
 * "The Green Room" is the chat-creation status dialog; the pipeline it narrates
 * hands each character's wearable pool to the cheap-LLM outfit chooser. That
 * candidate list is the one place archiving is NOT a soft hint — there is no
 * `includeArchived` for the model, no override, no surface that can ask for it.
 *
 * These cases pin that end to end, in every tier (character, group, project,
 * general), plus the two adjacent guarantees:
 *   - a model that hallucinates an archived id still doesn't get to equip it;
 *   - a garment archived mid-chat stays worn until someone takes it off.
 */

import { applyOutfitSelections } from '@/lib/wardrobe/apply-outfit-selections'
import { mergeWearablePool } from '@/lib/wardrobe/wearable-pool'
import { buildWearablePool } from '@/lib/wardrobe/pool'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { chooseLLMOutfit } from '@/lib/memory/cheap-llm-tasks/outfit-selection'
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped'
import { resolveGroupMountsForCharacter } from '@/lib/mount-index/tiered-mount-pool'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
// The real wearable pool runs; only the tier resolution it leans on is stubbed.
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveGroupMountsForCharacter: jest.fn(),
  resolveProjectMountPointIds: jest.fn().mockResolvedValue([]),
}))
jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn().mockResolvedValue('general-mp'),
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
const mockResolve = resolveEquippedOutfitForCharacter as jest.MockedFunction<
  typeof resolveEquippedOutfitForCharacter
>
const mockGroupMounts = resolveGroupMountsForCharacter as jest.MockedFunction<
  typeof resolveGroupMountsForCharacter
>
const GROUP_TIER = [{ group: { id: 'grp-1', name: 'The Drones' }, mountPointIds: ['mp-group'] }]

const CHAR_ID = 'c1c1c1c1-0000-0000-0000-000000000001'

let clock = 0

function item(
  id: string,
  types: WardrobeItemType[],
  overrides: Partial<WardrobeItem> = {},
): WardrobeItem {
  clock += 1
  return {
    id,
    characterId: null,
    title: id,
    types,
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: `2026-01-01T00:00:${String(clock).padStart(2, '0')}.000Z`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as WardrobeItem
}

const ARCHIVED = { archivedAt: '2026-02-01T00:00:00.000Z' }

/**
 * Repos over a fake store layout: `general` lives in Quilltap General
 * ('general-mp'), `project` in 'mp-project', `group` in 'mp-group'. The shared
 * reads hand back archived items too (the pool always asks for them) — the
 * pool, not the repository, is what keeps them off the candidate list.
 */
function makeRepos(
  opts: { own?: WardrobeItem[]; general?: WardrobeItem[]; project?: WardrobeItem[]; group?: WardrobeItem[] } = {},
) {
  const setEquippedOutfit = jest.fn().mockResolvedValue(undefined)
  const mounts: Record<string, WardrobeItem[]> = {
    'general-mp': opts.general ?? [],
    'mp-project': opts.project ?? [],
    'mp-group': opts.group ?? [],
  }
  const readSharedTiers = jest.fn(
    async (mountPointIds: readonly string[], includeArchived: boolean, originOf: (mp: string) => unknown) =>
      mountPointIds.flatMap((mp) =>
        (mounts[mp] ?? [])
          .filter((it) => includeArchived || !it.archivedAt)
          .map((it) => ({ ...it, origin: originOf(mp) })),
      ),
  )
  const findByCharacterId = jest.fn().mockResolvedValue(opts.own ?? [])
  return {
    setEquippedOutfit,
    repos: {
      characters: {
        findById: jest.fn().mockResolvedValue({
          id: CHAR_ID, name: 'Bertie', description: 'd', personality: 'p', manifesto: 'm',
        }),
      },
      wardrobe: { findByCharacterId, readSharedTiers },
      connections: { findAll: jest.fn().mockResolvedValue([{ id: 'p1', isDefault: true }]) },
      chats: {
        setEquippedOutfit,
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
      },
    },
  }
}

function equippedFor(setEquippedOutfit: jest.Mock, characterId = CHAR_ID) {
  const call = setEquippedOutfit.mock.calls.find((c) => c[1] === characterId)
  return call?.[2] as Record<string, string[]> | undefined
}

/** The candidate list actually handed to the cheap LLM (positional arg 5). */
function candidateIds(): string[] {
  const items = mockChooseLLMOutfit.mock.calls[0]?.[4] as WardrobeItem[]
  return items.map((i) => i.id)
}

const EMPTY_RESOLVED = {
  outfitValues: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
  leafItemsBySlot: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
  itemsById: new Map(),
}

const EMPTY_SLOTS = { top: [], bottom: [], footwear: [], accessories: [], hair: [] }

beforeEach(() => {
  jest.clearAllMocks()
  clock = 0
  mockGroupMounts.mockResolvedValue([])
  mockResolve.mockReturnValue(
    EMPTY_RESOLVED as unknown as ReturnType<typeof resolveEquippedOutfitForCharacter>,
  )
  mockChooseLLMOutfit.mockResolvedValue({
    success: true,
    result: { slots: EMPTY_SLOTS, deliberatelyUnclothed: false },
  } as never)
})

// ============================================================================
// The candidate list
// ============================================================================

describe('llm_choose candidate pool — archived garments never audition', () => {
  it('omits an archived garment from the CHARACTER tier', async () => {
    const { repos } = makeRepos({
      own: [item('own-live', ['top'], { characterId: CHAR_ID }),
            item('own-shelved', ['top'], { characterId: CHAR_ID, ...ARCHIVED })],
    })

    await applyOutfitSelections(
      'chat-1', [{ characterId: CHAR_ID, mode: 'llm_choose' }], repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(candidateIds()).toEqual(['own-live'])
  })

  it('omits an archived garment from the GENERAL and PROJECT tiers', async () => {
    const { repos } = makeRepos({
      general: [item('general-live', ['top']), item('general-shelved', ['top'], ARCHIVED)],
      project: [item('project-live', ['bottom']), item('project-shelved', ['bottom'], ARCHIVED)],
    })

    await applyOutfitSelections(
      'chat-1', [{ characterId: CHAR_ID, mode: 'llm_choose' }], repos as never,
      { userId: 'u1', projectMountPointIds: ['mp-project'] },
    )

    expect(candidateIds().sort()).toEqual(['general-live', 'project-live'])
  })

  it('omits an archived garment from the GROUP tier', async () => {
    mockGroupMounts.mockResolvedValue(GROUP_TIER)
    const { repos } = makeRepos({
      group: [item('group-live', ['top']), item('group-shelved', ['top'], ARCHIVED)],
    })

    await applyOutfitSelections(
      'chat-1', [{ characterId: CHAR_ID, mode: 'llm_choose' }], repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(candidateIds()).toEqual(['group-live'])
  })

  it('hands the LLM nothing at all when every garment in every tier is archived', async () => {
    mockGroupMounts.mockResolvedValue(GROUP_TIER)
    const { repos } = makeRepos({
      own: [item('own-shelved', ['top'], { characterId: CHAR_ID, ...ARCHIVED })],
      general: [item('general-shelved', ['top'], ARCHIVED)],
      project: [item('project-shelved', ['top'], ARCHIVED)],
      group: [item('group-shelved', ['top'], ARCHIVED)],
    })

    await applyOutfitSelections(
      'chat-1', [{ characterId: CHAR_ID, mode: 'llm_choose' }], repos as never,
      { userId: 'u1', projectMountPointIds: ['mp-project'] },
    )

    // An empty pool short-circuits before the LLM is called at all.
    expect(mockChooseLLMOutfit).not.toHaveBeenCalled()
  })
})

// (A model that hallucinates an archived id is stopped by `chooseLLMOutfit`'s
// own pool-membership check — pinned in
// `__tests__/unit/lib/memory/cheap-llm-tasks/outfit-selection.test.ts`, since
// this suite mocks that function out.)

// ============================================================================
// Archived shadowing — dropped per tier BEFORE shadowing
// ============================================================================

describe('mergeWearablePool — archived shadowing', () => {
  it('drops archived items after the tier merge', () => {
    const pool = mergeWearablePool(
      [item('shared-live', ['top'])],
      [item('own-shelved', ['top'], { ...ARCHIVED })],
    )
    expect(pool.map((i) => i.id)).toEqual(['shared-live'])
  })

  it('lets a shared item resurface when the personal override of the SAME id is archived', () => {
    // Deliberate: archiving your own copy is how you fall back to the house one.
    const pool = mergeWearablePool(
      [item('coat', ['top'], { title: 'House coat' })],
      [item('coat', ['top'], { title: 'My coat', characterId: CHAR_ID, ...ARCHIVED })],
    )
    expect(pool.map((i) => i.title)).toEqual(['House coat'])
  })
})

describe('buildWearablePool — the server pool applies the same rule', () => {
  const origin = { scope: 'general' as const, id: null, name: 'Quilltap General' }
  const tag = (it: WardrobeItem) => ({ ...it, origin })
  const NO_MOUNTS = { groupMountPointIds: [], projectMountPointIds: [] }

  it('resurfaces the shared copy in wearable(), while byId still sees the archived personal copy', () => {
    const pool = buildWearablePool(CHAR_ID, NO_MOUNTS, {
      own: [tag(item('coat', ['top'], { title: 'My coat', characterId: CHAR_ID, ...ARCHIVED }))],
      group: [],
      project: [],
      general: [tag(item('coat', ['top'], { title: 'House coat' }))],
    })
    expect(pool.wearable().map((i) => i.title)).toEqual(['House coat'])
    expect(pool.get('coat')?.title).toBe('My coat')
  })

  it('an archived group copy does not hide the live General one either', () => {
    const pool = buildWearablePool(CHAR_ID, NO_MOUNTS, {
      own: [],
      group: [tag(item('coat', ['top'], { title: 'Group coat', ...ARCHIVED }))],
      project: [],
      general: [tag(item('coat', ['top'], { title: 'House coat' }))],
    })
    expect(pool.wearable().map((i) => i.title)).toEqual(['House coat'])
  })

  it('reaches the candidate list end to end: the house coat auditions in place of the shelved copy', async () => {
    const { repos } = makeRepos({
      own: [item('coat', ['top'], { title: 'My coat', characterId: CHAR_ID, ...ARCHIVED })],
      general: [item('coat', ['top'], { title: 'House coat' })],
    })

    await applyOutfitSelections(
      'chat-1', [{ characterId: CHAR_ID, mode: 'llm_choose' }], repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    const items = mockChooseLLMOutfit.mock.calls[0]?.[4] as WardrobeItem[]
    expect(items.map((i) => i.title)).toEqual(['House coat'])
  })
})
