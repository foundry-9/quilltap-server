/**
 * Turn phase: the Staff whispers a turn posts, in transcript order.
 *
 * Each whisper is persisted (the operator sees it in the Salon under its
 * Staff avatar) and its LLM-facing text rides this turn's context, so the
 * model reads it without a turn's lag:
 *
 * 1. The Host marks the time (`postTurnTimestamp`) — its own `user` message.
 * 2. Aurora offers the Core packet (`offerCoreWhisper`) — a trailing section.
 * 3. The Commonplace Book (`postCommonplaceWhispers`) — the consolidated
 *    recall whisper, then the retrospective mini-recap as its own.
 * 4. Suparṇā announces new mail (`announceTurnMail`), then the operator's own
 *    characters' mail is surfaced.
 *
 * Every one is best-effort: a whisper that fails to post costs its whisper,
 * never the turn.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import { sweepPriorWhispers } from '@/lib/chat/whisper-sweep'
import { postHostTimestampAnnouncement, buildTimestampContent } from '@/lib/services/host-notifications/writer'
import {
  assembleCorePacket,
  buildCoreWhisperContent,
  buildCoreWhisperLLMContext,
  buildCoreWhisperOpaqueContent,
  postCoreWhisper,
  resolveCoreWhisperConfig,
} from '@/lib/services/aurora-notifications/core-whisper'
import {
  buildCommonplacePersonaWhisper,
  postCommonplaceWhisper,
  type CommonplaceParts,
} from '@/lib/services/commonplace-notifications/writer'
import {
  buildSuparnaMailLLMContext,
  buildSuparnaMailWhisper,
  postSuparnaMailWhisper,
} from '@/lib/services/suparna-notifications/writer'
import { collectUnalertedMail, type MailAlertsOwed } from '@/lib/post-office/mailbox'
import { surfaceOperatorMailForChat } from '@/lib/post-office/surface-operator-mail'
import { shouldFireCoreWhisper } from './core-whisper-trigger'
import type { TurnTranscript } from './turn-transcript'
import type { Character, ChatMetadataBase, ChatParticipantBase } from '@/lib/schemas/types'
import type { ContextMessage } from '../context-manager'

/**
 * Post the Host's time announcement and return the line this turn's model
 * reads. Only called when the timestamp gate says this turn announces;
 * `formatted` is the same string the scene-state section shows.
 *
 * The line is `role: 'user'`, not `assistant`: a Host timestamp is an external
 * annotation, not the character's speech, and Anthropic 4.6+ rejects an
 * assistant tail — in continue mode nothing follows it.
 */
export async function postTurnTimestamp(chatId: string, formatted: string): Promise<ContextMessage> {
  await postHostTimestampAnnouncement({ chatId, formatted })
  return { role: 'user', content: buildTimestampContent(formatted) }
}

/**
 * Aurora's Core whisper: the character's core packet, offered on its own
 * cadence (`shouldFireCoreWhisper`) and never on a turn without a new user
 * message. Returns the LLM-facing text, or '' when nothing is offered. A fresh
 * whisper replaces the recipient's earlier ones.
 */
export async function offerCoreWhisper(input: {
  chat: ChatMetadataBase
  character: Character
  userId: string
  respondingParticipant?: ChatParticipantBase
  isContinueMode: boolean
  transcript: TurnTranscript
}): Promise<string> {
  const { chat, character, respondingParticipant } = input
  if (!respondingParticipant || input.isContinueMode) return ''
  try {
    const userChatSettings = await getRepositories().chatSettings.findByUserId(input.userId)
    const config = resolveCoreWhisperConfig(chat, character, userChatSettings?.coreWhisper ?? null)
    if (!config.enabled) return ''

    const events = await input.transcript.events()
    const decision = shouldFireCoreWhisper({
      events,
      respondingParticipantId: respondingParticipant.id,
      isContinue: input.isContinueMode,
      isNudge: false,
      interval: config.interval,
      silenceThreshold: config.silenceThreshold,
      fireOnContextTransition: config.fireOnContextTransition,
    })
    if (!decision.fire) return ''

    const packet = await assembleCorePacket(character.id, config.packetTokenBudget)
    if (!packet) return ''

    const posted = await postCoreWhisper({
      chatId: chat.id,
      targetParticipantId: respondingParticipant.id,
      content: buildCoreWhisperContent(packet),
      opaqueContent: buildCoreWhisperOpaqueContent(packet),
    })
    if (posted) {
      await sweepPriorWhispers({
        chatId: chat.id,
        keepId: posted.id,
        targetParticipantId: respondingParticipant.id,
        isSameKind: m => m.systemSender === 'aurora' && m.systemKind === 'core-whisper',
        logTag: '[CoreWhisper]',
      })
    }
    return buildCoreWhisperLLMContext(packet)
  } catch (error) {
    logger.error('[CoreWhisper] Failed to offer Core packet', {
      chatId: chat.id,
      respondingParticipantId: respondingParticipant.id,
      error: getErrorMessage(error),
    }, error as Error)
    return ''
  }
}

/**
 * The Commonplace Book's whispers for this turn.
 *
 * The consolidated whisper is a snapshot, not a record: once it is durably
 * posted, the scene-state section it showed is recorded (`commitSceneState`)
 * and every earlier Commonplace whisper in the scope is swept — except the
 * fold-posted `relevant-conversations` one, which stands across turns and is
 * swept on the fold's own cadence.
 *
 * The retrospective mini-recap is posted after that sweep as its own
 * `retrospective-recall` whisper, so the Salon shows the dated list distinctly
 * and it survives this turn; the next turn's sweep removes it.
 */
export async function postCommonplaceWhispers(input: {
  chatId: string
  targetParticipantId: string | null
  parts: CommonplaceParts
  retrospectiveRecall: string
  commitSceneState: () => Promise<void>
}): Promise<void> {
  const { chatId, targetParticipantId } = input
  const personaWhisper = buildCommonplacePersonaWhisper(input.parts)
  if (personaWhisper) {
    const posted = await postCommonplaceWhisper({ chatId, targetParticipantId, content: personaWhisper, kind: 'consolidated' })
    if (posted) {
      await input.commitSceneState()
      await sweepPriorWhispers({
        chatId,
        keepId: posted.id,
        targetParticipantId,
        isSameKind: m => m.systemSender === 'commonplaceBook' && m.systemKind !== 'relevant-conversations',
        logTag: '[CommonplaceWhisper]',
      })
    }
  }

  if (input.retrospectiveRecall) {
    try {
      await postCommonplaceWhisper({
        chatId,
        targetParticipantId,
        content: buildCommonplacePersonaWhisper({ retrospectiveRecall: input.retrospectiveRecall }),
        kind: 'retrospective-recall',
      })
    } catch (error) {
      logger.warn('[CommonplaceWhisper] Failed to post retrospective-recall whisper', {
        chatId,
        error: getErrorMessage(error),
      })
    }
  }
}

export interface TurnMail {
  /** Suparṇā's LLM-facing announcement, or '' when no mail was announced. */
  llmContext: string
  /** Letters owed an `alerted` flip once the turn delivers them. */
  owed: MailAlertsOwed | null
}

/**
 * Suparṇā's Post Office, after the Commonplace Book.
 *
 * Letters in the responding character's vault not yet announced each get a
 * whisper — an event, not a snapshot, so earlier mail whispers are never
 * swept. They are *not* marked `alerted` here: the turn's call has not been
 * made. They are returned as owed and marked once the turn has delivered them
 * (`markMailAlertsDelivered`), so a provider failure or abort offers them
 * again — at the cost of a second whisper, the honest record of a letter
 * re-announced.
 *
 * A swipe re-rolls a line already spoken; a letter that arrived since does not
 * belong in it (the rule the inform block keeps for new passages), and the
 * swipe path never reaches the finalizer that would mark it, so a regeneration
 * skips the check.
 *
 * The operator's characters never take an LLM turn, so letters addressed to
 * them are surfaced here too, as whispers targeted at their seats
 * (`surfaceOperatorMailForChat`, idempotent and warn-only; the chat-load GET
 * runs the same sweep for idle rooms).
 */
export async function announceTurnMail(input: {
  chat: ChatMetadataBase
  character: Character
  targetParticipantId: string | null
  isRegeneration: boolean
}): Promise<TurnMail> {
  const { chat, character } = input
  const mail: TurnMail = { llmContext: '', owed: null }
  const vaultId = character.characterDocumentMountPointId ?? null

  if (vaultId && !input.isRegeneration) {
    try {
      const unalerted = await collectUnalertedMail(vaultId)
      if (unalerted.length > 0) {
        await postSuparnaMailWhisper({
          chatId: chat.id,
          targetParticipantId: input.targetParticipantId,
          content: buildSuparnaMailWhisper(unalerted),
        })
        mail.llmContext = buildSuparnaMailLLMContext(unalerted)
        mail.owed = { vaultId, paths: unalerted.map(letter => letter.path) }
        logger.debug('[Suparna] Mail announced; alerted flip deferred to delivery', {
          chatId: chat.id,
          characterId: character.id,
          vaultId,
          letters: unalerted.length,
        })
      }
    } catch (error) {
      logger.warn('[Suparna] Mail check failed; turn continues', {
        chatId: chat.id,
        characterId: character.id,
        vaultId,
        error: getErrorMessage(error),
      })
    }
  }

  await surfaceOperatorMailForChat(chat.id, chat.participants)
  return mail
}
