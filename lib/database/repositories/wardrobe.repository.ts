/**
 * Wardrobe Repository
 *
 * Reads a character's own wardrobe and the shared tiers, and keeps the old
 * owner-hint write API as thin adapters over the folder writers. Wardrobe
 * items live only in document stores (`Wardrobe/*.md`); there is no table.
 *
 * New code addresses a tier through `resolveWardrobeLocation`
 * (`lib/wardrobe/location.ts`) and reads what a character can wear through
 * `loadWearablePool` (`lib/wardrobe/pool.ts`), never through owner-id hints or
 * hand-walked tiers.
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItemWithOrigin, WardrobeOrigin } from '@/lib/wardrobe/wardrobe-container';
import type { RepositoryDbTarget } from './base.repository';
import { getOverlaidWardrobeItems } from './character-properties-overlay';
import {
  createInMount,
  deleteInMount,
  resolveWardrobeMount,
  updateInMount,
  type WardrobeMount,
} from './vault-overlay/wardrobe-writes';

/** Create options: a caller restoring or transferring an item keeps its id and stamps. */
export interface WardrobeCreateOptions {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class WardrobeRepository {
  /**
   * The job child's write partitioner routes a buffered `wardrobe.*` write by
   * this tag. It stays `'main'` as it was when this class extended the base
   * repository: the replayed call writes the document store itself.
   */
  readonly dbTarget: RepositoryDbTarget = 'main';

  /**
   * Every item in a character's own vault `Wardrobe/` folder.
   *
   * @param includeArchived When false (default), excludes archived items
   */
  async findByCharacterId(characterId: string, includeArchived = false): Promise<WardrobeItem[]> {
    try {
      return await getOverlaidWardrobeItems(characterId, { includeArchived });
    } catch (error) {
      logger.error('Error finding wardrobe items by character ID', {
        characterId,
        includeArchived,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Read the `Wardrobe/` folder of each shared mount in order, a later mount's
   * item shadowing an earlier one with the same id — so pass mounts
   * weakest-tier-first. Each item is tagged by `originOf(mountPointId)`.
   *
   * A mount that can't be read is logged and skipped: one unreadable store
   * must not cost a character the rest of their wardrobe.
   */
  async readSharedTiers(
    mountPointIds: readonly string[],
    includeArchived: boolean,
    originOf: (mountPointId: string) => WardrobeOrigin,
  ): Promise<WardrobeItemWithOrigin[]> {
    if (mountPointIds.length === 0) return [];
    const { readSharedWardrobe } = await import('@/lib/mount-index/shared-wardrobe');
    const byId = new Map<string, WardrobeItemWithOrigin>();
    for (const mountPointId of mountPointIds) {
      try {
        const origin = originOf(mountPointId);
        for (const item of await readSharedWardrobe(mountPointId, includeArchived)) {
          byId.set(item.id, { ...item, origin });
        }
      } catch (error) {
        logger.warn('Failed to read shared wardrobe tier; skipping', {
          mountPointId,
          context: 'wardrobe',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    logger.debug('Read shared wardrobe tiers', {
      mountCount: mountPointIds.length,
      itemCount: byId.size,
      includeArchived,
      context: 'wardrobe',
    });
    return Array.from(byId.values());
  }

  /**
   * Create an item in its owner's folder: the character's vault, or Quilltap
   * General for `characterId: null`. Kept for the import and restore writers,
   * which address items by owner; everything else creates through a location.
   */
  async create(
    data: Omit<WardrobeItem, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<WardrobeItem, 'archivedAt'>>,
    options?: WardrobeCreateOptions,
  ): Promise<WardrobeItem> {
    const now = new Date().toISOString();
    const item: WardrobeItem = {
      ...data,
      id: options?.id ?? randomUUID(),
      characterId: data.characterId ?? null,
      // Schema defaults applied at the construction chokepoint so a partial
      // item (AI import omits these) never reaches the writer undefined.
      componentItemIds: data.componentItemIds ?? [],
      replace: data.replace ?? false,
      createdAt: options?.createdAt ?? now,
      updatedAt: options?.updatedAt ?? now,
    };
    return createInMount(await this.mountFor(item.characterId ?? null, 'create'), item);
  }

  /** Patch an item in its owner's folder (`null` = Quilltap General). */
  async update(
    id: string,
    data: Partial<WardrobeItem>,
    ownerCharacterId: string | null,
  ): Promise<WardrobeItem | null> {
    const patch = { ...data };
    delete patch.id;
    delete patch.createdAt;
    delete patch.updatedAt;
    return updateInMount(await this.mountFor(ownerCharacterId, 'update'), id, patch);
  }

  /** Delete an item from its owner's folder (`null` = Quilltap General). */
  async delete(id: string, ownerCharacterId: string | null): Promise<boolean> {
    return deleteInMount(await this.mountFor(ownerCharacterId, 'delete'), id);
  }

  private async mountFor(ownerCharacterId: string | null, op: string): Promise<WardrobeMount> {
    const mount = await resolveWardrobeMount(ownerCharacterId);
    if (mount) return mount;
    logger.error('Wardrobe write has no resolvable folder', { op, ownerCharacterId });
    throw new Error(
      `Cannot ${op} wardrobe item: no Character Vault or Quilltap General mount is available. ` +
        'Wardrobe items are stored exclusively in the document store.',
    );
  }
}
