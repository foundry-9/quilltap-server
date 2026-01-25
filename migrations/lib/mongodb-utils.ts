// This module has been removed. It remains only as a stub to prevent
// accidental imports from failing during transitional refactors.
// All database migrations now use SQLite exclusively.

export function getMongoDatabase(): never {
  throw new Error('mongodb-utils has been removed. Use SQLite utilities instead.');
}

export async function closeMongoDB(): Promise<void> {
  // no-op; MongoDB support removed
}

export function testMongoDBConnection(): { success: boolean; message: string } {
  return { success: true, message: 'MongoDB support removed; using SQLite.' };
}

export function validateMongoDBConfig(): { isConfigured: boolean; errors: string[] } {
  return { isConfigured: false, errors: ['MongoDB support removed'] };
}

export function isMongoDBBackend(): boolean {
  return false;
}
