/**
 * Mount Points API v1 — Blob Item Endpoint
 *
 * GET    /api/v1/mount-points/[id]/blobs/*  — Stream blob bytes
 * DELETE /api/v1/mount-points/[id]/blobs/*  — Remove a blob
 * PATCH  /api/v1/mount-points/[id]/blobs/*  — Update the blob's description
 *
 * The [...path] catch-all carries the blob's relativePath within the mount
 * point (e.g. "images/avatar.webp"). This keeps Markdown references like
 * `![alt](images/avatar.webp)` resolvable against `/api/v1/mount-points/:id/blobs/`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/auth';
import { logger } from '@/lib/logger';
import { notFound, serverError, successResponse } from '@/lib/api/responses';

type Params = { id: string; path: string[] };

function joinPath(parts: string[]): string {
  return parts.map(p => decodeURIComponent(p)).join('/');
}

export const GET = createAuthenticatedParamsHandler<Params>(
  async (_req: NextRequest, { repos }: RequestContext, { id, path }) => {
    try {
      const relativePath = joinPath(path);
      const meta = await repos.docMountBlobs.findByMountPointAndPath(id, relativePath);
      if (!meta) return notFound('Blob');
      const data = await repos.docMountBlobs.readData(meta.id);
      if (!data) return notFound('Blob data');

      // Copy into a fresh Uint8Array — Next.js' NextResponse body expects a
      // BlobPart / Uint8Array, and a Buffer's backing pool may otherwise
      // bleed unrelated bytes.
      const body = new Uint8Array(data.length);
      data.copy(body);

      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': meta.storedMimeType,
          'Content-Length': String(meta.sizeBytes),
          'Cache-Control': 'private, max-age=3600',
          'X-Blob-Sha256': meta.sha256,
        },
      });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error serving blob',
        { mountPointId: id, path },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to serve blob');
    }
  }
);

export const DELETE = createAuthenticatedParamsHandler<Params>(
  async (_req: NextRequest, { user, repos }: RequestContext, { id, path }) => {
    try {
      const relativePath = joinPath(path);
      const deleted = await repos.docMountBlobs.deleteByMountPointAndPath(id, relativePath);
      if (!deleted) return notFound('Blob');
      logger.info('[Mount Points v1] Deleted blob', {
        mountPointId: id,
        relativePath,
        userId: user.id,
      });
      return successResponse({ success: true });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error deleting blob',
        { mountPointId: id, path },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete blob');
    }
  }
);

export const PATCH = createAuthenticatedParamsHandler<Params>(
  async (req: NextRequest, { user, repos }: RequestContext, { id, path }) => {
    try {
      const relativePath = joinPath(path);
      const meta = await repos.docMountBlobs.findByMountPointAndPath(id, relativePath);
      if (!meta) return notFound('Blob');
      const body = await req.json();
      const description = typeof body?.description === 'string' ? body.description : '';
      const updated = await repos.docMountBlobs.updateDescription(meta.id, description);
      logger.info('[Mount Points v1] Updated blob description', {
        mountPointId: id,
        relativePath,
        userId: user.id,
      });
      return successResponse({ blob: updated });
    } catch (error) {
      logger.error(
        '[Mount Points v1] Error updating blob description',
        { mountPointId: id, path },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to update blob description');
    }
  }
);
