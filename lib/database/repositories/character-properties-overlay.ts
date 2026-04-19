/**
 * Character Properties Overlay
 *
 * Applies the per-character `readPropertiesFromDocumentStore` switch: when a
 * character has the flag on and a linked vault, selected fields are read from
 * the vault's files instead of the DB row.
 *
 * Eight vault targets participate, each independently:
 *
 *   - properties.json          — pronouns, aliases, title, firstMessage, talkativeness
 *   - description.md           — character.description
 *   - personality.md           — character.personality
 *   - example-dialogues.md     — character.exampleDialogues
 *   - physical-description.md  — physicalDescriptions[0].fullDescription
 *   - physical-prompts.json    — physicalDescriptions[0].{short,medium,long,complete}Prompt
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
import { readDatabaseDocument, DatabaseStoreError } from '@/lib/mount-index/database-store';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
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
