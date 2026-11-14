/**
 * One-shot Brahma Console engine.
 *
 * Runs a single, ISOLATED Brahma Console query and returns the final answer text
 * — no persistence, no SSE, no chat history. This is what backs the Brahma
 * pseudocharacter when it is consulted as a Carina answerer from inside a Salon
 * (see `lib/services/carina/brahma-answerer.ts`).
 *
 * It mirrors `processBrahmaResponse` (the streaming, persisting console
 * orchestrator) but deliberately diverges on three points:
 *
 *  - **No chat history.** The conversation slate is exactly
 *    `[system, user(question)]`. Loading the surrounding Salon transcript would
 *    leak every other participant's content into Brahma and break Carina's
 *    isolation contract.
 *  - **No persistence.** Tool calls are executed (their own side effects stand),
 *    but the per-iteration assistant / TOOL messages are never written to the
 *    Salon, no tokens are tracked, and no done/error SSE events are emitted. The
 *    answer is accumulated in memory and returned.
 *  - **Operator surface.** Tools run with `operatorSurface: true`, unlocking
 *    `run_sql` and all-store document access — exactly as the standalone
 *    console. The caller (`runCarinaQuery`) gates reachability to the operator,
 *    user-controlled personas, and `systemTransparency` characters BEFORE
 *    calling here, because Brahma answers run at full operator privilege.
 *    The asking turn's effect ceiling travels with the query
 *    (`RunBrahmaQueryOptions.effectCeiling`): the tool list and every call run
 *    under it, and the Carina caller refuses Brahma outright below `write`.
 *
 * `processBrahmaResponse` is NOT refactored into a shared core: it was recently
 * stabilised and the divergences above are exactly the parts that make sharing
 * awkward. The in-memory agent loop itself lives in `runOneShotToolLoop`
 * (`lib/services/agent-loop/one-shot-loop.ts`), shared with the Scenario
 * Builder; this module supplies the Brahma profile, slate, prompt and scope.
 */

import { inventoryToolFlags } from '@/lib/tools/inventory-tool-flags'
import { newWardrobeTurnContainers } from '@/lib/wardrobe/turn-containers'
import { createServiceLogger } from '@/lib/logging/create-logger'
import { describeProfileApiKeyFailure, resolveConnectionProfileApiKey } from '@/lib/services/api-key.service'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import { buildTools } from '@/lib/services/chat-message/streaming.service'
import {
  buildOneShotToolInstructions,
  runOneShotToolLoop,
} from '@/lib/services/agent-loop/one-shot-loop'
import { buildBrahmaSystemPrompt } from '@/lib/brahma-console/system-prompt-builder'
import { resolveInlineBrahmaConnectionProfile } from './inline-profile'
import { resolveBrahmaMaxAgentTurns } from './turn-budget'
import type { ToolEffect } from '@/lib/tools/effects'

const logger = createServiceLogger('BrahmaOneShot')

export interface RunBrahmaQueryOptions {
  repos: ReturnType<typeof getRepositories>
  userId: string
  /** The Salon chat the answer will be posted into (tool scope / logging only). */
  chatId: string
  /** The standalone question to put to the console. */
  question: string
  /**
   * The asking turn's effect ceiling. The console's tool list and every call it
   * makes run under it; unset = no ceiling. (The Carina caller refuses Brahma
   * outright below `write`.)
   */
  effectCeiling?: ToolEffect
}

export type BrahmaQueryResult =
  | { ok: true; answer: string }
  | { ok: false; detail: string }

/**
 * Run an isolated Brahma Console query and return the final answer text.
 * Returns `{ ok: false, detail }` (never throws) so the Carina caller can route
 * the failure through Prospero — `detail: 'no-profile'` maps to the no-profile
 * error; anything else is an llm-failed detail string.
 */
export async function runBrahmaQuery(opts: RunBrahmaQueryOptions): Promise<BrahmaQueryResult> {
  const { repos, userId, chatId, question, effectCeiling } = opts

  // Profile (model): project override → global inline setting → the user's
  // default. The standalone Console's per-chat picker does not apply here.
  const connectionProfile = await resolveInlineBrahmaConnectionProfile(repos, userId, chatId)
  if (!connectionProfile) {
    logger.debug('No connection profile resolvable for Brahma query', { chatId })
    return { ok: false, detail: 'no-profile' }
  }

  const keyResolution = await resolveConnectionProfileApiKey(repos, connectionProfile)
  if (!keyResolution.ok) {
    return { ok: false, detail: describeProfileApiKeyFailure(keyResolution.reason) }
  }
  const apiKey = keyResolution.apiKey

  // Tools — identical to the standalone console: agent mode, doc read/write, the
  // read-only run_sql tool, search-without-memories; NO ask_carina (recursion
  // guard), NO workspace tools.
  const built = await buildTools({
    connectionProfile,
    userId,
    agentModeEnabled: true,
    canDressThemselves: false,
    canCreateOutfits: false,
    canManageInventory: false, // no inventory_* tools here
    docToolsMode: 'full',
    askCarinaEnabled: false, // recursion guard
    includeWorkspaceTools: false, // stripped for the console
    excludeMemorySearch: true, // no memory source
    sqlAccess: true, // read-only run_sql
    effectCeiling, // the asking turn's ceiling travels with the query
  })

  // Operator-set turn budget (Settings → Chat → Brahma Console); shared with the
  // standalone console. The loop's stuck-loop guard is independent of it.
  const maxAgentTurns = await resolveBrahmaMaxAgentTurns()
  const toolInstructions = buildOneShotToolInstructions({
    connectionProfile,
    built,
    maxAgentTurns,
    textBlockOptions: {
      imageGeneration: false,
      search: true,
      webSearch: !!connectionProfile.allowWebSearch,
      whisper: false,
      state: false,
      rng: false,
      projectInfo: false,
      helpSearch: false,
      helpSettings: false,
      helpNavigate: false,
      createNote: false,
      wardrobeList: false,
      wardrobeRead: false,
      wardrobeWear: false,
      wardrobeTakeOff: false,
      wardrobeRollback: false,
      wardrobeHistory: false,
      wardrobeCreate: false,
      wardrobeUpdate: false,
      wardrobeArchive: false,
      ...inventoryToolFlags(false),
    },
  })

  const systemPrompt = buildBrahmaSystemPrompt({
    profile: connectionProfile,
    toolInstructions,
    includeSqlAccess: true,
  })

  // Operator surface (character-less, all-stores). Tool side effects (SQL reads,
  // doc writes) stand; the result MESSAGES are threaded in-memory only and
  // never persisted to the Salon.
  const toolContext: ToolExecutionContext = {
    chatId,
    userId,
    operatorSurface: true,
    toolOffer: built.offer,
    customToolEffects: built.customToolEffects,
    pluginToolEffects: built.pluginToolEffects,
    ...(effectCeiling ? { effectCeiling } : {}),
    ...newWardrobeTurnContainers(),
  }
  logger.debug('Brahma one-shot tool context built', { chatId, effectCeiling: effectCeiling ?? null })

  // ISOLATION: the loop's slate is system + the single question only — never
  // the Salon transcript. No controller: nothing is surfaced live.
  const result = await runOneShotToolLoop({
    repos,
    userId,
    chatId,
    connectionProfile,
    apiKey,
    systemPrompt,
    userMessage: question,
    tools: built,
    toolContext,
    maxAgentTurns,
    statusContext: { characterName: 'Brahma Console', characterId: '' },
    logLabel: 'Brahma one-shot',
  })

  return result.ok ? { ok: true, answer: result.answer } : { ok: false, detail: result.detail }
}
