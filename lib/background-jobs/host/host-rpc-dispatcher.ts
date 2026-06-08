/**
 * Host-side dispatcher for `host-rpc` requests from the forked job-runner
 * child. Each method runs against the parent's RW database connection
 * directly (NOT inside the per-job buffered-writes transaction), so any
 * side-effects committed here persist independently of whether the job's
 * later buffered writes succeed.
 *
 * Supported methods all share one root cause: they issue real DB writes
 * (`docMountBlobs.create`, `docMountFiles.create` / `docMountFileLinks.linkBlobContent`,
 * `docMountPoints.refreshStats`) whose server-computed return values
 * (`storageKey`, `blobId`, `linkId`) the child proxy's synthetic buffered
 * writes cannot model:
 *   - `uploadFile` — project-scoped `FileStorageManager.uploadFile`
 *     (→ `writeProjectFileToMountStore`)
 *   - `writeCharacterAvatarToVault` — project-less character-vault avatar writes
 *   - `writeLanternBackgroundToMountStore` — project-less Lantern background writes
 *
 * Each bridge short-circuits to `callHost(...)` when running in the child;
 * the parent re-enters the same bridge here on its RW connection (where
 * `QUILLTAP_JOB_CHILD` is unset, so there is no re-dispatch loop).
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type {
  ChildHostRpcRequestMessage,
  ParentHostRpcResponseMessage,
} from '../ipc-types';

const log = logger.child({ module: 'jobs:host-rpc' });

export async function dispatchHostRpc(
  msg: ChildHostRpcRequestMessage,
): Promise<ParentHostRpcResponseMessage> {
  try {
    const result = await runMethod(msg.method, msg.args);
    return {
      type: 'host-rpc-response',
      requestId: msg.requestId,
      ok: true,
      result,
    };
  } catch (err) {
    log.warn('Host RPC failed', {
      method: msg.method,
      requestId: msg.requestId,
      error: getErrorMessage(err),
    });
    return {
      type: 'host-rpc-response',
      requestId: msg.requestId,
      ok: false,
      error: {
        message: getErrorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    };
  }
}

async function runMethod(
  method: ChildHostRpcRequestMessage['method'],
  args: unknown[],
): Promise<unknown> {
  switch (method) {
    case 'uploadFile': {
      const { fileStorageManager } = await import('@/lib/file-storage/manager');
      const params = args[0] as Parameters<typeof fileStorageManager.uploadFile>[0];
      return fileStorageManager.uploadFile(params);
    }
    case 'writeCharacterAvatarToVault': {
      const { writeCharacterAvatarToVault } = await import(
        '@/lib/file-storage/character-vault-bridge'
      );
      const params = args[0] as Parameters<typeof writeCharacterAvatarToVault>[0];
      return writeCharacterAvatarToVault(params);
    }
    case 'writeLanternBackgroundToMountStore': {
      const { writeLanternBackgroundToMountStore } = await import(
        '@/lib/file-storage/lantern-store-bridge'
      );
      const params = args[0] as Parameters<typeof writeLanternBackgroundToMountStore>[0];
      return writeLanternBackgroundToMountStore(params);
    }
    default: {
      const exhaustive: never = method;
      throw new Error(`Unknown host-rpc method: ${String(exhaustive)}`);
    }
  }
}
