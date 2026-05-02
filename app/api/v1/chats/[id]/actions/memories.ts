/**
 * Chats API v1 - Memory Actions
 *
 * - queue-memories: enqueues one per-turn MEMORY_EXTRACTION job for every
 *   USER message in the chat. Each job rebuilds the turn transcript at
 *   execution time and runs user / self / inter-character extraction passes.
 *
 * - extract-memories-dry-run: walks every USER turn inline, runs the same
 *   per-turn extraction passes with `dryRun: true`, and streams NDJSON
 *   progress to the client. Nothing is persisted — used by the
 *   `quilltap memory-diff` developer tool to compare current vs proposed
 *   extraction without touching the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest } from '@/lib/api/responses';
import { enqueueMemoryExtractionBatch, ensureProcessorRunning } from '@/lib/background-jobs';
import { processTurnForMemory } from '@/lib/memory/memory-processor';
import { buildTurnTranscript } from '@/lib/services/chat-message/turn-transcript';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import type {
  Character,
  ChatMetadata,
  ChatParticipantBase,
  MessageEvent,
} from '@/lib/schemas/types';

/**
 * Resolve the cheap-LLM connection profile id the user has configured for
 * memory extraction. Returns null when no valid profile is configured.
 */
async function resolveCheapLLMProfileId(
  ctx: AuthenticatedContext,
): Promise<string | null> {
  const { user, repos } = ctx;
  const chatSettings = await repos.chatSettings.findByUserId(user.id);
  const cheapLLMSettings = chatSettings?.cheapLLMSettings;

  if (cheapLLMSettings?.defaultCheapProfileId) {
    const profile = await repos.connections.findById(cheapLLMSettings.defaultCheapProfileId);
    if (profile && profile.userId === user.id) {
      return cheapLLMSettings.defaultCheapProfileId;
    }
  }

  if (cheapLLMSettings?.strategy === 'USER_DEFINED' && cheapLLMSettings?.userDefinedProfileId) {
    const profile = await repos.connections.findById(cheapLLMSettings.userDefinedProfileId);
    if (profile && profile.userId === user.id) {
      return cheapLLMSettings.userDefinedProfileId;
    }
  }

  return null;
}

/** Find the user-controlled character participant on a chat (single-user instance). */
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

/**
 * Queue per-turn memory extraction jobs for every USER message in the chat.
 *
 * The legacy version of this action accepted `characterId` / `characterName` /
 * `messagePairs` to scope the rerun to a specific character. Under the
 * per-turn model, each job covers the whole turn (every character that
 * spoke), so character scoping no longer applies — the legacy fields are
 * still accepted by the schema but ignored here.
 */
export async function handleQueueMemories(
  _req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  ctx: AuthenticatedContext,
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const connectionProfileId = await resolveCheapLLMProfileId(ctx);

  if (!connectionProfileId) {
    logger.warn('[Chats v1] No valid cheap LLM configured', { userId: user.id });
    return badRequest('No valid cheap LLM configured. Please set a cheap LLM profile in settings.');
  }

  // Walk chat history forward and enqueue one job per non-system USER message.
  // Each job covers the turn that opens at that user message (the handler
  // walks forward from there until the next USER to assemble the transcript).
  const messages = await repos.chats.getMessages(chatId);
  const turnOpenerIds: string[] = [];
  for (const m of messages) {
    if (m.type !== 'message') continue;
    const event = m as unknown as MessageEvent;
    if (event.role !== 'USER') continue;
    if (event.systemSender) continue;
    turnOpenerIds.push(event.id);
  }

  if (turnOpenerIds.length === 0) {
    return badRequest('No user messages found in this chat — nothing to extract memories from.');
  }

  logger.info('[Chats v1] Queueing per-turn memory extraction jobs', {
    chatId,
    turnCount: turnOpenerIds.length,
  });

  const jobIds = await enqueueMemoryExtractionBatch(
    user.id,
    chatId,
    connectionProfileId,
    turnOpenerIds,
    { priority: 0 },
  );

  ensureProcessorRunning();

  // Reference `chat` so the linter doesn't flag the unused param —
  // the chat metadata isn't needed under the per-turn model but the route
  // signature still receives it.
  void chat;

  return NextResponse.json({
    success: true,
    jobCount: jobIds.length,
    chatId,
    turnCount: turnOpenerIds.length,
  });
}

/**
 * Run the per-turn extraction pipeline against an existing chat without
 * persisting anything, streaming NDJSON progress events to the client.
 *
 * Wire format (one JSON object per line):
 *   { "type": "start", "chatId": "...", "turnCount": N }
 *   { "type": "turn", "index": i, "total": N, "sourceMessageId": "...",
 *     "candidatesAdded": K, "debugLogs": [...] }
 *   { "type": "candidate", "turnIndex": i, ...ExtractedCandidate }
 *   { "type": "turn-error", "index": i, "error": "..." }
 *   { "type": "done", "totalCandidates": M }
 *
 * No auth scoping beyond the route's existing authenticated middleware —
 * Quilltap is single-user per instance and this is a developer tool.
 */
export async function handleExtractMemoriesDryRun(
  _req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  ctx: AuthenticatedContext,
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const connectionProfileId = await resolveCheapLLMProfileId(ctx);

  if (!connectionProfileId) {
    return badRequest('No valid cheap LLM configured. Please set a cheap LLM profile in settings.');
  }

  const connectionProfile = await repos.connections.findById(connectionProfileId);
  if (!connectionProfile) {
    return badRequest(`Cheap LLM connection profile not found: ${connectionProfileId}`);
  }

  const chatSettings = await repos.chatSettings.findByUserId(user.id);
  if (!chatSettings) {
    return badRequest('Chat settings not found.');
  }

  const allRawMessages = await repos.chats.getMessages(chatId);
  const messageEvents = allRawMessages.filter(
    (m): m is MessageEvent => m.type === 'message',
  ) as unknown as MessageEvent[];

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

  const turnOpenerIds: string[] = [];
  for (const event of messageEvents) {
    if (event.role !== 'USER') continue;
    if (event.systemSender) continue;
    turnOpenerIds.push(event.id);
  }

  if (turnOpenerIds.length === 0) {
    return badRequest('No user messages found in this chat — nothing to extract memories from.');
  }

  const availableProfiles = await repos.connections.findByUserId(user.id);
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
  const isDangerousChat = chat.isDangerousChat === true;

  logger.info('[Chats v1] Streaming dry-run memory extraction', {
    chatId,
    turnCount: turnOpenerIds.length,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      try {
        send({ type: 'start', chatId, turnCount: turnOpenerIds.length });

        let totalCandidates = 0;

        for (let i = 0; i < turnOpenerIds.length; i++) {
          const turnOpenerMessageId = turnOpenerIds[i];
          try {
            const transcript = buildTurnTranscript(
              messageEvents,
              chat.participants,
              participantCharacters,
              {
                turnOpenerMessageId,
                userCharacterId: userCharacter?.id,
                userCharacterName: userCharacter?.name,
                userCharacterPronouns: userCharacter?.pronouns ?? null,
              },
            );

            if (transcript.characterSlices.length === 0) {
              send({
                type: 'turn',
                index: i,
                total: turnOpenerIds.length,
                sourceMessageId: turnOpenerMessageId,
                candidatesAdded: 0,
                debugLogs: ['[Memory] Turn has no character contributions — skipped'],
              });
              continue;
            }

            const result = await processTurnForMemory({
              transcript,
              participantCharacters,
              chatId,
              userId: user.id,
              connectionProfile,
              cheapLLMSettings: chatSettings.cheapLLMSettings,
              availableProfiles,
              dangerSettings,
              isDangerousChat,
              memoryExtractionLimits: chatSettings.memoryExtractionLimits,
              dryRun: true,
            });

            const candidates = result.extractedCandidates ?? [];
            for (const candidate of candidates) {
              send({ type: 'candidate', turnIndex: i, ...candidate });
            }
            totalCandidates += candidates.length;

            send({
              type: 'turn',
              index: i,
              total: turnOpenerIds.length,
              sourceMessageId: result.sourceMessageId,
              candidatesAdded: candidates.length,
              debugLogs: result.debugLogs,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn('[Chats v1] Dry-run turn failed', { chatId, turnOpenerMessageId, error: message });
            send({
              type: 'turn-error',
              index: i,
              total: turnOpenerIds.length,
              sourceMessageId: turnOpenerMessageId,
              error: message,
            });
          }
        }

        send({ type: 'done', totalCandidates });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[Chats v1] Dry-run stream failed', { chatId }, err instanceof Error ? err : undefined);
        try {
          send({ type: 'fatal', error: message });
        } catch {
          // controller might already be closed
        }
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
