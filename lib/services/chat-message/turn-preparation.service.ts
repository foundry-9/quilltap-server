/**
 * Turn Preparation — the per-turn decisions made before a character's context
 * is built.
 *
 * Each helper answers one question a turn asks of its settings and its room:
 * which API key travels with the request, how context compression is set, which
 * cheap model serves the side tasks, whether "nothing to add" is on offer, and
 * whether Prospero is due to brief the character again. They are small on
 * purpose; the orchestrator calls them in order and reads like the turn it
 * builds.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { acceptsApiKey, requiresApiKey } from '@/lib/plugins/provider-validation'
import { getCheapLLMProvider, DEFAULT_CHEAP_LLM_CONFIG, type CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { computeSkipEligibility, qualifiesForTurnSkipping } from '@/lib/chat/turn-manager'
import {
  loadProsperoGeneralContext,
  loadProsperoProjectContext,
  postProsperoContextAnnouncement,
  postProsperoGroupContextWhisper,
} from '@/lib/services/prospero-notifications/writer'
import { ContextCompressionSettingsSchema, type ChatSettings, type ContextCompressionSettings } from '@/lib/schemas/settings.types'
import type { getRepositories } from '@/lib/repositories/factory'
import type { Character, ChatEvent, ChatMetadataBase, ChatParticipantBase, ConnectionProfile } from '@/lib/schemas/types'
import type { TurnSkipOffer } from './turn-outcome.service'

const logger = createServiceLogger('TurnPreparation')

/**
 * The key a turn's request carries. The participant resolver has already
 * decrypted whatever key the profile holds; here a provider that *requires*
 * one refuses the turn without it, and a provider that merely *accepts* one
 * still gets it — `requiresApiKey` alone used to answer both questions and so
 * dropped the key an OpenAI-Compatible profile attached for a hosted endpoint
 * (bug 81). The Courier calls no provider and carries none. A held post
 * calls no provider either, so a missing key never stops it being recorded.
 */
export function resolveTurnApiKey(
  connectionProfile: ConnectionProfile,
  rawApiKey: string,
  options: { held?: boolean } = {}
): string {
  if (connectionProfile.transport === 'courier') return ''
  if (requiresApiKey(connectionProfile.provider) && !rawApiKey && !options.held) {
    throw new Error('No API key configured for this connection profile')
  }
  return acceptsApiKey(connectionProfile.provider) ? rawApiKey : ''
}

/** The operator's compression settings, or the schema's defaults. */
export function resolveContextCompressionSettings(
  chatSettings: Pick<ChatSettings, 'contextCompressionSettings'> | null
): ContextCompressionSettings {
  return chatSettings?.contextCompressionSettings ?? ContextCompressionSettingsSchema.parse({})
}

/**
 * Spend the chat's "full context on the next message" request, if one stands.
 * A held post builds no request, so the flag survives to be spent by the turn
 * the operator eventually asks for.
 */
export async function spendFullContextRequest(
  repos: ReturnType<typeof getRepositories>,
  chat: Pick<ChatMetadataBase, 'id' | 'requestFullContextOnNextMessage'>,
  held: boolean
): Promise<boolean> {
  if (chat.requestFullContextOnNextMessage !== true || held) return false
  await repos.chats.update(chat.id, { requestFullContextOnNextMessage: false })
  logger.info('Bypassing context compression (full context requested)', { chatId: chat.id })
  return true
}

/**
 * The cheap model behind compression, danger classification and proactive
 * recall, plus the profile list the uncensored fallbacks choose from. A failure
 * leaves the selection null and those features are skipped for the turn.
 */
export async function selectTurnCheapLLM(params: {
  repos: ReturnType<typeof getRepositories>
  userId: string
  chatSettings: Pick<ChatSettings, 'cheapLLMSettings'> | null
  connectionProfile: ConnectionProfile
}): Promise<{ cheapLLMSelection: CheapLLMSelection | null; allProfiles: ConnectionProfile[] }> {
  let allProfiles: ConnectionProfile[] = []
  try {
    allProfiles = await params.repos.connections.findByUserId(params.userId)
    const config = params.chatSettings?.cheapLLMSettings || DEFAULT_CHEAP_LLM_CONFIG
    const cheapLLMSelection = getCheapLLMProvider(
      params.connectionProfile,
      {
        ...config,
        // CheapLLMConfig reads absent ids as undefined, never null.
        userDefinedProfileId: config.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: config.defaultCheapProfileId ?? undefined,
      },
      allProfiles,
      false // Ollama availability is not probed per turn
    )
    return { cheapLLMSelection, allProfiles }
  } catch (error) {
    logger.warn('Failed to get cheap LLM provider, features requiring it will be skipped', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { cheapLLMSelection: null, allProfiles }
  }
}

/**
 * Whether this character may be offered the "nothing to add" pass this turn.
 * Only meaningful in multi-character chats with an LLM-controlled responder.
 * A summoned voice (nudge or queue-pop) is not offered a pass. A storyteller
 * turn may always pass — the operator chose the speaker, but the moment its
 * plan was for may have gone by — and its plan section carries the
 * instruction. A bid is not a turn and is offered nothing.
 */
export function resolveTurnSkipOffer(params: {
  chat: Pick<ChatMetadataBase, 'participants' | 'turnSkippingEnabled'>
  existingMessages: ChatEvent[]
  character: Character
  characterParticipant: ChatParticipantBase
  isStorytellerTurn: boolean
  isBid: boolean
  summoned: boolean
}): TurnSkipOffer | undefined {
  const { chat, character, characterParticipant } = params
  if (params.isStorytellerTurn) {
    return { offerSkip: true, recentlyAddressed: false, characterName: character.name }
  }
  if (params.isBid || !qualifiesForTurnSkipping(chat.participants) || characterParticipant.controlledBy === 'user') {
    return undefined
  }
  const eligibility = computeSkipEligibility({
    events: params.existingMessages,
    participants: chat.participants,
    respondingParticipantId: characterParticipant.id,
    respondingCharacter: character,
    summoned: params.summoned,
    turnSkippingEnabled: chat.turnSkippingEnabled !== false,
  })
  return {
    offerSkip: eligibility.offerSkip,
    recentlyAddressed: eligibility.recentlyAddressed,
    characterName: character.name,
  }
}

/**
 * Prospero's cadence refresh. The chat-start briefing is posted when the chat
 * is created (`createInitialMessagesScenarioAndStaff`); after that, every
 * `projectContextReinjectInterval` messages a fresh briefing — the project's
 * description, instructions and linked stores beside the always-on Quilltap
 * General shelf, in one public message — keeps them in the character's mind,
 * along with a targeted whisper of the character's own group stores (gated by
 * membership, so never public). Both brief the character about to take the
 * floor, so a held post or a bid waits for a real turn. Whatever is posted is
 * pushed onto the turn's in-memory context.
 */
export async function reinjectProsperoContext(params: {
  chatId: string
  project: { id: string } | null
  existingMessages: ChatEvent[]
  reinjectInterval: number
  /** A concurrent storyteller follower: the group's first turn already posted the public briefing. */
  concurrentFollower: boolean
  character: Pick<Character, 'id'>
  characterParticipant: Pick<ChatParticipantBase, 'id'>
}): Promise<void> {
  const { chatId, existingMessages, reinjectInterval } = params
  const messageCount = existingMessages.filter(m => m.type === 'message').length
  // messageCount 0 is the chat-start briefing's.
  if (reinjectInterval <= 0 || messageCount === 0 || messageCount % reinjectInterval !== 0) return

  logger.debug('[TurnPreparation] Prospero context refresh due', { chatId, messageCount, reinjectInterval })

  const projectContext = params.project ? await loadProsperoProjectContext(params.project.id) : null
  const generalContext = await loadProsperoGeneralContext()
  if ((projectContext || generalContext) && !params.concurrentFollower) {
    const posted = await postProsperoContextAnnouncement({ chatId, project: projectContext, general: generalContext })
    if (posted) existingMessages.push(posted)
  }

  try {
    const groupWhisper = await postProsperoGroupContextWhisper({
      chatId,
      targetParticipantId: params.characterParticipant.id,
      characterId: params.character.id,
    })
    if (groupWhisper) existingMessages.push(groupWhisper)
  } catch (error) {
    logger.warn('[TurnPreparation] Failed to post Prospero group-context whisper', {
      chatId,
      characterId: params.character.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
