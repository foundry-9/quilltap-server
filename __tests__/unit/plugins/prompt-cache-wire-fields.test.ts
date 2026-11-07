/**
 * Prompt-cache wire fields for Z.AI and DeepSeek.
 *
 * Z.AI's end-user identifier is `user_id` (6–128 chars); the plugin used to
 * send OpenAI's `user`, which Z.AI does not list, so the per-character cache
 * key never reached it. DeepSeek's is also `user_id`. Both plugins must keep
 * the provider's own usage object so hit rates can be audited from the log.
 */

import { ZAIProvider, zaiUserId } from '@/plugins/dist/qtap-plugin-z-ai/provider';
import { DeepSeekProvider } from '@/plugins/dist/qtap-plugin-deepseek/provider';
import { buildCharacterCacheKey } from '@/lib/llm/cache-key';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import OpenAI from 'openai';

const MockOpenAI = OpenAI as unknown as jest.Mock;
let create: jest.Mock;

const COMPLETION = {
  choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 },
};

beforeEach(() => {
  jest.clearAllMocks();
  create = jest.fn().mockResolvedValue(COMPLETION);
  MockOpenAI.mockImplementation(() => ({
    chat: { completions: { create } },
    models: { list: jest.fn() },
  }));
});

const CACHE_KEY = buildCharacterCacheKey('3b465ede-0000-4000-8000-000000000000')!;

function params(extra: Record<string, unknown> = {}) {
  return {
    model: 'glm-5.3-flash',
    messages: [{ role: 'user' as const, content: 'hi' }],
    cacheKey: CACHE_KEY,
    ...extra,
  };
}

describe('zaiUserId', () => {
  it('passes a real character key through', () => {
    expect(zaiUserId(CACHE_KEY)).toBe(CACHE_KEY);
  });

  it.each([undefined, '', 'abc', 'x'.repeat(129)])('omits %p (outside 6–128)', (key) => {
    expect(zaiUserId(key as string | undefined)).toBeUndefined();
  });
});

describe('Z.AI request body', () => {
  it('sends the cache key as user_id, never user (sendMessage)', async () => {
    await new ZAIProvider().sendMessage(params() as never, 'k');
    const body = create.mock.calls[0][0];
    expect(body.user_id).toBe(CACHE_KEY);
    expect(body).not.toHaveProperty('user');
  });

  it('sends the cache key as user_id, never user (streamMessage)', async () => {
    create.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] };
    })());
    for await (const _ of new ZAIProvider().streamMessage(params() as never, 'k')) { /* drain */ }
    const body = create.mock.calls[0][0];
    expect(body.user_id).toBe(CACHE_KEY);
    expect(body).not.toHaveProperty('user');
  });

  it('omits user_id when there is no cache key', async () => {
    await new ZAIProvider().sendMessage(params({ cacheKey: undefined }) as never, 'k');
    expect(create.mock.calls[0][0]).not.toHaveProperty('user_id');
  });
});

describe('DeepSeek streaming', () => {
  it('sends user_id and keeps the raw hit/miss usage on the final chunk', async () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20,
    };
    create.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] };
      yield { choices: [], usage };
    })());

    const chunks = [];
    for await (const c of new DeepSeekProvider().streamMessage(
      params({ model: 'deepseek-v4-flash' }) as never,
      'k'
    )) {
      chunks.push(c);
    }
    expect(create.mock.calls[0][0].user_id).toBe(CACHE_KEY);
    const last = chunks[chunks.length - 1];
    expect(last.done).toBe(true);
    expect(last.rawProviderUsage).toEqual(usage);
    expect(last.cacheUsage).toEqual({ cacheReadInputTokens: 80, cachedTokens: 80 });
    expect(last.usage.promptTokens).toBe(20);
  });
});
