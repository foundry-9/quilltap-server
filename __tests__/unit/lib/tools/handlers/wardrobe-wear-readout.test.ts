/**
 * What a character learns about wear when it asks (spec §5.5).
 *
 *   - `wardrobe_list` ends each line with ` · last worn <relative>` or
 *     ` · never worn`, from one `findSummaries` call.
 *   - `wardrobe_read` adds a `wear:` paragraph after the slot occupancy:
 *     second person for the caller, names for everyone else, and
 *     "someone no longer in the household" for a wearer the ledger can no
 *     longer name.
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
} = require('@/lib/tools/handlers/wardrobe-list-handler')
const {
  executeWardrobeReadTool,
  formatWardrobeReadResults,
  formatWardrobeWearParagraph,
} = require('@/lib/tools/handlers/wardrobe-read-handler')

const NOW_MS = Date.parse('2026-10-07T12:00:00.000Z')
const THREE_DAYS_AGO = '2026-10-04T10:00:00.000Z'
const TWO_WEEKS_AGO = '2026-09-22T10:00:00.000Z'

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
      findSummaries: jest.fn(async (ids: string[]) =>
        new Map(ids.map((id) => [
          id,
          id === 'item-1'
            ? { wearCount: 4, firstWornAt: '2026-03-14T10:00:00.000Z', lastWornAt: THREE_DAYS_AGO, lastWornChatId: null }
            : NEVER_WORN,
        ])),
      ),
      findHistory: jest.fn().mockResolvedValue({ ...NEVER_WORN, wearers: [] }),
    },
  }
  ;(getRepositories as jest.Mock).mockReturnValue(repos)
})

describe('wardrobe_list', () => {
  it('reads every listed item\'s wear in one call and notes last worn / never worn', async () => {
    const output = await executeWardrobeListTool({}, context)

    expect(repos.wardrobeWear.findSummaries).toHaveBeenCalledTimes(1)
    expect(repos.wardrobeWear.findSummaries).toHaveBeenCalledWith(['item-1', 'item-2'])
    expect(output.items.map((i: any) => [i.item_id, i.wear_count, i.last_worn_at])).toEqual([
      ['item-1', 4, THREE_DAYS_AGO],
      ['item-2', 0, null],
    ])

    const lines = formatWardrobeListResults(output, NOW_MS).split('\n')
    expect(lines[1]).toBe('  [top] Greatcoat · last worn 3 days ago')
    expect(lines[2]).toBe('  [footwear] Spats · never worn')
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

  it('speaks to the caller in the second person and names everyone else', async () => {
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
      '  wear: Worn 4 times, first 14 Mar 2026, last 3 days ago by you. Also worn by Marguerite (once).',
    )
  })

  it('names the latest wearer when it is someone else, and folds the caller into "also"', async () => {
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
      '  wear: Worn 3 times, first 14 Mar 2026, last 2 weeks ago by Marguerite. Also worn by you (twice).',
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
      '  wear: Worn 5 times, first 14 Mar 2026, last 3 days ago by someone no longer in the household. ' +
        'Also worn by Marguerite (once) and someone no longer in the household (twice).',
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
    ).toBe('Worn once, 3 days ago by you.')
  })
})
