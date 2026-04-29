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

import crypto from 'node:crypto';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { scaffoldCharacterMount } from '@/lib/mount-index/character-scaffold';
import { serializeFrontmatter } from '@/lib/doc-edit/markdown-parser';
import type {
  Character,
  PhysicalDescription,
  CharacterSystemPrompt,
  CharacterScenario,
  ClothingRecord,
} from '@/lib/schemas/character.types';
import type { WardrobeItem, OutfitPreset } from '@/lib/schemas/wardrobe.types';

export const CHARACTER_WARDROBE_FOLDER = 'Wardrobe';
export const CHARACTER_OUTFITS_FOLDER = 'Outfits';

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
    logger.debug('Character already linked to vault — nothing to do', {
      characterId: character.id,
      mountPointId: character.characterDocumentMountPointId,
    });
    return { mountPointId: character.characterDocumentMountPointId, created: false };
  }

  const repos = getRepositories();
  const vaultName = `${character.name} Character Vault`;

  logger.debug('Creating character vault', {
    characterId: character.id,
    name: character.name,
    vaultName,
  });

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

  logger.debug('Character vault mount point created', {
    characterId: character.id,
    mountPointId: mountPoint.id,
  });

  await scaffoldCharacterMount(mountPoint.id);
  await populateVaultWithCharacterData(mountPoint.id, character);

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

async function populateVaultWithCharacterData(
  mountPointId: string,
  character: Character,
): Promise<void> {
  const repos = getRepositories();

  await writeDatabaseDocument(mountPointId, 'identity.md', character.identity ?? '');
  await writeDatabaseDocument(mountPointId, 'description.md', character.description ?? '');
  await writeDatabaseDocument(mountPointId, 'personality.md', character.personality ?? '');

  const primaryPhysical = (character.physicalDescriptions ?? [])[0];
  await writeDatabaseDocument(
    mountPointId,
    'physical-description.md',
    primaryPhysical?.fullDescription ?? '',
  );
  await writeDatabaseDocument(
    mountPointId,
    'physical-prompts.json',
    renderPhysicalPromptsJson(primaryPhysical),
  );

  await writeDatabaseDocument(
    mountPointId,
    'example-dialogues.md',
    character.exampleDialogues ?? '',
  );

  await writeDatabaseDocument(
    mountPointId,
    'properties.json',
    JSON.stringify(
      {
        pronouns: character.pronouns ?? null,
        aliases: character.aliases ?? [],
        title: character.title ?? '',
        firstMessage: character.firstMessage ?? '',
        talkativeness: character.talkativeness ?? 0.5,
      },
      null,
      2,
    ),
  );

  // Raw reads so the populator writes DB values to the vault, never the
  // overlaid (vault-sourced) values it would otherwise see.
  const wardrobeItems = await repos.wardrobe.findByCharacterIdRaw(character.id);
  const outfitPresets = await repos.outfitPresets.findByCharacterIdRaw(character.id);
  const migratedClothingItems = migrateClothingRecordsToItems(
    character.id,
    character.clothingRecords ?? [],
  );
  const allItems: WardrobeItem[] = [...wardrobeItems, ...migratedClothingItems];
  const slugByItemId = buildSlugByItemIdMap(allItems);

  await writeNamedArrayIntoFolder(
    mountPointId,
    CHARACTER_WARDROBE_FOLDER,
    allItems,
    (item) => ({
      fileName: `${sanitizeFileName(item.title)}.md`,
      content: buildWardrobeItemFile(item),
    }),
  );

  await writeNamedArrayIntoFolder(
    mountPointId,
    CHARACTER_OUTFITS_FOLDER,
    outfitPresets,
    (preset) => ({
      fileName: `${sanitizeFileName(preset.name)}.md`,
      content: buildOutfitPresetFile(preset, slugByItemId),
    }),
  );

  await writeNamedArrayIntoFolder(
    mountPointId,
    'Prompts',
    character.systemPrompts ?? [],
    (p: CharacterSystemPrompt) => ({
      fileName: `${sanitizeFileName(p.name)}.md`,
      content: buildSystemPromptFile(p),
    }),
  );

  await writeNamedArrayIntoFolder(
    mountPointId,
    'Scenarios',
    character.scenarios ?? [],
    (s: CharacterScenario) => ({
      fileName: `${sanitizeFileName(s.title)}.md`,
      content: buildScenarioFile(s),
    }),
  );
}

export function renderPhysicalPromptsJson(primary: PhysicalDescription | undefined): string {
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

function migrateClothingRecordsToItems(
  characterId: string,
  records: ClothingRecord[],
): WardrobeItem[] {
  return records.map((r) => ({
    id: crypto.randomUUID(),
    characterId,
    title: r.name,
    description: r.description ?? null,
    types: ['accessories' as const],
    appropriateness: r.usageContext ?? null,
    isDefault: false,
    migratedFromClothingRecordId: r.id,
    archivedAt: null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

async function writeNamedArrayIntoFolder<T>(
  mountPointId: string,
  folder: string,
  items: T[],
  mapper: (item: T) => { fileName: string; content: string },
): Promise<void> {
  if (items.length === 0) return;
  await ensureFolderPath(mountPointId, folder);
  const seen = new Set<string>();
  for (const item of items) {
    const mapped = mapper(item);
    let candidate = mapped.fileName;
    let n = 1;
    while (seen.has(candidate.toLowerCase())) {
      const dot = mapped.fileName.lastIndexOf('.');
      const base = dot >= 0 ? mapped.fileName.slice(0, dot) : mapped.fileName;
      const ext = dot >= 0 ? mapped.fileName.slice(dot) : '';
      candidate = `${base}-${n}${ext}`;
      n++;
    }
    seen.add(candidate.toLowerCase());
    await writeDatabaseDocument(mountPointId, `${folder}/${candidate}`, mapped.content);
  }
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
 * identity for slot references in outfit preset files — `top: blue-tweed-jacket`
 * is friendlier to read and edit than a UUID. Two items whose titles slugify
 * to the same string will collide; the read overlay handles that by warning
 * and only registering the first.
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
 * the read-time slug map and lets `buildOutfitPresetFile` translate slot UUIDs
 * to slugs without a separate pass.
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

export function buildWardrobeItemFile(item: WardrobeItem): string {
  const data: Record<string, unknown> = {
    id: item.id,
    title: item.title,
    types: item.types,
  };
  if (item.appropriateness != null && item.appropriateness !== '') {
    data.appropriateness = item.appropriateness;
  }
  if (item.isDefault) {
    data.default = true;
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

export function buildOutfitPresetFile(
  preset: OutfitPreset,
  slugByItemId: ReadonlyMap<string, string>,
): string {
  const slots: Record<string, string | null> = {
    top: slotValueForFile(preset.slots.top, slugByItemId),
    bottom: slotValueForFile(preset.slots.bottom, slugByItemId),
    footwear: slotValueForFile(preset.slots.footwear, slugByItemId),
    accessories: slotValueForFile(preset.slots.accessories, slugByItemId),
  };
  const data: Record<string, unknown> = {
    id: preset.id,
    name: preset.name,
    slots,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
  };

  const body = preset.description ?? '';
  return `${serializeFrontmatter(data)}\n${body}`;
}

function slotValueForFile(
  itemId: string | null,
  slugByItemId: ReadonlyMap<string, string>,
): string | null {
  if (itemId === null) return null;
  return slugByItemId.get(itemId) ?? itemId;
}
