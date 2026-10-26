/**
 * Turn phase: the conversation the model sees, and the head of the request.
 *
 * `turnHistoryRows` decides which history rows may ride verbatim — from the
 * responder's vantage point in a multi-character chat (history access,
 * whispers, attribution), cut to the compression window when a summary is in
 * force, without rows already folded into the running summary.
 * `packTurnHistory` then packs them newest-first into what the budget leaves.
 *
 * `buildLeadingSystemBlocks` and `historyContextMessages` lay out the
 * request's head: the three system blocks, then that history.
 */

import { countMessagesTokens } from '@/lib/tokens/token-counter'
import { shouldSummarizeConversation } from '@/lib/llm/model-context-data'
import { SUMMARY_CONTENT_PREFIX } from '@/lib/services/librarian-notifications/writer'
import { logger } from '@/lib/logger'
import {
  attributeMessagesForCharacter,
  filterMessagesByHistoryAccess,
  filterWhisperMessages,
  type MessageWithParticipant,
} from './message-attribution'
import { selectRecentMessages, type SelectableMessage } from './message-selector'
import { buildIdentityReinforcement } from './system-prompt-builder'
import type { Character, ChatParticipantBase, Provider } from '@/lib/schemas/types'
import type { ContextMessage } from '../context-manager'

type HistoryRow = { role: string; content: string; id?: string; thoughtSignature?: string | null }

/** The cast of a multi-character chat, as history selection needs it. */
export interface HistoryCast {
  respondingParticipant: ChatParticipantBase
  allParticipants: ChatParticipantBase[]
  participantCharacters: Map<string, Character>
  messagesWithParticipants: MessageWithParticipant[]
}

export interface TurnHistoryRowsInput {
  existingMessages: ReadonlyArray<HistoryRow>
  /** Present in a multi-character chat only. */
  cast?: HistoryCast
  /** Where the compression window starts in `existingMessages` (0 = no cut). */
  windowStart: number
  /** Rows the running summary has absorbed (`chats.summaryAnchorMessageIds`). */
  summaryAnchorIds: ReadonlyArray<string>
}

/**
 * Every history row that may ride this turn, oldest first, before packing:
 * from the responder's vantage in a multi-character chat, from the compression
 * window on, without rows the running summary absorbed. What packing sends is
 * always a suffix of this — which is what lets the scene note's room be
 * measured over these rows before the packing is done.
 */
export function turnHistoryRows(input: TurnHistoryRowsInput): SelectableMessage[] {
  const rows = input.cast
    ? castHistory(input.cast, input.existingMessages, input.windowStart)
    : ownHistory(input.existingMessages, input.windowStart)

  // The Librarian summary whisper survives — it is posted after the fold and
  // is not an anchor — so the tail begins with the newest summary whisper and
  // the turns since.
  if (input.summaryAnchorIds.length === 0) return rows
  const anchors = new Set(input.summaryAnchorIds)
  return rows.filter(m => !m.id || !anchors.has(m.id))
}

export interface PackTurnHistoryInput {
  provider: Provider
  /** Tokens left under the input ceiling once everything fixed is spoken for. */
  remainingTokens: number
  /** `ContextBudget.recentMessagesBudget` — history never takes more than this. */
  recentMessagesBudget: number
  /** `ContextBudget.totalLimit`, for the "consider a summary" advice. */
  totalLimit: number
  warnings: string[]
}

export interface TurnHistory {
  messages: SelectableMessage[]
  tokens: number
  truncated: boolean
}

/** Pack the rows newest-first into the smaller of what is left and the history budget. */
export function packTurnHistory(rows: SelectableMessage[], input: PackTurnHistoryInput): TurnHistory {
  const { provider } = input
  const selected = selectRecentMessages(
    rows,
    Math.max(0, Math.min(input.remainingTokens, input.recentMessagesBudget)),
    provider,
  )

  if (selected.truncated) {
    const totalTokens = countMessagesTokens(rows.map(m => ({ role: m.role, content: m.content })), provider)
    if (shouldSummarizeConversation(rows.length, totalTokens, input.totalLimit)) {
      input.warnings.push('Conversation is getting long. Consider generating a summary for better context management.')
    }
  }
  return { messages: selected.messages, tokens: selected.tokenCount, truncated: selected.truncated }
}

/** A single-character chat's history: the rows as given, from the window on. */
function ownHistory(existingMessages: ReadonlyArray<HistoryRow>, windowStart: number): SelectableMessage[] {
  return existingMessages.slice(windowStart).map(msg => ({
    role: msg.role,
    content: msg.content,
    id: msg.id,
    thoughtSignature: msg.thoughtSignature,
  }))
}

/**
 * A multi-character chat's history from the responder's seat: what it was
 * present for, without whispers it was not party to, attributed by name —
 * and, like the single-character path, from the compression window on. The
 * participant rows are the same sequence as `existingMessages`, so the window
 * is found by the id its first row carries.
 */
function castHistory(cast: HistoryCast, existingMessages: ReadonlyArray<HistoryRow>, windowStart: number): SelectableMessage[] {
  const { respondingParticipant, allParticipants, participantCharacters } = cast
  const windowed = fromWindow(cast.messagesWithParticipants, existingMessages, windowStart)
  const visible = filterWhisperMessages(
    filterMessagesByHistoryAccess(windowed, respondingParticipant),
    respondingParticipant.id,
  )
  return attributeMessagesForCharacter(visible, respondingParticipant.id, participantCharacters, allParticipants)
    .map(msg => ({
      role: msg.role,
      content: msg.content,
      id: msg.id,
      name: msg.name,
      participantId: msg.participantId,
      thoughtSignature: msg.thoughtSignature,
    }))
}

function fromWindow(
  rows: MessageWithParticipant[],
  existingMessages: ReadonlyArray<HistoryRow>,
  windowStart: number,
): MessageWithParticipant[] {
  if (windowStart <= 0) return rows
  if (windowStart >= existingMessages.length) return []
  const startId = existingMessages[windowStart].id
  const at = startId ? rows.findIndex(m => m.id === startId) : -1
  if (at >= 0) return rows.slice(at)
  // No id to match by: the two sequences are built row for row, so fall back
  // to the index when they agree in length.
  if (rows.length === existingMessages.length) return rows.slice(windowStart)
  logger.warn('[ContextManager] Could not place the compression window in the cast history; keeping it whole', {
    windowStart,
    rows: rows.length,
    existingMessages: existingMessages.length,
  })
  return rows
}

/**
 * The request's system blocks, in their fixed order:
 *
 * 1. The persona prompt — the stable identity stack, byte-identical across
 *    turns of the same character, and so the cacheable prefix for provider
 *    prompt caching. Memories and the conversation summary ride as whispers
 *    and are not here.
 * 2. The identity reinforcement — fully static, a separate block so block 1
 *    can carry a cache breakpoint. (It no longer names the participants; that
 *    list bisected the cacheable region. Attribution comes from the Host's
 *    roster announcements and per-message `name` fields.)
 * 3. The compressed-history summary, only when compression is in force — its
 *    own block, so its churn never invalidates blocks 1 and 2.
 *
 * Built once: the blocks measured for the budget are the blocks sent.
 */
export function buildLeadingSystemBlocks(input: {
  systemPrompt: string
  characterName: string
  compressedHistoryBlock: string | null
}): ContextMessage[] {
  const blocks: ContextMessage[] = [
    { role: 'system', content: input.systemPrompt, metadata: { isInjected: true } },
    { role: 'system', content: buildIdentityReinforcement(input.characterName), metadata: { isInjected: true } },
  ]
  if (input.compressedHistoryBlock) {
    blocks.push({ role: 'system', content: input.compressedHistoryBlock, metadata: { isInjected: true } })
  }
  return blocks
}

/**
 * The packed history as request messages. The first Librarian summary
 * whisper carries a cache breakpoint, so the system-and-tools prefix stays
 * hot across folds.
 */
export function historyContextMessages(history: ReadonlyArray<SelectableMessage>): ContextMessage[] {
  let breakpointPlaced = false
  return history.map(msg => {
    const isSummaryHead = !breakpointPlaced && typeof msg.content === 'string' && msg.content.startsWith(SUMMARY_CONTENT_PREFIX)
    if (isSummaryHead) breakpointPlaced = true
    return {
      role: msg.role.toLowerCase() as 'user' | 'assistant',
      content: msg.content,
      thoughtSignature: msg.thoughtSignature,
      name: msg.name,
      cacheControl: isSummaryHead ? { type: 'ephemeral' } : undefined,
      // Carried so the attachment anchor can tell the user's own historical
      // turn from a staff whisper wearing role=user (bug 95).
      metadata: msg.id ? { messageId: msg.id } : undefined,
    }
  })
}
