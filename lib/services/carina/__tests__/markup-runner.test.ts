/**
 * Unit tests for the shared Carina inline-markup runner, `runCarinaMarkupQuery`.
 *
 * Both the orchestrator (user-message path) and the message finalizer
 * (assistant-markup path) route through this one helper; these tests pin the
 * orchestration the two paths share — detect → consult → run → surface →
 * splice-public / route-error → swallow-throw — with all collaborators mocked.
 */

import { runCarinaMarkupQuery } from '../markup-runner';
import { parseCarinaQuery } from '@/lib/chat/carina-parser';
import { runCarinaQuery } from '../carina.service';
import { postProsperoCarinaError } from '@/lib/services/prospero-notifications/writer';
import type { MessageEvent } from '@/lib/schemas/types';

jest.mock('@/lib/chat/carina-parser', () => ({ parseCarinaQuery: jest.fn() }));
jest.mock('../carina.service', () => ({ runCarinaQuery: jest.fn() }));
jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  postProsperoCarinaError: jest.fn(),
}));

const mockParse = jest.mocked(parseCarinaQuery);
const mockRun = jest.mocked(runCarinaQuery);
const mockPostError = jest.mocked(postProsperoCarinaError);

const POSTED = { id: 'carina-msg-1' } as unknown as MessageEvent;

function baseOpts() {
  return {
    userId: 'user-1',
    chatId: 'chat-1',
    text: '@Sage: what is the capital of France?',
    askerParticipantId: 'asker-1',
    logLabels: { detected: 'user message', failed: 'user-message' },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runCarinaMarkupQuery', () => {
  it('is a no-op when no markup is present', async () => {
    mockParse.mockReturnValue(null);
    const onConsulting = jest.fn();
    const onPublicAnswer = jest.fn();

    await runCarinaMarkupQuery({ ...baseOpts(), onConsulting, onPublicAnswer });

    expect(mockRun).not.toHaveBeenCalled();
    expect(onConsulting).not.toHaveBeenCalled();
    expect(onPublicAnswer).not.toHaveBeenCalled();
    expect(mockPostError).not.toHaveBeenCalled();
  });

  it('consults, runs, surfaces, and splices a successful PUBLIC answer', async () => {
    mockParse.mockReturnValue({ characterName: 'Sage', question: 'capital?', whisper: false });
    mockRun.mockResolvedValue({
      ok: true,
      answer: 'Paris',
      messageId: 'carina-msg-1',
      message: POSTED,
      answererId: 'sage-1',
      answererName: 'Sage',
    });
    const onConsulting = jest.fn();
    const onPosted = jest.fn();
    const onPublicAnswer = jest.fn();

    await runCarinaMarkupQuery({
      ...baseOpts(),
      operatorInitiated: true,
      onConsulting,
      onPosted,
      onPublicAnswer,
    });

    expect(onConsulting).toHaveBeenCalledWith('Sage');
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        chatId: 'chat-1',
        characterName: 'Sage',
        question: 'capital?',
        whisper: false,
        askerParticipantId: 'asker-1',
        operatorInitiated: true,
        onPosted,
      })
    );
    expect(onPublicAnswer).toHaveBeenCalledWith(POSTED);
    expect(mockPostError).not.toHaveBeenCalled();
  });

  it('does NOT splice a whisper answer into the live turn', async () => {
    mockParse.mockReturnValue({ characterName: 'Sage', question: 'secret?', whisper: true });
    mockRun.mockResolvedValue({
      ok: true,
      answer: 'shh',
      messageId: 'carina-msg-2',
      message: POSTED,
      answererId: 'sage-1',
      answererName: 'Sage',
    });
    const onPublicAnswer = jest.fn();

    await runCarinaMarkupQuery({ ...baseOpts(), onPublicAnswer });

    expect(onPublicAnswer).not.toHaveBeenCalled();
    expect(mockPostError).not.toHaveBeenCalled();
  });

  it('routes a failure through Prospero with the error fields and asker', async () => {
    mockParse.mockReturnValue({ characterName: 'Sage', question: 'q', whisper: false });
    mockRun.mockResolvedValue({
      ok: false,
      error: { kind: 'no-profile', characterName: 'Sage', detail: undefined },
    });
    const onPublicAnswer = jest.fn();

    await runCarinaMarkupQuery({ ...baseOpts(), onPublicAnswer });

    expect(onPublicAnswer).not.toHaveBeenCalled();
    expect(mockPostError).toHaveBeenCalledWith({
      chatId: 'chat-1',
      kind: 'no-profile',
      characterName: 'Sage',
      detail: undefined,
      whisper: false,
      askerParticipantId: 'asker-1',
    });
  });

  it('swallows a thrown query (the turn must not fail) and does not route an error', async () => {
    mockParse.mockReturnValue({ characterName: 'Sage', question: 'q', whisper: false });
    mockRun.mockRejectedValue(new Error('network down'));

    await expect(runCarinaMarkupQuery(baseOpts())).resolves.toBeUndefined();
    expect(mockPostError).not.toHaveBeenCalled();
  });

  it('omits operatorInitiated for the assistant-markup path', async () => {
    mockParse.mockReturnValue({ characterName: 'Sage', question: 'q', whisper: false });
    mockRun.mockResolvedValue({
      ok: true,
      answer: 'a',
      messageId: 'm',
      message: POSTED,
      answererId: 'sage-1',
      answererName: 'Sage',
    });

    await runCarinaMarkupQuery({
      ...baseOpts(),
      askerParticipantId: 'char-participant-1',
      logLabels: { detected: 'assistant response', failed: 'assistant-markup' },
    });

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ operatorInitiated: undefined, askerParticipantId: 'char-participant-1' })
    );
  });
});
