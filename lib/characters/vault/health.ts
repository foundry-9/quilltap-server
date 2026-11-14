/**
 * A character vault's health, and the one repair the system may perform on it
 * (D1, D10 of refactor-character-repository-and-vault.md).
 *
 * The report reads the row and the layout files directly — it never hydrates,
 * so it answers for exactly the characters `findById` refuses (a 503). The
 * repair seeds an ABSENT `properties.json` / `metadata.json` (or scaffolds a
 * vault the character lacks entirely) and nothing else: a present file that
 * fails to parse is reported and left for the operator, because the settings
 * and the content it holds live nowhere else (#148).
 *
 * @module characters/vault/health
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { CharacterRow } from '@/lib/schemas/character.types';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import {
  CHARACTER_METADATA_JSON_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_VAULT_ANCHOR_PATH,
  CHARACTER_VAULT_FILE_PATHS,
  CHARACTER_VAULT_KEYSTONES,
  parsePropertiesStrict,
} from './layout';
import { CharacterVaultMetadataSchema, CharacterVaultPhysicalPromptsSchema } from './file-schemas';
import { ensureCharacterMetadataFile, ensureCharacterPropertiesFile } from './scaffold';

export interface VaultFileHealth {
  path: string;
  /** A populated vault always holds it. */
  keystone: boolean;
  present: boolean;
  /** Null when absent; false with `error` when present but unreadable. */
  parses: boolean | null;
  error?: string;
}

export interface CharacterVaultHealth {
  characterId: string;
  mountPointId: string | null;
  /** The row names a vault and the vault exists. */
  linked: boolean;
  /**
   * The character opens: linked, and the anchor is present and parses. (A
   * list read still shows a character whose anchor will not parse, with its
   * settings at their defaults; the single read behind its page refuses it.)
   */
  readable: boolean;
  files: VaultFileHealth[];
  /** What `repair-vault` would seed (absent files it is allowed to write). */
  repairable: string[];
  /** Present files that fail to parse — the operator's to fix; never rewritten. */
  needsAttention: string[];
}

/** The files the repair may seed when they are absent (D1). Never a present file. */
const SEEDABLE = [CHARACTER_PROPERTIES_JSON_PATH, CHARACTER_METADATA_JSON_PATH] as const;

function parseError(path: string, raw: string, ctx: { characterId: string; mountPointId: string }): string | null {
  try {
    if (path === CHARACTER_PROPERTIES_JSON_PATH) {
      parsePropertiesStrict(raw, ctx);
      return null;
    }
    if (path === CHARACTER_METADATA_JSON_PATH) {
      const result = CharacterVaultMetadataSchema.safeParse(JSON.parse(raw));
      return result.success ? null : 'not a JSON object';
    }
    if (path === CHARACTER_PHYSICAL_PROMPTS_JSON_PATH) {
      const result = CharacterVaultPhysicalPromptsSchema.safeParse(JSON.parse(raw));
      return result.success ? null : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    }
    // Markdown is text; any content reads.
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The strict parser's error leads with who and where; the report wants why.
    return message.replace(/^Character \S+ has no usable vault \([^)]*\): /, '');
  }
}

/** Report on a character's vault, from the row and the file list alone. */
export async function inspectCharacterVault(row: CharacterRow): Promise<CharacterVaultHealth> {
  const repos = getRepositories();
  const mountPointId = row.characterDocumentMountPointId ?? null;
  const mount = mountPointId ? await repos.docMountPoints.findById(mountPointId) : null;
  const linked = !!mount;
  const ctx = { characterId: row.id, mountPointId: mountPointId ?? '' };

  const files: VaultFileHealth[] = [];
  for (const path of CHARACTER_VAULT_FILE_PATHS) {
    const keystone = CHARACTER_VAULT_KEYSTONES.includes(path);
    const doc = linked ? await repos.docMountDocuments.findByMountPointAndPath(mountPointId as string, path) : null;
    if (!doc) {
      files.push({ path, keystone, present: false, parses: null });
      continue;
    }
    const error = parseError(path, doc.content ?? '', ctx);
    files.push(error === null ? { path, keystone, present: true, parses: true } : { path, keystone, present: true, parses: false, error });
  }

  const anchor = files.find((f) => f.path === CHARACTER_VAULT_ANCHOR_PATH)!;
  const health: CharacterVaultHealth = {
    characterId: row.id,
    mountPointId,
    linked,
    readable: linked && anchor.present && anchor.parses === true,
    files,
    repairable: linked
      ? files.filter((f) => !f.present && (SEEDABLE as readonly string[]).includes(f.path)).map((f) => f.path)
      : [...SEEDABLE],
    needsAttention: files.filter((f) => f.parses === false).map((f) => f.path),
  };
  logger.debug('[CharacterVault] Vault health inspected', {
    characterId: row.id,
    mountPointId,
    linked,
    readable: health.readable,
    repairable: health.repairable,
    needsAttention: health.needsAttention,
  });
  return health;
}

/**
 * Seed what is absent and may be seeded; write nothing else. A character with
 * no vault at all gets a scaffolded one. Returns the paths written and the
 * health afterwards.
 */
export async function repairCharacterVault(
  row: CharacterRow,
): Promise<{ seeded: string[]; health: CharacterVaultHealth }> {
  if (row.archivedAt) {
    throw new Error(`Character ${row.id} is archived; rehydrate it before repairing its vault`);
  }
  const before = await inspectCharacterVault(row);
  const seeded: string[] = [];
  let current = row;

  if (!before.linked) {
    const ensured = await ensureCharacterVault({ ...row, characterDocumentMountPointId: null });
    current = { ...row, characterDocumentMountPointId: ensured.mountPointId };
    seeded.push(...(ensured.created ? CHARACTER_VAULT_FILE_PATHS : []));
    logger.warn('[CharacterVault] Repair provisioned a vault for a character that had none', {
      characterId: row.id,
      mountPointId: ensured.mountPointId,
      created: ensured.created,
      adopted: ensured.adopted ?? false,
    });
  } else {
    const mountPointId = row.characterDocumentMountPointId as string;
    if (await ensureCharacterPropertiesFile(mountPointId)) seeded.push(CHARACTER_PROPERTIES_JSON_PATH);
    if (await ensureCharacterMetadataFile(mountPointId)) seeded.push(CHARACTER_METADATA_JSON_PATH);
  }

  const health = await inspectCharacterVault(current);
  logger.info('[CharacterVault] Vault repaired', {
    characterId: row.id,
    seeded,
    stillNeedsAttention: health.needsAttention,
  });
  return { seeded, health };
}
