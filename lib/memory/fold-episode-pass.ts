/**
 * Fold-time episode pass (episodic spine — creation-side keystone).
 *
 * Per-turn extraction sees one turn at a time and produces fragments; a real
 * outing spans many turns and deserves one coherent record. On the existing
 * fold cadence (piggybacking `generateContextSummary`, no new trigger), this
 * pass asks the cheap LLM for 0–2 consolidated episode records over the
 * just-folded message window, writes them as `kind: 'episodic'` memories for
 * each present character through the normal gate (the gate's date guard keeps
 * them from being swallowed by near-dup skips), and links the per-turn
 * fragment memories from the same window via `relatedMemoryIds` so one-hop
 * expansion can pull the fragments when the episode surfaces.
 *
 * Watermark: `chats.episodeExtractionWatermarkMessageId` is the last message
 * the pass has read. The pass reads from its watermark through the end of the
 * fold's window (`foldPassRange`), so a hard-rebuild fold (which re-walks
 * turns 1..N) or a refold after `rebuild-summary` never re-extracts history
 * the pass already covered (bug 207), and a stretch an earlier run lost to a
 * timeout is read before the new window rather than jumped. The same
 * eligibility filter as the fold OTHER pass applies (`fold-window.ts`), and a
 * range wider than {@link FOLD_EPISODE_MAX_WINDOW_MESSAGES} is read in
 * consecutive slices, the watermark advancing past each one as it is read —
 * at most {@link FOLD_EPISODE_MAX_SLICES_PER_JOB} of them per run, the rest
 * left for the next fold. A slice lost to a cheap-LLM timeout stops the run
 * and leaves the watermark before it.
 *
 * The cheap-LLM call carries the chat's uncensored fallback, so an empty
 * answer on dangerous content retries on the Concierge desk exactly as the
 * other extraction passes do (bug 213).
 *
 * Best-effort throughout: never throws into the fold; a failed episode pass
 * costs nothing but the episode.
 *
 * @module memory/fold-episode-pass
 */

import { getRepositories } from '@/lib/repositories/factory'
import {
  extractEpisodesFromFold,
  type ExtractionClock,
  type FoldEpisodeMessage,
  type UncensoredFallbackOptions,
} from './cheap-llm-tasks'
import { createMemoryWithGate } from './memory-service'
import { resolveEpisodicAnchors } from './episodic-anchors'
import { isFoldEligibleMessage, foldPassRange, sliceFoldWindow } from './fold-window'
import { resolveSpeakerNames, speakerLabel, type SpeakerNames } from '@/lib/chat/speaker-names'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ChatParticipantBase, MessageEvent } from '@/lib/schemas/types'
import { isParticipantPresent } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import { refreshMemoryTimeZone } from './memory-calendar-refresh'

/** Cap on fragment links attached to one episode (per character). */
const MAX_FRAGMENT_LINKS = 8

/** One episode prompt reads at most this many eligible messages; a wider window is read in slices of it. */
export const FOLD_EPISODE_MAX_WINDOW_MESSAGES = 60

/** One run reads at most this many slices; a longer backlog is left for the next fold, from the advanced watermark. */
export const FOLD_EPISODE_MAX_SLICES_PER_JOB = 4

export interface RunFoldEpisodePassInput {
  chatId: string
  userId: string
  /** The just-folded window: USER + character messages, chronological. */
  windowMessages: MessageEvent[]
  /**
   * The chat's whole transcript (`type: 'message'` rows, chronological), when
   * the caller already holds it. Saves a second full read and decompression
   * per fold; read here only when absent and a watermark needs it.
   */
  chatMessages?: MessageEvent[]
  cheapLLM: CheapLLMSelection
  /** Retry target for an empty answer on dangerous content (the Concierge desk). */
  uncensoredFallback?: UncensoredFallbackOptions
  timelineMode: 'realtime' | 'narrative'
  projectId?: string | null
  inAutonomousRoom: boolean
}

export interface FoldEpisodePassResult {
  episodesExtracted: number
  memoriesWritten: number
  fragmentsLinked: number
  /** Slices the window was read in (0 when nothing past the watermark was eligible). */
  slices: number
  /** Slices left unread because the run hit {@link FOLD_EPISODE_MAX_SLICES_PER_JOB}; the next fold takes them up. */
  slicesDeferred: number
  /** Set when a slice was lost to a cheap-LLM timeout; the watermark stays before it. */
  timedOut: boolean
  watermarkAdvancedTo: string | null
  /** Set when the pass did nothing on purpose (`no-chat`, `behind-watermark`, `nobody-present`). */
  skippedReason?: string
}

function emptyResult(skippedReason?: string): FoldEpisodePassResult {
  return {
    episodesExtracted: 0,
    memoriesWritten: 0,
    fragmentsLinked: 0,
    slices: 0,
    slicesDeferred: 0,
    timedOut: false,
    watermarkAdvancedTo: null,
    ...(skippedReason ? { skippedReason } : {}),
  }
}

/**
 * Run the episode pass over a folded window. See module docs.
 */
export async function runFoldEpisodePass(
  input: RunFoldEpisodePassInput,
): Promise<FoldEpisodePassResult> {
  const result = emptyResult()
  const { chatId } = input

  try {
    if (input.windowMessages.length === 0) return result

    const repos = getRepositories()
    const chat = await repos.chats.findById(chatId)
    if (!chat) return emptyResult('no-chat')

    // Read from the episode watermark through the end of the fold's window.
    // A hard rebuild hands us turns 1..N; only the part past the watermark is
    // new to this pass. A fold of only newer turns after a lost slice hands us
    // a window past a gap; the gap is read first, never jumped.
    let window = input.windowMessages
    const watermark = chat.episodeExtractionWatermarkMessageId ?? null
    if (watermark) {
      const all = input.chatMessages ?? (await loadTranscript(chatId))
      const before = window.length
      const range = foldPassRange(window, all, watermark)
      if (range.applied) {
        window = range.messages
        logger.debug('[FoldEpisodePass] Applied watermark to window', {
          chatId,
          watermark,
          before,
          after: window.length,
          gap: range.gap,
          transcriptHandedIn: input.chatMessages !== undefined,
        })
        if (window.length === 0) return emptyResult('behind-watermark')
      }
    }

    const coverThrough = window[window.length - 1]?.id ?? null
    const eligible = window.filter(isFoldEligibleMessage)
    const allSlices = sliceFoldWindow(eligible, FOLD_EPISODE_MAX_WINDOW_MESSAGES, coverThrough)
    const slices = allSlices.slice(0, FOLD_EPISODE_MAX_SLICES_PER_JOB)
    result.slices = slices.length
    result.slicesDeferred = allSlices.length - slices.length
    if (result.slicesDeferred > 0) {
      logger.info('[FoldEpisodePass] Backlog wider than one run; the rest waits for the next fold', {
        chatId,
        slicesRead: slices.length,
        slicesDeferred: result.slicesDeferred,
      })
    }

    // Present character participants form the episode memory — the same set
    // whose recall the whisper feeds. User-controlled characters form
    // memories too (matching the per-turn SELF pass).
    const presentParticipants = chat.participants.filter(
      p => p.type === 'CHARACTER' && isParticipantPresent(p.status) && p.characterId,
    )
    if (presentParticipants.length === 0 || slices.length === 0) {
      // Nothing that could be written: the window is still read-and-done.
      result.skippedReason = presentParticipants.length === 0 ? 'nobody-present' : 'nothing-eligible'
      logger.debug('[FoldEpisodePass] Nothing to extract; covering the window', {
        chatId,
        reason: result.skippedReason,
        windowMessages: window.length,
      })
      await advanceWatermark(chatId, coverThrough, result)
      return result
    }

    if (slices.length > 1) {
      logger.info('[FoldEpisodePass] Window wider than one prompt; reading it in slices', {
        chatId,
        eligible: eligible.length,
        slices: slices.length,
        perSlice: FOLD_EPISODE_MAX_WINDOW_MESSAGES,
      })
    }

    // Resolve speaker names per participant. Shared with the context-summary
    // fold — see lib/chat/speaker-names.ts for why there is only one of these.
    const speakerNames = await resolveSpeakerNames(chat)
    // Episodes this run has written, per character: never a fragment of a later episode (finding 10).
    const writtenEpisodeIds = new Set<string>()

    for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex++) {
      const slice = slices[sliceIndex]
      const outcome = await runSlice(input, slice.messages, presentParticipants, speakerNames, writtenEpisodeIds, result)
      if (outcome === 'timed-out') {
        result.timedOut = true
        logger.warn('[FoldEpisodePass] Slice lost to a timeout; watermark not advanced past it', {
          chatId,
          slice: sliceIndex + 1,
          slices: slices.length,
        })
        break
      }
      await advanceWatermark(chatId, slice.coverThroughMessageId, result)
    }

    logger.info('[FoldEpisodePass] Episode pass complete', {
      chatId,
      slices: result.slices,
      episodesExtracted: result.episodesExtracted,
      memoriesWritten: result.memoriesWritten,
      fragmentsLinked: result.fragmentsLinked,
      watermarkAdvancedTo: result.watermarkAdvancedTo,
    })
    return result
  } catch (error) {
    logger.warn('[FoldEpisodePass] Episode pass failed (non-fatal)', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
    return result
  }
}

/**
 * Extract and write the episodes of one slice. Returns `'timed-out'` when the
 * cheap LLM timed out (the slice was not read), `'done'` otherwise — a refusal
 * or an unparseable answer would fail the same way on every retry, so it
 * counts as read.
 */
async function runSlice(
  input: RunFoldEpisodePassInput,
  sliceMessages: MessageEvent[],
  presentParticipants: ChatParticipantBase[],
  speakerNames: SpeakerNames,
  writtenEpisodeIds: Set<string>,
  result: FoldEpisodePassResult,
): Promise<'done' | 'timed-out'> {
  const { chatId, userId, cheapLLM } = input
  const repos = getRepositories()

  // Anchor the clock to the slice's newest message so historical folds
  // (regeneration sweeps) date correctly.
  const lastStamped = [...sliceMessages].reverse().find(m => m.createdAt)
  // The memory-calendar zone (bug 212) is resolved before the prompt is
  // built and rides on the clock to the `when` resolution below, so the date
  // the model is shown and the date its phrases resolve against agree.
  const clock: ExtractionClock = {
    nowIso: lastStamped?.createdAt ?? new Date().toISOString(),
    timelineMode: input.timelineMode,
    timeZone: await refreshMemoryTimeZone(),
  }

  const rendered: FoldEpisodeMessage[] = sliceMessages.map(m => ({
    speaker: speakerLabel(m, speakerNames),
    content: m.content ?? '',
    createdAt: m.createdAt ?? null,
  }))

  const extraction = await extractEpisodesFromFold(
    rendered,
    clock,
    cheapLLM,
    userId,
    chatId,
    input.uncensoredFallback,
  )
  if (!extraction.success || !extraction.result || extraction.result.length === 0) {
    if (!extraction.success) {
      logger.warn('[FoldEpisodePass] Episode extraction failed', {
        chatId,
        timedOut: extraction.timedOut === true,
        error: extraction.error,
      })
      if (extraction.timedOut) return 'timed-out'
    }
    return 'done'
  }
  result.episodesExtracted += extraction.result.length

  // First message timestamp of the slice — the default occurredAt when the
  // model's `when` phrase doesn't resolve.
  const firstStamped = sliceMessages.find(m => m.createdAt)
  const windowStartIso = firstStamped?.createdAt ?? clock.nowIso
  const windowMessageIds = sliceMessages.map(m => m.id)
  const sourceMessageId = lastStamped?.id ?? sliceMessages[sliceMessages.length - 1]?.id ?? null

  for (const episode of extraction.result) {
    // The phrase resolves against the slice's newest message (the clock the
    // model was told), falling back to its oldest.
    const { occurredAt, narrativeTime } = resolveEpisodicAnchors({
      when: episode.when,
      referenceIso: clock.nowIso,
      fallbackIso: windowStartIso,
      timelineMode: input.timelineMode,
      narrativeTime: episode.narrativeTime,
      timeZone: clock.timeZone,
    })

    for (const participant of presentParticipants) {
      const characterId = participant.characterId as string
      try {
        const outcome = await createMemoryWithGate(
          {
            characterId,
            content: episode.narrative,
            summary: episode.summary,
            keywords: [...episode.entities.map(e => e.toLowerCase()), 'past', 'scope: narrow', 'history'],
            importance: episode.importance,
            chatId,
            projectId: input.projectId ?? null,
            source: 'AUTO',
            sourceMessageId,
            sourceMessageTimestamp: occurredAt,
            witnessedContext: input.inAutonomousRoom ? 'autonomous_room' : 'user_present',
            occurredAt,
            narrativeTime,
            entities: episode.entities,
            kind: 'episodic',
            tags: [],
          },
          { userId },
        )

        const memory = outcome.memory
        if (!memory) continue
        writtenEpisodeIds.add(memory.id)
        if (outcome.action === 'INSERT' || outcome.action === 'INSERT_RELATED' || outcome.action === 'SKIP_GATE') {
          result.memoriesWritten++
        }

        // Link the character's per-turn fragment memories from the same
        // slice so one-hop expansion can pull them when the episode
        // surfaces. Union-preserving on both sides (never clobber links the
        // gate already made) — this relies on `createMemoryWithGate` returning
        // the POST-LINK row for INSERT_RELATED, so `memory.relatedMemoryIds`
        // below already carries the gate's links (Bug 26). An episode this
        // run wrote shares the slice's source message (and the job child's
        // overlay surfaces it), but it is a sibling, not a fragment: linking it
        // would spend fragment slots on episodes (finding 10).
        const candidates = await repos.memories.findByCharacterAndSourceMessageIds(
          characterId,
          windowMessageIds,
        )
        const fragments = candidates.filter(f => !writtenEpisodeIds.has(f.id))
        if (fragments.length < candidates.length) {
          logger.debug('[FoldEpisodePass] Left sibling episodes out of the fragment links', {
            chatId,
            characterId,
            episodeId: memory.id,
            siblings: candidates.length - fragments.length,
          })
        }
        const fragmentIds = fragments
          .map(f => f.id)
          .filter(id => id !== memory.id)
          .slice(0, MAX_FRAGMENT_LINKS)
        if (fragmentIds.length === 0) continue

        // Links are deltas against the rows at commit, never lists built from
        // this read: another job linking the same rows keeps its links (bug 231).
        const existingEpisodeLinks = new Set(memory.relatedMemoryIds ?? [])
        const newEpisodeLinks = fragmentIds.filter(id => !existingEpisodeLinks.has(id))
        if (newEpisodeLinks.length > 0) {
          await repos.memories.addRelatedMemoryIds(characterId, memory.id, newEpisodeLinks)
        }
        for (const fragment of fragments) {
          if (fragment.id === memory.id) continue
          if (!fragmentIds.includes(fragment.id)) continue
          if ((fragment.relatedMemoryIds ?? []).includes(memory.id)) continue
          await repos.memories.addRelatedMemoryIds(characterId, fragment.id, [memory.id])
          result.fragmentsLinked++
        }
      } catch (perCharacterError) {
        logger.warn('[FoldEpisodePass] Failed to write episode for character', {
          chatId,
          characterId,
          error: perCharacterError instanceof Error ? perCharacterError.message : String(perCharacterError),
        })
      }
    }
  }
  return 'done'
}

async function loadTranscript(chatId: string): Promise<MessageEvent[]> {
  logger.debug('[FoldEpisodePass] Reading the transcript to place the watermark', { chatId })
  return (await getRepositories().chats.getMessages(chatId)).filter(
    (m): m is MessageEvent => m.type === 'message',
  ) as unknown as MessageEvent[]
}

async function advanceWatermark(
  chatId: string,
  messageId: string | null,
  result: FoldEpisodePassResult,
): Promise<void> {
  if (!messageId) return
  try {
    await getRepositories().chats.update(chatId, { episodeExtractionWatermarkMessageId: messageId })
    result.watermarkAdvancedTo = messageId
    logger.debug('[FoldEpisodePass] Watermark advanced', { chatId, messageId })
  } catch (error) {
    logger.warn('[FoldEpisodePass] Failed to advance watermark', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
