/**
 * System Tools — Quilltap (`.qtap`) export: the stream, the entity picker and
 * the preview.
 *
 * Served by `app/api/v1/system/tools/route.ts`:
 *   POST ?action=export           - stream an NDJSON `.qtap` export
 *   GET  ?action=export-entities  - entities offered for export, by type
 *   GET  ?action=export-preview   - preview an export's contents
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { RequestContext } from '@/lib/api/middleware';
import { buildContentDisposition } from '@/lib/api/content-disposition';
import { serverError, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { listPortableInstanceSettings } from '@/lib/instance-settings';
import { previewExport } from '@/lib/export/quilltap-export-service';
import { isFileExcludedFromExport } from '@/lib/export/excluded-files';
import { createNdjsonStream, QTAP_NDJSON_CONTENT_TYPE } from '@/lib/export/ndjson-writer';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type { ExportEntityType } from '@/lib/export/types';

// ============================================================================
// Schemas
// ============================================================================

/** Every `ExportEntityType`, as an enum-like object (the mapped type keeps it exhaustive). */
const EXPORT_ENTITY_TYPES: { [K in ExportEntityType]: K } = {
  characters: 'characters',
  chats: 'chats',
  'roleplay-templates': 'roleplay-templates',
  'prompt-templates': 'prompt-templates',
  'connection-profiles': 'connection-profiles',
  'image-profiles': 'image-profiles',
  'embedding-profiles': 'embedding-profiles',
  tags: 'tags',
  projects: 'projects',
  groups: 'groups',
  'document-stores': 'document-stores',
  files: 'files',
  'provider-models': 'provider-models',
  'plugin-configs': 'plugin-configs',
  'instance-settings': 'instance-settings',
};

/** An export entity type; a missing or unknown one is a 400 with the old wording. */
const exportEntityTypeSchema = (missingMessage: string) =>
  z.enum(EXPORT_ENTITY_TYPES, {
    error: (issue) =>
      issue.input === undefined || issue.input === null || issue.input === ''
        ? missingMessage
        : `Unknown entity type: ${String(issue.input)}`,
  });

const exportScopeSchema = z.enum(['all', 'selected']);

/** POST ?action=export body. */
export const exportBodySchema = z.object({
  type: exportEntityTypeSchema('Missing required field: type'),
  scope: exportScopeSchema.nullish(),
  selectedIds: z.array(z.string()).nullish(),
  includeMemories: z.boolean().nullish(),
});

/** GET ?action=export-entities query. */
export const exportEntitiesQuerySchema = z.object({
  type: exportEntityTypeSchema('Missing type parameter'),
});

/** GET ?action=export-preview query (as read from the search params). */
export const exportPreviewQuerySchema = z.object({
  type: exportEntityTypeSchema('Missing required parameter: type'),
  scope: exportScopeSchema.default('all'),
  selectedIds: z.array(z.string()),
  includeMemories: z.boolean(),
});

// ============================================================================
// Handlers
// ============================================================================

export async function handleExport(req: NextRequest, context: RequestContext) {
  const { user } = context;

  try {
    const { type, scope, selectedIds, includeMemories } = exportBodySchema.parse(await req.json());

    logger.info('[System Tools v1] Creating export (NDJSON stream)', {
      userId: user.id,
      type,
      scope,
      selectedIdsCount: selectedIds?.length || 0,
      includeMemories: includeMemories || false,
    });

    const stream = createNdjsonStream(user.id, {
      type,
      scope: scope || 'all',
      selectedIds: selectedIds ?? undefined,
      includeMemories: includeMemories || false,
    });

    const timestamp = new Date().toISOString().split('T')[0];
    const sanitizedType = type.replace(/_/g, '-');
    const filename = `quilltap-${sanitizedType}-${timestamp}.qtap`;

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': QTAP_NDJSON_CONTENT_TYPE,
        'Content-Disposition': buildContentDisposition(filename, 'attachment'),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    logger.error(
      '[System Tools v1] Export failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to create export');
  }
}

export async function handleExportEntities(req: NextRequest, context: RequestContext) {
  const { user } = context;
  const { type } = exportEntitiesQuerySchema.parse({
    type: req.nextUrl.searchParams.get('type') ?? undefined,
  });

  try {
    logger.debug('[System Tools v1] Fetching entities for export', { userId: user.id, type });

    const repos = getUserRepositories(user.id);
    const globalRepos = getRepositories();

    let entities: Array<{ id: string; name: string; memoryCount?: number }> = [];
    let totalMemoryCount = 0;

    switch (type) {
      case 'characters': {
        // Archived characters don't appear in the export picker: a tombstone
        // export would carry the pruned vault only, and the full bundle
        // already exists as an ARCHIVE file (spec §4.1 — "block it").
        const characters = (await repos.characters.findAll()).filter((c) => !c.archivedAt);
        for (const char of characters) {
          const memories = await repos.memories.findByCharacterId(char.id);
          const charMemoryCount = memories.length;
          totalMemoryCount += charMemoryCount;
          entities.push({
            id: char.id,
            name: char.name,
            memoryCount: charMemoryCount,
          });
        }
        break;
      }

      case 'chats': {
        const chats = await repos.chats.findAll();
        const characters = await repos.characters.findAll();
        const allMemoriesArrays = await Promise.all(
          characters.map((char) => repos.memories.findByCharacterId(char.id))
        );
        const allMemories = allMemoriesArrays.flat();

        for (const chat of chats) {
          const chatMemories = allMemories.filter((m) => m.chatId === chat.id);
          const chatMemoryCount = chatMemories.length;
          totalMemoryCount += chatMemoryCount;
          entities.push({
            id: chat.id,
            name: chat.title,
            memoryCount: chatMemoryCount,
          });
        }
        break;
      }

      case 'roleplay-templates': {
        const templates = await globalRepos.roleplayTemplates.findAll();
        const userTemplates = templates.filter(
          (t) => !t.isBuiltIn && t.userId === user.id
        );
        entities = userTemplates.map((t) => ({ id: t.id, name: t.name }));
        break;
      }

      case 'connection-profiles': {
        const profiles = await repos.connections.findAll();
        entities = profiles.map((p) => ({ id: p.id, name: p.name }));
        break;
      }

      case 'image-profiles': {
        const profiles = await repos.imageProfiles.findAll();
        entities = profiles.map((p) => ({ id: p.id, name: p.name }));
        break;
      }

      case 'embedding-profiles': {
        const profiles = await repos.embeddingProfiles.findAll();
        entities = profiles.map((p) => ({ id: p.id, name: p.name }));
        break;
      }

      case 'tags': {
        const tags = await repos.tags.findAll();
        entities = tags.map((t) => ({ id: t.id, name: t.name }));
        break;
      }

      case 'projects': {
        const projects = await repos.projects.findAll();
        entities = projects.map((p) => ({ id: p.id, name: p.name }));
        break;
      }

      case 'groups': {
        const groups = await repos.groups.findAll();
        entities = groups.map((g) => ({ id: g.id, name: g.name }));
        break;
      }

      case 'document-stores': {
        // Document stores are instance-scoped, not user-scoped — global repos
        // on purpose, mirroring resolveExportIds in the NDJSON writer.
        const stores = await globalRepos.docMountPoints.findAll();
        entities = stores.map((s) => ({ id: s.id, name: s.name }));
        break;
      }

      case 'files': {
        // Backups and character-archive bundles are never offered — they are
        // `.qtap` files themselves and don't nest inside another export.
        const files = (await repos.files.findAll()).filter((f) => !isFileExcludedFromExport(f));
        entities = files.map((f) => ({ id: f.id, name: f.originalFilename }));
        break;
      }

      case 'prompt-templates': {
        const templates = await globalRepos.promptTemplates.findAll();
        const userTemplates = templates.filter(
          (t) => !t.isBuiltIn && t.userId === user.id
        );
        entities = userTemplates.map((t) => ({ id: t.id, name: t.name }));
        break;
      }

      case 'provider-models': {
        // Instance-global catalogue, no user filter.
        const models = await globalRepos.providerModels.findAll();
        entities = models.map((m) => ({
          id: m.id,
          name: `${m.provider} / ${m.modelId}`,
        }));
        break;
      }

      case 'plugin-configs': {
        const configs = await globalRepos.pluginConfigs.findByUserId(user.id);
        entities = configs.map((c) => ({ id: c.id, name: c.pluginName }));
        break;
      }

      case 'instance-settings': {
        // Keyed by setting key — instance_settings has no id column. Keys that
        // only make sense inside the exporting instance are already withheld.
        const settings = await listPortableInstanceSettings();
        entities = settings.map((s) => ({ id: s.key, name: s.key }));
        break;
      }
    }

    logger.info('[System Tools v1] Entities fetched for export', {
      userId: user.id,
      type,
      count: entities.length,
      totalMemoryCount,
    });

    return successResponse({
      entities,
      memoryCount: totalMemoryCount,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Failed to fetch entities for export',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch entities');
  }
}

export async function handleExportPreview(req: NextRequest, context: RequestContext) {
  const { user } = context;
  const { searchParams } = req.nextUrl;
  const selectedIdsParam = searchParams.get('selectedIds');

  if (!searchParams.get('type')) {
    logger.warn('[System Tools v1] Export preview missing type parameter', { userId: user.id });
  }

  const { type, scope, selectedIds, includeMemories } = exportPreviewQuerySchema.parse({
    type: searchParams.get('type') ?? undefined,
    scope: searchParams.get('scope') || undefined,
    selectedIds: selectedIdsParam ? selectedIdsParam.split(',').filter(Boolean) : [],
    includeMemories: searchParams.get('includeMemories') === 'true',
  });

  try {
    logger.info('[System Tools v1] Previewing export', {
      userId: user.id,
      type,
      scope,
      selectedIdsCount: selectedIds.length,
      includeMemories,
    });

    const preview = await previewExport(user.id, {
      type,
      scope,
      selectedIds,
      includeMemories,
    });
    return successResponse(preview);
  } catch (error) {
    logger.error(
      '[System Tools v1] Export preview failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to preview export');
  }
}
