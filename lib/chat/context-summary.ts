/**
 * Context Summary Service
 * Sprint 5: Context Management
 *
 * Generates and updates conversation summaries for long chats.
 * Uses the cheap LLM system for efficient summarization.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { updateContextSummary, summarizeChat, ChatMessage, generateTitleFromSummary, considerTitleUpdate, considerHelpChatTitleUpdate, generateHelpChatTitleFromSummary } from '@/lib/memory/cheap-llm-tasks'
import { countMessagesTokens } from '@/lib/tokens/token-counter'
import { getModelContextLimit, shouldSummarizeConversation } from '@/lib/llm/model-context-data'
import { Provider, ConnectionProfile, CheapLLMSettings, ChatEvent, ChatMetadata, ChatParticipantBase, MessageEvent } from '@/lib/schemas/types'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { logger } from '@/lib/logger'
import { createContextSummaryEvent, createTitleGenerationEvent } from '@/lib/services/system-events.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { queueStoryBackgroundIfEnabled } from '@/lib/background-jobs/handlers/title-update'
import { postLibrarianSummaryAnnouncement, SUMMARY_CONTENT_PREFIX } from '@/lib/services/librarian-notifications/writer'
import {
  filterMessagesByHistoryAccess,
  filterMessagesByPresenceWindows,
  filterWhisperMessages,
  computePresenceWindowsForParticipant,
  type MessageWithParticipant,
} from '@/lib/chat/context/message-attribution'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'

/**
 * Triple-gate summarization triggers (Phase 2 of LLM cost-reduction plan).
 *
 * The previous behaviour fired summarization at every title checkpoint
 * (interchange counts 2, 3, 5, 7, 10, then every 10), eagerly recomputing
 * from scratch and fanning out to per-character whispers each time. On a
 * 84-turn session that produced ~252 summarization calls. The triple-gate
 * replaces that with budget-driven thresholds:
 *
 *   - T_soft: refresh when EITHER 8K+ tokens have been added since the last
 *     summary OR 8+ turns have passed. Updates the existing summary with
 *     recent messages.
 *   - T_promote: deferred to Phase 4 (layered-summary structure does not
 *     exist yet); included as a no-op so call-sites don't drift.
 *   - T_hard: full from-scratch rebuild every 50 turns (or sooner on drift
 *     detection later). Resets accumulated recursive error.
 *
 * Most turns return 'skip' and reuse the cached summary unchanged.
 */
export const T_SOFT_TOKEN_THRESHOLD = 8000
export const T_SOFT_TURN_THRESHOLD = 8
export const T_HARD_TURN_THRESHOLD = 50

export type SummarizationGateDecision = 'skip' | 'soft' | 'hard'

export interface SummarizationGateInputs {
  /** Current interchange count (output of calculateInterchangeCount). */
  currentTurn: number
  /** Total chat token estimate for current message set. */
  currentTokens: number
  /** From chat metadata. */
  lastSummaryTurn: number
  lastSummaryTokens: number
  lastFullRebuildTurn: number
  /** True if a contextSummary already exists on the chat. */
  hasExistingSummary: boolean
}

/**
 * Decide whether to skip, soft-refresh, or hard-rebuild the chat summary.
 * Pure function — no side effects.
 */
export function evaluateSummarizationGate(
  inputs: SummarizationGateInputs,
): SummarizationGateDecision {
  const { currentTurn, currentTokens, lastSummaryTurn, lastSummaryTokens, lastFullRebuildTurn, hasExistingSummary } = inputs

  // Need a meaningful amount of conversation before any summary makes sense.
  if (currentTurn < 2) return 'skip'

  // First-time generation: a chat with no existing summary that has crossed
  // the soft threshold should produce one. Treat as a soft fire so the
  // updateContextSummary path is tried first; full rebuild is reserved for
  // T_hard so the cheap-LLM cost stays bounded.
  if (!hasExistingSummary) {
    if (currentTurn >= T_SOFT_TURN_THRESHOLD || currentTokens >= T_SOFT_TOKEN_THRESHOLD) {
      return 'soft'
    }
    return 'skip'
  }

  // T_hard wins over T_soft when both fire, because a fresh rebuild
  // implicitly satisfies any soft refresh that was due.
  if (currentTurn - lastFullRebuildTurn >= T_HARD_TURN_THRESHOLD) {
    return 'hard'
  }

  const turnsSinceRefresh = currentTurn - lastSummaryTurn
  const tokensSinceRefresh = currentTokens - lastSummaryTokens
  if (turnsSinceRefresh >= T_SOFT_TURN_THRESHOLD || tokensSinceRefresh >= T_SOFT_TOKEN_THRESHOLD) {
    return 'soft'
  }

  return 'skip'
}

/**
 * Calculates the number of interchanges in a chat
 * An interchange is one user message + one assistant response
 */
export function calculateInterchangeCount(messages: Array<{ role?: string; type?: string }>): number {
  let userMessages = 0
  let assistantMessages = 0
  
  for (const msg of messages) {
    // Skip non-message types (like context-summary, tool-result, etc.)
    if (msg.type && msg.type !== 'message') {
      continue
    }
    
    const role = msg.role?.toUpperCase()
    if (role === 'USER') {
      userMessages++
    } else if (role === 'ASSISTANT') {
      assistantMessages++
    }
  }
  
  // An interchange is complete when both user and assistant have spoken
  // Return the minimum of the two (limiting factor)
  return Math.min(userMessages, assistantMessages)
}

/**
 * Determines if we should check for title update at this interchange count
 * Regular chats: checks at 2, 3, 5, 7, 10, then every 10 after
 * Help chats: checks at 1, 2, 3, 5, 7, 10, then every 10 after (fires immediately after first Q&A)
 */
export function shouldCheckTitleAtInterchange(
  currentInterchange: number,
  lastCheckedInterchange: number,
  chatType?: string
): boolean {
  const isHelpChat = chatType === 'help'

  // Help chats fire at interchange 1 (right after first Q&A)
  // Regular chats never check before interchange 2
  const minimumInterchange = isHelpChat ? 1 : 2
  if (currentInterchange < minimumInterchange) {
    return false
  }

  // If we haven't checked yet, and we're at one of the early checkpoints
  const earlyCheckpoints = isHelpChat ? [1, 2, 3, 5, 7, 10] : [2, 3, 5, 7, 10]
  if (earlyCheckpoints.includes(currentInterchange) && currentInterchange > lastCheckedInterchange) {
    return true
  }

  // After 10, check every 10 interchanges
  if (currentInterchange >= 10 && currentInterchange % 10 === 0 && currentInterchange > lastCheckedInterchange) {
    return true
  }

  return false
}

/**
 * Options for generating a context summary
 */
export interface GenerateSummaryOptions {
  /** User ID for API access */
  userId: string
  /** Chat ID to summarize */
  chatId: string
  /** Current connection profile being used */
  connectionProfile: ConnectionProfile
  /** Cheap LLM settings */
  cheapLLMSettings: CheapLLMSettings
  /** Available connection profiles for fallback */
  availableProfiles: ConnectionProfile[]
  /** Force regeneration even if summary exists */
  forceRegenerate?: boolean
}

/**
 * Result of summary generation
 */
export interface SummaryGenerationResult {
  success: boolean
  summary?: string
  error?: string
  /** Whether the summary was newly generated or already existed */
  wasGenerated: boolean
  /** Token usage for the generation */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Check if a chat needs a context summary
 * Based on message count and estimated token usage
 */
export async function chatNeedsSummary(
  chatId: string,
  provider: Provider,
  modelName: string
): Promise<{ needsSummary: boolean; reason?: string }> {
  const repos = getRepositories()

  // Get chat metadata
  const chat = await repos.chats.findById(chatId)
  if (!chat) {
    return { needsSummary: false, reason: 'Chat not found' }
  }

  // If already has a summary, check if it needs updating
  if (chat.contextSummary) {
    // Get message count since last summary
    // For now, we regenerate if message count exceeds threshold
    if (chat.messageCount < 100) {
      return { needsSummary: false, reason: 'Existing summary is recent enough' }
    }
  }

  // Get messages to estimate token count
  const messages = await repos.chats.getMessages(chatId)
  const conversationMessages = messages
    .filter(msg => msg.type === 'message')
    .filter(msg => {
      const role = (msg as { role: string }).role
      return role === 'USER' || role === 'ASSISTANT'
    })
    .map(msg => ({ role: (msg as { role: string }).role, content: (msg as { content: string }).content }))

  const estimatedTokens = countMessagesTokens(conversationMessages, provider)
  const contextLimit = getModelContextLimit(provider, modelName)

  if (shouldSummarizeConversation(conversationMessages.length, estimatedTokens, contextLimit)) {
    return {
      needsSummary: true,
      reason: `Conversation has ${conversationMessages.length} messages using ~${estimatedTokens} tokens (${Math.round((estimatedTokens / contextLimit) * 100)}% of context)`,
    }
  }

  return { needsSummary: false }
}

/**
 * Generate or update a context summary for a chat
 */
export async function generateContextSummary(
  options: GenerateSummaryOptions
): Promise<SummaryGenerationResult> {
  const {
    userId,
    chatId,
    connectionProfile,
    cheapLLMSettings,
    availableProfiles,
    forceRegenerate = false,
  } = options

  const repos = getRepositories()

  try {
    // Get chat
    const chat = await repos.chats.findById(chatId)
    if (!chat) {
      return { success: false, error: 'Chat not found', wasGenerated: false }
    }

    // The gating decision lives upstream now — see evaluateSummarizationGate
    // and checkAndGenerateSummaryIfNeeded. If a caller invokes this function
    // directly without forceRegenerate, we still produce a summary; the
    // incremental updateContextSummary path is selected automatically when
    // chat.contextSummary already exists.

    // Get cheap LLM provider - convert null values to undefined for compatibility
    let cheapLLM = getCheapLLMProvider(
      connectionProfile,
      {
        strategy: cheapLLMSettings.strategy,
        userDefinedProfileId: cheapLLMSettings.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: cheapLLMSettings.defaultCheapProfileId ?? undefined,
        fallbackToLocal: cheapLLMSettings.fallbackToLocal,
      },
      availableProfiles
    )

    if (!cheapLLM) {
      return { success: false, error: 'No cheap LLM provider available', wasGenerated: false }
    }

    // For dangerous chats, use uncensored provider to avoid content refusals
    if (chat.isDangerousChat === true) {
      const chatSettingsForDanger = await repos.chatSettings.findByUserId(userId)
      const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettingsForDanger)
      cheapLLM = resolveUncensoredCheapLLMSelection(
        cheapLLM,
        true,
        dangerSettings,
        availableProfiles
      )
    }

    // Get messages
    const messages = await repos.chats.getMessages(chatId)
    const conversationMessages: ChatMessage[] = messages
      .filter(msg => msg.type === 'message')
      .filter(msg => {
        const role = (msg as { role: string }).role
        return role === 'USER' || role === 'ASSISTANT'
      })
      .map(msg => ({
        role: (msg as { role: string }).role.toLowerCase() as 'user' | 'assistant',
        content: (msg as { content: string }).content,
      }))

    if (conversationMessages.length === 0) {
      return { success: false, error: 'No messages to summarize', wasGenerated: false }
    }

    let result: SummaryGenerationResult

    // If we have an existing summary, update it with recent messages
    if (chat.contextSummary && !forceRegenerate) {
      // Only summarize messages that came after the summary was likely generated
      // Take the last 20 messages for incremental update
      const recentMessages = conversationMessages.slice(-20)

      const updateResult = await updateContextSummary(
        chat.contextSummary,
        recentMessages,
        cheapLLM,
        userId,
        chatId
      )

      if (updateResult.success && updateResult.result) {
        result = {
          success: true,
          summary: updateResult.result,
          wasGenerated: true,
          usage: updateResult.usage,
        }
      } else {
        // Fall back to full regeneration
        const fullResult = await summarizeChat(conversationMessages, cheapLLM, userId, chatId)

        if (fullResult.success && fullResult.result) {
          result = {
            success: true,
            summary: fullResult.result,
            wasGenerated: true,
            usage: fullResult.usage,
          }
        } else {
          return {
            success: false,
            error: fullResult.error || 'Failed to generate summary',
            wasGenerated: false,
          }
        }
      }
    } else {
      // Generate new summary from scratch
      const summaryResult = await summarizeChat(conversationMessages, cheapLLM, userId, chatId)

      if (summaryResult.success && summaryResult.result) {
        result = {
          success: true,
          summary: summaryResult.result,
          wasGenerated: true,
          usage: summaryResult.usage,
        }
      } else {
        return {
          success: false,
          error: summaryResult.error || 'Failed to generate summary',
          wasGenerated: false,
        }
      }
    }

    // Save summary to chat
    if (result.success && result.summary) {
      // Refresh chat to get current message + token state before updating
      // tracking fields. The triple-gate uses these to decide whether to
      // skip on subsequent turns.
      const allChatMessages = await repos.chats.getMessages(chatId)
      const currentTurn = calculateInterchangeCount(allChatMessages)
      const conversationForCount = allChatMessages
        .filter(msg => msg.type === 'message')
        .filter(msg => {
          const role = (msg as { role: string }).role
          return role === 'USER' || role === 'ASSISTANT'
        })
        .map(msg => ({ role: (msg as { role: string }).role, content: (msg as { content: string }).content }))
      const currentTokens = countMessagesTokens(conversationForCount, connectionProfile.provider)

      const isFullRebuild = forceRegenerate || !chat.contextSummary

      await repos.chats.update(chatId, {
        contextSummary: result.summary,
        compactionGeneration: (chat.compactionGeneration ?? 0) + 1,
        lastSummaryTurn: currentTurn,
        lastSummaryTokens: currentTokens,
        ...(isFullRebuild ? { lastFullRebuildTurn: currentTurn } : {}),
        updatedAt: new Date().toISOString(),
      })

      // Also save as a context-summary event in the chat
      const summaryEvent = {
        type: 'context-summary' as const,
        id: crypto.randomUUID(),
        context: result.summary,
        createdAt: new Date().toISOString(),
      }
      await repos.chats.addMessage(chatId, summaryEvent)

      // Per-character Librarian summary whispers. Replaces the broadcast
      // summary message: each LLM-controlled character receives a private
      // summary tailored to what they were actually present for, since
      // characters may have joined mid-stream or stepped away and back.
      // Prior summary whispers to the same participant are swept first so
      // each character only ever has the latest summary in their context.
      try {
        const refreshedChat = await repos.chats.findById(chatId)
        if (refreshedChat) {
          const allMessages = await repos.chats.getMessages(chatId)
          await generatePerCharacterSummaryWhispers({
            chat: refreshedChat,
            allMessages,
            globalSummary: result.summary,
            cheapLLM,
            userId,
            chatId,
          })
        }
      } catch (e) {
        logger.error('[Context Summary] Failed to fan out per-character summary whispers:', { chatId }, e instanceof Error ? e : new Error(String(e)))
      }

      // Create system event for context summary token tracking
      if (result.usage && (result.usage.promptTokens > 0 || result.usage.completionTokens > 0)) {
        try {
          const costResult = await estimateMessageCost(
            cheapLLM.provider,
            cheapLLM.modelName,
            result.usage.promptTokens,
            result.usage.completionTokens,
            userId
          )
          await createContextSummaryEvent(
            chatId,
            result.usage,
            cheapLLM.provider,
            cheapLLM.modelName,
            costResult.cost
          )
        } catch (e) {
          logger.error('[Context Summary] Failed to create system event:', {}, e instanceof Error ? e : new Error(String(e)))
        }
      }

      // Generate a title from the summary using the cheap LLM
      // Help chats get practical, descriptive titles; regular chats get literary ones
      try {
        const titleResult = chat.chatType === 'help'
          ? await generateHelpChatTitleFromSummary(result.summary, cheapLLM, userId, chatId)
          : await generateTitleFromSummary(result.summary, cheapLLM, userId, chatId)
        if (titleResult.success && titleResult.result) {
          await repos.chats.update(chatId, {
            title: titleResult.result,
            updatedAt: new Date().toISOString(),
          })
          logger.info(`[Context Summary] Generated title for chat ${chatId}: ${titleResult.result}`)

          // Create system event for title generation token tracking
          if (titleResult.usage && (titleResult.usage.promptTokens > 0 || titleResult.usage.completionTokens > 0)) {
            try {
              const titleCostResult = await estimateMessageCost(
                cheapLLM.provider,
                cheapLLM.modelName,
                titleResult.usage.promptTokens,
                titleResult.usage.completionTokens,
                userId
              )
              await createTitleGenerationEvent(
                chatId,
                titleResult.usage,
                cheapLLM.provider,
                cheapLLM.modelName,
                titleCostResult.cost
              )
            } catch (e) {
              logger.error('[Context Summary] Failed to create title generation system event:', {}, e instanceof Error ? e : new Error(String(e)))
            }
          }
        } else {
          logger.warn(`[Context Summary] Failed to generate title for chat ${chatId}: ${titleResult.error}`)
        }
      } catch (titleError) {
        logger.error(`[Context Summary] Error generating title for chat ${chatId}:`, {}, titleError instanceof Error ? titleError : new Error(String(titleError)))
      }
    }

    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      wasGenerated: false,
    }
  }
}

/**
 * Build the per-character message slice for a participant: the messages they
 * actually saw, in chronological order.
 *
 * Pipeline:
 *   1. type === 'message' (drop context-summary / system events)
 *   2. history-access slice (skip messages before they joined unless
 *      `hasHistoryAccess` is set)
 *   3. presence-window slice (skip messages during periods they were 'absent'
 *      / 'removed', based on Host status announcements). Skipped entirely
 *      when `hasHistoryAccess` is set.
 *   4. whisper filter (only public messages and whispers they're a sender or
 *      target of)
 */
function buildVisibleMessagesForParticipant(
  allMessages: ChatEvent[],
  participant: ChatParticipantBase,
): MessageEvent[] {
  const messageEvents = allMessages.filter((m): m is MessageEvent => m.type === 'message')

  const adapted: MessageWithParticipant[] = messageEvents.map(m => ({
    role: m.role,
    content: m.content,
    id: m.id,
    participantId: m.participantId ?? null,
    createdAt: m.createdAt,
    targetParticipantIds: m.targetParticipantIds ?? null,
    hostEvent: m.hostEvent ?? null,
  }))

  let visible: MessageWithParticipant[] = adapted

  if (!participant.hasHistoryAccess) {
    visible = filterMessagesByHistoryAccess(visible, participant)
    const windows = computePresenceWindowsForParticipant(adapted, participant)
    visible = filterMessagesByPresenceWindows(visible, windows)
  }

  visible = filterWhisperMessages(visible, participant.id)

  // Map back to MessageEvent records — we kept message IDs, so reattach.
  const idsKept = new Set(visible.map(m => m.id).filter((id): id is string => Boolean(id)))
  return messageEvents.filter(m => idsKept.has(m.id))
}

/**
 * Reduce a participant's visible messages to the role-and-content shape the
 * cheap-LLM summariser expects.
 */
function visibleConversation(visible: MessageEvent[]): ChatMessage[] {
  return visible
    .filter(m => m.role === 'USER' || m.role === 'ASSISTANT')
    .map(m => ({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content }))
}

interface GeneratePerCharacterSummariesParams {
  chat: ChatMetadata
  allMessages: ChatEvent[]
  globalSummary: string
  cheapLLM: CheapLLMSelection
  userId: string
  chatId: string
}

/**
 * For each LLM-controlled CHARACTER participant who is still in the chat,
 * produce a Librarian summary whisper tailored to what they actually saw —
 * sweeping any prior summary whisper they had received first.
 *
 * When a participant's visible slice contains exactly the same messages that
 * went into the global summary (the common single-character / always-present
 * case), the global summary text is reused verbatim — no extra cheap-LLM
 * call. When the slice differs, a fresh per-character summary is generated.
 */
export async function generatePerCharacterSummaryWhispers(
  params: GeneratePerCharacterSummariesParams,
): Promise<void> {
  const { chat, allMessages, globalSummary, cheapLLM, userId, chatId } = params
  const repos = getRepositories()

  // Reference slice for "did the per-character filter remove anything?"
  const globalSliceIds = allMessages
    .filter((m): m is MessageEvent => m.type === 'message')
    .filter(m => m.role === 'USER' || m.role === 'ASSISTANT')
    .map(m => m.id)
  const globalIdSet = new Set(globalSliceIds)

  for (const participant of chat.participants) {
    if (participant.type !== 'CHARACTER') continue
    if (participant.controlledBy === 'user') continue
    if (participant.status === 'removed') continue

    try {
      const visible = buildVisibleMessagesForParticipant(allMessages, participant)
      const conv = visibleConversation(visible)

      if (conv.length === 0) {
        logger.debug('[Context Summary] No visible messages for participant — skipping summary whisper', {
          chatId, participantId: participant.id,
        })
        continue
      }

      const visibleConvIds = visible
        .filter(m => m.role === 'USER' || m.role === 'ASSISTANT')
        .map(m => m.id)
      const sameAsGlobal =
        visibleConvIds.length === globalIdSet.size &&
        visibleConvIds.every(id => globalIdSet.has(id))

      let summaryText = globalSummary
      if (!sameAsGlobal) {
        logger.info('[Context Summary] Per-character whisper: regenerating (slice differs from global)', {
          chatId, participantId: participant.id,
          visibleCount: conv.length, globalCount: globalSliceIds.length,
          whisperOutcome: 'regenerated',
        })
        const result = await summarizeChat(conv, cheapLLM, userId, chatId)
        if (!result.success || !result.result) {
          logger.warn('[Context Summary] Per-character summarize failed; skipping whisper', {
            chatId, participantId: participant.id, error: result.error,
          })
          continue
        }
        summaryText = result.result

        // Track cost for the extra cheap-LLM call.
        if (result.usage && (result.usage.promptTokens > 0 || result.usage.completionTokens > 0)) {
          try {
            const costResult = await estimateMessageCost(
              cheapLLM.provider,
              cheapLLM.modelName,
              result.usage.promptTokens,
              result.usage.completionTokens,
              userId,
            )
            await createContextSummaryEvent(
              chatId,
              result.usage,
              cheapLLM.provider,
              cheapLLM.modelName,
              costResult.cost,
            )
          } catch (e) {
            logger.error('[Context Summary] Failed to record per-character summary system event:', { chatId, participantId: participant.id }, e instanceof Error ? e : new Error(String(e)))
          }
        }
      } else {
        logger.info('[Context Summary] Per-character whisper: reused global summary', {
          chatId, participantId: participant.id,
          whisperOutcome: 'reused',
        })
      }

      // Sweep prior Librarian summary whispers targeted exclusively at this
      // participant. Identified by systemSender + content prefix + a single
      // matching target. Old broadcast summaries (from before this refactor)
      // are not swept — they were addressed to the whole room.
      const priorSummaryIds = allMessages
        .filter((m): m is MessageEvent => m.type === 'message')
        .filter(m =>
          m.systemSender === 'librarian' &&
          Array.isArray(m.targetParticipantIds) &&
          m.targetParticipantIds.length === 1 &&
          m.targetParticipantIds[0] === participant.id &&
          typeof m.content === 'string' &&
          m.content.startsWith(SUMMARY_CONTENT_PREFIX),
        )
        .map(m => m.id)

      if (priorSummaryIds.length > 0) {
        const removed = await repos.chats.deleteMessagesByIds(chatId, priorSummaryIds)
        logger.info('[Context Summary] Swept prior summary whispers for participant', {
          chatId, participantId: participant.id, removed,
        })
      }

      await postLibrarianSummaryAnnouncement({
        chatId,
        summary: summaryText,
        targetParticipantIds: [participant.id],
      })
    } catch (e) {
      logger.error('[Context Summary] Per-character summary whisper failed for participant', {
        chatId, participantId: participant.id,
      }, e instanceof Error ? e : new Error(String(e)))
    }
  }
}

/**
 * Generate a catch-up Librarian summary whisper for a participant that just
 * joined the chat with `hasHistoryAccess === true`. Since they can see all
 * prior history, they need a summary right away rather than waiting for the
 * next checkpoint to fire. No-op if there's not enough prior content to
 * warrant summarising.
 */
export async function generateCatchUpSummaryForParticipant(
  options: GenerateSummaryOptions & { participantId: string },
): Promise<void> {
  const { userId, chatId, connectionProfile, cheapLLMSettings, availableProfiles, participantId } = options
  const repos = getRepositories()

  try {
    const chat = await repos.chats.findById(chatId)
    if (!chat) return

    const participant = chat.participants.find(p => p.id === participantId)
    if (!participant || !participant.hasHistoryAccess) {
      logger.debug('[Context Summary] Catch-up skipped — participant not found or has no history access', {
        chatId, participantId,
      })
      return
    }
    if (participant.type !== 'CHARACTER' || participant.controlledBy === 'user') return

    let cheapLLM = getCheapLLMProvider(
      connectionProfile,
      {
        strategy: cheapLLMSettings.strategy,
        userDefinedProfileId: cheapLLMSettings.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: cheapLLMSettings.defaultCheapProfileId ?? undefined,
        fallbackToLocal: cheapLLMSettings.fallbackToLocal,
      },
      availableProfiles,
    )
    if (!cheapLLM) {
      logger.warn('[Context Summary] Catch-up skipped — no cheap LLM available', { chatId, participantId })
      return
    }

    if (chat.isDangerousChat === true) {
      const chatSettingsForDanger = await repos.chatSettings.findByUserId(userId)
      const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettingsForDanger)
      cheapLLM = resolveUncensoredCheapLLMSelection(cheapLLM, true, dangerSettings, availableProfiles)
    }

    const allMessages = await repos.chats.getMessages(chatId)
    const visible = buildVisibleMessagesForParticipant(allMessages, participant)
    const conv = visibleConversation(visible)

    // Need a meaningful amount of history to bother summarising — match the
    // existing minimum interchange threshold for global summaries.
    if (conv.length < 4) {
      logger.debug('[Context Summary] Catch-up skipped — too little history to summarise', {
        chatId, participantId, visibleCount: conv.length,
      })
      return
    }

    logger.info('[Context Summary] Generating catch-up summary for newly-joined participant', {
      chatId, participantId, visibleCount: conv.length,
    })

    const result = await summarizeChat(conv, cheapLLM, userId, chatId)
    if (!result.success || !result.result) {
      logger.warn('[Context Summary] Catch-up summarize failed', {
        chatId, participantId, error: result.error,
      })
      return
    }

    if (result.usage && (result.usage.promptTokens > 0 || result.usage.completionTokens > 0)) {
      try {
        const costResult = await estimateMessageCost(
          cheapLLM.provider,
          cheapLLM.modelName,
          result.usage.promptTokens,
          result.usage.completionTokens,
          userId,
        )
        await createContextSummaryEvent(
          chatId,
          result.usage,
          cheapLLM.provider,
          cheapLLM.modelName,
          costResult.cost,
        )
      } catch (e) {
        logger.error('[Context Summary] Failed to record catch-up summary system event:', { chatId, participantId }, e instanceof Error ? e : new Error(String(e)))
      }
    }

    await postLibrarianSummaryAnnouncement({
      chatId,
      summary: result.result,
      targetParticipantIds: [participantId],
    })
  } catch (e) {
    logger.error('[Context Summary] Catch-up summary failed', { chatId, participantId },
      e instanceof Error ? e : new Error(String(e)))
  }
}

/**
 * Resolve cheap-LLM settings + available profiles + a connection profile and
 * fire `generateCatchUpSummaryForParticipant` in the background. Non-blocking;
 * any failure (no cheap LLM, no profile, etc.) is logged and swallowed.
 *
 * Called from the participant-add path when `hasHistoryAccess === true`, so
 * the newly-joined character starts with a Librarian summary of what they're
 * walking into rather than waiting for the next checkpoint to fire.
 */
export function triggerCatchUpSummaryAsync(params: {
  chatId: string
  userId: string
  participantId: string
}): void {
  const { chatId, userId, participantId } = params

  ;(async () => {
    try {
      const repos = getRepositories()

      const chat = await repos.chats.findById(chatId)
      if (!chat) return

      const participant = chat.participants.find(p => p.id === participantId)
      if (!participant?.hasHistoryAccess) return
      if (participant.type !== 'CHARACTER' || participant.controlledBy === 'user') return

      const chatSettings = await repos.chatSettings.findByUserId(userId)
      if (!chatSettings?.cheapLLMSettings) {
        logger.debug('[Context Summary] Catch-up skipped — no cheap LLM settings', { chatId, participantId })
        return
      }

      // Pick a connection profile to feed `getCheapLLMProvider`. Prefer the
      // joining participant's own profile; fall back to any other LLM
      // participant's profile so the cheap-LLM resolver has something to
      // anchor against.
      let connectionProfileId = participant.connectionProfileId ?? null
      if (!connectionProfileId) {
        const otherLLM = chat.participants.find(
          p => p.type === 'CHARACTER' && p.controlledBy !== 'user' && p.connectionProfileId,
        )
        connectionProfileId = otherLLM?.connectionProfileId ?? null
      }
      if (!connectionProfileId) {
        logger.debug('[Context Summary] Catch-up skipped — no connection profile available', {
          chatId, participantId,
        })
        return
      }
      const connectionProfile = await repos.connections.findById(connectionProfileId)
      if (!connectionProfile) {
        logger.debug('[Context Summary] Catch-up skipped — connection profile not found', {
          chatId, participantId, connectionProfileId,
        })
        return
      }

      const availableProfiles = await repos.connections.findByUserId(userId)

      await generateCatchUpSummaryForParticipant({
        userId,
        chatId,
        connectionProfile,
        cheapLLMSettings: chatSettings.cheapLLMSettings,
        availableProfiles,
        participantId,
      })
    } catch (e) {
      logger.error('[Context Summary] triggerCatchUpSummaryAsync failed',
        { chatId, participantId },
        e instanceof Error ? e : new Error(String(e)),
      )
    }
  })()
}

/**
 * Clear the context summary for a chat
 */
export async function clearContextSummary(chatId: string): Promise<boolean> {
  const repos = getRepositories()

  try {
    await repos.chats.update(chatId, {
      contextSummary: null,
      updatedAt: new Date().toISOString(),
    })
    return true
  } catch (error) {
    logger.error('Failed to clear context summary:', {}, error instanceof Error ? error : new Error(String(error)))
    return false
  }
}

/**
 * Generate summary in the background (non-blocking)
 * Used after message exchanges to keep summaries up to date
 */
export function generateContextSummaryAsync(options: GenerateSummaryOptions): void {
  // Run in background without waiting
  generateContextSummary(options)
    .then(result => {
      if (result.success && result.wasGenerated) {
        logger.info(`[Context Summary] Generated summary for chat ${options.chatId}`)
      } else if (!result.success) {
        logger.warn(`[Context Summary] Failed for chat ${options.chatId}: ${result.error}`)
      }
    })
    .catch(error => {
      logger.error(`[Context Summary] Error for chat ${options.chatId}:`, {}, error instanceof Error ? error : new Error(String(error)))
    })
}

/**
 * Considers updating the chat title based on recent messages
 * Runs asynchronously in the background
 */
async function considerTitleUpdateAsync(
  chatId: string,
  userId: string,
  connectionProfile: ConnectionProfile,
  cheapLLMSettings: CheapLLMSettings,
  availableProfiles: ConnectionProfile[],
  currentInterchange: number
): Promise<void> {
  try {
    const repos = getRepositories()
    const chat = await repos.chats.findById(chatId)

    if (!chat) {
      logger.warn(`[Title Update] Chat ${chatId} not found`)
      return
    }

    // Skip title update if user has manually renamed the chat
    if (chat.isManuallyRenamed) {

      return
    }

    // Get cheap LLM provider
    const cheapLLM = getCheapLLMProvider(
      connectionProfile,
      {
        strategy: cheapLLMSettings.strategy,
        userDefinedProfileId: cheapLLMSettings.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: cheapLLMSettings.defaultCheapProfileId ?? undefined,
        fallbackToLocal: cheapLLMSettings.fallbackToLocal,
      },
      availableProfiles
    )
    if (!cheapLLM) {
      logger.warn(`[Title Update] No cheap LLM available for chat ${chatId}`)
      return
    }

    // Get messages for context
    const allMessages = await repos.chats.getMessages(chatId)
    const conversationMessages: ChatMessage[] = allMessages
      .filter(msg => msg.type === 'message')
      .filter(msg => {
        const role = (msg as { role: string }).role
        return role === 'USER' || role === 'ASSISTANT'
      })
      .map(msg => ({
        role: (msg as { role: string }).role.toLowerCase() as 'user' | 'assistant',
        content: (msg as { content: string }).content,
      }))
    
    if (conversationMessages.length === 0) {
      return
    }
    
    // Get recent messages since last check
    // We'll take the last 10 messages as "recent" context
    const recentMessages = conversationMessages.slice(-10)
    
    // Use existing summary if available, otherwise use current title
    const context = chat.contextSummary || chat.title
    
    // Ask the cheap LLM if title needs updating — use help-specific prompt for help chats
    const isHelpChat = chat.chatType === 'help'
    const considerationResult = isHelpChat
      ? await considerHelpChatTitleUpdate(chat.title, recentMessages, context, cheapLLM, userId, chatId)
      : await considerTitleUpdate(chat.title, recentMessages, context, cheapLLM, userId, chatId)
    
    if (considerationResult.success && considerationResult.result) {
      const { needsNewTitle, reason, suggestedTitle } = considerationResult.result

      logger.info(`[Title Update] Chat ${chatId} - needsNewTitle: ${needsNewTitle}, reason: ${reason}`)

      // Create system event for title consideration token tracking
      if (considerationResult.usage && (considerationResult.usage.promptTokens > 0 || considerationResult.usage.completionTokens > 0)) {
        try {
          const costResult = await estimateMessageCost(
            cheapLLM.provider,
            cheapLLM.modelName,
            considerationResult.usage.promptTokens,
            considerationResult.usage.completionTokens,
            userId
          )
          await createTitleGenerationEvent(
            chatId,
            considerationResult.usage,
            cheapLLM.provider,
            cheapLLM.modelName,
            costResult.cost
          )
        } catch (e) {
          logger.error('[Title Update] Failed to create system event:', {}, e instanceof Error ? e : new Error(String(e)))
        }
      }

      if (needsNewTitle && suggestedTitle) {
        // Update the chat title
        await repos.chats.update(chatId, {
          title: suggestedTitle,
          lastRenameCheckInterchange: currentInterchange,
          updatedAt: new Date().toISOString(),
        })
        logger.info(`[Title Update] Updated title for chat ${chatId} to: "${suggestedTitle}"`)

        // Queue story background generation if enabled (skip for help chats — no Lantern support)
        if (!isHelpChat) {
          const chatSettings = await repos.chatSettings.findByUserId(userId)
          if (chatSettings) {
            // Re-fetch chat to get updated title
            const updatedChat = await repos.chats.findById(chatId)
            if (updatedChat) {
              queueStoryBackgroundIfEnabled(userId, updatedChat, chatSettings, suggestedTitle).catch(error => {
                logger.error(`[Title Update] Failed to queue story background for chat ${chatId}:`, {}, error instanceof Error ? error : new Error(String(error)))
              })
            }
          }
        }
      } else {
        // Still update the last check interchange even if no title change
        await repos.chats.update(chatId, {
          lastRenameCheckInterchange: currentInterchange,
          updatedAt: new Date().toISOString(),
        })
      }
    } else {
      logger.warn(`[Title Update] Failed for chat ${chatId}: ${considerationResult.error}`)
    }
  } catch (error) {
    logger.error(`[Title Update] Error for chat ${chatId}:`, {}, error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Check and generate summary if needed after a message
 * Also checks if title should be updated based on interchange count
 * Call this after message exchanges to maintain context
 */
export async function checkAndGenerateSummaryIfNeeded(
  chatId: string,
  provider: Provider,
  modelName: string,
  userId: string,
  connectionProfile: ConnectionProfile,
  cheapLLMSettings: CheapLLMSettings,
  availableProfiles: ConnectionProfile[]
): Promise<void> {
  const repos = getRepositories()
  const chat = await repos.chats.findById(chatId)

  if (!chat) {

    return
  }

  // Get all messages to calculate interchange count
  const allMessages = await repos.chats.getMessages(chatId)
  const currentInterchange = calculateInterchangeCount(allMessages)

  // Check if we should consider updating the title
  const lastCheckedInterchange = chat.lastRenameCheckInterchange || 0

  const isAtTitleCheckpoint = shouldCheckTitleAtInterchange(currentInterchange, lastCheckedInterchange, chat.chatType)

  if (isAtTitleCheckpoint) {
    logger.info(`[Title Update] Checking title at interchange ${currentInterchange} for ${chat.chatType === 'help' ? 'help ' : ''}chat ${chatId}`)

    // Run title consideration in background (non-blocking)
    considerTitleUpdateAsync(
      chatId,
      userId,
      connectionProfile,
      cheapLLMSettings,
      availableProfiles,
      currentInterchange
    ).catch(error => {
      logger.error(`[Title Update] Background error for chat ${chatId}:`, {}, error instanceof Error ? error : new Error(String(error)))
    })
  }

  // Triple-gate summarization: replace the per-checkpoint trigger. The title
  // path keeps its own checkpoint clock; this gate is for the summary alone.
  const conversationForCount = allMessages
    .filter(msg => msg.type === 'message')
    .filter(msg => {
      const role = (msg as { role: string }).role
      return role === 'USER' || role === 'ASSISTANT'
    })
    .map(msg => ({ role: (msg as { role: string }).role, content: (msg as { content: string }).content }))
  const currentTokens = countMessagesTokens(conversationForCount, provider)

  const decision = evaluateSummarizationGate({
    currentTurn: currentInterchange,
    currentTokens,
    lastSummaryTurn: chat.lastSummaryTurn ?? 0,
    lastSummaryTokens: chat.lastSummaryTokens ?? 0,
    lastFullRebuildTurn: chat.lastFullRebuildTurn ?? 0,
    hasExistingSummary: !!chat.contextSummary,
  })

  if (decision !== 'skip') {
    logger.info('[Context Summary] Gate fired', {
      chatId,
      decision,
      currentInterchange,
      currentTokens,
      lastSummaryTurn: chat.lastSummaryTurn ?? 0,
      lastSummaryTokens: chat.lastSummaryTokens ?? 0,
      lastFullRebuildTurn: chat.lastFullRebuildTurn ?? 0,
    })
    generateContextSummaryAsync({
      userId,
      chatId,
      connectionProfile,
      cheapLLMSettings,
      availableProfiles,
      forceRegenerate: decision === 'hard',
    })
  } else {
    logger.debug('[Context Summary] Gate skipped', {
      chatId,
      currentInterchange,
      currentTokens,
      lastSummaryTurn: chat.lastSummaryTurn ?? 0,
      lastSummaryTokens: chat.lastSummaryTokens ?? 0,
    })
  }
}

