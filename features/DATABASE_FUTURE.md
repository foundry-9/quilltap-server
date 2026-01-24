# Database Abstraction and SQLite Support

This document outlines the plan to abstract Quilltap's database layer to support multiple backends, with SQLite as the new default and MongoDB remaining as an option.

## Overview

Currently, Quilltap uses MongoDB exclusively with the native MongoDB driver (no Prisma/Mongoose). The goal is to:

1. **Abstract the database interface** - Create a backend-agnostic layer similar to the file storage abstraction
2. **Implement SQLite support** - Using `better-sqlite3` for synchronous, embedded database operations
3. **Make SQLite the default** - New installations use SQLite with zero external dependencies
4. **Keep MongoDB available** - Existing installations continue working; MongoDB becomes optional

## Current Architecture

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Connection Client | `lib/mongodb/client.ts` | Singleton MongoClient with pooling |
| Configuration | `lib/mongodb/config.ts` | Zod-validated MongoDB config |
| Base Repository | `lib/mongodb/repositories/base.repository.ts` | Abstract base with CRUD patterns |
| Repositories (26) | `lib/mongodb/repositories/*.ts` | Domain-specific data access |
| Index Definitions | `lib/mongodb/indexes.ts` | Collection indexes |
| Repository Factory | `lib/repositories/factory.ts` | Entry point for repository access |
| User Scoping | `lib/repositories/user-scoped.ts` | Per-user data isolation |
| Migrations | `migrations/` | Startup-time data migrations |

### Data Model Summary

- **26 collections** with Zod schemas in `lib/schemas/`
- **UUID v4** for all entity IDs (not MongoDB ObjectId)
- **ISO-8601 timestamps** as strings
- **User scoping** via `userId` field on most entities
- **Nested JSON** for complex fields (participants, system prompts, physical descriptions)

### Reference Pattern: File Storage Abstraction

The file storage system (`lib/file-storage/`) provides the template:

- `interfaces.ts` - Backend interface with capabilities negotiation
- `manager.ts` - Singleton orchestrator for backend selection
- `backends/local/` - Local filesystem implementation
- Mount points stored in database for configuration

---

## Proposed Architecture

### Directory Structure

```
lib/
├── database/                           # NEW: Database abstraction layer
│   ├── interfaces.ts                   # Core interfaces
│   ├── manager.ts                      # Singleton database manager
│   ├── config.ts                       # Configuration and env handling
│   ├── schema-translator.ts            # Zod-to-DDL utilities
│   │
│   ├── backends/
│   │   ├── sqlite/
│   │   │   ├── index.ts                # Exports
│   │   │   ├── client.ts               # better-sqlite3 connection
│   │   │   ├── backend.ts              # DatabaseBackend implementation
│   │   │   ├── schema-generator.ts     # SQLite DDL from Zod
│   │   │   └── json-columns.ts         # JSON column utilities
│   │   │
│   │   └── mongodb/
│   │       ├── index.ts                # Exports
│   │       ├── client.ts               # Refactored from lib/mongodb/client
│   │       └── backend.ts              # DatabaseBackend implementation
│   │
│   └── repositories/
│       ├── base.repository.ts          # Backend-agnostic base
│       └── index.ts                    # Repository container
│
├── mongodb/                            # PRESERVED for backward compatibility
│   ├── client.ts                       # Delegates to database/backends/mongodb
│   ├── config.ts                       # Kept unchanged
│   └── repositories/                   # Existing repos (minimal changes)
```

### Core Interfaces

#### DatabaseBackendCapabilities

```typescript
interface DatabaseBackendCapabilities {
  transactions: boolean;        // Supports ACID transactions
  jsonColumns: boolean;         // Native JSON storage
  arrayColumns: boolean;        // Native array fields
  textSearch: boolean;          // Full-text search
  ttlIndexes: boolean;          // Auto-expiring documents
  aggregationPipeline: boolean; // Complex aggregations
  synchronous: boolean;         // Sync API (like better-sqlite3)
}
```

#### DatabaseBackend Interface

```typescript
interface DatabaseBackend {
  // Metadata
  getMetadata(): DatabaseBackendMetadata;

  // Lifecycle
  testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }>;
  initialize(): Promise<void>;
  close(): Promise<void>;

  // CRUD Operations
  find<T>(collection: string, filter: QueryFilter, options?: QueryOptions): Promise<T[]>;
  findOne<T>(collection: string, filter: QueryFilter): Promise<T | null>;
  insert<T>(collection: string, document: T): Promise<T>;
  insertMany<T>(collection: string, documents: T[]): Promise<T[]>;
  update(collection: string, filter: QueryFilter, update: UpdateOperations): Promise<UpdateResult>;
  updateOne<T>(collection: string, filter: QueryFilter, update: UpdateOperations): Promise<T | null>;
  delete(collection: string, filter: QueryFilter): Promise<{ deletedCount: number }>;
  deleteOne(collection: string, filter: QueryFilter): Promise<boolean>;
  count(collection: string, filter: QueryFilter): Promise<number>;

  // Schema Operations
  ensureIndexes(definitions: IndexDefinitions): Promise<void>;
  dropIndexes(collection: string): Promise<void>;

  // Optional
  aggregate?<T>(collection: string, pipeline: AggregationStage[]): Promise<T[]>;
  transaction?<T>(fn: (session: TransactionSession) => Promise<T>): Promise<T>;
}
```

#### QueryFilter (Portable Query Language)

```typescript
interface QueryFilter {
  [field: string]: unknown | QueryOperator;
}

interface QueryOperator {
  $eq?: unknown;
  $ne?: unknown;
  $gt?: number | string;
  $gte?: number | string;
  $lt?: number | string;
  $lte?: number | string;
  $in?: unknown[];
  $nin?: unknown[];
  $exists?: boolean;
  $regex?: string;
  $contains?: unknown;      // Array contains
  $and?: QueryFilter[];
  $or?: QueryFilter[];
}
```

---

## SQLite Implementation Details

### Schema Translation

| Zod Type | SQLite Type | Notes |
|----------|-------------|-------|
| `z.string()` | `TEXT` | |
| `z.number()` | `REAL` | `INTEGER` if `.int()` |
| `z.boolean()` | `INTEGER` | 0/1 |
| `z.date()` | `TEXT` | ISO-8601 |
| `z.array(...)` | `TEXT` | JSON serialized |
| `z.object(...)` | `TEXT` | JSON serialized |
| `z.enum([...])` | `TEXT` | With CHECK constraint |
| `.nullable()` | Allow NULL | |

### Index Translation

| MongoDB Index | SQLite Equivalent |
|---------------|-------------------|
| `{ field: 1 }` | `CREATE INDEX` |
| `{ field: -1 }` | `CREATE INDEX ... DESC` |
| Compound | `CREATE INDEX ... (a, b)` |
| `unique: true` | `CREATE UNIQUE INDEX` |
| `sparse: true` | `... WHERE field IS NOT NULL` |
| Text search | FTS5 virtual table |
| TTL | Application-level cleanup |

### JSON Column Queries

SQLite handles JSON via `json_extract()` and `json_each()`:

```sql
-- MongoDB: { 'participants.characterId': 'abc' }
-- SQLite:
SELECT * FROM chats WHERE EXISTS (
  SELECT 1 FROM json_each(participants)
  WHERE json_extract(value, '$.characterId') = 'abc'
);

-- MongoDB: { tags: { $in: ['tag1', 'tag2'] } }
-- SQLite:
SELECT * FROM characters WHERE (
  EXISTS (SELECT 1 FROM json_each(tags) WHERE value = 'tag1')
  OR EXISTS (SELECT 1 FROM json_each(tags) WHERE value = 'tag2')
);
```

### better-sqlite3 Configuration

```typescript
const db = new Database(path, {
  // Enable WAL mode for better concurrent read performance
});
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
```

---

## Configuration

### Environment Variables

```bash
# Backend selection (default: sqlite)
DATABASE_BACKEND=sqlite

# SQLite configuration
# Default path varies by environment:
# - Docker: /app/data/quilltap.db (mounted volume)
# - Local dev: ~/.quilltap/data/quilltap.db
# - Custom: Set SQLITE_PATH explicitly
SQLITE_PATH=/app/data/quilltap.db
SQLITE_WAL_MODE=true
SQLITE_BUSY_TIMEOUT=5000

# MongoDB configuration (existing - used if DATABASE_BACKEND=mongodb)
MONGODB_URI=mongodb://localhost:27017/quilltap
MONGODB_DATABASE=quilltap
```

### Auto-Detection Logic

1. If `DATABASE_BACKEND` is set, use that value
2. If `MONGODB_URI` is set (legacy), default to `mongodb`
3. Otherwise, default to `sqlite` (new installations)

---

## Docker Configuration

SQLite files must persist outside the container. The database file is stored in a mounted volume.

### Development Docker (`docker-compose.yml`)

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    volumes:
      - .:/app
      - app-node-modules:/app/node_modules
      - sqlite-data:/app/data  # SQLite database persistence
      - /app/.next
    environment:
      - DATABASE_BACKEND=sqlite
      - SQLITE_PATH=/app/data/quilltap.db
      # MongoDB still available for testing
      - MONGODB_URI=mongodb://mongo:27017/quilltap

volumes:
  sqlite-data:  # Named volume for SQLite persistence
```

### Production Docker (`docker-compose.prod.yml`)

```yaml
services:
  app:
    volumes:
      - sqlite-data:/app/data  # SQLite database persistence
      # OR for network filesystem mount:
      # - /mnt/efs/quilltap/data:/app/data
    environment:
      - DATABASE_BACKEND=sqlite
      - SQLITE_PATH=/app/data/quilltap.db

volumes:
  sqlite-data:
    # For AWS EFS or other network filesystem:
    # driver: local
    # driver_opts:
    #   type: nfs
    #   o: addr=fs-xxx.efs.region.amazonaws.com,nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2
    #   device: ":/"
```

### Local Development (No Docker)

For local development without Docker, SQLite uses the user's home directory:

```bash
# Default location (auto-detected)
~/.quilltap/data/quilltap.db

# Or set explicitly
export SQLITE_PATH=~/.quilltap/data/quilltap.db
```

The application creates the directory structure automatically if it doesn't exist.

### Dockerfile Changes

The Dockerfile needs `better-sqlite3` which has native bindings. For Alpine:

```dockerfile
FROM node:22-alpine AS base

# Install build tools for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

# ... rest of Dockerfile
```

For the production stage, the compiled native module is copied from the builder stage.

### Volume Mount Points

| Environment | Mount Point | Default Path |
|-------------|-------------|--------------|
| Docker Dev | `/app/data` | `sqlite-data` named volume |
| Docker Prod | `/app/data` | Named volume or NFS mount |
| Local Dev | N/A | `~/.quilltap/data/` |
| AWS ECS | `/app/data` | EFS mount |

### Data Directory Structure

```
/app/data/                    # or ~/.quilltap/data/
├── quilltap.db              # Main SQLite database
├── quilltap.db-wal          # WAL journal (if WAL mode enabled)
├── quilltap.db-shm          # Shared memory file
└── backups/                 # Local backup files (optional)
```

---

## Implementation Phases

### Phase 1: Core Infrastructure

**Files to create:**
- `lib/database/interfaces.ts` - All interface definitions
- `lib/database/config.ts` - Configuration schema with Zod
- `lib/database/schema-translator.ts` - Zod introspection utilities

**Outcome:** Type definitions and configuration in place.

### Phase 2: SQLite Backend

**Files to create:**
- `lib/database/backends/sqlite/client.ts` - better-sqlite3 singleton
- `lib/database/backends/sqlite/json-columns.ts` - JSON utilities
- `lib/database/backends/sqlite/schema-generator.ts` - DDL generation
- `lib/database/backends/sqlite/backend.ts` - DatabaseBackend impl

**Outcome:** Working SQLite backend that passes interface contract.

### Phase 3: MongoDB Backend Wrapper

**Files to create:**
- `lib/database/backends/mongodb/client.ts` - Delegate to existing
- `lib/database/backends/mongodb/backend.ts` - DatabaseBackend impl

**Files to modify:**
- `lib/mongodb/client.ts` - Add deprecation notices, delegate calls

**Outcome:** MongoDB wrapped in same interface as SQLite.

### Phase 4: Abstract Repository Layer

**Files to create:**
- `lib/database/repositories/base.repository.ts` - Backend-agnostic base
- `lib/database/manager.ts` - Singleton manager

**Files to modify:**
- `lib/repositories/factory.ts` - Backend selection logic
- `lib/mongodb/repositories/base.repository.ts` - Delegate to new base

**Outcome:** Repositories work with either backend.

### Phase 5: Repository Migration

Migrate repositories in order of complexity:

1. **Simple CRUD:** `tags`, `users`, `sessions`
2. **With indexes:** `connectionProfiles`, `imageProfiles`, `embeddingProfiles`
3. **Nested objects:** `characters`, `promptTemplates`, `roleplayTemplates`
4. **Complex queries:** `chats`, `chatMessages`, `memories`
5. **Remaining:** `files`, `folders`, `projects`, `syncInstances`, etc.

**Outcome:** All 26 repositories work with both backends.

### Phase 6: Migration System Updates

**Files to create:**
- `migrations/lib/database-utils.ts` - Backend-agnostic utilities
- `migrations/scripts/sqlite-initial-schema.ts` - SQLite bootstrap

**Files to modify:**
- `migrations/state.ts` - Support SQLite state storage
- Existing migrations - Add `isDatabaseBackend()` checks

**Outcome:** Migrations work for both backends.

### Phase 7: Testing and Documentation

- Unit tests for query translation
- Integration tests against both backends
- Update README.md and DEVELOPMENT.md
- Create migration guide for users

---

## Risks and Mitigations

### Complex Query Translation

**Risk:** Some MongoDB queries may not translate cleanly.

**Mitigation:**
- Define supported query operator subset
- Allow backend-specific methods where needed
- Simplify queries in repositories

### JSON Query Performance

**Risk:** JSON column queries slower than native MongoDB.

**Mitigation:**
- Add computed/extracted columns for hot paths
- Create indexes on extracted JSON values
- Monitor and optimize as needed

### TTL Indexes

**Risk:** SQLite has no native TTL support.

**Mitigation:**
- Implement scheduled cleanup job
- Run on app startup and periodically
- Target: `sessions`, `verification_tokens`

### Atomic Operations

**Risk:** MongoDB's `$inc`, `$push` don't have SQL equivalents.

**Mitigation:**
- Use transactions for multi-step operations
- Implement optimistic locking patterns
- Use `UPDATE ... SET count = count + 1` for counters

---

## Future Considerations (Not in Scope)

These items are documented but not planned for the initial implementation:

1. **MongoDB as Plugin:** Eventually move MongoDB support to a plugin package
2. **Data Migration Tool:** Tool to migrate data between SQLite and MongoDB
3. **Vector Search:** sqlite-vss or sqlite-vec for local embedding search
4. **Read Replicas:** SQLite read replicas for scaling (Litestream)

---

## Verification Plan

### Unit Tests

- Query filter translation (MongoDB syntax → SQL)
- Schema translation (Zod → DDL)
- JSON serialization roundtrips

### Integration Tests

```typescript
describe.each(['sqlite', 'mongodb'])('DatabaseBackend (%s)', (backend) => {
  // Same tests run against both backends
  it('inserts and finds documents', async () => { ... });
  it('handles JSON arrays', async () => { ... });
  it('applies query filters', async () => { ... });
});
```

### Manual Testing

1. Fresh install with SQLite (no MongoDB running)
2. Existing MongoDB installation continues working
3. Backup/restore works with both backends
4. Sync works between instances with different backends
5. All CRUD operations in UI function correctly

---

## Critical Files Reference

| File | Purpose |
|------|---------|
| `lib/mongodb/repositories/base.repository.ts` | Template for abstraction |
| `lib/file-storage/interfaces.ts` | Pattern for interface design |
| `lib/repositories/factory.ts` | Entry point to modify |
| `lib/mongodb/indexes.ts` | Index definitions to translate |
| `lib/schemas/*.ts` | Zod schemas (unchanged) |
| `migrations/index.ts` | Migration runner to update |
