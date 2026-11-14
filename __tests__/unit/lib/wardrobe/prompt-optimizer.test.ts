/**
 * The wardrobe image-prompt optimizer: the length clamp, which items it reads,
 * how a model's verdicts become recommendations, and the batched run.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

const mockExecute = jest.fn()
jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: (...args: unknown[]) => mockExecute(...args),
}))

import {
  clampWardrobeImagePrompt,
  WARDROBE_IMAGE_PROMPT_MAX_LENGTH,
} from '@/lib/wardrobe/image-prompt-limit'
import {
  OPTIMIZER_BATCH_SIZE,
  optimizeWardrobeImagePrompts,
  parseOptimizerResponse,
  selectOptimizableItems,
} from '@/lib/wardrobe/prompt-optimizer'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

let seq = 0
function item(overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  seq += 1
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    characterId: null,
    title: `Item ${seq}`,
    description: 'A plain garment',
    imagePrompt: null,
    types: ['top'],
    componentItemIds: [],
    appropriateness: null,
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as WardrobeItem
}

describe('clampWardrobeImagePrompt', () => {
  it('strips Markdown, quotes and a trailing full stop', () => {
    expect(clampWardrobeImagePrompt('"**red wool coat**."')).toBe('red wool coat')
  })

  it('collapses line breaks', () => {
    expect(clampWardrobeImagePrompt('red\n  wool\tcoat')).toBe('red wool coat')
  })

  it('cuts at a word boundary under the cap', () => {
    const text = 'a'.repeat(150) + ' ' + 'b'.repeat(80)
    const out = clampWardrobeImagePrompt(text)
    expect(out.length).toBeLessThanOrEqual(WARDROBE_IMAGE_PROMPT_MAX_LENGTH)
    expect(out).toBe('a'.repeat(150))
  })

  it('prefers a late comma break', () => {
    const text = `${'x'.repeat(170)}, ${'y'.repeat(60)}`
    expect(clampWardrobeImagePrompt(text)).toBe('x'.repeat(170))
  })

  it('returns empty for nothing', () => {
    expect(clampWardrobeImagePrompt(null)).toBe('')
    expect(clampWardrobeImagePrompt('   ')).toBe('')
  })
})

describe('selectOptimizableItems', () => {
  it('keeps multi-slot garments and drops composites and archived pieces', () => {
    const dress = item({ types: ['top', 'bottom'] })
    const outfit = item({ componentItemIds: [dress.id] })
    const retired = item({ archivedAt: '2026-02-01T00:00:00.000Z' })
    const shirt = item()
    expect(selectOptimizableItems([dress, outfit, retired, shirt]).map((i) => i.id)).toEqual([dress.id, shirt.id])
  })
})

describe('parseOptimizerResponse', () => {
  it('turns a revise into a recommendation and leaves a keep alone', () => {
    const a = item({ imagePrompt: 'blue shirt', description: 'A crimson silk shirt' })
    const b = item({ imagePrompt: 'black leather boots' })
    const recs = parseOptimizerResponse(
      JSON.stringify({
        items: [
          { n: 1, verdict: 'revise', imagePrompt: 'crimson silk shirt', reason: 'Colour contradicted the description' },
          { n: 2, verdict: 'keep' },
        ],
      }),
      [a, b],
    )
    expect(recs).toEqual([
      expect.objectContaining({
        itemId: a.id,
        currentPrompt: 'blue shirt',
        proposedPrompt: 'crimson silk shirt',
        kind: 'revise',
        reason: 'Colour contradicted the description',
      }),
    ])
  })

  it('labels a filled blank as a fill', () => {
    const a = item({ imagePrompt: '' })
    const recs = parseOptimizerResponse('{"items":[{"n":1,"verdict":"revise","imagePrompt":"grey felt fedora"}]}', [a])
    expect(recs[0]).toMatchObject({ kind: 'fill', currentPrompt: null, proposedPrompt: 'grey felt fedora' })
  })

  it('clamps a too-long proposal', () => {
    const a = item()
    const long = Array.from({ length: 80 }, () => 'velvet').join(' ')
    const recs = parseOptimizerResponse(JSON.stringify({ items: [{ n: 1, verdict: 'revise', imagePrompt: long }] }), [a])
    expect(recs[0].proposedPrompt.length).toBeLessThanOrEqual(WARDROBE_IMAGE_PROMPT_MAX_LENGTH)
  })

  it('trims an over-long cue the model kept', () => {
    const long = Array.from({ length: 60 }, () => 'satin').join(' ')
    const a = item({ imagePrompt: long })
    const recs = parseOptimizerResponse('{"items":[{"n":1,"verdict":"keep"}]}', [a])
    expect(recs[0]).toMatchObject({ kind: 'shorten', itemId: a.id })
    expect(recs[0].proposedPrompt.length).toBeLessThanOrEqual(WARDROBE_IMAGE_PROMPT_MAX_LENGTH)
  })

  it('drops a revise identical to the current cue, and out-of-range numbers', () => {
    const a = item({ imagePrompt: 'tan trench coat' })
    const recs = parseOptimizerResponse(
      '{"items":[{"n":1,"verdict":"revise","imagePrompt":"tan trench coat."},{"n":7,"verdict":"revise","imagePrompt":"x"}]}',
      [a],
    )
    expect(recs).toEqual([])
  })

  it('reads an answer wrapped in a code fence', () => {
    const a = item()
    const recs = parseOptimizerResponse('```json\n{"items":[{"n":"1","verdict":"revise","imagePrompt":"white linen apron"}]}\n```', [a])
    expect(recs[0].proposedPrompt).toBe('white linen apron')
  })
})

describe('optimizeWardrobeImagePrompts', () => {
  beforeEach(() => mockExecute.mockReset())

  const selection = { provider: 'OPENAI', modelName: 'mini' } as never

  it('batches the garments and reports a failed batch', async () => {
    const items = Array.from({ length: OPTIMIZER_BATCH_SIZE + 2 }, () => item())
    mockExecute.mockImplementation(async (_s: unknown, _m: unknown, _u: unknown, parse: (c: string) => unknown, taskType: string) => {
      expect(taskType).toBe('optimize-wardrobe-image-prompts')
      if (mockExecute.mock.calls.length === 1) {
        return { success: true, result: parse('{"items":[{"n":1,"verdict":"revise","imagePrompt":"striped cotton shirt"}]}') }
      }
      return { success: false, error: 'boom' }
    })
    const result = await optimizeWardrobeImagePrompts({ items, selection, userId: 'u', characterId: 'c' })
    expect(mockExecute).toHaveBeenCalledTimes(2)
    expect(result.examined).toBe(items.length)
    expect(result.recommendations).toHaveLength(1)
    expect(result.failedItemIds).toHaveLength(2)
  })

  it('never sends a composite or an archived piece', async () => {
    const leaf = item()
    const items = [leaf, item({ componentItemIds: [leaf.id] }), item({ archivedAt: '2026-01-02T00:00:00.000Z' })]
    mockExecute.mockResolvedValue({ success: true, result: [] })
    const result = await optimizeWardrobeImagePrompts({ items, selection, userId: 'u', characterId: 'c' })
    expect(result.examined).toBe(1)
    const messages = mockExecute.mock.calls[0][1] as { role: string; content: string }[]
    expect(messages[1].content).toContain('Review these 1 wardrobe items')
  })
})
