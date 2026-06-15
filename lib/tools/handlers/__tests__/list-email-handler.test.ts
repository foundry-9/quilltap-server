/**
 * Tests for the list_email tool handler.
 *
 * The mailbox listing is mocked; the handler's formatting (the per-letter
 * doc_read_file / send_mail / doc_delete_file snippets using mount_point
 * "self") runs for real. `getRepositories` is globally mocked by jest.setup.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { executeListEmailTool } from '../list-email-handler';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { listMailbox, type DeliveredLetterSummary } from '@/lib/post-office/mailbox';

jest.mock('@/lib/mount-index/character-vault', () => ({
  ensureCharacterVault: jest.fn(),
}));
jest.mock('@/lib/post-office/mailbox', () => {
  const actual = jest.requireActual('@/lib/post-office/mailbox');
  return { ...actual, listMailbox: jest.fn() };
});

const me = { id: 'c1', name: 'Ariadne', characterDocumentMountPointId: 'mv' };
const ctx = { userId: 'u1', chatId: 'chat-1', characterId: 'c1' };

function letter(over: Partial<DeliveredLetterSummary>): DeliveredLetterSummary {
  return {
    path: 'Mail/100-from-bertie.md',
    from: 'Bertie',
    sentAt: '2026-06-10T00:00:00.000Z',
    body: 'body',
    alerted: false,
    inReplyTo: null,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getRepositories).mockReturnValue({
    characters: { findByIdRaw: jest.fn().mockResolvedValue(me) },
  } as never);
  jest.mocked(ensureCharacterVault).mockResolvedValue({ mountPointId: 'mv', created: false });
});

describe('executeListEmailTool', () => {
  it('reports an empty postbox without error', async () => {
    jest.mocked(listMailbox).mockResolvedValue([]);
    const out = await executeListEmailTool({}, ctx);
    expect(out.success).toBe(true);
    expect(out.count).toBe(0);
    expect(out.listing).toBe('Your postbox stands empty.');
  });

  it('lists letters with working read/reply/discard snippets using the self token', async () => {
    jest.mocked(listMailbox).mockResolvedValue([
      letter({ path: 'Mail/200-from-bertie.md', from: 'Bertie', sentAt: '2026-06-12T00:00:00.000Z' }),
    ]);
    const out = await executeListEmailTool({}, ctx);
    expect(out.success).toBe(true);
    expect(out.count).toBe(1);
    expect(out.listing).toContain('Bertie');
    expect(out.listing).toContain('Mail/200-from-bertie.md');
    expect(out.listing).toContain('doc_read_file');
    expect(out.listing).toContain('mount_point: "self"');
    expect(out.listing).toContain('doc_delete_file');
    expect(out.listing).toContain('in_reply_to');
  });

  it('preserves the listing order returned by the mailbox (newest-first)', async () => {
    jest.mocked(listMailbox).mockResolvedValue([
      letter({ path: 'Mail/newer.md', sentAt: '2026-06-12T00:00:00.000Z' }),
      letter({ path: 'Mail/older.md', sentAt: '2026-06-10T00:00:00.000Z' }),
    ]);
    const out = await executeListEmailTool({}, ctx);
    expect(out.listing.indexOf('Mail/newer.md')).toBeLessThan(out.listing.indexOf('Mail/older.md'));
  });

  it('only ever lists the caller own mailbox (its resolved vault id)', async () => {
    jest.mocked(listMailbox).mockResolvedValue([]);
    await executeListEmailTool({}, ctx);
    expect(listMailbox).toHaveBeenCalledWith('mv');
  });

  it('fails when there is no acting character', async () => {
    const out = await executeListEmailTool({}, { ...ctx, characterId: null });
    expect(out.success).toBe(false);
    expect(listMailbox).not.toHaveBeenCalled();
  });
});
