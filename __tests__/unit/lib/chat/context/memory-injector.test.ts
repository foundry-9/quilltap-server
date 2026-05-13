/**
 * Phase 3a/3b unit tests — frozen archive + dynamic head formatters.
 *
 * Covers the byte-stability invariants the prompt cache architecture
 * depends on:
 *
 * - The frozen archive emits memories in the exact order it received them
 *   (caller is expected to pre-sort by id), so the formatted text is
 *   byte-stable across turns.
 * - The dynamic head respects its token budget and uses summary not body.
 * - The rank-instruction format includes the short id tag the LLM can
 *   echo back when citing memory recall.
 */

import {
  formatFrozenMemoryArchive,
  formatDynamicMemoryHead,
  formatCurrentSceneState,
  DYNAMIC_HEAD_TOKEN_BUDGET,
  DYNAMIC_HEAD_DEFAULT_SIZE,
} from '@/lib/chat/context/memory-injector'
import type { Memory, Provider } from '@/lib/schemas/types'
import type { SceneState } from '@/lib/schemas/chat.types'
import type { SemanticSearchResult } from '@/lib/memory/memory-service'

const provider: Provider = {
  id: '00000000-0000-0000-0000-0000000000aa',
  name: 'test',
  type: 'OPENAI',
  baseUrl: 'http://localhost',
  apiKeyId: '00000000-0000-0000-0000-0000000000bb',
  models: ['test-model'],
  defaultModel: 'test-model',
  isEnabled: true,
  isCustom: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
} as unknown as Provider

function memory(id: string, summary: string, content: string = summary): Memory {
  return {
    id,
    characterId: '00000000-0000-0000-0000-0000000000c1',
    content,
    summary,
    keywords: [],
    tags: [],
    importance: 0.7,
    source: 'AUTO',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: 0.7,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as unknown as Memory
}

function searchResult(m: Memory, score: number = 0.8, weight: number = 0.7): SemanticSearchResult {
  return { memory: m, score, usedEmbedding: true, effectiveWeight: weight }
}

describe('memory-injector: formatFrozenMemoryArchive (Phase 3a)', () => {
  it('emits memories in input order (caller sorts by id)', () => {
    const archive = [
      memory('a-id', 'first archive entry'),
      memory('b-id', 'second archive entry'),
      memory('c-id', 'third archive entry'),
    ]

    const result = formatFrozenMemoryArchive(archive, 1000, provider)

    expect(result.memoriesUsed).toBe(3)
    expect(result.content).toContain('## Memory Anchors')
    const positions = ['first archive entry', 'second archive entry', 'third archive entry']
      .map(s => result.content.indexOf(s))
    expect(positions[0]).toBeGreaterThan(0)
    expect(positions[1]).toBeGreaterThan(positions[0])
    expect(positions[2]).toBeGreaterThan(positions[1])
  })

  it('is byte-identical across consecutive calls', () => {
    const archive = [
      memory('a', 'alpha'),
      memory('b', 'bravo'),
      memory('c', 'charlie'),
    ]
    const a = formatFrozenMemoryArchive(archive, 1000, provider)
    const b = formatFrozenMemoryArchive(archive, 1000, provider)
    expect(b.content).toBe(a.content)
  })

  it('returns empty content when memories array is empty', () => {
    const result = formatFrozenMemoryArchive([], 1000, provider)
    expect(result).toEqual({ content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] })
  })

  it('truncates at the token budget', () => {
    const archive = Array.from({ length: 30 }, (_, i) =>
      memory(`m-${i.toString().padStart(2, '0')}`, `summary item number ${i}`),
    )
    const result = formatFrozenMemoryArchive(archive, 50, provider)
    expect(result.memoriesUsed).toBeLessThan(30)
    expect(result.tokenCount).toBeLessThanOrEqual(50)
  })

  it('uses summary, not full content', () => {
    const archive = [memory('a', 'short summary', 'a much longer body that should not appear')]
    const result = formatFrozenMemoryArchive(archive, 1000, provider)
    expect(result.content).toContain('short summary')
    expect(result.content).not.toContain('a much longer body')
  })
})

describe('memory-injector: formatDynamicMemoryHead (Phase 3b)', () => {
  it('emits a rank instruction with [m_xxxx] id tags', () => {
    const results = [
      searchResult(memory('11111111-aaaa-bbbb-cccc-000000000001', 'first relevant'), 0.95, 0.85),
      searchResult(memory('22222222-aaaa-bbbb-cccc-000000000002', 'second relevant'), 0.9, 0.8),
    ]
    const r = formatDynamicMemoryHead(results, provider)
    expect(r.content).toContain('Most relevant memories for this turn:')
    expect(r.content).toMatch(/\[m_1111\]/)
    expect(r.content).toMatch(/\[m_2222\]/)
    expect(r.memoriesUsed).toBe(2)
  })

  it('respects DYNAMIC_HEAD_TOKEN_BUDGET by default', () => {
    const longSummary = 'a long summary that uses many tokens '.repeat(20)
    const results = Array.from({ length: 10 }, (_, i) =>
      searchResult(memory(`abcdef${i}-0000-0000-0000-000000000000`, longSummary)),
    )
    const r = formatDynamicMemoryHead(results, provider)
    expect(r.tokenCount).toBeLessThanOrEqual(DYNAMIC_HEAD_TOKEN_BUDGET)
  })

  it('caps entries at DYNAMIC_HEAD_DEFAULT_SIZE by default', () => {
    expect(DYNAMIC_HEAD_DEFAULT_SIZE).toBeGreaterThan(0)
    const results = Array.from({ length: DYNAMIC_HEAD_DEFAULT_SIZE + 5 }, (_, i) =>
      searchResult(memory(`a${i}-0000-0000-0000-000000000000`, `entry ${i}`)),
    )
    const r = formatDynamicMemoryHead(results, provider)
    expect(r.memoriesUsed).toBeLessThanOrEqual(DYNAMIC_HEAD_DEFAULT_SIZE)
  })

  it('returns empty content when results is empty', () => {
    const r = formatDynamicMemoryHead([], provider)
    expect(r).toEqual({ content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] })
  })

  it('orders by effective weight then score', () => {
    const lowWeight = searchResult(memory('a-aaaa-1111-1111-111111111111', 'low'), 0.99, 0.3)
    const highWeight = searchResult(memory('b-bbbb-2222-2222-222222222222', 'high'), 0.5, 0.9)
    const r = formatDynamicMemoryHead([lowWeight, highWeight], provider, { maxEntries: 2 })
    const highIdx = r.content.indexOf('high')
    const lowIdx = r.content.indexOf('low')
    expect(highIdx).toBeGreaterThan(0)
    expect(lowIdx).toBeGreaterThan(0)
    expect(highIdx).toBeLessThan(lowIdx)
  })

  it('uses summary, not full content', () => {
    const m = memory('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'short summary', 'long body content')
    const r = formatDynamicMemoryHead([searchResult(m)], provider)
    expect(r.content).toContain('short summary')
    expect(r.content).not.toContain('long body content')
  })
})

describe('memory-injector: formatCurrentSceneState', () => {
  function scene(overrides: Partial<SceneState> = {}): SceneState {
    return {
      location: 'Kitchen breakfast nook',
      characters: [
        {
          characterId: '00000000-0000-0000-0000-000000000001',
          characterName: 'Friday',
          action: 'Sipping coffee while planning the day.',
          appearance: 'Strawberry-blonde shoulder-length hair.',
          clothing: 'Charcoal Sweater, Charcoal Cigarette Trousers, barefoot',
        },
        {
          characterId: '00000000-0000-0000-0000-000000000002',
          characterName: 'Amy',
          action: 'Reading at the table.',
          appearance: 'Glossy jet-black wavy hair.',
          clothing: 'Forest Green Long Writing Cardigan',
        },
      ],
      updatedAt: '2026-05-04T10:00:00.000Z',
      updatedAtMessageCount: 42,
      ...overrides,
    }
  }

  it('returns empty content when scene state is null', () => {
    const r = formatCurrentSceneState(null, null, provider)
    expect(r.content).toBe('')
    expect(r.tokenCount).toBe(0)
    expect(r.emittedByCharacter.size).toBe(0)
  })

  it('returns empty content when scene state is undefined', () => {
    const r = formatCurrentSceneState(undefined, null, provider)
    expect(r.content).toBe('')
    expect(r.tokenCount).toBe(0)
    expect(r.emittedByCharacter.size).toBe(0)
  })

  it('renders the canonical Current State block with all fields', () => {
    const r = formatCurrentSceneState(scene(), '10:42 PM', provider)
    expect(r.content).toContain('## Current State')
    expect(r.content).toContain('- **Location**: Kitchen breakfast nook')
    expect(r.content).toContain('- **Characters Present**: Friday, Amy')
    expect(r.content).toContain('- **Time**: 10:42 PM')
    expect(r.content).toContain('- **Active Now**: true')
    expect(r.content).toContain('### Friday')
    expect(r.content).toContain('#### Action')
    expect(r.content).toContain('Sipping coffee while planning the day.')
    expect(r.content).toContain('#### Clothing')
    expect(r.content).toContain('Charcoal Sweater, Charcoal Cigarette Trousers, barefoot')
    expect(r.content).toContain('### Amy')
    expect(r.tokenCount).toBeGreaterThan(0)
  })

  it('omits the Time line entirely when no time is provided', () => {
    const r = formatCurrentSceneState(scene(), null, provider)
    expect(r.content).not.toContain('Time')
    expect(r.content).toContain('- **Active Now**: true')
  })

  it('omits the Time line when time is empty/whitespace', () => {
    const r = formatCurrentSceneState(scene(), '   ', provider)
    expect(r.content).not.toContain('- **Time**')
  })

  it('renders a single character correctly', () => {
    const oneChar = scene({
      characters: [
        {
          characterId: '00000000-0000-0000-0000-000000000001',
          characterName: 'Friday',
          action: 'Alone in the study.',
          appearance: null,
          clothing: 'Wool overcoat',
        },
      ],
    })
    const r = formatCurrentSceneState(oneChar, null, provider)
    expect(r.content).toContain('- **Characters Present**: Friday')
    expect(r.content).toContain('### Friday')
    expect(r.content).not.toContain('### Amy')
  })

  it('shows _unspecified_ placeholders when action or clothing is null/blank', () => {
    const blank = scene({
      characters: [
        {
          characterId: '00000000-0000-0000-0000-000000000001',
          characterName: 'Friday',
          action: '',
          appearance: null,
          clothing: null,
        },
      ],
    })
    const r = formatCurrentSceneState(blank, null, provider)
    expect(r.content).toContain('_unspecified_')
    // Both Action and Clothing should fall back
    const matches = r.content.match(/_unspecified_/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('preserves character order from the scene state', () => {
    const r = formatCurrentSceneState(scene(), null, provider)
    const fridayIdx = r.content.indexOf('### Friday')
    const amyIdx = r.content.indexOf('### Amy')
    expect(fridayIdx).toBeGreaterThan(0)
    expect(amyIdx).toBeGreaterThan(fridayIdx)
  })

  it('does not surface character appearance (appearance stays in the JSON)', () => {
    const r = formatCurrentSceneState(scene(), null, provider)
    expect(r.content).not.toContain('Strawberry-blonde')
    expect(r.content).not.toContain('jet-black wavy hair')
  })

  it('overrides cached clothing with live wardrobe values when provided', () => {
    const live = new Map<string, string>([
      ['00000000-0000-0000-0000-000000000001', '- **top:** Linen Shirt\n- **bottom:** Denim Jeans'],
    ])
    const r = formatCurrentSceneState(scene(), null, provider, live)
    expect(r.content).toContain('- **top:** Linen Shirt')
    expect(r.content).toContain('- **bottom:** Denim Jeans')
    expect(r.content).not.toContain('Charcoal Sweater')
    // Amy has no live override so her cached clothing still shows
    expect(r.content).toContain('Forest Green Long Writing Cardigan')
  })

  it('falls back to cached clothing when live override is empty/whitespace', () => {
    const live = new Map<string, string>([
      ['00000000-0000-0000-0000-000000000001', '   '],
    ])
    const r = formatCurrentSceneState(scene(), null, provider, live)
    expect(r.content).toContain('Charcoal Sweater, Charcoal Cigarette Trousers, barefoot')
  })

  it('collapses a character section to "_unchanged_" when prior emission hashes match', () => {
    // First emission — full content, populates emittedByCharacter.
    const first = formatCurrentSceneState(scene(), null, provider)
    expect(first.content).toContain('### Friday\n')
    expect(first.content).toContain('#### Action')
    expect(first.emittedByCharacter.size).toBe(2)

    // Second emission with the same scene state and the prior emission map
    // as the cache — both characters' sections should collapse.
    const second = formatCurrentSceneState(scene(), null, provider, undefined, first.emittedByCharacter)
    expect(second.content).toContain('### Friday — _unchanged_')
    expect(second.content).toContain('### Amy — _unchanged_')
    expect(second.content).not.toContain('Charcoal Sweater')
    expect(second.content).not.toContain('Forest Green Long Writing Cardigan')
    expect(second.tokenCount).toBeLessThan(first.tokenCount)

    // emittedAt is carried forward unchanged when nothing changes.
    const fridayFirst = first.emittedByCharacter.get('00000000-0000-0000-0000-000000000001')!
    const fridaySecond = second.emittedByCharacter.get('00000000-0000-0000-0000-000000000001')!
    expect(fridaySecond.emittedAt).toBe(fridayFirst.emittedAt)
    expect(fridaySecond.actionHash).toBe(fridayFirst.actionHash)
    expect(fridaySecond.clothingHash).toBe(fridayFirst.clothingHash)
  })

  it('emits full content for a character whose clothing changed since the prior emission', () => {
    const first = formatCurrentSceneState(scene(), null, provider)
    // Friday changes clothes; Amy is unchanged.
    const liveClothing = new Map<string, string>([
      ['00000000-0000-0000-0000-000000000001', 'Velvet Smoking Jacket and silk pajamas'],
    ])
    const second = formatCurrentSceneState(scene(), null, provider, liveClothing, first.emittedByCharacter)

    expect(second.content).toContain('### Friday\n')
    expect(second.content).toContain('Velvet Smoking Jacket and silk pajamas')
    expect(second.content).toContain('### Amy — _unchanged_')

    // Friday's stamp advances; Amy's is preserved.
    const fridayFirst = first.emittedByCharacter.get('00000000-0000-0000-0000-000000000001')!
    const fridaySecond = second.emittedByCharacter.get('00000000-0000-0000-0000-000000000001')!
    expect(fridaySecond.actionHash).toBe(fridayFirst.actionHash)
    expect(fridaySecond.clothingHash).not.toBe(fridayFirst.clothingHash)

    const amyFirst = first.emittedByCharacter.get('00000000-0000-0000-0000-000000000002')!
    const amySecond = second.emittedByCharacter.get('00000000-0000-0000-0000-000000000002')!
    expect(amySecond.emittedAt).toBe(amyFirst.emittedAt)
  })

  it('emits full content for a character with no prior emission in the cache', () => {
    // Prior cache only knows about Friday; Amy must render full this turn.
    const priorFridayOnly = new Map<string, { actionHash: string; clothingHash: string; emittedAt: string }>()
    const seed = formatCurrentSceneState(scene(), null, provider)
    priorFridayOnly.set('00000000-0000-0000-0000-000000000001', seed.emittedByCharacter.get('00000000-0000-0000-0000-000000000001')!)

    const next = formatCurrentSceneState(scene(), null, provider, undefined, priorFridayOnly)
    expect(next.content).toContain('### Friday — _unchanged_')
    expect(next.content).toContain('### Amy\n')
    expect(next.content).toContain('Forest Green Long Writing Cardigan')
  })
})
