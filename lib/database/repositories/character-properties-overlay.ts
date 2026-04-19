/**
 * Character Properties Overlay
 *
 * Applies the per-character `readPropertiesFromDocumentStore` switch: when a
 * character has the flag on and a linked vault, selected fields are read from
 * the vault's files instead of the DB row.
 *
 * Five vault files participate, each independently:
 *
 *   - properties.json          — pronouns, aliases, title, firstMessage, talkativeness
 *   - description.md           — character.description
 *   - personality.md           — character.personality
 *   - physical-description.md  — physicalDescriptions[0].fullDescription
 *   - physical-prompts.json    — physicalDescriptions[0].{short,medium,long,complete}Prompt
 *
 * Each file's overlay is all-or-nothing for the fields it owns. If the file is
 * missing, malformed, or fails schema validation, that file's fields fall back
 * to the DB (other files are unaffected). Empty markdown files map `''` → null
 * so nullable fields retain their "unset" semantics.
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

import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { Character, PhysicalDescription } from '@/lib/schemas/types';
import { PronounsSchema } from '@/lib/schemas/character.types';
import { readDatabaseDocument, DatabaseStoreError } from '@/lib/mount-index/database-store';

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
export const CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH = 'physical-description.md';
export const CHARACTER_PHYSICAL_PROMPTS_JSON_PATH = 'physical-prompts.json';

const OVERLAY_PATHS = [
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
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
 * Apply the vault file overlay to a list of characters. Characters not flagged
 * for overlay (switch off OR no linked vault) are returned unchanged. Batched:
 * performs one IN(...) query per vault path.
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
  for (const path of OVERLAY_PATHS) {
    contentByMountByPath.set(path, new Map<string, string>());
  }

  try {
    const results = await Promise.all(
      OVERLAY_PATHS.map((path) =>
        repos.docMountDocuments.findManyByMountPointsAndPath(mountPointIds, path),
      ),
    );
    for (let i = 0; i < OVERLAY_PATHS.length; i++) {
      const path = OVERLAY_PATHS[i];
      const byMount = contentByMountByPath.get(path)!;
      for (const doc of results[i]) {
        byMount.set(doc.mountPointId, doc.content);
      }
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
  const physDescByMount = contentByMountByPath.get(CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH)!;
  const physPromptsByMount = contentByMountByPath.get(CHARACTER_PHYSICAL_PROMPTS_JSON_PATH)!;

  logger.debug('Applying character document-store overlay', {
    totalCharacters: characters.length,
    candidateCount: candidates.length,
    mountPointCount: mountPointIds.length,
    propertiesJsonFoundCount: propsByMount.size,
    descriptionMdFoundCount: descByMount.size,
    personalityMdFoundCount: persByMount.size,
    physicalDescriptionMdFoundCount: physDescByMount.size,
    physicalPromptsMdFoundCount: physPromptsByMount.size,
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
