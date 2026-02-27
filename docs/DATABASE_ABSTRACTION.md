# Database Abstraction Layer

This document describes Quilltap's SQLite-based data storage and the database abstraction layer that supports it.

## Overview

Quilltap uses **SQLite** as its database backend. SQLite provides:
- Lightweight embedded database with zero external dependencies
- Single-file storage for easy deployment and backup
- ACID transactions and reliable data persistence
- Full query support through the abstraction layer

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SQLITE_PATH` | Path to main SQLite database file | `~/.quilltap/data/quilltap.db` or `/app/quilltap/data/quilltap.db` (Docker) |
| `SQLITE_LLM_LOGS_PATH` | Path to LLM logs database file | `~/.quilltap/data/quilltap-llm-logs.db` |
| `SQLITE_WAL_MODE` | Enable WAL mode for SQLite | `true` |
| `SQLITE_BUSY_TIMEOUT` | Maximum wait time for database locks (milliseconds) | `5000` |

> **Note:** SQLite is the only supported database backend. The legacy `DATA_BACKEND` and `MONGODB_URI` variables are no longer used.

## Docker Deployment

Run Quilltap with a persistent data volume:
```bash
docker run -d --name quilltap -p 3000:3000 -v /path/to/data:/app/quilltap csebold/quilltap
```

The SQLite database is stored at `/app/quilltap/data/quilltap.db` inside the container.

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
│   └── sqlite/
│       ├── index.ts
│       ├── backend.ts            # SQLite backend implementation
│       ├── client.ts             # Main DB better-sqlite3 singleton
│       ├── llm-logs-client.ts    # LLM logs DB better-sqlite3 singleton
│       ├── protection.ts         # Main DB integrity/checkpoint lifecycle
│       ├── llm-logs-protection.ts # LLM logs DB integrity/checkpoint lifecycle
│       ├── physical-backup.ts    # Hot backups for both databases
│       ├── json-columns.ts       # JSON utilities
│       └── query-translator.ts   # Query conversion
└── repositories/
    └── base.repository.ts  # Abstract base class
```

### Key Interfaces

#### DatabaseBackend

The main interface that all backends implement:

```typescript
interface DatabaseBackend {
  readonly type: 'sqlite';
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

Represents an SQLite table:

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

### SQLite Capabilities

SQLite provides the following capabilities for Quilltap:

| Capability | Support |
|-----------|---------|
| Transactions | ✅ |
| JSON Fields | ✅ (via JSON1 extension) |
| Array Operations | ✅ (application layer) |
| Text Search | ✅ (via FTS5) |
| Nested Field Queries | ✅ (via json_extract) |
| ACID Compliance | ✅ |
| Concurrent Reads | ✅ (WAL mode) |

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

The migration system handles SQLite schema initialization:

- **SQLite Initial Schema**: On first run, the `sqlite-initial-schema-v1` migration creates all required tables, indexes, and constraints
- **Incremental Migrations**: Additional migrations handle schema updates and data transformations

All migrations are automatically applied on application startup.

## Data Storage

Quilltap stores all application data in SQLite. The database contains tables for all major entities:

- **Users**: User accounts and authentication
- **Characters**: Character definitions and metadata
- **Chats**: Chat metadata and message history
- **Files**: File metadata (actual files stored on local filesystem)
- **Tags**: Tag definitions
- **Memories**: Character memory data and relationships
- **Connection Profiles**: LLM provider configurations
- **Embedding Profiles**: Embedding provider configurations
- **Image Profiles**: Image generation configurations

For data backup and restoration, see [Backup & Restore Guide](BACKUP-RESTORE.md).

## Current Status

### Implemented

- ✅ Database abstraction layer interfaces
- ✅ Configuration management
- ✅ SQLite backend with better-sqlite3
- ✅ Query translation (MongoDB-style to SQL)
- ✅ JSON column support for SQLite
- ✅ Migration system for schema initialization
- ✅ Docker configuration for SQLite
- ✅ All 25 repositories using abstraction layer

## SQLite Considerations

### JSON Columns

Array and object fields are stored as JSON strings in SQLite. The abstraction layer automatically:
- Serializes objects/arrays to JSON on write
- Parses JSON back to objects/arrays on read
- Supports querying within JSON via `json_extract()`

### BLOB Columns

Certain columns (notably vector embeddings) are stored as compact Float32 BLOBs instead of JSON text. This provides ~4-5x storage reduction and eliminates JSON parse/serialize overhead.

**Registration:** Repositories call `registerBlobColumns(tableName, columns)` via the database manager to declare which columns contain BLOB data:

```ts
await registerBlobColumns('vector_entries', ['embedding']);
await registerBlobColumns('memories', ['embedding']);
```

**Behavior:**
- On write: `number[]` values in registered blob columns are converted to `Float32Array` Buffers via `embeddingToBlob()`
- On read: Buffers are converted back to `number[]` via `blobToEmbedding()`
- Legacy JSON text is handled gracefully during migration transitions

**Utilities** (in `json-columns.ts`):
- `embeddingToBlob(embedding: number[]): Buffer` — Creates a Float32Array buffer from a number array
- `blobToEmbedding(blob: Buffer): number[]` — Reads Float32Array from buffer back to number array

### WAL Mode

SQLite runs in WAL (Write-Ahead Logging) mode by default, which provides:
- Better concurrent read/write performance
- Crash recovery
- Atomic transactions

### Data Directory

Platform-specific locations:
- Docker: `/app/quilltap/data/quilltap.db` (mounted from host)
- Linux: `~/.quilltap/data/quilltap.db`
- macOS: `~/Library/Application Support/Quilltap/data/quilltap.db`
- Windows: `%APPDATA%\Quilltap\data\quilltap.db`

The data directory is automatically created if it doesn't exist. For Docker, mount a host directory to `/app/quilltap` using `docker run -v /path/to/data:/app/quilltap`.

## Two-Database Architecture

Quilltap uses two separate SQLite database files:

| Database | File | Contents | Purpose |
|----------|------|----------|---------|
| Main | `quilltap.db` | Characters, chats, messages, memories, projects, settings, etc. | Core application data |
| LLM Logs | `quilltap-llm-logs.db` | LLM request/response debug logs | High-churn debug data |

The LLM logs database is isolated to prevent corruption in the high-churn debug data from ever affecting the main application database. Each database has its own WAL, checkpoint lifecycle, integrity checking, and physical backup schedule.

**Graceful degradation**: If the LLM logs database fails to open (corruption, permissions, etc.), the app continues normally with logging silently disabled. All repository operations have safe fallbacks (empty arrays, zero counts).

The `LLMLogsRepository` overrides `getCollection()` to route all operations to the dedicated logs database instead of the main database. No other repository is affected.

## Database Protection

Quilltap includes multiple layers of SQLite database protection implemented in modules under `lib/database/backends/sqlite/`:

### Protection Module (`protection.ts`)

Provides database lifecycle protection functions. All functions accept a `Database` instance as parameter to avoid circular imports.

| Function | When | PRAGMA | Purpose |
|----------|------|--------|---------|
| `runIntegrityCheck(db)` | Startup | `quick_check` | Detects corruption early |
| `startPeriodicCheckpoints(db)` | Startup | `wal_checkpoint(PASSIVE)` every 5 min | Keeps WAL file size bounded |
| `stopPeriodicCheckpoints()` | Shutdown | N/A | Clears the interval |
| `runShutdownCheckpoint(db)` | Shutdown | `wal_checkpoint(TRUNCATE)` | Merges WAL fully into main DB |
| `runBackupCheckpoint(db)` | Before logical backup | `wal_checkpoint(PASSIVE)` | Ensures backup reads consistent data |

The periodic checkpoint interval is stored on `globalThis.__quilltapCheckpointInterval` to survive Next.js hot module replacement. The interval calls `.unref()` so it doesn't prevent process exit.

### LLM Logs Protection Module (`llm-logs-protection.ts`)

Mirrors the main protection module for the LLM logs database. Same functions with `LLMLogs` prefix. If the integrity check fails, sets a degraded flag instead of blocking startup.

### Physical Backup Module (`physical-backup.ts`)

Creates hot physical backups using better-sqlite3's `.backup()` API (wraps SQLite's Online Backup API):

- **`createPhysicalBackup(db)`**: Creates a backup at `<data>/data/backups/quilltap-YYYY-MM-DDTHHmmss.db`. Async, non-blocking. Cleans up partial files on failure.
- **`createLLMLogsPhysicalBackup(db)`**: Creates a backup at `<data>/data/backups/quilltap-llm-logs-YYYY-MM-DDTHHmmss.db`. Same behavior.
- **`applyRetentionPolicy()`**: Scans the backups directory and applies a tiered retention policy to both main and LLM logs backups:
  - All backups < 7 days old
  - 1 per week for weeks 1-4
  - 1 per month for months 1-12
  - 1 per year indefinitely

### Startup Sequence

In `SQLiteBackend.connect()`:
1. Initialize main database connection (`getSQLiteClient`)
2. Register shutdown handlers (`setupSQLiteShutdownHandlers`)
3. Run integrity check (synchronous, logs result, doesn't block)
4. Start periodic WAL checkpoints
5. Create physical backup + apply retention (async, non-blocking via `.then()`)
6. Initialize LLM logs database (wrapped in try/catch — failure is non-fatal):
   - Open connection (`getLLMLogsSQLiteClient`)
   - Run integrity check (sets degraded flag on failure)
   - Start periodic WAL checkpoints
   - Create physical backup (async, non-blocking)

### Shutdown Sequence

In shutdown handlers (`closeSQLiteClient` and signal handlers):
1. Close LLM logs database (stop checkpoints, TRUNCATE checkpoint, optimize, close)
2. Stop main DB periodic checkpoints
3. Run main DB TRUNCATE checkpoint (merges all WAL data)
4. Run `PRAGMA optimize` on main DB
5. Close main database connection

### Configuration

| Setting | Default | Override |
|---------|---------|----------|
| `synchronous` | `FULL` | `SQLITE_SYNCHRONOUS=normal` env var |

The `FULL` synchronous mode ensures writes are flushed to disk before being acknowledged, preventing data loss on power failure.

### Process Safety

The shutdown handlers cover:
- `SIGTERM` / `SIGINT` — graceful shutdown signals
- `uncaughtException` — logs error, closes DB, exits
- `unhandledRejection` — logs reason, closes DB, exits

## Troubleshooting

### SQLite Database Locked

If you see "database is locked" errors:
1. Ensure only one process is accessing the database
2. Check that WAL mode is enabled
3. Increase `SQLITE_BUSY_TIMEOUT` (default: 5000ms)

### Database Not Accessible

If the database cannot be accessed:
1. Verify `SQLITE_PATH` is set correctly and the file exists
2. Check file permissions (read/write access required)
3. Ensure the directory exists and is writable
4. Check application logs for detailed error messages
