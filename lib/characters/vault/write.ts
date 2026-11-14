/**
 * Writes to a character vault, driven by the layout table (`layout.ts`):
 *
 *   - {@link writeCharacterVaultManagedFields} — full projection of an
 *     in-memory character into every layout file. Two sanctioned callers: the
 *     repository binding (`binding.ts` — create, and the restore fallback,
 *     through `provisionOfficialStore`) and the frozen 4.6 cutover migration.
 *     Never a raw row (#148).
 *   - {@link applyDocumentStoreWriteOverlay} — patch routing: each layout entry
 *     the patch touches writes its file(s); the managed fields are stripped
 *     from what the row receives.
 *
 * @module characters/vault/write
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { Character, CharacterRow } from '@/lib/schemas/character.types';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { projectArrayIntoVaultFolder } from '@/lib/mount-index/vault-projection';
import {
  CHARACTER_VAULT_ENTRIES,
  MANAGED_FIELDS,
  entriesTouchedBy,
  withoutManagedFields,
  type VaultContext,
  type VaultFolderEntry,
} from './layout';
import { hasLinkedVault } from './parsers';
import { readVaultFileStrict } from './readers';

/**
 * Replace a folder entry's items with `items`. Sweeps only files that parse as
 * items (`ownsFile`), so a hand-written draft survives (D6).
 */
export async function projectFolderEntry<T extends { id: string }>(
  entry: VaultFolderEntry<T>,
  mountPointId: string,
  items: readonly T[],
  characterId: string,
): Promise<void> {
  await projectArrayIntoVaultFolder(
    mountPointId,
    entry.folder,
    items,
    (item) => ({ fileName: entry.fileNameFor(item), content: entry.renderItem(item) }),
    characterId,
    { ownsFile: entry.ownsFile },
  );
}

// ============================================================================
// FULL PROJECTION
// ============================================================================

export interface VaultManagedFieldsWriteInput {
  character: Character;
}

export interface VaultManagedFieldsWriteResult {
  /** Single-file writes performed (not counting folder contents). */
  singleFileWriteCount: number;
  systemPromptsWritten: number;
  scenariosWritten: number;
  /** True when the character has no physicalDescription and the physical files were skipped. */
  physicalSkippedNoPrimary: boolean;
}

/**
 * Project every managed field of an in-memory character into its vault. A
 * file whose codec renders `null` (no metadata in hand, no physical
 * description) is left as it is. Wardrobe and Inventory are side-stores with
 * their own writers and are never touched here.
 */
export async function writeCharacterVaultManagedFields(
  mountPointId: string,
  { character }: VaultManagedFieldsWriteInput,
): Promise<VaultManagedFieldsWriteResult> {
  const ctx: VaultContext = { characterId: character.id, mountPointId };
  const result: VaultManagedFieldsWriteResult = {
    singleFileWriteCount: 0,
    systemPromptsWritten: 0,
    scenariosWritten: 0,
    physicalSkippedNoPrimary: false,
  };

  for (const entry of CHARACTER_VAULT_ENTRIES) {
    switch (entry.kind) {
      case 'file': {
        const content = entry.render(character);
        if (content === null) break;
        await writeDatabaseDocument(mountPointId, entry.path, content);
        result.singleFileWriteCount++;
        break;
      }
      case 'composite': {
        const files = entry.render(character, ctx);
        if (files === null) {
          result.physicalSkippedNoPrimary = true;
          break;
        }
        for (const [path, content] of files) {
          await writeDatabaseDocument(mountPointId, path, content);
          result.singleFileWriteCount++;
        }
        break;
      }
      case 'folder': {
        const items = entry.items(character);
        await projectFolderEntry(entry as VaultFolderEntry<{ id: string }>, mountPointId, items, character.id);
        if (entry.field === 'systemPrompts') result.systemPromptsWritten = items.length;
        else result.scenariosWritten = items.length;
        break;
      }
    }
  }

  logger.debug('[CharacterVault] Projected a whole character into its vault', { ...ctx, ...result });
  return result;
}

// ============================================================================
// PATCH ROUTING
// ============================================================================

/**
 * Route a patch's managed fields to the vault and return what the row should
 * receive (the patch minus every managed field).
 *
 * `existing` is the raw row when the caller already holds it (`update()` reads
 * it once for the archive guard); otherwise it is read here.
 *
 * Throws if a vault write fails, so the caller never commits a row write the
 * vault disagrees with. A character with no vault but a patch carrying managed
 * fields is a bug elsewhere (every character is provisioned on create); the
 * vault is provisioned on the fly — the scaffold only — and logged loudly.
 */
export async function applyDocumentStoreWriteOverlay(
  characterId: string,
  patch: Partial<Character>,
  existing?: CharacterRow | null,
): Promise<Partial<CharacterRow>> {
  const touched = entriesTouchedBy(patch);
  if (touched.length === 0) {
    return patch as Partial<CharacterRow>;
  }

  const repos = getRepositories();
  let row = existing !== undefined ? existing : await repos.characters.findByIdRaw(characterId);
  if (!row) {
    // The row write will hit the same not-found; let it surface there.
    return withoutManagedFields(patch) as Partial<CharacterRow>;
  }

  if (!hasLinkedVault(row)) {
    logger.error(
      'applyDocumentStoreWriteOverlay: character has no linked vault but the patch carries managed fields; provisioning on the fly',
      { characterId, managedFieldsInPatch: Object.keys(patch).filter((k) => MANAGED_FIELDS.has(k as never)) },
    );
    const ensured = await ensureCharacterVault(row);
    row = { ...row, characterDocumentMountPointId: ensured.mountPointId };
  }

  const mountPointId = row.characterDocumentMountPointId as string;
  const ctx: VaultContext = { characterId, mountPointId };
  const current = (path: string) => readVaultFileStrict(mountPointId, path, characterId);

  for (const entry of touched) {
    switch (entry.kind) {
      case 'file':
        await writeDatabaseDocument(mountPointId, entry.path, await entry.renderPatch(patch, current, ctx));
        break;
      case 'composite':
        for (const [path, content] of await entry.renderPatch(patch, current, ctx)) {
          await writeDatabaseDocument(mountPointId, path, content);
        }
        break;
      case 'folder': {
        const items = (patch[entry.field] ?? []) as Array<{ id: string }>;
        await projectFolderEntry(entry as VaultFolderEntry<{ id: string }>, mountPointId, items, characterId);
        break;
      }
    }
  }

  logger.debug('[CharacterVault] Routed a patch to the vault', {
    ...ctx,
    entries: touched.map((e) => (e.kind === 'folder' ? e.folder : e.kind === 'file' ? e.path : e.paths.join('+'))),
  });
  return withoutManagedFields(patch) as Partial<CharacterRow>;
}
