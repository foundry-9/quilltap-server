/**
 * SQLite Backend Module
 *
 * Exports all SQLite-related functionality for the database abstraction layer.
 */

// Main backend
export { SQLiteBackend, createSQLiteBackend } from './backend';

// Client management
export {
  getSQLiteClient,
  closeSQLiteClient,
  isSQLiteConnected,
  setupSQLiteShutdownHandlers,
  withTransaction,
  withImmediateTransaction,
  withExclusiveTransaction,
  runCheckpoint,
  getDatabaseStats,
  vacuumDatabase,
  getRawDatabase,
} from './client';

// Database protection
export {
  runIntegrityCheck,
  startPeriodicCheckpoints,
  stopPeriodicCheckpoints,
  runShutdownCheckpoint,
  runBackupCheckpoint,
} from './protection';

// Physical backup
export {
  createPhysicalBackup,
  applyRetentionPolicy,
} from './physical-backup';

// JSON column utilities
export {
  toJson,
  fromJson,
  fromJsonSafe,
  shouldStoreAsJson,
  prepareForStorage,
  hydrateRow,
  documentToRow,
  rowToDocument,
  detectJsonColumns,
  jsonExtract,
  jsonArrayContains,
  jsonArrayContainsAny,
  jsonArrayLength,
  embeddingToBlob,
  blobToEmbedding,
} from './json-columns';

// Query translation
export {
  translateFilter,
  translateSort,
  translatePagination,
  translateUpdate,
  buildSelectQuery,
  buildCountQuery,
  buildUpdateQuery,
  buildDeleteQuery,
} from './query-translator';
