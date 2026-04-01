/**
 * Tests for gatekeeper parsing functions
 */

import {
  parseClassificationResponse,
  mapModerationResult,
} from '@/lib/services/dangerous-content/gatekeeper.service'
import type { ModerationResult } from '@/lib/plugins/interfaces/moderation-provider-plugin'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}))

jest.mock('@/lib/llm', () => ({}))
jest.mock('@/lib/repositories/factory', () => ({}))
jest.mock('@/lib/services/llm-logging.service', () => ({ logLLMCall: jest.fn() }))
jest.mock('@/lib/plugins/moderation-provider-registry', () => ({ moderationProviderRegistry: { getDefaultProvider: jest.fn() } }))

describe('parseClassificationResponse', () => {
  const threshold = 0.7

  it('parses valid JSON with score below threshold', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.3,
      categories: []
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0.3)
  })

  it('marks dangerous when score at threshold', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.7,
      categories: []
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.isDangerous).toBe(true)
  })

  it('marks dangerous when score above threshold', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.9,
      categories: []
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.isDangerous).toBe(true)
  })

  it('strips ```json code fence wrapper', () => {
    const response = '```json\n{"isDangerous": false, "score": 0.2, "categories": []}\n```'
    const result = parseClassificationResponse(response, threshold)
    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0.2)
  })

  it('strips plain ``` code fence wrapper', () => {
    const response = '```\n{"isDangerous": false, "score": 0.1, "categories": []}\n```'
    const result = parseClassificationResponse(response, threshold)
    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0.1)
  })

  it('returns fail-safe on invalid JSON', () => {
    const response = 'not valid json at all'
    const result = parseClassificationResponse(response, threshold)
    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0)
    expect(result.categories).toEqual([])
  })

  it('returns fail-safe on empty string', () => {
    const result = parseClassificationResponse('', threshold)
    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0)
    expect(result.categories).toEqual([])
  })

  it('isDangerous true in response overrides score', () => {
    const response = JSON.stringify({
      isDangerous: true,
      score: 0.1,
      categories: []
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.isDangerous).toBe(true)
  })

  it('uses max category score when it exceeds overall score', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.3,
      categories: [
        { category: 'violence', score: 0.8, label: 'Violence' }
      ]
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.score).toBe(0.8)
    expect(result.isDangerous).toBe(true)
  })

  it('handles missing score field', () => {
    const response = JSON.stringify({
      isDangerous: false,
      categories: []
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.score).toBe(0)
    expect(result.isDangerous).toBe(false)
  })

  it('handles missing categories field', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.5
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.categories).toEqual([])
  })

  it('handles categories with missing score', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.2,
      categories: [
        { category: 'nsfw', label: 'NSFW' }
      ]
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.categories[0].score).toBe(0)
  })

  it('handles categories with missing category name', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.2,
      categories: [
        { score: 0.5, label: 'Some content' }
      ]
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.categories[0].category).toBe('unknown')
  })

  it('handles categories with missing label', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.2,
      categories: [
        { category: 'violence', score: 0.6 }
      ]
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.categories[0].label).toBe('')
  })

  it('score exactly at threshold is dangerous', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.5,
      categories: []
    })
    const result = parseClassificationResponse(response, 0.5)
    expect(result.isDangerous).toBe(true)
  })

  it('preserves category data correctly', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.4,
      categories: [
        { category: 'hate_speech', score: 0.75, label: 'Hate speech' }
      ]
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.categories).toHaveLength(1)
    expect(result.categories[0].category).toBe('hate_speech')
    expect(result.categories[0].score).toBe(0.75)
    expect(result.categories[0].label).toBe('Hate speech')
  })

  it('handles multiple categories', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.5,
      categories: [
        { category: 'violence', score: 0.4, label: 'Violence' },
        { category: 'nsfw', score: 0.3, label: 'NSFW' }
      ]
    })
    const result = parseClassificationResponse(response, threshold)
    expect(result.categories).toHaveLength(2)
  })
})

describe('mapModerationResult', () => {
  const threshold = 0.7

  it('maps sexual to nsfw', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'sexual', score: 0.8, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'nsfw', score: 0.8 })
    )
  })

  it('maps sexual/minors to nsfw', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'sexual/minors', score: 0.9, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'nsfw' })
    )
  })

  it('maps violence to violence', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'violence', score: 0.85, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'violence', score: 0.85 })
    )
  })

  it('maps violence/graphic to violence', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'violence/graphic', score: 0.9, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'violence' })
    )
  })

  it('maps hate to hate_speech', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'hate', score: 0.8, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'hate_speech' })
    )
  })

  it('maps hate/threatening to hate_speech', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'hate/threatening', score: 0.85, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'hate_speech' })
    )
  })

  it('maps harassment to hate_speech', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'harassment', score: 0.75, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'hate_speech' })
    )
  })

  it('maps harassment/threatening to hate_speech', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'harassment/threatening', score: 0.8, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'hate_speech' })
    )
  })

  it('maps self-harm to self_harm', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'self-harm', score: 0.9, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'self_harm' })
    )
  })

  it('maps self-harm/intent to self_harm', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'self-harm/intent', score: 0.85, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'self_harm' })
    )
  })

  it('maps self-harm/instructions to self_harm', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'self-harm/instructions', score: 0.8, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'self_harm' })
    )
  })

  it('maps illicit to illegal_activity', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'illicit', score: 0.75, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'illegal_activity' })
    )
  })

  it('maps illicit/violent to illegal_activity', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'illicit/violent', score: 0.8, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'illegal_activity' })
    )
  })

  it('takes max score when multiple categories map to same Concierge category', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [
        { category: 'sexual', score: 0.6, flagged: false },
        { category: 'sexual/minors', score: 0.9, flagged: true }
      ]
    }
    const result = mapModerationResult(moderationResult, threshold)
    const nsfwCategory = result.categories.find(c => c.category === 'nsfw')
    expect(nsfwCategory).toEqual(expect.objectContaining({ category: 'nsfw', score: 0.9 }))
  })

  it('filters out scores below RELEVANCE_FLOOR (0.01)', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [
        { category: 'sexual', score: 0.005, flagged: false },
        { category: 'violence', score: 0.02, flagged: false }
      ]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories).not.toContainEqual(
      expect.objectContaining({ category: 'nsfw' })
    )
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'violence', score: 0.02 })
    )
  })

  it('flagged=true makes isDangerous true regardless of score', () => {
    const moderationResult: ModerationResult = {
      flagged: true,
      categories: [{ category: 'sexual', score: 0.2, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.isDangerous).toBe(true)
  })

  it('flagged=false with score below threshold means not dangerous', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'violence', score: 0.3, flagged: false }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.isDangerous).toBe(false)
  })

  it('score at threshold is dangerous', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'violence', score: 0.7, flagged: false }]
    }
    const result = mapModerationResult(moderationResult, 0.7)
    expect(result.isDangerous).toBe(true)
  })

  it('includes category labels', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'violence', score: 0.75, flagged: true }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.categories[0].label).toBe('Violence or graphic content')
  })

  it('handles empty categories', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: []
    }
    const result = mapModerationResult(moderationResult, threshold)
    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0)
    expect(result.categories).toEqual([])
  })

  it('handles unknown category', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'unknown-category', score: 0.5, flagged: false }]
    }
    const result = mapModerationResult(moderationResult, threshold)
    // Unknown categories pass through unmapped
    expect(result.categories).toContainEqual(
      expect.objectContaining({ category: 'unknown-category', score: 0.5 })
    )
  })
})
