/**
 * Avatar rolls service — the Aurora gallery's window onto the avatar
 * configuration cache.
 *
 * An **avatar roll** is one plate the house has already developed for a
 * character: the image the wardrobe avatar job stored for a particular
 * configuration of outfit, provider, profile and model. The cache
 * (`lib/wardrobe/avatar-cache.ts`) looks those up by key so a character
 * putting the same coat back on costs nothing; this module looks them up by
 * *character*, so the operator can see the collection, promote a plate to the
 * character's portrait, copy one into the photo album, or throw one away.
 *
 * **A roll is a `files` row carrying a non-null `generationKey`.** That column
 * exists for exactly one purpose — the avatar cache writes it, and the
 * `collapse-duplicate-avatar-rolls-v1` migration backfilled it onto every
 * pre-cache portrait — so "keyed and tagged with this character" is the whole
 * definition, with no path matching to drift. It has to be that way: rolls
 * predating the vault change live at `character-avatars/…` in a project mount,
 * newer ones at `images/history/…` in the character's own vault, and a roll
 * that has been copied into the album has a second link under `photos/`.
 *
 * Deleting a roll never takes an album photo with it. `deleteMountBlob` drops
 * *every* link to a blob's file, which is the wrong verb here — a roll the
 * operator has already kept is two links over one set of bytes, and only the
 * roll's own link is ours. See {@link deleteAvatarRoll}.
 *
 * @module photos/avatar-rolls-service
 */

import { logger } from '@/lib/logger';
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge';
import { parseMountBlobStorageKey } from '@/lib/file-storage/project-store-bridge';
import { invalidateMountPoint } from '@/lib/mount-index/mount-chunk-cache';
import type { getRepositories } from '@/lib/database/repositories';
import type { FileEntry } from '@/lib/schemas/types';
import { getPhotoLinkSummaryBySha256, type PhotoLinker } from './photo-link-summary';
import { buildMountFileUrl, buildLegacyFileUrl } from './resolve-character-avatar';
import { saveFileToCharacterGallery } from './character-gallery-service';

/** One developed plate, as the gallery renders it. */
export interface AvatarRollEntry {
  /** `files.id` — the canonical id for a roll, and what a chat binds to. */
  fileId: string;
  /**
   * The mount-index link holding the roll's own bytes (`character-avatars/…`
   * or `images/history/…`), when one survives. Null for a roll whose only
   * remaining link is the album copy, or whose bytes have gone.
   */
  rollLinkId: string | null;
  /**
   * The link in *this* character's vault `photos/` folder, when the roll has
   * been copied into the album. Non-null means "already kept".
   */
  albumLinkId: string | null;
  fileName: string;
  /** URL the UI drops straight into `<img src>`. */
  url: string;
  mimeType: string | null;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  generationPrompt: string | null;
  generationModel: string | null;
  sha256: string;
  /** True when the character's portrait (`defaultImageId`) points at this roll. */
  isPortrait: boolean;
  /** How many of the character's chats are currently displaying this plate. */
  usedInChatCount: number;
}

export interface ListAvatarRollsInput {
  characterId: string;
  limit?: number;
  offset?: number;
  repos: ReturnType<typeof getRepositories>;
}

export interface ListAvatarRollsOutput {
  entries: AvatarRollEntry[];
  total: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

/**
 * Every roll the cache holds for a character — keyed `files` rows tagged with
 * the character id — newest first.
 */
export async function listAvatarRolls(
  input: ListAvatarRollsInput
): Promise<ListAvatarRollsOutput> {
  const { characterId, limit, offset, repos } = input;

  const character = await repos.characters.findById(characterId);
  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }

  const rolls = await findRollsForCharacter(characterId, repos);
  const effectiveLimit = Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const effectiveOffset = Math.max(0, offset ?? 0);
  const page = rolls.slice(effectiveOffset, effectiveOffset + effectiveLimit);

  const vault = await getCharacterVaultStore(characterId);
  // One pass over the character's chats builds the whole page's usage counts;
  // asking per roll would be one query per thumbnail.
  const chatUsage = await countChatAvatarUsage(characterId, repos);

  const entries: AvatarRollEntry[] = [];
  for (const file of page) {
    const { rollLink, albumLink } = await classifyRollLinks(
      file,
      vault?.mountPointId ?? null,
      repos
    );
    const displayLink = rollLink ?? albumLink;

    entries.push({
      fileId: file.id,
      rollLinkId: rollLink?.linkId ?? null,
      albumLinkId: albumLink?.linkId ?? null,
      fileName: file.originalFilename,
      url: displayLink
        ? buildMountFileUrl(displayLink.mountPointId, displayLink.relativePath)
        : buildLegacyFileUrl(file.id),
      mimeType: file.mimeType ?? null,
      fileSizeBytes: file.size,
      width: file.width ?? null,
      height: file.height ?? null,
      createdAt: String(file.createdAt),
      generationPrompt: file.generationPrompt ?? null,
      generationModel: file.generationModel ?? null,
      sha256: file.sha256,
      isPortrait:
        character.defaultImageId === file.id ||
        (!!albumLink && character.defaultImageId === albumLink.linkId),
      usedInChatCount: chatUsage.get(file.id) ?? 0,
    });
  }

  return {
    entries,
    total: rolls.length,
    hasMore: effectiveOffset + page.length < rolls.length,
  };
}

export interface AvatarRollActionInput {
  characterId: string;
  /** `files.id` of the roll. */
  fileId: string;
  repos: ReturnType<typeof getRepositories>;
}

/**
 * Copy a roll into the character's photo album, hard-linking the existing
 * bytes rather than re-encoding them. A roll already in the album is a no-op
 * that reports the link it already has, so the button is idempotent.
 */
export async function saveAvatarRollToAlbum(
  input: AvatarRollActionInput
): Promise<{ linkId: string; alreadyInAlbum: boolean }> {
  const { characterId, fileId, repos } = input;
  const file = await requireRoll(characterId, fileId, repos);

  const vault = await getCharacterVaultStore(characterId);
  if (!vault) {
    throw new Error(`Character ${characterId} has no linked database-backed vault`);
  }

  const { albumLink } = await classifyRollLinks(file, vault.mountPointId, repos);
  if (albumLink) {
    return { linkId: albumLink.linkId, alreadyInAlbum: true };
  }

  const saved = await saveFileToCharacterGallery({ characterId, fileId, repos });
  logger.info('[AvatarRolls] Roll copied into the photo album', {
    context: 'photos.avatar-rolls',
    characterId,
    fileId,
    linkId: saved.linkId,
  });
  return { linkId: saved.linkId, alreadyInAlbum: false };
}

/**
 * Make a roll the character's portrait.
 *
 * The roll is copied into the album first, and `defaultImageId` is pointed at
 * the *album* link rather than the `files` row. Post-Phase-3 every avatar
 * pointer is a `doc_mount_file_links.id`; `resolveCharacterAvatar` still
 * tolerates a legacy `files.id` for un-migrated imports, but minting a fresh
 * one here would push the album's own delete path (which scrubs pointers by
 * link id) back out of step.
 */
export async function setAvatarRollAsPortrait(
  input: AvatarRollActionInput
): Promise<{ linkId: string; addedToAlbum: boolean }> {
  const { characterId, fileId, repos } = input;
  const { linkId, alreadyInAlbum } = await saveAvatarRollToAlbum(input);

  await repos.characters.update(characterId, { defaultImageId: linkId });

  logger.info('[AvatarRolls] Roll promoted to the character portrait', {
    context: 'photos.avatar-rolls',
    characterId,
    fileId,
    linkId,
    addedToAlbum: !alreadyInAlbum,
  });

  return { linkId, addedToAlbum: !alreadyInAlbum };
}

export interface DeleteAvatarRollOutput {
  deleted: boolean;
  /** True when the bytes went with the roll (no album copy was holding them). */
  blobRemoved: boolean;
  /** Chats whose `characterAvatars` entry was pointing at the deleted roll. */
  chatsScrubbed: number;
  /** True when the album still holds a copy of these bytes. */
  keptInAlbum: boolean;
}

/**
 * Throw a roll away.
 *
 * Order matters: every pointer at the roll is scrubbed *before* the bytes go,
 * so nothing is left naming a file that has stopped existing —
 * `chats.characterAvatars` (where the avatar job binds a roll), the
 * character's `avatarOverrides`, and `defaultImageId`. Only then is the
 * roll's own mount link dropped with GC, which reclaims the blob when it was
 * the last reference.
 *
 * An album copy is never a casualty. If the operator kept this plate in the
 * character's `photos/` folder, that link stays and the bytes stay with it;
 * only the cache row and the roll's own link go. A roll whose *only* link is
 * the album copy therefore loses its `files` row and nothing else — which is
 * exactly right, since the picture is still in the album where they put it.
 *
 * The cache treats a keyed row whose blob is gone as a miss, so the next time
 * this configuration comes round the house simply draws it again.
 */
export async function deleteAvatarRoll(
  input: AvatarRollActionInput
): Promise<DeleteAvatarRollOutput> {
  const { characterId, fileId, repos } = input;

  const file = await findRoll(characterId, fileId, repos);
  if (!file) {
    return { deleted: false, blobRemoved: false, chatsScrubbed: 0, keptInAlbum: false };
  }

  const character = await repos.characters.findById(characterId);
  const vault = await getCharacterVaultStore(characterId);
  const { rollLink, albumLink } = await classifyRollLinks(
    file,
    vault?.mountPointId ?? null,
    repos
  );

  // 1. Chats displaying this plate.
  const chatsScrubbed = await scrubChatAvatars(characterId, fileId, repos);

  // 2. The character's own pointers. `defaultImageId` can name either shape:
  //    the roll's `files` row (a legacy pointer) or the album link we are
  //    deliberately leaving in place — only the former is cleared.
  if (character) {
    const updates: { defaultImageId?: string | null; avatarOverrides?: typeof character.avatarOverrides } = {};
    if (character.defaultImageId === fileId) {
      updates.defaultImageId = null;
    }
    const remainingOverrides = (character.avatarOverrides ?? []).filter(o => o.imageId !== fileId);
    if (remainingOverrides.length !== (character.avatarOverrides ?? []).length) {
      updates.avatarOverrides = remainingOverrides;
    }
    if (Object.keys(updates).length > 0) {
      await repos.characters.update(characterId, updates);
    }
  }

  // 3. The roll's own link — never the album's.
  let blobRemoved = false;
  if (rollLink) {
    const result = await repos.docMountFileLinks.deleteWithGC(rollLink.linkId);
    blobRemoved = result.fileGC;
    invalidateMountPoint(rollLink.mountPointId);
    repos.docMountPoints.refreshStats(rollLink.mountPointId).catch(() => { /* best-effort */ });
  }

  // 4. The cache row itself.
  await repos.files.delete(fileId);

  logger.info('[AvatarRolls] Roll deleted', {
    context: 'photos.avatar-rolls',
    characterId,
    fileId,
    rollLinkId: rollLink?.linkId ?? null,
    keptInAlbum: !!albumLink,
    blobRemoved,
    chatsScrubbed,
  });

  return { deleted: true, blobRemoved, chatsScrubbed, keptInAlbum: !!albumLink };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Keyed `files` rows tagged with this character, newest first. `generationKey`
 * is written by the avatar cache and by nothing else, so it is the membership
 * test; the tag scopes it to one character.
 */
async function findRollsForCharacter(
  characterId: string,
  repos: ReturnType<typeof getRepositories>
): Promise<FileEntry[]> {
  const tagged = await repos.files.findByTag(characterId);
  return tagged
    .filter(isRoll)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function isRoll(file: FileEntry): boolean {
  return !!file.generationKey && file.category === 'IMAGE';
}

async function findRoll(
  characterId: string,
  fileId: string,
  repos: ReturnType<typeof getRepositories>
): Promise<FileEntry | null> {
  const file = await repos.files.findById(fileId);
  if (!file || !isRoll(file) || !file.tags?.includes(characterId)) {
    return null;
  }
  return file;
}

async function requireRoll(
  characterId: string,
  fileId: string,
  repos: ReturnType<typeof getRepositories>
): Promise<FileEntry> {
  const file = await findRoll(characterId, fileId, repos);
  if (!file) {
    throw new Error(`Avatar roll not found: ${fileId}`);
  }
  return file;
}

/**
 * Split a roll's mount-index links into "the roll's own" and "the album copy".
 *
 * The roll's own link is the one in the mount point its `storageKey` names —
 * a project store's `character-avatars/` for pre-vault rolls, the character's
 * own vault `images/history/` since — and never a `photos/` path, because a
 * roll that has been kept has a second link there over the same bytes.
 */
async function classifyRollLinks(
  file: FileEntry,
  vaultMountPointId: string | null,
  repos: ReturnType<typeof getRepositories>
): Promise<{ rollLink: PhotoLinker | null; albumLink: PhotoLinker | null }> {
  if (!file.sha256) {
    return { rollLink: null, albumLink: null };
  }

  const summary = await getPhotoLinkSummaryBySha256(file.sha256, repos);
  const storageMountPointId = file.storageKey
    ? parseMountBlobStorageKey(file.storageKey)?.mountPointId ?? null
    : null;

  const rollLink =
    summary.linkers.find(
      l => !l.isPhotoAlbum && (!storageMountPointId || l.mountPointId === storageMountPointId)
    ) ?? null;

  const albumLink = vaultMountPointId
    ? summary.linkers.find(l => l.isPhotoAlbum && l.mountPointId === vaultMountPointId) ?? null
    : null;

  return { rollLink, albumLink };
}

/**
 * `files.id` → number of the character's chats whose `characterAvatars` entry
 * names it. One read of the character's chats answers the whole page.
 */
async function countChatAvatarUsage(
  characterId: string,
  repos: ReturnType<typeof getRepositories>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const chats = await repos.chats.findByCharacterId(characterId);
  for (const chat of chats) {
    const imageId = readBoundAvatarId(chat.characterAvatars, characterId);
    if (imageId) {
      counts.set(imageId, (counts.get(imageId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Drop every `chats.characterAvatars[characterId]` entry pointing at a roll
 * that is about to stop existing. Without this the Salon keeps rendering a
 * file id nothing backs until the next avatar job rebinds the seat.
 */
async function scrubChatAvatars(
  characterId: string,
  fileId: string,
  repos: ReturnType<typeof getRepositories>
): Promise<number> {
  const chats = await repos.chats.findByCharacterId(characterId);
  let scrubbed = 0;

  for (const chat of chats) {
    if (readBoundAvatarId(chat.characterAvatars, characterId) !== fileId) continue;

    const existing = chat.characterAvatars as Record<string, unknown>;
    const next: Record<string, unknown> = { ...existing };
    delete next[characterId];

    await repos.chats.update(chat.id, { characterAvatars: next });
    scrubbed += 1;
  }

  return scrubbed;
}

/** The `imageId` a chat's `characterAvatars` binds for one character, if any. */
function readBoundAvatarId(
  characterAvatars: unknown,
  characterId: string
): string | null {
  if (!characterAvatars || typeof characterAvatars !== 'object') return null;
  const entry = (characterAvatars as Record<string, unknown>)[characterId];
  if (!entry || typeof entry !== 'object') return null;
  const imageId = (entry as { imageId?: unknown }).imageId;
  return typeof imageId === 'string' && imageId.length > 0 ? imageId : null;
}
