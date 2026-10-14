/**
 * Chats API v1 - Memory Actions
 *
 * - queue-memories: enqueues one MEMORY_EXTRACTION turn job for every turn of
 *   the chat (`listExtractionTurns`). Each job rebuilds its turn transcript at
 *   execution time and runs the turn passes.
 *
 * - extract-memories-dry-run: runs the chat through the extraction pipeline
 *   with `dryRun: true` (`runExtractionDryRun`) — every turn, then both fold
 *   passes over the history a regenerate would rebuild — and streams NDJSON
 *   progress. Nothing is written; admission decides and reports. Used by the
 *   `quilltap memory-diff` developer tool.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest } from '@/lib/api/responses';
import { enqueueMemoryExtractionBatch, ensureProcessorRunning } from '@/lib/background-jobs';
import {
  buildExtractionContext,
  ExtractionContextError,
  pickExtractionConnectionProfileId,
  runExtractionDryRun,
  toExtractedCandidate,
} from '@/lib/memory/extraction';
import { listExtractionTurns, loadChatMessageEvents } from '@/lib/services/chat-message/turn-transcript';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types';

/**
 * The connection profile a chat's extraction runs against — the same one the
 * live pipeline uses: an LLM seat's profile, else any seat's. A chat with no
 * seat profile falls back to the user's configured cheap profile. Null when
 * neither exists.
 */
async function resolveExtractionProfileId(
  chat: ChatMetadata,
  ctx: RequestContext,
): Promise<string | null> {
  const seatProfileId = pickExtractionConnectionProfileId(chat);
  if (seatProfileId) return seatProfileId;

  const { user, repos } = ctx;
  const cheapLLMSettings = (await repos.chatSettings.findByUserId(user.id))?.cheapLLMSettings;
  for (const id of [
    cheapLLMSettings?.defaultCheapProfileId,
    cheapLLMSettings?.strategy === 'USER_DEFINED' ? cheapLLMSettings.userDefinedProfileId : null,
  ]) {
    if (!id) continue;
    const profile = await repos.connections.findById(id);
    if (profile && profile.userId === user.id) return id;
  }
  return null;
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
  ctx: RequestContext,
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const connectionProfileId = await resolveExtractionProfileId(chat, ctx);

  if (!connectionProfileId) {
    logger.warn('[Chats v1] No connection profile for memory extraction', { userId: user.id, chatId });
    return badRequest('No connection profile available for memory extraction. Give a seat a profile or set a cheap LLM profile in settings.');
  }

  const messages = await loadChatMessageEvents(chatId);
  const isAutonomous = chat.chatType === 'autonomous';
  const batchEntries = listExtractionTurns(messages, chat.chatType);

  if (batchEntries.length === 0) {
    return badRequest(
      isAutonomous
        ? 'No assistant messages found in this chat — nothing to extract memories from.'
        : 'No messages found in this chat — nothing to extract memories from.',
    );
  }

  logger.info('[Chats v1] Queueing per-turn memory extraction jobs', {
    chatId,
    chatType: chat.chatType ?? null,
    turnCount: batchEntries.length,
  });

  const jobIds = await enqueueMemoryExtractionBatch(
    user.id,
    chatId,
    connectionProfileId,
    batchEntries,
    { priority: 0 },
  );

  ensureProcessorRunning();

  return NextResponse.json({
    success: true,
    jobCount: jobIds.length,
    chatId,
    turnCount: batchEntries.length,
  });
}

/**
 * Run the chat through the extraction pipeline without writing anything,
 * streaming NDJSON progress events to the client.
 *
 * Wire format (one JSON object per line):
 *   { "type": "start", "chatId": "...", "turnCount": N, "concurrency": C }
 *   { "type": "candidate", "turnIndex": i, ...ExtractedCandidate }
 *   { "type": "turn", "index": i, "total": N, "sourceMessageId": "...",
 *     "candidatesAdded": K, "debugLogs": [...] }
 *   { "type": "turn-error", "index": i, "error": "..." }
 *   { "type": "candidate", "turnIndex": null, "foldPass": "other-fold", ...ExtractedCandidate }
 *   { "type": "fold", "pass": "other-fold" | "episode-fold", "slices": S,
 *     "skippedReason": null, "candidatesAdded": K, "debugLogs": [...] }
 *   { "type": "done", "totalCandidates": M }
 *
 * Each candidate carries `extractionPass` (its provenance) and `decision`
 * (what admission would do: insert, reinforce, absorb, …).
 *
 * No auth scoping beyond the route's existing authenticated middleware —
 * Quilltap is single-user per instance and this is a developer tool.
 */
export async function handleExtractMemoriesDryRun(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  ctx: RequestContext,
): Promise<NextResponse> {
  const { user } = ctx;
  const connectionProfileId = await resolveExtractionProfileId(chat, ctx);

  if (!connectionProfileId) {
    return badRequest('No connection profile available for memory extraction. Give a seat a profile or set a cheap LLM profile in settings.');
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

  // The live pipeline's own context, in dry-run mode: same profile, same
  // route, same clock, same project and summary, autonomous rooms included.
  let extraction;
  try {
    extraction = await buildExtractionContext(chatId, user.id, { chat, connectionProfileId, dryRun: true, backfill: true });
  } catch (error) {
    if (error instanceof ExtractionContextError) return badRequest(error.message);
    throw error;
  }

  logger.info('[Chats v1] Streaming dry-run memory extraction', {
    chatId,
    concurrency,
    connectionProfileId,
    projectId: extraction.project.id,
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
        let turnCount = 0;
        const { candidates } = await runExtractionDryRun(extraction, {
          concurrency,
          hooks: {
            isCancelled: () => closed,
            onStart: (count) => {
              turnCount = count;
              send({ type: 'start', chatId, turnCount: count, concurrency });
            },
            onTurn: (index, total, result) => {
              const turnCandidates = result.admitted.map(toExtractedCandidate);
              for (const candidate of turnCandidates) send({ type: 'candidate', turnIndex: index, ...candidate });
              send({
                type: 'turn',
                index,
                total,
                sourceMessageId: result.sourceMessageId,
                candidatesAdded: turnCandidates.length,
                debugLogs: result.debugLogs,
              });
            },
            onTurnError: (index, total, sourceMessageId, error) => {
              send({ type: 'turn-error', index, total, sourceMessageId, error });
            },
            onFold: (pass, result) => {
              const foldCandidates = result.admitted.map(toExtractedCandidate);
              for (const candidate of foldCandidates) send({ type: 'candidate', turnIndex: null, foldPass: pass, ...candidate });
              send({
                type: 'fold',
                pass,
                slices: result.slices,
                skippedReason: result.skippedReason ?? null,
                candidatesAdded: foldCandidates.length,
                debugLogs: result.debugLogs,
              });
            },
          },
        });
        logger.debug('[Chats v1] Dry-run stream finished', { chatId, turnCount, candidates });
        if (!closed) send({ type: 'done', totalCandidates: candidates });
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
