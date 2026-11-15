/**
 * How the theme-draft routes answer a drafts error — one map, so the list
 * route and the item route say the same thing for the same failure.
 *
 * @module lib/themes/drafts/api-errors
 */

import type { NextResponse } from 'next/server';
import { badRequest, conflict, errorResponse, notFound, type ErrorResponse } from '@/lib/api/responses';
import {
  DraftManifestUnreadableError,
  DraftNotInstallableError,
  DraftRevisionConflictError,
  DraftSourceNotFoundError,
  ThemeDraftNotFoundError,
} from './service';
import { ThemeDraftStoreUnavailableError } from './store';

/** The response for a known drafts error, or null to let it fall through to a 500. */
export function draftErrorResponse(error: unknown): NextResponse<ErrorResponse> | null {
  if (error instanceof ThemeDraftNotFoundError) return notFound('Theme draft');
  if (error instanceof DraftRevisionConflictError) {
    return errorResponse(error.message, 409, { currentRevision: error.currentRevision });
  }
  if (error instanceof DraftManifestUnreadableError) return conflict(error.message);
  if (error instanceof DraftNotInstallableError) return errorResponse(error.message, 422, { errors: error.errors });
  if (error instanceof DraftSourceNotFoundError) return badRequest(error.message);
  if (error instanceof ThemeDraftStoreUnavailableError) return errorResponse(error.message, 503);
  return null;
}
