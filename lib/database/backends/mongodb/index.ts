/**
 * MongoDB Backend Module
 *
 * Exports the MongoDB backend implementation for the database abstraction layer.
 */

export { MongoDBBackend, createMongoDBBackend } from './backend';

// Re-export existing MongoDB utilities for backwards compatibility
export {
  getMongoClient,
  getMongoDatabase,
  closeMongoConnection,
  isMongoConnected,
  setupMongoDBShutdownHandlers,
} from '@/lib/mongodb/client';
