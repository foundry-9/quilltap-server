import { describe, it, expect, jest, beforeEach } from '@jest/globals'

type ChunkLike = {
  content?: string
  done?: boolean
  usage?: unknown
  cacheUsage?: unknown
  rawResponse?: unknown
  thoughtSignature?: string
}

const mockProcessToolCalls = jest.fn()

let nextStreamMessageBehaviour: 'happy' | 'throw' = 'happy'
let nextStreamMessageChunks: ChunkLike[] = []
let nextStreamMessageThrowAfter: number | null = null
const streamMessageCalls: Array<Record<string, unknown>> = []

async function* mockStreamMessageImpl(opts: Record<string, unknown>): AsyncGenerator<ChunkLike> {
  streamMessageCalls.push(opts)
  if (nextStreamMessageBehaviour === 'throw' && nextStreamMessageThrowAfter === 0) {
    throw new Error('stream-broke-before-any-chunk')
  }
  let i = 0
  for (const chunk of nextStreamMessageChunks) {
    yield chunk
    i += 1
    if (nextStreamMessageBehaviour === 'throw' && nextStreamMessageThrowAfter === i) {
      throw new Error('stream-broke-mid-continuation')
    }
  }
}

const mockSafeEnqueue = jest.fn((controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => {
  controller.enqueue(chunk)
  return true
})
const mockEncodeContentChunk = jest.fn((_encoder: TextEncoder, text: string) => ({ contentChunk: text }))
const mockEncodeStatusEvent = jest.fn((_encoder: TextEncoder, payload: unknown) => ({ status: payload }))

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  streamMessage: (opts: Record<string, unknown>) => mockStreamMessageImpl(opts),
  encodeContentChunk: (encoder: TextEncoder, text: string) => mockEncodeContentChunk(encoder, text),
  encodeStatusEvent: (encoder: TextEncoder, payload: unknown) => mockEncodeStatusEvent(encoder, payload),
  safeEnqueue: (controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => mockSafeEnqueue(controller, chunk),
}))

jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  processToolCalls: (...args: any[]) => mockProcessToolCalls(...args),
}))

const {
  runTextToolPass,
} = require('@/lib/services/chat-message/text-tool-loop.service') as typeof import('@/lib/services/chat-message/text-tool-loop.service')

function makeStreaming(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    fullResponse: 'plain narration <tool_use>foo</tool_use>',
    effectiveProfile: { provider: 'GOOGLE', modelName: 'gemini', baseUrl: null } as any,
    effectiveApiKey: 'k',
    usage: null,
    cacheUsage: null,
    attachmentResults: null,
    rawResponse: null,
    thoughtSignature: 'sig-1',
    hasStartedStreaming: true,
    ...overrides,
  } as any
}

function makeStrategy(overrides: Partial<{
  name: 'provider-text-markers' | 'text-block'
  hasMarkers: (r: string) => boolean
  parse: (r: string) => Array<{ name: string; arguments: Record<string, unknown> }>
  strip: (r: string) => string
}> = {}) {
  return {
    name: 'provider-text-markers' as const,
    hasMarkers: jest.fn((_r: string) => true),
    parse: jest.fn((_r: string) => [{ name: 'doc_open_file', arguments: { path: 'a.md' } }]),
    strip: jest.fn((r: string) => r.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '').trim()),
    ...overrides,
  }
}

function makeBaseOpts(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    chatId: 'chat-1',
    userId: 'user-1',
    character: { id: 'char-1', name: 'Alice' },
    preGeneratedAssistantMessageId: 'pre-msg-1',
    strategy: makeStrategy(),
    formattedMessages: [{ role: 'user', content: 'Hi' }] as any,
    modelParams: { temperature: 0.7 },
    continuationTools: [{ name: 'image' }],
    continuationUseNativeWebSearch: true,
    toolContext: {} as any,
    streaming: makeStreaming(),
    toolMessages: [] as any[],
    generatedImagePaths: [] as any[],
    controller: { enqueue: jest.fn() } as any,
    encoder: new TextEncoder(),
    preservePartialOnError: jest.fn(async () => undefined),
    ...overrides,
  }
}

describe('text-tool-loop.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    streamMessageCalls.length = 0
    nextStreamMessageBehaviour = 'happy'
    nextStreamMessageThrowAfter = null
    nextStreamMessageChunks = [
      { content: 'continuation-' },
      { content: 'response' },
      { done: true, usage: { promptTokens: 5 }, cacheUsage: { cacheReadInputTokens: 1 }, rawResponse: { id: 'r1' }, thoughtSignature: 'sig-2' },
    ]
    mockProcessToolCalls.mockImplementation(async (_calls, _ctx, controller: { enqueue: (c: unknown) => void }, _encoder, _statusCtx) => {
      controller.enqueue({ toolsDetected: 1 })
      return {
        toolMessages: [{ toolName: 'doc_open_file', content: 'opened a.md', callId: undefined }],
        generatedImagePaths: [{ filePath: '/tmp/x.png', toolName: 'image' }],
      }
    })
  })

  it('no-ops when fullResponse is empty', async () => {
    const opts = makeBaseOpts({ streaming: makeStreaming({ fullResponse: '' }) })
    await runTextToolPass(opts as any)
    expect(opts.strategy.hasMarkers).not.toHaveBeenCalled()
    expect(mockProcessToolCalls).not.toHaveBeenCalled()
    expect(streamMessageCalls).toHaveLength(0)
  })

  it('no-ops when strategy.hasMarkers returns false', async () => {
    const strategy = makeStrategy({ hasMarkers: jest.fn(() => false) })
    const opts = makeBaseOpts({ strategy })
    await runTextToolPass(opts as any)
    expect(strategy.hasMarkers).toHaveBeenCalledTimes(1)
    expect(strategy.parse).not.toHaveBeenCalled()
    expect(mockProcessToolCalls).not.toHaveBeenCalled()
  })

  it('no-ops when strategy.parse returns an empty array even though hasMarkers is true', async () => {
    const strategy = makeStrategy({ parse: jest.fn(() => []) })
    const opts = makeBaseOpts({ strategy })
    await runTextToolPass(opts as any)
    expect(strategy.parse).toHaveBeenCalledTimes(1)
    expect(mockProcessToolCalls).not.toHaveBeenCalled()
    expect(streamMessageCalls).toHaveLength(0)
  })

  it('runs the happy path: tool execution, conversation rebuild, continuation, streaming-state updates', async () => {
    const opts = makeBaseOpts()
    const initialFull = opts.streaming.fullResponse

    await runTextToolPass(opts as any)

    expect(mockProcessToolCalls).toHaveBeenCalledTimes(1)
    expect(opts.toolMessages).toHaveLength(1)
    expect(opts.toolMessages[0]).toMatchObject({ toolName: 'doc_open_file' })
    expect(opts.generatedImagePaths).toHaveLength(1)

    // strip called on the original response (continuation slate build) and on
    // the final combined result.
    expect((opts.strategy.strip as jest.Mock).mock.calls).toHaveLength(2)
    expect((opts.strategy.strip as jest.Mock).mock.calls[0][0]).toBe(initialFull)

    // streamMessage was invoked with the rebuilt continuation slate.
    expect(streamMessageCalls).toHaveLength(1)
    const sent = streamMessageCalls[0]!
    const messages = sent.messages as Array<{ role: string; content: string }>
    expect(messages[0]).toEqual({ role: 'user', content: 'Hi' })
    // Stripped assistant turn is included.
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('plain narration')
    // One synthetic user message per tool result.
    expect(messages[2]).toMatchObject({ role: 'user' })
    expect(messages[2].content).toContain('[Tool Result: doc_open_file]')
    expect(messages[2].content).toContain('opened a.md')

    expect(sent.tools).toEqual([{ name: 'image' }])
    expect(sent.useNativeWebSearch).toBe(true)
    expect(sent.userId).toBe('user-1')
    expect(sent.messageId).toBe('pre-msg-1')

    // Streaming state was updated from the continuation's done chunk.
    expect(opts.streaming.usage).toEqual({ promptTokens: 5 })
    expect(opts.streaming.cacheUsage).toEqual({ cacheReadInputTokens: 1 })
    expect(opts.streaming.rawResponse).toEqual({ id: 'r1' })
    expect(opts.streaming.thoughtSignature).toBe('sig-2')

    // fullResponse rewritten to stripped + separator + continuation, then re-stripped.
    expect(opts.streaming.fullResponse).toBe('plain narration\n\ncontinuation-response')

    expect(opts.preservePartialOnError).not.toHaveBeenCalled()
  })

  it('omits the assistant turn from the continuation when the stripped response is whitespace', async () => {
    const strategy = makeStrategy({ strip: jest.fn(() => '   \n  ') })
    const opts = makeBaseOpts({ strategy })

    await runTextToolPass(opts as any)

    const sent = streamMessageCalls[0]!
    const messages = sent.messages as Array<{ role: string }>
    // Only the original formattedMessages + tool-result user message.
    expect(messages.map(m => m.role)).toEqual(['user', 'user'])
  })

  it('skips the "\\n\\n" separator in the combined response when continuation is empty', async () => {
    nextStreamMessageChunks = [
      { done: true, usage: null, cacheUsage: null, rawResponse: null },
    ]
    const opts = makeBaseOpts()
    await runTextToolPass(opts as any)
    expect(opts.streaming.fullResponse).toBe('plain narration')
  })

  it('on continuation error: rewrites fullResponse, strips again, calls preservePartialOnError, and re-throws', async () => {
    nextStreamMessageBehaviour = 'throw'
    nextStreamMessageThrowAfter = 1 // throw after first chunk lands
    const opts = makeBaseOpts()

    await expect(runTextToolPass(opts as any)).rejects.toThrow('stream-broke-mid-continuation')

    expect(opts.preservePartialOnError).toHaveBeenCalledTimes(1)
    // The combined-and-stripped response carries the partial continuation
    // that streamed before the error.
    expect(opts.streaming.fullResponse).toBe('plain narration\n\ncontinuation-')
    // strip is called once on the slate build and once on the error rewrite.
    expect((opts.strategy.strip as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('text-block strategy: continuation tools/useNativeWebSearch can be suppressed, strip-on-completion still runs', async () => {
    const stripSpy = jest.fn((r: string) => r.replace(/\[\[TOOL\]\][\s\S]*?\[\[\/TOOL\]\]/g, '').trim())
    const opts = makeBaseOpts({
      streaming: makeStreaming({ fullResponse: 'foo [[TOOL]]x[[/TOOL]] bar' }),
      strategy: {
        name: 'text-block',
        hasMarkers: jest.fn(() => true),
        parse: jest.fn(() => [{ name: 'image', arguments: {} }]),
        strip: stripSpy,
      },
      continuationTools: [],
      continuationUseNativeWebSearch: false,
    })

    await runTextToolPass(opts as any)

    const sent = streamMessageCalls[0]!
    expect(sent.tools).toEqual([])
    expect(sent.useNativeWebSearch).toBe(false)

    // strip called twice (slate build + final combined).
    expect(stripSpy).toHaveBeenCalledTimes(2)
    expect(opts.streaming.fullResponse).toBe('foo  bar\n\ncontinuation-response')
  })
})
