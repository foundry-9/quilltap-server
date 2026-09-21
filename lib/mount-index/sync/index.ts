/**
 * `syncMountPoint` — one run of the document-store sync.
 *
 * Reads both sides once, plans, applies, writes the manifest, and reports.
 * The planner holds all the judgement; this module holds the plumbing: the
 * store-type guards, the per-store mutex that stops two runs from interleaving
 * their compare-and-swaps, the byte fetches each action needs, and the
 * bookkeeping that turns an applied plan into the next run's base.
 *
 * The verb never touches `doc_mount_chunks` or an embedding vector. It calls
 * the same write chokepoints every other writer calls, so the store's existing
 * post-write hooks do the indexing — which is also why the engine must live in
 * the server rather than in the CLI: those hooks are TypeScript in `lib/`, and
 * a lock-gated direct-SQLite writer could not run them at all.
 *
 * @module mount-index/sync
 */

import path from 'path';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getArchivedCharacterVaultMountPointIds } from '@/lib/mount-index/character-vault';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';
import {
  applyDiskAction,
  birthtimeIsSettable,
  ensureTargetDirectory,
  targetExists,
} from './apply-disk';
import { applyStoreAction, readStoreBytes } from './apply-store';
import { baseFromManifest, readManifest, writeManifest } from './manifest';
import { planSync } from './planner';
import { descriptionSha256 } from './sidecar';
import { walkDisk } from './walk-disk';
import { walkStore } from './walk-store';
import {
  SYNC_MANIFEST_FILENAME,
  type ManifestEntry,
  type SyncAction,
  type SyncManifest,
  type SyncOptions,
  type SyncReport,
  type SyncSummary,
} from './types';

export class SyncRefusedError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'SyncRefusedError';
  }
}

/**
 * One run per store at a time. A second run interleaved with the first would
 * see the first's half-applied writes as "changed since the plan" and report a
 * storm of conflicts — and on the disk side the two would race for the same
 * temp names.
 */
const inFlight = new Set<string>();

export async function syncMountPoint(
  mountPoint: DocMountPoint,
  options: SyncOptions
): Promise<SyncReport> {
  const started = Date.now();
  await assertSyncable(mountPoint);

  if (inFlight.has(mountPoint.id)) {
    throw new SyncRefusedError(
      `A sync of "${mountPoint.name}" is already running`,
      'SYNC_IN_PROGRESS'
    );
  }
  inFlight.add(mountPoint.id);
  try {
    return await runSync(mountPoint, options, started);
  } finally {
    inFlight.delete(mountPoint.id);
  }
}

// ============================================================================
// Guards
// ============================================================================

async function assertSyncable(mountPoint: DocMountPoint): Promise<void> {
  if (mountPoint.mountType !== 'database') {
    throw new SyncRefusedError(
      `"${mountPoint.name}" is a ${mountPoint.mountType} store — it already IS a directory ` +
      `(${mountPoint.basePath || 'no base path recorded'}). Sync mirrors database-backed stores only.`,
      'NOT_DATABASE_BACKED'
    );
  }
  if (mountPoint.conversionStatus !== 'idle') {
    throw new SyncRefusedError(
      `"${mountPoint.name}" is ${mountPoint.conversionStatus}; wait for that to finish`,
      'CONVERSION_IN_PROGRESS'
    );
  }
  if (mountPoint.scanStatus === 'scanning') {
    throw new SyncRefusedError(
      `"${mountPoint.name}" is being scanned; wait for that to finish`,
      'SCAN_IN_PROGRESS'
    );
  }
  if (mountPoint.storeType === 'character') {
    // An archived character is a tombstone. Its vault is still a live, writable
    // store, so the guards are the only thing stopping a sync from editing it
    // back into existence.
    const archived = await getArchivedCharacterVaultMountPointIds();
    if (archived.includes(mountPoint.id)) {
      throw new SyncRefusedError(
        `"${mountPoint.name}" is an archived character's vault and cannot be synced. ` +
        `Rehydrate the character first.`,
        'CHARACTER_ARCHIVED'
      );
    }
  }
}

// ============================================================================
// The run
// ============================================================================

async function runSync(
  mountPoint: DocMountPoint,
  options: SyncOptions,
  started: number
): Promise<SyncReport> {
  const targetPath = path.resolve(options.targetPath);
  const warnings: string[] = [];

  // `--dry-run` changes nothing on either side, and that includes not
  // conjuring the directory: an operator planning a sync against a path they
  // mistyped should be left with the mistyped path absent, not with an empty
  // folder they now have to notice and remove.
  if (options.dryRun) {
    const exists = await targetExists(targetPath);
    if (!exists) warnings.push(`${targetPath} does not exist yet; a real run would create it`);
  } else {
    await ensureTargetDirectory(targetPath);
  }

  const manifest = options.useManifest
    ? await readManifest(targetPath, mountPoint.id, warnings)
    : null;
  const base = baseFromManifest(manifest);

  const storeWalk = await walkStore(mountPoint);
  const diskWalk = await walkDisk(targetPath, mountPoint.excludePatterns ?? []);
  warnings.push(...storeWalk.warnings, ...diskWalk.warnings);

  // A store path that already uses the sidecar suffix is ambiguous in both
  // directions; it is dropped from the walk and named here instead.
  const reserved: SyncAction[] = storeWalk.reservedPaths.map(relativePath => ({
    kind: 'conflict' as const,
    side: null,
    relativePath,
    entryKind: 'file' as const,
    reason: 'reserved name: the sidecar suffix cannot also be a document',
    outcome: 'skipped' as const,
  }));

  const { actions, warnings: planWarnings } = planSync({
    store: storeWalk.entries,
    disk: diskWalk.entries,
    base,
    options,
    isCharacterVault: mountPoint.storeType === 'character',
    canSetDiskBirthtime: birthtimeIsSettable(),
  });
  warnings.push(...planWarnings);

  const plan = [...reserved, ...actions];

  logger.debug('[Sync] Planned', {
    mountPointId: mountPoint.id,
    targetPath,
    storeEntries: storeWalk.entries.size,
    diskEntries: diskWalk.entries.size,
    baseEntries: base.size,
    actions: plan.length,
    dryRun: options.dryRun,
  });

  if (!options.dryRun) {
    await applyPlan(mountPoint, targetPath, plan, warnings);
    if (options.useManifest) {
      await writeManifest(
        targetPath,
        await buildManifest(mountPoint, targetPath)
      );
    }
    if (!birthtimeIsSettable() && plan.some(a => a.side === 'disk' && a.createdAt)) {
      warnings.push(
        `Creation dates are not settable on ${process.platform}; they are recorded in ${SYNC_MANIFEST_FILENAME} instead`
      );
    }
  }

  return {
    storeId: mountPoint.id,
    storeName: mountPoint.name,
    targetPath,
    dryRun: options.dryRun,
    actions: plan,
    summary: summarise(plan),
    warnings,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Run the plan in order, recording each action's outcome on the action itself.
 *
 * A failing action never aborts the run: the rest of the plan is independent
 * of it, and a sync that stopped at the first unwritable file would leave the
 * operator with a directory in a state no manifest describes. Failures are
 * reported and counted, and the CLI's exit code reflects them.
 */
async function applyPlan(
  mountPoint: DocMountPoint,
  targetPath: string,
  plan: SyncAction[],
  warnings: string[]
): Promise<void> {
  for (const action of plan) {
    if (action.side === null) continue;
    try {
      const bytes = await bytesFor(mountPoint, targetPath, action);
      if (action.side === 'store') {
        await applyStoreAction(mountPoint.id, action, bytes);
      } else {
        await applyDiskAction(targetPath, action, bytes);
      }
      action.outcome = 'applied';
      logger.debug('[Sync] Applied', {
        mountPointId: mountPoint.id,
        kind: action.kind,
        side: action.side,
        relativePath: action.relativePath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      action.outcome = 'failed';
      action.error = message;
      warnings.push(`${action.kind} ${action.side} ${action.relativePath}: ${message}`);
      logger.warn('[Sync] Action failed', {
        mountPointId: mountPoint.id,
        kind: action.kind,
        side: action.side,
        relativePath: action.relativePath,
        error: message,
      });
    }
  }
}

/**
 * The bytes an action needs, read from the side it is copying FROM. A
 * hard-link fan-out reads the store, which by then holds the written bytes —
 * which is why the planner orders store-side work first.
 */
async function bytesFor(
  mountPoint: DocMountPoint,
  targetPath: string,
  action: SyncAction
): Promise<Buffer | null> {
  if (action.kind !== 'create' && action.kind !== 'modify') return null;

  if (action.side === 'disk') {
    const bytes = await readStoreBytes(mountPoint.id, action.relativePath);
    if (!bytes) throw new Error(`The store has no content at ${action.relativePath}`);
    return bytes;
  }

  const { promises: fs } = await import('fs');
  const { resolveInTarget } = await import('./apply-disk');
  return fs.readFile(resolveInTarget(targetPath, action.relativePath));
}

// ============================================================================
// Manifest
// ============================================================================

/**
 * Re-read the store and re-stat the disk to record what the run actually left,
 * rather than what it meant to leave. A failed action must not be written into
 * the base as though it had succeeded — that is exactly the state that would
 * make the next run delete something.
 */
async function buildManifest(
  mountPoint: DocMountPoint,
  targetPath: string
): Promise<SyncManifest> {
  const storeWalk = await walkStore(mountPoint);
  const diskWalk = await walkDisk(targetPath, mountPoint.excludePatterns ?? []);

  const entries: Record<string, ManifestEntry> = {};
  for (const [key, store] of storeWalk.entries) {
    const disk = diskWalk.entries.get(key);
    // Only what both sides agree on becomes the base. An entry present on one
    // side alone is genuinely "new there" next time, which is the right answer.
    if (!disk) continue;
    if (store.kind === 'folder') {
      entries[store.relativePath] = { kind: 'folder', createdAt: store.createdAt };
      continue;
    }
    if (store.sha256 !== disk.sha256) continue;
    entries[store.relativePath] = {
      kind: 'file',
      sha256: store.sha256,
      lastModified: store.lastModified,
      createdAt: store.createdAt,
      ...(store.description || disk.description
        ? {
            descriptionSha256: descriptionSha256(store.description ?? ''),
            descriptionUpdatedAt: store.descriptionUpdatedAt ?? null,
          }
        : {}),
    };
  }

  return {
    version: 1,
    storeId: mountPoint.id,
    storeName: mountPoint.name,
    lastSyncAt: new Date().toISOString(),
    entries,
  };
}

// ============================================================================
// Report
// ============================================================================

function summarise(plan: SyncAction[]): SyncSummary {
  const summary: SyncSummary = {
    created: 0, modified: 0, deleted: 0, touched: 0,
    described: 0, conflicts: 0, skipped: 0, failed: 0,
  };
  for (const action of plan) {
    if (action.outcome === 'failed') { summary.failed++; continue; }
    switch (action.kind) {
      case 'create': case 'mkdir':  summary.created++; break;
      case 'modify':                summary.modified++; break;
      case 'delete': case 'rmdir':  summary.deleted++; break;
      case 'touch':                 summary.touched++; break;
      case 'describe':              summary.described++; break;
      case 'conflict':              summary.conflicts++; break;
      case 'skip':                  summary.skipped++; break;
    }
  }
  return summary;
}

export type { SyncOptions, SyncReport } from './types';
export { SyncOptionsSchema } from './types';
