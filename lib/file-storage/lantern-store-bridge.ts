/**
 * Lantern Backgrounds Store Bridge
 *
 * Holds the singleton global "Lantern Backgrounds" database-backed document
 * store — the home for generated story backgrounds and ad-hoc image-tool
 * output when there's no project context to land them in. The mount-point id
 * is persisted in `instance_settings.lanternBackgroundsMountPointId` (provisioned
 * by `provision-lantern-backgrounds-mount-v1`); callers should not look it up
 * via name.
 *
 * Layout inside the mount:
 *
 *   generated/<safeFilename>   — story-background job output
 *   tool/<safeFilename>        — generic `generate_image` tool output, plus
 *                                the `/api/v1/images?action=generate` route
 *
 * Returns the same `mount-blob:{mountPointId}:{blobId}` shim the project and
 * character bridges use, so existing `FileStorageManager` read/delete paths
 * resolve the bytes without change.
 *
 * @module file-storage/lantern-store-bridge
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getLanternBackgroundsMountPointId } from '@/lib/instance-settings';
import { storeMountFile } from '@/lib/mount-index/store-file';
import { buildMountBlobStorageKey } from './project-store-bridge';
import { sanitizeLeafName } from './bridge-path-helpers';

interface LanternStoreTarget {
  mountPointId: string;
}

/**
 * Look up the global Lantern Backgrounds mount, if provisioned. Returns null
 * when the migration hasn't yet run or the mount row has been deleted.
 */
export async function getLanternBackgroundsStore(): Promise<LanternStoreTarget | null> {
  try {
    const id = await getLanternBackgroundsMountPointId();
    if (!id) return null;
    const repos = getRepositories();
    const mp = await repos.docMountPoints.findById(id);
    if (!mp) return null;
    if (mp.mountType !== 'database') return null;
    return { mountPointId: mp.id };
  } catch (error) {
    logger.warn('Failed to resolve Lantern Backgrounds store', {
      context: 'file-storage.lantern-store-bridge',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface WriteLanternBackgroundInput {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Top-level folder inside the mount. */
  subfolder: 'generated' | 'tool';
  description?: string;
}

interface WriteLanternBackgroundResult {
  storageKey: string;
  mountPointId: string;
  blobId: string;
  relativePath: string;
  storedMimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Write a generated image into the Lantern Backgrounds mount. Caller must
 * have verified provisioning via `getLanternBackgroundsStore()`; this throws
 * otherwise. Image bytes that sharp can decode are transcoded to WebP.
 */
export async function writeLanternBackgroundToMountStore(
  input: WriteLanternBackgroundInput
): Promise<WriteLanternBackgroundResult> {
  // In the forked job child the DB connection is readonly and writes are
  // buffered (no read-your-writes). The `linkBlobContent` insert below returns
  // a server-generated `blobId` (deduped by sha, so it may reference a
  // pre-existing blob) that gets baked into the returned `storageKey` and
  // persisted into `files.create`; a buffered/synthetic id would dangle. Route
  // the whole write to the parent's RW connection via host-RPC and return the
  // real result. Mirrors `FileStorageManager.uploadFile`.
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client');
    return callHost<WriteLanternBackgroundResult>(
      'writeLanternBackgroundToMountStore',
      input,
    );
  }

  const target = await getLanternBackgroundsStore();
  if (!target) {
    throw new Error('Lantern Backgrounds mount has not been provisioned');
  }

  const safeName = sanitizeLeafName(input.filename);
  const desiredPath = `${input.subfolder}/${safeName}`;

  const result = await storeMountFile({
    mountPointId: target.mountPointId,
    relativePath: desiredPath,
    data: input.content,
    originalMimeType: input.contentType,
    originalFileName: safeName,
    description: input.description,
    collisionStrategy: 'unique-suffix',
    treatNativeTextAsDocument: false,
    transcodeImages: true,
    extractText: false,
    enqueueEmbedding: false,
    assetStorage: 'database',
  });

  return {
    storageKey: buildMountBlobStorageKey(result.mountPointId, result.blobId!),
    mountPointId: result.mountPointId,
    blobId: result.blobId!,
    relativePath: result.relativePath,
    storedMimeType: result.storedMimeType,
    sizeBytes: result.sizeBytes,
    sha256: result.sha256,
  };
}
