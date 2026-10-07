/**
 * Wardrobe picture import: re-mint each character-owned wardrobe item's
 * picture rows against the vault the bundle carried.
 *
 * A picture's bytes travel as a vault blob at
 * `Wardrobe/images/<itemId>/<originalFilename>`; its `files` row travels as
 * metadata on the item's record (`_imageFiles`). Once the document-store phase
 * has landed the vault and `reconcileRelationships` has pointed the character
 * at it, this step finds each blob in the imported vault and creates a `files`
 * row for it (keeping the exported id when it is free, minting one when not),
 * then points the item's `imageFileId` at its own copy.
 *
 * The vault-borne item keeps its exported id — the vault's `Wardrobe/*.md`
 * frontmatter carries it — so paths and `linkedTo` use that id. A pre-A2
 * bundle (no vault records) carries no bytes: its items were created by
 * `importCharacters` with no picture and stay that way.
 *
 * Design of record: docs/developer/features/wardrobe-item-images.md §7
 *
 * @module import/quilltap-import/import-wardrobe-images
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { buildMountBlobStorageKey } from '@/lib/file-storage/project-store-bridge';
import { wardrobeItemImagePath } from '@/lib/file-storage/wardrobe-image-bridge';
import type { ExportedCharacter } from '@/lib/export/types';
import type { IdMappingState } from './types';

const moduleLogger = logger.child({ module: 'import:wardrobe-images' });

/**
 * Returns the number of picture rows created. Never throws; failures become
 * warnings and the item is left without that picture.
 */
export async function importWardrobeItemImages(
  userId: string,
  characters: readonly ExportedCharacter[],
  idMaps: IdMappingState,
  warnings: string[],
): Promise<number> {
  const repos = getRepositories();
  let created = 0;

  for (const character of characters) {
    const newCharacterId = idMaps.characters.get(character.id);
    if (!newCharacterId) continue;

    const items = (character.wardrobeItems ?? []).filter((i) => (i._imageFiles?.length ?? 0) > 0);
    if (items.length === 0) continue;

    const exportedVaultId = idMaps.characterVaultMounts.get(newCharacterId);
    const mountPointId = exportedVaultId ? idMaps.mountPoints.get(exportedVaultId) : undefined;
    if (!mountPointId) {
      moduleLogger.debug('No imported vault for character; wardrobe pictures not carried', {
        characterId: newCharacterId,
        itemCount: items.length,
      });
      continue;
    }

    for (const item of items) {
      const fileIdMap = new Map<string, string>();
      for (const image of item._imageFiles ?? []) {
        try {
          const relativePath = wardrobeItemImagePath(item.id, image.originalFilename);
          const link = await repos.docMountFileLinks.findByMountPointAndPath(mountPointId, relativePath);
          const blob = link ? await repos.docMountBlobs.findByFileId(link.fileId) : null;
          if (!link || !blob) {
            warnings.push(`Wardrobe item "${item.title}" lost a picture whose bytes were not in the bundle (${image.originalFilename}).`);
            continue;
          }

          const fileId = (await repos.files.findById(image.id)) ? randomUUID() : image.id;
          await repos.files.create(
            {
              userId,
              sha256: link.sha256,
              originalFilename: image.originalFilename,
              mimeType: blob.storedMimeType,
              size: link.fileSizeBytes,
              width: image.width ?? null,
              height: image.height ?? null,
              linkedTo: [item.id],
              source: image.source,
              category: 'IMAGE',
              generationPrompt: image.generationPrompt ?? null,
              generationModel: image.generationModel ?? null,
              generationRevisedPrompt: image.generationRevisedPrompt ?? null,
              description: image.description ?? null,
              tags: [item.id],
              storageKey: buildMountBlobStorageKey(mountPointId, blob.id),
              projectId: null,
              folderPath: null,
            },
            { id: fileId, createdAt: image.createdAt },
          );
          fileIdMap.set(image.id, fileId);
          created++;
        } catch (error) {
          warnings.push(
            `Failed to import a picture of wardrobe item "${item.title}": ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Point the item at its own copy of its current picture — or at none,
      // when that picture did not come along.
      const exportedCurrent = item.imageFileId ?? null;
      const current = exportedCurrent ? fileIdMap.get(exportedCurrent) ?? null : null;
      if (current !== exportedCurrent) {
        try {
          await repos.wardrobe.update(item.id, { imageFileId: current }, newCharacterId);
        } catch (error) {
          warnings.push(
            `Failed to repoint the picture of wardrobe item "${item.title}": ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  if (created > 0) {
    moduleLogger.info('Imported wardrobe item pictures', { count: created });
  }
  return created;
}
