/**
 * Unit tests for memory-extraction targeting-tag normalization and the
 * orienting-context / TAGS prompt structure. We mock executeCheapLLMTask so we
 * can (a) feed a canned LLM JSON response straight into the real parser the
 * extractor passes in, and (b) capture the system prompt to assert the cache-
 * safe footer placement.
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import {
  extractSelfMemoriesFromTurn,
  extractOtherMemoriesFromTurn,
  type OrientingContext,
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
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript';
import type { MemoryCandidate, CheapLLMTaskResult } from '../types';
import type { OtherSubjectInput } from '../memory-tasks';

const SELECTION: CheapLLMSelection = {
  provider: 'OPENAI',
  modelName: 'gpt-test',
  connectionProfileId: 'profile-1',
  isLocal: false,
} as never;

const TRANSCRIPT: TurnTranscript = {
  characterSlices: [
    { characterId: 'obs', characterName: 'Friday', characterPronouns: null, text: 'I made a call.', contributingMessageIds: ['m1'] },
  ],
  userMessage: null,
  userCharacterId: undefined,
  userCharacterName: undefined,
  userCharacterPronouns: null,
  latestAssistantMessageId: 'm1',
} as unknown as TurnTranscript;

const SUBJECTS: OtherSubjectInput[] = [
  { id: 's1', name: 'Amy', pronouns: null, isUser: false, canonBlock: 'ALREADY ESTABLISHED about Amy\n[IDENTITY] An engineer.' },
];

/** The next canned LLM JSON response the mocked parser will receive. */
let nextResponse = '[]';

beforeEach(() => {
  jest.clearAllMocks();
  nextResponse = '[]';
  jest.mocked(executeCheapLLMTask).mockImplementation(
    async (_sel, _msgs, _uid, parse) =>
      ({ success: true, result: (parse as (c: string) => unknown)(nextResponse) }) as never,
  );
});

function lastSystemMessage(): string {
  const calls = jest.mocked(executeCheapLLMTask).mock.calls;
  const messages = calls[calls.length - 1][1] as Array<{ role: string; content: string }>;
  return messages.find((m) => m.role === 'system')!.content;
}

async function runSelf(opts?: OrientingContext): Promise<MemoryCandidate[]> {
  const res = (await extractSelfMemoriesFromTurn(
    TRANSCRIPT, 'obs', 'CANON', SELECTION, 'user-1', undefined, 'chat-1', 8000, false, opts,
  )) as CheapLLMTaskResult<MemoryCandidate[]>;
  return res.result ?? [];
}

async function runOther(opts?: OrientingContext): Promise<Map<string, MemoryCandidate[]>> {
  const res = (await extractOtherMemoriesFromTurn(
    TRANSCRIPT, 'obs', SUBJECTS, SELECTION, 'user-1', undefined, 'chat-1', 8000, false, opts,
  )) as CheapLLMTaskResult<Map<string, MemoryCandidate[]>>;
  return res.result ?? new Map();
}

describe('SELF tag normalization → keywords', () => {
  it('passes valid tags through and materializes them after the free keywords', async () => {
    nextResponse = JSON.stringify([
      { content: 'I committed to X.', summary: 'committed to x', keywords: ['alpha', 'beta'], importance: 0.8, temporal: 'future', scope: 'narrow', context: 'philosophy' },
    ]);
    const [candidate] = await runSelf();
    expect(candidate.keywords).toEqual(['alpha', 'beta', 'future', 'scope: narrow', 'philosophy']);
  });

  it('defaults invalid values to present / wide / information', async () => {
    nextResponse = JSON.stringify([
      { content: 'I did Y.', summary: 'did y', keywords: ['alpha'], importance: 0.5, temporal: 'someday', scope: 'galaxy', context: 'gossip' },
    ]);
    const [candidate] = await runSelf();
    expect(candidate.keywords).toEqual(['alpha', 'present', 'scope: wide', 'information']);
  });

  it('defaults missing tags (and missing keywords) to the fallbacks', async () => {
    nextResponse = JSON.stringify([
      { content: 'I did Z.', summary: 'did z', importance: 0.5 },
    ]);
    const [candidate] = await runSelf();
    expect(candidate.keywords).toEqual(['present', 'scope: wide', 'information']);
  });

  it('lowercases valid-but-uppercased tags', async () => {
    nextResponse = JSON.stringify([
      { content: 'I changed.', summary: 'changed', keywords: [], importance: 0.5, temporal: 'PAST', scope: 'WIDE', context: 'History' },
    ]);
    const [candidate] = await runSelf();
    expect(candidate.keywords).toEqual(['past', 'scope: wide', 'history']);
  });
});

describe('OTHER tag normalization → keywords (routed by subjectIndex)', () => {
  it('passes valid tags through for the addressed subject', async () => {
    nextResponse = JSON.stringify([
      { subjectIndex: 1, content: 'Amy proposed a layout.', summary: 'proposed layout', keywords: ['cache'], importance: 0.7, temporal: 'moment', scope: 'narrow', context: 'philosophy' },
    ]);
    const result = await runOther();
    const amy = result.get('s1') ?? [];
    expect(amy[0].keywords).toEqual(['cache', 'moment', 'scope: narrow', 'philosophy']);
  });

  it('defaults invalid/missing tags', async () => {
    nextResponse = JSON.stringify([
      { subjectIndex: 1, content: 'Amy did a thing.', summary: 'did a thing', keywords: ['x'], importance: 0.5 },
    ]);
    const result = await runOther();
    const amy = result.get('s1') ?? [];
    expect(amy[0].keywords).toEqual(['x', 'present', 'scope: wide', 'information']);
  });
});

describe('Prompt structure — TAGS block, skip bullet, and cache-safe ORIENTING footer', () => {
  it('always includes the TAGS block and the orienting-context skip bullet', async () => {
    await runSelf();
    const system = lastSystemMessage();
    expect(system).toContain('TAGS — every memory object MUST carry exactly one value from each axis.');
    expect(system).toContain('Never extract a memory whose only source is the ORIENTING CONTEXT block.');
  });

  it('omits the ORIENTING CONTEXT block entirely when no context is supplied', async () => {
    await runSelf();
    const system = lastSystemMessage();
    expect(system).not.toContain('ORIENTING CONTEXT — background only');
  });

  it('renders the ORIENTING CONTEXT footer after the body and before the CONTEXT footer', async () => {
    await runSelf({ projectDescription: 'My project desc', chatContextSummary: 'The story summary' });
    const system = lastSystemMessage();
    expect(system).toContain('ORIENTING CONTEXT — background only, never a source of memories');
    expect(system).toContain('PROJECT: My project desc');
    expect(system).toContain('STORY SO FAR: The story summary');
    // The footer must sit between the body's TAGS block and the CONTEXT/SUBJECT block.
    const tagsAt = system.indexOf('TAGS — every memory object');
    const orientingAt = system.indexOf('ORIENTING CONTEXT — background only');
    const contextAt = system.indexOf('\nCONTEXT\nSUBJECT:');
    expect(tagsAt).toBeGreaterThanOrEqual(0);
    expect(orientingAt).toBeGreaterThan(tagsAt);
    expect(contextAt).toBeGreaterThan(orientingAt);
  });

  it('keeps the cached body prefix byte-identical with and without orienting context', async () => {
    await runSelf();
    const without = lastSystemMessage();
    await runSelf({ projectDescription: 'My project desc', chatContextSummary: 'The story summary' });
    const withCtx = lastSystemMessage();
    // The body ends at this literal line; everything up to it is the cacheable prefix.
    const marker = 'the bar, return [].';
    const idxWithout = without.indexOf(marker);
    const idxWith = withCtx.indexOf(marker);
    expect(idxWithout).toBeGreaterThanOrEqual(0);
    expect(idxWith).toBeGreaterThanOrEqual(0);
    expect(withCtx.slice(0, idxWith)).toBe(without.slice(0, idxWithout));
  });

  it('truncates an over-long project description to 1500 chars with an ellipsis', async () => {
    const long = 'x'.repeat(2000);
    await runSelf({ projectDescription: long, chatContextSummary: null });
    const system = lastSystemMessage();
    expect(system).toContain(`PROJECT: ${'x'.repeat(1500)}…`);
    expect(system).not.toContain('x'.repeat(1501));
  });
});
