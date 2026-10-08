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
 * message covered after every pass that was not lost to a timeout. Messages at
 * or before it are never re-read, which is also what keeps a fold that
 * re-walks old turns (a summary rebuild) from re-paying for them. The daily
 * maintenance sweep uses the same watermark to catch up short or idle chats
 * that never reach a fold (`findFoldOtherCatchupCandidates`).
 *
 * Best-effort throughout: never throws into the fold.
 *
 * @module memory/fold-other-pass
 */

import { getRepositories } from '@/lib/repositories/factory'
import {
  extractOtherMemoriesFromFold,
  loadCanonForObserverAboutSubject,
  renderOtherCanonBlock,
  MemoryCandidate,
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
import { resolveSpeakerNames, speakerLabel } from '@/lib/chat/speaker-names'
import { resolveUserCharacterParticipant } from '@/lib/services/chat-message/turn-transcript'
import { getMemoryExtractionModeSettings, getMemoryExtractionLimits } from '@/lib/instance-settings'
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection, type CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { resolveMaxTokens } from '@/lib/llm/model-context-data'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service'
import { isHelpLikeChatType } from '@/lib/schemas/chat.types'
import type { Pronouns } from '@/lib/schemas/character.types'
import type {
  Character,
  ChatMetadata,
  CheapLLMSettings,
  ConnectionProfile,
  MessageEvent,
} from '@/lib/schemas/types'
import { logger } from '@/lib/logger'

/** A fold window can be a whole rebuilt history; the prompt reads at most the newest this many messages. */
export const FOLD_OTHER_MAX_WINDOW_MESSAGES = 60

/** A chat must have been quiet this long before the sweep treats its tail as uncovered. */
export const FOLD_OTHER_CATCHUP_IDLE_MS = 2 * 60 * 60 * 1000

/** Chats whose last message is older than this are not swept (an old backlog is a backfill, not a catch-up). */
export const FOLD_OTHER_CATCHUP_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

/** Most catch-up jobs one sweep will enqueue; the rest wait for tomorrow. */
export const FOLD_OTHER_CATCHUP_MAX_CHATS = 50

export interface RunFoldOtherPassInput {
  chatId: string
  userId: string
  /** The covered window: chronological, may contain system/tool rows (they are filtered). */
  windowMessages: MessageEvent[]
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
    watermarkAdvancedTo: null,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }
}

/** A message that carries conversation: a spoken USER/ASSISTANT line from a seat, not staff or tool output. */
export function isFoldOtherEligibleMessage(m: MessageEvent): boolean {
  if (m.type !== 'message') return false
  if (m.role !== 'USER' && m.role !== 'ASSISTANT') return false
  if (m.systemSender) return false
  if (!m.participantId) return false
  return typeof m.content === 'string' && m.content.trim().length > 0
}

/**
 * Messages strictly after the watermark. A watermark that names a message no
 * longer in the chat (deleted) is treated as absent — better to re-read the
 * tail once than to go blind forever.
 */
export function messagesPastWatermark<T extends { id: string }>(
  allMessages: ReadonlyArray<T>,
  watermarkMessageId: string | null | undefined,
): T[] {
  if (!watermarkMessageId) return [...allMessages]
  const idx = allMessages.findIndex(m => m.id === watermarkMessageId)
  if (idx === -1) return [...allMessages]
  return allMessages.slice(idx + 1)
}

/**
 * Run the fold-grain OTHER pass over a window. See module docs.
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

    // Drop what the watermark already covers. The fold may re-walk early turns
    // (a summary rebuild); the watermark is what stops us paying twice.
    let window = input.windowMessages
    if (chat.otherExtractionWatermarkMessageId && window.length > 0) {
      const all = (await repos.chats.getMessages(chatId)).filter(
        (m): m is MessageEvent => m.type === 'message',
      ) as unknown as MessageEvent[]
      const watermarkIdx = all.findIndex(m => m.id === chat.otherExtractionWatermarkMessageId)
      if (watermarkIdx !== -1) {
        const order = new Map(all.map((m, i) => [m.id, i]))
        const before = window.length
        window = window.filter(m => (order.get(m.id) ?? Infinity) > watermarkIdx)
        logger.debug('[FoldOtherPass] Applied watermark to window', {
          chatId,
          watermark: chat.otherExtractionWatermarkMessageId,
          before,
          after: window.length,
        })
        if (window.length === 0) return emptyResult('behind-watermark')
      }
    }

    const coverThrough =
      input.coverThroughMessageId ?? window[window.length - 1]?.id ?? null
    const eligible = window.filter(isFoldOtherEligibleMessage)
    const trimmed = eligible.slice(-FOLD_OTHER_MAX_WINDOW_MESSAGES)
    if (trimmed.length < eligible.length) {
      logger.debug('[FoldOtherPass] Window trimmed to newest messages', {
        chatId,
        eligible: eligible.length,
        kept: trimmed.length,
      })
    }

    // Seats and characters.
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

    // Observers: characters who spoke in the window. Subjects: those plus the
    // user-controlled character even if silent — as in the per-turn pass.
    interface Seat { id: string; name: string; pronouns: Pronouns | null; isUser: boolean }
    const observers: Seat[] = []
    const seen = new Set<string>()
    const lastMessageByCharacter = new Map<string, MessageEvent>()
    for (const m of trimmed) {
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

    result.observers = observers.length
    logger.debug('[FoldOtherPass] Pass set up', {
      chatId,
      mode: modeSettings.otherPass,
      perSubjectCap,
      windowMessages: trimmed.length,
      observers: observers.length,
      subjects: subjects.length,
    })

    if (trimmed.length === 0 || observers.length === 0 || subjects.length < 2) {
      result.skippedReason = 'nothing-to-observe'
      await advanceWatermark(chatId, coverThrough, input.dryRun === true, result)
      return result
    }

    const speakerNames = await resolveSpeakerNames(chat)
    const rendered: FoldOtherMessage[] = trimmed.map(m => ({
      speaker: speakerLabel(m, speakerNames),
      content: m.content ?? '',
      createdAt: m.createdAt ?? null,
    }))
    const lastStamped = [...trimmed].reverse().find(m => m.createdAt)
    const clock: ExtractionClock = {
      nowIso: lastStamped?.createdAt ?? new Date().toISOString(),
      timelineMode: input.timelineMode,
    }
    const orienting: OrientingContext = {
      projectDescription: input.projectDescription ?? null,
      chatContextSummary: input.chatContextSummary ?? null,
    }
    const limits = await getMemoryExtractionLimits()
    const collected: ExtractedCandidate[] = []
    const createdIds: string[] = []
    const reinforcedIds: string[] = []
    const debugLogs: string[] = []
    const writeCtx = {
      chatId,
      userId,
      projectId: input.projectId ?? null,
      timelineMode: input.timelineMode,
      inAutonomousRoom: input.inAutonomousRoom,
      dryRun: input.dryRun,
      transcript: { turnTimestamp: clock.nowIso },
    }

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
        if (extraction.timedOut) result.passesLostToTimeout++
        logger.warn('[FoldOtherPass] OTHER extraction failed', {
          chatId,
          observer: observer.name,
          timedOut: extraction.timedOut === true,
          error: extraction.error,
        })
        continue
      }

      const bySubject = extraction.result ?? new Map<string, MemoryCandidate[]>()
      const lastMessage = lastMessageByCharacter.get(observer.id) ?? trimmed[trimmed.length - 1]
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
            candidate,
            passLabel: `fold OTHER memory ${observer.name} about ${subject.name}`,
            ctx: writeCtx,
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

    result.memoriesWritten = createdIds.length
    result.memoriesReinforced = reinforcedIds.length
    if (input.dryRun) result.extractedCandidates = collected

    // A pass lost to a timeout leaves the watermark where it was: the window
    // is still uncovered and the next fold or sweep will take it up.
    if (result.passesLostToTimeout === 0) {
      await advanceWatermark(chatId, coverThrough, input.dryRun === true, result)
    } else {
      logger.warn('[FoldOtherPass] Passes lost to timeout; watermark not advanced', {
        chatId,
        passesLostToTimeout: result.passesLostToTimeout,
      })
    }

    logger.info('[FoldOtherPass] Fold-grain OTHER pass complete', {
      chatId,
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
  const prefiltered = chats
    .filter(c => !isHelpLikeChatType(c.chatType))
    .filter(c => (c.messageCount ?? 0) >= 2)
    .map(c => ({ chat: c, last: c.lastMessageAt ? Date.parse(c.lastMessageAt) : NaN }))
    .filter(x => Number.isFinite(x.last))
    .filter(x => now - x.last > FOLD_OTHER_CATCHUP_IDLE_MS && now - x.last < FOLD_OTHER_CATCHUP_LOOKBACK_MS)
    .sort((a, b) => b.last - a.last)

  const candidates: FoldOtherCatchupCandidate[] = []
  let deferred = 0
  for (const { chat } of prefiltered) {
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
      const profileId = pickConnectionProfileId(chat)
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

function pickConnectionProfileId(chat: ChatMetadata): string | null {
  const llmSeat = chat.participants.find(
    p => p.type === 'CHARACTER' && p.controlledBy !== 'user' && p.connectionProfileId,
  )
  const anySeat = llmSeat ?? chat.participants.find(p => p.connectionProfileId)
  return anySeat?.connectionProfileId ?? null
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
  const lastAt = chat.lastMessageAt ? Date.parse(chat.lastMessageAt) : NaN
  if (!input.ignoreIdle && Number.isFinite(lastAt) && now - lastAt <= FOLD_OTHER_CATCHUP_IDLE_MS) {
    logger.debug('[FoldOtherCatchup] Chat active again since the sweep; leaving it to the fold', { chatId })
    return emptyResult('not-idle')
  }

  const messages = (await repos.chats.getMessages(chatId)).filter(
    (m): m is MessageEvent => m.type === 'message',
  ) as unknown as MessageEvent[]
  const window = messagesPastWatermark(messages, chat.otherExtractionWatermarkMessageId)
  if (window.length === 0) return emptyResult('behind-watermark')

  let cheapLLM: CheapLLMSelection = getCheapLLMProvider(
    input.connectionProfile,
    {
      strategy: input.cheapLLMSettings.strategy,
      userDefinedProfileId: input.cheapLLMSettings.userDefinedProfileId ?? undefined,
      fallbackToLocal: input.cheapLLMSettings.fallbackToLocal,
    },
    input.availableProfiles,
    false,
  )
  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const conciergePolicy = resolveConciergeSettings(chatSettings, chat)
  cheapLLM = resolveUncensoredCheapLLMSelection(
    cheapLLM,
    shouldUseUncensoredRoute(chat),
    conciergePolicy,
    input.availableProfiles,
  )

  let projectDescription: string | null = null
  if (chat.projectId) {
    try {
      projectDescription = (await repos.projects.findById(chat.projectId))?.description ?? null
    } catch {
      // degrade to no project description
    }
  }

  logger.debug('[FoldOtherCatchup] Running catch-up pass', {
    chatId,
    windowMessages: window.length,
    watermark: chat.otherExtractionWatermarkMessageId ?? null,
  })
  return runFoldOtherPass({
    chatId,
    userId,
    windowMessages: window,
    cheapLLM,
    cheapMaxTokens: resolveMaxTokens(input.connectionProfile),
    uncensoredFallback: { conciergePolicy, availableProfiles: input.availableProfiles },
    timelineMode: chat.timelineMode ?? 'realtime',
    projectId: chat.projectId ?? null,
    inAutonomousRoom: chat.chatType === 'autonomous',
    projectDescription,
    chatContextSummary: chat.contextSummary ?? null,
    coverThroughMessageId: messages[messages.length - 1]?.id ?? null,
  })
}
