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
 * **The croupier does not narrate.** The body is the tool's own title and the
 * author's own outcome message, and nothing else. Pascal once spoke here — "At
 * Charlie's behest, Pascal spins the wheel: …", with an italic *(rolled 14)*
 * suffix — and both are gone by request. What a roll says is the author's to
 * decide in their `.tool.json`: a table that wants its number shown puts
 * `{{value}}` or `{{dice}}` in the message. Nothing is lost by dropping the
 * suffix — the whole roll record (raw draw, dice faces, transform, which
 * outcome matched) is persisted in `pascalMeta` regardless.
 *
 * Opacity: this is why `opaqueContent === content` here. The dual body exists
 * to keep Staff NAMES out of an opaque character's context, and with the
 * flourishes gone there is no persona left to strip — the same position
 * Suparṇā and Carina are in. Both bodies are still populated, in lockstep, as
 * the `opaqueContent` contract asks (see `lib/schemas/chat.types.ts`).
 *
 * Pascal also keeps the Inventory (the game's furniture): when the operator
 * equips or unequips objects in a chat he posts one plain line per gesture
 * (`systemKind: 'inventory-change'`, {@link postPascalInventoryChange}). That
 * row carries **no** `pascalMeta` — it is not a roll, and nothing keyed on a
 * roll record (the outcome accent, the full-row roll bubble) may treat it as
 * one.
 *
 * Errors never propagate — a failure to announce is logged and surfaced to the
 * caller as null rather than thrown.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { MessageEvent } from '@/lib/schemas/types';

const CONTEXT = 'pascal';

/** The provenance payload persisted alongside a Pascal outcome message. */
export type PascalMeta = NonNullable<NonNullable<MessageEvent['pascalMeta']>>;

export interface BuildPascalResultContentParams {
  /**
   * Human-readable name of the tool that was run, e.g. `Scan Hawking Radiation`
   * — always from `displayTitle()`, never the raw declaration name. The
   * identity (`unlock`) lives on in `pascalMeta.tool` for audit; what the table
   * reads is prose.
   */
  toolTitle: string;
  /**
   * Rendered `chipLabel`, when the definition declares one — the header uses
   * it, same string as the chip, so transcript and chip never disagree.
   */
  chipLabel?: string;
  /** The author's rendered outcome message. Emitted VERBATIM, never revoiced. */
  message: string;
}

/**
 * Build the body of an outcome announcement: a heading line naming the run,
 * then the author's own message as its own paragraph. Both bodies are the same
 * string — see the note on opacity in the file header.
 *
 * The blank line is load-bearing: it makes the message its own Markdown block,
 * so an outcome that begins with `- `, `#`, `1.`, `>`, or a fence renders as
 * the list/heading/quote its author wrote instead of gluing inline to the bold
 * heading. (Messages posted before this change keep their one-line bodies —
 * content is frozen at post time, which is correct for a record.)
 *
 * Deliberately knows nothing about the roll. Who invoked it, what fell, and
 * what the parameters were are all matters for `pascalMeta`, not for the
 * scene: a table that wants its number read out says so with `{{value}}`.
 */
export function buildPascalResultContent(
  params: BuildPascalResultContentParams,
): { content: string; opaqueContent: string } {
  const heading = params.chipLabel?.trim() || params.toolTitle;
  const body = `🎲 **${heading}**\n\n${params.message.trim()}`;

  return { content: body, opaqueContent: body };
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
  /**
   * The tool's `announceAsCharacter`: the rolling character whose name and face
   * the bubble wears instead of Pascal's, through `customAnnouncer` — the one
   * field the Salon, the LLM context's speaker tag, the Courier and the
   * transcript export already read for "who is speaking this". The row stays
   * Pascal's (`systemSender`, `pascalMeta`), so nothing that keys on a Pascal
   * outcome — the chip, the trigger scan's blindness to it — changes.
   */
  announcerCharacterId?: string | null;
}

/**
 * Persist a Pascal outcome announcement. Returns the posted message (so callers
 * can splice it into the current turn's in-memory context and surface it over
 * SSE), or null on failure — logged, never thrown.
 */
export async function postPascalResult(
  params: PostPascalResultParams,
): Promise<MessageEvent | null> {
  const { chatId, content, opaqueContent, pascalMeta, targetParticipantIds, announcerCharacterId } = params;

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
      ...(announcerCharacterId
        ? { customAnnouncer: { kind: 'character' as const, characterId: announcerCharacterId } }
        : {}),
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[Pascal] Custom-tool outcome posted', {
      context: CONTEXT,
      chatId,
      messageId,
      tool: pascalMeta.tool,
      state: pascalMeta.state,
      whispered: Boolean(message.targetParticipantIds),
      announcerCharacterId: announcerCharacterId ?? null,
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

/** The `systemKind` of an Inventory change line. */
export const PASCAL_INVENTORY_CHANGE_KIND = 'inventory-change';

/**
 * Persist Pascal's one-line note of an Inventory change ("Vivienne takes up
 * Excalibur."). Public to the room, no roll record. Returns the posted
 * message, or null on failure — logged, never thrown.
 */
export async function postPascalInventoryChange(params: {
  chatId: string;
  content: string;
}): Promise<MessageEvent | null> {
  const { chatId, content } = params;
  try {
    const repos = getRepositories();
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      logger.debug('Pascal inventory line dropped — no such chat', { context: CONTEXT, chatId });
      return null;
    }
    const message: MessageEvent = {
      type: 'message',
      id: randomUUID(),
      role: 'ASSISTANT',
      content,
      opaqueContent: content,
      attachments: [],
      createdAt: new Date().toISOString(),
      participantId: null,
      systemSender: 'pascal',
      systemKind: PASCAL_INVENTORY_CHANGE_KIND,
      targetParticipantIds: null,
    };
    await repos.chats.addMessage(chatId, message);
    logger.info('[Pascal] Inventory change posted', { context: CONTEXT, chatId, messageId: message.id });
    return message;
  } catch (error) {
    logger.error('[Pascal] Failed to post inventory change', {
      context: CONTEXT,
      chatId,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}
