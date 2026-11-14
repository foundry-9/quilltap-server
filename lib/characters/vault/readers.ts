/**
 * Single-file reads of a character vault, outside hydration. Hydration reads
 * every file at once (`hydrate.ts`); these are for the few callers that need
 * one file — the heal, the vault-health report, a guard that needs the current
 * `humanoid` flag, the dressing instructions.
 *
 * @module characters/vault/readers
 */

import { logger } from '@/lib/logger';
import { readDatabaseDocumentIfExists } from '@/lib/mount-index/database-store';
import {
  CHARACTER_PROPERTIES_JSON_PATH,
  CharacterVaultUnavailableError,
  parsePropertiesStrict,
} from './layout';
import type { CharacterVaultProperties } from './file-schemas';

/**
 * One vault file's content, or null when it is absent **or unreadable** (the
 * failure is logged). Lenient by design: for readers that degrade.
 */
export async function readVaultFile(
  mountPointId: string,
  path: string,
  characterId?: string,
): Promise<string | null> {
  try {
    return await readDatabaseDocumentIfExists(mountPointId, path);
  } catch (error) {
    logger.warn('Failed to read vault file', {
      mountPointId,
      path,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * One vault file's content, or null only when it is genuinely absent. An
 * unreadable file throws {@link CharacterVaultUnavailableError}. For writers,
 * which must never mistake "unreadable" for "absent".
 */
export async function readVaultFileStrict(
  mountPointId: string,
  path: string,
  characterId: string,
): Promise<string | null> {
  try {
    return await readDatabaseDocumentIfExists(mountPointId, path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error('Vault file unreadable — refusing to treat it as absent', { mountPointId, characterId, path, error: detail });
    throw new CharacterVaultUnavailableError(characterId, mountPointId, `${path} unreadable: ${detail}`);
  }
}

/**
 * `properties.json`, strictly: null when absent (a caller may seed defaults),
 * the parsed settings when valid, and a throw when present but unreadable or
 * invalid — the settings live nowhere else, so nothing may seed over them.
 */
export async function readCharacterVaultPropertiesForWrite(
  mountPointId: string,
  characterId: string,
): Promise<CharacterVaultProperties | null> {
  const raw = await readVaultFileStrict(mountPointId, CHARACTER_PROPERTIES_JSON_PATH, characterId);
  return raw === null ? null : parsePropertiesStrict(raw, { characterId, mountPointId });
}
