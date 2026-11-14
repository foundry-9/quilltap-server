/**
 * Character Vault Provisioning
 *
 * Shared helper for creating a database-backed character document store
 * ("vault") for a character and linking it to the character record.
 *
 * Used by both the startup backfill and the character-create API handlers
 * so that every character ends up with a vault whose id is persisted in
 * `characters.characterDocumentMountPointId`.
 *
 * `ensureCharacterVault()` is idempotent: a character that already carries
 * `characterDocumentMountPointId` is returned unchanged.
 *
 * @module mount-index/character-vault
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { scaffoldCharacterMount } from '@/lib/characters/vault/scaffold';
import { CHARACTER_VAULT_KEYSTONES } from '@/lib/characters/vault/layout';
import {
  ensureOfficialStore,
  type AdoptableStore,
  type EnsureOfficialStoreConfig,
} from '@/lib/mount-index/ensure-official-store';
import { serializeFrontmatter } from '@/lib/doc-edit/markdown-parser';
import type { Character } from '@/lib/schemas/character.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { normalizePronounGuidance } from '@/lib/wardrobe/pronoun-guidance';

export const CHARACTER_WARDROBE_FOLDER = 'Wardrobe';

/** Every tier's Inventory objects live under `Inventory/` (rules in `lib/inventory/folders.ts`). */
export { INVENTORY_FOLDER as CHARACTER_INVENTORY_FOLDER } from '@/lib/inventory/folders';

/**
 * Optional per-tier dressing-instructions file living at the root of a
 * `Wardrobe/` folder. Never a garment: every enumeration of Wardrobe items
 * must skip it, and the wardrobe projection sweep must preserve it.
 */
export const WARDROBE_INSTRUCTIONS_FILENAME = 'instructions.md';
export const WARDROBE_INSTRUCTIONS_PATH = `${CHARACTER_WARDROBE_FOLDER}/${WARDROBE_INSTRUCTIONS_FILENAME}`;

/** Case-insensitive match for the dressing-instructions file name. */
export function isWardrobeInstructionsFileName(fileName: string): boolean {
  return fileName.toLowerCase() === WARDROBE_INSTRUCTIONS_FILENAME;
}

const logger = createServiceLogger('MountIndex:CharacterVault');

export interface EnsureCharacterVaultResult {
  mountPointId: string;
  /** True if this call created the vault; false if the character already had one (or we adopted an existing one). */
  created: boolean;
  /** True if we adopted a pre-existing populated same-name vault rather than creating one. */
  adopted?: boolean;
}

/** True if the given mount point holds every file a populated vault must have. */
async function vaultHasRequiredFiles(mountPointId: string): Promise<boolean> {
  const repos = getRepositories();
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
  const present = new Set(links.map((l) => l.relativePath.toLowerCase()));
  return CHARACTER_VAULT_KEYSTONES.every((f) => present.has(f.toLowerCase()));
}

/**
 * Write `characterDocumentMountPointId` onto the character row and CONFIRM it
 * stuck by re-reading the raw row.
 *
 * The write goes through `repos.characters.update`, which can return without
 * persisting if the main DB is unwritable at that instant — most notably while
 * a cloud-synced DB file is still materializing (the partial-download window
 * that yields "file is not a database"). When that happened during the 4.6
 * character cutover, the vault content (a separate mount-index DB) landed fine
 * but the link write silently vanished, and the migration dropped the legacy
 * content columns anyway — leaving every character hollow. Verifying here turns
 * that silent "linked but not linked" state into a loud throw the caller can
 * block on instead of destroying columns out from under good vault content.
 */
async function linkCharacterToVault(characterId: string, mountPointId: string): Promise<void> {
  const repos = getRepositories();
  await repos.characters.update(characterId, { characterDocumentMountPointId: mountPointId });
  const reread = await repos.characters.findByIdRaw(characterId);
  if (!reread || reread.characterDocumentMountPointId !== mountPointId) {
    throw new Error(
      `Failed to persist characterDocumentMountPointId for ${characterId}: wrote ` +
        `${mountPointId} but re-read ${reread?.characterDocumentMountPointId ?? 'null'}. ` +
        `The character row write did not stick (database mid-materialization?).`,
    );
  }
}

/**
 * The vault mount-point ids belonging to **archived** characters.
 *
 * An archived character is a tombstone: its row survives, its vault is pruned
 * but still enabled and still enumerable by `docMountPoints.findEnabled()`.
 * Operator surfaces that walk every store (the global search bar's Documents
 * chip) subtract this set, so a tombstone's leftovers never become a click
 * target that leads back to an edit path the archive guards exist to prevent.
 *
 * Reads the raw character rows deliberately: the overlay read path mounts each
 * character's vault, which is precisely what a pruned vault can't serve, and
 * all we need is the `archivedAt` / `characterDocumentMountPointId` columns.
 */
export async function getArchivedCharacterVaultMountPointIds(): Promise<string[]> {
  const characters = await getRepositories().characters.findAllRaw();
  const ids = characters
    .filter((c) => c.archivedAt && c.characterDocumentMountPointId)
    .map((c) => c.characterDocumentMountPointId as string);
  logger.debug('Collected archived character vault mount points', {
    archivedWithVault: ids.length,
    charactersScanned: characters.length,
  });
  return ids;
}

/**
 * Ensure the given character has a linked database-backed character vault.
 * Creates, scaffolds and links if missing. Idempotent.
 *
 * **Never projects content.** A vault created here holds the scaffold alone —
 * `properties.json` and `metadata.json` at their defaults and blank markdown —
 * because the caller usually holds a raw row, and a raw row has no content to
 * project: writing it would lay `''` over files that look authored (#148).
 * The create path, which does hold content in memory, provisions through
 * `provisionCharacterVaultWithContent` instead.
 *
 * If the character has no link but a populated same-name vault already exists
 * (e.g. a prior run created and populated the vault but its link write was lost
 * mid cloud-materialization), that vault is ADOPTED rather than duplicated —
 * critical post-cutover, where the legacy content columns are gone, so creating
 * a fresh vault here would orphan the good one. A vault another character is
 * already linked to is never adopted. `adopt: false` (a brand-new character)
 * skips adoption entirely.
 */
export async function ensureCharacterVault(
  character: Pick<Character, 'id' | 'name' | 'characterDocumentMountPointId'>,
  opts: { adopt?: boolean } = {},
): Promise<EnsureCharacterVaultResult> {
  const result = await ensureOfficialStore(characterVaultStoreConfig(character, opts), character.id, character.name);
  if (!result) {
    // The config reads the caller's row, never the database, so this cannot
    // happen; keep the type honest.
    throw new Error(`ensureCharacterVault: no row for character ${character.id}`);
  }
  if (result.created) {
    logger.info('Character vault created, scaffolded, and linked', {
      characterId: character.id,
      mountPointId: result.mountPointId,
    });
  } else if (result.adopted) {
    logger.warn('Adopted an existing populated character vault for an unlinked character', {
      characterId: character.id,
      mountPointId: result.mountPointId,
    });
  }
  return result;
}

/** A character's vault name before collision suffixing. */
function vaultNameFor(name: string): string {
  return `${name} Character Vault`;
}

/**
 * The character vault's binding of the official-store core
 * (`ensure-official-store.ts`). It differs from a project's in four ways:
 * the pointer is read from the caller's row (a restore re-provisioning a
 * vault that failed to arrive passes a null pointer on purpose), an existing
 * pointer is trusted rather than healed, adoption is by name (a populated
 * same-name vault no other character owns — recovering a link write lost
 * mid cloud materialisation, bug 185), and a fresh vault is scaffolded.
 */
function characterVaultStoreConfig(
  character: Pick<Character, 'id' | 'name' | 'characterDocumentMountPointId'>,
  opts: { adopt?: boolean },
): EnsureOfficialStoreConfig {
  return {
    entityLabel: 'character',
    entityLabelCapitalized: 'Character',
    entityIdLogKey: 'characterId',
    storeNameFor: vaultNameFor,
    storeShape: { storeType: 'character', includePatterns: ['*.md', '*.txt', '*.pdf', '*.docx'] },
    findEntityRaw: async () => ({ officialMountPointId: character.characterDocumentMountPointId ?? null }),
    stalePointer: 'trust',
    findAdoptable: async () => (opts.adopt === false ? null : findAdoptableVault(character)),
    setOfficialMountPointId: linkCharacterToVault,
    afterCreate: scaffoldCharacterMount,
  };
}

/**
 * A populated same-name character vault no other character is linked to, or
 * null. Two candidates is ambiguous: neither is adopted (logged loudly) and a
 * fresh vault is created, leaving them for an operator.
 */
async function findAdoptableVault(
  character: Pick<Character, 'id' | 'name'>,
): Promise<AdoptableStore | null> {
  const repos = getRepositories();
  const vaultName = vaultNameFor(character.name);
  const sameName = (await repos.docMountPoints.findByName(vaultName)).filter((mp) => mp.storeType === 'character');
  const populated: AdoptableStore[] = [];
  for (const mp of sameName) {
    // A namesake's live vault is theirs, not an orphan to recover.
    const owner = await repos.characters.findByStorePointerRaw(mp.id);
    if (owner && owner.id !== character.id) {
      logger.debug('Same-name vault belongs to another character; not adopting', {
        characterId: character.id,
        mountPointId: mp.id,
        ownerId: owner.id,
      });
      continue;
    }
    if (await vaultHasRequiredFiles(mp.id)) populated.push({ id: mp.id, name: mp.name });
  }
  if (populated.length === 1) return populated[0];
  if (populated.length > 1) {
    logger.error('Multiple populated same-name character vaults; cannot auto-adopt, creating fresh', {
      characterId: character.id,
      name: vaultName,
      candidateMountPointIds: populated.map((p) => p.id),
    });
  }
  return null;
}

// The sanitiser lives in a client-safe module so the wardrobe's folder rules
// (`lib/wardrobe/folders.ts`) can share it; re-exported here for its callers.
export { sanitizeFileName } from '@/lib/mount-index/sanitize-file-name';

/**
 * Kebab-case slug derived from a wardrobe item's title. Used as the in-vault
 * identity for component references — `componentItems: [pearl-earrings, …]`
 * is friendlier to read and edit than a UUID. Two items whose titles slugify
 * to the same string will collide; the read overlay handles that by warning
 * and only registering the first, and the writer falls back to UUID for the
 * losers.
 */
export function slugifyWardrobeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Build a `{ itemId → slug }` map from a list of wardrobe items, and let
 * `buildWardrobeItemFile` translate `componentItemIds` UUIDs to slugs without
 * a separate pass.
 *
 * A slug borne by MORE THAN ONE item in the list is assigned to nobody — every
 * reference to any of the colliders is written as a UUID instead. A slug is
 * only an alias for "the one item with this title"; when two items share the
 * title, writer array order and the reader's filename-sorted order can crown
 * different winners, silently rewiring a composite's components on the next
 * read (a moved outfit pointing at a same-titled stranger instead of the piece
 * that travelled with it). The UUID fallback is exact in both directions.
 */
export function buildSlugByItemIdMap(
  items: readonly WardrobeItem[],
): Map<string, string> {
  const slugCounts = new Map<string, number>();
  for (const item of items) {
    const slug = slugifyWardrobeTitle(item.title);
    if (slug.length === 0) continue;
    slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
  }
  const slugByItemId = new Map<string, string>();
  for (const item of items) {
    const slug = slugifyWardrobeTitle(item.title);
    if (slug.length === 0 || slugCounts.get(slug) !== 1) continue;
    slugByItemId.set(item.id, slug);
  }
  return slugByItemId;
}

export function buildWardrobeItemFile(
  item: WardrobeItem,
  slugByItemId: ReadonlyMap<string, string>,
): string {
  const data: Record<string, unknown> = {
    id: item.id,
    title: item.title,
    types: item.types,
  };
  if (item.componentItemIds && item.componentItemIds.length > 0) {
    // Slug if we have one, UUID fallback for collisions or unknown items.
    data.componentItems = item.componentItemIds.map((id) => slugByItemId.get(id) ?? id);
  }
  if (item.appropriateness != null && item.appropriateness !== '') {
    data.appropriateness = item.appropriateness;
  }
  if (item.imagePrompt != null && item.imagePrompt !== '') {
    data.imagePrompt = item.imagePrompt;
  }
  if (item.isDefault) {
    data.default = true;
  }
  if (item.replace) {
    data.replace = true;
  }
  const pronounGuidance = normalizePronounGuidance(item.pronounGuidance);
  if (pronounGuidance.length > 0) {
    data.pronounGuidance = pronounGuidance;
  }
  if (item.archivedAt) {
    data.archived = true;
    data.archivedAt = item.archivedAt;
  }
  if (item.migratedFromClothingRecordId) {
    data.migratedFromClothingRecordId = item.migratedFromClothingRecordId;
  }
  if (item.imageFileId) {
    data.imageFileId = item.imageFileId;
  }
  data.createdAt = item.createdAt;
  data.updatedAt = item.updatedAt;

  const body = item.description ?? '';
  return `${serializeFrontmatter(data)}\n${body}`;
}
