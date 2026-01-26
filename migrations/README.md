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

**Upgrading from legacy versions**: Deployments running v2.6.0 or earlier must be upgraded to v2.7.0 first before upgrading to newer versions. Legacy migrations (v2.0.0–v2.6.x) are no longer included in the codebase; only v2.7.0+ migrations are available.

## Directory Structure

```
migrations/
├── index.ts              # MigrationRunner class
├── types.ts              # Migration interfaces
├── state.ts              # Migration state persistence
├── lib/
│   ├── logger.ts         # Migration logging
│   ├── s3-utils.ts       # S3 utilities for migrations
│   ├── file-manager.ts   # File operations
│   ├── secrets.ts        # Encryption utilities
│   ├── database-utils.ts # Database utilities
│   └── json-store/       # JSON store utilities for migrations
└── scripts/
    ├── index.ts                              # Migration registry
    ├── add-use-native-web-search-field.ts    # v2.7.0
    ├── cleanup-orphan-file-records.ts        # v2.7.0
    ├── create-mount-points.ts                # v2.7.0
    ├── fix-missing-storage-keys.ts           # v2.7.0
    ├── fix-orphan-persona-participants.ts    # v2.7.0
    ├── add-llm-logs-collection.ts            # v2.8.0
    ├── migrate-to-centralized-data-dir.ts    # v2.8.0
    ├── per-project-mount-points.ts           # v2.8.0
    ├── sqlite-initial-schema.ts              # v2.8.0
    ├── create-folder-entities.ts             # v2.8.0
    └── remove-auth-tables.ts                 # v2.8.0
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

Only v2.7.0+ migrations are included in the codebase. Legacy migrations (v2.0.0–v2.6.x) have been removed.

| ID | Version | Description | Dependencies |
|----|---------|-----------|----|
| add-use-native-web-search-field-v1 | 2.7.0 | Add native web search field to connection profiles | None |
| cleanup-orphan-file-records-v1 | 2.7.0 | Clean up orphaned file records | fix-missing-storage-keys-v1 |
| create-mount-points-v1 | 2.7.0 | Create mount points for file storage | sqlite-initial-schema-v1 |
| fix-missing-storage-keys-v1 | 2.7.0 | Fix missing storage keys in files | create-mount-points-v1 |
| fix-orphan-persona-participants-v1 | 2.7.0 | Fix orphaned PERSONA participants | migrate-personas-to-characters-v1 |
| add-llm-logs-collection-v1 | 2.8.0 | Add LLM logs collection | None |
| migrate-to-centralized-data-dir-v1 | 2.8.0 | Migrate data to centralized data directory | None |
| per-project-mount-points-v1 | 2.8.0 | Add per-project mount points | create-mount-points-v1 |
| sqlite-initial-schema-v1 | 2.8.0 | Create SQLite database schema | None |
| create-folder-entities-v1 | 2.8.0 | Create folder entities | per-project-mount-points-v1 |
| remove-auth-tables-v1 | 2.8.0 | Drop accounts and sessions tables (single-user mode) | None |

**Notes**:
- Minimum supported version for upgrades is v2.7.0
- See `migrations/scripts/index.ts` for the complete list

## Previous System

The migration system was previously implemented as the `qtap-plugin-upgrade` plugin. This was changed because:

1. **Race conditions**: Migrations ran via plugin initialization, which happened after the server started accepting requests
2. **Timing issues**: API requests could arrive before migrations completed, causing Zod validation errors
3. **Complex orchestration**: Plugin enable/disable logic was fragile

The new system runs migrations in `instrumentation.ts` **before** any requests are served, eliminating these issues.
