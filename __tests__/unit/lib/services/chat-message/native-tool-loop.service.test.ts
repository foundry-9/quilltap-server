import { describe, it, expect, jest, beforeEach } from '@jest/globals'

type ChunkLike = {
  content?: string
  done?: boolean
  usage?: unknown
  cacheUsage?: unknown
  attachmentResults?: unknown
  rawResponse?: unknown
  thoughtSignature?: string
}

// --- controllable streamMessage generator ------------------------------------
let nextStreamMessageScripts: ChunkLike[][] = []
let nextStreamMessageBehaviours: Array<'happy' | 'throw'> = []
let nextStreamMessageErrors: Array<Error> = []
const streamMessageCalls: Array<Record<string, unknown>> = []

async function* mockStreamMessageImpl(opts: Record<string, unknown>): AsyncGenerator<ChunkLike> {
  const idx = streamMessageCalls.length
  streamMessageCalls.push(opts)
  const chunks = nextStreamMessageScripts[idx] ?? []
  const behaviour = nextStreamMessageBehaviours[idx] ?? 'happy'
  for (const chunk of chunks) yield chunk
  if (behaviour === 'throw') throw nextStreamMessageErrors[idx] ?? new Error(`stream-${idx}-broke`)
}

const mockSafeEnqueue = jest.fn((controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => {
  controller.enqueue(chunk)
  return true
})
const mockEncodeContentChunk = jest.fn((_e: TextEncoder, t: string) => ({ contentChunk: t }))
const mockEncodeStatusEvent = jest.fn((_e: TextEncoder, p: unknown) => ({ status: p }))

const mockDetectToolCalls = jest.fn<(raw: unknown, provider: string) => Array<{ name: string; arguments: Record<string, unknown>; callId?: string }>>()
const mockProcessToolCalls = jest.fn<(...args: any[]) => Promise<{ toolMessages: any[]; generatedImagePaths: any[] }>>()

const mockRepoChatsUpdate = jest.fn<(id: string, patch: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)
const fakeRepos = { chats: { update: mockRepoChatsUpdate } }

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
  encodeContentChunk: (e: TextEncoder, t: string) => mockEncodeContentChunk(e, t),
  encodeStatusEvent: (e: TextEncoder, p: unknown) => mockEncodeStatusEvent(e, p),
  safeEnqueue: (c: { enqueue: (x: unknown) => void }, x: unknown) => mockSafeEnqueue(c, x),
}))

jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  detectToolCallsInResponse: (raw: unknown, provider: string) => mockDetectToolCalls(raw, provider),
  processToolCalls: (...args: any[]) => mockProcessToolCalls(...(args as [])),
}))

jest.mock('@/lib/services/chat-message/agent-mode-resolver.service', () => ({
  buildForceFinalMessage: () => 'FORCE_FINAL_MARKER',
  generateIterationSummary: (n: number, names: string[]) => `iter-${n}-${names.join('+')}`,
}))

const {
  runNativeToolLoop,
} = require('@/lib/services/chat-message/native-tool-loop.service') as typeof import('@/lib/services/chat-message/native-tool-loop.service')

function makeStreaming(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    fullResponse: '',
    effectiveProfile: { provider: 'ANTHROPIC', modelName: 'claude', baseUrl: null } as any,
    effectiveApiKey: 'k',
    usage: null,
    cacheUsage: null,
    attachmentResults: null,
    rawResponse: { id: 'raw-initial' } as unknown,
    thoughtSignature: 'sig-initial',
    hasStartedStreaming: true,
    ...overrides,
  } as any
}

function makeBaseOpts(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    repos: fakeRepos as any,
    chatId: 'chat-1',
    userId: 'user-1',
    character: { id: 'char-1', name: 'Alice', aliases: [] } as any,
    characterParticipant: { id: 'cp-1' } as any,
    preGeneratedAssistantMessageId: 'pre-msg-1',
    agentMode: { enabled: false, maxTurns: 5, enabledSource: 'default' } as any,
    formattedMessages: [{ role: 'user', content: 'Hi' }] as any,
    modelParams: { temperature: 0.7 },
    actualTools: [{ name: 'doc_open_file' }],
    useNativeWebSearch: false,
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

describe('native-tool-loop.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    streamMessageCalls.length = 0
    nextStreamMessageScripts = []
    nextStreamMessageBehaviours = []
    nextStreamMessageErrors = []
    mockDetectToolCalls.mockReset()
    mockProcessToolCalls.mockReset()
  })

  it('no-ops when streaming.rawResponse is falsy', async () => {
    const opts = makeBaseOpts({ streaming: makeStreaming({ rawResponse: null }) })
    await runNativeToolLoop(opts as any)
    expect(mockDetectToolCalls).not.toHaveBeenCalled()
    expect(streamMessageCalls).toHaveLength(0)
  })

  it('exits on first iteration when detectToolCalls returns []', async () => {
    mockDetectToolCalls.mockReturnValueOnce([])
    const opts = makeBaseOpts()
    await runNativeToolLoop(opts as any)
    expect(mockDetectToolCalls).toHaveBeenCalledTimes(1)
    expect(mockProcessToolCalls).not.toHaveBeenCalled()
    expect(streamMessageCalls).toHaveLength(0)
  })

  it('runs a single tool iteration, then exits when the follow-up stream has no tool calls', async () => {
    mockDetectToolCalls
      .mockReturnValueOnce([{ name: 'doc_open_file', arguments: { path: 'a.md' }, callId: 'tc-1' }])
      .mockReturnValueOnce([])

    mockProcessToolCalls.mockResolvedValueOnce({
      toolMessages: [{ toolName: 'doc_open_file', content: 'opened', callId: 'tc-1', success: true }],
      generatedImagePaths: [],
    })

    nextStreamMessageScripts = [[
      { content: 'after-tool-' },
      { content: 'response' },
      { done: true, usage: { promptTokens: 9 }, cacheUsage: null, rawResponse: { id: 'raw-2' }, thoughtSignature: 'sig-2' },
    ]]
    nextStreamMessageBehaviours = ['happy']

    const opts = makeBaseOpts({ streaming: makeStreaming({ fullResponse: 'I should open it. ', rawResponse: { id: 'raw-1' } }) })
    await runNativeToolLoop(opts as any)

    expect(mockProcessToolCalls).toHaveBeenCalledTimes(1)
    expect(opts.toolMessages).toHaveLength(1)
    expect(opts.toolMessages[0]?.callId).toBe('tc-1')
    expect(opts.streaming.fullResponse).toBe('I should open it. after-tool-response')
    expect(opts.streaming.usage).toEqual({ promptTokens: 9 })
    expect(opts.streaming.rawResponse).toEqual({ id: 'raw-2' })

    const sent = streamMessageCalls[0]!
    const messages = sent.messages as Array<{ role: string; content?: string; toolCallId?: string; toolCalls?: unknown[] }>
    expect(messages[0]).toMatchObject({ role: 'user', content: 'Hi' })
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'I should open it. ' })
    expect(messages[1]).toMatchObject({ toolCalls: [{ id: 'tc-1', type: 'function' }] })
    expect(messages[2]).toMatchObject({ role: 'tool', toolCallId: 'tc-1', content: 'opened', name: 'doc_open_file' })
  })

  it('uses text-fallback "user" role when no tool call carries a callId', async () => {
    mockDetectToolCalls
      .mockReturnValueOnce([{ name: 'image', arguments: {} }])
      .mockReturnValueOnce([])

    mockProcessToolCalls.mockResolvedValueOnce({
      toolMessages: [{ toolName: 'image', content: 'generated', success: true }],
      generatedImagePaths: [{ filePath: '/tmp/x.png', toolName: 'image' }],
    })

    nextStreamMessageScripts = [[{ done: true, usage: null, cacheUsage: null, rawResponse: null }]]
    nextStreamMessageBehaviours = ['happy']

    const opts = makeBaseOpts()
    await runNativeToolLoop(opts as any)

    expect(opts.generatedImagePaths).toHaveLength(1)
    const sent = streamMessageCalls[0]!
    const messages = sent.messages as Array<{ role: string; content?: string }>
    expect(messages[1]?.role).toBe('assistant')
    expect(messages[1]?.content).toBe('')
    expect(messages[2]).toMatchObject({ role: 'user', content: '[Tool Result: image]\ngenerated' })
  })

  it('agent mode: submit_final_response on iteration ≥ 1 sets fullResponse and exits', async () => {
    mockDetectToolCalls
      .mockReturnValueOnce([{ name: 'doc_open_file', arguments: {}, callId: 'tc-1' }])
      .mockReturnValueOnce([{ name: 'submit_final_response', arguments: { response: 'final-answer', summary: 'sum', confidence: 0.9 }, callId: 'tc-final' }])

    mockProcessToolCalls.mockResolvedValueOnce({
      toolMessages: [{ toolName: 'doc_open_file', content: 'ok', callId: 'tc-1', success: true }],
      generatedImagePaths: [],
    })

    nextStreamMessageScripts = [[
      { content: 'thinking-' },
      { done: true, usage: null, cacheUsage: null, rawResponse: { id: 'raw-after-tool' } },
    ]]
    nextStreamMessageBehaviours = ['happy']

    const opts = makeBaseOpts({
      agentMode: { enabled: true, maxTurns: 5, enabledSource: 'chat' } as any,
      streaming: makeStreaming({ fullResponse: 'pre-content ' }),
    })
    await runNativeToolLoop(opts as any)

    expect(opts.streaming.fullResponse).toBe('final-answer')
    expect(mockRepoChatsUpdate).toHaveBeenCalledWith('chat-1', { agentTurnCount: 1 })
    expect(streamMessageCalls).toHaveLength(1)
    expect(mockProcessToolCalls).toHaveBeenCalledTimes(1)
  })

  it('agent mode: ghost-wrap submit_final_response on iteration 0 is rejected and synthesizes a failure tool message', async () => {
    mockDetectToolCalls
      .mockReturnValueOnce([{ name: 'submit_final_response', arguments: { response: 'previously concluded' }, callId: 'tc-final' }])
      .mockReturnValueOnce([])

    nextStreamMessageScripts = [[
      { content: 'apologies, let me respond properly' },
      { done: true, usage: null, cacheUsage: null, rawResponse: { id: 'raw-after-rejection' } },
    ]]
    nextStreamMessageBehaviours = ['happy']

    const opts = makeBaseOpts({
      agentMode: { enabled: true, maxTurns: 5, enabledSource: 'chat' } as any,
      streaming: makeStreaming({ fullResponse: '' }),
    })
    await runNativeToolLoop(opts as any)

    expect(mockProcessToolCalls).not.toHaveBeenCalled()
    expect(opts.toolMessages).toHaveLength(1)
    expect(opts.toolMessages[0]?.success).toBe(false)
    expect(opts.toolMessages[0]?.toolName).toBe('submit_final_response')
    expect(opts.toolMessages[0]?.content).toContain('Rejected')

    expect(opts.streaming.fullResponse).toBe('apologies, let me respond properly')
    expect(streamMessageCalls).toHaveLength(1)
  })

  it('agent mode: submit_final_response with two tool calls on iteration 0 is NOT ghost-wrap (terminates)', async () => {
    mockDetectToolCalls.mockReturnValueOnce([
      { name: 'submit_final_response', arguments: { response: 'final' }, callId: 'tc-final' },
      { name: 'doc_open_file', arguments: {}, callId: 'tc-1' },
    ])
    const opts = makeBaseOpts({
      agentMode: { enabled: true, maxTurns: 5, enabledSource: 'chat' } as any,
      streaming: makeStreaming({ fullResponse: '' }),
    })
    await runNativeToolLoop(opts as any)
    expect(opts.streaming.fullResponse).toBe('final')
    expect(mockProcessToolCalls).not.toHaveBeenCalled()
  })

  it('agent mode: submit_final_response with prose on iteration 0 is NOT ghost-wrap (terminates, falls back to currentResponse when no response arg)', async () => {
    mockDetectToolCalls.mockReturnValueOnce([
      { name: 'submit_final_response', arguments: {}, callId: 'tc-final' },
    ])
    const opts = makeBaseOpts({
      agentMode: { enabled: true, maxTurns: 5, enabledSource: 'chat' } as any,
      streaming: makeStreaming({ fullResponse: 'already-streamed' }),
    })
    await runNativeToolLoop(opts as any)
    expect(opts.streaming.fullResponse).toBe('already-streamed')
  })

  it('agent mode max-turns: runs force-final pass and promotes submit_final_response.response when present', async () => {
    // Five iterations each return one non-final tool call, then exit via max-turns.
    for (let i = 0; i < 5; i++) {
      mockDetectToolCalls.mockReturnValueOnce([{ name: 'doc_open_file', arguments: { i }, callId: `tc-${i}` }])
    }
    mockProcessToolCalls.mockResolvedValue({
      toolMessages: [{ toolName: 'doc_open_file', content: 'ok', callId: 'cb', success: true }],
      generatedImagePaths: [],
    })

    // Five follow-up streams (one per iteration), then the force-final stream
    // whose chunk.rawResponse triggers a final detectToolCalls call.
    for (let i = 0; i < 5; i++) {
      nextStreamMessageScripts.push([{ done: true, usage: null, cacheUsage: null, rawResponse: { id: `raw-${i}` } }])
      nextStreamMessageBehaviours.push('happy')
    }
    nextStreamMessageScripts.push([
      { content: 'forced-fallback ' },
      { done: true, usage: { promptTokens: 12 }, cacheUsage: null, rawResponse: { id: 'force-raw' } },
    ])
    nextStreamMessageBehaviours.push('happy')

    // The detectToolCalls for the force-final response promotes its response arg.
    mockDetectToolCalls.mockReturnValueOnce([
      { name: 'submit_final_response', arguments: { response: 'forced-final-answer' }, callId: 'tc-force' },
    ])

    const opts = makeBaseOpts({
      agentMode: { enabled: true, maxTurns: 5, enabledSource: 'chat' } as any,
    })
    await runNativeToolLoop(opts as any)

    // 5 in-loop streams + 1 force-final = 6
    expect(streamMessageCalls).toHaveLength(6)
    expect(opts.streaming.fullResponse).toBe('forced-final-answer')
    expect(mockRepoChatsUpdate).toHaveBeenCalledTimes(5)

    // Force-final slate ends with the FORCE_FINAL_MARKER user message.
    const forceSent = streamMessageCalls[5]!
    const messages = forceSent.messages as Array<{ role: string; content?: string }>
    expect(messages[messages.length - 1]).toMatchObject({ role: 'user', content: 'FORCE_FINAL_MARKER' })
  })

  it('agent mode max-turns: when force-final response has NO submit_final_response, the streamed content is kept', async () => {
    for (let i = 0; i < 3; i++) {
      mockDetectToolCalls.mockReturnValueOnce([{ name: 'doc_open_file', arguments: { i }, callId: `tc-${i}` }])
    }
    mockProcessToolCalls.mockResolvedValue({
      toolMessages: [{ toolName: 'doc_open_file', content: 'ok', callId: 'cb', success: true }],
      generatedImagePaths: [],
    })

    for (let i = 0; i < 3; i++) {
      nextStreamMessageScripts.push([{ done: true, usage: null, cacheUsage: null, rawResponse: { id: `raw-${i}` } }])
      nextStreamMessageBehaviours.push('happy')
    }
    nextStreamMessageScripts.push([
      { content: 'streamed-fallback' },
      { done: true, usage: null, cacheUsage: null, rawResponse: { id: 'force-raw-2' } },
    ])
    nextStreamMessageBehaviours.push('happy')
    // No submit_final_response in the force-final response.
    mockDetectToolCalls.mockReturnValueOnce([])

    const opts = makeBaseOpts({
      agentMode: { enabled: true, maxTurns: 3, enabledSource: 'chat' } as any,
    })
    await runNativeToolLoop(opts as any)

    expect(opts.streaming.fullResponse).toBe('streamed-fallback')
  })

  it('non-agent mode max-turns: just logs a warning, no force-final pass', async () => {
    for (let i = 0; i < 5; i++) {
      mockDetectToolCalls.mockReturnValueOnce([{ name: 'doc_open_file', arguments: { i }, callId: `tc-${i}` }])
    }
    mockProcessToolCalls.mockResolvedValue({
      toolMessages: [{ toolName: 'doc_open_file', content: 'ok', callId: 'cb', success: true }],
      generatedImagePaths: [],
    })

    for (let i = 0; i < 5; i++) {
      nextStreamMessageScripts.push([{ done: true, usage: null, cacheUsage: null, rawResponse: { id: `raw-${i}` } }])
      nextStreamMessageBehaviours.push('happy')
    }

    const opts = makeBaseOpts() // agentMode.enabled === false; max = 5
    await runNativeToolLoop(opts as any)

    expect(streamMessageCalls).toHaveLength(5)
    expect(mockRepoChatsUpdate).not.toHaveBeenCalled()
  })

  it('on follow-up stream error: preservePartialOnError is called and the error re-throws', async () => {
    mockDetectToolCalls.mockReturnValueOnce([{ name: 'doc_open_file', arguments: {}, callId: 'tc-1' }])
    mockProcessToolCalls.mockResolvedValueOnce({
      toolMessages: [{ toolName: 'doc_open_file', content: 'ok', callId: 'tc-1', success: true }],
      generatedImagePaths: [],
    })

    nextStreamMessageScripts = [[{ content: 'mid-' }]]
    nextStreamMessageBehaviours = ['throw']
    nextStreamMessageErrors = [new Error('upstream-died')]

    const opts = makeBaseOpts()
    await expect(runNativeToolLoop(opts as any)).rejects.toThrow('upstream-died')
    expect(opts.preservePartialOnError).toHaveBeenCalledTimes(1)
    // The mid-stream content survives on streaming.fullResponse.
    expect(opts.streaming.fullResponse).toBe('mid-')
  })

  it('on force-final stream error: preservePartialOnError is called and the error re-throws', async () => {
    for (let i = 0; i < 2; i++) {
      mockDetectToolCalls.mockReturnValueOnce([{ name: 'doc_open_file', arguments: { i }, callId: `tc-${i}` }])
    }
    mockProcessToolCalls.mockResolvedValue({
      toolMessages: [{ toolName: 'doc_open_file', content: 'ok', callId: 'cb', success: true }],
      generatedImagePaths: [],
    })

    nextStreamMessageScripts.push([{ done: true, usage: null, cacheUsage: null, rawResponse: { id: 'r0' } }])
    nextStreamMessageBehaviours.push('happy')
    nextStreamMessageScripts.push([{ done: true, usage: null, cacheUsage: null, rawResponse: { id: 'r1' } }])
    nextStreamMessageBehaviours.push('happy')
    nextStreamMessageScripts.push([{ content: 'force-mid-' }])
    nextStreamMessageBehaviours.push('throw')
    nextStreamMessageErrors[2] = new Error('force-final-died')

    const opts = makeBaseOpts({
      agentMode: { enabled: true, maxTurns: 2, enabledSource: 'chat' } as any,
    })
    await expect(runNativeToolLoop(opts as any)).rejects.toThrow('force-final-died')
    expect(opts.preservePartialOnError).toHaveBeenCalledTimes(1)
  })
})
