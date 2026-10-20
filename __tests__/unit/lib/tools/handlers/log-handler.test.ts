/**
 * The log tools: `log_create_entry` stamps the call's chat and character,
 * `log_grep` refuses a bad pattern before touching the database, and
 * `log_read` resolves a character by name, maps "current", normalises its
 * time bounds, and labels every entry with its author's name.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { resolveCharacterByNameOrId } from '@/lib/services/character-resolver';
import {
  executeLogCreateEntryTool,
  executeLogGrepTool,
  executeLogReadTool,
} from '@/lib/tools/handlers/log-handler';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('@/lib/logger', () => {
  const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  mockLog.child.mockReturnValue(mockLog);
  return { logger: mockLog };
});
jest.mock('@/lib/services/character-resolver', () => ({ resolveCharacterByNameOrId: jest.fn() }));

const CONTEXT = { userId: 'user-1', chatId: 'chat-here', characterId: 'char-alice' };

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'entry-1',
  message: 'Picked the lock',
  chatId: 'chat-here',
  characterId: 'char-alice',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

describe('log tool handlers', () => {
  const logEntries = {
    create: jest.fn(),
    findEntries: jest.fn(),
    searchMessages: jest.fn(),
  };
  const characters = { findNamesByIds: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getRepositories).mockReturnValue({ logEntries, characters } as never);
    characters.findNamesByIds.mockResolvedValue(new Map([['char-alice', 'Alice']]));
  });

  describe('log_create_entry', () => {
    it('writes the trimmed message against the call’s chat and character', async () => {
      logEntries.create.mockImplementation(async (data: Record<string, unknown>) => entry(data));

      const result = await executeLogCreateEntryTool({ message: '  Picked the lock  ' }, CONTEXT);

      expect(logEntries.create).toHaveBeenCalledWith({
        message: 'Picked the lock',
        chatId: 'chat-here',
        characterId: 'char-alice',
      });
      expect(result).toEqual({
        success: true,
        entry: {
          id: 'entry-1',
          message: 'Picked the lock',
          conversationId: 'chat-here',
          createdAt: '2026-10-01T10:00:00.000Z',
        },
      });
    });

    it('records a character-less call with a null author', async () => {
      logEntries.create.mockImplementation(async (data: Record<string, unknown>) => entry(data));
      await executeLogCreateEntryTool({ message: 'Noted' }, { userId: 'user-1', chatId: 'chat-here' });
      expect(logEntries.create).toHaveBeenCalledWith(expect.objectContaining({ characterId: null }));
    });

    it('refuses an empty message without writing', async () => {
      const result = await executeLogCreateEntryTool({ message: '   ' }, CONTEXT);
      expect(result.success).toBe(false);
      expect(logEntries.create).not.toHaveBeenCalled();
    });

    it('reports a failed write rather than throwing', async () => {
      logEntries.create.mockRejectedValue(new Error('LLM logs database is degraded'));
      const result = await executeLogCreateEntryTool({ message: 'x' }, CONTEXT);
      expect(result).toEqual({ success: false, error: expect.stringContaining('degraded') });
    });
  });

  describe('log_grep', () => {
    it('searches with the case flag and default limit, and labels authors', async () => {
      logEntries.searchMessages.mockResolvedValue([entry(), entry({ id: 'entry-2', characterId: null })]);

      const result = await executeLogGrepTool({ pattern: 'lock', ignore_case: true }, CONTEXT);

      expect(logEntries.searchMessages).toHaveBeenCalledWith('lock', 'i', 50);
      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.entries?.[0]).toEqual({
        id: 'entry-1',
        message: 'Picked the lock',
        conversationId: 'chat-here',
        characterId: 'char-alice',
        characterName: 'Alice',
        createdAt: '2026-10-01T10:00:00.000Z',
      });
      expect(result.entries?.[1].characterName).toBeNull();
    });

    it('accepts a quoted limit', async () => {
      logEntries.searchMessages.mockResolvedValue([]);
      await executeLogGrepTool({ pattern: 'x', limit: '5' }, CONTEXT);
      expect(logEntries.searchMessages).toHaveBeenCalledWith('x', '', 5);
    });

    it('refuses a pattern that does not compile, before any query', async () => {
      const result = await executeLogGrepTool({ pattern: '(unclosed' }, CONTEXT);
      expect(result).toEqual({ success: false, error: expect.stringMatching(/^Invalid regular expression: \/\(unclosed\/: /) });
      expect(result.error).not.toMatch(/Invalid regular expression:.*Invalid regular expression/);
      expect(logEntries.searchMessages).not.toHaveBeenCalled();
    });
  });

  describe('log_read', () => {
    it('reads the latest entries everywhere when given no filters', async () => {
      logEntries.findEntries.mockResolvedValue([entry()]);
      const result = await executeLogReadTool({}, CONTEXT);
      expect(logEntries.findEntries).toHaveBeenCalledWith({ limit: 50 });
      expect(result.entries).toHaveLength(1);
    });

    it('maps "current", resolves the character by name, and normalises the bounds', async () => {
      jest.mocked(resolveCharacterByNameOrId).mockResolvedValue({ id: 'char-bob' } as never);
      logEntries.findEntries.mockResolvedValue([]);

      await executeLogReadTool(
        { conversationId: 'current', character: 'bob', from: '2026-10-01', to: '2026-10-02T12:00:00+02:00', limit: 10 },
        CONTEXT
      );

      expect(resolveCharacterByNameOrId).toHaveBeenCalledWith('user-1', 'bob');
      expect(logEntries.findEntries).toHaveBeenCalledWith({
        chatId: 'chat-here',
        characterId: 'char-bob',
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T10:00:00.000Z',
        limit: 10,
      });
    });

    it('reads a bare-date `to` as the end of that day, so one date names the whole day', async () => {
      logEntries.findEntries.mockResolvedValue([]);
      const result = await executeLogReadTool({ from: '2026-10-19', to: '2026-10-19' }, CONTEXT);
      expect(result.success).toBe(true);
      expect(logEntries.findEntries).toHaveBeenCalledWith({
        from: '2026-10-19T00:00:00.000Z',
        to: '2026-10-19T23:59:59.999Z',
        limit: 50,
      });
    });

    it('accepts a timed `from` later in the day than a bare-date `to` begins', async () => {
      logEntries.findEntries.mockResolvedValue([]);
      expect((await executeLogReadTool({ from: '2026-10-19T18:00:00Z', to: '2026-10-19' }, CONTEXT)).success).toBe(true);
    });

    it('names a character it cannot find', async () => {
      jest.mocked(resolveCharacterByNameOrId).mockResolvedValue(null);
      const result = await executeLogReadTool({ character: 'Nobody' }, CONTEXT);
      expect(result).toEqual({ success: false, error: 'No character named "Nobody" was found.' });
      expect(logEntries.findEntries).not.toHaveBeenCalled();
    });

    it('refuses bounds that are not dates, or out of order', async () => {
      expect((await executeLogReadTool({ from: 'last Tuesday' }, CONTEXT)).success).toBe(false);
      expect((await executeLogReadTool({ from: '2026-10-05', to: '2026-10-01' }, CONTEXT)).success).toBe(false);
      expect(logEntries.findEntries).not.toHaveBeenCalled();
    });
  });
});
