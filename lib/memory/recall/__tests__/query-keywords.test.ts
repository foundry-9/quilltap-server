/**
 * Keyword + turn-guess parsing of the recall query distiller
 * (`extractMemorySearchKeywords`). `executeCheapLLMTask` is mocked so a canned
 * LLM JSON response is fed straight into the real parser the distiller passes
 * in. Split out of the retired cheap-llm-tasks memory-extraction-tags test
 * when the distiller moved to `lib/memory/recall/query.ts` (memory refactor
 * Phase D).
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import { extractMemorySearchKeywords, type MemorySearchExtraction } from '../query';

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../../cheap-llm-tasks/core-execution', () => ({
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
import { executeCheapLLMTask } from '../../cheap-llm-tasks/core-execution';
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm';

const SELECTION: CheapLLMSelection = {
  provider: 'OPENAI',
  modelName: 'gpt-test',
  connectionProfileId: 'profile-1',
  isLocal: false,
} as never;

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

describe('extractMemorySearchKeywords — keyword + turn-guess parsing', () => {
  async function runKeywords(): Promise<MemorySearchExtraction> {
    const res = await extractMemorySearchKeywords(
      [{ role: 'user', content: 'we keep circling back to the bridge plan' }],
      'Friday',
      SELECTION,
      'user-1',
      'chat-1',
      'char-1',
    );
    return res.result ?? { keywords: [] };
  }

  it('parses the object shape with a valid temporal/context guess', async () => {
    nextResponse = JSON.stringify({
      keywords: ['bridge', 'plan', 'engineering'],
      temporal: 'future',
      context: 'philosophy',
    });
    const r = await runKeywords();
    expect(r.keywords).toEqual(['bridge', 'plan', 'engineering']);
    expect(r.temporal).toBe('future');
    expect(r.context).toBe('philosophy');
  });

  it('lowercases and validates the guess, dropping out-of-vocabulary values', async () => {
    nextResponse = JSON.stringify({
      keywords: ['bridge'],
      temporal: 'PRESENT',
      context: 'gossip', // not in the closed vocabulary → undefined
    });
    const r = await runKeywords();
    expect(r.keywords).toEqual(['bridge']);
    expect(r.temporal).toBe('present');
    expect(r.context).toBeUndefined();
  });

  it('leaves the guess undefined when the model omits it', async () => {
    nextResponse = JSON.stringify({ keywords: ['bridge', 'plan'] });
    const r = await runKeywords();
    expect(r.keywords).toEqual(['bridge', 'plan']);
    expect(r.temporal).toBeUndefined();
    expect(r.context).toBeUndefined();
  });

  it('accepts a bare keyword array (legacy / model drift) with no guess', async () => {
    nextResponse = JSON.stringify(['bridge', 'plan']);
    const r = await runKeywords();
    expect(r.keywords).toEqual(['bridge', 'plan']);
    expect(r.temporal).toBeUndefined();
    expect(r.context).toBeUndefined();
  });

  it('filters non-string keywords and caps the list at 10', async () => {
    nextResponse = JSON.stringify({
      keywords: ['a', 2, '', 'b', null, 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
    });
    const r = await runKeywords();
    expect(r.keywords).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    expect(r.keywords.length).toBe(10);
  });

  it('returns an empty extraction on non-JSON output', async () => {
    nextResponse = 'sorry, I cannot do that';
    const r = await runKeywords();
    expect(r.keywords).toEqual([]);
    expect(r.temporal).toBeUndefined();
    expect(r.context).toBeUndefined();
  });
});
