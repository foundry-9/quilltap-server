/**
 * @jest-environment node
 *
 * Round-trip regression test for the LIVE export/import path.
 *
 * Exports a chat that carries a conversation annotation and a chat document
 * through `createNdjsonStream`, feeds the emitted NDJSON back through
 * `assembleExportFromStream`, and asserts both survive. This guards the path
 * that actually ships — the legacy in-memory `exportChats` builder (deleted
 * with the rest of the dead export code) used to silently drop these two
 * arrays, so a regression test pins the behaviour down.
 *
 * Node environment (not jsdom): ReadableStream is a Node global but not a
 * jsdom global.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createMockChat, createMockMessage } from '../fixtures/test-factories';

// Mock the repository factory before importing the modules under test.
jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}));

// Mock the logger so we don't print noise. Covers both the writer and the
// importer (same module path).
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

import { createNdjsonStream } from '@/lib/export/ndjson-writer';
import { assembleExportFromStream } from '@/lib/import/quilltap-import-stream';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';

async function readAllText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
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

/** Turn NDJSON text into the async-iterable of parsed records the importer wants. */
function ndjsonToRecords(text: string): AsyncIterable<unknown> {
  const records = text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
  return (async function* () {
    for (const r of records) yield r;
  })();
}

describe('NDJSON export → import round-trip', () => {
  const testUserId = 'user-roundtrip';
  const chatId = 'chat-roundtrip-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves conversation annotations and chat documents through the live path', async () => {
    const chat = {
      ...createMockChat({ id: chatId, title: 'Round Trip', userId: testUserId }),
      participants: [],
      tags: [],
    };
    const message = createMockMessage({ role: 'USER', content: 'Hello there' });
    const annotation = {
      id: 'anno-1',
      chatId,
      sourceMessageId: 'msg-1',
      note: 'A marginal scribble',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const chatDocument = {
      id: 'cd-1',
      chatId,
      title: 'Working Draft',
      content: 'Once upon a time…',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const userRepos = {
      chats: {
        findById: jest.fn(async (id: string) => (id === chatId ? chat : null)),
        findAll: jest.fn(async () => [chat]),
        getMessages: jest.fn(async () => [message]),
      },
      characters: {
        findById: jest.fn(async () => null),
        findAll: jest.fn(async () => []),
      },
      tags: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []) },
      memories: { findByCharacterId: jest.fn(async () => []) },
    };

    const globalRepos = {
      conversationAnnotations: {
        findByChatId: jest.fn(async (id: string) => (id === chatId ? [annotation] : [])),
      },
      chatDocuments: {
        findByChatId: jest.fn(async (id: string) => (id === chatId ? [chatDocument] : [])),
      },
    };

    (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
    (getRepositories as jest.Mock).mockReturnValue(globalRepos);

    // Export → bytes → records → reassembled export.
    const stream = createNdjsonStream(testUserId, {
      type: 'chats',
      scope: 'selected',
      selectedIds: [chatId],
      includeMemories: false,
    });
    const text = await readAllText(stream);
    const result = await assembleExportFromStream(ndjsonToRecords(text));

    expect(result.manifest.exportType).toBe('chats');

    // The chat itself survives, with its single message.
    const data = result.data as {
      chats: Array<{ id: string; messages: unknown[] }>;
      conversationAnnotations?: Array<{ id: string }>;
      chatDocuments?: Array<{ id: string }>;
    };
    expect(data.chats).toHaveLength(1);
    expect(data.chats[0].id).toBe(chatId);
    expect(data.chats[0].messages).toHaveLength(1);

    // The two arrays the dead builder used to drop survive the round-trip.
    expect(data.conversationAnnotations).toBeDefined();
    expect(data.conversationAnnotations).toHaveLength(1);
    expect(data.conversationAnnotations![0]).toMatchObject({ id: 'anno-1', note: 'A marginal scribble' });

    expect(data.chatDocuments).toBeDefined();
    expect(data.chatDocuments).toHaveLength(1);
    expect(data.chatDocuments![0]).toMatchObject({ id: 'cd-1', title: 'Working Draft' });
  });
});
