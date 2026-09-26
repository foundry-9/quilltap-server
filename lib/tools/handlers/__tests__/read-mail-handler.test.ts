/**
 * Tests for the read_mail tool handler.
 *
 * The mailbox reads are mocked; the handler's path resolution (bare file name
 * → `Mail/…`, confined to the caller's own postbox) and formatting run for
 * real. `getRepositories` is globally mocked by jest.setup.
 *
 * The handler never consults systemTransparency: a character that cannot see
 * its own vault through the doc_* tools may still read its mail.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { executeReadMailTool } from '../read-mail-handler';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { readLetter, markAlerted, type ParsedLetter } from '@/lib/post-office/mailbox';

jest.mock('@/lib/mount-index/character-vault', () => ({
  ensureCharacterVault: jest.fn(),
}));
jest.mock('@/lib/post-office/mailbox', () => {
  const actual = jest.requireActual('@/lib/post-office/mailbox');
  return { ...actual, readLetter: jest.fn(), markAlerted: jest.fn() };
});

const me = { id: 'c1', name: 'Ariadne', systemTransparency: false, characterDocumentMountPointId: 'mv' };
const ctx = { userId: 'u1', chatId: 'chat-1', characterId: 'c1' };

function parsed(over: Partial<ParsedLetter['frontmatter']> = {}): ParsedLetter {
  return {
    frontmatter: {
      from: 'Bertie',
      fromCharacterId: 'b1',
      sentAt: '2026-06-10T00:00:00.000Z',
      alerted: true,
      inReplyTo: null,
      ...over,
    },
    body: 'Meet me at the Drones.',
  };
}

let findByIdRaw: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  findByIdRaw = jest.fn().mockResolvedValue(me);
  jest.mocked(getRepositories).mockReturnValue({
    characters: { findByIdRaw },
  } as never);
  jest.mocked(ensureCharacterVault).mockResolvedValue({ mountPointId: 'mv', created: false });
  jest.mocked(markAlerted).mockResolvedValue(undefined);
});

describe('executeReadMailTool', () => {
  it('reads a letter named by its bare file name from the caller own vault', async () => {
    jest.mocked(readLetter).mockResolvedValue(parsed());
    const out = await executeReadMailTool({ letter: '100-from-bertie.md' }, ctx);
    expect(out.success).toBe(true);
    expect(readLetter).toHaveBeenCalledWith('mv', 'Mail/100-from-bertie.md');
    expect(out.path).toBe('Mail/100-from-bertie.md');
    expect(out.text).toContain('A letter from Bertie');
    expect(out.text).toContain('Meet me at the Drones.');
    expect(out.text).toContain('in_reply_to: "100-from-bertie.md"');
    expect(out.text).not.toContain('Read it again');
  });

  it('works for a character without systemTransparency', async () => {
    jest.mocked(readLetter).mockResolvedValue(parsed());
    const out = await executeReadMailTool({ letter: '100-from-bertie.md' }, ctx);
    expect(me.systemTransparency).toBe(false);
    expect(out.success).toBe(true);
  });

  it('marks an unannounced letter announced once read', async () => {
    jest.mocked(readLetter).mockResolvedValue(parsed({ alerted: false }));
    await executeReadMailTool({ letter: '100-from-bertie.md' }, ctx);
    expect(markAlerted).toHaveBeenCalledWith('mv', 'Mail/100-from-bertie.md');
  });

  it('leaves an already-announced letter alone', async () => {
    jest.mocked(readLetter).mockResolvedValue(parsed({ alerted: true }));
    await executeReadMailTool({ letter: '100-from-bertie.md' }, ctx);
    expect(markAlerted).not.toHaveBeenCalled();
  });

  it('refuses a reference that would leave the Mail/ folder', async () => {
    const out = await executeReadMailTool({ letter: '../Notes/secret.md' }, ctx);
    expect(out.success).toBe(false);
    expect(readLetter).not.toHaveBeenCalled();
  });

  it('reports a missing letter without throwing', async () => {
    jest.mocked(readLetter).mockResolvedValue(null);
    const out = await executeReadMailTool({ letter: 'missing.md' }, ctx);
    expect(out.success).toBe(false);
    expect(out.error).toContain('missing.md');
  });

  it('refuses an archived character', async () => {
    findByIdRaw.mockResolvedValue({ ...me, archivedAt: '2026-06-01T00:00:00.000Z' });
    const out = await executeReadMailTool({ letter: '100-from-bertie.md' }, ctx);
    expect(out.success).toBe(false);
    expect(ensureCharacterVault).not.toHaveBeenCalled();
  });

  it('fails when there is no acting character', async () => {
    const out = await executeReadMailTool({ letter: '100-from-bertie.md' }, { ...ctx, characterId: null });
    expect(out.success).toBe(false);
    expect(readLetter).not.toHaveBeenCalled();
  });

  it('fails on missing input', async () => {
    const out = await executeReadMailTool({}, ctx);
    expect(out.success).toBe(false);
  });
});
