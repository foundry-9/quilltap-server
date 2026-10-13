/**
 * Idle catch-ups for the two fold-grain passes (memory refactor §3.7).
 *
 * Both passes run on the fold cadence and read a bounded number of slices per
 * run, so a chat that stops folding would leave either backlog stalled. The
 * daily maintenance sweep therefore picks idle chats whose cursor is behind
 * and enqueues a MEMORY_EXTRACTION job per chat (`pass: 'other-fold'` or
 * `'episode-fold'`); the job builds an extraction context and runs the
 * ordinary fold runner over the backlog.
 *
 *  - `other-fold` reads everything past its cursor: short chats that never
 *    fold still get their observations of others.
 *  - `episode-fold` reads only folded history (through the last of
 *    `summaryAnchorMessageIds`), exactly as the fold-time pass never reads
 *    past the fold boundary.
 *
 * @module memory/extraction/catchup
 */

import { getRepositories } from '@/lib/repositories/factory'
import { isHelpLikeChatType } from '@/lib/schemas/chat.types'
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types'
import type { ExtractionCursorMap, ExtractionCursorPass } from '@/lib/schemas/memory-extraction-cursor.types'
import { getMemoryExtractionModeSettings } from '@/lib/instance-settings'
import { logger } from '@/lib/logger'
import { loadChatMessageEvents } from '@/lib/services/chat-message/turn-transcript'
import { pickExtractionConnectionProfileId, type ExtractionContext } from './context'
import { runFoldPass, type FoldResult } from './fold'
import { messagesPastCursor } from './window'
import { emptyPassResult } from './run'

/** A chat must have been quiet this long before a sweep treats its backlog as stalled. */
export const FOLD_CATCHUP_IDLE_MS = 2 * 60 * 60 * 1000

/** Chats whose last message is older than this are not swept (an old backlog is a backfill, not a catch-up). */
export const FOLD_CATCHUP_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

/** Most catch-up jobs of one pass a sweep will enqueue; the rest wait for tomorrow. */
export const FOLD_CATCHUP_MAX_CHATS = 50

/**
 * Chats a catch-up sweep may consider: not help/brahma, at least two
 * messages, idle more than {@link FOLD_CATCHUP_IDLE_MS} and active within
 * {@link FOLD_CATCHUP_LOOKBACK_MS}. Most recently active first.
 */
export function idleChatsForCatchup(chats: readonly ChatMetadata[], now: number): ChatMetadata[] {
  return chats
    .filter(c => !isHelpLikeChatType(c.chatType))
    .filter(c => (c.messageCount ?? 0) >= 2)
    .map(c => ({ chat: c, last: c.lastMessageAt ? Date.parse(c.lastMessageAt) : NaN }))
    .filter(x => Number.isFinite(x.last))
    .filter(x => now - x.last > FOLD_CATCHUP_IDLE_MS && now - x.last < FOLD_CATCHUP_LOOKBACK_MS)
    .sort((a, b) => b.last - a.last)
    .map(x => x.chat)
}

/** True when the chat has spoken within the idle window, so the fold, not a catch-up, owns its backlog. */
export function isChatActiveForCatchup(chat: Pick<ChatMetadata, 'lastMessageAt'>, now: number): boolean {
  const lastAt = chat.lastMessageAt ? Date.parse(chat.lastMessageAt) : NaN
  return Number.isFinite(lastAt) && now - lastAt <= FOLD_CATCHUP_IDLE_MS
}

/**
 * Index (in `messages`) of the last message the chat's summary has folded,
 * or -1 when the chat has never folded or none of its anchors survive.
 */
export function foldEndIndex(
  messages: ReadonlyArray<{ id: string }>,
  summaryAnchorMessageIds: readonly string[] | null | undefined,
): number {
  if (!summaryAnchorMessageIds || summaryAnchorMessageIds.length === 0) return -1
  const anchors = new Set(summaryAnchorMessageIds)
  for (let i = messages.length - 1; i >= 0; i--) {
    if (anchors.has(messages[i].id)) return i
  }
  return -1
}

/**
 * Whether the episode cursor is behind the fold boundary. A cursor that names
 * a message the chat no longer has counts as behind: the pass treats it as
 * absent and re-reads.
 */
export function isEpisodeBacklogBehind(
  messages: ReadonlyArray<{ id: string }>,
  summaryAnchorMessageIds: readonly string[] | null | undefined,
  cursor: string | null,
): { behind: boolean; endIndex: number } {
  const endIndex = foldEndIndex(messages, summaryAnchorMessageIds)
  if (endIndex === -1) return { behind: false, endIndex }
  const cursorIndex = cursor ? messages.findIndex(m => m.id === cursor) : -1
  return { behind: cursorIndex < endIndex, endIndex }
}

/**
 * The sweep's transcript-free test: whether the episode cursor is behind the
 * fold boundary as the chat row records it. `summaryAnchorMessageIds` lists
 * every folded message in turn order, so the boundary is its last entry and
 * the cursor's position in it says how far the pass has read. Can only err
 * towards "behind"; the job's own {@link isEpisodeBacklogBehind} then skips.
 */
export function isEpisodeBacklogBehindByAnchors(
  summaryAnchorMessageIds: readonly string[] | null | undefined,
  cursor: string | null,
): { behind: boolean; foldEndMessageId: string | null } {
  const anchors = summaryAnchorMessageIds ?? []
  if (anchors.length === 0) return { behind: false, foldEndMessageId: null }
  const foldEndMessageId = anchors[anchors.length - 1]
  const cursorIndex = cursor ? anchors.lastIndexOf(cursor) : -1
  return { behind: cursorIndex < anchors.length - 1, foldEndMessageId }
}

export interface FoldCatchupCandidate {
  chatId: string
  userId: string
  /** The job's dedupe anchor: the chat's last message (`other-fold`) or fold boundary (`episode-fold`). */
  anchorMessageId: string
  connectionProfileId: string
}

export interface FoldCatchupSelection {
  candidates: FoldCatchupCandidate[]
  /** Eligible chats beyond the per-sweep cap, left for the next sweep. */
  deferred: number
}


/**
 * Idle chats whose `pass` cursor is behind. Most recently active first,
 * bounded by `limit`. `chats` and `cursors` let the sweep share one chat list
 * and one cursor read between the two passes.
 */
export async function findFoldCatchupCandidates(
  pass: ExtractionCursorPass,
  options: {
    now?: number
    limit?: number
    chats?: readonly ChatMetadata[]
    cursors?: ReadonlyMap<string, ExtractionCursorMap>
  } = {},
): Promise<FoldCatchupSelection> {
  const now = options.now ?? Date.now()
  const limit = options.limit ?? FOLD_CATCHUP_MAX_CHATS
  const repos = getRepositories()

  if (pass === 'other-fold') {
    const mode = await getMemoryExtractionModeSettings()
    if (mode.otherPass === 'turn') {
      logger.debug('[FoldCatchup] otherPass=turn; no OTHER catch-up needed')
      return { candidates: [], deferred: 0 }
    }
  }

  const chats = options.chats ?? await repos.chats.findAll()
  const cursors = options.cursors ?? await repos.memoryExtractionCursors.findAllByChat()
  let prefiltered = idleChatsForCatchup(chats, now)
  // A chat that has never folded has no episode backlog.
  if (pass === 'episode-fold') prefiltered = prefiltered.filter(c => (c.summaryAnchorMessageIds?.length ?? 0) > 0)

  const candidates: FoldCatchupCandidate[] = []
  let deferred = 0
  for (const chat of prefiltered) {
    const cursor = cursors.get(chat.id)?.[pass] ?? null
    let anchorMessageId: string | null = null
    if (pass === 'episode-fold') {
      const { behind, foldEndMessageId } = isEpisodeBacklogBehindByAnchors(chat.summaryAnchorMessageIds, cursor)
      if (!behind || !foldEndMessageId) continue
      if (candidates.length >= limit) { deferred++; continue }
      anchorMessageId = foldEndMessageId
    } else {
      if (candidates.length >= limit) {
        // Counted without reading their messages; some may turn out covered.
        deferred++
        continue
      }
      try {
        const messages = await loadChatMessageEvents(chat.id)
        const last = messages[messages.length - 1]
        if (!last || cursor === last.id) continue
        anchorMessageId = last.id
      } catch (error) {
        logger.warn('[FoldCatchup] Could not inspect chat; skipping', {
          chatId: chat.id,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }
    }
    const connectionProfileId = pickExtractionConnectionProfileId(chat)
    if (!connectionProfileId) {
      logger.debug('[FoldCatchup] No connection profile on any seat; skipping chat', { chatId: chat.id, pass })
      continue
    }
    candidates.push({ chatId: chat.id, userId: chat.userId, anchorMessageId, connectionProfileId })
  }

  logger.debug('[FoldCatchup] Selection complete', {
    pass,
    scanned: chats.length,
    idle: prefiltered.length,
    selected: candidates.length,
    deferred,
  })
  return { candidates, deferred }
}

function skipped(pass: ExtractionCursorPass, skippedReason: string): FoldResult {
  return { ...emptyPassResult(pass), slices: 0, slicesDeferred: 0, cursorAdvancedTo: null, skippedReason }
}

/**
 * Catch up one chat's backlog for `pass` on a built context: the messages past
 * the cursor (`other-fold`), or the folded history past it (`episode-fold`).
 */
export async function runFoldCatchup(
  ctx: ExtractionContext,
  pass: ExtractionCursorPass,
  options: { ignoreIdle?: boolean; now?: number; maxSlices?: number } = {},
): Promise<FoldResult> {
  const chat = ctx.chat
  if (!options.ignoreIdle && isChatActiveForCatchup(chat, options.now ?? Date.now())) {
    logger.debug('[FoldCatchup] Chat active again since the sweep; leaving it to the fold', { chatId: chat.id, pass })
    return skipped(pass, 'not-idle')
  }
  const messages = await ctx.messages()
  const cursor = (await ctx.cursors.read(pass)).afterMessageId

  if (pass === 'other-fold') {
    const window = messagesPastCursor(messages, cursor)
    if (window.length === 0) return skipped(pass, 'behind-cursor')
    logger.debug('[FoldCatchup] Running OTHER catch-up', { chatId: chat.id, windowMessages: window.length, cursor })
    return runFoldPass(ctx, pass, {
      windowMessages: window,
      coverThroughMessageId: messages[messages.length - 1]?.id ?? null,
      maxSlices: options.maxSlices,
    })
  }

  const { behind, endIndex } = isEpisodeBacklogBehind(messages, chat.summaryAnchorMessageIds, cursor)
  if (!behind) return skipped(pass, endIndex === -1 ? 'never-folded' : 'behind-cursor')
  const folded = messages.slice(0, endIndex + 1)
  logger.debug('[FoldCatchup] Running episode catch-up', {
    chatId: chat.id,
    foldedMessages: folded.length,
    cursor,
    foldEnd: folded[folded.length - 1]?.id ?? null,
  })
  return runFoldPass(ctx, pass, { windowMessages: folded, maxSlices: options.maxSlices })
}
