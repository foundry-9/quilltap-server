/**
 * What editing a line of the Salon transcript disturbs.
 *
 * Any message the operator can see may be edited — their own lines, a
 * character's, a Staff announcement. Two things can already have happened to
 * the old text, and the operator should hear about both before they save:
 *
 *  - **A model read it.** Every later model call in the chat (a character's
 *    turn, a memory extraction, a summary fold, a title check…) sent the old
 *    text. Editing the row changes what future calls see; it cannot unsay
 *    what earlier answers were built on. We count later `llm_logs` rows for
 *    the chat (less the line's own generation calls) and, because logging can
 *    be off or pruned, later character lines too.
 *  - **It fed memories.** Memories are stamped with one source message, and
 *    which one depends on the path that formed them:
 *      - a conversation line → its *turn* (a turn's memories carry the turn's
 *        last character line, so a user line's memories sit on someone
 *        else's row);
 *      - a Carina answer → the answer row (`CARINA_MEMORY_EXTRACTION`);
 *      - a machine established fact → the Host row (`ESTABLISHED_FACT_MEMORIES`).
 *    Other Staff rows are never extraction material, so they have none.
 *
 * {@link locateMemorySource} is pure; {@link assessMessageEditImpact} reads;
 * {@link regenerateEditedMessageMemories} retires the old memories through
 * `retireMemories` and enqueues the path's own job to form them afresh from
 * the edited text. It must run *after* the edit is written — the job reads
 * the transcript when it runs.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { retireMemories } from '@/lib/memory/retire'
import {
  enqueueCarinaMemoryExtraction,
  enqueueEstablishedFactMemories,
  enqueueMemoryExtraction,
} from '@/lib/background-jobs/queue-service'
import { ensureProcessorRunning } from '@/lib/background-jobs/processor'
import { resolveChatExtractionProfileId } from '@/lib/memory/extraction'
import { isAutonomousTurnAnchor, listExtractionTurns, type ExtractionTurnLocator } from './turn-transcript'
import { liveSwipeVariantIds, withoutSupersededSwipes } from '@/lib/chat/swipe-variants'
import { logger } from '@/lib/logger'
import type { RetireReason } from '@/lib/memory/retire'
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types'
import type { LLMLogType } from '@/lib/schemas/llm-log.types'
import type { MessageEditImpact } from '@/lib/schemas/message-edit-impact.types'

export type { MessageEditImpact }

/** Where an edited line's memories came from, and how to form them again. */
export type EditedMessageMemorySource =
  | {
      kind: 'turn'
      /** The turn as extraction addresses it — exactly one of `listExtractionTurns`'s entries. */
      locator: ExtractionTurnLocator
      /** Every message in the turn: its memories are stamped with one of these. */
      sourceMessageIds: string[]
    }
  | { kind: 'carina'; messageId: string; answererId: string }
  | { kind: 'established-fact'; messageId: string }

/** A line's own generation calls: not "read since it landed", they wrote it. */
const OWN_GENERATION_LOG_TYPES: LLMLogType[] = ['CHAT_MESSAGE', 'TOOL_CONTINUATION']

/**
 * Locate the path that formed (or would form) this message's memories.
 * `messages` is the chat's message events in transcript order, swipe variants
 * included.
 *
 * Extraction reads a swipe group as its newest variant alone
 * (`loadChatMessageEvents`), so the turn is located on that reading too. A
 * superseded variant is located through the variant that replaced it — the
 * same turn — and its own id stays among the turn's sources, since memories
 * formed from it are stamped with it (#236).
 */
export function locateMemorySource(
  messages: MessageEvent[],
  target: MessageEvent,
  chatType: string | null | undefined,
): EditedMessageMemorySource | null {
  if (target.systemSender === 'carina') {
    const answererId = target.carinaMeta?.answererId
    return answererId ? { kind: 'carina', messageId: target.id, answererId } : null
  }
  if (target.systemSender === 'host' && target.systemKind === 'established-fact') {
    return { kind: 'established-fact', messageId: target.id }
  }
  // Every other Staff row is left out of the turn transcript.
  if (target.systemSender) return null
  if (!messages.some(m => m.id === target.id)) return null

  const live = withoutSupersededSwipes(messages)
  const standingId = target.swipeGroupId && !live.some(m => m.id === target.id)
    ? liveSwipeVariantIds(messages).get(target.swipeGroupId)
    : target.id
  const index = live.findIndex(m => m.id === standingId)
  if (index === -1) return null

  const span = turnSpanFor(live, index, chatType)
  if (!span) return null

  const locator = listExtractionTurns(live, chatType).find(
    t =>
      (t.turnOpenerMessageId ?? null) === span.turnOpenerMessageId &&
      (t.extractionAnchorMessageId ?? null) === (span.extractionAnchorMessageId ?? null),
  )
  if (!locator) return null

  const sourceMessageIds = live.slice(span.start, span.end).map(m => m.id)
  if (!sourceMessageIds.includes(target.id)) sourceMessageIds.push(target.id)
  return { kind: 'turn', locator, sourceMessageIds }
}

/** The half-open slice of `messages` that is the turn holding `index`, addressed as extraction addresses it. */
function turnSpanFor(
  messages: MessageEvent[],
  index: number,
  chatType: string | null | undefined,
): { start: number; end: number; turnOpenerMessageId: string | null; extractionAnchorMessageId?: string | null } | null {
  if (chatType === 'autonomous') {
    // A speaker's turn runs from just past the previous anchor to its own.
    let anchor = -1
    for (let i = index; i < messages.length; i++) {
      if (isAutonomousTurnAnchor(messages[i])) { anchor = i; break }
    }
    if (anchor === -1) return null // the turn has not closed yet
    let previous = -1
    for (let i = anchor - 1; i >= 0; i--) {
      if (isAutonomousTurnAnchor(messages[i])) { previous = i; break }
    }
    return { start: previous + 1, end: anchor + 1, turnOpenerMessageId: null, extractionAnchorMessageId: messages[anchor].id }
  }

  const isOpener = (m: MessageEvent) => m.role === 'USER' && !m.systemSender
  let opener = -1
  for (let i = index; i >= 0; i--) {
    if (isOpener(messages[i])) { opener = i; break }
  }
  let next = messages.length
  for (let i = index + 1; i < messages.length; i++) {
    if (isOpener(messages[i])) { next = i; break }
  }
  // Before the first user line: the greeting turn (null opener).
  return opener === -1
    ? { start: 0, end: next, turnOpenerMessageId: null }
    : { start: opener, end: next, turnOpenerMessageId: messages[opener].id }
}

function memorySourceIds(source: EditedMessageMemorySource): string[] {
  return source.kind === 'turn' ? source.sourceMessageIds : [source.messageId]
}

/** The memories a regenerate would retire. */
async function findSourcedMemoryIds(source: EditedMessageMemorySource): Promise<string[]> {
  const repos = getRepositories()
  const ids: string[] = []
  for (const sourceMessageId of memorySourceIds(source)) {
    const rows = await repos.memories.findBySourceMessageId(sourceMessageId)
    for (const row of rows) {
      // An established fact is admitted as MANUAL rows; the extractors write AUTO.
      if (source.kind === 'established-fact' || row.source === 'AUTO') ids.push(row.id)
    }
  }
  return ids
}

/** Everything an edit of `target` would disturb. Reads only. */
export async function assessMessageEditImpact(
  chat: ChatMetadata,
  messages: MessageEvent[],
  target: MessageEvent,
  userId: string,
): Promise<MessageEditImpact> {
  const repos = getRepositories()
  const landedAt = target.createdAt

  // The line's own generation (and its swipe siblings') wrote it; it did not read it.
  const ownIds = target.swipeGroupId
    ? messages.filter(m => m.swipeGroupId === target.swipeGroupId).map(m => m.id)
    : [target.id]

  let laterLlmCalls = 0
  if (landedAt) {
    const [allLater, ownLater] = await Promise.all([
      repos.llmLogs.countForChatSince(chat.id, landedAt),
      repos.llmLogs.countForChatSince(chat.id, landedAt, { messageIds: ownIds, types: OWN_GENERATION_LOG_TYPES }),
    ])
    laterLlmCalls = Math.max(0, allLater - ownLater)
  }

  const index = messages.findIndex(m => m.id === target.id)
  const laterCharacterLines = index === -1
    ? 0
    : messages.slice(index + 1).filter(
        m => m.role === 'ASSISTANT' && !m.systemSender && !!m.participantId && !ownIds.includes(m.id),
      ).length

  const source = locateMemorySource(messages, target, chat.chatType)
  const memoryCount = source ? (await findSourcedMemoryIds(source)).length : 0
  const canRegenerateMemories =
    !!source && memoryCount > 0 && (await resolveChatExtractionProfileId(chat, userId)) !== null

  const impact: MessageEditImpact = {
    seenByLlm: laterLlmCalls > 0 || laterCharacterLines > 0,
    laterLlmCalls,
    laterCharacterLines,
    memoryCount,
    memorySource: source?.kind ?? null,
    canRegenerateMemories,
  }
  logger.debug('[MessageEdit] Assessed edit impact', { chatId: chat.id, messageId: target.id, ...impact })
  return impact
}

export interface RegenerateMemoriesOptions {
  /** Why the old memories go: an edit by hand, or a swipe re-roll replacing the line. */
  reason?: Extract<RetireReason, 'message-edit' | 'swipe-regenerate'>
}

export interface RegenerateEditedMemoriesResult {
  memoriesRetired: number
  jobId: string | null
}

/**
 * Retire the memories an edited line formed and enqueue the job that forms
 * them again from its new text. Call after the edit is written.
 *
 * A swipe re-roll is the same act (`reason: 'swipe-regenerate'`): pass the
 * replaced variant as `target` and a transcript that already holds the new
 * one, and the replaced line's memories are retired while the turn — read
 * with the new variant standing in its place — is extracted afresh (#236).
 *
 * A regenerate with no profile to extract on retires nothing: the operator
 * keeps the old memories rather than losing them for nothing.
 */
export async function regenerateEditedMessageMemories(
  chat: Pick<ChatMetadata, 'id' | 'participants' | 'chatType'>,
  messages: MessageEvent[],
  target: MessageEvent,
  userId: string,
  options: RegenerateMemoriesOptions = {},
): Promise<RegenerateEditedMemoriesResult> {
  const reason = options.reason ?? 'message-edit'
  const source = locateMemorySource(messages, target, chat.chatType)
  if (!source) {
    logger.debug('[MessageEdit] No memory source for edited line; nothing to regenerate', { chatId: chat.id, messageId: target.id })
    return { memoriesRetired: 0, jobId: null }
  }

  // The established-fact job admits verbatim and needs no model.
  const connectionProfileId = source.kind === 'established-fact'
    ? null
    : await resolveChatExtractionProfileId(chat, userId)
  if (source.kind !== 'established-fact' && !connectionProfileId) {
    logger.warn('[MessageEdit] No connection profile to regenerate memories; keeping the old ones', { chatId: chat.id, messageId: target.id })
    return { memoriesRetired: 0, jobId: null }
  }

  const memoryIds = await findSourcedMemoryIds(source)
  const report = memoryIds.length > 0
    ? await retireMemories(memoryIds, { reason })
    : { retired: 0 }

  let jobId: string
  switch (source.kind) {
    case 'turn':
      jobId = await enqueueMemoryExtraction(userId, {
        chatId: chat.id,
        turnOpenerMessageId: source.locator.turnOpenerMessageId,
        extractionAnchorMessageId: source.locator.extractionAnchorMessageId ?? null,
        ...(source.locator.extractAfterMessageId ? { extractAfterMessageId: source.locator.extractAfterMessageId } : {}),
        connectionProfileId: connectionProfileId!,
        // Read the turn whole, past the live cursor, and outside the rate limit.
        backfill: true,
      })
      break
    case 'carina':
      jobId = await enqueueCarinaMemoryExtraction(userId, {
        chatId: chat.id,
        carinaMessageId: source.messageId,
        answererId: source.answererId,
        connectionProfileId: connectionProfileId!,
      })
      break
    case 'established-fact':
      jobId = await enqueueEstablishedFactMemories(userId, { chatId: chat.id, messageId: source.messageId })
      break
  }
  ensureProcessorRunning()

  logger.info('[MessageEdit] Regenerating memories for edited line', {
    chatId: chat.id,
    messageId: target.id,
    reason,
    source: source.kind,
    memoriesRetired: report.retired,
    jobId,
  })
  return { memoriesRetired: report.retired, jobId }
}
