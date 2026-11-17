/**
 * Atlas lore draft — Brahma drafts one Atlas entry from the operator's lore.
 *
 * One run is one request → tool loop → one draft (name, aliases, graphic
 * prompt, knowledge). Stateless on the server: no chat row, no messages, and
 * nothing written to the Atlas — the wizard hands the draft to the Atlas
 * editor, where the operator saves it through the ordinary create. The only
 * durable trace is the LLM log rows `streamMessage` writes, typed
 * `ATLAS_LORE_DRAFT`. Pictures are not drafted: they are the operator's to
 * upload or generate once the entry exists.
 *
 * The run executes in the parent process inside the API route, streamed over
 * SSE (the Scenario Builder's pattern) — never a background job.
 *
 * Brahma's reach: with the stores open, the operator surface (every document
 * store, the lookup shortcuts and read-only `run_sql`) under an effect ceiling
 * of `read`, so nothing can be written whatever the model asks for. With the
 * stores closed, no tools but `submit_final_response`.
 *
 * @module services/atlas-lore/atlas-lore.service
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
import { resolveBrahmaMaxAgentTurns } from '@/lib/services/brahma-console/turn-budget'
import { resolveAtlasLocation } from '@/lib/atlas/location'
import type { AtlasScope } from '@/lib/schemas/atlas.types'
import { buildAtlasLoreSystemPrompt, buildAtlasLoreUserMessage } from '@/lib/atlas/lore-draft/prompt'
import { parseAtlasLoreDraft } from '@/lib/atlas/lore-draft/parse'
import type { AtlasLoreDraft } from '@/lib/atlas/lore-draft/request-schema'

const logger = createServiceLogger('AtlasLoreDraft')

export interface AtlasLoreDraftInput {
  subject: string
  details: string
  searchStores: boolean
  target: { scope: AtlasScope; id: string | null }
  priorDraft?: AtlasLoreDraft | null
  revision?: string | null
}

export interface RunAtlasLoreDraftOptions {
  repos: ReturnType<typeof getRepositories>
  userId: string
  connectionProfile: ConnectionProfile
  apiKey: string
  input: AtlasLoreDraftInput
}

/** The words for the tier a draft will be filed in, as Brahma is told them. */
function targetLabelOf(scope: AtlasScope, ownerName: string | null): string {
  switch (scope) {
    case 'general':
      return 'Quilltap General (reachable from every chat)'
    case 'project':
      return ownerName ? `the project "${ownerName}"` : 'a project'
    case 'group':
      return ownerName ? `the group "${ownerName}"` : 'a group'
    case 'character':
      return ownerName ? `the character ${ownerName}'s own vault` : "a character's own vault"
  }
}

/** The tier's label and the names its live entries already answer to. Never throws. */
async function describeTarget(
  repos: RunAtlasLoreDraftOptions['repos'],
  userId: string,
  target: AtlasLoreDraftInput['target'],
): Promise<{ label: string; takenNames: string[] }> {
  try {
    const location = await resolveAtlasLocation(target.scope, target.id, repos, userId)
    if (!location) return { label: targetLabelOf(target.scope, null), takenNames: [] }
    const entries = await location.readEntries(false)
    const takenNames = entries.flatMap((e) => [e.name, ...(e.aliases ?? [])])
    return {
      label: targetLabelOf(target.scope, target.scope === 'general' ? null : location.origin.name),
      takenNames,
    }
  } catch (error) {
    logger.warn('Could not read the target atlas for a lore draft; going on without its names', {
      scope: target.scope,
      id: target.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return { label: targetLabelOf(target.scope, null), takenNames: [] }
  }
}

/**
 * Run the draft, streaming tool events to `controller` and ending with a
 * `done` event carrying the draft, or an `error` event in Brahma's plain
 * voice. Never throws; an abort ends quietly (the client is gone).
 */
export async function runAtlasLoreDraft(
  opts: RunAtlasLoreDraftOptions,
  controller: StreamController,
  signal?: AbortSignal,
): Promise<void> {
  const { repos, userId, connectionProfile, apiKey, input } = opts
  // This route's client reads the untagged-bag SSE shape, as the Scenario Builder's does.
  const encoder = legacyFrameEncoder()
  // Tools need a chat id only for scoping; nothing reads or writes a chat row with it.
  const chatId = randomUUID()

  try {
    const target = await describeTarget(repos, userId, input.target)
    const maxAgentTurns = await resolveBrahmaMaxAgentTurns()

    logger.debug('Atlas lore draft starting', {
      chatId,
      searchStores: input.searchStores,
      targetScope: input.target.scope,
      takenNames: target.takenNames.length,
      revising: input.revision != null,
      profileId: connectionProfile.id,
      provider: connectionProfile.provider,
      model: connectionProfile.modelName,
      maxAgentTurns,
    })

    // Stores open: Brahma's read-only slate (search without memories, the
    // doc_* reads, the lookup shortcuts and run_sql). Stores closed: nothing
    // but submit_final_response.
    const built = await buildTools(
      input.searchStores
        ? {
            connectionProfile,
            userId,
            agentModeEnabled: true,
            canDressThemselves: false,
            canCreateOutfits: false,
            canManageInventory: false,
            docToolsMode: 'read',
            askCarinaEnabled: false,
            includeWorkspaceTools: false,
            excludeMemorySearch: true,
            sqlAccess: true,
            webSearch: false,
            pluginToolAllowlist: [],
            effectCeiling: 'read',
          }
        : { connectionProfile, userId, agentModeEnabled: true, onlyTools: [] },
    )

    const toolInstructions = buildOneShotToolInstructions({
      connectionProfile,
      built,
      maxAgentTurns,
      textBlockOptions: {
        imageGeneration: false,
        search: input.searchStores,
        webSearch: false,
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

    const systemPrompt = buildAtlasLoreSystemPrompt({
      searchStores: input.searchStores,
      sqlPrompt: BRAHMA_SQL_PROMPT,
      toolInstructions,
    })
    const userMessage = buildAtlasLoreUserMessage({
      subject: input.subject,
      details: input.details,
      targetLabel: target.label,
      takenNames: target.takenNames,
      priorDraft: input.priorDraft ?? null,
      revision: input.revision ?? null,
    })

    const toolContext: ToolExecutionContext = {
      chatId,
      userId,
      // Operator surface only when the stores are open; the executor admits
      // only the slate built above, and nothing above `read`.
      ...(input.searchStores ? { operatorSurface: true } : {}),
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
      maxAgentTurns,
      controller,
      signal,
      logType: 'ATLAS_LORE_DRAFT',
      statusContext: { characterName: 'Brahma', characterId: '' },
      onReasoning: (reasoning) => controller.enqueue(encodeReasoningChunk(encoder, reasoning)),
      logLabel: 'Atlas lore draft',
    })

    if (!result.ok) {
      if (result.detail === 'aborted') {
        logger.debug('Atlas lore draft aborted by the client', { chatId })
        return
      }
      logger.debug('Atlas lore draft ended without an answer', { chatId, detail: result.detail })
      controller.enqueue(
        encodeErrorEvent(
          encoder,
          'Brahma came back without a draft. Try again, or choose another model.',
          'atlas_lore_draft_failed',
          result.detail,
        ),
      )
      return
    }

    const { draft, structured } = parseAtlasLoreDraft(result.answer, input.subject)
    if (!structured) {
      logger.warn('Atlas lore draft answer had no readable frontmatter; kept it whole as knowledge', {
        chatId,
        answerLength: result.answer.length,
      })
    }
    logger.debug('Atlas lore draft complete', {
      chatId,
      structured,
      aliasCount: draft.aliases.length,
      hasGraphicPrompt: !!draft.graphicPrompt,
      knowledgeLength: draft.knowledge?.length ?? 0,
      toolsExecuted: result.toolsExecuted,
      usage: result.usage,
    })
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({
          done: true,
          draft,
          structured,
          provider: connectionProfile.provider,
          modelName: connectionProfile.modelName,
          usage: result.usage,
          toolsExecuted: result.toolsExecuted,
        })}\n\n`,
      ),
    )
  } catch (error) {
    if (signal?.aborted) {
      logger.debug('Atlas lore draft aborted by the client (during a throw)', { chatId })
      return
    }
    const detail = error instanceof Error ? error.message : String(error)
    logger.error('Atlas lore draft failed', { chatId, error: detail })
    controller.enqueue(
      encodeErrorEvent(
        encoder,
        'The model would not answer, so there is no draft. Try again, or choose another model.',
        'atlas_lore_draft_failed',
        detail,
      ),
    )
  }
}
