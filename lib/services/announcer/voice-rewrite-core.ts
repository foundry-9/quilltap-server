/**
 * Shared core for the two "say it in the character's own voice" rehearsals.
 *
 * Both rehearsals hand a character a draft the operator typed and ask for it
 * back in the character's own voice. They differ only in framing:
 *
 *   - `character-voiced.ts` is OFF-SCENE: the character stands outside the
 *     conversation and speaks in to the people in it (Insert Announcement).
 *   - `in-scene-voiced.ts` is IN-SCENE: the character is in the room, has been
 *     following along, and it is now their turn to say the drafted line
 *     (the impersonated-seat rewrite).
 *
 * What the two share — the Commonplace recall against the draft, the
 * `executeCheapLLMTask` call, and the never-throws result shape — lives here so
 * the two framings cannot drift apart in everything except their wording.
 *
 * Nothing in this module persists anything.
 */

import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import type { Character, ConnectionProfile } from '@/lib/schemas/types'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { LLMMessage } from '@/lib/llm/base'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { searchMemories } from '@/lib/memory/recall/search'
import { stampAccessed } from '@/lib/memory/recall/deliver'
import { renderHead } from '@/lib/memory/recall/render'
import { buildMemorySubjectContext } from '@/lib/memory/recall/subject'
import { buildCommonplaceLLMContext } from '@/lib/services/commonplace-notifications/writer'
import { RECALL_MIN_IMPORTANCE } from '@/lib/memory/scoring'

/** Upper bound on how many memories the recall considers. */
const RECALL_LIMIT = 20
/** How many recalled memories survive into the rendered block. */
const RECALL_MAX_ENTRIES = 12
/** Token cap on the rendered block (the head's historical default). */
const RECALL_HEAD_TOKEN_BUDGET = 200

/** The shape both rehearsals return. Never throws; failure is a field. */
export interface VoiceRewriteResult {
  success: boolean
  proposedMarkdown: string
  error?: string
}

/** "Alice", "Alice and Bob", "Alice, Bob, and Carol". */
export function formatNameList(names: string[]): string {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

/**
 * Commonplace Book recall against the operator's draft, rendered as the block
 * that leads the user-role message.
 *
 * A recall failure is logged and tolerated — it is context, not payload, and a
 * dead embedding provider must not cost the operator their rehearsal. Returns
 * an empty string when there is nothing to say.
 */
export async function recallForSeed(
  character: Character,
  seedMarkdown: string,
  profile: ConnectionProfile,
  userId: string,
  chatId: string,
  logContext: string,
): Promise<string> {
  try {
    const memoryResults = await searchMemories(character.id, seedMarkdown, {
      userId,
      limit: RECALL_LIMIT,
      minImportance: RECALL_MIN_IMPORTANCE,
    })

    if (memoryResults.length === 0) return ''

    // The recall spans the character's whole store, so it carries their
    // memories about other people too; attribute them or the rewrite reads
    // someone else's life as its own (bug 122).
    const subject = await buildMemorySubjectContext(
      character.id,
      memoryResults.map(r => r.memory),
    )
    const formatted = renderHead(memoryResults, profile.provider, subject, {
      maxTokens: RECALL_HEAD_TOKEN_BUDGET,
      maxEntries: RECALL_MAX_ENTRIES,
    })
    if (!formatted.content) return ''
    // The rehearsal carries the block whole: every rendered line is delivered.
    stampAccessed(character.id, formatted.lines.map(l => l.memoryId))
    return buildCommonplaceLLMContext({ relevant: formatted.content })
  } catch (err) {
    logger.warn(`${logContext} Memory recall failed; proceeding without`, {
      chatId,
      characterId: character.id,
      error: getErrorMessage(err),
    })
    return ''
  }
}

export interface ExecuteVoiceRewriteParams {
  selection: CheapLLMSelection
  messages: LLMMessage[]
  userId: string
  taskType: string
  chatId: string
  characterId: string
  maxTokens: number
}

/**
 * Run the rewrite and normalise the outcome. An empty or failed completion is
 * reported as `success: false` with the provider's own message, which is what
 * both dialogs surface to the operator.
 */
export async function executeVoiceRewrite(
  params: ExecuteVoiceRewriteParams,
): Promise<VoiceRewriteResult> {
  const { selection, messages, userId, taskType, chatId, characterId, maxTokens } = params

  const llmResult = await executeCheapLLMTask<string>(
    selection,
    messages,
    userId,
    (content: string) => content.trim(),
    taskType,
    chatId,
    undefined,
    undefined,
    maxTokens,
    characterId,
  )

  if (!llmResult.success || !llmResult.result) {
    return {
      success: false,
      proposedMarkdown: '',
      error: llmResult.error || 'The LLM returned no content.',
    }
  }

  return {
    success: true,
    proposedMarkdown: llmResult.result,
  }
}
