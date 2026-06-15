/**
 * Tests for the send_mail tool handler.
 *
 * The mailbox I/O (deliverLetter / readLetter) and recipient resolution are
 * mocked; the reply-preface composition (buildReplyPreface) runs for real so we
 * verify the delivered body quotes the original body only. `getRepositories` is
 * globally mocked by jest.setup and configured per-test for findByIdRaw.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { executeSendMailTool } from '../send-mail-handler';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { resolveCharacterByNameOrId } from '@/lib/services/character-resolver';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { deliverLetter, readLetter } from '@/lib/post-office/mailbox';

jest.mock('@/lib/services/character-resolver', () => ({
  resolveCharacterByNameOrId: jest.fn(),
}));
jest.mock('@/lib/mount-index/character-vault', () => ({
  ensureCharacterVault: jest.fn(),
}));
jest.mock('@/lib/post-office/mailbox', () => {
  const actual = jest.requireActual('@/lib/post-office/mailbox');
  return { ...actual, deliverLetter: jest.fn(), readLetter: jest.fn() };
});

const sender = { id: 's1', name: 'Ariadne', characterDocumentMountPointId: 'sv' };
const recipient = { id: 'r1', name: 'Bertie', characterDocumentMountPointId: 'rv' };

const ctx = { userId: 'u1', chatId: 'chat-1', characterId: 's1', callingParticipantId: 'p1' };

beforeEach(() => {
  jest.clearAllMocks();

  jest.mocked(getRepositories).mockReturnValue({
    characters: {
      findByIdRaw: jest.fn().mockImplementation(async (id: string) => (id === 's1' ? sender : null)),
    },
  } as never);

  jest.mocked(resolveCharacterByNameOrId).mockResolvedValue(recipient as never);
  jest.mocked(ensureCharacterVault).mockImplementation(async (c: { id: string }) => ({
    mountPointId: c.id === 's1' ? 'sv' : 'rv',
    created: false,
  }));
  jest.mocked(deliverLetter).mockResolvedValue({ path: 'Mail/123-from-ariadne.md' });
});

describe('executeSendMailTool', () => {
  it('delivers into the recipient vault (never the sender vault) and names the recipient', async () => {
    const out = await executeSendMailTool({ character: 'Bertie', message: 'Hello there.' }, ctx);

    expect(out.success).toBe(true);
    expect(out.path).toBe('Mail/123-from-ariadne.md');
    expect(out.message).toContain('Bertie');

    expect(deliverLetter).toHaveBeenCalledTimes(1);
    const arg = jest.mocked(deliverLetter).mock.calls[0][0];
    expect(arg.recipientVaultId).toBe('rv');
    expect(arg.fromName).toBe('Ariadne');
    expect(arg.fromCharacterId).toBe('s1');
    expect(arg.body).toBe('Hello there.');
    expect(arg.inReplyTo).toBeNull();
    // No "Sent" copy — delivery never targets the sender's own vault.
    expect(arg.recipientVaultId).not.toBe('sv');
  });

  it('resolves the recipient by the given token (id or name)', async () => {
    await executeSendMailTool({ character: 'r1', message: 'hi' }, ctx);
    expect(resolveCharacterByNameOrId).toHaveBeenCalledWith('u1', 'r1');
  });

  it('prefaces a reply with the quoted original body only (no frontmatter)', async () => {
    jest.mocked(readLetter).mockResolvedValue({
      frontmatter: {
        from: 'Bertie',
        fromCharacterId: 'r1',
        sentAt: '2026-06-01T12:00:00.000Z',
        alerted: true,
        inReplyTo: null,
      },
      body: 'The original words.',
    });

    const out = await executeSendMailTool(
      { character: 'Bertie', message: 'My reply.', in_reply_to: 'Mail/old-from-bertie.md' },
      ctx,
    );

    expect(out.success).toBe(true);
    expect(readLetter).toHaveBeenCalledWith('sv', 'Mail/old-from-bertie.md');
    const body = jest.mocked(deliverLetter).mock.calls[0][0].body;
    expect(body).toContain('> The original words.');
    expect(body).toContain('In reply to your letter of');
    expect(body).toContain('My reply.');
    expect(body).not.toContain('from:');
    expect(jest.mocked(deliverLetter).mock.calls[0][0].inReplyTo).toBe('Mail/old-from-bertie.md');
  });

  it('fails gracefully when in_reply_to is not a Mail/ path in the sender mailbox', async () => {
    const out = await executeSendMailTool(
      { character: 'Bertie', message: 'hi', in_reply_to: 'Notes/secret.md' },
      ctx,
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/postbox/i);
    expect(deliverLetter).not.toHaveBeenCalled();
  });

  it('fails gracefully when in_reply_to is a Mail/ path that does not exist', async () => {
    jest.mocked(readLetter).mockResolvedValue(null);
    const out = await executeSendMailTool(
      { character: 'Bertie', message: 'hi', in_reply_to: 'Mail/missing.md' },
      ctx,
    );
    expect(out.success).toBe(false);
    expect(deliverLetter).not.toHaveBeenCalled();
  });

  it('fails gracefully on an unknown recipient', async () => {
    jest.mocked(resolveCharacterByNameOrId).mockResolvedValue(null);
    const out = await executeSendMailTool({ character: 'Nobody', message: 'hi' }, ctx);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/no soul/i);
    expect(deliverLetter).not.toHaveBeenCalled();
  });

  it('rejects an empty body via schema validation', async () => {
    const out = await executeSendMailTool({ character: 'Bertie', message: '' }, ctx);
    expect(out.success).toBe(false);
    expect(deliverLetter).not.toHaveBeenCalled();
  });

  it('fails when there is no acting character', async () => {
    const out = await executeSendMailTool(
      { character: 'Bertie', message: 'hi' },
      { ...ctx, characterId: null },
    );
    expect(out.success).toBe(false);
    expect(deliverLetter).not.toHaveBeenCalled();
  });
});
