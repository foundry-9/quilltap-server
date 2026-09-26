/**
 * Tests for the discard_mail tool handler.
 *
 * `discardLetter` (the GC-chokepoint delete) is mocked; the handler's path
 * resolution (bare file name → `Mail/…`, confined to the caller's own postbox)
 * runs for real. `getRepositories` is globally mocked by jest.setup.
 *
 * The handler never consults systemTransparency: a character that cannot see
 * its own vault through the doc_* tools may still discard its mail.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { executeDiscardMailTool } from '../discard-mail-handler';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { discardLetter } from '@/lib/post-office/mailbox';

jest.mock('@/lib/mount-index/character-vault', () => ({
  ensureCharacterVault: jest.fn(),
}));
jest.mock('@/lib/post-office/mailbox', () => {
  const actual = jest.requireActual('@/lib/post-office/mailbox');
  return { ...actual, discardLetter: jest.fn() };
});

const me = { id: 'c1', name: 'Ariadne', systemTransparency: false, characterDocumentMountPointId: 'mv' };
const ctx = { userId: 'u1', chatId: 'chat-1', characterId: 'c1' };

let findByIdRaw: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  findByIdRaw = jest.fn().mockResolvedValue(me);
  jest.mocked(getRepositories).mockReturnValue({
    characters: { findByIdRaw },
  } as never);
  jest.mocked(ensureCharacterVault).mockResolvedValue({ mountPointId: 'mv', created: false });
});

describe('executeDiscardMailTool', () => {
  it('discards a letter named by its bare file name from the caller own vault', async () => {
    jest.mocked(discardLetter).mockResolvedValue(true);
    const out = await executeDiscardMailTool({ letter: '100-from-bertie.md' }, ctx);
    expect(out.success).toBe(true);
    expect(discardLetter).toHaveBeenCalledWith('mv', 'Mail/100-from-bertie.md');
    expect(out.path).toBe('Mail/100-from-bertie.md');
    expect(out.message).toContain('100-from-bertie.md');
  });

  it('works for a character without systemTransparency', async () => {
    jest.mocked(discardLetter).mockResolvedValue(true);
    const out = await executeDiscardMailTool({ letter: '100-from-bertie.md' }, ctx);
    expect(me.systemTransparency).toBe(false);
    expect(out.success).toBe(true);
  });

  it('refuses a reference that would leave the Mail/ folder', async () => {
    const out = await executeDiscardMailTool({ letter: '../Notes/secret.md' }, ctx);
    expect(out.success).toBe(false);
    expect(discardLetter).not.toHaveBeenCalled();
  });

  it('reports a missing letter without throwing', async () => {
    jest.mocked(discardLetter).mockResolvedValue(false);
    const out = await executeDiscardMailTool({ letter: 'missing.md' }, ctx);
    expect(out.success).toBe(false);
    expect(out.error).toContain('missing.md');
  });

  it('refuses an archived character', async () => {
    findByIdRaw.mockResolvedValue({ ...me, archivedAt: '2026-06-01T00:00:00.000Z' });
    const out = await executeDiscardMailTool({ letter: '100-from-bertie.md' }, ctx);
    expect(out.success).toBe(false);
    expect(ensureCharacterVault).not.toHaveBeenCalled();
    expect(discardLetter).not.toHaveBeenCalled();
  });

  it('fails when there is no acting character', async () => {
    const out = await executeDiscardMailTool({ letter: '100-from-bertie.md' }, { ...ctx, characterId: null });
    expect(out.success).toBe(false);
    expect(discardLetter).not.toHaveBeenCalled();
  });

  it('fails on missing input', async () => {
    const out = await executeDiscardMailTool({}, ctx);
    expect(out.success).toBe(false);
  });
});
