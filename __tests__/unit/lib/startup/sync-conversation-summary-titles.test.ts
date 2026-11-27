/**
 * Tests for the startup pass that renames conversation summary files (and
 * their frontmatter title) to their chat's current title.
 *
 * The real bridge supplies the name rule; the database store is an in-memory
 * map so renames and writes can be observed.
 */

jest.mock('@/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { logger: { ...noop, child: () => noop } };
});

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const mockCharacters: Array<Record<string, unknown>> = [];
const mockChats = new Map<string, { id: string; title: string }>();
const mockMountPoints = new Map<string, Record<string, unknown>>();

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    characters: { findAllRaw: async () => mockCharacters },
    chats: { findById: async (id: string) => mockChats.get(id) ?? null },
    docMountPoints: { findById: async (id: string) => mockMountPoints.get(id) ?? null },
  }),
}));

jest.mock('@/lib/file-storage/character-vault-bridge', () => ({
  getCharacterVaultStore: jest.fn(),
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn(),
}));

/** mountPointId → (relativePath → content) */
const mockStore = new Map<string, Map<string, string>>();
const mockMove = jest.fn();
const mockWrite = jest.fn();

jest.mock('@/lib/mount-index/database-store', () => ({
  listDatabaseFiles: async (mp: string) =>
    [...(mockStore.get(mp)?.keys() ?? [])].map((relativePath) => ({ relativePath, kind: 'file' })),
  readDatabaseDocument: async (mp: string, rel: string) => ({ content: mockStore.get(mp)!.get(rel)! }),
  databaseDocumentExists: async (mp: string, rel: string) =>
    [...(mockStore.get(mp)?.keys() ?? [])].some((k) => k.toLowerCase() === rel.toLowerCase()),
  moveDatabaseDocument: async (mp: string, from: string, to: string) => {
    mockMove(mp, from, to);
    const files = mockStore.get(mp)!;
    const content = files.get(from)!;
    files.delete(from);
    files.set(to, content);
  },
  writeDatabaseDocument: async (mp: string, rel: string, content: string) => {
    mockWrite(mp, rel, content);
    mockStore.get(mp)!.set(rel, content);
    return { mtime: 0 };
  },
  deleteDatabaseDocument: jest.fn(),
}));

import { syncConversationSummaryTitles } from '@/lib/startup/sync-conversation-summary-titles';

const CHAT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const CHAT_B = 'bbbbbbbb-1111-2222-3333-444444444444';

function summaryFile(chatId: string, title: string, body = 'They met at the station.'): string {
  return `---\ntype: conversation-summary\nconversationId: ${chatId}\nconversationTitle: ${title}\nupdatedAt: 2026-11-01T00:00:00.000Z\n---\n${body}\n`;
}

function addVault(characterId: string, mountPointId: string, files: Record<string, string>, extra: Record<string, unknown> = {}) {
  mockCharacters.push({ id: characterId, characterDocumentMountPointId: mountPointId, archivedAt: null, ...extra });
  mockMountPoints.set(mountPointId, { id: mountPointId, mountType: 'database', storeType: 'character' });
  mockStore.set(mountPointId, new Map(Object.entries(files)));
}

beforeEach(() => {
  mockCharacters.length = 0;
  mockChats.clear();
  mockMountPoints.clear();
  mockStore.clear();
  mockMove.mockClear();
  mockWrite.mockClear();
});

describe('syncConversationSummaryTitles', () => {
  it('renames a drifted file and rewrites its frontmatter title, keeping the body', async () => {
    mockChats.set(CHAT_A, { id: CHAT_A, title: 'The Midnight Train' });
    addVault('char-1', 'mp-1', {
      'Conversation Summaries/Arrival.md': summaryFile(CHAT_A, 'Arrival'),
    });

    const result = await syncConversationSummaryTitles();

    expect(result).toMatchObject({ renamed: 1, retitled: 1, errors: 0 });
    const files = mockStore.get('mp-1')!;
    expect([...files.keys()]).toEqual(['Conversation Summaries/The Midnight Train.md']);
    const content = files.get('Conversation Summaries/The Midnight Train.md')!;
    expect(content).toContain('conversationTitle: The Midnight Train');
    expect(content).toContain(`conversationId: ${CHAT_A}`);
    expect(content).toContain('updatedAt: 2026-11-01T00:00:00.000Z');
    expect(content).toContain('They met at the station.');
  });

  it('touches nothing when name and title already match', async () => {
    mockChats.set(CHAT_A, { id: CHAT_A, title: 'Arrival' });
    addVault('char-1', 'mp-1', {
      'Conversation Summaries/Arrival.md': summaryFile(CHAT_A, 'Arrival'),
    });

    const result = await syncConversationSummaryTitles();

    expect(result).toMatchObject({ files: 1, renamed: 0, retitled: 0 });
    expect(mockMove).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('only renames (no rewrite, so no re-embed) when the frontmatter is already current', async () => {
    mockChats.set(CHAT_A, { id: CHAT_A, title: 'Arrival' });
    addVault('char-1', 'mp-1', {
      'Conversation Summaries/Old Name.md': summaryFile(CHAT_A, 'Arrival'),
    });

    const result = await syncConversationSummaryTitles();

    expect(result).toMatchObject({ renamed: 1, retitled: 0 });
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('falls back to the short-id name when another conversation holds the title', async () => {
    mockChats.set(CHAT_A, { id: CHAT_A, title: 'Arrival' });
    mockChats.set(CHAT_B, { id: CHAT_B, title: 'Arrival' });
    addVault('char-1', 'mp-1', {
      'Conversation Summaries/Arrival.md': summaryFile(CHAT_A, 'Arrival'),
      'Conversation Summaries/Something Else.md': summaryFile(CHAT_B, 'Something Else'),
    });

    await syncConversationSummaryTitles();

    expect([...mockStore.get('mp-1')!.keys()].sort()).toEqual([
      'Conversation Summaries/Arrival (bbbbbbbb).md',
      'Conversation Summaries/Arrival.md',
    ]);
  });

  it('leaves a file whose chat is gone, and skips archived characters', async () => {
    addVault('char-1', 'mp-1', {
      'Conversation Summaries/Lost.md': summaryFile(CHAT_A, 'Lost'),
    });
    mockChats.set(CHAT_B, { id: CHAT_B, title: 'New Title' });
    addVault('char-2', 'mp-2', {
      'Conversation Summaries/Old.md': summaryFile(CHAT_B, 'Old'),
    }, { archivedAt: '2026-10-01T00:00:00.000Z' });

    const result = await syncConversationSummaryTitles();

    expect(result).toMatchObject({ orphaned: 1, renamed: 0, retitled: 0 });
    expect(mockMove).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
