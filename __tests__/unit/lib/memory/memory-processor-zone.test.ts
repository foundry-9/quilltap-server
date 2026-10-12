/**
 * Review of PR 90, finding 5: the per-turn extraction (processTurnForMemory —
 * also the Carina and dry-run paths) resolves the memory-calendar zone ONCE,
 * before any prompt is built, and the same zone reaches both the extractor's
 * clock and the `when` resolver — so a cold cache cannot render the prompt in
 * the fallback zone and resolve `when` in the instance zone.
 */

import { beforeEach, describe, expect, it } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// These regressions pin the per-turn OTHER pass itself, so run it in 'turn'
// mode (no hybrid floor); the mode switch has its own test file.
jest.mock('@/lib/instance-settings', () => ({
  getMemoryExtractionModeSettings: jest.fn(async () => ({
    otherPass: 'turn',
    perTurnOtherFloor: 0.75,
    foldCandidatesPerSubject: 3,
  })),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  resolveUncensoredCheapLLMSelection: jest.fn((selection: unknown) => selection),
}))

jest.mock('@/lib/llm/model-context-data', () => ({
  resolveMaxTokens: jest.fn(),
}))

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  extractSelfMemoriesFromTurn: jest.fn(),
  extractOtherMemoriesFromTurn: jest.fn(),
  loadCanonForSelfWithCommonplace: jest.fn(() => ({
    characterId: 'noop',
    characterName: 'noop',
    body: null,
    source: 'none',
  })),
  loadCanonForObserverAboutSubject: jest.fn().mockResolvedValue({
    characterId: 'noop',
    characterName: 'noop',
    body: null,
    source: 'none',
  }),
  renderSelfCanonBlock: jest.fn(() => 'CANON'),
  renderOtherCanonBlock: jest.fn(() => 'CANON'),
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
const tasks = jest.requireMock('@/lib/memory/cheap-llm-tasks') as {
  extractSelfMemoriesFromTurn: jest.Mock
  extractOtherMemoriesFromTurn: jest.Mock
  loadCanonForSelfWithCommonplace: jest.Mock
  loadCanonForObserverAboutSubject: jest.Mock
  renderSelfCanonBlock: jest.Mock
  renderOtherCanonBlock: jest.Mock
}
const { createMemoryWithGate } = jest.requireMock('@/lib/memory/memory-service') as {
  createMemoryWithGate: jest.Mock
}

/** Build the Map shape returned by extractOtherMemoriesFromTurn (multi-subject). */
function otherResult(byId: Record<string, Array<{ content: string; summary: string; keywords?: string[]; importance?: number }>>) {
  const map = new Map<string, unknown>()
  for (const [id, candidates] of Object.entries(byId)) {
    map.set(id, candidates.map(c => ({
      content: c.content,
      summary: c.summary,
      keywords: c.keywords ?? [],
      importance: c.importance ?? 0.5,
    })))
  }
  return map
}

function makeTranscript(extra: {
  userMessage?: string | null
  userCharacterId?: string | null
  characterSlices?: Array<{
    characterId: string
    characterName: string
    text: string
    isUserControlled?: boolean
  }>
} = {}) {
  const slices = (extra.characterSlices ?? [
    { characterId: 'char-1', characterName: 'Avery', text: "I'll remember the compass." },
  ]).map(s => ({
    ...s,
    characterPronouns: null,
    contributingMessageIds: [`assistant-${s.characterId}`],
  }))

  // Build participantCharacters map covering every slice + the user character.
  const participantCharacters = new Map<string, any>()
  for (const s of slices) {
    participantCharacters.set(s.characterId, {
      id: s.characterId,
      name: s.characterName,
      identity: null,
      characterDocumentMountPointId: null,
    })
  }
  const userCharacterId = 'userCharacterId' in extra ? (extra.userCharacterId ?? undefined) : 'user-char-1'
  if (userCharacterId) {
    participantCharacters.set(userCharacterId, {
      id: userCharacterId,
      name: 'Bob',
      identity: null,
      characterDocumentMountPointId: null,
    })
  }

  return {
    transcript: {
      turnOpenerMessageId: 'opener-1',
      userMessage: 'userMessage' in extra ? extra.userMessage : "I keep my grandmother's compass in my satchel.",
      userCharacterId,
      userCharacterName: userCharacterId ? 'Bob' : undefined,
      userCharacterPronouns: null,
      characterSlices: slices,
      latestAssistantMessageId: `assistant-${(extra.characterSlices?.[0]?.characterId) ?? 'char-1'}`,
    },
    participantCharacters,
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


const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }

import { resetMemoryTimeZoneCacheForTests } from '@/lib/memory/memory-calendar'

const ORIGINAL_ENV_TZ = process.env.QUILLTAP_TIMEZONE

describe('processTurnForMemory — memory-calendar zone on a cold cache', () => {
  let processTurnForMemory: (ctx: unknown) => Promise<any>

  beforeEach(async () => {
    jest.clearAllMocks()
    resetMemoryTimeZoneCacheForTests()
    process.env.QUILLTAP_TIMEZONE = 'UTC'
    getRepositories.mockReturnValue({
      chatSettings: { findAll: jest.fn(async () => [{ timezone: 'Asia/Tokyo' }]) },
    })
    getCheapLLMProvider.mockReturnValue({
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
      connectionProfileId: 'profile-1',
      isLocal: false,
    } as any)
    resolveUncensoredCheapLLMSelection.mockImplementation((selection: unknown) => selection as any)
    resolveMaxTokens.mockReturnValue(2048)
    tasks.loadCanonForSelfWithCommonplace.mockResolvedValue({ characterId: 'noop', characterName: 'noop', body: null, source: 'none' } as any)
    tasks.loadCanonForObserverAboutSubject.mockResolvedValue({ characterId: 'noop', characterName: 'noop', body: null, source: 'none' } as any)
    tasks.renderSelfCanonBlock.mockReturnValue('CANON')
    tasks.renderOtherCanonBlock.mockReturnValue('CANON')
    tasks.extractSelfMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: [{ content: 'Avery walked the pier.', summary: 'pier walk', keywords: [], importance: 0.6, kind: 'episodic', when: 'yesterday' }],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)
    tasks.extractOtherMemoriesFromTurn.mockResolvedValue({
      success: true,
      result: new Map(),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as any)
    createMemoryWithGate.mockResolvedValue({ action: 'INSERT', memory: { id: 'mem-1' } } as any)
    ;({ processTurnForMemory } = await import('@/lib/memory/memory-processor'))
  })

  afterAll(() => {
    if (ORIGINAL_ENV_TZ === undefined) delete process.env.QUILLTAP_TIMEZONE
    else process.env.QUILLTAP_TIMEZONE = ORIGINAL_ENV_TZ
    resetMemoryTimeZoneCacheForTests()
  })

  it('hands the extractor a clock already carrying the instance zone, and resolves `when` in it', async () => {
    const ctx = makeTranscript({ userCharacterId: null })
    // 16:00Z on 07-13 is 01:00 on Tuesday 07-14 in Tokyo.
    ctx.sourceMessageTimestamp = '2026-07-13T16:00:00.000Z'
    await processTurnForMemory(ctx)

    expect(tasks.extractSelfMemoriesFromTurn).toHaveBeenCalledTimes(1)
    const clock = tasks.extractSelfMemoriesFromTurn.mock.calls[0][10] as { nowIso: string; timeZone?: string }
    expect(clock.timeZone).toBe('Asia/Tokyo')

    // "yesterday" in Tokyo is 07-13, whose local midnight is 07-12T15:00Z
    // (the UTC fallback would have said 07-12T00:00Z).
    expect(createMemoryWithGate).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: '2026-07-12T15:00:00.000Z' }),
      expect.anything(),
    )
  })
})
