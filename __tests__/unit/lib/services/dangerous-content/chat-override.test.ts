/**
 * Tests for lib/services/dangerous-content/chat-override.ts
 */

import {
  isConciergeOffDuty,
  isChatActiveDangerous,
  getConciergeState,
} from '@/lib/services/dangerous-content/chat-override'

describe('isConciergeOffDuty', () => {
  it('returns false for null/undefined chat', () => {
    expect(isConciergeOffDuty(null)).toBe(false)
    expect(isConciergeOffDuty(undefined)).toBe(false)
  })

  it('returns false when conciergeOverride is missing', () => {
    expect(isConciergeOffDuty({})).toBe(false)
  })

  it('returns false when conciergeOverride is null', () => {
    expect(isConciergeOffDuty({ conciergeOverride: null })).toBe(false)
  })

  it("returns true when conciergeOverride is 'OFF'", () => {
    expect(isConciergeOffDuty({ conciergeOverride: 'OFF' })).toBe(true)
  })
})

describe('isChatActiveDangerous', () => {
  it('returns false for null/undefined chat', () => {
    expect(isChatActiveDangerous(null)).toBe(false)
    expect(isChatActiveDangerous(undefined)).toBe(false)
  })

  it('returns false when isDangerousChat is missing', () => {
    expect(isChatActiveDangerous({ conciergeOverride: null })).toBe(false)
  })

  it('returns false when isDangerousChat is false', () => {
    expect(isChatActiveDangerous({ isDangerousChat: false, conciergeOverride: null })).toBe(false)
  })

  it('returns true when isDangerousChat is true and override is null', () => {
    expect(isChatActiveDangerous({ isDangerousChat: true, conciergeOverride: null })).toBe(true)
  })

  it('returns false when Off-duty, even with isDangerousChat=true (override wins)', () => {
    expect(isChatActiveDangerous({ isDangerousChat: true, conciergeOverride: 'OFF' })).toBe(false)
  })

  it('returns false when Off-duty with isDangerousChat=false', () => {
    expect(isChatActiveDangerous({ isDangerousChat: false, conciergeOverride: 'OFF' })).toBe(false)
  })
})

describe('getConciergeState', () => {
  it("returns 'safe' for null/undefined chat", () => {
    expect(getConciergeState(null)).toBe('safe')
    expect(getConciergeState(undefined)).toBe('safe')
  })

  it("returns 'safe' when not classified dangerous and on-duty", () => {
    expect(getConciergeState({ isDangerousChat: false, conciergeOverride: null })).toBe('safe')
    expect(getConciergeState({ conciergeOverride: null })).toBe('safe')
  })

  it("returns 'flagged' when classified dangerous and on-duty", () => {
    expect(getConciergeState({ isDangerousChat: true, conciergeOverride: null })).toBe('flagged')
  })

  it("returns 'off' when Off-duty, regardless of the preserved label", () => {
    expect(getConciergeState({ isDangerousChat: true, conciergeOverride: 'OFF' })).toBe('off')
    expect(getConciergeState({ isDangerousChat: false, conciergeOverride: 'OFF' })).toBe('off')
  })

  it('stays consistent with isChatActiveDangerous', () => {
    const cases = [
      { isDangerousChat: true, conciergeOverride: null },
      { isDangerousChat: true, conciergeOverride: 'OFF' as const },
      { isDangerousChat: false, conciergeOverride: null },
      { isDangerousChat: false, conciergeOverride: 'OFF' as const },
    ]
    for (const c of cases) {
      expect(isChatActiveDangerous(c)).toBe(getConciergeState(c) === 'flagged')
    }
  })
})
