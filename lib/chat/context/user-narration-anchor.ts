/**
 * The trailing scene note on chained multi-character turns.
 *
 * On a chained turn (the second responder onward, or a continue / nudge) no new
 * user message rides at the tail: the human's narration sits mid-history and
 * the newest thing in the prompt is another character's reply. When that reply
 * contradicts the narration — a stopped turn that finished server-side and
 * landed after the human's newer message, or a second tab posting mid-chain —
 * nothing tells the next character which account wins. This note does: the
 * human's latest message is the state of the scene.
 *
 * ## Where it lands
 *
 * Never in the cached prefix. `applyMultiCharacterTurnAnchor` edits system
 * block 1 and must never carry per-turn wording; this is a trailing per-turn
 * section on the uncached tail, pushed by `context-manager.ts` ahead of the
 * progressions report and the turn-skip note on the chained-turn path only.
 * Conditional, not structural, so neither `IDENTITY_STACK_BUILDER_VERSION` nor
 * `PROMPT_CACHE_STRUCTURE_VERSION` moves. Not persisted.
 *
 * ## Empty is byte-for-byte nothing
 *
 * When the note does not apply this returns `''` and the caller pushes nothing,
 * the same contract `lib/progressions/prompt-section.ts` keeps.
 *
 * Design of record: docs/developer/features/prompt-trust-and-anti-committee.md §9.
 */

import { logger } from '@/lib/logger'

const CONTEXT = 'chat.context.user-narration-anchor'

export interface BuildUserNarrationAnchorInput {
  /** Multi-character chat? Single-character chats have no race to settle. */
  isMultiCharacter: boolean
  /** True when this turn carries a new user message (first responder). */
  hasNewUserMessage: boolean
  /**
   * The history window this turn will send, oldest first. In a multi-character
   * chat other characters' replies are attributed to role `user` with their
   * `participantId`, so a character line is recognised by either signal.
   */
  historyWindow: ReadonlyArray<{ role: string; id?: string; participantId?: string | null }>
  /**
   * Row ids of the human's own turns (USER, no `systemSender`), captured
   * before whisper normalization re-roles Staff whispers to USER.
   */
  humanTurnMessageIds: ReadonlySet<string> | null | undefined
  /**
   * Fallback display name, resolved the way `{{user}}` is. Used only when the
   * matched human message's author cannot be named (an unseated user).
   */
  userName: string
  /**
   * Names the author of the matched human message from its `participantId`.
   * The human may drive several seats, and the "Speaking As" selection is not
   * necessarily who wrote the latest line, so the seat that wrote it wins.
   */
  nameForParticipant?: (participantId: string) => string | undefined
}

/** The note itself. Exported for tests and the help page's wording. */
export function renderUserNarrationAnchor(userName: string): string {
  return (
    `Scene note: ${userName}'s most recent message is the current state of the scene. ` +
    `Where any other speaker's line — before or after it — conflicts with what ${userName} narrated, ` +
    `${userName}'s account is what happened. Adjust without arguing; what you do about it is yours.`
  )
}

/**
 * Returns the scene note for a chained multi-character turn where the human
 * has spoken and a character has answered since, or `''` otherwise.
 */
export function buildUserNarrationAnchor(input: BuildUserNarrationAnchorInput): string {
  if (!input.isMultiCharacter || input.hasNewUserMessage) return ''
  const humanIds = input.humanTurnMessageIds
  if (!humanIds || humanIds.size === 0) return ''

  let lastHumanIndex = -1
  for (let i = input.historyWindow.length - 1; i >= 0; i--) {
    const id = input.historyWindow[i].id
    if (id && humanIds.has(id)) {
      lastHumanIndex = i
      break
    }
  }
  if (lastHumanIndex === -1) return ''

  const characterSpokeSince = input.historyWindow
    .slice(lastHumanIndex + 1)
    .some(m => m.role.toLowerCase() === 'assistant' || (!!m.participantId && !(m.id && humanIds.has(m.id))))
  if (!characterSpokeSince) return ''

  const authorParticipantId = input.historyWindow[lastHumanIndex].participantId
  const authorName = (authorParticipantId && input.nameForParticipant?.(authorParticipantId)) || input.userName

  logger.debug('[UserNarrationAnchor] Scene note applies to this chained turn', {
    context: CONTEXT,
    historyWindowSize: input.historyWindow.length,
    lastHumanIndex,
    resolvedFromSeat: authorName !== input.userName,
  })
  return renderUserNarrationAnchor(authorName)
}
