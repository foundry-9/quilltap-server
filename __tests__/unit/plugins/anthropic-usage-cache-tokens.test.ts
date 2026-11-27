/**
 * Anthropic usage normalization: the plugin contract is "promptTokens is every
 * input token except cache reads". Anthropic reports input_tokens apart from
 * both cache reads and cache writes, so the plugin adds the writes back in
 * (billable cache-miss input, as OpenRouter and NanoGPT report it) and leaves
 * the reads out. cacheUsage carries both, which is what the usage accounting
 * (lib/services/usage-accounting.service.ts) splits on.
 */

jest.mock('@anthropic-ai/sdk', () => {
  const create = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ messages: { create } })),
  };
});

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '@/plugins/dist/qtap-plugin-anthropic/provider';

function getCreateMock(): jest.Mock {
  return new (Anthropic as unknown as new () => { messages: { create: jest.Mock } })().messages.create;
}

const USAGE = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 600, cache_read_input_tokens: 5000 };
const params = { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] };

beforeEach(() => jest.clearAllMocks());

describe('Anthropic usage with prompt caching', () => {
  it('sendMessage: cache writes in promptTokens, cache reads out', async () => {
    getCreateMock().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: USAGE,
    });
    const response = await new AnthropicProvider().sendMessage(params as never, 'test-key');
    expect(response.usage).toEqual({ promptTokens: 700, completionTokens: 20, totalTokens: 720 });
    expect(response.cacheUsage).toEqual({ cacheCreationInputTokens: 600, cacheReadInputTokens: 5000 });
  });

  it('streamMessage: the same figures on the final chunk', async () => {
    async function* events() {
      yield { type: 'message_start', message: { id: 'm1', model: 'claude-sonnet-4-6', usage: USAGE } };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } };
      yield { type: 'message_stop' };
    }
    getCreateMock().mockResolvedValue(events());
    let final: any;
    for await (const chunk of new AnthropicProvider().streamMessage(params as never, 'test-key')) {
      if (chunk.done) final = chunk;
    }
    expect(final.usage).toEqual({ promptTokens: 700, completionTokens: 20, totalTokens: 720 });
    expect(final.cacheUsage).toEqual({ cacheCreationInputTokens: 600, cacheReadInputTokens: 5000 });
  });

  it('without caching, promptTokens is input_tokens alone', async () => {
    getCreateMock().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    const response = await new AnthropicProvider().sendMessage(params as never, 'test-key');
    expect(response.usage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 });
  });
});
