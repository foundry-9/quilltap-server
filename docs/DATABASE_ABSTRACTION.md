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

### Backend Auto-Detection

If `DATABASE_BACKEND` is not set:
1. If `MONGODB_URI` is configured, MongoDB is used
2. Otherwise, SQLite is used

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

### In Progress

- 🔄 Repository migration to abstraction layer
  - Existing MongoDB repositories work unchanged
  - New repositories can use AbstractBaseRepository

### Future Work

- ⏳ Migrate all 28 repositories to abstraction layer
- ⏳ Data migration tool (MongoDB ↔ SQLite)
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
