/**
 * Read-only query connections
 *
 * Tools that run model-authored SQL (the Brahma console's `run_sql`) must not
 * share the server's read-write handles. This module opens a separate
 * `readonly: true` connection to the same database file, keyed through
 * {@link applySqlcipherKey} like every other connection, and caches one per
 * file. Statements prepared on it have nothing to write to, whatever the
 * statement text does at prepare time.
 *
 * @module lib/database/backends/sqlite/readonly-query-client
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '@/lib/logger';
import { applySqlcipherKey } from './sqlcipher-key';
import { registerTextCodecFunction } from './text-codec-function';

const log = logger.child({ module: 'database:readonly-query-client' });

declare global {
  var __quilltapReadonlyQueryClients: Map<string, DatabaseType> | undefined;
}

function cache(): Map<string, DatabaseType> {
  if (!globalThis.__quilltapReadonlyQueryClients) {
    globalThis.__quilltapReadonlyQueryClients = new Map();
  }
  return globalThis.__quilltapReadonlyQueryClients;
}

/** True when the handle is backed by a real file (not in-memory / temp). */
function fileBacked(db: DatabaseType): boolean {
  const name = db.name;
  return typeof name === 'string' && name.length > 0 && name !== ':memory:' && !name.startsWith('file::memory:');
}

/**
 * Return a read-only connection to the same file as `rwHandle`, or `null`
 * when the handle is not file-backed or the read-only open fails.
 */
export function getReadonlyQueryClient(rwHandle: DatabaseType): DatabaseType | null {
  if (!fileBacked(rwHandle)) return null;
  const path = rwHandle.name;
  const existing = cache().get(path);
  if (existing && existing.open) return existing;

  try {
    const db = new Database(path, { readonly: true });
    try {
      applySqlcipherKey(db);
      registerTextCodecFunction(db);
      db.pragma('busy_timeout = 5000');
      db.pragma('query_only = ON');
      // Verify probe: forces decryption of page 1.
      db.prepare('SELECT count(*) AS cnt FROM sqlite_master').get();
    } catch (error) {
      db.close();
      throw error;
    }
    cache().set(path, db);
    log.debug('Opened read-only query connection', { path });
    return db;
  } catch (error) {
    log.warn('Could not open read-only query connection', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Close every cached read-only connection. Never throws. */
export function closeReadonlyQueryClients(): void {
  const clients = globalThis.__quilltapReadonlyQueryClients;
  if (!clients) return;
  for (const [path, db] of clients) {
    try {
      db.close();
      log.debug('Closed read-only query connection', { path });
    } catch (error) {
      log.debug('Error closing read-only query connection', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  clients.clear();
}
