/**
 * Writer for Pascal the Croupier's custom-tool outcomes.
 *
 * When a custom tool is run — by a character via `run_custom`, or by the
 * operator from the manual popup — Pascal announces the outcome as a synthetic
 * ASSISTANT message tagged `systemSender: 'pascal'` /
 * `systemKind: 'custom-tool-result'`. The `pascalMeta` payload preserves the
 * whole provenance of the deal (definition tier, resolved params, the raw roll
 * and its dice, the transformed value, the outcome that matched) so the table
 * can be audited long after the felt is cleared.
 *
 * **Pascal only ever announces genuine outcomes.** A run that fails — an
 * unknown tool, a rejected parameter, a definition that would not load — is
 * reported by Prospero (`systemKind: 'custom-tool-error'`, see
 * `lib/services/prospero-notifications/writer.ts`), never by Pascal. A Pascal
 * message in the transcript therefore always means the dice truly fell.
 *
 * Opacity: Pascal is a named member of the Staff, so an opaque character (one
 * whose `systemTransparency !== true`) must not read his name or his flourishes.
 * Unlike Suparṇā and Carina — whose bodies carry no persona framing and so set
 * `opaqueContent = content` — Pascal's visible body IS framed, so we build a
 * genuinely different, plainly-worded `System: …` body for the opaque swap. The
 * author's own outcome `message` is rendered VERBATIM in both: the framing is
 * ours to voice, the outcome is not.
 *
 * Errors never propagate — a failure to announce is logged and surfaced to the
 * caller as null rather than thrown.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { formatValue } from '@/lib/pascal/custom-tools';
import type { MessageEvent } from '@/lib/schemas/types';

const CONTEXT = 'pascal';

/** The provenance payload persisted alongside a Pascal outcome message. */
export type PascalMeta = NonNullable<NonNullable<MessageEvent['pascalMeta']>>;

export interface BuildPascalResultContentParams {
  /** Declaration name of the tool that was run, e.g. `unlock`. */
  toolName: string;
  /** The author's rendered outcome message. Emitted VERBATIM, never revoiced. */
  message: string;
  /** Post-transform value the outcome table tested. */
  value: number;
  /** Which roll form the definition declared. */
  rollForm: 'range' | 'dice';
  /** Dice breakdown (e.g. `3d6+2: [4, 2, 6] + 2 = 14`), or '' for the range form. */
  diceBreakdown?: string;
  /** Who reached for the tool: a character (`llm`) or the operator (`user`). */
  invokedBy: 'llm' | 'user';
  /** Display name of the operator — used only for the manual (`user`) attribution. */
  userName?: string | null;
}

/**
 * The parenthetical that shows what fell. The dice form prefers its breakdown —
 * `[4, 2, 6] + 2 = 14` tells the table far more than a bare `14` — and the range
 * form has nothing to show but the value itself.
 */
function formatRollSuffix(params: BuildPascalResultContentParams): string {
  const breakdown = params.diceBreakdown?.trim();
  if (params.rollForm === 'dice' && breakdown) return breakdown;
  return formatValue(params.value);
}

/**
 * Build both bodies for an outcome announcement: the visible one in Pascal's
 * voice, and the plain one an opaque character reads in its place. The author's
 * `message` is identical in each — only the framing around it differs.
 */
export function buildPascalResultContent(
  params: BuildPascalResultContentParams,
): { content: string; opaqueContent: string } {
  const roll = formatRollSuffix(params);
  const message = params.message.trim();

  const manual = params.invokedBy === 'user';
  const patron = params.userName?.trim() || 'the house';

  const content = manual
    ? `🎲 **${params.toolName}** — At ${patron}'s behest, Pascal spins the wheel: ${message} *(rolled ${roll})*`
    : `🎲 **${params.toolName}** — ${message} *(rolled ${roll})*`;

  const opaqueContent = manual
    ? `System: Custom tool "${params.toolName}" was run at ${patron}'s request. ${message} (rolled ${roll})`
    : `System: Custom tool "${params.toolName}" was run. ${message} (rolled ${roll})`;

  return { content, opaqueContent };
}

export interface PostPascalResultParams {
  chatId: string;
  /** Persona-voiced body (from {@link buildPascalResultContent}). */
  content: string;
  /** Plain body swapped in for opaque characters (from {@link buildPascalResultContent}). */
  opaqueContent: string;
  /** Provenance of the run — the whole deal, for later audit. */
  pascalMeta: PascalMeta;
  /**
   * When set and non-empty, the outcome is whispered only to these participants
   * (a private run). null/undefined = the whole room sees it.
   */
  targetParticipantIds?: string[] | null;
}

/**
 * Persist a Pascal outcome announcement. Returns the posted message (so callers
 * can splice it into the current turn's in-memory context and surface it over
 * SSE), or null on failure — logged, never thrown.
 */
export async function postPascalResult(
  params: PostPascalResultParams,
): Promise<MessageEvent | null> {
  const { chatId, content, opaqueContent, pascalMeta, targetParticipantIds } = params;

  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      logger.debug('Pascal outcome dropped — no such chat', { context: CONTEXT, chatId, tool: pascalMeta.tool });
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      opaqueContent,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'pascal',
      systemKind: 'custom-tool-result',
      targetParticipantIds: targetParticipantIds && targetParticipantIds.length ? targetParticipantIds : null,
      pascalMeta,
    };

    logger.debug('Posting Pascal outcome', {
      context: CONTEXT,
      chatId,
      messageId,
      tool: pascalMeta.tool,
      rollForm: pascalMeta.rollForm,
      state: pascalMeta.state,
      invokedBy: pascalMeta.invokedBy,
    });

    await repos.chats.addMessage(chatId, message);

    logger.info('[Pascal] Custom-tool outcome posted', {
      context: CONTEXT,
      chatId,
      messageId,
      tool: pascalMeta.tool,
      state: pascalMeta.state,
      whispered: Boolean(message.targetParticipantIds),
    });

    return message;
  } catch (error) {
    logger.error('[Pascal] Failed to post custom-tool outcome', {
      context: CONTEXT,
      chatId,
      tool: pascalMeta.tool,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}
