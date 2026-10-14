/**
 * Multi-tier coverage for `applyOutfitSelections`.
 *
 * The server used to dress characters from their own vault alone, so a
 * character whose wardrobe lives entirely in a shared tier (Quilltap General, a
 * project store, or one of their groups) opened a chat wearing nothing and
 * never reached the `llm_choose` LLM at all. These cases pin the merged
 * behaviour: merge every tier first, filter `isDefault` last, character shadows
 * shared on id.
 *
 * The group tier is read per character rather than with the batch, because it
 * follows each character's own memberships.
 */

import { applyOutfitSelections } from '@/lib/wardrobe/apply-outfit-selections'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { chooseLLMOutfit } from '@/lib/memory/cheap-llm-tasks/outfit-selection'
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped'
import { resolveGroupMountsForCharacter } from '@/lib/mount-index/tiered-mount-pool'
import { ledgerOver } from '@/__tests__/helpers/wardrobe-wear-ledger'

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

const CHAR_ID = 'c1c1c1c1-0000-0000-0000-000000000001'
const GENERAL_MP = 'general-mp'

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

/**
 * Repos over a fake store layout. `mounts` maps a mount-point id to the items
 * in its `Wardrobe/` folder; Quilltap General is `GENERAL_MP`. `own` is keyed
 * by character (or a flat list for `CHAR_ID`). `readSharedTiers` behaves like
 * the real one: every listed mount, later mounts shadowing earlier on id, each
 * item tagged with `originOf(mount)`.
 */
function makeRepos(
  opts: {
    own?: WardrobeItem[] | Record<string, WardrobeItem[]>
    mounts?: Record<string, WardrobeItem[]>
  } = {},
) {
  const setEquippedOutfit = jest.fn().mockResolvedValue(undefined)
  const mounts = opts.mounts ?? {}
  const readSharedTiers = jest.fn(
    async (
      mountPointIds: readonly string[],
      includeArchived: boolean,
      originOf: (mp: string) => unknown,
    ) => {
      const byId = new Map<string, WardrobeItem & { origin: unknown }>()
      for (const mp of mountPointIds) {
        for (const it of mounts[mp] ?? []) {
          if (!includeArchived && it.archivedAt) continue
          byId.set(it.id, { ...it, origin: originOf(mp) })
        }
      }
      return Array.from(byId.values())
    },
  )
  const own = opts.own ?? []
  const findByCharacterId = jest.fn(async (characterId: string) =>
    Array.isArray(own) ? (characterId === CHAR_ID ? own : []) : own[characterId] ?? [],
  )
  return {
    setEquippedOutfit,
    readSharedTiers,
    findByCharacterId,
    repos: {
      characters: {
        findById: jest.fn().mockResolvedValue({
          id: CHAR_ID,
          name: 'Bertie',
          description: 'd',
          personality: 'p',
          manifesto: 'm',
        }),
      },
      wardrobe: { findByCharacterId, readSharedTiers },
      connections: {
        findAll: jest.fn().mockResolvedValue([{ id: 'p1', isDefault: true }]),
      },
      chats: {
        setEquippedOutfit,
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
      },
      wardrobeWear: ledgerOver({ setEquippedOutfit }),
    },
  }
}

function equippedFor(setEquippedOutfit: jest.Mock, characterId = CHAR_ID) {
  const call = setEquippedOutfit.mock.calls.find((c) => c[1] === characterId)
  return call?.[2] as Record<string, string[]> | undefined
}

/** Every mount list `readSharedTiers` was asked for. */
function readsOf(readSharedTiers: jest.Mock): string[][] {
  return readSharedTiers.mock.calls.map((c) => Array.from(c[0] as string[]))
}

const EMPTY_RESOLVED = {
  outfitValues: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
  leafItemsBySlot: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
  itemsById: new Map(),
}

beforeEach(() => {
  jest.clearAllMocks()
  clock = 0
  mockGroupMounts.mockResolvedValue([])
  mockResolve.mockReturnValue(
    EMPTY_RESOLVED as unknown as ReturnType<typeof resolveEquippedOutfitForCharacter>,
  )
})

describe('applyOutfitSelections — shared wardrobe tiers', () => {
  const dressDefault = (repos: unknown, projectMountPointIds: string[] = []) =>
    applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'default' }],
      repos as never,
      { userId: 'u1', projectMountPointIds },
    )

  it('equips a Quilltap General default when the character vault is empty', async () => {
    const { repos, setEquippedOutfit } = makeRepos({
      own: [],
      mounts: { [GENERAL_MP]: [item('general-coat', ['top'], { isDefault: true })] },
    })

    await dressDefault(repos)

    expect(equippedFor(setEquippedOutfit)).toEqual({
      top: ['general-coat'],
      bottom: [],
      footwear: [],
      accessories: [],
      hair: [],
    })
  })

  it('layers personal, project and General defaults in createdAt order', async () => {
    // Created oldest-first: general, then project, then personal.
    const general = item('general-shirt', ['top'], { isDefault: true })
    const project = item('project-waistcoat', ['top'], { isDefault: true })
    const personal = item('own-jacket', ['top'], { isDefault: true, characterId: CHAR_ID })

    const { repos, setEquippedOutfit } = makeRepos({
      own: [personal],
      mounts: { [GENERAL_MP]: [general], 'mp-project': [project] },
    })

    await dressDefault(repos, ['mp-project'])

    expect(equippedFor(setEquippedOutfit)?.top).toEqual([
      'general-shirt',
      'project-waistcoat',
      'own-jacket',
    ])
  })

  it('does not equip a shared default the character shadows with isDefault:false', async () => {
    const { repos, setEquippedOutfit } = makeRepos({
      mounts: { [GENERAL_MP]: [item('livery', ['top'], { isDefault: true })] },
      own: [item('livery', ['top'], { isDefault: false, characterId: CHAR_ID })],
    })

    await dressDefault(repos)

    expect(equippedFor(setEquippedOutfit)).toEqual({
      top: [],
      bottom: [],
      footwear: [],
      accessories: [],
      hair: [],
    })
  })

  it('equips an item the character marks default even when the shared copy does not', async () => {
    const { repos, setEquippedOutfit } = makeRepos({
      mounts: { [GENERAL_MP]: [item('livery', ['top'], { isDefault: false })] },
      own: [item('livery', ['top'], { isDefault: true, characterId: CHAR_ID })],
    })

    await dressDefault(repos)

    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['livery'])
  })

  it('excludes an archived shared default', async () => {
    const { repos, setEquippedOutfit } = makeRepos({
      mounts: {
        [GENERAL_MP]: [
          item('archived-cloak', ['top'], {
            isDefault: true,
            archivedAt: '2026-02-02T00:00:00.000Z',
          }),
          item('live-cloak', ['top'], { isDefault: true }),
        ],
      },
    })

    await dressDefault(repos)

    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['live-cloak'])
  })

  it('hands the merged pool to chooseLLMOutfit for a character with an empty vault', async () => {
    mockChooseLLMOutfit.mockResolvedValue({
      success: true,
      result: {
        slots: { top: ['general-coat'], bottom: [], footwear: [], accessories: [], hair: [] },
        deliberatelyUnclothed: false,
      },
    } as Awaited<ReturnType<typeof chooseLLMOutfit>>)

    const { repos, setEquippedOutfit } = makeRepos({
      own: [],
      mounts: { [GENERAL_MP]: [item('general-coat', ['top'])] },
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(mockChooseLLMOutfit).toHaveBeenCalledTimes(1)
    const passedItems = mockChooseLLMOutfit.mock.calls[0][4] as WardrobeItem[]
    expect(passedItems.map((i) => i.id)).toEqual(['general-coat'])
    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['general-coat'])
  })

  it('falls back to defaults when the LLM picks nothing usable', async () => {
    mockChooseLLMOutfit.mockResolvedValue({
      success: true,
      result: {
        slots: { top: [], bottom: [], footwear: [], accessories: [], hair: [] },
        deliberatelyUnclothed: false,
      },
    } as Awaited<ReturnType<typeof chooseLLMOutfit>>)

    const { repos, setEquippedOutfit, readSharedTiers, findByCharacterId } = makeRepos({
      own: [],
      mounts: { [GENERAL_MP]: [item('general-coat', ['top'], { isDefault: true })] },
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: [] },
    )

    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['general-coat'])
    // The fallback reuses the memoised pool rather than reading anything again.
    expect(findByCharacterId).toHaveBeenCalledTimes(1)
    expect(readSharedTiers).toHaveBeenCalledTimes(1)
  })

  it('equips a group default when the character vault and the batch tiers are empty', async () => {
    mockGroupMounts.mockResolvedValue([
      { group: { id: 'grp-1', name: 'The Drones' }, mountPointIds: ['grp-mount'] },
    ])
    const { repos, setEquippedOutfit, readSharedTiers } = makeRepos({
      own: [],
      mounts: { 'grp-mount': [item('house-livery', ['top'], { isDefault: true })] },
    })

    await dressDefault(repos)

    expect(mockGroupMounts).toHaveBeenCalledWith(CHAR_ID)
    expect(readsOf(readSharedTiers)).toContainEqual(['grp-mount'])
    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['house-livery'])
  })

  it('lets a group item shadow the project/general copy of the same id', async () => {
    mockGroupMounts.mockResolvedValue([
      { group: { id: 'grp-1', name: 'The Drones' }, mountPointIds: ['grp-mount'] },
    ])
    const groupLivery = item('livery', ['top'], { isDefault: true, title: 'group livery' })
    const { repos, setEquippedOutfit } = makeRepos({
      own: [],
      mounts: {
        [GENERAL_MP]: [item('livery', ['top'], { isDefault: true, title: 'general livery' })],
        'mp-a': [item('livery', ['top'], { isDefault: true, title: 'project livery' })],
        'grp-mount': [groupLivery],
      },
    })
    const progress = {
      status: jest.fn(),
      log: jest.fn(),
      wardrobeStart: jest.fn(),
      wardrobeResult: jest.fn(),
      finish: jest.fn(),
      fail: jest.fn(),
    }
    mockChooseLLMOutfit.mockResolvedValue({
      success: true,
      result: {
        slots: { top: ['livery'], bottom: [], footwear: [], accessories: [], hair: [] },
        deliberatelyUnclothed: false,
      },
    } as Awaited<ReturnType<typeof chooseLLMOutfit>>)

    await dressDefault(repos, ['mp-a'])
    expect(equippedFor(setEquippedOutfit)?.top).toEqual(['livery'])

    // The model is shown one livery — the group's — tagged with its group.
    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: ['mp-a'], progress: progress as never },
    )
    const passed = mockChooseLLMOutfit.mock.calls[0][4] as Array<WardrobeItem & { origin: { scope: string; id: string | null } }>
    expect(passed).toHaveLength(1)
    expect(passed[0]).toMatchObject({ title: 'group livery', origin: { scope: 'group', id: 'grp-1' } })
  })

  it('skips the group read entirely for a character with no memberships', async () => {
    const { repos, readSharedTiers } = makeRepos({
      own: [],
      mounts: { [GENERAL_MP]: [item('general-coat', ['top'], { isDefault: true })] },
    })

    await dressDefault(repos)

    // General is the only shared read; no group (and no empty project) read.
    expect(readsOf(readSharedTiers)).toEqual([[GENERAL_MP]])
  })

  it('threads both shared tiers into the pool fetch and the preview resolve', async () => {
    mockChooseLLMOutfit.mockResolvedValue({
      success: true,
      result: {
        slots: { top: ['project-coat'], bottom: [], footwear: [], accessories: [], hair: [] },
        deliberatelyUnclothed: false,
      },
    } as Awaited<ReturnType<typeof chooseLLMOutfit>>)

    const progress = {
      status: jest.fn(),
      log: jest.fn(),
      wardrobeStart: jest.fn(),
      wardrobeResult: jest.fn(),
      finish: jest.fn(),
      fail: jest.fn(),
    }

    const { repos, readSharedTiers } = makeRepos({
      own: [],
      mounts: { 'mp-b': [item('project-coat', ['top'])] },
    })

    await applyOutfitSelections(
      'chat-1',
      [{ characterId: CHAR_ID, mode: 'llm_choose' }],
      repos as never,
      { userId: 'u1', projectMountPointIds: ['mp-a', 'mp-b'], progress: progress as never },
    )

    expect(readsOf(readSharedTiers)).toEqual(expect.arrayContaining([[GENERAL_MP], ['mp-a', 'mp-b']]))
    expect(mockResolve).toHaveBeenCalledTimes(1)
    const [pool, slots] = mockResolve.mock.calls[0]
    expect(pool.characterId).toBe(CHAR_ID)
    expect(pool.tiers).toEqual({ groupMountPointIds: [], projectMountPointIds: ['mp-a', 'mp-b'] })
    expect(pool.get('project-coat')?.origin.scope).toBe('project')
    expect(slots.top).toEqual(['project-coat'])
  })

  it('reads the shared tiers once for a batch of selections', async () => {
    const other = 'c1c1c1c1-0000-0000-0000-000000000002'
    const { repos, readSharedTiers, findByCharacterId } = makeRepos({
      own: [],
      mounts: {
        [GENERAL_MP]: [item('general-coat', ['top'], { isDefault: true })],
        'mp-a': [item('project-hat', ['accessories'], { isDefault: true })],
      },
    })

    await applyOutfitSelections(
      'chat-1',
      [
        { characterId: CHAR_ID, mode: 'default' },
        { characterId: other, mode: 'default' },
      ],
      repos as never,
      { userId: 'u1', projectMountPointIds: ['mp-a'] },
    )

    // General and the project stores: one read each for the whole batch.
    expect(readsOf(readSharedTiers)).toEqual(expect.arrayContaining([[GENERAL_MP], ['mp-a']]))
    expect(readSharedTiers).toHaveBeenCalledTimes(2)
    // Each character's own vault is still read once apiece.
    expect(findByCharacterId).toHaveBeenCalledTimes(2)
  })

  it('a batch shares project + General but gives each character only their own groups', async () => {
    const other = 'c1c1c1c1-0000-0000-0000-000000000002'
    mockGroupMounts.mockImplementation(async (characterId) =>
      characterId === CHAR_ID
        ? [{ group: { id: 'grp-1', name: 'The Drones' }, mountPointIds: ['grp-drones'] }]
        : [{ group: { id: 'grp-2', name: 'The Aunts' }, mountPointIds: ['grp-aunts'] }],
    )
    const { repos, setEquippedOutfit, readSharedTiers } = makeRepos({
      own: { [CHAR_ID]: [], [other]: [] },
      mounts: {
        [GENERAL_MP]: [item('general-coat', ['top'], { isDefault: true })],
        'mp-a': [item('project-hat', ['accessories'], { isDefault: true })],
        'grp-drones': [item('spats', ['footwear'], { isDefault: true })],
        'grp-aunts': [item('pince-nez', ['accessories'], { isDefault: true })],
      },
    })

    await applyOutfitSelections(
      'chat-1',
      [
        { characterId: CHAR_ID, mode: 'default' },
        { characterId: other, mode: 'default' },
      ],
      repos as never,
      { userId: 'u1', projectMountPointIds: ['mp-a'] },
    )

    const reads = readsOf(readSharedTiers)
    expect(reads.filter((r) => r.includes(GENERAL_MP))).toHaveLength(1)
    expect(reads.filter((r) => r.includes('mp-a'))).toHaveLength(1)
    expect(reads).toEqual(expect.arrayContaining([['grp-drones'], ['grp-aunts']]))

    const bertie = equippedFor(setEquippedOutfit, CHAR_ID)
    const gussie = equippedFor(setEquippedOutfit, other)
    expect(bertie).toMatchObject({ top: ['general-coat'], footwear: ['spats'], accessories: ['project-hat'] })
    expect(gussie).toMatchObject({ top: ['general-coat'], footwear: [] })
    expect(gussie?.accessories.sort()).toEqual(['pince-nez', 'project-hat'])
  })
})
