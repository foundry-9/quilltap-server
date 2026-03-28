# File System Implementation

## Overview

The file system implementation provides a robust, centralized file management system through the file storage abstraction layer. All project files are stored under a unified directory structure with comprehensive metadata tracking via the database layer.

## Architecture Components

### 1. File Storage Manager
**Location**: `lib/file-storage/manager.ts`

Provides the core API for all file operations:
- `buildStorageKey()` - Generate standardized storage paths
- `createFile()` - Store new files with metadata and relationships
- `findFileById()` - Retrieve file metadata and content
- `deleteFile()` - Remove files with relationship cleanup
- `listFiles()` - Query files by filters
- Statistics and utility methods

### 2. Storage Interfaces
**Location**: `lib/file-storage/interfaces.ts`

Defines contracts for file storage:
- `FileStorageBackend` - Pluggable backend interface
- `StorageConfig` - Configuration options
- Type definitions for storage operations

### 3. Type Schemas
**Location**: `lib/schemas/file.types.ts`

Core file types:
- `FileEntry` - File metadata and relationships
- `FileSource` - Enum for file origins (UPLOADED, GENERATED, IMPORTED, SYSTEM)
- `FileCategory` - Enum for file types (IMAGE, DOCUMENT, AVATAR, ATTACHMENT, EXPORT)
- `FileLink` - Relationships to entities (chats, characters, messages, etc.)

### 4. Database Repository
**Location**: `lib/database/repositories/files.repository.ts`

Persists file metadata to SQLite:
- CRUD operations for file entries
- Query methods for finding files by various criteria
- Relationship management through the database
- Integrates with the abstraction layer

### 5. Local File Storage Backend
**Location**: `lib/file-storage/backends/local/index.ts`

Default file storage implementation:
- Stores files to `data/files/storage/` on the local filesystem
- Uses UUID-based naming with original extension
- Manages physical file operations (read, write, delete)
- Directory management and cleanup

### 6. File Scanning & Reconciliation
**Location**: `lib/file-storage/scanner.ts` and `lib/file-storage/reconciliation.ts`

Utilities for managing stored files:
- **Scanner**: Discovers and catalogs files in storage
- **Reconciliation**: Validates database entries match physical files
- Orphan detection and cleanup utilities
- Safety checks before deletion

## File Storage Structure

```
data/files/
├── storage/
│   ├── users/
│   │   ├── {userId}/
│   │   │   ├── {projectId}/
│   │   │   │   └── {fileId}_{filename}     (files in project)
│   │   │   └── _general/
│   │   │       └── {fileId}_{filename}     (files without project)
│   │   └── system/
│   │       └── {fileId}_{filename}         (system files)
│   └── plugins/
│       └── {pluginId}/
│           └── {fileId}_{filename}         (plugin storage)
```

All file metadata is tracked in the SQLite database with comprehensive relationships to entities (chats, characters, messages, etc.).

## Key Features

### 1. Project-Aware Storage
Files are organized by project context when applicable:
- Project files stored in project-specific directories
- General (non-project) files in `_general/` folders
- System files in dedicated `system/` directory
- Plugin files in isolated `plugins/` namespace

### 2. Centralized Metadata
SQLite database tracks all file information:
- Original filename
- MIME type
- File size
- Content hash (SHA256)
- Creation/modification timestamps
- Entity relationships (chats, characters, messages, projects)
- Generation metadata (for AI files)
- User and project associations
- Tags and categorization

### 3. Entity Relationship Tracking
Files maintain relationships to various entities:
```typescript
linkedTo: [
  { entityId: "msg-abc123", entityType: "message" },
  { entityId: "chat-def456", entityType: "chat" },
  { entityId: "char-ghi789", entityType: "character" },
  { entityId: "proj-jkl012", entityType: "project" }
]
```

### 4. Automatic Deduplication
Files with identical content are deduplicated:
- Content hash compared before storage
- Only one physical copy maintained
- Multiple entities can reference same file
- Relationships merged automatically on creation

### 5. Comprehensive Classification
Files are categorized by source and type:
- **Source**: UPLOADED, GENERATED, IMPORTED, SYSTEM
- **Category**: IMAGE, DOCUMENT, AVATAR, ATTACHMENT, EXPORT, PROJECT

### 6. Generation Metadata
AI-generated files include:
- Original prompt
- Model and provider used
- Revised/improved prompt (if applicable)
- Description and generation context

## Usage Patterns

### Building Storage Keys

Generate standardized paths for files:

```typescript
import { fileStorageManager } from '@/lib/file-storage/manager';

// Project file in root
const key = fileStorageManager.buildStorageKey({
  userId: 'user-123',
  fileId: 'file-456',
  filename: 'document.pdf',
  projectId: 'proj-789',
  folderPath: '/',
});
// Result: users/user-123/proj-789/file-456_document.pdf

// Project file in subfolder
const key = fileStorageManager.buildStorageKey({
  userId: 'user-123',
  fileId: 'file-456',
  filename: 'document.pdf',
  projectId: 'proj-789',
  folderPath: '/documents/',
});
// Result: users/user-123/proj-789/documents/file-456_document.pdf

// General file (no project)
const key = fileStorageManager.buildStorageKey({
  userId: 'user-123',
  fileId: 'file-456',
  filename: 'avatar.png',
});
// Result: users/user-123/_general/file-456_avatar.png
```

### Creating Files

```typescript
import { fileStorageManager } from '@/lib/file-storage/manager';

const fileEntry = await fileStorageManager.createFile({
  userId: 'user-123',
  projectId: 'proj-789',
  folderPath: '/documents/',
  buffer: fileBuffer,
  filename: 'report.pdf',
  mimeType: 'application/pdf',
  source: 'UPLOADED',
  category: 'DOCUMENT',
  linkedTo: [
    { entityId: 'chat-456', entityType: 'chat' },
    { entityId: 'msg-789', entityType: 'message' }
  ],
});
```

### Querying Files

```typescript
import { fileStorageManager } from '@/lib/file-storage/manager';

// Find by ID
const file = await fileStorageManager.findFileById('file-456');

// List project files
const files = await fileStorageManager.listFiles({
  userId: 'user-123',
  projectId: 'proj-789',
});

// Find by content hash (deduplication)
const existing = await fileStorageManager.findFileByHash('sha256hash');
```

### Deleting Files

```typescript
// Remove file (checks for entity links)
await fileStorageManager.deleteFile('file-456', {
  checkEntityLinks: true,
  cascade: false, // don't delete linked entities
});
```

## API Routes

File operations are exposed through versioned REST API routes:

### File Operations
- **POST `/api/v1/files`** - Create/upload file
- **GET `/api/v1/files`** - List files with filters
- **GET `/api/v1/files/[id]`** - Retrieve file metadata
- **DELETE `/api/v1/files/[id]`** - Delete file
- **POST `/api/v1/files/[id]?action=link`** - Add entity link
- **POST `/api/v1/files/[id]?action=unlink`** - Remove entity link

### File Proxy Access
- **GET `/api/v1/files/proxy/[...key]`** - Serve file by storage key with access control

### Folder Management
- **GET `/api/v1/files/folders`** - List project folders
- **POST `/api/v1/files/folders`** - Create folder
- **DELETE `/api/v1/files/folders`** - Delete folder

### Orphaned File Cleanup
- **POST `/api/v1/files?action=cleanup-orphans`** - Detect and clean up orphaned files (untracked files without database records). Supports dry-run mode (`dryRun: true`) to preview results before acting. Actions: `move` relocates unique orphans to `/orphans/` folder, `delete` removes all orphans permanently. De-duplication via SHA-256 hash automatically removes orphans whose content matches an existing tracked file.
- **POST `/api/v1/files?action=cleanup-stale`** - Remove stale database entries for files no longer on disk

### File Permissions
- **GET `/api/v1/files/write-permissions`** - Check folder write access

### Image Management
- **POST `/api/v1/images`** - Upload image
- **GET `/api/v1/images/[id]`** - Retrieve image
- **DELETE `/api/v1/images/[id]`** - Delete image

### Chat File Operations
- **POST `/api/v1/chats/[id]/files`** - Upload file to chat
- **DELETE `/api/v1/chat-files/[id]`** - Delete chat file

## Benefits

1. **Single Source of Truth**: All files in one location
2. **Under Data Directory**: Files persist with other application data
3. **Better Tracking**: Comprehensive metadata and relationships
4. **Deduplication**: Automatic handling of duplicate files
5. **Simplified Paths**: UUID-based naming eliminates conflicts
6. **Easier Backups**: Single directory to backup
7. **Better Recovery**: Files won't be lost after reboots
8. **Relationship Management**: Track which files belong to which entities
9. **Generation History**: Full metadata for AI-generated content
10. **Scalable**: Ready for future enhancements (CDN, etc.)

## Database Schema

File metadata is stored in SQLite with the following key columns:

### Files Table
```typescript
interface FileEntry {
  id: string;                    // UUID identifier
  userId: string;                // Owner user ID
  projectId?: string;            // Associated project (optional)
  filename: string;              // Original filename
  mimeType: string;              // MIME type
  size: number;                  // File size in bytes
  sha256: string;                // Content hash for deduplication
  source: FileSource;            // UPLOADED | GENERATED | IMPORTED | SYSTEM
  category: FileCategory;        // IMAGE | DOCUMENT | AVATAR | etc.
  storageKey: string;            // Path in storage backend
  linkedTo: FileLink[];          // Entity relationships
  tags: string[];                // Tag identifiers
  metadata?: Record<string, any>;// Additional metadata
  generationMeta?: {             // For AI-generated files
    prompt: string;
    provider: string;
    model: string;
    revisedPrompt?: string;
    description?: string;
  };
  createdAt: number;             // Timestamp
  updatedAt: number;             // Timestamp
}
```

### FileLink Type
```typescript
interface FileLink {
  entityId: string;              // ID of linked entity
  entityType: string;            // Entity type (chat, message, character, etc.)
}
```

## Scanning and Reconciliation

The system includes utilities to manage stored files:

### Scanner
Discovers and catalogs files in storage:

```typescript
import { fileStorageScanner } from '@/lib/file-storage/scanner';

const results = await fileStorageScanner.scan({
  basePath: 'data/files/storage',
  pattern: '**/*',
});
```

### Reconciliation
Validates database entries match physical files:

```typescript
import { reconcileFileStorage } from '@/lib/file-storage/reconciliation';

const report = await reconcileFileStorage({
  checkOrphans: true,        // Find files without DB entries
  checkMissing: true,        // Find DB entries without files
  validateHashes: false,     // Verify SHA256 hashes (slow)
  autoCleanup: false,        // Delete orphans
});

console.log(report.orphans);  // Files without DB entries
console.log(report.missing);  // DB entries without files
```

## File Watcher

Monitor storage directory for external changes:

```typescript
import { FileWatcher } from '@/lib/file-storage/watcher';

const watcher = new FileWatcher('data/files/storage');
watcher.on('add', (filePath) => console.log('File added:', filePath));
watcher.on('remove', (filePath) => console.log('File removed:', filePath));
await watcher.watch();
```

## Integration Points

### With Projects
Files are associated with projects through:
- `projectId` in file metadata
- Storage path includes project directory
- Project deletion cascades to project files

### With Chats
Chat files linked through:
- Entity relationship tracking
- `linkedTo` array with `entityType: 'chat'`
- File deletion checks for chat references

### With Characters
Character avatars and related files:
- Category: `AVATAR` for character images
- Entity links to character ID
- Managed through character API endpoints

### With Messages
Message attachments tracked via:
- `linkedTo` array with `entityType: 'message'`
- File deletion cascade options

### Orphaned File Cleanup UI

The file browser includes a user-facing orphaned file cleanup feature:

- **Toolbar button**: A broom icon with an amber count badge appears when untracked files are detected
- **Cleanup modal**: Presents a dry-run analysis with two options:
  - **Relocate to /orphans/**: Moves unique orphans to a dedicated folder; duplicates of tracked files are removed
  - **Delete All**: Permanently removes all untracked files
- **De-duplication**: Both modes use SHA-256 content hashing to automatically remove orphans that are copies of existing tracked files
- **Character protection**: The cleanup system excludes character gallery images and avatar files from orphan detection, preventing accidental deletion of character-linked assets

**Implementation**: `app/api/v1/files/actions/cleanup-orphans.ts` handles the API action; the file browser UI at `components/files/` triggers cleanup via the action dispatch pattern.

## Future Enhancements

The system is designed to support:
- Image optimization and resizing
- File versioning and snapshots
- Thumbnail generation
- Advanced search and filtering
- File analytics and usage tracking
- CDN/cloud storage backends

## Best Practices

1. **Always specify userId** - Files should be associated with an owner
2. **Use project context** - Link files to projects when applicable
3. **Tag related files** - Use tags for logical grouping
4. **Check relationships** - Verify entity links before deletion
5. **Monitor storage** - Run reconciliation periodically
6. **Hash verification** - Leverage SHA256 for deduplication
7. **Metadata richness** - Populate metadata fields for generation info

## Troubleshooting

### Orphaned Files
Files exist in storage but lack database entries:
```typescript
const report = await reconcileFileStorage({ checkOrphans: true });
if (report.orphans.length > 0) {
  // Manual review or automatic cleanup
}
```

### Missing Files
Database entries without corresponding files:
```typescript
const report = await reconcileFileStorage({ checkMissing: true });
if (report.missing.length > 0) {
  // Remove stale DB entries or restore from backup
}
```

### Hash Conflicts
Multiple files with same content:
```typescript
const existing = await fileStorageManager.findFileByHash(sha256);
// Deduplicate by using existing file instead of creating new one
```
