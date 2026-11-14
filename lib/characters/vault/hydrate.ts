/**
 * Hydration: turn slim `characters` rows into full `Character`s by reading
 * their vaults. A fold over the layout table (`layout.ts`) — every managed
 * field starts at its schema default and each layout entry overwrites what its
 * files carry. One `IN(...)` query per single-file path plus one listing per
 * folder, however many characters.
 *
 * Failure is asymmetric and vault-only (there are no DB columns to fall back
 * to since the 4.6 cutover):
 *   - {@link applyDocumentStoreOverlayOne} (single, behind `findById`) THROWS
 *     `CharacterVaultUnavailableError` — for a missing anchor and for one that
 *     will not parse. The caller asked for that one character.
 *   - {@link applyDocumentStoreOverlay} (batched, behind `findAll`/`findByIds`)
 *     logs at `error` and DROPS the offending character so one corrupt vault
 *     can't take down the whole roster.
 *
 * @module characters/vault/hydrate
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { Character, CharacterRow } from '@/lib/schemas/character.types';
import { characterManagedDefaults } from '@/lib/schemas/character.types';
import type {
  DocMountDocumentWithLink as DocMountDocument,
} from '@/lib/database/repositories/doc-mount-documents.repository';
import {
  CHARACTER_VAULT_ANCHOR_PATH,
  CHARACTER_VAULT_COMPOSITE_ENTRIES,
  CHARACTER_VAULT_FILE_ENTRIES,
  CHARACTER_VAULT_FILE_PATHS,
  CHARACTER_VAULT_FOLDER_ENTRIES,
  CharacterVaultUnavailableError,
  parsePropertiesStrict,
  type VaultContext,
} from './layout';
import { hasLinkedVault } from './parsers';
import { resolveDefaultSystemPromptId } from '@/lib/characters/default-system-prompt';

/** The loaded vault files for a set of mount points. */
interface VaultFileMaps {
  /** path → (mountPointId → file content), for every single-file path. */
  contentByPath: Map<string, Map<string, string>>;
  /** folder → (mountPointId → documents), for every folder entry. */
  docsByFolder: Map<string, Map<string, DocMountDocument[]>>;
}

/**
 * Load every vault file the layout reads for the given mount points. Does NOT
 * swallow read failures — a store-read exception propagates so the caller fails
 * loudly rather than returning hollow characters.
 */
async function loadVaultFileMaps(mountPointIds: string[]): Promise<VaultFileMaps> {
  const repos = getRepositories();

  const [fileResults, folderResults] = await Promise.all([
    Promise.all(
      CHARACTER_VAULT_FILE_PATHS.map((path) =>
        repos.docMountDocuments.findManyByMountPointsAndPath(mountPointIds, path),
      ),
    ),
    Promise.all(
      CHARACTER_VAULT_FOLDER_ENTRIES.map((entry) =>
        repos.docMountDocuments.findManyByMountPointsInFolder(mountPointIds, entry.folder, '.md'),
      ),
    ),
  ]);

  const contentByPath = new Map<string, Map<string, string>>();
  CHARACTER_VAULT_FILE_PATHS.forEach((path, i) => {
    const byMount = new Map<string, string>();
    for (const doc of fileResults[i]) byMount.set(doc.mountPointId, doc.content);
    contentByPath.set(path, byMount);
  });

  const docsByFolder = new Map<string, Map<string, DocMountDocument[]>>();
  CHARACTER_VAULT_FOLDER_ENTRIES.forEach((entry, i) => {
    const byMount = new Map<string, DocMountDocument[]>();
    for (const doc of folderResults[i]) {
      const list = byMount.get(doc.mountPointId);
      if (list) list.push(doc);
      else byMount.set(doc.mountPointId, [doc]);
    }
    docsByFolder.set(entry.folder, byMount);
  });

  return { contentByPath, docsByFolder };
}

/**
 * Hydrate one row from the loaded vault files.
 *
 * - A row with no linked vault hydrates to the row plus the managed defaults.
 * - A row WITH a linked vault whose anchor (`properties.json`) is absent has a
 *   broken vault: throws {@link CharacterVaultUnavailableError}. So does a
 *   present anchor that will not parse, on a single read (`strictAnchor`);
 *   a list read takes its settings at their defaults instead.
 *
 * No `archivedAt` short-circuit, deliberately (§4.2a): archiving prunes the
 * vault but keeps every managed-field document, so an archived character
 * hydrates exactly like a live one.
 */
function hydrateOne(row: CharacterRow, maps: VaultFileMaps, opts: { strictAnchor: boolean }): Character {
  const out: Character = { ...characterManagedDefaults(), ...row };
  if (!hasLinkedVault(row)) {
    return out;
  }
  const mountPointId = row.characterDocumentMountPointId as string;
  const ctx: VaultContext = { characterId: row.id, mountPointId };

  if (maps.contentByPath.get(CHARACTER_VAULT_ANCHOR_PATH)!.get(mountPointId) === undefined) {
    throw new CharacterVaultUnavailableError(row.id, mountPointId, `${CHARACTER_VAULT_ANCHOR_PATH} missing`);
  }

  for (const entry of CHARACTER_VAULT_FILE_ENTRIES) {
    const raw = maps.contentByPath.get(entry.path)!.get(mountPointId);
    if (raw !== undefined && entry.anchor && opts.strictAnchor) {
      // A single read refuses an anchor that will not parse, exactly as it
      // refuses a missing one: the settings it holds live nowhere else, and a
      // page that showed them at their defaults would invite a save that the
      // write path must then refuse. The 503 puts the repair card up instead.
      Object.assign(out, parsePropertiesStrict(raw, ctx));
      continue;
    }
    Object.assign(out, raw === undefined ? entry.absent?.(ctx) : entry.parse(raw, ctx));
  }

  for (const entry of CHARACTER_VAULT_COMPOSITE_ENTRIES) {
    const raws = new Map<string, string>();
    for (const path of entry.paths) {
      const raw = maps.contentByPath.get(path)!.get(mountPointId);
      if (raw !== undefined) raws.set(path, raw);
    }
    if (raws.size > 0) Object.assign(out, entry.parse(raws, ctx));
  }

  // Folders are vault-authoritative: an empty or all-unparseable folder
  // hydrates as an empty array.
  for (const entry of CHARACTER_VAULT_FOLDER_ENTRIES) {
    const docs = maps.docsByFolder.get(entry.folder)!.get(mountPointId) ?? [];
    Object.assign(out, entry.parseFolder(docs, ctx));
  }

  // The default prompt is one fact in two places; the column wins when it
  // names a prompt that exists (`resolveDefaultSystemPrompt`'s order). Settled
  // here, so every reader — the client included — reads the flag and never
  // re-derives the order.
  const defaultId = resolveDefaultSystemPromptId(out);
  if (defaultId !== null && out.systemPrompts.some((p) => p.isDefault !== (p.id === defaultId))) {
    out.systemPrompts = out.systemPrompts.map((p) => ({ ...p, isDefault: p.id === defaultId }));
  }

  return out;
}

/**
 * Hydrate a list of rows. A row whose vault is unavailable is logged at
 * `error` and DROPPED so one corrupt vault can't take down the whole roster.
 */
export async function applyDocumentStoreOverlay(rows: CharacterRow[]): Promise<Character[]> {
  if (rows.length === 0) {
    return [];
  }

  const mountPointIds = Array.from(
    new Set(rows.filter(hasLinkedVault).map((c) => c.characterDocumentMountPointId as string)),
  );
  if (mountPointIds.length === 0) {
    return rows.map((row) => ({ ...characterManagedDefaults(), ...row }));
  }

  const maps = await loadVaultFileMaps(mountPointIds);

  const out: Character[] = [];
  let dropped = 0;
  for (const row of rows) {
    try {
      // Lists stay lenient about an invalid anchor (its settings read as
      // defaults): dropping the character would hide it from the roster, and
      // the roster is how the operator reaches its repair card.
      out.push(hydrateOne(row, maps, { strictAnchor: false }));
    } catch (err) {
      if (err instanceof CharacterVaultUnavailableError) {
        dropped++;
        logger.error('Dropping character from list — vault unavailable', {
          characterId: err.characterId,
          characterDocumentMountPointId: err.characterDocumentMountPointId,
          detail: err.message,
        });
        continue;
      }
      throw err;
    }
  }
  if (dropped > 0) {
    logger.warn('applyDocumentStoreOverlay dropped characters with unavailable vaults', {
      dropped,
      total: rows.length,
    });
  }
  return out;
}

/**
 * Hydrate one row. Throws `CharacterVaultUnavailableError` when the vault is
 * unavailable — the caller asked for this specific character, so fail loudly
 * (a 503 from the route). Callers that must tolerate a broken vault read the
 * row with `findByIdRaw` instead.
 */
export async function applyDocumentStoreOverlayOne(row: CharacterRow | null): Promise<Character | null> {
  if (!row) {
    return null;
  }
  if (!hasLinkedVault(row)) {
    return { ...characterManagedDefaults(), ...row };
  }
  const maps = await loadVaultFileMaps([row.characterDocumentMountPointId as string]);
  return hydrateOne(row, maps, { strictAnchor: true });
}
