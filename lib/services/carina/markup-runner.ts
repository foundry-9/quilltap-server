/**
 * Carina inline-markup runner — the shared `@Name:` / `@Name?` handling that both
 * the user-message path (the orchestrator) and the assistant-markup path (the
 * message finalizer) drive.
 *
 * Each path scans a piece of text for Carina markup, fires the isolated reference
 * query, surfaces the answer live, and routes a failure through Prospero. The
 * only differences are caller-side: the user-message path emits a "Consulting…"
 * status first and splices a public answer into the in-flight turn; the
 * assistant-markup path does neither, and the two word their log lines
 * differently. Those variations are passed in as callbacks and labels so the one
 * implementation here stays the single source of truth for markup handling.
 */

import { logger } from '@/lib/logger';
import { parseCarinaQuery } from '@/lib/chat/carina-parser';
import { runCarinaQuery } from './carina.service';
import { postProsperoCarinaError } from '@/lib/services/prospero-notifications/writer';
import type { MessageEvent } from '@/lib/schemas/types';

export interface CarinaMarkupLogLabels {
  /** Fills "Carina query detected in <detected>" (e.g. `'user message'`). */
  detected: string;
  /** Fills "Carina <failed> query failed" (e.g. `'user-message'`). */
  failed: string;
}

export interface CarinaMarkupOptions {
  userId: string;
  chatId: string;
  /** Text to scan for `@Name:` / `@Name?` markup. */
  text: string;
  /**
   * Asker participant id: the user's persona for the user-message path, the
   * responding character's participant for the assistant-markup path. Becomes
   * both the whisper target and the error attribution. null when unavailable.
   */
  askerParticipantId: string | null;
  /**
   * The human operator typed this markup (user-message path) — they can reach any
   * character regardless of their persona's Carina flag. Also gates whether the
   * detection log records the operator's userId, matching the original paths.
   */
  operatorInitiated?: boolean;
  /** Log labels for the detection/failure lines (the two paths word them differently). */
  logLabels: CarinaMarkupLogLabels;
  /**
   * Surface the posted answer live over the caller's SSE stream the instant it
   * persists, before the turn's own done/refresh event. Must never throw.
   */
  onPosted?: (message: MessageEvent) => void;
  /**
   * Called once, before the query runs, with the answerer's name — the
   * user-message path emits a "Consulting <name>…" status event here.
   */
  onConsulting?: (characterName: string) => void;
  /**
   * Called with a successful PUBLIC (non-whisper) answer message — the
   * user-message path splices it into the in-flight turn so the first responder
   * hears it. A whisper answer is scoped to the asker and never delivered here.
   */
  onPublicAnswer?: (message: MessageEvent) => void;
}

/**
 * Detect Carina markup in `text` and, if present, run the isolated reference
 * query: emit the optional "Consulting…" status, post the answer (surfaced live
 * via `onPosted`), splice a public answer via `onPublicAnswer`, and route any
 * failure through Prospero. Missing markup is a no-op. Never throws — a failed
 * Carina side-effect must not sink the turn that triggered it.
 */
export async function runCarinaMarkupQuery(opts: CarinaMarkupOptions): Promise<void> {
  const carinaQuery = parseCarinaQuery(opts.text);
  if (!carinaQuery) return;

  logger.info(`Carina query detected in ${opts.logLabels.detected}`, {
    chatId: opts.chatId,
    // The user-message path logged the operator's userId; the assistant path did not.
    ...(opts.operatorInitiated ? { userId: opts.userId } : {}),
    answerer: carinaQuery.characterName,
    whisper: carinaQuery.whisper,
  });

  opts.onConsulting?.(carinaQuery.characterName);

  try {
    const carinaResult = await runCarinaQuery({
      userId: opts.userId,
      chatId: opts.chatId,
      characterName: carinaQuery.characterName,
      question: carinaQuery.question,
      whisper: carinaQuery.whisper,
      askerParticipantId: opts.askerParticipantId,
      operatorInitiated: opts.operatorInitiated,
      onPosted: opts.onPosted,
    });
    if (carinaResult.ok) {
      // Splice a PUBLIC answer into the live turn; whispers stay scoped to the asker.
      if (!carinaQuery.whisper) opts.onPublicAnswer?.(carinaResult.message);
    } else {
      await postProsperoCarinaError({
        chatId: opts.chatId,
        kind: carinaResult.error.kind,
        characterName: carinaResult.error.characterName,
        detail: carinaResult.error.detail,
        whisper: carinaQuery.whisper,
        askerParticipantId: opts.askerParticipantId,
      });
    }
  } catch (carinaError) {
    logger.warn(`Carina ${opts.logLabels.failed} query failed`, {
      chatId: opts.chatId,
      error: carinaError instanceof Error ? carinaError.message : String(carinaError),
    });
  }
}
