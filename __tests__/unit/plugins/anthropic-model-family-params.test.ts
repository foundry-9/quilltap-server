/**
 * Anthropic request shaping — regression guard for API version 2026-10-21
 * and the Sonnet 5 / Opus 4.7+ / Fable / Mythos thinking rules.
 *
 *   - The plugin uses the SDK's default API version, 2026-10-21, which 400s on
 *     `temperature` / `top_p` / `top_k` for every model, so none are sent.
 *   - The same version 400s on a `document` block placed directly in an
 *     assistant message, so those move into a user turn just ahead of it.
 *   - Sonnet 5 / Opus 4.7+ / Fable / Mythos removed fixed-budget thinking:
 *     extended thinking is requested as `{type: 'adaptive', display:
 *     'summarized'}` — the fixed-budget form 400s, and adaptive defaults
 *     display to "omitted" (empty reasoning text) unless "summarized" is
 *     asked for explicitly. Older models (Sonnet 4.6-, Opus 4.6-, Haiku 4.5)
 *     keep `{type: 'enabled', budget_tokens}`.
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
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ messages: { create } })),
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

describe('AnthropicProvider — thinking shape by model generation', () => {
  const NEW_GEN = [
    'claude-sonnet-5',
    'claude-sonnet-5-20260101',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-fable-5',
    'claude-mythos-5',
    'claude-mythos-preview',
  ];
  const OLD_GEN = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5', 'claude-3-5-sonnet-latest'];

  it.each(NEW_GEN)('uses adaptive+summarized thinking for %s', async model => {
    const body = await captureSendBody({ model, profileParameters: THINKING_ON });
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('streamMessage uses adaptive thinking for a new-gen model', async () => {
    const body = await captureStreamBody({ model: 'claude-opus-4-8', profileParameters: THINKING_ON });
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it.each(OLD_GEN)('uses fixed-budget thinking for %s', async model => {
    const body = await captureSendBody({
      model,
      profileParameters: { thinkingBudget: 2048 },
    });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('streamMessage keeps fixed-budget thinking for older models', async () => {
    const body = await captureStreamBody({
      model: 'claude-sonnet-4-6',
      profileParameters: { thinkingBudget: 2048 },
    });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('does not treat claude-opus-4-6 as new-gen', async () => {
    const body = await captureSendBody({ model: 'claude-opus-4-6', profileParameters: THINKING_ON });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });

  it('treats a dated claude-opus-4-8 snapshot as new-gen', async () => {
    const body = await captureSendBody({ model: 'claude-opus-4-8-20260215', profileParameters: THINKING_ON });
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
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
