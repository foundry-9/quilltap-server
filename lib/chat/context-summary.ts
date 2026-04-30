/**
 * Context Summary Service
 * Sprint 5: Context Management
 *
 * Generates and updates conversation summaries for long chats.
 * Uses the cheap LLM system for efficient summarization.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { foldChatSummary, ChatMessage, generateTitleFromSummary, considerTitleUpdate, considerHelpChatTitleUpdate, generateHelpChatTitleFromSummary } from '@/lib/memory/cheap-llm-tasks'
import { countMessagesTokens } from '@/lib/tokens/token-counter'
import { getModelContextLimit, shouldSummarizeConversation } from '@/lib/llm/model-context-data'
import { Provider, ConnectionProfile, CheapLLMSettings, ChatEvent, MessageEvent } from '@/lib/schemas/types'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { logger } from '@/lib/logger'
import { createContextSummaryEvent, createTitleGenerationEvent } from '@/lib/services/system-events.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { queueStoryBackgroundIfEnabled } from '@/lib/background-jobs/handlers/title-update'
import { postLibrarianSummaryAnnouncement, SUMMARY_CONTENT_PREFIX } from '@/lib/services/librarian-notifications/writer'

/**
 * Rolling-window summarization cadence.
 *
 * The chat-message LLM call sees `[running summary] + [last 5–10 turns]`. The
 * running summary lives as a Librarian whisper at the head of the kept
 * messages. Older USER + character messages get dropped from the LLM context
 * once a fold has covered them. Knobs:
 *
 *   - FOLD_TURN_BATCH: number of turns folded per fire (5).
 *   - FOLD_TAIL_FLOOR: minimum recent turns kept verbatim (5).
 *   - FOLD_TRIGGER_DELTA: turns of accumulated tail before a fold fires
 *     (FOLD_TAIL_FLOOR + FOLD_TURN_BATCH = 10). When `currentTurn -
 *     lastFoldedTurn > FOLD_TRIGGER_DELTA`, fold the next 5 turns.
 *   - T_HARD_TURN_THRESHOLD: periodic full from-scratch rebuild (50). Cheap
 *     insurance against accumulated paraphrase drift across many folds.
 *
 * `chat.lastSummaryTurn` is reused as the fold anchor (semantically:
 * "lastFoldedTurn" — the turn number through which the running summary has
 * already absorbed content). `chat.compactionGeneration` bumps on every fold
 * so the Librarian-whisper sweep and Phase 3 frozen-memory archive cache
 * invalidate together. `chat.lastFullRebuildTurn` anchors the T_hard window.
 */
export const FOLD_TURN_BATCH = 5
export const FOLD_TAIL_FLOOR = 5
export const FOLD_TRIGGER_DELTA = FOLD_TAIL_FLOOR + FOLD_TURN_BATCH
export const T_HARD_TURN_THRESHOLD = 50

export type SummarizationGateDecision = 'skip' | 'fold' | 'hard'

export interface SummarizationGateInputs {
  /** Current interchange count (output of calculateInterchangeCount). */
  currentTurn: number
  /** Turn through which the running summary has already absorbed content. */
  lastFoldedTurn: number
  /** Turn at which the last from-scratch rebuild fired. */
  lastFullRebuildTurn: number
}

/**
 * Decide whether to skip, fold the next batch, or do a full rebuild.
 * Pure function — no side effects.
 */
export function evaluateSummarizationGate(
  inputs: SummarizationGateInputs,
): SummarizationGateDecision {
  const { currentTurn, lastFoldedTurn, lastFullRebuildTurn } = inputs

  // Below the floor + batch threshold, no fold needs to happen — the LLM still
  // sees the full conversation as recent tail.
  if (currentTurn <= FOLD_TRIGGER_DELTA) return 'skip'

  // T_hard wins over the regular fold path. A from-scratch rebuild implicitly
  // satisfies any fold that was due.
  if (currentTurn - lastFullRebuildTurn >= T_HARD_TURN_THRESHOLD) {
    return 'hard'
  }

  if (currentTurn - lastFoldedTurn > FOLD_TRIGGER_DELTA) {
    return 'fold'
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

interface FoldedTurn {
  /** 1-indexed turn number. */
  turnNumber: number
  /** USER + non-staff ASSISTANT messages composing this turn, chronological. */
  messages: MessageEvent[]
  /** IDs of those messages, for summaryAnchorMessageIds. */
  ids: string[]
}

/**
 * Walk chat history in chronological order, grouping messages into turns.
 * A turn begins on a USER message; trailing non-staff ASSISTANT messages
 * before the next USER message belong to that turn. Staff-authored messages
 * (`systemSender` set) are excluded from summary input but do not affect
 * turn numbering. ASSISTANT-only greeting messages before any USER message
 * are folded into turn 1.
 */
export function partitionMessagesIntoTurns(allMessages: ChatEvent[]): FoldedTurn[] {
  const turns: FoldedTurn[] = []
  let currentTurn: FoldedTurn | null = null
  let leadingAssistant: { messages: MessageEvent[]; ids: string[] } | null = null

  for (const msg of allMessages) {
    if (msg.type !== 'message') continue
    const m = msg as MessageEvent
    if (m.role !== 'USER' && m.role !== 'ASSISTANT') continue
    if (m.systemSender) continue

    if (m.role === 'USER') {
      const turnNumber = turns.length + 1
      const startMessages = leadingAssistant ? [...leadingAssistant.messages, m] : [m]
      const startIds = leadingAssistant ? [...leadingAssistant.ids, m.id] : [m.id]
      currentTurn = { turnNumber, messages: startMessages, ids: startIds }
      turns.push(currentTurn)
      leadingAssistant = null
    } else if (currentTurn) {
      currentTurn.messages.push(m)
      currentTurn.ids.push(m.id)
    } else {
      leadingAssistant = leadingAssistant ?? { messages: [], ids: [] }
      leadingAssistant.messages.push(m)
      leadingAssistant.ids.push(m.id)
    }
  }

  return turns
}

function turnsToChatMessages(turns: FoldedTurn[]): ChatMessage[] {
  const result: ChatMessage[] = []
  for (const t of turns) {
    for (const m of t.messages) {
      result.push({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content })
    }
  }
  return result
}

/**
 * Generate or update a context summary for a chat using the rolling-window
 * fold cadence. Caller is expected to have run the gate (or to set
 * `forceRegenerate` for an unconditional T_hard rebuild).
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
    const chat = await repos.chats.findById(chatId)
    if (!chat) {
      return { success: false, error: 'Chat not found', wasGenerated: false }
    }

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

    const allChatMessages = await repos.chats.getMessages(chatId)
    const allTurns = partitionMessagesIntoTurns(allChatMessages)
    const currentTurn = allTurns.length

    if (currentTurn === 0) {
      return { success: false, error: 'No messages to summarize', wasGenerated: false }
    }

    const lastFoldedTurn = chat.lastSummaryTurn ?? 0

    // Decide what range of turns to fold. T_hard absorbs everything up to the
    // tail floor in a single from-scratch call; the regular fold path takes
    // the next FOLD_TURN_BATCH turns and updates the prior summary.
    const isHardRebuild = forceRegenerate
    let foldFromTurn: number
    let foldThroughTurn: number
    if (isHardRebuild) {
      foldFromTurn = 1
      foldThroughTurn = Math.max(1, currentTurn - FOLD_TAIL_FLOOR)
    } else {
      foldFromTurn = lastFoldedTurn + 1
      foldThroughTurn = Math.min(lastFoldedTurn + FOLD_TURN_BATCH, currentTurn - FOLD_TAIL_FLOOR)
    }

    if (foldThroughTurn < foldFromTurn) {
      return { success: false, error: 'Not enough turns to fold', wasGenerated: false }
    }

    const turnsToFold = allTurns.slice(foldFromTurn - 1, foldThroughTurn)
    const newTurnsContent = turnsToChatMessages(turnsToFold)

    if (newTurnsContent.length === 0) {
      return { success: false, error: 'No content in turns to fold', wasGenerated: false }
    }

    const priorSummary = isHardRebuild ? null : (chat.contextSummary ?? null)

    const foldResult = await foldChatSummary(
      { priorSummary, newTurns: newTurnsContent },
      cheapLLM,
      userId,
      chatId,
    )

    if (!foldResult.success || !foldResult.result) {
      return {
        success: false,
        error: foldResult.error || 'Failed to fold summary',
        wasGenerated: false,
      }
    }

    const newSummary: string = foldResult.result
    const result: SummaryGenerationResult = {
      success: true,
      summary: newSummary,
      wasGenerated: true,
      usage: foldResult.usage,
    }

    const newGeneration = (chat.compactionGeneration ?? 0) + 1
    const newLastFoldedTurn = foldThroughTurn

    // Anchor every conversation message in turns 1 through newLastFoldedTurn
    // so the edit-aware invalidation hook clears the summary when a covered
    // message is touched. Recompute (don't append) so the set is always
    // consistent with the current fold boundary.
    const summaryAnchorMessageIds = allTurns
      .slice(0, newLastFoldedTurn)
      .flatMap(t => t.ids)

    await repos.chats.update(chatId, {
      contextSummary: newSummary,
      compactionGeneration: newGeneration,
      lastSummaryTurn: newLastFoldedTurn,
      summaryAnchorMessageIds,
      ...(isHardRebuild ? { lastFullRebuildTurn: currentTurn } : {}),
      updatedAt: new Date().toISOString(),
    })

    const summaryEvent = {
      type: 'context-summary' as const,
      id: crypto.randomUUID(),
      context: newSummary,
      createdAt: new Date().toISOString(),
    }
    await repos.chats.addMessage(chatId, summaryEvent)

    // Sweep prior Librarian summary whispers from older generations, then
    // post the fresh one. Whispers from the new generation are left
    // untouched. Legacy unanchored whispers are identified by content prefix.
    try {
      const refreshedMessages = await repos.chats.getMessages(chatId)
      const priorSummaryIds = refreshedMessages
        .filter((m): m is MessageEvent => m.type === 'message')
        .filter(m => {
          if (m.systemSender !== 'librarian') return false
          if (m.summaryAnchor) {
            return m.summaryAnchor.compactionGeneration < newGeneration
          }
          return typeof m.content === 'string' && m.content.startsWith(SUMMARY_CONTENT_PREFIX)
        })
        .map(m => m.id)

      if (priorSummaryIds.length > 0) {
        const removed = await repos.chats.deleteMessagesByIds(chatId, priorSummaryIds)
        logger.info('[Context Summary] Swept prior broadcast summary whispers', {
          chatId, removed, newGeneration,
        })
      }

      await postLibrarianSummaryAnnouncement({
        chatId,
        summary: newSummary,
        targetParticipantIds: null,
        summaryAnchor: { compactionGeneration: newGeneration },
      })
    } catch (e) {
      logger.error('[Context Summary] Failed to post broadcast summary whisper:', { chatId }, e instanceof Error ? e : new Error(String(e)))
    }

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

    try {
      const titleResult = chat.chatType === 'help'
        ? await generateHelpChatTitleFromSummary(newSummary, cheapLLM, userId, chatId)
        : await generateTitleFromSummary(newSummary, cheapLLM, userId, chatId)
      if (titleResult.success && titleResult.result) {
        await repos.chats.update(chatId, {
          title: titleResult.result,
          updatedAt: new Date().toISOString(),
        })
        logger.info(`[Context Summary] Generated title for chat ${chatId}: ${titleResult.result}`)

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
 * Edit/delete invalidation hook. When a conversation message is edited or
 * deleted, clear the running summary if the changed message ID was part of
 * the set that fed it. Resets `lastSummaryTurn` (the fold anchor) and
 * `lastFullRebuildTurn` so the next fold rebuilds from scratch. Bumps
 * `compactionGeneration` so downstream caches and Librarian-whisper sweeps
 * refresh in step.
 *
 * Called with one or more message IDs (a single edit, or the swipe-group
 * IDs the delete path collects). Returns true when the summary was
 * invalidated; false when none of the IDs were covered.
 */
export async function invalidateContextSummaryIfMessageCovered(
  chatId: string,
  messageIds: string[],
): Promise<boolean> {
  if (messageIds.length === 0) return false
  const repos = getRepositories()

  try {
    const chat = await repos.chats.findById(chatId)
    if (!chat || !chat.contextSummary) return false

    const covered = chat.summaryAnchorMessageIds ?? []
    if (covered.length === 0) return false

    const coveredSet = new Set(covered)
    const intersects = messageIds.some(id => coveredSet.has(id))
    if (!intersects) return false

    await repos.chats.update(chatId, {
      contextSummary: null,
      summaryAnchorMessageIds: [],
      compactionGeneration: (chat.compactionGeneration ?? 0) + 1,
      lastSummaryTurn: 0,
      lastFullRebuildTurn: 0,
      updatedAt: new Date().toISOString(),
    })

    logger.info('[Context Summary] Invalidated on covered message change', {
      chatId,
      changedMessageCount: messageIds.length,
      coveredCount: covered.length,
      newGeneration: (chat.compactionGeneration ?? 0) + 1,
    })
    return true
  } catch (error) {
    logger.error('[Context Summary] Invalidation hook failed', { chatId },
      error instanceof Error ? error : new Error(String(error)))
    return false
  }
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

  const decision = evaluateSummarizationGate({
    currentTurn: currentInterchange,
    lastFoldedTurn: chat.lastSummaryTurn ?? 0,
    lastFullRebuildTurn: chat.lastFullRebuildTurn ?? 0,
  })

  if (decision !== 'skip') {
    logger.info('[Context Summary] Gate fired', {
      chatId,
      decision,
      currentInterchange,
      lastFoldedTurn: chat.lastSummaryTurn ?? 0,
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
      lastFoldedTurn: chat.lastSummaryTurn ?? 0,
    })
  }
}

