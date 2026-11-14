/**
 * Character vault scaffold.
 *
 * Populates a freshly created (or freshly flipped) database-backed character
 * document store with the conventional structure: every layout file at its
 * seed (blank markdown, default settings, an empty fact sheet), the layout's
 * folders, and the side-store folders. Idempotent — existing entries are left
 * untouched, so it can be re-run when a store's storeType is flipped to
 * 'character' on an already-populated store.
 *
 * The seeds come from the layout table (`layout.ts`); nothing here spells a
 * vault file.
 *
 * Filesystem/obsidian character stores are left alone; the user is presumed
 * to be pointing at an existing character vault of their own.
 *
 * @module characters/vault/scaffold
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import {
  CHARACTER_VAULT_LAYOUT,
  CHARACTER_VAULT_LAYOUT_FOLDERS,
  CHARACTER_VAULT_SEEDS,
} from './layout';

const logger = createServiceLogger('CharacterVault:Scaffold');

/**
 * Folders a fresh vault carries beyond the layout's own: the side-stores
 * (Wardrobe), the retired Outfits folder older tooling still expects, and the
 * operator's lore / images / files shelves.
 */
const SIDE_FOLDERS = ['Wardrobe', 'Outfits', 'lore', 'images', 'files'] as const;

/** The content of a fresh, empty fact sheet. */
export const METADATA_JSON_SEED = CHARACTER_VAULT_LAYOUT.metadata.seed;

/** The content of a fresh `properties.json`: every setting at its default. */
export const PROPERTIES_JSON_SEED = CHARACTER_VAULT_LAYOUT.properties.seed;

export interface CharacterScaffoldResult {
  filesCreated: number;
  filesSkipped: number;
  foldersCreated: number;
}

/** Seed one layout file if it is absent. Returns true when it created it. */
async function seedIfAbsent(mountPointId: string, path: string, content: string): Promise<boolean> {
  const existing = await getRepositories().docMountDocuments.findByMountPointAndPath(mountPointId, path);
  if (existing) return false;
  await writeDatabaseDocument(mountPointId, path, content);
  return true;
}

/**
 * Ensure one vault carries a `metadata.json`, seeding an empty sheet if not.
 *
 * Every vault provisioned before the fact sheet existed lacks the file, and
 * since the file manager is the only editing surface, those characters have
 * nothing to open. Existence is checked directly rather than by parsing: a
 * sheet the user has fat-fingered into invalid JSON is still their sheet.
 *
 * Returns true when it created the file.
 */
export async function ensureCharacterMetadataFile(mountPointId: string): Promise<boolean> {
  return seedIfAbsent(mountPointId, CHARACTER_VAULT_LAYOUT.metadata.path, METADATA_JSON_SEED);
}

/**
 * Ensure one vault carries a `properties.json`, seeding the defaults if not.
 *
 * The only content the startup heal or the repair action may write into an
 * existing vault (with `metadata.json`, above): an ABSENT keystone is seeded,
 * a present one is never touched — not even when it fails to parse, since the
 * settings it holds live nowhere else (#148).
 *
 * Returns true when it created the file.
 */
export async function ensureCharacterPropertiesFile(mountPointId: string): Promise<boolean> {
  const created = await seedIfAbsent(mountPointId, CHARACTER_VAULT_LAYOUT.properties.path, PROPERTIES_JSON_SEED);
  if (created) logger.info('Seeded a missing properties.json with defaults', { mountPointId });
  return created;
}

/**
 * Seed whichever of the physical-description pair is absent; never overwrite.
 * The physical-files boot migration's one write. Returns the paths it created.
 */
export async function ensureCharacterPhysicalFiles(mountPointId: string): Promise<string[]> {
  const created: string[] = [];
  const entry = CHARACTER_VAULT_LAYOUT.physical;
  for (const path of entry.paths) {
    if (await seedIfAbsent(mountPointId, path, entry.seeds[path])) created.push(path);
  }
  return created;
}

/**
 * Scaffold the preset structure for a database-backed character store.
 * No-op if the mount point is not database-backed or not classified as
 * a character store. Existing files are never overwritten.
 */
export async function scaffoldCharacterMount(mountPointId: string): Promise<CharacterScaffoldResult> {
  const repos = getRepositories();
  const mountPoint = await repos.docMountPoints.findById(mountPointId);

  const result: CharacterScaffoldResult = { filesCreated: 0, filesSkipped: 0, foldersCreated: 0 };

  if (!mountPoint) {
    logger.warn('Cannot scaffold — mount point not found', { mountPointId });
    return result;
  }
  if (mountPoint.mountType !== 'database' || mountPoint.storeType !== 'character') {
    return result;
  }

  for (const folder of [...CHARACTER_VAULT_LAYOUT_FOLDERS, ...SIDE_FOLDERS]) {
    const existing = await repos.docMountFolders.findByMountPointAndPath(mountPointId, folder);
    await ensureFolderPath(mountPointId, folder);
    if (!existing) result.foldersCreated++;
  }

  for (const { path, content } of CHARACTER_VAULT_SEEDS) {
    if (await seedIfAbsent(mountPointId, path, content)) result.filesCreated++;
    else result.filesSkipped++;
  }

  logger.info('Character scaffold complete', { mountPointId, name: mountPoint.name, ...result });
  return result;
}
