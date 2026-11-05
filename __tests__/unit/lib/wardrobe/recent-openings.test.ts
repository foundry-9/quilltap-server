/**
 * The green room's memory of earlier openings: arrival rows → prompt lines.
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  describeAge,
  describeRecentOpenings,
  loadRecentOpenings,
} from '@/lib/wardrobe/recent-openings';

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const EMPTY = { top: [], bottom: [], footwear: [], accessories: [], hair: [] };

function row(slots: Partial<typeof EMPTY>, createdAt = '2026-11-04T12:00:00.000Z') {
  return {
    id: 'r', chatId: 'c', characterId: 'ch', entryIndex: 0,
    slots: { ...EMPTY, ...slots }, slotsHash: '0123456789abcdef',
    source: 'chat-start' as const, actorCharacterId: null, actorToolName: null,
    isCurrent: true, createdAt,
  };
}

const byId = new Map([
  ['dress', { title: 'Teal Dress' }],
  ['boots', { title: 'Walnut Boots' }],
  ['ring', { title: 'Wedding Ring' }],
]);

describe('describeAge', () => {
  it('reads today, yesterday, days, weeks and months', () => {
    expect(describeAge('2026-11-05T01:00:00.000Z', NOW)).toBe('today');
    expect(describeAge('2026-11-04T10:00:00.000Z', NOW)).toBe('yesterday');
    expect(describeAge('2026-11-01T12:00:00.000Z', NOW)).toBe('4 days ago');
    expect(describeAge('2026-10-15T12:00:00.000Z', NOW)).toBe('3 weeks ago');
    expect(describeAge('2026-07-01T12:00:00.000Z', NOW)).toBe('4 months ago');
    expect(describeAge('not a date', NOW)).toBe('some time ago');
  });
});

describe('describeRecentOpenings', () => {
  it('lists each garment once, in slot order, even when it covers two slots', () => {
    const [opening] = describeRecentOpenings(
      [row({ top: ['dress'], bottom: ['dress'], footwear: ['boots'], accessories: ['ring'] })],
      byId, NOW,
    );
    expect(opening).toEqual({ when: 'yesterday', titles: ['Teal Dress', 'Walnut Boots', 'Wedding Ring'], unclothed: false });
  });

  it('marks an opening with only accessories as unclothed', () => {
    const [opening] = describeRecentOpenings([row({ accessories: ['ring'] })], byId, NOW);
    expect(opening.unclothed).toBe(true);
    expect(opening.titles).toEqual(['Wedding Ring']);
  });

  it('drops an opening whose garments are all gone rather than calling it unclothed', () => {
    expect(describeRecentOpenings([row({ top: ['deleted'] })], byId, NOW)).toEqual([]);
  });
});

describe('loadRecentOpenings', () => {
  it('asks the history for this character, excluding the chat being dressed', async () => {
    const findRecentOpenings = jest.fn(async () => [row({ top: ['dress'], bottom: ['dress'] })]);
    const result = await loadRecentOpenings(
      { wardrobeHistory: { findRecentOpenings } } as never, 'ch', byId,
      { excludeChatId: 'now-chat', now: NOW },
    );
    expect(findRecentOpenings).toHaveBeenCalledWith('ch', 5, 'now-chat');
    expect(result).toHaveLength(1);
  });

  it('soft-fails to none', async () => {
    const findRecentOpenings = jest.fn(async () => { throw new Error('boom'); });
    await expect(
      loadRecentOpenings({ wardrobeHistory: { findRecentOpenings } } as never, 'ch', byId),
    ).resolves.toEqual([]);
  });
});
