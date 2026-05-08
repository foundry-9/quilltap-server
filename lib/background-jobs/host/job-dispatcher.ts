/**
 * Job dispatcher (parent-side)
 *
 * Owns the claim loop: poll the `background_jobs` table on a 2 s interval,
 * claim the next pending job atomically via the repository, and post it to
 * the forked child. When the child returns a `job-result`, apply the
 * batched writes inside a single `db.transaction(...)` over the parent's
 * RW connection, then mark the job COMPLETED (or FAILED on error).
 *
 * Concurrency: a single global cap of `MAX_IN_FLIGHT` jobs of any type.
 * This replaces the previous per-type caps and the user-configurable
 * memory-extraction slider — the trade-off (heavy job types can starve
 * lighter ones) is documented in `docs/developer/BACKGROUND_JOBS_CHILD.md`.
 */

import { getRepositories } from '@/lib/repositories/factory';
import type { Database } from 'better-sqlite3';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import type { BackgroundJob } from '@/lib/schemas/types';
import type { ChildJobResultMessage, ChildWritePayload } from '../ipc-types';
import { sendToChild, notifyChild } from './processor-host';
import fs from 'fs';
import path from 'path';

const log = logger.child({ module: 'jobs:dispatcher' });

// ============================================================================
// Tunables
// ============================================================================

const POLL_INTERVAL_MS = 2_000;
const MAX_IN_FLIGHT = 4;
const MAX_WAKE_DELAY_MS = 5 * 60 * 1000;
const STUCK_JOB_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// ============================================================================
// HMR-safe global state
// ============================================================================

interface DispatcherState {
  pollTimer: ReturnType<typeof setInterval> | null;
  stuckCheckTimer: ReturnType<typeof setInterval> | null;
  wakeTimer: ReturnType<typeof setTimeout> | null;
  inFlight: Map<string, BackgroundJob>;
  claiming: boolean;
  running: boolean;
}

declare global {
  var __quilltapJobDispatcher: DispatcherState | undefined;
}

function getState(): DispatcherState {
  if (!globalThis.__quilltapJobDispatcher) {
    globalThis.__quilltapJobDispatcher = {
      pollTimer: null,
      stuckCheckTimer: null,
      wakeTimer: null,
      inFlight: new Map(),
      claiming: false,
      running: false,
    };
  }
  return globalThis.__quilltapJobDispatcher;
}

// ============================================================================
// Lifecycle
// ============================================================================

export function startDispatcher(): void {
  const state = getState();
  if (state.running) return;
  state.running = true;

  state.pollTimer = setInterval(() => {
    pumpClaim().catch(err => {
      log.error('Error in claim loop', { error: getErrorMessage(err) });
    });
  }, POLL_INTERVAL_MS);

  if (!state.stuckCheckTimer) {
    state.stuckCheckTimer = setInterval(() => {
      resetStuckJobs().catch(err => {
        log.error('Error in stuck-job sweep', { error: getErrorMessage(err) });
      });
    }, STUCK_JOB_CHECK_INTERVAL_MS);
  }

  // On startup, reset any orphaned PROCESSING jobs — none should legitimately
  // be mid-flight when the dispatcher just started.
  resetOrphanedJobs().catch(err => {
    log.error('Error resetting orphaned jobs at startup', { error: getErrorMessage(err) });
  });

  log.info('Dispatcher started', { pollIntervalMs: POLL_INTERVAL_MS, maxInFlight: MAX_IN_FLIGHT });
}

export function stopDispatcher(): void {
  const state = getState();
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  if (state.stuckCheckTimer) { clearInterval(state.stuckCheckTimer); state.stuckCheckTimer = null; }
  if (state.wakeTimer) { clearTimeout(state.wakeTimer); state.wakeTimer = null; }
  state.running = false;
  log.info('Dispatcher stopped');
}

export function dispatcherWake(): void {
  const state = getState();
  if (!state.running) return;
  if (state.wakeTimer) { clearTimeout(state.wakeTimer); state.wakeTimer = null; }
  pumpClaim().catch(err => {
    log.error('Error in wake-triggered claim', { error: getErrorMessage(err) });
  });
}

export function getDispatcherSnapshot(): { inFlight: number; running: boolean } {
  const state = getState();
  return { inFlight: state.inFlight.size, running: state.running };
}

// ============================================================================
// Claim loop
// ============================================================================

async function pumpClaim(): Promise<void> {
  const state = getState();
  if (!state.running || state.claiming) return;
  state.claiming = true;
  try {
    while (state.inFlight.size < MAX_IN_FLIGHT) {
      const repos = getRepositories();
      const job = await repos.backgroundJobs.claimNextJob();
      if (!job) {
        // Queue is empty — schedule a wake-up if a future retry is due.
        if (state.inFlight.size === 0) {
          const next = await repos.backgroundJobs.findNextScheduledAt();
          if (next) armWakeTimer(next);
        }
        return;
      }
      dispatchJob(job);
    }
  } finally {
    state.claiming = false;
  }
}

function dispatchJob(job: BackgroundJob): void {
  const state = getState();
  state.inFlight.set(job.id, job);
  log.info('Dispatching job to child', { jobId: job.id, type: job.type, attempts: job.attempts });
  const ok = sendToChild({ type: 'job', job });
  if (!ok) {
    // Child is gone — return the job to PENDING and let the next claim retry.
    state.inFlight.delete(job.id);
    log.warn('Child unavailable; marking job failed for retry', { jobId: job.id });
    void getRepositories().backgroundJobs.markFailed(job.id, 'Child process unavailable');
  }
}

function armWakeTimer(scheduledAt: string): void {
  const state = getState();
  if (state.wakeTimer) clearTimeout(state.wakeTimer);
  const rawMs = new Date(scheduledAt).getTime() - Date.now();
  const delayMs = Math.min(Math.max(rawMs, 100), MAX_WAKE_DELAY_MS);
  state.wakeTimer = setTimeout(() => {
    state.wakeTimer = null;
    log.info('Wake timer fired for scheduled retry', { scheduledAt });
    dispatcherWake();
  }, delayMs);
  state.wakeTimer.unref?.();
}

// ============================================================================
// Job result + write applier
// ============================================================================

export async function handleChildJobResult(msg: ChildJobResultMessage): Promise<void> {
  const state = getState();
  const job = state.inFlight.get(msg.jobId);
  state.inFlight.delete(msg.jobId);

  const repos = getRepositories();

  if (!msg.ok) {
    const errorMessage = msg.error?.message ?? 'Unknown handler error';
    log.warn('Job failed in child', { jobId: msg.jobId, type: job?.type, error: errorMessage });
    // Best-effort cleanup of staged files left behind by the failed handler.
    cleanupStagingDirs(msg.writes, msg.jobId);
    await repos.backgroundJobs.markFailed(msg.jobId, errorMessage);
    pumpClaim().catch(err => log.error('Post-fail claim error', { error: getErrorMessage(err) }));
    return;
  }

  try {
    await applyWritesAtomically(msg.jobId, msg.writes);
    await repos.backgroundJobs.markCompleted(msg.jobId);
    log.info('Job completed', { jobId: msg.jobId, type: job?.type, writeCount: msg.writes.length });
  } catch (err) {
    const errorMessage = getErrorMessage(err);
    log.error('Failed to apply child writes; marking job failed', {
      jobId: msg.jobId,
      type: job?.type,
      error: errorMessage,
    });
    cleanupStagingDirs(msg.writes, msg.jobId);
    await repos.backgroundJobs.markFailed(msg.jobId, errorMessage);
  }

  pumpClaim().catch(e => log.error('Post-complete claim error', { error: getErrorMessage(e) }));
}

// Serialize apply calls. With concurrency=4, multiple jobs finish around
// the same time and the parent receives several `job-result` messages
// nearly simultaneously. Each tries to `BEGIN IMMEDIATE` on the same
// connection — the second one hits "cannot start a transaction within a
// transaction." Chain applies through a Promise so only one runs at a
// time; the dispatcher's claim loop still uses MAX_IN_FLIGHT for parallel
// child execution, but the parent's transaction boundary is single-file.
let applyChain: Promise<unknown> = Promise.resolve();

async function applyWritesAtomically(jobId: string, writes: ChildWritePayload[]): Promise<void> {
  if (writes.length === 0) return;

  // Wait for any in-progress apply to finish before we begin our own
  // transaction. Failures in the previous apply must not poison this one,
  // so swallow them — the dispatcher already marks each job's outcome.
  const prev = applyChain;
  let release: () => void = () => {};
  applyChain = new Promise<void>(resolve => { release = resolve; });
  try { await prev; } catch { /* previous apply's error was already handled */ }

  try {
    await applyWritesUnsafe(jobId, writes);
  } finally {
    release();
  }
}

async function applyWritesUnsafe(jobId: string, writes: ChildWritePayload[]): Promise<void> {
  const db = getRawDatabase();
  if (!db) {
    throw new Error('Cannot apply child writes: parent SQLite connection is not initialized');
  }

  const stagedRenames: Array<{ from: string; to: string }> = [];

  // We can't use better-sqlite3's `db.transaction(fn)` wrapper because the
  // repository methods are async (the database abstraction is async-first
  // even though the underlying SQL is sync) — `db.transaction` requires
  // its body to return synchronously. Drive BEGIN/COMMIT/ROLLBACK by hand
  // so we can `await` each write while still getting all-or-nothing
  // semantics. BEGIN IMMEDIATE acquires the reserved lock up front so we
  // surface lock contention early instead of mid-batch.
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const w of writes) {
      if (w.method === '__finalizeFile') {
        const args = w.args[0] as { stagingPath: string; finalPath: string };
        ensureDirSync(path.dirname(args.finalPath));
        fs.renameSync(args.stagingPath, args.finalPath);
        stagedRenames.push({ from: args.stagingPath, to: args.finalPath });
        continue;
      }
      const result = applyRepositoryWrite(w);
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        await result;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* may already be rolled back */ }
    // Undo any file renames that completed before the throw.
    for (const r of stagedRenames.reverse()) {
      try { fs.renameSync(r.to, r.from); } catch { /* best effort */ }
    }
    throw err;
  }

  // After commit, drop the per-job staging directory so we don't accumulate
  // empty `<dataDir>/files/.staging/<jobId>/` shells.
  cleanupStagingDirs(writes, jobId);

  // After commit, scan for cache-invalidating writes and notify both the
  // parent's local caches and the child. This keeps cache coherence in one
  // place rather than scattered across every repository.
  dispatchInvalidations(writes);
}

function dispatchInvalidations(writes: ChildWritePayload[]): void {
  // Collect unique invalidation targets up front so we don't fire duplicates
  // when a single batch touches the same character/mount-point repeatedly.
  const vectorStoreKeys = new Set<string>();
  const mountPointKeys = new Set<string>();

  for (const w of writes) {
    const charId = extractCharacterId(w);
    if (charId && WRITES_INVALIDATING_VECTOR_STORE.has(w.method)) {
      vectorStoreKeys.add(charId);
    }
    const mountId = extractMountPointId(w);
    if (mountId && WRITES_INVALIDATING_MOUNT_CACHE.has(w.method)) {
      mountPointKeys.add(mountId);
    }
  }

  if (vectorStoreKeys.size === 0 && mountPointKeys.size === 0) return;

  // Always notify the child immediately (cheap IPC). The local-side
  // invalidation goes through dynamic `import()` so it survives the
  // various module-loading shapes Next.js webpack uses (`require()`
  // returned a non-namespace object in some configurations).
  for (const key of vectorStoreKeys) notifyChild('vectorStore', key);
  for (const key of mountPointKeys) notifyChild('mountPoint', key);

  void invalidateLocalCachesAsync(vectorStoreKeys, mountPointKeys);
}

async function invalidateLocalCachesAsync(
  vectorStoreKeys: Set<string>,
  mountPointKeys: Set<string>,
): Promise<void> {
  if (vectorStoreKeys.size > 0) {
    try {
      const mod = await import('@/lib/embedding/vector-store');
      const mgr = mod.getVectorStoreManager();
      for (const key of vectorStoreKeys) {
        try { mgr.unloadStore(key); }
        catch (err) { log.debug('Local vector-store unload failed', { key, error: getErrorMessage(err) }); }
      }
    } catch (err) {
      log.debug('Loading vector-store module for invalidation failed', { error: getErrorMessage(err) });
    }
  }

  if (mountPointKeys.size > 0) {
    try {
      const mod = await import('@/lib/mount-index/mount-chunk-cache');
      for (const key of mountPointKeys) {
        try { mod.invalidateMountPoint(key); }
        catch (err) { log.debug('Local mount-chunk invalidation failed', { key, error: getErrorMessage(err) }); }
      }
    } catch (err) {
      log.debug('Loading mount-chunk-cache module for invalidation failed', { error: getErrorMessage(err) });
    }
  }
}

const WRITES_INVALIDATING_VECTOR_STORE = new Set<string>([
  'vectorIndices.deleteStore',
  'vectorIndices.addEntry',
  'vectorIndices.updateEntryEmbedding',
  'vectorIndices.saveMeta',
  'memories.updateForCharacter',
  'memories.delete',
  'memories.create',
  'memories.upsert',
]);

const WRITES_INVALIDATING_MOUNT_CACHE = new Set<string>([
  'docMountChunks.upsert',
  'docMountChunks.delete',
  'docMountChunks.deleteByMountPointId',
]);

function extractCharacterId(w: ChildWritePayload): string | null {
  // Many of the listed methods take the characterId as a top-level field on
  // the first arg, or as the first positional arg. Probe both shapes.
  const a0 = w.args?.[0];
  if (typeof a0 === 'string' && a0.length > 0) return a0;
  if (a0 && typeof a0 === 'object') {
    const obj = a0 as Record<string, unknown>;
    if (typeof obj.characterId === 'string') return obj.characterId;
  }
  return null;
}

function extractMountPointId(w: ChildWritePayload): string | null {
  const a0 = w.args?.[0];
  if (typeof a0 === 'string' && a0.length > 0) return a0;
  if (a0 && typeof a0 === 'object') {
    const obj = a0 as Record<string, unknown>;
    if (typeof obj.mountPointId === 'string') return obj.mountPointId;
  }
  return null;
}

function applyRepositoryWrite(w: ChildWritePayload): unknown {
  const repos = getRepositories();
  const fn = resolveDottedMethod(repos as unknown as Record<string, unknown>, w.method);
  if (typeof fn !== 'function') {
    throw new Error(`No repository method registered for "${w.method}"`);
  }
  // May be sync or return a Promise; the caller awaits if needed.
  return fn(...w.args);
}

function resolveDottedMethod(root: Record<string, unknown>, dotted: string): unknown {
  const parts = dotted.split('.');
  let cur: unknown = root;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  // Functions on classes need to be bound back to the parent object so
  // `this` is correct. Walk to the parent and return a bound copy.
  if (typeof cur === 'function' && parts.length > 1) {
    let parent: unknown = root;
    for (let i = 0; i < parts.length - 1; i++) {
      parent = (parent as Record<string, unknown>)[parts[i]];
    }
    return (cur as (...args: unknown[]) => unknown).bind(parent);
  }
  return cur;
}

function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanupStagingDirs(writes: ChildWritePayload[], jobId: string): void {
  // For now we just remove any staging directories named after this jobId.
  // The child writes files into <dataDir>/files/.staging/<jobId>/...; the
  // exact base is encoded in the args' stagingPath, so derive it from the
  // first __finalizeFile call (if any).
  for (const w of writes) {
    if (w.method !== '__finalizeFile') continue;
    const args = w.args[0] as { stagingPath: string };
    const stagingRoot = findStagingRoot(args.stagingPath, jobId);
    if (!stagingRoot) continue;
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    return;
  }
}

function findStagingRoot(stagingPath: string, jobId: string): string | null {
  const idx = stagingPath.indexOf(`.staging${path.sep}${jobId}`);
  if (idx < 0) return null;
  const end = idx + `.staging${path.sep}${jobId}`.length;
  return stagingPath.slice(0, end);
}

// ============================================================================
// Stuck/orphan recovery
// ============================================================================

async function resetOrphanedJobs(): Promise<void> {
  const repos = getRepositories();
  const count = await repos.backgroundJobs.resetAllProcessingJobs();
  if (count > 0) {
    log.info('Reset orphaned PROCESSING jobs at startup', { count });
  }
}

export async function resetStuckJobs(timeoutMinutes: number = 10): Promise<number> {
  const repos = getRepositories();
  const count = await repos.backgroundJobs.resetStuckJobs(timeoutMinutes);
  if (count > 0) {
    log.info('Reset stuck jobs', { count, timeoutMinutes });
  }
  return count;
}

// Avoid an unused-import warning when the Database type is referenced only
// via the inferred return of getRawDatabase.
type _DBRef = Database;
