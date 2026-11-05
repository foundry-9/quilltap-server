import {
  isCacheRetentionRejection,
  isOpenAIChatModel,
  isOpenAIReasoningModel,
  parseOpenAIModelFamily,
  supportsOpenAIExtendedCacheRetention,
} from '@/plugins/dist/qtap-plugin-openai/model-families';
import { OpenAIProvider } from '@/plugins/dist/qtap-plugin-openai/provider';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import OpenAI from 'openai';

describe('OpenAI model families', () => {
  it('parses family and version', () => {
    expect(parseOpenAIModelFamily('gpt-6.1-mini')).toMatchObject({ family: 'gpt', major: 6, minor: 1 });
    expect(parseOpenAIModelFamily('gpt-4o')).toMatchObject({ family: 'gpt', major: 4, minor: undefined });
    expect(parseOpenAIModelFamily('o4-mini')).toMatchObject({ family: 'o', major: 4 });
    expect(parseOpenAIModelFamily('gpt-image-1')).toBeNull();
    expect(parseOpenAIModelFamily('gpt-realtime')).toBeNull();
    expect(parseOpenAIModelFamily('omni-moderation-latest')).toBeNull();
  });

  it('lists every generation from gpt-4 on, including ones not yet released', () => {
    for (const id of ['gpt-4o', 'gpt-4.1', 'gpt-5', 'gpt-5.5-pro', 'gpt-6', 'gpt-6.2-mini', 'gpt-7', 'gpt-10.1', 'o1', 'o3-pro', 'o4-mini', 'o7']) {
      expect(isOpenAIChatModel(id)).toBe(true);
    }
    for (const id of ['gpt-3.5-turbo', 'gpt-image-1', 'gpt-realtime', 'dall-e-3', 'text-embedding-3-small', 'omni-moderation-latest', 'whisper-1']) {
      expect(isOpenAIChatModel(id)).toBe(false);
    }
  });

  it('treats gpt-5 and later, and every o-series, as reasoning models', () => {
    expect(isOpenAIReasoningModel('gpt-4o')).toBe(false);
    expect(isOpenAIReasoningModel('gpt-4.1-mini')).toBe(false);
    expect(isOpenAIReasoningModel('gpt-5-mini')).toBe(true);
    expect(isOpenAIReasoningModel('gpt-6.1')).toBe(true);
    expect(isOpenAIReasoningModel('gpt-8')).toBe(true);
    expect(isOpenAIReasoningModel('o3')).toBe(true);
  });

  it('keeps the documented gpt-5 retention set and extends it to later generations', () => {
    expect(supportsOpenAIExtendedCacheRetention('gpt-5')).toBe(false);
    expect(supportsOpenAIExtendedCacheRetention('gpt-5.1')).toBe(true);
    expect(supportsOpenAIExtendedCacheRetention('gpt-5.2-chat-latest')).toBe(true);
    expect(supportsOpenAIExtendedCacheRetention('gpt-5.3-chat-latest')).toBe(false);
    expect(supportsOpenAIExtendedCacheRetention('gpt-5.5')).toBe(true);
    expect(supportsOpenAIExtendedCacheRetention('gpt-6.1')).toBe(true);
    expect(supportsOpenAIExtendedCacheRetention('gpt-6.1-chat-latest')).toBe(false);
    expect(supportsOpenAIExtendedCacheRetention('gpt-4o')).toBe(false);
    expect(supportsOpenAIExtendedCacheRetention('o3')).toBe(false);
  });

  it('recognises a retention rejection only for that parameter', () => {
    const rejection = Object.assign(new Error("400 Unsupported parameter: 'prompt_cache_retention'"), { status: 400 });
    expect(isCacheRetentionRejection(rejection)).toBe(true);
    expect(isCacheRetentionRejection({ status: 400, param: 'prompt_cache_retention', message: 'nope' })).toBe(true);
    expect(isCacheRetentionRejection(Object.assign(new Error('400 bad temperature'), { status: 400 }))).toBe(false);
    expect(isCacheRetentionRejection(Object.assign(new Error('prompt_cache_retention'), { status: 500 }))).toBe(false);
  });
});

describe('OpenAIProvider', () => {
  const MockOpenAI = OpenAI as unknown as jest.Mock;

  beforeEach(() => jest.clearAllMocks());

  it('getAvailableModels lists gpt-6.x and later', async () => {
    MockOpenAI.mockImplementation(() => ({
      models: {
        list: jest.fn().mockResolvedValue({
          data: ['gpt-6.1', 'gpt-5.5', 'gpt-7-mini', 'gpt-image-1', 'gpt-3.5-turbo', 'o4-mini'].map((id) => ({ id })),
        }),
      },
    }));
    const models = await new OpenAIProvider().getAvailableModels('key');
    expect(models).toEqual(['gpt-5.5', 'gpt-6.1', 'gpt-7-mini', 'o4-mini']);
  });

  it('retries once without prompt_cache_retention when the model rejects it', async () => {
    const create = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error("400 Unsupported parameter: 'prompt_cache_retention'"), { status: 400 }))
      .mockResolvedValueOnce({
        output: [],
        output_text: 'hello',
        status: 'completed',
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    MockOpenAI.mockImplementation(() => ({ responses: { create } }));

    const response = await new OpenAIProvider().sendMessage(
      { model: 'gpt-6.1', messages: [{ role: 'user', content: 'hi' }], cacheKey: 'char-1' } as any,
      'key',
    );

    expect(response.content).toBe('hello');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toMatchObject({ prompt_cache_retention: '24h', prompt_cache_key: 'char-1' });
    expect(create.mock.calls[1][0]).not.toHaveProperty('prompt_cache_retention');
    expect(create.mock.calls[1][0]).toMatchObject({ prompt_cache_key: 'char-1' });
    // gpt-6 is a reasoning model: no sampling parameters
    expect(create.mock.calls[0][0]).not.toHaveProperty('temperature');
    expect(create.mock.calls[0][0]).not.toHaveProperty('top_p');
  });
});
