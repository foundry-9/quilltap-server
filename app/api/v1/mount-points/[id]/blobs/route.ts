/**
 * Mount Points API v1 — Blob Collection Endpoint
 *
 * GET  /api/v1/mount-points/[id]/blobs          — List blob metadata
 * POST /api/v1/mount-points/[id]/blobs          — Upload a blob (multipart/form-data)
 *
 * Image bitmaps are transcoded to WebP via sharp; WebP, SVG, and all other
 * MIME types are stored as-is. PDF and DOCX uploads additionally have their
 * text extracted into doc_mount_blobs.extractedText and chunked for embedding
 * so they become searchable alongside native-text documents. Arbitrary binary
 * uploads are stored as blob mirrors with no chunks until a future converter
 * can derive text for them.
 */

import path from 'path';
import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/auth';
import { logger } from '@/lib/logger';
import { badRequest, created, notFound, serverError } from '@/lib/api/responses';
import { transcodeToWebP, normaliseBlobRelativePath } from '@/lib/mount-index/blob-transcode';
import { convertBufferToPlainText } from '@/lib/mount-index/converters';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { reindexSingleFile } from '@/lib/doc-edit/reindex-file';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import type { DocMountFile } from '@/lib/schemas/mount-index.types';

type BlobMirrorFileType = 'pdf' | 'docx' | 'blob';

function detectBlobFileType(relativePath: string): BlobMirrorFileType {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  return 'blob';
}

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

      // Transcode bitmap images to WebP; everything else (WebP, SVG, PDFs,
      // arbitrary binaries) passes through untouched.
      const transcoded = await transcodeToWebP(rawBytes, originalMimeType);
      const finalPath = normaliseBlobRelativePath(relativePath, transcoded.storedMimeType);

      // Ensure any folder segments in the virtual path exist so the unified
      // tree view can resolve the blob's location.
      const folderDir = path.dirname(finalPath);
      const folderId =
        folderDir !== '.' ? await ensureFolderPath(id, folderDir) : null;

      let blob = await repos.docMountBlobs.create({
        mountPointId: id,
        relativePath: finalPath,
        originalFileName,
        originalMimeType,
        storedMimeType: transcoded.storedMimeType,
        sha256: transcoded.sha256,
        description,
        data: transcoded.data,
      });

      const mirrorFileType = detectBlobFileType(finalPath);

      // PDF and DOCX: extract plain text from the original bytes (not the
      // transcoded copy — only images are transcoded). Other binaries get
      // no text representation for now.
      if (mirrorFileType === 'pdf' || mirrorFileType === 'docx') {
        try {
          const extractedText = await convertBufferToPlainText(rawBytes, mirrorFileType);
          if (extractedText && extractedText.trim().length > 0) {
            const extractedTextSha256 = createHash('sha256')
              .update(extractedText, 'utf-8')
              .digest('hex');
            const updated = await repos.docMountBlobs.updateExtractedText(blob.id, {
              extractedText,
              extractedTextSha256,
              extractionStatus: 'converted',
              extractionError: null,
            });
            if (updated) blob = updated;
          } else {
            const updated = await repos.docMountBlobs.updateExtractedText(blob.id, {
              extractedText: null,
              extractedTextSha256: null,
              extractionStatus: 'failed',
              extractionError: 'Converter produced no text',
            });
            if (updated) blob = updated;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn('[Mount Points v1] Text extraction failed for blob', {
            mountPointId: id,
            relativePath: finalPath,
            fileType: mirrorFileType,
            error: msg,
          });
          const updated = await repos.docMountBlobs.updateExtractedText(blob.id, {
            extractedText: null,
            extractedTextSha256: null,
            extractionStatus: 'failed',
            extractionError: msg,
          });
          if (updated) blob = updated;
        }
      }

      // Mirror into doc_mount_files so the tree, search, and chunking layers
      // see this blob alongside native-text documents. For 'blob' type the
      // record exists purely so the tree can show it — no chunks, no
      // conversion status beyond 'skipped'.
      const hasExtractedText =
        blob.extractionStatus === 'converted' && !!blob.extractedText;
      const now = new Date().toISOString();
      const existingFile = await repos.docMountFiles.findByMountPointAndPath(id, finalPath);

      if (existingFile) {
        // Clear any stale chunks from a prior extraction; reindex will
        // recreate them below if the new blob has extractedText.
        await repos.docMountChunks.deleteByFileId(existingFile.id);
        await repos.docMountFiles.update(existingFile.id, {
          sha256: blob.sha256,
          fileSizeBytes: blob.sizeBytes,
          lastModified: now,
          source: 'database',
          fileType: mirrorFileType,
          folderId,
          conversionStatus: hasExtractedText ? 'converted' : 'skipped',
          conversionError: blob.extractionError ?? null,
          plainTextLength: blob.extractedText?.length ?? null,
          chunkCount: 0,
        } as Partial<DocMountFile>);
      } else {
        await repos.docMountFiles.create({
          mountPointId: id,
          relativePath: finalPath,
          fileName: path.basename(finalPath),
          fileType: mirrorFileType,
          sha256: blob.sha256,
          fileSizeBytes: blob.sizeBytes,
          lastModified: now,
          source: 'database',
          folderId,
          conversionStatus: hasExtractedText ? 'converted' : 'skipped',
          conversionError: blob.extractionError ?? null,
          plainTextLength: blob.extractedText?.length ?? null,
          chunkCount: 0,
        });
      }

      // Chunk + enqueue embeddings in the background when we have text to
      // feed the embedder. Matches the fire-and-forget pattern used by
      // doc_write_file in the doc-edit tool handler.
      if (hasExtractedText) {
        reindexSingleFile(id, finalPath, '')
          .then(() => Promise.all([
            enqueueEmbeddingJobsForMountPoint(id),
            repos.docMountPoints.refreshStats(id),
          ]))
          .catch(err => {
            logger.warn('[Mount Points v1] Background reindex failed for blob', {
              mountPointId: id,
              relativePath: finalPath,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      } else {
        repos.docMountPoints.refreshStats(id).catch(() => { /* best-effort */ });
      }

      // Let any other subscribers know the virtual file system changed.
      emitDocumentWritten({ mountPointId: id, relativePath: finalPath });

      logger.info('[Mount Points v1] Uploaded blob', {
        mountPointId: id,
        relativePath: blob.relativePath,
        storedMimeType: blob.storedMimeType,
        sizeBytes: blob.sizeBytes,
        fileType: mirrorFileType,
        extractionStatus: blob.extractionStatus,
        userId: user.id,
      });

      return created({ blob });
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
