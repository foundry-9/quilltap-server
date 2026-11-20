/**
 * Scenario Builder — The Host researches and drafts a starting scene.
 *
 * One builder run is one request → tool loop → one scene. Stateless on the
 * server: no chat row, no messages, no participant. The only durable trace is
 * the LLM log rows `streamMessage` writes, typed `SCENARIO_BUILDER`.
 *
 * The run executes in the parent process inside the API route, streamed over
 * SSE (the Brahma pattern) — never a background job.
 *
 * Tool scope is "what this chat could see": a pre-built mount pool from
 * `resolveScenarioBuilderMountPool` (cast vaults, their groups' stores, the
 * project's stores, Quilltap General), never `operatorSurface`.
 *
 * Design of record: docs/developer/features/complete/scenario-builder.md
 *
 * @module services/scenario-builder/scenario-builder.service
 */

import { buildScenarioBrief } from '@/lib/research/brief'
import { randomUUID } from 'crypto'
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
import { isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler'
import { resolveWebCapabilities, type WebCapabilities } from '@/lib/tools/web-capabilities'
import { resolveScenarioBuilderMountPool } from '@/lib/scenario-builder/mount-pool'
import {
  buildScenarioBuilderSystemPrompt,
  buildScenarioBuilderUserMessage,
  type ScenarioBuilderMode,
} from '@/lib/scenario-builder/system-prompt'
import { legacyFrameEncoder } from '@/lib/chat/stream-frames'
import { researchOnlyTextBlockToolOptions } from '@/lib/services/chat-message/text-block-tool-options'

const logger = createServiceLogger('ScenarioBuilder')

/** Turn budget for one builder run. A constant in v1 (see the spec's Deferred list). */
export const SCENARIO_BUILDER_MAX_AGENT_TURNS = 25

export interface ScenarioBuilderInput {
  mode: ScenarioBuilderMode
  location: string
  time: string
  details: string
  projectId?: string | null
  /** Cast ids already vetted by the caller (readable by this user). */
  characterIds: string[]
  /** Groups named outright, already vetted by the caller (the group's Scenarios card). */
  groupIds?: string[]
  /** In-chat: the chat whose scene is being replaced (already ownership-checked). */
  chat?: { id: string; scenarioText?: string | null; contextSummary?: string | null } | null
  priorDraft?: string | null
  revision?: string | null
}

export interface RunScenarioBuilderOptions {
  repos: ReturnType<typeof getRepositories>
  userId: string
  connectionProfile: ConnectionProfile
  apiKey: string
  input: ScenarioBuilderInput
}

/** What the builder could reach on the web: `resolveWebCapabilities` (`lib/tools/web-capabilities.ts`). */
export type ScenarioBuilderCapabilities = WebCapabilities

/** The Scenario Builder's name for {@link resolveWebCapabilities}. */
export const resolveScenarioBuilderCapabilities = resolveWebCapabilities

/** Web search reaches this run only in real mode, on a profile that allows it, with a provider that has its key. */
export async function isScenarioWebAvailable(
  mode: ScenarioBuilderMode,
  profile: ConnectionProfile,
  userId: string,
): Promise<boolean> {
  return mode === 'real' && !!profile.allowWebSearch && (await isWebSearchConfigured(userId))
}

/**
 * Run the builder, streaming tool events to `controller` and ending with a
 * `done` event carrying the scene, or an `error` event in the Host's voice.
 * Never throws; an abort ends quietly (the client is gone).
 */
export async function runScenarioBuilder(
  opts: RunScenarioBuilderOptions,
  controller: StreamController,
  signal?: AbortSignal,
): Promise<void> {
  const { repos, userId, connectionProfile, apiKey, input } = opts
  // This route's client reads the pre-4.12 untagged-bag SSE shape.
  const encoder = legacyFrameEncoder()

  // Tools need a chat id only for scoping; nothing reads or writes a chat row
  // with a synthetic one (the read-only slate posts no Librarian notices).
  const chatId = input.chat?.id ?? randomUUID()
  const webAvailable = await isScenarioWebAvailable(input.mode, connectionProfile, userId)

  try {
    const mountPool = await resolveScenarioBuilderMountPool({
      userId,
      projectId: input.projectId ?? null,
      characterIds: input.characterIds,
      groupIds: input.groupIds ?? [],
    })

    logger.debug('Scenario Builder run starting', {
      mode: input.mode,
      castCount: input.characterIds.length,
      namedGroupCount: input.groupIds?.length ?? 0,
      inChat: !!input.chat,
      revising: input.revision != null,
      profileId: connectionProfile.id,
      provider: connectionProfile.provider,
      model: connectionProfile.modelName,
      webAvailable,
      pool: {
        participants: mountPool.participantMountPointIds.length,
        groups: mountPool.groupMountPointIds.length,
        projects: mountPool.projectMountPointIds.length,
        hasGlobal: !!mountPool.globalMountPointId,
      },
    })

    // The slate: search (documents/knowledge), the read-only doc_* five,
    // submit_final_response; plus search_web and curl in real mode.
    const built = await buildTools({
      connectionProfile,
      userId,
      // No projectId — no project_info tool; the pool carries the project tier.
      agentModeEnabled: true,
      canDressThemselves: false,
      canCreateOutfits: false,
      canManageInventory: false, // no inventory_* tools here
      docToolsMode: 'read', // reads only
      researchKit: 'documents', // find_documents / list_documents inside the pool
      askCarinaEnabled: false,
      includeWorkspaceTools: false,
      excludeMemorySearch: true, // narrowed further by documentsOnlySearch
      documentsOnlySearch: true,
      webSearch: webAvailable,
      pluginToolAllowlist: input.mode === 'real' ? ['curl'] : [],
    })

    const toolInstructions = buildOneShotToolInstructions({
      connectionProfile,
      built,
      agentKind: 'drafting',
      maxAgentTurns: SCENARIO_BUILDER_MAX_AGENT_TURNS,
      textBlockOptions: researchOnlyTextBlockToolOptions({
        search: true,
        webSearch: webAvailable,
        researchKit: 'documents',
      }),
    })

    const systemPrompt = buildScenarioBuilderSystemPrompt({
      mode: input.mode,
      webAvailable,
      toolInstructions,
      now: new Date(),
    })
    // What a first search of the pool already found, so the loop starts from it.
    const brief = await buildScenarioBrief({ kind: 'pool', pool: mountPool }, input.location, { userId })
    const userMessage = buildScenarioBuilderUserMessage({
      brief,
      mode: input.mode,
      location: input.location,
      time: input.time,
      details: input.details,
      currentScenario: input.chat?.scenarioText ?? null,
      contextSummary: input.chat?.contextSummary ?? null,
      priorDraft: input.priorDraft ?? null,
      revision: input.revision ?? null,
    })

    const toolContext: ToolExecutionContext = {
      chatId,
      userId,
      projectId: input.projectId ?? undefined,
      // embeddingProfileId omitted → the user's default embedding profile.
      mountPool,
      // The executor admits only the slate built above.
      toolOffer: built.offer,
      pluginToolEffects: built.pluginToolEffects,
    }

    const result = await runOneShotToolLoop({
      repos,
      agentKind: 'drafting',
      userId,
      chatId,
      connectionProfile,
      apiKey,
      systemPrompt,
      userMessage,
      tools: built,
      toolContext,
      maxAgentTurns: SCENARIO_BUILDER_MAX_AGENT_TURNS,
      controller,
      signal,
      logType: 'SCENARIO_BUILDER',
      statusContext: { characterName: 'The Host', characterId: '' },
      onReasoning: (reasoning) => controller.enqueue(encodeReasoningChunk(encoder, reasoning)),
      logLabel: 'Scenario Builder',
    })

    if (!result.ok) {
      if (result.detail === 'aborted') {
        logger.debug('Scenario Builder run aborted by the client', { chatId })
        return
      }
      logger.debug('Scenario Builder run ended without a scene', { chatId, detail: result.detail })
      controller.enqueue(
        encodeErrorEvent(
          encoder,
          'The Host returned from his enquiries empty-handed, I regret to report. Do try again, or try another model.',
          'scenario_builder_failed',
          result.detail,
        ),
      )
      return
    }

    const scenario = result.answer.trim()
    logger.debug('Scenario Builder run complete', {
      chatId,
      scenarioLength: scenario.length,
      toolsExecuted: result.toolsExecuted,
      usage: result.usage,
    })
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({
          done: true,
          scenario,
          provider: connectionProfile.provider,
          modelName: connectionProfile.modelName,
          usage: result.usage,
          toolsExecuted: result.toolsExecuted,
          webAvailable,
        })}\n\n`,
      ),
    )
  } catch (error) {
    if (signal?.aborted) {
      logger.debug('Scenario Builder run aborted by the client (during a throw)', { chatId })
      return
    }
    const detail = error instanceof Error ? error.message : String(error)
    logger.error('Scenario Builder run failed', { chatId, error: detail })
    controller.enqueue(
      encodeErrorEvent(
        encoder,
        'The Host has been detained by circumstances beyond his control — the model would not answer. Do try again, or try another model.',
        'scenario_builder_failed',
        detail,
      ),
    )
  }
}
