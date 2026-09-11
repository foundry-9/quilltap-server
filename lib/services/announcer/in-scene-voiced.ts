/**
 * In-scene voiced line rewriter — the rehearsal for an impersonated seat.
 *
 * The operator has taken a character's seat with the Salon's Impersonate
 * button (`chat.impersonatingParticipantIds` — the Bug 44 overlay, which
 * leaves the seat's `controlledBy` and its profile/prompt selections intact)
 * and typed a line. This hands that line back to the character whose seat it
 * is and asks them to say it in their own voice, given where the scene has
 * actually got to.
 *
 * Where the off-scene rehearsal (`character-voiced.ts`) tells the character
 * they stand outside the conversation, this one puts them in the room: they get
 * their per-turn system prompt (identity stack, roleplay template, Taboo,
 * standing instructions — deliberately NO tool instructions), the tail of the
 * transcript shaped exactly as they would see it on a real turn, a Commonplace
 * recall against the draft, and then the draft itself with the instruction to
 * restate it.
 *
 * Pure and side-effect-free apart from the provider call and its LLM log row:
 * nothing about the rehearsal is persisted, and it never throws — a failure
 * comes back as `{ success: false, error }` so the dialog can keep offering
 * "Send as written".
 */

import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import { getRepositories } from '@/lib/repositories/factory'
import type {
  ChatEvent,
  ChatMetadataBase,
  Character,
  ChatParticipantBase,
  ConnectionProfile,
} from '@/lib/schemas/types'
import type { SubpromptForPrompt } from '@/lib/subprompts/subprompts'
import { selectionFromProfile } from '@/lib/llm/cheap-llm'
import type { LLMMessage } from '@/lib/llm/base'
import { buildSystemPrompt } from '@/lib/chat/context/system-prompt-builder'
import { getCompiledIdentityStack } from '@/lib/services/system-prompt-compiler/compiler'
import { resolveStandingInstructionsSection } from '@/lib/chat/context/standing-instructions'
import { getTabooSettings } from '@/lib/instance-settings'
import { getRoleplayTemplate } from '@/lib/services/chat-message/participant-resolver.service'
import { resolveUserIdentity } from '@/lib/services/chat-message/user-identity-resolver.service'
import {
  attributeMessagesForCharacter,
  computePresenceWindowsForParticipant,
  filterMessagesByHistoryAccess,
  filterMessagesByPresenceWindows,
  filterWhisperMessages,
  type MessageWithParticipant,
} from '@/lib/chat/context/message-attribution'
import { formatMessagesForProvider } from '@/lib/llm/message-formatter'
import {
  executeVoiceRewrite,
  recallForSeed,
  type VoiceRewriteResult,
} from './voice-rewrite-core'

/**
 * How many played messages of transcript the character is shown. Enough for
 * the line to answer the moment it lands in; deliberately not the whole chat,
 * which would make a rehearsal cost as much as a turn. Not a setting — a
 * rehearsal is a fixed-shape call, and the operator has the proposal in front
 * of them either way.
 */
export const IN_SCENE_REWRITE_WINDOW = 12

const TASK_TYPE = 'impersonation-voice-rewrite'

const LOG_CONTEXT = '[InSceneVoicedLine]'

/** Floor / ceiling on the rewrite's output budget. */
const MIN_MAX_TOKENS = 1024
const MAX_MAX_TOKENS = 4096

/**
 * Output budget for the rewrite. A proclamation fits in the announcement's flat
 * 2048, but a long dramatic paragraph does not — so the ceiling follows the
 * draft's own length (and a terse draft still gets room to breathe).
 */
export function maxTokensForSeed(seedMarkdown: string): number {
  const half = Math.floor(seedMarkdown.length / 2)
  return Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, half))
}

/**
 * The instruction that turns a draft into a turn. Kept verbatim-preserving on
 * purpose: dice notation is read by Pascal's auto-detect, `@Name` addresses by
 * Carina, and a Markdown link by the renderer — none of them survive being
 * paraphrased. (Carina addresses bypass the gate outright on the client; this
 * sentence is the belt to that braces.)
 */
const REWRITE_INSTRUCTION = [
  'It is your turn to speak in the conversation above. Below is your own rough',
  'draft of what you want to say next — the meaning and substance of it.',
  'Rewrite it in your own voice, the way you would actually say it given your',
  'personality, manner of speech, and everything that has just happened. Keep',
  'the meaning, the addressees, every specific fact, and any dice notation or',
  '`@Name` address exactly as written. Match the scene\'s conventions for',
  'narration and dialogue. Say only this — do not continue past it, do not',
  'answer it, and do not speak for anyone else.',
].join(' ')

export interface InSceneVoicedLineParams {
  chat: ChatMetadataBase
  /** The seat the operator is impersonating. */
  participant: ChatParticipantBase
  character: Character
  profile: ConnectionProfile
  seedMarkdown: string
  /** Resolved by the caller: override → participant selection → character default. */
  systemPromptId: string | null
  /** Resolved by the caller from `participant.selectedSubpromptIds`. */
  subprompts: readonly SubpromptForPrompt[] | null
  userId: string
}

export type InSceneVoicedLineResult = VoiceRewriteResult

/**
 * Shape the transcript tail the way a real turn would for this seat.
 *
 * Presence windows are computed from the FULL event list (the Host status
 * announcements that define them are themselves whispers, and would be gone by
 * the time the played subset is taken), then applied to the played messages.
 * Staff whispers are excluded outright — a rehearsal is about what was said in
 * the room, so there is nothing left for whisper-role normalisation to flip.
 */
function buildTranscriptForSeat(
  events: ChatEvent[],
  participant: ChatParticipantBase,
): MessageWithParticipant[] {
  const messageEvents = events.filter(
    (e): e is Extract<ChatEvent, { type: 'message' }> => e.type === 'message',
  )

  const all: MessageWithParticipant[] = messageEvents.map(m => ({
    role: m.role,
    content: m.content,
    id: m.id,
    participantId: m.participantId ?? null,
    createdAt: m.createdAt,
    targetParticipantIds: m.targetParticipantIds ?? null,
    hostEvent: m.hostEvent ?? null,
  }))

  // Played messages only: the character's and the operator's own speech.
  const played = messageEvents
    .filter(
      m =>
        !m.systemSender &&
        (m.role === 'USER' || m.role === 'ASSISTANT') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0,
    )
    .map(m => ({
      role: m.role,
      content: m.content,
      id: m.id,
      participantId: m.participantId ?? null,
      createdAt: m.createdAt,
      targetParticipantIds: m.targetParticipantIds ?? null,
    }))

  // Whispers this seat is not party to, then the history the seat has access
  // to, then the stretches it was actually present for.
  let shaped = filterWhisperMessages(played, participant.id)
  shaped = filterMessagesByHistoryAccess(shaped, participant)
  if (!participant.hasHistoryAccess) {
    const windows = computePresenceWindowsForParticipant(all, participant)
    shaped = filterMessagesByPresenceWindows(shaped, windows)
  }

  return shaped.slice(-IN_SCENE_REWRITE_WINDOW)
}

export async function generateInSceneVoicedLine(
  params: InSceneVoicedLineParams,
): Promise<InSceneVoicedLineResult> {
  const { chat, participant, character, profile, seedMarkdown, systemPromptId, subprompts, userId } =
    params

  try {
    const repos = getRepositories()
    // The chosen profile as-is; provider params ride along so per-model
    // settings (e.g. DeepSeek thinking mode) take effect for this call too.
    const selection = selectionFromProfile(profile)

    const chatSettings = await repos.chatSettings.findByUserId(userId)

    // `{{user}}` is the OWNER persona, not the seat being impersonated — the
    // seat's compiled stack was built that way and the overlay does not change
    // it. Passing no active-speaker id is what makes the resolver fall back to
    // the owner seat rather than to whoever is being impersonated.
    const resolvedIdentity = await resolveUserIdentity(repos, userId, chat, null)
    const userCharacter = {
      name: resolvedIdentity.name,
      description: resolvedIdentity.description,
    }

    const roleplayTemplate = await getRoleplayTemplate(
      repos,
      chat,
      chatSettings
        ? { defaultRoleplayTemplateId: chatSettings.defaultRoleplayTemplateId ?? undefined }
        : null,
    )

    // Taboo and standing instructions are style guidance, not payload — the
    // turn path tolerates a failed read and so does this.
    let tabooPhrases: string[] = []
    try {
      tabooPhrases = (await getTabooSettings()).phrases
    } catch (error) {
      logger.warn(`${LOG_CONTEXT} Failed to read Taboo settings — continuing without them`, {
        chatId: chat.id,
        error: getErrorMessage(error),
      })
    }
    const standingInstructions = await resolveStandingInstructionsSection({
      projectId: chat.projectId ?? null,
      characterId: character.id,
    })

    // The line is PLAYED, so it gets the per-turn prompt the seat would get —
    // template, Taboo, standing instructions, the lot. No tool instructions:
    // a rehearsal has nothing to call.
    const precompiledIdentityStack = getCompiledIdentityStack(chat, participant.id)
    const systemPrompt = buildSystemPrompt({
      character,
      userCharacter,
      roleplayTemplate,
      selectedSystemPromptId: systemPromptId,
      scenarioText: chat.scenarioText ?? undefined,
      precompiledIdentityStack,
      tabooPhrases,
      standingInstructions,
      subprompts: precompiledIdentityStack ? null : subprompts,
    })

    // The scene as this seat sees it, with `[Name]` attribution in a
    // multi-character room and the seat's own lines as `assistant`.
    const events = await repos.chats.getMessages(chat.id)
    const shaped = buildTranscriptForSeat(events, participant)
    const participantCharacters = new Map<string, Character>()
    for (const p of chat.participants) {
      if (!p.characterId || participantCharacters.has(p.characterId)) continue
      if (p.characterId === character.id) {
        participantCharacters.set(p.characterId, character)
        continue
      }
      try {
        const other = await repos.characters.findById(p.characterId)
        if (other) participantCharacters.set(p.characterId, other)
      } catch (error) {
        // A broken vault on a bystander must not cost the rehearsal; the
        // message simply goes unattributed.
        logger.warn(`${LOG_CONTEXT} Could not load a participant character for attribution`, {
          chatId: chat.id,
          characterId: p.characterId,
          error: getErrorMessage(error),
        })
      }
    }
    const attributed = attributeMessagesForCharacter(
      shaped,
      participant.id,
      participantCharacters,
      chat.participants,
    )
    const transcriptMessages: LLMMessage[] = formatMessagesForProvider(
      attributed,
      profile.provider,
      character.name,
    ).map(m => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    }))

    // Commonplace recall against the draft.
    const recallText = await recallForSeed(
      character,
      seedMarkdown,
      profile,
      userId,
      chat.id,
      LOG_CONTEXT,
    )

    const seedTrimmed = seedMarkdown.trim()
    const userParts: string[] = []
    if (recallText) userParts.push(recallText)
    userParts.push(REWRITE_INSTRUCTION)
    userParts.push('Draft:')
    userParts.push(seedTrimmed)

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...transcriptMessages,
      { role: 'user', content: userParts.join('\n\n') },
    ]

    const maxTokens = maxTokensForSeed(seedTrimmed)

    logger.debug(`${LOG_CONTEXT} Composed rewrite request`, {
      chatId: chat.id,
      participantId: participant.id,
      characterId: character.id,
      profileId: profile.id,
      transcriptMessages: transcriptMessages.length,
      systemPromptLength: systemPrompt.length,
      hasRecall: recallText.length > 0,
      hasTemplate: !!roleplayTemplate,
      tabooPhrases: tabooPhrases.length,
      usedPrecompiledStack: !!precompiledIdentityStack,
      seedLength: seedTrimmed.length,
      maxTokens,
    })

    return await executeVoiceRewrite({
      selection,
      messages,
      userId,
      taskType: TASK_TYPE,
      chatId: chat.id,
      characterId: character.id,
      maxTokens,
    })
  } catch (error) {
    logger.error(
      `${LOG_CONTEXT} Unexpected failure`,
      {
        chatId: chat.id,
        participantId: participant.id,
        characterId: character.id,
        error: getErrorMessage(error),
      },
      error as Error,
    )
    return {
      success: false,
      proposedMarkdown: '',
      error: getErrorMessage(error),
    }
  }
}
