# Implementation Plan: Quilltap Native Import/Export System

This plan covers the implementation of a Quilltap-native import/export system, enabling users to export and import individual entity types or selections of entities with full control over what data is included.

**Note:** This is separate from and in addition to the SillyTavern import/export functionality.

## Status Overview

| Component | Status |
|-----------|--------|
| Export File Format Specification | COMPLETE |
| Export API Routes | COMPLETE |
| Export UI Components | COMPLETE |
| Import API Routes | COMPLETE |
| Import UI Components | COMPLETE |
| Import/Export Tool Card | COMPLETE |

**Implementation Complete:** All components have been implemented and integrated into the Tools page.

---

## Overview

### Goals

1. **Selective Export**: Export individual entities or collections of entities with user-selected options
2. **Rich Metadata**: Every export includes a manifest describing what's exported and export settings
3. **Flexible Import**: Single "Import" button reads manifest, shows user what's inside, allows selective import
4. **Merge Support**: Import can add new entities or merge with/replace existing entities
5. **Memory Association**: Optional inclusion of memories tied to exported entities

### Supported Entity Types

1. **Characters** - with optional memories, includes: system prompts, physical descriptions, tags, persona links, avatar overrides
2. **Personas** - with optional memories (if persona-tagged), includes: tags, character links, physical descriptions
3. **Chats** - with optional memories (chat-tagged), includes: messages, participants (references), tags
4. **Roleplay Templates** - user-created templates only
5. **Connection Profiles** - LLM connection configurations (API keys are NOT exported for security)
6. **Image Profiles** - image generation configurations (API keys are NOT exported for security)
7. **Embedding Profiles** - embedding/RAG configurations (API keys are NOT exported for security)
8. **Tags** - tag definitions with visual styles

---

## Part 1: Export File Format Specification

### 1.1 File Structure

The Quilltap export format is a JSON file with the `.qtap` extension. Structure:

```typescript
interface QuilltapExport {
  /** Export format metadata */
  manifest: QuilltapExportManifest;

  /** Exported data - only populated sections are present */
  data: QuilltapExportData;
}

interface QuilltapExportManifest {
  /** Format identifier - always 'quilltap-export' */
  format: 'quilltap-export';

  /** Format version for future compatibility */
  version: '1.0';

  /** What type of export this is */
  exportType: 'characters' | 'personas' | 'chats' | 'roleplay-templates' |
              'connection-profiles' | 'image-profiles' | 'tags' | 'mixed';

  /** ISO 8601 timestamp of export creation */
  createdAt: string;

  /** Application version that created this export */
  appVersion: string;

  /** Export settings used */
  settings: QuilltapExportSettings;

  /** Counts of exported entities */
  counts: QuilltapExportCounts;
}

interface QuilltapExportSettings {
  /** Whether memories were included */
  includeMemories: boolean;

  /** Whether all entities of the type were exported, or specific selections */
  scope: 'all' | 'selected';

  /** IDs of specifically selected entities (empty if scope is 'all') */
  selectedIds: string[];
}

interface QuilltapExportCounts {
  characters?: number;
  personas?: number;
  chats?: number;
  messages?: number;
  roleplayTemplates?: number;
  connectionProfiles?: number;
  imageProfiles?: number;
  tags?: number;
  memories?: number;
}

interface QuilltapExportData {
  /** Characters with embedded associated data */
  characters?: ExportedCharacter[];

  /** Personas with embedded associated data */
  personas?: ExportedPersona[];

  /** Chats with messages */
  chats?: ExportedChat[];

  /** Roleplay templates */
  roleplayTemplates?: RoleplayTemplate[];

  /** Connection profiles (without API keys) */
  connectionProfiles?: SanitizedConnectionProfile[];

  /** Image profiles (without API keys) */
  imageProfiles?: SanitizedImageProfile[];

  /** Tags */
  tags?: Tag[];

  /** Memories (when exported separately or with entities) */
  memories?: Memory[];
}
```

### 1.2 Exported Entity Types

#### ExportedCharacter

```typescript
interface ExportedCharacter extends Character {
  /** Memories associated with this character (optional based on export settings) */
  _exportedMemories?: Memory[];

  /** Tag names for human readability (actual tags exported separately) */
  _tagNames?: string[];

  /** Reference info for linked personas */
  _linkedPersonaNames?: string[];
}
```

#### ExportedPersona

```typescript
interface ExportedPersona extends Persona {
  /** Memories associated with this persona (optional) */
  _exportedMemories?: Memory[];

  /** Tag names for human readability */
  _tagNames?: string[];

  /** Reference info for linked characters */
  _linkedCharacterNames?: string[];
}
```

#### ExportedChat

```typescript
interface ExportedChat extends ChatMetadata {
  /** All messages in this chat */
  messages: MessageEvent[];

  /** Memories associated with this chat (optional) */
  _exportedMemories?: Memory[];

  /** Tag names for human readability */
  _tagNames?: string[];

  /** Participant info for human readability */
  _participantInfo?: {
    characterNames: string[];
    personaNames: string[];
  };
}
```

#### Sanitized Profiles (Security)

```typescript
interface SanitizedConnectionProfile extends Omit<ConnectionProfile, 'apiKeyId'> {
  /** API key reference removed for security */
  _apiKeyLabel?: string; // Just the label, no actual key data
}

interface SanitizedImageProfile extends Omit<ImageProfile, 'apiKeyId'> {
  /** API key reference removed for security */
  _apiKeyLabel?: string;
}
```

### 1.3 File Naming Convention

Export files follow this naming pattern:
- `quilltap-characters-{timestamp}.qtap`
- `quilltap-personas-{timestamp}.qtap`
- `quilltap-chats-{timestamp}.qtap`
- `quilltap-roleplay-templates-{timestamp}.qtap`
- `quilltap-connection-profiles-{timestamp}.qtap`
- `quilltap-image-profiles-{timestamp}.qtap`
- `quilltap-tags-{timestamp}.qtap`
- `quilltap-export-{timestamp}.qtap` (mixed exports)

Where `{timestamp}` is `YYYY-MM-DD-HH-mm-ss`.

---

## Part 2: Export Implementation

### 2.1 Export Service

**File:** `lib/export/quilltap-export-service.ts`

Core functions:

```typescript
interface ExportOptions {
  type: 'characters' | 'personas' | 'chats' | 'roleplay-templates' |
        'connection-profiles' | 'image-profiles' | 'tags';
  scope: 'all' | 'selected';
  selectedIds?: string[];
  includeMemories?: boolean;  // Only applicable for characters, personas, chats
}

async function createExport(
  userId: string,
  options: ExportOptions
): Promise<QuilltapExport>

async function createCharacterExport(
  userId: string,
  characterIds: string[] | 'all',
  includeMemories: boolean
): Promise<QuilltapExport>

async function createPersonaExport(
  userId: string,
  personaIds: string[] | 'all',
  includeMemories: boolean
): Promise<QuilltapExport>

async function createChatExport(
  userId: string,
  chatIds: string[] | 'all',
  includeMemories: boolean
): Promise<QuilltapExport>

// Similar functions for other entity types...
```

### 2.2 Export API Routes

**File:** `app/api/tools/quilltap-export/route.ts`

```typescript
// POST /api/tools/quilltap-export
// Body: ExportOptions
// Returns: JSON export data (for download)

// GET /api/tools/quilltap-export/preview
// Query: type, scope, selectedIds (comma-separated), includeMemories
// Returns: Preview of what would be exported (counts, entity names)
```

**File:** `app/api/tools/quilltap-export/[type]/route.ts`

```typescript
// GET /api/tools/quilltap-export/characters
// Query: ids (comma-separated, optional), includeMemories
// Returns: Character export JSON

// Similar routes for other entity types
```

### 2.3 Memory Association Logic

#### For Characters

Memories are associated with a character if:
- `memory.characterId === character.id`

#### For Personas

Memories are associated with a persona if:
- `memory.personaId === persona.id`

#### For Chats

Memories are associated with a chat if:
- `memory.chatId === chat.id`

---

## Part 3: Import Implementation

### 3.1 Import Service

**File:** `lib/import/quilltap-import-service.ts`

Core functions:

```typescript
interface ImportPreview {
  manifest: QuilltapExportManifest;
  entities: {
    characters?: { id: string; name: string; exists: boolean }[];
    personas?: { id: string; name: string; exists: boolean }[];
    chats?: { id: string; title: string; exists: boolean }[];
    roleplayTemplates?: { id: string; name: string; exists: boolean }[];
    connectionProfiles?: { id: string; name: string; exists: boolean }[];
    imageProfiles?: { id: string; name: string; exists: boolean }[];
    tags?: { id: string; name: string; exists: boolean }[];
    memories?: { count: number };
  };
}

interface ImportOptions {
  /** Which entity IDs to import (empty = import all) */
  selectedIds?: {
    characters?: string[];
    personas?: string[];
    chats?: string[];
    roleplayTemplates?: string[];
    connectionProfiles?: string[];
    imageProfiles?: string[];
    tags?: string[];
  };

  /** How to handle conflicts with existing entities */
  conflictStrategy: 'skip' | 'replace' | 'duplicate';

  /** Whether to import associated memories */
  importMemories: boolean;
}

interface ImportResult {
  success: boolean;
  imported: {
    characters: number;
    personas: number;
    chats: number;
    messages: number;
    roleplayTemplates: number;
    connectionProfiles: number;
    imageProfiles: number;
    tags: number;
    memories: number;
  };
  skipped: {
    characters: number;
    personas: number;
    chats: number;
    roleplayTemplates: number;
    connectionProfiles: number;
    imageProfiles: number;
    tags: number;
    memories: number;
  };
  warnings: string[];
}

async function parseExportFile(
  fileBuffer: Buffer
): Promise<QuilltapExport>

async function previewImport(
  userId: string,
  exportData: QuilltapExport
): Promise<ImportPreview>

async function executeImport(
  userId: string,
  exportData: QuilltapExport,
  options: ImportOptions
): Promise<ImportResult>
```

### 3.2 Import API Routes

**File:** `app/api/tools/quilltap-import/route.ts`

```typescript
// POST /api/tools/quilltap-import/preview
// Body: FormData with file
// Returns: ImportPreview

// POST /api/tools/quilltap-import/execute
// Body: FormData with file + ImportOptions as JSON
// Returns: ImportResult
```

### 3.3 Conflict Resolution

When importing entities with the same ID:

1. **Skip**: Keep existing entity, don't import
2. **Replace**: Delete existing entity, import new one (with new timestamps)
3. **Duplicate**: Import with new UUID, append " (imported)" to name

Default behavior: **Skip** (safest)

### 3.4 UUID Remapping

When `conflictStrategy` is 'duplicate', the import service must:

1. Generate new UUIDs for all imported entities
2. Update all internal references (e.g., character.tags[], chat.participants[].characterId)
3. Use the existing `lib/backup/uuid-remapper.ts` as reference

### 3.5 Import Validation

Before import, validate:

1. File is valid JSON
2. Has required `manifest.format === 'quilltap-export'`
3. Version is supported (currently only '1.0')
4. Data structures match expected schemas

---

## Part 4: UI Components

### 4.1 Import/Export Tool Card

**File:** `components/tools/import-export-card.tsx`

Main card displayed on the Tools page with:

- Header: "Import / Export" with transfer icon
- Description: "Export your Quilltap data or import from export files"
- Two main action buttons:
  - "Export Data" - Opens export dialog
  - "Import Data" - Opens file picker, then import dialog

### 4.2 Export Dialog

**File:** `components/tools/export-dialog.tsx`

Multi-step dialog:

#### Step 1: Select Export Type

- Radio buttons for entity type:
  - Characters
  - Personas
  - Chats
  - Roleplay Templates
  - Connection Profiles
  - Image Profiles
  - Tags

#### Step 2: Select Entities

- Toggle: "Export All" vs "Select Specific"
- If "Select Specific":
  - Searchable list with checkboxes
  - "Select All" / "Select None" buttons
  - Count indicator: "X of Y selected"

#### Step 3: Export Options (for Characters/Personas/Chats)

- Checkbox: "Include associated memories"
  - Shows count: "X memories will be included"

#### Step 4: Confirm & Download

- Summary of what will be exported
- Entity counts
- "Export" button triggers download

### 4.3 Import Dialog

**File:** `components/tools/import-dialog.tsx`

Multi-step dialog:

#### Step 1: File Selection

- Drag-and-drop zone or file picker
- Accept: `.qtap`, `.json` files
- Shows file name and size after selection
- "Analyze File" button

#### Step 2: Preview Contents

- Display manifest info:
  - Export type
  - Created date
  - App version
  - Entity counts
- List of entities with checkboxes:
  - Show name/title
  - Indicator if entity already exists (matching ID)
- "Select All" / "Select None" buttons

#### Step 3: Import Options

- Conflict strategy dropdown:
  - "Skip existing" (default)
  - "Replace existing"
  - "Import as duplicates"
- Checkbox: "Import memories" (if memories present)

#### Step 4: Confirm & Import

- Summary of what will be imported
- Warning if any conflicts detected
- "Import" button
- Progress indicator during import

#### Step 5: Results

- Success/failure status
- Counts of imported entities
- List of warnings (if any)
- "Close" button

---

## Part 5: Implementation Order

### Phase 1: Core Infrastructure

1. Create `lib/export/types.ts` with export format type definitions
2. Create `lib/export/quilltap-export-service.ts` with basic export logic
3. Create export API route for characters (as proof of concept)
4. Add debug logging throughout

### Phase 2: Full Export Support

5. Implement export for all entity types
6. Add memory association logic
7. Add export preview endpoint
8. Create export dialog component
9. Integrate into tools page

### Phase 3: Import Infrastructure

10. Create `lib/import/quilltap-import-service.ts`
11. Implement file parsing and validation
12. Implement import preview
13. Implement conflict detection

### Phase 4: Import Execution

14. Implement import execution for all entity types
15. Implement UUID remapping for duplicates
16. Implement conflict resolution strategies
17. Add import API routes

### Phase 5: Import UI

18. Create import dialog component
19. Create import preview component
20. Create import options component
21. Create import results component

### Phase 6: Tool Card Integration

22. Create `components/tools/import-export-card.tsx`
23. Add to tools page
24. End-to-end testing
25. Final polish and logging

---

## Part 6: API Route Summary

### Export Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tools/quilltap-export` | Create export with options |
| GET | `/api/tools/quilltap-export/preview` | Preview export contents |

### Import Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tools/quilltap-import/preview` | Analyze uploaded file |
| POST | `/api/tools/quilltap-import/execute` | Execute import |

---

## Part 7: Files to Create

### New Files

- `lib/export/types.ts` - Export format type definitions
- `lib/export/quilltap-export-service.ts` - Export logic
- `lib/import/quilltap-import-service.ts` - Import logic
- `app/api/tools/quilltap-export/route.ts` - Export API
- `app/api/tools/quilltap-import/route.ts` - Import API (preview)
- `app/api/tools/quilltap-import/execute/route.ts` - Import API (execute)
- `components/tools/import-export-card.tsx` - Main tool card
- `components/tools/export-dialog.tsx` - Export wizard dialog
- `components/tools/import-dialog.tsx` - Import wizard dialog

### Modified Files

- `app/(authenticated)/tools/page.tsx` - Add ImportExportCard

---

## Part 8: Security Considerations

### API Keys

- **NEVER** export actual API key values
- Export only the key label for reference
- Users must re-configure API keys after importing connection/image profiles

### File Validation

- Validate JSON structure before parsing
- Validate manifest format and version
- Sanitize all string inputs
- Limit maximum file size (e.g., 100MB)

### User Authorization

- All export/import operations require authentication
- Users can only export/import their own data
- Log all export/import operations

---

## Part 9: Testing Strategy

### Unit Tests

- [ ] Export format validation
- [ ] Memory association logic
- [ ] UUID remapping
- [ ] Conflict detection
- [ ] File parsing and validation

### Integration Tests

- [ ] Full export/import cycle for each entity type
- [ ] Conflict resolution strategies
- [ ] Large file handling
- [ ] Invalid file rejection

### E2E Tests

- [ ] Export dialog flow
- [ ] Import dialog flow
- [ ] File download
- [ ] Error handling in UI

---

## Part 10: Success Criteria

1. **Export Works**: Can export any supported entity type to `.qtap` file
2. **Import Works**: Can import any valid `.qtap` file
3. **Selective Operations**: Can export/import specific entities, not just all
4. **Memory Support**: Memories correctly associated and optionally included
5. **Conflict Handling**: All three conflict strategies work correctly
6. **Security**: No API keys or sensitive data leaked in exports
7. **User Experience**: Clear UI with progress indicators and error messages
8. **No Regression**: Existing SillyTavern import/export unaffected

---

## Part 11: Open Questions

| Question | Status | Resolution |
|----------|--------|------------|
| Maximum export file size? | PENDING | Suggest 100MB |
| Support for partial chat export (date range)? | PENDING | Future enhancement |
| Export compression (gzip)? | PENDING | Start uncompressed, add later if needed |
| Memories export as separate entity type? | RESOLVED | No - memories always tied to parent entities |

---

## Part 12: Future Enhancements

These are out of scope for initial implementation but noted for future consideration:

1. **Scheduled Exports**: Automatic periodic exports to S3
2. **Export Encryption**: Password-protected export files
3. **Selective Memory Export**: Export memories as standalone entity type
4. **Cross-User Import**: Admin ability to import into another user's account
5. **Export Templates**: Save export configurations for repeated use
6. **Diff/Merge**: Show differences between import and existing data before merge

---

## Notes

- The `.qtap` extension is chosen to clearly distinguish Quilltap native exports from SillyTavern or other formats
- The manifest-first approach allows quick analysis of export files without parsing all data
- Human-readable fields (like `_tagNames`) are prefixed with `_` to indicate they're metadata, not imported data
- This system complements (does not replace) the existing cloud backup system which exports ALL user data
