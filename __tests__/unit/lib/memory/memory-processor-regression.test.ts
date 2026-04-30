/**
 * Regression tests for the per-turn memory processor.
 *
 * Covers the gate-handling surface area the prior per-message regression
 * suite did, but updated to the new transcript-shaped extractors:
 *   - Multiple extracted candidates → multiple memory writes
 *   - sourceMessageTimestamp preservation
 *   - Rate-limit skip and throttle modes
 *   - SKIP_NEAR_DUPLICATE / SKIP_EMBEDDING_FAILED don't add IDs
 *   - User-pass writes aboutCharacterId = userCharacterId
 *   - Self-pass writes aboutCharacterId = characterId
 *   - Inter-character pass writes aboutCharacterId = subject
 */

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
  extractUserMemoriesFromTurn: jest.fn(),
  extractSelfMemoriesFromTurn: jest.fn(),
  extractInterCharacterMemoriesFromTurn: jest.fn(),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  createMemoryWithGate: jest.fn(),
}))

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
const tasks = jest.requireMock('@/lib/memory/cheap-llm-tasks') as {
  extractUserMemoriesFromTurn: jest.Mock
  extractSelfMemoriesFromTurn: jest.Mock
  extractInterCharacterMemoriesFromTurn: jest.Mock
}
const { createMemoryWithGate } = jest.requireMock('@/lib/memory/memory-service') as {
  createMemoryWithGate: jest.Mock
}

function makeTranscript(extra: {
  userMessage?: string | null
  userCharacterId?: string | null
  characterSlices?: Array<{
    characterId: string
    characterName: string
    text: string
  }>
} = {}) {
  return {
    transcript: {
      turnOpenerMessageId: 'opener-1',
      userMessage: 'userMessage' in extra ? extra.userMessage : 'I keep my grandmother\'s compass in my satchel.',
      userCharacterId: 'userCharacterId' in extra ? (extra.userCharacterId ?? undefined) : 'user-char-1',
      userCharacterName: 'Bob',
      userCharacterPronouns: null,
      characterSlices: (extra.characterSlices ?? [
        { characterId: 'char-1', characterName: 'Avery', text: 'I\'ll remember the compass.' },
      ]).map(s => ({
        ...s,
        characterPronouns: null,
        contributingMessageIds: [`assistant-${s.characterId}`],
      })),
      latestAssistantMessageId: `assistant-${(extra.characterSlices?.[0]?.characterId) ?? 'char-1'}`,
    },
    chatId: 'chat-1',
    userId: 'user-1',
    sourceMessageTimestamp: '2026-04-01T12:34:56.000Z',
    connectionProfile: {
      id: 'profile-1',
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
    } as any,
    cheapLLMSettings: {
      strategy: 'PROVIDER_CHEAPEST',
      fallbackToLocal: true,
    } as any,
    availableProfiles: [],
  }
}

describe('processTurnForMemory regressions', () => {
  let processTurnForMemory: (ctx: unknown) => Promise<any>

  beforeEach(async () => {
    jest.clearAllMocks()

    getCheapLLMProvider.mockReturnValue({
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
      connectionProfileId: 'profile-1',
      isLocal: false,
    } as any)
    resolveUncensoredCheapLLMSelection.mockImplementation((selection: unknown) => selection as any)
    resolveMaxTokens.mockReturnValue(2048)
    tasks.extractUserMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)
    tasks.extractInterCharacterMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)
    createMemoryWithGate.mockResolvedValue({
      action: 'INSERT',
      memory: { id: 'mem-default' },
    } as any)

    ;({ processTurnForMemory } = await import('@/lib/memory/memory-processor'))
  })

  it('aggregates token usage and writes one memory per gated candidate', async () => {
    tasks.extractUserMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'compass fact', summary: 'compass', keywords: ['compass'], importance: 0.8 },
        { significant: true, content: 'storm fear', summary: 'storms', keywords: ['storms'], importance: 0.7 },
      ],
      usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
    } as any)
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'Avery is steady', summary: 'steady', keywords: [], importance: 0.6 },
      ],
      usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 },
    } as any)

    createMemoryWithGate
      .mockResolvedValueOnce({ action: 'INSERT', memory: { id: 'mem-1' } } as any)
      .mockResolvedValueOnce({ action: 'INSERT_RELATED', memory: { id: 'mem-2' }, relatedMemoryIds: ['mem-1'] } as any)
      .mockResolvedValueOnce({ action: 'REINFORCE', memory: { id: 'mem-3', reinforcementCount: 2 } } as any)

    const result = await processTurnForMemory(makeTranscript())

    expect(createMemoryWithGate).toHaveBeenCalledTimes(3)
    expect(result.success).toBe(true)
    expect(result.createdMemoryIds).toEqual(['mem-1', 'mem-2'])
    expect(result.reinforcedMemoryIds).toEqual(['mem-3'])
    expect(result.usage).toEqual({ promptTokens: 21, completionTokens: 7, totalTokens: 28 })
  })

  it('preserves the source message timestamp', async () => {
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'Avery is steady', summary: 'steady', keywords: [], importance: 0.7 },
      ],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)

    await processTurnForMemory(makeTranscript())

    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMessageTimestamp: '2026-04-01T12:34:56.000Z',
      }),
      { userId: 'user-1' },
    )
  })

  it('SKIP_NEAR_DUPLICATE keeps the result clean', async () => {
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'fact', summary: 'fact', keywords: [], importance: 0.7 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)
    createMemoryWithGate.mockReset()
    createMemoryWithGate.mockResolvedValueOnce({
      action: 'SKIP_NEAR_DUPLICATE',
      memory: { id: 'mem-existing', reinforcementCount: 5 },
      similarity: 0.95,
    } as any)

    const result = await processTurnForMemory(makeTranscript())

    expect(result.success).toBe(true)
    expect(result.createdMemoryIds).toEqual([])
    expect(result.reinforcedMemoryIds).toEqual([])
    expect(result.debugLogs.join('\n')).toContain('SKIPPED near-duplicate')
  })

  it('SKIP_EMBEDDING_FAILED keeps the result clean and surfaces the reason in debug logs', async () => {
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'fact', summary: 'fact', keywords: [], importance: 0.7 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)
    createMemoryWithGate.mockReset()
    createMemoryWithGate.mockResolvedValueOnce({
      action: 'SKIP_EMBEDDING_FAILED',
      memory: null,
      reason: 'Embedding failed after retry: ECONNREFUSED',
    } as any)

    const result = await processTurnForMemory(makeTranscript())

    expect(result.success).toBe(true)
    expect(result.createdMemoryIds).toEqual([])
    expect(result.debugLogs.join('\n')).toContain('embedding generation failed')
  })

  it('rate limit: skips a character entirely when its recent count >= maxPerHour', async () => {
    const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
      getRepositories: jest.Mock
    }
    repositoriesMock.getRepositories.mockReturnValue({
      memories: { countCreatedSince: jest.fn<any>().mockResolvedValue(25) },
    })

    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'fact', summary: 'fact', keywords: [], importance: 0.7 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    const ctx = makeTranscript()
    const result = await processTurnForMemory({
      ...ctx,
      memoryExtractionLimits: {
        enabled: true,
        maxPerHour: 20,
        softStartFraction: 0.7,
        softFloor: 0.7,
      },
    })

    expect(result.success).toBe(true)
    expect(tasks.extractSelfMemoriesFromTurn).not.toHaveBeenCalled()
    expect(tasks.extractUserMemoriesFromTurn).not.toHaveBeenCalled()
    expect(result.debugLogs.join('\n')).toContain('rate limit reached')
  })

  it('rate limit: in soft band, drops candidates below the floor', async () => {
    const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
      getRepositories: jest.Mock
    }
    repositoriesMock.getRepositories.mockReturnValue({
      memories: { countCreatedSince: jest.fn<any>().mockResolvedValue(15) },
    })

    tasks.extractUserMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'low', summary: 'low', keywords: [], importance: 0.5 },
        { significant: true, content: 'alsoLow', summary: 'alsoLow', keywords: [], importance: 0.6 },
        { significant: true, content: 'high', summary: 'high', keywords: [], importance: 0.8 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    const ctx = makeTranscript()
    const result = await processTurnForMemory({
      ...ctx,
      memoryExtractionLimits: {
        enabled: true,
        maxPerHour: 20,
        softStartFraction: 0.7,
        softFloor: 0.7,
      },
    })

    expect(result.success).toBe(true)
    expect(result.debugLogs.join('\n')).toContain('Throttle dropped')
    expect(result.debugLogs.join('\n')).toContain('floor 0.7')
  })

  it('skips USER memory extraction when no user-controlled character is attached', async () => {
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'Avery feels protective.', summary: 'Avery is protective', keywords: [], importance: 0.6 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    const ctx = makeTranscript({ userCharacterId: undefined })

    const result = await processTurnForMemory(ctx)

    expect(result.success).toBe(true)
    expect(tasks.extractUserMemoriesFromTurn).not.toHaveBeenCalled()
    expect(tasks.extractSelfMemoriesFromTurn).toHaveBeenCalledTimes(1)
    expect(result.debugLogs.join('\n')).toContain('Skipped USER memory pass')
    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        aboutCharacterId: 'char-1',
      }),
      { userId: 'user-1' },
    )
  })

  it('user-pass writes aboutCharacterId = userCharacterId for every participating character', async () => {
    tasks.extractUserMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'User likes jazz.', summary: 'jazz', keywords: ['jazz'], importance: 0.6 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    await processTurnForMemory(makeTranscript())

    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        aboutCharacterId: 'user-char-1',
      }),
      { userId: 'user-1' },
    )
  })

  it('inter-character pass fires per (observer, subject) pair when 2+ characters spoke in the turn', async () => {
    tasks.extractInterCharacterMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [
        { significant: true, content: 'Other character is calm', summary: 'calm', keywords: [], importance: 0.6 },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as any)

    const ctx = makeTranscript({
      characterSlices: [
        { characterId: 'char-1', characterName: 'Avery', text: 'Avery speaks.' },
        { characterId: 'char-2', characterName: 'Beatrice', text: 'Beatrice replies.' },
      ],
    })

    await processTurnForMemory(ctx)

    // 2 characters → 2 (observer, subject) ordered pairs.
    expect(tasks.extractInterCharacterMemoriesFromTurn).toHaveBeenCalledTimes(2)
    // Each pair invokes the gate with characterId=observer, aboutCharacterId=subject.
    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-1', aboutCharacterId: 'char-2' }),
      { userId: 'user-1' },
    )
    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-2', aboutCharacterId: 'char-1' }),
      { userId: 'user-1' },
    )
  })
})
