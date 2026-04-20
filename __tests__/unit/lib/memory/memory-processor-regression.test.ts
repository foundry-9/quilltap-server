import { beforeEach, describe, expect, it, jest } from '@jest/globals'


jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  resolveUncensoredCheapLLMSelection: jest.fn((selection: unknown) => selection),
}))

jest.mock('@/lib/llm/model-context-data', () => ({
  resolveMaxTokens: jest.fn(),
}))

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  extractMemoryFromMessage: jest.fn(),
  extractCharacterMemoryFromMessage: jest.fn(),
  extractInterCharacterMemoryFromMessage: jest.fn(),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  createMemoryWithGate: jest.fn(),
}))

const { getCheapLLMProvider, resolveUncensoredCheapLLMSelection } = jest.requireMock('@/lib/llm/cheap-llm') as {
  getCheapLLMProvider: jest.Mock
  resolveUncensoredCheapLLMSelection: jest.Mock
}
const { resolveMaxTokens } = jest.requireMock('@/lib/llm/model-context-data') as {
  resolveMaxTokens: jest.Mock
}
const { extractMemoryFromMessage, extractCharacterMemoryFromMessage } = jest.requireMock('@/lib/memory/cheap-llm-tasks') as {
  extractMemoryFromMessage: jest.Mock
  extractCharacterMemoryFromMessage: jest.Mock
}
const { createMemoryWithGate } = jest.requireMock('@/lib/memory/memory-service') as {
  createMemoryWithGate: jest.Mock
}

const mockGetCheapLLMProvider = getCheapLLMProvider
const mockResolveUncensoredCheapLLMSelection = resolveUncensoredCheapLLMSelection
const mockResolveMaxTokens = resolveMaxTokens
const mockExtractMemoryFromMessage = extractMemoryFromMessage
const mockExtractCharacterMemoryFromMessage = extractCharacterMemoryFromMessage
const mockCreateMemoryWithGate = createMemoryWithGate

const baseContext = {
  characterId: 'char-1',
  characterName: 'Avery',
  chatId: 'chat-1',
  userMessage: 'I keep my grandmother\'s compass in my satchel and I am afraid of thunderstorms.',
  assistantMessage: 'I\'ll remember the compass, and I can stay with you when storms roll in.',
  sourceMessageId: 'msg-1',
  sourceMessageTimestamp: '2026-04-01T12:34:56.000Z',
  userId: 'user-1',
  connectionProfile: {
    id: 'profile-1',
    provider: 'OPENAI',
    modelName: 'gpt-4o-mini',
  },
  cheapLLMSettings: {
    strategy: 'PROVIDER_CHEAPEST',
    fallbackToLocal: true,
  },
  availableProfiles: [],
} as any

describe('processMessageForMemory regressions', () => {
  let processMessageForMemory: (ctx: unknown) => Promise<any>

  beforeEach(async () => {
    jest.clearAllMocks()

    mockGetCheapLLMProvider.mockReturnValue({
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
      connectionProfileId: 'profile-1',
      isLocal: false,
    } as any)
    mockResolveUncensoredCheapLLMSelection.mockImplementation((selection: unknown) => selection as any)
    mockResolveMaxTokens.mockReturnValue(2048)
    mockExtractMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)
    mockExtractCharacterMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)
    mockCreateMemoryWithGate.mockResolvedValue({
      action: 'INSERT',
      memory: { id: 'mem-default' },
    } as any)

    ;({ processMessageForMemory } = await import('@/lib/memory/memory-processor'))
  })

  it('creates one memory per extracted fact and aggregates usage totals', async () => {
    mockExtractMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [
        {
          significant: true,
          content: 'The user keeps their grandmother\'s compass in a satchel.',
          summary: 'User carries grandmother\'s compass',
          keywords: ['compass', 'satchel'],
          importance: 0.8,
        },
        {
          significant: true,
          content: 'The user is afraid of thunderstorms.',
          summary: 'User fears thunderstorms',
          keywords: ['storms', 'fear'],
          importance: 0.7,
        },
      ],
      usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
    } as any)
    mockExtractCharacterMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [
        {
          significant: true,
          content: 'Avery promised to stay close during storms.',
          summary: 'Avery comforts the user during storms',
          keywords: ['comfort', 'storms'],
          importance: 0.6,
        },
      ],
      usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 },
    } as any)

    mockCreateMemoryWithGate
      .mockResolvedValueOnce({ action: 'INSERT', memory: { id: 'mem-1' } } as any)
      .mockResolvedValueOnce({ action: 'INSERT_RELATED', memory: { id: 'mem-2' }, relatedMemoryIds: ['mem-1'] } as any)
      .mockResolvedValueOnce({ action: 'REINFORCE', memory: { id: 'mem-3', reinforcementCount: 2 }, novelDetails: ['comfort during storms'] } as any)

    const result = await processMessageForMemory(baseContext)

    expect(mockCreateMemoryWithGate).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      success: true,
      memoryCreated: true,
      memoryReinforced: true,
      memoryIds: ['mem-1', 'mem-2'],
      reinforcedMemoryIds: ['mem-3'],
      relatedMemoryIds: ['mem-1'],
      usage: {
        promptTokens: 21,
        completionTokens: 7,
        totalTokens: 28,
      },
    })

    const firstExtractArgs = mockExtractMemoryFromMessage.mock.calls[0]
    expect(firstExtractArgs?.[10]).toBe(2048)
  })

  it('preserves the source message timestamp when creating memories', async () => {
    mockExtractMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [
        {
          significant: true,
          content: 'The user treasures the old compass.',
          summary: 'User treasures a family compass',
          keywords: ['compass'],
          importance: 0.75,
        },
      ],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    } as any)

    const result = await processMessageForMemory(baseContext)

    expect(result.success).toBe(true)
    expect(mockCreateMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMessageId: 'msg-1',
        sourceMessageTimestamp: '2026-04-01T12:34:56.000Z',
      }),
      { userId: 'user-1' }
    )
  })

  it('SKIP_NEAR_DUPLICATE does not add an ID to memoryIds or reinforcedMemoryIds', async () => {
    mockExtractMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [
        {
          significant: true,
          content: 'User carries the compass everywhere.',
          summary: 'User carries compass',
          keywords: ['compass'],
          importance: 0.7,
        },
      ],
      usage: { promptTokens: 4, completionTokens: 1, totalTokens: 5 },
    } as any)
    mockCreateMemoryWithGate.mockReset()
    mockCreateMemoryWithGate
      .mockResolvedValueOnce({
        action: 'SKIP_NEAR_DUPLICATE',
        memory: { id: 'mem-existing', reinforcementCount: 5 },
        similarity: 0.95,
      } as any)

    const result = await processMessageForMemory(baseContext)

    expect(result.success).toBe(true)
    expect(result.memoryIds).toEqual([])
    expect(result.reinforcedMemoryIds).toEqual([])
    expect(result.memoryCreated).toBe(false)
    expect(result.memoryReinforced).toBe(false)
    expect(result.debugLogs?.join('\n')).toContain('SKIPPED near-duplicate')
  })

  it('SKIP_EMBEDDING_FAILED does not add an ID and surfaces the failure in debug logs', async () => {
    mockExtractMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [
        {
          significant: true,
          content: 'User likes jazz.',
          summary: 'User likes jazz',
          keywords: ['jazz'],
          importance: 0.6,
        },
      ],
      usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
    } as any)
    mockCreateMemoryWithGate.mockReset()
    mockCreateMemoryWithGate
      .mockResolvedValueOnce({
        action: 'SKIP_EMBEDDING_FAILED',
        memory: null,
        reason: 'Embedding failed after retry: ECONNREFUSED',
      } as any)

    const result = await processMessageForMemory(baseContext)

    expect(result.success).toBe(true)
    expect(result.memoryIds).toEqual([])
    expect(result.reinforcedMemoryIds).toEqual([])
    expect(result.memoryCreated).toBe(false)
    expect(result.debugLogs?.join('\n')).toContain('embedding generation failed after retry')
  })
})
