/**
 * Raised-hand yielding: the `[YIELD]` sentinel and the Turn note that offers it.
 */

import { describe, it, expect } from '@jest/globals'
import {
  YIELD_SENTINEL,
  TURN_YIELD_SYSTEM_KIND,
  detectYieldSentinel,
  isGestureOnlyReply,
  buildTurnYieldInstruction,
} from '@/lib/chat/turn-manager'

describe('detectYieldSentinel', () => {
  it('reads a bare sentinel as a yield with nothing else said', () => {
    expect(detectYieldSentinel('[YIELD]')).toEqual({ yielded: true, cleaned: '' })
  })

  it('forgives case, brackets, wrapping markdown and trailing punctuation', () => {
    for (const form of ['[yield]', 'YIELD', '**[YIELD]**', '`[Yield]`', '_yield._', '[YIELD]!']) {
      expect(detectYieldSentinel(form)).toEqual({ yielded: true, cleaned: '' })
    }
  })

  it('keeps the prose that follows a sentinel line as the reply', () => {
    const result = detectYieldSentinel('[YIELD]\n\n*She gestures for you to go on.*')
    expect(result).toEqual({ yielded: true, cleaned: '*She gestures for you to go on.*' })
  })

  it('honours a sentinel tacked on as the last line', () => {
    const result = detectYieldSentinel('"After you, my dear."\n\n[YIELD]')
    expect(result).toEqual({ yielded: true, cleaned: '"After you, my dear."' })
  })

  it('honours a bracketed sentinel opening a line of prose', () => {
    const result = detectYieldSentinel('[YIELD] By all means, speak.')
    expect(result).toEqual({ yielded: true, cleaned: 'By all means, speak.' })
  })

  it('strips a leading own-name prefix before looking', () => {
    expect(detectYieldSentinel('Alice: [YIELD]', 'Alice')).toEqual({ yielded: true, cleaned: '' })
  })

  it('does not mistake the word "yield" in prose for the sentinel', () => {
    expect(detectYieldSentinel('I shall not yield the point so easily.')).toEqual({ yielded: false })
    expect(detectYieldSentinel('Yield to no one, she said, and meant it.')).toEqual({ yielded: false })
  })

  it('reads a gesture-only reply as an inferred yield, keeping the gesture', () => {
    const gesture = '*(a tilt of the head, one hand opening toward Tester — go on, then)*'
    expect(detectYieldSentinel(gesture, 'Riya')).toEqual({ yielded: true, cleaned: gesture, inferred: true })
    expect(detectYieldSentinel('Riya: *steps back and sweeps a hand toward you*', 'Riya'))
      .toEqual({ yielded: true, cleaned: '*steps back and sweeps a hand toward you*', inferred: true })
  })

  it('reads a reply with spoken words or a long beat as carrying on', () => {
    expect(detectYieldSentinel('*nods* "Go on, then."')).toEqual({ yielded: false })
    expect(detectYieldSentinel('*nods* Go on, then. *smiles*')).toEqual({ yielded: false })
    expect(detectYieldSentinel(`*${'she works the knot loose and frowns at the water '.repeat(8)}*`)).toEqual({ yielded: false })
    expect(detectYieldSentinel('*She looks up.*\n\n*She looks down again.*')).toEqual({ yielded: false })
  })

  it('reads an ordinary reply, or nothing, as no yield', () => {
    expect(detectYieldSentinel('The tea is getting cold.')).toEqual({ yielded: false })
    expect(detectYieldSentinel('')).toEqual({ yielded: false })
    expect(detectYieldSentinel('   \n  ')).toEqual({ yielded: false })
  })
})

describe('isGestureOnlyReply', () => {
  it('accepts a single wrapped stage direction in any of the usual wrappers', () => {
    for (const form of ['*bows*', '_bows_', '(bows)', '**bows**', '*(bows to Tester)*', "*It's yours, the gesture says.*"]) {
      expect(isGestureOnlyReply(form)).toBe(true)
    }
  })

  it('refuses bare prose, quoted speech, empty wrappers and prose between directions', () => {
    for (const form of ['bows', '"After you."', '*bows* "After you."', '**', '*…*', '*nods* Fine. *smiles*', '']) {
      expect(isGestureOnlyReply(form)).toBe(false)
    }
  })
})

describe('buildTurnYieldInstruction', () => {
  it('names the operator and offers the exact sentinel', () => {
    const note = buildTurnYieldInstruction('Charlie')
    expect(note).toContain('Charlie has raised a hand')
    expect(note).toContain(YIELD_SENTINEL)
    expect(note).toMatch(/^\[Turn note from the Salon/)
    expect(note).toContain('only a gesture')
  })
})

describe('TURN_YIELD_SYSTEM_KIND', () => {
  it('is the Host message kind the writer stamps on a yield', () => {
    expect(TURN_YIELD_SYSTEM_KIND).toBe('turn-yield')
  })
})
