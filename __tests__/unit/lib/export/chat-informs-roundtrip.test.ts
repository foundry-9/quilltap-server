/**
 * @jest-environment node
 *
 * Inform rows survive a `.qtap` round-trip, consumed ones included.
 *
 * A consumed row is not dead weight: it is the only record of what a past
 * generation was told, and it is what lets a swipe of that turn re-apply the
 * same passage. Drop it on export and every swipe in the destination instance
 * quietly loses its inform, which is exactly the kind of failure nobody
 * notices until the model's reply stops making sense.
 *
 * The ordering assertion is load-bearing too: `recordMessageId` and
 * `consumedByMessageId` point at messages, so the rows must follow the
 * `chat_message` records and precede the annotations.
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

describe('NDJSON export — chat_inform records', () => {
  const testUserId = 'user-informs';
  const chatId = 'chat-informs-1';

  const pendingInform = {
    id: 'inform-pending',
    chatId,
    batchId: 'batch-1',
    participantId: 'participant-alice',
    contentMarkdown: 'You notice the clock has stopped.',
    recordMessageId: 'msg-record',
    createdAt: '2026-09-19T21:14:00.000Z',
    updatedAt: '2026-09-19T21:14:00.000Z',
    consumedAt: null,
    consumedByMessageId: null,
  };

  const consumedInform = {
    id: 'inform-consumed',
    chatId,
    batchId: 'batch-1',
    participantId: 'participant-bob',
    contentMarkdown: 'You notice the clock has stopped.',
    recordMessageId: 'msg-record',
    createdAt: '2026-09-19T21:14:00.000Z',
    updatedAt: '2026-09-19T21:16:00.000Z',
    consumedAt: '2026-09-19T21:16:00.000Z',
    consumedByMessageId: 'msg-assistant',
  };

  const annotation = {
    id: 'anno-1',
    chatId,
    sourceMessageId: 'msg-1',
    note: 'A marginal scribble',
    createdAt: '2026-09-19T21:20:00.000Z',
    updatedAt: '2026-09-19T21:20:00.000Z',
  };

  function primeRepos(informs: unknown[]) {
    const chat = {
      ...createMockChat({ id: chatId, title: 'The Stopped Clock', userId: testUserId }),
      participants: [],
      tags: [],
    };
    const message = createMockMessage({ role: 'USER', content: 'Hello there' });

    const userRepos = {
      chats: {
        findById: jest.fn(async (id: string) => (id === chatId ? chat : null)),
        findAll: jest.fn(async () => [chat]),
        getMessages: jest.fn(async () => [message]),
      },
      characters: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []) },
      tags: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []) },
      memories: { findByCharacterId: jest.fn(async () => []) },
    };

    const globalRepos = {
      conversationAnnotations: {
        findByChatId: jest.fn(async (id: string) => (id === chatId ? [annotation] : [])),
      },
      chatDocuments: { findByChatId: jest.fn(async () => []) },
      chatInforms: {
        findByChatId: jest.fn(async (id: string) => (id === chatId ? informs : [])),
      },
    };

    (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
    (getRepositories as jest.Mock).mockReturnValue(globalRepos);
    return { globalRepos };
  }

  async function exportText() {
    return readAllText(
      createNdjsonStream(testUserId, {
        type: 'chats',
        scope: 'selected',
        selectedIds: [chatId],
        includeMemories: false,
      })
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('carries pending and consumed rows through export → import', async () => {
    primeRepos([pendingInform, consumedInform]);

    const result = await assembleExportFromStream(toRecords(await exportText()));
    const data = result.data as { chatInforms?: Array<Record<string, unknown>> };

    expect(data.chatInforms).toBeDefined();
    expect(data.chatInforms).toHaveLength(2);
    expect(data.chatInforms![0]).toMatchObject({
      id: 'inform-pending',
      contentMarkdown: 'You notice the clock has stopped.',
      consumedAt: null,
    });
    // The consumed row travels with its anchor intact — that is what makes a
    // swipe of that turn honest after the round-trip.
    expect(data.chatInforms![1]).toMatchObject({
      id: 'inform-consumed',
      consumedAt: '2026-09-19T21:16:00.000Z',
      consumedByMessageId: 'msg-assistant',
    });
  });

  it('counts the rows in the footer', async () => {
    primeRepos([pendingInform, consumedInform]);

    const result = await assembleExportFromStream(toRecords(await exportText()));
    expect(result.manifest.counts.chatInforms).toBe(2);
  });

  it('emits chat_inform after every chat_message and before the annotations', async () => {
    primeRepos([pendingInform, consumedInform]);

    const kinds = parseLines(await exportText()).map((r) => r.kind as string);
    const lastMessage = kinds.lastIndexOf('chat_message');
    const firstInform = kinds.indexOf('chat_inform');
    const firstAnnotation = kinds.indexOf('conversation_annotation');

    expect(lastMessage).toBeGreaterThanOrEqual(0);
    expect(firstInform).toBeGreaterThan(lastMessage);
    expect(firstAnnotation).toBeGreaterThan(kinds.lastIndexOf('chat_inform'));
  });

  it('emits nothing at all when the chat has no informs', async () => {
    primeRepos([]);

    const text = await exportText();
    expect(text).not.toContain('chat_inform');

    const result = await assembleExportFromStream(toRecords(text));
    const data = result.data as { chatInforms?: unknown[] };
    expect(data.chatInforms).toBeUndefined();
  });

  it('does not abandon the chat when the informs read throws', async () => {
    const { globalRepos } = primeRepos([]);
    (globalRepos.chatInforms.findByChatId as jest.Mock).mockRejectedValue(
      new Error('chat_informs is missing')
    );

    const result = await assembleExportFromStream(toRecords(await exportText()));
    const data = result.data as {
      chats: Array<{ id: string }>;
      conversationAnnotations?: unknown[];
    };
    // The chat and everything after the informs still make it out.
    expect(data.chats).toHaveLength(1);
    expect(data.conversationAnnotations).toHaveLength(1);
  });
});
