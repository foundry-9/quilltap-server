/**
 * @jest-environment node
 *
 * remapAvatarTimelineRows: ids follow the import's maps, rows for chats that
 * were not imported are dropped, and imageId follows the imported vault links.
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

import { remapAvatarTimelineRows } from '@/lib/import/quilltap-import/import-avatar-timeline';

const CHAT = '11111111-1111-4111-8111-111111111111';
const CHAT_NEW = '22222222-2222-4222-8222-222222222222';
const CHAT_SKIPPED = '33333333-3333-4333-8333-333333333333';

function row(over: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    chatId: CHAT,
    characterId: 'char-old',
    imageId: 'link-old',
    effectiveAt: '2026-01-02T03:04:05.000Z',
    source: 'generated',
    createdAt: '2026-01-02T03:04:05.000Z',
    ...over,
  };
}

function ctx() {
  let n = 0;
  return {
    chatIds: new Map([[CHAT, CHAT_NEW]]),
    characterIds: new Map([['char-old', 'char-new']]),
    imageIds: new Map([['link-old', 'link-new']]),
    mintId: () => `minted-${++n}`,
  };
}

describe('remapAvatarTimelineRows', () => {
  it('remaps ids, mints fresh row ids and keeps dates and source', () => {
    const { rows } = remapAvatarTimelineRows([row()], ctx());
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'minted-1',
        chatId: CHAT_NEW,
        characterId: 'char-new',
        imageId: 'link-new',
        effectiveAt: '2026-01-02T03:04:05.000Z',
        source: 'generated',
        createdAt: '2026-01-02T03:04:05.000Z',
      }),
    ]);
  });

  it('keeps a null imageId and an imageId with no map entry', () => {
    const { rows } = remapAvatarTimelineRows(
      [row({ imageId: null, source: 'baseline' }), row({ imageId: 'legacy-file-id' })],
      ctx(),
    );
    expect(rows.map((r) => r.imageId)).toEqual([null, 'legacy-file-id']);
  });

  it('keeps a character id with no map entry', () => {
    const { rows } = remapAvatarTimelineRows([row({ characterId: 'char-unknown' })], ctx());
    expect(rows[0].characterId).toBe('char-unknown');
  });

  it('drops rows whose chat was not imported and rows that are malformed', () => {
    const result = remapAvatarTimelineRows(
      [row({ chatId: CHAT_SKIPPED }), { nonsense: true }, row()],
      ctx(),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.droppedUnknownChat).toBe(1);
    expect(result.droppedInvalid).toBe(1);
  });
});
