/**
 * Run Custom Tool Handler
 *
 * Executes one of Pascal's user-authored pseudo-tools on a model's behalf:
 * resolve the roster, look the tool up, roll it server-side, and let Pascal
 * announce the outcome.
 *
 * The model receives a compact result — it needs to know what happened in order
 * to narrate it — but the visible artifact is Pascal's own message, which the
 * model did not write. A failure therefore cannot be narrated into a success,
 * and regenerating the reply does not re-roll.
 *
 * Job-child safe: the roll and the outcome evaluation are pure computation, and
 * the single write goes through the buffered `getRepositories()` proxy. Nothing
 * here reads back what it just wrote.
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import {
  resolveCustomToolRoster,
  executeCustomTool,
  CustomToolRunError,
  type CustomToolRunResult,
  type DiscoveredCustomTool,
} from '@/lib/pascal/custom-tools';
import { displayTitle } from '@/lib/pascal/custom-tool.types';
import { buildPascalResultContent, postPascalResult } from '@/lib/services/pascal/writer';
import { postProsperoCustomToolError } from '@/lib/services/prospero-notifications/writer';
import type { MessageEvent } from '@/lib/schemas/chat.types';
import { validateRunCustomInput, type RunCustomToolInput, type RunCustomToolOutput } from '../run-custom-tool';

const CONTEXT = 'run-custom-handler';

/**
 * Context required for run_custom execution.
 */
export interface RunCustomToolContext {
  /** User ID for ownership and logging. */
  userId: string;
  /** Chat the roll belongs to. */
  chatId: string;
  /** The rolling character — their vault is the 'character' tier. */
  characterId?: string | null;
  /** Fast path for the character's vault; the group tier still needs characterId. */
  characterMountPointId?: string | null;
  /** Every character in the chat — their vaults form the 'participant' tier. */
  characterIds?: string[];
  /** Active project, for the 'project' tier. */
  projectId?: string | null;
  /** The caller's participant id — the whisper target for a private roll. */
  callerParticipantId?: string | null;
  /**
   * Optional sink for the posted Pascal message, so the caller can surface it
   * over SSE the instant it lands rather than waiting for the post-turn refetch.
   */
  onPosted?: (message: MessageEvent) => void;
}

/** Shape the failure the same way whether it was a bad input or a bad roll. */
function failure(error: string, tool?: string): RunCustomToolOutput {
  return { success: false, ...(tool ? { tool } : {}), error };
}

/**
 * Post the Prospero error bubble for a failed run and return the model's result.
 *
 * Pascal only ever announces genuine outcomes, so a failure is Prospero's to
 * report — there is no Pascal message for a roll that never happened.
 */
async function reportFailure(
  context: RunCustomToolContext,
  toolName: string,
  reason: string,
  whisper: boolean
): Promise<RunCustomToolOutput> {
  logger.warn('Custom tool run failed', {
    context: CONTEXT,
    userId: context.userId,
    chatId: context.chatId,
    tool: toolName,
    reason,
  });

  await postProsperoCustomToolError({
    chatId: context.chatId,
    toolName,
    reason,
    whisper,
    callerParticipantId: context.callerParticipantId ?? null,
  });

  return failure(reason, toolName);
}

/**
 * Execute the run_custom tool.
 */
export async function executeRunCustomTool(
  input: unknown,
  context: RunCustomToolContext
): Promise<RunCustomToolOutput> {
  const parsed = validateRunCustomInput(input);
  if (!parsed) {
    logger.warn('run_custom validation failed', { context: CONTEXT, userId: context.userId, input });
    return failure('Invalid input: `tool` must be the name of an available custom tool.');
  }

  const { tool: toolName, parameters, private: isPrivate } = parsed;

  logger.debug('run_custom invoked', {
    context: CONTEXT,
    userId: context.userId,
    chatId: context.chatId,
    characterId: context.characterId ?? null,
    tool: toolName,
    hasParameters: !!parameters,
    private: isPrivate ?? null,
  });

  // Resolved fresh: a definition added or edited mid-chat is live on this call.
  const roster = await resolveCustomToolRoster({
    userId: context.userId,
    chatId: context.chatId,
    characterId: context.characterId ?? null,
    characterMountPointId: context.characterMountPointId ?? null,
    characterIds: context.characterIds,
    projectId: context.projectId ?? null,
  });

  const entry: DiscoveredCustomTool | undefined = roster.tools.get(toolName);
  if (!entry) {
    const available = [...roster.tools.keys()];
    // A name the model invented, or a file the user just deleted. Either way
    // this is not worth an error bubble in the transcript — tell the model.
    logger.warn('run_custom named an unknown tool', {
      context: CONTEXT,
      chatId: context.chatId,
      tool: toolName,
      available,
    });
    return failure(
      available.length
        ? `No custom tool named "${toolName}". Available: ${available.join(', ')}.`
        : `No custom tool named "${toolName}". This scene has none.`,
      toolName
    );
  }

  let result: CustomToolRunResult;
  try {
    result = executeCustomTool(entry.definition, parameters ?? null, { private: isPrivate });
  } catch (error) {
    const reason = error instanceof CustomToolRunError ? error.message : getErrorMessage(error);
    const whisper = isPrivate ?? entry.definition.defaultVisibility === 'whisper';
    return reportFailure(context, toolName, reason, whisper);
  }

  const whispered = result.visibility === 'whisper';

  // A private roll is whispered to the rolling character alone: every other
  // participant's context excludes it. The human operator sees it regardless —
  // Staff whispers always render for them.
  const targetParticipantIds =
    whispered && context.callerParticipantId ? [context.callerParticipantId] : null;

  const toolTitle = displayTitle(entry.definition);

  const { content, opaqueContent } = buildPascalResultContent({
    toolTitle,
    message: result.message,
  });

  const posted = await postPascalResult({
    chatId: context.chatId,
    content,
    opaqueContent,
    targetParticipantIds,
    pascalMeta: {
      tool: result.tool,
      toolTitle,
      definitionTier: entry.tier,
      definitionMountId: entry.mountPointId,
      params: result.params,
      rollForm: result.rollForm,
      ...(result.notation ? { notation: result.notation } : {}),
      raw: result.raw,
      ...(result.diceRolls ? { diceRolls: result.diceRolls } : {}),
      value: result.value,
      state: result.state,
      outcomeIndex: result.outcomeIndex,
      invokedBy: 'llm',
      ...(context.callerParticipantId ? { callerParticipantId: context.callerParticipantId } : {}),
    },
  });

  if (posted) {
    context.onPosted?.(posted);
  } else {
    // The roll was real but the announcement did not land. Say so rather than
    // letting the model narrate an outcome the transcript has no record of.
    return reportFailure(
      context,
      toolName,
      'the outcome could not be posted to the chat',
      whispered
    );
  }

  logger.info('Custom tool run completed', {
    context: CONTEXT,
    userId: context.userId,
    chatId: context.chatId,
    tool: result.tool,
    tier: entry.tier,
    rollForm: result.rollForm,
    value: result.value,
    state: result.state,
    outcomeIndex: result.outcomeIndex,
    whispered,
  });

  return {
    success: true,
    tool: result.tool,
    value: result.value,
    state: result.state,
    message: result.message,
    whispered,
  };
}

/**
 * Format a run_custom result for the model's context.
 *
 * Deliberately terse: the model already has the outcome message, and Pascal's
 * bubble is what the scene reads.
 */
export function formatRunCustomResults(output: RunCustomToolOutput): string {
  if (!output.success) {
    return `Custom tool error: ${output.error || 'Unknown error'}`;
  }
  const whisper = output.whispered ? ' (whispered — only you saw this)' : '';
  return `${output.tool}: ${output.message} [${output.state}]${whisper}`;
}
