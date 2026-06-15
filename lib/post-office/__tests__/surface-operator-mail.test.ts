/**
 * Tests for surfacing Post Office mail addressed to the operator's character(s).
 *
 * The helper composes three collaborators — the characters repo (for the vault
 * id), the mailbox reader/flagger, and the Suparṇā writer. jest.setup globally
 * mocks `@/lib/repositories/factory`; the mailbox and writer modules are mocked
 * here. Key invariants: only user-controlled, present CHARACTER participants are
 * swept; each gets a whisper TARGETED at its participant id; every announced
 * letter is marked alerted; and one participant's failure never throws or stops
 * the others.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { surfaceOperatorMailForChat } from '../surface-operator-mail';
import type { ChatParticipantBase } from '@/lib/schemas/types';
import type { DeliveredLetterSummary } from '@/lib/post-office/mailbox';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { collectUnalertedMail, markAlerted } from '@/lib/post-office/mailbox';
import {
  buildSuparnaMailWhisper,
  postSuparnaMailWhisper,
} from '@/lib/services/suparna-notifications/writer';

jest.mock('@/lib/post-office/mailbox');
jest.mock('@/lib/services/suparna-notifications/writer');

const mockedCollect = jest.mocked(collectUnalertedMail);
const mockedMarkAlerted = jest.mocked(markAlerted);
const mockedBuild = jest.mocked(buildSuparnaMailWhisper);
const mockedPost = jest.mocked(postSuparnaMailWhisper);
const mockedGetRepositories = jest.mocked(getRepositories);

let findByIdRaw: jest.Mock;

function participant(over: Partial<ChatParticipantBase>): ChatParticipantBase {
  return {
    id: 'part-1',
    type: 'CHARACTER',
    characterId: 'char-1',
    controlledBy: 'user',
    displayOrder: 0,
    isActive: true,
    status: 'active',
    removedAt: null,
    hasHistoryAccess: false,
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    ...over,
  } as ChatParticipantBase;
}

function letter(over: Partial<DeliveredLetterSummary> = {}): DeliveredLetterSummary {
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

/** Make findByIdRaw resolve a vault id per characterId (or null when absent). */
function withVaults(map: Record<string, string | null>) {
  findByIdRaw.mockImplementation(async (id: string) =>
    id in map ? ({ id, characterDocumentMountPointId: map[id] } as never) : null,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  findByIdRaw = jest.fn();
  mockedGetRepositories.mockReturnValue({ characters: { findByIdRaw } } as never);
  mockedBuild.mockReturnValue('Suparṇā has a letter for you.');
  mockedPost.mockResolvedValue({ id: 'msg-1', type: 'message' } as never);
});

describe('surfaceOperatorMailForChat', () => {
  it('announces a user-controlled character\'s mail, targeted at its participant, and marks it alerted', async () => {
    withVaults({ 'char-1': 'vault-1' });
    mockedCollect.mockResolvedValue([letter({ path: 'Mail/a.md' })]);

    const posted = await surfaceOperatorMailForChat('chat-1', [
      participant({ id: 'part-1', characterId: 'char-1', controlledBy: 'user' }),
    ]);

    expect(mockedCollect).toHaveBeenCalledWith('vault-1');
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith({
      chatId: 'chat-1',
      targetParticipantId: 'part-1',
      content: 'Suparṇā has a letter for you.',
    });
    expect(mockedMarkAlerted).toHaveBeenCalledWith('vault-1', 'Mail/a.md');
    expect(posted).toHaveLength(1);
  });

  it('marks every unalerted letter alerted', async () => {
    withVaults({ 'char-1': 'vault-1' });
    mockedCollect.mockResolvedValue([letter({ path: 'Mail/a.md' }), letter({ path: 'Mail/b.md' })]);

    await surfaceOperatorMailForChat('chat-1', [participant({})]);

    expect(mockedMarkAlerted).toHaveBeenCalledWith('vault-1', 'Mail/a.md');
    expect(mockedMarkAlerted).toHaveBeenCalledWith('vault-1', 'Mail/b.md');
  });

  it('skips LLM-controlled participants entirely', async () => {
    withVaults({ 'char-1': 'vault-1' });
    mockedCollect.mockResolvedValue([letter()]);

    const posted = await surfaceOperatorMailForChat('chat-1', [
      participant({ controlledBy: 'llm' }),
    ]);

    expect(findByIdRaw).not.toHaveBeenCalled();
    expect(mockedCollect).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });

  it('skips removed participants', async () => {
    withVaults({ 'char-1': 'vault-1' });
    mockedCollect.mockResolvedValue([letter()]);

    await surfaceOperatorMailForChat('chat-1', [
      participant({ removedAt: '2026-06-14T00:00:00.000Z' }),
    ]);

    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('skips a character with no vault (no mount point)', async () => {
    withVaults({ 'char-1': null });

    const posted = await surfaceOperatorMailForChat('chat-1', [participant({})]);

    expect(mockedCollect).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });

  it('posts nothing when there is no unalerted mail', async () => {
    withVaults({ 'char-1': 'vault-1' });
    mockedCollect.mockResolvedValue([]);

    const posted = await surfaceOperatorMailForChat('chat-1', [participant({})]);

    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedMarkAlerted).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });

  it('sweeps every user-controlled participant', async () => {
    withVaults({ 'char-1': 'vault-1', 'char-2': 'vault-2' });
    mockedCollect.mockResolvedValue([letter()]);

    const posted = await surfaceOperatorMailForChat('chat-1', [
      participant({ id: 'part-1', characterId: 'char-1', controlledBy: 'user' }),
      participant({ id: 'part-2', characterId: 'char-2', controlledBy: 'user' }),
      participant({ id: 'part-3', characterId: 'char-3', controlledBy: 'llm' }),
    ]);

    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect(mockedPost).toHaveBeenCalledWith(expect.objectContaining({ targetParticipantId: 'part-1' }));
    expect(mockedPost).toHaveBeenCalledWith(expect.objectContaining({ targetParticipantId: 'part-2' }));
    expect(posted).toHaveLength(2);
  });

  it('is warn-only: one participant failing does not throw and does not stop the others', async () => {
    withVaults({ 'char-1': 'vault-1', 'char-2': 'vault-2' });
    mockedCollect
      .mockRejectedValueOnce(new Error('vault exploded'))
      .mockResolvedValueOnce([letter()]);

    const posted = await surfaceOperatorMailForChat('chat-1', [
      participant({ id: 'part-1', characterId: 'char-1', controlledBy: 'user' }),
      participant({ id: 'part-2', characterId: 'char-2', controlledBy: 'user' }),
    ]);

    // First participant threw; second still announced.
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(expect.objectContaining({ targetParticipantId: 'part-2' }));
    expect(posted).toHaveLength(1);
  });

  it('returns an empty array for a chat with no participants', async () => {
    const posted = await surfaceOperatorMailForChat('chat-1', []);
    expect(posted).toEqual([]);
    expect(findByIdRaw).not.toHaveBeenCalled();
  });
});
