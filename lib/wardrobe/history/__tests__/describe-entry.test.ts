/**
 * Outfit-history rendering: stale ids marked rather than dropped, a plain-text
 * one-line summary, and the "changed by" labels.
 *
 * @jest-environment node
 */

import {
  changedByLabel,
  resolveHistorySlots,
  staleItemsOf,
  summarizeHistorySlots,
} from '@/lib/wardrobe/history/describe-entry'
import { makeEmptyEquippedSlots } from '@/lib/schemas/wardrobe.types'
import type { WearablePool } from '@/lib/wardrobe/pool'

const ITEMS = new Map<string, { id: string; title: string; archivedAt?: string }>([
  ['dress', { id: 'dress', title: 'Green Dress' }],
  ['coat', { id: 'coat', title: 'Greatcoat', archivedAt: '2026-10-01T00:00:00.000Z' }],
])
const POOL = { get: (id: string) => ITEMS.get(id) } as unknown as WearablePool

describe('describe-entry', () => {
  const slots = { ...makeEmptyEquippedSlots(), top: ['dress', 'coat'], accessories: ['gone'] }

  it('marks archived and missing ids instead of dropping them', () => {
    const resolved = resolveHistorySlots(POOL, slots)
    expect(resolved.top).toEqual([
      { itemId: 'dress', title: 'Green Dress', archived: false, missing: false },
      { itemId: 'coat', title: 'Greatcoat', archived: true, missing: false },
    ])
    expect(resolved.accessories).toEqual([{ itemId: 'gone', title: null, archived: false, missing: true }])
    expect(staleItemsOf(resolved).map((i) => i.itemId)).toEqual(['coat', 'gone'])
  })

  it('summarizes on one plain line, with no Markdown', () => {
    const summary = summarizeHistorySlots(resolveHistorySlots(POOL, slots))
    expect(summary).not.toMatch(/\n|\*\*|^- /)
    expect(summary).toContain('Greatcoat (archived)')
    expect(summary).toContain('gone (no longer exists)')
  })

  it('labels who changed it', () => {
    const base = { characterId: 'a', actorCharacterId: null }
    expect(changedByLabel({ ...base, source: 'operator' }, null, 'you')).toBe('the operator')
    expect(changedByLabel({ ...base, source: 'character', actorCharacterId: 'a' }, null, 'you')).toBe('you')
    expect(changedByLabel({ ...base, source: 'character', actorCharacterId: 'b' }, 'Jeeves', 'you')).toBe('Jeeves')
    expect(changedByLabel({ ...base, source: 'pascal', actorCharacterId: 'a' }, null, 'you')).toBe('Pascal')
    expect(changedByLabel({ ...base, source: 'seeded' }, null, 'you')).toBe('before history was kept')
    expect(changedByLabel({ ...base, source: 'chat-start' }, null, 'you')).toBe('chat opened')
  })
})
