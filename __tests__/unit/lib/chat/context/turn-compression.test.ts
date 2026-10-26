/**
 * Tests for the turn's budget-driven compression phase: the window it keeps
 * verbatim, the autonomous cap, and the memory pass's budget split.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  ...jest.requireActual('@/lib/memory/cheap-llm-tasks'),
  compressMemories: jest.fn(),
}))

jest.mock('@/lib/chat/context/compression', () => ({
  ...jest.requireActual('@/lib/chat/context/compression'),
  applyContextCompression: jest.fn(),
}))

import {
  compressTurnHistory,
  compressTurnMemories,
  effectiveWindowSize,
  resolveTurnBudgetInfo,
  verbatimWindowStart,
} from '@/lib/chat/context/turn-compression'
import { compressMemories } from '@/lib/memory/cheap-llm-tasks'
import { applyContextCompression } from '@/lib/chat/context/compression'

const mockedCompressMemories = compressMemories as jest.MockedFunction<typeof compressMemories>
const mockedApplyContextCompression = applyContextCompression as jest.MockedFunction<typeof applyContextCompression>

const settings = { enabled: true, windowSize: 2, systemPromptTargetTokens: 1000 } as any
const selection = { provider: 'OPENAI', modelName: 'gpt-4o-mini' } as any

afterEach(() => {
  jest.clearAllMocks()
})

describe('verbatimWindowStart', () => {
  it('starts the window at the last N visible messages', () => {
    const rows = [
      { role: 'USER', content: 'one' },
      { role: 'ASSISTANT', content: 'two' },
      { role: 'USER', content: 'three' },
      { role: 'ASSISTANT', content: 'four' },
    ]
    expect(verbatimWindowStart(rows, 2)).toBe(2)
  })

  // Bug 265: a row the compressor never sees (an assistant turn that was only
  // tool markup) used to count toward the window, which then kept one visible
  // message fewer than the summary left out — that message was in neither.
  it('does not count a row the visible conversation drops', () => {
    const rows = [
      { role: 'USER', content: 'one' },
      { role: 'ASSISTANT', content: 'two' },
      { role: 'USER', content: 'three' },
      { role: 'ASSISTANT', content: '' },
      { role: 'USER', content: 'four' },
    ]
    // The last two visible messages are "three" and "four".
    expect(verbatimWindowStart(rows, 2)).toBe(2)
  })

  it('keeps everything when the window is wider than the history', () => {
    const rows = [{ role: 'USER', content: 'only' }]
    expect(verbatimWindowStart(rows, 5)).toBe(0)
  })
})

describe('effectiveWindowSize', () => {
  it('is the standard size without a fallback cache', () => {
    expect(effectiveWindowSize(5, 20, undefined)).toBe(5)
  })

  it('widens by the messages a stale cache has not seen', () => {
    expect(effectiveWindowSize(5, 20, 17)).toBe(8)
  })

  it('defaults when the settings carry no size', () => {
    expect(effectiveWindowSize(0, 20, undefined)).toBe(5)
  })
})

describe('resolveTurnBudgetInfo', () => {
  const profile = { maxContext: 100_000, maxTokens: 4000 } as any

  it('is null without a connection profile', () => {
    expect(resolveTurnBudgetInfo('OPENAI', 'gpt-4o', undefined, undefined)).toBeNull()
  })

  it('clamps maxAvailable to the autonomous cap, never raising it', () => {
    const uncapped = resolveTurnBudgetInfo('OPENAI', 'gpt-4o', profile, undefined)!
    expect(resolveTurnBudgetInfo('OPENAI', 'gpt-4o', profile, 10_000)!.maxAvailable).toBe(10_000)
    expect(resolveTurnBudgetInfo('OPENAI', 'gpt-4o', profile, uncapped.maxAvailable + 1)!.maxAvailable)
      .toBe(uncapped.maxAvailable)
  })
})

describe('compressTurnHistory', () => {
  const longHistory = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
    content: `message ${i} `.repeat(200),
    id: `m${i}`,
  }))
  const base = {
    provider: 'OPENAI' as const,
    userId: 'user',
    chatId: 'chat',
    characterName: 'Friday',
    userName: 'Charlie',
    existingMessages: longHistory,
    systemPrompt: 'You are Friday.',
    systemPromptTokens: 10,
    memoryEstimateTokens: 0,
    budgetInfo: { maxAvailable: 1000, maxContext: 2000, maxTokens: 500 },
    settings,
    selection,
    bypass: false,
    warnings: [] as string[],
  }

  it('does nothing when the estimate fits', async () => {
    const result = await compressTurnHistory({ ...base, budgetInfo: { maxAvailable: 1_000_000, maxContext: 2_000_000, maxTokens: 500 } })
    expect(result).toEqual({ enabled: false, applied: false, block: null, windowStart: 0 })
    expect(mockedApplyContextCompression).not.toHaveBeenCalled()
  })

  it('uses the cached pre-compression and cuts history to the window', async () => {
    const result = await compressTurnHistory({
      ...base,
      cachedResult: { compressionApplied: true, compressedHistory: 'They met.', warnings: [] },
    })
    expect(mockedApplyContextCompression).not.toHaveBeenCalled()
    expect(result.applied).toBe(true)
    expect(result.block).toContain('They met.')
    expect(result.windowStart).toBe(10)
  })

  it('compresses synchronously on a cache miss, and degrades to no summary on failure', async () => {
    mockedApplyContextCompression.mockRejectedValueOnce(new Error('cheap LLM down'))
    const warnings: string[] = []
    const result = await compressTurnHistory({ ...base, warnings })
    expect(mockedApplyContextCompression).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ enabled: true, applied: false, block: null, windowStart: 0 })
    expect(warnings).toContain('Failed to apply context compression: cheap LLM down')
  })
})

describe('compressTurnMemories', () => {
  const base = {
    provider: 'OPENAI' as const,
    userId: 'user',
    chatId: 'chat',
    characterName: 'Friday',
    budgetInfo: { maxAvailable: 1000, maxContext: 2000, maxTokens: 500 },
    selection,
    enabled: true,
    warnings: [] as string[],
  }

  it('leaves the sections alone when compression is not in force', async () => {
    const semantic = { content: 'x'.repeat(5000), tokens: 5000 }
    const interCharacter = { content: '', tokens: 0 }
    const result = await compressTurnMemories({ ...base, enabled: false, semantic, interCharacter })
    expect(result).toEqual({ semantic, interCharacter })
    expect(mockedCompressMemories).not.toHaveBeenCalled()
  })

  it('compresses semantic memories to 70% of the share when inter-character ones are present', async () => {
    mockedCompressMemories.mockResolvedValue({
      success: true,
      result: { compressedText: 'short', originalTokens: 500, compressedTokens: 2 },
    } as any)
    const result = await compressTurnMemories({
      ...base,
      semantic: { content: 'long memories', tokens: 500 },
      interCharacter: { content: 'about the others', tokens: 400 },
    })
    // MEMORY_BUDGET_RATIO of 1000 is 200; 70% of that is 140.
    expect(mockedCompressMemories.mock.calls[0][2]).toBe(140)
    expect(result.semantic.content).toBe('short')
    expect(mockedCompressMemories).toHaveBeenCalledTimes(2)
  })

  it('keeps the original section and warns when compression fails', async () => {
    mockedCompressMemories.mockResolvedValue({ success: false, error: 'refused' } as any)
    const warnings: string[] = []
    const semantic = { content: 'long memories', tokens: 500 }
    const result = await compressTurnMemories({ ...base, warnings, semantic, interCharacter: { content: '', tokens: 0 } })
    expect(result.semantic).toBe(semantic)
    expect(warnings).toEqual(['Failed to compress memories: refused'])
  })
})
