/**
 * @jest-environment node
 *
 * `deleteMessagesByIds` must count what it actually deleted.
 *
 * The count is the claim every caller reports from — the Commonplace whisper
 * sweep logs "swept N" — and, since the transcript counter landed, `removed > 0`
 * is also what bumps `chats.transcriptVersion` and publishes the realtime hint
 * that costs every open Salon tab a conditional re-read. A delete that removed
 * nothing must therefore be silent.
 *
 * This runs the real `SQLiteCollection` against a real in-memory database
 * rather than a hand-written double, because a hand-written double is exactly
 * what hid bug 142: the unit suite's mock returned `0`/`1` while
 * `DatabaseCollection.deleteOne` returns a `DeleteResult`, so the caller's
 * `else if (result)` branch counted a truthy `{ deletedCount: 0 }` as a
 * deletion and the accumulator could only ever end at `messageIds.length`.
 * The contract asserted here is the backend's own, and nothing stands in for it.
 *
 * Guards:
 *   - lib/database/repositories/chats-messages.ops.ts (deleteMessagesByIds)
 *   - lib/database/backends/sqlite/backend.ts (SQLiteCollection.deleteOne)
 */

import path from 'path';

import { SQLiteCollection } from '@/lib/database/backends/sqlite/backend';
import { ChatMessagesOps } from '@/lib/database/repositories/chats-messages.ops';
import type { ChatOpsContext } from '@/lib/database/repositories/chats-ops-context';
import type { ChatEvent, ChatMetadata } from '@/lib/schemas/types';

// Subject imports first, then the mock — SWC hoists `jest.mock` above them, and
// the factory may only close over a `mock`-prefixed name.
const mockPublishRealtime = jest.fn();
jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: (...args: unknown[]) => mockPublishRealtime(...args),
}));

function loadDriver(): any {
  try {
    return require(path.join(
      __dirname, '..', '..', '..', '..', '..',
      'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers'
    ));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      return require(path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}
const Database = loadDriver();

const NOW = '2026-09-14T10:00:00.000Z';
const CHAT_ID = '00000000-0000-4000-8000-00000000c0a7';
const PRESENT = '00000000-0000-4000-8000-000000000001';
const ALSO_PRESENT = '00000000-0000-4000-8000-000000000002';
const ABSENT = '00000000-0000-4000-8000-0000000000ff';

/** The columns a `message` row touches, as production declares them. */
const DDL = `
CREATE TABLE "chat_messages" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "type" TEXT DEFAULT 'message',
  "role" TEXT,
  "content" TEXT,
  "attachments" TEXT DEFAULT '[]',
  "createdAt" TEXT NOT NULL
);
`;

let db: any;
let ops: ChatMessagesOps;
/** Every `updateOne` issued against the `chats` row itself. */
let chatRowWrites: Array<Record<string, unknown>>;

function msg(id: string): ChatEvent {
  return {
    type: 'message',
    id,
    role: 'ASSISTANT',
    content: 'hello',
    createdAt: NOW,
  } as unknown as ChatEvent;
}

/** Every atomic counter bump the writes issued, in order. */
function bumps(): Array<Record<string, unknown>> {
  return chatRowWrites
    .map((w) => (w as { $inc?: Record<string, unknown> }).$inc)
    .filter((inc): inc is Record<string, unknown> => Boolean(inc));
}

function messageIdsInTable(): string[] {
  return (db.prepare('SELECT id FROM chat_messages ORDER BY id').all() as Array<{ id: string }>)
    .map((r) => r.id);
}

beforeEach(async () => {
  mockPublishRealtime.mockClear();
  chatRowWrites = [];

  db = new Database(':memory:');
  db.exec(DDL);

  // The real collection, with the column classification production gives it.
  const messagesCollection = new SQLiteCollection(db, 'chat_messages', [], ['attachments'], [], []);

  const chatCollection = {
    updateOne: async (_filter: unknown, update: Record<string, unknown>) => {
      chatRowWrites.push(update);
      return { matchedCount: 1, modifiedCount: 1, acknowledged: true };
    },
  };

  const ctx: ChatOpsContext = {
    findById: async () => ({
      id: CHAT_ID,
      participants: [],
      transcriptVersion: 7,
    }) as unknown as ChatMetadata,
    update: async () => null,
    getCollection: async () => chatCollection as never,
    getMessagesCollection: async () => messagesCollection as never,
    isSQLiteBackend: () => true,
    generateId: () => PRESENT,
    getCurrentTimestamp: () => NOW,
  } as unknown as ChatOpsContext;

  ops = new ChatMessagesOps(ctx);

  await ops.addMessage(CHAT_ID, msg(PRESENT));
  await ops.addMessage(CHAT_ID, msg(ALSO_PRESENT));
  expect(messageIdsInTable()).toEqual([PRESENT, ALSO_PRESENT]);

  mockPublishRealtime.mockClear();
  chatRowWrites = [];
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
});

describe('deleteMessagesByIds counts rows, not requests', () => {
  it('an id that is not there reports 0 and says nothing', async () => {
    const removed = await ops.deleteMessagesByIds(CHAT_ID, [ABSENT]);

    expect(removed).toBe(0);
    expect(bumps()).toEqual([]);
    expect(mockPublishRealtime).not.toHaveBeenCalled();
    expect(messageIdsInTable()).toEqual([PRESENT, ALSO_PRESENT]);
  });

  it('three ids that are not there still report 0 — the accumulator is not the request length', async () => {
    const removed = await ops.deleteMessagesByIds(CHAT_ID, [ABSENT, 'nope-1', 'nope-2']);

    expect(removed).toBe(0);
    expect(mockPublishRealtime).not.toHaveBeenCalled();
  });

  it('a real id reports 1 and announces once', async () => {
    const removed = await ops.deleteMessagesByIds(CHAT_ID, [PRESENT]);

    expect(removed).toBe(1);
    expect(bumps()).toEqual([{ transcriptVersion: 1 }]);
    expect(mockPublishRealtime).toHaveBeenCalledTimes(1);
    expect(mockPublishRealtime).toHaveBeenCalledWith('chats', CHAT_ID);
    expect(messageIdsInTable()).toEqual([ALSO_PRESENT]);
  });

  it('a mixed batch reports only the hit, and still announces — it did change the transcript', async () => {
    const removed = await ops.deleteMessagesByIds(CHAT_ID, [PRESENT, ABSENT]);

    expect(removed).toBe(1);
    expect(bumps()).toEqual([{ transcriptVersion: 1 }]);
    expect(mockPublishRealtime).toHaveBeenCalledTimes(1);
    expect(messageIdsInTable()).toEqual([ALSO_PRESENT]);
  });

  it('a message belonging to another chat is not deletable through this one', async () => {
    // The filter is `{ id, chatId }`; a miss on the pair must count as a miss.
    const removed = await ops.deleteMessagesByIds('some-other-chat', [PRESENT]);

    expect(removed).toBe(0);
    expect(mockPublishRealtime).not.toHaveBeenCalled();
    expect(messageIdsInTable()).toEqual([PRESENT, ALSO_PRESENT]);
  });
});

describe('the backend contract the caller must read', () => {
  it('deleteOne returns a DeleteResult — never a number, never a boolean', async () => {
    const collection = new SQLiteCollection(db, 'chat_messages', [], ['attachments'], [], []);

    const miss = await collection.deleteOne({ id: ABSENT } as never);
    // The shape that made the bug: a truthy object reporting zero deletions.
    expect(miss).toEqual({ deletedCount: 0, acknowledged: true });
    expect(typeof miss).toBe('object');
    expect(Boolean(miss)).toBe(true);

    const hit = await collection.deleteOne({ id: PRESENT } as never);
    expect(hit).toEqual({ deletedCount: 1, acknowledged: true });
  });
});
