# Feature Request: Local File CRUD via MCP Server

**Status:** Proposal / Not Implemented

## Summary

Add a local MCP server to Quilltap that exposes file system operations as tools, enabling LLMs to read, create, update, and delete Markdown and other files while respecting token limitations through chunked access patterns.

## Motivation

Large worldbuilding and fiction projects often involve Markdown files that exceed practical token limits. An LLM-accessible file tool allows the model to intelligently navigate, read sections of, and modify these files without requiring the entire content in context. This lays groundwork for future project-based workflows with persistent file access across multiple chats.

---

## Proposed Tool Interface

### Core Tools

| Tool | Purpose |
| ------ | --------- |
| `file_list` | List files in a directory with metadata (size, modified date, type) |
| `file_read` | Read entire file (small files only, with size guard) |
| `file_read_section` | Read by line range, byte range, or heading anchor |
| `file_index` | Return structural index of a file (headings, line counts, section byte positions) |
| `file_create` | Create new file with content |
| `file_write` | Replace entire file content |
| `file_patch` | Update specific section by line range or heading |
| `file_append` | Append content to end of file |
| `file_delete` | Delete file (with confirmation flag) |

---

## Tool Schemas

```typescript
// file_list
{
  directory: string;      // "alias" or "alias:subdirectory"
  pattern?: string;       // Glob pattern, e.g., "*.md"
  recursive?: boolean;    // Default false
}

// file_read
{
  path: string;           // "alias:relative/path.md"
  max_bytes?: number;     // Guard against accidental large reads; default 50KB
}

// file_read_section
{
  path: string;
  // One of the following:
  line_range?: { start: number; end: number };
  byte_range?: { start: number; end: number };
  heading?: string;       // e.g., "## Characters" or "Characters"
  include_heading?: boolean;  // Default true
}

// file_index
{
  path: string;
  include_line_counts?: boolean;  // Per-section line counts
  include_byte_positions?: boolean;
}

// file_create
{
  path: string;
  content: string;
  overwrite?: boolean;    // Default false; fails if file exists
}

// file_write
{
  path: string;
  content: string;
}

// file_patch
{
  path: string;
  // Target selection (one required):
  line_range?: { start: number; end: number };
  heading?: string;
  // Replacement:
  content: string;
}

// file_append
{
  path: string;
  content: string;
  separator?: string;     // Default "\n\n"
}

// file_delete
{
  path: string;
  confirm: boolean;       // Must be true to execute
}
```

---

## Workspace Configuration

### Multi-directory with Aliases

Each chat configures one or more named workspaces. Paths in tool calls use the format `alias:relative/path`.

```typescript
interface WorkspaceMount {
  alias: string;              // e.g., "notes", "drafts", "reference"
  path: string;               // Absolute filesystem path
  permissions: 'read' | 'read-write' | 'full';
}

interface FileAccessConfig {
  enabled: boolean;
  workspaces: WorkspaceMount[];
  max_file_size?: number;         // Override default read guard (bytes)
  allowed_extensions?: string[];  // e.g., [".md", ".txt"]; null = all
}
```

### Path Resolution

- Tool calls use `alias:relative/path` format
- If only one workspace is mounted, the alias prefix is optional
- Bare paths resolve to the single mounted workspace

### Example Configuration

```json
{
  "enabled": true,
  "workspaces": [
    { "alias": "world", "path": "/home/user/fiction/malorywave", "permissions": "read-write" },
    { "alias": "reference", "path": "/home/user/fiction/research", "permissions": "read" }
  ],
  "allowed_extensions": [".md", ".txt", ".json"]
}
```

### Validation Rules

1. Aliases must be unique within a chat (alphanumeric, hyphens, underscores)
2. Paths cannot overlap (no mounting a parent and child of the same tree)
3. Path traversal beyond mount root is rejected regardless of alias

---

## Permission Model

**Scope**: Per-chat configuration, stored in chat metadata.

### Permission Levels

| Level | file_list | file_read | file_read_section | file_index | file_create | file_write | file_patch | file_append | file_delete |
| ------- | ----------- | ----------- | ------------------- | ------------ | ------------- | ------------ | ------------ | ------------- | ------------- |
| `read` | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — |
| `read-write` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `full` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Permissions are set per-workspace, allowing mixed configurations (e.g., read-write for working files, read-only for reference material).

---

## Architecture

### Package Structure

```text
quilltap/
├── packages/
│   └── mcp-files/
│       ├── src/
│       │   ├── index.ts          # MCP server entry point
│       │   ├── tools/
│       │   │   ├── list.ts
│       │   │   ├── read.ts
│       │   │   ├── read-section.ts
│       │   │   ├── index-file.ts
│       │   │   ├── create.ts
│       │   │   ├── write.ts
│       │   │   ├── patch.ts
│       │   │   ├── append.ts
│       │   │   └── delete.ts
│       │   ├── indexer.ts        # Markdown structure parser
│       │   ├── resolver.ts       # Alias/path resolution
│       │   └── guards.ts         # Size limits, path validation, permissions
│       ├── package.json
│       └── tsconfig.json
```

### Dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "glob": "^10.0.0",
  "gray-matter": "^4.0.3"
}
```

### Implementation Notes

1. **Path sandboxing** - All operations constrained to configured workspace roots; reject any path resolving outside
2. **Size guards** - `file_read` refuses files over threshold (default 50KB) and directs LLM to use `file_index` + `file_read_section`
3. **Markdown-aware indexing** - Parse ATX headings and return structured tree with line numbers and byte offsets
4. **Atomic writes** - Write-to-temp-then-rename for `file_write` and `file_patch` to prevent corruption
5. **Connection model** - Stdio transport; Quilltap spawns server as child process per chat

---

## Example Interaction Flow

For a large file the LLM hasn't seen:

1. LLM calls `file_index({ path: "world:characters.md" })`
2. Server returns heading tree with line ranges
3. LLM calls `file_read_section({ path: "world:characters.md", heading: "## Antagonists" })`
4. LLM receives only the relevant section
5. LLM calls `file_patch({ path: "world:characters.md", heading: "## Antagonists", content: "..." })` to update

---

## Future Considerations

### Project Support Migration Path

When projects are implemented:

```text
Project
├── workspaces[] (default mounts inherited by all chats)
└── Chats[]
    └── workspace_overrides[] (add mounts or restrict permissions)
```

- Chats inherit project workspaces but can add their own mounts
- Chats can downgrade permissions but never upgrade (read-only project mount cannot become read-write at chat level)

### Potential Future Enhancements (Not in Scope)

- File change watch/notify (push changes to LLM context)
- Binary file handling (images, PDFs)
- Git integration for version tracking
- Conflict resolution for concurrent edits

---

## Tasks

- [ ] Scaffold `mcp-files` package structure
- [ ] Implement path resolver with alias support
- [ ] Implement permission and size guards
- [ ] Implement Markdown indexer (heading tree with positions)
- [ ] Implement core tools: `file_list`, `file_read`, `file_read_section`, `file_index`
- [ ] Implement write tools: `file_create`, `file_write`, `file_patch`, `file_append`
- [ ] Implement `file_delete` with confirmation
- [ ] Add chat metadata schema for `FileAccessConfig`
- [ ] Add UI for workspace configuration in chat settings
- [ ] Integration testing with large Markdown files
- [ ] Documentation
