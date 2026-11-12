/**
 * Casting defaults — every precedence chain a new chat resolves, in one place.
 *
 * The New Chat dialog reads these before casting (`GET /api/v1/chats
 * ?action=casting-defaults`) to show what the chat will get, and sends back
 * only what the operator changed; casting calls the same function with the
 * request layered on top. What the form showed is what the chat got, and an
 * API client that sends nothing but a cast gets the same chat the dialog would
 * have made.
 *
 *   title             the server names the chat from its LLM cast
 *   timestampConfig   request > primary character > global
 *   imageProfileId    request (an explicit null included) > project >
 *                     primary character > the instance's default profile
 *   roleplayTemplate  request (an explicit null included) > project > user
 *   tools, avatars    project
 *   conciergeState    request > `newChatsStartAs` (on duty only)
 *   scenario          any scenario key in the request > character default >
 *                     project default > General default > none
 *   outfit modes      per seat, `defaultOutfitMode` (`arrival.ts`)
 *
 * Server-only.
 *
 * Design of record: docs/developer/features/complete/refactor-green-room-and-opening.md (D5)
 *
 * @module chat/opening/defaults
 */

import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import type { Character, ChatMetadata, TimestampConfig } from '@/lib/schemas/types'
import type { OutfitSelectionMode } from '@/lib/schemas/wardrobe.types'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import { resolveScenarioLocation } from '@/lib/scenarios/location'
import { buildOutfitSummary, type OutfitSummary } from '@/lib/wardrobe/outfit-summary'
import { requestedConciergeStateAtCreation } from './concierge'
import { chatHasOutfitFor, defaultOutfitMode } from './arrival'
import { SCENARIO_KEYS, type CreateChatInput } from './schema'

/** A prospective seat, as the defaults need to see it. */
export interface CastingSeat {
  character: Character
  controlledBy: 'llm' | 'user'
}

/** The scenario a cast opens in when the operator picks none. */
export type CastingScenarioDefault =
  | { kind: 'custom' }
  | { kind: 'character'; scenarioId: string }
  | { kind: 'project'; path: string }
  | { kind: 'general'; path: string }

export interface CastingDefaults {
  title: string
  timestampConfig: TimestampConfig | null
  imageProfileId: string | null
  roleplayTemplateId: string | null
  avatarGenerationEnabled: boolean | null
  toolDefaults: { disabledTools: string[]; disabledToolGroups: string[] }
  documentEditingMode: boolean
  /** What the chat starts as when the request names no state. */
  conciergeState: ConciergeState
  scenario: CastingScenarioDefault
  /** characterId → the outfit mode that seat arrives in when none is chosen. */
  outfitModes: Record<string, OutfitSelectionMode>
  /** A continuation's source chat's outfits, by character; null otherwise. */
  previousOutfits: OutfitSummary | null
}

export interface ResolveCastingDefaultsInput {
  repos: RepositoryContainer
  userId: string
  seats: CastingSeat[]
  projectId?: string | null
  continuationFromChatId?: string | null
  chatType?: 'salon' | 'autonomous'
  /** The create request, layered on top. Absent for the read the dialog makes. */
  request?: Partial<CreateChatInput>
}

/** A project the caller named does not exist. */
export class CastingProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} not found`)
    this.name = 'CastingProjectNotFoundError'
  }
}

/**
 * The chat's name, from its LLM cast: one, two or three names, else a count.
 * The same rule the New Chat dialog has always used.
 */
export function titleForCast(llmNames: readonly string[]): string {
  if (llmNames.length === 0) return 'New Chat'
  if (llmNames.length === 1) return `Chat with ${llmNames[0]}`
  if (llmNames.length === 2) return `Chat with ${llmNames[0]} and ${llmNames[1]}`
  if (llmNames.length === 3) return `Chat with ${llmNames[0]}, ${llmNames[1]}, and ${llmNames[2]}`
  return `Group Chat (${llmNames.length} characters)`
}

/** Whether the request names any scenario key (the scenario is one override). */
export function requestNamesScenario(request: Partial<CreateChatInput> | undefined): boolean {
  if (!request) return false
  return SCENARIO_KEYS.some((key) => request[key] !== undefined)
}

export async function resolveCastingDefaults(input: ResolveCastingDefaultsInput): Promise<CastingDefaults> {
  const { repos, userId, seats, request } = input
  const projectId = input.projectId ?? null
  const isAutonomous = input.chatType === 'autonomous'

  const project = projectId ? await repos.projects.findById(projectId) : null
  if (projectId && !project) throw new CastingProjectNotFoundError(projectId)
  const chatSettings = await repos.chatSettings.findByUserId(userId)

  const llmSeats = seats.filter((s) => s.controlledBy !== 'user')
  // The primary character: the first LLM seat, as listed.
  const primary = llmSeats[0]?.character ?? null

  const timestampConfig =
    request?.timestampConfig ?? primary?.defaultTimestampConfig ?? chatSettings?.defaultTimestampConfig ?? null

  const imageProfileId = request && request.imageProfileId !== undefined
    ? request.imageProfileId
    : project?.defaultImageProfileId ?? primary?.defaultImageProfileId ?? await instanceDefaultImageProfileId(repos, userId)

  const roleplayTemplateId = request && request.roleplayTemplateId !== undefined
    ? request.roleplayTemplateId
    : project?.defaultRoleplayTemplateId || chatSettings?.defaultRoleplayTemplateId || null

  const avatarGenerationEnabled = isAutonomous
    ? false
    : request?.avatarGenerationEnabled ?? project?.defaultAvatarGenerationEnabled ?? null

  const conciergeState =
    requestedConciergeStateAtCreation(request?.conciergeState, chatSettings, { chatType: input.chatType ?? 'salon' }) ?? 'moderated'

  const scenario = await defaultScenario({
    repos,
    userId,
    projectId,
    // A continuation picks up where its source left off; the character's own
    // opening scenario would be the wrong scene.
    characterDefaultScenarioId: !input.continuationFromChatId && llmSeats.length === 1
      ? llmSeats[0].character.defaultScenarioId ?? null
      : null,
  })

  const sourceChat: ChatMetadata | null = input.continuationFromChatId
    ? await repos.chats.findById(input.continuationFromChatId)
    : null
  const outfitModes: Record<string, OutfitSelectionMode> = {}
  for (const seat of seats) {
    outfitModes[seat.character.id] = defaultOutfitMode({
      canChooseOutfit: seat.character.canChooseOutfit,
      userControlled: seat.controlledBy === 'user',
      sourceHasOutfit: chatHasOutfitFor(sourceChat, seat.character.id),
    })
  }
  const previousOutfits = sourceChat ? await buildOutfitSummary(repos, sourceChat.id) : null

  const defaults: CastingDefaults = {
    title: request?.title || titleForCast(llmSeats.map((s) => s.character.name)),
    timestampConfig,
    imageProfileId,
    roleplayTemplateId,
    avatarGenerationEnabled,
    toolDefaults: {
      disabledTools: project?.defaultDisabledTools || [],
      disabledToolGroups: project?.defaultDisabledToolGroups || [],
    },
    documentEditingMode: chatSettings?.compositionModeDefault ?? false,
    conciergeState,
    scenario,
    outfitModes,
    previousOutfits,
  }
  logger.debug('[Casting] Resolved casting defaults', {
    userId,
    projectId,
    seats: seats.length,
    continuationFromChatId: input.continuationFromChatId ?? null,
    layeredOnRequest: !!request,
    title: defaults.title,
    imageProfileId,
    roleplayTemplateId,
    conciergeState,
    scenario: scenario.kind,
    outfitModes,
  })
  return defaults
}

/**
 * The instance's default image profile, if it can actually draw (it has a key).
 * The setup wizard marks the profile it creates as the default; without this a
 * new chat showed "No image generation" beside a profile labelled [Default].
 */
async function instanceDefaultImageProfileId(
  repos: RepositoryContainer,
  userId: string,
): Promise<string | null> {
  try {
    const profile = await repos.imageProfiles.findDefault(userId)
    return profile?.apiKeyId ? profile.id : null
  } catch (error) {
    logger.warn('[Casting] Could not read the default image profile', { userId, error: getErrorMessage(error) })
    return null
  }
}

/** The scenario a cast opens in by default: character > project > General > none. */
async function defaultScenario(input: {
  repos: RepositoryContainer
  userId: string
  projectId: string | null
  characterDefaultScenarioId: string | null
}): Promise<CastingScenarioDefault> {
  if (input.characterDefaultScenarioId) {
    return { kind: 'character', scenarioId: input.characterDefaultScenarioId }
  }
  const fromStore = async (scope: 'project' | 'general', id: string | null): Promise<string | null> => {
    try {
      const location = await resolveScenarioLocation(scope, id, input.repos, input.userId)
      if (!location) return null
      const { scenarios } = await location.list()
      return scenarios.find((s) => s.isDefault && !s.archived)?.path ?? null
    } catch (error) {
      logger.warn('[Casting] Could not read default scenario', { scope, id, error: getErrorMessage(error) })
      return null
    }
  }
  if (input.projectId) {
    const path = await fromStore('project', input.projectId)
    if (path) return { kind: 'project', path }
  }
  const generalPath = await fromStore('general', null)
  if (generalPath) return { kind: 'general', path: generalPath }
  return { kind: 'custom' }
}

/** A scenario default as the create request's scenario keys. */
export function scenarioDefaultAsRequest(scenario: CastingScenarioDefault): Partial<CreateChatInput> {
  switch (scenario.kind) {
    case 'character': return { scenarioId: scenario.scenarioId }
    case 'project': return { projectScenarioPath: scenario.path }
    case 'general': return { generalScenarioPath: scenario.path }
    case 'custom': return {}
  }
}
