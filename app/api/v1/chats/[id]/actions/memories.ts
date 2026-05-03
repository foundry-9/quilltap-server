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
import { getMemoryExtractionLimits } from '@/lib/instance-settings';
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
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  ctx: AuthenticatedContext,
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const connectionProfileId = await resolveCheapLLMProfileId(ctx);

  if (!connectionProfileId) {
    return badRequest('No valid cheap LLM configured. Please set a cheap LLM profile in settings.');
  }

  // Bounded turn-parallelism. Defaults to 4: enough to give a noticeable
  // speedup against cloud providers without crushing a local Ollama. Cap
  // at 32 to keep the cheap-LLM provider from drowning even when the user
  // explicitly asks for more.
  const concurrencyParam = req.nextUrl.searchParams.get('concurrency');
  let concurrency = 4;
  if (concurrencyParam !== null) {
    const parsed = Number.parseInt(concurrencyParam, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return badRequest('concurrency must be a positive integer');
    }
    concurrency = Math.min(parsed, 32);
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
  const memoryExtractionLimits = await getMemoryExtractionLimits();

  logger.info('[Chats v1] Streaming dry-run memory extraction', {
    chatId,
    turnCount: turnOpenerIds.length,
    concurrency,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Defensive write: a controller closed mid-flight (client disconnect,
      // response timeout, dev-server reload) would otherwise throw on every
      // subsequent enqueue, cascade through the per-turn catch, and re-throw
      // out of the outer catch — flooding the logs with misleading
      // "Controller is already closed" turn failures. Tracking `closed` lets
      // the loop bail instead of running 30-60 s of LLM passes for output
      // that nobody will ever read.
      let closed = false;
      const send = (obj: unknown): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      // Heartbeat keeps the response from going quiet during the first turn's
      // LLM passes. Without it the underlying socket can be torn down before
      // the first `candidate`/`turn` event ever fires.
      const heartbeat = setInterval(() => {
        send({ type: 'ping', t: Date.now() });
      }, 5000);

      try {
        send({ type: 'start', chatId, turnCount: turnOpenerIds.length, concurrency });

        let totalCandidates = 0;

        // Process a single turn. The body is identical to the previous
        // serial loop body — extracting it into a function lets the worker
        // pool below pull turns concurrently without duplicating logic.
        const processTurn = async (i: number): Promise<void> => {
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
              return;
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
              memoryExtractionLimits,
              dryRun: true,
            });

            if (closed) return;
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
            if (closed) return;
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
        };

        // Worker pool: `concurrency` parallel pullers share a cursor over
        // turnOpenerIds. Each worker grabs the next index, awaits its turn,
        // then loops. Settles when the cursor is exhausted (or `closed`
        // flips). NDJSON output is interleaved across turns; the CLI sorts
        // by `index` when assembling the final extracted.json so this is
        // safe for the diff workflow.
        let nextIndex = 0;
        const worker = async (): Promise<void> => {
          while (!closed) {
            const i = nextIndex++;
            if (i >= turnOpenerIds.length) return;
            await processTurn(i);
          }
        };

        const workerCount = Math.min(concurrency, turnOpenerIds.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        if (!closed) send({ type: 'done', totalCandidates });
      } catch (err) {
        if (!closed) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error('[Chats v1] Dry-run stream failed', { chatId }, err instanceof Error ? err : undefined);
          send({ type: 'fatal', error: message });
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
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
