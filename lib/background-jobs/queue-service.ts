/**
 * Background Job Queue Service
 *
 * Provides functions to enqueue background jobs for processing.
 * Jobs are stored in the database and processed by the job processor.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { BackgroundJobType, type BackgroundJob, type BackgroundJobStatus } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';
import { MAINTENANCE_PHASES, type MaintenancePhase, type MaintenanceReason, type MaintenanceRunSettings } from '@/lib/memory/maintenance/types';
import type { QueueStats } from '@/lib/database/repositories';
import { ensureProcessorRunning } from './processor';
import { ACTIVITY_KINDS, emptyActivityCounts, type ActivityKind } from './activity-kinds';
import { getActivityCounts, getActivityStartTotals } from './activity-registry';
import { publishRealtime } from '@/lib/realtime/bus';
import {
  COMPLETED_JOB_RETENTION_DAYS,
  DEAD_JOB_RETENTION_DAYS,
  retentionCutoff,
} from './maintenance/retention-constants';

/**
 * Options for creating a job
 */
export interface EnqueueJobOptions {
  /** Higher priority jobs are processed first (default: 0) */
  priority?: number;
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** When the job should become eligible to run (default: now) */
  scheduledAt?: Date;
  /**
   * Skip the per-call dedup scan for enqueue helpers that own a precomputed
   * in-flight set. Set this when bulk-enqueuing many jobs in a tight loop —
   * e.g. the regenerate-chat handler enqueuing per-turn extractions, where
   * a per-call scan turns N enqueues into 2N DB queries.
   */
  skipDedupCheck?: boolean;
}

/**
 * Payload for per-turn memory extraction job.
 *
 * The handler rebuilds the TurnTranscript from chat state at execution time
 * (the chat is the source of truth — pre-serialising the transcript into
 * the job would just stale faster than the job drains). Dedup is keyed on
 * (chatId, turnOpenerMessageId, extractionAnchorMessageId, pass, cursor): the first
 * response of a turn enqueues the job; subsequent responses in the same
 * turn no-op against the existing pending job. The anchor field lets
 * autonomous chats (no USER openers) key each character's turn distinctly
 * — without it, every autonomous trigger would dedupe to (chatId, null).
 */
export interface MemoryExtractionPayload {
  chatId: string;
  /**
   * USER message ID that opened this turn. May be null for greeting-only,
   * continue/nudge turns, and autonomous chats where there's no fresh user
   * input — the handler skips the user-pass and runs only the self /
   * inter-character passes.
   */
  turnOpenerMessageId: string | null;
  /**
   * Optional terminal anchor: the ASSISTANT message ID that marks the end
   * of this turn's transcript window. When set, buildTurnTranscript stops
   * after collecting the message whose id matches, and the queue dedupes
   * on (chatId, turnOpenerMessageId, extractionAnchorMessageId) instead
   * of just the first two fields.
   *
   * Set this for autonomous chats so each speaker's turn becomes its own
   * job; leave undefined for normal salon chats where turnOpenerMessageId
   * is unique per turn already.
   */
  extractionAnchorMessageId?: string | null;
  /**
   * Lines at or before this message are context, not material (bug 245).
   * Set by a regenerate for an autonomous room (the previous speaker's
   * anchor); a live job leaves it unset and reads the chat's `turn` cursor.
   */
  extractAfterMessageId?: string | null;
  connectionProfileId: string;
  /**
   * The grain (memory refactor §3.7): `'turn'` (the default) runs the turn
   * passes over the turn the opener/anchor locate; `'other-fold'` and
   * `'episode-fold'` are a fold pass's catch-up over the chat's backlog past
   * that pass's cursor (enqueued by the daily maintenance sweep, a regenerate,
   * or a catch-up job that left slices unread).
   */
  pass?: MemoryExtractionPass;
  /**
   * Catch-ups: the cursor position the job was enqueued at — part of its
   * dedupe key, so a continuation never collapses into the job that enqueued
   * it. The job always reads the live cursor.
   */
  cursor?: string | null;
  /** Catch-ups: run even if the chat is not idle (a regenerate wants it now). */
  ignoreIdle?: boolean;
  /**
   * A rebuild of history (regenerate, queue-memories, SillyTavern import), not
   * live conversation: the extraction rate limit does not apply to it, and its
   * inserts do not count towards it. Without this a 100-turn regenerate would
   * hit the hourly cap after a handful of turns and lose every later turn.
   */
  backfill?: boolean;
  /** @deprecated Rows queued before Phase D: `pass: 'other-fold'`. Read by {@link memoryExtractionPassOf} only. */
  foldOtherCatchup?: boolean;
  /** @deprecated Rows queued before Phase D: `ignoreIdle`. */
  foldOtherIgnoreIdle?: boolean;
  /** @deprecated Rows queued before Phase D: `pass: 'episode-fold'`. */
  foldEpisodeCatchup?: boolean;
}

/** The grain a MEMORY_EXTRACTION job runs at. */
export type MemoryExtractionPass = 'turn' | 'other-fold' | 'episode-fold';

/** A payload's grain, reading the pre-Phase-D flags of rows still in the queue. */
export function memoryExtractionPassOf(payload: MemoryExtractionPayload): MemoryExtractionPass {
  if (payload.pass) return payload.pass;
  if (payload.foldEpisodeCatchup) return 'episode-fold';
  if (payload.foldOtherCatchup) return 'other-fold';
  return 'turn';
}

/**
 * Payload for a Carina memory-extraction job.
 *
 * Unlike the per-turn extractor, a Carina exchange is a single isolated Q&A:
 * the answerer (who may not even be a chat participant) is asked a question and
 * posts a `systemSender: 'carina'` reference answer. That message is excluded
 * from the normal per-turn transcript (every systemSender message is), so its
 * memories are formed through this dedicated path instead. The handler keys on
 * the posted carina message — its `content` is the answer, its
 * `carinaMeta.question` the prompt — and runs a one-slice SELF extraction for
 * the answerer.
 */
export interface CarinaMemoryExtractionPayload {
  chatId: string;
  /** The posted Carina reference-answer message (systemSender 'carina'). */
  carinaMessageId: string;
  /** The answerer character whose SELF memories this exchange forms. */
  answererId: string;
  /** Connection profile to source the cheap-LLM extractor from. */
  connectionProfileId: string;
}

/**
 * Payload for an established-fact memory job. A machine-delivered established
 * fact (a Host row, `systemKind: 'established-fact'`) has no speaker for LLM
 * extraction to interpret, so the handler admits it verbatim as one MANUAL
 * memory per non-removed LLM seat — absent and silent seats included.
 */
export interface EstablishedFactMemoriesPayload {
  chatId: string;
  /** The posted Host fact row. Its `content` is the fact. */
  messageId: string;
}

/**
 * Payload for context summary job
 */
export interface ContextSummaryPayload {
  chatId: string;
  connectionProfileId: string;
  forceRegenerate?: boolean;
}

/**
 * Payload for title update job
 */
export interface TitleUpdatePayload {
  chatId: string;
  connectionProfileId: string;
  currentInterchange: number;
}

/**
 * Payload for LLM log cleanup job
 */
export interface LLMLogCleanupPayload {
  userId: string;
  /** Optional: override the retention days from settings (for manual cleanup) */
  retentionDays?: number;
}

/**
 * Payload for embedding generate job
 */
export interface EmbeddingGeneratePayload {
  /** Type of entity being embedded */
  entityType: 'MEMORY' | 'CONVERSATION_CHUNK' | 'HELP_DOC' | 'MOUNT_CHUNK';
  /** ID of the entity (memory ID, conversation chunk ID, or help doc ID) */
  entityId: string;
  /** ID of the character (for memories) */
  characterId?: string;
  /** ID of the embedding profile to use */
  profileId: string;
  /** Chat ID (for conversation chunks) */
  chatId?: string;
}

/**
 * Payload for embedding refit job (TF-IDF vocabulary rebuild)
 */
export interface EmbeddingRefitPayload {
  /** ID of the embedding profile */
  profileId: string;
  /** Whether to enqueue reindex jobs after refit */
  triggerReindex?: boolean;
}

/**
 * Payload for embedding reindex all job
 */
export interface EmbeddingReindexAllPayload {
  /** ID of the embedding profile */
  profileId: string;
  /**
   * Selection scope. Defaults to `'all'` for backwards compatibility.
   *
   * - `'all'` (default): wipe and re-embed every memory, conversation chunk,
   *   and help doc. This is the path the manual "Re-embed Everything" button
   *   takes after a model swap.
   * - `'mismatched-dim'`: only re-embed rows whose stored embedding dim
   *   differs from the profile's target dim
   *   (`truncateToDimensions ?? dimensions`). Used to clean up orphans left
   *   behind by a previous embedding model without paying for a full reindex.
   *   Does not delete vector stores or cancel in-flight jobs.
   */
  scope?: 'all' | 'mismatched-dim';
}

/**
 * Payload for embedding re-apply-profile job (Matryoshka slice + renormalize)
 */
export interface EmbeddingReapplyProfilePayload {
  /** ID of the embedding profile whose truncateToDimensions + normalizeL2 will be applied */
  profileId: string;
}

/**
 * Payload for story background generation job
 */
export interface StoryBackgroundGenerationPayload {
  /** Chat ID to generate background for */
  chatId: string;
  /** Image profile ID to use for generation */
  imageProfileId: string;
  /** Character IDs participating in the chat */
  characterIds: string[];
  /** Optional scene context (e.g., chat title or summary) */
  sceneContext?: string;
  /** Optional project ID if the chat belongs to a project */
  projectId?: string | null;
  /**
   * "Try uncensored": paint on the Concierge's uncensored understudy instead
   * of `imageProfileId` (which is then only excluded from the lookup). Set by
   * `POST /api/v1/chats/[id]?action=retry-image-uncensored` with
   * `{ kind: 'background' }`. Never changes the chat's state.
   */
  forceUncensored?: boolean;
}

/**
 * Payload for character avatar generation job
 */
export interface CharacterAvatarGenerationPayload {
  /** Chat ID where the outfit changed */
  chatId: string;
  /** Character ID to generate avatar for */
  characterId: string;
  /** Image profile ID to use for generation */
  imageProfileId: string;
  /**
   * One-shot equipped-slots override: when set, the avatar prompt is built
   * from these slots instead of the chat's stored `equippedOutfit`. Used
   * when the user generates from a "fitting room" composition that does
   * not match what the character is actually wearing in the chat.
   */
  equippedSlotsOverride?: EquippedSlots | null;
  /**
   * Reroll: skip the avatar configuration cache and generate unconditionally,
   * rebinding the configuration's cache key to the new image. Set by the manual
   * regenerate button; automatic wardrobe-change triggers leave it unset so a
   * configuration that has already been drawn costs nothing to re-enter.
   */
  force?: boolean;
}

/**
 * Payload for a wardrobe item picture queued by a wardrobe tool. Tools only
 * create and edit character-owned items, so the container is always the
 * owning character's wardrobe.
 */
export interface WardrobeItemImageGenerationPayload {
  /** Chat the tool ran in — scopes the pending-job dedupe and the realtime hint, and its Concierge state governs the picture */
  chatId: string;
  /** The character whose wardrobe holds the item (the recipient, for a gift) */
  characterId: string;
  /** The wardrobe item to draw */
  itemId: string;
}

/**
 * Payload for chat danger classification job
 */
export interface ChatDangerClassificationPayload {
  chatId: string;
  connectionProfileId: string;
}

/**
 * Result of enqueueing a chat danger classification job
 */
export interface ChatDangerClassificationEnqueueResult {
  jobId: string;
  isNew: boolean;
}

/**
 * Payload for conversation render job (Scriptorium)
 */
export interface ConversationRenderPayload {
  chatId: string;
  /** If true, embed all interchange chunks (not just the newest). Used for on-demand re-render. */
  fullReembed?: boolean;
}

/**
 * Result of enqueueing a conversation render job
 */
export interface ConversationRenderEnqueueResult {
  jobId: string;
  isNew: boolean;
}

/**
 * Payload for a memory-maintenance job (memory refactor §3.9). One job per
 * character; the phases run in their fixed order.
 */
export interface MemoryMaintenancePayload {
  characterId: string;
  /** Phases asked for; omitted, every phase the settings allow. */
  phases?: MaintenancePhase[];
  /** Why the job was enqueued (for the ledger and logs). */
  reason: MaintenanceReason;
  /**
   * Phases asked for by hand, which run whatever the enabled switches and
   * per-phase toggles say. Set at enqueue: a manual request's phases (all of
   * them when it names none); empty for an automatic request.
   */
  exemptPhases?: MaintenancePhase[];
  /** Per-run overrides (a manual run's cluster threshold, say — bug 223). */
  settings?: MaintenanceRunSettings;
}

/**
 * Payload for the per-chat memory regenerate job.
 *
 * One job per chat. The handler wipes the chat's existing memories
 * (and their vector store entries), then enqueues one MEMORY_EXTRACTION
 * job per user-message turn opener. For greeting-only chats with no user
 * messages, it enqueues a single null-opener extraction.
 */
export interface MemoryRegenerateChatPayload {
  chatId: string;
  /** Connection profile to use for the extraction LLM passes — resolved at enqueue time. */
  connectionProfileId: string;
}

/**
 * Payload for the regenerate-all fan-out job.
 *
 * The HTTP handler returns immediately after enqueuing one of these. The
 * background processor then enumerates the user's chats, walks the memory
 * table for orphan chatIds, and enqueues one MEMORY_REGENERATE_CHAT per
 * chat. Doing the heavy enumeration here keeps the API response sub-second
 * even on instances with tens of thousands of memories.
 */
export interface MemoryRegenerateAllPayload {
  /** Standard cheap-LLM profile to use for non-dangerous chats. */
  standardProfileId: string;
  /** Profile to use for chats marked `isDangerousChat`; same as standardProfileId when no dangerous-compatible cheap LLM is configured. */
  dangerousProfileId: string;
}

/**
 * Payload for scene state tracking job
 */
export interface SceneStateTrackingPayload {
  chatId: string;
  characterIds: string[];
  connectionProfileId: string;
}

/**
 * Payload for an autonomous-room turn (4.6 Private Character Rooms).
 *
 * `runId` is matched against `chats.currentRunId` by the handler's stale-run
 * guard: a queued turn whose runId no longer matches a newer authoritative
 * run exits cleanly without enqueueing a successor.
 */
export interface AutonomousRoomTurnPayload {
  chatId: string;
  runId: string;
}

/**
 * Result of enqueueing a scene state tracking job
 */
export interface SceneStateTrackingEnqueueResult {
  jobId: string;
  isNew: boolean;
}

/**
 * Enqueue a chat danger classification job. The classifier reads the chat
 * when it runs, so a queued job absorbs the request and a running one does
 * not.
 */
export async function enqueueChatDangerClassification(
  userId: string,
  payload: ChatDangerClassificationPayload,
  options?: EnqueueJobOptions
): Promise<ChatDangerClassificationEnqueueResult> {
  return enqueueDeduped(userId, 'CHAT_DANGER_CLASSIFICATION', payload, {
    key: p => p.chatId,
    absorbs: 'pending',
    scope: 'chatId',
    label: 'ChatDangerClassification',
  }, {
    // Lower priority than interactive tasks
    priority: options?.priority ?? -1,
    ...options,
  });
}

/**
 * Enqueue a scene state tracking job. The tracker reads the chat when it
 * runs, so a queued job absorbs the request and a running one does not.
 */
export async function enqueueSceneStateTracking(
  userId: string,
  payload: SceneStateTrackingPayload,
  options?: EnqueueJobOptions
): Promise<SceneStateTrackingEnqueueResult> {
  return enqueueDeduped(userId, 'SCENE_STATE_TRACKING', payload, {
    key: p => p.chatId,
    absorbs: 'pending',
    scope: 'chatId',
    label: 'SceneStateTracking',
  }, {
    // Lower priority than interactive tasks
    priority: options?.priority ?? -1,
    ...options,
  });
}

/**
 * Enqueue a conversation render job (Scriptorium). The renderer reads the
 * chat when it runs, so a queued job absorbs the request and a running one
 * does not.
 */
export async function enqueueConversationRender(
  userId: string,
  payload: ConversationRenderPayload,
  options?: EnqueueJobOptions
): Promise<ConversationRenderEnqueueResult> {
  return enqueueDeduped(userId, 'CONVERSATION_RENDER', payload, {
    key: p => p.chatId,
    absorbs: 'pending',
    scope: 'chatId',
    label: 'ConversationRender',
  }, {
    // Lower priority than interactive tasks
    priority: options?.priority ?? -1,
    ...options,
  });
}

/**
 * Which jobs may absorb an enqueue — the one rule every deduped enqueue
 * states (refactor 4.13 §5.3).
 *
 * - `'pending'`: only a job not yet claimed. A handler that reads its inputs
 *   when it runs is covered by any queued job, but a job already PROCESSING
 *   has "missed the bus": it read them before this change, so the request
 *   needs a fresh job.
 * - `'active'`: a PROCESSING job absorbs it too. Only where a running job
 *   provably covers a later request (the request names something immutable,
 *   or a second run would repeat the first's work).
 */
export type DedupeAbsorbs = 'pending' | 'active';

export interface DedupeRule<P> {
  /** What makes two jobs "the same", computed on the queued payloads as well. */
  key: (payload: P) => string;
  /** Required, no default: see {@link DedupeAbsorbs}. */
  absorbs: DedupeAbsorbs;
  /**
   * Narrow the queue read to jobs whose payload carries the same value in
   * this field, so a busy type is not read whole on every enqueue. The key
   * must imply it.
   */
  scope?: 'chatId' | 'entityId';
  /** Log prefix. */
  label: string;
}

export interface DedupedEnqueueResult {
  jobId: string;
  isNew: boolean;
}

/**
 * Enqueue a job unless one that absorbs it is already queued, by the rule's
 * key and absorption rule. `options.skipDedupCheck` skips the read (for a
 * caller that owns its own in-flight set). A failed read enqueues anyway: a
 * duplicate job is wasteful, a lost one is not recoverable.
 */
export async function enqueueDeduped<P extends object>(
  userId: string,
  type: BackgroundJobType,
  payload: P,
  rule: DedupeRule<P>,
  options?: EnqueueJobOptions
): Promise<DedupedEnqueueResult> {
  if (!options?.skipDedupCheck) {
    try {
      const statuses: BackgroundJobStatus[] = rule.absorbs === 'active' ? ['PENDING', 'PROCESSING'] : ['PENDING'];
      const scopeValue = rule.scope ? (payload as Record<string, unknown>)[rule.scope] : undefined;
      const candidates = await getRepositories().backgroundJobs.findAbsorbers(type, statuses, {
        userId,
        ...(rule.scope && typeof scopeValue === 'string' ? { payloadField: rule.scope, payloadValue: scopeValue } : {}),
      });
      const wanted = rule.key(payload);
      const existing = candidates.find(job => rule.key(job.payload as unknown as P) === wanted);
      if (existing) {
        logger.debug(`[${rule.label}] Reusing a queued job`, {
          context: 'background-jobs.queue',
          type,
          key: wanted,
          absorbs: rule.absorbs,
          existingJobId: existing.id,
          existingStatus: existing.status,
        });
        return { jobId: existing.id, isNew: false };
      }
    } catch (error) {
      logger.warn(`[${rule.label}] Failed to check for existing jobs during enqueue`, {
        context: 'background-jobs.queue',
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through and enqueue anyway.
    }
  }

  const jobId = await enqueueJob(userId, type, payload as unknown as Record<string, unknown>, options);
  return { jobId, isNew: true };
}

/**
 * Enqueue a single background job
 */
export async function enqueueJob(
  userId: string,
  type: BackgroundJobType,
  payload: Record<string, unknown>,
  options?: EnqueueJobOptions
): Promise<string> {
  const repos = getRepositories();
  const now = new Date().toISOString();

  const job = await repos.backgroundJobs.create({
    userId,
    type,
    status: 'PENDING',
    payload,
    priority: options?.priority ?? 0,
    attempts: 0,
    maxAttempts: options?.maxAttempts ?? 3,
    lastError: null,
    scheduledAt: options?.scheduledAt?.toISOString() ?? now,
    startedAt: null,
    completedAt: null,
  });

  logger.info('Background job enqueued', { jobId: job.id, type, userId });

  // Tell every open tab the queue moved. The bus coalesces, so a batch of
  // enqueues arrives as one hint rather than one per job.
  publishRealtime('jobs');

  // Auto-start the processor when a job is enqueued
  ensureProcessorRunning();

  return job.id;
}

/**
 * Enqueue a per-turn memory extraction job.
 *
 * Dedupe key: (chatId, turnOpenerMessageId, extractionAnchorMessageId, pass,
 * cursor). The first character to finalize in a multi-character turn creates
 * the job; later characters' finalize calls fall through to dedup. Greeting /
 * continue turns (where turnOpenerMessageId is null and no anchor is set)
 * dedupe on (chatId, null, null) so a single extraction job covers the
 * greeting tail rather than producing one per assistant message. Autonomous
 * chats set extractionAnchorMessageId per speaker so successive triggers
 * don't collapse to the same null/null key.
 *
 * Absorbs `'active'`: a second job for the same key would extract the same
 * turn again and count its memories twice (admission is keyed per job
 * attempt, not per turn), so a running job stands for the turn.
 */
export async function enqueueMemoryExtraction(
  userId: string,
  payload: MemoryExtractionPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  const { jobId } = await enqueueDeduped(userId, 'MEMORY_EXTRACTION', payload, {
    key: p => JSON.stringify([
      p.chatId,
      p.turnOpenerMessageId ?? null,
      p.extractionAnchorMessageId ?? null,
      memoryExtractionPassOf(p),
      p.cursor ?? null,
    ]),
    absorbs: 'active',
    scope: 'chatId',
    label: 'MemoryExtraction',
  }, options);
  return jobId;
}

/**
 * Enqueue a Carina memory-extraction job for a single posted reference answer.
 *
 * Dedupe: keyed on the posted carina message id. Each Carina answer is a
 * distinct message, so this only guards against an accidental double-enqueue
 * for the same message (e.g. a retry of `runCarinaQuery`). The message does
 * not change, so a running job covers it (`'active'`). Works from both the
 * main process (markup path) and the forked child (the `ask_carina` tool during
 * an autonomous-room turn) — the child buffers the create back to the parent,
 * exactly as the per-turn extractor already does.
 */
export async function enqueueCarinaMemoryExtraction(
  userId: string,
  payload: CarinaMemoryExtractionPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  const { jobId } = await enqueueDeduped(userId, 'CARINA_MEMORY_EXTRACTION', payload, {
    key: p => p.carinaMessageId,
    absorbs: 'active',
    scope: 'chatId',
    label: 'CarinaMemoryExtraction',
  }, options);
  return jobId;
}

/**
 * Enqueue the memory job for a machine-delivered established fact. Runs once
 * per post: dedupe is keyed on the posted message id, which does not change,
 * so a running job covers it (`'active'`).
 */
export async function enqueueEstablishedFactMemories(
  userId: string,
  payload: EstablishedFactMemoriesPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  const { jobId } = await enqueueDeduped(userId, 'ESTABLISHED_FACT_MEMORIES', payload, {
    key: p => p.messageId,
    absorbs: 'active',
    scope: 'chatId',
    label: 'EstablishedFactMemories',
  }, options);
  return jobId;
}

/** Union two phase lists; `undefined` (every phase) absorbs anything. */
function unionPhases(a: MaintenancePhase[] | undefined, b: MaintenancePhase[] | undefined): MaintenancePhase[] | undefined {
  if (!a || !b) return undefined;
  return Array.from(new Set([...a, ...b]));
}

/**
 * The phases a request asks for by hand: they run whatever the enabled
 * switches and per-phase toggles say. A manual request exempts what it names
 * (every phase when it names none); an automatic one exempts nothing.
 */
function exemptPhasesOf(payload: MemoryMaintenancePayload): MaintenancePhase[] {
  if (payload.exemptPhases) return payload.exemptPhases;
  if (payload.reason !== 'manual') return [];
  return payload.phases ?? [...MAINTENANCE_PHASES];
}

/** Fold `payload` into a waiting job's payload. Each phase keeps its own exemption. */
function widenPayload(prior: MemoryMaintenancePayload, payload: MemoryMaintenancePayload): MemoryMaintenancePayload {
  const phases = unionPhases(prior.phases, payload.phases);
  const exemptPhases = Array.from(new Set([...exemptPhasesOf(prior), ...exemptPhasesOf(payload)]));
  const widened: MemoryMaintenancePayload = {
    ...prior,
    ...(phases ? { phases } : {}),
    // For the ledger and the logs only: what may skip the switches is `exemptPhases`.
    reason: payload.reason === 'manual' ? 'manual' : prior.reason,
    exemptPhases,
    ...(payload.settings ? { settings: { ...prior.settings, ...payload.settings } } : {}),
  };
  if (!phases) delete widened.phases;
  return widened;
}

/**
 * Enqueue (or widen) one character's maintenance job against an already-read
 * list of the user's PENDING maintenance jobs, which it keeps up to date.
 */
async function enqueueMaintenanceAgainst(
  userId: string,
  payload: MemoryMaintenancePayload,
  pending: BackgroundJob[] | null,
  options?: EnqueueJobOptions
): Promise<string> {
  const normalized: MemoryMaintenancePayload = { ...payload, exemptPhases: exemptPhasesOf(payload) };
  const existing = pending?.find(
    j => (j.payload as Record<string, unknown>).characterId === payload.characterId
  );
  if (existing) {
    const widened = widenPayload(existing.payload as unknown as MemoryMaintenancePayload, normalized);
    await getRepositories().backgroundJobs.update(existing.id, { payload: widened as unknown as Record<string, unknown> });
    existing.payload = widened as unknown as Record<string, unknown>;
    logger.debug('[Maintenance] Pending job widened to the requested phases', {
      characterId: payload.characterId,
      existingJobId: existing.id,
      phases: widened.phases ?? 'all',
      exemptPhases: widened.exemptPhases,
      reason: widened.reason,
    });
    return existing.id;
  }
  const id = await enqueueJob(
    userId,
    'MEMORY_MAINTENANCE',
    normalized as unknown as Record<string, unknown>,
    { ...options, maxAttempts: options?.maxAttempts ?? 1 },
  );
  pending?.push({ id, payload: normalized } as unknown as BackgroundJob);
  return id;
}

/** The user's PENDING maintenance jobs, or null when they cannot be read. */
async function findPendingMaintenance(userId: string, characterId?: string): Promise<BackgroundJob[] | null> {
  try {
    // PENDING only: a running maintenance job has already read the corpus.
    return await getRepositories().backgroundJobs.findAbsorbers('MEMORY_MAINTENANCE', ['PENDING'], { userId });
  } catch (error) {
    logger.warn('[Maintenance] Failed to check for pending jobs during enqueue', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    // A duplicate run is wasteful, not harmful.
    return null;
  }
}

/**
 * Enqueue memory maintenance for one character.
 *
 * Dedupe key is the character, whatever the reason (bug 221): a PENDING
 * maintenance job for the same character absorbs the request — it widens to
 * the phases asked for and adopts the requested overrides — so the daily
 * sweep, a watermark run and a manual run collapse into one job. Each phase
 * keeps its own exemption (`exemptPhases`): a manual request's phases run
 * whatever the switches say, an automatic request's never do, so merging
 * the two never lends a scheduled phase the manual exemption.
 *
 * A PROCESSING job never absorbs a request: it has already read the corpus
 * and may be past the phase asked for. A new PENDING job is created instead,
 * and the handler defers it while the running one finishes, so two runs
 * never work on one character at once.
 *
 * Retry-hostile: a rerun redoes every model call, and the next scheduled or
 * watermark pass picks up whatever this one left, so attempts default to 1.
 */
export async function enqueueMemoryMaintenance(
  userId: string,
  payload: MemoryMaintenancePayload,
  options?: EnqueueJobOptions
): Promise<string> {
  const pending = await findPendingMaintenance(userId, payload.characterId);
  return enqueueMaintenanceAgainst(userId, payload, pending, options);
}

/**
 * One maintenance job per listed character, each deduped per character, with
 * one read of the user's pending jobs for the whole batch. Returns every job
 * id, new or widened, without duplicates.
 */
export async function enqueueMemoryMaintenanceMany(
  userId: string,
  characterIds: readonly string[],
  payload: Omit<MemoryMaintenancePayload, 'characterId'>,
  options?: EnqueueJobOptions
): Promise<string[]> {
  const pending = await findPendingMaintenance(userId);
  const ids: string[] = [];
  for (const characterId of characterIds) {
    const id = await enqueueMaintenanceAgainst(userId, { ...payload, characterId }, pending, options);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * One maintenance job per live character the user owns (each deduped per
 * character). Returns every job id, new or widened.
 */
export async function enqueueMemoryMaintenanceForUser(
  userId: string,
  payload: Omit<MemoryMaintenancePayload, 'characterId'>,
  options?: EnqueueJobOptions
): Promise<string[]> {
  const characters = await getRepositories().characters.findByUserId(userId);
  const live = characters.filter(c => !c.archivedAt).map(c => c.id);
  const ids = await enqueueMemoryMaintenanceMany(userId, live, payload, options);
  logger.debug('[Maintenance] User-wide run fanned out per character', {
    userId,
    reason: payload.reason,
    characters: live.length,
    jobs: ids.length,
  });
  return ids;
}

/**
 * Payload for CHARACTER_HEADSHOULDERS_BACKFILL — generate a head-and-shoulders
 * portrait prompt for one character that lacks one.
 */
export interface CharacterHeadShouldersBackfillPayload {
  characterId: string;
}

/**
 * Enqueue a head-and-shoulders backfill job for a character.
 *
 * Dedupes on the character against PENDING and PROCESSING jobs (`'active'`):
 * the job fills a prompt the character lacks, and a second run would only
 * find it filled. Background priority (-1). Generation is idempotent, so
 * retries are harmless — callers may raise `maxAttempts` so a cold job child
 * (provider not yet ready) retries instead of giving up.
 */
export async function enqueueCharacterHeadShouldersBackfill(
  userId: string,
  payload: CharacterHeadShouldersBackfillPayload,
  options?: EnqueueJobOptions,
): Promise<DedupedEnqueueResult> {
  return enqueueDeduped(userId, 'CHARACTER_HEADSHOULDERS_BACKFILL', payload, {
    key: p => p.characterId,
    absorbs: 'active',
    label: 'HeadShouldersBackfill',
  }, { ...options, priority: options?.priority ?? -1 });
}

/**
 * Enqueue a per-chat memory regeneration job.
 *
 * Dedupes on the chat against PENDING and PROCESSING jobs (`'active'`): a
 * running regeneration is already wiping and re-queuing that chat, and a
 * second would wipe what the first just re-extracted.
 *
 * Capped at maxAttempts: 1 — a retry would double-enqueue the per-turn
 * extraction jobs spawned by the first attempt.
 */
export async function enqueueMemoryRegenerateChat(
  userId: string,
  payload: MemoryRegenerateChatPayload,
  options?: EnqueueJobOptions,
): Promise<string> {
  const { jobId } = await enqueueDeduped(userId, 'MEMORY_REGENERATE_CHAT', payload, {
    key: p => p.chatId,
    absorbs: 'active',
    scope: 'chatId',
    label: 'MemoryRegenerateChat',
  }, { ...options, maxAttempts: options?.maxAttempts ?? 1 });
  return jobId;
}

/**
 * Enqueue the regenerate-all fan-out job.
 *
 * The HTTP handler returns immediately after this; the actual chat
 * enumeration and per-chat enqueues happen inside the background job.
 *
 * One fan-out per user at a time (`'active'`): a running fan-out is already
 * enqueuing every chat. Capped at maxAttempts: 1 — a retry would re-enqueue
 * every per-chat wipe.
 */
export async function enqueueMemoryRegenerateAll(
  userId: string,
  payload: MemoryRegenerateAllPayload,
  options?: EnqueueJobOptions,
): Promise<DedupedEnqueueResult> {
  return enqueueDeduped(userId, 'MEMORY_REGENERATE_ALL', payload, {
    key: () => 'all',
    absorbs: 'active',
    label: 'MemoryRegenerateAll',
  }, { ...options, maxAttempts: options?.maxAttempts ?? 1 });
}

/**
 * Enqueue the conversation-summary regeneration job.
 *
 * Re-mirrors every summarized chat's context summary into its participant
 * character vaults (a backfill for the files the Commonplace Book's
 * relevant-conversations retrieval depends on, and a repair after format
 * changes). The HTTP handler returns immediately; the enumeration + per-chat
 * vault writes happen inside the background job.
 *
 * One regeneration per user at a time (`'active'`): a running one is already
 * walking every chat. Capped at maxAttempts: 1 — the work is idempotent, but
 * a retry would re-walk every chat.
 */
export async function enqueueRegenerateConversationSummaries(
  userId: string,
  options?: EnqueueJobOptions,
): Promise<DedupedEnqueueResult> {
  return enqueueDeduped(userId, 'REGENERATE_CONVERSATION_SUMMARIES', {}, {
    key: () => 'all',
    absorbs: 'active',
    label: 'RegenerateConversationSummaries',
  }, { ...options, maxAttempts: options?.maxAttempts ?? 1 });
}

/**
 * Enqueue a context summary job
 */
export async function enqueueContextSummary(
  userId: string,
  payload: ContextSummaryPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'CONTEXT_SUMMARY', payload as unknown as Record<string, unknown>, options);
}

/**
 * Enqueue a title update job.
 *
 * Dedupe: keyed on the chat against PENDING and PROCESSING jobs
 * (`'active'`). Multiple finalizer firings at the same interchange checkpoint
 * (multi-character turns, autonomous rooms re-firing every assistant turn)
 * are one request: the running job checks that checkpoint and advances the
 * chat's title cursor past it, and the next checkpoint fires again.
 */
export async function enqueueTitleUpdate(
  userId: string,
  payload: TitleUpdatePayload,
  options?: EnqueueJobOptions
): Promise<string> {
  const { jobId } = await enqueueDeduped(userId, 'TITLE_UPDATE', payload, {
    key: p => p.chatId,
    absorbs: 'active',
    scope: 'chatId',
    label: 'Title Update',
  }, options);
  return jobId;
}

/**
 * Enqueue an LLM log cleanup job
 */
export async function enqueueLLMLogCleanup(
  userId: string,
  payload: LLMLogCleanupPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'LLM_LOG_CLEANUP', payload as unknown as Record<string, unknown>, options);
}

/**
 * Enqueue an autonomous-room turn job (4.6 Private Character Rooms).
 *
 * Each turn re-enqueues itself if the run is still alive. The handler's
 * stale-run guard uses `payload.runId` against `chats.currentRunId` to drop
 * jobs left behind by superseded runs. No dedup here — multiple in-flight
 * turn jobs for the same chat is exactly the failure mode the guard catches.
 *
 * `maxAttempts: 1` because the per-room procedure already classifies fatal
 * vs non-fatal errors and decides whether to re-enqueue itself; the job
 * processor's automatic retry would muddle that lifecycle.
 */
export async function enqueueAutonomousRoomTurn(
  userId: string,
  payload: AutonomousRoomTurnPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(
    userId,
    'AUTONOMOUS_ROOM_TURN',
    payload as unknown as Record<string, unknown>,
    { ...options, maxAttempts: options?.maxAttempts ?? 1 },
  );
}

/**
 * Enqueue the autonomous-room scheduler tick (4.6 Private Character Rooms).
 *
 * Called once per minute by the parent-process timer in
 * `lib/background-jobs/scheduled-autonomous-rooms.ts`. A queued tick absorbs
 * the next one instead of stacking duplicate scans; a running tick has
 * already read the schedule, so it does not (`'pending'`).
 */
export async function enqueueAutonomousRoomScheduleTick(
  userId: string,
  options?: EnqueueJobOptions
): Promise<string> {
  const { jobId } = await enqueueDeduped(userId, 'AUTONOMOUS_ROOM_SCHEDULE_TICK', {}, {
    key: () => 'tick',
    absorbs: 'pending',
    label: 'AutonomousRoomScheduleTick',
  }, { ...options, maxAttempts: options?.maxAttempts ?? 1, priority: options?.priority ?? -1 });
  return jobId;
}

/**
 * Result of enqueueing an embedding generate job
 */
export interface EmbeddingGenerateEnqueueResult {
  jobId: string;
  isNew: boolean;
}

/**
 * Default priorities for embedding entity types.
 * Chat-related embeddings (memories, conversation chunks) run before
 * batch operations (document mount chunks, help docs) so that chat
 * responsiveness is never blocked by background indexing.
 */
const EMBEDDING_ENTITY_PRIORITIES: Record<EmbeddingGeneratePayload['entityType'], number> = {
  MEMORY: 10,
  CONVERSATION_CHUNK: 10,
  HELP_DOC: 0,
  MOUNT_CHUNK: 0,
};

/**
 * Enqueue an embedding generate job. A queued job for the same entity
 * absorbs the request; a running one does not (`'pending'`): it may have read
 * the entity's text before the change that prompted this request. Its write
 * is conditional on that text still being current, so the two cannot leave a
 * stale vector behind.
 * Priority defaults based on entity type: chat-related types (MEMORY,
 * CONVERSATION_CHUNK) get higher priority than batch types.
 */
export async function enqueueEmbeddingGenerate(
  userId: string,
  payload: EmbeddingGeneratePayload,
  options?: EnqueueJobOptions
): Promise<EmbeddingGenerateEnqueueResult> {
  const priority = options?.priority ?? EMBEDDING_ENTITY_PRIORITIES[payload.entityType] ?? 0;
  return enqueueDeduped(userId, 'EMBEDDING_GENERATE', payload, {
    key: p => p.entityId,
    absorbs: 'pending',
    scope: 'entityId',
    label: 'EmbeddingGenerate',
  }, { ...options, priority });
}

/**
 * Enqueue `EMBEDDING_GENERATE` jobs for many entities at once: one read of the
 * queued embedding jobs, one batch insert. An entity that already has a
 * PENDING job is skipped, as `enqueueEmbeddingGenerate` skips it
 * one at a time. Returns the ids of the jobs created (skipped entities add
 * none), so its length is the number actually queued.
 */
export async function enqueueEmbeddingGenerateMany(
  userId: string,
  payloads: readonly EmbeddingGeneratePayload[],
  options?: EnqueueJobOptions
): Promise<string[]> {
  if (payloads.length === 0) return [];
  const repos = getRepositories();
  // PENDING only, as enqueueEmbeddingGenerate: a running job may have read
  // the old text (its write is conditional, so it cannot clobber the new one).
  const queued = await repos.backgroundJobs.findAbsorbers('EMBEDDING_GENERATE', ['PENDING']);
  const busy = new Set(
    queued.map((job) => (job.payload as { entityId?: unknown } | null)?.entityId).filter((id): id is string => typeof id === 'string')
  );
  const seen = new Set<string>();
  const fresh = payloads.filter((p) => {
    if (busy.has(p.entityId) || seen.has(p.entityId)) return false;
    seen.add(p.entityId);
    return true;
  });
  if (fresh.length === 0) {
    logger.debug('Embedding batch: every entity already has a job', { requested: payloads.length });
    return [];
  }
  const now = new Date().toISOString();
  const jobIds = await repos.backgroundJobs.createBatch(
    fresh.map((payload) => ({
      userId,
      type: 'EMBEDDING_GENERATE' as const,
      status: 'PENDING' as const,
      payload: payload as unknown as Record<string, unknown>,
      priority: options?.priority ?? EMBEDDING_ENTITY_PRIORITIES[payload.entityType] ?? 0,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      lastError: null,
      scheduledAt: options?.scheduledAt?.toISOString() ?? now,
      startedAt: null,
      completedAt: null,
    }))
  );
  logger.info('Embedding generate batch enqueued', {
    requested: payloads.length,
    queued: jobIds.length,
    alreadyQueued: payloads.length - fresh.length,
  });
  if (jobIds.length > 0) {
    publishRealtime('jobs');
    ensureProcessorRunning();
  }
  return jobIds;
}

/**
 * Enqueue an embedding refit job (TF-IDF vocabulary rebuild)
 */
export async function enqueueEmbeddingRefit(
  userId: string,
  payload: EmbeddingRefitPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'EMBEDDING_REFIT', payload as unknown as Record<string, unknown>, {
    // Refit is lower priority than individual generates
    priority: options?.priority ?? -1,
    ...options,
  });
}

/**
 * Enqueue an embedding reindex all job
 */
export async function enqueueEmbeddingReindexAll(
  userId: string,
  payload: EmbeddingReindexAllPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'EMBEDDING_REINDEX_ALL', payload as unknown as Record<string, unknown>, {
    // Reindex is lower priority
    priority: options?.priority ?? -1,
    ...options,
  });
}

/**
 * Enqueue an embedding re-apply-profile job (Matryoshka slice + renormalize).
 * Pure local rewrite — no provider call. Use after editing a profile's
 * truncateToDimensions to migrate the existing corpus.
 */
export async function enqueueEmbeddingReapplyProfile(
  userId: string,
  payload: EmbeddingReapplyProfilePayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'EMBEDDING_REAPPLY_PROFILE', payload as unknown as Record<string, unknown>, {
    // Re-apply runs once and is purely local; default priority -1 like reindex.
    priority: options?.priority ?? -1,
    ...options,
  });
}

/**
 * Result of enqueueing a story background job
 */
export interface StoryBackgroundEnqueueResult {
  jobId: string;
  isNew: boolean;
}

/**
 * Enqueue a story background generation job. The handler reads the chat
 * when it runs, so a queued job absorbs the request and a running one does
 * not.
 */
export async function enqueueStoryBackgroundGeneration(
  userId: string,
  payload: StoryBackgroundGenerationPayload,
  options?: EnqueueJobOptions
): Promise<StoryBackgroundEnqueueResult> {
  return enqueueDeduped(userId, 'STORY_BACKGROUND_GENERATION', payload, {
    key: p => p.chatId,
    absorbs: 'pending',
    scope: 'chatId',
    label: 'StoryBackground',
  }, {
    // Lower priority than interactive tasks
    priority: options?.priority ?? -1,
    ...options,
  });
}

/**
 * Batch enqueue per-turn memory extraction jobs.
 *
 * Used by the "queue memories for this entire chat" UI action and by the
 * SillyTavern import path. Caller supplies one entry per turn — either a
 * USER turn-opener message ID (salon chats), null (greeting-only), or a
 * `{ turnOpenerMessageId, extractionAnchorMessageId }` object (autonomous
 * chats, where the anchor is the ASSISTANT message that closes the turn
 * and keeps each speaker's job distinct in the dedupe table). The handler
 * rebuilds the transcript from chat state at execution time, so this
 * enqueue API doesn't need the per-turn message contents.
 */
export type MemoryExtractionBatchEntry =
  | string
  | null
  | {
      turnOpenerMessageId: string | null;
      extractionAnchorMessageId?: string | null;
      /** Read past this message (an autonomous room's previous anchor; bug 245). */
      extractAfterMessageId?: string | null;
    };

export async function enqueueMemoryExtractionBatch(
  userId: string,
  chatId: string,
  connectionProfileId: string,
  entries: MemoryExtractionBatchEntry[],
  options?: EnqueueJobOptions
): Promise<string[]> {
  if (entries.length === 0) {
    return [];
  }

  const repos = getRepositories();
  const now = new Date().toISOString();

  const jobs = entries.map((entry) => {
    const turnOpenerMessageId =
      typeof entry === 'object' && entry !== null ? entry.turnOpenerMessageId : entry;
    const extractionAnchorMessageId =
      typeof entry === 'object' && entry !== null ? entry.extractionAnchorMessageId ?? null : null;
    const extractAfterMessageId =
      typeof entry === 'object' && entry !== null ? entry.extractAfterMessageId ?? null : null;
    return {
      userId,
      type: 'MEMORY_EXTRACTION' as const,
      status: 'PENDING' as const,
      payload: {
        chatId,
        turnOpenerMessageId,
        extractionAnchorMessageId,
        ...(extractAfterMessageId ? { extractAfterMessageId } : {}),
        connectionProfileId,
        // Every batch rebuilds history (queue-memories, SillyTavern import).
        backfill: true,
      },
      priority: options?.priority ?? 0,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      lastError: null,
      scheduledAt: options?.scheduledAt?.toISOString() ?? now,
      startedAt: null,
      completedAt: null,
    };
  });

  const jobIds = await repos.backgroundJobs.createBatch(jobs);

  logger.info('Memory extraction batch enqueued', {
    chatId,
    jobCount: jobIds.length,
  });

  if (jobIds.length > 0) {
    publishRealtime('jobs');
    ensureProcessorRunning();
  }

  return jobIds;
}

/**
 * Get the status of a job
 */
export async function getJobStatus(jobId: string) {
  const repos = getRepositories();
  return repos.backgroundJobs.findById(jobId);
}

/**
 * Get queue statistics
 */
export async function getQueueStats(userId?: string): Promise<QueueStats> {
  const repos = getRepositories();
  return repos.backgroundJobs.getStats(userId);
}

/**
 * Get active (PENDING + PROCESSING) job counts grouped by type
 */
export async function getActiveCountsByType(userId?: string): Promise<Record<string, number>> {
  const repos = getRepositories();
  return repos.backgroundJobs.getActiveCountsByType(userId);
}

/**
 * Get active (PENDING + PROCESSING) job counts grouped by activity kind,
 * merged with non-job work currently registered in the activity registry.
 *
 * This is what the toolbar chips read: a chip stays lit for the whole span of
 * the work it names, whether that work is a queued job or something running
 * inline in a request.
 */
export async function getActivitySnapshot(userId?: string): Promise<{
  active: Record<ActivityKind, number>;
  started: Record<ActivityKind, number>;
}> {
  const repos = getRepositories();
  const jobCounts = await repos.backgroundJobs.getActiveCountsByKind(userId);
  const inline = getActivityCounts();

  const active = emptyActivityCounts();
  for (const kind of ACTIVITY_KINDS) {
    active[kind] = jobCounts[kind] + inline[kind];
  }

  return { active, started: getActivityStartTotals() };
}

/**
 * Cancel a pending job
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  const repos = getRepositories();
  const cancelled = await repos.backgroundJobs.cancel(jobId);
  if (cancelled) publishRealtime('jobs');
  return cancelled;
}

/**
 * Get pending jobs for a chat
 */
export async function getPendingJobsForChat(chatId: string) {
  const repos = getRepositories();
  return repos.backgroundJobs.findPendingForChat(chatId);
}

/**
 * Enqueue a character avatar generation job.
 *
 * Collapses onto a still-PENDING avatar job for this chat+character
 * (`'pending'`). The handler reads the outfit and the carried objects when it
 * runs, so one queued job covers any later change. A PROCESSING job has
 * already built its prompt, so a change made after that point needs a fresh
 * job.
 */
export async function enqueueCharacterAvatarGeneration(
  userId: string,
  payload: CharacterAvatarGenerationPayload,
  options?: EnqueueJobOptions
): Promise<DedupedEnqueueResult> {
  const result = await enqueueDeduped(userId, 'CHARACTER_AVATAR_GENERATION', payload, {
    key: p => p.characterId,
    absorbs: 'pending',
    scope: 'chatId',
    label: 'CharacterAvatar',
  }, options);
  logger.info(result.isNew ? '[CharacterAvatar] Avatar generation job enqueued' : '[CharacterAvatar] Reusing existing pending job', {
    context: 'background-jobs.queue',
    chatId: payload.chatId,
    characterId: payload.characterId,
    jobId: result.jobId,
  });
  return result;
}

/**
 * Enqueue a picture of one wardrobe item, on behalf of a wardrobe tool.
 * Collapses against a still-PENDING job for the same item (`'pending'`): the
 * handler reads the item when it runs, so one queued job already covers any
 * later edit. A PROCESSING job has already built its prompt, so a fresh one
 * is enqueued.
 */
export async function enqueueWardrobeItemImageGeneration(
  userId: string,
  payload: WardrobeItemImageGenerationPayload,
): Promise<DedupedEnqueueResult> {
  // One try: a refusal or a provider failure would only be paid for again.
  const result = await enqueueDeduped(userId, 'WARDROBE_ITEM_IMAGE_GENERATION', payload, {
    key: p => p.itemId,
    absorbs: 'pending',
    scope: 'chatId',
    label: 'WardrobeItemImage',
  }, { maxAttempts: 1 });
  logger.info(result.isNew ? '[WardrobeItemImage] Wardrobe item image job enqueued' : '[WardrobeItemImage] Reusing existing pending job', {
    context: 'background-jobs.queue',
    chatId: payload.chatId,
    characterId: payload.characterId,
    itemId: payload.itemId,
    jobId: result.jobId,
  });
  return result;
}

/**
 * Payload for wardrobe outfit announcement job
 */
export interface WardrobeOutfitAnnouncementPayload {
  /** Chat where the outfit change occurred */
  chatId: string;
  /** Character whose outfit changed */
  characterId: string;
}

/**
 * Enqueue a wardrobe outfit announcement job, fire-and-forget.
 *
 * Originally this scheduled the announcement an entire minute out so a flurry
 * of small slot edits could collapse into a single Aurora message. With the
 * Wardrobe dialog's "Wear this" gesture committing whole compositions in one
 * shot, the operator expects the announcement (and avatar regen) to land
 * promptly.
 *
 * Collapses only against a still-PENDING job for the same (chat, character)
 * (`'pending'`). A job already claimed has snapshotted the equipped state and
 * can't absorb fresh changes; letting it would strand post-claim slot edits
 * with no follow-up announcement.
 */
export async function enqueueWardrobeOutfitAnnouncement(
  userId: string,
  payload: WardrobeOutfitAnnouncementPayload,
): Promise<DedupedEnqueueResult> {
  const scheduledAt = new Date();
  const result = await enqueueDeduped(userId, 'WARDROBE_OUTFIT_ANNOUNCEMENT', payload, {
    key: p => p.characterId,
    absorbs: 'pending',
    scope: 'chatId',
    label: 'WardrobeAnnouncement',
  }, { scheduledAt, priority: -1 });
  logger.info(result.isNew ? '[WardrobeAnnouncement] Announcement job enqueued' : '[WardrobeAnnouncement] Pending announcement reused', {
    context: 'background-jobs.queue',
    chatId: payload.chatId,
    characterId: payload.characterId,
    jobId: result.jobId,
    ...(result.isNew ? { scheduledAt: scheduledAt.toISOString() } : {}),
  });
  return result;
}

/**
 * Cleanup old completed jobs
 *
 * @deprecated Single-window reaper. Use {@link cleanupFinishedJobs}, which
 * applies separate retention windows to COMPLETED vs DEAD jobs.
 */
export async function cleanupOldJobs(daysOld: number = 7): Promise<number> {
  const repos = getRepositories();
  const olderThan = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  return repos.backgroundJobs.cleanupOldJobs(olderThan);
}

/**
 * Reap finished background jobs using the per-status retention windows from
 * `lib/background-jobs/maintenance/retention-constants.ts`: COMPLETED jobs
 * after the short window, DEAD jobs after the longer one. PENDING/PROCESSING/
 * FAILED/PAUSED are left untouched. Called by the daily maintenance tick.
 */
export async function cleanupFinishedJobs(): Promise<{ completed: number; dead: number }> {
  const repos = getRepositories();
  const completedOlderThan = retentionCutoff(COMPLETED_JOB_RETENTION_DAYS);
  const deadOlderThan = retentionCutoff(DEAD_JOB_RETENTION_DAYS);
  return repos.backgroundJobs.cleanupOldJobsByStatus(completedOlderThan, deadOlderThan);
}
