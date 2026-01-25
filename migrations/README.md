# Quilltap Migrations System

This directory contains the migration system for Quilltap. Migrations run automatically at server startup **before** any requests are served, ensuring data compatibility.

## Architecture

Migrations run in `instrumentation.ts` during Next.js server startup:

```
Server Start
    │
    ▼
instrumentation.ts
    │
    ├── Run Migrations (must complete)
    │   ├── Sort by dependencies
    │   ├── Check if each migration should run
    │   ├── Execute pending migrations
    │   └── If failure: process.exit(1)
    │
    ├── Initialize Database (SQLite or legacy MongoDB)
    ├── Initialize Plugins
    └── Initialize File Storage
```

**Critical**: If migrations fail, the server exits immediately. This prevents serving requests with incompatible data formats.

## Database Backend

**Default**: SQLite (zero external dependencies)
- New installations use SQLite by default
- No configuration required
- Migrations run automatically on startup

**Legacy**: MongoDB (for existing deployments)
- Set `DATABASE_BACKEND=mongodb` environment variable to use MongoDB
- MongoDB-specific migrations (validate-mongodb-config, migrate-json-to-mongodb) only run when MongoDB is explicitly enabled
- For migrations from MongoDB to SQLite, use the standalone CLI tool: `scripts/mongo-to-sqlite-cli.js`

## Directory Structure

```
migrations/
├── index.ts              # MigrationRunner class
├── types.ts              # Migration interfaces
├── state.ts              # Migration state persistence (MongoDB)
├── lib/
│   ├── logger.ts         # Migration logging
│   ├── mongodb-utils.ts  # MongoDB connection for migrations
│   ├── s3-utils.ts       # S3 utilities for migrations
│   ├── file-manager.ts   # Legacy file operations
│   ├── secrets.ts        # Encryption utilities
│   └── json-store/       # Legacy JSON store for data migration
└── scripts/
    ├── index.ts                              # Migration registry
    ├── 001-convert-openrouter-profiles.ts
    ├── 002-enable-provider-plugins.ts
    ├── 003-validate-mongodb-config.ts
    ├── ... (21 migrations total)
    └── 021-create-folder-entities.ts
```

## Adding a New Migration

1. **Create the migration file** in `migrations/scripts/`:

```typescript
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { getMongoDatabase, isMongoDBBackend } from '../lib/mongodb-utils';

export const myNewMigration: Migration = {
  id: 'my-migration-v1',
  description: 'Description of what this migration does',
  introducedInVersion: '2.7.0',
  dependsOn: ['migrate-json-to-mongodb-v1'], // optional dependencies

  async shouldRun(): Promise<boolean> {
    // Return true if migration needs to run
    if (!isMongoDBBackend()) return false;
    // Check for data that needs migration
    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      // Migration logic here
      const db = await getMongoDatabase();
      const result = await db.collection('my_collection').updateMany(...);

      return {
        id: 'my-migration-v1',
        success: true,
        itemsAffected: result.modifiedCount,
        message: `Updated ${result.modifiedCount} documents`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        id: 'my-migration-v1',
        success: false,
        itemsAffected: 0,
        message: 'Migration failed',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
```

2. **Add to the registry** in `migrations/scripts/index.ts`:

```typescript
import { myNewMigration } from './my-new-migration';

export const migrations: Migration[] = [
  // ... existing migrations ...
  myNewMigration,
];
```

## Migration Dependencies

Migrations can declare dependencies on other migrations:

```typescript
export const myMigration: Migration = {
  id: 'my-migration-v1',
  dependsOn: ['migrate-json-to-mongodb-v1', 'add-multi-character-fields-v1'],
  // ...
};
```

The MigrationRunner sorts migrations topologically to ensure dependencies run first.

## Migration State

Migration state is stored in MongoDB in the `migrations_state` collection:

```json
{
  "_id": "migration_state",
  "completedMigrations": [
    {
      "id": "migration-id-v1",
      "completedAt": "2026-01-21T12:00:00.000Z",
      "quilltapVersion": "2.7.0",
      "itemsAffected": 42,
      "message": "Updated 42 documents"
    }
  ],
  "lastChecked": "2026-01-21T12:00:00.000Z",
  "quilltapVersion": "2.7.0"
}
```

## Idempotency

All migrations must be idempotent:

1. **shouldRun()**: Check if migration actually needs to run
2. **Completion tracking**: Don't re-run completed migrations
3. **Safe operations**: Use `$set` instead of overwriting, check for existing data

## Failure Handling

- If a migration fails, the server **exits with code 1**
- Subsequent migrations are not attempted
- Fix the issue and restart the server
- The failed migration will be retried on next startup

## Logging

Migrations log extensively to help diagnose issues:

```typescript
logger.info('Migration started', {
  context: 'migration.my-migration',
  migrationId: 'my-migration-v1',
});

logger.debug('Processing documents', {
  context: 'migration.my-migration',
  count: 100,
});

logger.error('Migration failed', {
  context: 'migration.my-migration',
  error: 'Document not found',
});
```

## Testing Migrations

1. **Local testing**:
   - Create test data with old format
   - Run `npm run devssl`
   - Verify migrations run in logs
   - Check data format after migration

2. **Docker testing**:
   - Build fresh Docker image
   - Start with test data
   - Verify migrations run on startup
   - Restart - verify migrations are skipped

## Current Migrations

| ID | Description | For | Dependencies |
|----|-------------|-----|--------------|
| convert-openrouter-profiles-v1 | Convert old OpenRouter profile format | All | None |
| enable-provider-plugins-v1 | Enable required provider plugins | All | convert-openrouter-profiles-v1 |
| validate-mongodb-config-v1 | Validate MongoDB configuration | Legacy MongoDB | None |
| validate-s3-config-v1 | Validate S3 configuration | All | None |
| migrate-json-to-mongodb-v1 | Migrate JSON data to MongoDB | Legacy MongoDB | validate-mongodb-config-v1 |
| migrate-files-to-s3-v1 | Migrate files to S3 storage | All | validate-s3-config-v1, migrate-json-to-mongodb-v1 |
| sqlite-initial-schema-v1 | Create SQLite database schema | SQLite (Default) | None |
| ... | ... | ... | ... |

**Notes**:
- **Legacy MongoDB migrations** only run if `DATABASE_BACKEND=mongodb` is set
- **SQLite** migrations run on all default installations
- See `migrations/scripts/index.ts` for the complete list

## Previous System

The migration system was previously implemented as the `qtap-plugin-upgrade` plugin. This was changed because:

1. **Race conditions**: Migrations ran via plugin initialization, which happened after the server started accepting requests
2. **Timing issues**: API requests could arrive before migrations completed, causing Zod validation errors
3. **Complex orchestration**: Plugin enable/disable logic was fragile

The new system runs migrations in `instrumentation.ts` **before** any requests are served, eliminating these issues.
