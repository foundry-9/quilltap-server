/**
 * Character-voiced announcement rewriter — the OFF-SCENE rehearsal.
 *
 * Given a seed text the operator typed for an off-scene character and a
 * chosen connection profile, this rewrites the seed in the character's own
 * voice. The character is told they are NOT in the chat — they are speaking
 * in character to the people who are. The system gives them their normal
 * identity stack (no scenario, no tools, no roleplay template), runs a
 * Commonplace Book recall against the seed so they bring in relevant
 * memories, and lists the currently active or silent participants so the
 * character has an audience to address. The result is returned to the
 * caller for the operator to review, edit, regenerate, or post. Nothing is
 * persisted by this service.
 *
 * When the operator has chosen a whisper audience, the roster is replaced by
 * that audience and the character is told the remark is private. A line pitched
 * to a full room reads wrong when only one person hears it, so the audience has
 * to reach the rewrite rather than being applied after the fact.
 *
 * The recall, the provider call and the result shape are shared with the
 * IN-SCENE rehearsal (`in-scene-voiced.ts`) through `voice-rewrite-core.ts`;
 * only the framing below is this module's own.
 */

import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import { getRepositories } from '@/lib/repositories/factory'
import type { Character, ConnectionProfile } from '@/lib/schemas/types'
import { selectionFromProfile } from '@/lib/llm/cheap-llm'
import type { LLMMessage } from '@/lib/llm/base'
import { buildSystemPrompt } from '@/lib/chat/context/system-prompt-builder'
import {
  executeVoiceRewrite,
  formatNameList,
  recallForSeed,
  type VoiceRewriteResult,
} from './voice-rewrite-core'

export interface CharacterVoicedAnnouncementParams {
  chatId: string
  character: Character
  profile: ConnectionProfile
  seedMarkdown: string
  systemPromptId?: string
  userId: string
  /**
   * Display names of the whisper audience the operator has chosen, already
   * resolved and verified. Empty / omitted means the announcement is public
   * and the character addresses the whole room.
   */
  audienceNames?: string[]
}

export type CharacterVoicedAnnouncementResult = VoiceRewriteResult

const TASK_TYPE = 'announcement-rewrite'

/** Token ceiling for a proclamation. Flat — an announcement is short by nature. */
const ANNOUNCEMENT_MAX_TOKENS = 2048

const LOG_CONTEXT = '[CharacterVoicedAnnouncement]'

/**
 * Build the present-roster block from a chat's participants. Includes only
 * participants whose status is 'active' or 'silent' (not 'absent' or
 * 'removed'). The off-scene speaking character is filtered out in case they
 * also appear as a participant.
 */
async function buildRoster(
  chatId: string,
  speakingCharacterId: string,
): Promise<string> {
  const repos = getRepositories()
  const chat = await repos.chats.findById(chatId)
  if (!chat) return ''

  const rosterParticipants = chat.participants.filter(p =>
    p.type === 'CHARACTER'
    && (p.status === 'active' || p.status === 'silent')
    && p.characterId !== speakingCharacterId,
  )

  if (rosterParticipants.length === 0) return ''

  const rosterEntries = await Promise.all(
    rosterParticipants.map(async p => {
      const character = await repos.characters.findById(p.characterId)
      const name = character?.name?.trim() || 'Someone'
      return `- ${name} (${p.status})`
    }),
  )

  return rosterEntries.join('\n')
}

export async function generateCharacterVoicedAnnouncement(
  params: CharacterVoicedAnnouncementParams,
): Promise<CharacterVoicedAnnouncementResult> {
  const { chatId, character, profile, seedMarkdown, systemPromptId, userId, audienceNames } = params
  const whisperAudience = audienceNames?.filter(n => n.trim().length > 0) ?? []

  try {
    // The chosen profile as-is; provider params ride along so per-model
    // settings (e.g. DeepSeek thinking mode) take effect for this call too.
    const selection = selectionFromProfile(profile)

    // System prompt: identity stack only — no roleplay template, no tools.
    const systemPrompt = buildSystemPrompt({
      character,
      selectedSystemPromptId: systemPromptId ?? null,
    })

    // Commonplace recall against the seed text.
    const recallText = await recallForSeed(
      character,
      seedMarkdown,
      profile,
      userId,
      chatId,
      LOG_CONTEXT,
    )

    // Who's listening. A whisper's audience is the audience — the room's wider
    // roster is not merely irrelevant to it, it would mislead the rewrite into
    // pitching a private aside at people who will never hear it.
    const roster = whisperAudience.length > 0 ? '' : await buildRoster(chatId, character.id)

    // Compose the user-role message.
    const seedTrimmed = seedMarkdown.trim()
    const userParts: string[] = []
    if (recallText) {
      userParts.push(recallText)
    }
    const presenceLine = whisperAudience.length > 0
      ? `You want to say something privately to ${formatNameList(whisperAudience)} — others are present in the chat, but this remark is for ${whisperAudience.length === 1 ? 'them' : 'those named'} alone and no one else will hear it. Pitch it as a private aside, not a declaration to the room.`
      : roster
        ? `You want to say something to the people in the chat. The following people are present:\n${roster}`
        : 'You want to say something to the people in the chat.'
    userParts.push(
      `${presenceLine}\n\nBelow is your own rough draft — the meaning and substance of what you want to convey. Rewrite it in your own voice, the way you would actually say it given your personality, manner of speech, and current circumstances. Keep the meaning, the addressees, and any specific facts; refine the voice and phrasing. Narration, action, and stage directions are welcome where they fit your voice. Do not respond to the draft — it is yours.\n\nDraft:`,
    )
    userParts.push(seedTrimmed)

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userParts.join('\n\n') },
    ]

    return await executeVoiceRewrite({
      selection,
      messages,
      userId,
      taskType: TASK_TYPE,
      chatId,
      characterId: character.id,
      maxTokens: ANNOUNCEMENT_MAX_TOKENS,
    })
  } catch (error) {
    logger.error(`${LOG_CONTEXT} Unexpected failure`, {
      chatId,
      characterId: character.id,
      error: getErrorMessage(error),
    }, error as Error)
    return {
      success: false,
      proposedMarkdown: '',
      error: getErrorMessage(error),
    }
  }
}
