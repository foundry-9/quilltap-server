/**
 * The pictures a page's collage may draw from (spec §3.1).
 *
 *   - home      — every story background on the instance;
 *   - project   — story backgrounds painted for the project's chats: filed
 *                 under the project, or linked to a chat now in it (a chat
 *                 can be moved into a project after its backdrops were
 *                 painted);
 *   - character — that character's avatar rolls.
 *
 * Every pool keeps image types only, one picture per sha256, then passes
 * through `filterForCollage`; the result is sorted by `fileId`, so a seeded
 * shuffle over it is deterministic.
 *
 * @module dynamic-backgrounds/pools
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getLanternBackgroundsStore } from '@/lib/file-storage/lantern-store-bridge';
import { parseMountBlobStorageKey } from '@/lib/file-storage/mount-blob-key';
import { isStoryBackgroundFile } from '@/lib/photos/generated-image-kind';
import { findRollsForCharacter } from '@/lib/photos/avatar-rolls-service';
import type { DynamicBackgroundsSettings } from '@/lib/schemas/settings.types';
import type { FileEntry } from '@/lib/schemas/types';
import { filterForCollage } from './eligibility';

const log = logger.child({ module: 'dynamic-backgrounds.pools' });

export type CollageScope = 'home' | 'project' | 'character';

export const COLLAGE_SCOPES: readonly CollageScope[] = ['home', 'project', 'character'];

/** One picture a collage may use. */
export interface CollageSource {
  fileId: string;
  sha256: string;
  /** Pixel size; assumed 16:9 (backdrops) or 2:3 (avatars) when not recorded. */
  width: number;
  height: number;
  /** For `fileStorageManager.downloadFile`. */
  file: FileEntry;
}

/** The project named does not exist. */
export class CollageScopeNotFoundError extends Error {
  constructor(scope: CollageScope, id: string) {
    super(`No ${scope} ${id}`);
    this.name = 'CollageScopeNotFoundError';
  }
}

type Repos = ReturnType<typeof getRepositories>;

/** Assumed sizes when a row has no dimensions; tiles are cover-cropped, so a wrong guess only crops. */
const ASSUMED_BACKDROP = { width: 1600, height: 900 };
const ASSUMED_AVATAR = { width: 800, height: 1200 };

function isImageMime(mimeType: string | null | undefined): boolean {
  return !!mimeType && mimeType.toLowerCase().startsWith('image/');
}

/**
 * Lantern-mount link paths by sha256, read once per pool. Project-less
 * backdrops live in the Lantern Backgrounds mount under `generated/`; image
 * tool pictures share that mount under `tool/`, so the mount alone does not
 * tell them apart — the link path does.
 */
async function lanternPathsBySha(repos: Repos): Promise<{ mountPointId: string | null; paths: Map<string, string[]> }> {
  const paths = new Map<string, string[]>();
  const lantern = await getLanternBackgroundsStore();
  if (!lantern) return { mountPointId: null, paths };
  const links = await repos.docMountFileLinks.findByMountPointId(lantern.mountPointId);
  for (const link of links) {
    if (!link.sha256) continue;
    const list = paths.get(link.sha256) ?? [];
    list.push(link.relativePath);
    paths.set(link.sha256, list);
  }
  return { mountPointId: lantern.mountPointId, paths };
}

/** Keep the generated, non-roll images that are story backgrounds. */
async function keepStoryBackgrounds(candidates: readonly FileEntry[], repos: Repos): Promise<FileEntry[]> {
  const generated = candidates.filter(
    (f) => f.source === 'GENERATED' && f.category === 'IMAGE' && !f.generationKey,
  );
  const needsLantern = generated.some((f) => f.folderPath !== '/story-backgrounds/');
  const lantern = needsLantern ? await lanternPathsBySha(repos) : { mountPointId: null, paths: new Map<string, string[]>() };
  return generated.filter((file) => {
    const inLantern =
      !!lantern.mountPointId &&
      parseMountBlobStorageKey(file.storageKey ?? '')?.mountPointId === lantern.mountPointId;
    const paths = inLantern ? lantern.paths.get(file.sha256) ?? [] : [];
    return isStoryBackgroundFile(file, paths);
  });
}

async function loadHomeCandidates(repos: Repos): Promise<FileEntry[]> {
  return keepStoryBackgrounds(await repos.files.findGeneratedImages(), repos);
}

async function loadProjectCandidates(projectId: string, userId: string, repos: Repos): Promise<FileEntry[]> {
  const project = await repos.projects.findById(projectId);
  if (!project) throw new CollageScopeNotFoundError('project', projectId);
  const chatIds = (await repos.chats.findAll()).filter((c) => c.projectId === projectId).map((c) => c.id);
  const [linked, filed] = await Promise.all([
    repos.files.findByLinkedToAny(chatIds),
    repos.files.findByProjectId(userId, projectId),
  ]);
  const byId = new Map<string, FileEntry>();
  for (const f of [...filed, ...linked]) byId.set(f.id, f);
  log.debug('Project collage candidates', { projectId, chats: chatIds.length, files: byId.size });
  return keepStoryBackgrounds(Array.from(byId.values()), repos);
}

async function loadCharacterCandidates(characterId: string, repos: Repos): Promise<FileEntry[]> {
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character || character.archivedAt) {
    log.debug('No character pool (missing or archived)', { characterId, archived: !!character?.archivedAt });
    return [];
  }
  return findRollsForCharacter(characterId, repos);
}

/**
 * The fit, deduplicated pool for a scope, sorted by `fileId`. Throws
 * `CollageScopeNotFoundError` for an unknown project.
 */
export async function loadCollagePool(
  target: { scope: CollageScope; id: string | null; userId: string },
  settings: Pick<DynamicBackgroundsSettings, 'allowUncensored'>,
  repos: Repos = getRepositories(),
): Promise<CollageSource[]> {
  const { scope, id, userId } = target;
  let candidates: FileEntry[];
  switch (scope) {
    case 'home':
      candidates = await loadHomeCandidates(repos);
      break;
    case 'project':
      candidates = await loadProjectCandidates(id as string, userId, repos);
      break;
    case 'character':
      candidates = await loadCharacterCandidates(id as string, repos);
      break;
  }

  const seen = new Set<string>();
  const deduped = candidates
    .filter((f) => isImageMime(f.mimeType) && !!f.sha256)
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((f) => {
      if (seen.has(f.sha256)) return false;
      seen.add(f.sha256);
      return true;
    });

  const fit = await filterForCollage(deduped, settings, repos);
  const assumed = scope === 'character' ? ASSUMED_AVATAR : ASSUMED_BACKDROP;
  const pool = fit
    .map<CollageSource>((file) => {
      const known = !!file.width && !!file.height && file.width > 0 && file.height > 0;
      return {
        fileId: file.id,
        sha256: file.sha256,
        width: known ? (file.width as number) : assumed.width,
        height: known ? (file.height as number) : assumed.height,
        file,
      };
    })
    .sort((a, b) => a.fileId.localeCompare(b.fileId));

  log.debug('Collage pool resolved', {
    scope,
    id,
    candidates: candidates.length,
    deduped: deduped.length,
    fit: pool.length,
  });
  return pool;
}

/**
 * A short fingerprint of a pool, so a cached collage is never served after
 * the pool it was drawn from has changed.
 */
export function poolFingerprint(pool: readonly CollageSource[]): string {
  let h = 2166136261;
  for (const s of pool) {
    for (let i = 0; i < s.fileId.length; i++) {
      h ^= s.fileId.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return `${pool.length}:${(h >>> 0).toString(16)}`;
}
