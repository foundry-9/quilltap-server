# Implementation Plan: Tools Page with Backup/Restore Feature

## Overview

Add a new top-level `/tools` page after "Settings" in the navigation, with the first tool being a comprehensive backup/restore system that allows users to export all their data (MongoDB collections + S3 files) to a ZIP archive, and restore from either uploaded ZIPs or S3-stored backups.

## Feature Requirements

### Backup Capabilities
1. Export all user data from MongoDB collections:
   - Characters (with descriptions)
   - Personas (with descriptions)
   - Chats (with all messages)
   - Tags
   - Connection Profiles (API keys excluded for security - these are encrypted with user-specific keys)
   - Image Profiles
   - Embedding Profiles
   - Memories
   - Files metadata

2. Export all user files from S3 storage

3. Package into a ZIP archive with structure:
   ```
   quilltap-backup-{userId}-{timestamp}/
   ├── manifest.json           # Backup metadata
   ├── data/
   │   ├── characters.json
   │   ├── personas.json
   │   ├── chats.json
   │   ├── tags.json
   │   ├── connection-profiles.json
   │   ├── image-profiles.json
   │   ├── embedding-profiles.json
   │   ├── memories.json
   │   └── files.json          # File metadata
   └── files/
       └── {category}/
           └── {fileId}_{filename}
   ```

4. Delivery options:
   - Direct download to browser
   - Save to S3 (in a `backups/` category)

### Restore Capabilities
1. Source options:
   - Upload ZIP file from local machine
   - Select from S3-stored backups

2. Restore modes:
   - **Replace Mode**: Delete all existing data first, then restore (same user)
   - **New Account Mode**: Regenerate all UUIDs consistently to import data into a different account

3. UUID Regeneration Strategy (for New Account Mode):
   - Create a mapping of old UUID -> new UUID for all entities
   - Process in dependency order:
     1. Tags (no dependencies)
     2. Files (references tags)
     3. Characters (references tags, files)
     4. Personas (references tags, files, characters)
     5. Connection Profiles (references tags)
     6. Image Profiles (no dependencies)
     7. Embedding Profiles (no dependencies)
     8. Chats (references characters, personas, tags)
     9. Memories (references characters)
   - Update all foreign key references using the UUID mapping

4. Verification:
   - Before restore, show summary of what will be imported
   - Confirm destructive actions (Replace Mode)

## Architecture

### New Dependencies
Add `archiver` for creating ZIP files and `adm-zip` for reading ZIP files:
```bash
npm install archiver adm-zip
npm install -D @types/archiver @types/adm-zip
```

### File Structure

```
app/
├── (authenticated)/
│   └── tools/
│       └── page.tsx                    # Tools page with cards
components/
├── tools/
│   ├── backup-restore-card.tsx         # Main backup/restore UI card
│   ├── backup-dialog.tsx               # Backup options dialog
│   ├── restore-dialog.tsx              # Restore wizard dialog
│   └── restore-preview.tsx             # Preview what will be restored
lib/
├── backup/
│   ├── backup-service.ts               # Core backup creation logic
│   ├── restore-service.ts              # Core restore logic
│   ├── uuid-remapper.ts                # UUID regeneration utilities
│   └── types.ts                        # Backup/restore types
app/api/
├── tools/
│   └── backup/
│       ├── create/
│       │   └── route.ts                # POST - Create backup
│       ├── download/
│       │   └── route.ts                # GET - Download backup
│       ├── list/
│       │   └── route.ts                # GET - List S3 backups
│       └── restore/
│           └── route.ts                # POST - Restore from backup
```

### API Endpoints

#### POST /api/tools/backup/create
Create a new backup:
```typescript
Request: {
  destination: 'download' | 's3'
  filename?: string  // Optional custom filename for S3
}
Response: {
  success: true
  backupId: string
  downloadUrl?: string  // If destination is 'download'
  s3Key?: string        // If destination is 's3'
}
```

#### GET /api/tools/backup/download?backupId={id}
Download a backup file (streams ZIP directly).

#### GET /api/tools/backup/list
List available backups in S3:
```typescript
Response: {
  backups: Array<{
    key: string
    filename: string
    createdAt: Date
    size: number
  }>
}
```

#### POST /api/tools/backup/restore
Restore from a backup:
```typescript
Request: {
  source: 'upload' | 's3'
  s3Key?: string           // If source is 's3'
  file?: File              // If source is 'upload' (multipart form)
  mode: 'replace' | 'new-account'
}
Response: {
  success: true
  summary: {
    characters: number
    personas: number
    chats: number
    messages: number
    tags: number
    files: number
    memories: number
  }
}
```

### Backup Service Implementation

```typescript
// lib/backup/backup-service.ts

interface BackupManifest {
  version: '1.0'
  createdAt: string
  userId: string
  appVersion: string
  counts: {
    characters: number
    personas: number
    chats: number
    tags: number
    connectionProfiles: number
    imageProfiles: number
    embeddingProfiles: number
    memories: number
    files: number
  }
}

export class BackupService {
  async createBackup(userId: string): Promise<{
    zipBuffer: Buffer
    manifest: BackupManifest
  }>

  async saveToS3(userId: string, zipBuffer: Buffer, filename: string): Promise<string>

  async listS3Backups(userId: string): Promise<BackupInfo[]>
}
```

### Restore Service Implementation

```typescript
// lib/backup/restore-service.ts

interface RestoreOptions {
  mode: 'replace' | 'new-account'
  targetUserId: string
}

interface RestoreSummary {
  characters: number
  personas: number
  chats: number
  messages: number
  tags: number
  files: number
  memories: number
  profiles: {
    connection: number
    image: number
    embedding: number
  }
}

export class RestoreService {
  async previewRestore(zipBuffer: Buffer): Promise<RestoreSummary>

  async restore(
    zipBuffer: Buffer,
    options: RestoreOptions
  ): Promise<RestoreSummary>

  private async deleteUserData(userId: string): Promise<void>

  private async remapUuids(
    data: BackupData,
    targetUserId: string
  ): Promise<BackupData>
}
```

### UUID Remapper

```typescript
// lib/backup/uuid-remapper.ts

export class UuidRemapper {
  private mapping: Map<string, string> = new Map()

  // Generate new UUID for an old one, caching the mapping
  remap(oldUuid: string): string

  // Remap an array of UUIDs
  remapArray(uuids: string[]): string[]

  // Remap entity references in an object
  remapReferences<T>(obj: T, fields: string[]): T

  // Get the full mapping for debugging
  getMapping(): Record<string, string>
}
```

## UI Components

### Tools Page Layout
```tsx
// app/(authenticated)/tools/page.tsx
export default function ToolsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <h1>Tools</h1>
      <p>Utility tools for managing your Quilltap data</p>

      <div className="grid gap-6 md:grid-cols-2">
        <BackupRestoreCard />
        {/* Future tools go here */}
      </div>
    </div>
  )
}
```

### Backup/Restore Card
A card component showing:
- "Backup" button -> Opens BackupDialog
- "Restore" button -> Opens RestoreDialog
- List of recent S3 backups (if any)

### Backup Dialog
- Radio buttons: "Download" or "Save to Cloud"
- If S3: optional custom filename
- Progress indicator during backup
- Download link or success message

### Restore Dialog (Multi-step wizard)
1. **Step 1: Source Selection**
   - Upload file input
   - Or dropdown of S3 backups

2. **Step 2: Preview**
   - Show RestorePreview component
   - Display counts of each entity type
   - List any warnings (e.g., existing data will be replaced)

3. **Step 3: Mode Selection**
   - Radio: Replace existing data / Import as new data
   - Warning text for replace mode
   - Confirmation checkbox for destructive action

4. **Step 4: Progress & Results**
   - Progress bar during restore
   - Summary of restored items
   - Any errors/warnings

## Implementation Order

### Phase 1: Infrastructure
1. Add npm dependencies (`archiver`, `adm-zip`)
2. Create backup types (`lib/backup/types.ts`)
3. Implement UUID remapper (`lib/backup/uuid-remapper.ts`)

### Phase 2: Backup Service
4. Create backup service (`lib/backup/backup-service.ts`)
5. Create backup API endpoint (`app/api/tools/backup/create/route.ts`)
6. Create download API endpoint (`app/api/tools/backup/download/route.ts`)
7. Create list backups API endpoint (`app/api/tools/backup/list/route.ts`)

### Phase 3: Restore Service
8. Create restore service (`lib/backup/restore-service.ts`)
9. Create restore API endpoint (`app/api/tools/backup/restore/route.ts`)

### Phase 4: UI Components
10. Add Tools link to navigation (`components/dashboard/nav.tsx`)
11. Create Tools page (`app/(authenticated)/tools/page.tsx`)
12. Create BackupRestoreCard component
13. Create BackupDialog component
14. Create RestoreDialog component
15. Create RestorePreview component

### Phase 5: Testing & Polish
16. Add unit tests for backup/restore services
17. Add integration tests for API endpoints
18. Add debug logging throughout
19. Update README with backup/restore documentation

## Security Considerations

1. **API Keys**: Encrypted API keys are NOT included in backups since they're encrypted with user-specific keys and would be unusable on another account
2. **User Isolation**: All backup/restore operations are scoped to the authenticated user
3. **S3 Backups**: Stored in user-specific path `users/{userId}/backups/`
4. **File Validation**: Validate ZIP structure before restore
5. **Size Limits**: Consider adding size limits for upload/backup operations

## Logging

All operations should use the logger with context:
```typescript
logger.debug('Starting backup', { userId, destination })
logger.info('Backup completed', { userId, backupId, counts })
logger.error('Restore failed', { userId, error: err.message }, err)
```

## Error Handling

1. **Partial Failures**: If restore fails partway through, attempt rollback
2. **File Missing**: Skip missing S3 files with warning, don't fail entire restore
3. **Invalid ZIP**: Return clear error message about invalid backup format
4. **Version Mismatch**: Handle future backup format versions gracefully

## Notes

- The backup format is JSON-based for human readability and easy debugging
- Files are stored with their original filenames for easy manual inspection
- The manifest.json provides quick overview without extracting everything
- Consider adding optional compression level setting in future
