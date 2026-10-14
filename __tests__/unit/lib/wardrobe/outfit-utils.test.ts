import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { computeDisplacedSlots, wearItemIntoSlots } from '@/lib/wardrobe/slot-ops'
import { applyDisplacement } from '@/lib/wardrobe/outfit-displacement'
import { resolveWearable } from '@/lib/wardrobe/wear-ops'
import { buildWearablePool } from '@/lib/wardrobe/pool'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { describeOutfit, decorateOutfitItems } from '@/lib/wardrobe/outfit-description'
import { ledgerOver } from '@/__tests__/helpers/wardrobe-wear-ledger'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('wardrobe outfit utilities', () => {
  describe('describeOutfit', () => {
    it('describes a completely empty outfit as naked and unadorned', () => {
      expect(
        describeOutfit({
          top: [],
          bottom: [],
          footwear: [],
          accessories: [],
          hair: [],
        })
      ).toBe('- completely naked and unadorned\n')
    })

    it('uses topless and bottomless fallbacks while preserving equipped items', () => {
      expect(
        describeOutfit({
          top: [],
          bottom: ['striped trousers'],
          footwear: [],
          accessories: ['silver rings'],
          hair: [],
        })
      ).toBe([
        '- **top:** topless',
        '- **bottom:** striped trousers',
        '- **footwear:** barefoot',
        '- **accessories:** silver rings',
        '',
      ].join('\n'))
    })

    it('collapses slots sharing the same value onto a single line', () => {
      expect(
        describeOutfit({
          top: ['Working Outfit'],
          bottom: ['Working Outfit'],
          footwear: ['Working Outfit'],
          accessories: ['Working Outfit'],
          hair: [],
        })
      ).toBe('- **top, bottom, footwear, accessories:** Working Outfit\n')
    })

    it('groups multi-slot items but keeps distinct slots separate', () => {
      expect(
        describeOutfit({
          top: ['silk dress'],
          bottom: ['silk dress'],
          footwear: ['leather boots'],
          accessories: ['pearl earrings'],
          hair: [],
        })
      ).toBe([
        '- **top, bottom:** silk dress',
        '- **footwear:** leather boots',
        '- **accessories:** pearl earrings',
        '',
      ].join('\n'))
    })

    it('comma-joins multiple items in a single slot for layering', () => {
      expect(
        describeOutfit({
          top: ['t-shirt', 'cardigan'],
          bottom: ['jeans'],
          footwear: ['sneakers'],
          accessories: [],
          hair: [],
        })
      ).toBe([
        '- **top:** t-shirt, cardigan',
        '- **bottom:** jeans',
        '- **footwear:** sneakers',
        '- **accessories:** no accessories',
        '',
      ].join('\n'))
    })

    // Hair is styling, not a garment: it must never produce negative space and
    // must never be mistaken for clothing by the nudity collapses.
    it('renders nothing for an empty hair slot on a dressed character', () => {
      const out = describeOutfit({
        top: ['linen shirt'],
        bottom: ['jeans'],
        footwear: ['boots'],
        accessories: [],
        hair: [],
      })
      expect(out).not.toContain('hair')
      expect(out).toBe([
        '- **top:** linen shirt',
        '- **bottom:** jeans',
        '- **footwear:** boots',
        '- **accessories:** no accessories',
        '',
      ].join('\n'))
    })

    it('renders a set hairdo last, after every clothing slot', () => {
      expect(
        describeOutfit({
          top: ['linen shirt'],
          bottom: ['jeans'],
          footwear: ['boots'],
          accessories: ['signet ring'],
          hair: ['braided crown, silver pins'],
        })
      ).toBe([
        '- **top:** linen shirt',
        '- **bottom:** jeans',
        '- **footwear:** boots',
        '- **accessories:** signet ring',
        '- **hair:** braided crown, silver pins',
        '',
      ].join('\n'))
    })

    it('keeps the naked-and-unadorned collapse when hair is empty too', () => {
      expect(
        describeOutfit({
          top: [],
          bottom: [],
          footwear: [],
          accessories: [],
          hair: [],
        })
      ).toBe('- completely naked and unadorned\n')
    })

    it('does not collapse to naked-and-unadorned when only the hair is styled', () => {
      const out = describeOutfit({
        top: [],
        bottom: [],
        footwear: [],
        accessories: [],
        hair: ['braided'],
      })
      expect(out).not.toContain('completely naked and unadorned')
      expect(out).toContain('- naked')
      expect(out).toContain('- **hair:** braided')
      expect(out).toBe([
        '- naked',
        '- **footwear:** barefoot',
        '- **accessories:** no accessories',
        '- **hair:** braided',
        '',
      ].join('\n'))
    })
  })

  describe('decorateOutfitItems', () => {
    it('uses the title in the prose (non-titleOnly) path, decorating with description', () => {
      expect(
        decorateOutfitItems(
          [{ title: 'Charcoal Sweater', description: 'hand-knit', imagePrompt: 'IGNORED' }],
        )
      ).toEqual(['Charcoal Sweater (hand-knit)'])
    })

    it('prefers imagePrompt over title in the titleOnly (image) path', () => {
      expect(
        decorateOutfitItems(
          [{ title: 'Captain Rank Chest', imagePrompt: 'intricate burnished-gold rank glyph' }],
          { titleOnly: true },
        )
      ).toEqual(['intricate burnished-gold rank glyph'])
    })

    it('falls back to title when imagePrompt is absent or blank (image path)', () => {
      expect(
        decorateOutfitItems(
          [
            { title: 'Plain Tunic' },
            { title: 'Blank Cue', imagePrompt: '   ' },
            { title: 'Null Cue', imagePrompt: null },
          ],
          { titleOnly: true },
        )
      ).toEqual(['Plain Tunic', 'Blank Cue', 'Null Cue'])
    })

    it('ignores imagePrompt entirely in the prose path even when set', () => {
      expect(
        decorateOutfitItems(
          [{ title: 'Plain Tunic', imagePrompt: 'should not appear' }],
        )
      ).toEqual(['Plain Tunic'])
    })
  })

  describe('computeDisplacedSlots (pure)', () => {
    const baseSlots = {
      top: ['dress-1'],
      bottom: ['dress-1'],
      footwear: ['boots-1'],
      accessories: [],
      hair: [],
    }

    it('wear mode layers a leaf garment into its slot when the replace flag is off', () => {
      const next = computeDisplacedSlots(
        { top: ['shirt-1'], bottom: ['jeans-1'], footwear: [], accessories: [], hair: [] },
        {
          mode: 'wear',
          item: { id: 'cardigan-1', types: ['top'] },
        },
      )

      expect(next).toEqual({
        top: ['shirt-1', 'cardigan-1'],
        bottom: ['jeans-1'],
        footwear: [],
        accessories: [],
        hair: [],
      })
    })

    it('wear mode layers a multi-slot dress into both top and bottom (replace flag off)', () => {
      const next = computeDisplacedSlots(
        { top: ['shirt-1'], bottom: ['jeans-1'], footwear: [], accessories: [], hair: [] },
        {
          mode: 'wear',
          item: { id: 'dress-1', types: ['top', 'bottom'] },
        },
      )

      expect(next).toEqual({
        top: ['shirt-1', 'dress-1'],
        bottom: ['jeans-1', 'dress-1'],
        footwear: [],
        accessories: [],
        hair: [],
      })
    })

    it('wear mode replaces every covered slot when the item replace flag is on', () => {
      const next = computeDisplacedSlots(
        { top: ['shirt-1'], bottom: ['jeans-1'], footwear: [], accessories: [], hair: [] },
        {
          mode: 'wear',
          item: { id: 'dress-1', types: ['top', 'bottom'], replace: true },
        },
      )

      expect(next).toEqual({
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: [],
        accessories: [],
        hair: [],
      })
    })

    it('wear mode layers an additive composite onto existing slots (replace=false)', () => {
      const next = computeDisplacedSlots(
        { top: ['shirt-1'], bottom: ['jeans-1'], footwear: [], accessories: [], hair: [] },
        {
          mode: 'wear',
          item: { id: 'outfit-1', types: ['top', 'bottom'], componentItemIds: ['a', 'b'] },
        },
      )

      expect(next).toEqual({
        top: ['shirt-1', 'outfit-1'],
        bottom: ['jeans-1', 'outfit-1'],
        footwear: [],
        accessories: [],
        hair: [],
      })
    })

    it('wear mode does not duplicate an item already in a slot', () => {
      const next = computeDisplacedSlots(
        { top: ['outfit-1'], bottom: ['outfit-1'], footwear: [], accessories: [], hair: [] },
        {
          mode: 'wear',
          item: { id: 'outfit-1', types: ['top', 'bottom'], componentItemIds: ['a'] },
        },
      )

      expect(next.top).toEqual(['outfit-1'])
      expect(next.bottom).toEqual(['outfit-1'])
    })

    it('wear mode clears every designated slot for a replace composite (Naked)', () => {
      const next = computeDisplacedSlots(
        { top: ['shirt-1'], bottom: ['jeans-1'], footwear: ['boots-1'], accessories: ['watch-1'], hair: [] },
        {
          mode: 'wear',
          item: {
            id: 'naked-1',
            types: ['top', 'bottom', 'footwear', 'accessories'],
            componentItemIds: ['ring-1'],
            replace: true,
          },
        },
      )

      // Every designated slot is cleared and holds only the composite id; the
      // ring leaf is routed to accessories at read time, leaving the rest bare.
      expect(next).toEqual({
        top: ['naked-1'],
        bottom: ['naked-1'],
        footwear: ['naked-1'],
        accessories: ['naked-1'],
        hair: [],
      })
    })

    it('replace mode force-swaps every covered slot regardless of the flag', () => {
      const next = computeDisplacedSlots(
        { top: ['shirt-1', 'cardigan-1'], bottom: ['jeans-1'], footwear: [], accessories: [], hair: [] },
        {
          mode: 'replace',
          item: { id: 'dress-1', types: ['top', 'bottom'] },
        },
      )

      expect(next).toEqual({
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: [],
        accessories: [],
        hair: [],
      })
    })

    it('add_to_slot mode appends to the slot array without displacing siblings', () => {
      const next = computeDisplacedSlots(
        { top: ['t-shirt-1'], bottom: [], footwear: [], accessories: [], hair: [] },
        {
          mode: 'add_to_slot',
          slot: 'top',
          item: { id: 'cardigan-1', types: ['top'] },
        },
      )

      expect(next).toEqual({
        top: ['t-shirt-1', 'cardigan-1'],
        bottom: [],
        footwear: [],
        accessories: [],
        hair: [],
      })
    })

    it('add_to_slot mode is a no-op when the item is already in the slot', () => {
      const next = computeDisplacedSlots(
        { top: ['t-shirt-1'], bottom: [], footwear: [], accessories: [], hair: [] },
        {
          mode: 'add_to_slot',
          slot: 'top',
          item: { id: 't-shirt-1', types: ['top'] },
        },
      )

      expect(next.top).toEqual(['t-shirt-1'])
    })

    it('remove_from_slot with an itemId filters that id out of the slot', () => {
      const next = computeDisplacedSlots(
        { top: ['t-shirt-1', 'cardigan-1'], bottom: [], footwear: [], accessories: [], hair: [] },
        {
          mode: 'remove_from_slot',
          slot: 'top',
          itemId: 't-shirt-1',
        },
      )

      expect(next.top).toEqual(['cardigan-1'])
    })

    it('remove_from_slot without an itemId clears the slot entirely', () => {
      const next = computeDisplacedSlots(
        { top: ['t-shirt-1', 'cardigan-1'], bottom: [], footwear: [], accessories: [], hair: [] },
        {
          mode: 'remove_from_slot',
          slot: 'top',
        },
      )

      expect(next.top).toEqual([])
    })

    it('clear_slot empties the named slot but leaves others alone', () => {
      const next = computeDisplacedSlots(baseSlots, {
        mode: 'clear_slot',
        slot: 'top',
      })

      expect(next).toEqual({
        top: [],
        bottom: ['dress-1'],
        footwear: ['boots-1'],
        accessories: [],
        hair: [],
      })
    })
  })

  describe('wearItemIntoSlots / replace mode (pure)', () => {
    const worn = { top: ['shirt-1'], bottom: ['jeans-1'], footwear: [], accessories: [], hair: [] }

    it('wearItemIntoSlots layers when the flag is off and replaces when on', () => {
      expect(
        wearItemIntoSlots(worn, { id: 'dress-1', types: ['top', 'bottom'] }),
      ).toEqual({
        top: ['shirt-1', 'dress-1'],
        bottom: ['jeans-1', 'dress-1'],
        footwear: [],
        accessories: [],
        hair: [],
      })

      expect(
        wearItemIntoSlots(worn, { id: 'dress-1', types: ['top', 'bottom'], replace: true }),
      ).toEqual({
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: [],
        accessories: [],
        hair: [],
      })
    })

    it('replace mode always clears and sets the covered slots', () => {
      expect(
        computeDisplacedSlots(
          { top: ['shirt-1', 'cardigan-1'], bottom: ['jeans-1'], footwear: [], accessories: [], hair: [] },
          { mode: 'replace', item: { id: 'dress-1', types: ['top', 'bottom'] } },
        ),
      ).toEqual({
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: [],
        accessories: [],
        hair: [],
      })
    })

    it('does not mutate the input slots', () => {
      const input = { top: ['shirt-1'], bottom: [], footwear: [], accessories: [], hair: [] }
      wearItemIntoSlots(input, { id: 'cardigan-1', types: ['top'] })
      expect(input.top).toEqual(['shirt-1'])
    })
  })

  describe('applyDisplacement (load → gesture → commit)', () => {
    let repos: {
      chats: {
        getEquippedOutfitForCharacter: jest.Mock
        setEquippedOutfit: jest.Mock
      }
      wardrobeWear: ReturnType<typeof ledgerOver>
    }

    beforeEach(() => {
      repos = {
        chats: {
          getEquippedOutfitForCharacter: jest.fn(),
          setEquippedOutfit: jest.fn(async (_chatId: string, _characterId: string, slots: unknown) => slots),
        },
      } as typeof repos
      repos.wardrobeWear = ledgerOver(repos.chats)
    })

    it('wear layers a multi-slot leaf garment when the replace flag is off', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['shirt-1'],
        bottom: ['jeans-1'],
        footwear: ['boots-1'],
        accessories: [],
        hair: [],
      })

      const result = await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'wear', item: {
        id: 'dress-1',
        types: ['top', 'bottom'],
      } })

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: ['shirt-1', 'dress-1'],
        bottom: ['jeans-1', 'dress-1'],
        footwear: ['boots-1'],
        accessories: [],
        hair: [],
      })
      expect(result).toEqual({
        top: ['shirt-1', 'dress-1'],
        bottom: ['jeans-1', 'dress-1'],
        footwear: ['boots-1'],
        accessories: [],
        hair: [],
      })
    })

    it('wear replaces every covered slot when the item replace flag is on', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['shirt-1'],
        bottom: ['jeans-1'],
        footwear: ['boots-1'],
        accessories: [],
        hair: [],
      })

      const result = await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'wear', item: {
        id: 'dress-1',
        types: ['top', 'bottom'],
        replace: true,
      } })

      expect(result).toEqual({
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: ['boots-1'],
        accessories: [],
        hair: [],
      })
    })

    it('replace force-swaps every covered slot regardless of the flag', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['shirt-1', 'cardigan-1'],
        bottom: ['jeans-1'],
        footwear: ['boots-1'],
        accessories: [],
        hair: [],
      })

      const result = await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'replace', item: {
        id: 'dress-1',
        types: ['top', 'bottom'],
      } })

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: ['boots-1'],
        accessories: [],
        hair: [],
      })
      expect(result.top).toEqual(['dress-1'])
      expect(result.bottom).toEqual(['dress-1'])
    })

    it('wear starts from empty slots when nothing is equipped yet', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue(null)

      const result = await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'wear', item: {
        id: 'dress-1',
        types: ['top', 'bottom'],
      } })

      expect(result).toEqual({
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: [],
        accessories: [],
        hair: [],
      })
    })

    it('wear stores a composite whole when no pool lookup is given', async () => {
      // Composite "rain outfit" covers top/bottom/footwear via componentItemIds;
      // its own types reflect the slots it covers, and its id is what's stored.
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: [],
        bottom: [],
        footwear: [],
        accessories: [],
        hair: [],
      })

      await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'wear', item: {
        id: 'rain-outfit',
        types: ['top', 'bottom', 'footwear'],
      } })

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: ['rain-outfit'],
        bottom: ['rain-outfit'],
        footwear: ['rain-outfit'],
        accessories: [],
        hair: [],
      })
    })

    it('add_to_slot appends to the slot array', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['t-shirt-1'],
        bottom: [],
        footwear: [],
        accessories: [],
        hair: [],
      })

      const result = await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'add_to_slot', slot: 'top', item: {
        id: 'cardigan-1',
        types: ['top'],
      } })

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: ['t-shirt-1', 'cardigan-1'],
        bottom: [],
        footwear: [],
        accessories: [],
        hair: [],
      })
      expect(result.top).toEqual(['t-shirt-1', 'cardigan-1'])
    })

    it('add_to_slot is a no-op when the item is already in the slot', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['cardigan-1'],
        bottom: [],
        footwear: [],
        accessories: [],
        hair: [],
      })

      const result = await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'add_to_slot', slot: 'top', item: {
        id: 'cardigan-1',
        types: ['top'],
      } })

      // The slot still reflects a single occurrence; we don't double-append.
      expect(result.top).toEqual(['cardigan-1'])
    })

    it('remove_from_slot with an itemId filters that id out of the slot', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['t-shirt-1', 'cardigan-1'],
        bottom: [],
        footwear: [],
        accessories: [],
        hair: [],
      })

      const result = await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'remove_from_slot', slot: 'top', itemId: 't-shirt-1' })

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: ['cardigan-1'],
        bottom: [],
        footwear: [],
        accessories: [],
        hair: [],
      })
      expect(result.top).toEqual(['cardigan-1'])
    })

    it('remove_from_slot without an itemId clears the slot entirely', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['t-shirt-1', 'cardigan-1'],
        bottom: ['jeans-1'],
        footwear: [],
        accessories: [],
        hair: [],
      })

      const result = await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'remove_from_slot', slot: 'top' })

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: [],
        bottom: ['jeans-1'],
        footwear: [],
        accessories: [],
        hair: [],
      })
      expect(result.top).toEqual([])
    })
  })
  describe('applyDisplacement — ledger source and composite credit', () => {
    let repos: {
      chats: { getEquippedOutfitForCharacter: jest.Mock; setEquippedOutfit: jest.Mock }
      wardrobeWear: ReturnType<typeof ledgerOver>
    }
    const EMPTY = { top: [], bottom: [], footwear: [], accessories: [], hair: [] }

    beforeEach(() => {
      repos = {
        chats: {
          getEquippedOutfitForCharacter: jest.fn(async () => ({ ...EMPTY, top: ['shirt-1'] })),
          setEquippedOutfit: jest.fn(async (_c: string, _ch: string, slots: unknown) => slots),
        },
      } as typeof repos
      repos.wardrobeWear = ledgerOver(repos.chats)
    })

    it('commits put-on gestures with the caller source (default ui)', async () => {
      await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'wear', item: { id: 'hat-1', types: ['accessories'] } })
      await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'wear', item: { id: 'hat-1', types: ['accessories'] } }, 'tool')
      const sources = repos.wardrobeWear.commitEquippedOutfit.mock.calls.map((c) => (c[0] as { source: string }).source)
      expect(sources).toEqual(['ui', 'tool'])
    })

    it("commits take-off gestures as 'take-off' whatever source is passed", async () => {
      await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'remove_from_slot', slot: 'top', itemId: 'shirt-1' }, 'tool')
      await applyDisplacement(repos, 'chat-1', 'char-1', { mode: 'clear_slot', slot: 'top' })
      const sources = repos.wardrobeWear.commitEquippedOutfit.mock.calls.map((c) => (c[0] as { source: string }).source)
      expect(sources).toEqual(['take-off', 'take-off'])
    })

    it('dissolves a composite through the pool lookup and claims it as a worn bundle', async () => {
      const lookup = new Map([
        ['suit', { id: 'suit', types: ['top', 'bottom'], componentItemIds: ['jacket', 'trousers'] }],
        ['jacket', { id: 'jacket', types: ['top'] }],
        ['trousers', { id: 'trousers', types: ['bottom'] }],
      ])
      const result = await applyDisplacement(repos, 'chat-1', 'char-1', {
        mode: 'wear',
        item: lookup.get('suit')!,
        itemsById: lookup,
      })
      expect(result).toMatchObject({ top: ['shirt-1', 'jacket'], bottom: ['trousers'] })
      expect(repos.wardrobeWear.commitEquippedOutfit).toHaveBeenCalledWith(
        expect.objectContaining({ wornBundles: [{ id: 'suit', leafIds: ['jacket', 'trousers'] }] }),
      )
    })
  })

  describe('resolveWearable (wear-ops) — the refusal front half', () => {
    const origin = { scope: 'character' as const, id: 'char-1', name: '' }
    const mk = (id: string, types: string[], extra: Partial<WardrobeItem> = {}) =>
      ({
        id,
        characterId: 'char-1',
        title: id,
        types,
        componentItemIds: [],
        isDefault: false,
        replace: false,
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...extra,
        origin,
      }) as WardrobeItem & { origin: typeof origin }
    const pool = buildWearablePool(
      'char-1',
      { groupMountPointIds: [], projectMountPointIds: [] },
      {
        own: [mk('shoes-1', ['footwear']), mk('old-coat', ['top'], { archivedAt: '2026-02-01T00:00:00.000Z' })],
        group: [],
        project: [],
        general: [],
      },
    )

    it('refuses add_to_slot for an item whose types do not include the requested slot', () => {
      const r = resolveWearable(pool, { itemId: 'shoes-1' }, 'add_to_slot', 'top')
      expect(r).toMatchObject({ ok: false, reason: 'slot' })
      expect(r.ok === false && r.message).toMatch(/cannot be added to the "top" slot/)
    })

    it('refuses an archived item and an unknown one', () => {
      expect(resolveWearable(pool, { itemId: 'old-coat' }, 'wear')).toMatchObject({ ok: false, reason: 'archived' })
      expect(resolveWearable(pool, { itemId: 'nope' }, 'wear')).toMatchObject({ ok: false, reason: 'not_found' })
    })

    it('resolves a wearable item in its own slot', () => {
      expect(resolveWearable(pool, { itemId: 'shoes-1' }, 'add_to_slot', 'footwear')).toMatchObject({ ok: true })
    })
  })
})
