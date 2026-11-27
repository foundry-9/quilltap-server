/**
 * The import preview's selection, applied to a bundle before anything is
 * written (#267).
 *
 * `selectedIds` is keyed by the preview's entity kinds (`characters`,
 * `documentStores`, `instanceSettings`, …). A kind that appears in it is cut
 * down to the listed ids — an empty list keeps none of that kind — and a kind
 * that does not appear is imported whole, so an import with no selection at
 * all still brings in everything. A row left out is neither imported nor
 * counted as skipped: as far as this import is concerned the bundle never
 * carried it.
 *
 * Rows that belong to a left-out row follow it out: a character's memories
 * and vault, a project's or group's official store, a store's folders,
 * documents, blobs and project links. A chat's sidecars already follow the
 * chats the import writes (`idMaps.writtenChats`), and its messages ride
 * inside the chat row.
 *
 * @module import/quilltap-import/selection
 */

import { logger } from '@/lib/logger';
import type { AnyExportData } from './types';

const moduleLogger = logger.child({ module: 'import:selection' });

/**
 * Preview kind → the bundle array it names, and how a row of it is
 * identified. Every kind the preview lists is here; a selection naming
 * anything else is ignored.
 */
const SELECTABLE_KINDS: Record<string, { field: keyof AnyExportData; idOf: (row: any) => string | undefined }> = {
  characters: { field: 'characters', idOf: (r) => r.id },
  chats: { field: 'chats', idOf: (r) => r.id },
  roleplayTemplates: { field: 'roleplayTemplates', idOf: (r) => r.id },
  connectionProfiles: { field: 'connectionProfiles', idOf: (r) => r.id },
  imageProfiles: { field: 'imageProfiles', idOf: (r) => r.id },
  embeddingProfiles: { field: 'embeddingProfiles', idOf: (r) => r.id },
  tags: { field: 'tags', idOf: (r) => r.id },
  projects: { field: 'projects', idOf: (r) => r.id },
  groups: { field: 'groups', idOf: (r) => r.id },
  documentStores: { field: 'mountPoints', idOf: (r) => r.id },
  files: { field: 'files', idOf: (r) => r.id },
  promptTemplates: { field: 'promptTemplates', idOf: (r) => r.id },
  providerModels: { field: 'providerModels', idOf: (r) => r.id },
  pluginConfigs: { field: 'pluginConfigs', idOf: (r) => r.id },
  // The preview names an instance setting by its key.
  instanceSettings: { field: 'instanceSettings', idOf: (r) => r.key },
};

/** Store-owned rows, each parented by `mountPointId`. */
const STORE_CHILD_FIELDS = ['folders', 'documents', 'blobs', 'projectLinks'] as const;

/**
 * Return a copy of `data` holding only what `selectedIds` chose. With no
 * selection (or an empty record) the data is returned untouched.
 */
export function applyImportSelection(
  data: AnyExportData,
  selectedIds: Record<string, string[]> | undefined
): AnyExportData {
  if (!selectedIds) return data;
  const kinds = Object.keys(selectedIds).filter((kind) => kind in SELECTABLE_KINDS);
  if (kinds.length === 0) return data;

  const out: AnyExportData = { ...data };
  const dropped: Record<string, number> = {};

  for (const kind of kinds) {
    const { field, idOf } = SELECTABLE_KINDS[kind];
    const rows = data[field] as unknown[] | undefined;
    if (!rows) continue;
    const keep = new Set(selectedIds[kind]);
    const kept = rows.filter((row) => {
      const id = idOf(row);
      return id !== undefined && keep.has(id);
    });
    if (kept.length < rows.length) dropped[kind] = rows.length - kept.length;
    (out as Record<string, unknown>)[field] = kept;
  }

  // A left-out owner takes its store with it: a character's vault, a
  // project's or group's official store.
  const droppedOwnedMounts = new Set<string>();
  const leftOut = <T extends { id: string }>(all: T[] | undefined, kept: T[] | undefined): T[] => {
    if (!all) return [];
    const keptIds = new Set((kept ?? []).map((row) => row.id));
    return all.filter((row) => !keptIds.has(row.id));
  };
  for (const character of leftOut(data.characters, out.characters)) {
    if (character.characterDocumentMountPointId) droppedOwnedMounts.add(character.characterDocumentMountPointId);
  }
  for (const owner of [...leftOut(data.projects, out.projects), ...leftOut(data.groups, out.groups)]) {
    const official = (owner as { officialMountPointId?: string | null }).officialMountPointId;
    if (official) droppedOwnedMounts.add(official);
  }
  if (droppedOwnedMounts.size > 0 && out.mountPoints) {
    out.mountPoints = out.mountPoints.filter((mp) => !droppedOwnedMounts.has(mp.id));
  }

  // A left-out store takes its folders, documents, blobs and links with it.
  if (data.mountPoints && out.mountPoints && out.mountPoints.length < data.mountPoints.length) {
    const keptMounts = new Set(out.mountPoints.map((mp) => mp.id));
    for (const field of STORE_CHILD_FIELDS) {
      const rows = data[field] as Array<{ mountPointId?: string }> | undefined;
      if (!rows) continue;
      // A files export keeps its folders in the same field, and they carry no
      // mountPointId — leave those alone.
      (out as Record<string, unknown>)[field] = rows.filter(
        (row) => row.mountPointId === undefined || keptMounts.has(row.mountPointId)
      );
    }
  }

  // A left-out character takes its memories with it.
  if (data.memories && data.characters && out.characters && out.characters.length < data.characters.length) {
    const keptCharacters = new Set(out.characters.map((c) => c.id));
    out.memories = data.memories.filter((memory) => keptCharacters.has(memory.characterId));
  }

  moduleLogger.debug('Applied import selection', {
    kinds,
    dropped,
    droppedOwnedMounts: droppedOwnedMounts.size,
  });

  return out;
}
