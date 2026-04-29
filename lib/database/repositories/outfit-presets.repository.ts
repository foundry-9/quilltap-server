/**
 * Outfit Presets Repository
 *
 * Backend-agnostic repository for OutfitPreset entities.
 * Works with SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { OutfitPreset, OutfitPresetSchema, WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { getOverlaidOutfitPresets, syncCharacterVaultWardrobe } from './character-properties-overlay';
import { TypedQueryFilter } from '../interfaces';

/**
 * Outfit Presets Repository
 * Implements CRUD operations for outfit presets (saved slot combinations)
 * associated with characters or shared across characters.
 */
export class OutfitPresetsRepository extends AbstractBaseRepository<OutfitPreset> {
  constructor() {
    super('outfit_presets', OutfitPresetSchema);
  }

  /**
   * Find an outfit preset by ID
   */
  async findById(id: string): Promise<OutfitPreset | null> {
    return this._findById(id);
  }

  /**
   * Find all outfit presets
   */
  async findAll(): Promise<OutfitPreset[]> {
    return this._findAll();
  }

  /**
   * Find all outfit presets belonging to a specific character. Honours the
   * per-character document-store overlay: when the character's
   * `readPropertiesFromDocumentStore` flag is on, presets are sourced from the
   * vault's `Outfits/*.md` files instead of the DB.
   */
  async findByCharacterId(characterId: string): Promise<OutfitPreset[]> {
    return this.safeQuery(
      () =>
        getOverlaidOutfitPresets(
          characterId,
          () => this.findByCharacterIdRaw(characterId),
        ),
      'Error finding outfit presets by character ID',
      { characterId }
    );
  }

  /**
   * Raw DB-only variant of `findByCharacterId` that bypasses the document-store
   * overlay. Used by the vault populator and export paths.
   */
  async findByCharacterIdRaw(characterId: string): Promise<OutfitPreset[]> {
    return this.safeQuery(
      () => this.findByFilter({ characterId } as TypedQueryFilter<OutfitPreset>),
      'Error finding outfit presets by character ID (raw)',
      { characterId }
    );
  }

  /**
   * Create a new outfit preset
   * @param data The outfit preset data
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<OutfitPreset, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<OutfitPreset> {
    return this.safeQuery(
      async () => {
        const preset = await this._create(data, options);

        logger.info('Outfit preset created successfully', {
          outfitPresetId: preset.id,
          characterId: data.characterId ?? null,
          name: data.name,
          context: 'wardrobe',
        });

        await syncCharacterVaultWardrobe(preset.characterId);

        return preset;
      },
      'Error creating outfit preset',
      { characterId: data.characterId ?? null, name: data.name, context: 'wardrobe' }
    );
  }

  /**
   * Insert an outfit preset that originated from a character's vault,
   * preserving its stable id and timestamps. Bypasses
   * `syncCharacterVaultWardrobe` so the sync chain itself can promote
   * vault-only presets into the DB without recursing back into another sync.
   * Symmetric with `WardrobeRepository.createFromVault`.
   */
  async createFromVault(preset: OutfitPreset): Promise<OutfitPreset> {
    return this.safeQuery(
      () =>
        this._create(
          {
            characterId: preset.characterId ?? null,
            name: preset.name,
            description: preset.description ?? null,
            slots: preset.slots,
          } as Omit<OutfitPreset, 'id' | 'createdAt' | 'updatedAt'>,
          {
            id: preset.id,
            createdAt: preset.createdAt,
            updatedAt: preset.updatedAt,
          },
        ),
      'Error ingesting vault-only outfit preset into DB',
      { outfitPresetId: preset.id, characterId: preset.characterId ?? null, name: preset.name, context: 'wardrobe' }
    );
  }

  /**
   * Update an outfit preset
   */
  async update(id: string, data: Partial<OutfitPreset>): Promise<OutfitPreset | null> {
    return this.safeQuery(
      async () => {
        const updateData = { ...data };

        // Remove id and createdAt to prevent accidental overwrites
        delete updateData.id;
        delete updateData.createdAt;

        const preset = await this._update(id, updateData);

        if (preset) {
          logger.info('Outfit preset updated successfully', {
            outfitPresetId: id,
            context: 'wardrobe',
          });
          await syncCharacterVaultWardrobe(preset.characterId);
        }

        return preset;
      },
      'Error updating outfit preset',
      { outfitPresetId: id, context: 'wardrobe' }
    );
  }

  /**
   * Delete an outfit preset
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        // Fetch first so we know whose vault to sync — once the row is gone
        // there's nothing to look up.
        const existing = await this._findById(id);
        const result = await this._delete(id);

        if (result) {
          logger.info('Outfit preset deleted successfully', {
            outfitPresetId: id,
            context: 'wardrobe',
          });
          if (existing?.characterId) {
            await syncCharacterVaultWardrobe(existing.characterId);
          }
        }

        return result;
      },
      'Error deleting outfit preset',
      { outfitPresetId: id, context: 'wardrobe' }
    );
  }

  /**
   * Delete an outfit preset without firing `syncCharacterVaultWardrobe`.
   * Symmetric with `createFromVault` and `WardrobeRepository.deleteRaw`:
   * used by the vault-to-DB sync path when wholesale rebuilding the
   * preset rows for a character.
   */
  async deleteRaw(id: string): Promise<boolean> {
    return this.safeQuery(
      () => this._delete(id),
      'Error deleting outfit preset (raw)',
      { outfitPresetId: id, context: 'wardrobe' }
    );
  }

  /**
   * Remove a wardrobe item from all presets that reference it.
   * When a wardrobe item is deleted, any preset slot pointing to that item
   * is set to null so the preset remains valid.
   *
   * @param itemId The wardrobe item ID being removed
   * @returns Number of presets modified
   */
  async removeItemFromPresets(itemId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const allPresets = await this._findAll();
        let modifiedCount = 0;
        const affectedCharacterIds = new Set<string>();

        for (const preset of allPresets) {
          let modified = false;
          const updatedSlots = { ...preset.slots };

          for (const slotKey of WARDROBE_SLOT_TYPES) {
            if (updatedSlots[slotKey] === itemId) {
              updatedSlots[slotKey] = null;
              modified = true;
            }
          }

          if (modified) {
            await this._update(preset.id, { slots: updatedSlots });
            modifiedCount++;
            if (preset.characterId) affectedCharacterIds.add(preset.characterId);
            logger.debug('Removed deleted wardrobe item from outfit preset', {
              outfitPresetId: preset.id,
              removedItemId: itemId,
              context: 'wardrobe',
            });
          }
        }

        if (modifiedCount > 0) {
          logger.info('Removed wardrobe item from outfit presets', {
            itemId,
            presetsModified: modifiedCount,
            context: 'wardrobe',
          });
          for (const characterId of affectedCharacterIds) {
            await syncCharacterVaultWardrobe(characterId);
          }
        }

        return modifiedCount;
      },
      'Error removing item from outfit presets',
      { itemId, context: 'wardrobe' }
    );
  }
}
