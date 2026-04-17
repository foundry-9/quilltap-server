/**
 * Mount Points API v1 — Blob Collection Endpoint
 *
 * GET  /api/v1/mount-points/[id]/blobs          — List blob metadata
 * POST /api/v1/mount-points/[id]/blobs          — Upload a blob (multipart/form-data)
 *
 * Uploaded images are transcoded to WebP via sharp before storage.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/auth';
import { logger } from '@/lib/logger';
import { badRequest, created, notFound, serverError } from '@/lib/api/responses';
import { transcodeToWebP, normaliseBlobRelativePath } from '@/lib/mount-index/blob-transcode';

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      const mountPoint = await repos.docMountPoints.findById(id);
      if (!mountPoint) return notFound('Mount point');

      const url = new URL(req.url);
      const folder = url.searchParams.get('folder') ?? undefined;
      const blobs = await repos.docMountBlobs.listByMountPoint(id, folder ? { folder } : {});

      logger.debug('[Mount Points v1] Listed blobs', {
        mountPointId: id,
        folder,
        count: blobs.length,
        userId: user.id,
      });
      return NextResponse.json({ blobs });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error listing blobs',
        { mountPointId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to list blobs');
    }
  }
);

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {
      const mountPoint = await repos.docMountPoints.findById(id);
      if (!mountPoint) return notFound('Mount point');

      const contentType = req.headers.get('content-type') || '';
      if (!contentType.includes('multipart/form-data')) {
        return badRequest('Expected multipart/form-data');
      }

      const form = await req.formData();
      const file = form.get('file');
      const relativePath = String(form.get('path') ?? '').trim();
      const description = String(form.get('description') ?? '');

      if (!(file instanceof File)) {
        return badRequest('Missing "file" field in multipart body');
      }
      if (!relativePath) {
        return badRequest('Missing "path" field');
      }

      const rawBytes = Buffer.from(await file.arrayBuffer());
      if (rawBytes.length === 0) {
        return badRequest('Empty file payload');
      }
      const originalMimeType = file.type || 'application/octet-stream';
      const originalFileName = file.name || relativePath.split('/').pop() || 'blob';

      const transcoded = await transcodeToWebP(rawBytes, originalMimeType);
      const finalPath = normaliseBlobRelativePath(relativePath, transcoded.storedMimeType);

      const stored = await repos.docMountBlobs.create({
        mountPointId: id,
        relativePath: finalPath,
        originalFileName,
        originalMimeType,
        storedMimeType: transcoded.storedMimeType,
        sha256: transcoded.sha256,
        description,
        data: transcoded.data,
      });

      logger.info('[Mount Points v1] Uploaded blob', {
        mountPointId: id,
        relativePath: stored.relativePath,
        storedMimeType: stored.storedMimeType,
        sizeBytes: stored.sizeBytes,
        userId: user.id,
      });

      return created({ blob: stored });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error uploading blob',
        { mountPointId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to upload blob');
    }
  }
);
