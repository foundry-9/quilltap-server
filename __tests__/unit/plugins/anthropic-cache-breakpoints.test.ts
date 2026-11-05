/**
 * Anthropic prompt-cache breakpoint placement.
 *
 * A Salon turn's final user message carries that turn's trailing context
 * sections, which are gone from the next turn's copy of the same message — so
 * a breakpoint on it writes a cache entry nothing can ever read. The plugin
 * puts the conversation breakpoint on the message *before* the final one, adds
 * a stepped mid-history breakpoint on long arrays, and never exceeds
 * Anthropic's four-breakpoint limit across tools, system and messages.
 *
 * Both sendMessage and streamMessage build the request, so both are exercised.
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

const FAKE_RESPONSE = {
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

function getCreateMock(): jest.Mock {
  return new (Anthropic as unknown as new () => { messages: { create: jest.Mock } })().messages
    .create;
}

beforeEach(() => {
  jest.clearAllMocks();
  getCreateMock().mockResolvedValue(FAKE_RESPONSE);
});

const CACHING = { enableCacheBreakpoints: true };

async function captureBody(
  path: 'send' | 'stream',
  messages: unknown[],
  extra: Record<string, unknown> = {},
  profileParameters: Record<string, unknown> | null = CACHING,
): Promise<Record<string, any>> {
  const provider = new AnthropicProvider();
  const params = { model: 'claude-sonnet-4-6', messages, profileParameters: profileParameters ?? undefined, ...extra };
  if (path === 'send') {
    await provider.sendMessage(params as never, 'test-key').catch(() => undefined);
  } else {
    try {
      for await (const _chunk of provider.streamMessage(params as never, 'test-key')) {
        // no-op
      }
    } catch {
      // expected: FAKE_RESPONSE is not an async iterable
    }
  }
  return (getCreateMock().mock.calls[0]?.[0] ?? {}) as Record<string, any>;
}

/** Indexes of request messages that carry a cache_control breakpoint. */
function breakpointIndexes(body: Record<string, any>): number[] {
  const out: number[] = [];
  (body.messages as Array<{ content: unknown }>).forEach((m, i) => {
    if (Array.isArray(m.content) && m.content.some((b: any) => b.cache_control)) out.push(i);
  });
  return out;
}

function totalBreakpoints(body: Record<string, any>): number {
  let n = 0;
  for (const m of body.messages as Array<{ content: unknown }>) {
    if (Array.isArray(m.content)) n += m.content.filter((b: any) => b.cache_control).length;
  }
  if (Array.isArray(body.system)) n += body.system.filter((b: any) => b.cache_control).length;
  if (Array.isArray(body.tools)) n += body.tools.filter((t: any) => t.cache_control).length;
  return n;
}

function conversation(length: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  return Array.from({ length }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `message ${i}`,
  }));
}

describe.each(['send', 'stream'] as const)('AnthropicProvider cache breakpoints (%s)', (path) => {
  it('puts the breakpoint on the message before the final, turn-variable one', async () => {
    const messages = [
      { role: 'system', content: 'identity' },
      ...conversation(4),
      { role: 'user', content: 'new line\n\n---\n\ntrailing recall that changes every turn' },
    ];
    const body = await captureBody(path, messages);
    // 5 non-system messages: the tail breakpoint is index 3, not the final 4.
    expect(breakpointIndexes(body)).toEqual([3]);
    expect(body.messages[4].content).toBe(messages[5].content);
  });

  it('keeps the breakpoint on a lone message', async () => {
    const body = await captureBody(path, [{ role: 'user', content: 'only' }]);
    expect(breakpointIndexes(body)).toEqual([0]);
  });

  it('caches each tool-loop step for the step after it', async () => {
    const messages = [
      { role: 'user', content: 'question' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', type: 'function', function: { name: 'search', arguments: '{}' } }],
      },
      { role: 'tool', toolCallId: 't1', content: 'result' },
    ];
    const body = await captureBody(path, messages);
    expect(breakpointIndexes(body)).toEqual([1]);
    const assistantBlocks = body.messages[1].content as any[];
    expect(assistantBlocks[assistantBlocks.length - 1].type).toBe('tool_use');
    expect(assistantBlocks[assistantBlocks.length - 1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('adds a stepped mid-history breakpoint on a long conversation', async () => {
    const body = await captureBody(path, conversation(41));
    // 41 messages: tail at 39, mid at floor((41-15)/15)*15 = 15.
    expect(breakpointIndexes(body)).toEqual([15, 39]);
  });

  it('never exceeds four breakpoints across tools, system and messages', async () => {
    const messages: unknown[] = [{ role: 'system', content: 'identity' }, ...conversation(41)];
    // A caller-marked summary head takes one of the message breakpoints.
    (messages[3] as Record<string, unknown>).cacheControl = { type: 'ephemeral' };
    const tools = [{ name: 'search', description: 'd', input_schema: { type: 'object', properties: {} } }];
    const body = await captureBody(path, messages, { tools });
    expect(totalBreakpoints(body)).toBe(4);
    // Summary head (index 2) and tail survive; the mid-history one is dropped.
    expect(breakpointIndexes(body)).toEqual([2, 39]);
  });

  it('places no conversation breakpoints for the system_only strategy', async () => {
    const body = await captureBody(path, conversation(41), {}, { ...CACHING, cacheStrategy: 'system_only' });
    expect(breakpointIndexes(body)).toEqual([]);
  });

  it('places no breakpoints when caching is off', async () => {
    const body = await captureBody(path, conversation(5), {}, null);
    expect(breakpointIndexes(body)).toEqual([]);
  });

  it('honours the profile TTL on the tail breakpoint', async () => {
    const body = await captureBody(path, conversation(3), {}, { ...CACHING, cacheTTL: '1h' });
    expect(body.messages[1].content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});
