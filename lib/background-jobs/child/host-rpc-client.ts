/**
 * Child-side host-RPC client.
 *
 * The forked job-runner child has a readonly SQLCipher connection, so any
 * operation that needs an RW write (notably `FileStorageManager.uploadFile`,
 * which routes through `writeProjectFileToMountStore` and writes blob/mirror
 * rows synchronously) must be performed on the host. This module ships a
 * `callHost(method, args)` helper that:
 *
 *   1. allocates a UUID `requestId`,
 *   2. posts a `host-rpc` IPC message to the parent,
 *   3. parks a Promise in the `pending` map keyed by the requestId, and
 *   4. resolves or rejects when the matching `host-rpc-response` arrives.
 *
 * Pending requests do not need to be cleared on disconnect because the
 * child exits when its IPC channel drops — the whole process and its
 * pending Promises die together.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import type {
  ChildHostRpcRequestMessage,
  ParentHostRpcResponseMessage,
} from '../ipc-types';

const log = logger.child({ module: 'jobs:child:host-rpc' });

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

const pending = new Map<string, PendingRequest>();

export function callHost<T = unknown>(
  method: ChildHostRpcRequestMessage['method'],
  ...args: unknown[]
): Promise<T> {
  if (typeof process.send !== 'function') {
    return Promise.reject(
      new Error('Host RPC unavailable: child has no IPC channel'),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const requestId = randomUUID();
    const msg: ChildHostRpcRequestMessage = {
      type: 'host-rpc',
      requestId,
      method,
      args,
    };
    pending.set(requestId, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    try {
      process.send!(msg);
    } catch (err) {
      pending.delete(requestId);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function handleHostRpcResponse(msg: ParentHostRpcResponseMessage): void {
  const entry = pending.get(msg.requestId);
  if (!entry) {
    log.warn('host-rpc response for unknown requestId', {
      requestId: msg.requestId,
    });
    return;
  }
  pending.delete(msg.requestId);
  if (msg.ok) {
    entry.resolve(msg.result);
    return;
  }
  const err = new Error(msg.error?.message ?? 'Host RPC failed');
  if (msg.error?.stack) {
    (err as Error & { stack?: string }).stack = msg.error.stack;
  }
  entry.reject(err);
}
