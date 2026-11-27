/**
 * `streamMessage` writes exactly one LLM log row per call, whatever becomes of
 * it: a finished call on its terminal chunk, a failed one with its error, and
 * one its consumer walked away from with a note saying so. The Salon's LLM
 * Inspector reads these rows, so a call without one is invisible there.
 */

jest.mock('@/lib/logging/create-logger', () => {
  const quiet = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })
  return { createServiceLogger: jest.fn(quiet), createLogger: jest.fn(quiet) }
})

const logLLMCall = jest.fn(async () => null)
jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: (...args: unknown[]) => logLLMCall(...(args as [])),
}))

const detectToolCalls = jest.fn((_raw: unknown, _provider: string) => [] as Array<{ name: string; arguments: Record<string, unknown> }>)
jest.mock('@/lib/chat/tool-executor', () => ({
  detectToolCalls: (raw: unknown, provider: string) => detectToolCalls(raw, provider),
}))

let providerStream: () => AsyncGenerator<Record<string, unknown>>
jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(async () => ({
    streamMessage: () => providerStream(),
  })),
}))

import { streamMessage, type StreamOptions } from '@/lib/services/chat-message/streaming.service'

const options = (): StreamOptions => ({
  messages: [{ role: 'user', content: 'Good evening.' }],
  connectionProfile: {
    id: 'profile-1',
    userId: 'user-1',
    provider: 'OPENAI',
    modelName: 'gpt-x',
    baseUrl: null,
  } as unknown as StreamOptions['connectionProfile'],
  apiKey: 'key',
  modelParams: {},
  tools: [],
  useNativeWebSearch: false,
  userId: 'user-1',
  chatId: 'chat-1',
  messageId: 'msg-1',
  characterId: 'char-1',
})

async function drain(gen: AsyncGenerator<unknown>, stopAfter = Infinity): Promise<void> {
  let seen = 0
  for await (const _chunk of gen) {
    seen++
    if (seen >= stopAfter) break
  }
}

describe('streamMessage LLM logging', () => {
  beforeEach(() => {
    logLLMCall.mockClear()
    detectToolCalls.mockClear()
  })

  it('logs a finished call once, with usage and cache usage, against the chat and message', async () => {
    providerStream = async function* () {
      yield { content: 'Good ', done: false }
      yield { content: 'evening to you.', done: false }
      yield {
        content: '',
        done: true,
        usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
        cacheUsage: { cacheReadInputTokens: 8 },
      }
    }

    await drain(streamMessage(options()))

    expect(logLLMCall).toHaveBeenCalledTimes(1)
    expect(logLLMCall.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      chatId: 'chat-1',
      messageId: 'msg-1',
      type: 'CHAT_MESSAGE',
      response: { content: 'Good evening to you.' },
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
      cacheUsage: { cacheReadInputTokens: 8 },
    })
    expect((logLLMCall.mock.calls[0][0] as { response: { error?: string } }).response.error).toBeUndefined()
  })

  it('logs a failed call with its error and whatever arrived before it', async () => {
    providerStream = async function* () {
      yield { content: 'Half a', done: false }
      throw new Error('upstream refused')
    }

    await expect(drain(streamMessage(options()))).rejects.toThrow('upstream refused')

    expect(logLLMCall).toHaveBeenCalledTimes(1)
    expect(logLLMCall.mock.calls[0][0]).toMatchObject({
      chatId: 'chat-1',
      messageId: 'msg-1',
      response: { content: 'Half a', error: 'upstream refused' },
    })
  })

  it('logs a call its consumer abandoned before the provider finished', async () => {
    providerStream = async function* () {
      yield { content: 'One', done: false }
      yield { content: ' two', done: false }
      yield { content: '', done: true }
    }

    await drain(streamMessage(options()), 1)

    expect(logLLMCall).toHaveBeenCalledTimes(1)
    expect(logLLMCall.mock.calls[0][0]).toMatchObject({
      response: { content: 'One', error: 'The stream was closed before the provider finished' },
    })
  })

  it('logs a stream that ends without a terminal chunk as an ordinary answer', async () => {
    providerStream = async function* () {
      yield { content: 'No terminal chunk here.', done: false }
    }

    await drain(streamMessage(options()))

    expect(logLLMCall).toHaveBeenCalledTimes(1)
    const row = logLLMCall.mock.calls[0][0] as { response: { content: string; error?: string } }
    expect(row.response.content).toBe('No terminal chunk here.')
    expect(row.response.error).toBeUndefined()
  })

  it("records what the provider's parser made of a native tool request, an empty list included", async () => {
    const raw = { candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] }
    providerStream = async function* () {
      yield { content: '', done: true, rawResponse: raw }
    }
    const tool = { type: 'function', function: { name: 'search', parameters: {} } }

    await drain(streamMessage({ ...options(), tools: [tool] as unknown as StreamOptions['tools'] }))
    expect(detectToolCalls).toHaveBeenCalledWith(raw, 'OPENAI')
    expect(logLLMCall.mock.calls[0][0]).toMatchObject({
      response: { finishReason: 'MALFORMED_FUNCTION_CALL', toolCalls: [] },
    })

    logLLMCall.mockClear()
    detectToolCalls.mockReturnValueOnce([{ name: 'search', arguments: { query: 'tea' } }])
    await drain(streamMessage({ ...options(), tools: [tool] as unknown as StreamOptions['tools'] }))
    expect(logLLMCall.mock.calls[0][0]).toMatchObject({
      response: { toolCalls: [{ name: 'search', arguments: { query: 'tea' } }] },
    })
  })

  it('records no tool calls when no native tools were sent', async () => {
    providerStream = async function* () {
      yield { content: 'Hello', done: true }
    }

    await drain(streamMessage(options()))

    expect(detectToolCalls).not.toHaveBeenCalled()
    expect((logLLMCall.mock.calls[0][0] as { response: object }).response).not.toHaveProperty('toolCalls')
  })

  it('writes nothing without a user to attribute the call to', async () => {
    providerStream = async function* () {
      yield { content: 'Hello', done: true }
    }

    await drain(streamMessage({ ...options(), userId: undefined }))

    expect(logLLMCall).not.toHaveBeenCalled()
  })
})
