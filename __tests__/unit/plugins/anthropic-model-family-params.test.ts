/**
 * Anthropic request shaping — regression guard for API version 2026-10-21
 * and the Sonnet 5 / Opus 4.7+ / Fable / Mythos thinking rules.
 *
 *   - The plugin uses the SDK's default API version, 2026-10-21, which 400s on
 *     `temperature` / `top_p` / `top_k` for every model, so none are sent.
 *   - The same version 400s on a `document` block placed directly in an
 *     assistant message, so those move into a user turn just ahead of it.
 *   - Which thinking form a model takes is read from the live Models API
 *     (`capabilities.thinking.types.enabled`), never from the model ID:
 *     a model that accepts fixed-budget thinking gets `{type: 'enabled',
 *     budget_tokens}`; any other — or one whose capabilities could not be
 *     read — gets `{type: 'adaptive', display: 'summarized'}` (adaptive
 *     defaults display to "omitted" unless "summarized" is asked for).
 *
 * The branching lives in a private helper, so — like the z-ai plugin suite —
 * we assert on the request body handed to the (mocked) Anthropic SDK. The
 * sendMessage and streamMessage paths carry duplicated copies of this logic,
 * so both are exercised to guard against drift.
 */

// Override the global jest.setup.ts Anthropic mock with one whose `create` is a
// single shared jest.fn we can inspect (the global mock hands each instance its
// own fn, so the request body can't be captured through it).
jest.mock('@anthropic-ai/sdk', () => {
  const create = jest.fn();
  // What the Models API reports per model: does it accept fixed-budget
  // ("enabled") thinking? A model missing here makes retrieve fail.
  const acceptsBudget: Record<string, boolean> = {
    'claude-haiku-5-5': false,
    'claude-opus-5-5': false,
    'claude-sonnet-5-5': false,
    'claude-opus-4-8': false,
    'claude-fable-5-2': false,
    'claude-sonnet-4-6': true,
    'claude-opus-4-6': true,
    'claude-haiku-4-5': true,
  };
  const retrieve = jest.fn(async (model: string) => {
    if (!(model in acceptsBudget)) throw new Error('not_found_error');
    return {
      id: model,
      capabilities: { thinking: { supported: true, types: {
        adaptive: { supported: !acceptsBudget[model] || model !== 'claude-haiku-4-5' },
        between_tools: { supported: false },
        disabled: { supported: true },
        enabled: { supported: acceptsBudget[model] },
      } } },
    };
  });
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ messages: { create }, models: { retrieve } })),
  };
});

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '@/plugins/dist/qtap-plugin-anthropic/provider';

// A valid non-streaming response so sendMessage's post-processing doesn't throw
// before we can inspect the captured request.
const FAKE_RESPONSE = {
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** The shared create mock the provider and this test both see. */
function getCreateMock(): jest.Mock {
  return new (Anthropic as unknown as new () => { messages: { create: jest.Mock } })().messages
    .create;
}

beforeEach(() => {
  jest.clearAllMocks();
  getCreateMock().mockResolvedValue(FAKE_RESPONSE);
});

/** Run sendMessage and return the request body handed to the Anthropic client. */
async function captureSendBody(opts: {
  model: string;
  temperature?: number;
  topP?: number;
  profileParameters?: Record<string, unknown>;
  messages?: unknown[];
}): Promise<Record<string, any>> {
  const provider = new AnthropicProvider();
  const params = {
    model: opts.model,
    messages: opts.messages ?? [{ role: 'user' as const, content: 'hi' }],
    temperature: opts.temperature,
    topP: opts.topP,
    profileParameters: opts.profileParameters,
  };
  await provider.sendMessage(params as never, 'test-key').catch(() => undefined);
  const create = getCreateMock();
  return (create.mock.calls[0]?.[0] ?? {}) as Record<string, any>;
}

/** Run streamMessage far enough to capture the request body it builds. */
async function captureStreamBody(opts: {
  model: string;
  temperature?: number;
  profileParameters?: Record<string, unknown>;
}): Promise<Record<string, any>> {
  const provider = new AnthropicProvider();
  const params = {
    model: opts.model,
    messages: [{ role: 'user' as const, content: 'hi' }],
    temperature: opts.temperature,
    profileParameters: opts.profileParameters,
  };
  try {
    // The mocked create resolves a plain object that isn't async-iterable, so
    // the stream loop throws — but only AFTER create is called with the body.
    for await (const _chunk of provider.streamMessage(params as never, 'test-key')) {
      // no-op
    }
  } catch {
    // expected: FAKE_RESPONSE is not an async iterable
  }
  const create = getCreateMock();
  return (create.mock.calls[0]?.[0] ?? {}) as Record<string, any>;
}

// Enabling thinking via the default-budget flag (thinkingBudget path is
// equivalent for the assertions here).
const THINKING_ON = { extendedThinking: true };

describe('AnthropicProvider — sampling params are never sent', () => {
  const MODELS = [
    'claude-sonnet-5',
    'claude-opus-4-8',
    'claude-fable-5',
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-haiku-4-5',
    'claude-3-5-sonnet-latest',
  ];

  it.each(MODELS)('omits temperature/top_p for %s', async model => {
    const body = await captureSendBody({ model, temperature: 0.7, topP: 0.9 });
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.top_k).toBeUndefined();
  });

  it('does not default temperature when none is provided', async () => {
    const body = await captureSendBody({ model: 'claude-opus-4-6' });
    expect(body.temperature).toBeUndefined();
  });

  it('streamMessage also omits sampling params', async () => {
    const body = await captureStreamBody({ model: 'claude-sonnet-4-6', temperature: 0.5 });
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
  });

  it('leaves anthropic-version to the SDK default', () => {
    new AnthropicProvider().sendMessage(
      { model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'hi' }] } as never,
      'test-key',
    ).catch(() => undefined);
    const ctorArgs = (Anthropic as unknown as jest.Mock).mock.calls.at(-1)?.[0] ?? {};
    expect(ctorArgs.defaultHeaders?.['anthropic-version']).toBeUndefined();
  });
});

describe('AnthropicProvider — thinking shape from model capabilities', () => {
  const ADAPTIVE_ONLY = ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-8', 'claude-fable-5-2'];
  const BUDGET_OK = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'];

  it.each(ADAPTIVE_ONLY)('uses adaptive+summarized thinking for %s', async model => {
    const body = await captureSendBody({ model, profileParameters: THINKING_ON });
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('streamMessage uses adaptive thinking for a model that refuses a budget', async () => {
    const body = await captureStreamBody({ model: 'claude-opus-4-8', profileParameters: THINKING_ON });
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it.each(BUDGET_OK)('uses fixed-budget thinking for %s', async model => {
    const body = await captureSendBody({ model, profileParameters: { thinkingBudget: 2048 } });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('streamMessage keeps fixed-budget thinking where the model accepts it', async () => {
    const body = await captureStreamBody({ model: 'claude-sonnet-4-6', profileParameters: { thinkingBudget: 2048 } });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('uses the default 4096 budget from the extendedThinking flag', async () => {
    const body = await captureSendBody({ model: 'claude-opus-4-6', profileParameters: THINKING_ON });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });

  it('falls back to adaptive when capabilities cannot be read', async () => {
    const body = await captureSendBody({ model: 'claude-unlisted-model', profileParameters: THINKING_ON });
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('sends no thinking field when the profile does not ask for thinking', async () => {
    const body = await captureSendBody({ model: 'claude-haiku-5-5' });
    expect(body.thinking).toBeUndefined();
  });
});

describe('AnthropicProvider — documents never sit in an assistant turn', () => {
  const pdf = { id: 'a1', mimeType: 'application/pdf', data: 'JVBERi0=' };
  const png = { id: 'a2', mimeType: 'image/png', data: 'iVBORw0=' };

  it('moves an assistant document into a user turn just ahead of it', async () => {
    const body = await captureSendBody({
      model: 'claude-opus-4-6',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'here it is', attachments: [pdf, png] },
        { role: 'user', content: 'thanks' },
      ],
    });
    const msgs = body.messages as Array<{ role: string; content: any }>;
    expect(msgs.map(m => m.role)).toEqual(['user', 'user', 'assistant', 'user']);
    expect(msgs[1].content.map((b: any) => b.type)).toEqual(['document']);
    expect(msgs[2].content.map((b: any) => b.type)).toEqual(['text', 'image']);
  });

  it('drops an assistant turn left empty once its documents move', async () => {
    const body = await captureSendBody({
      model: 'claude-opus-4-6',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', attachments: [pdf] },
        { role: 'user', content: 'thanks' },
      ],
    });
    const msgs = body.messages as Array<{ role: string; content: any }>;
    expect(msgs.some(m => m.role === 'assistant')).toBe(false);
  });
});
