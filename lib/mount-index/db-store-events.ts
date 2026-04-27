/**
 * Database-backed Document Store Events
 *
 * For mount points with mountType === 'database' there is no filesystem to
 * watch. Instead, every mutation performed through `database-store.ts`
 * emits an event here, and the mount watcher (and anything else that needs
 * to react to content changes — search re-index, UI live-refresh) subscribes
 * to those events. This module is the moral equivalent of the chokidar
 * watcher for filesystem-backed stores.
 *
 * Events:
 *   'document-written'   — A DB-backed document was created or updated.
 *   'document-deleted'   — A DB-backed document was removed.
 *   'document-moved'     — A DB-backed document was renamed.
 *
 * Each event payload includes the mountPointId and the affected relativePath
 * (or from/to paths for moves). Subscribers are expected to be cheap and
 * idempotent — the watcher debounces its own embedding-scheduler calls, so
 * firing the same event twice in rapid succession is safe.
 */

import { EventEmitter } from 'events';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('MountIndex:DbStoreEvents');

export interface DocumentWrittenEvent {
  mountPointId: string;
  relativePath: string;
}

export interface DocumentDeletedEvent {
  mountPointId: string;
  relativePath: string;
}

export interface DocumentMovedEvent {
  mountPointId: string;
  fromRelativePath: string;
  toRelativePath: string;
}

type EventMap = {
  'document-written': [DocumentWrittenEvent];
  'document-deleted': [DocumentDeletedEvent];
  'document-moved': [DocumentMovedEvent];
};

class TypedEmitter extends EventEmitter {
  override emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): boolean {
    return super.emit(event, ...args);
  }
  override on<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override off<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

const emitter = new TypedEmitter();
// The watcher subscribes permanently, plus potentially other listeners — lift
// the default cap so Node doesn't warn.
emitter.setMaxListeners(50);

export function emitDocumentWritten(event: DocumentWrittenEvent): void {
  logger.debug('document-written event', event);
  emitter.emit('document-written', event);
}

export function emitDocumentDeleted(event: DocumentDeletedEvent): void {
  logger.debug('document-deleted event', event);
  emitter.emit('document-deleted', event);
}

export function emitDocumentMoved(event: DocumentMovedEvent): void {
  logger.debug('document-moved event', event);
  emitter.emit('document-moved', event);
}

export function onDocumentWritten(listener: (event: DocumentWrittenEvent) => void): () => void {
  emitter.on('document-written', listener);
  return () => emitter.off('document-written', listener);
}

export function onDocumentDeleted(listener: (event: DocumentDeletedEvent) => void): () => void {
  emitter.on('document-deleted', listener);
  return () => emitter.off('document-deleted', listener);
}

export function onDocumentMoved(listener: (event: DocumentMovedEvent) => void): () => void {
  emitter.on('document-moved', listener);
  return () => emitter.off('document-moved', listener);
}
