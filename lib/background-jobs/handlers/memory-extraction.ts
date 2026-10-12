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
import { runFoldOtherCatchup } from '@/lib/memory/fold-other-pass';
import { runFoldEpisodeCatchup } from '@/lib/memory/fold-episode-catchup';
import { CheapLLMTaskLostError } from '@/lib/memory/cheap-llm-tasks';
import {
  buildTurnTranscript,
  resolveUserCharacterParticipant,
  type TurnTranscript,
} from '@/lib/services/chat-message/turn-transcript';
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service';
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override';
import { createMemoryExtractionEvent } from '@/lib/services/system-events.service';
import { estimateMessageCost } from '@/lib/services/cost-estimation.service';
import type { Character, MessageEvent } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { getMemoryExtractionLimits } from '@/lib/instance-settings';
import { loadExtractionProjectDescription } from '@/lib/memory/extraction-route';
import { enqueueMemoryExtraction, type MemoryExtractionPayload } from '../queue-service';

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

  // Idle catch-up for the fold episode pass (enqueued by the daily maintenance
  // sweep, bug 232): the folded history past the episode watermark.
  if (payload.foldEpisodeCatchup) {
    const availableProfiles = await repos.connections.findByUserId(job.userId);
    const catchup = await runFoldEpisodeCatchup({
      chatId: payload.chatId,
      userId: job.userId,
      connectionProfile,
      cheapLLMSettings: chatSettings.cheapLLMSettings,
      availableProfiles,
    });
    logger.info('[MemoryExtraction] Fold episode catch-up processed', {
      jobId: job.id,
      chatId: payload.chatId,
      skippedReason: catchup.skippedReason ?? null,
      episodes: catchup.episodesExtracted,
      written: catchup.memoriesWritten,
      fragmentsLinked: catchup.fragmentsLinked,
      watermarkAdvancedTo: catchup.watermarkAdvancedTo,
      slicesDeferred: catchup.slicesDeferred,
    });
    // A slice lost to a timeout was not read and the watermark stayed before
    // it: fail the job so it retries, as the OTHER catch-up does.
    if (catchup.timedOut) {
      throw new CheapLLMTaskLostError('fold-episode-catchup', 'an episode slice timed out');
    }
    // The rest of a long backlog is the next job's, keyed on the watermark
    // this one advanced to so successive steps never dedupe into each other.
    if (catchup.slicesDeferred > 0 && catchup.watermarkAdvancedTo) {
      await enqueueMemoryExtraction(job.userId, {
        chatId: payload.chatId,
        turnOpenerMessageId: null,
        extractionAnchorMessageId: `continue-episode:${catchup.watermarkAdvancedTo}`,
        connectionProfileId: payload.connectionProfileId,
        foldEpisodeCatchup: true,
      });
      logger.debug('[MemoryExtraction] Fold episode catch-up continues in a follow-up job', {
        jobId: job.id,
        chatId: payload.chatId,
        from: catchup.watermarkAdvancedTo,
        slicesDeferred: catchup.slicesDeferred,
      });
    }
    return;
  }

  // Idle catch-up for the fold-grain OTHER pass (enqueued by the daily
  // maintenance sweep): not a turn at all, so it never builds a transcript.
  if (payload.foldOtherCatchup) {
    const availableProfiles = await repos.connections.findByUserId(job.userId);
    const catchup = await runFoldOtherCatchup({
      chatId: payload.chatId,
      userId: job.userId,
      connectionProfile,
      cheapLLMSettings: chatSettings.cheapLLMSettings,
      availableProfiles,
      ignoreIdle: payload.foldOtherIgnoreIdle === true,
    });
    logger.info('[MemoryExtraction] Fold-grain OTHER catch-up processed', {
      jobId: job.id,
      chatId: payload.chatId,
      skippedReason: catchup.skippedReason ?? null,
      observers: catchup.observers,
      created: catchup.memoriesWritten,
      reinforced: catchup.memoriesReinforced,
      watermarkAdvancedTo: catchup.watermarkAdvancedTo,
      slicesDeferred: catchup.slicesDeferred,
    });
    // A pass lost to a timeout never happened and the watermark did not move:
    // fail the job so it retries (bug 107), rather than reporting a clean
    // finish over the hole.
    if (catchup.passesLostToTimeout > 0) {
      throw new CheapLLMTaskLostError('fold-other-catchup', `${catchup.passesLostToTimeout} pass(es) timed out`);
    }
    // One job reads a bounded number of slices. The rest of a long backlog is
    // the next job's, from the watermark this one advanced to — keyed on that
    // watermark so successive steps never dedupe into each other.
    if (catchup.slicesDeferred > 0 && catchup.watermarkAdvancedTo) {
      await enqueueMemoryExtraction(job.userId, {
        chatId: payload.chatId,
        turnOpenerMessageId: null,
        extractionAnchorMessageId: `continue:${catchup.watermarkAdvancedTo}`,
        connectionProfileId: payload.connectionProfileId,
        foldOtherCatchup: true,
        ...(payload.foldOtherIgnoreIdle ? { foldOtherIgnoreIdle: true } : {}),
      });
      logger.debug('[MemoryExtraction] Fold-grain OTHER catch-up continues in a follow-up job', {
        jobId: job.id,
        chatId: payload.chatId,
        from: catchup.watermarkAdvancedTo,
        slicesDeferred: catchup.slicesDeferred,
      });
    }
    return;
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
      extractionAnchorMessageId: payload.extractionAnchorMessageId ?? null,
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
  const conciergePolicy = resolveConciergeSettings(chatSettings, chat);
  const memoryExtractionLimits = await getMemoryExtractionLimits();

  // Orienting context (background only, never a memory source): the project's
  // description lets the extractor judge a memory's scope; the rolling chat
  // summary frames its temporal hinge. Both ride in the prompt footer. The
  // project lookup is guarded — a broken project store must not sink the whole
  // extraction, so we degrade to no project description.
  const chatContextSummary = chat.contextSummary ?? null;
  const projectDescription = await loadExtractionProjectDescription(chat.projectId, {
    jobId: job.id,
    chatId: payload.chatId,
  });
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
    projectId: chat.projectId ?? null,
    projectDescription,
    chatContextSummary,
    userId: job.userId,
    connectionProfile,
    cheapLLMSettings: chatSettings.cheapLLMSettings,
    availableProfiles,
    conciergePolicy,
    isDangerousChat: shouldUseUncensoredRoute(chat),
    memoryExtractionLimits,
    sourceMessageTimestamp,
    // Episodic spine: which clock the chat's story runs on (drives the
    // extraction CLOCK block and narrativeTime capture).
    timelineMode: chat.timelineMode ?? 'realtime',
    // 4.6 Private Character Rooms: autonomous-source attribution for the
    // extractor — the prompts get the user-absence clause and the resulting
    // memory rows carry witnessedContext = 'autonomous_room'.
    inAutonomousRoom: chat.chatType === 'autonomous',
  });

  // A pass lost to a timeout is work that never happened, and nothing
  // downstream re-queues it. Fail the job rather than let it report a clean
  // finish over the hole (bug 107): the child's writes are only applied on
  // success, so the backed-off retry re-runs the whole turn from the state
  // this attempt started in, and the extraction stays atomic. A refusal or an
  // unparseable answer would fail identically on every retry and keeps the old
  // log-and-move-on behaviour.
  if (result.passesLostToTimeout > 0) {
    logger.error('[MemoryExtraction] Extraction passes lost to a cheap-LLM timeout; failing the job for retry', {
      jobId: job.id,
      chatId: payload.chatId,
      passesLostToTimeout: result.passesLostToTimeout,
      error: result.error,
    });
    throw new CheapLLMTaskLostError('memory-extraction', result.error);
  }

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
      extractionAnchorMessageId: payload.extractionAnchorMessageId ?? null,
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
