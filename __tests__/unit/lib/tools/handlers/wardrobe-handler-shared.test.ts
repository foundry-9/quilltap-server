/**
 * What still lives in lib/tools/handlers/wardrobe-handler-shared.ts: the
 * equipped-state read and the coverage summary built from the wearable pool.
 * (The announcement / notify helpers moved to lib/wardrobe/outfit-change-effects.ts
 * and are tested in __tests__/unit/lib/wardrobe/outfit-change-effects.test.ts.)
 */

const {
  buildWardrobeCoverageSummaryFromState,
  loadCurrentWardrobeState,
  normalizeNoItemSentinel,
} = require('@/lib/tools/handlers/wardrobe-handler-shared')

jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/wardrobe/outfit-change-effects', () => ({
  notifyWardrobeChanged: jest.fn(),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

const { buildWearablePool } = require('@/lib/wardrobe/pool')
const { makeEmptyEquippedSlots } = require('@/lib/schemas/wardrobe.types')

const OWN_ORIGIN = { scope: 'character', id: 'char-1', name: '' }

function item(id: string, title: string, types: string[], componentItemIds: string[] = []) {
  return {
    id,
    characterId: 'char-1',
    title,
    types,
    componentItemIds,
    appropriateness: null,
    description: null,
    isDefault: false,
    replace: false,
    archivedAt: null,
    origin: OWN_ORIGIN,
  }
}

function poolOf(items: any[]) {
  return buildWearablePool(
    'char-1',
    { groupMountPointIds: [], projectMountPointIds: [] },
    { own: items, group: [], project: [], general: [] },
  )
}

describe('wardrobe-handler-shared', () => {
  it('returns an empty equipped state when no outfit is stored', async () => {
    const repos = {
      chats: { getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null) },
    }
    const state = await loadCurrentWardrobeState(repos as any, 'chat-1', 'char-1')
    expect(state).toEqual(makeEmptyEquippedSlots())
  })

  it('treats LLM "no item" sentinels as undefined', () => {
    expect(normalizeNoItemSentinel('none')).toBeUndefined()
    expect(normalizeNoItemSentinel(' NULL ')).toBeUndefined()
    expect(normalizeNoItemSentinel('')).toBeUndefined()
    expect(normalizeNoItemSentinel('raincoat-1')).toBe('raincoat-1')
    expect(normalizeNoItemSentinel(undefined)).toBeUndefined()
  })

  it('builds the coverage summary from expanded composite leaves in the pool', () => {
    // Equipped state stores only the composite id; the summary must still
    // expand its components from the pool.
    const pool = poolOf([
      item('rain-outfit', 'Rain Outfit', ['top', 'bottom', 'footwear'], ['raincoat-1', 'jeans-1', 'wellies-1']),
      item('raincoat-1', 'Raincoat', ['top']),
      item('jeans-1', 'Blue Jeans', ['bottom']),
      item('wellies-1', 'Wellies', ['footwear']),
    ])

    const summary = buildWardrobeCoverageSummaryFromState(pool, {
      top: ['rain-outfit'],
      bottom: ['rain-outfit'],
      footwear: ['rain-outfit'],
      accessories: [],
      hair: [],
    })

    expect(summary).toContain('Raincoat')
    expect(summary).toContain('Blue Jeans')
    expect(summary).toContain('Wellies')
    expect(summary).not.toContain('Rain Outfit')
    expect(summary).not.toContain('completely naked')
  })

  it('renders a composite equipped to all four slots via its components (Friday regression)', () => {
    // Friday: wardrobe_wear put a composite id in all four slots and the
    // summary read "completely naked and unadorned" because the children were
    // never loaded.
    const pool = poolOf([
      item(
        'working-outfit',
        'Working Outfit — Composed',
        ['top', 'bottom', 'footwear', 'accessories'],
        ['sweater-1', 'jeans-1', 'boots-1', 'ring-1'],
      ),
      item('sweater-1', 'Navy Sweater', ['top']),
      item('jeans-1', 'Dark Jeans', ['bottom']),
      item('boots-1', 'Brown Boots', ['footwear']),
      item('ring-1', 'Wedding Ring', ['accessories']),
    ])

    const summary = buildWardrobeCoverageSummaryFromState(pool, {
      top: ['working-outfit'],
      bottom: ['working-outfit'],
      footwear: ['working-outfit'],
      accessories: ['working-outfit'],
      hair: [],
    })

    expect(summary).toContain('Navy Sweater')
    expect(summary).toContain('Dark Jeans')
    expect(summary).toContain('Brown Boots')
    expect(summary).toContain('Wedding Ring')
    expect(summary).not.toContain('completely naked')
    expect(summary).not.toContain('Working Outfit — Composed')
  })
})
