/**
 * The shape of a "save this picture into…" choice, and the instance-wide list
 * of them.
 *
 * Two surfaces offer the same `SaveImageDialog`: the Salon (whose candidates
 * are the chat's own — see `GET /api/v1/chats/[id]?action=photo-albums`) and
 * the wardrobe picture viewer, which is not inside any conversation and so
 * offers every document store the operator could file a picture in. Both
 * answer with {@link PhotoAlbumOption}, so the dialog renders either list the
 * same way.
 *
 * @module photos/photo-album-options
 */

import { logger } from '@/lib/logger';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { getArchivedCharacterVaultMountPointIds } from '@/lib/mount-index/character-vault';
import type { RepositoryContainer } from '@/lib/database/repositories';

export type PhotoAlbumKind = 'character' | 'project' | 'document-store' | 'general';

export interface PhotoAlbumOption {
  mountPointId: string;
  /** Display label. Character albums use the character name; others use the mount-point name. */
  name: string;
  kind: PhotoAlbumKind;
  /** Present for `kind: 'character'`. */
  characterId?: string;
  /** Present for `kind: 'character'` — the chat participant whose vault this is. */
  participantId?: string;
  /** Present for `kind: 'character'` — true when the participant is user-controlled. */
  isUserCharacter?: boolean;
  /** Exactly one option in the response is marked default. */
  isDefault?: boolean;
}

const KIND_ORDER: Record<PhotoAlbumKind, number> = {
  character: 0,
  project: 1,
  'document-store': 2,
  general: 3,
};

/**
 * Every enabled document store a picture may be filed in, outside any chat.
 *
 * Archived characters' vaults are left out: a tombstone's vault is still live
 * and writable, and a save into it would be an edit the archive guards exist
 * to prevent. Character vaults are labelled with their character's name;
 * a project's official store is `project`; Quilltap General is `general` and
 * is the default. Sorted by kind, then name.
 */
export async function listAllPhotoAlbumOptions(
  repos: Pick<RepositoryContainer, 'docMountPoints' | 'characters' | 'projects'>,
): Promise<PhotoAlbumOption[]> {
  const [mountPoints, archivedVaultIds, generalId, characters, projects] = await Promise.all([
    repos.docMountPoints.findEnabled(),
    getArchivedCharacterVaultMountPointIds(),
    getGeneralMountPointId(),
    repos.characters.findAllRaw(),
    repos.projects.findAll(),
  ]);

  const archived = new Set(archivedVaultIds);
  const characterByVault = new Map<string, { id: string; name: string; controlledBy?: string | null }>();
  for (const c of characters) {
    if (c.characterDocumentMountPointId && !c.archivedAt) {
      characterByVault.set(c.characterDocumentMountPointId, c);
    }
  }
  const projectStoreIds = new Set(
    projects.map((p) => p.officialMountPointId).filter((id): id is string => !!id),
  );

  const options: PhotoAlbumOption[] = [];
  for (const mp of mountPoints) {
    if (archived.has(mp.id)) continue;
    const character = characterByVault.get(mp.id);
    if (character) {
      options.push({
        mountPointId: mp.id,
        name: character.name,
        kind: 'character',
        characterId: character.id,
        isUserCharacter: character.controlledBy === 'user',
      });
    } else if (mp.id === generalId) {
      options.push({ mountPointId: mp.id, name: mp.name, kind: 'general', isDefault: true });
    } else if (projectStoreIds.has(mp.id)) {
      options.push({ mountPointId: mp.id, name: mp.name, kind: 'project' });
    } else {
      // Includes a retired `<Name> Version … Store` no character points at.
      options.push({ mountPointId: mp.id, name: mp.name, kind: 'document-store' });
    }
  }

  options.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
  if (options.length > 0 && !options.some((o) => o.isDefault)) {
    options[0].isDefault = true;
  }

  logger.debug('[photo-album-options] Listed every store as a save target', {
    enabledStores: mountPoints.length,
    archivedVaultsSkipped: archivedVaultIds.length,
    offered: options.length,
  });
  return options;
}
