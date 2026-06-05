/**
 * Import preview: count what each entity type would import and flag conflicts
 * (by id, with a cross-instance name-match fallback for characters) without
 * writing anything.
 *
 * @module import/quilltap-import/preview
 */

import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type { Character } from '@/lib/schemas/types';
import type { QuilltapExport, ExportedCharacter } from '@/lib/export/types';
import { getExportData, type ImportPreview, type ImportPreviewEntity } from './types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/**
 * Previews what will be imported without actually importing
 */
export async function previewImport(
  userId: string,
  exportData: QuilltapExport
): Promise<ImportPreview> {
  moduleLogger.info('Starting import preview', { userId });

  const repos = getUserRepositories(userId);
  const conflictCounts: Record<string, number> = {};

  // Helper to check existence
  const checkExists = async <T extends { id: string }>(
    items: T[] | undefined,
    finder: (id: string) => Promise<T | null>,
    entityType: string
  ): Promise<ImportPreviewEntity[]> => {
    if (!items) return [];

    const results: ImportPreviewEntity[] = [];
    let conflicts = 0;

    for (const item of items) {
      const existing = await finder(item.id);
      const exists = !!existing;
      if (exists) conflicts++;

      results.push({
        id: item.id,
        name: ('name' in item ? item.name : 'title' in item ? (item as any).title : 'Unknown') as string,
        exists,
      });
    }

    if (conflicts > 0) {
      conflictCounts[entityType] = conflicts;
    }

    return results;
  };

  const data = getExportData(exportData);

  // Check characters with name-based fallback for cross-instance imports
  const checkCharacterExists = async (
    items: ExportedCharacter[] | undefined
  ): Promise<ImportPreviewEntity[]> => {
    if (!items) return [];

    const results: ImportPreviewEntity[] = [];
    let conflicts = 0;

    // Pre-fetch all existing characters for name matching
    const existingCharacters = await repos.characters.findAll();
    const existingByName = new Map<string, Character>();
    for (const char of existingCharacters) {
      existingByName.set(char.name.toLowerCase(), char);
    }

    for (const item of items) {
      // First check by ID (same instance re-import)
      const existingById = await repos.characters.findById(item.id);
      if (existingById) {
        conflicts++;
        results.push({ id: item.id, name: item.name, exists: true });
        continue;
      }

      // Fallback: check by name (cross-instance import)
      const existingByNameMatch = existingByName.get(item.name.toLowerCase());
      if (existingByNameMatch) {
        conflicts++;
        results.push({
          id: item.id,
          name: item.name,
          exists: true,
          matchedExistingId: existingByNameMatch.id,
        });
        continue;
      }

      results.push({ id: item.id, name: item.name, exists: false });
    }

    if (conflicts > 0) {
      conflictCounts.characters = conflicts;
    }

    return results;
  };

  // Preview all entity types
  const [characters, chats, tags, connectionProfiles, imageProfiles, embeddingProfiles, roleplayTemplates, projects] =
    await Promise.all([
      checkCharacterExists(data.characters),
      checkExists(
        data.chats,
        (id) => repos.chats.findById(id),
        'chats'
      ),
      checkExists(
        data.tags,
        (id) => repos.tags.findById(id),
        'tags'
      ),
      checkExists(
        data.connectionProfiles,
        (id) => repos.connections.findById(id),
        'connectionProfiles'
      ),
      checkExists(
        data.imageProfiles,
        (id) => repos.imageProfiles.findById(id),
        'imageProfiles'
      ),
      checkExists(
        data.embeddingProfiles,
        (id) => repos.embeddingProfiles.findById(id),
        'embeddingProfiles'
      ),
      checkExists(
        data.roleplayTemplates,
        (id) => {
          const globalRepos = getRepositories();
          return globalRepos.roleplayTemplates.findById(id);
        },
        'roleplayTemplates'
      ),
      checkExists(
        data.projects,
        (id) => repos.projects.findById(id),
        'projects'
      ),
    ]);

  const preview: ImportPreview = {
    manifest: exportData.manifest,
    entities: {
      ...(characters.length > 0 && { characters }),
      ...(chats.length > 0 && { chats }),
      ...(tags.length > 0 && { tags }),
      ...(connectionProfiles.length > 0 && { connectionProfiles }),
      ...(imageProfiles.length > 0 && { imageProfiles }),
      ...(embeddingProfiles.length > 0 && { embeddingProfiles }),
      ...(roleplayTemplates.length > 0 && { roleplayTemplates }),
      ...(projects.length > 0 && { projects }),
      ...(data.memories && {
        memories: { count: data.memories.length },
      }),
    },
    conflictCounts,
  };

  moduleLogger.info('Import preview completed', {
    userId,
    conflicts: Object.keys(conflictCounts).length,
  });

  return preview;
}
