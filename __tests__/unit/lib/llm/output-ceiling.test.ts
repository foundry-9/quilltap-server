/**
 * Tests for the output-token ceiling learned from providers and applied to
 * every text provider the registry creates.
 */

jest.mock('@/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { logger: { ...noop, child: () => noop } };
});

const mockPlugins: Array<{ manifest: { providerConfig?: { providerName: string; maxOutputTokens?: number } } }> = [];
jest.mock('@/lib/plugins/registry', () => ({
  getPluginsByCapability: () => mockPlugins,
}));

const mockLookupLiveModelEntry = jest.fn();
jest.mock('@/lib/llm/model-catalog', () => ({
  lookupLiveModelEntry: (...args: unknown[]) => mockLookupLiveModelEntry(...args),
}));

import {
  clearOutputCeilingCache,
  resolveOutputCeiling,
  withOutputCeiling,
  FAILED_LOOKUP_RETRY_MS,
} from '@/lib/llm/output-ceiling';
import type { LLMParams, TextProvider } from '@quilltap/plugin-types';

function params(maxTokens?: number): LLMParams {
  return { messages: [{ role: 'user', content: 'hi' }], model: 'glm-5.3-flash', maxTokens } as LLMParams;
}

function fakeProvider() {
  const sendMessage = jest.fn(async (_p: LLMParams) => ({ content: 'ok' }));
  const streamMessage = jest.fn(async function* (_p: LLMParams) { yield { content: 'a' }; });
  const provider = {
    sendMessage,
    streamMessage,
    validateApiKey: jest.fn(async () => true),
    getAvailableModels: jest.fn(async () => ['glm-5.3-flash']),
  } as unknown as TextProvider;
  return { provider, sendMessage, streamMessage };
}

beforeEach(() => {
  clearOutputCeilingCache();
  mockPlugins.length = 0;
  mockLookupLiveModelEntry.mockReset();
  mockLookupLiveModelEntry.mockResolvedValue(null);
});

describe('resolveOutputCeiling', () => {
  it('uses the ceiling the manifest declares when there is no catalog', async () => {
    mockPlugins.push({ manifest: { providerConfig: { providerName: 'Z_AI', maxOutputTokens: 131072 } } });
    await expect(resolveOutputCeiling('Z_AI', 'glm-5.3-flash', 'key')).resolves.toBe(131072);
  });

  it('takes the lower of the catalog limit and the declared ceiling', async () => {
    mockPlugins.push({ manifest: { providerConfig: { providerName: 'Z_AI', maxOutputTokens: 131072 } } });
    mockLookupLiveModelEntry.mockResolvedValue({ id: 'glm-5.3-flash', name: 'x', maxOutputTokens: 65536 });
    await expect(resolveOutputCeiling('Z_AI', 'glm-5.3-flash', 'key')).resolves.toBe(65536);
  });

  it('is null when the provider says nothing', async () => {
    await expect(resolveOutputCeiling('OPENAI', 'gpt-5', 'key')).resolves.toBeNull();
  });

  it('asks the catalog once per session', async () => {
    mockLookupLiveModelEntry.mockResolvedValue({ id: 'm', name: 'm', maxOutputTokens: 8000 });
    await resolveOutputCeiling('NANOGPT', 'm', 'key');
    await resolveOutputCeiling('NANOGPT', 'm', 'key');
    await Promise.all([resolveOutputCeiling('NANOGPT', 'm', 'key'), resolveOutputCeiling('NANOGPT', 'm', 'key')]);
    expect(mockLookupLiveModelEntry).toHaveBeenCalledTimes(1);
  });

  it('retries a failed catalog read only after the retry window', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockLookupLiveModelEntry.mockRejectedValueOnce(new Error('offline'));
    mockLookupLiveModelEntry.mockResolvedValueOnce({ id: 'm', name: 'm', maxOutputTokens: 8000 });

    await expect(resolveOutputCeiling('NANOGPT', 'm', 'key')).resolves.toBeNull();
    await expect(resolveOutputCeiling('NANOGPT', 'm', 'key')).resolves.toBeNull();
    expect(mockLookupLiveModelEntry).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + FAILED_LOOKUP_RETRY_MS + 1);
    await expect(resolveOutputCeiling('NANOGPT', 'm', 'key')).resolves.toBe(8000);
    expect(mockLookupLiveModelEntry).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
});

describe('withOutputCeiling', () => {
  beforeEach(() => {
    mockPlugins.push({ manifest: { providerConfig: { providerName: 'Z_AI', maxOutputTokens: 131072 } } });
  });

  it('clamps sendMessage above the ceiling and leaves smaller requests alone', async () => {
    const { provider, sendMessage } = fakeProvider();
    const wrapped = withOutputCeiling('Z_AI', undefined, provider);

    await wrapped.sendMessage(params(132000), 'key');
    await wrapped.sendMessage(params(4000), 'key');
    await wrapped.sendMessage(params(undefined), 'key');

    expect(sendMessage.mock.calls.map(([p]) => p.maxTokens)).toEqual([131072, 4000, undefined]);
  });

  it('clamps streamMessage and still yields the stream', async () => {
    const { provider, streamMessage } = fakeProvider();
    const wrapped = withOutputCeiling('Z_AI', undefined, provider);

    const chunks = [];
    for await (const chunk of wrapped.streamMessage(params(943718), 'key')) chunks.push(chunk);

    expect(chunks).toEqual([{ content: 'a' }]);
    expect(streamMessage.mock.calls[0][0].maxTokens).toBe(131072);
  });

  it('passes every other member through', async () => {
    const { provider } = fakeProvider();
    const wrapped = withOutputCeiling('Z_AI', undefined, provider);
    await expect(wrapped.getAvailableModels('key')).resolves.toEqual(['glm-5.3-flash']);
  });
});
