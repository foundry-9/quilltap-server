/**
 * @jest-environment node
 *
 * Outfit history survives a `.qtap` round-trip: a chat with a five-entry
 * timeline, cursor at 2, exports as `wardrobe_history` records, assembles back
 * into `data.wardrobeHistory`, and remaps onto fresh ids with the same
 * indices, hashes and cursor (spec §12).
 *
 * Node environment (not jsdom): ReadableStream is a Node global but not a
 * jsdom one.
 */

import { createMockChat, createMockMessage } from '../fixtures/test-factories';

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { downloadFile: jest.fn() },
}));

jest.mock('@/lib/plugins/registry', () => ({
  getPlugin: jest.fn(),
}));

jest.mock('@/lib/instance-settings', () => ({
  listPortableInstanceSettings: jest.fn(),
}));

import { createNdjsonStream } from '@/lib/export/ndjson-writer';
import { assembleExportFromStream } from '@/lib/import/quilltap-import-stream';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import { remapWardrobeHistoryRows } from '@/lib/import/quilltap-import/import-wardrobe-history';
import { hashEquippedSlots } from '@/lib/wardrobe/outfit-hash';

async function readAllText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

function parseLines(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function toRecords(text: string): AsyncIterable<unknown> {
  const records = parseLines(text);
  return (async function* () {
    for (const r of records) yield r;
  })();
}

const CHAT_ID = '33333333-3333-4333-8333-333333333333';
const CHAR_ID = '11111111-1111-4111-8111-111111111111';
const NEW_CHAT_ID = '44444444-4444-4444-8444-444444444444';
const NEW_CHAR_ID = '22222222-2222-4222-8222-222222222222';
const EMPTY = { top: [], bottom: [], footwear: [], accessories: [], hair: [] };

const HISTORY = [0, 1, 2, 3, 4].map((entryIndex) => {
  const slots = { ...EMPTY, top: [`aaaaaaaa-aaaa-4aaa-8aaa-00000000000${entryIndex}`] };
  return {
    id: `5555555${entryIndex}-5555-4555-8555-555555555555`,
    chatId: CHAT_ID,
    characterId: CHAR_ID,
    entryIndex,
    slots,
    slotsHash: hashEquippedSlots(slots),
    source: entryIndex === 0 ? 'chat-start' : 'character',
    actorCharacterId: entryIndex === 0 ? null : CHAR_ID,
    isCurrent: entryIndex === 2,
    createdAt: `2026-10-16T0${entryIndex}:00:00.000Z`,
  };
});

describe('NDJSON export — wardrobe_history records', () => {
  function primeRepos(history: unknown[]) {
    const chat = {
      ...createMockChat({ id: CHAT_ID, title: 'The Green Dress', userId: 'user-1' }),
      participants: [],
      tags: [],
    };
    (getUserRepositories as jest.Mock).mockReturnValue({
      chats: {
        findById: jest.fn(async (id: string) => (id === CHAT_ID ? chat : null)),
        findAll: jest.fn(async () => [chat]),
        getMessages: jest.fn(async () => [createMockMessage({ role: 'USER', content: 'Hello' })]),
      },
      characters: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []) },
      tags: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []) },
      memories: { findByCharacterId: jest.fn(async () => []) },
    });
    (getRepositories as jest.Mock).mockReturnValue({
      conversationAnnotations: { findByChatId: jest.fn(async () => []) },
      chatDocuments: { findByChatId: jest.fn(async () => []) },
      chatInforms: { findByChatId: jest.fn(async () => []) },
      wardrobeHistory: { findByChatId: jest.fn(async (id: string) => (id === CHAT_ID ? history : [])) },
    });
  }

  async function exportText() {
    return readAllText(
      createNdjsonStream('user-1', { type: 'chats', scope: 'selected', selectedIds: [CHAT_ID], includeMemories: false })
    );
  }

  beforeEach(() => jest.clearAllMocks());

  it('re-imports with the same indices, hashes and cursor under remapped ids', async () => {
    primeRepos(HISTORY);
    const result = await assembleExportFromStream(toRecords(await exportText()));
    const data = result.data as { wardrobeHistory?: unknown[] };

    expect(result.manifest.counts.wardrobeHistory).toBe(5);
    expect(data.wardrobeHistory).toEqual(HISTORY);

    let n = 0;
    const { rows, droppedInvalid } = remapWardrobeHistoryRows(data.wardrobeHistory!, {
      chatIds: new Map([[CHAT_ID, NEW_CHAT_ID]]),
      characterIds: new Map([[CHAR_ID, NEW_CHAR_ID]]),
      itemIds: new Map(),
      mintId: () => `new-${n++}`,
    });

    expect(droppedInvalid).toBe(0);
    expect(rows.map((r) => r.entryIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(rows.map((r) => r.isCurrent)).toEqual([false, false, true, false, false]);
    expect(rows.map((r) => r.slotsHash)).toEqual(HISTORY.map((r) => r.slotsHash));
    expect(rows.every((r) => r.chatId === NEW_CHAT_ID && r.characterId === NEW_CHAR_ID)).toBe(true);
    expect(rows[1].actorCharacterId).toBe(NEW_CHAR_ID);
    expect(rows[0].actorCharacterId).toBeNull();
    expect(rows.map((r) => r.id)).toEqual(['new-0', 'new-1', 'new-2', 'new-3', 'new-4']);
  });

  it('remaps slot item ids that imported with new ids, and keeps the rest', () => {
    const oldItem = HISTORY[1].slots.top[0];
    const { rows } = remapWardrobeHistoryRows([HISTORY[1], HISTORY[2]], {
      chatIds: new Map(),
      characterIds: new Map(),
      itemIds: new Map([[oldItem, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']]),
      mintId: () => 'x',
    });
    expect(rows[0].slots.top).toEqual(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
    expect(rows[0].slotsHash).toBe(hashEquippedSlots(rows[0].slots));
    expect(rows[1].slots.top).toEqual(HISTORY[2].slots.top);
  });

  it('drops a malformed row and counts it', () => {
    const { rows, droppedInvalid } = remapWardrobeHistoryRows([{ nonsense: true }, HISTORY[0]], {
      chatIds: new Map(), characterIds: new Map(), itemIds: new Map(), mintId: () => 'x',
    });
    expect(rows).toHaveLength(1);
    expect(droppedInvalid).toBe(1);
  });

  it('emits nothing for a chat with no history', async () => {
    primeRepos([]);
    const text = await exportText();
    expect(text).not.toContain('wardrobe_history');
  });
});
