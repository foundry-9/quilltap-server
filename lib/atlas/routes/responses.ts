/**
 * The Atlas routes' shared answer: the Atlas's own refusals (an
 * `AtlasRefusal` is its `status` with its `code` in `details`, a foreign
 * picture a `400`), mapped through the item routes' one error mapping
 * (`itemErrorResponse` / `withItemErrors` in
 * `lib/mount-index/item-folder-routes.ts`), which adds the folder refusals and
 * the archived-character `409` every kind shares.
 *
 * Server-only.
 *
 * @module lib/atlas/routes/responses
 */

import type { NextResponse } from 'next/server';
import { badRequest, errorResponse } from '@/lib/api/responses';
import { AtlasRefusal } from '@/lib/atlas/errors';
import { ForeignAtlasImageError } from '@/lib/atlas/item-images';
import { itemErrorResponse, withItemErrors, type ItemErrorKind } from '@/lib/mount-index/item-folder-routes';

/** The Atlas's own refusals, beside the folder and tombstone ones every kind shares. */
export const ATLAS_ITEM_ERRORS: ItemErrorKind = {
  noun: 'atlas',
  refusals: (error) => {
    if (error instanceof AtlasRefusal) {
      return errorResponse(error.message, error.status, { code: error.code, ...error.details });
    }
    if (error instanceof ForeignAtlasImageError) return badRequest("imageFileId must name one of this entry's own pictures");
    return null;
  },
};

/** The response for an Atlas refusal, or rethrow anything else. */
export function atlasErrorResponse(error: unknown): NextResponse {
  return itemErrorResponse(ATLAS_ITEM_ERRORS, error);
}

/** Wrap a route handler so any Atlas refusal it throws answers through {@link atlasErrorResponse}. */
export const withAtlasErrors = withItemErrors(ATLAS_ITEM_ERRORS);
