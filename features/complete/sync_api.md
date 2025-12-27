# Quilltap Sync API

## Overview

The Sync API enables bidirectional synchronization between two or more Quilltap instances, allowing users to keep their data in sync across multiple deployments. The system maintains permanent UUID mappings between local and remote entities so that relationships are preserved across instances.

## Status

**Status**: IMPLEMENTED
**Version**: 2.5.0-dev
**Completed**: 2025-12-23

### Implementation Summary

The Sync API has been fully implemented with the following components:

**Backend Services** (`/lib/sync/`):
- `types.ts` - Zod schemas and TypeScript types for sync operations
- `version-checker.ts` - Version compatibility checking
- `conflict-resolver.ts` - Last-write-wins conflict resolution
- `delta-detector.ts` - Detect changed entities since timestamp
- `sync-service.ts` - Core sync orchestration
- `remote-client.ts` - HTTP client for remote instances

**MongoDB Repositories** (`/lib/mongodb/repositories/`):
- `sync-instances.repository.ts` - Remote instance configurations
- `sync-mappings.repository.ts` - Permanent UUID mappings
- `sync-operations.repository.ts` - Sync audit log

**Server-side API Routes** (`/app/api/sync/`):
- `POST /api/sync/handshake` - Version check and auth
- `POST /api/sync/delta` - Fetch changed entities
- `POST /api/sync/push` - Receive entities from remote
- `GET/POST /api/sync/mappings` - UUID mapping exchange

**Client-side API Routes**:
- `GET/POST /api/sync/instances` - List/create instances
- `GET/PUT/DELETE /api/sync/instances/[id]` - Manage instance
- `POST /api/sync/instances/[id]/test` - Test connection
- `POST /api/sync/instances/[id]/sync` - Trigger manual sync
- `GET /api/sync/operations` - List sync history

**Settings UI** (`/components/settings/sync/`):
- `types.ts` - UI type definitions
- `hooks/` - useSyncInstances, useSyncOperations, useSyncTrigger
- `components/` - InstanceCard, InstanceForm, InstanceList, SyncHistoryPanel, SyncStatusBadge
- `index.tsx` - Main SyncTab component

---

## Original Design

## Requirements

### User Requirements
- **Sync Direction**: Bidirectional - both instances can push and pull changes
- **Conflict Resolution**: Last-write-wins (most recent `updatedAt` timestamp wins)
- **Sync Scope**: All user data EXCEPT profiles:
  - Characters
  - Personas
  - Chats (including messages)
  - Memories
  - Tags
  - Roleplay Templates
  - Prompt Templates
  - **NOT** Connection Profiles (contain API keys)
  - **NOT** Image Profiles (contain API keys)
  - **NOT** Embedding Profiles (contain API keys)
- **Authentication**: API key + user credentials to remote instance
- **UUID Mapping**: Permanent mapping so "this character X is the remote character X"
- **Version Check**: First verify schema/version compatibility between instances
- **Settings UI**: New tab at Settings --> Sync

---

## Architecture

### Data Model

#### New Collections

**`syncInstances`** - Remote instance configurations
```typescript
interface SyncInstance {
  id: string;                    // UUID
  userId: string;                // Local user ID
  name: string;                  // Human-readable name
  url: string;                   // Remote instance URL
  apiKey: string;                // Encrypted API key for remote
  remoteUserId?: string;         // Remote user ID after auth
  isActive: boolean;
  lastSyncAt?: string;           // ISO timestamp
  lastSyncStatus?: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  schemaVersion?: string;        // Remote schema version
  appVersion?: string;           // Remote app version
  createdAt: string;
  updatedAt: string;
}
```

**`syncMappings`** - Permanent UUID mappings
```typescript
interface SyncMapping {
  id: string;                    // UUID
  userId: string;
  instanceId: string;            // Which remote instance
  entityType: SyncableEntityType;
  localId: string;               // Local entity UUID
  remoteId: string;              // Remote entity UUID
  lastSyncedAt: string;
  lastLocalUpdatedAt: string;
  lastRemoteUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}

type SyncableEntityType =
  | 'CHARACTER'
  | 'PERSONA'
  | 'CHAT'
  | 'MEMORY'
  | 'TAG'
  | 'ROLEPLAY_TEMPLATE'
  | 'PROMPT_TEMPLATE';
```

**`syncOperations`** - Audit log of sync operations
```typescript
interface SyncOperation {
  id: string;
  userId: string;
  instanceId: string;
  direction: 'PUSH' | 'PULL' | 'BIDIRECTIONAL';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  entityCounts: Record<string, number>;
  conflicts: Array<{
    entityType: SyncableEntityType;
    localId: string;
    remoteId: string;
    resolution: 'LOCAL_WINS' | 'REMOTE_WINS';
  }>;
  errors: string[];
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

### Version Compatibility

Version constants in `/lib/schemas/types.ts`:
```typescript
export const SCHEMA_VERSION = '2.5.0';
export const SYNC_PROTOCOL_VERSION = '1.0';
```

**Compatibility Rules:**
- `SYNC_PROTOCOL_VERSION` must match exactly
- `SCHEMA_VERSION` major version must match (e.g., 2.x.x compatible with 2.y.y)
- Sync blocked with user-friendly message if incompatible

---

## API Endpoints

### Server-Side API (Accept sync from remote instances)

These endpoints allow OTHER Quilltap instances to sync with THIS instance.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sync/handshake` | Version check, authenticate remote user |
| POST | `/api/sync/delta` | Get entities changed since timestamp |
| POST | `/api/sync/push` | Receive entities from remote instance |
| GET/POST | `/api/sync/mappings` | Exchange UUID mappings |

### Client-Side API (Initiate sync to remote instances)

These endpoints are called by the local UI to manage sync configurations.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sync/instances` | List configured sync instances |
| POST | `/api/sync/instances` | Create new sync instance |
| GET | `/api/sync/instances/[id]` | Get instance details |
| PUT | `/api/sync/instances/[id]` | Update instance |
| DELETE | `/api/sync/instances/[id]` | Delete instance |
| POST | `/api/sync/instances/[id]/test` | Test connection to remote |
| POST | `/api/sync/instances/[id]/sync` | Trigger manual sync |
| GET | `/api/sync/operations` | List recent sync operations |
| GET | `/api/sync/operations/[id]` | Get operation details |

---

## Sync Algorithm

### Bidirectional Sync Flow

```
1. HANDSHAKE
   - Call remote /api/sync/handshake
   - Verify version compatibility
   - Authenticate and get remote user ID
   - Abort if incompatible

2. PULL (Get remote changes)
   - Request deltas since lastSyncTimestamp
   - For each remote delta:
     a. Find local sync mapping
     b. If no mapping: create entity locally with new UUID, create mapping
     c. If mapping exists:
        - Load local entity
        - Compare updatedAt timestamps
        - If REMOTE_WINS: update local entity
        - Log conflict resolution

3. PUSH (Send local changes)
   - Find local entities with updatedAt > lastSyncTimestamp
   - Send to remote /api/sync/push
   - Remote applies same conflict resolution

4. RECONCILE
   - Exchange UUID mappings for newly created entities
   - Update mappings with sync timestamps

5. UPDATE
   - Update lastSyncAt on SyncInstance
   - Record SyncOperation for audit
```

### Conflict Resolution (Last-Write-Wins)

```typescript
function resolveConflict(local: Entity, remote: Entity): 'LOCAL_WINS' | 'REMOTE_WINS' {
  const localTime = new Date(local.updatedAt).getTime();
  const remoteTime = new Date(remote.updatedAt).getTime();
  return remoteTime > localTime ? 'REMOTE_WINS' : 'LOCAL_WINS';
}
```

---

## Settings UI

### New Settings Tab

Location: Settings --> Sync

**Features:**
- List configured remote instances with status
- Add/edit/delete sync instances
- Test connection to remote
- Trigger manual sync
- View sync history and errors
- Display version compatibility warnings

### UI Components

```
/components/settings/sync/
├── index.tsx                 # Main SyncTab component
├── README.md                 # Module documentation
├── types.ts                  # Component-specific types
├── hooks/
│   ├── useSyncInstances.ts   # Manage instances state
│   ├── useSyncOperations.ts  # Fetch sync history
│   └── useSyncTrigger.ts     # Trigger manual sync
└── components/
    ├── InstanceCard.tsx      # Display single instance
    ├── InstanceForm.tsx      # Create/edit form
    ├── InstanceList.tsx      # List of instances
    ├── SyncHistoryPanel.tsx  # Recent operations
    ├── SyncStatusBadge.tsx   # Status indicator
    └── VersionCompatibility.tsx  # Version check display
```

### Instance Form Fields

```typescript
interface InstanceFormData {
  name: string;       // Human-readable name (e.g., "Home Server")
  url: string;        // Remote URL (e.g., https://quilltap.example.com)
  email: string;      // Remote user email
  password: string;   // Remote user password (not stored, used for initial auth)
}
```

---

## Security Considerations

### Authentication Flow

1. **Initial Setup:**
   - User provides remote instance URL
   - User provides their credentials for the remote instance
   - Local instance authenticates to remote via `/api/sync/handshake`
   - Remote returns session/API key
   - Only the API key is stored (encrypted), not credentials

2. **Ongoing Sync:**
   - Each sync request includes the stored API key
   - Remote validates API key and user association
   - All data scoped to authenticated user only

### Data Security

- **API Keys Encrypted**: Stored using AES-256-GCM (same as existing API keys)
- **Credentials Not Stored**: Used only for initial handshake
- **User Scoping**: Sync operations can only access the authenticated user's data
- **Zod Validation**: All incoming sync data validated against schemas
- **No Profile Sync**: Connection/Image/Embedding profiles excluded (contain API keys)

### Rate Limiting

```typescript
// In /lib/rate-limit.ts
sync: {
  maxRequests: 10,
  windowSeconds: 60,
},
syncHandshake: {
  maxRequests: 5,
  windowSeconds: 300,
},
```

---

## Implementation Phases

### Phase 1: Foundation
- Create `/lib/sync/types.ts` with all Zod schemas
- Add `SCHEMA_VERSION` and `SYNC_PROTOCOL_VERSION` to `/lib/schemas/types.ts`
- Create MongoDB indexes for new collections
- Implement repositories: `sync-instances`, `sync-mappings`, `sync-operations`

### Phase 2: Server-Side API
- Implement `/lib/sync/sync-service.ts` with core logic
- Implement `/lib/sync/version-checker.ts`
- Implement `/lib/sync/delta-detector.ts`
- Implement `/lib/sync/conflict-resolver.ts`
- Create server-side API routes (`/api/sync/handshake`, `/api/sync/delta`, `/api/sync/push`, `/api/sync/mappings`)

### Phase 3: Client-Side API
- Implement `/lib/sync/remote-client.ts` for HTTP calls to remote
- Create client-side API routes (`/api/sync/instances/*`, `/api/sync/operations/*`)

### Phase 4: Settings UI
- Add 'sync' tab to `/app/(authenticated)/settings/page.tsx`
- Create `/components/settings/sync/` module with all components
- Implement hooks for state management

### Phase 5: Testing & Documentation (COMPLETE)
- Unit tests: 164 tests covering version-checker, conflict-resolver, and Zod schemas
  - `__tests__/unit/lib/sync/version-checker.test.ts` (41 tests)
  - `__tests__/unit/lib/sync/conflict-resolver.test.ts` (39 tests)
  - `__tests__/unit/lib/sync/sync-types.test.ts` (84 tests)
- Integration tests for API endpoints (deferred to future)
- Create `/docs/SYNC-API.md` (deferred to future)
- Moved this doc to `/features/complete/sync_api.md`

---

## Potential Challenges

### Chat Messages
Chats can have thousands of messages. Mitigation:
- Stream messages in batches (100 at a time)
- Only sync message deltas (new messages since last sync)
- Consider message-level timestamps for granular sync

### File References
Characters/personas reference avatar images. Options:
- **Phase 1**: Exclude file references, avatars become null on sync
- **Future**: Add file sync capability with deduplication via SHA256

### Circular References
Characters link to personas, personas link to characters. Handling:
- Import all entities first with placeholder references
- Reconcile references after all entities imported
- Use existing `IdMappingState` pattern from import service

### Network Failures
Handle partial sync gracefully:
- Track progress per entity type
- Allow resuming from last successful point
- Clear indication to user of partial sync state

---

## Future Enhancements

1. **Automatic Sync**: Background job to sync on a schedule
2. **Selective Sync**: Choose which entity types to sync
3. **File Sync**: Sync avatar images and attachments
4. **Conflict UI**: Manual conflict resolution for edge cases
5. **Multi-Instance**: Sync to multiple remote instances simultaneously
6. **Sync Permissions**: Fine-grained control over what syncs

---

## Files Reference

### New Files to Create
- `/lib/sync/types.ts` - All sync Zod schemas
- `/lib/sync/sync-service.ts` - Core sync logic
- `/lib/sync/remote-client.ts` - HTTP client for remote calls
- `/lib/sync/version-checker.ts` - Version compatibility
- `/lib/sync/delta-detector.ts` - Find changed entities
- `/lib/sync/conflict-resolver.ts` - Last-write-wins logic
- `/lib/mongodb/repositories/sync-instances.repository.ts`
- `/lib/mongodb/repositories/sync-mappings.repository.ts`
- `/lib/mongodb/repositories/sync-operations.repository.ts`
- `/app/api/sync/handshake/route.ts`
- `/app/api/sync/delta/route.ts`
- `/app/api/sync/push/route.ts`
- `/app/api/sync/mappings/route.ts`
- `/app/api/sync/instances/route.ts`
- `/app/api/sync/instances/[id]/route.ts`
- `/app/api/sync/instances/[id]/test/route.ts`
- `/app/api/sync/instances/[id]/sync/route.ts`
- `/app/api/sync/operations/route.ts`
- `/app/api/sync/operations/[id]/route.ts`
- `/components/settings/sync/index.tsx`
- `/components/settings/sync/README.md`
- `/components/settings/sync/types.ts`
- `/components/settings/sync/hooks/useSyncInstances.ts`
- `/components/settings/sync/hooks/useSyncOperations.ts`
- `/components/settings/sync/hooks/useSyncTrigger.ts`
- `/components/settings/sync/components/InstanceCard.tsx`
- `/components/settings/sync/components/InstanceForm.tsx`
- `/components/settings/sync/components/InstanceList.tsx`
- `/components/settings/sync/components/SyncHistoryPanel.tsx`
- `/components/settings/sync/components/SyncStatusBadge.tsx`
- `/components/settings/sync/components/VersionCompatibility.tsx`

### Files to Modify
- `/lib/schemas/types.ts` - Add version constants
- `/lib/mongodb/repositories/index.ts` - Export new repositories
- `/lib/repositories/factory.ts` - Add new repos to factory
- `/app/(authenticated)/settings/page.tsx` - Add sync tab
- `/lib/rate-limit.ts` - Add sync rate limits
- `/CLAUDE.md` - Add documentation entry for sync docs
