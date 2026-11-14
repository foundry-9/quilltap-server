/**
 * Characters Repository
 *
 * A character is one slim row plus one vault. The store-backed base
 * (`store-backed.repository.ts`) owns everything that split implies — overlay
 * on read, route-and-strip on write, provision on create, the raw readers —
 * through the vault's binding (`lib/characters/vault/binding.ts`). What is
 * here is only what is particular to characters: the archive guard and the
 * store-name reconcile as hooks, the user-owned and tag queries, partner
 * links, favourites, control, Carina, the fact-sheet key patch, and the
 * per-item prompt and scenario operations.
 */

import {
  Character,
  CharacterInput,
  CharacterRow,
  CharacterRowSchema,
  CharacterSystemPrompt,
  CharacterScenario,
} from '@/lib/schemas/types';
import { CreateOptions } from './base.repository';
import { AbstractStoreBackedRepository, type StoreOverlayBinding } from './store-backed.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter } from '../interfaces';
import { characterVaultBinding } from '@/lib/characters/vault/binding';
import { CHARACTER_VAULT_LAYOUT, type VaultContext } from '@/lib/characters/vault/layout';
import {
  addFolderItem,
  listFolderItems,
  removeFolderItem,
  rewriteFolderItem,
  type LocatedItem,
} from '@/lib/characters/vault/items';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { processSingleton } from '@/lib/utils/process-singleton';
import { readVaultFileStrict } from '@/lib/characters/vault/readers';
import { parseVaultMetadata } from '@/lib/characters/vault/parsers';

// The archive guard lives with the character domain so non-repository code
// (the shared item-folder ops) can raise it without importing a repository.
export { CharacterArchivedError, validateCharacterArchivePatch } from '@/lib/characters/archive-guard';
import { CharacterArchivedError, validateCharacterArchivePatch } from '@/lib/characters/archive-guard';

/**
 * What `update()` takes: any field of the character except the two
 * sub-collections, which are written one item at a time (`addSystemPrompt`,
 * `updateScenario`, …) and never as a whole array (D6).
 */
export type CharacterUpdate = Partial<Omit<Character, 'systemPrompts' | 'scenarios'>>;

/** One write chain per key, process-wide (a module-level map is per bundle — bug 235). */
const characterWriteChains = processSingleton(
  'characters.repository.writeChains',
  () => new Map<string, Promise<unknown>>(),
);

/** Run `fn` after every earlier write queued on `key`. Never re-enter the same key from `fn`. */
function runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = characterWriteChains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  characterWriteChains.set(key, next);
  void next
    .catch(() => {})
    .finally(() => {
      if (characterWriteChains.get(key) === next) characterWriteChains.delete(key);
    });
  return next;
}

/**
 * A key-level fact-sheet patch found `metadata.json` present but not a JSON
 * object. Merging into `{}` would erase the user's sheet, so the patch is
 * refused until the file is repaired.
 */
export class CharacterMetadataUnreadableError extends Error {
  constructor(characterId: string) {
    super(`Character ${characterId}'s metadata.json is not a JSON object; repair it before patching keys`);
    this.name = 'CharacterMetadataUnreadableError';
  }
}

/**
 * Characters Repository
 * Implements CRUD operations for characters with support for tags, personas, favorites, and physical descriptions.
 */

/**
 * Bring store names into line after a change to a character's name or vault
 * (`lib/mount-index/reconcile-store-names.ts`). Never fails the caller's
 * write: a naming miss is repaired at the next boot. Imported lazily, since
 * the reconcile reads through the repository factory.
 */
async function reconcileVaultNames(trigger: string, characterId: string): Promise<void> {
  try {
    const { reconcileStoreNames } = await import('@/lib/mount-index/reconcile-store-names');
    await reconcileStoreNames(trigger);
  } catch (error) {
    logger.warn('Store-name reconcile after a character change failed', {
      trigger,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The repository's generic is the slim row (`CharacterRow`): that is what the
 * `characters` table holds and what every base read validates against, so a
 * raw read is honestly typed. The hydrated `Character` — row plus vault — is
 * what every non-raw read returns.
 */
export class CharactersRepository extends AbstractStoreBackedRepository<CharacterRow, Character> {
  constructor() {
    super('characters', CharacterRowSchema);
  }

  protected readonly store: StoreOverlayBinding<CharacterRow, Character> = characterVaultBinding;
  protected readonly pointerField = 'characterDocumentMountPointId' as const;

  // ============================================================================
  // HOOKS
  // ============================================================================

  /** The tombstone guard: only unarchive may touch an archived character. */
  protected guardUpdate(existing: CharacterRow | null, patch: Partial<Character>): void {
    if ('systemPrompts' in patch || 'scenarios' in patch) {
      // Never a whole-array write (D6): it re-projected the folder and swept
      // anything it did not recognise. The per-item operations are the only
      // writers of either sub-collection.
      throw new Error('update() does not take systemPrompts or scenarios; use the per-item prompt and scenario operations');
    }
    validateCharacterArchivePatch(existing, patch);
    if (existing?.archivedAt && patch.archivedAt === null) {
      logger.info('Rehydrating archived character', { characterId: existing.id });
    }
  }

  /**
   * An old vault left by a namesake may hold "<Name> Character Vault", in
   * which case the new one was provisioned as "… (2)": retire the old one and
   * hand the new vault its plain name.
   */
  protected async afterCreate(character: Character): Promise<void> {
    await reconcileVaultNames('character-created', character.id);
  }

  /** The vault is named after the character, so a rename renames it. */
  protected async afterRename(id: string): Promise<void> {
    await reconcileVaultNames('character-renamed', id);
  }

  /** The vault outlives its character; retire its name. */
  protected async afterDelete(id: string): Promise<void> {
    await reconcileVaultNames('character-deleted', id);
  }

  /** The create-time defaults for the row's own columns. */
  protected prepareCreateData(
    data: Omit<Character, 'id' | 'createdAt' | 'updatedAt'>,
  ): Omit<Character, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      ...data,
      tags: data.tags ?? [],
      isFavorite: data.isFavorite ?? false,
      partnerLinks: data.partnerLinks ?? [],
      avatarOverrides: data.avatarOverrides ?? [],
    };
  }

  /** `update()` takes everything but the two sub-collections (see {@link CharacterUpdate}). */
  async update(id: string, data: CharacterUpdate): Promise<Character | null> {
    return super.update(id, data);
  }

  /** Create a character; the input type allows fields with defaults to be omitted. */
  async create(
    data: Omit<CharacterInput, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions,
  ): Promise<Character> {
    return super.create(data as Omit<Character, 'id' | 'createdAt' | 'updatedAt'>, options);
  }

  /** Restore a character row bound to its archived vault (see the base). */
  async createBoundToStore(
    data: Omit<CharacterInput, 'id' | 'createdAt' | 'updatedAt'>,
    mountPointId: string,
    options?: CreateOptions,
  ): Promise<CharacterRow> {
    return super.createBoundToStore(data as Omit<Character, 'id' | 'createdAt' | 'updatedAt'>, mountPointId, options);
  }

  // ============================================================================
  // CHARACTER QUERIES
  // ============================================================================

  /** Characters belonging to a user. */
  async findByUserId(userId: string): Promise<Character[]> {
    return this.hydrate(await this.findByFilter({ userId } as TypedQueryFilter<CharacterRow>));
  }

  /** User-controlled characters of a user. */
  async findUserControlled(userId: string): Promise<Character[]> {
    return this.safeQuery(
      async () => this.hydrate(await this.findByFilter({ userId, controlledBy: 'user' })),
      'Error finding user-controlled characters',
      { userId },
      [],
    );
  }

  /** Characters carrying a tag. */
  async findByTag(tagId: string): Promise<Character[]> {
    return this.hydrate(await this.findByFilter({ tags: { $in: [tagId] } } as TypedQueryFilter<CharacterRow>));
  }

  /**
   * Resolve character IDs to display names — **without the vault**.
   *
   * `name` is a column, so the vault has nothing to add, and skipping it is the
   * point: this runs on the per-turn context path, where a character whose
   * vault is unreadable must cost the caller a *name*, not the whole turn.
   * IDs with no row, or with a blank name, are absent from the returned map.
   */
  async findNamesByIds(
    ids: string[],
    options: { excludeArchived?: boolean } = {}
  ): Promise<Map<string, string>> {
    const unique = Array.from(
      new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))
    );
    if (unique.length === 0) return new Map();

    return this.safeQuery(
      async () => {
        const rows = await this.findByFilter({ id: { $in: unique } } as TypedQueryFilter<CharacterRow>);
        const names = new Map<string, string>();
        for (const row of rows) {
          if (options.excludeArchived && row.archivedAt) continue;
          const name = typeof row.name === 'string' ? row.name.trim() : '';
          if (row.id && name.length > 0) names.set(row.id, name);
        }
        return names;
      },
      'Error resolving character names',
      { count: unique.length },
      new Map<string, string>()
    );
  }

  /** Characters using an image as their default. */
  async findByDefaultImageId(imageId: string): Promise<Character[]> {
    return this.safeQuery(
      async () => this.hydrate(await this.findByFilter({ defaultImageId: imageId })),
      'Error finding characters by default image ID',
      { imageId },
      []
    );
  }

  /** Characters using an image in their avatar overrides. */
  async findByAvatarOverrideImageId(imageId: string): Promise<Character[]> {
    return this.safeQuery(
      async () => this.hydrate(await this.findByFilter({
        'avatarOverrides.imageId': imageId,
      } as TypedQueryFilter<CharacterRow>)),
      'Error finding characters by avatar override image ID',
      { imageId },
      []
    );
  }

  // ============================================================================
  // TAG OPERATIONS
  // ============================================================================

  /** Add a tag; returns the hydrated character. */
  async addTag(characterId: string, tagId: string): Promise<Character | null> {
    const row = await this.findByIdRaw(characterId);
    if (!row) {
      logger.warn('Character not found for tag addition', { characterId });
      return null;
    }
    if (row.tags.includes(tagId)) return this.findById(characterId);
    return this.update(characterId, { tags: [...row.tags, tagId] });
  }

  /** Remove a tag; returns the hydrated character. */
  async removeTag(characterId: string, tagId: string): Promise<Character | null> {
    const row = await this.findByIdRaw(characterId);
    if (!row) {
      logger.warn('Character not found for tag removal', { characterId });
      return null;
    }
    if (!row.tags.includes(tagId)) return this.findById(characterId);
    return this.update(characterId, { tags: row.tags.filter((id) => id !== tagId) });
  }

  // ============================================================================
  // PARTNER LINK OPERATIONS
  // ============================================================================

  /**
   * Add a partner link to a character
   * @param characterId The character ID
   * @param partnerId The partner character ID
   * @param isDefault Whether this partner should be the default
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async addPartnerLink(characterId: string, partnerId: string, isDefault = false): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for partner link addition', { characterId });
          return null;
        }

        const existing = character.partnerLinks.find((link) => link.partnerId === partnerId);
        if (!existing) {
          character.partnerLinks.push({ partnerId, isDefault });
          return await this.update(characterId, { partnerLinks: character.partnerLinks });
        }
        return character;
      },
      'Error adding partner link to character',
      { characterId, partnerId }
    );
  }

  /**
   * Remove a partner link from a character
   * @param characterId The character ID
   * @param partnerId The partner character ID
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async removePartnerLink(characterId: string, partnerId: string): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for partner link removal', { characterId });
          return null;
        }

        const beforeCount = character.partnerLinks.length;
        character.partnerLinks = character.partnerLinks.filter((link) => link.partnerId !== partnerId);
        const afterCount = character.partnerLinks.length;

        if (beforeCount !== afterCount) {
          return await this.update(characterId, { partnerLinks: character.partnerLinks });
        }
        return character;
      },
      'Error removing partner link from character',
      { characterId, partnerId }
    );
  }

  // ============================================================================
  // FAVORITE OPERATIONS
  // ============================================================================

  /**
   * Set favorite status for a character
   * @param characterId The character ID
   * @param isFavorite Whether the character is marked as favorite
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async setFavorite(characterId: string, isFavorite: boolean): Promise<Character | null> {
    return this.update(characterId, { isFavorite });
  }

  /**
   * Set controlled-by status for a character
   * @param characterId The character ID
   * @param controlledBy Who controls the character: 'llm' or 'user'
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async setControlledBy(characterId: string, controlledBy: 'llm' | 'user'): Promise<Character | null> {
    return this.update(characterId, { controlledBy });
  }

  /**
   * Set Carina (inline @-query answerer) eligibility for a character
   * @param characterId The character ID
   * @param canBeCarina Whether this character may answer inline @-queries
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async setCanBeCarina(characterId: string, canBeCarina: boolean): Promise<Character | null> {
    return this.update(characterId, { canBeCarina });
  }

  // ============================================================================
  // FACT SHEET (metadata.json) KEY PATCH
  // ============================================================================

  /**
   * Set and unset fact-sheet keys, merged here under one write chain per
   * character so two editors never race a read-merge-replace (D11). The HTTP
   * route's `?action=patch-metadata` is the caller; `update({ metadata })`
   * stays whole-object replace for every other writer (Pascal's effects in the
   * job child depend on it).
   */
  async patchMetadata(
    characterId: string,
    patch: { set: Record<string, unknown>; unset: string[] },
  ): Promise<Character | null> {
    return runSerialized(`character-metadata:${characterId}`, async () => {
      const row = await this.findByIdRaw(characterId);
      if (!row) return null;
      const mountPointId = row.characterDocumentMountPointId;
      let current: Record<string, unknown> = {};
      if (mountPointId) {
        const raw = await readVaultFileStrict(mountPointId, CHARACTER_VAULT_LAYOUT.metadata.path, characterId);
        if (raw !== null) {
          const parsed = parseVaultMetadata(raw, characterId, mountPointId);
          if (!parsed) throw new CharacterMetadataUnreadableError(characterId);
          current = parsed;
        }
      }
      const next: Record<string, unknown> = { ...current, ...patch.set };
      for (const key of patch.unset) delete next[key];
      logger.debug('Patching character metadata keys', {
        characterId,
        set: Object.keys(patch.set),
        unset: patch.unset,
      });
      return this.update(characterId, { metadata: next });
    });
  }

  // ============================================================================
  // SUB-COLLECTIONS: SYSTEM PROMPTS AND SCENARIOS
  //
  // Per item (D6): each operation finds its item by id and writes, renames or
  // deletes that one file (`lib/characters/vault/items.ts`). Ids are stable
  // (frontmatter `id:`, D5), so the id an add returns is the id every later
  // read returns, and a rename keeps it. Neither array is ever written whole
  // through `update()`.
  // ============================================================================

  /**
   * The row and vault context a sub-collection write needs, or null when the
   * character does not exist. Refuses an archived character (the archive guard
   * `update()` applies, for writes that bypass `update()`).
   */
  private async subCollectionContext(
    characterId: string,
  ): Promise<{ row: CharacterRow; ctx: VaultContext } | null> {
    const row = await this.findByIdRaw(characterId);
    if (!row) {
      logger.warn('Character not found for a prompt or scenario write', { characterId });
      return null;
    }
    if (row.archivedAt) {
      throw new CharacterArchivedError(characterId);
    }
    let mountPointId = row.characterDocumentMountPointId;
    if (!mountPointId) {
      logger.error('Character has no vault for a prompt or scenario write; provisioning the scaffold', { characterId });
      mountPointId = (await ensureCharacterVault(row)).mountPointId;
    }
    return { row, ctx: { characterId, mountPointId } };
  }

  /**
   * Keep `defaultSystemPromptId` in step with the prompts' `isDefault` flags.
   *
   * The default prompt is recorded twice — the flag inside the prompt and this
   * column — and every consumer reads the column first (bug 154). Ids are
   * stable now, so the column names the effective default after every write
   * and never goes stale.
   */
  private async syncDefaultPromptColumn(row: CharacterRow, prompts: CharacterSystemPrompt[]): Promise<void> {
    const defaultId = prompts.find((p) => p.isDefault)?.id ?? null;
    if ((row.defaultSystemPromptId ?? null) !== defaultId) {
      await this._update(row.id, { defaultSystemPromptId: defaultId }, row);
      logger.debug('Default system prompt column moved', { characterId: row.id, defaultSystemPromptId: defaultId });
    }
  }

  /** Rewrite every prompt whose on-disk `isDefault` flag disagrees with `defaultId`. */
  private async writeDefaultFlags(
    ctx: VaultContext,
    located: LocatedItem<CharacterSystemPrompt>[],
    defaultId: string | null,
    skipId?: string,
  ): Promise<void> {
    const prompts = CHARACTER_VAULT_LAYOUT.prompts;
    for (const entry of located) {
      if (entry.item.id === skipId) continue;
      const wanted = entry.item.id === defaultId;
      if (entry.onDisk.isDefault !== wanted) {
        await rewriteFolderItem(prompts, ctx, entry, { ...entry.onDisk, isDefault: wanted });
      }
    }
  }

  /** Add a system prompt. The first prompt, or one added as default, becomes the default. */
  async addSystemPrompt(
    characterId: string,
    data: Omit<CharacterSystemPrompt, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<CharacterSystemPrompt | null> {
    return this.safeQuery(
      async () => {
        const target = await this.subCollectionContext(characterId);
        if (!target) return null;
        const { row, ctx } = target;
        const prompts = CHARACTER_VAULT_LAYOUT.prompts;
        const located = await listFolderItems(prompts, ctx);
        const now = this.getCurrentTimestamp();
        const added: CharacterSystemPrompt = {
          ...data,
          id: this.generateId(),
          isDefault: !!data.isDefault || located.length === 0,
          createdAt: now,
          updatedAt: now,
        };
        if (added.isDefault) await this.writeDefaultFlags(ctx, located, added.id);
        await addFolderItem(prompts, ctx, added);
        const after = added.isDefault
          ? [...located.map((l) => ({ ...l.item, isDefault: false })), added]
          : [...located.map((l) => l.item), added];
        await this.syncDefaultPromptColumn(row, after);
        return added;
      },
      'Error adding system prompt',
      { characterId, promptName: data.name }
    );
  }

  /** Update a system prompt; a name change renames its file and keeps its id. */
  async updateSystemPrompt(
    characterId: string,
    promptId: string,
    data: Partial<Omit<CharacterSystemPrompt, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<CharacterSystemPrompt | null> {
    return this.safeQuery(
      async () => {
        const target = await this.subCollectionContext(characterId);
        if (!target) return null;
        const { row, ctx } = target;
        const prompts = CHARACTER_VAULT_LAYOUT.prompts;
        const located = await listFolderItems(prompts, ctx);
        const current = located.find((l) => l.item.id === promptId);
        if (!current) {
          logger.warn('System prompt not found for update', { characterId, promptId });
          return null;
        }
        const updated: CharacterSystemPrompt = {
          ...current.item,
          ...data,
          id: current.item.id,
          createdAt: current.item.createdAt,
          updatedAt: this.getCurrentTimestamp(),
        };
        if (data.isDefault) await this.writeDefaultFlags(ctx, located, promptId, promptId);
        await rewriteFolderItem(prompts, ctx, current, updated);
        const after = located.map((l) =>
          l.item.id === promptId ? updated : data.isDefault ? { ...l.item, isDefault: false } : l.item,
        );
        await this.syncDefaultPromptColumn(row, CHARACTER_VAULT_LAYOUT.prompts.normalize(after));
        return updated;
      },
      'Error updating system prompt',
      { characterId, promptId }
    );
  }

  /** Delete a system prompt; if it was the default, the first remaining prompt takes over. */
  async deleteSystemPrompt(characterId: string, promptId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const target = await this.subCollectionContext(characterId);
        if (!target) return false;
        const { row, ctx } = target;
        const prompts = CHARACTER_VAULT_LAYOUT.prompts;
        const located = await listFolderItems(prompts, ctx);
        const doomed = located.find((l) => l.item.id === promptId);
        if (!doomed) {
          logger.warn('System prompt not found for removal', { characterId, promptId });
          return false;
        }
        await removeFolderItem(prompts, ctx, doomed);
        const remaining = located.filter((l) => l !== doomed);
        if (doomed.item.isDefault && remaining.length > 0 && !remaining.some((l) => l.onDisk.isDefault)) {
          await this.writeDefaultFlags(ctx, remaining, remaining[0].item.id);
        }
        await this.syncDefaultPromptColumn(row, prompts.normalize(remaining.map((l) => l.onDisk)));
        return true;
      },
      'Error deleting system prompt',
      { characterId, promptId }
    );
  }

  /**
   * Set a system prompt as default, or clear the default entirely with `null`.
   *
   * The one chokepoint for "which prompt does this character start with": it
   * moves the `isDefault` flags and the `defaultSystemPromptId` column
   * together. Anything that changes the default — the star in the prompts
   * editor, the picker on the character's Profiles tab — goes through here.
   */
  async setDefaultSystemPrompt(characterId: string, promptId: string | null): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const target = await this.subCollectionContext(characterId);
        if (!target) return null;
        const { row, ctx } = target;
        const located = await listFolderItems(CHARACTER_VAULT_LAYOUT.prompts, ctx);
        if (promptId !== null && !located.some((l) => l.item.id === promptId)) {
          logger.warn('System prompt not found', { characterId, promptId });
          return null;
        }
        await this.writeDefaultFlags(ctx, located, promptId);
        await this.syncDefaultPromptColumn(
          row,
          located.map((l) => ({ ...l.item, isDefault: l.item.id === promptId })),
        );
        return this.findById(characterId);
      },
      'Error setting default system prompt',
      { characterId, promptId }
    );
  }

  /** Add a scenario. Its id is real from the start (D5). */
  async addScenario(
    characterId: string,
    data: { title: string; content: string; description?: string; archived?: boolean }
  ): Promise<CharacterScenario | null> {
    return this.safeQuery(
      async () => {
        const target = await this.subCollectionContext(characterId);
        if (!target) return null;
        const now = this.getCurrentTimestamp();
        const added: CharacterScenario = {
          id: this.generateId(),
          title: data.title,
          content: data.content,
          ...(data.description !== undefined && data.description.trim().length > 0 && { description: data.description }),
          // Omission means active; never persist an explicit `archived: false`.
          ...(data.archived === true && { archived: true }),
          createdAt: now,
          updatedAt: now,
        };
        await addFolderItem(CHARACTER_VAULT_LAYOUT.scenarios, target.ctx, added);
        return added;
      },
      'Error adding scenario',
      { characterId, title: data.title }
    );
  }

  /** Update a scenario; a title change renames its file and keeps its id. */
  async updateScenario(
    characterId: string,
    scenarioId: string,
    data: { title?: string; content?: string; description?: string; archived?: boolean }
  ): Promise<CharacterScenario | null> {
    return this.safeQuery(
      async () => {
        const target = await this.subCollectionContext(characterId);
        if (!target) return null;
        const scenarios = CHARACTER_VAULT_LAYOUT.scenarios;
        const located = await listFolderItems(scenarios, target.ctx);
        const current = located.find((l) => l.item.id === scenarioId);
        if (!current) {
          logger.warn('Scenario not found for update', { characterId, scenarioId });
          return null;
        }
        const { archived: _archived, description: _description, ...rest } = current.item;
        const archived = data.archived ?? current.item.archived;
        const description = data.description ?? current.item.description;
        const updated: CharacterScenario = {
          ...rest,
          ...(data.title !== undefined && { title: data.title }),
          ...(data.content !== undefined && { content: data.content }),
          ...(description !== undefined && description.trim().length > 0 && { description }),
          // Omission means active; drop the key rather than writing `false`.
          ...(archived === true && { archived: true }),
          id: current.item.id,
          createdAt: current.item.createdAt,
          updatedAt: this.getCurrentTimestamp(),
        };
        await rewriteFolderItem(scenarios, target.ctx, current, updated);
        return updated;
      },
      'Error updating scenario',
      { characterId, scenarioId }
    );
  }

  /** Remove a scenario. */
  async removeScenario(characterId: string, scenarioId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const target = await this.subCollectionContext(characterId);
        if (!target) return false;
        const scenarios = CHARACTER_VAULT_LAYOUT.scenarios;
        const located = await listFolderItems(scenarios, target.ctx);
        const doomed = located.find((l) => l.item.id === scenarioId);
        if (!doomed) {
          logger.warn('Scenario not found for removal', { characterId, scenarioId });
          return false;
        }
        await removeFolderItem(scenarios, target.ctx, doomed);
        return true;
      },
      'Error removing scenario',
      { characterId, scenarioId }
    );
  }
}
