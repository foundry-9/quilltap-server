/**
 * Paused-chat hold rule (bug 137).
 *
 * A paused room records what the human types and answers none of it; only a
 * summons — Nudge, Skip, the all-LLM modal's Continue — takes the floor, and
 * only for the one turn the chain guard then refuses to extend.
 */

import { shouldHoldUserTurnForPause } from '@/lib/services/chat-message/paused-hold'

describe('shouldHoldUserTurnForPause', () => {
  it('holds a typed message while the chat is paused', () => {
    expect(shouldHoldUserTurnForPause({
      isContinueMode: false,
      chatIsPaused: true,
    })).toBe(true)
  })

  it('lets a typed message through when the chat is not paused', () => {
    expect(shouldHoldUserTurnForPause({
      isContinueMode: false,
      chatIsPaused: false,
    })).toBe(false)
  })

  // Nudge, Skip and the all-LLM modal's Continue all arrive as continue mode.
  // They ARE the human asking for a turn, so the pause must not swallow them —
  // the chain guard is what keeps it to a single turn.
  it('never holds a continue-mode summons, paused or not', () => {
    expect(shouldHoldUserTurnForPause({
      isContinueMode: true,
      chatIsPaused: true,
    })).toBe(false)
  })

  // An autonomous room runs on `runState`, not on the user-facing pause flag.
  it('never holds an autonomous-room turn', () => {
    expect(shouldHoldUserTurnForPause({
      isContinueMode: false,
      chatIsPaused: true,
      neverPauseForUser: true,
    })).toBe(false)
  })
})
