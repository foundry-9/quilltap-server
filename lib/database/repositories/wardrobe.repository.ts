/**
 * Wardrobe Repository
 *
 * Backend-agnostic repository for WardrobeItem entities.
 * Works with SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { WardrobeItem, WardrobeItemSchema, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
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
   * Find all wardrobe items belonging to a specific character
   * @param characterId The character ID
   * @param includeArchived When false (default), excludes items where archivedAt is not null
   */
  async findByCharacterId(characterId: string, includeArchived = false): Promise<WardrobeItem[]> {
    return this.safeQuery(
      async () => {
        const items = await this.findByFilter({ characterId } as TypedQueryFilter<WardrobeItem>);
        if (includeArchived) {
          return items;
        }
        return items.filter((item) => !item.archivedAt);
      },
      'Error finding wardrobe items by character ID',
      { characterId, includeArchived }
    );
  }

  /**
   * Find wardrobe items for a character that include a specific type/slot.
   * Since types is stored as a JSON array, we fetch by characterId then filter in JS.
   */
  async findByCharacterIdAndTypes(characterId: string, type: WardrobeItemType): Promise<WardrobeItem[]> {
    return this.safeQuery(
      async () => {
        const items = await this.findByFilter({ characterId } as TypedQueryFilter<WardrobeItem>);
        return items.filter((item) => item.types.includes(type));
      },
      'Error finding wardrobe items by character ID and type',
      { characterId, type }
    );
  }

  /**
   * Find default wardrobe items for a character
   */
  async findDefaultsForCharacter(characterId: string): Promise<WardrobeItem[]> {
    return this.safeQuery(
      () => this.findByFilter({ characterId, isDefault: true } as TypedQueryFilter<WardrobeItem>),
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
        const result = await this._delete(id);

        if (result) {
          logger.info('Wardrobe item deleted successfully', { wardrobeItemId: id });
        }

        return result;
      },
      'Error deleting wardrobe item',
      { wardrobeItemId: id }
    );
  }
}
