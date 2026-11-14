/**
 * connection_profiles.toolResultVerbatimTurns — the resolver supplies the
 * documented default for missing or junk values (and honours 0, "never
 * elide"); the parser validates request bodies for the profile routes.
 */

import {
  parseToolResultVerbatimTurns,
  resolveToolResultVerbatimTurns,
} from '@/lib/llm/connection-profile-utils'
import {
  DEFAULT_TOOL_RESULT_VERBATIM_TURNS,
  TOOL_RESULT_VERBATIM_TURNS_CEILING,
} from '@/lib/schemas/profile.types'

describe('resolveToolResultVerbatimTurns', () => {
  it('returns a stored window, including 0', () => {
    expect(resolveToolResultVerbatimTurns({ toolResultVerbatimTurns: 0 })).toBe(0)
    expect(resolveToolResultVerbatimTurns({ toolResultVerbatimTurns: 12 })).toBe(12)
  })

  it.each([
    ['missing profile', undefined],
    ['null profile', null],
    ['missing field', {}],
    ['null field', { toolResultVerbatimTurns: null }],
    ['negative', { toolResultVerbatimTurns: -1 }],
    ['fractional', { toolResultVerbatimTurns: 2.5 }],
    ['over the ceiling', { toolResultVerbatimTurns: TOOL_RESULT_VERBATIM_TURNS_CEILING + 1 }],
  ])('falls back to the default for a %s', (_label, profile) => {
    expect(resolveToolResultVerbatimTurns(profile as never)).toBe(DEFAULT_TOOL_RESULT_VERBATIM_TURNS)
  })
})

describe('parseToolResultVerbatimTurns', () => {
  it('accepts whole numbers and numeric strings in range', () => {
    expect(parseToolResultVerbatimTurns(0)).toBe(0)
    expect(parseToolResultVerbatimTurns('20')).toBe(20)
    expect(parseToolResultVerbatimTurns(TOOL_RESULT_VERBATIM_TURNS_CEILING)).toBe(TOOL_RESULT_VERBATIM_TURNS_CEILING)
  })

  it.each([-1, 1.5, '', 'three', TOOL_RESULT_VERBATIM_TURNS_CEILING + 1, null, true])(
    'refuses %p',
    (value) => {
      expect(parseToolResultVerbatimTurns(value)).toBeNull()
    },
  )
})
