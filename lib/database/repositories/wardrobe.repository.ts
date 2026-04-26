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
import { TypedQueryFilter } from '../interfaces';

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
   * Find a wardrobe item by ID
   */
  async findById(id: string): Promise<WardrobeItem | null> {
    return this._findById(id);
  }

  /**
   * Find all wardrobe items
   */
  async findAll(): Promise<WardrobeItem[]> {
    return this._findAll();
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
   * Find all wardrobe items belonging to a specific character. Honours the
   * per-character document-store overlay: when the character's
   * `readPropertiesFromDocumentStore` flag is on, items are sourced from the
   * vault's `Wardrobe/*.md` files instead of the DB.
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
  async findByIdForCharacter(characterId: string, id: string): Promise<WardrobeItem | null> {
    return this.safeQuery(
      async () => {
        const items = await this.findByCharacterId(characterId, true);
        const owned = items.find((item) => item.id === id);
        if (owned) return owned;
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
  async findByIdsForCharacter(characterId: string, ids: string[]): Promise<WardrobeItem[]> {
    if (ids.length === 0) return [];
    return this.safeQuery(
      async () => {
        const items = await this.findByCharacterId(characterId, true);
        const found = new Map(items.filter((i) => ids.includes(i.id)).map((i) => [i.id, i]));
        const missing = ids.filter((id) => !found.has(id));
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
   * Find archetype wardrobe items (characterId is null, shared across characters)
   * @param includeArchived When false (default), excludes items where archivedAt is not null
   */
  async findArchetypes(includeArchived = false): Promise<WardrobeItem[]> {
    return this.safeQuery(
      async () => {
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
   * Archive a wardrobe item (soft delete)
   * Sets archivedAt to the current timestamp.
   */
  async archive(id: string): Promise<WardrobeItem | null> {
    return this.safeQuery(
      async () => {
        const now = this.getCurrentTimestamp();
        const item = await this._update(id, { archivedAt: now } as Partial<WardrobeItem>);

        if (item) {
          logger.info('Wardrobe item archived', { wardrobeItemId: id, archivedAt: now });
          await syncCharacterVaultWardrobe(item.characterId);
        }

        return item;
      },
      'Error archiving wardrobe item',
      { wardrobeItemId: id }
    );
  }

  /**
   * Unarchive a wardrobe item (restore from archive)
   * Sets archivedAt to null.
   */
  async unarchive(id: string): Promise<WardrobeItem | null> {
    return this.safeQuery(
      async () => {
        const item = await this._update(id, { archivedAt: null } as Partial<WardrobeItem>);

        if (item) {
          logger.info('Wardrobe item unarchived', { wardrobeItemId: id });
          await syncCharacterVaultWardrobe(item.characterId);
        }

        return item;
      },
      'Error unarchiving wardrobe item',
      { wardrobeItemId: id }
    );
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
        const item = await this._create(data, options);

        logger.info('Wardrobe item created successfully', {
          wardrobeItemId: item.id,
          characterId: data.characterId ?? null,
          title: data.title,
        });

        await syncCharacterVaultWardrobe(item.characterId);

        return item;
      },
      'Error creating wardrobe item',
      { characterId: data.characterId ?? null, title: data.title }
    );
  }

  /**
   * Update a wardrobe item
   */
  async update(id: string, data: Partial<WardrobeItem>): Promise<WardrobeItem | null> {
    return this.safeQuery(
      async () => {
        const updateData = { ...data };

        // Remove id and createdAt to prevent accidental overwrites
        delete updateData.id;
        delete updateData.createdAt;

        const item = await this._update(id, updateData);

        if (item) {
          logger.info('Wardrobe item updated successfully', { wardrobeItemId: id });
          await syncCharacterVaultWardrobe(item.characterId);
        }

        return item;
      },
      'Error updating wardrobe item',
      { wardrobeItemId: id }
    );
  }

  /**
   * Delete a wardrobe item
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        // Fetch first so we know whose vault to sync — once the row is gone
        // there's nothing to look up.
        const existing = await this._findById(id);
        const result = await this._delete(id);

        if (result) {
          logger.info('Wardrobe item deleted successfully', { wardrobeItemId: id });
          if (existing?.characterId) {
            await syncCharacterVaultWardrobe(existing.characterId);
          }
        }

        return result;
      },
      'Error deleting wardrobe item',
      { wardrobeItemId: id }
    );
  }
}
