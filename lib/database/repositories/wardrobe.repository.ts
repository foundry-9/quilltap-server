/**
 * Wardrobe Repository
 *
 * Backend-agnostic repository for WardrobeItem entities.
 * Works with SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { WardrobeItem, WardrobeItemSchema, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { getOverlaidWardrobeItems, syncCharacterVaultWardrobe } from './character-properties-overlay';
import {
  createVaultWardrobeItem,
  updateVaultWardrobeItem,
  deleteVaultWardrobeItem,
} from './vault-overlay/wardrobe-writes';
import { TypedQueryFilter } from '../interfaces';
import { detectComponentCycles } from '@/lib/wardrobe/expand-composites';

/**
 * Wardrobe Repository
 * Implements CRUD operations for wardrobe items (clothing, accessories, etc.)
 * associated with characters or shared as archetypes.
 */
export class WardrobeRepository extends AbstractBaseRepository<WardrobeItem> {
  constructor() {
    super('wardrobe_items', WardrobeItemSchema);
  }

  /**
   * Find multiple wardrobe items by their IDs in a single query
   * @param ids Array of wardrobe item IDs
   * @returns Promise<WardrobeItem[]> Array of found items (may be shorter than input if some IDs don't exist)
   */
  async findByIds(ids: string[]): Promise<WardrobeItem[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.safeQuery(
      () => this.findByFilter({ id: { $in: ids } } as TypedQueryFilter<WardrobeItem>),
      'Error finding wardrobe items by IDs',
      { idCount: ids.length }
    );
  }

  /**
   * Find all wardrobe items belonging to a specific character. Sources items
   * from the character's vault `Wardrobe/*.md` files when present, falling
   * back to DB rows.
   *
   * @param characterId The character ID
   * @param includeArchived When false (default), excludes items where archivedAt is not null
   */
  async findByCharacterId(characterId: string, includeArchived = false): Promise<WardrobeItem[]> {
    return this.safeQuery(
      () =>
        getOverlaidWardrobeItems(
          characterId,
          () => this.findByCharacterIdRaw(characterId, includeArchived),
          { includeArchived },
        ),
      'Error finding wardrobe items by character ID',
      { characterId, includeArchived }
    );
  }

  /**
   * Raw DB-only variant of `findByCharacterId` that bypasses the document-store
   * overlay. Used by the vault populator (to avoid reading the file it's about
   * to write) and by export paths that need the canonical DB rows.
   */
  async findByCharacterIdRaw(characterId: string, includeArchived = false): Promise<WardrobeItem[]> {
    return this.safeQuery(
      async () => {
        const items = await this.findByFilter({ characterId } as TypedQueryFilter<WardrobeItem>);
        if (includeArchived) {
          return items;
        }
        return items.filter((item) => !item.archivedAt);
      },
      'Error finding wardrobe items by character ID (raw)',
      { characterId, includeArchived }
    );
  }

  /**
   * Find a single wardrobe item wearable by a character. Honours the
   * document-store overlay so vault-only items (which have no DB row) resolve,
   * and falls back to a raw lookup so shared archetype items (characterId
   * null) remain reachable. Includes archived items because callers in the
   * equip path need an item's `types` even if it's been archived after the
   * chat last loaded.
   */
  async findByIdForCharacter(
    characterId: string,
    id: string,
    opts?: { projectMountPointIds?: string[] },
  ): Promise<WardrobeItem | null> {
    return this.safeQuery(
      async () => {
        const items = await this.findByCharacterId(characterId, true);
        const owned = items.find((item) => item.id === id);
        if (owned) return owned;
        const archetype = await this.findArchetypeById(id, opts);
        if (archetype) return archetype;
        const raw = await this._findById(id);
        if (raw && raw.characterId == null) return raw;
        return null;
      },
      'Error finding wardrobe item by character + id',
      { characterId, wardrobeItemId: id }
    );
  }

  /**
   * Find multiple wardrobe items wearable by a character. Honours the
   * document-store overlay and includes archetype items (characterId null)
   * for any IDs not found in the character's own wardrobe.
   */
  async findByIdsForCharacter(
    characterId: string,
    ids: string[],
    opts?: { projectMountPointIds?: string[] },
  ): Promise<WardrobeItem[]> {
    if (ids.length === 0) return [];
    return this.safeQuery(
      async () => {
        const items = await this.findByCharacterId(characterId, true);
        const found = new Map(items.filter((i) => ids.includes(i.id)).map((i) => [i.id, i]));
        let missing = ids.filter((id) => !found.has(id));
        if (missing.length > 0) {
          // Shared items live in Quilltap General + any project stores; seed any
          // missing ids from the merged tier set.
          const archetypes = await this.findArchetypes(true, opts);
          for (const a of archetypes) {
            if (missing.includes(a.id)) found.set(a.id, a);
          }
          missing = missing.filter((id) => !found.has(id));
        }
        if (missing.length > 0) {
          const raw = await this.findByFilter({ id: { $in: missing } } as TypedQueryFilter<WardrobeItem>);
          for (const item of raw) {
            if (item.characterId == null) found.set(item.id, item);
          }
        }
        return Array.from(found.values());
      },
      'Error finding wardrobe items by character + ids',
      { characterId, idCount: ids.length }
    );
  }

  /**
   * Find wardrobe items for a character that include a specific type/slot.
   * Since types is stored as a JSON array, we fetch by characterId then filter in JS.
   * Honours the document-store overlay via `findByCharacterId`.
   */
  async findByCharacterIdAndTypes(characterId: string, type: WardrobeItemType): Promise<WardrobeItem[]> {
    return this.safeQuery(
      async () => {
        const items = await this.findByCharacterId(characterId);
        return items.filter((item) => item.types.includes(type));
      },
      'Error finding wardrobe items by character ID and type',
      { characterId, type }
    );
  }

  /**
   * Find default wardrobe items for a character. Honours the document-store
   * overlay.
   */
  async findDefaultsForCharacter(characterId: string): Promise<WardrobeItem[]> {
    return this.safeQuery(
      () =>
        getOverlaidWardrobeItems(
          characterId,
          () =>
            this.findByFilter({
              characterId,
              isDefault: true,
            } as TypedQueryFilter<WardrobeItem>),
          { defaultsOnly: true },
        ),
      'Error finding default wardrobe items for character',
      { characterId }
    );
  }

  /**
   * Find archetype/shared wardrobe items (characterId is null). Tri-tier: reads
   * Quilltap General plus every project store passed in `opts.projectMountPointIds`.
   * Project items override Quilltap General items on id collision (precedence
   * character > project > general; the character tier is handled by callers via
   * `findByCharacterId`).
   *
   * @param includeArchived When false (default), excludes items where archivedAt is not null
   * @param opts.projectMountPointIds Project document stores to fold into the shared pool
   */
  async findArchetypes(
    includeArchived = false,
    opts?: { projectMountPointIds?: string[] },
  ): Promise<WardrobeItem[]> {
    return this.safeQuery(
      async () => {
        // Vault-first: shared archetypes live in Quilltap General/Wardrobe.
        const { readGeneralWardrobe } = await import('@/lib/mount-index/general-wardrobe');
        const general = await readGeneralWardrobe(includeArchived);

        const projectMountPointIds = opts?.projectMountPointIds ?? [];
        if (projectMountPointIds.length > 0) {
          // Merge the project tier over the general tier — project items win on
          // id collision so a project can shadow a household archetype.
          const { readProjectWardrobe } = await import('@/lib/mount-index/project-wardrobe');
          const byId = new Map<string, WardrobeItem>();
          for (const item of general) byId.set(item.id, item);
          for (const mountPointId of projectMountPointIds) {
            try {
              const projectItems = await readProjectWardrobe(mountPointId, includeArchived);
              for (const item of projectItems) byId.set(item.id, item);
            } catch (error) {
              logger.warn('Failed to read project wardrobe tier; skipping', {
                mountPointId,
                context: 'wardrobe',
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          if (byId.size > 0) return Array.from(byId.values());
        } else if (general.length > 0) {
          return general;
        }

        // Fallback to DB rows (pre-migration instances, or General unprovisioned).
        const items = await this.findByFilter(this.createNullableFilter('characterId', null));
        if (includeArchived) {
          return items;
        }
        return items.filter((item) => !item.archivedAt);
      },
      'Error finding archetype wardrobe items',
      { includeArchived }
    );
  }

  /**
   * Find a single shared archetype by id. Reads Quilltap General/Wardrobe (and
   * any project stores in `opts.projectMountPointIds`) first, falling back to a
   * raw DB lookup for pre-migration instances.
   */
  async findArchetypeById(
    id: string,
    opts?: { projectMountPointIds?: string[] },
  ): Promise<WardrobeItem | null> {
    return this.safeQuery(
      async () => {
        const archetypes = await this.findArchetypes(true, opts);
        const found = archetypes.find((a) => a.id === id);
        if (found) return found;
        const raw = await this._findById(id);
        return raw && raw.characterId == null ? raw : null;
      },
      'Error finding archetype wardrobe item by id',
      { wardrobeItemId: id }
    );
  }

  /**
   * Archive a wardrobe item (soft delete)
   * Sets archivedAt to the current timestamp.
   */
  async archive(id: string, ownerCharacterId?: string | null): Promise<WardrobeItem | null> {
    const now = this.getCurrentTimestamp();
    const item = await this.update(id, { archivedAt: now }, ownerCharacterId);
    if (item) {
      logger.info('Wardrobe item archived', { wardrobeItemId: id, archivedAt: now });
    }
    return item;
  }

  /**
   * Unarchive a wardrobe item (restore from archive)
   * Sets archivedAt to null.
   */
  async unarchive(id: string, ownerCharacterId?: string | null): Promise<WardrobeItem | null> {
    const item = await this.update(id, { archivedAt: null }, ownerCharacterId);
    if (item) {
      logger.info('Wardrobe item unarchived', { wardrobeItemId: id });
    }
    return item;
  }

  /**
   * Reject a save that would introduce a cycle through `componentItemIds`.
   * Looks at the would-be id (passed in or freshly minted) plus its proposed
   * components and walks the existing graph for the character's items + shared
   * archetypes. Throws on any cycle found.
   */
  private async assertNoComponentCycles(
    selfId: string,
    componentItemIds: readonly string[],
    characterId: string | null,
  ): Promise<void> {
    if (componentItemIds.length === 0) return;

    const peers = characterId
      ? await this.findByCharacterId(characterId, true)
      : await this.findArchetypes(true);
    const itemsById = new Map(peers.map((i) => [i.id, i]));
    const cycles = detectComponentCycles(selfId, componentItemIds, itemsById);

    if (cycles.length > 0) {
      const message = `Wardrobe item ${selfId} would create a component cycle: ${cycles
        .map((c) => c.join(' → '))
        .join('; ')}`;
      logger.warn('[Wardrobe] Rejected save — component cycle detected', {
        context: 'wardrobe',
        wardrobeItemId: selfId,
        componentItemIds: [...componentItemIds],
        cycles,
      });
      throw new Error(message);
    }
  }

  /**
   * Create a new wardrobe item
   * @param data The wardrobe item data
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<WardrobeItem, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<WardrobeItem> {
    return this.safeQuery(
      async () => {
        const candidateId = options?.id ?? this.generateId();
        const now = this.getCurrentTimestamp();
        const newItem: WardrobeItem = {
          ...data,
          id: candidateId,
          characterId: data.characterId ?? null,
          // Apply the schema defaults for array/flag fields here at the
          // construction chokepoint so callers that hand us a partial item
          // (e.g. AI import, which omits these) never let an undefined reach the
          // vault writer's `componentItemIds.length` check.
          componentItemIds: data.componentItemIds ?? [],
          replace: data.replace ?? false,
          createdAt: options?.createdAt ?? now,
          updatedAt: options?.updatedAt ?? now,
        };

        // Vault-first: write the item straight into the owning character's
        // vault, or Quilltap General for shared archetypes (characterId null).
        // Cycle detection happens inside against the folder's current items.
        const vault = await createVaultWardrobeItem(newItem);
        if (vault.handled) {
          logger.info('Wardrobe item created in vault', {
            wardrobeItemId: newItem.id,
            characterId: newItem.characterId,
            title: newItem.title,
          });
          return vault.value;
        }

        // No vault mount resolved. Wardrobe is fully vault-first: the document
        // store ("Character Vault" / Quilltap General) is the sole *source* for
        // new items, and we must never write one as a primary SQL row. (The DB
        // mirror that the projection sweep relies on is populated only by the
        // sync path's `createFromVault`, not here.) If we land here, the General
        // mount isn't provisioned yet — surface that rather than silently
        // creating an authoritative item the vault doesn't know about.
        logger.error('Wardrobe create has no resolvable vault mount; refusing SQL fallback', {
          wardrobeItemId: newItem.id,
          characterId: newItem.characterId,
          title: newItem.title,
        });
        throw new Error(
          'Cannot create wardrobe item: no Character Vault or Quilltap General mount is available. ' +
            'Wardrobe items are stored exclusively in the document store.',
        );
      },
      'Error creating wardrobe item',
      { characterId: data.characterId ?? null, title: data.title }
    );
  }

  /**
   * Insert a wardrobe item that originated from a character's vault, preserving
   * its stable id and timestamps. Bypasses `syncCharacterVaultWardrobe` so the
   * sync chain itself can promote vault-only items into the DB without
   * recursing back into another sync.
   *
   * Why: the projection sweep in `projectArrayIntoVaultFolder` deletes any
   * `Wardrobe/*.md` file not represented in the DB-derived list. Vault-only
   * items (created by hand or via Document Mode, never written to the DB) get
   * wiped out on the next sync. Promoting them to DB rows ahead of the
   * projection makes the sweep see them as "managed" and leave them alone.
   */
  async createFromVault(item: WardrobeItem): Promise<WardrobeItem> {
    return this.safeQuery(
      async () => {
        await this.assertNoComponentCycles(
          item.id,
          item.componentItemIds ?? [],
          item.characterId ?? null,
        );
        return this._create(
          {
            // `imagePrompt` deliberately omitted: the legacy wardrobe_items
            // table has no such column on pre-existing instances (see `create`).
            // It lives in the vault, which is the authoritative store.
            characterId: item.characterId ?? null,
            title: item.title,
            description: item.description ?? null,
            types: item.types,
            componentItemIds: item.componentItemIds ?? [],
            appropriateness: item.appropriateness ?? null,
            isDefault: item.isDefault,
            replace: item.replace ?? false,
            migratedFromClothingRecordId: item.migratedFromClothingRecordId ?? null,
            archivedAt: item.archivedAt ?? null,
          } as Omit<WardrobeItem, 'id' | 'createdAt' | 'updatedAt'>,
          {
            id: item.id,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          },
        );
      },
      'Error ingesting vault-only wardrobe item into DB',
      { wardrobeItemId: item.id, characterId: item.characterId ?? null, title: item.title },
    );
  }

  /**
   * Update a wardrobe item.
   *
   * `ownerCharacterId` (the owning character, or `null` for a shared archetype)
   * locates the vault mount. Callers that know it — the wardrobe routes — should
   * pass it; without it we derive a best-effort hint from the patch or a
   * (possibly stale) DB row, which only works for pre-cutover items.
   */
  async update(
    id: string,
    data: Partial<WardrobeItem>,
    ownerCharacterId?: string | null,
  ): Promise<WardrobeItem | null> {
    return this.safeQuery(
      async () => {
        const updateData = { ...data };

        // Remove immutable fields to prevent accidental overwrites
        delete updateData.id;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        // Resolve the owning character for mount resolution.
        let hint: string | null | undefined = ownerCharacterId;
        if (hint === undefined) {
          if ('characterId' in updateData) {
            hint = updateData.characterId ?? null;
          } else {
            const existing = await this._findById(id);
            hint = existing ? existing.characterId ?? null : undefined;
          }
        }

        if (hint !== undefined) {
          const vault = await updateVaultWardrobeItem(id, updateData, hint);
          if (vault.handled) {
            if (vault.value) {
              logger.info('Wardrobe item updated in vault', { wardrobeItemId: id });
            }
            return vault.value;
          }
        }

        // Fallback — legacy DB update + sync-out.
        if (updateData.componentItemIds !== undefined) {
          const existing = await this._findById(id);
          const characterId = updateData.characterId ?? existing?.characterId ?? null;
          await this.assertNoComponentCycles(id, updateData.componentItemIds, characterId);
        }
        const item = await this._update(id, updateData);
        if (item) {
          logger.info('Wardrobe item updated (DB fallback)', { wardrobeItemId: id });
          await syncCharacterVaultWardrobe(item.characterId);
        }
        return item;
      },
      'Error updating wardrobe item',
      { wardrobeItemId: id }
    );
  }

  /**
   * Delete a wardrobe item.
   *
   * `ownerCharacterId` (or `null` for a shared archetype) locates the vault
   * mount; the wardrobe routes pass it. Without it we derive a best-effort hint
   * from a (possibly stale) DB row.
   */
  async delete(id: string, ownerCharacterId?: string | null): Promise<boolean> {
    return this.safeQuery(
      async () => {
        let hint: string | null | undefined = ownerCharacterId;
        let existing: WardrobeItem | null = null;
        if (hint === undefined) {
          existing = await this._findById(id);
          hint = existing ? existing.characterId ?? null : undefined;
        }

        if (hint !== undefined) {
          const vault = await deleteVaultWardrobeItem(id, hint);
          if (vault.handled) {
            if (vault.value) {
              logger.info('Wardrobe item deleted from vault', { wardrobeItemId: id });
            }
            return vault.value;
          }
        }

        // Fallback — legacy DB delete + sync-out (tombstone the id so the
        // sync's ingestion step doesn't re-promote the still-on-disk file).
        if (!existing) existing = await this._findById(id);
        const result = await this._delete(id);
        if (result) {
          logger.info('Wardrobe item deleted (DB fallback)', { wardrobeItemId: id });
          if (existing?.characterId) {
            await syncCharacterVaultWardrobe(existing.characterId, new Set([id]));
          }
        }
        return result;
      },
      'Error deleting wardrobe item',
      { wardrobeItemId: id }
    );
  }

}
