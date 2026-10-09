/**
 * Restore orchestrator. Extracts the archive once, optionally deletes existing
 * data (replace mode) or remaps every UUID (new-account mode), then re-inserts
 * every entity in dependency order with its backup/remapped id preserved so
 * cross-references stay valid. Per-entity failures are collected as warnings
 * rather than aborting the whole restore.
 *
 * @module backup/restore/restore
 */

import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { writeLibraryFileBytes } from '@/lib/file-storage/library-file-writer';
import { stripScenarioSeededSummary } from '@/lib/chat/scenario-seeded-summary';
import { getConciergeState, withConciergeModeFromLegacy } from '@/lib/services/dangerous-content/chat-override';
import {
  withConciergeSettingsFromLegacy,
  type SettingsWithLegacyConcierge,
} from '@/lib/services/dangerous-content/legacy-concierge-settings';
import {
  withImpersonationVoiceModeFromLegacy,
  type SettingsWithLegacyImpersonationVoice,
} from '@/lib/chat/impersonation-voice-legacy';
import { makeCarriedStoreRowsResolver } from './carried-store-rows';
import { parseMountBlobStorageKey } from '@/lib/file-storage/project-store-bridge';
import { getNpmPluginsDir, getThemesDir } from '@/lib/paths';
import { isLLMLogsDegraded } from '@/lib/database/backends/sqlite/llm-logs-client';
import { rawQuery } from '@/lib/database/manager';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '@/lib/database/backends/sqlite/mount-index-client';
import { TextReplacementRuleConflictError } from '@/lib/database/repositories';
import { normalizeProfileName, makeUniqueProfileName } from '@/lib/llm/connection-profile-names';
import { seedLegacyConnectionProfileFields } from '@/lib/llm/connection-profile-legacy-fields';
import { reconcileEmbeddingDimensions } from '@/lib/startup/reconcile-embedding-dimensions';
import { enqueueEmbeddingReindexAll } from '@/lib/background-jobs/queue-service';
import { getDefaultEmbeddingProfile } from '@/lib/embedding/embedding-service';
import type { RestoreOptions, RestoreSummary } from '../types';
import { UuidRemapper } from '../uuid-remapper';
import { parseBackupZip, getFileFromExtractedBackup, cleanupDir } from './archive';
import { deleteUserData } from './delete-service';
import { planWardrobeImagePointerFixes, remapBackupData, type WardrobeImagePointerFix } from './uuid-remap';
import { updateProjectWardrobeItem } from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { coerceDocMountPointRow, coerceDocMountFileLinkRow } from './mount-index-coercion';
import { isUniqueConstraintError } from '@/lib/database/sqlite-errors';
import { decodeIndexKeyedEmbedding } from './index-keyed-embedding';
import { makeStoreClaimMap, type StoreClaim, type StoreOwnerKind } from './store-claims';
import { nextUniqueMountPointName } from '@/lib/mount-index/unique-mount-point-name';
import { reconcileStoreNames } from '@/lib/mount-index/reconcile-store-names';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import type { Character } from '@/lib/schemas/types';

const moduleLogger = logger.child({ module: 'backup:restore-service' });

/**
 * Strip the columns a backup's `files` row must not hand to `files.create`:
 * the auto-generated ones (`userId`, `createdAt`, `updatedAt`), the
 * `storageKey` (every restore path rewrites it — from the bridge that stored
 * the bytes, or from the carried-store resolver), and the legacy S3 /
 * mount-point fields older backups still carry.
 */
function stripLegacyFileRowFields<T extends object>(
  file: T
): Omit<T, 'userId' | 'createdAt' | 'updatedAt' | 'storageKey'> {
  const { userId, createdAt, updatedAt, storageKey, ...fileData } = file as T & Record<string, unknown>;
  delete (fileData as Record<string, unknown>).s3Key;
  delete (fileData as Record<string, unknown>).s3Bucket;
  delete (fileData as Record<string, unknown>).mountPointId;
  return fileData;
}

/**
 * Restores data from a backup ZIP file on disk
 */
export async function restore(
  zipPath: string,
  options: RestoreOptions
): Promise<RestoreSummary> {
  const { mode, targetUserId } = options;

  moduleLogger.info('Starting restore operation', { mode, targetUserId });

  const warnings: string[] = [];

  // Extract zip to temp directory once — all file reads come from disk
  const { data: parsedData, extractDir, rootFolder } = await parseBackupZip(zipPath);
  const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir;

  try {
    let data = parsedData;

    // For replace mode, delete existing data first. Archived-character
    // bundles survive by default (spec §4.7) — the restore replaces the
    // tombstone rows, so what's kept is a loose, importable bundle.
    if (mode === 'replace') {
      await deleteUserData(targetUserId, {
        keepArchivedCharacterBundles: options.keepArchivedCharacterBundles !== false,
      });
    }

    // For new-account mode, remap all UUIDs
    let wardrobeImagePointerFixes: WardrobeImagePointerFix[] = [];
    if (mode === 'new-account') {
      const remapper = new UuidRemapper();
      // Planned against the original data with the same remapper, so each
      // pointer resolves to the id its `files` row is about to receive.
      wardrobeImagePointerFixes = planWardrobeImagePointerFixes(data, remapper);
      data = remapBackupData(data, targetUserId, remapper);
    }

    const repos = getUserRepositories(targetUserId);
    const globalRepos = getRepositories();

    // Bug 185: a character's vault and a project's or group's official store
    // travel in the archive beside the entity, and come back at 22a–22f. The
    // entities' create paths would mint a fresh store and leave the archive's
    // orphaned, so each entity whose archived pointer names a carried store is
    // written bound to it instead (first claim wins; see store-claims.ts). In
    // new-account mode the pointers were remapped with the stores' own ids.
    const storeClaims = makeStoreClaimMap(data.docMountPoints || []);
    // Entities bound to an archived store, kept so a store whose own row fails
    // to restore at 22a can be replaced before anything reads through it.
    const boundCharacters: Array<{ character: Character; mountPointId: string }> = [];
    const boundProjects: Array<{ project: Awaited<ReturnType<typeof globalRepos.projects.createBoundToStore>>; mountPointId: string }> = [];
    const boundGroups: Array<{ group: Awaited<ReturnType<typeof globalRepos.groups.createBoundToStore>>; mountPointId: string }> = [];
    const noteStoreFallback = (kind: StoreOwnerKind, id: string, name: string, claim: StoreClaim): void => {
      if (claim.bound || claim.reason === 'no-pointer') return;
      const why =
        claim.reason === 'not-carried'
          ? 'the backup does not carry the store it pointed at'
          : claim.reason === 'wrong-kind'
            ? 'the store it pointed at is the wrong kind'
            : `its store is already claimed by ${claim.claimedBy?.kind} ${claim.claimedBy?.id}`;
      warnings.push(`The ${kind} "${name}" was given a fresh, empty store because ${why}`);
      moduleLogger.warn('Restored entity falls back to a fresh store', { kind, id, reason: claim.reason, claimedBy: claim.claimedBy });
    };

    // Restore in dependency order
    // All entities preserve their backup/remapped IDs via CreateOptions.id,
    // so cross-references (characterId in participants, tags, etc.) are already correct.

    // 1. Tags (no dependencies)
    for (const tag of data.tags) {
      try {
        const { userId, createdAt, updatedAt, ...tagData } = tag;
        await repos.tags.create({ ...tagData, nameLower: tagData.nameLower || tagData.name.toLowerCase() }, { id: tag.id });
      } catch (error) {
        warnings.push(`Failed to restore tag "${tag.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore tag', { tagId: tag.id, error });
      }
    }

    // 2. Connection profiles (no entity dependencies, but have tag refs).
    // Names are unique per user (DB index). Pre-migration backups can carry
    // duplicate names, and merge restores can collide with existing profiles —
    // rename on collision rather than letting the constraint drop the profile.
    const existingConnectionProfiles = await repos.connections.findAll();
    const takenConnectionNames = new Set(existingConnectionProfiles.map((p) => normalizeProfileName(p.name)));
    for (const profile of data.connectionProfiles) {
      try {
        const { userId, createdAt, updatedAt, apiKeyId, ...rawProfileData } = profile;
        // Note: apiKeyId is not restored as API keys are encrypted and can't be restored
        // Columns the archive predates would otherwise be decided by the table
        // DEFAULT rather than by the profile's owner — see the module docs.
        const profileData = seedLegacyConnectionProfileFields(rawProfileData);
        if (
          rawProfileData.multiCharacterPrefill === undefined ||
          rawProfileData.supportsImageUpload === undefined
        ) {
          moduleLogger.debug('Seeded connection-profile columns the archive predates', {
            profileId: profile.id,
            provider: profileData.provider,
            seededMultiCharacterPrefill: rawProfileData.multiCharacterPrefill === undefined,
            seededSupportsImageUpload: rawProfileData.supportsImageUpload === undefined,
          });
        }
        const uniqueName = makeUniqueProfileName(profileData.name, takenConnectionNames);
        if (uniqueName !== profileData.name) {
          moduleLogger.debug('Renamed connection profile on restore to avoid name collision', {
            profileId: profile.id,
            from: profileData.name,
            to: uniqueName,
          });
        }
        takenConnectionNames.add(normalizeProfileName(uniqueName));
        await repos.connections.create({ ...profileData, name: uniqueName, apiKeyId: null }, { id: profile.id });
      } catch (error) {
        warnings.push(`Failed to restore connection profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore connection profile', { profileId: profile.id, error });
      }
    }

    // 3. Image profiles
    for (const profile of data.imageProfiles) {
      try {
        const { userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
        await repos.imageProfiles.create({ ...profileData, apiKeyId: null }, { id: profile.id });
      } catch (error) {
        warnings.push(`Failed to restore image profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore image profile', { profileId: profile.id, error });
      }
    }

    // 4. Embedding profiles
    for (const profile of data.embeddingProfiles) {
      try {
        const { userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
        await repos.embeddingProfiles.create({ ...profileData, apiKeyId: null }, { id: profile.id });
      } catch (error) {
        warnings.push(`Failed to restore embedding profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore embedding profile', { profileId: profile.id, error });
      }
    }

    // 5. Files — DEFERRED to step 22a-bis (after doc-store mounts exist).
    // Every user file now lands in a document store: project-bound files go
    // through the project-store bridge, project-less files through the Quilltap
    // Uploads bridge. Neither target can resolve at this point in the restore —
    // projects arrive at 13, and the mount-point rows (including the Quilltap
    // Uploads mount, which `deleteUserData` truncates in replace mode while
    // deliberately leaving its `instance_settings` pointer dangling) arrive at
    // 22a. Restoring here worked only when the target instance happened to
    // already hold those stores; into a fresh or wiped instance — the
    // disaster-recovery case — not one byte landed.
    let filesRestored = 0;

    // 6. Characters. One bound to its archived vault is written as a slim row
    // only; its vault arrives at 22a–22f, so nothing may read it through the
    // overlay before then (memories below check ownership by id for that
    // reason). Anything else is created with a fresh vault, as before.
    const restoredCharacterIds = new Set<string>();
    for (const character of data.characters) {
      try {
        const { userId, createdAt, updatedAt, ...charData } = character;
        const claim = storeClaims.claim('character', character.id, character.characterDocumentMountPointId);
        if (claim.bound) {
          const created = await globalRepos.characters.createBoundToVault(
            { ...charData, userId: targetUserId },
            claim.mountPointId,
            { id: character.id }
          );
          boundCharacters.push({ character: created, mountPointId: claim.mountPointId });
        } else {
          noteStoreFallback('character', character.id, character.name, claim);
          await repos.characters.create(charData, { id: character.id });
        }
        restoredCharacterIds.add(character.id);
      } catch (error) {
        warnings.push(`Failed to restore character "${character.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore character', { characterId: character.id, error });
      }
    }

    // 7. Chats (with messages)
    let messagesRestored = 0;
    for (const chat of data.chats) {
      try {
        const { userId, createdAt, updatedAt, messages, ...chatData } = chat;
        // A backup taken before bug 158 holds the chat's scenario in
        // `contextSummary` as well as `scenarioText`. Restoring the instance
        // exactly would restore the defect with it, and the migration that
        // cleared those rows will not run again — so it is corrected on the way
        // in. The scenario itself is untouched.
        // A backup from before the three Concierge states carries only the
        // legacy pair; derive the state so the restored chat keeps its behaviour.
        const createdChat = await repos.chats.create(withConciergeModeFromLegacy(stripScenarioSeededSummary(chatData)), { id: chat.id });

        // Add messages to the chat
        for (const message of messages) {
          try {
            await repos.chats.addMessage(createdChat.id, message);
            messagesRestored++;
          } catch (msgError) {
            warnings.push(`Failed to restore message in chat "${chat.title}": ${msgError instanceof Error ? msgError.message : String(msgError)}`);
          }
        }

        // `addMessage` stamps `lastMessageAt` with the wall clock, so replaying
        // a transcript dates every restored chat to the instant of the restore
        // — which is the timestamp every list sorts and displays by, so the
        // whole history would land in one flat heap. Re-derive it from the
        // transcript we just wrote, under the one predicate that defines it
        // (`lib/chat/chat-activity.ts`). Null when no character ever posted,
        // where readers fall back to `createdAt`.
        try {
          await repos.chats.update(createdChat.id, {
            lastMessageAt: await repos.chats.getLastPlayedMessageAt(createdChat.id),
          });
        } catch (stampError) {
          warnings.push(`Failed to restore last-activity date for chat "${chat.title}": ${stampError instanceof Error ? stampError.message : String(stampError)}`);
        }
      } catch (error) {
        warnings.push(`Failed to restore chat "${chat.title}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore chat', { chatId: chat.id, error });
      }
    }

    // 9. Memories
    // IDs are preserved during creation, so characterId/aboutCharacterId already point
    // to the correct (preserved) character IDs — no remapping needed.
    //
    // Ownership is checked against the characters just restored rather than by
    // the user-scoped repository's read, which goes through the vault overlay
    // and would throw for a character bound to a vault not yet restored (22a).
    //
    // The memory's own id is preserved too, and that matters: memories reference
    // each other through `relatedMemoryIds`, which uuid-remap rewrites in lockstep
    // with `id` for new-account restores. Letting the repository mint a fresh id
    // here would leave every one of those edges pointing at a memory that no longer
    // exists, quietly flattening the Commonplace Book's graph on restore.
    let memoriesRestored = 0;
    // A character this restore wrote is the target user's; any other must
    // already belong to them, read raw (no overlay) and remembered.
    const memoryOwnerChecks = new Map<string, boolean>();
    const memoryOwnerIsTargetUser = async (characterId: string): Promise<boolean> => {
      if (restoredCharacterIds.has(characterId)) return true;
      let owned = memoryOwnerChecks.get(characterId);
      if (owned === undefined) {
        owned = (await globalRepos.characters.findByIdRaw(characterId))?.userId === targetUserId;
        memoryOwnerChecks.set(characterId, owned);
      }
      return owned;
    };
    for (const memory of data.memories) {
      try {
        const { id, createdAt, updatedAt, ...memoryData } = memory;

        // Strip legacy personaId from old backups (column no longer exists)
        const { personaId: _legacyPersonaId, ...cleanMemoryData } = memoryData as Record<string, unknown>;
        // Pre-fix backups wrote embeddings as index-keyed objects (bug 181).
        const decodedEmbedding = decodeIndexKeyedEmbedding(cleanMemoryData.embedding);
        if (decodedEmbedding !== cleanMemoryData.embedding) {
          moduleLogger.debug('Decoded index-keyed memory embedding', {
            memoryId: id,
            dimensions: (decodedEmbedding as number[]).length,
          });
          cleanMemoryData.embedding = decodedEmbedding;
        }
        if (!(await memoryOwnerIsTargetUser(cleanMemoryData.characterId as string))) {
          throw new Error('Character not found or access denied');
        }
        await globalRepos.memories.create(cleanMemoryData as Parameters<typeof globalRepos.memories.create>[0], { id });
        memoriesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore memory: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore memory', { memoryId: memory.id, error });
      }
    }

    // 10. Prompt Templates (user-created only)
    let promptTemplatesRestored = 0;
    for (const template of data.promptTemplates) {
      try {
        const { id, userId, createdAt, updatedAt, ...templateData } = template;
        await globalRepos.promptTemplates.create({
          ...templateData,
          userId: targetUserId,
        });
        promptTemplatesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore prompt template "${template.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore prompt template', { templateId: template.id, error });
      }
    }

    // 11. Roleplay Templates (user-created only)
    let roleplayTemplatesRestored = 0;
    for (const template of data.roleplayTemplates) {
      try {
        const { id, userId, createdAt, updatedAt, ...templateData } = template;
        await globalRepos.roleplayTemplates.create({
          ...templateData,
          userId: targetUserId,
        });
        roleplayTemplatesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore roleplay template "${template.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore roleplay template', { templateId: template.id, error });
      }
    }

    // 12. Provider Models (global cache)
    let providerModelsRestored = 0;
    for (const model of data.providerModels) {
      try {
        const { id, createdAt, updatedAt, ...modelData } = model;
        await globalRepos.providerModels.upsertModel(modelData);
        providerModelsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore provider model "${model.modelId}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore provider model', { modelId: model.modelId, error });
      }
    }

    // 13. Projects. Bound to the archived official store when the archive
    // carries it (bug 185) — slim row only, no fresh store and no link; the
    // archive's link rows arrive at 22h. Otherwise a fresh store, as before.
    let projectsRestored = 0;
    for (const project of data.projects) {
      try {
        // userId no longer exists on Project (projects are global).
        const { createdAt, updatedAt, ...projectData } = project;
        const claim = storeClaims.claim('project', project.id, project.officialMountPointId);
        if (claim.bound) {
          const created = await globalRepos.projects.createBoundToStore(projectData, claim.mountPointId, { id: project.id });
          boundProjects.push({ project: created, mountPointId: claim.mountPointId });
        } else {
          noteStoreFallback('project', project.id, project.name, claim);
          await repos.projects.create(projectData, { id: project.id });
        }
        projectsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore project "${project.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore project', { projectId: project.id, error });
      }
    }

    // 13a. Groups — parallel to projects: a slim row bound to the archived
    // official store when the archive carries it, otherwise `groups.create`
    // provisions a fresh store and writes the hydrated description /
    // instructions / state / properties into it. Membership and
    // additional-store links are restored later (22h-i / 22h-ii), once
    // doc-mount points exist.
    let groupsRestored = 0;
    for (const group of data.groups || []) {
      try {
        const { createdAt, updatedAt, ...groupData } = group;
        const claim = storeClaims.claim('group', group.id, group.officialMountPointId);
        if (claim.bound) {
          const created = await globalRepos.groups.createBoundToStore(groupData, claim.mountPointId, { id: group.id });
          boundGroups.push({ group: created, mountPointId: claim.mountPointId });
        } else {
          noteStoreFallback('group', group.id, group.name, claim);
          await repos.groups.create(groupData, { id: group.id });
        }
        groupsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore group "${group.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore group', { groupId: group.id, error });
      }
    }

    // 14. LLM Logs
    let llmLogsRestored = 0;
    if (isLLMLogsDegraded()) {
      moduleLogger.warn('Skipping LLM logs restore — logs database is in degraded mode');
      warnings.push('LLM logs were not restored because the logs database is in degraded mode');
    } else {
      for (const log of data.llmLogs) {
        try {
          const { id, createdAt, ...logData } = log;
          await repos.llmLogs.create(logData, { id, createdAt });
          llmLogsRestored++;
        } catch (error) {
          warnings.push(`Failed to restore LLM log: ${error instanceof Error ? error.message : String(error)}`);
          moduleLogger.warn('Failed to restore LLM log', { logId: log.id, error });
        }
      }
    }

    // 15. Plugin Configs
    let pluginConfigsRestored = 0;
    for (const config of data.pluginConfigs || []) {
      try {
        const { id, createdAt, updatedAt, ...configData } = config;
        // Use upsert to merge with existing configs or create new ones.
        // `enabled` rides along: without it a plugin the user had switched
        // off silently came back on after a restore.
        await globalRepos.pluginConfigs.upsertForUserPlugin(
          targetUserId,
          configData.pluginName,
          configData.config as Record<string, unknown>,
          configData.enabled
        );
        pluginConfigsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore plugin config for "${config.pluginName}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore plugin config', { pluginName: config.pluginName, error });
      }
    }

    // 16. Chat Settings
    let chatSettingsRestored = 0;
    // A pre-4.10 backup carries the retired Concierge settings and no
    // conciergeSettings; translate them before the schema strips the old keys.
    const backupHasUnmoderatedChats = (data.chats || []).some(
      (chat) => getConciergeState(withConciergeModeFromLegacy(chat as Parameters<typeof withConciergeModeFromLegacy>[0])) === 'unmoderated',
    );
    for (const rawSettings of data.chatSettings || []) {
      const conciergeTranslated = withConciergeSettingsFromLegacy(
        rawSettings as SettingsWithLegacyConcierge<typeof rawSettings>,
        backupHasUnmoderatedChats,
      ) as typeof rawSettings;
      if (conciergeTranslated !== rawSettings) {
        moduleLogger.debug('Translated pre-4.10 Concierge settings for restore', {
          settingsId: rawSettings.id,
          backupHasUnmoderatedChats,
        });
      }
      // A 4.10-dev backup carries the retired on/off impersonationVoiceRewrite.
      const settings = withImpersonationVoiceModeFromLegacy(
        conciergeTranslated as SettingsWithLegacyImpersonationVoice<typeof conciergeTranslated>,
      ) as typeof rawSettings;
      if (settings !== conciergeTranslated) {
        moduleLogger.debug('Translated the retired impersonated-line voice toggle for restore', {
          settingsId: rawSettings.id,
          impersonationVoiceMode: (settings as { impersonationVoiceMode?: string }).impersonationVoiceMode,
        });
      }
      try {
        const { id, createdAt, updatedAt, ...settingsData } = settings;
        await globalRepos.chatSettings.create(settingsData, { id });
        chatSettingsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore chat settings: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore chat settings', { settingsId: settings.id, error });
      }
    }

    // 17. Folders
    let foldersRestored = 0;
    for (const folder of data.folders || []) {
      try {
        const { id, createdAt, updatedAt, ...folderData } = folder;
        await globalRepos.folders.create({ ...folderData, userId: targetUserId }, { id: folder.id });
        foldersRestored++;
      } catch (error) {
        // A backup taken before bug 114 was collapsed can carry many rows for
        // one (userId, projectId, path). The unique index rejects the extras;
        // the first one restored is the survivor and the rest are noise, so
        // they're dropped quietly rather than filling the report with warnings.
        if (isUniqueConstraintError(error)) {
          moduleLogger.debug('Skipped duplicate folder row during restore', {
            folderId: folder.id,
            path: folder.path,
          });
          continue;
        }
        warnings.push(`Failed to restore folder "${folder.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore folder', { folderId: folder.id, error });
      }
    }

    // 19. Wardrobe Items — DEFERRED to step 22g (after doc-store mounts exist).
    // Wardrobe is vault-only: `wardrobe.create` writes into the character's
    // Character Vault / Quilltap General document store and now refuses a
    // SQL-row fallback. At this point in the restore those mounts haven't been
    // recreated yet (they land at 22a), so resolving the vault would fail.
    // Items from a post-cutover backup already restore as `Wardrobe/*.md`
    // documents via 22c–22e; only LEGACY (pre-cutover) backups carry
    // `data.wardrobeItems`, and those are seeded into the vault at 22g.
    let wardrobeItemsRestored = 0;

    // 20. Outfit Presets — REMOVED: presets are now composite WardrobeItems and
    // were folded into data.wardrobeItems at parse time for back-compat with
    // older backups. Nothing to restore here.

    // 21. Character Plugin Data (depends on characters)
    let characterPluginDataRestored = 0;
    for (const cpd of data.characterPluginData || []) {
      try {
        const { id, createdAt, updatedAt, ...cpdData } = cpd;
        await globalRepos.characterPluginData.create(cpdData, { id: cpd.id });
        characterPluginDataRestored++;
      } catch (error) {
        warnings.push(`Failed to restore character plugin data for plugin "${cpd.pluginName}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore character plugin data', { cpdId: cpd.id, pluginName: cpd.pluginName, error });
      }
    }

    // 22. Conversation Annotations (depends on chats)
    let conversationAnnotationsRestored = 0;
    for (const annotation of data.conversationAnnotations || []) {
      try {
        const { id, createdAt, updatedAt, ...annotationData } = annotation;
        await globalRepos.conversationAnnotations.create(annotationData, { id: annotation.id });
        conversationAnnotationsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore conversation annotation: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore conversation annotation', { annotationId: annotation.id, error });
      }
    }

    // ========================================================================
    // Format-3 entities (depend on the entities created above)
    // ========================================================================

    // 22a. Document store mount points. The archive carries these rows as the
    // raw `SELECT *` gave them up — pattern arrays as JSON text, `enabled` as
    // INTEGER 0/1 — so coerce back to domain shape or every row is rejected by
    // the repository schema and the stores come back unreachable.
    //
    // Store names are one case-insensitive namespace (bug 186): a store keeps
    // its archived name when it is free, otherwise takes the next ` (N)` —
    // the case in new-account mode, where the archive's stores arrive beside
    // the instance's own. The archive's createdAt is kept, since a retired
    // vault's name is stamped with it. The reconcile at the end of the
    // restore then names each live vault after its character.
    let docMountPointsRestored = 0;
    const restoredMountPointIds = new Set<string>();
    const takenStoreNames = new Set((await globalRepos.docMountPoints.findAll()).map((mp) => mp.name));
    for (const mp of data.docMountPoints || []) {
      try {
        const { id, createdAt, updatedAt, ...mpData } = coerceDocMountPointRow(mp);
        const name = nextUniqueMountPointName(takenStoreNames, mpData.name);
        if (name !== mpData.name) {
          moduleLogger.debug('Restored document store under a free name', { mountPointId: mp.id, archived: mpData.name, name });
        }
        await globalRepos.docMountPoints.create({ ...mpData, name }, { id: mp.id, ...(createdAt ? { createdAt } : {}) });
        takenStoreNames.add(name);
        restoredMountPointIds.add(mp.id);
        docMountPointsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore document store "${mp.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount point', { mountPointId: mp.id, error });
      }
    }

    // 22a-i. An entity bound to an archived store (6 / 13 / 13a) whose store
    // row just failed to restore would point at nothing, and every read of it
    // would throw. Give it a fresh store populated from its backup row — what
    // the create path would have done.
    for (const { character, mountPointId } of boundCharacters) {
      if (restoredMountPointIds.has(mountPointId)) continue;
      // An archived character is a tombstone: never provision it a vault.
      if (character.archivedAt) {
        warnings.push(`The archived character "${character.name}" could not be restored readable, because its vault could not be restored`);
        moduleLogger.warn('Archived character vault failed to restore; tombstone left unhealed', { characterId: character.id, mountPointId });
        continue;
      }
      try {
        await ensureCharacterVault({ ...character, characterDocumentMountPointId: null });
        warnings.push(`The character "${character.name}" was given a fresh vault because its own could not be restored`);
        moduleLogger.warn('Re-provisioned a character vault whose archived store failed to restore', { characterId: character.id, mountPointId });
      } catch (error) {
        warnings.push(`Failed to give the character "${character.name}" a vault: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.error('Failed to re-provision character vault after restore', { characterId: character.id, mountPointId }, error instanceof Error ? error : undefined);
      }
    }
    const reprovisionStores = [
      ...boundProjects.map(({ project, mountPointId }) => ({ kind: 'project', entity: project, mountPointId, provision: () => globalRepos.projects.provisionOfficialStore(project) })),
      ...boundGroups.map(({ group, mountPointId }) => ({ kind: 'group', entity: group, mountPointId, provision: () => globalRepos.groups.provisionOfficialStore(group) })),
    ];
    for (const { kind, entity, mountPointId, provision } of reprovisionStores) {
      if (restoredMountPointIds.has(mountPointId)) continue;
      try {
        await provision();
        warnings.push(`The ${kind} "${entity.name}" was given a fresh store because its own could not be restored`);
        moduleLogger.warn('Re-provisioned an official store whose archived store failed to restore', { kind, id: entity.id, mountPointId });
      } catch (error) {
        warnings.push(`Failed to give the ${kind} "${entity.name}" a store: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.error('Failed to re-provision official store after restore', { kind, id: entity.id, mountPointId }, error instanceof Error ? error : undefined);
      }
    }
    moduleLogger.info('Restored entities bound to their archived stores', {
      characters: boundCharacters.length,
      projects: boundProjects.length,
      groups: boundGroups.length,
      storesCarried: (data.docMountPoints || []).length,
      storesRestored: restoredMountPointIds.size,
    });

    // 22a-bis. Files (deferred from step 5). The mount points now exist, so
    // both bridges resolve: projects (13) own their official stores and the
    // Quilltap Uploads mount is back under the id its `instance_settings`
    // pointer still names. Read from the extracted dir on disk, write through
    // the bridge, then record the row.
    // In new-account mode, file IDs are remapped but on-disk filenames use original IDs.
    // Use parsedData.files (original) for disk lookup, data.files (remapped) for DB records.
    //
    // Bug 12: a second-generation archive (a backup of an instance that was
    // itself restored) already carries the doc-store rows (file/link/blob) for
    // a project-less user file — its storageKey points at an archived mount
    // blob that 22c–22f restore verbatim, and its link already sits at
    // `restored/<name>`. Re-ingesting it below would mint a *new* blob + link
    // at that same path (the replay gets there first), so 22d's archived link
    // then collides on UNIQUE(mountPointId, relativePath) and loses its id, and
    // the store rows duplicate one more copy per generation. So detect the
    // carried rows and skip the replay: keep the (remapped) archived storageKey
    // and let the archived rows restore intact. First-generation archives are
    // unaffected — their files' bytes aren't yet in a mount blob, so the
    // storageKey isn't a `mount-blob:` key and the replay runs as before.
    const carriedStorageKeyFor = makeCarriedStoreRowsResolver(
      parsedData.docMountBlobs || [],
      data.docMountBlobs || [],
      parsedData.docMountPoints || [],
      data.docMountPoints || [],
    );

    // The carried branch below skips the replay, so it never sees a bridge and
    // cannot take its `sha256` from one. The archived blob rows restore
    // verbatim and carry the hash of their own bytes, which is the same answer
    // the bridge would have given — so index them by id and use that, rather
    // than trusting a `files.sha256` a pre-4.9.0 source instance may have
    // written from its pre-transcode input (bug 117).
    const carriedBlobSha256ById = new Map<string, string>(
      (data.docMountBlobs || []).map(b => [b.id, b.sha256] as const)
    );

    // Re-ingest one user file's bytes through the bridges and record its row.
    // The bridges may transcode bytes (bitmaps → WebP), so the row takes the
    // post-bridge mime/size/sha256 rather than what the backup row claimed — a
    // backup made before that fix may carry the pre-transcode lie, and
    // re-writing it would re-introduce the "media_type X but bytes are Y"
    // error, and (for sha256) a FileEntry that cannot be joined to the mount
    // blob it points at (bug 117).
    const replayFile = async (file: (typeof data.files)[number], originalFile: (typeof parsedData.files)[number]): Promise<void> => {
      const fileBuffer = await getFileFromExtractedBackup(rootPath, originalFile, data.manifest?.backupFormat);
      if (!fileBuffer) {
        warnings.push(`File not found in backup: ${file.originalFilename}`);
        return;
      }
      // Project-bound files restore into the project mount (via FSM →
      // project-store-bridge). Project-less files land in the Quilltap
      // Uploads mount under restored/, not the catch-all _general/.
      const {
        storageKey: restoredStorageKey,
        storedMimeType: restoredMimeType,
        sizeBytes: restoredSize,
        sha256: restoredSha256,
      } = await writeLibraryFileBytes({
        filename: file.originalFilename,
        content: fileBuffer,
        contentType: file.mimeType,
        projectId: file.projectId,
        folderPath: file.folderPath,
        subfolder: 'restored',
      });
      const fileData = stripLegacyFileRowFields(file);
      await repos.files.create(
        {
          ...fileData,
          mimeType: restoredMimeType,
          size: restoredSize,
          sha256: restoredSha256,
          storageKey: restoredStorageKey,
        },
        { id: file.id }
      );
      filesRestored++;
    };

    // A project bound to its archived store (13) has no link to it until 22h,
    // and the bridge finds a project's store through its links — so a file of
    // that project that still needs its bytes re-ingested waits until then,
    // when it lands as an ordinary write into the populated store.
    const boundProjectIds = new Set(boundProjects.map(({ project }) => project.id));
    const deferredFileIndices: number[] = [];

    for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i];
      const originalFile = parsedData.files[i]; // original IDs for disk lookup
      try {
        // Carried store rows (Bug 12): skip the replay, preserve the archived
        // storageKey. This covers project-bound files too: with the project
        // bound to its archived store (bug 185), a replay would write into
        // the very store whose archived link for the file lands at 22d and
        // would collide with it.
        const carriedStorageKey = carriedStorageKeyFor(originalFile.storageKey);
        if (carriedStorageKey) {
          const fileData = stripLegacyFileRowFields(file);
          const carriedBlobId = parseMountBlobStorageKey(carriedStorageKey)?.blobId;
          const carriedSha256 = carriedBlobId ? carriedBlobSha256ById.get(carriedBlobId) : undefined;
          await repos.files.create(
            {
              ...fileData,
              ...(carriedSha256 ? { sha256: carriedSha256 } : {}),
              storageKey: carriedStorageKey,
            },
            { id: file.id }
          );
          filesRestored++;
          continue;
        }

        if (file.projectId && boundProjectIds.has(file.projectId)) {
          deferredFileIndices.push(i);
          continue;
        }

        await replayFile(file, originalFile);
      } catch (error) {
        warnings.push(`Failed to restore file "${file.originalFilename}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore file', { fileId: file.id, error });
      }
    }

    // 22b. Document store folders — sort by path length so parents precede
    // children (parentId is a self-FK into the same table).
    let docMountFoldersRestored = 0;
    const sortedFolders = [...(data.docMountFolders || [])].sort(
      (a, b) => (a.path?.length ?? 0) - (b.path?.length ?? 0)
    );
    for (const folder of sortedFolders) {
      try {
        const { id, createdAt, updatedAt, ...folderData } = folder;
        await globalRepos.docMountFolders.create(folderData, { id: folder.id });
        docMountFoldersRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store folder "${folder.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount folder', { folderId: folder.id, error });
      }
    }

    // 22c. Document store file content rows (content-addressed by sha256).
    let docMountFilesRestored = 0;
    for (const file of data.docMountFiles || []) {
      try {
        const { id, createdAt, updatedAt, ...fileData } = file;
        await globalRepos.docMountFiles.create(fileData, { id: file.id });
        docMountFilesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store file row: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount file', { fileId: file.id, error });
      }
    }

    // 22d. Document store file links (hard links to file content). Same
    // storage-type coercion as 22a — the three policy flags arrive as
    // INTEGER 0/1 and the schema demands booleans.
    let docMountFileLinksRestored = 0;
    for (const link of data.docMountFileLinks || []) {
      try {
        const { id, createdAt, updatedAt, ...linkData } = coerceDocMountFileLinkRow(link);
        await globalRepos.docMountFileLinks.create(linkData, { id: link.id });
        docMountFileLinksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store file link "${link.relativePath}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount file link', { linkId: link.id, error });
      }
    }

    // 22e. Document store text documents (database-backed text content).
    let docMountDocumentsRestored = 0;
    for (const doc of data.docMountDocuments || []) {
      try {
        const { id, createdAt, updatedAt, ...docData } = doc;
        await globalRepos.docMountDocuments.create(docData, { id: doc.id });
        docMountDocumentsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store document: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount document', { documentId: doc.id, error });
      }
    }

    // 22f. Document store binary blobs (metadata rows + bytes from disk).
    // Bytes were staged in mount-blobs/<blobId> at backup time. We restore
    // them by writing the metadata row + bytes directly to the mount-index
    // DB so we preserve the original blob id (a UNIQUE column on fileId).
    let docMountBlobsRestored = 0;
    if ((data.docMountBlobs || []).length > 0) {
      // In new-account mode the metadata id is remapped but the bytes on
      // disk are still keyed by the *original* id. Pair them by index, the
      // same trick used for user files higher up.
      const originalBlobs = parsedData.docMountBlobs || [];
      const blobsDir = path.join(rootPath, 'mount-blobs');
      const mountIndexDb = isMountIndexDegraded() ? null : getRawMountIndexDatabase();
      if (!mountIndexDb) {
        warnings.push('Doc-store blobs were not restored — mount-index database is unavailable');
      } else {
        const insert = mountIndexDb.prepare(
          `INSERT INTO "doc_mount_blobs" (id, fileId, sha256, sizeBytes, storedMimeType, data, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (let i = 0; i < (data.docMountBlobs || []).length; i++) {
          const blob = (data.docMountBlobs || [])[i];
          const original = originalBlobs[i] ?? blob;
          try {
            const bytesPath = path.join(blobsDir, original.id);
            const bytes = await fs.promises.readFile(bytesPath);
            insert.run(
              blob.id,
              blob.fileId,
              blob.sha256,
              blob.sizeBytes,
              blob.storedMimeType,
              bytes,
              blob.createdAt,
              blob.updatedAt
            );
            docMountBlobsRestored++;
          } catch (error) {
            warnings.push(`Failed to restore doc-store blob ${blob.id}: ${error instanceof Error ? error.message : String(error)}`);
            moduleLogger.warn('Failed to restore doc mount blob', { blobId: blob.id, error });
          }
        }
      }
    }

    // 22f-bis. Legacy wardrobe items (deferred from step 19). The doc-store
    // mounts, folders, and file rows now exist (22a–22f), so each character's
    // Character Vault — and Quilltap General for shared archetypes — resolves.
    // `wardrobe.create` therefore writes these straight into the vault document
    // store (its sole home); it no longer falls back to a SQL `wardrobe_items`
    // row. Post-cutover backups carry their wardrobe as `Wardrobe/*.md`
    // documents (already restored above) and leave `data.wardrobeItems` empty,
    // so this loop only fires for older, pre-cutover backups.
    for (const item of data.wardrobeItems || []) {
      try {
        const { id, createdAt, updatedAt, ...itemData } = item;
        await globalRepos.wardrobe.create(itemData, { id: item.id });
        wardrobeItemsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore wardrobe item "${item.title}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore wardrobe item', { wardrobeItemId: item.id, error });
      }
    }

    // 22f-ter. Wardrobe picture pointers (new-account mode). The vaults and
    // the picture `files` rows are in place; each item's frontmatter
    // `imageFileId` still names the file's pre-remap id. Repoint it through
    // the ordinary per-mount wardrobe update, which re-projects the document
    // (so its content hash follows the new text). The mount-scoped writer is
    // used for every tier: it addresses the folder by mount, and a character
    // vault's frontmatter carries no characterId to disturb.
    // An archived character's vault is a tombstone: it is never written, so
    // its pictures keep their old pointer (readable history, no current pick).
    const tombstonedVaults = new Set(
      data.characters
        .filter((c) => c.archivedAt && c.characterDocumentMountPointId)
        .map((c) => c.characterDocumentMountPointId as string)
    );
    let wardrobeImagePointersFixed = 0;
    for (const fix of wardrobeImagePointerFixes) {
      if (tombstonedVaults.has(fix.mountPointId) || tombstonedVaults.has(fix.sourceMountPointId)) continue;
      try {
        if (await updateProjectWardrobeItem(fix.mountPointId, fix.itemId, { imageFileId: fix.imageFileId })) {
          wardrobeImagePointersFixed++;
        }
      } catch (error) {
        warnings.push(`Failed to repoint a wardrobe item's picture (${fix.itemId}): ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to repoint wardrobe item picture after restore', { ...fix, error });
      }
    }
    if (wardrobeImagePointerFixes.length > 0) {
      moduleLogger.info('Repointed wardrobe item pictures after new-account restore', {
        planned: wardrobeImagePointerFixes.length,
        fixed: wardrobeImagePointersFixed,
      });
    }

    // 22g. Document store embedded chunks. The repo's create() accepts the
    // chunk in serialised form; the schema rehydrates embedding as Float32Array.
    let docMountChunksRestored = 0;
    for (const chunk of data.docMountChunks || []) {
      try {
        const { id, createdAt, updatedAt, ...chunkData } = chunk;
        await globalRepos.docMountChunks.create(chunkData as unknown as Parameters<typeof globalRepos.docMountChunks.create>[0], { id: chunk.id });
        docMountChunksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store chunk: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount chunk', { chunkId: chunk.id, error });
      }
    }

    // 22h. Project ↔ document-store links.
    let projectDocMountLinksRestored = 0;
    for (const link of data.projectDocMountLinks || []) {
      try {
        const { id, createdAt, updatedAt, ...linkData } = link;
        await globalRepos.projectDocMountLinks.create(linkData, { id: link.id });
        projectDocMountLinksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore project↔store link: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore project doc mount link', { linkId: link.id, error });
      }
    }

    // 22h-bis. Files of projects bound to their archived stores whose bytes
    // still needed re-ingesting (deferred from 22a-bis). The links just
    // restored let the bridge find each project's store.
    for (const i of deferredFileIndices) {
      const file = data.files[i];
      try {
        await replayFile(file, parsedData.files[i]);
      } catch (error) {
        warnings.push(`Failed to restore file "${file.originalFilename}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore deferred project file', { fileId: file.id, projectId: file.projectId, error });
      }
    }
    if (deferredFileIndices.length > 0) {
      moduleLogger.debug('Replayed deferred project files', { count: deferredFileIndices.length });
    }

    // 22h-i. Group ↔ document-store links (a group's *additional* linked stores;
    // the official store rides on the group row). Mirror of projectDocMountLinks.
    let groupDocMountLinksRestored = 0;
    for (const link of data.groupDocMountLinks || []) {
      try {
        const { id, createdAt, updatedAt, ...linkData } = link;
        await globalRepos.groupDocMountLinks.create(linkData, { id: link.id });
        groupDocMountLinksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore group↔store link: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore group doc mount link', { linkId: link.id, error });
      }
    }

    // 22h-ii. Group ↔ character membership. groupId/characterId both reference
    // main-DB rows already restored above (groups at 13a, characters at 6).
    let groupCharacterMembersRestored = 0;
    for (const member of data.groupCharacterMembers || []) {
      try {
        const { id, createdAt, updatedAt, ...memberData } = member;
        await globalRepos.groupCharacterMembers.create(memberData, { id: member.id });
        groupCharacterMembersRestored++;
      } catch (error) {
        warnings.push(`Failed to restore group membership: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore group character member', { memberId: member.id, error });
      }
    }

    // 22i. Chat documents (Document Mode pane state per chat).
    let chatDocumentsRestored = 0;
    for (const cd of data.chatDocuments || []) {
      try {
        const { id, createdAt, updatedAt, ...cdData } = cd;
        await globalRepos.chatDocuments.create(cdData, { id: cd.id });
        chatDocumentsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore chat document: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore chat document', { chatDocumentId: cd.id, error });
      }
    }

    // 22i-ii. Inform rows. Consumed rows come back too: the row a past turn
    // consumed is what lets a swipe of that turn re-apply the same passage.
    // Must follow the chats (13/14) and their replayed transcripts, since the
    // row points at a seat, at the Host record message and, once consumed, at
    // the assistant message that carried it.
    let chatInformsRestored = 0;
    for (const inform of data.chatInforms || []) {
      try {
        const { id, createdAt, updatedAt, ...informData } = inform;
        await globalRepos.chatInforms.create(informData, { id: inform.id });
        chatInformsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore inform: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore chat inform', { informId: inform.id, error });
      }
    }
    moduleLogger.debug('Restored chat informs', {
      total: (data.chatInforms || []).length,
      restored: chatInformsRestored,
    });

    // 22j. Vector index metas + entries. Without these every memory would
    // need to be re-embedded after restore.
    let vectorIndexMetasRestored = 0;
    for (const meta of data.vectorIndexMetas || []) {
      try {
        await globalRepos.vectorIndices.saveMeta(meta.characterId, meta.dimensions);
        vectorIndexMetasRestored++;
      } catch (error) {
        warnings.push(`Failed to restore vector index meta for character ${meta.characterId}: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore vector index meta', { characterId: meta.characterId, error });
      }
    }

    // The repo's addEntries batch path expects Float32Array; the serialised
    // form holds plain number arrays, so rehydrate before insert.
    let vectorEntriesRestored = 0;
    if ((data.vectorEntries || []).length > 0) {
      try {
        const rehydrated = (data.vectorEntries || []).map((e) => ({
          id: e.id,
          characterId: e.characterId,
          embedding: new Float32Array(e.embedding),
        }));
        await globalRepos.vectorIndices.addEntries(rehydrated);
        vectorEntriesRestored = rehydrated.length;
      } catch (error) {
        warnings.push(`Failed to restore vector entries: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore vector entries batch', { error });
      }
    }

    // 22k. Conversation chunks (semantic chunks with embeddings).
    let conversationChunksRestored = 0;
    for (const chunk of data.conversationChunks || []) {
      try {
        const { id, createdAt, updatedAt, ...chunkData } = chunk;
        // The repo's create accepts ConversationChunkInput; embeddings come
        // through as number[] and the Zod transform rehydrates them.
        await globalRepos.conversationChunks.create(
          chunkData as unknown as Parameters<typeof globalRepos.conversationChunks.create>[0],
          { id: chunk.id }
        );
        conversationChunksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore conversation chunk: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore conversation chunk', { chunkId: chunk.id, error });
      }
    }

    // 22l. TF-IDF vocabularies (one per BUILTIN embedding profile).
    let tfidfVocabulariesRestored = 0;
    for (const voc of data.tfidfVocabularies || []) {
      try {
        const { id, createdAt, updatedAt, ...vocData } = voc;
        await globalRepos.tfidfVocabularies.create(
          { ...vocData, userId: targetUserId },
          { id: voc.id }
        );
        tfidfVocabulariesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore TF-IDF vocabulary: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore tfidf vocabulary', { vocabularyId: voc.id, error });
      }
    }

    // 22m. Embedding status flags.
    let embeddingStatusRestored = 0;
    for (const es of data.embeddingStatus || []) {
      try {
        const { id, createdAt, updatedAt, ...esData } = es;
        await globalRepos.embeddingStatus.create(
          { ...esData, userId: targetUserId },
          { id: es.id }
        );
        embeddingStatusRestored++;
      } catch (error) {
        warnings.push(`Failed to restore embedding status: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore embedding status', { statusId: es.id, error });
      }
    }

    // 22n. Text replacement rules (global; no userId, no FKs). Insert each row
    // through the repository so its unique-conflict guard applies. Replace mode
    // truncates the table first (delete-service), so conflicts here only arise
    // in merge mode against pre-existing rules — swallow those and keep going,
    // matching the tolerance of the other restore loops.
    let textReplacementRulesRestored = 0;
    for (const rule of data.textReplacementRules || []) {
      try {
        const { id, createdAt, updatedAt, ...ruleData } = rule;
        await globalRepos.textReplacementRules.create(ruleData, { id: rule.id });
        textReplacementRulesRestored++;
      } catch (error) {
        if (error instanceof TextReplacementRuleConflictError) {
          moduleLogger.debug('Skipping duplicate text replacement rule on restore', {
            fromText: rule.fromText,
            caseSensitive: rule.caseSensitive,
          });
          continue;
        }
        warnings.push(`Failed to restore text replacement rule: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore text replacement rule', { ruleId: rule.id, error });
      }
    }
    if (textReplacementRulesRestored > 0) {
      moduleLogger.debug('Restored text replacement rules', { count: textReplacementRulesRestored });
    }

    // 22n-bis. Wardrobe wear ledger (global; keyed by item id, no FKs). Written
    // as given through the repository's import/restore path — no increment.
    // Replace mode truncated the table first (delete-service); a collision on
    // (item, wearer) in any other mode takes the backup's tally. The backup's
    // rows are unique on that key already, so no pre-merge is needed.
    let wardrobeWearRestored = 0;
    const wardrobeWearRows = data.wardrobeWear || [];
    if (wardrobeWearRows.length > 0) {
      try {
        await globalRepos.wardrobeWear.upsertRows(wardrobeWearRows);
        wardrobeWearRestored = wardrobeWearRows.length;
      } catch (error) {
        warnings.push(`Failed to restore the wardrobe wear ledger: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore wardrobe wear ledger', { rowCount: wardrobeWearRows.length, error });
      }
    }
    moduleLogger.debug('Restored wardrobe wear ledger', {
      total: wardrobeWearRows.length,
      restored: wardrobeWearRestored,
    });

    // 22o. Instance settings — applied last because the mount-point keys
    // reference doc_mount_points that we just restored above. Upsert by key
    // so a fresh instance's auto-provisioned defaults get overwritten by the
    // backup's values.
    let instanceSettingsRestored = 0;
    for (const row of data.instanceSettings || []) {
      try {
        await rawQuery(
          'INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?) ' +
            'ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"',
          [row.key, row.value]
        );
        instanceSettingsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore instance setting "${row.key}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore instance setting', { key: row.key, error });
      }
    }

    // 23. NPM Plugins (copy from extracted dir to plugins/npm directory)
    let npmPluginsRestored = 0;
    const npmPluginsSrcDir = path.join(rootPath, 'plugins', 'npm');

    try {
      const pluginEntries = await fs.promises.readdir(npmPluginsSrcDir, { withFileTypes: true });
      const npmPluginsDir = getNpmPluginsDir();

      // Ensure the npm plugins directory exists
      await fs.promises.mkdir(npmPluginsDir, { recursive: true });

      for (const entry of pluginEntries) {
        if (entry.isDirectory()) {
          try {
            const srcPath = path.join(npmPluginsSrcDir, entry.name);
            const destPath = path.join(npmPluginsDir, entry.name);
            await fs.promises.cp(srcPath, destPath, { recursive: true });
            npmPluginsRestored++;
            moduleLogger.debug('Restored npm plugin', { pluginName: entry.name });
          } catch (error) {
            warnings.push(`Failed to restore npm plugin "${entry.name}": ${error instanceof Error ? error.message : String(error)}`);
            moduleLogger.warn('Failed to restore npm plugin', { pluginName: entry.name, error });
          }
        }
      }

      if (npmPluginsRestored > 0) {
        moduleLogger.info('Restored npm plugins', {
          count: npmPluginsRestored,
          plugins: pluginEntries.filter((e) => e.isDirectory()).map((e) => e.name),
        });
      }
    } catch {
      // No plugins/npm directory in the backup — that's fine
      moduleLogger.debug('No npm plugins directory in backup');
    }

    // 24. User-installed theme bundles (copy from extracted dir to themes directory)
    let userInstalledThemesRestored = 0;
    const themesSrcDir = path.join(rootPath, 'themes');

    try {
      const themeEntries = await fs.promises.readdir(themesSrcDir, { withFileTypes: true });
      const themesDir = getThemesDir();

      // Ensure the themes directory exists
      await fs.promises.mkdir(themesDir, { recursive: true });

      for (const entry of themeEntries) {
        if (entry.isDirectory() && entry.name !== '.cache') {
          try {
            const srcPath = path.join(themesSrcDir, entry.name);
            const destPath = path.join(themesDir, entry.name);
            await fs.promises.cp(srcPath, destPath, { recursive: true, force: true });
            userInstalledThemesRestored++;
            moduleLogger.debug('Restored theme bundle', { themeId: entry.name });
          } catch (error) {
            warnings.push(`Failed to restore theme bundle "${entry.name}": ${error instanceof Error ? error.message : String(error)}`);
            moduleLogger.warn('Failed to restore theme bundle', { themeId: entry.name, error });
          }
        } else if (entry.isFile() && entry.name === 'themes-index.json') {
          // Restore the themes index file
          try {
            const themesDir2 = getThemesDir();
            await fs.promises.cp(path.join(themesSrcDir, 'themes-index.json'), path.join(themesDir2, 'themes-index.json'), { force: true });
          } catch (error) {
            moduleLogger.warn('Failed to restore themes-index.json', { error });
          }
        }
      }

      if (userInstalledThemesRestored > 0) {
        moduleLogger.info('Restored user-installed theme bundles', {
          count: userInstalledThemesRestored,
        });
      }
    } catch {
      // No themes directory in the backup — that's fine
      moduleLogger.debug('No themes directory in backup');
    }

    moduleLogger.info('All entities restored with preserved IDs - no reconciliation needed');

    // 23a. Store names (bug 186): each live vault named after its character,
    // every vault no character points at retired, no two stores alike.
    try {
      const nameResult = await reconcileStoreNames('restore');
      moduleLogger.debug('Post-restore store-name reconcile complete', {
        renamed: nameResult.renamed.length,
        skippedReason: nameResult.skippedReason,
      });
    } catch (error) {
      warnings.push(`Failed to tidy document-store names after restore: ${error instanceof Error ? error.message : String(error)}`);
      moduleLogger.warn('Post-restore store-name reconcile failed', { error });
    }

    // 24a. Compact archives arrive with no vectors at all: memory embeddings
    // are NULL and every derived collection (conversation chunks, vector
    // entries, TF-IDF vocabularies, doc-mount chunks) was omitted at backup
    // time. The reconcile below deliberately ignores *absent* chunk rows — it
    // only repairs non-conforming ones — so without this the instance would
    // come back with search quietly cold. Enqueued before the reconcile so the
    // reconcile's own dedup sees this job and doesn't stack a second one.
    if (parsedData.manifest?.compact) {
      try {
        const profile = await getDefaultEmbeddingProfile(targetUserId);
        if (profile) {
          await enqueueEmbeddingReindexAll(targetUserId, { profileId: profile.id, scope: 'all' });
          moduleLogger.debug('Queued full re-index for compact backup restore', {
            targetUserId,
            profileId: profile.id,
          });
          warnings.push(
            'This was a compact backup, so search indexes were rebuilt rather than restored — ' +
              'search will warm back up as re-indexing completes. Conversation and document ' +
              'chunks are rebuilt as those chats and stores are next touched.'
          );
        } else {
          warnings.push(
            'This was a compact backup, but no default embedding profile is configured, so ' +
              'search cannot be rebuilt yet. Configure one and re-index from the Commonplace Book.'
          );
        }
      } catch (error) {
        warnings.push(
          `Failed to queue re-indexing after compact restore: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        moduleLogger.warn('Failed to enqueue reindex after compact restore', { error });
      }
    }

    // 25. Embedding reconcile. Restore is the one moment a corpus can arrive
    // whose vectors were produced under a different embedding standard than
    // this instance's default profile — new-account mode, or simply a machine
    // configured differently from the one the backup came off. Until now the
    // only repair was the *next boot's* sweep, which is fine for an in-place
    // restore and wrong for everything else.
    //
    // The reconcile takes no arguments, never throws (it catches into a null
    // result), resolves the default profile itself and dedupes its own
    // reindex enqueue — so in the ordinary conforming case this is a cheap
    // no-op.
    const reconcileResult = await reconcileEmbeddingDimensions();
    moduleLogger.debug('Post-restore embedding reconcile complete', {
      targetDimensions: reconcileResult.targetDimensions,
      skippedReason: reconcileResult.skippedReason,
      vectorEntriesDeleted: reconcileResult.vectorEntriesDeleted,
      vectorIndexMetaFixed: reconcileResult.vectorIndexMetaFixed,
      reindexEnqueued: reconcileResult.reindexEnqueued,
      mismatched: reconcileResult.mismatched,
    });
    if (reconcileResult.skippedReason) {
      warnings.push(
        `Embedding reconcile was skipped after restore (${reconcileResult.skippedReason}); ` +
          'semantic search will be repaired on the next startup.'
      );
    } else if (reconcileResult.reindexEnqueued) {
      warnings.push(
        'Some restored embeddings did not match this instance\'s embedding profile; ' +
          're-indexing has been queued and search will warm back up as it completes.'
      );
    }

    const summary: RestoreSummary = {
      characters: data.characters.length,
      chats: data.chats.length,
      messages: messagesRestored,
      tags: data.tags.length,
      files: filesRestored,
      memories: memoriesRestored,
      profiles: {
        connection: data.connectionProfiles.length,
        image: data.imageProfiles.length,
        embedding: data.embeddingProfiles.length,
      },
      templates: {
        prompt: promptTemplatesRestored,
        roleplay: roleplayTemplatesRestored,
      },
      providerModels: providerModelsRestored,
      projects: projectsRestored,
      groups: groupsRestored,
      llmLogs: llmLogsRestored,
      pluginConfigs: pluginConfigsRestored,
      chatSettings: chatSettingsRestored,
      folders: foldersRestored,
      wardrobeItems: wardrobeItemsRestored,
      npmPlugins: npmPluginsRestored,
      characterPluginData: characterPluginDataRestored,
      conversationAnnotations: conversationAnnotationsRestored,
      userInstalledThemes: userInstalledThemesRestored,
      chatDocuments: chatDocumentsRestored,
      chatInforms: chatInformsRestored,
      instanceSettings: instanceSettingsRestored,
      embeddingStatus: embeddingStatusRestored,
      conversationChunks: conversationChunksRestored,
      tfidfVocabularies: tfidfVocabulariesRestored,
      vectorIndexMetas: vectorIndexMetasRestored,
      vectorEntries: vectorEntriesRestored,
      docMountPoints: docMountPointsRestored,
      docMountFolders: docMountFoldersRestored,
      docMountFiles: docMountFilesRestored,
      docMountFileLinks: docMountFileLinksRestored,
      docMountChunks: docMountChunksRestored,
      docMountDocuments: docMountDocumentsRestored,
      docMountBlobs: docMountBlobsRestored,
      projectDocMountLinks: projectDocMountLinksRestored,
      groupDocMountLinks: groupDocMountLinksRestored,
      groupCharacterMembers: groupCharacterMembersRestored,
      textReplacementRules: textReplacementRulesRestored,
      wardrobeWear: wardrobeWearRestored,
      embeddingReconcile: {
        targetDimensions: reconcileResult.targetDimensions,
        skippedReason: reconcileResult.skippedReason,
        vectorEntriesDeleted: reconcileResult.vectorEntriesDeleted,
        vectorIndexMetaFixed: reconcileResult.vectorIndexMetaFixed,
        reindexEnqueued: reconcileResult.reindexEnqueued,
      },
      warnings,
    };

    moduleLogger.info('Restore operation completed', {
      targetUserId,
      mode,
      summary,
      warningCount: warnings.length,
    });

    return summary;
  } finally {
    // Always clean up the extracted temp directory
    await cleanupDir(extractDir);
  }
}
