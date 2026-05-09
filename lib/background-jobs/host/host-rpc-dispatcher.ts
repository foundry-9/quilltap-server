/**
 * Host-side dispatcher for `host-rpc` requests from the forked job-runner
 * child. Each method runs against the parent's RW database connection
 * directly (NOT inside the per-job buffered-writes transaction), so any
 * side-effects committed here persist independently of whether the job's
 * later buffered writes succeed.
 *
 * Currently only `uploadFile` is supported — the child cannot execute
 * `writeProjectFileToMountStore` because that path issues real DB writes
 * (`docMountBlobs.create`, `docMountFiles.create`, `docMountPoints.refreshStats`)
 * with server-computed return values that the child proxy's synthetic
 * write results cannot model.
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
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
    default: {
      const exhaustive: never = method;
      throw new Error(`Unknown host-rpc method: ${String(exhaustive)}`);
    }
  }
}
