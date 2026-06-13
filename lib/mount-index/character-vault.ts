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
import { scaffoldCharacterMount } from '@/lib/mount-index/character-scaffold';
import { serializeFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { writeCharacterVaultManagedFields } from '@/lib/database/repositories/character-properties-overlay';
import type {
  Character,
  PhysicalDescription,
  CharacterSystemPrompt,
  CharacterScenario,
} from '@/lib/schemas/character.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

export const CHARACTER_WARDROBE_FOLDER = 'Wardrobe';

const logger = createServiceLogger('MountIndex:CharacterVault');

export interface EnsureCharacterVaultResult {
  mountPointId: string;
  /** True if this call created the vault; false if the character already had one. */
  created: boolean;
}

/**
 * Ensure the given character has a linked database-backed character vault.
 * Creates, scaffolds, populates, and links if missing. Idempotent.
 */
export async function ensureCharacterVault(
  character: Character,
): Promise<EnsureCharacterVaultResult> {
  if (character.characterDocumentMountPointId) {
    return { mountPointId: character.characterDocumentMountPointId, created: false };
  }

  const repos = getRepositories();
  const vaultName = `${character.name} Character Vault`;

  const mountPoint = await repos.docMountPoints.create({
    name: vaultName,
    basePath: '',
    mountType: 'database',
    storeType: 'character',
    includePatterns: ['*.md', '*.txt', '*.pdf', '*.docx'],
    excludePatterns: ['.git', 'node_modules', '.obsidian', '.trash'],
    enabled: true,
    lastScannedAt: null,
    scanStatus: 'idle',
    lastScanError: null,
    conversionStatus: 'idle',
    conversionError: null,
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
  });

  await scaffoldCharacterMount(mountPoint.id);

  // Project the character's content fields into the new vault. Wardrobe is not
  // projected here — it lives solely in the vault and is written through the
  // wardrobe-writes path; a brand-new vault has no wardrobe yet.
  await writeCharacterVaultManagedFields(mountPoint.id, { character });

  await repos.characters.update(character.id, {
    characterDocumentMountPointId: mountPoint.id,
  });

  logger.info('Character vault created, populated, and linked', {
    characterId: character.id,
    mountPointId: mountPoint.id,
    name: vaultName,
  });

  return { mountPointId: mountPoint.id, created: true };
}

export function renderPhysicalPromptsJson(primary: PhysicalDescription | null | undefined): string {
  return JSON.stringify(
    {
      short: primary?.shortPrompt ?? null,
      medium: primary?.mediumPrompt ?? null,
      long: primary?.longPrompt ?? null,
      complete: primary?.completePrompt ?? null,
    },
    null,
    2,
  );
}

export function buildSystemPromptFile(p: CharacterSystemPrompt): string {
  const frontmatter = p.isDefault
    ? `---\nname: ${escapeYaml(p.name)}\nisDefault: true\n---\n\n`
    : `---\nname: ${escapeYaml(p.name)}\n---\n\n`;
  return `${frontmatter}${p.content}`;
}

export function buildScenarioFile(s: CharacterScenario): string {
  return `# ${s.title}\n\n${s.content}`;
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 100) || 'untitled';
}

function escapeYaml(value: string): string {
  if (/[:#"'\n]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

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
 * Build a `{ itemId → slug }` map from a list of wardrobe items, taking the
 * first item that slugifies to each slug (skipping later collisions). Mirrors
 * the read-time slug map and lets `buildWardrobeItemFile` translate
 * `componentItemIds` UUIDs to slugs without a separate pass.
 */
export function buildSlugByItemIdMap(
  items: readonly WardrobeItem[],
): Map<string, string> {
  const slugByItemId = new Map<string, string>();
  const claimedSlugs = new Set<string>();
  for (const item of items) {
    const slug = slugifyWardrobeTitle(item.title);
    if (slug.length === 0 || claimedSlugs.has(slug)) continue;
    claimedSlugs.add(slug);
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
  if (item.archivedAt) {
    data.archived = true;
    data.archivedAt = item.archivedAt;
  }
  if (item.migratedFromClothingRecordId) {
    data.migratedFromClothingRecordId = item.migratedFromClothingRecordId;
  }
  data.createdAt = item.createdAt;
  data.updatedAt = item.updatedAt;

  const body = item.description ?? '';
  return `${serializeFrontmatter(data)}\n${body}`;
}
