/**
 * The Anthropic plugin names no model itself: the model list, the cheap
 * model and the key check all go through the live Models API.
 */

jest.mock('@anthropic-ai/sdk', () => {
  const list = jest.fn();
  const create = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ models: { list }, messages: { create } })),
  };
});

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '@/plugins/dist/qtap-plugin-anthropic/provider';

function client(): { models: { list: jest.Mock }; messages: { create: jest.Mock } } {
  return new (Anthropic as unknown as new () => ReturnType<typeof client>)();
}

/** An async-iterable page of models, newest first, as the SDK returns. */
function page(models: Array<{ id: string; line: string | null }>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of models) yield m;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AnthropicProvider — live model list', () => {
  it('picks the newest active model in the Haiku line', async () => {
    client().models.list.mockReturnValue(page([
      { id: 'claude-fable-9', line: 'fable' },
      { id: 'claude-haiku-9', line: 'haiku' },
      { id: 'claude-haiku-8', line: 'haiku' },
    ]));
    await expect(new AnthropicProvider().resolveCheapModel('k')).resolves.toBe('claude-haiku-9');
    expect(client().models.list).toHaveBeenCalledWith(expect.objectContaining({ lifecycle: ['active'] }));
  });

  it('returns null when the key sees no Haiku', async () => {
    client().models.list.mockReturnValue(page([{ id: 'claude-opus-9', line: 'opus' }]));
    await expect(new AnthropicProvider().resolveCheapModel('k')).resolves.toBeNull();
  });

  it('lists every model the API returns, with no built-in fallback', async () => {
    client().models.list.mockReturnValue(page([
      { id: 'claude-opus-9', line: 'opus' },
      { id: 'claude-haiku-9', line: 'haiku' },
    ]));
    await expect(new AnthropicProvider().getAvailableModels('k')).resolves.toEqual(['claude-opus-9', 'claude-haiku-9']);
  });

  it('throws rather than inventing a list when the API fails', async () => {
    client().models.list.mockImplementation(() => { throw new Error('401'); });
    await expect(new AnthropicProvider().getAvailableModels('k')).rejects.toThrow('401');
  });

  it('checks a key by listing models, not by calling a named model', async () => {
    client().models.list.mockResolvedValue(page([]));
    await expect(new AnthropicProvider().validateApiKey('k')).resolves.toBe(true);
    expect(client().messages.create).not.toHaveBeenCalled();
    client().models.list.mockRejectedValue(new Error('401'));
    await expect(new AnthropicProvider().validateApiKey('k')).resolves.toBe(false);
  });
});
