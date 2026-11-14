/**
 * `avatarAt`: which avatar a bubble shows at a moment, and the fallback when
 * an image has since gone.
 *
 * @jest-environment node
 */

import { avatarAt, indexAvatarTimeline, type SalonAvatarSegment } from '@/lib/chat/salon-avatar'
import { AVATAR_TIMELINE_BASELINE_AT } from '@/lib/schemas/chat-avatar-timeline.types'

const CLARK = 'clark'
const CURRENT = '/current.webp'

function seg(partial: Partial<SalonAvatarSegment> & { effectiveAt: string }): SalonAvatarSegment {
  return {
    characterId: CLARK,
    imageId: 'img',
    imageUrl: '/img.webp',
    ownAvatar: false,
    source: 'generated',
    missing: false,
    ...partial,
  }
}

const T1 = '2026-11-06T10:00:00.000Z'
const T2 = '2026-11-06T11:00:00.000Z'

describe('avatarAt', () => {
  const glassesOff = indexAvatarTimeline([
    // Given out of order on purpose: the index sorts.
    seg({ effectiveAt: T2, imageId: 'superman', imageUrl: '/superman.webp' }),
    seg({ effectiveAt: AVATAR_TIMELINE_BASELINE_AT, imageId: 'clark', imageUrl: '/clark.webp', source: 'baseline' }),
  ])

  it('shows the look in force when the message was written', () => {
    expect(avatarAt(glassesOff, CLARK, T1, CURRENT)).toEqual({ url: '/clark.webp', from: 'timeline', effectiveAt: AVATAR_TIMELINE_BASELINE_AT })
    expect(avatarAt(glassesOff, CLARK, '2026-11-06T12:00:00.000Z', CURRENT).url).toBe('/superman.webp')
  })

  it('treats a message written at the very moment of the change as after it', () => {
    expect(avatarAt(glassesOff, CLARK, T2, CURRENT).url).toBe('/superman.webp')
  })

  it('reads a missing timestamp as now', () => {
    expect(avatarAt(glassesOff, CLARK, undefined, CURRENT).url).toBe('/superman.webp')
  })

  it('uses the current avatar for a character with no timeline', () => {
    expect(avatarAt(glassesOff, 'lois', T1, CURRENT)).toEqual({ url: CURRENT, from: 'character-current', effectiveAt: null })
  })

  it('shows the character\'s own avatar for an own-avatar row, never the current per-chat one', () => {
    const index = indexAvatarTimeline([
      seg({ effectiveAt: AVATAR_TIMELINE_BASELINE_AT, imageId: null, imageUrl: '/default.webp', ownAvatar: true, source: 'baseline' }),
      seg({ effectiveAt: T2, imageUrl: '/superman.webp' }),
    ])
    expect(avatarAt(index, CLARK, T1, CURRENT)).toMatchObject({ url: '/default.webp', from: 'timeline' })
  })

  it('shows the placeholder for an own-avatar row when the character has no default image', () => {
    const index = indexAvatarTimeline([
      seg({ effectiveAt: AVATAR_TIMELINE_BASELINE_AT, imageId: null, imageUrl: null, ownAvatar: true, source: 'baseline' }),
    ])
    expect(avatarAt(index, CLARK, T1, CURRENT)).toMatchObject({ url: null, from: 'timeline' })
  })

  it('falls back to the latest image in the chat that still exists', () => {
    const index = indexAvatarTimeline([
      seg({ effectiveAt: AVATAR_TIMELINE_BASELINE_AT, imageUrl: null, missing: true, source: 'baseline' }),
      seg({ effectiveAt: T1, imageUrl: '/kept.webp' }),
      seg({ effectiveAt: T2, imageUrl: null, missing: true }),
    ])
    expect(avatarAt(index, CLARK, '2026-11-06T09:00:00.000Z', CURRENT)).toEqual({ url: '/kept.webp', from: 'chat-latest', effectiveAt: T1 })
  })

  it('does not fall back to an own-avatar row\'s default image', () => {
    const index = indexAvatarTimeline([
      seg({ effectiveAt: AVATAR_TIMELINE_BASELINE_AT, imageId: null, imageUrl: '/default.webp', ownAvatar: true, source: 'baseline' }),
      seg({ effectiveAt: T1, imageUrl: null, missing: true }),
    ])
    expect(avatarAt(index, CLARK, T2, CURRENT)).toEqual({ url: CURRENT, from: 'character-current', effectiveAt: null })
  })

  it('falls back to the current avatar when no image in the chat survives', () => {
    const index = indexAvatarTimeline([seg({ effectiveAt: T1, imageUrl: null, missing: true })])
    expect(avatarAt(index, CLARK, T2, CURRENT).from).toBe('character-current')
  })
})
