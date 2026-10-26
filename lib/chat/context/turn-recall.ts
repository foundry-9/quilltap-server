/**
 * Turn phase: what the responding character recalls.
 *
 * Two independent reads from one recent-window query:
 *
 * - **Memories** (`assembleTurnRecall`) — every memory pool of the turn from
 *   one query and one embedding (`lib/memory/recall/assemble.ts`). Assembly
 *   only reads; what reached the model is recorded by `deliverRecall` once the
 *   request body is settled.
 * - **Knowledge** (`retrieveTurnKnowledge`) — the character's vault, its
 *   groups' stores, the project's stores and Quilltap General. First-class
 *   canon: never fed to the memory compressor.
 */

import { assembleRecall, emptyRecallBundle, type PreRecall, type RecallBundle } from '@/lib/memory/recall/assemble'
import { stripToolArtifacts } from '@/lib/memory/cheap-llm-tasks'
import type { UncensoredFallbackOptions } from '@/lib/memory/cheap-llm-tasks'
import { getMemoryRecallSettings } from '@/lib/instance-settings'
import { getErrorMessage } from '@/lib/error-utils'
import { isInWhisperScope } from '@/lib/schemas/chat.types'
import { retrieveKnowledgeForTurn, type KnowledgeDebugEntry } from './knowledge-injector'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { TieredMountPool } from '@/lib/mount-index/tiered-mount-pool'
import type {
  Character,
  ChatEvent,
  ChatMetadataBase,
  ChatParticipantBase,
  MessageEvent,
  Provider,
} from '@/lib/schemas/types'

type HistoryRow = { role: string; content: string }

/** Max characters of recent-window prose used as the memory-search query. */
const RECENT_WINDOW_QUERY_MAX_CHARS = 600

/** How many history rows the fallback distillation reads. */
const DISTILL_WINDOW_ROWS = 12

/** Matches the conversation UUIDs a rendered conversation list prints in backticks. */
const CONVERSATION_UUID_PATTERN = /`([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`/gi

/** A history row's text as recall reads it: an assistant turn without its tool markup. */
function conversationText(m: HistoryRow): string {
  const content = m.content || ''
  return m.role.toLowerCase() === 'assistant' ? (stripToolArtifacts(content) ?? '') : content
}

/**
 * A sentence-shaped memory-search query from the recent conversation.
 *
 * Embedding a single one-line message ("ok, go on") produces a near-useless
 * query. Instead the last three user/assistant turns, plus the new message,
 * are joined as prose, so the query represents *what this moment is about*.
 * Cheap (no LLM); the most recent text is kept when truncating.
 */
export function buildRecentWindowQuery(existingMessages: ReadonlyArray<HistoryRow>, newUserMessage?: string): string {
  const parts: string[] = []
  for (let i = existingMessages.length - 1; i >= 0 && parts.length < 3; i--) {
    const m = existingMessages[i]
    const role = m.role.toLowerCase()
    if (role !== 'user' && role !== 'assistant') continue
    const trimmed = conversationText(m).trim()
    if (trimmed.length > 0) parts.unshift(trimmed)
  }
  if (newUserMessage && newUserMessage.trim().length > 0) parts.push(newUserMessage.trim())
  const joined = parts.join('\n')
  return joined.length > RECENT_WINDOW_QUERY_MAX_CHARS ? joined.slice(-RECENT_WINDOW_QUERY_MAX_CHARS) : joined
}

/**
 * Conversation UUIDs already listed in the standing fold-posted
 * `relevant-conversations` whisper for one recipient scope. That whisper
 * persists across turns and is exempt from the LLM-context strip, so anything
 * it names is already in front of the character; the turn-scoped conversation
 * lists (the per-turn list and the retrospective mini-recap) filter against it
 * rather than printing a UUID twice.
 *
 * Reads the newest such whisper only: the fold refresh sweeps a recipient's
 * prior ones as it posts a fresh one, so at most one stands.
 */
export function collectStandingConversationIds(
  events: ReadonlyArray<ChatEvent>,
  targetParticipantId: string | null,
): Set<string> {
  const ids = new Set<string>()
  for (let i = events.length - 1; i >= 0; i--) {
    const m = events[i]
    if (m.type !== 'message') continue
    const msg = m as MessageEvent
    if (msg.systemSender !== 'commonplaceBook' || msg.systemKind !== 'relevant-conversations') continue
    if (!isInWhisperScope(msg, targetParticipantId)) continue
    for (const uuid of (msg.content ?? '').matchAll(CONVERSATION_UUID_PATTERN)) ids.add(uuid[1])
    break
  }
  return ids
}

export interface TurnRecallInput {
  userId: string
  embeddingProfileId?: string
  provider: Provider
  character: Character
  chat: ChatMetadataBase
  existingMessages: ReadonlyArray<HistoryRow>
  newUserMessage?: string
  /** The recent-window query (`buildRecentWindowQuery`). */
  recentWindow: string
  memoryBudget: number
  minImportance: number
  skipMemories: boolean
  /** The cast, in a multi-character chat. */
  cast?: { allParticipants: ChatParticipantBase[]; participantCharacters: Map<string, Character> }
  /** Every character seated, whether or not the chat is multi-character. */
  participantCharacters?: Map<string, Character>
  currentStateTokens: number
  /** Context window for the recap's and the conversation lists' sizing. */
  maxContext?: number
  cheapLLMSelection?: CheapLLMSelection | null
  preRecall?: PreRecall | null
  generateMemoryRecap?: boolean
  uncensoredFallback?: UncensoredFallbackOptions
  /** The recipient scope's standing conversation UUIDs (read on demand). */
  standingConversationIds: () => Promise<Set<string>>
  onStatusChange?: (stage: string, message: string) => void
}

export async function assembleTurnRecall(input: TurnRecallInput): Promise<RecallBundle> {
  const { character, chat, existingMessages, newUserMessage, cheapLLMSelection } = input
  if (!character.id) {
    input.onStatusChange?.('assembling_context', 'Assembling context...')
    return emptyRecallBundle()
  }

  const present = new Map<string, string>([[character.id, character.name]])
  for (const [id, c] of input.participantCharacters ?? []) {
    if (id && !present.has(id)) present.set(id, c.name)
  }

  const interCharacterSubjects: Array<{ id: string; name: string }> = []
  for (const participant of input.cast?.allParticipants ?? []) {
    if (participant.type !== 'CHARACTER' || !participant.characterId || participant.characterId === character.id) continue
    const other = input.cast!.participantCharacters.get(participant.characterId)
    if (other) interCharacterSubjects.push({ id: other.id, name: other.name })
  }

  const recapRelevanceQuery =
    newUserMessage ||
    (existingMessages.length > 0 ? existingMessages[existingMessages.length - 1].content : '') ||
    chat.scenarioText ||
    chat.contextSummary ||
    ''

  return assembleRecall({
    userId: input.userId,
    embeddingProfileId: input.embeddingProfileId,
    provider: input.provider,
    character: { id: character.id, name: character.name },
    chat,
    memoryBudget: input.memoryBudget,
    minImportance: input.minImportance,
    skipMemories: input.skipMemories,
    present: [...present].map(([id, name]) => ({ id, name: name ?? '' })),
    interCharacterSubjects,
    currentStateTokens: input.currentStateTokens,
    recallSettings: await getMemoryRecallSettings(),
    recentWindow: input.recentWindow,
    // The fallback distillation, for when the proactive pass did not run
    // (first turn, continue mode, nothing to distil from).
    distill: cheapLLMSelection
      ? {
          messages: [
            ...existingMessages.slice(-DISTILL_WINDOW_ROWS)
              .map(m => ({ role: m.role.toLowerCase() as 'user' | 'assistant' | 'system', content: conversationText(m) }))
              .filter(m => m.content.length > 0),
            ...(newUserMessage ? [{ role: 'user' as const, content: newUserMessage }] : []),
          ],
          selection: cheapLLMSelection,
          clockIso: new Date().toISOString(),
        }
      : undefined,
    preRecall: input.preRecall,
    recap: input.generateMemoryRecap && cheapLLMSelection
      ? {
          selection: cheapLLMSelection,
          uncensoredFallback: input.uncensoredFallback,
          maxContext: input.maxContext,
          fallbackQuery: recapRelevanceQuery,
        }
      : null,
    conversations: {
      maxContext: input.maxContext ?? null,
      standingIds: input.standingConversationIds,
    },
    onStatusChange: input.onStatusChange,
  })
}

export interface TurnKnowledge {
  content: string
  tokens: number
  debug: KnowledgeDebugEntry[]
}

const NO_KNOWLEDGE: TurnKnowledge = { content: '', tokens: 0, debug: [] }

/**
 * Knowledge from every tier the responding character can reach. Each tier
 * no-ops when its mount is unavailable; a failure costs the section, never
 * the turn.
 */
export async function retrieveTurnKnowledge(input: {
  userId: string
  embeddingProfileId?: string
  provider: Provider
  character: Character
  query: string
  budgetTokens: number
  skip: boolean
  mountPool: () => Promise<TieredMountPool>
  warnings: string[]
}): Promise<TurnKnowledge> {
  const { character } = input
  if (input.skip || !character.id || !input.query || input.budgetTokens <= 0) return NO_KNOWLEDGE
  try {
    const { characterMountPointId, groupMountPointIds, projectMountPointIds, globalMountPointId } =
      await input.mountPool()
    if (!characterMountPointId && groupMountPointIds.length === 0 && projectMountPointIds.length === 0 && !globalMountPointId) {
      return NO_KNOWLEDGE
    }
    const result = await retrieveKnowledgeForTurn({
      characterId: character.id,
      userId: input.userId,
      embeddingProfileId: input.embeddingProfileId,
      query: input.query,
      characterMountPointId,
      groupMountPointIds,
      projectMountPointIds,
      globalMountPointId,
      budgetTokens: input.budgetTokens,
      provider: input.provider,
    })
    return { content: result.content, tokens: result.tokenCount, debug: result.debug }
  } catch (error) {
    input.warnings.push(`Failed to retrieve knowledge: ${getErrorMessage(error)}`)
    return NO_KNOWLEDGE
  }
}
