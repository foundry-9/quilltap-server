# File Management LLM Tool

This document describes the file management system that allows LLMs to interact with user files during conversations.

## Overview

The file management tool (`file_management`) enables LLMs to:
- List files in projects or general storage
- Read file contents
- Write new files (with user permission)
- Create folders
- Promote message attachments to persistent storage

## Tool Actions

### list_files

List files by scope with optional folder filtering.

**Parameters:**
- `scope` (required): `'project'` | `'general'` | `'character'`
  - `project`: Files in the current chat's project
  - `general`: Files not in any project
  - `character`: Images associated with a specific character
- `folderPath` (optional): Filter to specific folder (e.g., `'/documents/'`)
- `recursive` (optional): Include subfolders (default: `true`)
- `characterId` (required for `scope='character'`): Character ID
- `limit` (optional): Max results (default: 20, max: 100)

**Example:**
```json
{
  "action": "list_files",
  "scope": "project",
  "folderPath": "/documents/",
  "recursive": true,
  "limit": 50
}
```

### list_folders

List folder structure within project or general files.

**Parameters:**
- `scope` (optional): `'project'` | `'general'` (default: `'project'`)

**Example:**
```json
{
  "action": "list_folders",
  "scope": "project"
}
```

### read_file

Read the contents of a specific file.

**Parameters:**
- `fileId` (required): The file ID to read

**Access Rules:**
- File must belong to the user
- For project files: must match the current chat's project
- General files (no project) are always accessible

**Example:**
```json
{
  "action": "read_file",
  "fileId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### write_file

Create or update a file. **Requires user permission.**

**Parameters:**
- `filename` (required): Name for the new file
- `content` (required): File content (max 1MB)
- `mimeType` (optional): MIME type (default: `'text/plain'`)
- `targetFolderPath` (optional): Destination folder (default: `'/'`)

**Permission Flow:**
1. LLM requests write
2. If no permission exists, returns `requiresPermission: true`
3. User sees approval modal with options:
   - Approve this write only
   - Approve all writes to this project
   - Approve all general file writes
   - Deny
4. After approval, permission is stored and write proceeds

**Example:**
```json
{
  "action": "write_file",
  "filename": "notes.txt",
  "content": "Meeting notes from today...",
  "mimeType": "text/plain",
  "targetFolderPath": "/documents/"
}
```

### create_folder

Create (validate) a new folder path.

**Parameters:**
- `newFolderPath` (required): Full folder path (e.g., `'/documents/reports/'`)

**Note:** Folders are implicit - they exist when files are written to them. This action validates the path and confirms it's ready for use.

**Example:**
```json
{
  "action": "create_folder",
  "newFolderPath": "/documents/reports/"
}
```

### promote_attachment

Move a message attachment to project or general files.

**Parameters:**
- `attachmentId` (required): The attachment file ID
- `targetProjectId` (optional): Project ID to move to (null for general files)
- `targetFolderPath` (optional): Destination folder (default: `'/'`)

**Example:**
```json
{
  "action": "promote_attachment",
  "attachmentId": "550e8400-e29b-41d4-a716-446655440000",
  "targetProjectId": null,
  "targetFolderPath": "/saved-attachments/"
}
```

## File Write Permissions

Permissions are stored in the `file_permissions` MongoDB collection and control when the LLM can write without asking.

### Permission Scopes

| Scope | Description |
|-------|-------------|
| `SINGLE_FILE` | Permission for one specific file (for overwrites) |
| `PROJECT` | Permission for any file in a specific project |
| `GENERAL` | Permission for any file not in a project |

### Permission Schema

```typescript
interface FileWritePermission {
  id: string;
  userId: string;
  scope: 'SINGLE_FILE' | 'PROJECT' | 'GENERAL';
  fileId?: string;      // For SINGLE_FILE scope
  projectId?: string;   // For PROJECT scope
  grantedAt: string;
  grantedInChatId?: string;
  createdAt: string;
  updatedAt: string;
}
```

### Managing Permissions

Users can view and revoke permissions through:
- Settings > File Permissions (FilePermissionsManager component)
- API: `GET/POST /api/files/write-permission`
- API: `DELETE /api/files/write-permission/:id`

## Folder Organization

Files are organized using a path-based folder system.

### Path Conventions

- Root level: `"/"`
- Subfolders: `"/documents/"`, `"/documents/reports/"`
- Always starts and ends with `/`
- Case-sensitive
- No `..` or path traversal allowed

### Folder Utilities

The `lib/files/folder-utils.ts` module provides:
- `normalizeFolderPath(path)`: Ensure proper format
- `validateFolderPath(path)`: Check for valid path
- `getParentPath(path)`: Get parent folder
- `buildFolderTree(paths)`: Build tree structure
- `isInFolder(filePath, folderPath)`: Check containment

## API Routes

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/files/write` | POST | Create new file with permission check |
| `/api/files/write-permission` | GET, POST | List/grant permissions |
| `/api/files/write-permission/:id` | DELETE | Revoke permission |
| `/api/files/:id/promote` | POST | Promote attachment |
| `/api/files/general` | GET | List general (non-project) files |
| `/api/projects/:id/files` | GET, POST, DELETE | Project files management |

## Security Considerations

1. **Project Isolation**: LLM can only access files in the current project or general files
2. **Permission Required**: No writes without explicit user approval
3. **Server Validation**: All permissions checked server-side
4. **Content Limits**: Max 1MB for LLM-written files
5. **Filename Sanitization**: Path traversal characters stripped
6. **User Control**: Permissions can be revoked at any time

## UI Components

| Component | Purpose |
|-----------|---------|
| `FileWriteApprovalModal` | Approval dialog for LLM write requests |
| `FolderPicker` | Select/create folders |
| `AttachmentPromotionMenu` | Promote attachments to files |
| `FileBrowser` | Browse project/general files |
| `FilePermissionsManager` | Manage granted permissions |

## Integration Points

### Tool Builder
The file management tool is enabled by default in `lib/tools/plugin-tool-builder.ts`. Set `fileManagement: false` in options to disable.

### Tool Executor
Handled in `lib/chat/tool-executor.ts` as the `file_management` case.

### Tool Display
The `ToolMessage.tsx` component displays file management results with the 📁 icon.

## Future Enhancements

Potential improvements for future versions:
- File browser UI on project pages
- Drag-and-drop file organization
- File search across projects
- File sharing between projects
- Version history for LLM-written files
- Bulk operations (move, delete multiple files)
