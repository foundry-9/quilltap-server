/**
 * Turn phase: the trailing context sections, and the message that carries them.
 *
 * The sections ride the uncached tail of the request, in their one order (see
 * `TrailingSections`). They are composed once and delivered by one function,
 * `composeTrailingMessage`, onto the new user message when there is one or as
 * their own trailing user message when there is not — two hand-kept copies of
 * that list is how recall, mail and the Core whisper went missing from turns
 * with no new user message while their side effects still ran (bug 199).
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import { resolveSpeakerNames, speakerLabel } from '@/lib/chat/speaker-names'
import { presenceOf, spokenText } from '@/lib/chat/absent-mentions'
import { renderOffSceneCard } from '@/lib/services/host-notifications/writer'
import { buildTurnSkipInstruction } from '@/lib/chat/turn-manager/skip-signal'
import { buildTurnYieldInstruction } from '@/lib/chat/turn-manager/yield-signal'
import {
  buildClosingEcho,
  buildReferentLedger,
  REFERENT_LEDGER_WINDOW_LINES,
  type ReferentLedgerLine,
} from './referent-ledger'
import type { TurnTranscript } from './turn-transcript'
import type { Character, ChatMetadataBase, ChatParticipantBase } from '@/lib/schemas/types'
import type { ContextMessage } from '../context-manager'

/** Between the new user message and the sections, and between sections. */
const TRAILING_SECTION_SEPARATOR = '\n\n---\n\n'

/**
 * The trailing sections, in their one order: who the character is (the Core
 * whisper), what it remembers (recall), what arrived for it (mail), what it is
 * carrying (progressions, then the Inventory), what the operator says is so
 * (the inform block — after recall, so a memory that contradicts it comes
 * first), who the conversation is about (the referent ledger), the line being
 * answered (the closing echo), and the turn notes last. Empty-is-absent: an
 * empty section adds nothing, not even a separator.
 */
export interface TrailingSections {
  coreWhisper: string
  recall: string
  mail: string
  progressions: string
  inventory: string
  inform: string | null
  referentLedger: string
  closingEcho: string
  turnSkip: string
  turnYield: string
  storyteller?: string
}

function orderedSections(s: TrailingSections): string[] {
  return [
    s.coreWhisper,
    s.recall,
    s.mail,
    s.progressions,
    s.inventory,
    s.inform,
    s.referentLedger,
    s.closingEcho,
    s.turnSkip,
    s.turnYield,
    s.storyteller,
  ].filter((section): section is string => !!section)
}

/**
 * The message that carries the trailing sections.
 *
 * With a new user message they follow it in the same message. Without one (a
 * chained speaker, a continue, a nudge, an autonomous turn) they ride their
 * own trailing `user` message — Anthropic 4.6+ rejects an assistant tail — led
 * by the scene note, which is about the scene where the rest are about the
 * character. That message may follow a user-role line (every other seat's line
 * is attributed `user` in a multi-character chat); OpenAI-compatible APIs
 * accept adjacent user messages, Anthropic's combines them, and the Google
 * plugin merges them before sending.
 *
 * Null when there is neither a new user message nor any section.
 */
export function composeTrailingMessage(input: {
  newUserMessage?: string
  /** The new user message's `name`, in a multi-character chat. */
  newUserName?: string
  sections: TrailingSections
  /** The chained-turn scene note (`buildUserNarrationAnchor`); '' when it does not apply. */
  narrationAnchor: string
}): ContextMessage | null {
  const sections = orderedSections(input.sections)
  if (input.newUserMessage) {
    return {
      role: 'user',
      content: [input.newUserMessage, ...sections].join(TRAILING_SECTION_SEPARATOR),
      name: input.newUserName,
      metadata: { isUserTurn: true },
    }
  }
  const trailingOnly = [input.narrationAnchor, ...sections].filter(section => !!section)
  return trailingOnly.length > 0 ? { role: 'user', content: trailingOnly.join(TRAILING_SECTION_SEPARATOR) } : null
}

/**
 * The ephemeral Turn notes — never persisted, read last of all. The skip note
 * when the orchestrator has decided this character may pass; the yield note
 * when the operator has raised a hand and this is the character asked.
 */
export function buildTurnNotes(input: {
  turnSkip?: { offerSkip: boolean; recentlyAddressed: boolean; characterName: string }
  offerYield?: boolean
  operatorName: string
  chatId: string
  participantId?: string
}): { turnSkip: string; turnYield: string } {
  const turnSkip = input.turnSkip?.offerSkip
    ? buildTurnSkipInstruction(input.turnSkip.characterName, input.turnSkip.recentlyAddressed)
    : ''
  const turnYield = input.offerYield ? buildTurnYieldInstruction(input.operatorName) : ''
  if (turnYield) {
    logger.debug('[TurnYield] Offering the yield note to the next speaker', {
      chatId: input.chatId,
      participantId: input.participantId,
    })
  }
  return { turnSkip, turnYield }
}

/**
 * The referent ledger and the closing echo: who the last few spoken lines
 * were about, and the line being answered, repeated after recall so it is the
 * last thing the model reads about the conversation. Reads only, and never
 * fails the turn (`referent-ledger.ts`).
 */
export async function buildReferentSections(input: {
  chat: ChatMetadataBase
  userId: string
  character: Character
  userCharacter?: { name: string } | null
  respondingParticipant?: ChatParticipantBase
  allParticipants?: ChatParticipantBase[]
  activeUserParticipantId?: string | null
  newUserMessage?: string
  transcript: TurnTranscript
}): Promise<{ referentLedger: string; closingEcho: string }> {
  const { chat, respondingParticipant } = input
  try {
    const participants = input.allParticipants ?? chat.participants ?? []
    const speakerNames = await resolveSpeakerNames({ participants })
    const userName = input.userCharacter?.name || 'User'
    type SpokenRow = { role?: string; participantId?: string | null }
    const labelFor = (m: SpokenRow): string => {
      const label = speakerLabel(
        { role: (m.role || '').toUpperCase() as 'USER' | 'ASSISTANT', participantId: m.participantId ?? undefined },
        speakerNames,
      )
      return label === 'User' ? userName : label
    }
    const isResponderLine = (m: SpokenRow): boolean =>
      respondingParticipant
        ? m.participantId === respondingParticipant.id
        : (m.role || '').toUpperCase() === 'ASSISTANT'

    const events = await input.transcript.events()
    const spoken: ReferentLedgerLine[] = []
    for (let i = events.length - 1; i >= 0 && spoken.length < REFERENT_LEDGER_WINDOW_LINES; i--) {
      const m = events[i] as Parameters<typeof spokenText>[0] & SpokenRow
      const content = spokenText(m)
      if (content) spoken.unshift({ speaker: labelFor(m), isResponder: isResponderLine(m), content })
    }

    // The new user message is normally persisted before the context is built;
    // when it is not (or not yet), it is still the line being answered.
    const userSpeaker = (input.activeUserParticipantId && speakerNames.get(input.activeUserParticipantId)) || userName
    const latestSpoken = spoken[spoken.length - 1]
    if (input.newUserMessage && latestSpoken?.content.trim() !== input.newUserMessage.trim()) {
      spoken.push({ speaker: userSpeaker, isResponder: false, content: input.newUserMessage })
    }

    // The same presence rule the Salon's name chips use: seated characters,
    // and an unseated persona wherever the operator speaks without a seat.
    const isInRoom = presenceOf({
      participants: input.allParticipants ?? chat.participants,
      chatType: chat.chatType,
      personaName: input.userCharacter?.name,
    })
    const people = (await getRepositories().characters.findByUserId(input.userId)).map(c => {
      const inRoom = isInRoom(c)
      return {
        id: c.id,
        name: c.name,
        aliases: c.aliases ?? null,
        pronouns: c.pronouns ?? null,
        inRoom,
        // Absent people bring their card — the particulars the Salon's
        // name-chip popup shows the operator.
        renderCard: inRoom
          ? undefined
          : () => renderOffSceneCard(
              {
                id: c.id,
                name: c.name,
                aliases: c.aliases ?? undefined,
                pronouns: c.pronouns ?? undefined,
                identity: c.identity ?? undefined,
                description: c.description ?? undefined,
              },
              input.userCharacter?.name,
            ),
      }
    })

    return {
      referentLedger: buildReferentLedger({ lines: spoken, people, responderId: input.character.id }),
      closingEcho: buildClosingEcho({ newUserMessage: input.newUserMessage, speakerName: userSpeaker }),
    }
  } catch (error) {
    logger.warn('[ReferentLedger] Could not build the referent ledger; turn continues', {
      chatId: chat.id,
      error: getErrorMessage(error),
    })
    return { referentLedger: '', closingEcho: '' }
  }
}
