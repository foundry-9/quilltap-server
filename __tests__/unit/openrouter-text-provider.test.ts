/**
 * @jest-environment node
 */
/**
 * OpenRouterProvider text-send tests.
 *
 * Bug 31 regression: the non-streaming send path (regenerate / continuation
 * legs) must carry image attachments to OpenRouter. The @openrouter/sdk
 * chat.send() request path rejects OpenAI content-parts (image_url) messages at
 * client-side validation, so vision sends are routed around it through a direct
 * Chat Completions fetch. Text-only sends keep the SDK path.
 *
 * #145: every streaming turn (plain, tool, image) goes through the same direct
 * fetch, and both fetch paths build their body in one place.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

// The subject imports @openrouter/sdk (mapped to the manual mock) and
// @quilltap/plugin-utils. Mock plugin-utils here so the logger is inert and the
// timeout/abort helpers are deterministic.
jest.mock('@quilltap/plugin-utils', () => ({
  __esModule: true,
  createPluginLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  getQuilltapUserAgent: () => 'Quilltap/Test',
  resolveRequestTimeoutMs: () => 30_000,
  buildRequestAbortSignal: () => new AbortController().signal,
}))

import { OpenRouter, __mocks__ as openRouterMocks } from '@openrouter/sdk'
import { OpenRouterProvider } from '@/plugins/dist/qtap-plugin-openrouter/provider'
import type { LLMParams } from '@/plugins/dist/qtap-plugin-openrouter/types'

const { mockChatSend } = openRouterMocks as unknown as { mockChatSend: jest.Mock }

// 1x1 red PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function imageParams(): LLMParams {
  return {
    model: 'openai/gpt-4o',
    messages: [
      {
        role: 'user',
        content: 'What is in this image?',
        attachments: [
          {
            id: 'att-1',
            filename: 'red.png',
            mimeType: 'image/png',
            size: 68,
            data: PNG_B64,
          },
        ],
      },
    ],
  } as unknown as LLMParams
}

describe('OpenRouterProvider.sendMessage — non-streaming vision (Bug 31)', () => {
  let provider: OpenRouterProvider
  let fetchMock: jest.Mock
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    provider = new OpenRouterProvider()
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('routes an image send through a direct Chat Completions fetch carrying the image_url part', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'a single red pixel' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      }),
      text: async () => '',
    })

    const res = await provider.sendMessage(imageParams(), 'sk-test')

    // The SDK's validating chat.send() must NOT be used for vision sends.
    expect(mockChatSend).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const body = JSON.parse(init.body as string)
    expect(body.stream).toBe(false)

    const userMsg = body.messages.find((m: any) => m.role === 'user')
    expect(Array.isArray(userMsg.content)).toBe(true)
    const imagePart = userMsg.content.find((p: any) => p.type === 'image_url')
    expect(imagePart).toBeDefined()
    expect(imagePart.image_url.url).toBe(`data:image/png;base64,${PNG_B64}`)
    // Text is preserved as its own part alongside the image.
    expect(userMsg.content.some((p: any) => p.type === 'text' && p.text === 'What is in this image?')).toBe(true)

    // Response is surfaced and the image is accounted as sent.
    expect(res.content).toBe('a single red pixel')
    expect(res.finishReason).toBe('stop')
    expect(res.usage.promptTokens).toBe(20)
    expect(res.attachmentResults?.sent).toContain('att-1')
    expect(res.attachmentResults?.failed).toHaveLength(0)
    expect(res.raw).toBeDefined()
  })

  it('forwards ZDR (data_collection: deny) on the vision path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      text: async () => '',
    })

    const params = imageParams()
    ;(params as any).profileParameters = { enableZDR: true }
    await provider.sendMessage(params, 'sk-test')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.provider?.data_collection).toBe('deny')
  })

  it('keeps the SDK path for text-only sends (no direct fetch)', async () => {
    mockChatSend.mockResolvedValue({
      choices: [{ message: { content: 'hello there' }, finishReason: 'stop' }],
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    })

    const params = {
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    } as unknown as LLMParams

    const res = await provider.sendMessage(params, 'sk-test')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockChatSend).toHaveBeenCalledTimes(1)
    expect(res.content).toBe('hello there')
  })
})

// ---------------------------------------------------------------------------
// Streaming (#145)
// ---------------------------------------------------------------------------

/** A fetch Response whose body is an SSE stream of the given chunks. */
function sseResponse(chunks: unknown[]) {
  const encoder = new TextEncoder()
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  // Split mid-line so the reader's buffering is exercised.
  const mid = Math.floor(text.length / 2)
  const parts = [text.slice(0, mid), text.slice(mid)]
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p))
      controller.close()
    },
  })
  return { ok: true, status: 200, body, text: async () => '' }
}

async function collect(gen: AsyncGenerator<any>) {
  const out: any[] = []
  for await (const c of gen) out.push(c)
  return out
}

function fullParams(extra: Partial<LLMParams> = {}): LLMParams {
  return {
    model: 'openai/gpt-4o',
    messages: [
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'hi' },
    ],
    cacheKey: 'char-123',
    webSearchEnabled: true,
    responseFormat: {
      type: 'json_schema',
      jsonSchema: { name: 'answer', schema: { type: 'object' } },
    },
    profileParameters: {
      fallbackModels: ['anthropic/claude-3.5-sonnet'],
      providerPreferences: {
        order: ['OpenAI'],
        allowFallbacks: false,
        requireParameters: true,
        ignore: ['Azure'],
        only: ['OpenAI', 'Anthropic'],
      },
      enableZDR: true,
      reasoningEffort: 'high',
    },
    ...extra,
  } as unknown as LLMParams
}

describe('OpenRouterProvider.streamMessage — one Chat Completions path (#145)', () => {
  let provider: OpenRouterProvider
  let fetchMock: jest.Mock
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    provider = new OpenRouterProvider()
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('streams a plain turn through fetch without constructing the SDK client', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' World' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 5,
          total_tokens: 105,
          prompt_tokens_details: { cached_tokens: 40 },
          cost: 0.001,
        },
      },
    ]))

    const chunks = await collect(provider.streamMessage(
      { model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'hi' }] } as unknown as LLMParams,
      'sk-test',
    ))

    expect(OpenRouter).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(JSON.parse(init.body as string).stream).toBe(true)

    const text = chunks.filter((c) => !c.done).map((c) => c.content).join('')
    expect(text).toBe('Hello World')

    const final = chunks[chunks.length - 1]
    expect(final.done).toBe(true)
    expect(final.usage).toEqual({ promptTokens: 60, completionTokens: 5, totalTokens: 65 })
    expect(final.cacheUsage).toEqual({ cacheReadInputTokens: 40, cachedTokens: 40 })
    expect(final.rawResponse.choices[0].finish_reason).toBe('stop')
  })

  it('builds the same body for streaming and non-streaming sends, save `stream`', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([{ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }]))
    await collect(provider.streamMessage(fullParams(), 'sk-test'))

    // An image forces sendMessage onto the fetch path.
    const withImage = fullParams({
      messages: [
        { role: 'system', content: 'be nice' },
        { role: 'user', content: 'hi', attachments: [{ id: 'a', filename: 'r.png', mimeType: 'image/png', size: 68, data: PNG_B64 }] },
      ],
    } as any)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} }),
      text: async () => '',
    })
    await provider.sendMessage(withImage, 'sk-test')
    fetchMock.mockResolvedValueOnce(sseResponse([{ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }]))
    await collect(provider.streamMessage(withImage, 'sk-test'))

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
    const [plainStream, imageSend, imageStream] = bodies

    const { stream: s1, ...restStream } = imageStream
    const { stream: s2, ...restSend } = imageSend
    expect(s1).toBe(true)
    expect(s2).toBe(false)
    expect(restStream).toEqual(restSend)

    for (const body of [plainStream, imageSend, imageStream]) {
      expect(body.user).toBe('char-123')
      expect(body.response_format.json_schema.name).toBe('answer')
      expect(body.models).toEqual(['openai/gpt-4o', 'anthropic/claude-3.5-sonnet'])
      expect(body).not.toHaveProperty('model')
      expect(body).not.toHaveProperty('route')
      expect(body.provider).toEqual({
        order: ['OpenAI'],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: 'deny',
        ignore: ['Azure'],
        only: ['OpenAI', 'Anthropic'],
      })
      expect(body.plugins).toEqual([{ id: 'web', max_results: 5 }])
      expect(body.reasoning).toEqual({ effort: 'high', exclude: false })
      expect(JSON.stringify(body)).not.toContain('web_search_preview')
    }
  })

  it('sends ZDR on a streaming tool turn', async () => {
    fetchMock.mockResolvedValue(sseResponse([{ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }]))
    await collect(provider.streamMessage({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'roll', description: 'roll dice', parameters: { type: 'object' } } }],
      profileParameters: { enableZDR: true },
    } as unknown as LLMParams, 'sk-test'))

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.provider.data_collection).toBe('deny')
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: { name: 'roll', description: 'roll dice', parameters: { type: 'object' } },
    })
    expect(body.tool_choice).toBe('auto')
  })

  it('streams cumulative reasoning from delta.reasoning', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { choices: [{ delta: { reasoning: 'Think' } }] },
      { choices: [{ delta: { reasoning: 'ing.' } }] },
      { choices: [{ delta: { content: 'Answer' }, finish_reason: 'stop' }] },
    ]))
    const chunks = await collect(provider.streamMessage(
      { model: 'x/y', messages: [{ role: 'user', content: 'q' }] } as unknown as LLMParams, 'sk-test'))
    const reasoningYields = chunks.filter((c) => !c.done && c.reasoningContent).map((c) => c.reasoningContent)
    expect(reasoningYields).toEqual(['Think', 'Thinking.'])
    expect(chunks[chunks.length - 1].reasoningContent).toBe('Thinking.')
  })

  it('falls back to delta.reasoning_details, skipping encrypted entries', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: 'Step one. ' }] } }] },
      { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque' }] } }] },
      { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.summary', summary: 'Step two.' }] } }] },
      { choices: [{ delta: { content: 'Answer' }, finish_reason: 'stop' }] },
    ]))
    const chunks = await collect(provider.streamMessage(
      { model: 'x/y', messages: [{ role: 'user', content: 'q' }] } as unknown as LLMParams, 'sk-test'))
    const reasoningYields = chunks.filter((c) => !c.done && c.reasoningContent).map((c) => c.reasoningContent)
    expect(reasoningYields).toEqual(['Step one. ', 'Step one. Step two.'])
    const final = chunks[chunks.length - 1]
    expect(final.reasoningContent).toBe('Step one. Step two.')
    expect(JSON.stringify(final)).not.toContain('opaque')
  })

  it('reports a streamed refusal as finish_reason refusal', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { choices: [{ delta: { refusal: "I can't help " } }] },
      { choices: [{ delta: { refusal: 'with that.' }, finish_reason: 'stop' }] },
    ]))
    const chunks = await collect(provider.streamMessage(
      { model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'q' }] } as unknown as LLMParams, 'sk-test'))
    const final = chunks[chunks.length - 1]
    expect(final.rawResponse.choices[0].finish_reason).toBe('refusal')
    expect(final.rawResponse.choices[0].finishReason).toBe('refusal')
  })

  it('passes a content_filter finish reason through', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { choices: [{ delta: { content: 'partial' }, finish_reason: 'content_filter' }] },
    ]))
    const chunks = await collect(provider.streamMessage(
      { model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'q' }] } as unknown as LLMParams, 'sk-test'))
    expect(chunks[chunks.length - 1].rawResponse.choices[0].finish_reason).toBe('content_filter')
  })

  it('accumulates streamed tool calls and reports tool_calls', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'roll', arguments: '{"si' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'des":6}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]))
    const chunks = await collect(provider.streamMessage({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'roll' }],
      tools: [{ type: 'function', function: { name: 'roll', parameters: { type: 'object' } } }],
    } as unknown as LLMParams, 'sk-test'))
    const raw = chunks[chunks.length - 1].rawResponse
    expect(raw.choices[0].finish_reason).toBe('tool_calls')
    expect(raw.choices[0].delta.toolCalls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'roll', arguments: '{"sides":6}' } },
    ])
  })
})
