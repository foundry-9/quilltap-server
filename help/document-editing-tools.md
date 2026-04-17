---
url: /settings?tab=chat
---

# Document Editing Tools

Quilltap's document editing tools — a suite of fourteen instruments bearing the distinguished `doc_*` prefix — grant your AI characters the ability to read, edit, search, and manage files stored in document stores, project files, and general files, all without leaving the conversation. Think of them as the well-trained staff of a private library: capable of fetching any volume, making careful annotations, reorganizing the shelves, and — when instructed with appropriate gravity — disposing of materials that have outlived their usefulness.

## Prerequisites

These tools require:

1. A **project** associated with the chat
2. At least one **document store** linked to the project (for the `document_store` scope)

Configure document stores from **The Scriptorium** page and link them to projects from the project detail page.

## Scopes

Every `doc_*` tool accepts a `scope` parameter that determines where it operates:

- **`document_store`** (default) — Files within mounted document stores. Requires a `mount_point` parameter specifying which store to use.
- **`project`** — Files stored in the project's own file area.
- **`general`** — Files in the general (non-project) file storage.

## Available Tools

### Reading & Searching

- **`doc_read_file`** — Read file contents with optional line-range pagination
- **`doc_list_files`** — List files across stores, with optional folder, glob pattern, and scope filters
- **`doc_grep`** — Search for text across files using literal or regex patterns, with context lines
- **`doc_read_frontmatter`** — Read YAML frontmatter from a markdown file
- **`doc_read_heading`** — Read all content under a specific heading in a markdown file

## Working with JSON and JSONL

Quilltap treats JSON and JSONL files as first-class document types alongside Markdown and plain text:

- **`.json` files**: `doc_read_file` returns the parsed object or array in the response's `content` field, with `parsed: true` and the original string in `rawContent`. `doc_write_file` accepts either a JSON string (validated) or a native JavaScript object or array (serialized canonically with indentation). Write failures include a clear error message if the JSON is invalid.

- **`.jsonl` and `.ndjson` files**: These newline-delimited JSON formats are supported. Reads return an array of per-line parse results — each entry is `{ line, value?, error? }` — so one malformed line does not corrupt the rest of the file. Writes require an array value (for `doc_write_file`), with each element serialized as one JSON line.

- **`doc_str_replace` on JSON files**: This tool operates on the raw serialized string rather than the parsed structure. For structural edits (adding/removing/modifying keys), prefer `doc_write_file` with a native object — it avoids string-based fragility and returns canonical, well-formatted output.

- **Validation on write**: Invalid JSON is rejected immediately with a descriptive error, preventing corruption of your structured data.

### Editing

- **`doc_write_file`** — Write or create a file (replaces entire contents). For JSON/JSONL files, accepts either a string (validated) or a native object/array (serialized). Supports optimistic concurrency via `expected_mtime`
- **`doc_str_replace`** — Find and replace exact text (requires a unique match for safety). For JSON/JSONL files, operates on the raw string; prefer `doc_write_file` with a native value for structural edits.
- **`doc_insert_text`** — Insert text at a specific position (start, end, before/after an anchor string)
- **`doc_update_frontmatter`** — Update individual YAML frontmatter properties
- **`doc_update_heading`** — Replace content under a specific heading

### File Management

- **`doc_move_file`** — Move or rename a file. If the destination is in a different directory, the file is moved; if in the same directory, it is renamed. The destination must not already exist.
- **`doc_delete_file`** — Permanently delete a file. This cannot be undone, so your characters should confirm intent before calling.
- **`doc_create_folder`** — Create a new folder, including any necessary parent folders. Idempotent — succeeds silently if the folder already exists. For database-backed stores, explicit folder rows are created; for filesystem stores, directories are created on disk.
- **`doc_delete_folder`** — Delete an empty folder. Non-empty folders are rejected for safety; no recursive deletion is permitted. For database-backed stores, the folder row is deleted; for filesystem stores, the directory is removed from disk.
- **`doc_move_folder`** — Move or rename a folder (and all its descendants). Works on both filesystem and database-backed stores. For database-backed stores, the destination parent directory is created automatically if needed (like `mkdir -p`), and all descendant paths and embeddings are cascaded in a transactional batch. For filesystem stores, parent directories are created on demand. The destination must not already exist.

## Enabling and Disabling

Document editing tools appear as a group in the **Tool Settings** panel (accessible from chat settings or project defaults). You can enable or disable the entire "Document Editing" group or toggle individual tools. Tools are automatically marked as unavailable if the chat lacks a project or the project has no linked document stores.

## In-Chat Navigation

To navigate to the chat settings where tools can be configured:

```
help_navigate(url: "/settings?tab=chat")
```
