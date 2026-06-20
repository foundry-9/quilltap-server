/**
 * Unit tests for user-controlled-character memory extraction: the SELF
 * first-person preamble (gated on the slice's isUserControlled flag) and the
 * renderTurnContext single-feed / coherent-roster behaviour. We mock
 * executeCheapLLMTask so we can capture both the system prompt (SELF clause)
 * and the user message (rendered turn transcript).
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import {
  extractSelfMemoriesFromTurn,
} from '../memory-tasks';

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}));

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { executeCheapLLMTask } from '../core-execution';
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm';
import type { TurnTranscript, TurnCharacterSlice } from '@/lib/services/chat-message/turn-transcript';

const SELECTION: CheapLLMSelection = {
  provider: 'OPENAI',
  modelName: 'gpt-test',
  connectionProfileId: 'profile-1',
  isLocal: false,
} as never;

const CLAUSE_MARKER = 'a character a human is playing directly';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(executeCheapLLMTask).mockImplementation(
    async (_sel, _msgs, _uid, parse) =>
      ({ success: true, result: (parse as (c: string) => unknown)('[]') }) as never,
  );
});

function lastMessages(): Array<{ role: string; content: string }> {
  const calls = jest.mocked(executeCheapLLMTask).mock.calls;
  return calls[calls.length - 1][1] as Array<{ role: string; content: string }>;
}
function lastSystemMessage(): string {
  return lastMessages().find((m) => m.role === 'system')!.content;
}
function lastUserMessage(): string {
  return lastMessages().find((m) => m.role === 'user')!.content;
}

function transcript(slices: TurnCharacterSlice[], extra: Partial<TurnTranscript> = {}): TurnTranscript {
  return {
    characterSlices: slices,
    userMessage: null,
    userCharacterId: undefined,
    userCharacterName: undefined,
    userCharacterPronouns: null,
    turnOpenerMessageId: null,
    latestAssistantMessageId: slices.length ? slices[slices.length - 1].contributingMessageIds.at(-1)! : null,
    ...extra,
  } as unknown as TurnTranscript;
}

async function runSelf(t: TurnTranscript, targetId: string): Promise<void> {
  await extractSelfMemoriesFromTurn(t, targetId, 'CANON', SELECTION, 'user-1', undefined, 'chat-1', 8000, false);
}

describe('SELF first-person preamble (isUserControlled)', () => {
  const obsSlice = (isUserControlled?: boolean): TurnCharacterSlice => ({
    characterId: 'obs',
    characterName: 'Friday',
    characterPronouns: null,
    text: 'I made a call.',
    contributingMessageIds: ['m1'],
    ...(isUserControlled ? { isUserControlled: true } : {}),
  });

  it('prepends the first-person clause when the target slice is user-controlled', async () => {
    await runSelf(transcript([obsSlice(true)]), 'obs');
    expect(lastSystemMessage()).toContain(CLAUSE_MARKER);
  });

  it('omits the clause for an ordinary AI slice', async () => {
    await runSelf(transcript([obsSlice(false)]), 'obs');
    expect(lastSystemMessage()).not.toContain(CLAUSE_MARKER);
  });

  it('changes only the prepended clause — the cached body prefix stays byte-identical', async () => {
    await runSelf(transcript([obsSlice(false)]), 'obs');
    const aiSystem = lastSystemMessage();
    await runSelf(transcript([obsSlice(true)]), 'obs');
    const ucSystem = lastSystemMessage();

    // The user-controlled prompt is exactly the AI prompt with a prepended
    // clause: everything after the clause is unchanged, so providers' prefix
    // caches are unaffected for the common (AI) path.
    expect(ucSystem.endsWith(aiSystem)).toBe(true);
    expect(ucSystem.length).toBeGreaterThan(aiSystem.length);
    expect(ucSystem.startsWith('IMPORTANT: The SUBJECT below is ' + CLAUSE_MARKER)).toBe(true);
  });
});

describe('renderTurnContext — user-controlled single-feed + roster', () => {
  const userSlice: TurnCharacterSlice = {
    characterId: 'char-user',
    characterName: 'Operator',
    characterPronouns: null,
    text: 'I refuse to go.',
    contributingMessageIds: ['u1'],
    isUserControlled: true,
  };
  const aiSlice: TurnCharacterSlice = {
    characterId: 'char-a',
    characterName: 'Avery',
    characterPronouns: null,
    text: 'Avery frowns.',
    contributingMessageIds: ['m1'],
  };

  function occurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  it('renders the user-controlled text exactly once, labeled as the user-controlled character', async () => {
    const t = transcript([userSlice, aiSlice], {
      userMessage: 'I refuse to go.',
      userCharacterId: 'char-user',
      userCharacterName: 'Operator',
    });
    await runSelf(t, 'char-user');
    const user = lastUserMessage();

    // Single feed: the verbatim text appears once, not twice.
    expect(occurrences(user, 'I refuse to go.')).toBe(1);
    // Labeled as user-controlled, not as a plain "(the user) says" opener.
    expect(user).toContain('Operator (the user-controlled character) says:');
    expect(user).not.toContain('Operator (the user) says:');
  });

  it('names the user character on the USER line and keeps it out of the AI roster', async () => {
    const t = transcript([userSlice, aiSlice], {
      userMessage: 'I refuse to go.',
      userCharacterId: 'char-user',
      userCharacterName: 'Operator',
    });
    await runSelf(t, 'char-user');
    const user = lastUserMessage();

    expect(user).toContain('- USER: Operator (the human participant)');
    expect(user).toContain('- CHARACTER: Avery (an AI character)');
    // The user character must never be listed as an AI character.
    expect(user).not.toContain('Operator (an AI character)');
    expect(user).not.toContain('* Operator');
  });

  it('regression: a plain-human turn (no user slice) renders the opener as before', async () => {
    const t = transcript([aiSlice], { userMessage: 'tell me a story' });
    await runSelf(t, 'char-a');
    const user = lastUserMessage();

    expect(user).toContain('- USER: The human participant');
    expect(user).toContain('The user says:');
    expect(user).toContain('Avery (the character) says:');
    expect(user).not.toContain('the user-controlled character');
  });
});
