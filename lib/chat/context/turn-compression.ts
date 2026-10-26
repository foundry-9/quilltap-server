/**
 * Turn phase: budget-driven compression.
 *
 * Two passes, both gated by one decision — the whole estimated prompt is over
 * the connection profile's `maxAvailable`:
 *
 * 1. **History** (`compressTurnHistory`). Everything before the last
 *    `windowSize` visible messages folds into a rolling summary that rides as
 *    system block 3; only the window stays verbatim. A summary the async
 *    pre-compression already made is used when there is one, since the
 *    operator would otherwise sit through the cheap-LLM call.
 * 2. **Memories** (`compressTurnMemories`). Recalled memories over their share
 *    of the budget are compressed in place. Knowledge is never fed to it — it
 *    is first-class canon, not to be lossily summarised.
 *
 * The summary engine itself lives in `compression.ts`; this module is the
 * turn's use of it.
 */

import { compressMemories, extractVisibleConversation, toVisibleConversationMessage } from '@/lib/memory/cheap-llm-tasks'
import type { UncensoredFallbackOptions } from '@/lib/memory/cheap-llm-tasks'
import {
  calculateMaxAvailable,
  CONTEXT_HISTORY_BUDGET_RATIO,
  MEMORY_BUDGET_RATIO,
} from '@/lib/llm/model-context-data'
import { countMessagesTokens, estimateTokens } from '@/lib/tokens/token-counter'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import {
  applyContextCompression,
  buildCompressedHistoryBlock,
  shouldApplyBudgetCompression,
  splitMessagesForCompression,
  type ContextCompressionResult,
} from './compression'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'
import type { ConnectionProfile, Provider } from '@/lib/schemas/types'

export type TurnBudgetInfo = ReturnType<typeof calculateMaxAvailable>

/** Window size used when the settings carry none. */
const DEFAULT_WINDOW_SIZE = 5

/**
 * The profile's `maxAvailable` budget, or null without a profile (no
 * compression is possible then).
 *
 * Autonomous-room pacing clamps it to this turn's slice of the run's token
 * budget (`remaining / turns_left`, from the turn handler). That shrinks the
 * whole pie — the compression trigger, the history fold and the memory budget
 * all derive from it — so a room with a huge window spreads its run across
 * turns instead of spending it on one. Only ever shrinks.
 */
export function resolveTurnBudgetInfo(
  provider: Provider,
  modelName: string,
  connectionProfile: ConnectionProfile | undefined,
  autonomousContextCap: number | undefined,
): TurnBudgetInfo | null {
  if (!connectionProfile) return null
  const info = calculateMaxAvailable(provider, modelName, connectionProfile)
  if (autonomousContextCap != null && autonomousContextCap < info.maxAvailable) {
    logger.info('[ContextManager] Autonomous per-turn budget cap applied', {
      modelMaxAvailable: info.maxAvailable,
      autonomousContextCap,
    })
    return { ...info, maxAvailable: autonomousContextCap }
  }
  return info
}

export interface TurnHistoryCompressionInput {
  provider: Provider
  userId: string
  chatId: string
  characterName: string
  userName: string
  /** The history rows `buildContext` was handed, in order. */
  existingMessages: ReadonlyArray<{ role: string; content: string; type?: string }>
  /** The persona prompt (system block 1), as built. */
  systemPrompt: string
  systemPromptTokens: number
  /** The memory allocation, standing in for recall not yet assembled. */
  memoryEstimateTokens: number
  budgetInfo: TurnBudgetInfo | null
  settings?: ContextCompressionSettings | null
  selection?: CheapLLMSelection | null
  bypass: boolean
  cachedResult?: ContextCompressionResult | null
  cachedMessageCount?: number
  onStatusChange?: (stage: string, message: string) => void
  warnings: string[]
}

export interface TurnHistoryCompression {
  /** The budget gate passed — memories may be compressed too. */
  enabled: boolean
  /** A summary is in force for this turn. */
  applied: boolean
  result?: ContextCompressionResult
  /** System block 3, or null when no summary is in force. */
  block: string | null
  /**
   * Index into `existingMessages` where the verbatim window begins; the rows
   * before it are what the summary covers. 0 when nothing is summarised.
   */
  windowStart: number
}

export async function compressTurnHistory(input: TurnHistoryCompressionInput): Promise<TurnHistoryCompression> {
  const { provider, budgetInfo, settings, selection } = input
  const none: TurnHistoryCompression = { enabled: false, applied: false, block: null, windowStart: 0 }

  const visible = extractVisibleConversation([...input.existingMessages])
  const conversationTokens = countMessagesTokens(visible, provider)
  // Recall has not been assembled yet; its allocation stands in for it.
  const totalEstimatedTokens = input.systemPromptTokens + conversationTokens + input.memoryEstimateTokens

  const enabled = !!(
    settings &&
    selection &&
    budgetInfo &&
    shouldApplyBudgetCompression(totalEstimatedTokens, budgetInfo.maxAvailable, settings, input.bypass)
  )

  if (budgetInfo) {
    input.onStatusChange?.('budget_check', 'Calculating context budget...')
    logger.info('[ContextManager] Budget analysis', {
      maxContext: budgetInfo.maxContext,
      maxTokens: budgetInfo.maxTokens,
      maxAvailable: budgetInfo.maxAvailable,
      totalEstimatedTokens,
      compressionNeeded: enabled,
      systemPromptTokens: input.systemPromptTokens,
      conversationTokens,
    })
  }
  if (!enabled || !settings || !selection || !budgetInfo) return none

  const contextHistoryBudget = Math.floor(budgetInfo.maxAvailable * CONTEXT_HISTORY_BUDGET_RATIO)
  logger.info('[ContextManager] Budget-driven compression enabled', {
    messageCount: input.existingMessages.length,
    windowSize: settings.windowSize,
    maxAvailable: budgetInfo.maxAvailable,
    contextHistoryBudget,
    conversationTokens,
  })

  const { messagesToCompress } = splitMessagesForCompression(visible, settings.windowSize)
  const compressibleTokens = countMessagesTokens(messagesToCompress, provider)
  if (compressibleTokens <= contextHistoryBudget) {
    logger.info('[ContextManager] Phase 1 skipped: conversation history within budget', {
      compressibleTokens,
      contextHistoryBudget,
    })
    return { ...none, enabled }
  }

  input.onStatusChange?.('compressing_context', 'Compressing conversation history...')
  logger.info('[ContextManager] Phase 1: Compressing conversation history', {
    compressibleTokens,
    contextHistoryBudget,
    compressibleMessageCount: messagesToCompress.length,
  })

  const result = await summaryForTurn(input, visible, settings, selection, contextHistoryBudget)
  if (!result?.compressionApplied) return { ...none, enabled, result }

  const block = buildCompressedHistoryBlock(result.compressedHistory)
  const windowSize = effectiveWindowSize(settings.windowSize, visible.length, input.cachedMessageCount)
  const { windowMessages } = splitMessagesForCompression(visible, windowSize)
  return {
    enabled,
    applied: true,
    result,
    block,
    windowStart: verbatimWindowStart(input.existingMessages, windowMessages.length),
  }
}

/** The cached pre-compression when it applies, else a synchronous pass. */
async function summaryForTurn(
  input: TurnHistoryCompressionInput,
  visible: ReturnType<typeof extractVisibleConversation>,
  settings: ContextCompressionSettings,
  selection: CheapLLMSelection,
  contextHistoryBudget: number,
): Promise<ContextCompressionResult | undefined> {
  const { cachedResult, warnings } = input
  const noteWarnings = (r: ContextCompressionResult) => {
    warnings.push(...r.warnings.map(w => `[Compression] ${w}`))
  }

  if (cachedResult?.compressionApplied) {
    logger.info('[ContextManager] Using cached compression result (async pre-compression)', {
      messageCount: input.existingMessages.length,
      cachedSavings: cachedResult.compressionDetails?.totalSavings,
    })
    noteWarnings(cachedResult)
    return cachedResult
  }

  logger.info('[ContextManager] No cached compression, performing sync compression', {
    messageCount: input.existingMessages.length,
    hasCachedResult: !!cachedResult,
  })
  try {
    const result = await applyContextCompression(visible, input.systemPrompt, {
      enabled: settings.enabled,
      windowSize: settings.windowSize,
      compressionTargetTokens: contextHistoryBudget,
      systemPromptTargetTokens: settings.systemPromptTargetTokens,
      selection,
      userId: input.userId,
      chatId: input.chatId,
      characterName: input.characterName,
      userName: input.userName,
      // The operator is waiting on this one: no cached result was ready, so
      // the turn is blocked behind the call. Tight budget (bug 107).
      latency: 'interactive',
    })
    noteWarnings(result)
    logger.info('[ContextManager] Phase 1 compression result', {
      compressionApplied: result.compressionApplied,
      compressionDetails: result.compressionDetails,
    })
    return result
  } catch (error) {
    warnings.push(`Failed to apply context compression: ${getErrorMessage(error)}`)
    logger.error('[ContextManager] Context compression error', {}, error instanceof Error ? error : undefined)
    return undefined
  }
}

/**
 * How many visible messages stay verbatim. A cache computed for fewer
 * messages than the chat now has summarises only up to its own window, so
 * every message since must ride verbatim too or it would be in neither.
 * Counted in visible messages, the domain `triggerAsyncCompression` counts in.
 */
export function effectiveWindowSize(
  standardWindowSize: number | undefined,
  visibleCount: number,
  cachedMessageCount: number | undefined,
): number {
  const standard = standardWindowSize || DEFAULT_WINDOW_SIZE
  if (cachedMessageCount === undefined || cachedMessageCount >= visibleCount) return standard
  const messagesSinceCache = visibleCount - cachedMessageCount
  logger.info('[ContextManager] Using dynamic window size for fallback cache', {
    standardWindowSize: standard,
    cachedMessageCount,
    currentVisibleMessageCount: visibleCount,
    messagesSinceCache,
    effectiveWindowSize: standard + messagesSinceCache,
  })
  return standard + messagesSinceCache
}

/**
 * The index at which the last `windowCount` *visible* messages begin. Counted
 * with the same rule `extractVisibleConversation` keeps rows by, so the window
 * holds exactly the messages the summary left out — a row that rule drops (an
 * assistant turn that was only tool markup) is carried along when it falls
 * inside the window but never counted toward it.
 */
export function verbatimWindowStart(
  messages: ReadonlyArray<{ role: string; content: string; type?: string }>,
  windowCount: number,
): number {
  let found = 0
  let start = messages.length
  for (let i = messages.length - 1; i >= 0 && found < windowCount; i--) {
    if (toVisibleConversationMessage(messages[i])) {
      found++
      start = i
    }
  }
  return start
}

/** One recalled-memory section, as compression sees it. */
export interface MemorySection {
  content: string
  tokens: number
}

export interface TurnMemoryCompressionInput {
  provider: Provider
  userId: string
  chatId: string
  characterName: string
  budgetInfo: TurnBudgetInfo | null
  selection?: CheapLLMSelection | null
  /** Whether the history pass's budget gate passed. */
  enabled: boolean
  semantic: MemorySection
  interCharacter: MemorySection
  uncensoredFallback?: UncensoredFallbackOptions
  onStatusChange?: (stage: string, message: string) => void
  warnings: string[]
}

/**
 * Phase 2: when the recalled memories exceed `MEMORY_BUDGET_RATIO` of
 * `maxAvailable`, compress them. Semantic memories get 70% of that share
 * when there are inter-character memories too, and those get what is left.
 * Returns the sections as they now stand (unchanged on failure or no need).
 */
export async function compressTurnMemories(
  input: TurnMemoryCompressionInput,
): Promise<{ semantic: MemorySection; interCharacter: MemorySection }> {
  const { budgetInfo, selection } = input
  let { semantic, interCharacter } = input
  const totalTokens = semantic.tokens + interCharacter.tokens
  if (!input.enabled || !budgetInfo || !selection || totalTokens === 0) return { semantic, interCharacter }

  const memoryBudget = Math.floor(budgetInfo.maxAvailable * MEMORY_BUDGET_RATIO)
  if (totalTokens <= memoryBudget) {
    logger.info('[ContextManager] Phase 2 skipped: memories within budget', { totalMemoryTokens: totalTokens, memoryBudget })
    return { semantic, interCharacter }
  }

  input.onStatusChange?.('compressing_memories', 'Compressing memories...')
  logger.info('[ContextManager] Phase 2: Compressing memories', {
    totalMemoryTokens: totalTokens,
    memoryBudget,
    semanticMemoryTokens: semantic.tokens,
    interCharacterMemoryTokens: interCharacter.tokens,
  })

  const semanticBudget = interCharacter.tokens > 0 ? Math.floor(memoryBudget * 0.7) : memoryBudget
  if (semantic.content && semantic.tokens > semanticBudget) {
    semantic = await compressMemorySection(input, semantic, semanticBudget, 'memories')
  }

  const interCharacterBudget = memoryBudget - Math.min(semantic.tokens, semanticBudget)
  if (interCharacter.content && interCharacter.tokens > interCharacterBudget && interCharacterBudget > 0) {
    interCharacter = await compressMemorySection(input, interCharacter, interCharacterBudget, 'inter-character memories')
  }

  return { semantic, interCharacter }
}

async function compressMemorySection(
  input: TurnMemoryCompressionInput,
  section: MemorySection,
  targetTokens: number,
  label: string,
): Promise<MemorySection> {
  try {
    const compressed = await compressMemories(
      section.content,
      input.characterName,
      targetTokens,
      input.selection!,
      input.userId,
      input.uncensoredFallback,
      input.chatId,
      // Inline on a visible turn — the tighter budget, and no retry (bug 107).
      'interactive',
    )
    if (compressed.success && compressed.result) {
      logger.info(`[ContextManager] Compressed ${label}`, {
        originalTokens: compressed.result.originalTokens,
        compressedTokens: compressed.result.compressedTokens,
      })
      const content = compressed.result.compressedText
      return { content, tokens: estimateTokens(content, input.provider) }
    }
    input.warnings.push(`Failed to compress ${label}: ${compressed.error}`)
  } catch (error) {
    input.warnings.push(`Error during ${label} compression: ${getErrorMessage(error)}`)
    logger.error(`[ContextManager] Error compressing ${label}`, {}, error instanceof Error ? error : undefined)
  }
  return section
}
