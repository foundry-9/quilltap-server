/**
 * Character Properties Overlay
 *
 * Applies the per-character `readPropertiesFromDocumentStore` switch: when a
 * character has the flag on and a linked vault, the five overridable fields
 * (pronouns, aliases, title, firstMessage, talkativeness) are read from the
 * vault's `properties.json` instead of the DB row.
 *
 * Behavior is all-or-nothing. If `properties.json` exists and parses cleanly
 * against the schema below, it wins entirely (null means null). If it's
 * missing, malformed, or fails validation, the DB values are returned for
 * all five fields and a warning is logged.
 *
 * The overlay is applied at the CharactersRepository layer so every read
 * path (findById/findAll/findByUserId/findByIds/findByFilter/etc.) sees
 * overlaid values transparently. Exports and the vault populator bypass via
 * the repository's `Raw` helpers.
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { Character } from '@/lib/schemas/types';
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

/**
 * The relative path of the properties document inside a character vault.
 * Matches `populateVaultWithCharacterData()` in character-vault.ts.
 */
export const CHARACTER_PROPERTIES_JSON_PATH = 'properties.json';

/**
 * Returns true if this character is a candidate for the overlay. A candidate
 * has the switch on AND a linked vault. Other callers short-circuit early.
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

/**
 * Apply the vault properties overlay to a list of characters. Characters not
 * flagged for overlay (switch off OR no linked vault) are returned unchanged.
 * Batched: performs a single IN(...) query against doc_mount_documents.
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

  let documents: Awaited<ReturnType<typeof repos.docMountDocuments.findManyByMountPointsAndPath>>;
  try {
    documents = await repos.docMountDocuments.findManyByMountPointsAndPath(
      mountPointIds,
      CHARACTER_PROPERTIES_JSON_PATH,
    );
  } catch (error) {
    logger.warn('Failed to load vault properties.json for overlay; falling back to DB values', {
      error: error instanceof Error ? error.message : String(error),
      mountPointIdCount: mountPointIds.length,
    });
    return characters;
  }

  const contentByMount = new Map<string, string>();
  for (const doc of documents) {
    contentByMount.set(doc.mountPointId, doc.content);
  }

  logger.debug('Applying character document-store overlay', {
    totalCharacters: characters.length,
    candidateCount: candidates.length,
    mountPointCount: mountPointIds.length,
    propertiesJsonFoundCount: contentByMount.size,
  });

  return characters.map((character) => {
    if (!isOverlayCandidate(character)) {
      return character;
    }
    const raw = contentByMount.get(character.characterDocumentMountPointId as string);
    if (raw === undefined) {
      // Vault exists but properties.json is missing — fall back to DB.
      return character;
    }
    const parsed = parseVaultProperties(raw, character.id);
    if (!parsed) {
      return character;
    }
    return {
      ...character,
      pronouns: parsed.pronouns,
      aliases: parsed.aliases,
      title: parsed.title,
      firstMessage: parsed.firstMessage,
      talkativeness: parsed.talkativeness,
    };
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
  let content: string;
  try {
    const doc = await readDatabaseDocument(mountPointId, CHARACTER_PROPERTIES_JSON_PATH);
    content = doc.content;
  } catch (error) {
    if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
      logger.debug('Vault properties.json not found', { mountPointId, characterId });
      return null;
    }
    logger.warn('Failed to read vault properties.json', {
      mountPointId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  return parseVaultProperties(content, characterId ?? mountPointId);
}
