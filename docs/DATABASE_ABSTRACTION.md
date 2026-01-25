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
| `SQLITE_PATH` | Path to SQLite database file | `~/.quilltap/data/quilltap.db` or `/app/quilltap/data/quilltap.db` (Docker) |
| `SQLITE_WAL_MODE` | Enable WAL mode for SQLite | `true` |
| `SQLITE_BUSY_TIMEOUT` | Maximum wait time for database locks (milliseconds) | `5000` |

> **Note:** SQLite is the only supported database backend. The legacy `DATA_BACKEND` and `MONGODB_URI` variables are no longer used.

## Docker Deployment

### Development

Use `docker-compose.sqlite.yml` for local development with SQLite:
```bash
docker-compose -f docker-compose.sqlite.yml up
```

### Production

Use `docker-compose.prod-sqlite.yml` for production deployments:
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
- **Files**: File metadata (actual files stored in S3)
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

The data directory is automatically created if it doesn't exist. For Docker, the `/app/quilltap` directory is mounted from the host's platform-specific location by default (`QUILLTAP_HOST_DATA_DIR`).

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
