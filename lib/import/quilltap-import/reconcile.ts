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
  ChatParticipantBase,
  Project,
} from '@/lib/schemas/types';
import type { IdMappingState } from './types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/**
 * Updates all entity relationships with correct remapped IDs
 */
export async function reconcileRelationships(
  userId: string,
  repos: ReturnType<typeof getUserRepositories>,
  idMaps: IdMappingState,
  warnings: string[]
): Promise<void> {
  moduleLogger.info('Starting post-import reconciliation', { userId });

  const remapId = (id: string | null | undefined, idMap: Map<string, string>): string | null => {
    if (!id) return null;
    return idMap.get(id) || null;
  };

  const remapIdArray = (ids: string[] | undefined, idMap: Map<string, string>): string[] => {
    if (!ids) return [];
    return ids
      .map((id) => idMap.get(id) || id)
      .filter((id) => id !== null) as string[];
  };

  // Reconcile characters
  for (const [backupId, newId] of idMaps.characters) {
    try {
      const character = await repos.characters.findById(newId);
      if (!character) continue;

      const updates: Partial<Character> = {};
      let hasUpdates = false;

      // Remap tags
      if (character.tags && character.tags.length > 0) {
        const remappedTags = remapIdArray(character.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          updates.tags = remappedTags;
          hasUpdates = true;
        }
      }

      // Remap defaultPartnerId (Characters Not Personas: default user-controlled character to pair with)
      if (character.defaultPartnerId) {
        const newPartnerId = remapId(character.defaultPartnerId, idMaps.characters);
        if (newPartnerId) {
          updates.defaultPartnerId = newPartnerId;
          hasUpdates = true;
        }
      }

      // Remap defaultConnectionProfileId
      if (character.defaultConnectionProfileId) {
        const newConnProfileId = remapId(character.defaultConnectionProfileId, idMaps.connectionProfiles);
        if (newConnProfileId) {
          updates.defaultConnectionProfileId = newConnProfileId;
          hasUpdates = true;
        }
      }

      // Remap defaultImageProfileId
      if (character.defaultImageProfileId) {
        const newImgProfileId = remapId(character.defaultImageProfileId, idMaps.imageProfiles);
        if (newImgProfileId) {
          updates.defaultImageProfileId = newImgProfileId;
          hasUpdates = true;
        }
      }

      // Remap defaultRoleplayTemplateId
      if (character.defaultRoleplayTemplateId) {
        const newTemplateId = remapId(character.defaultRoleplayTemplateId, idMaps.roleplayTemplates);
        if (newTemplateId) {
          updates.defaultRoleplayTemplateId = newTemplateId;
          hasUpdates = true;
        }
      }

      // Remap characterDocumentMountPointId. Only rewrite when the imported
      // value resolves to a remapped mount-point row — character vaults are
      // provisioned fresh at import time by `repos.characters.create()`, and
      // the post-create row holds a freshly-allocated id we must not blow
      // away. The earlier behavior of nulling the field on a failed remap
      // created orphaned vaults: the importer would provision a vault, then
      // this pass would clear the link, and the startup vault backfill would
      // provision yet another one.
      if (character.characterDocumentMountPointId) {
        const newMountId = remapId(character.characterDocumentMountPointId, idMaps.mountPoints);
        if (newMountId) {
          updates.characterDocumentMountPointId = newMountId;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.characters.update(newId, updates);
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
  for (const [backupId, newId] of idMaps.chats) {
    try {
      const chat = await repos.chats.findById(newId);
      if (!chat) continue;

      const updates: Partial<ChatMetadata> = {};
      let hasUpdates = false;

      // Remap participants
      if (chat.participants && chat.participants.length > 0) {
        updates.participants = chat.participants
          .map((participant) => {
            const remapped: ChatParticipantBase = { ...participant };

            if (participant.characterId) {
              const newCharId = remapId(participant.characterId, idMaps.characters);
              if (newCharId) remapped.characterId = newCharId;
            }

            if (participant.connectionProfileId) {
              const newConnId = remapId(
                participant.connectionProfileId,
                idMaps.connectionProfiles
              );
              if (newConnId) remapped.connectionProfileId = newConnId;
            }

            if (participant.imageProfileId) {
              const newImgProfId = remapId(
                participant.imageProfileId,
                idMaps.imageProfiles
              );
              if (newImgProfId) remapped.imageProfileId = newImgProfId;
            }

            // Remap roleplayTemplateId
            if (participant.roleplayTemplateId) {
              const newTemplateId = remapId(
                participant.roleplayTemplateId,
                idMaps.roleplayTemplates
              );
              if (newTemplateId) remapped.roleplayTemplateId = newTemplateId;
            }

            return remapped;
          });
        hasUpdates = true;
      }

      // Remap tags
      if (chat.tags && chat.tags.length > 0) {
        const remappedTags = remapIdArray(chat.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          updates.tags = remappedTags;
          hasUpdates = true;
        }
      }

      // Remap projectId
      if (chat.projectId) {
        const newProjectId = remapId(chat.projectId, idMaps.projects);
        if (newProjectId) {
          updates.projectId = newProjectId;
          hasUpdates = true;
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

  // Reconcile projects
  for (const [backupId, newId] of idMaps.projects) {
    try {
      const project = await repos.projects.findById(newId);
      if (!project) continue;

      const updates: Partial<Project> = {};
      let hasUpdates = false;

      // Remap characterRoster
      if (project.characterRoster && project.characterRoster.length > 0) {
        const remappedRoster = remapIdArray(project.characterRoster, idMaps.characters);
        if (remappedRoster.length > 0) {
          updates.characterRoster = remappedRoster;
          hasUpdates = true;
        }
      }

      // Remap defaultImageProfileId
      if (project.defaultImageProfileId) {
        const newImgProfileId = remapId(project.defaultImageProfileId, idMaps.imageProfiles);
        if (newImgProfileId) {
          updates.defaultImageProfileId = newImgProfileId;
          hasUpdates = true;
        }
      }

      // Remap defaultRoleplayTemplateId (custom templates get fresh ids on import)
      if (project.defaultRoleplayTemplateId) {
        const newTemplateId = remapId(project.defaultRoleplayTemplateId, idMaps.roleplayTemplates);
        if (newTemplateId) {
          updates.defaultRoleplayTemplateId = newTemplateId;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await repos.projects.update(newId, updates);
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile project relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile project', {
        projectId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile connection profiles (tags)
  for (const [backupId, newId] of idMaps.connectionProfiles) {
    try {
      const profile = await repos.connections.findById(newId);
      if (!profile) continue;

      if (profile.tags && profile.tags.length > 0) {
        const remappedTags = remapIdArray(profile.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          await repos.connections.update(newId, { tags: remappedTags });
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile connection profile relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile connection profile', {
        profileId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile image profiles (tags)
  for (const [backupId, newId] of idMaps.imageProfiles) {
    try {
      const profile = await repos.imageProfiles.findById(newId);
      if (!profile) continue;

      if (profile.tags && profile.tags.length > 0) {
        const remappedTags = remapIdArray(profile.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          await repos.imageProfiles.update(newId, { tags: remappedTags });
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile image profile relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile image profile', {
        profileId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile embedding profiles (tags)
  for (const [backupId, newId] of idMaps.embeddingProfiles) {
    try {
      const profile = await repos.embeddingProfiles.findById(newId);
      if (!profile) continue;

      if (profile.tags && profile.tags.length > 0) {
        const remappedTags = remapIdArray(profile.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          await repos.embeddingProfiles.update(newId, { tags: remappedTags });
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile embedding profile relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile embedding profile', {
        profileId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Reconcile roleplay templates (tags)
  const globalRepos = getRepositories();
  for (const [backupId, newId] of idMaps.roleplayTemplates) {
    try {
      const template = await globalRepos.roleplayTemplates.findById(newId);
      if (!template) continue;

      if (template.tags && template.tags.length > 0) {
        const remappedTags = remapIdArray(template.tags, idMaps.tags);
        if (remappedTags.length > 0) {
          await globalRepos.roleplayTemplates.update(newId, { tags: remappedTags });
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to reconcile roleplay template relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to reconcile roleplay template', {
        templateId: newId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  moduleLogger.info('Post-import reconciliation completed');
}
