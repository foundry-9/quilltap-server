/**
 * Tests for character optimizer helper functions
 */

import {
  buildCharacterContext,
  buildMemoryContext,
  getAnalysisPrompt,
  getSuggestionsPrompt,
} from '@/lib/services/character-optimizer.service'
import { createMockCharacter, createMockMemory } from '../fixtures/test-factories'
import type { OptimizerAnalysis } from '@/lib/services/character-optimizer.service'

describe('buildCharacterContext', () => {
  it('includes character name', () => {
    const character = createMockCharacter({ name: 'Aria' })
    const result = buildCharacterContext(character)
    expect(result).toContain('=== Character: Aria ===')
  })

  it('includes description or (empty)', () => {
    const characterWithDesc = createMockCharacter({ description: 'A mysterious figure' })
    const resultWith = buildCharacterContext(characterWithDesc)
    expect(resultWith).toContain('A mysterious figure')

    const characterNoDesc = createMockCharacter({ description: null })
    const resultWithout = buildCharacterContext(characterNoDesc)
    expect(resultWithout).toContain('(empty)')
  })

  it('includes personality or (empty)', () => {
    const characterWithPersonality = createMockCharacter({ personality: 'Witty and clever' })
    const resultWith = buildCharacterContext(characterWithPersonality)
    expect(resultWith).toContain('Witty and clever')

    const characterNoPersonality = createMockCharacter({ personality: null })
    const resultWithout = buildCharacterContext(characterNoPersonality)
    expect(resultWithout).toContain('(empty)')
  })

  it('includes scenario or (empty)', () => {
    const characterWithScenario = createMockCharacter({ scenarios: [{ id: 'test-scenario-id', title: 'Default', content: 'A tavern in a fantasy world', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }] })
    const resultWith = buildCharacterContext(characterWithScenario)
    expect(resultWith).toContain('A tavern in a fantasy world')

    const characterNoScenario = createMockCharacter({ scenarios: [] })
    const resultWithout = buildCharacterContext(characterNoScenario)
    expect(resultWithout).toContain('Scenario')
  })

  it('includes talkativeness value', () => {
    const character = createMockCharacter({ talkativeness: 0.7 })
    const result = buildCharacterContext(character)
    expect(result).toContain('Talkativeness: 0.7')
  })

  it('includes system prompts section when present', () => {
    const character = createMockCharacter({
      systemPrompts: [
        { id: '1', name: 'Behavior', content: 'Act naturally' }
      ]
    })
    const result = buildCharacterContext(character)
    expect(result).toContain('=== System Prompts ===')
    expect(result).toContain('Behavior')
    expect(result).toContain('Act naturally')
  })

  it('excludes system prompts section when empty', () => {
    const character = createMockCharacter({ systemPrompts: [] })
    const result = buildCharacterContext(character)
    expect(result).not.toContain('=== System Prompts ===')
  })

  it('includes physical descriptions when present', () => {
    const character = createMockCharacter({
      physicalDescriptions: [
        {
          id: '1',
          name: 'Appearance',
          shortPrompt: 'Tall',
          mediumPrompt: 'Tall and dark-haired',
          longPrompt: 'A tall figure with dark hair',
          completePrompt: 'Complete description',
          fullDescription: 'Full description here'
        }
      ]
    })
    const result = buildCharacterContext(character)
    expect(result).toContain('=== Physical Descriptions ===')
    expect(result).toContain('Appearance')
    expect(result).toContain('Tall')
  })

  it('includes clothing records when present', () => {
    const character = createMockCharacter({
      clothingRecords: [
        { id: '1', name: 'Formal Wear', description: 'A tailored suit' }
      ]
    })
    const result = buildCharacterContext(character)
    expect(result).toContain('=== Clothing Records ===')
    expect(result).toContain('Formal Wear')
    expect(result).toContain('A tailored suit')
  })
})

describe('buildMemoryContext', () => {
  it('includes count in header', () => {
    const memories = [
      { memory: createMockMemory({ content: 'Memory 1' }) },
      { memory: createMockMemory({ content: 'Memory 2' }) }
    ]
    const result = buildMemoryContext(memories)
    expect(result).toContain('=== Reinforced Memories (top 2) ===')
  })

  it('includes each memory with index', () => {
    const memories = [
      { memory: createMockMemory({ content: 'First memory' }) },
      { memory: createMockMemory({ content: 'Second memory' }) }
    ]
    const result = buildMemoryContext(memories)
    expect(result).toContain('[Memory #1]')
    expect(result).toContain('[Memory #2]')
  })

  it('includes reinforcement count', () => {
    const memories = [
      { memory: createMockMemory({ reinforcementCount: 5, content: 'Important memory' }) }
    ]
    const result = buildMemoryContext(memories)
    expect(result).toContain('reinforced 5 times')
  })

  it('includes memory content', () => {
    const memories = [
      { memory: createMockMemory({ content: 'The character loves tea' }) }
    ]
    const result = buildMemoryContext(memories)
    expect(result).toContain('The character loves tea')
  })

  it('handles empty array', () => {
    const result = buildMemoryContext([])
    expect(result).toContain('=== Reinforced Memories (top 0) ===')
  })

  it('preserves memory order', () => {
    const memories = [
      { memory: createMockMemory({ content: 'First' }) },
      { memory: createMockMemory({ content: 'Second' }) },
      { memory: createMockMemory({ content: 'Third' }) }
    ]
    const result = buildMemoryContext(memories)
    const firstIndex = result.indexOf('First')
    const secondIndex = result.indexOf('Second')
    const thirdIndex = result.indexOf('Third')
    expect(firstIndex).toBeLessThan(secondIndex)
    expect(secondIndex).toBeLessThan(thirdIndex)
  })
})

describe('getAnalysisPrompt', () => {
  it('returns non-empty string', () => {
    const result = getAnalysisPrompt()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('contains behavioral patterns', () => {
    const result = getAnalysisPrompt()
    expect(result).toContain('behavioral pattern')
  })

  it('contains JSON structure guidance', () => {
    const result = getAnalysisPrompt()
    expect(result).toContain('behavioralPatterns')
    expect(result).toContain('summary')
  })

  it('instructs on focus areas', () => {
    const result = getAnalysisPrompt()
    expect(result).toContain('Speech habits')
    expect(result).toContain('Emotional tendencies')
    expect(result).toContain('Relationship dynamics')
  })
})

describe('getSuggestionsPrompt', () => {
  const mockAnalysis: OptimizerAnalysis = {
    behavioralPatterns: [
      {
        pattern: 'Speaks softly',
        evidence: 'Always whispers in conversations',
        frequency: 'Very often'
      }
    ],
    summary: 'The character is introverted'
  }

  it('contains the analysis JSON', () => {
    const result = getSuggestionsPrompt(mockAnalysis)
    expect(result).toContain(JSON.stringify(mockAnalysis, null, 2))
  })

  it('contains field options list', () => {
    const result = getSuggestionsPrompt(mockAnalysis)
    expect(result).toContain('description|personality|scenario')
  })

  it('contains significance score guidance', () => {
    const result = getSuggestionsPrompt(mockAnalysis)
    expect(result).toContain('significance')
    expect(result).toContain('0.3')
    expect(result).toContain('0.6')
  })

  it('instructs on memory excerpts', () => {
    const result = getSuggestionsPrompt(mockAnalysis)
    expect(result).toContain('memoryExcerpts')
  })

  it('includes rules for different field types', () => {
    const result = getSuggestionsPrompt(mockAnalysis)
    expect(result).toContain('system prompt')
    expect(result).toContain('talkativeness')
    expect(result).toContain('0.1 and 1.0')
  })
})
