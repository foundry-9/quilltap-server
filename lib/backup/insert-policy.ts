/**
 * One insert policy for every row that restore or `.qtap` import brings into
 * an instance.
 *
 * Both subsystems ask the same question of every incoming row — *what happens
 * when it already exists?* — and used to answer it by hand, per entity kind,
 * in ways that disagreed (#188, #195). The rules now live here, once:
 *
 * - **No existing row**: create it, under the incoming id when ids are being
 *   preserved, else under a fresh one. The id map records the row that exists.
 * - **Skip**: leave the existing row alone and map the incoming id to it.
 * - **Overwrite**: the row **keeps its id**. Updated in place when the caller
 *   supplies `update`, otherwise removed and created again under the same id —
 *   never recreated under a new one, which is what left every outside
 *   reference dangling (#188). Fields the bundle cannot carry (a profile's
 *   `apiKeyId`) are the caller's to leave out of its patch.
 * - **Duplicate**: create a new row beside the existing one and map the
 *   incoming id to **the row that was created** — never to an id no row
 *   receives (#195).
 *
 * Every call returns an {@link InsertOutcome}; summaries count outcomes with
 * an {@link OutcomeTally}, never the length of the incoming array.
 *
 * @module backup/insert-policy
 */

import { logger } from '@/lib/logger';

const moduleLogger = logger.child({ module: 'backup:insert-policy' });

/** The conflict strategies an import offers. Restore creates under `skip`. */
export type ConflictStrategy = 'skip' | 'overwrite' | 'duplicate';

export type InsertStatus = 'created' | 'updated' | 'skipped' | 'failed';

export interface InsertOutcome {
  status: InsertStatus;
  /** The id of the row that exists afterwards (absent only on `failed`). */
  id?: string;
  /** Set on `failed`, and on a `skipped` the caller explained. */
  warning?: string;
}

/** What `create` is asked to do. */
export interface CreateRequest<E> {
  /** The id to create under, or undefined for a fresh one. */
  id?: string;
  /** True when this row is a copy beside an existing one. */
  duplicate: boolean;
  /** The row being replaced, on an overwrite that recreates. */
  replacing?: E;
}

export interface InsertPolicyOptions<E extends { id: string }> {
  /** Entity noun for warnings and logs ("connection profile"). */
  kind: string;
  /** Human label for the incoming row ("Old Faithful"). */
  label: string;
  /** The id the incoming row carries. */
  incomingId: string;
  strategy: ConflictStrategy;
  /** Create under `incomingId` when no row exists. */
  preserveIds?: boolean;
  /** The row the incoming one collides with, or null. Omit for "never collides". */
  findExisting?: () => Promise<E | null>;
  create: (request: CreateRequest<E>) => Promise<{ id: string }>;
  /** In-place overwrite. Preferred over remove + create when given. */
  update?: (existing: E) => Promise<unknown>;
  /** Clear the existing row before an overwrite recreates it under its id. */
  remove?: (existing: E) => Promise<unknown>;
  /**
   * Refuse an overwrite of this existing row (a built-in, a tombstone):
   * return the reason and the row is skipped instead, mapped to itself.
   */
  refuseOverwrite?: (existing: E) => string | null;
  /** Records incoming id → the id of the row that exists afterwards. */
  idMap?: Map<string, string>;
  /** Failures are pushed here as named warnings. */
  warnings?: string[];
  /** The verb a failure warning uses ("import" or "restore"). Default "import". */
  action?: 'import' | 'restore';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Bring one row in under the policy. Never throws: a failure is returned as
 * `{ status: 'failed' }` with a warning (also pushed to `warnings`).
 */
export async function insertUnderPolicy<E extends { id: string }>(
  options: InsertPolicyOptions<E>
): Promise<InsertOutcome> {
  const { kind, label, incomingId, strategy, idMap } = options;
  const record = (outcome: InsertOutcome): InsertOutcome => {
    if (outcome.id && idMap) idMap.set(incomingId, outcome.id);
    return outcome;
  };

  try {
    const existing = options.findExisting ? await options.findExisting() : null;

    if (!existing) {
      const created = await options.create({
        id: options.preserveIds ? incomingId : undefined,
        duplicate: false,
      });
      return record({ status: 'created', id: created.id });
    }

    if (strategy === 'skip') {
      moduleLogger.debug('Skipped existing row', { kind, incomingId, existingId: existing.id });
      return record({ status: 'skipped', id: existing.id });
    }

    if (strategy === 'duplicate') {
      const created = await options.create({ id: undefined, duplicate: true });
      moduleLogger.debug('Duplicated existing row', { kind, incomingId, existingId: existing.id, createdId: created.id });
      return record({ status: 'created', id: created.id });
    }

    // Overwrite: the row keeps its id.
    const refusal = options.refuseOverwrite?.(existing) ?? null;
    if (refusal) {
      const warning = `The ${kind} "${label}" was not overwritten: ${refusal}`;
      options.warnings?.push(warning);
      moduleLogger.debug('Overwrite refused; existing row kept', { kind, incomingId, existingId: existing.id, refusal });
      return record({ status: 'skipped', id: existing.id, warning });
    }
    if (options.update) {
      await options.update(existing);
    } else {
      await options.remove?.(existing);
      const created = await options.create({ id: existing.id, duplicate: false, replacing: existing });
      if (created.id !== existing.id) {
        throw new Error(`overwrite recreated the row as ${created.id} instead of ${existing.id}`);
      }
    }
    moduleLogger.debug('Overwrote existing row in place', { kind, incomingId, existingId: existing.id });
    return record({ status: 'updated', id: existing.id });
  } catch (error) {
    const warning = `Failed to ${options.action ?? 'import'} ${kind} "${label}": ${describe(error)}`;
    options.warnings?.push(warning);
    moduleLogger.warn('Failed to insert row under policy', { kind, incomingId, error: describe(error) });
    return { status: 'failed', warning };
  }
}

/** Counts outcomes for a summary. */
export class OutcomeTally {
  created = 0;
  updated = 0;
  skipped = 0;
  failed = 0;

  add(outcome: InsertOutcome): InsertOutcome {
    this[outcome.status]++;
    return outcome;
  }

  /** Rows this run wrote (created or overwritten). */
  get written(): number {
    return this.created + this.updated;
  }
}
