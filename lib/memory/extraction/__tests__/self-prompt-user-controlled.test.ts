/**
 * User-controlled-character memory extraction: the SELF first-person preamble
 * (gated on the slice's isUserControlled flag) and the renderTurnContext
 * single-feed / coherent-roster behaviour. Both are read off the pure SELF
 * message builder: the system prompt (SELF clause) and the user message
 * (rendered turn transcript).
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
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

// ── Subject ───────────────────────────────────────────────────────────────────
import { buildSelfTurnMessages } from '../prompts/self';
import { ORDERED_TURN_TRANSCRIPT_HEADING } from '../window';
import { passCap, HARD_CANDIDATE_CAP } from '../parse';
import type { TurnTranscript, TurnCharacterSlice } from '@/lib/services/chat-message/turn-transcript';

const CLAUSE_MARKER = 'a character a human is playing directly';

let last: Array<{ role: string; content: unknown }> = [];

beforeEach(() => {
  last = [];
});

function lastSystemMessage(): string {
  return last.find((m) => m.role === 'system')!.content as string;
}
function lastUserMessage(): string {
  return last.find((m) => m.role === 'user')!.content as string;
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

function runSelf(t: TurnTranscript, targetId: string): void {
  const messages = buildSelfTurnMessages({
    transcript: t,
    holderId: targetId,
    canonBlock: 'CANON',
    cap: passCap(HARD_CANDIDATE_CAP, 8000),
    inAutonomousRoom: false,
  });
  expect(messages).not.toBeNull();
  last = messages!;
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

  it('prepends the first-person clause when the target slice is user-controlled', () => {
    runSelf(transcript([obsSlice(true)]), 'obs');
    expect(lastSystemMessage()).toContain(CLAUSE_MARKER);
  });

  it('omits the clause for an ordinary AI slice', () => {
    runSelf(transcript([obsSlice(false)]), 'obs');
    expect(lastSystemMessage()).not.toContain(CLAUSE_MARKER);
  });

  it('changes only the prepended clause — the cached body prefix stays byte-identical', () => {
    runSelf(transcript([obsSlice(false)]), 'obs');
    const aiSystem = lastSystemMessage();
    runSelf(transcript([obsSlice(true)]), 'obs');
    const ucSystem = lastSystemMessage();

    // The user-controlled prompt is exactly the AI prompt with a prepended
    // clause: everything after the clause is unchanged, so providers' prefix
    // caches are unaffected for the common (AI) path.
    expect(ucSystem.endsWith(aiSystem)).toBe(true);
    expect(ucSystem.length).toBeGreaterThan(aiSystem.length);
    expect(ucSystem.startsWith('IMPORTANT: The SUBJECT below is ' + CLAUSE_MARKER)).toBe(true);
  });

  it('tells the extractor the SUBJECT has not yet answered anything said after their lines', () => {
    runSelf(transcript([obsSlice(true)]), 'obs');
    const system = lastSystemMessage();
    expect(system).toContain('the SUBJECT has not yet responded to anything the characters said after them');
    expect(system).toContain('Never record the SUBJECT as having accepted, agreed to, or consented to anything');
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

  it('renders the user-controlled text exactly once, labeled as the user-controlled character', () => {
    const t = transcript([userSlice, aiSlice], {
      userMessage: 'I refuse to go.',
      userCharacterId: 'char-user',
      userCharacterName: 'Operator',
    });
    runSelf(t, 'char-user');
    const user = lastUserMessage();

    // Single feed: the verbatim text appears once, not twice.
    expect(occurrences(user, 'I refuse to go.')).toBe(1);
    // Labeled as user-controlled, not as a plain "(the user) says" opener.
    expect(user).toContain('Operator (the user-controlled character) says:');
    expect(user).not.toContain('Operator (the user) says:');
  });

  it('names the user character on the USER line and keeps it out of the AI roster', () => {
    const t = transcript([userSlice, aiSlice], {
      userMessage: 'I refuse to go.',
      userCharacterId: 'char-user',
      userCharacterName: 'Operator',
    });
    runSelf(t, 'char-user');
    const user = lastUserMessage();

    expect(user).toContain('- USER: Operator (the human participant)');
    expect(user).toContain('- CHARACTER: Avery (an AI character)');
    // The user character must never be listed as an AI character.
    expect(user).not.toContain('Operator (an AI character)');
    expect(user).not.toContain('* Operator');
  });

  it('regression: a plain-human turn (no user slice) renders the opener as before', () => {
    const t = transcript([aiSlice], { userMessage: 'tell me a story' });
    runSelf(t, 'char-a');
    const user = lastUserMessage();

    expect(user).toContain('- USER: The human participant');
    expect(user).toContain('The user says:');
    expect(user).toContain('Avery (the character) says:');
    expect(user).not.toContain('the user-controlled character');
  });

  it('uses the ordered heading when the turn carries a user line', () => {
    const t = transcript([aiSlice], { userMessage: 'tell me a story' });
    runSelf(t, 'char-a');
    const user = lastUserMessage();
    expect(user).toContain(ORDERED_TURN_TRANSCRIPT_HEADING);
    expect(user).not.toMatch(/^TURN TRANSCRIPT:$/m);
  });

  it('uses the ordered heading when the user line arrives as a user-controlled slice', () => {
    const t = transcript([userSlice, aiSlice], {
      userMessage: 'I refuse to go.',
      userCharacterId: 'char-user',
      userCharacterName: 'Operator',
    });
    runSelf(t, 'char-a');
    expect(lastUserMessage()).toContain(ORDERED_TURN_TRANSCRIPT_HEADING);
  });

  it('keeps the plain heading when no user line exists (greeting-only turn)', () => {
    runSelf(transcript([aiSlice]), 'char-a');
    const user = lastUserMessage();
    expect(user).toMatch(/^TURN TRANSCRIPT:$/m);
    expect(user).not.toContain(ORDERED_TURN_TRANSCRIPT_HEADING);
  });
});
