/**
 * Connection-profile usage counters (lib/llm/profile-usage.ts) and the cache
 * tier of the cost estimate (lib/llm/pricing.ts).
 */

import {
  PROFILE_USAGE_COUNTER_FIELD_NAMES,
  counterIncrementsFor,
  orderProfilesByChatUse,
  readProfileUsage,
  tallyTokens,
  zeroProfileUsageCounters,
} from '@/lib/llm/profile-usage'
import { estimateCost, parseOpenRouterPricing, type ModelPricing } from '@/lib/llm/pricing'
import { usageCategoryOf } from '@/lib/schemas/llm-log.types'
import { ConnectionProfileSchema } from '@/lib/schemas/profile.types'

describe('usageCategoryOf', () => {
  it('counts a conversation answer and its tool round-trips as chat', () => {
    expect(usageCategoryOf('CHAT_MESSAGE')).toBe('chat')
    expect(usageCategoryOf('TOOL_CONTINUATION')).toBe('chat')
  })

  it('counts everything else as automatic', () => {
    for (const type of ['MEMORY_EXTRACTION', 'TITLE_GENERATION', 'DANGER_CLASSIFICATION', 'STORYTELLER_BID', 'CHARACTER_WIZARD'] as const) {
      expect(usageCategoryOf(type)).toBe('automatic')
    }
  })
})

describe('profile usage counters', () => {
  it('names exactly the schema columns', () => {
    const shape = Object.keys(ConnectionProfileSchema.shape)
    for (const field of PROFILE_USAGE_COUNTER_FIELD_NAMES) expect(shape).toContain(field)
    expect(PROFILE_USAGE_COUNTER_FIELD_NAMES).toHaveLength(10)
    expect(Object.values(zeroProfileUsageCounters()).every((v) => v === 0)).toBe(true)
  })

  it('reads both ledgers, junk as 0', () => {
    const usage = readProfileUsage({ chatCallCount: 3, chatPromptTokens: 100, automaticCallCount: null, automaticCompletionTokens: -5 })
    expect(usage.chat).toEqual({ calls: 3, promptTokens: 100, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(usage.automatic.calls).toBe(0)
    expect(usage.automatic.completionTokens).toBe(0)
  })

  it('increments only the figures a call has, in the right ledger', () => {
    expect(counterIncrementsFor('automatic', { calls: 1, promptTokens: 10, completionTokens: 0, cacheReadTokens: 4, cacheWriteTokens: 0 }))
      .toEqual({ automaticCallCount: 1, automaticPromptTokens: 10, automaticCacheReadTokens: 4 })
  })

  it('totals every token without overlap', () => {
    expect(tallyTokens({ calls: 1, promptTokens: 10, completionTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 3 })).toBe(38)
  })
})

describe('orderProfilesByChatUse', () => {
  it('puts the most chat calls first, then chat tokens, keeping the given order for ties', () => {
    const rows = [
      { id: 'never-a' },
      { id: 'light', chatCallCount: 2, chatPromptTokens: 10 },
      { id: 'background-only', automaticCallCount: 500 },
      { id: 'heavy', chatCallCount: 40 },
      { id: 'light-but-long', chatCallCount: 2, chatPromptTokens: 9000 },
      { id: 'never-b' },
    ]
    expect(orderProfilesByChatUse(rows).map((r) => r.id))
      .toEqual(['heavy', 'light-but-long', 'light', 'never-a', 'background-only', 'never-b'])
    expect(rows[0].id).toBe('never-a') // input untouched
  })
})

describe('estimateCost with prompt-cache traffic', () => {
  const base: ModelPricing = {
    modelId: 'm',
    provider: 'ANTHROPIC',
    name: 'm',
    promptCostPer1M: 3,
    completionCostPer1M: 15,
    contextLength: null,
    fetchedAt: '2026-11-27T00:00:00.000Z',
  }

  it('prices cache reads and writes at their published rates', () => {
    const cost = estimateCost(
      { ...base, cacheReadCostPer1M: 0.3, cacheWriteCostPer1M: 3.75 },
      1_000_000, 1_000_000, { cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }
    )
    expect(cost).toBeCloseTo(3 + 15 + 0.3 + 3.75)
  })

  it('prices unpublished cache rates at the input rate, never zero', () => {
    expect(estimateCost(base, 0, 0, { cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 })).toBeCloseTo(6)
  })

  it('is unchanged for a call without cache traffic', () => {
    expect(estimateCost(base, 1_000_000, 0)).toBeCloseTo(3)
  })

  it('parses OpenRouter cache rates in either spelling', () => {
    expect(parseOpenRouterPricing({ prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375' }))
      .toEqual({ promptCostPer1M: 3, completionCostPer1M: 15, cacheReadCostPer1M: expect.closeTo(0.3), cacheWriteCostPer1M: expect.closeTo(3.75) })
    expect(parseOpenRouterPricing({ prompt: '0.000001', completion: '0.000002', inputCacheRead: '0.0000001' }))
      .toEqual({ promptCostPer1M: 1, completionCostPer1M: 2, cacheReadCostPer1M: expect.closeTo(0.1), cacheWriteCostPer1M: null })
  })
})
