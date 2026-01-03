# Projects Feature Implementation Plan

**Status**: Core Implementation Complete
**Created**: 2026-01-02
**Last Updated**: 2026-01-02

## Overview

Projects are an optional way to categorize files and chats, providing focused context for AI conversations. Similar to Claude Desktop and ChatGPT projects.

## Core Concepts

### Project

- **Name** (required): Display name for the project
- **Description** (optional): Brief summary shown in project page
- **Instructions** (optional): System prompt injected into all project chats
- **Character Roster**: List of characters that can participate
- **allowAnyCharacter**: When true, any character can start chats in this project

### Associations

- **Chats**: A chat can belong to 0 or 1 projects (via `projectId`)
- **Files**: Files can be associated with projects for LLM access
- **Memories**: Memories created in project chats are tagged with projectId
- **Characters**: Managed via roster or auto-added when moving chats

### Project Tool

LLMs can access project context via `project_info` tool:

- `get_info`: Project name, description, character roster
- `get_instructions`: Full instructions (useful for long conversations where context is compressed)
- `list_files`: List project files with metadata
- `search_files`: Semantic search across project files
- `read_file`: Extract and return full file content (text, PDFs, image descriptions)

---

## Implementation Phases

### Phase 1: Data Layer ✅

- [x] Create `lib/schemas/project.types.ts` with ProjectSchema
- [x] Add `projectId` to ChatMetadataBaseSchema in `lib/schemas/chat.types.ts`
- [x] Add `projectId` to FileEntrySchema in `lib/schemas/file.types.ts`
- [x] Add `projectId` to MemorySchema in `lib/schemas/memory.types.ts`
- [x] Export types from `lib/schemas/types.ts`
- [x] Create `lib/mongodb/repositories/projects.repository.ts`
- [x] Add projects collection indexes in `lib/mongodb/indexes.ts`
- [x] Add projectId indexes to chats, files, memories collections
- [x] Add UserScopedProjectsRepository in `lib/repositories/user-scoped.ts`

### Phase 2: Backend API ✅

- [x] Create `app/api/projects/route.ts` (GET list, POST create)
- [x] Create `app/api/projects/[id]/route.ts` (GET, PATCH, DELETE)
- [x] Create `app/api/projects/[id]/characters/route.ts` (roster management)
- [x] Create `app/api/projects/[id]/files/route.ts` (file associations)
- [x] Create `app/api/projects/[id]/chats/route.ts` (project chats)
- [x] Create `app/api/sidebar/projects/route.ts` (sidebar data)
- [ ] Create `app/api/projects/[id]/memories/route.ts` (project memories) - Deferred
- [ ] Create `lib/services/project-service.ts` (association logic) - Inlined in API routes

### Phase 3: Project Tool ✅

- [x] Create `lib/tools/project-info-tool.ts` (tool definition)
- [x] Create `lib/tools/handlers/project-info-handler.ts` (handler)
- [x] Create `lib/services/file-content-extractor.ts` (text extraction)
- [x] Export from `lib/tools/index.ts`
- [x] Add project_info case in `lib/chat/tool-executor.ts`
- [x] Include in `lib/tools/plugin-tool-builder.ts` when projectId present

### Phase 4: System Prompt Integration ✅

- [x] Add projectContext parameter to `buildSystemPrompt` in `lib/chat/context/system-prompt-builder.ts`
- [x] Add ProjectContext type and pass through `lib/chat/context-manager.ts`
- [x] Add projectContext to `lib/services/chat-message/context-builder.service.ts`
- [x] Add projectId to `lib/services/chat-message/streaming.service.ts` buildTools

### Phase 5: Frontend - Sidebar ✅

- [x] Create `components/layout/left-sidebar/projects-section.tsx`
- [x] Add projects to `components/providers/sidebar-data-provider.tsx`
- [x] Replace placeholder in `components/layout/left-sidebar/index.tsx`
- [ ] Add collapsible support to `sidebar-section.tsx` - Deferred

### Phase 6: Frontend - Project Pages ✅

- [x] Create `app/(authenticated)/projects/page.tsx` (list)
- [x] Create `app/(authenticated)/projects/[id]/page.tsx` (detail with tabs)
- [ ] Create separate component files - Inlined in page for simplicity
- [ ] Create custom hooks - Using inline fetch for now

### Phase 7: Chat Integration (Future)

- [ ] Add project selector to chat settings/header
- [ ] Pass project context when starting chats from project page
- [ ] Show project badge on chat cards
- [ ] Show project indicator in chat UI
- [ ] Support creating new chat within project

---

## Data Model

### Project Schema

```typescript
const ProjectSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(10000).nullable().optional(),

  // Character access control
  allowAnyCharacter: z.boolean().default(false),
  characterRoster: z.array(UUIDSchema).default([]),

  // Display
  color: z.string().max(20).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
```

### Database Indexes

```typescript
// projects collection
{ key: { userId: 1 } }
{ key: { userId: 1, name: 1 }, options: { unique: true } }
{ key: { name: 'text', description: 'text' } }

// Add to existing collections (sparse)
chats: { key: { projectId: 1 }, options: { sparse: true } }
files: { key: { projectId: 1 }, options: { sparse: true } }
memories: { key: { projectId: 1 }, options: { sparse: true } }
```

---

## API Endpoints

### Projects CRUD

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/projects | List user's projects |
| POST | /api/projects | Create project |
| GET | /api/projects/:id | Get project details |
| PATCH | /api/projects/:id | Update project |
| DELETE | /api/projects/:id | Delete project |

### Project Associations

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/projects/:id/characters | Add to roster |
| DELETE | /api/projects/:id/characters/:charId | Remove from roster |
| GET | /api/projects/:id/files | List project files |
| POST | /api/projects/:id/files | Associate/upload file |
| GET | /api/projects/:id/chats | List project chats |
| GET | /api/projects/:id/memories | List project memories |

### Sidebar

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/sidebar/projects | Projects with counts |

---

## Project Tool

### Definition

```typescript
{
  name: 'project_info',
  description: 'Access project context, search files, and read document contents.',
  parameters: {
    action: enum ['get_info', 'get_instructions', 'list_files', 'search_files', 'read_file'],
    query: string,      // For search_files
    fileId: string,     // For read_file
    limit: integer      // For list/search (default 5, max 20)
  }
}
```

### File Content Extraction

- **PDF**: Use pdf-parse for text extraction
- **Text/Markdown**: Direct content read from S3
- **Images**: Return existing description or trigger cheap LLM description
- **Code files**: Return with syntax language hint

---

## UI Components

### Sidebar Projects Section

- Project icon/color + name
- Chat count badge
- Click navigates to project page
- "View all" link to /projects

### Project Detail Page Layout

```
+----------------------------------+
|  [Icon] Project Name    [Edit]   |
|  Description text here           |
+----------------------------------+
|  ## Instructions                 |
|  [Expandable editor]             |
+----------------------------------+
|  ## Characters          [+ Add]  |
|  [x] Allow any character         |
|  - Character 1  [Remove]         |
|  - Character 2  [Remove]         |
+----------------------------------+
|  ## Chats               [+ New]  |
|  - Chat 1 (5 messages)           |
|  - Chat 2 (12 messages)          |
+----------------------------------+
|  ## Files    [Drag files here]   |
|  [file1.pdf] [file2.txt]         |
+----------------------------------+
|  ## Memories                     |
|  - Memory 1...                   |
+----------------------------------+
```

---

## Future Considerations

Deferred for future implementation:

- [ ] Project templates (pre-configured setups)
- [ ] Project sharing between users
- [ ] Project export/import
- [ ] Nested projects (sub-projects)
- [ ] Project-level settings (default LLM, roleplay template)
- [ ] Project activity feed/timeline
- [ ] Bulk file upload with folder structure

---

## Testing Strategy

### Unit Tests

- Project repository CRUD
- User-scoped access control
- File content extraction (PDF, text, images)
- Project tool handler actions
- System prompt injection

### Integration Tests

- API route authentication
- Chat-project association flow
- Character roster management
- Project tool execution in LLM flow

### E2E Tests

- Create project workflow
- Drag-drop file upload
- Move existing chat to project
- LLM uses project tool successfully
- Project deletion cascading
