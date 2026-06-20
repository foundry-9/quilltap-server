/**
 * Tests for the conversation-summary vault bridge: the real-message predicate /
 * stats, the replace-by-UUID write path, the cross-conversation collision
 * guard, and the job-child host-RPC short-circuit.
 *
 * `@/lib/repositories/factory` and `@/lib/file-storage/character-vault-bridge`
 * are mocked app-wide in jest.setup.ts — configured per-test here. The
 * mount-index document/folder modules and the host-RPC client are mocked
 * locally; the markdown-parser and bridge-path-helpers stay real (pure).
 */

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn().mockResolvedValue({ mtime: 0 }),
  deleteDatabaseDocument: jest.fn().mockResolvedValue(true),
  listDatabaseFiles: jest.fn().mockResolvedValue([]),
  readDatabaseDocument: jest.fn(),
  databaseDocumentExists: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue('folder-id'),
}));

jest.mock('@/lib/background-jobs/child/host-rpc-client', () => ({
  callHost: jest.fn().mockResolvedValue(undefined),
}));

import {
  isConversationalMessage,
  computeConversationStats,
  writeConversationSummaryToVaults,
  removeConversationSummariesFromVaults,
  SUMMARIES_FOLDER,
} from '@/lib/file-storage/conversation-summary-vault-bridge';
import { getRepositories } from '@/lib/repositories/factory';
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge';
import {
  writeDatabaseDocument,
  deleteDatabaseDocument,
  listDatabaseFiles,
  readDatabaseDocument,
  databaseDocumentExists,
} from '@/lib/mount-index/database-store';
import { callHost } from '@/lib/background-jobs/child/host-rpc-client';
import { serializeFrontmatter, parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import type { ChatEvent } from '@/lib/schemas/types';

const mockGetRepositories = jest.mocked(getRepositories);
const mockGetCharacterVaultStore = jest.mocked(getCharacterVaultStore);
const mockWriteDatabaseDocument = jest.mocked(writeDatabaseDocument);
const mockDeleteDatabaseDocument = jest.mocked(deleteDatabaseDocument);
const mockListDatabaseFiles = jest.mocked(listDatabaseFiles);
const mockReadDatabaseDocument = jest.mocked(readDatabaseDocument);
const mockDatabaseDocumentExists = jest.mocked(databaseDocumentExists);
const mockCallHost = jest.mocked(callHost);

const ORIGINAL_ENV = process.env.QUILLTAP_JOB_CHILD;

function msg(partial: Partial<ChatEvent> & { id: string }): ChatEvent {
  return {
    type: 'message',
    role: 'ASSISTANT',
    content: 'hi',
    createdAt: '2026-06-10T00:00:00.000Z',
    ...partial,
  } as unknown as ChatEvent;
}

beforeEach(() => {
  delete process.env.QUILLTAP_JOB_CHILD;
  mockGetRepositories.mockReturnValue({
    characters: {
      findByIdRaw: jest.fn(async (id: string) => ({ id, name: `Char ${id}` })),
    },
  } as unknown as ReturnType<typeof getRepositories>);
  mockGetCharacterVaultStore.mockResolvedValue({
    mountPointId: 'vault-1',
    mountPointName: 'Char Vault',
  });
  mockListDatabaseFiles.mockResolvedValue([]);
  mockDatabaseDocumentExists.mockResolvedValue(false);
  mockWriteDatabaseDocument.mockResolvedValue({ mtime: 0 });
  mockDeleteDatabaseDocument.mockResolvedValue(true);
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.QUILLTAP_JOB_CHILD;
  else process.env.QUILLTAP_JOB_CHILD = ORIGINAL_ENV;
  jest.clearAllMocks();
});

describe('isConversationalMessage', () => {
  it('accepts plain USER and ASSISTANT messages', () => {
    expect(isConversationalMessage(msg({ id: '1', role: 'USER' }))).toBe(true);
    expect(isConversationalMessage(msg({ id: '2', role: 'ASSISTANT' }))).toBe(true);
  });

  it('rejects SYSTEM/TOOL roles and non-message events', () => {
    expect(isConversationalMessage(msg({ id: '3', role: 'SYSTEM' as never }))).toBe(false);
    expect(isConversationalMessage(msg({ id: '4', role: 'TOOL' as never }))).toBe(false);
    expect(isConversationalMessage({ type: 'system', id: '5' } as unknown as ChatEvent)).toBe(false);
    expect(isConversationalMessage({ type: 'context-summary', id: '6' } as unknown as ChatEvent)).toBe(false);
  });

  it('rejects staff messages, whispers, and announcements', () => {
    expect(isConversationalMessage(msg({ id: '7', systemSender: 'librarian' as never }))).toBe(false);
    expect(isConversationalMessage(msg({ id: '8', targetParticipantIds: ['p1'] as never }))).toBe(false);
    expect(isConversationalMessage(msg({ id: '9', customAnnouncer: { name: 'Narrator' } as never }))).toBe(false);
  });

  it('treats an empty whisper-target array as public', () => {
    expect(isConversationalMessage(msg({ id: '10', targetParticipantIds: [] as never }))).toBe(true);
  });
});

describe('computeConversationStats', () => {
  it('counts only real messages and captures first/last timestamps', () => {
    const events: ChatEvent[] = [
      msg({ id: 'a', role: 'USER', createdAt: '2026-06-01T10:00:00.000Z' }),
      msg({ id: 'b', systemSender: 'host' as never, createdAt: '2026-06-01T10:01:00.000Z' }),
      msg({ id: 'c', role: 'ASSISTANT', createdAt: '2026-06-01T10:02:00.000Z' }),
      msg({ id: 'd', targetParticipantIds: ['p1'] as never, createdAt: '2026-06-01T10:03:00.000Z' }),
      msg({ id: 'e', role: 'USER', createdAt: '2026-06-01T10:04:00.000Z' }),
    ];
    expect(computeConversationStats(events)).toEqual({
      messageCount: 3,
      firstMessageAt: '2026-06-01T10:00:00.000Z',
      lastMessageAt: '2026-06-01T10:04:00.000Z',
    });
  });

  it('returns nulls when there are no real messages', () => {
    expect(computeConversationStats([msg({ id: 'x', systemSender: 'host' as never })])).toEqual({
      messageCount: 0,
      firstMessageAt: null,
      lastMessageAt: null,
    });
  });
});

const baseWriteInput = {
  chatId: 'chat-123',
  chatTitle: 'A Grand Adventure',
  summary: 'They went on a quest.',
  summaryGeneration: 3,
  participantCharacterIds: ['c1', 'c2'],
  messageCount: 12,
  firstMessageAt: '2026-06-01T10:00:00.000Z',
  lastMessageAt: '2026-06-10T10:00:00.000Z',
  updatedAt: '2026-06-10T12:00:00.000Z',
};

describe('writeConversationSummaryToVaults', () => {
  it('short-circuits to host-RPC inside the job child', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1';
    await writeConversationSummaryToVaults(baseWriteInput);
    expect(mockCallHost).toHaveBeenCalledWith('writeConversationSummaryToVaults', baseWriteInput);
    expect(mockWriteDatabaseDocument).not.toHaveBeenCalled();
  });

  it('writes a frontmatter-tagged file to each participant vault', async () => {
    await writeConversationSummaryToVaults(baseWriteInput);

    expect(mockWriteDatabaseDocument).toHaveBeenCalledTimes(2);
    const [mountPointId, relativePath, body] = mockWriteDatabaseDocument.mock.calls[0];
    expect(mountPointId).toBe('vault-1');
    expect(relativePath).toBe(`${SUMMARIES_FOLDER}/A Grand Adventure.md`);

    const { data } = parseFrontmatter(body);
    expect(data).toMatchObject({
      type: 'conversation-summary',
      conversationId: 'chat-123',
      conversationTitle: 'A Grand Adventure',
      characters: ['Char c1', 'Char c2'],
      characterIds: ['c1', 'c2'],
      messageCount: 12,
      summaryGeneration: 3,
    });
    expect(body).toContain('They went on a quest.');
  });

  it('replaces a prior file for the same conversation even under a different name', async () => {
    const priorContent = serializeFrontmatter({ conversationId: 'chat-123' }) + '\nold summary\n';
    mockListDatabaseFiles.mockResolvedValue([
      { kind: 'file', relativePath: `${SUMMARIES_FOLDER}/Old Title.md` },
      { kind: 'file', relativePath: `${SUMMARIES_FOLDER}/Someone Else.md` },
    ] as never);
    mockReadDatabaseDocument.mockImplementation(async (_mp: string, rel: string) => {
      if (rel.endsWith('Old Title.md')) return { content: priorContent, mtime: 0, size: 0 };
      return { content: serializeFrontmatter({ conversationId: 'other-chat' }) + '\n', mtime: 0, size: 0 };
    });

    await writeConversationSummaryToVaults({ ...baseWriteInput, participantCharacterIds: ['c1'] });

    expect(mockDeleteDatabaseDocument).toHaveBeenCalledWith('vault-1', `${SUMMARIES_FOLDER}/Old Title.md`);
    expect(mockDeleteDatabaseDocument).not.toHaveBeenCalledWith('vault-1', `${SUMMARIES_FOLDER}/Someone Else.md`);
    expect(mockWriteDatabaseDocument).toHaveBeenCalledWith(
      'vault-1',
      `${SUMMARIES_FOLDER}/A Grand Adventure.md`,
      expect.any(String),
    );
  });

  it('disambiguates the filename when a different conversation already owns the name', async () => {
    mockDatabaseDocumentExists.mockResolvedValue(true);
    await writeConversationSummaryToVaults({ ...baseWriteInput, participantCharacterIds: ['c1'] });
    expect(mockWriteDatabaseDocument).toHaveBeenCalledWith(
      'vault-1',
      `${SUMMARIES_FOLDER}/A Grand Adventure (chat-123).md`,
      expect.any(String),
    );
  });

  it('sanitizes titles with path-unsafe characters', async () => {
    await writeConversationSummaryToVaults({
      ...baseWriteInput,
      chatTitle: 'Act 1: The/Beginning',
      participantCharacterIds: ['c1'],
    });
    const [, relativePath] = mockWriteDatabaseDocument.mock.calls[0];
    expect(relativePath).not.toContain('/Act 1: The/Beginning');
    expect(relativePath.startsWith(`${SUMMARIES_FOLDER}/`)).toBe(true);
    expect(relativePath.endsWith('.md')).toBe(true);
  });

  it('skips characters that have no vault', async () => {
    mockGetCharacterVaultStore.mockResolvedValue(null);
    await writeConversationSummaryToVaults({ ...baseWriteInput, participantCharacterIds: ['c1'] });
    expect(mockWriteDatabaseDocument).not.toHaveBeenCalled();
  });

  it('does not let one failing vault abort the rest', async () => {
    mockGetCharacterVaultStore
      .mockResolvedValueOnce({ mountPointId: 'vault-1', mountPointName: 'A' });
    mockWriteDatabaseDocument
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ mtime: 0 });
    await expect(
      writeConversationSummaryToVaults(baseWriteInput),
    ).resolves.toBeUndefined();
    expect(mockWriteDatabaseDocument).toHaveBeenCalledTimes(2);
  });
});

describe('removeConversationSummariesFromVaults', () => {
  it('short-circuits to host-RPC inside the job child', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1';
    const input = { chatId: 'chat-123', participantCharacterIds: ['c1'] };
    await removeConversationSummariesFromVaults(input);
    expect(mockCallHost).toHaveBeenCalledWith('removeConversationSummariesFromVaults', input);
    expect(mockDeleteDatabaseDocument).not.toHaveBeenCalled();
  });

  it('deletes every file matching the conversation UUID', async () => {
    mockListDatabaseFiles.mockResolvedValue([
      { kind: 'file', relativePath: `${SUMMARIES_FOLDER}/Mine.md` },
      { kind: 'file', relativePath: `${SUMMARIES_FOLDER}/Theirs.md` },
    ] as never);
    mockReadDatabaseDocument.mockImplementation(async (_mp: string, rel: string) => ({
      content:
        serializeFrontmatter({ conversationId: rel.endsWith('Mine.md') ? 'chat-123' : 'other' }) + '\n',
      mtime: 0,
      size: 0,
    }));

    await removeConversationSummariesFromVaults({ chatId: 'chat-123', participantCharacterIds: ['c1'] });

    expect(mockDeleteDatabaseDocument).toHaveBeenCalledWith('vault-1', `${SUMMARIES_FOLDER}/Mine.md`);
    expect(mockDeleteDatabaseDocument).not.toHaveBeenCalledWith('vault-1', `${SUMMARIES_FOLDER}/Theirs.md`);
  });
});
