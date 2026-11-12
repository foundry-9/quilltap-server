/**
 * Abstract Store-Backed Repository
 *
 * The one base for repositories whose substantive content lives in the
 * entity's official document store rather than in DB columns — projects,
 * groups and characters. It is the chokepoint that hides that split:
 *
 *   - Every read overlays the store (`applyOverlay[One]`) so callers see the
 *     fully-hydrated entity; the `*Raw` readers return the slim row.
 *   - Every write routes store-resident fields to the store (`applyWriteOverlay`)
 *     and writes only the row's columns.
 *   - `create()` provisions and populates the official store before returning,
 *     so a freshly-created entity is never storeless.
 *
 * Subclasses supply a {@link StoreOverlayBinding} (the entity's overlay engine,
 * provisioner and labels) and may override the hooks: {@link prepareCreateData}
 * (create-time defaults), {@link guardUpdate} (refuse a write — a character's
 * archive tombstone), and {@link afterCreate} / {@link afterRename} /
 * {@link afterDelete} (a character's store-name reconcile). The pointer column
 * is {@link pointerField}: `officialMountPointId` for projects and groups,
 * `characterDocumentMountPointId` for characters.
 *
 * `TRow` is what the table holds and the schema validates; `TEntity` is the
 * hydrated entity. Projects and groups validate rows with their full schema
 * (the managed fields are stripped by {@link toPersistedRow}), so for them the
 * two are one type; characters validate with `CharacterRowSchema`, so a raw
 * read is honestly typed `CharacterRow`.
 */

import { BaseEntity, TypedQueryFilter, UpdateSpec } from '../interfaces';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';

/** The minimal row shape a store-backed repository operates on. */
export type StoreBackedEntity = BaseEntity & { name: string };

/** The column holding the entity's official-store pointer. */
export type StorePointerField = 'officialMountPointId' | 'characterDocumentMountPointId';

/**
 * The store-overlay wiring a concrete store-backed repository provides: the
 * overlay operations, the store-managed field set stripped from the row, the
 * provisioning entry point, and the labels used in log lines.
 */
export interface StoreOverlayBinding<TRow, TEntity = TRow> {
  /** Store-resident field names stripped from the slim DB row. */
  readonly managedFields: Iterable<PropertyKey>;
  /** Capitalized singular label for human log lines, e.g. `'Project'`. */
  readonly entityLabel: string;
  /** Log-field key for the entity id, e.g. `'projectId'`. */
  readonly idLogKey: string;
  applyOverlay(rows: TRow[]): Promise<TEntity[]>;
  applyOverlayOne(row: TRow | null): Promise<TEntity | null>;
  /** Route the store fields to the store; return what the row should receive. */
  applyWriteOverlay(id: string, patch: Partial<TEntity>, existing?: TRow | null): Promise<Partial<TRow>>;
  /** Project an in-memory entity into its (fresh) store. */
  writeManagedFields(mountPointId: string, entity: TEntity): Promise<void>;
  /** Provision (or find) the entity's official store and record the pointer. */
  ensureOfficialStore(entity: TEntity): Promise<{ mountPointId: string } | null>;
  /** The full entity from a create payload plus the written row (defaults filled). */
  toEntity?(createPayload: Record<string, unknown>, row: TRow): TEntity;
}

export abstract class AbstractStoreBackedRepository<
  TRow extends StoreBackedEntity,
  TEntity extends TRow = TRow,
> extends AbstractBaseRepository<TRow> {
  /** The entity's store-overlay wiring. Supplied by the concrete subclass. */
  protected abstract readonly store: StoreOverlayBinding<TRow, TEntity>;

  /** The column holding the store pointer. */
  protected readonly pointerField: StorePointerField = 'officialMountPointId';

  // ==========================================================================
  // HOOKS
  // ==========================================================================

  /** Create-time default seeding, before the row is written. */
  protected prepareCreateData(
    data: Omit<TEntity, 'id' | 'createdAt' | 'updatedAt'>,
  ): Omit<TEntity, 'id' | 'createdAt' | 'updatedAt'> {
    return data;
  }

  /** Refuse an update before anything is written (throw). Default: allow. */
  protected guardUpdate(_existing: TRow | null, _patch: Partial<TEntity>): void {}

  /** After a create has provisioned and populated the store. */
  protected async afterCreate(_entity: TEntity): Promise<void> {}

  /** After an update changed the entity's name. */
  protected async afterRename(_id: string): Promise<void> {}

  /** After the row was deleted. */
  protected async afterDelete(_id: string): Promise<void> {}

  // ==========================================================================
  // READS
  // ==========================================================================

  /**
   * Find by ID, hydrated from the document store. Throws the entity's
   * unavailability error if the store is missing/unreadable — the caller asked
   * for this specific entity, so fail loudly.
   */
  async findById(id: string): Promise<TEntity | null> {
    return this.store.applyOverlayOne(await this._findById(id));
  }

  /**
   * The slim row by ID, **without the store**. The right read when the caller
   * needs only the row: existence and ownership, the store pointer, a DB-only
   * flag, a hot path that must survive an unreadable store, and bootstrap /
   * restore / backfill code that runs before a store can be read.
   */
  async findByIdRaw(id: string): Promise<TRow | null> {
    return this._findById(id);
  }

  /**
   * Find all, each hydrated from its document store. A row whose store is
   * unavailable is logged at `error` and dropped so one bad row can't take down
   * the whole list.
   */
  async findAll(): Promise<TEntity[]> {
    return this.store.applyOverlay(await this._findAll());
  }

  /** Every slim row, **without the store**. See {@link findByIdRaw}. */
  async findAllRaw(): Promise<TRow[]> {
    return this._findAll();
  }

  /**
   * The row whose official store is `mountPointId`, **without the store**.
   * The scenario location and the store-name rules use it to classify a mount.
   */
  async findByStorePointerRaw(mountPointId: string): Promise<TRow | null> {
    return this.findOneByFilter({ [this.pointerField]: mountPointId } as unknown as TypedQueryFilter<TRow>);
  }

  /** Find by IDs, each hydrated from its document store. */
  async findByIds(ids: string[]): Promise<TEntity[]> {
    if (ids.length === 0) return [];
    return this.hydrate(await this.findByFilter({ id: { $in: ids } } as TypedQueryFilter<TRow>));
  }

  /** Hydrate rows a subclass query found (the batched overlay). */
  protected hydrate(rows: TRow[]): Promise<TEntity[]> {
    return this.store.applyOverlay(rows);
  }

  // ==========================================================================
  // CREATE / UPDATE / DELETE
  // ==========================================================================

  /**
   * Create an entity, provision its official document store, and populate the
   * store files from the create payload before returning. Fails hard if the
   * store cannot be provisioned — a storeless entity would throw on every read.
   *
   * Any pointer in `data` is dropped: a fresh entity always gets a fresh store
   * (a restore re-binding to the archive's store uses {@link createBoundToStore}).
   */
  async create(
    data: Omit<TEntity, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions,
  ): Promise<TEntity> {
    const label = this.store.entityLabel;
    const lower = label.toLowerCase();
    return this.safeQuery(
      async () => {
        const entityData = {
          ...this.prepareCreateData(data),
          [this.pointerField]: null,
        } as Record<string, unknown>;

        // _create validates and writes only the row; the store content stays
        // in memory for the provisioning below.
        const row = await this._create(entityData as Omit<TRow, 'id' | 'createdAt' | 'updatedAt'>, options);
        const entity = this.store.toEntity ? this.store.toEntity(entityData, row) : (row as TEntity);

        // A row whose store never got its content is a hollow entity that
        // every later check counts as present (first-startup seeding saw two
        // and never ran again). Take the row back out before rethrowing; an
        // already-minted store is left for reconcileStoreNames to retire.
        let mountPointId: string;
        try {
          mountPointId = await this.provisionOfficialStore(entity);
        } catch (provisionError) {
          logger.warn(`${label} store provisioning failed; removing the row just written`, {
            [this.store.idLogKey]: row.id,
            name: row.name,
            error: provisionError instanceof Error ? provisionError.message : String(provisionError),
          });
          try {
            await this._delete(row.id);
          } catch (rollbackError) {
            logger.error(`Could not remove ${lower} row after failed store provisioning`, {
              [this.store.idLogKey]: row.id,
              error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            });
          }
          throw provisionError;
        }
        await this.afterCreate(entity);

        logger.info(`${label} created`, {
          [this.store.idLogKey]: row.id,
          name: row.name,
          mountPointId,
        });

        // Reload through the overlay so the returned entity reflects the
        // store-backed state, including the freshly-set pointer.
        const final = await this.findById(row.id);
        if (!final) {
          throw new Error(`${label} ${row.id} disappeared immediately after creation`);
        }
        return final;
      },
      `Error creating ${lower}`,
      { name: data.name },
    );
  }

  /**
   * Provision the entity's official store and write its store-resident fields
   * from `entity` (the in-memory payload, not a re-read). `ensureOfficialStore`
   * records the pointer on the row. Fails hard rather than leave the entity
   * storeless, which would throw on every read. Returns the store's id.
   */
  async provisionOfficialStore(entity: TEntity): Promise<string> {
    const lower = this.store.entityLabel.toLowerCase();
    const ensured = await this.store.ensureOfficialStore(entity);
    if (!ensured) {
      throw new Error(
        `Failed to provision official document store for ${lower} ${entity.id}; ` +
          `refusing to return a storeless ${lower}.`,
      );
    }
    await this.store.writeManagedFields(ensured.mountPointId, {
      ...entity,
      [this.pointerField]: ensured.mountPointId,
    });
    return ensured.mountPointId;
  }

  /**
   * Restore an entity row bound to the official store a backup carries for it.
   *
   * The one sanctioned exception to {@link create}'s fresh-store rule, and only
   * for the restore: the archive's own store for this entity is being restored
   * alongside the row, so minting a fresh one would leave the row pointing at
   * an empty store and the archived one orphaned (bug 185). The restore's claim
   * map guarantees no two rows are given the same store.
   *
   * Writes the slim row with the pointer set and does nothing else — no
   * provisioning, no store writes (the archive carries the store's files). The
   * store's rows usually arrive later in the restore than the entity's, so the
   * row is returned raw, never through the overlay, which would throw until
   * they do.
   */
  async createBoundToStore(
    data: Omit<TEntity, 'id' | 'createdAt' | 'updatedAt'>,
    mountPointId: string,
    options?: CreateOptions,
  ): Promise<TRow> {
    const label = this.store.entityLabel;
    return this.safeQuery(
      async () => {
        const entityData = {
          ...this.prepareCreateData(data),
          [this.pointerField]: mountPointId,
        } as unknown as Omit<TRow, 'id' | 'createdAt' | 'updatedAt'>;
        const created = await this._create(entityData, options);
        logger.info(`${label} restored bound to its archived store`, {
          [this.store.idLogKey]: created.id,
          name: created.name,
          mountPointId,
        });
        return created;
      },
      `Error restoring ${label.toLowerCase()} bound to its store`,
      { name: data.name, mountPointId },
    );
  }

  /**
   * Update an entity. One raw read serves the guard, the write overlay and the
   * row write. Store-resident fields are routed to the store
   * ({@link StoreOverlayBinding.applyWriteOverlay}); the remainder is written
   * through `_update`. The returned entity is overlaid, exactly as
   * {@link findById} would return it.
   */
  async update(id: string, data: Partial<TEntity>): Promise<TEntity | null> {
    const label = this.store.entityLabel;
    return this.safeQuery(
      async () => {
        const existing = await this.findByIdRaw(id);
        this.guardUpdate(existing, data);
        if (!existing) {
          logger.warn(`${label} not found for update`, { [this.store.idLogKey]: id });
          return null;
        }
        const dbPatch = await this.store.applyWriteOverlay(id, data, existing);
        const result = Object.keys(dbPatch).length > 0 ? await this._update(id, dbPatch, existing) : existing;
        if (result && data.name !== undefined && data.name !== existing.name) {
          await this.afterRename(id);
        }
        logger.info(`${label} updated`, { [this.store.idLogKey]: id });
        // The write overlay may have provisioned a missing store; re-read the
        // pointer in that one case so the hydration sees it.
        const pointer = (result as Record<string, unknown> | null)?.[this.pointerField];
        const row = result && !pointer ? await this.findByIdRaw(id) : result;
        return this.store.applyOverlayOne(row);
      },
      `Error updating ${label.toLowerCase()}`,
      { [this.store.idLogKey]: id },
    );
  }

  /**
   * Persist ONLY the pointer on the slim row, bypassing the document-store
   * overlay entirely. Provisioning calls this to record a freshly created
   * store's id BEFORE the store files exist — the normal, overlay-applying
   * {@link update} would throw on its closing re-read.
   */
  async setOfficialMountPointId(id: string, mountPointId: string): Promise<void> {
    await this._update(id, { [this.pointerField]: mountPointId } as unknown as Partial<TRow>);
  }

  /**
   * Delete the slim row. Callers are responsible for dropping memberships and
   * unlinking additional stores; the official store is orphaned.
   */
  async delete(id: string): Promise<boolean> {
    const label = this.store.entityLabel;
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);
        if (result) {
          logger.info(`${label} deleted`, { [this.store.idLogKey]: id });
          await this.afterDelete(id);
        }
        return result;
      },
      `Error deleting ${label.toLowerCase()}`,
      { [this.store.idLogKey]: id },
    );
  }

  protected createErrorMessage(): string {
    return `Error creating ${this.store.entityLabel.toLowerCase()} entity`;
  }

  /**
   * Store-aware row transform for the base `_create`. Strips store-resident
   * keys before INSERT (a row schema that knows none of them — characters'
   * — makes this a no-op).
   */
  protected toPersistedRow(validated: TRow): TRow {
    const dbRow = { ...validated } as Record<string, unknown>;
    for (const f of this.store.managedFields) {
      delete dbRow[f as string];
    }
    return dbRow as TRow;
  }

  /**
   * Store-aware override of the base `_update`: read the raw row (or take the
   * one the caller already holds), merge, validate with the repository's
   * schema, and write only the row's columns.
   */
  protected async _update(id: string, data: Partial<TRow>, known?: TRow | null): Promise<TRow | null> {
    return this.safeQuery(async () => {
      const existing = known !== undefined ? known : await this.findByIdRaw(id);
      if (!existing) {
        logger.warn('Entity not found for update', { collection: this.collectionName, id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const validated = this.validate({
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: ('updatedAt' in data)
          ? (data as Record<string, unknown>).updatedAt as string
          : now,
      });

      const collection = await this.getCollection();
      await collection.updateOne(
        { id } as TypedQueryFilter<TRow>,
        { $set: this.toPersistedRow(validated) } as UpdateSpec<TRow>,
      );

      return validated;
    }, `Error updating ${this.store.entityLabel.toLowerCase()} entity`, { id });
  }
}
