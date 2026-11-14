/**
 * The staff's opening posts: Prospero's context briefing and per-seat group
 * whispers, the Host's scenario, and the Host's introduction of the operator's
 * character. Each is one phase of the opening (`run.ts`), in the order a new
 * chat's transcript has always shown them.
 *
 * Every post is idempotent against the transcript: a phase re-run after a
 * break (a closed tab, a restart) checks for its own row by `systemSender` /
 * `systemKind` before posting, so a resumed opening never posts twice. Every
 * post fails soft — the opening goes on without it.
 *
 * Server-only.
 *
 * @module chat/opening/staff
 */

import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types'
import {
  loadProsperoGeneralContext,
  loadProsperoProjectContext,
  postProsperoContextAnnouncement,
  postProsperoGroupContextWhisper,
} from '@/lib/services/prospero-notifications/writer'
import {
  postHostScenarioAnnouncement,
  postHostUserCharacterAnnouncement,
} from '@/lib/services/host-notifications/writer'

/** How a staff phase is being run. */
export interface StaffPhaseOptions {
  /**
   * The opening is resuming after a break: skip a post this chat already has.
   * Only then — a continuation's replayed history carries the source chat's
   * staff rows, and a first opening posts its own regardless.
   */
  resuming: boolean
}

/** The chat's staff rows, read once per check; none when not resuming. */
async function staffRows(repos: RepositoryContainer, chatId: string, opts: StaffPhaseOptions): Promise<MessageEvent[]> {
  if (!opts.resuming) return []
  const messages = await repos.chats.getMessages(chatId)
  return messages.filter(
    (m): m is MessageEvent => m.type === 'message' && !!(m as MessageEvent).systemSender,
  )
}

function hasRow(
  rows: MessageEvent[],
  sender: NonNullable<MessageEvent['systemSender']>,
  kinds: readonly string[],
  targetParticipantId?: string,
): boolean {
  return rows.some((m) =>
    m.systemSender === sender
    && !!m.systemKind && kinds.includes(m.systemKind)
    && (!targetParticipantId || (m.targetParticipantIds ?? []).includes(targetParticipantId)),
  )
}

const PROSPERO_CONTEXT_KINDS = ['project-and-general-context', 'project-context', 'general-context'] as const

/**
 * Prospero's chat-start briefing — the project's description, instructions and
 * linked stores with the always-on Quilltap General shelf, or General alone —
 * and then, per character, a targeted whisper naming the stores they reach by
 * group membership plus their own vault.
 */
export async function postProsperoOpening(repos: RepositoryContainer, chat: ChatMetadata, opts: StaffPhaseOptions): Promise<void> {
  const rows = await staffRows(repos, chat.id, opts)
  try {
    if (!hasRow(rows, 'prospero', PROSPERO_CONTEXT_KINDS)) {
      const projectContext = chat.projectId ? await loadProsperoProjectContext(chat.projectId) : null
      const generalContext = await loadProsperoGeneralContext()
      if (projectContext || generalContext) {
        await postProsperoContextAnnouncement({ chatId: chat.id, project: projectContext, general: generalContext })
      }
    }
  } catch (error) {
    logger.warn('[Opening] Failed to post the Prospero context briefing', {
      chatId: chat.id,
      projectId: chat.projectId,
      error: getErrorMessage(error),
    })
  }

  try {
    for (const participant of chat.participants) {
      if (participant.type !== 'CHARACTER' || !participant.characterId) continue
      if (participant.status === 'removed') continue
      if (hasRow(rows, 'prospero', ['group-context'], participant.id)) continue
      await postProsperoGroupContextWhisper({
        chatId: chat.id,
        targetParticipantId: participant.id,
        characterId: participant.characterId,
      })
    }
  } catch (error) {
    logger.warn('[Opening] Failed to post the Prospero group-context whispers', {
      chatId: chat.id,
      error: getErrorMessage(error),
    })
  }
}

/** The Host sets the scene, when there is one. */
export async function postHostScenarioOpening(repos: RepositoryContainer, chat: ChatMetadata, opts: StaffPhaseOptions): Promise<void> {
  const scenarioText = chat.scenarioText?.trim()
  if (!scenarioText) return
  if (hasRow(await staffRows(repos, chat.id, opts), 'host', ['scenario'])) return
  await postHostScenarioAnnouncement({ chatId: chat.id, scenarioText })
}

/** The Host introduces the operator's character to the room, when one is seated. */
export async function postHostUserCharacterOpening(repos: RepositoryContainer, chat: ChatMetadata, opts: StaffPhaseOptions): Promise<void> {
  const userSeat = chat.participants.find(
    (p) => p.type === 'CHARACTER' && p.controlledBy === 'user' && p.characterId && p.status !== 'removed',
  )
  if (!userSeat?.characterId) return
  if (hasRow(await staffRows(repos, chat.id, opts), 'host', ['user-character'])) return
  const userCharacter = await repos.characters.findById(userSeat.characterId).catch(() => null)
  if (!userCharacter) return
  await postHostUserCharacterAnnouncement({
    chatId: chat.id,
    userCharacterName: userCharacter.name,
    userCharacterDescription: userCharacter.description ?? null,
  })
}
