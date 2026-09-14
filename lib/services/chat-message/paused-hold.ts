/**
 * Paused-chat hold rule.
 *
 * A paused conversation never moves on its own. The rule has two halves, and
 * they live in different places:
 *
 *  - **Nothing follows a turn.** `executeTurnChain` / `shouldChainNext` stop the
 *    rotation for as long as `isPaused` stands. That half predates this module.
 *  - **Nothing starts one either.** This predicate. A message typed into a
 *    paused room is recorded in full and answered by nobody; the floor waits
 *    where the user left it.
 *
 * Together they mean a paused room only ever speaks when the human asks it to,
 * one turn at a time, and only Resume lets it carry on by itself.
 */

/** What the hold rule needs to know about a send. */
export interface PausedHoldInput {
  /** True for the explicit summons — Nudge, Skip, the all-LLM modal's Continue,
   *  an autonomous-room turn. These ARE the human asking, so they run. */
  isContinueMode: boolean
  /** The chat's persisted `isPaused` as read at the top of the turn. */
  chatIsPaused: boolean
  /** Autonomous rooms keep their own lifecycle (`runState`) and opt out of every
   *  user-facing pause; `isPaused` is not their flag to obey. */
  neverPauseForUser?: boolean
}

/**
 * Whether this send should be recorded without drawing a reply.
 *
 * Note what is NOT consulted: whisper targets, an explicit responding
 * participant, attachments, staged tool results. A paused room holds every
 * typed message the same way — the only thing that takes the floor is a turn
 * the human summons.
 */
export function shouldHoldUserTurnForPause(input: PausedHoldInput): boolean {
  if (input.isContinueMode) return false
  if (input.neverPauseForUser === true) return false
  return input.chatIsPaused === true
}
