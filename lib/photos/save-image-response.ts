/**
 * The HTTP answers every save-image door gives — the Salon's message and
 * gallery routes and the wardrobe picture viewer — so `SaveImageDialog` reads
 * one shape whichever route it posted to.
 *
 * @module photos/save-image-response
 */

import { NextResponse } from 'next/server';
import { badRequest, successResponse } from '@/lib/api/responses';
import type { SaveImageToAlbumError, SaveImageToAlbumOutput } from './save-image-to-album';

/** 200 with the saved picture's whereabouts. */
export function savedImageResponse(saved: SaveImageToAlbumOutput): NextResponse {
  return successResponse({
    saved: true,
    mountPoint: saved.mountPointName,
    relativePath: saved.relativePath,
    linkId: saved.linkId,
    keptAt: saved.keptAt,
    fileId: saved.fileId,
    sha256: saved.sha256,
  });
}

/**
 * An expected refusal from `saveImageToAlbum`. Already in that album is not a
 * failure of the request — it is the answer to it — so it is a 409 carrying
 * when the picture was filed, which the dialog says in those words. Anything
 * else is a 400.
 */
export function saveImageErrorResponse(error: SaveImageToAlbumError): NextResponse {
  if (error.code === 'ALREADY_SAVED') {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        relativePath: error.existingRelativePath,
        keptAt: error.existingCreatedAt,
      },
      { status: 409 },
    );
  }
  return badRequest(error.message);
}
