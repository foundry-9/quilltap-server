/**
 * Calliope, as the console engine runs her (Calliope Live, Spec J §2.4).
 *
 * A console persona (`lib/services/console-engine/persona.ts`): a
 * character-less, memory-free conversation about one theme draft. Her slate
 * is exactly the five `theme_*` tools (`THEME_ASSIST_TOOL_DEFINITIONS`) plus
 * agent mode's closing call; her turns run under `effectCeiling: 'read'`
 * (`theme_propose` is `none`), so no write tool would be permitted even if
 * one leaked into the slate. She is not the operator surface. Her
 * attachments (reference pictures) live under `Calliope/` in Quilltap
 * General and leave with the conversation.
 *
 * Her engine: the conversation's pinned profile, else her setting
 * (`calliope.connectionProfileId`), else the default profile.
 *
 * @module services/calliope/persona
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getCalliopeSettings } from '@/lib/instance-settings'
import { DEFAULT_CALLIOPE_MAX_AGENT_TURNS } from '@/lib/schemas/settings.types'
import type { ConnectionProfile } from '@/lib/schemas/types'
import { buildTools } from '@/lib/services/chat-message/streaming.service'
import { inventoryToolFlags } from '@/lib/tools/inventory-tool-flags'
import { THEME_ASSIST_TOOL_DEFINITIONS } from '@/lib/tools/theme-assist-tools'
import { CONSOLE_ATTACHMENT_FOLDERS } from '@/lib/console-engine/attachments'
import { buildCalliopeSystemPrompt } from '@/lib/calliope/system-prompt-builder'
import { readDraft } from '@/lib/themes/drafts'
import { resolveConsoleConnectionProfile, runConsoleTurn, type ConsoleSendOptions } from '@/lib/services/console-engine/engine'
import type { ConsolePersona, ConsoleRepos, ConsoleTurnPlanBase } from '@/lib/services/console-engine/persona'

const logger = createServiceLogger('Calliope')

/** Her folder at the root of Quilltap General. */
export const CALLIOPE_ATTACHMENT_FOLDER = CONSOLE_ATTACHMENT_FOLDERS.calliope

/** The same plan every turn: read ceiling, research-style agent instructions. */
const CALLIOPE_TURN_PLAN: ConsoleTurnPlanBase = Object.freeze({
  effectCeiling: 'read' as const,
  agentKind: 'research' as const,
  stuckNudge:
    'You have already gathered this (a repeated call or repeated identical results). Do NOT call any more tools. ' +
    'Call submit_final_response NOW with your answer to the author.',
})

/** Her setting's profile when it names one the user owns; null otherwise. */
async function settingProfile(repos: ConsoleRepos, userId: string): Promise<ConnectionProfile | null> {
  try {
    const { connectionProfileId } = await getCalliopeSettings()
    if (!connectionProfileId) return null
    const profile = await repos.connections.findById(connectionProfileId)
    if (profile && profile.userId === userId) return profile
    logger.debug('Calliope\'s configured profile is gone; falling back to the default', { connectionProfileId })
  } catch (error) {
    logger.warn('Calliope settings unreadable; falling back to the default profile', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return null
}

/** Her agent-turn budget (her setting). Never throws. */
export async function resolveCalliopeMaxAgentTurns(): Promise<number> {
  try {
    const turns = (await getCalliopeSettings()).maxAgentTurns ?? DEFAULT_CALLIOPE_MAX_AGENT_TURNS
    logger.debug('Resolved Calliope agent-turn budget', { turns })
    return turns
  } catch (error) {
    logger.warn('Calliope turn budget unreadable; using default', {
      default: DEFAULT_CALLIOPE_MAX_AGENT_TURNS,
      error: error instanceof Error ? error.message : String(error),
    })
    return DEFAULT_CALLIOPE_MAX_AGENT_TURNS
  }
}

/** The draft's name for her prompt; its id when the draft cannot be read. */
async function draftName(draftId: string): Promise<string> {
  try {
    const detail = await readDraft(draftId)
    return typeof detail.manifest?.name === 'string' && detail.manifest.name.trim() ? detail.manifest.name : draftId
  } catch (error) {
    logger.debug('Draft unreadable while building Calliope\'s prompt; naming it by id', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    })
    return draftId
  }
}

export const CALLIOPE_PERSONA: ConsolePersona<ConsoleTurnPlanBase> = {
  chatType: 'calliope',
  label: 'Calliope',
  surface: 'calliope',
  attachmentFolder: CALLIOPE_ATTACHMENT_FOLDER,

  defaultConnectionProfile: async (repos, userId) =>
    (await settingProfile(repos, userId)) ?? repos.connections.findDefault(userId),
  maxAgentTurns: resolveCalliopeMaxAgentTurns,
  planTurn: (chat) => {
    logger.debug('Calliope turn plan', { chatId: chat.id, draftId: chat.themeDraftId ?? null })
    return CALLIOPE_TURN_PLAN
  },

  // Her own slate and nothing else: no search, no doc_*, no SQL, no Carina,
  // no plugin tools, no web search.
  buildTools: ({ connectionProfile, userId, plan }) =>
    buildTools({
      connectionProfile,
      userId,
      agentModeEnabled: true,
      onlyTools: THEME_ASSIST_TOOL_DEFINITIONS,
      effectCeiling: plan.effectCeiling,
    }),
  // The text-block tool family describes none of hers: without native tool
  // calling she can talk about the draft but not read or propose (the same
  // limit Brahma's run_sql has).
  textBlockToolOptions: () => ({
    imageGeneration: false,
    search: false,
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
  }),
  // Not the operator surface: her tools read only her conversation's draft.
  toolContext: () => ({}),

  buildSystemPrompt: async ({ chat, toolInstructions }) => {
    const draftId = chat.themeDraftId ?? ''
    return buildCalliopeSystemPrompt({ draft: { id: draftId, name: await draftName(draftId) }, toolInstructions })
  },

  salvageMessage: ({ maxAgentTurns, cause }) =>
    cause === 'empty'
      ? 'My reply came back empty — most likely it ran past the model\'s output allowance before I could set it down. Ask again for less at once, or raise the max tokens on the connection profile I am using.'
      : `I ran through my ${maxAgentTurns} turns before I could finish. Ask again, perhaps for less at once, or raise my turn budget in the settings.`,
  finishAnswer: ({ text }) => ({ content: text }),
}

/** The model a Calliope conversation talks to: pinned, else her setting, else the default. */
export function resolveCalliopeConnectionProfile(
  repos: ConsoleRepos,
  userId: string,
  pinnedConnectionProfileId: string | null | undefined,
): Promise<ConnectionProfile | null> {
  return resolveConsoleConnectionProfile(repos, userId, pinnedConnectionProfileId, CALLIOPE_PERSONA)
}

/** Send a message in a Calliope conversation and stream her reply. */
export function handleCalliopeMessage(
  repos: ConsoleRepos,
  chatId: string,
  userId: string,
  options: ConsoleSendOptions,
): Promise<ReadableStream<Uint8Array>> {
  return runConsoleTurn(CALLIOPE_PERSONA, repos, chatId, userId, options)
}
