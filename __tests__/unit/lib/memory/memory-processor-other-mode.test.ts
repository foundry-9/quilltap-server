/**
 * Per-turn OTHER pass honours memoryExtractionMode.otherPass:
 *   'turn'   — today's behaviour, unchanged
 *   'hybrid' — per-turn OTHER candidates below perTurnOtherFloor are dropped
 *   'fold'   — no per-turn OTHER pass at all
 * The SELF pass is untouched in every mode.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn(() => ({})) }))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  extractSelfMemoriesFromTurn: jest.fn(),
  extractOtherMemoriesFromTurn: jest.fn(),
  loadCanonForSelfWithCommonplace: jest.fn(async () => ({})),
  loadCanonForObserverAboutSubject: jest.fn(async () => ({ source: 'none' })),
  renderSelfCanonBlock: jest.fn(() => ''),
  renderOtherCanonBlock: jest.fn(() => ''),
}))
jest.mock('@/lib/memory/memory-service', () => ({ createMemoryWithGate: jest.fn() }))
jest.mock('@/lib/instance-settings', () => ({ getMemoryExtractionModeSettings: jest.fn() }))
jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(() => ({ provider: 'x', modelName: 'y' })),
  resolveUncensoredCheapLLMSelection: jest.fn((s: unknown) => s),
}))
jest.mock('@/lib/llm/model-context-data', () => ({ resolveMaxTokens: jest.fn(() => 8000) }))
jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { processTurnForMemory } from '@/lib/memory/memory-processor'
import { extractSelfMemoriesFromTurn, extractOtherMemoriesFromTurn } from '@/lib/memory/cheap-llm-tasks'
import { createMemoryWithGate } from '@/lib/memory/memory-service'
import { getMemoryExtractionModeSettings } from '@/lib/instance-settings'

const mockSelf = extractSelfMemoriesFromTurn as jest.Mock
const mockOther = extractOtherMemoriesFromTurn as jest.Mock
const mockGate = createMemoryWithGate as jest.Mock
const mockMode = getMemoryExtractionModeSettings as jest.Mock

const cand = (summary: string, importance: number) => ({
  content: summary, summary, keywords: [], importance, kind: 'semantic',
})

function ctx() {
  return {
    transcript: {
      turnOpenerMessageId: 'o1',
      userMessage: 'hi',
      userCharacterId: null,
      userCharacterName: null,
      userCharacterPronouns: null,
      characterSlices: [
        { characterId: 'a', characterName: 'Amy', characterPronouns: null, text: 't', contributingMessageIds: ['m1'] },
        { characterId: 'b', characterName: 'Bea', characterPronouns: null, text: 't', contributingMessageIds: ['m2'] },
      ],
      latestAssistantMessageId: 'm2',
    },
    participantCharacters: new Map(),
    chatId: 'chat-1',
    userId: 'u1',
    connectionProfile: { id: 'p', provider: 'OPENAI', modelName: 'm' },
    cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true },
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSelf.mockResolvedValue({ success: true, result: [] })
  // Both observers see the other as the subject: one 0.9 and one 0.5 candidate.
  mockOther.mockImplementation(async (_t: unknown, _o: string, subjects: Array<{ id: string }>) => ({
    success: true,
    result: new Map(subjects.map(s => [s.id, [cand('hinge', 0.9), cand('trait', 0.5)]])),
  }))
  mockGate.mockResolvedValue({ action: 'INSERT', memory: { id: 'new' } })
})

const otherWrites = () => mockGate.mock.calls.map(c => c[0]).filter(i => i.aboutCharacterId !== i.characterId)

describe('processTurnForMemory — otherPass mode', () => {
  it("'turn' keeps every per-turn OTHER candidate", async () => {
    mockMode.mockResolvedValue({ otherPass: 'turn', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 })
    await processTurnForMemory(ctx())
    expect(mockOther).toHaveBeenCalledTimes(2)
    expect(otherWrites()).toHaveLength(4)
  })

  it("'hybrid' drops per-turn OTHER candidates below the floor", async () => {
    mockMode.mockResolvedValue({ otherPass: 'hybrid', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 })
    await processTurnForMemory(ctx())
    expect(mockOther).toHaveBeenCalledTimes(2)
    const writes = otherWrites()
    expect(writes).toHaveLength(2)
    expect(writes.every(w => w.importance >= 0.75)).toBe(true)
  })

  it("'fold' runs no per-turn OTHER pass but still runs SELF", async () => {
    mockMode.mockResolvedValue({ otherPass: 'fold', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 })
    await processTurnForMemory(ctx())
    expect(mockOther).not.toHaveBeenCalled()
    expect(mockSelf).toHaveBeenCalledTimes(2)
    expect(otherWrites()).toHaveLength(0)
  })

  it('falls back to per-turn behaviour when the setting cannot be read', async () => {
    mockMode.mockRejectedValue(new Error('settings down'))
    await processTurnForMemory(ctx())
    expect(mockOther).toHaveBeenCalledTimes(2)
    expect(otherWrites()).toHaveLength(4)
  })
})
