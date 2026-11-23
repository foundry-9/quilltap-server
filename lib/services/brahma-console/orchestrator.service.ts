/**
 * Brahma Console — the console engine's first persona.
 *
 * The Brahma Console is the operator's direct line to a plain LLM inside
 * Quilltap: character-less and memory-free. The turn itself — user message,
 * model, history, attachments, the agent loop and its guards, persistence and
 * frames — is the console engine's (`lib/services/console-engine/engine.ts`);
 * this module supplies what is Brahma's:
 *
 *  - the neutral system prompt (`buildBrahmaSystemPrompt`), with the read-only
 *    SQL section and, in Writing Assistant mode, the manifest of named sources;
 *  - operator-scoped tools: search (no memories), the doc_* family reaching
 *    every document store the operator owns, read-only `run_sql`; web/curl from
 *    the chosen connection profile / installed plugins;
 *  - the Writing Assistant's read ceiling and output mark (`buildConsoleTurnPlan`);
 *  - attachments under `Brahma/` in Quilltap General;
 *  - the user's default profile when the chat pins none, and the operator's
 *    turn budget (Settings → Chat → Brahma Console).
 *
 * `handleBrahmaConsoleMessage`, `resolveBrahmaConnectionProfile` and
 * `buildConsoleTurnPlan` keep their names and behaviour; the routes and tests
 * call them as before.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { resolveBrahmaMaxAgentTurns } from './turn-budget'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadata, ConnectionProfile } from '@/lib/schemas/types'
import type { BrahmaConsoleSendOptions } from './types'
import { buildTools } from '@/lib/services/chat-message/streaming.service'
import { INQUIRY_FINISH_NOW, WRITING_FINISH_NOW } from '@/lib/services/chat-message/agent-mode-resolver.service'
import { buildBrahmaSystemPrompt } from '@/lib/brahma-console/system-prompt-builder'
import { resolveConsoleContext, renderConsoleContextManifest } from '@/lib/brahma-console/writing-context'
import { normalizeWritingOutput, WRITING_OUTPUT_KIND } from '@/lib/brahma-console/writing-output'
import { BRAHMA_ATTACHMENT_FOLDER } from '@/lib/brahma-console/attachments'
import { resolveConsoleConnectionProfile, runConsoleTurn } from '@/lib/services/console-engine/engine'
import type { ConsolePersona, ConsoleTurnPlanBase } from '@/lib/services/console-engine/persona'
import { researchOnlyTextBlockToolOptions } from '@/lib/services/chat-message/text-block-tool-options'

export { normalizeToolCallSignature } from '@/lib/services/console-engine/loop-guard'

const logger = createServiceLogger('BrahmaConsoleOrchestrator')

/**
 * Everything that differs between the ordinary Console and a Writing
 * Assistant conversation, decided once at the top of a turn so the agent loop
 * itself never tests the mode.
 */
export interface ConsoleTurnPlan extends ConsoleTurnPlanBase {
  /** Writing Assistant: the final answer is the piece, marked as an output. */
  writing: boolean
  /** The doc_* family offered: everything, or the read tools only. */
  docToolsMode: 'full' | 'read'
  // `effectCeiling` ('read' in Writing Assistant mode — the offer above is
  // advice; the ceiling is the guarantee, `resolveToolPermit`), `agentKind`
  // and `stuckNudge` come from the engine's base plan.
}

/** Build the turn plan for a Brahma chat from its stored mode. */
export function buildConsoleTurnPlan(chat: Pick<ChatMetadata, 'consoleMode'>): ConsoleTurnPlan {
  if (chat.consoleMode === 'writing') {
    return {
      writing: true,
      docToolsMode: 'read',
      effectCeiling: 'read',
      agentKind: 'writing',
      stuckNudge: `You have already gathered this data (a repeated call or repeated identical results). ${WRITING_FINISH_NOW}`,
    }
  }
  return {
    writing: false,
    docToolsMode: 'full',
    effectCeiling: undefined,
    agentKind: 'inquiry',
    stuckNudge: `You have already gathered this data (a repeated call or repeated identical results). ${INQUIRY_FINISH_NOW}`,
  }
}

/**
 * Resolve the connection profile a Brahma chat should talk to: the one pinned
 * on the chat (`consoleConnectionProfileId`), falling back to the user's
 * default profile. Returns null when neither resolves (no profiles at all).
 */
export async function resolveBrahmaConnectionProfile(
  repos: ReturnType<typeof getRepositories>,
  userId: string,
  consoleConnectionProfileId: string | null | undefined
): Promise<ConnectionProfile | null> {
  return resolveConsoleConnectionProfile(repos, userId, consoleConnectionProfileId, BRAHMA_CONSOLE_PERSONA)
}

/** Brahma, as the console engine runs him. */
export const BRAHMA_CONSOLE_PERSONA: ConsolePersona<ConsoleTurnPlan> = {
  chatType: 'brahma',
  label: 'Brahma Console',
  surface: 'brahma-console',
  attachmentFolder: BRAHMA_ATTACHMENT_FOLDER,

  defaultConnectionProfile: (repos, userId) => repos.connections.findDefault(userId),
  // The turn budget is operator-set (Settings → Chat → Brahma Console).
  maxAgentTurns: resolveBrahmaMaxAgentTurns,
  planTurn: (chat) => {
    const plan = buildConsoleTurnPlan(chat)
    logger.debug('Brahma Console turn plan', {
      chatId: chat.id,
      writing: plan.writing,
      docToolsMode: plan.docToolsMode,
      effectCeiling: plan.effectCeiling ?? null,
    })
    return plan
  },

  // Brahma flags: agent mode on, no help tools, document editing (read/write)
  // on, no wardrobe, no Carina, workspace tools stripped, search without
  // memories, read-only run_sql.
  buildTools: ({ connectionProfile, userId, plan }) =>
    buildTools({
      connectionProfile,
      userId,
      agentModeEnabled: true,
      canDressThemselves: false,
      canCreateOutfits: false,
      canManageInventory: false, // no inventory_* tools here
      docToolsMode: plan.docToolsMode,
      askCarinaEnabled: false,
      includeWorkspaceTools: false, // stripped for the console
      excludeMemorySearch: true, // no memory source
      sqlAccess: true, // the console gets read-only run_sql
      researchKit: 'full', // the research kit's search tools in place of the old grep and file list
      // Writing Assistant: drop what the read ceiling would refuse anyway, so
      // the model is not offered tools it cannot use. The executor's check on
      // the tool context is the guarantee.
      ...(plan.effectCeiling ? { effectCeiling: plan.effectCeiling } : {}),
    }),
  // Hand-built text-block options for the console: search + (maybe) web
  // search only; no workspace, wardrobe, help, rng/state, or whisper tools.
  textBlockToolOptions: ({ connectionProfile }) => researchOnlyTextBlockToolOptions({
    search: true,
    webSearch: !!connectionProfile.allowWebSearch,
    researchKit: 'full',
  }),
  // Operator surface: character-less, all stores.
  toolContext: () => ({ operatorSurface: true }),

  // The neutral, character-less system prompt. The console always enables the
  // read-only run_sql tool, so the SQL-access section is always appended.
  // Writing Assistant: the manifest of the operator's named sources, rebuilt
  // each turn from the stored refs (stable unless the context is edited, so
  // the prompt-cache prefix survives). Empty is absent.
  buildSystemPrompt: async ({ repos, userId, chat, connectionProfile, toolInstructions, plan }) => {
    const contextManifest = plan.writing
      ? renderConsoleContextManifest(await resolveConsoleContext(repos, userId, chat.consoleContext))
      : ''
    return buildBrahmaSystemPrompt({
      profile: connectionProfile,
      toolInstructions,
      includeSqlAccess: true,
      writingAssistant: plan.writing,
      contextManifest,
    })
  },

  // In Writing Assistant mode the salvage is a notice, never the piece: no raw
  // tool-result digest dressed up as an output, and no output marker.
  salvageMessage: ({ maxAgentTurns, lastToolResultText, plan, cause }) => {
    const digest = lastToolResultText && !plan.writing
      ? `\n\nHere is what I gathered before I stopped:\n\n${lastToolResultText}`
      : ''
    if (cause === 'empty') {
      return plan.writing
        ? 'The model answered with nothing before it could finish the piece; its reply may have run past its output allowance. Ask again, or raise the connection profile\'s max tokens.'
        : `The model answered with nothing; its reply may have run past its output allowance. Ask again, or raise the connection profile's max tokens.${digest}`
    }
    return plan.writing
      ? `I reached my ${maxAgentTurns}-turn budget before I could finish the piece. Ask again, perhaps more narrowly, or raise the Console's turn budget.`
      : `I reached my ${maxAgentTurns}-turn budget before I could compose a final answer.${digest}`
  },
  // Writing Assistant: a successful run's final message is the output — marked,
  // and lightly normalised (trim; unwrap a whole-text markdown fence).
  finishAnswer: ({ text, salvaged, plan }) =>
    plan.writing && !salvaged
      ? { content: normalizeWritingOutput(text), systemKind: WRITING_OUTPUT_KIND }
      : { content: text },
}

/**
 * Handle sending a message in a Brahma Console chat and streaming the response.
 */
export async function handleBrahmaConsoleMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  options: BrahmaConsoleSendOptions
): Promise<ReadableStream<Uint8Array>> {
  return runConsoleTurn(BRAHMA_CONSOLE_PERSONA, repos, chatId, userId, options)
}
