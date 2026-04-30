/**
 * Unit tests for the per-turn memory processor.
 *
 * The processor itself is exercised end-to-end via the
 * memory-extraction-handler tests; here we just type-check the public
 * shapes and verify the module barrel exports the expected functions.
 */

import { describe, it, expect } from '@jest/globals'
import type { ConnectionProfile, CheapLLMSettings } from '@/lib/schemas/types'
import type {
  TurnMemoryExtractionContext,
  TurnMemoryProcessingResult,
} from '@/lib/memory/memory-processor'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'

const testConnectionProfile: ConnectionProfile = {
  id: 'test-profile-id',
  userId: 'test-user-id',
  name: 'Test Profile',
  provider: 'OPENAI',
  modelName: 'gpt-4o',
  baseUrl: null,
  apiKeyId: 'test-api-key-id',
  parameters: {},
  isDefault: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

const testCheapLLMSettings: CheapLLMSettings = {
  strategy: 'PROVIDER_CHEAPEST',
  fallbackToLocal: true,
  embeddingProvider: 'OPENAI',
}

const transcriptFixture: TurnTranscript = {
  turnOpenerMessageId: 'opener-1',
  userMessage: 'I love hiking',
  userCharacterId: 'user-char',
  userCharacterName: 'Bob',
  userCharacterPronouns: null,
  characterSlices: [{
    characterId: 'char-luna',
    characterName: 'Luna',
    characterPronouns: null,
    text: 'That sounds great!',
    contributingMessageIds: ['assistant-1'],
  }],
  latestAssistantMessageId: 'assistant-1',
}

describe('Memory Processor (per-turn) Types', () => {
  it('TurnMemoryExtractionContext accepts the minimal field set', () => {
    const ctx: TurnMemoryExtractionContext = {
      transcript: transcriptFixture,
      chatId: 'chat-456',
      userId: 'user-001',
      connectionProfile: testConnectionProfile,
      cheapLLMSettings: testCheapLLMSettings,
    }

    expect(ctx.transcript.userMessage).toBe('I love hiking')
    expect(ctx.transcript.characterSlices).toHaveLength(1)
  })

  it('TurnMemoryExtractionContext accepts danger / rate-limit fields', () => {
    const ctx: TurnMemoryExtractionContext = {
      transcript: transcriptFixture,
      chatId: 'chat-456',
      userId: 'user-001',
      connectionProfile: testConnectionProfile,
      cheapLLMSettings: testCheapLLMSettings,
      isDangerousChat: true,
      memoryExtractionLimits: {
        enabled: true,
        maxPerHour: 50,
        softStartFraction: 0.7,
        softFloor: 0.5,
      },
    }

    expect(ctx.isDangerousChat).toBe(true)
    expect(ctx.memoryExtractionLimits?.enabled).toBe(true)
  })

  it('TurnMemoryProcessingResult shape covers success and failure', () => {
    const success: TurnMemoryProcessingResult = {
      success: true,
      memoriesCreatedCount: 2,
      memoriesReinforcedCount: 1,
      createdMemoryIds: ['m1', 'm2'],
      reinforcedMemoryIds: ['m3'],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      sourceMessageId: 'assistant-1',
      debugLogs: ['log line'],
    }

    const failure: TurnMemoryProcessingResult = {
      success: false,
      memoriesCreatedCount: 0,
      memoriesReinforcedCount: 0,
      createdMemoryIds: [],
      reinforcedMemoryIds: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      sourceMessageId: null,
      debugLogs: [],
      error: 'rate limit exceeded',
    }

    expect(success.memoriesCreatedCount).toBe(2)
    expect(failure.error).toBe('rate limit exceeded')
  })
})

describe('Memory Module Barrel Exports', () => {
  it('exports the per-turn processor entry point', async () => {
    const memoryProcessor = await import('@/lib/memory/memory-processor')
    expect(typeof memoryProcessor.processTurnForMemory).toBe('function')
  })

  it('re-exports the per-turn processor and transcript-shaped extractors from the memory index', async () => {
    const memoryModule = await import('@/lib/memory')
    expect(typeof memoryModule.processTurnForMemory).toBe('function')
    expect(typeof memoryModule.extractUserMemoriesFromTurn).toBe('function')
    expect(typeof memoryModule.extractSelfMemoriesFromTurn).toBe('function')
    expect(typeof memoryModule.extractInterCharacterMemoriesFromTurn).toBe('function')
  })
})
