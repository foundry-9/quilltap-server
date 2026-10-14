/**
 * The stall watchdog: a provider that answers with headers and then goes quiet
 * must fail, not hang. Bug 141.
 */

import {
  withStallWatchdog,
  LLMStreamStalledError,
} from '@/lib/llm/stream-watchdog';

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A stream that yields `values`, pausing `gapMs` before each one. */
async function* paced<T>(values: T[], gapMs: number): AsyncGenerator<T> {
  for (const value of values) {
    await sleep(gapMs);
    yield value;
  }
}

/** A stream that yields what it has and then never speaks again. */
function silentAfter<T>(values: T[]): { stream: AsyncGenerator<T>; returned: () => boolean } {
  let didReturn = false;
  async function* gen(): AsyncGenerator<T> {
    try {
      for (const value of values) yield value;
      // The stall: a promise that never settles, which is what a socket with
      // headers and no body looks like from here.
      await new Promise(() => {});
    } finally {
      didReturn = true;
    }
  }
  return { stream: gen(), returned: () => didReturn };
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of source) out.push(value);
  return out;
}

describe('withStallWatchdog', () => {
  const budgets = { firstChunkTimeoutMs: 60, idleTimeoutMs: 40 };

  it('passes a healthy stream through untouched', async () => {
    const chunks = await collect(
      withStallWatchdog(paced(['a', 'b', 'c'], 5), budgets)
    );
    expect(chunks).toEqual(['a', 'b', 'c']);
  });

  it('throws when the first chunk never arrives', async () => {
    const { stream } = silentAfter<string>([]);

    await expect(collect(withStallWatchdog(stream, budgets))).rejects.toThrow(
      LLMStreamStalledError
    );
  });

  it('reports the first-chunk case distinctly from a mid-stream stall', async () => {
    const { stream } = silentAfter<string>([]);
    const error = await collect(withStallWatchdog(stream, budgets)).catch((e) => e);

    expect(error).toBeInstanceOf(LLMStreamStalledError);
    expect(error.chunksReceived).toBe(0);
    expect(error.budgetMs).toBe(60);
    expect(error.message).toMatch(/never sent a first chunk/);
  });

  it('yields what arrived, then throws when the stream goes quiet mid-flight', async () => {
    const { stream } = silentAfter(['a', 'b']);
    const seen: string[] = [];

    const error = await (async () => {
      try {
        for await (const chunk of withStallWatchdog(stream, budgets)) seen.push(chunk);
        return null;
      } catch (e) {
        return e as LLMStreamStalledError;
      }
    })();

    expect(seen).toEqual(['a', 'b']);
    expect(error).toBeInstanceOf(LLMStreamStalledError);
    expect(error!.chunksReceived).toBe(2);
    expect(error!.budgetMs).toBe(40);
    expect(error!.message).toMatch(/went quiet/);
  });

  it('does not abort a slow stream that keeps making progress', async () => {
    // Six gaps of 25ms each: every gap is inside the 40ms idle budget, and the
    // total (150ms) is well past it. The budget is per-gap, not cumulative —
    // a long generation must not be penalised for being long.
    const chunks = await collect(
      withStallWatchdog(paced(['a', 'b', 'c', 'd', 'e', 'f'], 25), budgets)
    );
    expect(chunks).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('carries the provider and model onto the error', async () => {
    const { stream } = silentAfter<string>([]);
    const error = await collect(
      withStallWatchdog(stream, { ...budgets, provider: 'DEEPSEEK', modelName: 'deepseek-v4-flash' })
    ).catch((e) => e);

    expect(error.provider).toBe('DEEPSEEK');
    expect(error.modelName).toBe('deepseek-v4-flash');
  });

  it('closes the source when the consumer breaks early', async () => {
    const { stream, returned } = silentAfter(['a', 'b']);

    for await (const chunk of withStallWatchdog(stream, budgets)) {
      if (chunk === 'a') break;
    }

    expect(returned()).toBe(true);
  });

  it('lets a real provider error through as itself', async () => {
    async function* boom(): AsyncGenerator<string> {
      yield 'a';
      throw new Error('429 rate limit exceeded');
    }

    await expect(collect(withStallWatchdog(boom(), budgets))).rejects.toThrow(
      '429 rate limit exceeded'
    );
    await expect(collect(withStallWatchdog(boom(), budgets))).rejects.not.toBeInstanceOf(
      LLMStreamStalledError
    );
  });
});
