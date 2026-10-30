/**
 * Context Manager
 *
 * Builds one turn's LLM context within the model's token budget.
 * `buildContext` is a sequence of phases, each its own module under
 * `lib/chat/context/` (map: PROMPT_ARCHITECTURE.md §15,
 * SYSTEM_FLOWCHARTS.md §9):
 *
 *  1. System block 1 — the persona prompt (`turn-system-prompt.ts`).
 *  2. History compression, when the estimate is over budget (`turn-compression.ts`).
 *  3. The scene-state section (`turn-scene-state.ts`).
 *  4. Recall and knowledge (`turn-recall.ts`), then memory compression.
 *  5. The Staff whispers — Host time, Aurora's Core, the Commonplace Book,
 *     Suparṇā's mail (`turn-whispers.ts`).
 *  6. The trailing sections (`turn-trailing.ts`) and the inform block
 *     (`inform-block.ts`).
 *  7. History, packed into what every part above leaves (`turn-history.ts`).
 *  8. Recall delivery, once the request body is settled.
 *
 * Every part of the request is measured before history is packed, so a full
 * context lands under `safeInputLimit` — the ceiling the pre-send check holds
 * it to — rather than over it by the size of its trailing sections.
 *
 * Multi-character: history is attributed from the responder's seat (name
 * field or prefix fallback), honours `hasHistoryAccess` for late joiners and
 * hides whispers the responder was not party to.
 */

import type {
  Provider,
  Character,
  ChatParticipantBase,
  ChatMetadataBase,
  ConnectionProfile,
  TimestampConfig,
} from '@/lib/schemas/types'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'
import type { UncensoredFallbackOptions } from '@/lib/memory/cheap-llm-tasks'
import { countMessageTokens, countMessagesTokens } from '@/lib/tokens/token-counter'
import { getRecommendedContextAllocation, type ContextWindowSource } from '@/lib/llm/model-context-data'
import type { PreRecall } from '@/lib/memory/recall/assemble'
import { deliverRecall } from '@/lib/memory/recall/deliver'
import { RECALL_MIN_IMPORTANCE } from '@/lib/memory/scoring'
import { getRepositories } from '@/lib/repositories/factory'
import { resolveTieredMountPool } from '@/lib/mount-index/tiered-mount-pool'
import { buildCommonplaceLLMContext } from '@/lib/services/commonplace-notifications/writer'
import type { MailAlertsOwed } from '@/lib/post-office/mailbox'
import { buildProgressionsSection } from '@/lib/progressions/prompt-section'
import { buildInventorySection } from '@/lib/inventory/prompt-section'
import { calculateCurrentTimestamp, shouldInjectTimestamp } from '@/lib/chat/timestamp-utils'
import { lazyAsync } from '@/lib/utils/lazy-async'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import { buildInformBlock } from './context/inform-block'
import { findUserParticipantName, type MessageWithParticipant } from './context/message-attribution'
import { buildUserNarrationAnchor } from './context/user-narration-anchor'
import type { ContextCompressionResult } from './context/compression'
import { buildTurnSystemPrompt } from './context/turn-system-prompt'
import { compressTurnHistory, compressTurnMemories, resolveTurnBudgetInfo } from './context/turn-compression'
import { buildTurnSceneState } from './context/turn-scene-state'
import {
  assembleTurnRecall,
  buildRecentWindowQuery,
  collectStandingConversationIds,
  retrieveTurnKnowledge,
} from './context/turn-recall'
import { createTurnTranscript, minutesSinceLastHostTimestamp, type TurnTranscript } from './context/turn-transcript'
import { buildEstablishedFactReminder } from './context/established-fact-reminder'
import { resolveSpeakerNames } from './speaker-names'
import { announceTurnMail, offerCoreWhisper, postCommonplaceWhispers, postTurnTimestamp } from './context/turn-whispers'
import { buildReferentSections, buildTurnNotes, composeTrailingMessage } from './context/turn-trailing'
import {
  buildLeadingSystemBlocks,
  historyContextMessages,
  packTurnHistory,
  turnHistoryRows,
  type HistoryCast,
} from './context/turn-history'
import type { SelectableMessage } from './context/message-selector'

/**
 * Message format expected by the context manager
 */
export interface ContextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Optional metadata for the message */
  metadata?: {
    messageId?: string
    tokenCount?: number
    isInjected?: boolean
    /**
     * Set on the message carrying *this* turn's user input. Image attachments
     * anchor here rather than at the tail of the array, because staff whispers
     * (Host timestamps, Prospero context, connection-profile bubbles) format as
     * `role: user` and routinely land after it — bug 95.
     */
    isUserTurn?: boolean
  }
  /** Google Gemini thought signature for thinking models (e.g., gemini-3-pro) */
  thoughtSignature?: string | null
  /** Optional name for multi-character chats (provider-dependent support) */
  name?: string
  /**
   * Provider cache breakpoint marker. Set on the head Librarian summary
   * whisper so providers that support per-message caching (Anthropic) can
   * anchor a cache breakpoint there: system+tools stay hot across summary
   * folds; only the summary-and-after re-prefills.
   */
  cacheControl?: { type: 'ephemeral' }
}

/**
 * Context budget allocation
 */
export interface ContextBudget {
  /** Total context window size for the model */
  totalLimit: number
  /** Tokens allocated for system prompt */
  systemPromptBudget: number
  /** Tokens allocated for memories */
  memoryBudget: number
  /**
   * Tokens allocated for per-turn knowledge recall (responding character's
   * vault Knowledge/ folder). Independent of memoryBudget — knowledge is
   * first-class character canon and is not fed to the memory compressor.
   */
  knowledgeBudget: number
  /** Tokens allocated for recent messages */
  recentMessagesBudget: number
  /** Tokens reserved for response */
  responseReserve: number
  /**
   * Tokens held back beyond the response reserve to absorb estimator error
   * (10% of the window). Part of `safeInputLimit`; broken out for logging.
   */
  safetyMargin: number
  /**
   * The ceiling the outgoing payload must fit under:
   * `totalLimit − responseReserve − safetyMargin`.
   *
   * This is what the builder packs to *and* what the pre-send validation
   * checks against — one number, so a full context can no longer be reported
   * as an overage it was told to produce.
   */
  safeInputLimit: number
}

/**
 * Result of context building
 */
export interface BuiltContext {
  /** Messages ready to send to LLM */
  messages: ContextMessage[]
  /** Token usage breakdown */
  tokenUsage: {
    /** System blocks 1–3: persona prompt, identity reinforcement, compressed history. */
    systemPrompt: number
    memories: number
    /** Tokens spent on per-turn knowledge recall (responding character's vault Knowledge/ folder). */
    knowledge: number
    /** The history packed, plus the new user message. */
    recentMessages: number
    /** Everything in `messages`. */
    total: number
  }
  /** Context budget that was used */
  budget: ContextBudget
  /** Number of memories included */
  memoriesIncluded: number
  /** Number of messages included */
  messagesIncluded: number
  /** Whether messages were truncated to fit */
  messagesTruncated: boolean
  /**
   * The `chat_informs` rows the inform block carried this turn. Empty when
   * there was no block, and empty on a swipe (a swipe re-applies but never
   * consumes). The finalizer marks exactly these consumed once the turn has
   * produced a *persisted* assistant message — never before, so a provider
   * failure that saves nothing leaves them pending for the next attempt.
   * See `lib/chat/context/inform-block.ts`.
   */
  informRowIds: string[]
  /**
   * The letters Suparṇā announced this turn, owed an `alerted` flip. Null when
   * none were announced, and always null on a swipe. Like `informRowIds`, they
   * are marked only once the turn has delivered them — by the finalizer, the
   * preserved-partial path, the tool-only save or a deliberate pass — never
   * here, so a failed or aborted turn offers the letters again.
   * See `markMailAlertsDelivered` (`lib/post-office/mailbox.ts`).
   */
  mailAlertsOwed: MailAlertsOwed | null
  /** Warnings generated during context building */
  warnings: string[]
  /** Debug info: the actual memories that were included */
  debugMemories?: Array<{ summary: string; importance: number; score: number; salience: number }>
  /** Debug info: the inter-character memories that were included (multi-character chats) */
  debugInterCharacterMemories?: Array<{ aboutCharacterName: string; summary: string; importance: number }>
  /** Debug info: the knowledge entries that were included for this turn */
  debugKnowledge?: Array<{ filePath: string; score: number; inline: boolean; tokenCount: number }>
  /** Debug info: the memory recap content injected on chat start / character join */
  debugMemoryRecap?: string
  /**
   * Debug info: the per-turn relevant-past-conversations list, present only
   * when the instance-wide `memoryRecall.perTurnConversationSummaries` setting
   * is on and the search found something new to list.
   */
  debugRelevantConversations?: string
  /**
   * The turn's recall record — the stage trace, what each pool delivered and
   * the head ids for the anti-repetition ring — written by `deliverRecall`.
   * The finalizer stores it on the assistant message's `debugMemoryLogs`.
   */
  recallDebugLog?: string[]
  /** Debug info: the chat's rolling summary (it rides as a Librarian whisper) */
  debugSummary?: string
  /** Debug info: the system prompt that was built, with the compressed history when in force */
  debugSystemPrompt?: string
  /** Original uncompressed system prompt (for async pre-compression of next message) */
  originalSystemPrompt?: string
  /** Whether context compression was applied */
  compressionApplied?: boolean
  /** Details about the compression (if applied) */
  compressionDetails?: {
    originalMessageCount: number
    compressedMessageCount: number
    windowMessageCount: number
    originalHistoryTokens: number
    compressedHistoryTokens: number
    originalSystemPromptTokens: number
    compressedSystemPromptTokens: number
    totalSavings: number
  }
}

/**
 * Options for building context
 */
export interface BuildContextOptions {
  /** Provider for token estimation */
  provider: Provider
  /** Model name for context limit lookup */
  modelName: string
  /** User ID for memory access */
  userId: string
  /** Character for system prompt (the character who will respond) */
  character: Character
  /** User character information (optional) */
  userCharacter?: { name: string; description: string } | null
  /** Chat metadata */
  chat: ChatMetadataBase
  /** Existing messages in the conversation */
  existingMessages: Array<{ role: string; content: string; id?: string; thoughtSignature?: string | null }>
  /** New user message being sent (optional for continue mode) */
  newUserMessage?: string
  /**
   * The user-controlled participant the human is "Speaking As" for this turn.
   * Labels the new user message with the chosen character's name in multi-
   * character context; falls back to the first user-controlled participant.
   */
  activeUserParticipantId?: string | null
  /** Roleplay template for formatting instructions (prepended to system prompt) */
  roleplayTemplate?: { systemPrompt: string } | null
  /** Embedding profile ID for semantic search */
  embeddingProfileId?: string
  /** Skip memory retrieval */
  skipMemories?: boolean
  /** Minimum importance for memories */
  minMemoryImportance?: number

  // ============================================================================
  // Multi-Character Context Building
  // ============================================================================

  /**
   * The participant who will respond. Passed in single-character chats too,
   * so the compiled identity stack and the inform block can find their seat.
   */
  respondingParticipant?: ChatParticipantBase
  /** All active participants in the chat (multi-character only) */
  allParticipants?: ChatParticipantBase[]
  /** Map of participant ID -> Character data (multi-character only) */
  participantCharacters?: Map<string, Character>
  /** Extended messages with participantId for attribution (multi-character only) */
  messagesWithParticipants?: MessageWithParticipant[]

  /** Tool instructions injected into system prompt (native tool rules or text-block tool instructions) */
  toolInstructions?: string

  // ============================================================================
  // Timestamp Injection
  // ============================================================================

  /** Timestamp configuration (from chat or user settings) */
  timestampConfig?: TimestampConfig | null
  /** Whether this is the first user message in the conversation */
  isInitialMessage?: boolean
  /** Resolved IANA timezone name for timestamp formatting */
  timezone?: string

  /** The connection profile being used (provides maxContext/maxTokens for budget calculation) */
  connectionProfile?: ConnectionProfile

  // ============================================================================
  // Context Compression
  // ============================================================================

  /** Context compression settings */
  contextCompressionSettings?: ContextCompressionSettings | null
  /** Cheap LLM selection for compression (required if compression is enabled) */
  cheapLLMSelection?: CheapLLMSelection | null
  /** Whether to bypass compression for this request (e.g., requestFullContextOnNextMessage flag) */
  bypassCompression?: boolean
  /** Pre-computed compression result from async cache (avoids blocking on compression) */
  cachedCompressionResult?: ContextCompressionResult | null
  /**
   * Message count when the cached compression was computed.
   * Used to calculate dynamic window size when using a fallback cache.
   * If the cache was computed for fewer messages than we currently have,
   * the effective window must be larger to include all messages since
   * the compression point.
   */
  cachedCompressionMessageCount?: number

  // ============================================================================
  // Memory Recall
  // ============================================================================

  /**
   * The proactive pass's recall: its query (distilled and embedded once) and
   * what that query found. When present, this turn's recall reuses both —
   * no second distillation, no second embedding.
   */
  preRecall?: PreRecall | null
  /** Whether to generate a memory recap for this character (first message or character join) */
  generateMemoryRecap?: boolean
  /** Uncensored fallback options for memory recap in dangerous chats */
  uncensoredFallbackOptions?: UncensoredFallbackOptions

  /**
   * Continue mode: any turn built without a new user message — the Salon's
   * Continue, a nudge, every chained speaker after the first, and every
   * autonomous-room turn. Never a model finishing its own sentence. The Aurora
   * Core whisper skips these turns by design; the other trailing sections
   * (recall, mail, progressions, inventory, inform) are built on them as on
   * any turn.
   */
  isContinueMode?: boolean

  /**
   * Swipe re-apply: the message being re-rolled plus every id in its swipe
   * group. When set, the inform block carries the rows those generations
   * consumed and no pending row at all — a swipe must see exactly the informs
   * the line it re-rolls saw, and a brand-new inform has no business landing
   * there. Undefined for every ordinary turn.
   */
  regenerationOfMessageIds?: string[]

  /** Optional callback to emit status events during context building phases */
  onStatusChange?: (stage: string, message: string) => void

  /**
   * Autonomous-room per-turn context cap (tokens). When set, the model-derived
   * `maxAvailable` budget is clamped down to this value before the history and
   * memory fold targets are computed, so a token-budgeted room paces its run
   * across multiple turns instead of spending most of the per-run budget on one
   * oversized turn. The caller (the autonomous-room turn handler) derives it as
   * `remaining_run_budget / turns_left`, floored at a minimum viable context.
   * Undefined for non-autonomous turns and rooms without a token budget →
   * unchanged behavior.
   */
  autonomousContextCap?: number

  /**
   * Tokens the caller will add to this turn's payload *after* the context is
   * built, and which therefore cannot be discovered by measuring what the
   * builder produced: the tool/function schemas (never in the message array at
   * all), plus any system message the orchestrator splices in downstream —
   * agent-mode instructions, the tool-change notice.
   *
   * Held back from the message budget so the builder doesn't pack history into
   * space that is already spoken for. Undefined → unchanged behavior.
   *
   * See `collectTurnExtras` (`lib/services/chat-message/turn-extras.ts`), which
   * builds those additions and measures them in one place so the reservation
   * and the text it pays for can't drift apart.
   */
  reservedOutgoingTokens?: number

  // ============================================================================
  // Turn notes (ephemeral, never persisted)
  // ============================================================================

  /**
   * Per-turn ephemeral instruction control for turn-skipping. When
   * `offerSkip` is true, a Turn note is appended to (or pushed after) the
   * outgoing messages inviting the character to pass with the
   * `[NOTHING TO ADD]` sentinel; `recentlyAddressed` adds a caution to answer
   * rather than pass. Never persisted. Undefined / `offerSkip: false` → no note.
   */
  turnSkip?: { offerSkip: boolean; recentlyAddressed: boolean; characterName: string }
  /**
   * The operator has raised a hand (`lib/chat/turn-control.ts`) and this is the
   * character asked: a Turn note invites it to `[YIELD]` the floor or carry on.
   * Trails every other section, the skip note included. Never persisted.
   */
  offerYield?: boolean
  /**
   * Row ids of the human's own turns (USER, no `systemSender`), captured by the
   * caller before whisper normalization re-roles Staff whispers to USER. Feeds
   * the chained-turn scene note (`buildUserNarrationAnchor`). Absent → no note.
   */
  humanTurnMessageIds?: ReadonlySet<string>
  /**
   * `'bid'` builds a storyteller bid's context: everything a real turn would
   * see, but recall is assembled and not delivered (no access stamps, no
   * anti-repetition ring). The bid runs inside a dry scope
   * (`lib/repositories/dry-scope.ts`), which discards every other write the
   * build would make — staff whispers included, though their text still
   * reaches this context. Default `'turn'`.
   */
  purpose?: 'turn' | 'bid'
  /**
   * A storyteller section (the bid instructions, or a speaking turn's plan),
   * appended as the LAST trailing section. Ephemeral, never persisted.
   */
  storytellerSection?: string
}

/**
 * Calculate context budget based on model limits.
 *
 * `profile` is not optional in spirit — pass it whenever one is in hand. Without
 * it the window comes from a model-name table lookup that knows nothing about
 * the user's Max Context setting, so a profile pointed at an unrecognised model
 * (any `hf.co/...` Ollama tag, any OpenAI-compatible endpoint) budgets against
 * the 8192-token provider default while `calculateMaxAvailable` — which *does*
 * read the profile — works from the real window. The two then disagree, and the
 * smaller one wins where it hurts: history gets trimmed to fit a window the
 * model never had.
 */
export function calculateContextBudget(
  provider: Provider,
  modelName: string,
  profile?: ContextWindowSource | null
): ContextBudget {
  const allocation = getRecommendedContextAllocation(provider, modelName, profile)

  return {
    totalLimit: allocation.totalLimit,
    systemPromptBudget: allocation.systemPrompt,
    memoryBudget: allocation.memories,
    knowledgeBudget: allocation.knowledge,
    recentMessagesBudget: allocation.recentMessages,
    responseReserve: allocation.responseReserve,
    safetyMargin: allocation.safetyMargin,
    safeInputLimit: allocation.safeInputLimit,
  }
}

/**
 * The cast of a multi-character chat, or undefined for a single-character one
 * — a chat is multi-character when the caller passed everything attribution
 * needs and more than one participant is seated.
 */
function resolveCast(options: BuildContextOptions): HistoryCast | undefined {
  const { respondingParticipant, allParticipants, participantCharacters, messagesWithParticipants } = options
  if (!respondingParticipant || !allParticipants || allParticipants.length <= 1) return undefined
  if (!participantCharacters || !messagesWithParticipants) return undefined
  return { respondingParticipant, allParticipants, participantCharacters, messagesWithParticipants }
}

/**
 * The time the Host announces this turn, or null when it does not. Time is
 * announced when `autoPrepend` is set and the mode says so (`START_ONLY` on
 * the first message, `EVERY_MESSAGE`, or `EVERY_N_MINUTES` once the interval
 * has passed since the last announcement). One string, read once, for both
 * the Host's line and the scene-state section.
 */
async function resolveAnnouncedTime(options: BuildContextOptions, transcript: TurnTranscript): Promise<string | null> {
  const config = options.timestampConfig
  if (!config?.autoPrepend) return null

  let minutesSinceLast: number | null = null
  if (config.mode === 'EVERY_N_MINUTES') {
    try {
      minutesSinceLast = minutesSinceLastHostTimestamp(await transcript.events(), Date.now())
    } catch (error) {
      logger.warn('[ContextManager] Failed to resolve last timestamp announcement; allowing emission', {
        chatId: options.chat.id,
        error: getErrorMessage(error),
      })
    }
  }
  if (!shouldInjectTimestamp(config, options.isInitialMessage ?? false, minutesSinceLast)) return null
  return calculateCurrentTimestamp(config, options.timezone).formatted
}

/**
 * Main context building function: every phase, in order. See the module
 * header for the map.
 */
export async function buildContext(options: BuildContextOptions): Promise<BuiltContext> {
  const {
    provider,
    userId,
    character,
    userCharacter,
    chat,
    existingMessages,
    newUserMessage,
    respondingParticipant,
    cheapLLMSelection,
    onStatusChange,
  } = options
  const skipMemories = options.skipMemories ?? false
  const warnings: string[] = []
  const budget = calculateContextBudget(provider, options.modelName, options.connectionProfile)
  const cast = resolveCast(options)
  const userName = userCharacter?.name || 'User'
  // The scope every per-recipient Staff whisper this turn is addressed to: the
  // responding participant in a multi-character chat, untargeted otherwise.
  const whisperTarget = cast ? cast.respondingParticipant.id : null
  const transcript = createTurnTranscript(chat.id)
  // The tri-tier mount pool is wanted by the live-wardrobe titles and by
  // knowledge retrieval; resolved at most once, and only if either asks.
  // characterId is REQUIRED for the group tier (keyed on the responder's own
  // memberships, never the chat); the vault id is the fast path for its tier.
  const mountPool = lazyAsync(() => resolveTieredMountPool({
    userId,
    characterId: character.id ?? null,
    characterMountPointId: character.characterDocumentMountPointId ?? null,
    projectId: chat.projectId ?? null,
  }))

  const announcedTime = await resolveAnnouncedTime(options, transcript)

  // 1. System block 1.
  const systemPrompt = await buildTurnSystemPrompt({
    provider,
    character,
    userCharacter,
    chat,
    respondingParticipant,
    roleplayTemplate: options.roleplayTemplate,
    toolInstructions: options.toolInstructions,
    timestampConfig: options.timestampConfig,
    isInitialMessage: options.isInitialMessage,
    timezone: options.timezone,
    budgetTokens: budget.systemPromptBudget,
    cast,
    warnings,
  })

  // 2. History compression (system block 3).
  const budgetInfo = resolveTurnBudgetInfo(provider, options.modelName, options.connectionProfile, options.autonomousContextCap)
  const compression = await compressTurnHistory({
    provider,
    userId,
    chatId: chat.id,
    characterName: character.name,
    userName,
    existingMessages,
    systemPrompt: systemPrompt.prompt,
    systemPromptTokens: systemPrompt.tokens,
    memoryEstimateTokens: budget.memoryBudget,
    budgetInfo,
    settings: options.contextCompressionSettings,
    selection: cheapLLMSelection,
    bypass: options.bypassCompression ?? false,
    cachedResult: options.cachedCompressionResult,
    cachedMessageCount: options.cachedCompressionMessageCount,
    onStatusChange,
    warnings,
  })

  // 3. The `## Current State` section.
  const scene = await buildTurnSceneState({
    chat,
    provider,
    targetParticipantId: whisperTarget,
    sceneTime: announcedTime,
    projectMountPointIds: async () => (await mountPool()).projectMountPointIds,
    warnings,
  })

  // 4. Recall and knowledge, from one recent-window query (which works in
  // continue mode too), then memory compression.
  const recentWindow = buildRecentWindowQuery(existingMessages, newUserMessage)
  const tRecallStart = performance.now()
  // Independent reads, so they run together.
  const [recall, knowledge] = await Promise.all([assembleTurnRecall({
    userId,
    embeddingProfileId: options.embeddingProfileId,
    provider,
    character,
    chat,
    existingMessages,
    newUserMessage,
    recentWindow,
    memoryBudget: budget.memoryBudget,
    minImportance: options.minMemoryImportance ?? RECALL_MIN_IMPORTANCE,
    skipMemories,
    cast,
    participantCharacters: options.participantCharacters,
    currentStateTokens: scene.tokens,
    maxContext: budgetInfo?.maxContext,
    cheapLLMSelection,
    preRecall: options.preRecall,
    generateMemoryRecap: options.generateMemoryRecap,
    uncensoredFallback: options.uncensoredFallbackOptions,
    standingConversationIds: lazyAsync(async () => {
      try {
        return collectStandingConversationIds(await transcript.events(), whisperTarget)
      } catch {
        // Dedup is best-effort; a duplicate UUID listing is harmless.
        return new Set<string>()
      }
    }),
    onStatusChange,
  }), retrieveTurnKnowledge({
    userId,
    embeddingProfileId: options.embeddingProfileId,
    provider,
    character,
    query: recentWindow,
    budgetTokens: budget.knowledgeBudget,
    skip: skipMemories,
    mountPool,
    warnings,
  })])
  warnings.push(...recall.warnings)
  logger.debug('[ContextManager] Recall assembled', {
    chatId: chat.id,
    characterId: character.id,
    path: recall.path,
    durationMs: Math.round(performance.now() - tRecallStart),
    archive: recall.pools.archive.length,
    head: recall.pools.head.length,
    interCharacter: recall.pools.interCharacter.length,
    recap: recall.pools.recap.length,
  })

  const memories = await compressTurnMemories({
    provider,
    userId,
    chatId: chat.id,
    characterName: character.name,
    budgetInfo,
    selection: cheapLLMSelection,
    enabled: compression.enabled,
    semantic: { content: recall.sections.relevant ?? '', tokens: recall.tokens.relevant },
    interCharacter: { content: recall.sections.interCharacter ?? '', tokens: recall.tokens.interCharacter },
    uncensoredFallback: options.uncensoredFallbackOptions,
    onStatusChange,
    warnings,
  })

  // 5. The Staff whispers, in transcript order. ORDERING: the Core whisper
  // precedes the Commonplace Book on purpose — you need to know who you are
  // before you can rightly read what you remember; memory first can flood
  // identity (docs/feature-requests/aurora-core-whisper.md).
  const timestampLine = announcedTime ? await postTurnTimestamp(chat.id, announcedTime) : null
  const coreWhisper = await offerCoreWhisper({
    chat,
    character,
    userId,
    respondingParticipant,
    isContinueMode: options.isContinueMode ?? false,
    transcript,
  })

  // The consolidated whisper's persona text is posted for the Salon; its
  // plain "you remember…" text is what the model reads. The retrospective
  // mini-recap rides the recall text but is posted as its own whisper.
  const retrospectiveRecall = recall.sections.retrospective ?? ''
  const perTurnConversations = recall.sections.relevantConversations ?? ''
  const commonplaceParts = {
    currentState: scene.content || undefined,
    recap: recall.sections.recap || undefined,
    relevant: memories.semantic.content || undefined,
    interChar: memories.interCharacter.content || undefined,
    knowledge: knowledge.content || undefined,
    // Empty unless the per-turn conversation-summary cadence is switched on;
    // the fold-posted whisper carries this section otherwise.
    relevantConversations: perTurnConversations || undefined,
  }
  const recallText = buildCommonplaceLLMContext({ ...commonplaceParts, retrospectiveRecall: retrospectiveRecall || undefined })
  await postCommonplaceWhispers({
    chatId: chat.id,
    targetParticipantId: whisperTarget,
    parts: commonplaceParts,
    retrospectiveRecall,
    commitSceneState: scene.commit,
  })

  const isRegeneration = (options.regenerationOfMessageIds?.length ?? 0) > 0
  const mail = await announceTurnMail({ chat, character, targetParticipantId: whisperTarget, isRegeneration })

  // 6. The trailing sections' reads — independent of each other and of the
  // whispers just posted, so they run together. Progressions and the
  // Inventory are built on every turn, continue mode included: that is every
  // turn without a new user message (a chained speaker, a nudge, an
  // autonomous room), and the design of record wants both on all of them.
  // The inform block is the operator's passages for this seat, verbatim under
  // their one vouching header; empty-is-absent.
  const [progressions, inventory, referents, inform, establishedFacts] = await Promise.all([
    buildProgressionsSection({
      character,
      // A thunk: a character carrying no progressions — nearly all of them —
      // must not pay for a history read it will never consult.
      ...(respondingParticipant ? { loadEvents: transcript.events } : {}),
      respondingParticipantId: respondingParticipant?.id ?? null,
      nowMs: Date.now(),
      timezone: options.timezone,
    }),
    buildInventorySection({ chat, characterId: character.id, repos: getRepositories() }).then(section => section ?? ''),
    buildReferentSections({
      chat,
      userId,
      character,
      userCharacter,
      respondingParticipant,
      allParticipants: options.allParticipants,
      activeUserParticipantId: options.activeUserParticipantId,
      newUserMessage,
      transcript,
    }),
    respondingParticipant
      ? buildInformBlock({
          repos: getRepositories(),
          chatId: chat.id,
          participantId: respondingParticipant.id,
          regenerationOfMessageIds: options.regenerationOfMessageIds,
        })
      : Promise.resolve({ content: null, rowIds: [] as string[] }),
    // Established facts posted since this seat last spoke, under their one
    // vouching header; empty-is-absent. Reads only — the cadence is derived
    // from history, and a swipe measures it on what the original saw.
    respondingParticipant
      ? transcript.events().then(events => buildEstablishedFactReminder({
          events,
          respondingParticipantId: respondingParticipant.id,
          joinedAt: respondingParticipant.createdAt,
          hasHistoryAccess: respondingParticipant.hasHistoryAccess,
          regenerationOfMessageIds: options.regenerationOfMessageIds,
          loadSpeakerNames: () => resolveSpeakerNames(chat),
          chatId: chat.id,
        })).catch(error => {
          // Never fails the turn: the facts are still in history.
          logger.warn('[EstablishedFact] Could not build the reminder; the facts still ride in history', {
            chatId: chat.id,
            error: getErrorMessage(error),
          })
          return ''
        })
      : Promise.resolve(''),
  ])
  const notes = buildTurnNotes({
    turnSkip: options.turnSkip,
    offerYield: options.offerYield,
    operatorName: userCharacter?.name || 'The User',
    chatId: chat.id,
    participantId: respondingParticipant?.id,
  })
  if (inform.content) {
    logger.debug('[Inform] Delivering inform block as a trailing context section', {
      chatId: chat.id,
      participantId: respondingParticipant?.id,
      onNewUserMessage: !!newUserMessage,
      rowIds: inform.rowIds,
    })
  }
  const sections = {
    coreWhisper,
    recall: recallText,
    mail: mail.llmContext,
    progressions,
    inventory,
    inform: inform.content,
    establishedFacts,
    referentLedger: referents.referentLedger,
    closingEcho: referents.closingEcho,
    turnSkip: notes.turnSkip,
    turnYield: notes.turnYield,
    storyteller: options.storytellerSection,
  }
  const newUserName = newUserMessage && cast
    ? findUserParticipantName(cast.allParticipants, cast.participantCharacters, options.activeUserParticipantId, chat.impersonatingParticipantIds)
    : undefined
  const composeTrailing = (narrationAnchor: string) =>
    composeTrailingMessage({ newUserMessage, newUserName, sections, narrationAnchor })
  // The chained-turn scene note: in a multi-character chain the human's
  // narration sits mid-history and the newest line is another character's.
  const narrationAnchorFor = (historyWindow: ReadonlyArray<SelectableMessage>) => buildUserNarrationAnchor({
    isMultiCharacter: !!cast,
    hasNewUserMessage: !!newUserMessage,
    historyWindow,
    humanTurnMessageIds: options.humanTurnMessageIds,
    userName,
    nameForParticipant: participantId => {
      const seat = options.allParticipants?.find(p => p.id === participantId)
      return seat?.characterId ? options.participantCharacters?.get(seat.characterId)?.name : undefined
    },
  })

  // 7. History, packed into what is left under `safeInputLimit` once every
  // other part of the request is measured — and whatever the caller adds
  // afterwards (`reservedOutgoingTokens`: tool schemas, agent-mode
  // instructions, the tool-change notice). Every part is counted by the one
  // per-message rule the pre-send check uses (`countMessagesTokens`). The
  // scene note depends on which history rides, so its room is measured over
  // every row that may ride: the packed history is a suffix of those rows, so
  // the note built for it is never larger.
  const systemBlocks = buildLeadingSystemBlocks({
    systemPrompt: systemPrompt.prompt,
    characterName: character.name,
    compressedHistoryBlock: compression.block,
  })
  const historyRows = turnHistoryRows({
    existingMessages,
    cast,
    windowStart: compression.windowStart,
    summaryAnchorIds: chat.summaryAnchorMessageIds ?? [],
  })
  const draftAnchor = narrationAnchorFor(historyRows)
  const trailingDraft = composeTrailing(draftAnchor)
  const outsideHistory = (trailing: ContextMessage | null): ContextMessage[] => [
    ...systemBlocks,
    ...(timestampLine ? [timestampLine] : []),
    ...(trailing ? [trailing] : []),
  ]
  const reservedOutgoingTokens = options.reservedOutgoingTokens ?? 0
  const fixedTokens = countMessagesTokens(outsideHistory(trailingDraft), provider) + reservedOutgoingTokens
  const remainingTokens = budget.safeInputLimit - fixedTokens
  if (remainingTokens <= 0) {
    // The symptom is a character with no apparent memory of the exchange,
    // indistinguishable from routine trimming unless said out loud.
    warnings.push(
      `No room left for conversation history: the system prompt, memories, trailing sections and reserved payload (${fixedTokens} tokens) fill the ${budget.safeInputLimit}-token input budget. Raise Max Context on the connection profile, or trim the character.`
    )
    logger.warn('[ContextManager] Message budget exhausted before any history', {
      safeInputLimit: budget.safeInputLimit,
      fixedTokens,
      reservedOutgoingTokens,
      remainingTokens,
    })
  }

  const history = packTurnHistory(historyRows, {
    provider,
    remainingTokens,
    recentMessagesBudget: budget.recentMessagesBudget,
    totalLimit: budget.totalLimit,
    warnings,
  })

  // The draft is the message unless packing dropped the human line the
  // scene note pointed at.
  const finalAnchor = narrationAnchorFor(history.messages)
  const trailing = finalAnchor === draftAnchor ? trailingDraft : composeTrailing(finalAnchor)
  if (!newUserMessage && recallText) {
    logger.debug('[CommonplaceWhisper] Delivering recall in the trailing-only message (no new user message)', {
      chatId: chat.id,
      participantId: respondingParticipant?.id,
      length: recallText.length,
    })
  }
  const contextMessages: ContextMessage[] = [
    ...systemBlocks,
    ...historyContextMessages(history.messages),
    ...(timestampLine ? [timestampLine] : []),
    ...(trailing ? [trailing] : []),
  ]

  // 8. Recall delivery: the request body is built and compression has had its
  // say, so what the model will read is settled. Only now are rows stamped
  // accessed, the head recorded in the anti-repetition ring and the debug
  // record composed — and only for lines whose memory is still in the text.
  // A bid delivers nothing: it is a plan, not a turn.
  const recallDelivery = character.id && recallText && options.purpose !== 'bid'
    ? await deliverRecall(recall, { characterId: character.id, chat, deliveredText: recallText })
    : null

  const memoryTokens = recall.tokens.recap + memories.semantic.tokens + memories.interCharacter.tokens
  const newUserMessageTokens = newUserMessage ? countMessageTokens({ role: 'user', content: newUserMessage }, provider) : 0

  return {
    messages: contextMessages,
    tokenUsage: {
      systemPrompt: systemBlocks.reduce((sum, block) => sum + countMessageTokens(block, provider), 0),
      memories: memoryTokens,
      knowledge: knowledge.tokens,
      recentMessages: history.tokens + newUserMessageTokens,
      total: countMessagesTokens(contextMessages, provider),
    },
    budget,
    memoriesIncluded: recall.memoriesIncluded + recall.interCharacterIncluded,
    messagesIncluded: history.messages.length + (newUserMessage ? 1 : 0),
    messagesTruncated: history.truncated,
    // Consumed by the finalizer once this turn persists an assistant message —
    // never here. Empty on a swipe: a swipe re-applies, it never consumes.
    informRowIds: inform.rowIds,
    mailAlertsOwed: mail.owed,
    warnings,
    debugMemories: recall.debugMemories,
    debugInterCharacterMemories: recall.debugInterCharacterMemories.length > 0 ? recall.debugInterCharacterMemories : undefined,
    debugKnowledge: knowledge.debug.length > 0 ? knowledge.debug : undefined,
    debugMemoryRecap: recall.sections.recap || undefined,
    debugRelevantConversations: perTurnConversations || undefined,
    recallDebugLog: recallDelivery?.debugLog,
    debugSummary: chat.contextSummary || undefined,
    debugSystemPrompt: compression.block ? `${systemPrompt.prompt}\n\n${compression.block}` : systemPrompt.prompt,
    originalSystemPrompt: systemPrompt.prompt,
    compressionApplied: compression.applied,
    compressionDetails: compression.result?.compressionDetails,
  }
}
