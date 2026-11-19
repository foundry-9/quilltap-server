/**
 * Wardrobe design from instructions — Aurora designs pieces and an outfit
 * from the operator's written brief.
 *
 * One run is one request → tool loop → one proposal. Stateless on the server:
 * no chat row, no messages, and nothing written to a wardrobe — the wizard
 * shows the proposal for review, and the operator imports it through the
 * ordinary creates. The only durable trace is the LLM log rows
 * `streamMessage` writes, typed `WARDROBE_INSTRUCTION_DESIGN`. No picture is
 * drafted or fetched.
 *
 * The run executes in the parent process inside the API route, streamed over
 * SSE (the Scenario Builder's pattern) — never a background job.
 *
 * Aurora's reach, each part only when asked for and available:
 *  - the stores and records: the operator surface (every document store, the
 *    lookup shortcuts and read-only `run_sql`), without memories;
 *  - the web: `search_web` (the profile allows it and a provider is
 *    configured) and `curl` (the plugin has URL patterns).
 * Everything runs under an effect ceiling of `read`, on the slate and in the
 * executor, so nothing can be written whatever the model asks for — `curl`
 * included, whose GETs read and whose other methods are refused.
 *
 * @module services/wardrobe-design/wardrobe-design.service
 */

import { randomUUID } from 'crypto'
import { inventoryToolFlags } from '@/lib/tools/inventory-tool-flags'
import { createServiceLogger } from '@/lib/logging/create-logger'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import type { ConnectionProfile } from '@/lib/schemas/types'
import {
  buildTools,
  encodeErrorEvent,
  encodeReasoningChunk,
} from '@/lib/services/chat-message/streaming.service'
import type { StreamController } from '@/lib/services/chat-message/tool-execution.service'
import {
  buildOneShotToolInstructions,
  runOneShotToolLoop,
} from '@/lib/services/agent-loop/one-shot-loop'
import { newWardrobeTurnContainers } from '@/lib/wardrobe/turn-containers'
import { legacyFrameEncoder } from '@/lib/chat/stream-frames'
import { BRAHMA_SQL_PROMPT } from '@/lib/brahma-console/brahma-sql-prompt'
import { resolveWebCapabilities } from '@/lib/tools/web-capabilities'
import type { WardrobeLocation } from '@/lib/wardrobe/location'
import { buildWardrobeDesignBrief } from '@/lib/wardrobe/instruction-design/brief'
import {
  buildWardrobeDesignSystemPrompt,
  buildWardrobeDesignUserMessage,
  type WardrobeDesignReach,
} from '@/lib/wardrobe/instruction-design/prompt'
import {
  WARDROBE_DESIGN_MAX_ITEMS,
  type WardrobeDesignResult,
} from '@/lib/wardrobe/instruction-design/request-schema'
import { parseWardrobeProposal } from '@/lib/wardrobe/proposal/parse'
import type { WardrobeProposal } from '@/lib/wardrobe/proposal/types'

const logger = createServiceLogger('WardrobeDesign')

/** Turn budget for one design run. */
export const WARDROBE_DESIGN_MAX_AGENT_TURNS = 20

export interface WardrobeDesignInput {
  instructions: string
  searchStores: boolean
  searchWeb: boolean
  priorProposal?: WardrobeProposal | null
  revision?: string | null
}

export interface RunWardrobeDesignOptions {
  repos: ReturnType<typeof getRepositories>
  userId: string
  connectionProfile: ConnectionProfile
  apiKey: string
  /** The target wardrobe, resolved (and checked against the archive tombstone) by the route. */
  location: WardrobeLocation
  input: WardrobeDesignInput
}

/**
 * What a run on this profile can reach, given what the operator asked for.
 * Shared with the route, which refuses a no-tools profile only when one of
 * these would actually build a tool.
 */
export async function resolveWardrobeDesignReach(
  repos: RunWardrobeDesignOptions['repos'],
  userId: string,
  profile: Pick<ConnectionProfile, 'allowWebSearch'>,
  asked: { searchStores: boolean; searchWeb: boolean },
): Promise<WardrobeDesignReach> {
  const capabilities = asked.searchWeb
    ? await resolveWebCapabilities(repos, userId)
    : { webSearchConfigured: false, curlConfigured: false }
  const webSearch = asked.searchWeb && !!profile.allowWebSearch && capabilities.webSearchConfigured
  const webFetch = asked.searchWeb && capabilities.curlConfigured
  return {
    stores: asked.searchStores,
    webSearch,
    webFetch,
    webWantedButUnavailable: asked.searchWeb && !webSearch && !webFetch,
  }
}

/** True when the reach builds any tool beyond `submit_final_response`. */
export const wardrobeDesignUsesTools = (reach: WardrobeDesignReach): boolean =>
  reach.stores || reach.webSearch || reach.webFetch

/**
 * Run the design, streaming tool events to `controller` and ending with a
 * `done` event carrying the proposal, or an `error` event in Aurora's plain
 * voice. Never throws; an abort ends quietly (the client is gone).
 */
export async function runWardrobeInstructionDesign(
  opts: RunWardrobeDesignOptions,
  controller: StreamController,
  signal?: AbortSignal,
): Promise<void> {
  const { repos, userId, connectionProfile, apiKey, location, input } = opts
  // This route's client reads the untagged-bag SSE shape, as the Scenario Builder's does.
  const encoder = legacyFrameEncoder()
  // Tools need a chat id only for scoping; nothing reads or writes a chat row with it.
  const chatId = randomUUID()

  try {
    const [reach, brief] = await Promise.all([
      resolveWardrobeDesignReach(repos, userId, connectionProfile, input),
      buildWardrobeDesignBrief(repos, location),
    ])
    const anyTools = wardrobeDesignUsesTools(reach)

    logger.debug('Wardrobe design starting', {
      chatId,
      searchStores: input.searchStores,
      searchWeb: input.searchWeb,
      reach,
      targetScope: location.scope,
      briefParts: brief.parts,
      reusable: brief.reusable.length,
      revising: input.revision != null,
      profileId: connectionProfile.id,
      provider: connectionProfile.provider,
      model: connectionProfile.modelName,
      maxAgentTurns: WARDROBE_DESIGN_MAX_AGENT_TURNS,
    })

    // Nothing to look at: only submit_final_response. Otherwise a read-only
    // slate with exactly the parts asked for — never a wardrobe or inventory
    // tool (the brief is how Aurora sees the rail, and she must not write to it).
    const built = await buildTools(
      anyTools
        ? {
            connectionProfile,
            userId,
            agentModeEnabled: true,
            canDressThemselves: false,
            canCreateOutfits: false,
            canManageInventory: false,
            docToolsMode: reach.stores ? 'read' : 'off',
            storeSearch: reach.stores,
            askCarinaEnabled: false,
            includeWorkspaceTools: false,
            excludeMemorySearch: true,
            sqlAccess: reach.stores,
            webSearch: reach.webSearch,
            pluginToolAllowlist: reach.webFetch ? ['curl'] : [],
            effectCeiling: 'read',
          }
        : { connectionProfile, userId, agentModeEnabled: true, onlyTools: [] },
    )

    const toolInstructions = buildOneShotToolInstructions({
      connectionProfile,
      built,
      maxAgentTurns: WARDROBE_DESIGN_MAX_AGENT_TURNS,
      textBlockOptions: {
        imageGeneration: false,
        search: reach.stores,
        webSearch: reach.webSearch,
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

    // A revision shows Aurora the design as edited; reused pieces go back to
    // numbers against this run's brief, and any that have since left the rail drop out.
    const prior = input.priorProposal
    const priorReuse = prior
      ? prior.reuseItemIds
          .map((id) => brief.reusable.findIndex((item) => item.id === id) + 1)
          .filter((n) => n > 0)
      : []
    if (prior && priorReuse.length < prior.reuseItemIds.length) {
      logger.warn('Some reused pieces of the prior proposal are no longer on the rail; dropped', {
        chatId,
        asked: prior.reuseItemIds.length,
        kept: priorReuse.length,
      })
    }

    const systemPrompt = buildWardrobeDesignSystemPrompt({
      reach,
      sqlPrompt: BRAHMA_SQL_PROMPT,
      toolInstructions,
    })
    const userMessage = buildWardrobeDesignUserMessage({
      instructions: input.instructions,
      brief: brief.text,
      priorProposal: prior ? { items: prior.items, outfit: prior.outfit, reuse: priorReuse } : null,
      revision: input.revision ?? null,
    })

    const toolContext: ToolExecutionContext = {
      chatId,
      userId,
      // Operator surface only when the stores are open; the executor admits
      // only the slate built above, and nothing above `read`. Never a mount
      // pool: the executor refuses a context carrying both.
      ...(reach.stores ? { operatorSurface: true } : {}),
      toolOffer: built.offer,
      customToolEffects: built.customToolEffects,
      pluginToolEffects: built.pluginToolEffects,
      effectCeiling: 'read',
      ...newWardrobeTurnContainers(),
    }

    const result = await runOneShotToolLoop({
      repos,
      userId,
      chatId,
      connectionProfile,
      apiKey,
      systemPrompt,
      userMessage,
      tools: built,
      toolContext,
      maxAgentTurns: WARDROBE_DESIGN_MAX_AGENT_TURNS,
      controller,
      signal,
      logType: 'WARDROBE_INSTRUCTION_DESIGN',
      statusContext: { characterName: 'Aurora', characterId: '' },
      onReasoning: (reasoning) => controller.enqueue(encodeReasoningChunk(encoder, reasoning)),
      logLabel: 'Wardrobe design',
    })

    if (!result.ok) {
      if (result.detail === 'aborted') {
        logger.debug('Wardrobe design aborted by the client', { chatId })
        return
      }
      logger.debug('Wardrobe design ended without an answer', { chatId, detail: result.detail })
      controller.enqueue(
        encodeErrorEvent(
          encoder,
          'Aurora came back without a design. Try again, or choose another model.',
          'wardrobe_design_failed',
          result.detail,
        ),
      )
      return
    }

    let parsed: ReturnType<typeof parseWardrobeProposal>
    try {
      parsed = parseWardrobeProposal(result.answer, {
        reuseCount: brief.reusable.length,
        maxItems: WARDROBE_DESIGN_MAX_ITEMS,
      })
    } catch (error) {
      logger.warn('Wardrobe design answer could not be read as a proposal', {
        chatId,
        answerLength: result.answer.length,
        error: error instanceof Error ? error.message : String(error),
      })
      controller.enqueue(
        encodeErrorEvent(
          encoder,
          "Aurora's design came back in a shape that could not be read. Try again, or choose another model.",
          'wardrobe_design_unreadable',
          error instanceof Error ? error.message : String(error),
        ),
      )
      return
    }

    if (parsed.proposedItems.length === 0) {
      logger.debug('Wardrobe design proposed no pieces', { chatId, toolsExecuted: result.toolsExecuted })
      controller.enqueue(
        encodeErrorEvent(
          encoder,
          'Aurora came back empty-handed. Try again, give her more to go on, or choose another model.',
          'wardrobe_design_empty',
          'no pieces proposed',
        ),
      )
      return
    }

    const proposal: WardrobeDesignResult = {
      items: parsed.proposedItems,
      outfit: parsed.proposedOutfit,
      reuse: parsed.reuse.map((n) => {
        const item = brief.reusable[n - 1]
        return { id: item.id, title: item.title, types: item.types }
      }),
      notes: parsed.notes,
    }

    logger.debug('Wardrobe design complete', {
      chatId,
      itemCount: proposal.items.length,
      reuseCount: proposal.reuse.length,
      hasOutfit: proposal.outfit !== null,
      hasNotes: proposal.notes.length > 0,
      toolsExecuted: result.toolsExecuted,
      usage: result.usage,
    })
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({
          done: true,
          proposal,
          provider: connectionProfile.provider,
          modelName: connectionProfile.modelName,
          usage: result.usage,
          toolsExecuted: result.toolsExecuted,
          reach,
        })}\n\n`,
      ),
    )
  } catch (error) {
    if (signal?.aborted) {
      logger.debug('Wardrobe design aborted by the client (during a throw)', { chatId })
      return
    }
    const detail = error instanceof Error ? error.message : String(error)
    logger.error('Wardrobe design failed', { chatId, error: detail })
    controller.enqueue(
      encodeErrorEvent(
        encoder,
        'The model would not answer, so there is no design. Try again, or choose another model.',
        'wardrobe_design_failed',
        detail,
      ),
    )
  }
}
