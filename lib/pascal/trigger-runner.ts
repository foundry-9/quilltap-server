/**
 * Trigger phrases — the runner.
 *
 * When the chat setting `customToolTriggers` is on (it is off by default, and
 * dead while `customTools` is off), a message from anyone in the chat that
 * contains one of a custom tool's declared `triggers` phrases runs that tool,
 * with every parameter at its default, exactly as any other run: same roster
 * resolution, same cascade, same effects, same Pascal post, same Prospero
 * failure bubble. Design of record:
 * docs/developer/features/complete/pascal-trigger-phrases.md.
 *
 * Called from the two sites that already run the auto-RNG scan — the
 * operator's message in the orchestrator and the character's reply in the
 * finalizer — so only words someone said are ever scanned. Pascal's own
 * outcomes, Carina's answers and the staff's announcements never pass through
 * either, so none of them can fire a trigger.
 *
 * Cost, stated honestly: the phrases live in the definitions, and the
 * definitions live in the roster, so there is no cheaper pre-check than
 * resolving the roster once per message (with the setting on) and scanning it.
 * Rosters are resolved per call and never cached — a `.tool.json` edited
 * mid-chat must be live on the next message.
 *
 * Reads and buffered writes only, so it is safe in the forked job child
 * (autonomous rooms run the finalizer there). `onPosted` surfaces each post
 * over SSE; in the child the stream is a sink, so the call is a harmless no-op
 * and the post surfaces from the parent's commit, as a `run_custom` post or a
 * Carina answer does. **Never throws.**
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { getRepositories } from '@/lib/repositories/factory';
import { resolveCustomToolRoster } from '@/lib/pascal/custom-tools';
import { runCustomTool } from '@/lib/pascal/run-service';
import { scanTriggerPhrases } from '@/lib/pascal/trigger-phrases';
import { postProsperoCustomToolError } from '@/lib/services/prospero-notifications/writer';
import type { MessageEvent } from '@/lib/schemas/chat.types';
import type { ChatSettings } from '@/lib/schemas/settings.types';

const CONTEXT = 'pascal.trigger-runner';

export interface TriggeredSpeaker {
  /** The participant whose words these are — the whisper target for a private tool. */
  participantId: string | null;
  /** Their character, when the seat is a character (LLM-driven, user-driven or impersonated). null = the bare operator. */
  characterId: string | null;
}

export interface RunTriggeredCustomToolsParams {
  userId: string;
  chatId: string;
  /** The message text as persisted. */
  content: string;
  speaker: TriggeredSpeaker;
  projectId: string | null;
  /** Every character in the chat (the 'participant' tier). */
  characterIds: string[];
  /** The chat settings already in hand at the call site. */
  chatSettings: Pick<ChatSettings, 'customTools' | 'customToolTriggers'> | null | undefined;
  /** Surface each Pascal post the instant it lands (a no-op sink in the job child). */
  onPosted?: (message: MessageEvent) => void;
}

/** Whether a chat's settings let trigger phrases fire at all. */
export function triggersEnabled(
  chatSettings: Pick<ChatSettings, 'customTools' | 'customToolTriggers'> | null | undefined,
): boolean {
  return chatSettings?.customTools !== false && chatSettings?.customToolTriggers === true;
}

/** The Pascal messages that were posted, in firing order. [] when disabled, nothing matched, or every run failed. */
export async function runTriggeredCustomTools(params: RunTriggeredCustomToolsParams): Promise<MessageEvent[]> {
  // Gated off silently: a log here would fire on every message of every chat.
  if (!triggersEnabled(params.chatSettings) || !params.content?.trim()) return [];

  try {
    return await runTriggered(params);
  } catch (error) {
    logger.warn('Trigger-phrase scan failed; no custom tools fired', {
      context: CONTEXT,
      chatId: params.chatId,
      speakerParticipantId: params.speaker.participantId,
      error: getErrorMessage(error),
    });
    return [];
  }
}

async function runTriggered(params: RunTriggeredCustomToolsParams): Promise<MessageEvent[]> {
  const { userId, chatId, content, speaker } = params;
  const nowMs = Date.now();

  // Perspective: the speaker's. A character seat (LLM-driven, user-driven or
  // impersonated) brings its own fact sheet and vault tier; the bare operator
  // brings none — the "run nobody made" posture, under which availability
  // gates fail closed and effects that need a character skip.
  let metadata: Record<string, unknown> = {};
  let characterMountPointId: string | null = null;
  let characterName: string | null = null;
  if (speaker.characterId) {
    try {
      const character = await getRepositories().characters.findById(speaker.characterId);
      if (!character) {
        logger.warn('Trigger-phrase scan skipped — speaking character not found', {
          context: CONTEXT,
          chatId,
          characterId: speaker.characterId,
        });
        return [];
      }
      metadata = character.metadata ?? {};
      characterName = character.name ?? null;
      characterMountPointId = character.characterDocumentMountPointId ?? null;
    } catch (error) {
      // A broken vault (CharacterVaultUnavailableError) or any other read
      // failure. Nothing was asked for, so no Prospero bubble — just the log.
      logger.warn('Trigger-phrase scan skipped — speaking character unreadable', {
        context: CONTEXT,
        chatId,
        characterId: speaker.characterId,
        error: getErrorMessage(error),
      });
      return [];
    }
  }

  // Gates and `disabled` are honoured by the roster itself: a tool the speaker
  // cannot be dealt cannot be triggered by them.
  const roster = await resolveCustomToolRoster({
    userId,
    chatId,
    characterId: speaker.characterId,
    characterMountPointId,
    characterIds: params.characterIds,
    projectId: params.projectId,
    metadata,
  });

  const { hits, dropped } = scanTriggerPhrases(
    content,
    [...roster.tools.values()].map((entry) => entry.definition),
  );

  if (dropped.length > 0) {
    logger.warn('Trigger phrases over the per-message cap; later tools not fired', {
      context: CONTEXT,
      chatId,
      fired: hits.map((hit) => hit.tool),
      dropped: dropped.map((hit) => hit.tool),
    });
  }
  if (hits.length === 0) return [];

  // A private triggered roll is whispered to the speaker, as a private
  // `run_custom` is whispered to its caller; for the bare operator, to their
  // userId — the manual route's rule (a UUID no character's filter admits).
  const whisperTargetIds = speaker.participantId ? [speaker.participantId] : [userId];

  const posted: MessageEvent[] = [];
  for (const hit of hits) {
    const entry = roster.tools.get(hit.tool);
    if (!entry) continue;

    let outcome;
    try {
      outcome = await runCustomTool({
        userId,
        chatId,
        entry,
        parameters: null,
        private: undefined,
        characterId: speaker.characterId,
        metadata,
        characterName,
        whisperTargetIds,
        invokedBy: 'trigger',
        callerParticipantId: speaker.participantId,
        triggerPhrase: hit.phrase,
        nowMs,
      });
    } catch (error) {
      outcome = {
        ok: false as const,
        reason: getErrorMessage(error),
        whisper: entry.definition.defaultVisibility === 'whisper',
      };
    }

    if (!outcome.ok) {
      logger.debug('Triggered custom tool refused', {
        context: CONTEXT,
        chatId,
        tool: hit.tool,
        phrase: hit.phrase,
        reason: outcome.reason,
      });
      // Pascal never announces a run that did not happen — Prospero reports
      // it, exactly as for a model's refused `run_custom`. Then on to the next.
      await postProsperoCustomToolError({
        chatId,
        toolName: hit.tool,
        reason: outcome.reason,
        whisper: outcome.whisper,
        callerParticipantId: whisperTargetIds[0],
      });
      continue;
    }

    if (!outcome.posted) {
      // The roll was real (its effects stand) but the announcement did not
      // land — said, as the LLM entrance says it, rather than left silent.
      logger.debug('Triggered custom tool ran but its announcement did not land', {
        context: CONTEXT,
        chatId,
        tool: hit.tool,
      });
      const whispered = outcome.result.visibility === 'whisper';
      await postProsperoCustomToolError({
        chatId,
        toolName: hit.tool,
        reason: 'the outcome could not be posted to the chat',
        whisper: whispered,
        callerParticipantId: whisperTargetIds[0],
      });
      continue;
    }

    params.onPosted?.(outcome.posted);
    posted.push(outcome.posted);

    logger.info('Custom tool fired by trigger phrase', {
      context: CONTEXT,
      chatId,
      tool: hit.tool,
      phrase: hit.phrase,
      speakerParticipantId: speaker.participantId,
      invokedBy: 'trigger',
      state: outcome.result.state,
    });
  }

  return posted;
}
