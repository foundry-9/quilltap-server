/**
 * Operator Post — recording what the operator just sent.
 *
 * Everything an operator's send puts in the transcript, in the order it
 * appears there:
 *
 *   1. staged tool results from the composer, as TOOL rows;
 *   2. dice / coin / bottle patterns auto-detected in the text, rolled and
 *      saved as TOOL rows (they precede the words that asked for them);
 *   3. the USER message itself, its attachment links, the Librarian's note of
 *      any image uploads, and the Concierge's danger flags;
 *   4. Pascal's trigger-phrase outcomes (they follow the words that caused
 *      them);
 *   5. an inline `@Name:` / `@Name?` Carina query and its answer.
 *
 * This is the one place a post is recorded. Every path that takes an operator
 * message — a turn about to be answered, a paused chat holding the post, a
 * storyteller round, the fair-rotation pause for another user-driven seat —
 * records it here, so no path keeps a thinner copy of the same message
 * (bug 262). Rows that the answering character should hear are spliced onto the
 * turn's in-memory context as they land; the database copy covers later turns.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { postLibrarianUploadAnnouncement } from '@/lib/services/librarian-notifications/writer'
import { runCarinaMarkupQuery } from '@/lib/services/carina/markup-runner'
import { executeRngTool, formatRngResults } from '@/lib/tools/handlers/rng-handler'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatEvent, ChatParticipantBase, DangerFlag } from '@/lib/schemas/chat.types'
import type { ChatSettings } from '@/lib/schemas/settings.types'
import { detectAndConvertRngPatterns } from './rng-pattern-detector.service'
import { runUserMessageTriggers } from './trigger-phrase-sites'
import { encodeCarinaAnswerEvent, encodePascalResultEvent, safeEnqueue, type TurnStatusEmitter } from './streaming.service'
import type { SubmissionLedger } from './turn-stream'
import type { AttachedFile, PendingToolResultInput } from './types'

const logger = createServiceLogger('OperatorPost')

export interface OperatorPostParams {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  userId: string
  chat: { projectId?: string | null }
  chatSettings: ChatSettings | null
  /** What the operator typed ('' for an attachments- or tools-only send). */
  content: string
  /** The file ids the send named; the USER row lists them all. */
  fileIds?: string[]
  /** Those of them that are the chat's own files (`findAttachedFiles`); only these are linked. */
  attachedFiles: Pick<AttachedFile, 'id' | 'filename' | 'mimeType'>[]
  pendingToolResults?: PendingToolResultInput[]
  targetParticipantIds?: string[] | null
  /** The seat the post is attributed to (null: the bare operator). */
  poster: { participant: ChatParticipantBase | null; participantId: string | null }
  /** The Concierge's per-message flags for this post, when it screened one. */
  dangerFlags?: DangerFlag[]
  /** The turn's in-memory context; what the answering character must hear is pushed onto it. */
  context: ChatEvent[]
  ledger: SubmissionLedger
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  status: TurnStatusEmitter
}

export interface OperatorPostResult {
  /** The USER row's id, or null when the send carried no words. */
  userMessageId: string | null
}

/**
 * Record an operator's send. Throws only if a TOOL or USER row cannot be
 * written; every side effect after the USER row is best-effort.
 */
export async function recordOperatorPost(params: OperatorPostParams): Promise<OperatorPostResult> {
  const { repos, chatId, userId, content, context, ledger, controller, encoder } = params

  await savePendingToolResults(params)
  await rollDetectedRng(params)

  let userMessageId: string | null = null
  if (content) {
    userMessageId = crypto.randomUUID()
    await repos.chats.addMessage(chatId, {
      id: userMessageId,
      type: 'message',
      role: 'USER',
      content,
      createdAt: new Date().toISOString(),
      attachments: params.fileIds || [],
      participantId: params.poster.participantId,
      targetParticipantIds: params.targetParticipantIds || null,
    })
    ledger.userMessagePersisted = true
    logger.debug('[OperatorPost] User message persisted', { chatId, userMessageId })

    await linkAttachments(params, userMessageId)
    await announceImageUploads(params)
    await attachDangerFlags(params, userMessageId)
  }

  // Pascal's announcement must FOLLOW the words that caused it, so it runs
  // after the persist (unlike the dice above). The seat speaks for itself: a
  // user-driven or impersonated character's words are that character's, and
  // its roster is theirs; the bare operator rolls as nobody. Never throws.
  await runUserMessageTriggers({
    userId,
    chatId,
    chat: params.chat,
    content,
    isContinueMode: false,
    userParticipant: params.poster.participant,
    userParticipantId: params.poster.participantId,
    chatSettings: params.chatSettings,
    existingMessages: context,
    onPosted: (message) => safeEnqueue(controller, encodePascalResultEvent(encoder, message)),
  })

  // Carina: if the operator addressed an answerer with @Name: / @Name?, fire
  // the isolated reference call. A side effect — the responding participant
  // still takes its turn ("both fire"). The answer carries systemSender
  // 'carina', so it is excluded from memory extraction automatically.
  if (content) {
    await runCarinaMarkupQuery({
      userId,
      chatId,
      text: content,
      askerParticipantId: params.poster.participantId,
      // The human operator typed this markup — they can reach any character,
      // regardless of whether their persona is itself a Carina answerer.
      operatorInitiated: true,
      logLabels: { detected: 'user message', failed: 'user-message' },
      onConsulting: (characterName) => params.status('gathering', `Consulting ${characterName}...`),
      // Surfaced the instant it returns, before any character starts responding.
      onPosted: (msg) => safeEnqueue(controller, encodeCarinaAnswerEvent(encoder, msg)),
      // A PUBLIC answer joins this turn's context so the first character to
      // respond in the same cycle hears it.
      onPublicAnswer: (msg) => context.push(msg),
    })
  }

  return { userMessageId }
}

/** Staged composer tool results become TOOL rows ahead of the message. */
async function savePendingToolResults(params: OperatorPostParams): Promise<void> {
  const { repos, chatId, pendingToolResults, context, ledger } = params
  if (!pendingToolResults || pendingToolResults.length === 0) return

  for (const toolResult of pendingToolResults) {
    const toolMessage: ChatEvent = {
      id: crypto.randomUUID(),
      type: 'message',
      role: 'TOOL',
      content: JSON.stringify({
        tool: toolResult.tool,
        initiatedBy: 'user',
        success: toolResult.success,
        result: toolResult.result,
        prompt: toolResult.prompt,
        arguments: toolResult.arguments,
      }),
      createdAt: toolResult.createdAt,
      attachments: [],
    }
    await repos.chats.addMessage(chatId, toolMessage)
    context.push(toolMessage)
  }
  ledger.pendingToolResultsPersisted = true
  logger.debug('[OperatorPost] Pending tool results persisted', {
    chatId,
    count: pendingToolResults.length,
  })
}

/**
 * Dice rolls, coin flips and spin-the-bottle patterns in the text are rolled
 * and saved as TOOL rows (chat setting `autoDetectRng`, default on).
 */
async function rollDetectedRng(params: OperatorPostParams): Promise<void> {
  const { repos, chatId, userId, content, chatSettings, context } = params
  if (!content || chatSettings?.autoDetectRng === false) return

  const rngPatterns = detectAndConvertRngPatterns(content)
  if (rngPatterns.length === 0) return

  logger.info('Auto-detected RNG patterns in user message', {
    chatId,
    userId,
    patternCount: rngPatterns.length,
    patterns: rngPatterns.map(p => ({ type: p.type, rolls: p.rolls, matchText: p.matchText })),
  })

  for (const pattern of rngPatterns) {
    const args = { type: pattern.type, rolls: pattern.rolls, modifier: pattern.modifier ?? 0 }
    const result = await executeRngTool(args, { userId, chatId })
    const toolMessage: ChatEvent = {
      id: crypto.randomUUID(),
      type: 'message',
      role: 'TOOL',
      content: JSON.stringify({
        tool: 'rng',
        initiatedBy: 'auto-detect',
        success: result.success,
        result: formatRngResults(result),
        prompt: pattern.matchText,
        arguments: args,
      }),
      createdAt: new Date().toISOString(),
      attachments: [],
    }
    await repos.chats.addMessage(chatId, toolMessage)
    context.push(toolMessage)
  }
}

async function linkAttachments(params: OperatorPostParams, userMessageId: string): Promise<void> {
  for (const file of params.attachedFiles) {
    try {
      await params.repos.files.addLink(file.id, userMessageId)
    } catch (error) {
      logger.warn('[OperatorPost] Failed to link attachment to user message', {
        chatId: params.chatId,
        fileId: file.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Surface uploaded image ids in the transcript so the LLM has the handle that
 * `keep_image` / `attach_image` need. The message already carries the bytes,
 * so the Librarian's note is text-only.
 */
async function announceImageUploads(params: OperatorPostParams): Promise<void> {
  const uploads = params.attachedFiles
    .filter(f => f.mimeType.toLowerCase().startsWith('image/'))
    .map(f => ({ fileId: f.id, filename: f.filename }))
  if (uploads.length === 0) return
  try {
    await postLibrarianUploadAnnouncement({ chatId: params.chatId, uploads })
  } catch (error) {
    logger.warn('Failed to post Librarian upload announcement', {
      chatId: params.chatId,
      uploadCount: uploads.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function attachDangerFlags(params: OperatorPostParams, userMessageId: string): Promise<void> {
  const { dangerFlags } = params
  if (!dangerFlags || dangerFlags.length === 0) return
  try {
    await params.repos.chats.updateMessage(params.chatId, userMessageId, { dangerFlags })
  } catch (error) {
    logger.warn('[DangerousContent] Failed to attach dangerFlags to user message', {
      chatId: params.chatId,
      messageId: userMessageId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
