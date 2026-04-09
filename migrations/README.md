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
│   ├── database-utils.ts # SQLite database utilities
│   └── json-store/       # JSON store utilities for migrations
└── scripts/
    ├── index.ts                              # Migration registry
    ├── add-use-native-web-search-field.ts    # v2.7.0
    ├── cleanup-orphan-file-records.ts        # v2.7.0
    ├── create-mount-points.ts                # v2.7.0
    ├── fix-missing-storage-keys.ts           # v2.7.0
    ├── fix-orphan-persona-participants.ts    # v2.7.0 (historical)
    ├── rename-persona-columns.ts             # v4.2.0
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
import { isSQLiteBackend, getSQLiteDatabase } from '../lib/database-utils';

export const myNewMigration: Migration = {
  id: 'my-migration-v1',
  description: 'Description of what this migration does',
  introducedInVersion: '2.9.0',

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    // Check if migration needs to run
    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const db = getSQLiteDatabase();
      // Migration logic here

      return {
        id: 'my-migration-v1',
        success: true,
        itemsAffected: 0,
        message: 'Migration completed',
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
  dependsOn: ['sqlite-initial-schema-v1'],
  // ...
};
```

The MigrationRunner sorts migrations topologically to ensure dependencies run first.

## Migration State

Migration state is stored in SQLite in the `migrations_state` table:

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
|----|---------|----|-----------|
| add-use-native-web-search-field-v1 | 2.7.0 | Add useNativeWebSearch field to connection profiles to decouple tool from native web search (SQLite only - no-op) | None |
| fix-missing-storage-keys-v1 | 2.7.0 | Fix missing storage keys in file records (SQLite only - no-op) | None |
| cleanup-orphan-file-records-v1 | 2.7.0 | Cleanup orphaned file records without mount points (SQLite only - no-op) | None |
| fix-orphan-persona-participants-v1 | 2.7.0 | Fix orphaned PERSONA participants in chats (SQLite only - no-op) | None |
| add-llm-logs-collection-v1 | 2.8.0 | Create llm_logs table with indexes for LLM logging (SQLite only - no-op) | None |
| migrate-to-centralized-data-dir-v1 | 2.8.0 | Migrate data to centralized data directory for platform-specific paths | None |
| sqlite-initial-schema-v1 | 2.8.0 | Create SQLite database schema with all tables and indexes | None |
| create-mount-points-v1 | 2.7.0 | Create mount_points table and migrate files to use mount point system | sqlite-initial-schema-v1 |
| per-project-mount-points-v1 | 2.8.0 | Update schema for per-project mount points (SQLite only - no-op) | None |
| create-folder-entities-v1 | 2.8.0 | Create folder_entities table for folder management (SQLite only - no-op) | None |
| remove-auth-tables-v1 | 2.8.0 | Drop accounts and sessions tables (single-user mode) | None |
| reencrypt-api-keys-v1 | 2.8.0 | Re-encrypt API keys after single-user migration | remove-auth-tables-v1 |
| add-default-image-profile-field-v1 | 2.8.0 | Add defaultImageProfileId field to characters table | sqlite-initial-schema-v1 |
| migrate-user-plugins-to-site-v1 | 2.9.0 | Migrate per-user plugins to site-wide directory (single-user mode) | None |
| migrate-site-plugins-to-data-dir-v1 | 2.9.0 | Move plugins from app directory to data directory for persistence | None |
| drop-sync-tables-v1 | 2.8.0 | Remove all sync-related database tables | sqlite-initial-schema-v1 |
| add-chat-tool-settings-fields-v1 | 2.8.0 | Add tool settings fields to chats table (disabledTools, disabledToolGroups, forceToolsOnNextMessage) | sqlite-initial-schema-v1 |
| add-project-tool-settings-fields-v1 | 2.8.0 | Add default tool settings fields to projects table | sqlite-initial-schema-v1 |
| create-embedding-tables-v1 | 2.9.0 | Create tfidf_vocabularies and embedding_status tables for built-in embedding provider | sqlite-initial-schema-v1 |
| add-state-fields-v1 | 2.8.0 | Add state field to chats and projects tables for persistent JSON state storage | sqlite-initial-schema-v1 |
| add-auto-detect-rng-field-v1 | 2.8.0 | Add autoDetectRng field to chat_settings table for automatic RNG pattern detection | sqlite-initial-schema-v1 |
| add-compression-cache-field-v1 | 2.9.0 | Add compressionCache field to chats table for persistent compression results | sqlite-initial-schema-v1 |
| add-agent-mode-fields-v1 | 2.10.0 | Add agent mode fields to chat_settings, characters, projects, and chats tables | sqlite-initial-schema-v1 |
| add-story-backgrounds-fields-v1 | 2.11.0 | Add story backgrounds fields to chat_settings, chats, and projects tables | sqlite-initial-schema-v1 |
| add-chat-image-profile-field-v1 | 2.12.0 | Add imageProfileId field to chats table (move from per-participant to per-chat) | sqlite-initial-schema-v1 |
| add-dangerous-content-fields-v1 | 2.11.0 | Add dangerous content handling fields to chat_settings, connection_profiles, and image_profiles tables | sqlite-initial-schema-v1 |
| add-chat-danger-classification-fields-v1 | 2.12.0 | Add chat-level danger classification fields to chats table | sqlite-initial-schema-v1, add-dangerous-content-fields-v1 |
| fix-chat-updated-at-timestamps-v2 | 2.12.0 | Reset chat updatedAt and lastMessageAt to last actual message timestamp | sqlite-initial-schema-v1 |
| add-character-aliases-field-v1 | 2.10.0 | Add aliases field to characters table | sqlite-initial-schema-v1 |
| add-character-pronouns-field-v1 | 2.10.0 | Add pronouns field to characters table | sqlite-initial-schema-v1 |
| add-character-clothing-records-field-v1 | 2.10.0 | Add clothingRecords field to characters table | sqlite-initial-schema-v1 |
| fix-chat-message-counts | 2.10.0 | Reset chat messageCount to only count visible message bubbles (USER/ASSISTANT) | sqlite-initial-schema-v1 |
| add-memory-gate-fields-v1 | 2.10.0 | Add memory gate fields (reinforcement tracking, related links) to memories table | sqlite-initial-schema-v1 |
| migrate-legacy-jsonl-files-v1 | 2.13.0 | Migrate file entries from legacy public/data/files/files.jsonl to SQLite database | None |
| add-chat-message-missing-columns-v1 | 2.13.0 | Add renderedHtml and dangerFlags columns to chat_messages, fix empty JSON strings | sqlite-initial-schema-v1 |
| normalize-vector-storage-v1 | 2.11.0 | Normalize vector embeddings from JSON text to Float32 BLOBs | sqlite-initial-schema-v1 |
| add-profile-allow-tool-use-field-v1 | 3.0.0 | Add allowToolUse field to connection profiles for master tool use override | sqlite-initial-schema-v1 |
| drop-mount-points-v1 | 3.1.0 | Remove mount points system entirely (tables and columns) | None |
| move-llm-logs-to-separate-db-v1 | 3.1.0 | Move llm_logs table to dedicated quilltap-llm-logs.db file | None |
| add-file-status-field-v1 | 3.2.0 | Add fileStatus field to files table for filesystem sync tracking | sqlite-initial-schema-v1 |
| restructure-file-storage-v1 | 3.3.0 | Restructure file storage from old users/{userId}/... layout to new flat layout | sqlite-initial-schema-v1 |
| restructure-file-storage-cleanup-v1 | 3.3.0 | Cleanup pass for file storage restructure (category dirs, thumbnails, .DS_Store) | None |
| fix-text-embeddings-after-update-v1 | 3.1.0 | Fix TEXT embeddings written by update path (should be Float32 BLOBs) | normalize-vector-storage-v1 |
| rename-persona-columns-v1 | 4.2.0 | Rename personaLinks → partnerLinks in characters, drop personaId from memories | sqlite-initial-schema-v1 |

**Notes**:
- Minimum supported version for upgrades is v2.7.0
- Total of 47 migrations from v2.7.0 to v4.2.0
- Migrations with no dependencies have no blockers
- Some migrations are no-ops for SQLite (legacy MongoDB support removed)
- See `migrations/scripts/index.ts` for the complete registry

## Previous System

The migration system was previously implemented as the `qtap-plugin-upgrade` plugin. This was changed because:

1. **Race conditions**: Migrations ran via plugin initialization, which happened after the server started accepting requests
2. **Timing issues**: API requests could arrive before migrations completed, causing Zod validation errors
3. **Complex orchestration**: Plugin enable/disable logic was fragile

The new system runs migrations in `instrumentation.ts` **before** any requests are served, eliminating these issues.
