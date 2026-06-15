/**
 * Surface Post Office letters addressed to the OPERATOR's own character(s).
 *
 * The per-turn mail check in `context-manager.ts` only runs for the character
 * whose turn it is — i.e. an LLM-controlled participant. A user-controlled
 * participant never takes an LLM turn, so a letter delivered to the operator's
 * character would otherwise sit in its vault forever, `alerted: false`, with no
 * Suparṇā whisper ever posted.
 *
 * But the operator is always playing a character, and a letter to that
 * character is exactly as significant as a letter to any other — it's a whisper
 * from one character to the user-controlled one. So this sweeps every
 * user-controlled CHARACTER participant's vault for unannounced mail and posts a
 * Suparṇā whisper TARGETED at that participant's id. The Salon shows whispers
 * that target a user-controlled participant (so the operator sees it) while
 * keeping it private from the other characters. Unlike the LLM path it injects
 * NO LLM context: the operator's character makes no model call.
 *
 * Called from two places (see callers): the chat-load GET (so an idle room with
 * pending mail surfaces the moment the operator opens it) and each turn's
 * `buildContext` (so a letter that arrives mid-session surfaces within a turn,
 * including autonomous rooms with no operator GET). `markAlerted` flips each
 * announced letter, so the two triggers — and repeated loads — never
 * double-announce. (A whisper is posted at most once per letter; the rare race
 * of two concurrent sweeps seeing the same unalerted letter is benign — worst
 * case a duplicate bubble — and mirrors the existing per-turn check.)
 *
 * Parent/child write boundary: posting a whisper (`addMessage`) and the
 * `alerted` flip (a content update routed through `writeDatabaseDocument`) both
 * go through the buffered write path, so this replays correctly from the forked
 * background-jobs child too — same as the per-turn check it complements.
 *
 * Warn-only: a mail failure must never break chat load or a turn.
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { getRepositories } from '@/lib/repositories/factory';
import { collectUnalertedMail, markAlerted } from '@/lib/post-office/mailbox';
import {
  buildSuparnaMailWhisper,
  postSuparnaMailWhisper,
} from '@/lib/services/suparna-notifications/writer';
import type { ChatParticipantBase, MessageEvent } from '@/lib/schemas/types';

/**
 * For every user-controlled character in {@link participants}, announce any
 * unalerted letters in that character's vault as a Suparṇā whisper targeted at
 * the participant. Returns the whispers actually posted (one per character with
 * fresh mail), for callers that want to forward them.
 */
export async function surfaceOperatorMailForChat(
  chatId: string,
  participants: ChatParticipantBase[],
): Promise<MessageEvent[]> {
  const posted: MessageEvent[] = [];

  const operatorParticipants = participants.filter(
    (p) => p.type === 'CHARACTER' && p.controlledBy === 'user' && !p.removedAt,
  );
  if (operatorParticipants.length === 0) return posted;

  const repos = getRepositories();

  for (const participant of operatorParticipants) {
    try {
      // Existence-only raw read: a hollow-but-present vault must not 503 the
      // chat load, and we only need the mount-point id.
      const character = await repos.characters.findByIdRaw(participant.characterId);
      const vaultId = character?.characterDocumentMountPointId ?? null;
      if (!vaultId) continue;

      const unalerted = await collectUnalertedMail(vaultId);
      if (unalerted.length === 0) continue;

      const message = await postSuparnaMailWhisper({
        chatId,
        targetParticipantId: participant.id,
        content: buildSuparnaMailWhisper(unalerted),
      });
      if (message) posted.push(message);

      for (const letter of unalerted) {
        await markAlerted(vaultId, letter.path);
      }

      logger.debug('[Suparna] Surfaced operator mail', {
        chatId,
        participantId: participant.id,
        characterId: participant.characterId,
        vaultId,
        count: unalerted.length,
      });
    } catch (error) {
      logger.warn('[Suparna] Operator mail surface failed; continuing', {
        chatId,
        participantId: participant.id,
        characterId: participant.characterId,
        error: getErrorMessage(error),
      });
    }
  }

  return posted;
}
