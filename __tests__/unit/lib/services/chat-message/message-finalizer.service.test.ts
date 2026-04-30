import {
  finalizeMessageResponse,
  saveAssistantMessage,
} from '@/lib/services/chat-message/message-finalizer.service'
import * as memoryTriggers from '@/lib/services/chat-message/memory-trigger.service'
import * as streaming from '@/lib/services/chat-message/streaming.service'
import * as toolExecution from '@/lib/services/chat-message/tool-execution.service'
import * as compressionCache from '@/lib/services/chat-message/compression-cache.service'
import * as tokenTracking from '@/lib/services/token-tracking.service'
import * as costEstimation from '@/lib/services/cost-estimation.service'
import * as rngDetector from '@/lib/services/chat-message/rng-pattern-detector.service'
import * as rngHandler from '@/lib/tools/handlers/rng-handler'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/llm/message-formatter', () => ({
  normalizeContentBlockFormat: jest.fn((text: string) => text.replace(/^BLOCK:/, '')),
  stripCharacterNamePrefix: jest.fn((text: string) => text.replace(/^Alice:\s*/, '')),
}))

jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  saveToolMessages: jest.fn().mockResolvedValue({ firstToolMessageId: 'tool-1' }),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  encodeDoneEvent: jest.fn((_encoder: TextEncoder, payload: unknown) => payload),
}))

jest.mock('@/lib/services/chat-message/memory-trigger.service', () => ({
  triggerTurnMemoryExtraction: jest.fn().mockResolvedValue(undefined),
  triggerContextSummaryCheck: jest.fn().mockResolvedValue(undefined),
  triggerChatDangerClassification: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/services/token-tracking.service', () => ({
  trackMessageTokenUsage: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn().mockResolvedValue({ cost: 0.12, source: 'pricing-table' }),
}))

jest.mock('@/lib/services/chat-message/compression-cache.service', () => ({
  triggerAsyncCompression: jest.fn(),
}))

jest.mock('@/lib/services/chat-message/rng-pattern-detector.service', () => ({
  detectAndConvertRngPatterns: jest.fn().mockReturnValue([]),
}))

jest.mock('@/lib/tools/handlers/rng-handler', () => ({
  executeRngTool: jest.fn(),
  formatRngResults: jest.fn((result: { summary?: string }) => result.summary ?? 'rng-result'),
}))

jest.mock('@/lib/chat/turn-manager', () => ({
  calculateTurnStateFromHistory: jest.fn().mockReturnValue({
    lastSpeakerId: 'participant-1',
    turnsSinceUser: 1,
    participantTurnCounts: new Map(),
  }),
  selectNextSpeaker: jest.fn().mockReturnValue({
    nextSpeakerId: 'participant-2',
    reason: 'round_robin',
    cycleComplete: false,
  }),
  getActiveCharacterParticipants: jest.fn((participants: unknown[]) => participants),
}))

const createMockRepos = () => ({
  chats: {
    addMessage: jest.fn().mockResolvedValue(undefined),
    getMessages: jest.fn().mockResolvedValue([
      { type: 'message', role: 'USER', content: 'Hello there' },
      { type: 'message', role: 'ASSISTANT', content: 'Previous reply', participantId: 'participant-1' },
    ]),
    update: jest.fn().mockResolvedValue(undefined),
  },
  files: {
    addLink: jest.fn().mockResolvedValue(undefined),
  },
  characters: {
    findById: jest.fn().mockResolvedValue({ id: 'char-2', name: 'Bob', pronouns: null }),
  },
})

describe('message-finalizer.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('saveAssistantMessage persists the assistant message, tool messages, and image links', async () => {
    const repos = createMockRepos()

    const messageId = await saveAssistantMessage(
      repos as any,
      'chat-1',
      { id: 'char-1', name: 'Alice' },
      { id: 'participant-1', status: 'active' },
      'Final response',
      { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      { raw: true },
      'thought-1',
      [{ id: 'img-1', filename: 'img.png', filepath: '/tmp/img.png', mimeType: 'image/png', size: 100 }],
      [{ toolName: 'search', success: true, content: 'Found result' }],
      'assistant-1',
      'OPENAI',
      'gpt-4.1'
    )

    expect(messageId).toBe('assistant-1')
    expect(repos.chats.addMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        id: 'assistant-1',
        role: 'ASSISTANT',
        content: 'Final response',
        provider: 'OPENAI',
        modelName: 'gpt-4.1',
      })
    )
    expect(toolExecution.saveToolMessages).toHaveBeenCalled()
    expect(repos.files.addLink).toHaveBeenCalledWith('img-1', 'assistant-1')
  })

  it('finalizeMessageResponse saves the cleaned response, emits the done event, and triggers background work', async () => {
    const repos = createMockRepos()
    const controller = { enqueue: jest.fn() } as any
    const encoder = new TextEncoder()

    const result = await finalizeMessageResponse({
      repos: repos as any,
      chatId: 'chat-1',
      userId: 'user-1',
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'participant-1', characterId: 'char-1', type: 'CHARACTER', controlledBy: 'llm', status: 'active' },
        ],
        isDangerousChat: false,
      } as any,
      character: { id: 'char-1', name: 'Alice', aliases: ['Al'], pronouns: null } as any,
      characterParticipant: { id: 'participant-1', status: 'active' } as any,
      userParticipantId: null,
      isMultiCharacter: false,
      isContinueMode: false,
      generatedImagePaths: [],
      toolMessages: [],
      preGeneratedAssistantMessageId: 'assistant-2',
      connectionProfile: { id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-4.1' } as any,
      controller,
      encoder,
      streaming: {
        fullResponse: 'BLOCK:Alice: Hello from Alice',
        effectiveProfile: { id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-4.1' } as any,
        effectiveApiKey: 'sk-test',
        usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
        cacheUsage: { cacheCreationInputTokens: 2, cacheReadInputTokens: 3 },
        attachmentResults: { sent: [], failed: [] },
        rawResponse: { provider: 'raw' },
        thoughtSignature: 'thought-1',
        hasStartedStreaming: true,
      },
      compression: {
        existingMessages: [],
        content: 'Hello there',
        builtContext: { originalSystemPrompt: 'System prompt' } as any,
        compressionEnabled: true,
        cheapLLMSelection: { provider: 'OPENAI', modelName: 'gpt-4.1-mini', isLocal: false } as any,
        contextCompressionSettings: {
          enabled: true,
          windowSize: 5,
          compressionTargetTokens: 800,
          systemPromptTargetTokens: 1500,
          projectContextReinjectInterval: 5,
        },
        allProfiles: [],
      },
      triggers: {
        dangerSettings: { mode: 'OFF' } as any,
        chatSettings: {
          cheapLLMSettings: { strategy: 'USER_DEFINED' },
          autoDetectRng: false,
        } as any,
        participantCharacters: new Map([['char-1', { id: 'char-1', name: 'Alice', pronouns: null }]]),
        resolvedIdentity: { name: 'Narrator', description: 'desc', characterId: null },
        userCharacterId: undefined,
      },
    })

    expect(result).toEqual(expect.objectContaining({
      hasContent: true,
      messageId: 'assistant-2',
      isMultiCharacter: false,
    }))
    expect(result.sceneTrackingContext).toBeDefined()
    expect(tokenTracking.trackMessageTokenUsage).toHaveBeenCalledWith(
      'chat-1',
      'profile-1',
      { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
      0.12,
      'pricing-table'
    )
    expect(compressionCache.triggerAsyncCompression).toHaveBeenCalled()
    expect(streaming.encodeDoneEvent).toHaveBeenCalled()
    expect(controller.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'assistant-2',
      provider: 'OPENAI',
      modelName: 'gpt-4.1',
    }))
    // Per-turn extraction fires only when the turn closes (next speaker is the user).
    // The default selectNextSpeaker mock returns participant-2, so isUsersTurn is false
    // and the extraction trigger should NOT fire on this finalize.
    expect(memoryTriggers.triggerTurnMemoryExtraction).not.toHaveBeenCalled()
    expect(memoryTriggers.triggerContextSummaryCheck).toHaveBeenCalled()
    expect(memoryTriggers.triggerChatDangerClassification).toHaveBeenCalled()
  })

  it('finalizeMessageResponse fires per-turn memory extraction only when control returns to the user', async () => {
    const turnManager = jest.requireMock('@/lib/chat/turn-manager') as {
      selectNextSpeaker: jest.Mock
    }
    turnManager.selectNextSpeaker.mockReturnValueOnce({
      nextSpeakerId: null,
      reason: 'user-turn',
      cycleComplete: true,
    })

    const repos = createMockRepos()
    const controller = { enqueue: jest.fn() } as any
    const encoder = new TextEncoder()

    await finalizeMessageResponse({
      repos: repos as any,
      chatId: 'chat-1',
      userId: 'user-1',
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'participant-1', characterId: 'char-1', type: 'CHARACTER', controlledBy: 'llm', status: 'active' },
        ],
        isDangerousChat: false,
      } as any,
      character: { id: 'char-1', name: 'Alice', aliases: ['Al'], pronouns: null } as any,
      characterParticipant: { id: 'participant-1', status: 'active' } as any,
      userParticipantId: null,
      isMultiCharacter: false,
      isContinueMode: false,
      generatedImagePaths: [],
      toolMessages: [],
      preGeneratedAssistantMessageId: 'assistant-3',
      connectionProfile: { id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-4.1' } as any,
      controller,
      encoder,
      streaming: {
        fullResponse: 'BLOCK:Alice: closing line',
        effectiveProfile: { id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-4.1' } as any,
        effectiveApiKey: 'sk-test',
        usage: null,
        cacheUsage: null,
        attachmentResults: null,
        rawResponse: { provider: 'raw' },
        thoughtSignature: undefined,
        hasStartedStreaming: true,
      },
      compression: {
        existingMessages: [],
        content: 'hello',
        builtContext: { originalSystemPrompt: 'System prompt' } as any,
        compressionEnabled: false,
        cheapLLMSelection: null,
        contextCompressionSettings: {
          enabled: true,
          windowSize: 5,
          compressionTargetTokens: 800,
          systemPromptTargetTokens: 1500,
          projectContextReinjectInterval: 5,
        },
        allProfiles: [],
      },
      triggers: {
        dangerSettings: { mode: 'OFF' } as any,
        chatSettings: {
          cheapLLMSettings: { strategy: 'USER_DEFINED' },
          autoDetectRng: false,
        } as any,
        participantCharacters: new Map([['char-1', { id: 'char-1', name: 'Alice', pronouns: null }]]),
        resolvedIdentity: { name: 'Narrator', description: 'desc', characterId: null },
        userCharacterId: undefined,
      },
    })

    expect(memoryTriggers.triggerTurnMemoryExtraction).toHaveBeenCalled()
  })

  it('finalizeMessageResponse runs multi-character memory hooks and assistant RNG auto-detection', async () => {
    const repos = createMockRepos()
    const controller = { enqueue: jest.fn() } as any
    const encoder = new TextEncoder()

    ;(rngDetector.detectAndConvertRngPatterns as jest.Mock).mockReturnValue([
      { type: 'dice', rolls: '1d20', matchText: 'roll 1d20' },
    ])
    ;(rngHandler.executeRngTool as jest.Mock).mockResolvedValue({ success: true, summary: 'Rolled 12' })

    await finalizeMessageResponse({
      repos: repos as any,
      chatId: 'chat-1',
      userId: 'user-1',
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'participant-1', characterId: 'char-1', type: 'CHARACTER', controlledBy: 'llm', status: 'active' },
          { id: 'participant-2', characterId: 'char-2', type: 'CHARACTER', controlledBy: 'user', status: 'active' },
        ],
        activeTypingParticipantId: 'participant-2',
        isDangerousChat: false,
      } as any,
      character: { id: 'char-1', name: 'Alice', aliases: [], pronouns: null } as any,
      characterParticipant: { id: 'participant-1', status: 'active' } as any,
      userParticipantId: 'participant-2',
      isMultiCharacter: true,
      isContinueMode: false,
      generatedImagePaths: [],
      toolMessages: [],
      connectionProfile: { id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-4.1' } as any,
      controller,
      encoder,
      streaming: {
        fullResponse: 'Please roll 1d20',
        effectiveProfile: { id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-4.1' } as any,
        effectiveApiKey: 'sk-test',
        usage: null,
        cacheUsage: null,
        attachmentResults: null,
        rawResponse: { provider: 'raw' },
        thoughtSignature: undefined,
        hasStartedStreaming: true,
      },
      compression: {
        existingMessages: [
          { type: 'message', role: 'ASSISTANT', content: 'Hi', participantId: 'participant-2' },
        ] as any,
        content: 'hello',
        builtContext: { originalSystemPrompt: 'System prompt' } as any,
        compressionEnabled: false,
        cheapLLMSelection: null,
        contextCompressionSettings: {
          enabled: true,
          windowSize: 5,
          compressionTargetTokens: 800,
          systemPromptTargetTokens: 1500,
          projectContextReinjectInterval: 5,
        },
        allProfiles: [],
      },
      triggers: {
        dangerSettings: { mode: 'OFF' } as any,
        chatSettings: {
          cheapLLMSettings: { strategy: 'USER_DEFINED' },
          autoDetectRng: true,
        } as any,
        participantCharacters: new Map([
          ['char-1', { id: 'char-1', name: 'Alice', pronouns: null }],
          ['char-2', { id: 'char-2', name: 'Bob', pronouns: null }],
        ]),
        resolvedIdentity: { name: 'User', description: 'desc', characterId: 'char-2' },
        userCharacterId: 'char-2',
      },
    })

    expect(rngHandler.executeRngTool).toHaveBeenCalled()
  })
})
