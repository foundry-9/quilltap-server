/**
 * @jest-environment node
 */
/**
 * Concierge overhaul, phase 1 — each image plugin turns its provider's own
 * refusal into `ModerationRejectionError` (`code: 'MODERATION_REJECTED'`), and
 * leaves every other failure exactly as thrown; the streaming text paths carry
 * the finish reason that says a refusal happened.
 */

jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn() }), { virtual: true })

import { classifyRefusal } from '@/lib/services/dangerous-content/refusal'
import { extractFinishReason } from '@/lib/llm/extract-finish-reason'
import { toOpenAIImageModerationError } from '@/plugins/dist/qtap-plugin-openai/image-provider'
import { toGrokImageModerationError } from '@/plugins/dist/qtap-plugin-grok/image-provider'
import { toZaiImageModerationError } from '@/plugins/dist/qtap-plugin-z-ai/image-provider'
import {
  OpenRouterImageProvider,
  isOpenRouterRefusalBody,
} from '@/plugins/dist/qtap-plugin-openrouter/image-provider'
import { OpenRouterProvider } from '@/plugins/dist/qtap-plugin-openrouter/provider'
import { GoogleImagenProvider } from '@/plugins/dist/qtap-plugin-google/image-provider'
import { OpenAIProvider } from '@/plugins/dist/qtap-plugin-openai/provider'
import { GrokProvider } from '@/plugins/dist/qtap-plugin-grok/provider'
import { GoogleProvider } from '@/plugins/dist/qtap-plugin-google/provider'

/** The OpenAI SDK's APIError shape. */
function sdkError(status: number, code: string | number | null, message: string) {
  return Object.assign(new Error(message), { status, code, error: { code, message } })
}

function expectTyped(error: unknown, reason?: string) {
  expect(error).toBeInstanceOf(Error)
  expect((error as { code?: string }).code).toBe('MODERATION_REJECTED')
  expect((error as Error).name).toBe('ModerationRejectionError')
  if (reason !== undefined) expect((error as { providerReason?: string }).providerReason).toBe(reason)
  // And the host reads it as the strongest evidence there is.
  expect(classifyRefusal({ error }).evidence).toBe('typed-error')
}

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('OpenAI image refusals', () => {
  it('maps moderation_blocked and content_policy_violation', () => {
    expectTyped(toOpenAIImageModerationError(sdkError(400, 'moderation_blocked', 'Your request was rejected by the safety system.')), 'moderation_blocked')
    expectTyped(toOpenAIImageModerationError(sdkError(400, 'content_policy_violation', 'Rejected.')), 'content_policy_violation')
  })

  it('maps a "safety system" message without a code', () => {
    expectTyped(toOpenAIImageModerationError(sdkError(400, null, 'Your request was rejected as a result of our safety system.')))
  })

  it('leaves a rate limit and an auth failure untouched', () => {
    const rate = sdkError(429, 'rate_limit_exceeded', 'Rate limit reached')
    const auth = sdkError(401, 'invalid_api_key', 'Incorrect API key provided')
    expect(toOpenAIImageModerationError(rate)).toBe(rate)
    expect(toOpenAIImageModerationError(auth)).toBe(auth)
  })
})

describe('Grok image refusals', () => {
  it('maps "Generated image rejected by content moderation."', () => {
    expectTyped(toGrokImageModerationError(sdkError(400, null, 'Generated image rejected by content moderation.')))
  })

  it('leaves other errors untouched', () => {
    const err = sdkError(500, null, 'Internal server error')
    expect(toGrokImageModerationError(err)).toBe(err)
  })
})

describe('Z.AI image refusals', () => {
  it('maps business code 1301, numeric or string', () => {
    expectTyped(toZaiImageModerationError(sdkError(400, 1301, 'The system detected potentially unsafe or sensitive content.')), '1301')
    expectTyped(toZaiImageModerationError(sdkError(400, '1301', 'blocked')), '1301')
  })

  it('leaves other errors untouched', () => {
    const err = sdkError(429, 1302, 'Rate limit')
    expect(toZaiImageModerationError(err)).toBe(err)
  })
})

describe('OpenRouter image refusals', () => {
  it('recognises a refusal body, and not a generic one', () => {
    expect(isOpenRouterRefusalBody('{"error":{"message":"Request blocked by safety filters"}}')).toBe(true)
    expect(isOpenRouterRefusalBody('{"error":{"message":"Please try a different prompt"}}')).toBe(false)
  })

  it('reads a model that answered in words as a refusal', async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, {
      choices: [{ message: { content: null, refusal: 'I can\'t create that image.' } }],
    })) as unknown as typeof fetch
    const provider = new OpenRouterImageProvider()
    const err = await provider.generateImage({ prompt: 'x', model: 'openai/gpt-image-1' }, 'sk').catch((e) => e)
    expectTyped(err, 'I can\'t create that image.')
  })

  it('maps an HTTP error whose body states a refusal', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false, status: 400, text: async () => 'Your request was rejected by the safety system',
    })) as unknown as typeof fetch
    const err = await new OpenRouterImageProvider().generateImage({ prompt: 'x', model: 'm' }, 'sk').catch((e) => e)
    expectTyped(err)
  })

  it('leaves a plain HTTP error untouched', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 402, text: async () => 'Insufficient credits' })) as unknown as typeof fetch
    const err = await new OpenRouterImageProvider().generateImage({ prompt: 'x', model: 'm' }, 'sk').catch((e) => e)
    expect((err as { code?: string }).code).toBeUndefined()
    expect(classifyRefusal({ error: err }).refused).toBe(false)
  })
})

describe('Google image refusals', () => {
  it('Gemini IMAGE_SAFETY with no image parts', async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, {
      candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }],
    })) as unknown as typeof fetch
    const err = await new GoogleImagenProvider()
      .generateImage({ prompt: 'x', model: 'gemini-2.5-flash-image' }, 'k').catch((e) => e)
    expectTyped(err, 'IMAGE_SAFETY')
  })

  it('Gemini promptFeedback.blockReason', async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })) as unknown as typeof fetch
    const err = await new GoogleImagenProvider()
      .generateImage({ prompt: 'x', model: 'gemini-2.5-flash-image' }, 'k').catch((e) => e)
    expectTyped(err, 'PROHIBITED_CONTENT')
  })

  it('Imagen filtered predictions', async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, {
      predictions: [{ raiFilteredReason: 'Unable to show generated images. RAI filter.' }],
    })) as unknown as typeof fetch
    const err = await new GoogleImagenProvider().generateImage({ prompt: 'x', model: 'imagen-4' }, 'k').catch((e) => e)
    expectTyped(err, 'Unable to show generated images. RAI filter.')
  })

  it('Imagen Responsible AI HTTP error', async () => {
    global.fetch = jest.fn(async () => jsonResponse(400, {
      error: { message: 'The prompt violates Google\'s Responsible AI practices.', status: 'INVALID_ARGUMENT' },
    })) as unknown as typeof fetch
    const err = await new GoogleImagenProvider().generateImage({ prompt: 'x', model: 'imagen-4' }, 'k').catch((e) => e)
    expectTyped(err, 'INVALID_ARGUMENT')
  })

  it('leaves a malformed safety_settings 400 alone', async () => {
    global.fetch = jest.fn(async () => jsonResponse(400, {
      error: { message: 'Invalid value at \'safety_settings[0].threshold\'', status: 'INVALID_ARGUMENT' },
    })) as unknown as typeof fetch
    const err = await new GoogleImagenProvider().generateImage({ prompt: 'x', model: 'imagen-4' }, 'k').catch((e) => e)
    expect((err as { code?: string }).code).toBeUndefined()
  })
})

describe('streamed finish reasons reach the host', () => {
  const responsesResponse = (extra: Record<string, unknown>) => ({
    id: 'resp_1', created_at: 0, model: 'm', output_text: '', output: [],
    status: 'completed', usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
    ...extra,
  })

  it('OpenAI: an incomplete content_filter response', () => {
    const raw = (new OpenAIProvider() as any).buildRawResponse(responsesResponse({
      status: 'incomplete', incomplete_details: { reason: 'content_filter' },
    }))
    expect(extractFinishReason(raw)).toBe('content_filter')
  })

  it('OpenAI: a refusal output', () => {
    const raw = (new OpenAIProvider() as any).buildRawResponse(responsesResponse({
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }],
    }))
    expect(extractFinishReason(raw)).toBe('refusal')
  })

  it('Grok: an incomplete content_filter response', () => {
    const raw = (new GrokProvider() as any).buildRawResponse(responsesResponse({
      status: 'incomplete', incomplete_details: { reason: 'content_filter' },
    }))
    expect(extractFinishReason(raw)).toBe('content_filter')
  })

  it('Google: a blocked prompt\'s blockReason stands in as the finish reason', () => {
    const provider = new GoogleProvider() as any
    const raw = provider.withBlockReason({ usageMetadata: {} }, { blockReason: 'SAFETY' })
    expect(extractFinishReason(raw)).toBe('SAFETY')
    // An ordinary response is left alone.
    const plain = { candidates: [{ finishReason: 'STOP' }] }
    expect(provider.withBlockReason(plain, null)).toBe(plain)
  })

  it('OpenRouter: the streamed chat-completions finish reason', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":""}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    const bytes = new TextEncoder().encode(sse)
    let sent = false
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
        }),
      },
    })) as unknown as typeof fetch

    const provider = new OpenRouterProvider() as any
    let last: any
    for await (const chunk of provider.streamViaChatCompletions(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      'sk',
      { sent: [], failed: [] },
    )) {
      last = chunk
    }
    expect(last.done).toBe(true)
    expect(extractFinishReason(last.rawResponse)).toBe('content_filter')
  })
})
