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
// Optional FIFO queue: when set, each streamMessage call pops the next chunk
// array instead of reusing `nextStreamMessageChunks`. Once empty, falls back to
// `nextStreamMessageChunks` so the same setup works for single- and multi-pass
// tests.
let streamMessageChunkQueue: ChunkLike[][] | null = null
let nextStreamMessageThrowAfter: number | null = null
const streamMessageCalls: Array<Record<string, unknown>> = []

async function* mockStreamMessageImpl(opts: Record<string, unknown>): AsyncGenerator<ChunkLike> {
  streamMessageCalls.push(opts)
  if (nextStreamMessageBehaviour === 'throw' && nextStreamMessageThrowAfter === 0) {
    throw new Error('stream-broke-before-any-chunk')
  }
  const chunks = streamMessageChunkQueue && streamMessageChunkQueue.length > 0
    ? streamMessageChunkQueue.shift()!
    : nextStreamMessageChunks
  let i = 0
  for (const chunk of chunks) {
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
  name: 'provider-text-markers' | 'text-block' | 'simple-json'
  hasMarkers: (r: string) => boolean
  parse: (r: string) => Array<{ name: string; arguments: Record<string, unknown> }>
  strip: (r: string) => string
  formatToolResult: (toolName: string, content: string) => string
  stopSequences?: string[]
}> = {}) {
  return {
    name: 'provider-text-markers' as const,
    // Realistic marker detection: only the initial response carries the
    // `<tool_use>` pattern. Continuations like `continuation-response` don't,
    // so the loop naturally terminates after one iteration unless a test
    // overrides this.
    hasMarkers: jest.fn((r: string) => /<tool_use>/.test(r)),
    parse: jest.fn((_r: string) => [{ name: 'doc_open_file', arguments: { path: 'a.md' } }]),
    strip: jest.fn((r: string) => r.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '').trim()),
    formatToolResult: jest.fn(
      (toolName: string, content: string) => `[Tool Result: ${toolName}]\n${content}`,
    ),
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
    streamMessageChunkQueue = null
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

    // strip is called once per raw response at assembly time: initial + 1 continuation.
    expect((opts.strategy.strip as jest.Mock).mock.calls).toHaveLength(2)
    expect((opts.strategy.strip as jest.Mock).mock.calls[0][0]).toBe(initialFull)

    // streamMessage was invoked with the rebuilt continuation slate.
    expect(streamMessageCalls).toHaveLength(1)
    const sent = streamMessageCalls[0]!
    const messages = sent.messages as Array<{ role: string; content: string }>
    expect(messages[0]).toEqual({ role: 'user', content: 'Hi' })
    // Un-stripped assistant turn is included so the model can see its own
    // tool_call paired with the result that follows.
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe(initialFull)
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

    // fullResponse: each rawResponse stripped, then joined with a blank line.
    expect(opts.streaming.fullResponse).toBe('plain narration\n\ncontinuation-response')

    expect(opts.preservePartialOnError).not.toHaveBeenCalled()
  })

  it('drops continuation entries that strip to empty when assembling the final response', async () => {
    nextStreamMessageChunks = [
      { done: true, usage: null, cacheUsage: null, rawResponse: null },
    ]
    const opts = makeBaseOpts()
    await runTextToolPass(opts as any)
    // Continuation was empty → only the initial stripped chunk survives, no
    // dangling separator.
    expect(opts.streaming.fullResponse).toBe('plain narration')
  })

  it('on continuation error: rewrites fullResponse, calls preservePartialOnError, and re-throws', async () => {
    nextStreamMessageBehaviour = 'throw'
    nextStreamMessageThrowAfter = 1 // throw after first chunk lands
    const opts = makeBaseOpts()

    await expect(runTextToolPass(opts as any)).rejects.toThrow('stream-broke-mid-continuation')

    expect(opts.preservePartialOnError).toHaveBeenCalledTimes(1)
    // The combined-and-stripped response carries the partial continuation
    // that streamed before the error.
    expect(opts.streaming.fullResponse).toBe('plain narration\n\ncontinuation-')
    expect((opts.strategy.strip as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('text-block strategy: continuation tools/useNativeWebSearch can be suppressed, strip-on-completion still runs', async () => {
    const stripSpy = jest.fn((r: string) => r.replace(/\[\[TOOL\]\][\s\S]*?\[\[\/TOOL\]\]/g, '').trim())
    const opts = makeBaseOpts({
      streaming: makeStreaming({ fullResponse: 'foo [[TOOL]]x[[/TOOL]] bar' }),
      strategy: {
        name: 'text-block',
        hasMarkers: jest.fn((r: string) => /\[\[TOOL\]\]/.test(r)),
        parse: jest.fn(() => [{ name: 'image', arguments: {} }]),
        strip: stripSpy,
        formatToolResult: (toolName: string, content: string) => `[Tool Result: ${toolName}]\n${content}`,
      },
      continuationTools: [],
      continuationUseNativeWebSearch: false,
    })

    await runTextToolPass(opts as any)

    const sent = streamMessageCalls[0]!
    expect(sent.tools).toEqual([])
    expect(sent.useNativeWebSearch).toBe(false)

    // strip called once per raw response at final assembly (initial + 1 continuation).
    expect(stripSpy).toHaveBeenCalledTimes(2)
    expect(opts.streaming.fullResponse).toBe('foo  bar\n\ncontinuation-response')
  })

  describe('multi-iteration looping', () => {
    it('iterates while continuations keep emitting markers, accumulating tool messages', async () => {
      // Initial response has markers; first two continuations also carry
      // markers; the third is plain prose, ending the loop.
      streamMessageChunkQueue = [
        [{ content: 'still <tool_use>2</tool_use>' }, { done: true, usage: null, rawResponse: { id: 'r1' } }],
        [{ content: 'more <tool_use>3</tool_use>' }, { done: true, usage: null, rawResponse: { id: 'r2' } }],
        [{ content: 'final answer' }, { done: true, usage: null, rawResponse: { id: 'r3' } }],
      ]

      // Each parse returns a DIFFERENT args object so dedupe never trips.
      let parseIdx = 0
      const opts = makeBaseOpts({
        strategy: makeStrategy({
          parse: jest.fn(() => {
            parseIdx += 1
            return [{ name: 'doc_open_file', arguments: { iter: parseIdx } }]
          }),
        }),
      })

      await runTextToolPass(opts as any)

      // Three batches executed (initial + 2 marker-bearing continuations).
      expect(mockProcessToolCalls).toHaveBeenCalledTimes(3)
      expect(opts.toolMessages).toHaveLength(3)
      // Three streamMessage calls (one per continuation).
      expect(streamMessageCalls).toHaveLength(3)
      // Final assembled response: each raw response stripped, joined with "\n\n".
      expect(opts.streaming.fullResponse).toBe('plain narration\n\nstill\n\nmore\n\nfinal answer')

      // Each iteration's continuation slate grows: the un-stripped assistant
      // turns from prior iterations stay attached so the model sees the chain.
      const finalCallMessages = streamMessageCalls[2]!.messages as Array<{ role: string; content: string }>
      const roles = finalCallMessages.map(m => m.role)
      // user (original) + assistant1 + tool_result1 + assistant2 + tool_result2 + assistant3 + tool_result3.
      expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user'])
      // The first assistant turn carries the un-stripped initial response.
      expect(finalCallMessages[1].content).toBe('plain narration <tool_use>foo</tool_use>')
    })

    it('nudges and stops when the same call signature appears 3 times', async () => {
      // Every continuation re-emits markers; final stream after dedupe trip
      // returns the answer prose.
      streamMessageChunkQueue = [
        [{ content: 'again <tool_use>same</tool_use>' }, { done: true, usage: null, rawResponse: { id: 'a' } }],
        [{ content: 'again <tool_use>same</tool_use>' }, { done: true, usage: null, rawResponse: { id: 'b' } }],
        [{ content: 'okay, here is the answer based on what I have' }, { done: true, usage: null, rawResponse: { id: 'nudge' } }],
      ]

      const opts = makeBaseOpts({
        strategy: makeStrategy({
          // Always claim markers so we keep re-entering.
          hasMarkers: jest.fn(() => true),
          parse: jest.fn(() => [{ name: 'search', arguments: { q: 'x' } }]),
        }),
      })

      await runTextToolPass(opts as any)

      // Two actual tool executions; the 3rd identical call is refused.
      expect(mockProcessToolCalls).toHaveBeenCalledTimes(2)
      // Three streamMessage calls: 2 normal continuations + the nudge stream.
      expect(streamMessageCalls).toHaveLength(3)

      // Nudge stream's last user message contains the dedupe phrasing.
      const lastSent = streamMessageCalls[streamMessageCalls.length - 1]!
      const messages = lastSent.messages as Array<{ role: string; content: string }>
      const lastUser = messages[messages.length - 1]!
      expect(lastUser.role).toBe('user')
      expect(lastUser.content).toContain('already called the same tool with the same arguments')
      expect(lastUser.content).toContain('do NOT call any more tools')

      // The nudge response landed in the final body.
      expect(opts.streaming.fullResponse).toContain('okay, here is the answer based on what I have')
    })

    it('stops at the iteration cap when dedupe never trips', async () => {
      // Marker-bearing chunks for every continuation; unique args so dedupe
      // doesn't kick in.
      const marker: ChunkLike[] = [
        { content: 'and <tool_use>more</tool_use>' },
        { done: true, usage: null, rawResponse: { id: 'r' } },
      ]
      streamMessageChunkQueue = [marker, marker, marker, marker, marker, marker]

      let argsCounter = 0
      const opts = makeBaseOpts({
        strategy: makeStrategy({
          parse: jest.fn(() => {
            argsCounter += 1
            return [{ name: 'search', arguments: { unique: argsCounter } }]
          }),
        }),
      })

      await runTextToolPass(opts as any)

      // Cap is 5 → exactly five tool batches executed.
      expect(mockProcessToolCalls).toHaveBeenCalledTimes(5)
      expect(streamMessageCalls).toHaveLength(5)
    })
  })

  describe('formatToolResult + stopSequences (simple-json strategy)', () => {
    it('calls strategy.formatToolResult for each tool result in the continuation slate', async () => {
      const formatSpy = jest.fn(
        (toolName: string, content: string) =>
          `<tool_result name="${toolName}">\n${content}\n</tool_result>`,
      )
      const strategy = makeStrategy({ name: 'simple-json', formatToolResult: formatSpy })
      const opts = makeBaseOpts({ strategy })

      await runTextToolPass(opts as any)

      expect(formatSpy).toHaveBeenCalledTimes(1)
      expect(formatSpy).toHaveBeenCalledWith('doc_open_file', 'opened a.md')

      const sent = streamMessageCalls[0]!
      const messages = sent.messages as Array<{ role: string; content: string }>
      // The synthetic user-role result message uses the strategy's framing,
      // not the legacy `[Tool Result: ...]` template.
      expect(messages[2].role).toBe('user')
      expect(messages[2].content).toBe('<tool_result name="doc_open_file">\nopened a.md\n</tool_result>')
      expect(messages[2].content).not.toContain('[Tool Result:')
    })

    it('passes strategy.stopSequences into the continuation streamMessage call', async () => {
      const strategy = makeStrategy({
        name: 'simple-json',
        stopSequences: ['</tool_call>'],
      })
      const opts = makeBaseOpts({ strategy })

      await runTextToolPass(opts as any)

      const sent = streamMessageCalls[0]!
      expect(sent.stop).toEqual(['</tool_call>'])
    })

    it('passes undefined stop when the strategy does not declare stopSequences', async () => {
      const strategy = makeStrategy() // legacy text-block / provider-text-markers
      const opts = makeBaseOpts({ strategy })

      await runTextToolPass(opts as any)

      const sent = streamMessageCalls[0]!
      expect(sent.stop).toBeUndefined()
    })
  })
})
