/**
 * Mount Point Scan Runner
 *
 * Orchestrates scanning all enabled document mount points. Iterates
 * sequentially to avoid disk I/O contention, validates that each mount
 * point's basePath is still accessible, and enqueues embedding jobs
 * for newly created chunks after each scan completes.
 *
 * @module mount-index/scan-runner
 */

import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { scanMountPoint, ScanResult } from './scanner';
import { enqueueEmbeddingJobsForMountPoint } from './embedding-scheduler';

const logger = createServiceLogger('MountIndex:ScanRunner');

/**
 * Scan all enabled mount points sequentially.
 *
 * For each enabled mount point:
 *  1. Verify the basePath is still accessible
 *  2. Run the scanner (walk, hash, convert, chunk, persist)
 *  3. Enqueue embedding jobs for any new chunks
 *
 * @returns Array of ScanResult, one per mount point attempted
 */
export async function scanAllMountPoints(): Promise<ScanResult[]> {
  const repos = getRepositories();
  const results: ScanResult[] = [];

  // Get all enabled mount points
  const mountPoints = await repos.docMountPoints.findEnabled();

  if (mountPoints.length === 0) {
    logger.debug('No enabled mount points to scan');
    return results;
  }

  logger.info('Starting mount point scan for all enabled mount points', {
    count: mountPoints.length,
    names: mountPoints.map(mp => mp.name),
  });

  // Scan each mount point sequentially to avoid disk I/O contention
  for (const mountPoint of mountPoints) {
    try {
      // Database-backed stores have no filesystem basePath to validate;
      // scanMountPoint delegates to the database rescan path directly.
      if (mountPoint.mountType !== 'database') {
        // Verify the basePath still exists and is accessible
        try {
          await fs.access(mountPoint.basePath);
        } catch {
          logger.warn('Mount point base path is not accessible, skipping', {
            mountPointId: mountPoint.id,
            basePath: mountPoint.basePath,
          });
          await repos.docMountPoints.updateScanStatus(
            mountPoint.id,
            'error',
            `Base path not accessible: ${mountPoint.basePath}`
          );
          results.push({
            mountPointId: mountPoint.id,
            filesScanned: 0,
            filesNew: 0,
            filesModified: 0,
            filesDeleted: 0,
            chunksCreated: 0,
            errors: [`Base path not accessible: ${mountPoint.basePath}`],
          });
          continue;
        }
      }

      const result = await scanMountPoint(mountPoint);
      results.push(result);

      // After scanning, enqueue embedding jobs for new chunks without embeddings
      if (result.chunksCreated > 0) {
        await enqueueEmbeddingJobs(mountPoint.id);
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error scanning mount point', {
        mountPointId: mountPoint.id,
        name: mountPoint.name,
        error: errorMsg,
      });
      results.push({
        mountPointId: mountPoint.id,
        filesScanned: 0,
        filesNew: 0,
        filesModified: 0,
        filesDeleted: 0,
        chunksCreated: 0,
        errors: [errorMsg],
      });
    }
  }

  logger.info('All mount point scans completed', {
    totalMountPoints: mountPoints.length,
    totalNew: results.reduce((s, r) => s + r.filesNew, 0),
    totalModified: results.reduce((s, r) => s + r.filesModified, 0),
    totalDeleted: results.reduce((s, r) => s + r.filesDeleted, 0),
    totalChunks: results.reduce((s, r) => s + r.chunksCreated, 0),
    totalErrors: results.reduce((s, r) => s + r.errors.length, 0),
  });

  return results;
}

/**
 * Enqueue embedding jobs for chunks that were created during a scan.
 *
 * @param mountPointId - The mount point whose new chunks need embeddings
 */
async function enqueueEmbeddingJobs(mountPointId: string): Promise<void> {
  try {
    const enqueued = await enqueueEmbeddingJobsForMountPoint(mountPointId);
    logger.info('Embedding jobs enqueued for mount chunks', {
      mountPointId,
      enqueued,
    });
  } catch (error) {
    logger.warn('Failed to enqueue embedding jobs for mount point', {
      mountPointId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Re-export for direct use
export { scanMountPoint, type ScanResult } from './scanner';
