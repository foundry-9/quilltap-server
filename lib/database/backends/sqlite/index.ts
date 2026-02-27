/**
 * SQLite Backend Module
 *
 * Exports all SQLite-related functionality for the database abstraction layer.
 */

// Main backend
export { SQLiteBackend, SQLiteCollection, createSQLiteBackend } from './backend';

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
  createLLMLogsPhysicalBackup,
  applyRetentionPolicy,
} from './physical-backup';

// LLM Logs client
export {
  getLLMLogsSQLiteClient,
  closeLLMLogsSQLiteClient,
  getRawLLMLogsDatabase,
  isLLMLogsDegraded,
} from './llm-logs-client';

// LLM Logs protection
export {
  runLLMLogsIntegrityCheck,
  startLLMLogsPeriodicCheckpoints,
  stopLLMLogsPeriodicCheckpoints,
  runLLMLogsShutdownCheckpoint,
  runLLMLogsBackupCheckpoint,
} from './llm-logs-protection';

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
