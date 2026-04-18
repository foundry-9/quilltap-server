/**
 * Character Vault Backfill
 *
 * On server startup, ensures every Character has a linked database-backed
 * character document store ("vault"). For each unlinked character we:
 *   1. create a fresh database-backed mount point named "<Name> Character Vault"
 *      with storeType='character'
 *   2. call scaffoldCharacterMount() to lay down the preset structure
 *   3. overwrite the scaffolded blanks with the character's current data
 *      (identity, description, personality, physical-description,
 *      example-dialogues, properties.json, wardrobe.json), and write one
 *      file per systemPrompt into Prompts/ and per scenario into Scenarios/
 *   4. set character.characterDocumentMountPointId to the new mount point id
 *
 * Idempotent: characters already carrying characterDocumentMountPointId are
 * skipped. Per-character failures are logged and do not stop the remainder
 * of the run.
 *
 * @module startup/backfill-character-vaults
 */

import crypto from 'node:crypto';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { scaffoldCharacterMount } from '@/lib/mount-index/character-scaffold';
import type {
  Character,
  PhysicalDescription,
  CharacterSystemPrompt,
  CharacterScenario,
  ClothingRecord,
} from '@/lib/schemas/character.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

const logger = createServiceLogger('Startup:CharacterVaultBackfill');

export interface BackfillResult {
  scanned: number;
  vaultsCreated: number;
  alreadyLinked: number;
  errors: number;
}

export async function backfillCharacterVaults(): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    vaultsCreated: 0,
    alreadyLinked: 0,
    errors: 0,
  };

  const repos = getRepositories();
  const characters = await repos.characters.findAll();
  result.scanned = characters.length;

  logger.info('Character vault backfill scanning', { total: characters.length });

  for (const character of characters) {
    if (character.characterDocumentMountPointId) {
      result.alreadyLinked++;
      logger.debug('Character already linked to vault — skipping', {
        characterId: character.id,
        mountPointId: character.characterDocumentMountPointId,
      });
      continue;
    }

    try {
      await createVaultForCharacter(character);
      result.vaultsCreated++;
    } catch (err) {
      result.errors++;
      logger.error('Failed to create character vault', {
        characterId: character.id,
        name: character.name,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  logger.info('Character vault backfill complete', result);
  return result;
}

async function createVaultForCharacter(character: Character): Promise<void> {
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
}

async function populateVaultWithCharacterData(
  mountPointId: string,
  character: Character,
): Promise<void> {
  const repos = getRepositories();

  await writeDatabaseDocument(mountPointId, 'identity.md', renderIdentityMarkdown(character));
  await writeDatabaseDocument(mountPointId, 'description.md', character.description ?? '');
  await writeDatabaseDocument(mountPointId, 'personality.md', character.personality ?? '');
  await writeDatabaseDocument(
    mountPointId,
    'physical-description.md',
    renderPhysicalDescriptionMarkdown(character.physicalDescriptions ?? []),
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

  const wardrobeItems = await repos.wardrobe.findByCharacterId(character.id);
  const outfitPresets = await repos.outfitPresets.findByCharacterId(character.id);
  const migratedClothingItems = migrateClothingRecordsToItems(
    character.id,
    character.clothingRecords ?? [],
  );

  await writeDatabaseDocument(
    mountPointId,
    'wardrobe.json',
    JSON.stringify(
      {
        items: [...wardrobeItems, ...migratedClothingItems],
        presets: outfitPresets,
        outfit: { top: null, bottom: null, footwear: null, accessories: null },
      },
      null,
      2,
    ),
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

function renderIdentityMarkdown(c: Character): string {
  const lines: string[] = [];
  lines.push(`# ${c.name}`);
  lines.push('');

  const pronounSummary = c.pronouns
    ? `${c.pronouns.subject}/${c.pronouns.object}/${c.pronouns.possessive}`
    : null;
  const headerBits = [pronounSummary, c.title].filter(
    (bit): bit is string => typeof bit === 'string' && bit.length > 0,
  );
  if (headerBits.length > 0) {
    lines.push(`_${headerBits.join(' — ')}_`);
    lines.push('');
  }

  if (c.aliases && c.aliases.length > 0) {
    lines.push(`**Aliases:** ${c.aliases.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

function renderPhysicalDescriptionMarkdown(descs: PhysicalDescription[]): string {
  if (!descs || descs.length === 0) return '';
  const blocks: string[] = [];
  for (const d of descs) {
    const section: string[] = [];
    section.push(`## ${d.name}`);
    if (d.usageContext) {
      section.push('');
      section.push(`*Usage context:* ${d.usageContext}`);
    }
    if (d.shortPrompt) {
      section.push('');
      section.push('### Short prompt');
      section.push('');
      section.push(d.shortPrompt);
    }
    if (d.mediumPrompt) {
      section.push('');
      section.push('### Medium prompt');
      section.push('');
      section.push(d.mediumPrompt);
    }
    if (d.longPrompt) {
      section.push('');
      section.push('### Long prompt');
      section.push('');
      section.push(d.longPrompt);
    }
    if (d.completePrompt) {
      section.push('');
      section.push('### Complete prompt');
      section.push('');
      section.push(d.completePrompt);
    }
    if (d.fullDescription) {
      section.push('');
      section.push('### Full description');
      section.push('');
      section.push(d.fullDescription);
    }
    blocks.push(section.join('\n'));
  }
  return `${blocks.join('\n\n')}\n`;
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

function buildSystemPromptFile(p: CharacterSystemPrompt): string {
  const frontmatter = p.isDefault
    ? `---\nname: ${escapeYaml(p.name)}\nisDefault: true\n---\n\n`
    : `---\nname: ${escapeYaml(p.name)}\n---\n\n`;
  return `${frontmatter}${p.content}`;
}

function buildScenarioFile(s: CharacterScenario): string {
  return `# ${s.title}\n\n${s.content}`;
}

function sanitizeFileName(name: string): string {
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
