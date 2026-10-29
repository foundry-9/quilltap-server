/**
 * Raised-hand yielding: the `[YIELD]` sentinel and the Turn note that offers it.
 */

import { describe, it, expect } from '@jest/globals'
import {
  YIELD_SENTINEL,
  TURN_YIELD_SYSTEM_KIND,
  detectYieldSentinel,
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

  it('reads an ordinary reply, or nothing, as no yield', () => {
    expect(detectYieldSentinel('The tea is getting cold.')).toEqual({ yielded: false })
    expect(detectYieldSentinel('')).toEqual({ yielded: false })
    expect(detectYieldSentinel('   \n  ')).toEqual({ yielded: false })
  })
})

describe('buildTurnYieldInstruction', () => {
  it('names the operator and offers the exact sentinel', () => {
    const note = buildTurnYieldInstruction('Charlie')
    expect(note).toContain('Charlie has raised a hand')
    expect(note).toContain(YIELD_SENTINEL)
    expect(note).toMatch(/^\[Turn note from the Salon/)
  })
})

describe('TURN_YIELD_SYSTEM_KIND', () => {
  it('is the Host message kind the writer stamps on a yield', () => {
    expect(TURN_YIELD_SYSTEM_KIND).toBe('turn-yield')
  })
})
