/**
 * OpenAI explicit prompt-cache breakpoints (gpt-5.6+).
 *
 * gpt-5.6 and later reuse a cached prefix only at a cache boundary, and look
 * a prefix up only at boundaries marked in the request being served; an
 * explicit-mode request writes its latest four. Left to the implicit default,
 * a Salon turn wrote after the system blocks and after the turn-variable final
 * message, so chat history was never read from cache. The plugin now marks
 * every stable boundary — the leading developer block's end and every later
 * user / developer message and function-call output — and leaves the trailing
 * latest user message unmarked outside a tool loop. It no longer tries
 * `previous_response_id` chaining, which could never succeed with
 * `store: false`.
 */

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import OpenAI from 'openai';
import { OpenAIProvider } from '@/plugins/dist/qtap-plugin-openai/provider';
import {
  applyOpenAICacheBreakpoints,
  MAX_HISTORY_BREAKPOINTS,
  stripPromptCacheControls,
} from '@/plugins/dist/qtap-plugin-openai/cache-breakpoints';

const MockOpenAI = OpenAI as unknown as jest.Mock;

const FAKE_RESPONSE = {
  output: [],
  output_text: 'ok',
  status: 'completed',
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
};

const BP = { mode: 'explicit' };

/** Indices of input items carrying a breakpoint on their last block. */
function breakpointIndices(input: any[]): number[] {
  const marked: number[] = [];
  input.forEach((item, i) => {
    const blocks = Array.isArray(item.content) ? item.content : Array.isArray(item.output) ? item.output : [];
    if (blocks.some((b: any) => b?.prompt_cache_breakpoint)) marked.push(i);
  });
  return marked;
}

let create: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  create = jest.fn().mockResolvedValue(FAKE_RESPONSE);
  MockOpenAI.mockImplementation(() => ({ responses: { create } }));
});

async function captureBody(path: 'send' | 'stream', params: Record<string, unknown>): Promise<Record<string, any>> {
  const provider = new OpenAIProvider();
  if (path === 'send') {
    await provider.sendMessage(params as never, 'key');
  } else {
    try {
      for await (const _chunk of provider.streamMessage(params as never, 'key')) {
        // no-op
      }
    } catch {
      // FAKE_RESPONSE is not an async iterable
    }
  }
  return create.mock.calls[create.mock.calls.length - 1][0];
}

/** A multi-character Salon turn: system blocks, history, then the trailing message. */
const SALON_TURN = [
  { role: 'system', content: 'You are Amy.' },
  { role: 'system', content: 'Identity reminder.' },
  { role: 'system', content: 'Acting in the scene.' },
  { role: 'user', content: 'The Host sets the scene.' },
  { role: 'assistant', content: 'Amy speaks.' },
  { role: 'user', content: '[Abigail] Abigail speaks.' },
  { role: 'user', content: 'Scene note: trailing context for this turn only.' },
];

const user = (text: string) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });

describe('applyOpenAICacheBreakpoints', () => {
  it('marks the developer block end and every history message, never the trailing one', () => {
    const input: any[] = [
      { type: 'message', role: 'developer', content: 'dev 1' },
      { type: 'message', role: 'developer', content: 'dev 2' },
      user('u1'),
      { type: 'message', role: 'assistant', content: 'a1' },
      user('u2'),
      user('trailing'),
    ];
    expect(applyOpenAICacheBreakpoints(input)).toBe(3);
    expect(breakpointIndices(input)).toEqual([1, 2, 4]);
    // Developer messages are always lists, marked or not.
    expect(input[0].content).toEqual([{ type: 'input_text', text: 'dev 1' }]);
    expect(input[1].content).toEqual([{ type: 'input_text', text: 'dev 2', prompt_cache_breakpoint: BP }]);
    // The trailing message is never marked: no later request repeats it.
    expect(input[5].content[0]).not.toHaveProperty('prompt_cache_breakpoint');
  });

  it('leaves the trailing message unmarked when an assistant name prefill follows it', () => {
    const input: any[] = [
      { type: 'message', role: 'developer', content: 'dev' },
      user('history'),
      user('trailing'),
      { type: 'message', role: 'assistant', content: '[Lorian]' },
    ];
    applyOpenAICacheBreakpoints(input);
    expect(breakpointIndices(input)).toEqual([0, 1]);
  });

  it('marks the trailing message and every tool output inside a tool loop', () => {
    const input: any[] = [
      { type: 'message', role: 'developer', content: 'dev' },
      user('history'),
      user('trailing'),
      { type: 'message', role: 'assistant', content: '' },
      { type: 'function_call', call_id: 'c1', name: 'search', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: 'first result' },
      { type: 'message', role: 'assistant', content: '' },
      { type: 'function_call', call_id: 'c2', name: 'doc_read', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c2', output: 'file contents' },
    ];
    expect(applyOpenAICacheBreakpoints(input)).toBe(5);
    expect(breakpointIndices(input)).toEqual([0, 1, 2, 5, 8]);
    expect(input[8].output).toEqual([{ type: 'input_text', text: 'file contents', prompt_cache_breakpoint: BP }]);
  });

  it('marks a lone user message so an explicit-mode request is still cached', () => {
    const input: any[] = [user('hi')];
    expect(applyOpenAICacheBreakpoints(input)).toBe(1);
    expect(breakpointIndices(input)).toEqual([0]);
  });

  it('falls back to the latest user message when it is the only markable item', () => {
    const input: any[] = [user('task'), { type: 'message', role: 'assistant', content: 'thinking aloud' }];
    applyOpenAICacheBreakpoints(input);
    expect(breakpointIndices(input)).toEqual([0]);
  });

  it('marks the last block of a message ending in an image', () => {
    const input: any[] = [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'look' }, { type: 'input_image', image_url: 'data:x', detail: 'auto' }] },
      user('trailing'),
    ];
    applyOpenAICacheBreakpoints(input);
    expect(input[0].content[0]).not.toHaveProperty('prompt_cache_breakpoint');
    expect(input[0].content[1].prompt_cache_breakpoint).toEqual(BP);
  });

  it('keeps the developer block and the latest history marks inside the lookup window', () => {
    const input: any[] = [
      { type: 'message', role: 'developer', content: 'dev' },
      ...Array.from({ length: MAX_HISTORY_BREAKPOINTS + 10 }, (_, i) => user(`m${i}`)),
      user('trailing'),
    ];
    expect(applyOpenAICacheBreakpoints(input)).toBe(MAX_HISTORY_BREAKPOINTS + 1);
    const marked = breakpointIndices(input);
    expect(marked[0]).toBe(0);
    expect(marked[1]).toBe(11);
    expect(marked[marked.length - 1]).toBe(input.length - 2);
  });

  it('places nothing on an empty input', () => {
    expect(applyOpenAICacheBreakpoints([])).toBe(0);
  });
});

describe('stripPromptCacheControls', () => {
  it('removes options, retention and every breakpoint, keeping the routing key', () => {
    const stripped = stripPromptCacheControls({
      model: 'gpt-6.1',
      prompt_cache_key: 'k',
      prompt_cache_options: { mode: 'explicit' },
      prompt_cache_retention: '24h',
      input: [
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'd', prompt_cache_breakpoint: BP }] },
        { type: 'function_call_output', call_id: 'c', output: [{ type: 'input_text', text: 'o', prompt_cache_breakpoint: BP }] },
      ],
    });
    expect(stripped).not.toHaveProperty('prompt_cache_options');
    expect(stripped).not.toHaveProperty('prompt_cache_retention');
    expect(stripped.prompt_cache_key).toBe('k');
    expect(breakpointIndices(stripped.input as any[])).toEqual([]);
  });
});

describe.each(['send', 'stream'] as const)('OpenAIProvider %s — prompt-cache controls', (path) => {
  it('sends explicit breakpoints and no retention for gpt-5.6+', async () => {
    const body = await captureBody(path, { model: 'gpt-6.1-sol', messages: SALON_TURN, cacheKey: 'char-1' });
    expect(body.prompt_cache_options).toEqual({ mode: 'explicit' });
    expect(body).not.toHaveProperty('prompt_cache_retention');
    expect(body.prompt_cache_key).toBe('char-1');
    expect(body.instructions).toBe('You are Amy.');
    // input: [dev, dev, user(host), assistant, user(abigail), user(scene note)]
    expect(breakpointIndices(body.input)).toEqual([1, 2, 4]);
  });

  it('keeps 24h retention and implicit caching for older models', async () => {
    const body = await captureBody(path, { model: 'gpt-5.5', messages: SALON_TURN, cacheKey: 'char-1' });
    expect(body).not.toHaveProperty('prompt_cache_options');
    expect(body.prompt_cache_retention).toBe('24h');
    expect(breakpointIndices(body.input)).toEqual([]);
  });

  it('never chains with previous_response_id', async () => {
    await captureBody(path, { model: 'gpt-6.1', messages: SALON_TURN, previousResponseId: 'resp_prev' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).not.toHaveProperty('previous_response_id');
    expect(create.mock.calls[0][0].input).toHaveLength(6);
  });
});

it('retries once without cache controls when the model rejects a breakpoint', async () => {
  create
    .mockReset()
    .mockRejectedValueOnce(Object.assign(new Error("400 Unknown parameter: 'prompt_cache_options'"), { status: 400 }))
    .mockResolvedValueOnce(FAKE_RESPONSE);
  const response = await new OpenAIProvider().sendMessage(
    { model: 'gpt-6.1', messages: SALON_TURN, cacheKey: 'char-1' } as never,
    'key',
  );
  expect(response.content).toBe('ok');
  expect(create).toHaveBeenCalledTimes(2);
  const retry = create.mock.calls[1][0];
  expect(retry).not.toHaveProperty('prompt_cache_options');
  expect(retry.prompt_cache_key).toBe('char-1');
  expect(breakpointIndices(retry.input)).toEqual([]);
});
