/**
 * Tests for Suparṇā's Post Office mail whisper writer.
 *
 * The builders are pure and tested directly. `postSuparnaMailWhisper` is
 * repo-driven: jest.setup globally mocks `@/lib/repositories/factory`, configured
 * per-test. The key invariants: systemSender 'suparna', opaqueContent === content
 * (so Suparṇā is non-opaque), correct targeting, and warn-only error handling.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import {
  buildSuparnaMailWhisper,
  buildSuparnaMailLLMContext,
  postSuparnaMailWhisper,
} from '../writer';
import type { DeliveredLetterSummary } from '@/lib/post-office/mailbox';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';

function letter(over: Partial<DeliveredLetterSummary>): DeliveredLetterSummary {
  return {
    path: 'Mail/100-from-bertie.md',
    from: 'Bertie',
    sentAt: '2026-06-10T00:00:00.000Z',
    body: 'How do you do?',
    alerted: false,
    inReplyTo: null,
    ...over,
  };
}

describe('buildSuparnaMailWhisper', () => {
  it('names the sender, reads the body, and appends the action snippets', () => {
    const out = buildSuparnaMailWhisper([letter({})]);
    expect(out).toContain('Suparṇā');
    expect(out).toContain('Bertie');
    expect(out).toContain('> How do you do?');
    expect(out).toContain('mount_point: "self"');
    expect(out).toContain('Mail/100-from-bertie.md');
  });

  it('handles multiple letters', () => {
    const out = buildSuparnaMailWhisper([
      letter({ path: 'Mail/a.md', from: 'Bertie' }),
      letter({ path: 'Mail/b.md', from: 'Ariadne' }),
    ]);
    expect(out).toContain('2 letters');
    expect(out).toContain('Mail/a.md');
    expect(out).toContain('Mail/b.md');
  });

  it('returns empty string for no letters', () => {
    expect(buildSuparnaMailWhisper([])).toBe('');
  });
});

describe('buildSuparnaMailLLMContext', () => {
  it('frames new mail in second person with the body and how-to', () => {
    const out = buildSuparnaMailLLMContext([letter({})]);
    expect(out).toContain('Suparṇā');
    expect(out).toContain('Bertie');
    expect(out).toContain('How do you do?');
    expect(out).toContain('mount_point "self"');
    expect(out).toContain('Mail/100-from-bertie.md');
  });
  it('returns empty string for no letters', () => {
    expect(buildSuparnaMailLLMContext([])).toBe('');
  });
});

describe('postSuparnaMailWhisper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockRepos(addMessage: jest.Mock) {
    jest.mocked(getRepositories).mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue({ id: 'chat-1', participants: [] }),
        addMessage,
      },
    } as never);
  }

  it('posts a suparna mail-delivery message with opaqueContent === content, targeted', async () => {
    const addMessage = jest.fn().mockResolvedValue(undefined);
    mockRepos(addMessage);

    const result = await postSuparnaMailWhisper({
      chatId: 'chat-1',
      targetParticipantId: 'p1',
      content: 'Suparṇā delivered a letter.',
    });

    expect(result).not.toBeNull();
    expect(addMessage).toHaveBeenCalledTimes(1);
    const [, message] = addMessage.mock.calls[0];
    expect(message.systemSender).toBe('suparna');
    expect(message.systemKind).toBe('mail-delivery');
    expect(message.role).toBe('ASSISTANT');
    expect(message.participantId).toBeNull();
    expect(message.targetParticipantIds).toEqual(['p1']);
    expect(message.opaqueContent).toBe(message.content);
    expect(message.content).toBe('Suparṇā delivered a letter.');
  });

  it('posts untargeted (null) when no participant is given', async () => {
    const addMessage = jest.fn().mockResolvedValue(undefined);
    mockRepos(addMessage);
    await postSuparnaMailWhisper({ chatId: 'chat-1', content: 'x' });
    expect(addMessage.mock.calls[0][1].targetParticipantIds).toBeNull();
  });

  it('returns null without posting for empty content', async () => {
    const addMessage = jest.fn().mockResolvedValue(undefined);
    mockRepos(addMessage);
    const result = await postSuparnaMailWhisper({ chatId: 'chat-1', content: '   ' });
    expect(result).toBeNull();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('never throws — a post failure is warn-only and returns null', async () => {
    const addMessage = jest.fn().mockRejectedValue(new Error('db down'));
    mockRepos(addMessage);
    const result = await postSuparnaMailWhisper({ chatId: 'chat-1', content: 'x' });
    expect(result).toBeNull();
  });
});
