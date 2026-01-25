# Database Abstraction and SQLite Support

**Status:** Completed (2026-01-24)

This document describes the completed database abstraction layer that allows Quilltap to use either SQLite or MongoDB as its data store.

> **User Documentation:** See [docs/DATABASE_ABSTRACTION.md](../../docs/DATABASE_ABSTRACTION.md) for configuration, deployment, and usage instructions.

## Overview

Quilltap now supports multiple database backends through a unified abstraction layer:

1. **Backend-agnostic interface** - All data access goes through `DatabaseBackend` and `DatabaseCollection<T>` interfaces
2. **SQLite support** - Using `better-sqlite3` for synchronous, embedded database operations with zero external dependencies
3. **SQLite is the default** - New installations use SQLite automatically
4. **MongoDB remains available** - Existing installations continue working; MongoDB offers additional capabilities

## Implemented Architecture

### Directory Structure

```
lib/
├── database/                           # Database abstraction layer
│   ├── interfaces.ts                   # Core interfaces (DatabaseBackend, DatabaseCollection, etc.)
│   ├── manager.ts                      # Singleton database manager
│   ├── config.ts                       # Configuration and env handling with Zod validation
│   ├── schema-translator.ts            # Zod-to-DDL utilities
│   ├── index.ts                        # Central exports
│   │
│   ├── backends/
│   │   ├── sqlite/
│   │   │   ├── index.ts                # Exports
│   │   │   ├── client.ts               # better-sqlite3 singleton with shutdown handlers
│   │   │   ├── backend.ts              # SQLiteBackend implementation
│   │   │   ├── query-translator.ts     # MongoDB-style queries to SQL
│   │   │   └── json-columns.ts         # JSON column utilities
│   │   │
│   │   └── mongodb/
│   │       ├── index.ts                # Exports
│   │       └── backend.ts              # MongoDBBackend implementation (wraps existing client)
│   │
│   └── repositories/
│       ├── base.repository.ts          # AbstractBaseRepository, UserOwnedBaseRepository, TaggableBaseRepository
│       ├── index.ts                    # RepositoryContainer and factory
│       └── [25 concrete repositories]  # All domain-specific repositories
│
├── mongodb/                            # Legacy MongoDB-specific code (preserved)
│   ├── client.ts                       # Still used by MongoDB backend
│   ├── config.ts                       # MongoDB configuration
│   └── indexes.ts                      # Index definitions
│
└── repositories/
    └── factory.ts                      # Entry point: getRepositories(), getDataBackend()
```

### Core Interfaces

#### DatabaseBackend

```typescript
interface DatabaseBackend {
  // Metadata
  readonly type: 'sqlite' | 'mongodb';
  getCapabilities(): DatabaseBackendCapabilities;

  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; message: string; latencyMs?: number }>;

  // Collection access
  collection<T extends Document>(name: string): DatabaseCollection<T>;

  // Transactions
  transaction<T>(fn: (session: DatabaseTransaction) => Promise<T>): Promise<T>;

  // Raw queries (backend-specific)
  rawQuery<T>(query: string, params?: unknown[]): Promise<T>;
}
```

#### DatabaseCollection

```typescript
interface DatabaseCollection<T> {
  find(filter: QueryFilter, options?: QueryOptions): Promise<T[]>;
  findOne(filter: QueryFilter): Promise<T | null>;
  insertOne(document: Partial<T>): Promise<InsertResult>;
  insertMany(documents: Partial<T>[]): Promise<InsertResult[]>;
  updateOne(filter: QueryFilter, update: UpdateSpec): Promise<UpdateResult>;
  updateMany(filter: QueryFilter, update: UpdateSpec): Promise<UpdateResult>;
  deleteOne(filter: QueryFilter): Promise<DeleteResult>;
  deleteMany(filter: QueryFilter): Promise<DeleteResult>;
  countDocuments(filter: QueryFilter): Promise<number>;
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
  $and?: QueryFilter[];
  $or?: QueryFilter[];
}
```

### Backend Capabilities

| Capability | SQLite | MongoDB |
|------------|--------|---------|
| Transactions | Yes | Yes |
| JSON columns | Yes (via `json_extract`) | Native |
| Array operations | Yes (via `json_each`) | Native |
| Full-text search | FTS5 (not yet exposed) | Yes |
| Vector search | No | Atlas only |
| Change streams | No | Yes |
| Aggregation pipelines | No (use application layer) | Yes |
| TTL indexes | Application-level | Native |

---

## SQLite Implementation

### Query Translation

The `query-translator.ts` module converts MongoDB-style filters to parameterized SQL:

```typescript
// Input: { userId: 'abc', status: { $in: ['active', 'pending'] } }
// Output: "userId = ? AND status IN (?, ?)" with params ['abc', 'active', 'pending']
```

### JSON Column Queries

SQLite handles nested objects and arrays via `json_extract()` and `json_each()`:

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

### SQLite Configuration

```typescript
db.pragma('journal_mode = WAL');      // Better concurrent read performance
db.pragma('busy_timeout = 5000');     // Wait 5s if database is locked
db.pragma('synchronous = NORMAL');    // Balance durability and performance
db.pragma('foreign_keys = ON');       // Enforce referential integrity
```

---

## Configuration

### Environment Variables

```bash
# Backend selection (default: sqlite)
DATABASE_BACKEND=sqlite

# SQLite configuration (Docker path shown, local paths vary by platform)
SQLITE_PATH=/app/quilltap/data/quilltap.db
SQLITE_WAL_MODE=true
SQLITE_BUSY_TIMEOUT=5000

# MongoDB configuration (used if DATABASE_BACKEND=mongodb)
MONGODB_URI=mongodb://localhost:27017/quilltap
MONGODB_DATABASE=quilltap
```

### Auto-Detection Logic

1. If `DATABASE_BACKEND` is set, use that value
2. Else if `MONGODB_URI` is set (legacy), default to `mongodb`
3. Otherwise, default to `sqlite` (new installations)

---

## Implementation Phases (Completed)

### Phase 1: Core Infrastructure ✅

**Files created:**
- `lib/database/interfaces.ts` - All interface definitions
- `lib/database/config.ts` - Configuration schema with Zod validation
- `lib/database/schema-translator.ts` - Zod introspection and DDL generation utilities

### Phase 2: SQLite Backend ✅

**Files created:**
- `lib/database/backends/sqlite/client.ts` - better-sqlite3 singleton with shutdown handlers
- `lib/database/backends/sqlite/json-columns.ts` - JSON serialization and query utilities
- `lib/database/backends/sqlite/query-translator.ts` - MongoDB-style to SQL translation
- `lib/database/backends/sqlite/backend.ts` - SQLiteBackend and SQLiteCollection implementations

### Phase 3: MongoDB Backend Wrapper ✅

**Files created:**
- `lib/database/backends/mongodb/backend.ts` - MongoDBBackend wrapping existing client

**Result:** Both backends implement the same `DatabaseBackend` interface.

### Phase 4: Abstract Repository Layer ✅

**Files created:**
- `lib/database/repositories/base.repository.ts` - Three base classes:
  - `AbstractBaseRepository<T>` - Basic CRUD operations
  - `UserOwnedBaseRepository<T>` - Adds automatic userId scoping
  - `TaggableBaseRepository<T>` - Adds tag management
- `lib/database/manager.ts` - Singleton manager with initialization, health checks, testing support

**Files modified:**
- `lib/repositories/factory.ts` - Backend selection logic, `getRepositories()`, `getDataBackend()`

### Phase 5: Repository Migration ✅

All 25 repositories migrated to use the abstraction layer:

| Category | Repositories |
|----------|--------------|
| Characters & Chats | `CharactersRepository`, `ChatsRepository` |
| Settings | `ChatSettingsRepository`, `ConnectionProfilesRepository`, `EmbeddingProfilesRepository`, `ImageProfilesRepository` |
| Templates | `PromptTemplatesRepository`, `RoleplayTemplatesRepository` |
| System | `ProviderModelsRepository`, `ProjectsRepository`, `TagsRepository`, `UsersRepository` |
| Files | `FilesRepository`, `FoldersRepository`, `MountPointsRepository`, `FilePermissionsRepository` |
| Advanced | `MemoriesRepository`, `BackgroundJobsRepository`, `LLMLogsRepository` |
| Sync | `SyncInstancesRepository`, `SyncMappingsRepository`, `SyncOperationsRepository`, `UserSyncApiKeysRepository` |
| Other | `VectorIndicesRepository`, `PluginConfigRepository` |

### Phase 6: Migration System Updates ✅

- Migration system works with both backends
- SQLite schema bootstrap handled by `schema-translator.ts`
- `isDatabaseBackend()` checks available for backend-specific migrations

### Phase 7: Testing and Documentation ✅

**Unit tests created:**
- `__tests__/unit/lib/database/schema-translator.test.ts` - Zod to DDL translation
- `__tests__/unit/lib/database/query-translator.test.ts` - MongoDB-style to SQL translation
- `__tests__/unit/lib/database/config.test.ts` - Configuration auto-detection

**Documentation:**
- `docs/DATABASE_ABSTRACTION.md` - Complete user documentation
- Updated `README.md` and `DEVELOPMENT.md`

---

## Risks and How They Were Addressed

### Complex Query Translation

**Risk:** Some MongoDB queries may not translate cleanly.

**Resolution:**
- Defined a supported query operator subset (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$regex`, `$and`, `$or`)
- JSON path queries handled via `json_extract()` for nested fields
- Array containment queries handled via `json_each()` subqueries

### JSON Query Performance

**Risk:** JSON column queries slower than native MongoDB.

**Resolution:**
- Prepared statement caching in `SQLiteCollection` reduces parsing overhead
- JSON columns are automatically serialized/deserialized on read/write
- Hot paths can be optimized with extracted columns if needed in the future

### TTL Indexes

**Risk:** SQLite has no native TTL support.

**Resolution:**
- TTL cleanup implemented at application level via background jobs
- Affects `sessions` and similar time-bounded collections

### Atomic Operations

**Risk:** MongoDB's `$inc`, `$push` don't have direct SQL equivalents.

**Resolution:**
- Transactions used for multi-step operations
- `UpdateSpec` supports `$set` and `$unset` operations
- Increment operations use `UPDATE ... SET count = count + 1` pattern

---

## Future Considerations (Not Yet Implemented)

These items remain documented for potential future work:

1. **MongoDB as Plugin:** Move MongoDB support to an optional plugin package
2. **Data Migration Tool:** Tool to migrate data between SQLite and MongoDB
3. **Vector Search:** sqlite-vss or sqlite-vec for local embedding search
4. **Read Replicas:** SQLite read replicas for scaling (Litestream)

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/database/interfaces.ts` | Core type definitions |
| `lib/database/config.ts` | Configuration and auto-detection |
| `lib/database/manager.ts` | Singleton orchestrator |
| `lib/database/schema-translator.ts` | Zod to DDL conversion |
| `lib/database/backends/sqlite/backend.ts` | SQLite implementation |
| `lib/database/backends/sqlite/query-translator.ts` | Query filter to SQL |
| `lib/database/backends/mongodb/backend.ts` | MongoDB wrapper |
| `lib/database/repositories/base.repository.ts` | Base repository classes |
| `lib/database/repositories/index.ts` | Repository container and factory |
| `lib/repositories/factory.ts` | Public API entry point |
| `docs/DATABASE_ABSTRACTION.md` | User documentation |

---

## Related Commits

- `e97d2ee8` - test: Add unit tests for database abstraction layer
- `af4ffa81` - fix: Runtime errors in database abstraction layer
- `d34dfcfc` - feat: Wire up repository factory to use database abstraction layer
- `98402550` - feat: Upgrade OpenRouter plugin to SDK v0.4.0 with new streaming API
- `6eb1d2e6` - feat: Migrate all repositories to database abstraction layer
