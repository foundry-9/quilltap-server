/**
 * Casting — the quick half of starting a chat.
 *
 * `POST /api/v1/chats` validates the request, resolves every default once
 * (`resolveCastingDefaults`), resolves the scenario, creates the row and its
 * seats with the opening `'pending'`, applies the requested Concierge state,
 * and — for a continuation — replays the source chat's history, so the Salon
 * opens on it. Then it returns. Nothing here calls a model: dressing,
 * packing, the staff's posts and the greeting are the opening's (`run.ts`),
 * which the Salon starts when it opens the chat.
 *
 * Server-only.
 *
 * Design of record: docs/developer/features/complete/refactor-green-room-and-opening.md (D1, D5)
 *
 * @module chat/opening/cast
 */

import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import type { Character, ChatMetadata, ChatParticipantBaseInput } from '@/lib/schemas/types'
import {
  resolveScenarioSelection,
  ScenarioRefRefusedError,
  type ResolvedScenario,
} from '@/lib/chat/scenario-selection'
import { ensureFictionalBaseRealTime } from '@/lib/chat/timestamp-utils'
import { applyChatContinuation } from '@/lib/chat/apply-chat-continuation'
import { computeNextRunFromCron } from '@/lib/services/chat-message/autonomous-room-cron'
import {
  CastingProjectNotFoundError,
  requestNamesScenario,
  resolveCastingDefaults,
  scenarioDefaultAsRequest,
  type CastingSeat,
} from './defaults'
import {
  applyRequestedConciergeState,
  requestedConciergeStateAtCreation,
  type ConciergeColumns,
} from './concierge'
import type { CreateChatInput, CreateParticipantInput } from './schema'
import type { OpeningPlan } from './run'

/** Why casting refused, as the route maps it. */
export type CastingRefusal = { status: 400 | 404; message: string }

export type CastChatResult =
  | { ok: true; chat: ChatMetadata & ConciergeColumns }
  | { ok: false; refusal: CastingRefusal }

const refuse = (status: 400 | 404, message: string): CastChatResult => ({ ok: false, refusal: { status, message } })

type BuiltSeat = { participant: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>; character: Character }

/** One requested seat, checked against the character and its profile. */
async function buildSeat(
  data: CreateParticipantInput,
  displayOrder: number,
  repos: RepositoryContainer,
): Promise<BuiltSeat | { error: string; status: 400 | 404 }> {
  const character = await repos.characters.findById(data.characterId)
  if (!character) return { error: 'Character not found', status: 400 }

  const controlledBy = data.controlledBy || character.controlledBy || 'llm'
  const isUserControlled = controlledBy === 'user'
  if (!isUserControlled && !data.connectionProfileId) {
    return { error: 'connectionProfileId is required for LLM-controlled CHARACTER participants', status: 400 }
  }
  if (data.connectionProfileId && !(await repos.connections.findById(data.connectionProfileId))) {
    return { error: 'Connection profile not found', status: 400 }
  }

  return {
    character,
    participant: {
      type: 'CHARACTER',
      characterId: data.characterId,
      controlledBy,
      connectionProfileId: isUserControlled ? null : data.connectionProfileId || null,
      imageProfileId: null,
      selectedSystemPromptId: data.selectedSystemPromptId || null,
      selectedSubpromptIds: isUserControlled ? [] : (data.selectedSubpromptIds ?? []),
      displayOrder,
      isActive: true,
    },
  }
}

/**
 * Autonomous-room preconditions: no user-controlled seats, at least two
 * LLM-controlled characters, and a parseable `scheduleCron` (an all-whitespace
 * expression means "no schedule", i.e. manual-only). Yields the first
 * scheduled run to stamp on the row.
 */
function validateAutonomousRoomRequest(
  input: CreateChatInput,
  userId: string,
): { ok: true; nextRunAt: string | null } | { ok: false; message: string } {
  if (input.participants.some((p) => p.controlledBy === 'user')) {
    return { ok: false, message: 'Autonomous rooms cannot include user-controlled participants' }
  }
  const llm = input.participants.filter((p) => !p.controlledBy || p.controlledBy === 'llm')
  if (llm.length < 2) {
    return { ok: false, message: 'Autonomous rooms require at least two LLM-controlled characters' }
  }
  const expr = input.scheduleCron?.trim() ?? ''
  if (expr.length === 0) return { ok: true, nextRunAt: null }
  const nextRun = computeNextRunFromCron(expr)
  if (!nextRun.ok) {
    logger.warn('[Casting] Invalid cron expression on autonomous-room create', { userId, scheduleCron: expr, error: nextRun.error })
    return { ok: false, message: nextRun.message }
  }
  return { ok: true, nextRunAt: nextRun.nextRunAt }
}

/** Cast a chat: create it, ready to be opened. */
export async function castChat(
  input: CreateChatInput,
  { userId, repos }: { userId: string; repos: RepositoryContainer },
): Promise<CastChatResult> {
  const isAutonomous = input.chatType === 'autonomous'

  // The continuation source must be the operator's own (a user-scoped read).
  if (input.continuationFromChatId && !(await repos.chats.findById(input.continuationFromChatId))) {
    logger.warn('[Casting] continuationFromChatId names a chat not owned by the current user', {
      userId,
      continuationFromChatId: input.continuationFromChatId,
    })
    return refuse(404, 'Source chat not found')
  }

  let autonomousNextRunAt: string | null = null
  if (isAutonomous) {
    const autonomous = validateAutonomousRoomRequest(input, userId)
    if (!autonomous.ok) return refuse(400, autonomous.message)
    autonomousNextRunAt = autonomous.nextRunAt
  }

  const built: BuiltSeat[] = []
  for (let i = 0; i < input.participants.length; i++) {
    const seat = await buildSeat(input.participants[i], i, repos)
    if ('error' in seat) return refuse(seat.status, seat.error)
    built.push(seat)
  }
  if (!built.some((s) => s.participant.controlledBy !== 'user')) {
    return refuse(400, 'At least one LLM-controlled CHARACTER participant is required')
  }

  if (input.roleplayTemplateId && !(await repos.roleplayTemplates.findById(input.roleplayTemplateId))) {
    return refuse(400, 'Roleplay template not found')
  }

  const seats: CastingSeat[] = built.map((s) => ({
    character: s.character,
    controlledBy: s.participant.controlledBy === 'user' ? 'user' : 'llm',
  }))
  let defaults
  try {
    defaults = await resolveCastingDefaults({
      repos,
      userId,
      seats,
      projectId: input.projectId ?? null,
      continuationFromChatId: input.continuationFromChatId ?? null,
      chatType: input.chatType,
      request: input,
    })
  } catch (error) {
    if (error instanceof CastingProjectNotFoundError) return refuse(404, 'Project not found')
    throw error
  }

  // The scenario is one override: whatever the request named, or the default.
  const primary = seats.find((s) => s.controlledBy === 'llm')?.character ?? null
  const scenarioFields = requestNamesScenario(input) ? input : scenarioDefaultAsRequest(defaults.scenario)
  let scenario: ResolvedScenario
  try {
    scenario = await resolveScenarioSelection(
      {
        scenario: scenarioFields.scenario,
        scenarioRef: scenarioFields.scenarioRef,
        scenarioId: scenarioFields.scenarioId,
        projectScenarioPath: scenarioFields.projectScenarioPath,
        groupScenarioPath: scenarioFields.groupScenarioPath,
        groupScenarioGroupId: scenarioFields.groupScenarioGroupId,
        generalScenarioPath: scenarioFields.generalScenarioPath,
      },
      { repos, userId, projectId: input.projectId, characterId: primary?.id ?? null, logTag: '[Casting]' },
    )
  } catch (error) {
    if (error instanceof ScenarioRefRefusedError) return refuse(400, error.message)
    throw error
  }

  const now = new Date().toISOString()
  const participants: ChatParticipantBaseInput[] = built.map((s) => ({
    ...s.participant,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }))
  const tags = new Set<string>()
  for (const s of built) for (const tag of s.character.tags ?? []) tags.add(tag)

  const chat = await repos.chats.create({
    userId,
    participants,
    title: defaults.title,
    // A scenario is a stage direction; `contextSummary` is the record of a
    // conversation that has happened, and only the summarizer writes it (bug 158).
    contextSummary: null,
    tags: Array.from(tags),
    roleplayTemplateId: defaults.roleplayTemplateId,
    // Anchor a fictional clock as it lands on the chat: from here on it runs.
    timestampConfig: ensureFictionalBaseRealTime(defaults.timestampConfig),
    projectId: input.projectId || null,
    scenarioText: scenario.scenarioText,
    scenarioSource: scenario.scenarioSource,
    scenarioNotes: scenario.scenarioNotes,
    disabledTools: defaults.toolDefaults.disabledTools,
    disabledToolGroups: defaults.toolDefaults.disabledToolGroups,
    imageProfileId: defaults.imageProfileId,
    avatarGenerationEnabled: defaults.avatarGenerationEnabled,
    documentEditingMode: defaults.documentEditingMode,
    ...(isAutonomous ? {
      chatType: 'autonomous' as const,
      scheduleCron: input.scheduleCron?.trim() ? input.scheduleCron.trim() : null,
      scheduleFreshnessWindowMs: input.scheduleFreshnessWindowMs ?? null,
      scheduleNextRunAt: autonomousNextRunAt,
      budgetMaxTurns: input.budgetMaxTurns ?? null,
      budgetMaxTokens: input.budgetMaxTokens ?? null,
      budgetMaxWallClockMs: input.budgetMaxWallClockMs ?? null,
      budgetEstimatedSpendCapUSD: input.budgetEstimatedSpendCapUSD ?? null,
      runVisibility: input.runVisibility ?? null,
      runDestructiveToolsAllowed: input.runDestructiveToolsAllowed ? 1 : 0,
      // Exclude prompt-cache hits from the budget unless explicitly told not to.
      budgetExcludeCacheHits: input.budgetExcludeCacheHits === false ? 0 : 1,
      runState: 'idle' as const,
      currentRunId: null,
      runTurnsConsumed: 0,
      runTokensConsumed: 0,
    } : {}),
  })

  // The opening is the Salon's to start; until then the chat is "not yet opened".
  const plan: OpeningPlan = {
    outfitSelections: input.outfitSelections,
    sourceChatId: input.continuationFromChatId ?? null,
  }
  await repos.chats.setOpeningState(chat.id, 'pending', null, plan)

  // The Concierge's state lands before anything is said in the chat, so the
  // greeting is composed under it.
  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const conciergeColumns = await applyRequestedConciergeState(
    chat,
    requestedConciergeStateAtCreation(input.conciergeState, chatSettings, chat),
    repos,
  )

  if (input.continuationFromChatId) {
    try {
      await applyChatContinuation({
        newChatId: chat.id,
        sourceChatId: input.continuationFromChatId,
        userId,
        repos,
      })
    } catch (error) {
      logger.error('[Casting] applyChatContinuation failed', {
        chatId: chat.id,
        sourceChatId: input.continuationFromChatId,
        error: getErrorMessage(error),
      }, error instanceof Error ? error : undefined)
    }
  }

  logger.info('[Casting] Chat cast; awaiting its opening', {
    chatId: chat.id,
    chatType: input.chatType ?? 'salon',
    seats: participants.length,
    continuationFromChatId: input.continuationFromChatId ?? null,
    explicitOutfits: input.outfitSelections?.length ?? 0,
  })
  return { ok: true, chat: { ...chat, ...conciergeColumns } }
}
