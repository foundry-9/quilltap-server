/**
 * Idle catch-up for the fold episode pass (bug 232).
 *
 * The episode pass runs from a fold and reads at most
 * `FOLD_EPISODE_MAX_SLICES_PER_JOB` slices per run, so a long backlog — the
 * whole history after a regenerate cleared `episodeExtractionWatermarkMessageId`
 * — advances only as the chat folds again. A chat that folds rarely, or never
 * again, would keep episodes for only its first few hundred messages.
 *
 * The daily maintenance sweep therefore looks for idle chats whose episode
 * watermark is behind the end of what the chat has folded (the last of
 * `summaryAnchorMessageIds`) and enqueues a MEMORY_EXTRACTION job with
 * `foldEpisodeCatchup: true`. The job runs the ordinary episode pass over the
 * folded history; the pass's own watermark rule reads only what lies past the
 * watermark. A job that leaves slices unread enqueues its successor, keyed on
 * the watermark it advanced to, so the backlog drains monotonically.
 *
 * Episodes are only ever made from folded history: the catch-up never reads
 * past the fold boundary, exactly as the fold-time pass never does.
 *
 * @module memory/fold-episode-catchup
 */

import { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadata, ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { CheapLLMSettings } from '@/lib/schemas/settings.types'
import { logger } from '@/lib/logger'
import { runFoldEpisodePass, type FoldEpisodePassResult } from './fold-episode-pass'
import {
  FOLD_CATCHUP_MAX_CHATS,
  idleChatsForCatchup,
  isChatActiveForCatchup,
  pickCatchupConnectionProfileId,
  resolveFoldCatchupRoute,
} from './fold-catchup'

export interface FoldEpisodeCatchupCandidate {
  chatId: string
  userId: string
  /** The last folded message — the job's dedupe anchor. */
  foldEndMessageId: string
  connectionProfileId: string
}

export interface FoldEpisodeCatchupSelection {
  candidates: FoldEpisodeCatchupCandidate[]
  /** Eligible chats beyond the per-sweep cap, left for the next sweep. */
  deferred: number
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
 * Whether the episode watermark is behind the fold boundary. A watermark that
 * names a message the chat no longer has counts as behind: the pass treats it
 * as absent and re-reads, so the sweep must offer it the chance.
 */
export function isEpisodeBacklogBehind(
  messages: ReadonlyArray<{ id: string }>,
  chat: Pick<ChatMetadata, 'summaryAnchorMessageIds' | 'episodeExtractionWatermarkMessageId'>,
): { behind: boolean; endIndex: number } {
  const endIndex = foldEndIndex(messages, chat.summaryAnchorMessageIds)
  if (endIndex === -1) return { behind: false, endIndex }
  const watermark = chat.episodeExtractionWatermarkMessageId ?? null
  const watermarkIndex = watermark ? messages.findIndex(m => m.id === watermark) : -1
  return { behind: watermarkIndex < endIndex, endIndex }
}

/**
 * The sweep's transcript-free test: whether the episode watermark is behind
 * the fold boundary as the chat row alone records it. `summaryAnchorMessageIds`
 * lists every folded message in turn order, so the fold boundary is its last
 * entry and the watermark's position in it says how far the pass has read. A
 * watermark outside the list (never set, or naming a message no longer
 * folded) reads as behind. This can only err towards "behind" — a last anchor
 * since deleted from the transcript, or a watermark left past a fold boundary
 * that `rebuild-summary` pulled back — and the job's own check
 * ({@link isEpisodeBacklogBehind}, against the transcript it loads anyway)
 * then skips the chat; once a run has covered the window the watermark sits
 * on the fold boundary and the chat drops out.
 */
export function isEpisodeBacklogBehindByAnchors(
  chat: Pick<ChatMetadata, 'summaryAnchorMessageIds' | 'episodeExtractionWatermarkMessageId'>,
): { behind: boolean; foldEndMessageId: string | null } {
  const anchors = chat.summaryAnchorMessageIds ?? []
  if (anchors.length === 0) return { behind: false, foldEndMessageId: null }
  const foldEndMessageId = anchors[anchors.length - 1]
  const watermark = chat.episodeExtractionWatermarkMessageId ?? null
  const watermarkIndex = watermark ? anchors.lastIndexOf(watermark) : -1
  return { behind: watermarkIndex < anchors.length - 1, foldEndMessageId }
}

/**
 * Idle chats whose episode watermark is behind their fold boundary. Most
 * recently active first, bounded by `limit`. Reads no transcript: the
 * backlog test runs on the chat row ({@link isEpisodeBacklogBehindByAnchors}),
 * and `chats` lets the maintenance sweep share one chat list with the OTHER
 * catch-up.
 */
export async function findFoldEpisodeCatchupCandidates(
  options: { now?: number; limit?: number; chats?: readonly ChatMetadata[] } = {},
): Promise<FoldEpisodeCatchupSelection> {
  const now = options.now ?? Date.now()
  const limit = options.limit ?? FOLD_CATCHUP_MAX_CHATS
  const chats = options.chats ?? await getRepositories().chats.findAll()
  // A chat that has never folded has no episode backlog.
  const prefiltered = idleChatsForCatchup(chats, now).filter(c => (c.summaryAnchorMessageIds?.length ?? 0) > 0)

  const candidates: FoldEpisodeCatchupCandidate[] = []
  let deferred = 0
  for (const chat of prefiltered) {
    const { behind, foldEndMessageId } = isEpisodeBacklogBehindByAnchors(chat)
    if (!behind || !foldEndMessageId) continue
    if (candidates.length >= limit) {
      deferred++
      continue
    }
    const profileId = pickCatchupConnectionProfileId(chat)
    if (!profileId) {
      logger.debug('[FoldEpisodeCatchup] No connection profile on any seat; skipping chat', { chatId: chat.id })
      continue
    }
    candidates.push({
      chatId: chat.id,
      userId: chat.userId,
      foldEndMessageId,
      connectionProfileId: profileId,
    })
  }

  logger.debug('[FoldEpisodeCatchup] Selection complete', {
    scanned: chats.length,
    idleFolded: prefiltered.length,
    selected: candidates.length,
    deferred,
  })
  return { candidates, deferred }
}

export interface RunFoldEpisodeCatchupInput {
  chatId: string
  userId: string
  connectionProfile: ConnectionProfile
  cheapLLMSettings: CheapLLMSettings
  availableProfiles: ConnectionProfile[]
  /** Skip the idle recheck (tests, manual runs). */
  ignoreIdle?: boolean
  now?: number
}

function skipped(skippedReason: string): FoldEpisodePassResult {
  return {
    episodesExtracted: 0,
    memoriesWritten: 0,
    fragmentsLinked: 0,
    slices: 0,
    slicesDeferred: 0,
    timedOut: false,
    watermarkAdvancedTo: null,
    skippedReason,
  }
}

/**
 * Catch up one idle chat's episode backlog: the folded history, from the
 * episode watermark through the fold boundary, read by the ordinary episode
 * pass on the chat's Concierge-resolved cheap LLM. Called by the
 * MEMORY_EXTRACTION handler's `foldEpisodeCatchup` branch.
 */
export async function runFoldEpisodeCatchup(input: RunFoldEpisodeCatchupInput): Promise<FoldEpisodePassResult> {
  const { chatId, userId } = input
  const chat = await getRepositories().chats.findById(chatId)
  if (!chat) return skipped('no-chat')

  if (!input.ignoreIdle && isChatActiveForCatchup(chat, input.now ?? Date.now())) {
    logger.debug('[FoldEpisodeCatchup] Chat active again since the sweep; leaving it to the fold', { chatId })
    return skipped('not-idle')
  }

  const messages = await loadMessages(chatId)
  const { behind, endIndex } = isEpisodeBacklogBehind(messages, chat)
  if (!behind) return skipped(endIndex === -1 ? 'never-folded' : 'behind-watermark')

  const route = await resolveFoldCatchupRoute(chat, { ...input, userId })
  const folded = messages.slice(0, endIndex + 1)

  logger.debug('[FoldEpisodeCatchup] Running catch-up pass', {
    chatId,
    foldedMessages: folded.length,
    watermark: chat.episodeExtractionWatermarkMessageId ?? null,
    foldEnd: folded[folded.length - 1]?.id ?? null,
  })
  return runFoldEpisodePass({
    chatId,
    userId,
    windowMessages: folded,
    chatMessages: messages,
    cheapLLM: route.cheapLLM,
    uncensoredFallback: route.uncensoredFallback,
    timelineMode: chat.timelineMode ?? 'realtime',
    projectId: chat.projectId ?? null,
    inAutonomousRoom: chat.chatType === 'autonomous',
  })
}

async function loadMessages(chatId: string): Promise<MessageEvent[]> {
  return (await getRepositories().chats.getMessages(chatId)).filter(
    (m): m is MessageEvent => m.type === 'message',
  ) as unknown as MessageEvent[]
}
