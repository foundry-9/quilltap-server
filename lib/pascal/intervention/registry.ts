/**
 * Operator intervention — the pending-hold registry.
 *
 * A held custom-tool run waits here, inside the turn that dealt it, until the
 * operator answers the dialog (or presses Stop, which vetoes it). The HTTP
 * actions that resolve a hold run in a different route bundle from the stream
 * that is waiting, so the registry is a `processSingleton` (bug 235), as turn
 * control is. In-process only: holds never open in the job child.
 *
 * - **No timeout** (I2). A server restart loses the entry, but it also kills
 *   the turn that was waiting — and a held run has applied no effects and
 *   posted nothing, so nothing is left half-done.
 * - **First wins.** The first resolve settles the hold and removes it; a
 *   later one (a second tab, a double click) is told it already settled.
 * - Every add and every removal publishes `customToolInterventions` for the
 *   chat — a hint only, never data.
 *
 * Server-only. Design of record:
 * docs/developer/features/complete/pascal-operator-intervention.md.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { processSingleton } from '@/lib/utils/process-singleton';
import { publishRealtime } from '@/lib/realtime/bus';
import type { MountTier } from '@/lib/mount-index/tiered-mount-pool';
import type { QtapCustomTool } from '../custom-tool.types';
import type { CustomToolRunResult, LlmConsultResult, RecordedDraw } from '../custom-tools';
import type { InterventionOverrides } from './overrides';
import type { RecomputedRun, RunSnapshot } from './recompute';

const CONTEXT = 'pascal.intervention.registry';

/** How often a held turn pings its stream so proxies keep it open. */
const KEEP_ALIVE_MS = 15_000;

/** How many settled ids to remember, so a late resolve gets 409 rather than 404. */
const SETTLED_MEMORY = 200;

/** The operator's answer to a hold. */
export type InterventionDecision =
  /** Deal the run as recomputed under these overrides. `run` is the server's own recompute. */
  | { kind: 'deal'; overrides: InterventionOverrides; run: RecomputedRun; reasks: number }
  | { kind: 'as-rolled' }
  | { kind: 'veto'; cause: 'dialog' | 'stop' };

export interface PendingIntervention {
  id: string;
  chatId: string;
  userId: string;
  createdAt: number;
  entrance: 'llm' | 'trigger';
  characterId: string | null;
  characterName: string | null;
  /** The phrase that reached a triggered run, as written in the definition. */
  triggerPhrase?: string;
  /** The definition as it was dealt — a mid-hold file edit is not picked up. */
  definition: QtapCustomTool;
  definitionTier: MountTier;
  definitionMountId: string;
  snapshot: RunSnapshot;
  draw: RecordedDraw;
  baseline: CustomToolRunResult;
  /** The original answer, then one per Re-ask. The last is the answer in use. */
  consults: LlmConsultResult[];
}

interface Entry {
  pending: PendingIntervention;
  resolve: (decision: InterventionDecision) => void;
}

interface RegistryState {
  byId: Map<string, Entry>;
  settled: string[];
}

const state = processSingleton<RegistryState>('pascal.interventionRegistry', () => ({
  byId: new Map(),
  settled: [],
}));

export interface HoldOptions {
  /** The turn's Stop signal; an abort resolves the hold as a veto (I9). */
  signal?: AbortSignal;
  /** The turn's keep-alive ping; called every 15 s while waiting. */
  keepAlive?: () => boolean;
}

/**
 * Register a hold and wait for the operator's decision. Never rejects.
 */
export function hold(
  pending: Omit<PendingIntervention, 'id' | 'createdAt'>,
  options: HoldOptions = {}
): { id: string; decision: Promise<InterventionDecision> } {
  const id = randomUUID();
  const entryPending: PendingIntervention = { ...pending, id, createdAt: Date.now() };

  const decision = new Promise<InterventionDecision>((resolvePromise) => {
    let keepAlive: ReturnType<typeof setInterval> | null = null;
    const onAbort = () => settleIntervention(id, { kind: 'veto', cause: 'stop' });

    const cleanUp = () => {
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = null;
      options.signal?.removeEventListener('abort', onAbort);
    };

    state.byId.set(id, {
      pending: entryPending,
      resolve: (value) => {
        cleanUp();
        resolvePromise(value);
      },
    });

    if (options.keepAlive) {
      const ping = options.keepAlive;
      keepAlive = setInterval(() => {
        // Stream closed: stop pinging, but keep waiting — the dialog can still answer.
        if (!ping() && keepAlive) {
          clearInterval(keepAlive);
          keepAlive = null;
        }
      }, KEEP_ALIVE_MS);
    }

    if (options.signal) {
      if (options.signal.aborted) {
        // Registered and settled in one breath: publish the add before the removal.
        queueMicrotask(onAbort);
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });

  logger.info('Custom tool run held for the operator', {
    context: CONTEXT,
    chatId: pending.chatId,
    holdId: id,
    tool: pending.definition.name,
    entrance: pending.entrance,
    characterId: pending.characterId,
  });
  publishRealtime('customToolInterventions', pending.chatId);

  return { id, decision };
}

export type SettleOutcome = 'resolved' | 'unknown' | 'settled';

/**
 * Resolve a hold. First wins: `'settled'` when it was already resolved (the
 * API's 409), `'unknown'` for an id this process never held (404).
 */
export function settleIntervention(id: string, decision: InterventionDecision): SettleOutcome {
  const entry = state.byId.get(id);
  if (!entry) {
    const outcome: SettleOutcome = state.settled.includes(id) ? 'settled' : 'unknown';
    logger.warn('Custom tool hold resolve refused', { context: CONTEXT, holdId: id, outcome });
    return outcome;
  }
  state.byId.delete(id);
  state.settled.push(id);
  if (state.settled.length > SETTLED_MEMORY) state.settled.splice(0, state.settled.length - SETTLED_MEMORY);

  logger.info('Custom tool hold resolved', {
    context: CONTEXT,
    chatId: entry.pending.chatId,
    holdId: id,
    tool: entry.pending.definition.name,
    decision: decision.kind,
    cause: decision.kind === 'veto' ? decision.cause : 'dialog',
  });
  entry.resolve(decision);
  publishRealtime('customToolInterventions', entry.pending.chatId);
  return 'resolved';
}

/** Whether an id is pending, recently settled, or unknown to this process. Reads only. */
export function interventionStatus(id: string): 'pending' | 'settled' | 'unknown' {
  if (state.byId.has(id)) return 'pending';
  return state.settled.includes(id) ? 'settled' : 'unknown';
}

/** A pending hold, or null. */
export function getIntervention(id: string): PendingIntervention | null {
  return state.byId.get(id)?.pending ?? null;
}

/** This chat's pending holds, oldest first. */
export function listInterventions(chatId: string): PendingIntervention[] {
  return [...state.byId.values()]
    .map((entry) => entry.pending)
    .filter((pending) => pending.chatId === chatId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Record a Re-ask's answer; it becomes the answer in use. False when the hold has settled meanwhile. */
export function addConsult(id: string, consult: LlmConsultResult): boolean {
  const entry = state.byId.get(id);
  if (!entry) return false;
  entry.pending.consults.push(consult);
  return true;
}

/** Test seam: forget every hold without resolving it. */
export function resetInterventionRegistryForTests(): void {
  state.byId.clear();
  state.settled.length = 0;
}
