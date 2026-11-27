/**
 * Usage accounting — the one place a provider call's tokens are counted.
 *
 * Every LLM call is recorded through `logLLMCall`
 * (`lib/services/llm-logging.service.ts`): `streamMessage` for the Salon,
 * consoles, help chat, Carina and the agent loops, the cheap-LLM executor for
 * background work, and the few services that call a provider directly.
 * `logLLMCall` hands each call here *before* it checks whether LLM logging is
 * on, so the counters stay whole when logging is off or its rows have expired.
 *
 * One call becomes:
 * - **the profile's ledger** — `ConnectionProfilesRepository.incrementUsage`,
 *   chat or automatic by `usageCategoryOf(type)`, one call and its tokens;
 * - **the chat's totals** (when the call was made for a chat) —
 *   `ChatsRepository.addCallUsage`, then, after the pricing lookup,
 *   `addEstimatedCost`, priced with cache reads and writes at their own rates
 *   (`estimateCallCost`).
 *
 * Nothing else writes those columns. A call site that counted its own usage
 * used to see only the last request of a tool loop, skip swipes, and leave
 * every background task out of the profile.
 *
 * @module lib/services/usage-accounting
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { usageCategoryOf, type LLMLogType } from '@/lib/schemas/llm-log.types'
import { tallyTokens, type UsageTally } from '@/lib/llm/profile-usage'
import { estimateCallCost } from './cost-estimation.service'

const logger = createServiceLogger('usage-accounting')

/** What a call carries that accounting needs. */
export interface AccountableCall {
  userId: string
  type: LLMLogType
  chatId?: string | null
  connectionProfileId?: string | null
  provider: string
  modelName: string
  /**
   * As a provider plugin reports it: `promptTokens` is every input token
   * except cache reads (so it includes cache writes).
   */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
  cacheUsage?: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null
}

const count = (value: number | undefined | null): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0

/**
 * One call as a tally. Pure. Splits the plugin's `promptTokens` (input
 * except cache reads) into uncached input and cache writes, so the four
 * token figures never overlap and add up to every token the call moved.
 */
export function tallyOfCall(call: Pick<AccountableCall, 'usage' | 'cacheUsage'>): UsageTally {
  const reportedPrompt = count(call.usage?.promptTokens)
  const cacheWriteTokens = Math.min(count(call.cacheUsage?.cacheCreationInputTokens), reportedPrompt)
  return {
    calls: 1,
    promptTokens: reportedPrompt - cacheWriteTokens,
    completionTokens: count(call.usage?.completionTokens),
    cacheReadTokens: count(call.cacheUsage?.cacheReadInputTokens),
    cacheWriteTokens,
  }
}

/**
 * Count one provider call against its profile and its chat. Never throws:
 * accounting is a side ledger, and a failure here must not fail the call.
 *
 * The token writes go first, before any await on pricing: in the job child a
 * write issued after the job's batch has shipped is lost, and only the cost
 * should ever be at the mercy of a slow price lookup.
 */
export async function accountLLMCall(call: AccountableCall): Promise<void> {
  const tally = tallyOfCall(call)
  const category = usageCategoryOf(call.type)
  const tokens = tallyTokens(tally)

  try {
    const { getRepositories } = await import('@/lib/repositories/factory')
    const repos = getRepositories()

    const writes: Array<Promise<void>> = []
    if (call.connectionProfileId) {
      writes.push(repos.connections.incrementUsage(call.connectionProfileId, category, tally))
    }
    if (call.chatId && tokens > 0) {
      writes.push(repos.chats.addCallUsage(call.chatId, tally))
    }
    await Promise.all(writes)

    logger.debug('Accounted LLM call', {
      type: call.type,
      category,
      connectionProfileId: call.connectionProfileId ?? null,
      chatId: call.chatId ?? null,
      ...tally,
    })

    if (!call.chatId || tokens === 0) return

    const cost = await estimateCallCost(
      call.provider,
      call.modelName,
      {
        promptTokens: tally.promptTokens,
        completionTokens: tally.completionTokens,
        cacheReadTokens: tally.cacheReadTokens,
        cacheWriteTokens: tally.cacheWriteTokens,
      },
      call.userId
    )
    if (cost.cost !== null && cost.cost > 0) {
      await repos.chats.addEstimatedCost(call.chatId, cost.cost, cost.source)
    } else {
      logger.debug('No price for call; chat cost left unchanged', {
        chatId: call.chatId,
        provider: call.provider,
        modelName: call.modelName,
        source: cost.source,
      })
    }
  } catch (error) {
    logger.error('Failed to account LLM call', {
      type: call.type,
      connectionProfileId: call.connectionProfileId ?? null,
      chatId: call.chatId ?? null,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
