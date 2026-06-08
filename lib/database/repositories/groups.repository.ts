/**
 * Groups Repository
 *
 * Backend-agnostic repository for Group entities.
 * Works with SQLite through the database abstraction layer.
 *
 * A "Group" is a cross-section of *characters* (parallel to how a Project is a
 * cross-section of files/chats). Like projects, a group's substantive content
 * lives in its official document store, not in `groups` columns. This repository
 * is the chokepoint that hides that split:
 *
 *   - Every read overlays the store (`applyGroupStoreOverlay[One]`) so callers
 *     see the fully-hydrated `Group`.
 *   - Every write routes store-resident fields to the store
 *     (`applyGroupStoreWriteOverlay`) and strips them
 *     (`GROUP_STORE_MANAGED_FIELDS`) from the slim DB row.
 *   - `create()` provisions and populates the official store before returning,
 *     so a freshly-created group is never storeless.
 *
 * Membership (characters ↔ groups) and *additional linked* stores live in the
 * mount-index DB via `GroupCharacterMembersRepository` and
 * `GroupDocMountLinksRepository`, not on the group row.
 */

import { Group, GroupSchema, GROUP_STORE_MANAGED_FIELDS } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter, UpdateSpec } from '../interfaces';
import { logger } from '@/lib/logger';
import {
  applyGroupStoreOverlay,
  applyGroupStoreOverlayOne,
} from '@/lib/groups/group-store/read-overlay';
import {
  applyGroupStoreWriteOverlay,
  writeGroupStoreManagedFields,
} from '@/lib/groups/group-store/write-overlay';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';

/**
 * Groups Repository
 * Implements CRUD operations for groups with document-store-backed content.
 */
export class GroupsRepository extends AbstractBaseRepository<Group> {
  constructor() {
    super('groups', GroupSchema);
  }

  // ==========================================================================
  // READS (document-store overlay applied)
  // ==========================================================================

  /**
   * Find a group by ID, hydrated from its document store. Throws
   * `GroupStoreUnavailableError` if the store is missing/unreadable — the caller
   * asked for this specific group, so fail loudly.
   */
  async findById(id: string): Promise<Group | null> {
    const raw = await this._findById(id);
    return applyGroupStoreOverlayOne(raw);
  }

  /**
   * Find a group by ID **without applying the document-store overlay**. The
   * returned Group has empty/default values for every store-resident field.
   *
   * **Almost no caller wants this.** Use {@link findById} for any normal read.
   * The legitimate exceptions are the overlay's own bootstrap, the hot
   * tier-resolution path (which only needs `officialMountPointId`), and startup
   * backfills that operate on the row directly.
   */
  async findByIdRaw(id: string): Promise<Group | null> {
    return this._findById(id);
  }

  /**
   * Find all groups, each hydrated from its document store. A group whose store
   * is unavailable is logged at `error` and dropped from the result so one bad
   * row can't take down the whole list.
   */
  async findAll(): Promise<Group[]> {
    const raw = await this._findAll();
    return applyGroupStoreOverlay(raw);
  }

  /**
   * Find all groups **without applying the document-store overlay**. See the
   * warnings on {@link findByIdRaw}. Reserved for startup backfills and the
   * overlay's own bootstrap.
   */
  async findAllRaw(): Promise<Group[]> {
    return this._findAll();
  }

  /**
   * Find groups by IDs, hydrated from their document stores.
   */
  async findByIds(ids: string[]): Promise<Group[]> {
    if (ids.length === 0) return [];
    const raw = await this.findByFilter({ id: { $in: ids } } as TypedQueryFilter<Group>);
    return applyGroupStoreOverlay(raw);
  }

  // ==========================================================================
  // CREATE / UPDATE / DELETE
  // ==========================================================================

  /**
   * Create a new group, provision its official document store, and populate the
   * store files from the create payload before returning. Fails hard if the
   * store cannot be provisioned — a storeless group would throw on every read.
   *
   * @param data The group data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<Group> The created, fully-hydrated group
   */
  async create(
    data: Omit<Group, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Group> {
    return this.safeQuery(
      async () => {
        // Drop any incoming officialMountPointId — create always provisions a
        // fresh store. Importers carrying a source pointer shouldn't reuse it.
        const groupData = {
          ...data,
          officialMountPointId: null,
        } as Omit<Group, 'id' | 'createdAt' | 'updatedAt'>;

        // _create validates the full group (store fields in memory) and writes
        // only the slim row.
        const created = await this._create(groupData, options);

        // Provision the official store, then write the overlay files from the
        // in-memory create payload (which carries description/instructions/state/
        // properties). ensureGroupOfficialStore sets officialMountPointId on the
        // row.
        const ensured = await ensureGroupOfficialStore(created.id, created.name);
        if (!ensured) {
          throw new Error(
            `Failed to provision official document store for group ${created.id}; ` +
              `refusing to return a storeless group.`,
          );
        }
        await writeGroupStoreManagedFields(ensured.mountPointId, {
          ...created,
          officialMountPointId: ensured.mountPointId,
        });

        logger.info('Group created', {
          groupId: created.id,
          name: created.name,
          officialMountPointId: ensured.mountPointId,
        });

        // Reload through the overlay so the returned group reflects the
        // store-backed state, including the freshly-set mount pointer.
        const finalGroup = await this.findById(created.id);
        if (!finalGroup) {
          throw new Error(`Group ${created.id} disappeared immediately after creation`);
        }
        return finalGroup;
      },
      'Error creating group',
      { name: data.name }
    );
  }

  /**
   * Update a group.
   *
   * Store-resident fields (description, instructions, state, and the properties
   * bag) in `data` are routed to the group's official store via
   * {@link applyGroupStoreWriteOverlay}; the remaining DB-only fields (`name`,
   * `officialMountPointId`) are written through `_update`. The returned group is
   * overlaid so callers see the store-backed view, exactly as {@link findById}
   * would.
   *
   * @param id The group ID
   * @param data Partial group data to update
   * @returns Promise<Group | null> The updated group if found, null otherwise
   */
  async update(id: string, data: Partial<Group>): Promise<Group | null> {
    return this.safeQuery(
      async () => {
        const dbPatch = await applyGroupStoreWriteOverlay(id, data);
        const hasDbWork = Object.keys(dbPatch).length > 0;
        const result = hasDbWork ? await this._update(id, dbPatch) : await this._findById(id);
        if (result) {
          logger.info('Group updated', { groupId: id });
        }
        return applyGroupStoreOverlayOne(result);
      },
      'Error updating group',
      { groupId: id }
    );
  }

  /**
   * Persist ONLY the `officialMountPointId` FK on the slim row, bypassing the
   * document-store overlay entirely.
   *
   * Provisioning (`ensureGroupOfficialStore`) calls this to record a freshly
   * created store's id BEFORE the store files exist. The normal,
   * overlay-applying {@link update} cannot be used there: its closing re-read
   * (`applyGroupStoreOverlayOne`) would throw `GroupStoreUnavailableError`
   * ("properties.json missing") because `writeGroupStoreManagedFields` hasn't
   * run yet. The store-aware `_update` writes the column off the raw row and
   * never re-reads the store. Write-side sibling of {@link findByIdRaw}; almost
   * no caller wants this — use {@link update} for any normal write.
   *
   * @param id The group ID
   * @param mountPointId The official store's mount-point ID
   */
  async setOfficialMountPointId(id: string, mountPointId: string): Promise<void> {
    await this._update(id, { officialMountPointId: mountPointId });
  }

  /**
   * Delete a group row. Callers are responsible for dropping memberships and
   * unlinking additional stores (see the API delete handler); the official store
   * is orphaned, matching project delete behavior.
   *
   * @param id The group ID
   * @returns Promise<boolean> True if group was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('Group deleted', { groupId: id });
        }

        return result;
      },
      'Error deleting group',
      { groupId: id }
    );
  }

  /**
   * Store-aware override of the base `_create`. Strips store-resident keys
   * before INSERT so callers that pass e.g. `description` or `state` to
   * `create()` don't blow up with "no such column" — those fields belong in the
   * group's document store, not the DB row.
   */
  protected async _create(
    data: Omit<Group, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Group> {
    return this.safeQuery(async () => {
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;
      const updatedAt = options?.updatedAt || now;

      const entityInput = {
        ...data,
        id,
        createdAt,
        updatedAt,
      };

      const validated = this.validate(entityInput) as Group;

      const dbRow = { ...validated } as Record<string, unknown>;
      for (const f of GROUP_STORE_MANAGED_FIELDS) {
        delete dbRow[f as string];
      }

      const collection = await this.getCollection();
      await collection.insertOne(dbRow as Group);

      logger.info('Entity created', { collection: 'groups', id });

      return validated;
    }, 'Error creating group entity');
  }

  /**
   * Store-aware override of the base `_update`. Store-resident fields live in the
   * group's document store. Read raw, merge, validate, then strip store-resident
   * keys before writing as a defensive backstop so `$set` never references a
   * dropped column.
   */
  protected async _update(id: string, data: Partial<Group>): Promise<Group | null> {
    return this.safeQuery(async () => {
      const existing = await this.findByIdRaw(id);
      if (!existing) {
        logger.warn('Entity not found for update', { collection: 'groups', id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const merged = {
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: ('updatedAt' in data)
          ? (data as Record<string, unknown>).updatedAt as string
          : now,
      } as Group;

      const validated = this.validate(merged) as Group;

      const dbRow = { ...validated } as Record<string, unknown>;
      for (const f of GROUP_STORE_MANAGED_FIELDS) {
        delete dbRow[f as string];
      }

      const collection = await this.getCollection();
      await collection.updateOne(
        { id } as TypedQueryFilter<Group>,
        { $set: dbRow } as UpdateSpec<Group>
      );

      return validated;
    }, 'Error updating group entity', { id });
  }
}
