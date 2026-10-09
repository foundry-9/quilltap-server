/**
 * Wardrobe item drafts — the one form shape and the one create/update body.
 */

import { draftFromItem, draftToPayload, emptyDraft, validateDraft } from '@/lib/wardrobe/item-draft'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

const coat = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Charcoal Coat',
  description: null,
  imagePrompt: 'charcoal wool greatcoat',
  types: ['top'],
  appropriateness: 'formal',
  isDefault: true,
  componentItemIds: [],
  replace: true,
} as unknown as WardrobeItem

describe('item drafts', () => {
  it('round-trips an item into the body the routes accept', () => {
    expect(draftToPayload(draftFromItem(coat))).toEqual({
      title: 'Charcoal Coat',
      description: null,
      imagePrompt: 'charcoal wool greatcoat',
      types: ['top'],
      appropriateness: 'formal',
      isDefault: true,
      componentItemIds: [],
      // A leaf always replaces its slots; the flag is composite-only.
      replace: false,
    })
  })

  it('keeps replace for a composite and sends blank text as null', () => {
    const payload = draftToPayload(
      emptyDraft({ title: '  Naked  ', types: ['top', 'bottom'], componentItemIds: ['ring'], replace: true, description: '   ' }),
    )
    expect(payload.title).toBe('Naked')
    expect(payload.description).toBeNull()
    expect(payload.replace).toBe(true)
  })

  it('validates through the routes’ own schema', () => {
    expect(validateDraft(emptyDraft({ types: ['top'] }))).toEqual({ ok: false, error: 'Title is required' })
    expect(validateDraft(emptyDraft({ title: 'Hat' })).ok).toBe(false)
    const ok = validateDraft(emptyDraft({ title: 'Hat', types: ['accessories'] }))
    expect(ok.ok).toBe(true)
  })
})
