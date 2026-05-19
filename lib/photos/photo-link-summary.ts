/**
 * Photo link summary — reverse-index from an image's sha256 to every
 * `doc_mount_file_links` row that hard-links those bytes.
 *
 * An image is "hard-linkable" when it has been written into the mount-index
 * (kept into a character album, written to the Quilltap Uploads mount as a
 * chat attachment, etc.). All callers of the bridges go through
 * `linkBlobContent`, which dedupes by sha256, so any two writes of the same
 * image share a single `doc_mount_files` row and the link table tells us
 * everywhere it surfaces.
 *
 * The chat GET resolver attaches the result to each image in a message so
 * the UI can render link counts and a "linked by" list. Phase 1's
 * `keep_image` markdown carries the saver's identity in YAML frontmatter,
 * and that's the primary source of "linkedBy" — for non-kept links
 * (chat-upload, project store, avatars) we fall back to the mount point's
 * own name + storeType.
 *
 * @module photos/photo-link-summary
 */

import { getRepositories } from '@/lib/database/repositories';
import { parseKeptImageFrontmatter } from './keep-image-markdown';
import { isPhotosRelativePath } from './photos-paths';
import { logger } from '@/lib/logger';

export interface PhotoLinker {
  /** doc_mount_file_links.id — pass to attach_image / user_attach_image. */
  linkId: string;
  mountPointId: string;
  mountPointName: string;
  /** 'character' for vault photos; 'documents' for everything else (user-uploads, project, lantern). */
  mountStoreType: 'character' | 'documents';
  relativePath: string;
  /** True when the link lives in a vault's `photos/` folder (character album or user gallery). */
  isPhotoAlbum: boolean;
  /** ISO timestamp the link row was created. */
  linkedAt: string;
  /**
   * Display name of whoever owns this link, when we can determine it:
   *  - `linkedBy` from kept-image frontmatter (the character who saved it)
   *  - `null` for chat uploads / avatars / lantern bgs / project files
   * UI can fall back to `mountPointName` when this is null.
   */
  linkedBy: string | null;
  /** Identity id matching `linkedBy` (characterId for kept images; null otherwise). */
  linkedById: string | null;
  /** Optional caption from the kept-image markdown. */
  caption: string | null;
  /** Freeform retrieval tags from the kept-image markdown. */
  tags: string[];
}

export interface PhotoLinkSummary {
  /** Number of `doc_mount_file_links` rows referencing the image bytes. */
  count: number;
  linkers: PhotoLinker[];
}

const EMPTY_SUMMARY: PhotoLinkSummary = { count: 0, linkers: [] };

/**
 * Resolve every mount-index hard link for an image by its content hash.
 *
 * Returns `{ count: 0, linkers: [] }` when no `doc_mount_files` row matches
 * the sha256 (the image has never been written to the mount-index).
 */
export async function getPhotoLinkSummaryBySha256(
  sha256: string,
  repos: ReturnType<typeof getRepositories> = getRepositories()
): Promise<PhotoLinkSummary> {
  if (!sha256) return EMPTY_SUMMARY;

  try {
    const file = await repos.docMountFiles.findBySha256(sha256);
    if (!file) return EMPTY_SUMMARY;

    const links = await repos.docMountFileLinks.findByFileId(file.id);
    if (links.length === 0) return EMPTY_SUMMARY;

    const mountPointCache = new Map<string, { name: string; storeType: 'character' | 'documents' }>();

    const linkers: PhotoLinker[] = [];
    for (const link of links) {
      let mp = mountPointCache.get(link.mountPointId);
      if (!mp) {
        const row = await repos.docMountPoints.findById(link.mountPointId);
        if (!row) continue;
        mp = { name: row.name, storeType: row.storeType };
        mountPointCache.set(link.mountPointId, mp);
      }

      const frontmatter = parseKeptImageFrontmatter(link.extractedText ?? null);

      linkers.push({
        linkId: link.id,
        mountPointId: link.mountPointId,
        mountPointName: mp.name,
        mountStoreType: mp.storeType,
        relativePath: link.relativePath,
        isPhotoAlbum: isPhotosRelativePath(link.relativePath),
        linkedAt: link.createdAt,
        linkedBy: frontmatter.linkedBy,
        linkedById: frontmatter.linkedById,
        caption: frontmatter.caption,
        tags: frontmatter.tags,
      });
    }

    return { count: linkers.length, linkers };
  } catch (error) {
    logger.warn('[photo-link-summary] Failed to resolve link summary', {
      sha256,
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_SUMMARY;
  }
}

/**
 * Convenience wrapper: resolve link summary for an image-v2 FileEntry id.
 * Returns the empty summary if the file id is unknown.
 */
export async function getPhotoLinkSummaryByFileId(
  fileId: string,
  repos: ReturnType<typeof getRepositories> = getRepositories()
): Promise<PhotoLinkSummary> {
  if (!fileId) return EMPTY_SUMMARY;
  const entry = await repos.files.findById(fileId);
  if (!entry?.sha256) return EMPTY_SUMMARY;
  return getPhotoLinkSummaryBySha256(entry.sha256, repos);
}
