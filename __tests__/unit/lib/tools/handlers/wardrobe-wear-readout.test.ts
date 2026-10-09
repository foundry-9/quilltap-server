/**
 * What a character learns about wear when it asks (spec §5.5).
 *
 *   - `wardrobe_list` ends each line with the caller's own wear and the
 *     household's total as context (` · worn by you 3×, last 3 days ago
 *     (4× in the household)`), from one `findSummariesForWearer` call.
 *   - `wardrobe_read` adds a `wear:` paragraph after the slot occupancy:
 *     the caller's own record first, then the household's — names for
 *     everyone else, and "someone no longer in the household" for a wearer
 *     the ledger can no longer name.
 *
 * Bug 184: a shared item's household total must never read as the caller's
 * own. Bug 183: the 7–13 and 30–59 day rungs must not read "last last week".
 *
 * Every date is rendered against an injected clock so these stay stable.
 */

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/wardrobe/shared-tiers', () => ({
  resolveSharedWardrobeTiersForChat: jest.fn().mockResolvedValue({ groupMountPointIds: [], projectMountPointIds: [] }),
}))

const { getRepositories } = require('@/lib/repositories/factory')
const {
  executeWardrobeListTool,
  formatWardrobeListResults,
  formatWardrobeListWearNote,
} = require('@/lib/tools/handlers/wardrobe-list-handler')
const {
  executeWardrobeReadTool,
  formatWardrobeReadResults,
  formatWardrobeWearParagraph,
} = require('@/lib/tools/handlers/wardrobe-read-handler')

const NOW_MS = Date.parse('2026-10-07T12:00:00.000Z')
const THREE_DAYS_AGO = '2026-10-04T10:00:00.000Z'
const TWO_WEEKS_AGO = '2026-09-22T10:00:00.000Z'
const NINE_DAYS_AGO = '2026-09-28T10:00:00.000Z'
const FORTY_DAYS_AGO = '2026-08-28T10:00:00.000Z'

const CALLER = '11111111-1111-4111-8111-111111111111'
const MARGUERITE = '22222222-2222-4222-8222-222222222222'
const GONE = '33333333-3333-4333-8333-333333333333'

const NEVER_WORN = { wearCount: 0, firstWornAt: null, lastWornAt: null, lastWornChatId: null }

const context = { userId: 'user-1', chatId: 'chat-1', characterId: CALLER }

function wardrobeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    characterId: CALLER,
    title: 'Greatcoat',
    description: null,
    imagePrompt: null,
    types: ['top'],
    componentItemIds: [],
    appropriateness: null,
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-03-12T00:00:00.000Z',
    updatedAt: '2026-03-12T00:00:00.000Z',
    ...overrides,
  }
}

let repos: any

beforeEach(() => {
  jest.clearAllMocks()
  repos = {
    wardrobe: {
      findWearablePoolForCharacter: jest.fn().mockResolvedValue([
        wardrobeItem(),
        wardrobeItem({ id: 'item-2', title: 'Spats', types: ['footwear'] }),
      ]),
      findByIdForCharacter: jest.fn().mockResolvedValue(wardrobeItem()),
      findByIdsForCharacter: jest.fn().mockResolvedValue([]),
    },
    chats: {
      getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
    },
    characters: {
      findByIdRaw: jest.fn(async (id: string) =>
        id === MARGUERITE ? { id: MARGUERITE, name: 'Marguerite' } : id === CALLER ? { id: CALLER, name: 'Vivienne' } : null,
      ),
    },
    wardrobeWear: {
      findSummariesForWearer: jest.fn(async (ids: string[]) =>
        new Map(ids.map((id) => [
          id,
          id === 'item-1'
            ? {
                household: { wearCount: 4, firstWornAt: '2026-03-14T10:00:00.000Z', lastWornAt: THREE_DAYS_AGO, lastWornChatId: null },
                yours: { wearCount: 3, firstWornAt: '2026-04-01T10:00:00.000Z', lastWornAt: THREE_DAYS_AGO, lastWornChatId: null },
              }
            : { household: NEVER_WORN, yours: NEVER_WORN },
        ])),
      ),
      findHistory: jest.fn().mockResolvedValue({ ...NEVER_WORN, wearers: [] }),
    },
  }
  ;(getRepositories as jest.Mock).mockReturnValue(repos)
})

describe('wardrobe_list', () => {
  it('reads every listed item\'s wear in one call, the caller\'s share kept apart', async () => {
    const output = await executeWardrobeListTool({}, context)

    expect(repos.wardrobeWear.findSummariesForWearer).toHaveBeenCalledTimes(1)
    expect(repos.wardrobeWear.findSummariesForWearer).toHaveBeenCalledWith(['item-1', 'item-2'], CALLER)
    expect(
      output.items.map((i: any) => [i.item_id, i.wear_count, i.last_worn_at, i.worn_by_you, i.last_worn_by_you_at]),
    ).toEqual([
      ['item-1', 4, THREE_DAYS_AGO, 3, THREE_DAYS_AGO],
      ['item-2', 0, null, 0, null],
    ])

    const lines = formatWardrobeListResults(output, NOW_MS).split('\n')
    expect(lines[1]).toBe('  [top] Greatcoat · worn by you 3×, last 3 days ago (4× in the household)')
    expect(lines[2]).toBe('  [footwear] Spats · never worn')
  })

  it('never hands the household\'s count to a caller who has not worn it (bug 184)', () => {
    expect(
      formatWardrobeListWearNote(
        { wear_count: 115, last_worn_at: THREE_DAYS_AGO, worn_by_you: 0, last_worn_by_you_at: null },
        NOW_MS,
      ),
    ).toBe(' · never worn by you (worn 115× by others)')
  })

  it('drops the household aside when the caller is the only wearer', () => {
    expect(
      formatWardrobeListWearNote(
        { wear_count: 1, last_worn_at: THREE_DAYS_AGO, worn_by_you: 1, last_worn_by_you_at: THREE_DAYS_AGO },
        NOW_MS,
      ),
    ).toBe(' · worn by you once, last 3 days ago')
  })

  it.each([
    [NINE_DAYS_AGO, ' · worn by you 2×, last a week ago'],
    [FORTY_DAYS_AGO, ' · worn by you 2×, last a month ago'],
  ])('does not double "last" on the week and month rungs (bug 183): %s', (when, note) => {
    expect(
      formatWardrobeListWearNote({ wear_count: 2, last_worn_at: when, worn_by_you: 2, last_worn_by_you_at: when }, NOW_MS),
    ).toBe(note)
  })
})

describe('wardrobe_read', () => {
  async function readFormatted(): Promise<string> {
    const output = await executeWardrobeReadTool({ item_id: 'item-1' }, context)
    expect(output.success).toBe(true)
    return formatWardrobeReadResults(output, NOW_MS)
  }

  it('says "Never worn." for an item with no tally', async () => {
    const text = await readFormatted()
    const lines = text.split('\n')
    // The wear paragraph follows the slot occupancy.
    expect(lines[lines.length - 2]).toBe('  equipped: no')
    expect(lines[lines.length - 1]).toBe('  wear: Never worn.')
  })

  it('leads with the caller\'s own record, then the household\'s', async () => {
    repos.wardrobeWear.findHistory.mockResolvedValue({
      wearCount: 4,
      firstWornAt: '2026-03-14T10:00:00.000Z',
      lastWornAt: THREE_DAYS_AGO,
      lastWornChatId: null,
      wearers: [
        { characterId: CALLER, wearCount: 3, firstWornAt: '2026-04-01T10:00:00.000Z', lastWornAt: THREE_DAYS_AGO, lastWornChatId: null },
        { characterId: MARGUERITE, wearCount: 1, firstWornAt: '2026-03-14T10:00:00.000Z', lastWornAt: '2026-03-14T10:00:00.000Z', lastWornChatId: null },
      ],
    })

    expect(await readFormatted()).toContain(
      '  wear: You have worn it 3 times, first 1 Apr 2026, last 3 days ago. ' +
        'Worn 4 times in all; also by Marguerite (once).',
    )
  })

  it('names the latest wearer when it is someone else, after the caller\'s own count', async () => {
    repos.wardrobeWear.findHistory.mockResolvedValue({
      wearCount: 3,
      firstWornAt: '2026-03-14T10:00:00.000Z',
      lastWornAt: TWO_WEEKS_AGO,
      lastWornChatId: null,
      wearers: [
        { characterId: MARGUERITE, wearCount: 1, firstWornAt: TWO_WEEKS_AGO, lastWornAt: TWO_WEEKS_AGO, lastWornChatId: null },
        { characterId: CALLER, wearCount: 2, firstWornAt: '2026-03-14T10:00:00.000Z', lastWornAt: '2026-04-01T10:00:00.000Z', lastWornChatId: null },
      ],
    })

    expect(await readFormatted()).toContain(
      '  wear: You have worn it twice, first 14 Mar 2026, last 6 months ago. ' +
        'Worn 3 times in all, most recently 2 weeks ago by Marguerite; also by Marguerite (once).',
    )
  })

  it('calls a deleted or unattributed wearer "someone no longer in the household"', async () => {
    repos.wardrobeWear.findHistory.mockResolvedValue({
      wearCount: 5,
      firstWornAt: '2026-03-14T10:00:00.000Z',
      lastWornAt: THREE_DAYS_AGO,
      lastWornChatId: null,
      wearers: [
        { characterId: GONE, wearCount: 2, firstWornAt: '2026-05-01T10:00:00.000Z', lastWornAt: THREE_DAYS_AGO, lastWornChatId: null },
        { characterId: MARGUERITE, wearCount: 1, firstWornAt: '2026-04-01T10:00:00.000Z', lastWornAt: '2026-04-01T10:00:00.000Z', lastWornChatId: null },
        { characterId: null, wearCount: 2, firstWornAt: '2026-03-14T10:00:00.000Z', lastWornAt: '2026-03-20T10:00:00.000Z', lastWornChatId: null },
      ],
    })

    const output = await executeWardrobeReadTool({ item_id: 'item-1' }, context)
    expect(output.wear.wearers.map((w: any) => [w.character_id, w.departed, w.is_you])).toEqual([
      [GONE, true, false],
      [MARGUERITE, false, false],
      [null, true, false],
    ])
    expect(formatWardrobeReadResults(output, NOW_MS)).toContain(
      '  wear: You have never worn it. Worn 5 times by others, first 14 Mar 2026, ' +
        'last 3 days ago by someone no longer in the household: someone no longer in the household (twice), ' +
        'Marguerite (once) and someone no longer in the household (twice).',
    )
  })

  it('reads a single wear as "once" without a separate first date', () => {
    expect(
      formatWardrobeWearParagraph(
        {
          wear_count: 1,
          first_worn_at: THREE_DAYS_AGO,
          last_worn_at: THREE_DAYS_AGO,
          wearers: [
            { character_id: CALLER, name: 'Vivienne', is_you: true, departed: false, wear_count: 1, first_worn_at: THREE_DAYS_AGO, last_worn_at: THREE_DAYS_AGO },
          ],
        },
        NOW_MS,
      ),
    ).toBe('You have worn it once, 3 days ago.')
  })

  it('gives the caller their own count in a crowded household (bug 184)', () => {
    const wearer = (id: string, name: string, count: number, last: string, isYou = false) => ({
      character_id: id, name, is_you: isYou, departed: false, wear_count: count,
      first_worn_at: '2026-06-13T10:00:00.000Z', last_worn_at: last,
    })
    expect(
      formatWardrobeWearParagraph(
        {
          wear_count: 116,
          first_worn_at: '2026-06-13T10:00:00.000Z',
          last_worn_at: '2026-10-07T09:00:00.000Z',
          wearers: [
            wearer(CALLER, 'Vivienne', 13, '2026-10-07T09:00:00.000Z', true),
            wearer(MARGUERITE, 'Laura', 25, THREE_DAYS_AGO),
            wearer(GONE, 'Gary', 78, TWO_WEEKS_AGO),
          ],
        },
        NOW_MS,
      ),
    ).toBe(
      'You have worn it 13 times, first 13 Jun 2026, last today. ' +
        'Worn 116 times in all; also by Laura (25 times) and Gary (78 times).',
    )
  })

  it('reads a single wear by someone else plainly', () => {
    expect(
      formatWardrobeWearParagraph(
        {
          wear_count: 1,
          first_worn_at: THREE_DAYS_AGO,
          last_worn_at: THREE_DAYS_AGO,
          wearers: [
            { character_id: MARGUERITE, name: 'Marguerite', is_you: false, departed: false, wear_count: 1, first_worn_at: THREE_DAYS_AGO, last_worn_at: THREE_DAYS_AGO },
          ],
        },
        NOW_MS,
      ),
    ).toBe('You have never worn it. Worn once, 3 days ago by Marguerite.')
  })

  it.each([
    [NINE_DAYS_AGO, 'a week ago'],
    [FORTY_DAYS_AGO, 'a month ago'],
  ])('does not double "last" on the week and month rungs (bug 183): %s', (when, phrase) => {
    expect(
      formatWardrobeWearParagraph(
        {
          wear_count: 2,
          first_worn_at: '2026-03-14T10:00:00.000Z',
          last_worn_at: when,
          wearers: [
            { character_id: CALLER, name: 'Vivienne', is_you: true, departed: false, wear_count: 2, first_worn_at: '2026-03-14T10:00:00.000Z', last_worn_at: when },
          ],
        },
        NOW_MS,
      ),
    ).toBe(`You have worn it twice, first 14 Mar 2026, last ${phrase}.`)
  })
})
