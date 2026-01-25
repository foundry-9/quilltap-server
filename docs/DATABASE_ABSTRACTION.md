# Database Abstraction Layer

This document describes Quilltap's database abstraction layer, which enables support for multiple database backends.

## Overview

Quilltap supports two database backends:
- **MongoDB** (default) - Full-featured document database
- **SQLite** - Lightweight embedded database for simpler deployments

The abstraction layer provides a unified interface for database operations, allowing the application to work with either backend.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_BACKEND` | Backend to use: `mongodb` or `sqlite` | Auto-detected |
| `MONGODB_URI` | MongoDB connection string | Required for MongoDB |
| `MONGODB_DATABASE` | MongoDB database name | `quilltap` |
| `SQLITE_PATH` | Path to SQLite database file | `~/.quilltap/data/quilltap.db` or `/app/data/quilltap.db` |
| `SQLITE_WAL_MODE` | Enable WAL mode for SQLite | `true` |

> **Note:** The legacy `DATA_BACKEND` environment variable is deprecated but still supported for backward compatibility. If `DATA_BACKEND=mongodb` is set, it will be treated as `DATABASE_BACKEND=mongodb` with a deprecation warning logged. The `json` and `dual` values are no longer supported.

### Backend Auto-Detection

If `DATABASE_BACKEND` is not set:
1. Check SQLite meta table for preferred backend (if SQLite file exists)
2. Check legacy `DATA_BACKEND` for backward compatibility
3. If `MONGODB_URI` is configured, MongoDB is used
4. Otherwise, SQLite is used (default for new installations)

## Docker Deployment

### MongoDB Mode (Default)

Use `docker-compose.yml`:
```bash
docker-compose up
```

### SQLite Mode

Use `docker-compose.sqlite.yml`:
```bash
docker-compose -f docker-compose.sqlite.yml up
```

### Production SQLite

Use `docker-compose.prod-sqlite.yml`:
```bash
docker-compose -f docker-compose.prod-sqlite.yml up -d
```

## Architecture

### Directory Structure

```
lib/database/
├── index.ts                 # Main exports
├── interfaces.ts           # Core type definitions
├── config.ts               # Configuration management
├── manager.ts              # Backend orchestration
├── schema-translator.ts    # Zod to SQL conversion
├── backends/
│   ├── mongodb/
│   │   ├── index.ts
│   │   └── backend.ts     # MongoDB backend implementation
│   └── sqlite/
│       ├── index.ts
│       ├── backend.ts     # SQLite backend implementation
│       ├── client.ts      # better-sqlite3 singleton
│       ├── json-columns.ts # JSON utilities
│       └── query-translator.ts # Query conversion
└── repositories/
    └── base.repository.ts  # Abstract base class
```

### Key Interfaces

#### DatabaseBackend

The main interface that all backends implement:

```typescript
interface DatabaseBackend {
  readonly type: 'mongodb' | 'sqlite';
  readonly capabilities: DatabaseCapabilities;
  readonly state: ConnectionState;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  getCollection<T>(name: string): DatabaseCollection<T>;
  ensureCollection(name: string, schema: z.ZodSchema): Promise<void>;
  healthCheck(): Promise<HealthCheckResult>;
}
```

#### DatabaseCollection

Represents a MongoDB collection or SQLite table:

```typescript
interface DatabaseCollection<T> {
  findOne(filter: QueryFilter, options?: QueryOptions): Promise<T | null>;
  find(filter: QueryFilter, options?: QueryOptions): Promise<T[]>;
  insertOne(document: T): Promise<InsertResult>;
  updateOne(filter: QueryFilter, update: UpdateSpec<T>): Promise<UpdateResult>;
  deleteOne(filter: QueryFilter): Promise<DeleteResult>;
  countDocuments(filter?: QueryFilter): Promise<number>;
}
```

### Capabilities

Each backend has different capabilities:

| Capability | MongoDB | SQLite |
|-----------|---------|--------|
| Transactions | ✅ | ✅ |
| JSON Fields | ✅ | ✅ (via JSON1) |
| Array Operations | ✅ ($push, $pull) | ⚠️ (application layer) |
| Text Search | ✅ | ✅ (via FTS5) |
| Vector Search | ✅ | ❌ |
| Nested Field Queries | ✅ | ✅ (via json_extract) |
| Change Streams | ✅ | ❌ |
| Aggregation Pipelines | ✅ | ❌ |

## Usage

### Initializing the Database

```typescript
import { initializeDatabase, getCollection } from '@/lib/database';

// Initialize on startup
await initializeDatabase();

// Get a collection
const collection = await getCollection<Character>('characters');

// Use collection methods
const character = await collection.findOne({ id: characterId });
```

### Using the Base Repository

```typescript
import { AbstractBaseRepository } from '@/lib/database';
import { CharacterSchema, Character } from '@/lib/schemas/types';

class CharactersRepository extends AbstractBaseRepository<Character> {
  constructor() {
    super('characters', CharacterSchema);
  }

  async findById(id: string): Promise<Character | null> {
    return this._findById(id);
  }

  async findAll(): Promise<Character[]> {
    return this._findAll();
  }

  async create(data: Omit<Character, 'id' | 'createdAt' | 'updatedAt'>): Promise<Character> {
    return this._create(data);
  }

  async update(id: string, data: Partial<Character>): Promise<Character | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }
}
```

## Migrations

The migration system supports both backends:

- **MongoDB migrations**: Run on MongoDB backend only
- **SQLite migrations**: Run on SQLite backend only (create tables, indexes)
- **Backend-agnostic migrations**: Check `isMongoDBBackend()` or `isSQLiteBackend()`

### SQLite Initial Schema

On first run with SQLite, the `sqlite-initial-schema-v1` migration creates all required tables.

## Data Migration

### MongoDB to SQLite Migration

Quilltap includes a built-in migration tool to move data from MongoDB to SQLite. This is useful for:
- Simplifying deployments by removing MongoDB dependency
- Reducing infrastructure costs
- Moving to a single-file database

#### Using the Migration Tool

1. Go to **Tools** page in the Quilltap UI
2. Find the **Database** card
3. Click **Migrate to SQLite**
4. Follow the wizard steps:
   - Pre-flight checks verify both databases are accessible
   - Review the data counts to be migrated
   - Confirm and start the migration
   - Wait for completion (progress is displayed)
5. **Restart the application** to use SQLite

#### What Gets Migrated

All collections are migrated in dependency order:
- Users, tags, provider models (no dependencies)
- Account/session data, connection profiles, chat settings
- Files, folders, mount points
- Characters, prompt templates, roleplay templates
- Chats, memories, messages
- Background jobs, LLM logs, sync data

#### Backend Preference

The preferred backend is stored in SQLite's `quilltap_meta` table. This is checked **before** environment variables, allowing you to switch backends via the UI without changing your configuration.

To clear the preference and revert to auto-detection, use the **Switch Back to MongoDB** option (with confirmation).

#### Important Notes

- Migration copies data; MongoDB is not modified
- After migration, new data is only written to SQLite
- Switching back to MongoDB will **lose** any data created in SQLite after migration
- Large databases may take several minutes to migrate

### API Endpoints

| Action | Method | Description |
|--------|--------|-------------|
| `database-status` | GET | Current backend, availability, health |
| `migration-readiness` | GET | Pre-flight checks and record counts |
| `migration-progress` | GET | Current migration progress (if running) |
| `start-migration` | POST | Begin MongoDB→SQLite migration |
| `switch-backend` | POST | Change preferred backend (with confirmation) |

Example:
```bash
# Check database status
curl -X GET 'https://localhost:3000/api/v1/system/tools?action=database-status'

# Start migration
curl -X POST 'https://localhost:3000/api/v1/system/tools?action=start-migration' \
  -H 'Content-Type: application/json' \
  -d '{"direction": "mongo-to-sqlite"}'
```

## Current Status

### Implemented

- ✅ Database abstraction layer interfaces
- ✅ Configuration and auto-detection
- ✅ SQLite backend with better-sqlite3
- ✅ MongoDB backend wrapper
- ✅ Query translation (MongoDB-style to SQL)
- ✅ JSON column support for SQLite
- ✅ Migration system multi-backend support
- ✅ Docker configuration for both backends
- ✅ All 25 repositories migrated to abstraction layer
- ✅ MongoDB to SQLite migration tool

### Future Work

- ⏳ SQLite to MongoDB migration (reverse migration)
- ⏳ Vector search for SQLite (via external plugin)

## SQLite Considerations

### JSON Columns

Array and object fields are stored as JSON strings in SQLite. The abstraction layer automatically:
- Serializes objects/arrays to JSON on write
- Parses JSON back to objects/arrays on read
- Supports querying within JSON via `json_extract()`

### WAL Mode

SQLite runs in WAL (Write-Ahead Logging) mode by default, which provides:
- Better concurrent read/write performance
- Crash recovery
- Atomic transactions

### Data Directory

- Docker: `/app/data/quilltap.db`
- Local: `~/.quilltap/data/quilltap.db`

The data directory is automatically created if it doesn't exist.

## Troubleshooting

### SQLite Database Locked

If you see "database is locked" errors:
1. Ensure only one process is accessing the database
2. Check that WAL mode is enabled
3. Increase `SQLITE_BUSY_TIMEOUT` (default: 5000ms)

### MongoDB Connection Issues

If MongoDB connection fails:
1. Verify `MONGODB_URI` is correct
2. Check network connectivity
3. Ensure MongoDB service is running

### Backend Auto-Detection

If the wrong backend is detected:
1. Explicitly set `DATABASE_BACKEND=sqlite` or `DATABASE_BACKEND=mongodb`
2. Remove/add `MONGODB_URI` as appropriate
