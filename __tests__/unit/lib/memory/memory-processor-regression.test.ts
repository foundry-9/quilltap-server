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

// Pulled in transitively by memory-processor for the no-user-character whisper.
// Mock at the module level so we don't drag in the entire host-notifications
// stack (which depends on the database, repositories, etc.).
jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostNoUserCharacterAnnouncement: jest.fn().mockResolvedValue(null),
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
  // User-controlled character must be set so the user-memory extraction pass
  // is allowed to fire; without it the pipeline now skips that pass entirely
  // (and the regression test scenarios exercise both passes).
  userCharacterId: 'user-char-1',
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

  it('rate limit: skips extraction entirely when recent count >= maxPerHour', async () => {
    const mockCountCreatedSince = jest.fn<any>().mockResolvedValue(25)

    const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
      getRepositories: jest.Mock
    }
    repositoriesMock.getRepositories.mockReturnValue({
      memories: { countCreatedSince: mockCountCreatedSince },
    })

    const result = await processMessageForMemory({
      ...baseContext,
      memoryExtractionLimits: {
        enabled: true,
        maxPerHour: 20,
        softStartFraction: 0.7,
        softFloor: 0.7,
      },
    })

    expect(result.success).toBe(true)
    expect(result.memoryCreated).toBe(false)
    expect(result.memoryIds).toEqual([])
    expect(mockExtractMemoryFromMessage).not.toHaveBeenCalled()
    expect(result.debugLogs?.join('\n')).toContain('rate limit reached')
  })

  it('rate limit: in soft band, drops candidates below the floor', async () => {
    const mockCountCreatedSince = jest.fn<any>().mockResolvedValue(15) // 75% of 20 = 15 > softStart(14)

    const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
      getRepositories: jest.Mock
    }
    repositoriesMock.getRepositories.mockReturnValue({
      memories: { countCreatedSince: mockCountCreatedSince },
    })

    // Three candidates: two below floor, one above
    mockExtractMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'low', summary: 'low', keywords: [], importance: 0.5 },
        { significant: true, content: 'alsoLow', summary: 'alsoLow', keywords: [], importance: 0.6 },
        { significant: true, content: 'high', summary: 'high', keywords: [], importance: 0.8 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)
    mockCreateMemoryWithGate.mockReset()
    mockCreateMemoryWithGate.mockResolvedValue({ action: 'INSERT', memory: { id: 'mem-high' } } as any)

    const result = await processMessageForMemory({
      ...baseContext,
      memoryExtractionLimits: {
        enabled: true,
        maxPerHour: 20,
        softStartFraction: 0.7,
        softFloor: 0.7,
      },
    })

    expect(result.success).toBe(true)
    // Only the single high-importance candidate should have been forwarded to createMemoryWithGate
    // (across user + character passes, so expect at most 2 calls — one per pass)
    const insertCalls = mockCreateMemoryWithGate.mock.calls.length
    expect(insertCalls).toBeLessThanOrEqual(2)
    expect(result.debugLogs?.join('\n')).toContain('Throttle dropped')
    expect(result.debugLogs?.join('\n')).toContain('importance floor raised to 0.7')
  })

  it('rate limit: disabled is a no-op', async () => {
    mockExtractMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'fact', summary: 'fact', keywords: [], importance: 0.4 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    const result = await processMessageForMemory({
      ...baseContext,
      memoryExtractionLimits: {
        enabled: false,
        maxPerHour: 1, // deliberately tiny; disabled=false means it shouldn't matter
        softStartFraction: 0.7,
        softFloor: 0.7,
      },
    })

    expect(result.success).toBe(true)
    // Extraction proceeded (createMemoryWithGate got called) even though "maxPerHour" is 1
    expect(mockCreateMemoryWithGate).toHaveBeenCalled()
  })

  it('skips USER memory extraction when no user-controlled character is attached', async () => {
    // userCharacterId omitted → user-memory extraction must be bypassed entirely;
    // only the character (self) extraction pass is allowed to fire.
    const ctxNoUser = {
      ...baseContext,
      userCharacterId: undefined,
    }
    mockExtractCharacterMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'Avery feels protective.', summary: 'Avery is protective', keywords: [], importance: 0.6 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    const result = await processMessageForMemory(ctxNoUser)

    expect(result.success).toBe(true)
    expect(mockExtractMemoryFromMessage).not.toHaveBeenCalled()
    expect(mockExtractCharacterMemoryFromMessage).toHaveBeenCalledTimes(1)
    expect(result.debugLogs?.join('\n')).toContain('Skipped USER memory extraction')
    // Self-memory pass goes through createMemoryWithGate with aboutCharacterId === characterId
    expect(mockCreateMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        aboutCharacterId: 'char-1',
      }),
      { userId: 'user-1' },
    )
  })

  it('character (self) extraction pass writes aboutCharacterId = characterId, not the user', async () => {
    mockExtractMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)
    mockExtractCharacterMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'Avery is steady in storms.', summary: 'Avery is steady', keywords: [], importance: 0.7 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    await processMessageForMemory(baseContext)

    // The self-memory pass is what we changed — verify it now passes
    // aboutCharacterId === characterId (self-reference) rather than the
    // userCharacterId fallback the legacy helper used.
    expect(mockCreateMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        aboutCharacterId: 'char-1',
      }),
      { userId: 'user-1' },
    )
  })

  it('user extraction pass writes aboutCharacterId = userCharacterId', async () => {
    mockExtractMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'User likes jazz.', summary: 'User likes jazz', keywords: ['jazz'], importance: 0.6 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)
    mockExtractCharacterMemoryFromMessage.mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)

    await processMessageForMemory(baseContext)

    expect(mockCreateMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        aboutCharacterId: 'user-char-1',
      }),
      { userId: 'user-1' },
    )
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
