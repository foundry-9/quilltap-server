/**
 * System Tools — delete all user data, and its preview.
 *
 * Served by `app/api/v1/system/tools/route.ts`:
 *   GET  ?action=delete-data-preview
 *   POST ?action=delete-data
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { RequestContext } from '@/lib/api/middleware';
import { serverError, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { deleteAllUserData, previewDeleteAllUserData } from '@/lib/backup/restore-service';

const DELETE_CONFIRMATION = 'DELETE_ALL_MY_DATA';

/** POST ?action=delete-data body. */
export const deleteDataBodySchema = z.object({
  confirm: z.literal(DELETE_CONFIRMATION, {
    error: `Confirmation required. Send { "confirm": "${DELETE_CONFIRMATION}" }`,
  }),
  // Archived-character bundles are kept unless the client explicitly opts
  // into wiping them (spec §4.7 — the destructive choice must be explicit).
  keepArchivedCharacterBundles: z.boolean().optional(),
});

export async function handleDeleteData(req: NextRequest, context: RequestContext) {
  const { user } = context;

  try {
    const raw: unknown = await req.json();
    if ((raw as { confirm?: unknown } | null)?.confirm !== DELETE_CONFIRMATION) {
      logger.warn('[System Tools v1] Delete all data attempted without confirmation', {
        userId: user.id,
      });
    }
    const body = deleteDataBodySchema.parse(raw);

    const keepArchivedCharacterBundles = body.keepArchivedCharacterBundles !== false;

    logger.info('[System Tools v1] Starting complete data deletion', {
      userId: user.id,
      keepArchivedCharacterBundles,
    });

    const summary = await deleteAllUserData(user.id, { keepArchivedCharacterBundles });

    logger.info('[System Tools v1] Complete data deletion finished', { userId: user.id, summary });

    return successResponse({ success: true, summary });
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    logger.error(
      '[System Tools v1] Delete all data failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to delete data');
  }
}

export async function handleDeleteDataPreview(_req: NextRequest, context: RequestContext) {
  const { user } = context;

  try {
    logger.debug('[System Tools v1] Generating delete preview', { userId: user.id });

    const summary = await previewDeleteAllUserData(user.id);

    logger.info('[System Tools v1] Delete preview generated', { userId: user.id, summary });

    return successResponse({ success: true, summary });
  } catch (error) {
    logger.error(
      '[System Tools v1] Preview delete failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to preview data deletion');
  }
}
