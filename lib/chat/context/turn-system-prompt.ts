/**
 * Turn phase: system block 1.
 *
 * Gathers what the synchronous `buildSystemPrompt` cannot fetch for itself —
 * the precompiled identity stack, the fallback's subprompts, the instance-wide
 * Taboo phrases, the standing instructions — builds the prompt, and holds it to
 * its budget. Nothing turn-variable may enter here: this block is the
 * cacheable prefix (PROMPT_ARCHITECTURE.md §1, §5). Off-scene character cards
 * used to be spliced in and broke that prefix whenever a new name was dropped;
 * they ride the referent ledger on the uncached tail now.
 */

import { getTabooSettings } from '@/lib/instance-settings'
import { getCompiledIdentityStack } from '@/lib/services/system-prompt-compiler/compiler'
import { resolveSelectedSubprompts } from '@/lib/subprompts/subprompts'
import { estimateTokens, truncateToTokenLimit } from '@/lib/tokens/token-counter'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import { resolveStandingInstructionsSection } from './standing-instructions'
import { buildOtherParticipantsInfo, buildSystemPrompt } from './system-prompt-builder'
import type {
  Character,
  ChatMetadataBase,
  ChatParticipantBase,
  Provider,
  TimestampConfig,
} from '@/lib/schemas/types'

export interface TurnSystemPromptInput {
  provider: Provider
  character: Character
  userCharacter?: { name: string; description: string } | null
  chat: ChatMetadataBase
  respondingParticipant?: ChatParticipantBase
  roleplayTemplate?: { systemPrompt: string } | null
  toolInstructions?: string
  timestampConfig?: TimestampConfig | null
  isInitialMessage?: boolean
  timezone?: string
  /** `ContextBudget.systemPromptBudget`; an over-long prompt is truncated to it. */
  budgetTokens: number
  /** Present only in a multi-character chat; names the cast for the identity log. */
  cast?: { allParticipants: ChatParticipantBase[]; participantCharacters: Map<string, Character> }
  warnings: string[]
}

export interface TurnSystemPrompt {
  prompt: string
  tokens: number
}

export async function buildTurnSystemPrompt(input: TurnSystemPromptInput): Promise<TurnSystemPrompt> {
  const { provider, character, chat, respondingParticipant } = input

  // Phase H: prefer the precompiled identity stack from
  // chats.compiledIdentityStacks. `buildSystemPrompt` falls back to a fresh
  // build when it is missing or empty (legacy chats / a miss after an edit).
  const precompiledIdentityStack = respondingParticipant
    ? getCompiledIdentityStack(chat, respondingParticipant.id)
    : null

  // Subprompts only matter on the read-through fallback — a precompiled stack
  // already carries them. Fails soft to none.
  const subprompts = precompiledIdentityStack
    ? null
    : await resolveSelectedSubprompts(character.id, respondingParticipant?.selectedSubpromptIds ?? [])

  // The standing-instructions resolver fails soft internally (never throws):
  // the section is guidance, not payload.
  const [tabooPhrases, standingInstructions] = await Promise.all([
    readTabooPhrases(chat.id),
    resolveStandingInstructionsSection({ projectId: chat.projectId ?? null, characterId: character.id }),
  ])

  const built = buildSystemPrompt({
    character,
    userCharacter: input.userCharacter,
    roleplayTemplate: input.roleplayTemplate,
    toolInstructions: input.toolInstructions,
    selectedSystemPromptId: respondingParticipant?.selectedSystemPromptId,
    timestampConfig: input.timestampConfig,
    isInitialMessage: input.isInitialMessage,
    timezone: input.timezone,
    scenarioText: chat.scenarioText ?? undefined,
    precompiledIdentityStack,
    tabooPhrases,
    standingInstructions,
    subprompts,
  })

  if (input.cast && respondingParticipant) {
    logger.info('[ContextManager] Multi-character context built', {
      respondingCharacterName: character.name,
      respondingParticipantId: respondingParticipant.id,
      otherParticipantNames: buildOtherParticipantsInfo(
        respondingParticipant.id,
        input.cast.allParticipants,
        input.cast.participantCharacters,
      ).map(p => p.name),
      systemPromptContainsIdentity: built.includes(`You are ${character.name}`),
    })
  }

  const builtTokens = estimateTokens(built, provider)
  if (builtTokens <= input.budgetTokens) return { prompt: built, tokens: builtTokens }

  input.warnings.push(`System prompt (${builtTokens} tokens) exceeds budget (${input.budgetTokens}). Truncating.`)
  const prompt = truncateToTokenLimit(built, input.budgetTokens, provider)
  return { prompt, tokens: estimateTokens(prompt, provider) }
}

/**
 * The instance-wide Taboo list. A failed read is never worth the turn — the
 * section is style guidance — so it degrades to no phrases.
 */
async function readTabooPhrases(chatId: string): Promise<string[]> {
  try {
    const { phrases } = await getTabooSettings()
    if (phrases.length > 0) {
      logger.debug('[ContextManager] Taboo phrases applied to system prompt', { chatId, phraseCount: phrases.length })
    }
    return phrases
  } catch (error) {
    logger.warn('[ContextManager] Failed to read Taboo settings — continuing without them', {
      chatId,
      error: getErrorMessage(error),
    })
    return []
  }
}
