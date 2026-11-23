/**
 * Owner Document Mount Links Repository
 *
 * The shared body of the join tables that link an owner in the main database
 * (a project, a group) to a document store. The rows live in the dedicated
 * mount index database (quilltap-mount-index.db) via
 * `AbstractDedicatedDbRepository`, beside the mount data they point at.
 *
 * A subclass names its table, schema, the column holding the owner's id and
 * the owner's noun for error messages, and exposes the owner-axis finder under
 * its own name (`findByProjectId`, `findByGroupId`).
 *
 * When the mount index DB is in degraded mode (corruption, permissions, etc.),
 * getCollection() throws and the safeQuery fallbacks kick in: finders return
 * empty arrays and the rest of the app continues normally.
 */

import { z } from 'zod';
import { CreateOptions } from './base.repository';
import { AbstractDedicatedDbRepository } from './dedicated-db.repository';
import { BaseEntity, TypedQueryFilter } from '../interfaces';
import { requireMountIndexDb } from '../backends/sqlite/mount-index-guard';

/** A link row: an owner column (named by the subclass) and the store it points at. */
export interface OwnerDocMountLink extends BaseEntity {
  mountPointId: string;
}

export interface OwnerDocMountLinksOptions<T> {
  /** The column holding the owner's id. */
  ownerKey: keyof T & string;
  /** The owner in lower case, as error messages name it ("group"). */
  ownerNoun: string;
}

export abstract class OwnerDocMountLinksRepository<
  T extends OwnerDocMountLink,
> extends AbstractDedicatedDbRepository<T> {
  protected readonly ownerKey: keyof T & string;
  protected readonly ownerNoun: string;

  constructor(collectionName: string, schema: z.ZodType, options: OwnerDocMountLinksOptions<T>) {
    super(collectionName, schema, { dbTarget: 'mountIndex', acquireDb: requireMountIndexDb });
    this.ownerKey = options.ownerKey;
    this.ownerNoun = options.ownerNoun;
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>, options?: CreateOptions): Promise<T> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Link queries
  // ============================================================================

  /** The filter for one owner's links, optionally narrowed to one store. */
  protected ownerFilter(ownerId: string, mountPointId?: string): TypedQueryFilter<T> {
    return {
      [this.ownerKey]: ownerId,
      ...(mountPointId === undefined ? {} : { mountPointId }),
    } as TypedQueryFilter<T>;
  }

  /** Every link an owner has. Subclasses expose it under the owner's name. */
  protected findByOwnerId(ownerId: string): Promise<T[]> {
    return this.safeQuery(
      () => this.findByFilter(this.ownerFilter(ownerId)),
      `Error finding links by ${this.ownerNoun} ID`,
      { [this.ownerKey]: ownerId },
      []
    );
  }

  /** Every link that points at a store. */
  async findByMountPointId(mountPointId: string): Promise<T[]> {
    return this.safeQuery(
      () => this.findByFilter({ mountPointId } as TypedQueryFilter<T>),
      'Error finding links by mount point ID',
      { mountPointId },
      []
    );
  }

  /**
   * Link an owner to a store. An existing link is returned as it stands, so
   * linking twice never makes a second row.
   */
  async link(ownerId: string, mountPointId: string): Promise<T> {
    return this.safeQuery(
      async () => {
        const existing = await this.findOneByFilter(this.ownerFilter(ownerId, mountPointId));
        if (existing) {
          return existing;
        }
        return this._create(
          { [this.ownerKey]: ownerId, mountPointId } as unknown as Omit<T, 'id' | 'createdAt' | 'updatedAt'>
        );
      },
      `Error linking ${this.ownerNoun} to mount point`,
      { [this.ownerKey]: ownerId, mountPointId }
    );
  }

  /**
   * Unlink an owner from a store.
   * @returns true if a link was deleted, false if none existed
   */
  async unlink(ownerId: string, mountPointId: string): Promise<boolean> {
    return this.safeQuery(
      async () => (await this.deleteMany(this.ownerFilter(ownerId, mountPointId))) > 0,
      `Error unlinking ${this.ownerNoun} from mount point`,
      { [this.ownerKey]: ownerId, mountPointId }
    );
  }
}
