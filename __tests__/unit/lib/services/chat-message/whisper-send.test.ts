/**
 * Operator whispers run single-turn and queue behind an open stream (bug 258).
 * The queueing itself is `waitForEarlierTurns` (turn-control.test.ts); this is
 * the classification that decides a send gets that treatment.
 */

import { isOperatorWhisperSend } from '@/lib/services/chat-message/whisper-send'

describe('isOperatorWhisperSend', () => {
  it('is true for a fresh send with whisper targets', () => {
    expect(isOperatorWhisperSend({ targetParticipantIds: ['p-1'] })).toBe(true)
    expect(isOperatorWhisperSend({ continueMode: false, targetParticipantIds: ['p-1', 'p-2'] })).toBe(true)
  })

  it('is false for a public send', () => {
    expect(isOperatorWhisperSend({})).toBe(false)
    expect(isOperatorWhisperSend({ targetParticipantIds: null })).toBe(false)
    expect(isOperatorWhisperSend({ targetParticipantIds: [] })).toBe(false)
  })

  it('is false for a chained or continued turn, whatever it carries', () => {
    expect(isOperatorWhisperSend({ continueMode: true, targetParticipantIds: ['p-1'] })).toBe(false)
  })
})
