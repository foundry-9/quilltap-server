/**
 * Fold-grain OTHER pass (memory consolidation, workstream A).
 *
 * A single turn shows one beat of a thread, so the per-turn OTHER pass emits
 * fragments of it and the gate cannot fold paraphrases back together. This
 * pass reads a *stretch* of conversation instead — the window the context
 * summary has just folded, or the uncovered tail of an idle chat — and asks,
 * per (observer, subject) pair, for at most `foldCandidatesPerSubject`
 * candidates, each thread stated once.
 *
 * Candidates reach the store through the very writer the per-turn pass uses
 * (`writeCandidate` in memory-processor.ts → `createMemoryWithGate`), so
 * about-character resolution, witnessedContext and occurredAt stamping cannot
 * drift between the two grains. Speaker labels come from the shared resolver
 * (`lib/chat/speaker-names.ts`), never from message roles. The Concierge
 * policy and uncensored fallback are inherited exactly as the per-turn pass
 * inherits them.
 *
 * Mode (`getMemoryExtractionModeSettings().otherPass`): runs in 'fold' and
 * 'hybrid', never in 'turn'.
 *
 * Watermark: `chats.otherExtractionWatermarkMessageId` is advanced to the last
 * message covered after every slice that was not lost to a timeout. Messages
 * at or before it are never re-read, which is also what keeps a fold that
 * re-walks old turns (a summary rebuild) from re-paying for them. A window
 * wider than one prompt is read in consecutive slices, so the watermark never
 * passes a message the prompt did not see (bug 206). The pass reads from its
 * watermark through the end of the window it is handed (`foldPassRange`), so
 * a slice an earlier run lost to a timeout is read before a newer fold window
 * rather than jumped; and one run reads at most
 * {@link FOLD_OTHER_MAX_SLICES_PER_JOB} slices, leaving the rest of a long
 * backlog to the next fold or sweep. The daily maintenance
 * sweep uses the same watermark to catch up short or idle chats that never
 * reach a fold (`findFoldOtherCatchupCandidates`).
 *
 * Best-effort throughout: never throws into the fold.
 *
 * @module memory/fold-other-pass
 */

import { refreshMemoryTimeZone } from './time/calendar-refresh'
import { getRepositories } from '@/lib/repositories/factory'
import {
  extractOtherMemoriesFromFold,
  loadCanonForObserverAboutSubject,
  renderOtherCanonBlock,
  MemoryDraft,
  type UncensoredFallbackOptions,
  type OrientingContext,
  type ExtractionClock,
  type FoldOtherMessage,
  type OtherSubjectInput,
} from './cheap-llm-tasks'
import {
  writeCandidate,
  applyImportanceFloor,
  resolveExtractionRateLimit,
  type ExtractedCandidate,
} from './memory-processor'
import {
  isFoldEligibleMessage,
  messagesPastWatermark,
  foldPassRange,
  sliceFoldWindow,
} from './fold-window'
import { loadExtractionProjectDescription } from './extraction-route'
import {
  FOLD_CATCHUP_IDLE_MS,
  FOLD_CATCHUP_LOOKBACK_MS,
  FOLD_CATCHUP_MAX_CHATS,
  idleChatsForCatchup,
  isChatActiveForCatchup,
  pickCatchupConnectionProfileId,
  resolveFoldCatchupRoute,
} from './fold-catchup'
import { resolveSpeakerNames, speakerLabel } from '@/lib/chat/speaker-names'
import { resolveUserCharacterParticipant } from '@/lib/services/chat-message/turn-transcript'
import { getMemoryExtractionModeSettings, getMemoryExtractionLimits } from '@/lib/instance-settings'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { resolveMaxTokens } from '@/lib/llm/model-context-data'
import type { Pronouns } from '@/lib/schemas/character.types'
import type {
  Character,
  CheapLLMSettings,
  ConnectionProfile,
  MessageEvent,
} from '@/lib/schemas/types'
import { logger } from '@/lib/logger'

/** One prompt reads at most this many eligible messages; a wider window is read in consecutive slices of it. */
export const FOLD_OTHER_MAX_WINDOW_MESSAGES = 60

/** One run reads at most this many slices; a longer backlog continues on the next fold or sweep, from the advanced watermark. */
export const FOLD_OTHER_MAX_SLICES_PER_JOB = 4

/** A chat must have been quiet this long before the sweep treats its tail as uncovered. */
export const FOLD_OTHER_CATCHUP_IDLE_MS = FOLD_CATCHUP_IDLE_MS

/** Chats whose last message is older than this are not swept (an old backlog is a backfill, not a catch-up). */
export const FOLD_OTHER_CATCHUP_LOOKBACK_MS = FOLD_CATCHUP_LOOKBACK_MS

/** Most catch-up jobs one sweep will enqueue; the rest wait for tomorrow. */
export const FOLD_OTHER_CATCHUP_MAX_CHATS = FOLD_CATCHUP_MAX_CHATS

export interface RunFoldOtherPassInput {
  chatId: string
  userId: string
  /** The covered window: chronological, may contain system/tool rows (they are filtered). */
  windowMessages: MessageEvent[]
  /**
   * The chat's whole transcript (`type: 'message'` rows, chronological), when
   * the caller already holds it. Saves a second full read and decompression;
   * read here only when absent and a watermark needs it.
   */
  chatMessages?: MessageEvent[]
  cheapLLM: CheapLLMSelection
  /** The profile whose token budget bounds the call (per-turn uses the chat profile). */
  cheapMaxTokens?: number
  uncensoredFallback?: UncensoredFallbackOptions
  timelineMode: 'realtime' | 'narrative'
  projectId?: string | null
  inAutonomousRoom: boolean
  /** Background only — never a source of memories. */
  projectDescription?: string | null
  chatContextSummary?: string | null
  /** The message the watermark advances to. Defaults to the last window message. */
  coverThroughMessageId?: string | null
  dryRun?: boolean
}

export interface FoldOtherPassResult {
  /** Set when the pass did nothing on purpose (e.g. `mode-turn`, `no-chat`, `behind-watermark`). */
  skippedReason?: string
  observers: number
  memoriesWritten: number
  memoriesReinforced: number
  candidatesProposed: number
  /** Passes that never happened because the cheap LLM timed out. The caller may fail a job on this. */
  passesLostToTimeout: number
  /** Slices left unread because the run hit {@link FOLD_OTHER_MAX_SLICES_PER_JOB}. */
  slicesDeferred: number
  watermarkAdvancedTo: string | null
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  extractedCandidates?: ExtractedCandidate[]
}

function emptyResult(skippedReason?: string): FoldOtherPassResult {
  return {
    skippedReason,
    observers: 0,
    memoriesWritten: 0,
    memoriesReinforced: 0,
    candidatesProposed: 0,
    passesLostToTimeout: 0,
    slicesDeferred: 0,
    watermarkAdvancedTo: null,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }
}

/** A message that carries conversation: a spoken USER/ASSISTANT line from a seat, not staff or tool output. */
export const isFoldOtherEligibleMessage = isFoldEligibleMessage

export { messagesPastWatermark }

/**
 * Run the fold-grain OTHER pass over a window. See module docs.
 *
 * A window wider than {@link FOLD_OTHER_MAX_WINDOW_MESSAGES} eligible messages
 * (a regenerate, a first catch-up, a hard-rebuild fold on a chat with no
 * watermark) is read in consecutive slices, oldest first, and the watermark
 * advances past each slice as it is read. A slice that loses a pass to a
 * timeout stops the run there, so nothing past the last read slice is marked
 * covered (bug 206).
 */
export async function runFoldOtherPass(input: RunFoldOtherPassInput): Promise<FoldOtherPassResult> {
  const result = emptyResult()
  const { chatId, userId } = input

  try {
    const modeSettings = await getMemoryExtractionModeSettings()
    if (modeSettings.otherPass === 'turn') {
      logger.debug('[FoldOtherPass] otherPass=turn; fold-grain pass not run', { chatId })
      return emptyResult('mode-turn')
    }
    const perSubjectCap = Math.max(1, modeSettings.foldCandidatesPerSubject)

    const repos = getRepositories()
    const chat = await repos.chats.findById(chatId)
    if (!chat) return emptyResult('no-chat')

    // Read from the watermark through the end of the window. The fold may
    // re-walk early turns (a summary rebuild); the watermark is what stops us
    // paying twice. A fold of only newer turns after a lost slice hands us a
    // window past a gap; the gap is read first, never jumped.
    let window = input.windowMessages
    if (chat.otherExtractionWatermarkMessageId && window.length > 0) {
      const all = input.chatMessages ?? (await loadTranscript(chatId))
      const before = window.length
      const range = foldPassRange(window, all, chat.otherExtractionWatermarkMessageId)
      if (range.applied) {
        window = range.messages
        logger.debug('[FoldOtherPass] Applied watermark to window', {
          chatId,
          watermark: chat.otherExtractionWatermarkMessageId,
          before,
          after: window.length,
          gap: range.gap,
          transcriptHandedIn: input.chatMessages !== undefined,
        })
        if (window.length === 0) return emptyResult('behind-watermark')
      }
    }

    const coverThrough =
      input.coverThroughMessageId ?? window[window.length - 1]?.id ?? null
    const eligible = window.filter(isFoldEligibleMessage)
    const allSlices = sliceFoldWindow(eligible, FOLD_OTHER_MAX_WINDOW_MESSAGES, coverThrough)
    const slices = allSlices.slice(0, FOLD_OTHER_MAX_SLICES_PER_JOB)
    result.slicesDeferred = allSlices.length - slices.length
    if (result.slicesDeferred > 0) {
      logger.info('[FoldOtherPass] Backlog wider than one run; the rest waits for the next fold or sweep', {
        chatId,
        slicesRead: slices.length,
        slicesDeferred: result.slicesDeferred,
      })
    }
    if (slices.length > 1) {
      logger.info('[FoldOtherPass] Window wider than one prompt; reading it in slices', {
        chatId,
        eligible: eligible.length,
        slices: slices.length,
        perSlice: FOLD_OTHER_MAX_WINDOW_MESSAGES,
      })
    }

    if (slices.length === 0) {
      result.skippedReason = 'nothing-to-observe'
      await advanceWatermark(chatId, coverThrough, input.dryRun === true, result)
      return result
    }

    // Seats and characters, hydrated once for every slice.
    const participantsById = new Map(chat.participants.map(p => [p.id, p]))
    const participantCharacters = new Map<string, Character>()
    for (const p of chat.participants) {
      if (p.type !== 'CHARACTER' || !p.characterId) continue
      try {
        const character = await repos.characters.findById(p.characterId)
        if (character) participantCharacters.set(p.characterId, character)
      } catch (error) {
        logger.debug('[FoldOtherPass] Character unavailable; leaving it out', {
          chatId,
          characterId: p.characterId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const userCharacter = resolveUserCharacterParticipant(chat.participants, participantCharacters)
    const speakerNames = await resolveSpeakerNames(chat)
    const limits = await getMemoryExtractionLimits()
    const orienting: OrientingContext = {
      projectDescription: input.projectDescription ?? null,
      chatContextSummary: input.chatContextSummary ?? null,
    }
    const collected: ExtractedCandidate[] = []
    const createdIds: string[] = []
    const reinforcedIds: string[] = []
    const debugLogs: string[] = []
    const observerIds = new Set<string>()
    let slicesWithNothingToObserve = 0

    for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex++) {
      const slice = slices[sliceIndex]
      const sliceMessages = slice.messages

      // Observers: characters who spoke in the slice. Subjects: those plus the
      // user-controlled character even if silent — as in the per-turn pass.
      interface Seat { id: string; name: string; pronouns: Pronouns | null; isUser: boolean }
      const observers: Seat[] = []
      const seen = new Set<string>()
      const lastMessageByCharacter = new Map<string, MessageEvent>()
      for (const m of sliceMessages) {
        const seat = participantsById.get(m.participantId as string)
        if (!seat || seat.type !== 'CHARACTER' || !seat.characterId) continue
        lastMessageByCharacter.set(seat.characterId, m)
        if (seen.has(seat.characterId)) continue
        const character = participantCharacters.get(seat.characterId)
        if (!character) continue
        seen.add(seat.characterId)
        observers.push({
          id: seat.characterId,
          name: character.name,
          pronouns: character.pronouns ?? null,
          isUser: seat.controlledBy === 'user',
        })
      }
      const subjects: Seat[] = [...observers]
      if (userCharacter && !seen.has(userCharacter.id)) {
        subjects.push({ id: userCharacter.id, name: userCharacter.name, pronouns: userCharacter.pronouns ?? null, isUser: true })
      }
      for (const o of observers) observerIds.add(o.id)

      logger.debug('[FoldOtherPass] Slice set up', {
        chatId,
        mode: modeSettings.otherPass,
        perSubjectCap,
        slice: sliceIndex + 1,
        slices: slices.length,
        windowMessages: sliceMessages.length,
        observers: observers.length,
        subjects: subjects.length,
      })

      if (observers.length === 0 || subjects.length < 2) {
        slicesWithNothingToObserve++
        await advanceWatermark(chatId, slice.coverThroughMessageId, input.dryRun === true, result)
        continue
      }

      const rendered: FoldOtherMessage[] = sliceMessages.map(m => ({
        speaker: speakerLabel(m, speakerNames),
        content: m.content ?? '',
        createdAt: m.createdAt ?? null,
      }))
      const lastStamped = [...sliceMessages].reverse().find(m => m.createdAt)
      // The memory-calendar zone is resolved before the prompt is built and
      // rides on the clock to the `when` resolver (writeCandidate).
      const clock: ExtractionClock = {
        nowIso: lastStamped?.createdAt ?? new Date().toISOString(),
        timelineMode: input.timelineMode,
        timeZone: await refreshMemoryTimeZone(),
      }
      const writeCtx = {
        chatId,
        userId,
        projectId: input.projectId ?? null,
        timelineMode: input.timelineMode,
        inAutonomousRoom: input.inAutonomousRoom,
        dryRun: input.dryRun,
        transcript: { turnTimestamp: clock.nowIso },
      }
      let sliceTimeouts = 0

      for (const observer of observers) {
        const rl = await resolveExtractionRateLimit(observer.id, limits)
        if (rl.mode === 'skip') {
          logger.debug('[FoldOtherPass] Observer rate-limited; skipping', {
            chatId,
            observer: observer.name,
            recentCount: rl.recentCount,
            cap: rl.cap,
          })
          continue
        }

        const observerCharacter = participantCharacters.get(observer.id)
        const observerVault = {
          characterId: observer.id,
          mountPointId: observerCharacter?.characterDocumentMountPointId ?? null,
        }
        type ResolvedSubject = OtherSubjectInput & { canonSource: string }
        const resolved: ResolvedSubject[] = []
        for (const subject of subjects.filter(s => s.id !== observer.id)) {
          const subjectCharacter = participantCharacters.get(subject.id)
          const canon = await loadCanonForObserverAboutSubject(observerVault, {
            id: subject.id,
            name: subject.name,
            identity: subjectCharacter?.identity ?? null,
            description: subjectCharacter?.description ?? null,
          })
          resolved.push({
            id: subject.id,
            name: subject.name,
            pronouns: subject.pronouns,
            isUser: subject.isUser,
            canonBlock: renderOtherCanonBlock(canon),
            canonSource: canon.source,
          })
        }
        if (resolved.length === 0) continue

        const extraction = await extractOtherMemoriesFromFold(
          rendered,
          { id: observer.id, name: observer.name, pronouns: observer.pronouns },
          resolved,
          perSubjectCap,
          input.cheapLLM,
          userId,
          input.uncensoredFallback,
          chatId,
          input.cheapMaxTokens,
          input.inAutonomousRoom,
          orienting,
          clock,
        )

        if (extraction.usage) {
          result.usage.promptTokens += extraction.usage.promptTokens
          result.usage.completionTokens += extraction.usage.completionTokens
          result.usage.totalTokens += extraction.usage.totalTokens
        }
        if (!extraction.success) {
          if (extraction.timedOut) {
            result.passesLostToTimeout++
            sliceTimeouts++
          }
          logger.warn('[FoldOtherPass] OTHER extraction failed', {
            chatId,
            observer: observer.name,
            slice: sliceIndex + 1,
            timedOut: extraction.timedOut === true,
            error: extraction.error,
          })
          continue
        }

        const bySubject = extraction.result ?? new Map<string, MemoryDraft[]>()
        const lastMessage = lastMessageByCharacter.get(observer.id) ?? sliceMessages[sliceMessages.length - 1]
        for (const subject of resolved) {
          // The parser allows one extra slot for an anchored event; the fold
          // grain's contract is a hard cap per subject.
          const proposed = (bySubject.get(subject.id) ?? []).slice(0, perSubjectCap)
          const candidates = rl.mode === 'throttle' ? applyImportanceFloor(proposed, rl.floor) : proposed
          result.candidatesProposed += candidates.length
          logger.debug('[FoldOtherPass] Candidates for pair', {
            chatId,
            observer: observer.name,
            subject: subject.name,
            canon: subject.canonSource,
            proposed: proposed.length,
            kept: candidates.length,
          })
          for (const candidate of candidates) {
            await writeCandidate({
              characterId: observer.id,
              characterName: observer.name,
              aboutCharacterId: subject.id,
              aboutCharacterName: subject.name,
              pass: 'OTHER',
              candidatePass: 'other-fold',
              candidate,
              passLabel: `fold OTHER memory ${observer.name} about ${subject.name}`,
              ctx: writeCtx,
              timeZone: clock.timeZone,
              sourceMessageId: lastMessage?.id ?? null,
              sourceMessageCreatedAt: lastMessage?.createdAt ?? null,
              debugLogs,
              createdIds,
              reinforcedIds,
              collected,
            })
          }
        }
      }

      // A pass lost to a timeout leaves the watermark where it was: this slice
      // and everything after it are still uncovered, and the next fold or
      // sweep will take them up. Later slices are not read now — reading them
      // would let a later advance skip this one.
      if (sliceTimeouts > 0) {
        logger.warn('[FoldOtherPass] Passes lost to timeout; watermark not advanced past this slice', {
          chatId,
          slice: sliceIndex + 1,
          slices: slices.length,
          passesLostToTimeout: result.passesLostToTimeout,
        })
        break
      }
      await advanceWatermark(chatId, slice.coverThroughMessageId, input.dryRun === true, result)
    }

    result.observers = observerIds.size
    result.memoriesWritten = createdIds.length
    result.memoriesReinforced = reinforcedIds.length
    if (input.dryRun) result.extractedCandidates = collected
    if (slicesWithNothingToObserve === slices.length) result.skippedReason = 'nothing-to-observe'

    logger.info('[FoldOtherPass] Fold-grain OTHER pass complete', {
      chatId,
      slices: slices.length,
      observers: result.observers,
      candidatesProposed: result.candidatesProposed,
      memoriesWritten: result.memoriesWritten,
      memoriesReinforced: result.memoriesReinforced,
      watermarkAdvancedTo: result.watermarkAdvancedTo,
    })
    return result
  } catch (error) {
    logger.warn('[FoldOtherPass] Fold-grain OTHER pass failed (non-fatal)', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
    result.skippedReason = 'error'
    return result
  }
}

async function loadTranscript(chatId: string): Promise<MessageEvent[]> {
  logger.debug('[FoldOtherPass] Reading the transcript to place the watermark', { chatId })
  return (await getRepositories().chats.getMessages(chatId)).filter(
    (m): m is MessageEvent => m.type === 'message',
  ) as unknown as MessageEvent[]
}

async function advanceWatermark(
  chatId: string,
  messageId: string | null,
  dryRun: boolean,
  result: FoldOtherPassResult,
): Promise<void> {
  if (!messageId || dryRun) return
  try {
    await getRepositories().chats.update(chatId, { otherExtractionWatermarkMessageId: messageId })
    result.watermarkAdvancedTo = messageId
    logger.debug('[FoldOtherPass] Watermark advanced', { chatId, messageId })
  } catch (error) {
    logger.warn('[FoldOtherPass] Failed to advance watermark', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ============================================================================
// Idle catch-up (daily maintenance sweep)
// ============================================================================

export interface FoldOtherCatchupCandidate {
  chatId: string
  userId: string
  /** The chat's last conversation message — the watermark target and the job's dedupe anchor. */
  lastMessageId: string
  connectionProfileId: string
}

export interface FoldOtherCatchupSelection {
  candidates: FoldOtherCatchupCandidate[]
  /** Eligible chats beyond the per-sweep cap, left for the next sweep. */
  deferred: number
}

/**
 * Chats whose tail the fold-grain pass has not covered: idle for more than
 * {@link FOLD_OTHER_CATCHUP_IDLE_MS}, last message past the watermark, not a
 * help/brahma chat, and (cheap prefilter) active within the lookback. Mode
 * 'turn' selects nothing. Most recently active first, bounded by `limit`.
 */
export async function findFoldOtherCatchupCandidates(
  options: { now?: number; limit?: number } = {},
): Promise<FoldOtherCatchupSelection> {
  const now = options.now ?? Date.now()
  const limit = options.limit ?? FOLD_OTHER_CATCHUP_MAX_CHATS

  const mode = await getMemoryExtractionModeSettings()
  if (mode.otherPass === 'turn') {
    logger.debug('[FoldOtherCatchup] otherPass=turn; no catch-up needed')
    return { candidates: [], deferred: 0 }
  }

  const repos = getRepositories()
  const chats = await repos.chats.findAll()
  const prefiltered = idleChatsForCatchup(chats, now)

  const candidates: FoldOtherCatchupCandidate[] = []
  let deferred = 0
  for (const chat of prefiltered) {
    if (candidates.length >= limit) {
      // Counted without reading their messages; some may turn out covered.
      deferred++
      continue
    }
    try {
      const messages = (await repos.chats.getMessages(chat.id)).filter(
        (m): m is MessageEvent => m.type === 'message',
      ) as unknown as MessageEvent[]
      const last = messages[messages.length - 1]
      if (!last) continue
      if (chat.otherExtractionWatermarkMessageId === last.id) continue
      const profileId = pickCatchupConnectionProfileId(chat)
      if (!profileId) {
        logger.debug('[FoldOtherCatchup] No connection profile on any seat; skipping chat', { chatId: chat.id })
        continue
      }
      candidates.push({
        chatId: chat.id,
        userId: chat.userId,
        lastMessageId: last.id,
        connectionProfileId: profileId,
      })
    } catch (error) {
      logger.warn('[FoldOtherCatchup] Could not inspect chat; skipping', {
        chatId: chat.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.debug('[FoldOtherCatchup] Selection complete', {
    scanned: chats.length,
    idleAndRecent: prefiltered.length,
    selected: candidates.length,
    deferred,
  })
  return { candidates, deferred }
}

export interface RunFoldOtherCatchupInput {
  chatId: string
  userId: string
  connectionProfile: ConnectionProfile
  cheapLLMSettings: CheapLLMSettings
  availableProfiles: ConnectionProfile[]
  /** Skip the idle recheck (tests, manual runs). */
  ignoreIdle?: boolean
  now?: number
}

/**
 * Catch up one idle chat: build the window of messages past the watermark,
 * resolve the cheap LLM (Concierge-aware, as the per-turn handler does) and run
 * the pass. Called by the MEMORY_EXTRACTION handler's `foldOtherCatchup` branch.
 */
export async function runFoldOtherCatchup(input: RunFoldOtherCatchupInput): Promise<FoldOtherPassResult> {
  const { chatId, userId } = input
  const repos = getRepositories()
  const chat = await repos.chats.findById(chatId)
  if (!chat) return emptyResult('no-chat')

  const now = input.now ?? Date.now()
  if (!input.ignoreIdle && isChatActiveForCatchup(chat, now)) {
    logger.debug('[FoldOtherCatchup] Chat active again since the sweep; leaving it to the fold', { chatId })
    return emptyResult('not-idle')
  }

  const messages = (await repos.chats.getMessages(chatId)).filter(
    (m): m is MessageEvent => m.type === 'message',
  ) as unknown as MessageEvent[]
  const window = messagesPastWatermark(messages, chat.otherExtractionWatermarkMessageId)
  if (window.length === 0) return emptyResult('behind-watermark')

  const route = await resolveFoldCatchupRoute(chat, { ...input, userId })

  const projectDescription = await loadExtractionProjectDescription(chat.projectId, { chatId })

  logger.debug('[FoldOtherCatchup] Running catch-up pass', {
    chatId,
    windowMessages: window.length,
    watermark: chat.otherExtractionWatermarkMessageId ?? null,
  })
  return runFoldOtherPass({
    chatId,
    userId,
    windowMessages: window,
    chatMessages: messages,
    cheapLLM: route.cheapLLM,
    cheapMaxTokens: resolveMaxTokens(input.connectionProfile),
    uncensoredFallback: route.uncensoredFallback,
    timelineMode: chat.timelineMode ?? 'realtime',
    projectId: chat.projectId ?? null,
    inAutonomousRoom: chat.chatType === 'autonomous',
    projectDescription,
    chatContextSummary: chat.contextSummary ?? null,
    coverThroughMessageId: messages[messages.length - 1]?.id ?? null,
  })
}
