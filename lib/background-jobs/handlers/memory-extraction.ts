/**
 * Memory Extraction Job Handler — Per Turn
 *
 * Reads a turn-keyed payload (chatId + turnOpenerMessageId), rebuilds the
 * TurnTranscript from current chat state, and runs the per-turn memory
 * extraction pipeline. This replaces the prior per-assistant-message
 * handler, which fired once for every character response and re-extracted
 * the same user message N times in multi-character turns.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { processTurnForMemory } from '@/lib/memory/memory-processor';
import {
  buildTurnTranscript,
  type TurnTranscript,
} from '@/lib/services/chat-message/turn-transcript';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { createMemoryExtractionEvent } from '@/lib/services/system-events.service';
import { estimateMessageCost } from '@/lib/services/cost-estimation.service';
import type { Character, ChatParticipantBase, MessageEvent } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { getMemoryExtractionLimits } from '@/lib/instance-settings';
import type { MemoryExtractionPayload } from '../queue-service';

/**
 * Resolve the user-controlled character (if any) from the chat's participants.
 *
 * Quilltap is single-user per instance: at most one CHARACTER participant is
 * marked as the user persona. When no user-controlled character exists, the
 * OTHER pass simply omits the user from its subject set.
 */
function resolveUserCharacterParticipant(
  participants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>,
): { id: string; name: string; pronouns: Character['pronouns'] | null } | undefined {
  const userCharParticipant = participants.find(
    p => p.type === 'CHARACTER' && p.controlledBy === 'user' && p.characterId,
  );
  if (!userCharParticipant || userCharParticipant.type !== 'CHARACTER' || !userCharParticipant.characterId) {
    return undefined;
  }
  const character = participantCharacters.get(userCharParticipant.characterId);
  if (!character) return undefined;
  return { id: character.id, name: character.name, pronouns: character.pronouns ?? null };
}

export async function handleMemoryExtraction(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as MemoryExtractionPayload;
  const repos = getRepositories();

  const connectionProfile = await repos.connections.findById(payload.connectionProfileId);
  if (!connectionProfile) {
    throw new Error(`Connection profile not found: ${payload.connectionProfileId}`);
  }

  const chatSettings = await repos.chatSettings.findByUserId(job.userId);
  if (!chatSettings) {
    throw new Error(`Chat settings not found for user: ${job.userId}`);
  }

  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    logger.warn('[MemoryExtraction] Chat not found at job execution; skipping', {
      jobId: job.id,
      chatId: payload.chatId,
    });
    return;
  }

  const allRawMessages = await repos.chats.getMessages(payload.chatId);
  const messageEvents = allRawMessages.filter(
    (m): m is MessageEvent => m.type === 'message',
  ) as unknown as MessageEvent[];

  // Hydrate every CHARACTER participant's Character record so the transcript
  // builder can attach names + pronouns to each slice.
  const participantCharacters = new Map<string, Character>();
  for (const participant of chat.participants) {
    if (participant.type === 'CHARACTER' && participant.characterId) {
      const character = await repos.characters.findById(participant.characterId);
      if (character) {
        participantCharacters.set(participant.characterId, character);
      }
    }
  }

  const userCharacter = resolveUserCharacterParticipant(chat.participants, participantCharacters);

  const transcript: TurnTranscript = buildTurnTranscript(
    messageEvents,
    chat.participants,
    participantCharacters,
    {
      turnOpenerMessageId: payload.turnOpenerMessageId,
      userCharacterId: userCharacter?.id,
      userCharacterName: userCharacter?.name,
      userCharacterPronouns: userCharacter?.pronouns ?? null,
    },
  );

  if (transcript.characterSlices.length === 0) {
    logger.info('[MemoryExtraction] Turn has no character contributions; skipping', {
      jobId: job.id,
      chatId: payload.chatId,
      turnOpenerMessageId: payload.turnOpenerMessageId,
    });
    return;
  }

  const availableProfiles = await repos.connections.findByUserId(job.userId);
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
  const memoryExtractionLimits = await getMemoryExtractionLimits();

  // Anchor derived memories to the historical chat timestamp rather than
  // letting createdAt default to "now". Without this, a regenerate sweep
  // re-extracts a chat from 2025-08 and the new memory rows look like
  // they were written today — wrong for chronology, recency, and the
  // housekeeping signals that decay against age.
  //
  // Use the latest assistant message in the turn (matches the
  // sourceMessageId the processor will attach), falling back to the user
  // turn opener, then to the chat's own createdAt.
  let sourceMessageTimestamp: string | undefined;
  if (transcript.latestAssistantMessageId) {
    const m = messageEvents.find((m) => m.id === transcript.latestAssistantMessageId);
    sourceMessageTimestamp = m?.createdAt;
  }
  if (!sourceMessageTimestamp && payload.turnOpenerMessageId) {
    const m = messageEvents.find((m) => m.id === payload.turnOpenerMessageId);
    sourceMessageTimestamp = m?.createdAt;
  }
  if (!sourceMessageTimestamp) {
    sourceMessageTimestamp = chat.createdAt;
  }

  const result = await processTurnForMemory({
    transcript,
    participantCharacters,
    chatId: payload.chatId,
    userId: job.userId,
    connectionProfile,
    cheapLLMSettings: chatSettings.cheapLLMSettings,
    availableProfiles,
    dangerSettings,
    isDangerousChat: chat.isDangerousChat === true,
    memoryExtractionLimits,
    sourceMessageTimestamp,
  });

  if (!result.success) {
    logger.warn('[MemoryExtraction] Processing did not succeed', {
      jobId: job.id,
      chatId: payload.chatId,
      error: result.error,
    });
  } else {
    logger.info('[MemoryExtraction] Turn processed', {
      jobId: job.id,
      chatId: payload.chatId,
      turnOpenerMessageId: payload.turnOpenerMessageId,
      created: result.memoriesCreatedCount,
      reinforced: result.memoriesReinforcedCount,
    });
  }

  // Persist debug logs onto the latest assistant message of the turn so the
  // operator can pop the debug panel and see what the per-turn pass did.
  if (result.debugLogs.length > 0 && result.sourceMessageId) {
    try {
      await repos.chats.updateMessage(
        payload.chatId,
        result.sourceMessageId,
        { debugMemoryLogs: result.debugLogs },
      );
    } catch (e) {
      logger.warn('[MemoryExtraction] Failed to store debug logs', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Token-tracking event mirroring the prior per-message behaviour.
  if (result.usage.promptTokens || result.usage.completionTokens) {
    try {
      const costResult = await estimateMessageCost(
        connectionProfile.provider,
        connectionProfile.modelName,
        result.usage.promptTokens,
        result.usage.completionTokens,
        job.userId,
      );
      await createMemoryExtractionEvent(
        payload.chatId,
        result.usage,
        connectionProfile.provider,
        connectionProfile.modelName,
        costResult.cost,
      );
    } catch (e) {
      logger.warn('[MemoryExtraction] Failed to emit token tracking event', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
