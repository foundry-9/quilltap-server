/**
 * Operator whispers — how a whisper send differs from a public post.
 *
 * Client-safe and pure; `handleSendMessage` (`orchestrator.service.ts`) is the
 * one caller.
 */

import type { SendMessageOptions } from './types'

/**
 * Is this send the operator whispering to one or more characters (the Whisper
 * dialog), rather than a public post or a chained turn?
 *
 * A whisper is an aside, not a round: its target answers once and the floor
 * goes back to the operator. It also waits for any stream already running in
 * the chat instead of opening a second speaker beside it. Before bug 258 it
 * ran a whole turn chain of its own, in a stream the Salon never displayed,
 * alongside whatever chain was already going, both drawing from the same turn
 * queue and rotation.
 */
export function isOperatorWhisperSend(
  options: Pick<SendMessageOptions, 'continueMode' | 'targetParticipantIds'>
): boolean {
  return options.continueMode !== true && (options.targetParticipantIds?.length ?? 0) > 0
}
