/**
 * @jest-environment node
 *
 * (node env: the orchestrator returns a `ReadableStream`, which jsdom lacks but
 * Node provides as a global.)
 *
 * Unit tests for the Brahma Console orchestrator.
 *
 * The load-bearing guarantee: a Brahma turn fires the context-summary check
 * (so past chats get auto-titled) but NEVER triggers memory extraction — the
 * console forms no persistent memories. We also cover the model resolution
 * helper (pinned-vs-default).
 *
 * Mocks follow the repo convention: BARE factory functions, configured via
 * jest.mocked(...) in beforeEach. The repos object is passed into the
 * orchestrator directly (it does not call getRepositories itself).
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import {
  handleBrahmaConsoleMessage,
  resolveBrahmaConnectionProfile,
} from '../orchestrator.service'

// ── Mocks ─────────────────────────────────────────────────────────────────
jest.mock('@/lib/plugins/provider-validation', () => ({
  requiresApiKey: jest.fn().mockReturnValue(false),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  buildTools: jest.fn(),
  streamMessage: jest.fn(),
  encodeContentChunk: jest.fn(() => new Uint8Array()),
  encodeReasoningChunk: jest.fn(() => new Uint8Array()),
  encodeDoneEvent: jest.fn(() => new Uint8Array()),
  encodeErrorEvent: jest.fn(() => new Uint8Array()),
  safeEnqueue: (controller: ReadableStreamDefaultController<Uint8Array>, data: Uint8Array) => {
    try { controller.enqueue(data); return true } catch { return false }
  },
  safeClose: (controller: ReadableStreamDefaultController<Uint8Array>) => {
    try { controller.close() } catch { /* already closed */ }
  },
}))

jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  processToolCalls: jest.fn(),
  saveToolMessages: jest.fn(),
  detectToolCallsInResponse: jest.fn(),
}))

jest.mock('@/lib/services/chat-message/pseudo-tool.service', () => ({
  buildNativeToolSystemInstructions: jest.fn(() => 'native tool instructions'),
  checkShouldUseTextBlockTools: jest.fn(() => false),
  buildTextBlockSystemInstructions: jest.fn(() => 'text block instructions'),
  parseTextBlocksFromResponse: jest.fn(() => []),
  stripTextBlockMarkersFromResponse: jest.fn((s: string) => s),
}))

jest.mock('@/lib/services/chat-message/agent-mode-resolver.service', () => ({
  buildAgentModeInstructions: jest.fn(() => 'agent instructions'),
  buildForceFinalMessage: jest.fn(() => 'force final'),
  extractSubmitFinalResponseFromText: jest.fn((text: string) => text),
}))

jest.mock('@/lib/services/chat-message/memory-trigger.service', () => ({
  triggerContextSummaryCheck: jest.fn(),
  triggerTurnMemoryExtraction: jest.fn(),
}))

jest.mock('@/lib/services/token-tracking.service', () => ({
  trackMessageTokenUsage: jest.fn(),
}))

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn(),
}))

jest.mock('@/lib/tools', () => ({
  hasTextBlockMarkers: jest.fn(() => false),
}))

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { buildTools, streamMessage, encodeReasoningChunk } from '@/lib/services/chat-message/streaming.service'
import { detectToolCallsInResponse } from '@/lib/services/chat-message/tool-execution.service'
import {
  triggerContextSummaryCheck,
  triggerTurnMemoryExtraction,
} from '@/lib/services/chat-message/memory-trigger.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'

// ── Fixtures ─────────────────────────────────────────────────────────────────
const MOCK_PROFILE = {
  id: 'conn-1',
  userId: 'user-1',
  provider: 'openai',
  modelName: 'gpt-4o',
  allowWebSearch: false,
}

function makeMockRepos(overrides: Record<string, unknown> = {}) {
  return {
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: 'chat-1',
        userId: 'user-1',
        chatType: 'brahma',
        consoleConnectionProfileId: 'conn-1',
        participants: [],
      }),
      addMessage: jest.fn().mockResolvedValue(undefined),
      getMessages: jest.fn().mockResolvedValue([]),
    },
    connections: {
      findById: jest.fn().mockResolvedValue(MOCK_PROFILE),
      findDefault: jest.fn().mockResolvedValue(MOCK_PROFILE),
      findApiKeyById: jest.fn().mockResolvedValue({ id: 'key-1', key_value: 'sk-test' }),
    },
    chatSettings: {
      findByUserId: jest.fn().mockResolvedValue({ cheapLLMSettings: { enabled: true } }),
    },
    ...overrides,
  }
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(buildTools).mockResolvedValue({
    tools: [],
    modelSupportsNativeTools: false,
    useNativeWebSearch: false,
  } as never)
  jest.mocked(streamMessage).mockImplementation(async function* () {
    yield { content: 'Hello from the console.' }
    yield { done: true, rawResponse: { finishReason: 'stop' } }
  } as never)
  jest.mocked(detectToolCallsInResponse).mockReturnValue([])
  jest.mocked(estimateMessageCost).mockResolvedValue({ cost: 0, source: 'fallback' } as never)
})

describe('handleBrahmaConsoleMessage — memory omission', () => {
  it('fires the context-summary check but NEVER triggers memory extraction', async () => {
    const repos = makeMockRepos()
    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'hi there' })
    await drain(stream)

    expect(triggerContextSummaryCheck).toHaveBeenCalledTimes(1)
    expect(triggerTurnMemoryExtraction).not.toHaveBeenCalled()
  })

  it('persists the user message and the assistant reply', async () => {
    const repos = makeMockRepos()
    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'hi there' })
    await drain(stream)

    const saved = repos.chats.addMessage.mock.calls.map((c: unknown[]) => c[1] as { role: string; content: string })
    expect(saved.some(m => m.role === 'USER' && m.content === 'hi there')).toBe(true)
    expect(saved.some(m => m.role === 'ASSISTANT' && m.content === 'Hello from the console.')).toBe(true)
  })

  it('forwards reasoning ("thinking") live and persists it on the assistant message', async () => {
    // Provider emits cumulative reasoning across chunks, then prose.
    jest.mocked(streamMessage).mockImplementation(async function* () {
      yield { content: '', reasoningContent: 'Let me think.' }
      yield { content: '', reasoningContent: 'Let me think. Then act.' }
      yield { content: 'The answer.' }
      yield { done: true, rawResponse: { finishReason: 'stop' } }
    } as never)

    const repos = makeMockRepos()
    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'ponder this' })
    await drain(stream)

    // Live-forwarded: the cumulative chain is emitted as it grows.
    expect(encodeReasoningChunk).toHaveBeenCalledTimes(2)
    expect(jest.mocked(encodeReasoningChunk).mock.calls.map(c => c[1])).toEqual([
      'Let me think.',
      'Let me think. Then act.',
    ])

    // Persisted: the saved assistant message carries the full reasoning.
    const saved = repos.chats.addMessage.mock.calls.map((c: unknown[]) => c[1] as { role: string; content: string; reasoningContent?: string | null })
    const assistant = saved.find(m => m.role === 'ASSISTANT' && m.content === 'The answer.')
    expect(assistant?.reasoningContent).toBe('Let me think. Then act.')
  })

  it('rejects a non-brahma chat', async () => {
    const repos = makeMockRepos({
      chats: {
        findById: jest.fn().mockResolvedValue({ id: 'chat-1', userId: 'user-1', chatType: 'salon', participants: [] }),
        addMessage: jest.fn(),
        getMessages: jest.fn().mockResolvedValue([]),
      },
    })
    const stream = await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'hi' })
    await drain(stream) // should emit an error event and close, not throw
    expect(triggerContextSummaryCheck).not.toHaveBeenCalled()
  })
})

describe('resolveBrahmaConnectionProfile', () => {
  it('returns the pinned profile when it exists and the user owns it', async () => {
    const repos = makeMockRepos()
    const profile = await resolveBrahmaConnectionProfile(repos as never, 'user-1', 'conn-1')
    expect(profile?.id).toBe('conn-1')
    expect(repos.connections.findDefault).not.toHaveBeenCalled()
  })

  it('falls back to the default profile when the pinned one belongs to another user', async () => {
    const repos = makeMockRepos({
      connections: {
        findById: jest.fn().mockResolvedValue({ ...MOCK_PROFILE, userId: 'someone-else' }),
        findDefault: jest.fn().mockResolvedValue(MOCK_PROFILE),
        findApiKeyById: jest.fn(),
      },
    })
    const profile = await resolveBrahmaConnectionProfile(repos as never, 'user-1', 'conn-1')
    expect(repos.connections.findDefault).toHaveBeenCalledWith('user-1')
    expect(profile?.id).toBe('conn-1')
  })

  it('falls back to the default profile when none is pinned', async () => {
    const repos = makeMockRepos()
    const profile = await resolveBrahmaConnectionProfile(repos as never, 'user-1', null)
    expect(repos.connections.findById).not.toHaveBeenCalled()
    expect(repos.connections.findDefault).toHaveBeenCalledWith('user-1')
    expect(profile?.id).toBe('conn-1')
  })
})
