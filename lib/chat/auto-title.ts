/**
 * Automatic chat titling — the one place a cheap-LLM title reaches a chat.
 *
 * Three paths put a cheap-LLM title on a chat: the checkpoint title check
 * (`TITLE_UPDATE` job), the context-summary fold, and the Salon's
 * "Use automatic naming" (regenerate-title) action. All go through `applyAutoTitle`, which owns the
 * two rules every automatic rename must obey:
 *
 *   1. A manually-renamed chat keeps its title (bug 164 — the fold used to
 *      overwrite it). Only an explicit regenerate (`clearManualRename`)
 *      overrules it.
 *   2. A title that actually changed is the Lantern's cue that the scene has
 *      moved, so it queues a story background (bug 163 — the fold used to
 *      rename without one).
 *
 * `queueStoryBackgroundIfEnabled` lives here too: it is the Lantern's
 * auto-trigger, and a rename is the only thing that pulls it.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { isHelpLikeChatType, isParticipantPresent, type ChatMetadata } from '@/lib/schemas/chat.types'
import type { ChatSettings } from '@/lib/schemas/types'
import { resolveImageProfileForChat } from '@/lib/image-gen/profile-resolution'
import { enqueueStoryBackgroundGeneration } from '@/lib/background-jobs/queue-service'
import { logger } from '@/lib/logger'

export type AutoTitleSource = 'title-check' | 'summary-fold' | 'regenerate'

export type AutoTitleOutcome = 'applied' | 'unchanged' | 'manually-renamed' | 'missing'

export interface ApplyAutoTitleOptions {
  userId: string
  chatId: string
  title: string
  /** Settings for the story-background gate; null skips the background. */
  chatSettings: ChatSettings | null
  /** Written alongside the title (or alone, when the title is refused). */
  extraPatch?: Partial<ChatMetadata>
  /**
   * The user asked for a fresh title (Salon "Use automatic naming" (regenerate-title)): overrule a
   * hand rename and hand the title back to the automatic titler.
   */
  clearManualRename?: boolean
  source: AutoTitleSource
}

/**
 * Apply a cheap-LLM title to a chat. Re-reads the chat so a rename the user
 * made while the LLM call was in flight still wins.
 */
export async function applyAutoTitle(opts: ApplyAutoTitleOptions): Promise<AutoTitleOutcome> {
  const { userId, chatId, chatSettings, source, clearManualRename = false } = opts
  const extraPatch: Partial<ChatMetadata> | undefined = clearManualRename
    ? { ...opts.extraPatch, isManuallyRenamed: false }
    : opts.extraPatch
  const title = opts.title.trim()
  const repos = getRepositories()

  const chat = await repos.chats.findById(chatId)
  if (!chat) {
    logger.debug('[Auto Title] Chat vanished before title could be applied', { chatId, source })
    return 'missing'
  }

  const writeExtraOnly = async () => {
    if (extraPatch && Object.keys(extraPatch).length > 0) {
      await repos.chats.update(chatId, { ...extraPatch, updatedAt: new Date().toISOString() })
    }
  }

  if (chat.isManuallyRenamed && !clearManualRename) {
    logger.debug('[Auto Title] Chat was renamed by hand; keeping its title', { chatId, source })
    await writeExtraOnly()
    return 'manually-renamed'
  }

  if (!title || title === chat.title) {
    logger.debug('[Auto Title] Title unchanged', { chatId, source })
    await writeExtraOnly()
    return 'unchanged'
  }

  await repos.chats.update(chatId, {
    ...extraPatch,
    title,
    updatedAt: new Date().toISOString(),
  })
  logger.info('[Auto Title] Chat retitled', { chatId, source, from: chat.title, to: title })

  // Story backgrounds are for normal chats only — help chats are skipped
  // here, autonomous rooms inside queueStoryBackgroundIfEnabled.
  if (chatSettings && !isHelpLikeChatType(chat.chatType)) {
    await queueStoryBackgroundIfEnabled(userId, { ...chat, title }, chatSettings, title)
  }

  return 'applied'
}

/**
 * Queue a story background generation job if the feature is enabled
 */
export async function queueStoryBackgroundIfEnabled(
  userId: string,
  chat: ChatMetadata,
  chatSettings: ChatSettings,
  newTitle: string
): Promise<void> {

  // Check if story backgrounds are enabled
  const storyBackgroundsSettings = chatSettings.storyBackgroundsSettings
  if (!storyBackgroundsSettings?.enabled) {
    return
  }

  // Autonomous rooms (4.6 Private Character Rooms): the Lantern's auto-trigger
  // is disabled. Backgrounds are token-budget-conscious; the user is not in
  // the room to see them, and a character can still deliberately invoke
  // image-generation tools when desired.
  if (chat.chatType === 'autonomous') {
    return
  }

  // Determine the image profile to use
  const repos = getRepositories()
  const imageProfileId = await resolveImageProfileForChat(userId, chat, chatSettings, repos)
  if (!imageProfileId) {
    return
  }

  // Get character IDs from participants who are actually in the scene. Absent
  // and (soft-)removed participants must never be painted into the background —
  // the crafter is told to place every enumerated character as a figure in the
  // frame, so a stale enumeration puts someone in the room who walked out of it.
  // 'silent' counts as present: they are standing there, just not speaking.
  const characterIds = chat.participants
    .filter(p => isParticipantPresent(p.status) && p.characterId)
    .map(p => p.characterId!)

  if (characterIds.length === 0) {
    return
  }

  // Queue the story background generation job
  try {
    const { jobId, isNew } = await enqueueStoryBackgroundGeneration(userId, {
      chatId: chat.id,
      imageProfileId,
      characterIds,
      sceneContext: newTitle,
      projectId: chat.projectId ?? null,
    })

    if (isNew) {
      logger.info('[Auto Title] Queued story background generation', {
        chatId: chat.id,
        jobId,
        imageProfileId,
        characterCount: characterIds.length,
      })
    }
  } catch (error) {
    logger.warn('[Auto Title] Failed to queue story background generation', {
      chatId: chat.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
