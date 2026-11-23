/**
 * @jest-environment node
 *
 * The shared wardrobe proposal parser: the outline it insists on, everything
 * it forgives, and the two fields (`outfit.reuse`, `notes`) it reads only for
 * a caller that showed the model a numbered list.
 */

import { parseWardrobeProposal } from '../parse'
import { wardrobeProposalSchema } from '../types'
import { WARDROBE_IMAGE_PROMPT_MAX_LENGTH } from '@/lib/wardrobe/image-prompt-limit'

const piece = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  description: `${title}, described`,
  imagePrompt: `${title} cue`,
  types: ['top'],
  appropriateness: 'formal',
  ...extra,
})

const answer = (body: Record<string, unknown>) => JSON.stringify(body)

describe('parseWardrobeProposal — the outline', () => {
  it('reads pieces and the outfit', () => {
    const parsed = parseWardrobeProposal(
      answer({
        items: [piece('Blazer'), piece('Brogues', { types: ['footwear'] })],
        outfit: { title: 'Club Night', description: 'Sharp', appropriateness: 'evening' },
      }),
    )
    expect(parsed.proposedItems.map((i) => i.title)).toEqual(['Blazer', 'Brogues'])
    expect(parsed.proposedOutfit).toEqual({ title: 'Club Night', description: 'Sharp', appropriateness: 'evening' })
    expect(parsed.reuse).toEqual([])
    expect(parsed.notes).toBe('')
  })

  it('unwraps a code fence and a chatty preamble', () => {
    const json = answer({ items: [piece('Cloak')], outfit: null })
    expect(parseWardrobeProposal('```json\n' + json + '\n```').proposedItems).toHaveLength(1)
    expect(parseWardrobeProposal(`Here is the design:\n${json}\nI hope it suits.`).proposedItems).toHaveLength(1)
  })

  it('throws a readable error for text that is not JSON, or has no items', () => {
    expect(() => parseWardrobeProposal('a lovely cloak')).toThrow(/invalid response/)
    expect(() => parseWardrobeProposal(answer({ outfit: null }))).toThrow(/unexpected response format/)
    expect(() => parseWardrobeProposal(answer({ items: 'many' }))).toThrow(/unexpected response format/)
  })
})

describe('parseWardrobeProposal — what it forgives', () => {
  it('drops a piece without a title or description', () => {
    const parsed = parseWardrobeProposal(
      answer({ items: [piece('Kept'), { title: 'No description' }, { description: 'No title' }, null], outfit: null }),
    )
    expect(parsed.proposedItems.map((i) => i.title)).toEqual(['Kept'])
  })

  it('drops unknown slots, and files a piece left with none under accessories', () => {
    const parsed = parseWardrobeProposal(
      answer({ items: [piece('A', { types: ['top', 'cape'] }), piece('B', { types: ['cape'] }), piece('C', { types: null })], outfit: null }),
    )
    expect(parsed.proposedItems.map((i) => i.types)).toEqual([['top'], ['accessories'], ['accessories']])
  })

  it('clamps a long image prompt and lets the title stand in for a missing one', () => {
    const parsed = parseWardrobeProposal(
      answer({ items: [piece('Long', { imagePrompt: 'x'.repeat(500) }), piece('Bare', { imagePrompt: '' })], outfit: null }),
    )
    expect(parsed.proposedItems[0].imagePrompt.length).toBeLessThanOrEqual(WARDROBE_IMAGE_PROMPT_MAX_LENGTH)
    expect(parsed.proposedItems[1].imagePrompt).toBe('Bare')
  })

  it('drops an untitled outfit, and any outfit over fewer than two pieces', () => {
    const outfit = { title: 'Look', description: '', appropriateness: '' }
    expect(parseWardrobeProposal(answer({ items: [piece('A'), piece('B')], outfit: { title: '  ' } })).proposedOutfit).toBeNull()
    expect(parseWardrobeProposal(answer({ items: [piece('A')], outfit })).proposedOutfit).toBeNull()
    expect(parseWardrobeProposal(answer({ items: [piece('A'), piece('B')], outfit })).proposedOutfit).toEqual(outfit)
  })

  it('keeps no more pieces than the caller allows', () => {
    const items = Array.from({ length: 6 }, (_, i) => piece(`P${i}`))
    expect(parseWardrobeProposal(answer({ items, outfit: null }), { maxItems: 4 }).proposedItems).toHaveLength(4)
  })
})

describe('parseWardrobeProposal — reuse and notes', () => {
  const outfit = (reuse: unknown) => ({ title: 'Look', description: '', appropriateness: '', reuse })

  it('ignores both unless the caller says how many pieces were listed', () => {
    const parsed = parseWardrobeProposal(answer({ items: [piece('A'), piece('B')], outfit: outfit([1]), notes: 'From the archive.' }))
    expect(parsed.reuse).toEqual([])
    expect(parsed.notes).toBe('')
  })

  it('keeps numbers in range, once each, in order', () => {
    const parsed = parseWardrobeProposal(
      answer({ items: [piece('A')], outfit: outfit([3, 1, 3, 0, 9, 2.5, '2', -1]) }),
      { reuseCount: 4 },
    )
    expect(parsed.reuse).toEqual([3, 1])
  })

  it('counts reused pieces toward the outfit minimum', () => {
    const parsed = parseWardrobeProposal(answer({ items: [piece('Skirt')], outfit: outfit([2]) }), { reuseCount: 3 })
    expect(parsed.proposedOutfit?.title).toBe('Look')
    expect(parsed.reuse).toEqual([2])
  })

  it('drops reuse when there is no outfit to put it in', () => {
    const parsed = parseWardrobeProposal(answer({ items: [piece('A')], outfit: { title: '', reuse: [1] } }), { reuseCount: 3 })
    expect(parsed.proposedOutfit).toBeNull()
    expect(parsed.reuse).toEqual([])
  })

  it('trims and caps the notes', () => {
    const parsed = parseWardrobeProposal(answer({ items: [piece('A')], outfit: null, notes: `  ${'n'.repeat(1500)}  ` }), { reuseCount: 0 })
    expect(parsed.notes).toHaveLength(1000)
  })
})

describe('wardrobeProposalSchema', () => {
  it('defaults reuseItemIds and refuses unknown keys and slots', () => {
    const ok = wardrobeProposalSchema.parse({ items: [{ ...piece('A') }], outfit: null })
    expect(ok.reuseItemIds).toEqual([])
    expect(wardrobeProposalSchema.safeParse({ items: [{ ...piece('A'), selected: true }], outfit: null }).success).toBe(false)
    expect(wardrobeProposalSchema.safeParse({ items: [piece('A', { types: ['cape'] })], outfit: null }).success).toBe(false)
  })
})
