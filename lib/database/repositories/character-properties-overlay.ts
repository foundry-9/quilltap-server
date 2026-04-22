/**
 * Character Properties Overlay
 *
 * Applies the per-character `readPropertiesFromDocumentStore` switch: when a
 * character has the flag on and a linked vault, selected fields are read from
 * the vault's files instead of the DB row.
 *
 * Nine vault targets participate, each independently:
 *
 *   - properties.json          — pronouns, aliases, title, firstMessage, talkativeness
 *   - description.md           — character.description
 *   - personality.md           — character.personality
 *   - example-dialogues.md     — character.exampleDialogues
 *   - physical-description.md  — physicalDescriptions[0].fullDescription
 *   - physical-prompts.json    — physicalDescriptions[0].{short,medium,long,complete}Prompt
 *   - wardrobe.json            — wardrobe items + outfit presets (applied by the
 *                                 wardrobe / outfit-presets repositories rather
 *                                 than the character hydrator, since neither
 *                                 lives on the character row)
 *   - Prompts/*.md             — character.systemPrompts (one file per variant,
 *                                 YAML frontmatter carries {name, isDefault})
 *   - Scenarios/*.md           — character.scenarios (one file per scenario,
 *                                 first `# heading` is the title)
 *
 * Each file's overlay is all-or-nothing for the fields it owns. If the file is
 * missing, malformed, or fails schema validation, that file's fields fall back
 * to the DB (other files are unaffected). Empty markdown files map `''` → null
 * so nullable fields retain their "unset" semantics.
 *
 * Prompts/ and Scenarios/ overlays enumerate top-level `.md` files only; nested
 * paths are ignored. When either directory exists and contains at least one
 * valid file, the vault listing fully replaces the DB array (all-or-nothing
 * per directory). An empty directory falls back to the DB.
 *
 * IDs for synthesized systemPrompts/scenarios entries are derived deterministically
 * from (mountPointId, relativePath) via SHA-256 so the chat's stored
 * `selectedSystemPromptId` / `defaultScenarioId` survives across overlay reads
 * as long as the filename doesn't change.
 *
 * The physical-description.md and physical-prompts.json overlays only apply when
 * the character already has at least one physicalDescription in the DB; they
 * target index 0 (the default). Characters with an empty `physicalDescriptions`
 * array are not extended synthetically.
 *
 * The overlay is applied at the CharactersRepository layer so every read path
 * (findById/findAll/findByUserId/findByIds/findByFilter/etc.) sees overlaid
 * values transparently. Exports and the vault populator bypass via the
 * repository's `Raw` helpers.
 */

import crypto from 'node:crypto';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  Character,
  PhysicalDescription,
  CharacterSystemPrompt,
  CharacterScenario,
} from '@/lib/schemas/types';
import { PronounsSchema } from '@/lib/schemas/character.types';
import {
  WardrobeItemSchema,
  OutfitPresetSchema,
  EquippedSlotsSchema,
  type WardrobeItem,
  type OutfitPreset,
} from '@/lib/schemas/wardrobe.types';
import {
  readDatabaseDocument,
  writeDatabaseDocument,
  deleteDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import {
  buildSystemPromptFile,
  buildScenarioFile,
  sanitizeFileName,
  renderPhysicalPromptsJson,
} from '@/lib/mount-index/character-vault';
import type { DocMountDocument } from '@/lib/schemas/mount-index.types';

// Mirrors the nullability of the underlying Character schema so that a vault
// whose properties.json carries null `title` / `firstMessage` (the normal
// state when those fields are unset in the DB) does not silently fail
// validation and fall back to the DB for all five fields.
export const CharacterVaultPropertiesSchema = z.object({
  pronouns: PronounsSchema.nullable(),
  aliases: z.array(z.string()),
  title: z.string().nullable(),
  firstMessage: z.string().nullable(),
  talkativeness: z.number().min(0.1).max(1.0),
});

export type CharacterVaultProperties = z.infer<typeof CharacterVaultPropertiesSchema>;

export const CharacterVaultPhysicalPromptsSchema = z.object({
  short: z.string().nullable(),
  medium: z.string().nullable(),
  long: z.string().nullable(),
  complete: z.string().nullable(),
});

export type CharacterVaultPhysicalPrompts = z.infer<typeof CharacterVaultPhysicalPromptsSchema>;

// Shape of the vault's wardrobe.json. `outfit` is the per-chat equipped state
// placeholder the scaffold writes; it isn't consumed by the overlay (equipped
// outfit state lives on the chat row) but we accept it on read so hand-edited
// files don't fail validation just for keeping the scaffold's shape.
export const CharacterVaultWardrobeSchema = z.object({
  items: z.array(WardrobeItemSchema),
  presets: z.array(OutfitPresetSchema),
  outfit: EquippedSlotsSchema.optional(),
});

export type CharacterVaultWardrobe = z.infer<typeof CharacterVaultWardrobeSchema>;

/**
 * The relative paths of the overlay documents inside a character vault.
 * Mirrors `populateVaultWithCharacterData()` in character-vault.ts.
 */
export const CHARACTER_PROPERTIES_JSON_PATH = 'properties.json';
export const CHARACTER_DESCRIPTION_MD_PATH = 'description.md';
export const CHARACTER_PERSONALITY_MD_PATH = 'personality.md';
export const CHARACTER_EXAMPLE_DIALOGUES_MD_PATH = 'example-dialogues.md';
export const CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH = 'physical-description.md';
export const CHARACTER_PHYSICAL_PROMPTS_JSON_PATH = 'physical-prompts.json';
export const CHARACTER_WARDROBE_JSON_PATH = 'wardrobe.json';

export const CHARACTER_PROMPTS_FOLDER = 'Prompts';
export const CHARACTER_SCENARIOS_FOLDER = 'Scenarios';

const SINGLE_FILE_OVERLAY_PATHS = [
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
] as const;

// ============================================================================
// VAULT FIELD DESCRIPTORS
//
// Single source of truth for "which character fields live in which vault file."
// Drives both the write overlay (route patches to the right file) and the
// generic vault readers used by the sync-back action. The existing batched
// read overlay still operates on the raw paths above, but its conceptual
// mapping mirrors this table 1:1 — keep them in sync when adding a managed
// field.
// ============================================================================

export type CharacterVaultDescriptor =
  | {
      kind: 'markdown';
      vaultPath: string;
      field: 'description' | 'personality' | 'exampleDialogues';
    }
  | { kind: 'physical-md'; vaultPath: string }
  | { kind: 'physical-json'; vaultPath: string }
  | { kind: 'properties-json'; vaultPath: string }
  | { kind: 'prompts-dir'; vaultFolder: string }
  | { kind: 'scenarios-dir'; vaultFolder: string };

export const CHARACTER_VAULT_DESCRIPTORS: readonly CharacterVaultDescriptor[] = [
  { kind: 'properties-json', vaultPath: CHARACTER_PROPERTIES_JSON_PATH },
  { kind: 'markdown', vaultPath: CHARACTER_DESCRIPTION_MD_PATH, field: 'description' },
  { kind: 'markdown', vaultPath: CHARACTER_PERSONALITY_MD_PATH, field: 'personality' },
  { kind: 'markdown', vaultPath: CHARACTER_EXAMPLE_DIALOGUES_MD_PATH, field: 'exampleDialogues' },
  { kind: 'physical-md', vaultPath: CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH },
  { kind: 'physical-json', vaultPath: CHARACTER_PHYSICAL_PROMPTS_JSON_PATH },
  { kind: 'prompts-dir', vaultFolder: CHARACTER_PROMPTS_FOLDER },
  { kind: 'scenarios-dir', vaultFolder: CHARACTER_SCENARIOS_FOLDER },
];

// Top-level Character keys whose writes are routed to the vault when overlay is
// on. physicalDescriptions is included because the overlay owns
// physicalDescriptions[0] — the write overlay only patches index 0 and leaves
// the rest of the array untouched on the DB row.
export const MANAGED_FIELDS: ReadonlySet<keyof Character> = new Set<keyof Character>([
  'description',
  'personality',
  'exampleDialogues',
  'pronouns',
  'aliases',
  'title',
  'firstMessage',
  'talkativeness',
  'physicalDescriptions',
  'systemPrompts',
  'scenarios',
]);

/**
 * Returns true if this character is a candidate for the overlay. A candidate
 * has the switch on AND a linked vault.
 */
function isOverlayCandidate(character: Character): boolean {
  return !!character.readPropertiesFromDocumentStore && !!character.characterDocumentMountPointId;
}

function parseVaultProperties(
  raw: string,
  characterId: string,
): CharacterVaultProperties | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    logger.warn('Invalid JSON in vault properties.json; falling back to DB values', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const parsed = CharacterVaultPropertiesSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('Vault properties.json failed schema validation; falling back to DB values', {
      characterId,
      issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }

  return parsed.data;
}

function parseVaultPhysicalPrompts(
  raw: string,
  characterId: string,
): CharacterVaultPhysicalPrompts | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    logger.warn('Invalid JSON in vault physical-prompts.json; falling back to DB values', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const parsed = CharacterVaultPhysicalPromptsSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('Vault physical-prompts.json failed schema validation; falling back to DB values', {
      characterId,
      issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }

  return parsed.data;
}

function parseVaultWardrobe(
  raw: string,
  characterId: string,
): CharacterVaultWardrobe | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    logger.warn('Invalid JSON in vault wardrobe.json; falling back to DB values', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const parsed = CharacterVaultWardrobeSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('Vault wardrobe.json failed schema validation; falling back to DB values', {
      characterId,
      issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }

  return parsed.data;
}

/**
 * Convert markdown file content into an overlay value. Empty strings become
 * null so that clearing a file collapses to the "unset" state that nullable
 * schema fields expect.
 */
function markdownToNullable(content: string): string | null {
  return content === '' ? null : content;
}

/**
 * Build a stable, RFC 4122 v8-style UUID from a SHA-256 digest of the source
 * string. v8 is the "custom" version reserved for implementation-specific
 * content; we use it so the `z.uuid()` schema accepts the string without us
 * having to implement true v5 (which requires SHA-1). The exact version byte
 * is not load-bearing — we just need a stable string that parses as a UUID
 * and will always round-trip to itself for the same input.
 */
function stableUuidFromString(source: string): string {
  const hash = crypto.createHash('sha256').update(source).digest();
  const bytes = Buffer.alloc(16);
  hash.copy(bytes, 0, 0, 16);
  // Set version to 8 (custom) in byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  // Set variant to RFC 4122 in byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Parse a prompt-variant file. The YAML frontmatter carries the display name
 * and isDefault flag; the body (after the closing ---) becomes the prompt
 * content. Files without frontmatter or without a `name` field are skipped.
 */
function parsePromptFile(
  doc: DocMountDocument,
  characterId: string,
): CharacterSystemPrompt | null {
  const parsed = parseFrontmatter(doc.content);
  if (!parsed.data) {
    logger.warn('Prompts/*.md file has no parseable frontmatter; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  const name = parsed.data.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    logger.warn('Prompts/*.md file missing `name` in frontmatter; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  const isDefault = parsed.data.isDefault === true;
  const body = doc.content.slice(parsed.bodyStartOffset).trimStart();
  if (body.length === 0) {
    logger.warn('Prompts/*.md body is empty; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  return {
    id: stableUuidFromString(`prompt:${doc.mountPointId}:${doc.relativePath}`),
    name: name.trim().slice(0, 100),
    content: body,
    isDefault,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Parse a scenario file. The first `# heading` is the title; everything after
 * it (trimmed) is the body. Files without a `# heading` fall back to the
 * filename-without-extension as the title so nothing is dropped silently.
 */
function parseScenarioFile(
  doc: DocMountDocument,
  characterId: string,
): CharacterScenario | null {
  const content = doc.content;
  const lines = content.split('\n');
  let titleLineIndex = -1;
  let title: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^#\s+(.+)$/);
    if (match) {
      titleLineIndex = i;
      title = match[1].trim();
      break;
    }
  }
  if (title === null) {
    // Fall back to filename-without-extension so malformed scenario files are
    // still visible rather than silently dropped.
    const fileName = doc.fileName.replace(/\.md$/i, '');
    title = fileName.trim().slice(0, 200);
    if (title.length === 0) {
      logger.warn('Scenarios/*.md file has no title; skipping', {
        characterId,
        mountPointId: doc.mountPointId,
        relativePath: doc.relativePath,
      });
      return null;
    }
    logger.debug('Scenario file had no # heading; using filename as title', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
      title,
    });
  }

  // Body: everything after the title line (if any), trimmed to a reasonable
  // shape. If no heading was found, use the whole content as body.
  let body: string;
  if (titleLineIndex >= 0) {
    body = lines.slice(titleLineIndex + 1).join('\n').trim();
  } else {
    body = content.trim();
  }
  if (body.length === 0) {
    logger.warn('Scenarios/*.md body is empty; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  return {
    id: stableUuidFromString(`scenario:${doc.mountPointId}:${doc.relativePath}`),
    title: title.slice(0, 200),
    content: body,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Apply the vault file overlay to a list of characters. Characters not flagged
 * for overlay (switch off OR no linked vault) are returned unchanged. Batched:
 * performs one IN(...) query per vault path plus two directory listings.
 */
export async function applyDocumentStoreOverlay(
  characters: Character[],
): Promise<Character[]> {
  if (characters.length === 0) {
    return characters;
  }

  const candidates = characters.filter(isOverlayCandidate);
  if (candidates.length === 0) {
    return characters;
  }

  const mountPointIds = Array.from(
    new Set(candidates.map((c) => c.characterDocumentMountPointId as string)),
  );

  const repos = getRepositories();

  const contentByMountByPath = new Map<string, Map<string, string>>();
  for (const path of SINGLE_FILE_OVERLAY_PATHS) {
    contentByMountByPath.set(path, new Map<string, string>());
  }
  const promptsByMount = new Map<string, DocMountDocument[]>();
  const scenariosByMount = new Map<string, DocMountDocument[]>();

  try {
    const singleFileResults = await Promise.all(
      SINGLE_FILE_OVERLAY_PATHS.map((path) =>
        repos.docMountDocuments.findManyByMountPointsAndPath(mountPointIds, path),
      ),
    );
    for (let i = 0; i < SINGLE_FILE_OVERLAY_PATHS.length; i++) {
      const path = SINGLE_FILE_OVERLAY_PATHS[i];
      const byMount = contentByMountByPath.get(path)!;
      for (const doc of singleFileResults[i]) {
        byMount.set(doc.mountPointId, doc.content);
      }
    }

    const [promptDocs, scenarioDocs] = await Promise.all([
      repos.docMountDocuments.findManyByMountPointsInFolder(
        mountPointIds,
        CHARACTER_PROMPTS_FOLDER,
        '.md',
      ),
      repos.docMountDocuments.findManyByMountPointsInFolder(
        mountPointIds,
        CHARACTER_SCENARIOS_FOLDER,
        '.md',
      ),
    ]);
    for (const doc of promptDocs) {
      let list = promptsByMount.get(doc.mountPointId);
      if (!list) {
        list = [];
        promptsByMount.set(doc.mountPointId, list);
      }
      list.push(doc);
    }
    for (const doc of scenarioDocs) {
      let list = scenariosByMount.get(doc.mountPointId);
      if (!list) {
        list = [];
        scenariosByMount.set(doc.mountPointId, list);
      }
      list.push(doc);
    }
  } catch (error) {
    logger.warn('Failed to load vault files for character overlay; falling back to DB values', {
      error: error instanceof Error ? error.message : String(error),
      mountPointIdCount: mountPointIds.length,
    });
    return characters;
  }

  const propsByMount = contentByMountByPath.get(CHARACTER_PROPERTIES_JSON_PATH)!;
  const descByMount = contentByMountByPath.get(CHARACTER_DESCRIPTION_MD_PATH)!;
  const persByMount = contentByMountByPath.get(CHARACTER_PERSONALITY_MD_PATH)!;
  const dialoguesByMount = contentByMountByPath.get(CHARACTER_EXAMPLE_DIALOGUES_MD_PATH)!;
  const physDescByMount = contentByMountByPath.get(CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH)!;
  const physPromptsByMount = contentByMountByPath.get(CHARACTER_PHYSICAL_PROMPTS_JSON_PATH)!;

  logger.debug('Applying character document-store overlay', {
    totalCharacters: characters.length,
    candidateCount: candidates.length,
    mountPointCount: mountPointIds.length,
    propertiesJsonFoundCount: propsByMount.size,
    descriptionMdFoundCount: descByMount.size,
    personalityMdFoundCount: persByMount.size,
    exampleDialoguesMdFoundCount: dialoguesByMount.size,
    physicalDescriptionMdFoundCount: physDescByMount.size,
    physicalPromptsMdFoundCount: physPromptsByMount.size,
    promptsFolderMountCount: promptsByMount.size,
    scenariosFolderMountCount: scenariosByMount.size,
  });

  return characters.map((character) => {
    if (!isOverlayCandidate(character)) {
      return character;
    }
    const mountId = character.characterDocumentMountPointId as string;
    let out: Character = character;

    // properties.json: pronouns, aliases, title, firstMessage, talkativeness
    const propsRaw = propsByMount.get(mountId);
    if (propsRaw !== undefined) {
      const parsed = parseVaultProperties(propsRaw, character.id);
      if (parsed) {
        out = {
          ...out,
          pronouns: parsed.pronouns,
          aliases: parsed.aliases,
          title: parsed.title,
          firstMessage: parsed.firstMessage,
          talkativeness: parsed.talkativeness,
        };
      }
    }

    // description.md
    const descRaw = descByMount.get(mountId);
    if (descRaw !== undefined) {
      out = { ...out, description: markdownToNullable(descRaw) };
    }

    // personality.md
    const persRaw = persByMount.get(mountId);
    if (persRaw !== undefined) {
      out = { ...out, personality: markdownToNullable(persRaw) };
    }

    // example-dialogues.md
    const dialoguesRaw = dialoguesByMount.get(mountId);
    if (dialoguesRaw !== undefined) {
      out = { ...out, exampleDialogues: markdownToNullable(dialoguesRaw) };
    }

    // physical-description.md + physical-prompts.json target physicalDescriptions[0]
    const physDescRaw = physDescByMount.get(mountId);
    const physPromptsRaw = physPromptsByMount.get(mountId);
    const hasPhysicalOverlayInput = physDescRaw !== undefined || physPromptsRaw !== undefined;

    if (hasPhysicalOverlayInput) {
      if (!out.physicalDescriptions || out.physicalDescriptions.length === 0) {
        logger.debug(
          'Vault has physical overlay files but character has no physicalDescriptions; skipping',
          { characterId: character.id, mountPointId: mountId },
        );
      } else {
        const first = out.physicalDescriptions[0];
        const patched: PhysicalDescription = { ...first };

        if (physDescRaw !== undefined) {
          patched.fullDescription = markdownToNullable(physDescRaw);
        }

        if (physPromptsRaw !== undefined) {
          const parsedPrompts = parseVaultPhysicalPrompts(physPromptsRaw, character.id);
          if (parsedPrompts) {
            patched.shortPrompt = parsedPrompts.short;
            patched.mediumPrompt = parsedPrompts.medium;
            patched.longPrompt = parsedPrompts.long;
            patched.completePrompt = parsedPrompts.complete;
          }
        }

        out = {
          ...out,
          physicalDescriptions: [patched, ...out.physicalDescriptions.slice(1)],
        };
      }
    }

    // Prompts/*.md → systemPrompts
    const promptDocs = promptsByMount.get(mountId);
    if (promptDocs && promptDocs.length > 0) {
      const parsedPrompts = promptDocs
        .slice()
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        .map((doc) => parsePromptFile(doc, character.id))
        .filter((p): p is CharacterSystemPrompt => p !== null);
      if (parsedPrompts.length > 0) {
        // Ensure exactly one isDefault. If the frontmatter declares multiple
        // defaults, keep only the first; if none are marked default, promote
        // the first alphabetically so downstream consumers can always pick a
        // default without falling through to the empty-array branch.
        let seenDefault = false;
        const normalized: CharacterSystemPrompt[] = parsedPrompts.map((p) => {
          if (p.isDefault) {
            if (seenDefault) {
              return { ...p, isDefault: false };
            }
            seenDefault = true;
            return p;
          }
          return p;
        });
        if (!seenDefault) {
          normalized[0] = { ...normalized[0], isDefault: true };
        }
        out = { ...out, systemPrompts: normalized };
      }
    }

    // Scenarios/*.md → scenarios
    const scenarioDocs = scenariosByMount.get(mountId);
    if (scenarioDocs && scenarioDocs.length > 0) {
      const parsedScenarios = scenarioDocs
        .slice()
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        .map((doc) => parseScenarioFile(doc, character.id))
        .filter((s): s is CharacterScenario => s !== null);
      if (parsedScenarios.length > 0) {
        out = { ...out, scenarios: parsedScenarios };
      }
    }

    return out;
  });
}

/**
 * Apply the overlay to a single character (or null). Convenience wrapper
 * around the batched function.
 */
export async function applyDocumentStoreOverlayOne(
  character: Character | null,
): Promise<Character | null> {
  if (!character) {
    return character;
  }
  const [overlaid] = await applyDocumentStoreOverlay([character]);
  return overlaid ?? character;
}

/**
 * Read a character's vault properties.json and return a validated snapshot,
 * or null if the file is missing/malformed/invalid. Used by the sync-back
 * action to copy vault values into the DB.
 */
export async function readCharacterVaultProperties(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterVaultProperties | null> {
  const content = await readVaultTextFile(mountPointId, CHARACTER_PROPERTIES_JSON_PATH, characterId);
  if (content === null) return null;
  return parseVaultProperties(content, characterId ?? mountPointId);
}

/**
 * Read the raw markdown content of description.md. Returns null if missing or
 * if the read fails; returns the empty string if the file exists but is empty.
 */
export async function readCharacterVaultDescription(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_DESCRIPTION_MD_PATH, characterId);
}

export async function readCharacterVaultPersonality(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_PERSONALITY_MD_PATH, characterId);
}

export async function readCharacterVaultExampleDialogues(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_EXAMPLE_DIALOGUES_MD_PATH, characterId);
}

export async function readCharacterVaultPhysicalDescription(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH, characterId);
}

export async function readCharacterVaultPhysicalPrompts(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterVaultPhysicalPrompts | null> {
  const content = await readVaultTextFile(
    mountPointId,
    CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
    characterId,
  );
  if (content === null) return null;
  return parseVaultPhysicalPrompts(content, characterId ?? mountPointId);
}

/**
 * Enumerate Prompts/*.md inside a vault and return the parsed prompt array.
 * Returns an empty array if the folder is missing or empty. Invalid files are
 * skipped with a warning. Used by the sync-back action.
 */
export async function readCharacterVaultSystemPrompts(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterSystemPrompt[]> {
  const repos = getRepositories();
  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    CHARACTER_PROMPTS_FOLDER,
    '.md',
  );
  const parsed = docs
    .slice()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((doc) => parsePromptFile(doc, characterId ?? mountPointId))
    .filter((p): p is CharacterSystemPrompt => p !== null);
  if (parsed.length === 0) return [];
  let seenDefault = false;
  const normalized: CharacterSystemPrompt[] = parsed.map((p) => {
    if (p.isDefault) {
      if (seenDefault) return { ...p, isDefault: false };
      seenDefault = true;
      return p;
    }
    return p;
  });
  if (!seenDefault) {
    normalized[0] = { ...normalized[0], isDefault: true };
  }
  return normalized;
}

/**
 * Enumerate Scenarios/*.md inside a vault and return the parsed scenario array.
 * Returns an empty array if the folder is missing or empty. Used by the
 * sync-back action.
 */
export async function readCharacterVaultScenarios(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterScenario[]> {
  const repos = getRepositories();
  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    CHARACTER_SCENARIOS_FOLDER,
    '.md',
  );
  return docs
    .slice()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((doc) => parseScenarioFile(doc, characterId ?? mountPointId))
    .filter((s): s is CharacterScenario => s !== null);
}

/**
 * Read a character's vault wardrobe.json and return a validated snapshot, or
 * null if the file is missing/malformed/invalid. Consumed by the wardrobe /
 * outfit-presets repositories to overlay list reads.
 */
export async function readCharacterVaultWardrobe(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterVaultWardrobe | null> {
  const content = await readVaultTextFile(
    mountPointId,
    CHARACTER_WARDROBE_JSON_PATH,
    characterId,
  );
  if (content === null) return null;
  return parseVaultWardrobe(content, characterId ?? mountPointId);
}

export interface WardrobeOverlayOptions {
  /** Include items whose archivedAt is non-null. Default false. */
  includeArchived?: boolean;
  /** Only return items with isDefault=true. */
  defaultsOnly?: boolean;
}

/**
 * Overlay a wardrobe-items list read. If the character has
 * `readPropertiesFromDocumentStore` on and a linked vault, wardrobe.json is the
 * source of truth; the caller's DB loader is skipped. Otherwise the DB loader
 * runs and its result is returned.
 *
 * Items parsed from the vault have their `characterId` coerced to the lookup
 * ID — a wardrobe file scoped to one character's vault always belongs to that
 * character, and coercing keeps downstream consumers from tripping over a
 * hand-edited characterId that doesn't match.
 */
export async function getOverlaidWardrobeItems(
  characterId: string,
  loadDbItems: () => Promise<WardrobeItem[]>,
  options: WardrobeOverlayOptions = {},
): Promise<WardrobeItem[]> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character || !isOverlayCandidate(character)) {
    return loadDbItems();
  }

  const mountPointId = character.characterDocumentMountPointId as string;
  const vault = await readCharacterVaultWardrobe(mountPointId, characterId);
  if (!vault) {
    return loadDbItems();
  }

  let items: WardrobeItem[] = vault.items.map((item) => ({
    ...item,
    characterId,
  }));
  if (!options.includeArchived) {
    items = items.filter((item) => !item.archivedAt);
  }
  if (options.defaultsOnly) {
    items = items.filter((item) => item.isDefault);
  }

  logger.debug('Wardrobe items read overlaid from vault wardrobe.json', {
    characterId,
    mountPointId,
    itemCount: items.length,
    includeArchived: options.includeArchived ?? false,
    defaultsOnly: options.defaultsOnly ?? false,
  });

  return items;
}

/**
 * Overlay an outfit-presets list read, symmetric with
 * `getOverlaidWardrobeItems`.
 */
export async function getOverlaidOutfitPresets(
  characterId: string,
  loadDbPresets: () => Promise<OutfitPreset[]>,
): Promise<OutfitPreset[]> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character || !isOverlayCandidate(character)) {
    return loadDbPresets();
  }

  const mountPointId = character.characterDocumentMountPointId as string;
  const vault = await readCharacterVaultWardrobe(mountPointId, characterId);
  if (!vault) {
    return loadDbPresets();
  }

  const presets: OutfitPreset[] = vault.presets.map((preset) => ({
    ...preset,
    characterId,
  }));

  logger.debug('Outfit presets read overlaid from vault wardrobe.json', {
    characterId,
    mountPointId,
    presetCount: presets.length,
  });

  return presets;
}

/**
 * Per-character write chain. The overlay treats vault wardrobe.json as
 * authoritative on read, so each mutation of wardrobe items or outfit presets
 * must project the new DB state into the vault file. Chaining per characterId
 * prevents two concurrent sync calls from each reading a stale DB snapshot and
 * writing a file that loses one of the changes.
 */
const wardrobeSyncChains = new Map<string, Promise<void>>();

/**
 * After a wardrobe-item or outfit-preset write, re-project the character's
 * DB state into the vault's wardrobe.json. No-ops for archetype rows
 * (characterId null), missing characters, and characters that aren't overlay
 * candidates (flag off or no linked vault).
 *
 * Failures are logged but not propagated — the DB write is already committed,
 * and the next successful sync (or the startup refresh) will reconcile. We'd
 * rather report success and leave a warning in the log than throw and leave
 * the caller to retry into a duplicate DB row.
 */
export async function syncCharacterVaultWardrobe(
  characterId: string | null | undefined,
): Promise<void> {
  if (!characterId) return;

  const prev = wardrobeSyncChains.get(characterId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => performVaultWardrobeSync(characterId));
  wardrobeSyncChains.set(characterId, next);
  try {
    await next;
  } finally {
    if (wardrobeSyncChains.get(characterId) === next) {
      wardrobeSyncChains.delete(characterId);
    }
  }
}

async function performVaultWardrobeSync(characterId: string): Promise<void> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character || !isOverlayCandidate(character)) return;

  const mountPointId = character.characterDocumentMountPointId as string;

  try {
    const [items, presets] = await Promise.all([
      repos.wardrobe.findByCharacterIdRaw(characterId),
      repos.outfitPresets.findByCharacterIdRaw(characterId),
    ]);

    await writeDatabaseDocument(
      mountPointId,
      CHARACTER_WARDROBE_JSON_PATH,
      JSON.stringify(
        {
          items,
          presets,
          outfit: { top: null, bottom: null, footwear: null, accessories: null },
        },
        null,
        2,
      ),
    );

    logger.debug('Synced wardrobe.json from DB', {
      characterId,
      mountPointId,
      itemCount: items.length,
      presetCount: presets.length,
    });
  } catch (err) {
    logger.error('Failed to sync wardrobe.json from DB; vault is now stale', {
      characterId,
      mountPointId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

async function readVaultTextFile(
  mountPointId: string,
  path: string,
  characterId?: string,
): Promise<string | null> {
  try {
    const doc = await readDatabaseDocument(mountPointId, path);
    return doc.content;
  } catch (error) {
    if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
      logger.debug('Vault file not found', { mountPointId, path, characterId });
      return null;
    }
    logger.warn('Failed to read vault file', {
      mountPointId,
      path,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ============================================================================
// CONSOLIDATED VAULT READERS
//
// Single descriptor-driven entry point that the sync-back action and any
// future "give me everything the vault has for this character" caller can use
// instead of stitching together the nine standalone readCharacterVault*
// helpers above.
// ============================================================================

/**
 * Snapshot of all vault-managed fields for a character, in Character-row
 * shape. Fields whose vault file is missing/malformed are omitted (not set to
 * null), so callers can spread this object into a patch without clobbering
 * unrelated DB-only fields.
 *
 * `physicalDescriptions` is included as the full array (with index 0 patched
 * from physical-description.md / physical-prompts.json) only when the
 * character already has at least one physicalDescription — vault overlay
 * never synthesizes one.
 */
export interface VaultManagedFieldsSnapshot extends Partial<Character> {
  /** True if vault has any physical-* file but the character has no physicalDescriptions to patch. */
  physicalSkippedNoPrimary?: boolean;
}

export async function readCharacterVaultManagedFields(
  mountPointId: string,
  characterId: string,
  existingPhysicalDescriptions: readonly PhysicalDescription[] = [],
): Promise<VaultManagedFieldsSnapshot> {
  const snapshot: VaultManagedFieldsSnapshot = {};

  for (const descriptor of CHARACTER_VAULT_DESCRIPTORS) {
    switch (descriptor.kind) {
      case 'properties-json': {
        const props = await readCharacterVaultProperties(mountPointId, characterId);
        if (props) {
          snapshot.pronouns = props.pronouns;
          snapshot.aliases = props.aliases;
          snapshot.title = props.title;
          snapshot.firstMessage = props.firstMessage;
          snapshot.talkativeness = props.talkativeness;
        }
        break;
      }
      case 'markdown': {
        const md = await readVaultTextFile(mountPointId, descriptor.vaultPath, characterId);
        if (md !== null) {
          // Empty file → null so nullable fields keep their unset semantics.
          (snapshot as Record<string, unknown>)[descriptor.field] = md === '' ? null : md;
        }
        break;
      }
      case 'physical-md':
      case 'physical-json': {
        // Handled together below to keep both files patched onto the same
        // physicalDescriptions[0] copy. We process physical-md first; the
        // physical-json branch is a no-op the second time around.
        if (descriptor.kind === 'physical-md') {
          const physDescMd = await readVaultTextFile(
            mountPointId,
            CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
            characterId,
          );
          const physPromptsJson = await readCharacterVaultPhysicalPrompts(
            mountPointId,
            characterId,
          );
          if (physDescMd === null && physPromptsJson === null) break;
          if (existingPhysicalDescriptions.length === 0) {
            snapshot.physicalSkippedNoPrimary = true;
            break;
          }
          const first = existingPhysicalDescriptions[0];
          const patched: PhysicalDescription = { ...first };
          if (physDescMd !== null) {
            patched.fullDescription = physDescMd === '' ? null : physDescMd;
          }
          if (physPromptsJson !== null) {
            patched.shortPrompt = physPromptsJson.short;
            patched.mediumPrompt = physPromptsJson.medium;
            patched.longPrompt = physPromptsJson.long;
            patched.completePrompt = physPromptsJson.complete;
          }
          patched.updatedAt = new Date().toISOString();
          snapshot.physicalDescriptions = [patched, ...existingPhysicalDescriptions.slice(1)];
        }
        break;
      }
      case 'prompts-dir': {
        const prompts = await readCharacterVaultSystemPrompts(mountPointId, characterId);
        if (prompts.length > 0) {
          snapshot.systemPrompts = prompts;
        }
        break;
      }
      case 'scenarios-dir': {
        const scenarios = await readCharacterVaultScenarios(mountPointId, characterId);
        if (scenarios.length > 0) {
          snapshot.scenarios = scenarios;
        }
        break;
      }
    }
  }

  return snapshot;
}

// ============================================================================
// WRITE OVERLAY
//
// Symmetric counterpart to applyDocumentStoreOverlay: when an update() patch
// includes managed fields and the character is in vault mode, route those
// fields to vault files instead of the DB row. Returns the unmanaged
// remainder so the caller can still do its DB write for the rest.
//
// "Vault is source of truth" semantics: managed fields written here do NOT
// also update the DB column. The DB row stays at the value it held when
// overlay was toggled on. Toggling overlay off restores those frozen DB
// values; the user can run sync-properties-from-vault first to copy recent
// vault edits into the DB before flipping the switch.
// ============================================================================

/**
 * Decide whether a Character-row update needs to be routed to the vault, and
 * if so, write the managed fields and strip them from the DB-bound patch.
 *
 * Returns the portion of `patch` that should go to the DB (unmanaged fields
 * always; managed fields only when the character is not in vault mode).
 *
 * Throws if a vault write fails — the caller should NOT then proceed with the
 * DB write, so that callers can't end up with a partial commit where DB and
 * vault disagree on which fields are "current."
 */
export async function applyDocumentStoreWriteOverlay(
  characterId: string,
  patch: Partial<Character>,
): Promise<Partial<Character>> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character) {
    // Caller will hit the same not-found in _update; let it surface there.
    return patch;
  }
  if (!isOverlayCandidate(character)) {
    return patch;
  }

  const mountPointId = character.characterDocumentMountPointId as string;
  const dbPatch: Partial<Character> = { ...patch };
  let routedFieldCount = 0;

  for (const descriptor of CHARACTER_VAULT_DESCRIPTORS) {
    switch (descriptor.kind) {
      case 'markdown': {
        if (!(descriptor.field in patch)) break;
        const value = patch[descriptor.field] as string | null | undefined;
        await writeDatabaseDocument(mountPointId, descriptor.vaultPath, value ?? '');
        delete dbPatch[descriptor.field];
        routedFieldCount++;
        break;
      }
      case 'properties-json': {
        const propsKeys = ['pronouns', 'aliases', 'title', 'firstMessage', 'talkativeness'] as const;
        const touched = propsKeys.filter((k) => k in patch);
        if (touched.length === 0) break;
        // Read-modify-write so a partial patch doesn't blow away unspecified
        // fields in the same JSON file.
        const current = (await readCharacterVaultProperties(mountPointId, characterId)) ?? {
          pronouns: character.pronouns ?? null,
          aliases: character.aliases ?? [],
          title: character.title ?? null,
          firstMessage: character.firstMessage ?? null,
          talkativeness: character.talkativeness ?? 0.5,
        };
        const next: CharacterVaultProperties = {
          pronouns: 'pronouns' in patch ? (patch.pronouns ?? null) : current.pronouns,
          aliases: 'aliases' in patch ? (patch.aliases ?? []) : current.aliases,
          title: 'title' in patch ? (patch.title ?? null) : current.title,
          firstMessage:
            'firstMessage' in patch ? (patch.firstMessage ?? null) : current.firstMessage,
          talkativeness:
            'talkativeness' in patch ? (patch.talkativeness ?? 0.5) : current.talkativeness,
        };
        await writeDatabaseDocument(
          mountPointId,
          descriptor.vaultPath,
          JSON.stringify(next, null, 2),
        );
        for (const k of touched) delete dbPatch[k];
        routedFieldCount += touched.length;
        break;
      }
      case 'physical-md':
      case 'physical-json': {
        // Only routed once, on the physical-md descriptor pass; physical-json
        // is handled in the same write because both target physicalDescriptions[0].
        if (descriptor.kind !== 'physical-md') break;
        if (!('physicalDescriptions' in patch)) break;
        const incoming = patch.physicalDescriptions ?? [];
        if (incoming.length === 0) {
          // The DB array still owns membership; deleting an entry should go to
          // DB, not the vault. Drop the vault overlay only when the new array
          // is non-empty so we don't accidentally clear the file when the
          // caller is just emptying the DB row.
          break;
        }
        const primary = incoming[0];
        await writeDatabaseDocument(
          mountPointId,
          CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
          primary.fullDescription ?? '',
        );
        await writeDatabaseDocument(
          mountPointId,
          CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
          renderPhysicalPromptsJson(primary),
        );
        // Strip primary's overlaid fields from the DB-bound patch so the DB
        // row's index 0 stays frozen at the pre-overlay value. Non-overlaid
        // fields on the primary, plus the rest of the array, still go to DB.
        const dbPrimary: PhysicalDescription = {
          ...primary,
          fullDescription: character.physicalDescriptions?.[0]?.fullDescription ?? null,
          shortPrompt: character.physicalDescriptions?.[0]?.shortPrompt ?? null,
          mediumPrompt: character.physicalDescriptions?.[0]?.mediumPrompt ?? null,
          longPrompt: character.physicalDescriptions?.[0]?.longPrompt ?? null,
          completePrompt: character.physicalDescriptions?.[0]?.completePrompt ?? null,
        };
        dbPatch.physicalDescriptions = [dbPrimary, ...incoming.slice(1)];
        routedFieldCount++;
        break;
      }
      case 'prompts-dir': {
        if (!('systemPrompts' in patch)) break;
        const incoming = patch.systemPrompts ?? [];
        await projectArrayIntoVaultFolder(
          mountPointId,
          descriptor.vaultFolder,
          incoming,
          (p) => ({
            fileName: `${sanitizeFileName(p.name)}.md`,
            content: buildSystemPromptFile(p),
          }),
          characterId,
        );
        delete dbPatch.systemPrompts;
        routedFieldCount++;
        break;
      }
      case 'scenarios-dir': {
        if (!('scenarios' in patch)) break;
        const incoming = patch.scenarios ?? [];
        await projectArrayIntoVaultFolder(
          mountPointId,
          descriptor.vaultFolder,
          incoming,
          (s) => ({
            fileName: `${sanitizeFileName(s.title)}.md`,
            content: buildScenarioFile(s),
          }),
          characterId,
        );
        delete dbPatch.scenarios;
        routedFieldCount++;
        break;
      }
    }
  }

  if (routedFieldCount > 0) {
    logger.debug('Routed character update fields to vault', {
      characterId,
      mountPointId,
      routedFieldCount,
      remainingDbFieldCount: Object.keys(dbPatch).length,
    });
  }

  return dbPatch;
}

/**
 * Replace a vault folder's contents with a fresh projection of an array.
 * Files corresponding to items in `items` are written; any other files
 * currently in the folder are deleted, so the vault listing matches the
 * incoming array exactly. Naming collisions are disambiguated with
 * `-1`, `-2`, … suffixes.
 */
async function projectArrayIntoVaultFolder<T>(
  mountPointId: string,
  folder: string,
  items: readonly T[],
  mapper: (item: T) => { fileName: string; content: string },
  characterId: string,
): Promise<void> {
  const repos = getRepositories();
  const existing = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    folder,
    '.md',
  );
  const existingByPath = new Map(existing.map((d) => [d.relativePath, d]));

  if (items.length > 0) {
    await ensureFolderPath(mountPointId, folder);
  }

  const writtenPaths = new Set<string>();
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
    const relPath = `${folder}/${candidate}`;
    writtenPaths.add(relPath);
    await writeDatabaseDocument(mountPointId, relPath, mapped.content);
  }

  for (const [relPath, doc] of existingByPath) {
    if (writtenPaths.has(relPath)) continue;
    try {
      await deleteDatabaseDocument(mountPointId, relPath);
    } catch (err) {
      logger.warn('Failed to delete stale vault file during folder projection', {
        characterId,
        mountPointId,
        relativePath: relPath,
        docId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
