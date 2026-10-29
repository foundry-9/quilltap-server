/**
 * Uploaded-Blob Text Backfill
 *
 * Until bug 260, the upload bridges (project store, Quilltap Uploads) stored
 * every chat upload as a blob with text extraction off, so an uploaded
 * `CHANGELOG.md` sat in the project store where `doc_read_file`, `doc_grep`
 * and search could not see it, and an uploaded PDF or DOCX was no better.
 * New uploads are now extracted at ingest (`extractBlobText`, called from
 * `storeMountFile`); this pass brings the old ones up to the same state.
 *
 * Worklist: every blob link in a database-backed store still at
 * `extractionStatus = 'none'` whose path is an extractable type
 * (`EXTRACTABLE_BLOB_EXTENSIONS`). Each is extracted,
 * chunked (`reindexSingleFile`) and, per store, queued for embedding. A file
 * leaves the worklist once it is `converted` or `failed`, so the pass is
 * idempotent and a steady-state boot is one indexed query that returns
 * nothing — no flag needed, and anything a future write path leaves
 * unextracted is healed on the next boot.
 *
 * Runs in the parent after the document-store scan (it writes the
 * mount-index DB and enqueues jobs). Never throws.
 *
 * @module startup/backfill-upload-blob-text
 */
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { extractBlobText } from '@/lib/mount-index/store-file';
import { EXTRACTABLE_BLOB_EXTENSIONS } from '@/lib/mount-index/path-utils';
import { reindexSingleFile } from '@/lib/doc-edit/reindex-file';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';

const logger = createServiceLogger('Startup:UploadBlobTextBackfill');

export interface UploadBlobTextBackfillResult {
  candidates: number;
  extracted: number;
  failed: number;
  storesTouched: number;
}

export async function backfillUploadBlobText(): Promise<UploadBlobTextBackfillResult> {
  const result: UploadBlobTextBackfillResult = { candidates: 0, extracted: 0, failed: 0, storesTouched: 0 };

  try {
    const repos = getRepositories();
    const worklist = await repos.docMountBlobs.listUnextractedByExtensions([...EXTRACTABLE_BLOB_EXTENSIONS]);
    result.candidates = worklist.length;
    if (worklist.length === 0) {
      logger.debug('No unextracted text blobs; nothing to backfill');
      return result;
    }

    logger.info('Extracting text from uploaded blobs', { candidates: worklist.length });

    const touchedStores = new Set<string>();
    for (const blob of worklist) {
      const data = await repos.docMountBlobs.readData(blob.id);
      if (!data) {
        logger.warn('Blob bytes missing; skipping text backfill', {
          mountPointId: blob.mountPointId,
          relativePath: blob.relativePath,
        });
        result.failed++;
        continue;
      }

      const ok = await extractBlobText({
        blobId: blob.id,
        linkId: blob.linkId,
        relativePath: blob.relativePath,
        data,
        mountPointId: blob.mountPointId,
      });
      if (!ok) {
        result.failed++;
        continue;
      }
      result.extracted++;
      touchedStores.add(blob.mountPointId);

      try {
        await reindexSingleFile(blob.mountPointId, blob.relativePath, '');
      } catch (err) {
        logger.warn('Chunking a backfilled blob failed; its text is still readable', {
          mountPointId: blob.mountPointId,
          relativePath: blob.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    for (const mountPointId of touchedStores) {
      try {
        await enqueueEmbeddingJobsForMountPoint(mountPointId);
        await repos.docMountPoints.refreshStats(mountPointId);
      } catch (err) {
        logger.warn('Queueing embeddings for a backfilled store failed', {
          mountPointId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    result.storesTouched = touchedStores.size;

    logger.info('Uploaded-blob text backfill finished', { ...result });
  } catch (err) {
    logger.warn('Uploaded-blob text backfill failed', {
      error: err instanceof Error ? err.message : String(err),
      ...result,
    });
  }

  return result;
}
