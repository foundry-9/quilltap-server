/**
 * Post-import reconciliation: walk every imported entity and rewrite its
 * relationship FKs (tags, default profile/partner/template ids, participants,
 * project rosters, mount-point links) through the id maps now that every phase
 * has populated them.
 *
 * @module import/quilltap-import/reconcile
 */

import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type {
  Character,
  ChatMetadata,
  ConnectionProfile,
  EmbeddingProfile,
  ImageProfile,
  Project,
  RoleplayTemplate,
} from '@/lib/schemas/types';
import {
  remapEntity,
  changedFields,
  type IdEntity,
  type IdResolver,
  type IdTarget,
} from '@/lib/backup/id-fields';
import { deleteStoreCascade } from '@/lib/mount-index/delete-store-cascade';
import { remapScenarioSource } from '@/lib/scenarios/source-remap';
import type { ChatInform } from '@/lib/schemas/chat-inform.types';
import type { IdMappingState } from './types';
import { remapImportedMessageId } from './message-id-remap';
import { remapCharacterKeyedChatFields } from '@/lib/chat/character-keyed-fields';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/**
 * What one imported `chat_informs` row resolved to: either an insertable
 * payload with every FK rewritten, or the reason it was dropped.
 */
export type ChatInformRemapResult =
  | {
      ok: true;
      data: Omit<ChatInform, 'id' | 'createdAt' | 'updatedAt'>;
      /**
       * True when the row's `consumedByMessageId` named a message the
       * destination does not have and was nulled. The row is still a real
       * historical inform, so it is kept — it simply loses its swipe anchor.
       */
      consumedByMessageIdCleared: boolean;
    }
  | { ok: false; reason: string };

/**
 * Rewrite one Inform row's FKs for the destination instance.
 *
 * Three of the four references are identity maps in practice rather than
 * lookups, and that is exactly why they have to be *checked* here:
 *
 * - `chatId` goes through `idMaps.chats` like every other chat sidecar.
 * - `participantId` is a chat PARTICIPANT id. Participants ride inside the
 *   chat row, so `chats.create` preserves their ids verbatim — but a chat the
 *   conflict strategy skipped, or one whose roster was edited in the
 *   destination, may not have the seat at all.
 * - `recordMessageId` and `consumedByMessageId` are message ids. They go
 *   through `remapImportedMessageId`, which is the identity unless the chat
 *   was created under a fresh id and its messages reminted (bug 228) — and a
 *   message import that warned and continued leaves a hole either way.
 *
 * A row whose seat or whose Host record is missing is **dropped**: an inform
 * aimed at nobody would sit pending forever, and a record pointer into empty
 * space is a transcript lie. A missing `consumedByMessageId` only costs the
 * row its swipe anchor, so the row is kept with the field nulled.
 */
export function remapChatInform(
  inform: ChatInform,
  idMaps: IdMappingState,
  known: { participantIds: ReadonlySet<string>; messageIds: ReadonlySet<string> }
): ChatInformRemapResult {
  const chatId = idMaps.chats.get(inform.chatId) ?? inform.chatId;

  if (!known.participantIds.has(inform.participantId)) {
    return {
      ok: false,
      reason: `participant ${inform.participantId} is not a seat in chat ${chatId}`,
    };
  }

  // `null` back from the remap means the chat was reminted and this message
  // never landed — treated exactly like a pointer the destination lacks.
  const sourceRecordId = inform.recordMessageId ?? null;
  const recordMessageId = sourceRecordId
    ? remapImportedMessageId(idMaps, inform.chatId, sourceRecordId)
    : null;
  if (sourceRecordId && (!recordMessageId || !known.messageIds.has(recordMessageId))) {
    return {
      ok: false,
      reason: `record message ${sourceRecordId} is missing from chat ${chatId}`,
    };
  }

  const sourceConsumedById = inform.consumedByMessageId ?? null;
  const consumedByMessageId = sourceConsumedById
    ? remapImportedMessageId(idMaps, inform.chatId, sourceConsumedById)
    : null;
  const consumedByMessageIdCleared = Boolean(
    sourceConsumedById && (!consumedByMessageId || !known.messageIds.has(consumedByMessageId))
  );

  return {
    ok: true,
    consumedByMessageIdCleared,
    data: {
      chatId,
      batchId: inform.batchId,
      participantId: inform.participantId,
      contentMarkdown: inform.contentMarkdown,
      recordMessageId,
      // Bundles written before standing informs existed carry no flag.
      permanent: inform.permanent === true,
      consumedAt: inform.consumedAt ?? null,
      consumedByMessageId: consumedByMessageIdCleared ? null : consumedByMessageId,
    },
  };
}

/**
 * Tear down the scaffold vault `characters.create()` provisioned, now that the
 * character points at the vault its bundle carried.
 *
 * Goes through `deleteStoreCascade` — the chokepoint that runs link-group
 * orphan GC — never a bare mount-point delete.
 *
 * Also hands the canonical vault name back: store names live in one
 * case-insensitive namespace, so with the scaffold holding
 * "<name> Character Vault" the imported vault was uniquified to "… (2)" on the
 * way in. With the scaffold gone the plain name is free, and a character whose
 * vault is permanently named "(2)" is a visible wart in the Scriptorium.
 */
async function discardScaffoldVault(
  scaffoldMountId: string,
  importedVaultId: string,
  characterId: string,
  warnings: string[]
): Promise<void> {
  const storeRepos = getRepositories();
  try {
    const scaffold = await storeRepos.docMountPoints.findById(scaffoldMountId);
    deleteStoreCascade(scaffoldMountId);
    moduleLogger.debug('Discarded scaffold vault in favour of the imported one', {
      characterId,
      scaffoldMountId,
      importedVaultId,
    });

    if (!scaffold) return;
    const allStores = await storeRepos.docMountPoints.findAll();
    // The scaffold itself never counts as holding the name — we just deleted
    // it, and a read served from a stale cache would otherwise block the
    // rename forever.
    const nameTaken = allStores.some(
      (mp) =>
        mp.id !== importedVaultId &&
        mp.id !== scaffoldMountId &&
        mp.name.toLowerCase() === scaffold.name.toLowerCase()
    );
    if (nameTaken) return;
    const imported = allStores.find((mp) => mp.id === importedVaultId);
    if (imported && imported.name !== scaffold.name) {
      await storeRepos.docMountPoints.update(importedVaultId, { name: scaffold.name });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to remove the placeholder vault for an imported character: ${msg}`);
    moduleLogger.warn('Failed to discard scaffold vault', {
      characterId,
      scaffoldMountId,
      error: msg,
    });
  }
}

/** Ids already present on this instance, per target; null when unreadable. */
type LocalIds = Partial<Record<IdTarget, ReadonlySet<string> | null>>;

/**
 * The import side's resolver: the id this import gave the row, else the id
 * itself when the row is already on this instance, else unknown. A target
 * whose local rows could not be read answers "present", so a failed read
 * never clears a pointer.
 */
export function importResolver(idMaps: IdMappingState, local: LocalIds = {}): IdResolver {
  const maps: Partial<Record<IdTarget, Map<string, string>>> = {
    character: idMaps.characters,
    chat: idMaps.chats,
    tag: idMaps.tags,
    connectionProfile: idMaps.connectionProfiles,
    imageProfile: idMaps.imageProfiles,
    embeddingProfile: idMaps.embeddingProfiles,
    roleplayTemplate: idMaps.roleplayTemplates,
    project: idMaps.projects,
    group: idMaps.groups,
    mountPoint: idMaps.mountPoints,
  };
  return (target, id) => {
    const mapped = maps[target]?.get(id);
    if (mapped) return mapped;
    if (!(target in local)) return undefined;
    const ids = local[target];
    return ids === null || ids?.has(id) ? id : undefined;
  };
}

/** Load the ids of the targets whose fields clear when unresolved. */
async function loadLocalIds(repos: ReturnType<typeof getUserRepositories>): Promise<LocalIds> {
  const globalRepos = getRepositories();
  const load = async (target: IdTarget, read: () => Promise<Array<{ id: string }>>): Promise<[IdTarget, ReadonlySet<string> | null]> => {
    try {
      return [target, new Set((await read()).map((row) => row.id))];
    } catch (error) {
      moduleLogger.warn('Could not read local rows for reconciliation; their pointers are kept', {
        target,
        error: error instanceof Error ? error.message : String(error),
      });
      return [target, null];
    }
  };
  const entries = await Promise.all([
    load('connectionProfile', () => repos.connections.findAll()),
    load('imageProfile', () => repos.imageProfiles.findAll()),
    load('embeddingProfile', () => repos.embeddingProfiles.findAll()),
    load('roleplayTemplate', () => globalRepos.roleplayTemplates.findAll()),
  ]);
  // Terminal sessions never travel: an imported pointer to one always clears.
  return { ...Object.fromEntries(entries), terminalSession: new Set<string>() };
}

/** Everything reconciliation remaps through the table: not messages, which follow at create. */
const RECONCILE_TARGETS: ReadonlySet<IdTarget> = new Set<IdTarget>([
  'character', 'chat', 'participant', 'tag', 'connectionProfile', 'imageProfile', 'embeddingProfile',
  'roleplayTemplate', 'project', 'group', 'memory', 'file', 'folder', 'mountPoint', 'terminalSession',
]);

/**
 * Rewrite every relationship of the rows this import wrote, now that every
 * phase has populated the id maps. The fields come from the id-field table
 * (`lib/backup/id-fields.ts`); the few it marks bespoke for import (a
 * character's vault and avatars, a chat's scenario source and its
 * character-keyed columns) are handled here by their own rules.
 *
 * Rows the import skipped are the instance's own and are left alone.
 */
export async function reconcileRelationships(
  userId: string,
  repos: ReturnType<typeof getUserRepositories>,
  idMaps: IdMappingState,
  warnings: string[],
  options: {
    /**
     * Source → imported wardrobe item id (`buildImportedWardrobeItemIdMap`),
     * for the item ids inside a chat's `equippedOutfit`. An id it does not
     * name is kept.
     */
    wardrobeItemIds?: ReadonlyMap<string, string>;
  } = {}
): Promise<void> {
  moduleLogger.info('Starting post-import reconciliation', { userId });

  const resolve = importResolver(idMaps, await loadLocalIds(repos));
  const tableOptions = { side: 'import' as const, targets: RECONCILE_TARGETS };
  /** Destination ids of the rows of one kind that this import wrote. */
  const writtenOf = (idMap: Map<string, string>): string[] =>
    [...new Set(idMap.values())].filter((id) => idMaps.writtenRows.has(id));
  const remapId = (id: string | null | undefined, idMap: Map<string, string>): string | null =>
    id ? idMap.get(id) ?? null : null;

  /** Remap one row through the table and write back the fields that changed. */
  const reconcileRow = async <T extends object>(
    noun: string,
    entity: IdEntity,
    id: string,
    read: (id: string) => Promise<T | null>,
    write: (id: string, patch: Partial<T>) => Promise<unknown>
  ): Promise<void> => {
    try {
      const row = await read(id);
      if (!row) return;
      const { row: remapped, changed } = remapEntity(entity, row, resolve, tableOptions);
      if (!remapped || changed.size === 0) return;
      await write(id, changedFields(remapped, changed));
      moduleLogger.debug('Reconciled imported row', { entity, id, fields: [...changed] });
    } catch (error) {
      warnings.push(
        `Failed to reconcile ${noun} relationships: ${error instanceof Error ? error.message : String(error)}`
      );
      moduleLogger.warn(`Failed to reconcile ${noun}`, {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Reconcile characters
  for (const [backupId, newId] of idMaps.characters) {
    try {
      // Skip-if-present rehydrate (spec §6/F4): the surviving character was
      // never re-created — every id it references maps to itself, so there is
      // nothing to remap and no scaffold to tear down ("no reconcile pass
      // needed"). Attempting the identity patch anyway would be refused by
      // the archived-row write guard and surface as a spurious warning.
      if (backupId === newId && idMaps.preserveIdsSkips.has(newId)) continue;
      if (!idMaps.writtenRows.has(newId)) continue;

      const stored = await repos.characters.findById(newId);
      if (!stored) continue;

      const remap = remapEntity('character', stored, resolve, tableOptions);
      const character = remap.row ?? stored;
      const updates: Partial<Character> = changedFields(character, remap.changed);
      let hasUpdates = remap.changed.size > 0;
      /** Scaffold vault to cascade-delete once the repoint below has landed. */
      let scaffoldMountId: string | null = null;

      // The bundle carried this character's whole vault (WP A2), and
      // `create()` has already provisioned a scaffold vault whose fresh id is
      // what the row currently holds. Bundle wins, whole-store: repoint at the
      // imported store, then tear the scaffold down after the update lands.
      // Never merge the two.
      const bundleVaultId = idMaps.characterVaultMounts.get(newId);
      const importedVaultId = bundleVaultId ? remapId(bundleVaultId, idMaps.mountPoints) : null;
      if (importedVaultId && importedVaultId !== character.characterDocumentMountPointId) {
        scaffoldMountId = character.characterDocumentMountPointId ?? null;
        updates.characterDocumentMountPointId = importedVaultId;
        hasUpdates = true;
      } else if (character.characterDocumentMountPointId) {
        // Pre-A2 bundle (no vault records): only rewrite when the stored value
        // resolves to a remapped mount-point row. The post-create row holds a
        // freshly-allocated scaffold id we must not blow away. The earlier
        // behavior of nulling the field on a failed remap created orphaned
        // vaults: the importer would provision a vault, this pass would clear
        // the link, and the startup backfill would provision yet another one.
        const newMountId = remapId(character.characterDocumentMountPointId, idMaps.mountPoints);
        if (newMountId) {
          updates.characterDocumentMountPointId = newMountId;
          hasUpdates = true;
        }
      }

      // Remap avatar ids through the imported document-store link map. These
      // values are doc_mount_file_links.id values in the source instance's
      // vault. If the source used a legacy files.id, leave it unchanged;
      // otherwise null it with a warning so the character never keeps a
      // dangling reference after import.
      if (character.defaultImageId) {
        const remappedDefaultImageId = remapId(character.defaultImageId, idMaps.docMountFileLinks);
        if (remappedDefaultImageId) {
          updates.defaultImageId = remappedDefaultImageId;
          hasUpdates = true;
        } else if (!(await repos.files.findById(character.defaultImageId))) {
          warnings.push(
            `Character "${character.name}" defaultImageId could not be remapped and was cleared: ${character.defaultImageId}`
          );
          updates.defaultImageId = null;
          hasUpdates = true;
        }
      }

      if (character.avatarOverrides && character.avatarOverrides.length > 0) {
        let overridesChanged = remap.changed.has('avatarOverrides');
        const remapped = await Promise.all(
          character.avatarOverrides.map(async (override) => {
            const remappedImageId = remapId(override.imageId, idMaps.docMountFileLinks);
            if (remappedImageId) {
              overridesChanged = true;
              return { ...override, imageId: remappedImageId };
            }
            if (await repos.files.findById(override.imageId)) {
              return override;
            }
            warnings.push(
              `Character "${character.name}" avatar override could not be remapped and was dropped: ${override.imageId}`
            );
            // Drop the entry rather than nulling its imageId: the schema
            // requires a string there, so a null would fail the next
            // validated read of the character.
            overridesChanged = true;
            return null;
          })
        );
        // Only touch the field when something actually moved — an unconditional
        // write forces a pointless update (and a vault round-trip) on every
        // character that merely happens to own overrides.
        if (overridesChanged) {
          updates.avatarOverrides = remapped.filter(
            (override): override is NonNullable<typeof override> => override !== null
          ) as Character['avatarOverrides'];
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.characters.update(newId, updates);
      }

      // Only now that the character points at its imported vault is the
      // scaffold safe to remove: reversing the order would leave a window
      // where the row references a store that no longer exists, and any
      // overlay read in it throws CharacterVaultUnavailableError.
      if (scaffoldMountId && importedVaultId) {
        await discardScaffoldVault(scaffoldMountId, importedVaultId, newId, warnings);
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile character relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile character', {
        characterId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile chats
  for (const newId of writtenOf(idMaps.chats)) {
    try {
      const chat = await repos.chats.findById(newId);
      if (!chat) continue;

      const remap = remapEntity('chat', chat, resolve, tableOptions);
      const updates: Partial<ChatMetadata> = remap.row ? changedFields(remap.row, remap.changed) : {};
      let hasUpdates = remap.changed.size > 0;

      // Outfits, outfit avatars, Courier checkpoints and queued outfit notices
      // are keyed by character id (bug 252). A character the bundle did not
      // carry keeps its id, as a participant does. Message ids were already
      // reminted at create time (remintChatMessageIds); a picture follows its
      // imported link, as a character's avatar does.
      const keyed = remapCharacterKeyedChatFields(chat, {
        characterId: (id) => idMaps.characters.get(id) ?? id,
        wardrobeItemId: (id) => options.wardrobeItemIds?.get(id) ?? id,
        fileId: (id) => idMaps.docMountFileLinks.get(id) ?? id,
        messageId: (id) => id,
      });
      if (keyed.unreadable.length > 0) {
        moduleLogger.warn('Chat character-keyed columns unreadable; left as imported', {
          chatId: newId,
          fields: keyed.unreadable,
        });
      }
      if (Object.keys(keyed.patch).length > 0) {
        Object.assign(updates, keyed.patch);
        hasUpdates = true;
        moduleLogger.debug('Remapped character-keyed chat fields', {
          chatId: newId,
          fields: Object.keys(keyed.patch),
        });
      }

      // Re-point the scenario source at the imported copy of its store. A
      // source whose mount did not come across (and is not already in this
      // instance) is dropped rather than left dangling.
      if (chat.scenarioSource) {
        const source = chat.scenarioSource;
        const mapped = idMaps.mountPoints.get(source.mountPointId)
          ?? ((await getRepositories().docMountPoints.findById(source.mountPointId)) ? source.mountPointId : null);
        const remapped = remapScenarioSource(source, () => mapped);
        if (!remapped || remapped.mountPointId !== source.mountPointId) {
          updates.scenarioSource = remapped;
          hasUpdates = true;
          moduleLogger.debug('Remapped chat scenario source', {
            chatId: newId,
            fromMountPointId: source.mountPointId,
            toMountPointId: remapped?.mountPointId ?? null,
          });
        }
      }

      if (hasUpdates) {
        await repos.chats.update(newId, updates);
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile chat relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile chat', {
        chatId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Projects, profiles and templates: the table says it all.
  for (const id of writtenOf(idMaps.projects)) {
    await reconcileRow<Project>('project', 'project', id, (i) => repos.projects.findById(i), (i, patch) => repos.projects.update(i, patch));
  }
  // A profile may name an understudy that appears later in the bundle, so
  // `fallbackProfileId` can only be remapped once every profile has landed.
  for (const id of writtenOf(idMaps.connectionProfiles)) {
    await reconcileRow<ConnectionProfile>('connection profile', 'connectionProfile', id, (i) => repos.connections.findById(i), (i, patch) => repos.connections.update(i, patch));
  }
  for (const id of writtenOf(idMaps.imageProfiles)) {
    await reconcileRow<ImageProfile>('image profile', 'imageProfile', id, (i) => repos.imageProfiles.findById(i), (i, patch) => repos.imageProfiles.update(i, patch));
  }
  for (const id of writtenOf(idMaps.embeddingProfiles)) {
    await reconcileRow<EmbeddingProfile>('embedding profile', 'embeddingProfile', id, (i) => repos.embeddingProfiles.findById(i), (i, patch) => repos.embeddingProfiles.update(i, patch));
  }
  const globalRepos = getRepositories();
  for (const id of writtenOf(idMaps.roleplayTemplates)) {
    await reconcileRow<RoleplayTemplate>('roleplay template', 'roleplayTemplate', id, (i) => globalRepos.roleplayTemplates.findById(i), (i, patch) => globalRepos.roleplayTemplates.update(i, patch));
  }

  moduleLogger.info('Post-import reconciliation completed');
}
