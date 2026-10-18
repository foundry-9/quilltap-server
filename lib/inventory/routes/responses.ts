/**
 * The Inventory routes' shared answers: one mapping from every refusal the
 * Inventory can raise to its HTTP response (with the refusal's `code` in
 * `details`), and the one serialiser for objects on the wire.
 *
 * Server-only.
 *
 * @module lib/inventory/routes/responses
 */

import { NextResponse } from 'next/server';
import { badRequest, conflict, errorResponse, notFound } from '@/lib/api/responses';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';
import {
  InventoryFolderConflictError,
  InventoryFolderNotFoundError,
  InventoryFolderPathError,
  InventoryItemNotInLocationError,
} from '@/lib/inventory/folders';
import { InventoryRefusal } from '@/lib/inventory/errors';
import { InventorySvgError } from '@/lib/inventory/svg';
import { ForeignInventoryImageError } from '@/lib/inventory/item-images';
import { logger } from '@/lib/logger';

/** The response for an Inventory refusal, or rethrow anything else. */
export function inventoryErrorResponse(error: unknown): NextResponse {
  if (error instanceof InventoryRefusal) {
    return errorResponse(error.message, error.status, { code: error.code, ...error.details });
  }
  if (error instanceof InventorySvgError) return badRequest(error.message, { code: 'INVALID_SVG' });
  if (error instanceof InventoryFolderPathError) return badRequest(error.message);
  if (error instanceof InventoryItemNotInLocationError) return badRequest(error.message);
  if (error instanceof ForeignInventoryImageError) return badRequest("imageFileId must name one of this object's own pictures");
  if (error instanceof InventoryFolderNotFoundError) return notFound('Inventory folder');
  if (error instanceof InventoryFolderConflictError) return conflict(error.message);
  if (error instanceof CharacterArchivedError) {
    logger.info('[Inventory routes] Refused a write to an archived character', { context: 'inventory' });
    return conflict("An archived character's inventory cannot be changed");
  }
  throw error;
}
