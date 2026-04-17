# Quilltap Changelog

## Recent Changes

### 4.3-dev

#### Bug Fixes

- **Production build no longer fails with "Module not found: fs/promises" in the Salon bundle**: `app/salon/[id]/hooks/useDocumentMode.ts` is a client hook, but it imported `formatAutosaveNotification` from the `@/lib/doc-edit` barrel. That barrel re-exports `path-resolver` and `reindex-file`, which pull in `fs/promises`, `child_process`, and the SQLite instance lock — all server-only. Turbopack traced the chain into the client graph and aborted with ten module-not-found errors across the Salon and plugin routes. The hook now imports `formatAutosaveNotification` directly from `@/lib/doc-edit/unified-diff` (pure string logic, no Node built-ins), and `npm run build` completes cleanly. (`app/salon/[id]/hooks/useDocumentMode.ts`)
- **`.qtap` export/import is now streaming NDJSON so large exports no longer crash on the V8 string ceiling**: the old pipeline built a single `QuilltapExport` object in memory and called `JSON.stringify(..., null, 2)`, which threw `RangeError: Invalid string length` once a character with ~14k memories pushed the output past V8's ~512 MB max string. The import side had a mirror problem — `await file.text()` plus `JSON.parse` on the whole file plus a hard 100 MB upload cap. The `.qtap` format is now a newline-delimited JSON stream (`{"format":"qtap-ndjson","version":1,"manifest":{...}}` on line 1, tagged per-entity records on each subsequent line, a footer with authoritative counts at the end). Document-store blob bytes are split into ~4 MB base64 chunks so no single record ever approaches the string limit. Export writes the stream straight into the HTTP response; import peeks the first 2 KB to decide between NDJSON and the legacy monolithic path, reads the stream line-by-line, and reassembles the legacy-shape export object the existing import service already understands. Legacy `.qtap` files still import as long as they fit in V8's string budget (~450 MB); anything larger must be re-exported from a current build. Proxy upload cap raised from 500 MB to 10 GB. Frontend now hands the response straight to `response.blob()` instead of re-serializing JSON (which was a matching client-side wall), and skips the full client-side parse for NDJSON files — only the envelope line is parsed. Verified end-to-end with a 1.2 GB export of a character carrying 14,435 memories. (`lib/export/types.ts`, `lib/export/ndjson-writer.ts`, `lib/import/ndjson-reader.ts`, `lib/import/quilltap-import-stream.ts`, `app/api/v1/system/tools/route.ts`, `components/tools/import-export/hooks/useExportData.ts`, `components/tools/import-export/hooks/useImportData.ts`, `next.config.js`, `help/system-import-export.md`)
- **Document Mode internals were refactored for safer Scriptorium editing flow**: the Salon-side document hook now uses a shared API client for open/read/write/close state, autosave diff generation has been extracted into a reusable utility with regression coverage, and the chat document actions now resolve document context once and reuse the same post-save refresh path for document stores. This reduces duplicated logic and hardens Document Mode behavior without changing the user workflow. (`app/salon/[id]/hooks/useDocumentMode.ts`, `app/salon/[id]/hooks/documentModeApi.ts`, `lib/doc-edit/unified-diff.ts`, `app/api/v1/chats/[id]/actions/documents.ts`)
- **`.qtap` export/import now round-trips project↔mount-point links**: the export payload for document stores did not include the `project_doc_mount_links` join rows, so a project that referenced a Scriptorium mount point lost that reference after a round-trip. The export now collects links for every exported mount point (`ExportedProjectDocMountLink`), and the import remaps both project and mount-point IDs through the existing `idMaps` before re-creating each link. New `documentStoreProjectLinks` count in `QuilltapExportCounts` surfaces the number of links exchanged. Schema updated at `public/schemas/qtap-export.schema.json` with a new `$def` and optional `projectLinks` array. (`lib/export/quilltap-export-service.ts`, `lib/import/quilltap-import-service.ts`, `lib/export/types.ts`)
- **Scan on database-backed document stores now actually rechunks**: `rescanDatabaseMountPoint` previously only emitted `document-written` events, which fed `enqueueEmbeddingJobsForMountPoint` — but that function only enqueues jobs for *existing* null-embedding chunks. After an import (which creates documents and files but zero chunks) or any direct content change outside the doc-edit pipeline, Scan did nothing and the store stayed unsearchable. The rescan now delegates to `reindexSingleFile()` for any document whose file-record `sha256` has drifted from the document's `contentSha256` (or whose file has no chunks at all), creating fresh null-embedding chunks before emitting the write event. (`lib/mount-index/database-store.ts`)
- **Mount-index database now included in the 24-hour physical backup sweep**: the automatic SQLCipher backup previously covered only `quilltap.db` and `quilltap-llm-logs.db` and silently skipped `quilltap-mount-index.db` — where the Scriptorium keeps every chunk, embedding, and (for database-backed stores) the actual document bodies and blobs. A new `createMountIndexPhysicalBackup()` runs alongside the existing two on startup, uses the same 24-hour interval and retention policy (7 days all, weekly for 4 weeks, monthly for 12 months, yearly forever), and writes to `quilltap-mount-index-YYYY-MM-DDTHHmmss.db` inside `data/backups/`. Restore instructions added to `help/database-protection.md`. (`lib/database/backends/sqlite/physical-backup.ts`, `lib/database/backends/sqlite/backend.ts`)
- **Document Mode — fix open/read/write on database-backed stores**: `handleOpenDocument`, `handleReadDocument`, and `handleWriteDocument` were passing the bare `resolved.absolutePath` string to `readFileWithMtime` / `writeFileWithMtimeCheck`. For database-backed stores that string is empty, so the helpers took the filesystem branch and hit `ENOENT: no such file or directory, open ''`. They now pass the full `ResolvedPath` object, letting the helpers dispatch to `readDatabaseDocument` / `writeDatabaseDocument`. Fixes "Failed to open document" in Document Mode against a database-backed Scriptorium store. (`app/api/v1/chats/[id]/actions/documents.ts`)

#### Features

- **Scriptorium — JSON and JSONL as first-class document types (Phase 4.0 Deliverable 3 — Phase C)**: `doc_read_file` on `.json` files returns native JS objects/arrays in `content` with `parsed: true` and the original string in `rawContent`. `doc_write_file` accepts either a string (validated) or a native value (serialized canonically). `.jsonl` and `.ndjson` are supported: reads return per-line parse results so one malformed line does not poison the whole file. Invalid JSON on write is rejected with a clear error. `doc_str_replace` continues to operate on the raw string. Database-backed document stores now accept `.json` and `.jsonl` files alongside `.md` and `.txt`.
- **Scriptorium — Folder-aware operations on database-backed document stores (Phase 4.0 Deliverable 3 — Phase B)**: `doc_create_folder`, `doc_delete_folder`, `doc_list_files`, and new `doc_move_folder` tool now operate on first-class folder rows for database-backed stores. Filesystem stores gain folder entries in `doc_list_files` output. Move cascades path and `folderId` updates to all descendants and emits embedding events post-commit. Existing DB-backed stores are backfilled once on first access (`PRAGMA user_version = 1`). Export/import now round-trips folder rows in `.qtap` files.
- **Scriptorium — Explicit folder entity schema for database-backed document stores (Phase 4.0 Deliverable 3 — Phase A)**: Added `DocMountFolder` schema, `doc_mount_folders` repository and table, and `folderId` columns to `doc_mount_files` and `doc_mount_documents`. New `folder-paths.ts` utilities provide path resolution, folder hierarchy creation, and content checking. Filesystem-backed stores continue to derive folder structure from the OS. Schema and utilities are foundation for Phase B folder-aware operations.
- **Scriptorium — Convert and Deconvert document stores between backends**
  - Each document-store card on the Scriptorium page now sports a **Convert** button (on filesystem and Obsidian stores) and a **Deconvert** button (on database-backed stores) alongside the familiar Scan/Edit/Delete controls.
  - **Convert** reads every indexed file from the store's `basePath` and moves its bytes inside the encrypted mount-index database: text files land in `doc_mount_documents`, binaries in `doc_mount_blobs`. The original files on disk are left untouched. The store's `mountType` flips to `'database'` and the filesystem watcher detaches.
  - **Deconvert** prompts for a target directory (which must be empty or nonexistent), writes every document and blob out to disk at its relative path, flips `mountType` back to `'filesystem'`, and attaches a fresh filesystem watcher against the new `basePath`.
  - **Embeddings are preserved** across either direction. The `doc_mount_files` row and its `doc_mount_chunks` children (including the `embedding` BLOB) stay in place throughout; only the `source` column flips. No re-embedding is necessary.
  - New `POST /api/v1/mount-points/:id?action=convert` and `?action=deconvert` endpoints for programmatic access; the deconvert body accepts `{ targetPath }` and validates emptiness server-side.
  - New `conversionStatus` / `conversionError` columns on `doc_mount_points` drive the in-flight "Converting…" / "Deconverting…" badges on each card; an in-repo ALTER-TABLE migration adds them automatically on first access after upgrade.
- **Scriptorium — Database-backed document stores and universal blob layer**
  - New `mountType: 'database'` option for Scriptorium document stores. Documents and binary assets live entirely inside the SQLCipher-encrypted `quilltap-mount-index.db` — no filesystem path required. DB-backed stores are automatically covered by the existing 24-hour physical-backup sweep.
  - New universal blob table (`doc_mount_blobs`) available to every mount type. Uploaded images are transcoded to WebP server-side via `sharp`; original filename, original MIME type, user-supplied description, and SHA256 are preserved as metadata.
  - New blob REST endpoints: `GET`/`POST /api/v1/mount-points/:id/blobs` (list / upload multipart) and `GET`/`PATCH`/`DELETE /api/v1/mount-points/:id/blobs/<path>` (stream / update description / delete).
  - Four new `doc_*` tools — `doc_write_blob`, `doc_read_blob`, `doc_list_blobs`, `doc_delete_blob` — let characters upload, reference, and curate images alongside the existing document editing tools.
  - Scriptorium UI gains a third "Database-backed" mount type option and a BlobManager on every store detail page (thumbnail grid, description editing, "Copy Markdown" helper).
  - `MessageContent` renderer accepts a `blobMountPointId` prop; when set, relative Markdown image references like `![alt](images/avatar.webp)` resolve through the blob API so DB-backed assets display inline.
  - `.qtap` export/import gains a new `document-stores` entity type that round-trips mount point configuration plus — for DB-backed mounts — document bodies and base64-encoded blobs.
- **Scriptorium (Phase 1)**: Deterministic Markdown rendering of conversations with annotation support and semantic search chunking
  - Conversations are automatically rendered to Markdown after each turn with sequential message numbering and interchange grouping
  - New `read_conversation` tool allows characters to read the full rendered conversation with or without annotations
  - New `upsert_annotation` and `delete_annotation` tools enable characters to add persistent commentary to specific messages
  - Conversation interchanges are embedded as searchable chunks via the existing embedding pipeline
- **Scriptorium (Phase 2)**: Unified search and cross-conversation access
  - Rendered conversations now include a metadata header with title, ID, dates, participants, and counts
  - New unified `search` tool replaces `search_memories`, searching across both character memories and conversation chunks with unified ranking
  - `read_conversation` tool now accepts an optional `conversationId` parameter to read any conversation, not just the current one
  - Metadata header is embedded with chunk 0 for semantic searchability of conversation titles
  - Removed standalone `search_memories` tool (functionality consolidated into `search`)
- **Scriptorium (Phase 3.1)**: Lexical rich text editor integration for chat composer
  - Replaced plain textarea in ChatComposer with Meta's Lexical rich text framework
  - Rich text formatting (bold, italic, headings, lists) via document mode toolbar now uses native Lexical commands
  - Custom markdown transformer set preserves roleplay delimiters (e.g. `*narration*`) as literal text — italic uses underscore only
  - Undo/redo support via Lexical's built-in HistoryPlugin
  - Messages continue to be stored and transmitted as plain markdown strings — no schema changes
  - Foundation for Phase 3 collaborative document editing features
- **Scriptorium (Phase 3.1 cont.)**: Formatting toolbar enhancements
  - CODE button toggles code blocks (no selection) or inline code (with selection); shows as /CODE when cursor is inside a code block
  - Blockquote button with smart-quote label converts blocks to blockquotes
  - H4, H5, H6 heading buttons added
  - Delimiter buttons (Nar, OOC, etc.) now toggle: wrap selected text, or unwrap if already delimited
  - Enter on a blank trailing line inside a code block exits the block and creates a new paragraph
  - All toolbar buttons now preserve editor selection via `onMouseDown` preventDefault
  - Button styling: headings use serif font, CODE uses monospace, blockquote uses bold serif smart-quote
  - Tooltips updated (Bold, Italic, Unordered List, Ordered List, Blockquote, Heading N)
  - UL/OL button labels changed to `• …` and `1. …` for clarity
  - New themeable CSS custom properties: `--qt-formatting-heading-font`, `--qt-formatting-code-font`
- **Scriptorium (Phase 3.1 cont.)**: Source mode editor and toolbar source-mode support
  - Replaced "Preview message" toggle with "Source mode" toggle — shows raw markdown in a monospace textarea for direct editing
  - When toggling back to rich text mode, source edits are synced into the Lexical editor
  - All formatting toolbar buttons (bold, italic, headings, lists, blockquote, code, delimiters) work in source mode with textarea manipulation
  - Source mode uses `qt-source-mode-textarea` CSS class with monospace font
- **Scriptorium (Phase 3.2)**: Document mount points and auto-embedding
  - Mount external document directories (filesystem paths, Obsidian vaults) as searchable knowledge sources
  - New `quilltap-mount-index.db` database (third database, separate from main and LLM logs) with SQLCipher encryption, WAL mode, and graceful degradation
  - Four new tables: `doc_mount_points`, `doc_mount_files`, `doc_mount_chunks`, `project_doc_mount_links` (many-to-many)
  - Format conversion pipeline: PDF (pdf-parse v2), Word (.docx via mammoth.js), Markdown (regex syntax stripping), plain text
  - Intelligent chunking engine: 800-1200 token chunks with 200-token overlap, heading context tracking
  - SHA-256 checksum-based change detection on startup — new/modified files automatically re-ingested, deleted files purged
  - Auto-embedding via existing embedding infrastructure with new `MOUNT_CHUNK` entity type
  - New `'documents'` source type in the unified search tool — document chunks appear alongside memories and conversations
  - Fire-and-forget startup scanning (Phase 3.3) — large vaults don't block server startup
  - REST API: `/api/v1/mount-points` CRUD, `?action=scan` manual re-scan trigger, `/api/v1/projects/[id]/mount-points` link/unlink
  - New npm dependency: `mammoth` for DOCX text extraction
- **Scriptorium (Phase 3.3)**: Quilltap-native document editing tools
  - 10 new LLM tools for reading, editing, and searching files in document stores and project files
  - **Tier 1 — Text primitives**: `doc_read_file`, `doc_write_file`, `doc_str_replace`, `doc_insert_text`, `doc_grep`, `doc_list_files`
  - **Tier 2 — Markdown-aware**: `doc_read_frontmatter`, `doc_update_frontmatter`, `doc_read_heading`, `doc_update_heading`
  - Unified path resolution across three scopes: document stores, project files, and general files
  - `str_replace` with unique-match constraint — text itself serves as the "address", no structural IDs needed
  - Unicode diacritics normalization for search and replace (e.g., "Nimue" matches "Nimuë")
  - Lightweight markdown parser for heading trees and YAML frontmatter (using `yaml` npm package)
  - Path traversal prevention and mount point access control
  - Optimistic concurrency via mtime-based conflict detection
  - Fire-and-forget single-file re-indexing after edits to keep search results current
  - Tools automatically enabled when a project has linked document stores
  - New npm dependency: `yaml` for frontmatter parsing/serialization
- **Scriptorium (Phase 3.4)**: File management tools for document editing
  - `doc_move_file` — Move or rename files within document stores, project files, or general files
  - `doc_delete_file` — Permanently delete files
  - `doc_create_folder` — Create folders (with parent directory creation, idempotent)
  - `doc_delete_folder` — Delete empty folders (non-empty folders are rejected for safety)
  - All four tools support all three scopes (document_store, project, general)
  - Completes the 14-tool `doc_*` family, closing MCP feature gaps for file management
- **Document Mode (Scriptorium Phase 3.5)**: Split-panel editor for collaborative document editing alongside chat
  - Three layout states: Normal (chat only), Split (chat + document), Focus (document only)
  - Resizable divider between chat and document panes with minimum width enforcement
  - Document picker modal with source selection (new blank, project library, mounted stores)
  - Document picker shows "Recent" section with previously opened documents for quick reopen
  - Document store file browsing uses the mount point's indexed files (not the project file browser)
  - Lexical-based document editor with formatting toolbar, word count, and save status
  - `doc_open_document` and `doc_close_document` tools for LLM participants
  - Keyboard shortcuts: Cmd+Shift+D (toggle document mode), Cmd+Shift+F (toggle focus), Escape (exit focus)
  - Debounced autosave (30s idle) with immediate flush on editor blur
  - Sends unified diff to LLM on autosave so it can see what the user changed
  - Sends LLM notification message with file path and tool instructions when a document opens
  - Document editor updates live when LLM edits the file via doc_* tools
  - Document state persists per chat and restores on page reload or revisit
  - Closed documents are preserved as inactive records for quick-reopen history
  - Editing document store files triggers re-indexing, embedding, and stats refresh
  - Responsive: Document Mode button hidden below 1026px viewport width
- **Document Mode Quality of Life (Scriptorium Phase 3.6)**: Three improvements to the document editing experience
  - **Scroll position persistence**: Document pane remembers scroll position across re-renders, tool calls, layout transitions, and document reopen within the same session
  - **Left-hand gutter**: Narrow gutter beside document content showing change markers (blue bars on modified lines since last save) and an attention marker (eye icon at the last `doc_focus` target)
  - **`doc_focus` tool**: LLM participants can scroll the user's viewport to a heading, text passage, or line number — with ephemeral highlight animation and persistent gutter eye icon. Supports `anchor` (heading), `highlight` (text search), `line` (line number), and `clear_focus` parameters
- **Document Stores UI**: Full management interface for document mount points
  - New "Document Stores" button in left sidebar navigation (database icon, below Files)
  - List page at `/document-stores` with card grid showing name, path, type, file/chunk counts, scan status, and last scan time
  - Create dialog with name, path, mount type (filesystem/Obsidian), include/exclude pattern configuration
  - Edit dialog with all fields plus enable/disable toggle
  - Delete confirmation dialog with clear warning about data removal
  - Scan button on each card triggers filesystem scan and embedding job queuing with progress feedback
  - Detail page at `/document-stores/[id]` with summary stats, pattern display, and full file table
  - File table with sortable columns (name, type, size, conversion status, embedding chunks, last modified), filter search, and summary bar
  - Updated help file to reference new UI instead of API-only management
- **Project Document Stores**: Link/unlink document stores on the project detail page
  - New "Document Stores" expandable card on the Prospero project page
  - Shows linked stores with name, type, file count, and total size
  - Inline picker to link available document stores to the project
  - Unlink button on each linked store
- **Document editing tools in tool settings**: All 10 doc_* tools appear in the tool settings UI (per-chat and per-project defaults) with availability status based on whether the project has linked document stores
- **Tool settings grouping**: Built-in tools are now organized into collapsible groups by category — "Document Editing", "Wardrobe", "Workspace" (VM/Docker shell tools), and "Quilltap Help" — each toggleable as a unit
- **Unified Embedding Swap**: EMBEDDING_REINDEX_ALL now performs a full system-wide re-embed covering help documentation, character memories, and conversation chunks (Scriptorium)
  - Help docs are synced from disk to a new `help_docs` database table and embedded at runtime using the user's chosen embedding profile — no more pre-built MessagePack bundle
  - When switching embedding profiles, users are prompted to "Re-embed Everything" (not just memories)
  - Help docs are embedded first (highest priority), followed by memories, then conversation chunks
  - All progress is tracked via the existing "Emb" queue badge in the header
  - BUILTIN TF-IDF vocabulary refit now includes help docs in the corpus for better coverage
  - Conversation chunks now have full `embedding_status` tracking (PENDING/EMBEDDED/FAILED)
  - New default profiles automatically trigger a full system reindex on creation
  - New migration: `create-help-docs-table-v1` for the `help_docs` table
- **Ollama Embedding Model Fetch**: "Fetch Installed Models" button in the embedding profile modal dynamically queries Ollama's `/api/tags` endpoint to show installed models in a dropdown, merging with static suggestions
- Help documentation for document editing tools (`help/document-editing-tools.md`)
- **Concierge danger indicators** in the Salon chat view: breadcrumb "Flagged" badge, red participant card borders, red message avatar outlines (including streaming)
- Renamed "Document Stores" to "The Scriptorium" — new route `/scriptorium` (was `/document-stores`), registered as a formal subsystem with background image and thumbnail
- Replaced sidebar icons: database icon → unrolled scroll for The Scriptorium, person silhouette → sculpted bust for Characters, folder → drafting compass over blueprint for Projects (Prospero)
- Renamed "Document Mode" to "Composition Mode" for the existing ChatComposer toggle (avoids confusion with the new split-panel feature)
- **Claude 4.6 support**: Added Claude Opus 4.6 and Claude Sonnet 4.6 to Anthropic plugin model lists and fallback models
- Added `modelSupportsPrefill` optional method to `TextProviderPlugin` interface for per-model prefill capability detection
- Bumped `qtap-plugin-anthropic` to v1.0.27

#### Improvements

- **Scriptorium live file watching**: Each enabled document store now runs a chokidar-backed filesystem watcher while the server is up. External edits, moves, and deletions are picked up within ~1–2 seconds, the mount index is updated per-file, and embedding jobs are debounce-enqueued for newly-changed chunks — no more waiting for a restart or a manual scan. Watchers attach/refresh/detach automatically when mount points are created, updated, or deleted via the API. Set `QUILLTAP_WATCHER_POLLING=1` to fall back to polling on network filesystems where native fs events are unreliable.
- **Unified new-chat dialog**: The three divergent "start a chat" paths — homepage character cards, the Aurora character-view "Start Chat" button, and `/salon/new` — now share a single form component and submit shape. Homepage quick-chats gain a system-prompt picker when the character has more than one prompt, every entry point can expand to a group chat via an "Add another character" toggle, and `/salon/new` accepts a new `?characterId=` deep-link param that pre-selects a character
- **New-chat character picker sizing**: The "Select Characters" list now sizes itself to `max(starred-count, 3, selected-count)` rows instead of occupying nearly the full viewport. The "Select Characters" and "Selected Characters" cards are locked to the same height at all times via the grid, and auto-grow together as you star or select more characters — significantly less vertical space for small rosters
- **New-chat form split into two cards**: The customization section below the character picker is now "Character Customization" (Play As, image profile, starting scenario, starting outfit, auto-gen avatars — plus connection profile and system prompt when in single-character modal mode) and "Reality Injection Mode" (timestamp injection settings today, with room to grow)
- **Homepage Active Projects — new-chat shortcut**: Each entry in the homepage's "Active Projects" list now has a small green chat icon that jumps straight to `/salon/new?projectId=…`, matching the "New Chat" flow available from the project detail page
- **New chat dialogs — user outfit selection**: The Quick Chat dialog (homepage), `/salon/new` page, and character-view chat creation dialog now expose outfit selection for the selected "Play As" character alongside the LLM character(s), so you can dress your own persona when starting a chat (not just theirs)
- **Concurrent embedding processing**: EMBEDDING_GENERATE jobs now run up to 4 at a time in the background job processor (with a 10-minute per-job timeout), while all other job types remain single-threaded — significantly faster bulk re-embeds, especially with local providers like Ollama
- **Queue Status Badges**: Added "Emb" (embedding) badge showing active embedding jobs. Expanded "Sum" to cover all post-turn processing (context summaries, title updates, scene state tracking, conversation rendering). Added character avatar generation to "Img" badge (renamed from "BG"). Badge order: Mem|Emb|Sum|Dgr|Img.
- **Scriptorium Status Auto-Update**: Scriptorium badge on conversation cards now polls every 5 seconds after a render is triggered, showing real-time status transitions (red → amber → green) as rendering and embedding complete
- Refactored Scriptorium Document Mode for a steadier editing flow: source/rich editing now shares the same toolbar path, split-pane resizing stays in sync with persisted layout, keyboard resizing works on the divider, and autosaves use mtime conflict protection to avoid overwriting external edits
- Removed scenario text from character avatar generation prompts to prevent image models from depicting multiple people when the scenario mentions other characters
- Enhanced participant action logging: update, remove, add, and reactivate actions now log character names, status transitions, updated fields, and failure details at appropriate levels (debug/info/warn)
- perf: Consolidated health-check polling from `InstanceLockGate` and `VersionGuardGate` into a shared `useHealthCheck` hook — eliminates ~24 requests/minute of continuous `/api/health` polling during normal operation (now fires once on mount and only polls when a 409 is detected)
- perf: Cache `useUserCharacterDisplayName` hook data at module level — previously each ChatCard instance fired its own API call to `/api/v1/characters?controlledBy=user`, causing N redundant fetches for N visible cards
- Refactored document-stores UI components to use `qt-*` semantic classes instead of raw Tailwind color classes
- Added `qt-dot-success`, `qt-dot-warning`, `qt-dot-destructive`, `qt-dot-info` utility classes to `_utilities.css`
- Removed dead code: `lib/tools/handlers/memory-search-handler.ts` (unused file)
- Removed pre-built help bundle (`public/help-bundle.msgpack.gz`) and `build:help` npm script — help docs are now embedded at runtime

#### Fixes

- **Document Mode save/read races with LLM**: Fixed `Failed to read document content` and `Failed to save document {}` errors triggered by races between the 30s autosave debounce and LLM document tool calls
  - Autosave is now cancelled when the LLM begins editing and skipped while an LLM edit is in flight — eliminates the mtime conflict when the LLM rewrites the file out from under the user
  - Save 409 responses now silently adopt the server's latest content (or just refresh local mtime if the user has unsaved edits) instead of surfacing a scary error
  - `onToolResult` now reloads document state after `doc_write_file`, `doc_move_file`, and `doc_delete_file` (previously only reloaded after open/close), keeping the editor's cached content and mtime in sync with what the LLM wrote to disk
  - Server-side `handleReadDocument` no longer swallows every error as "File not found" — distinguishes missing-file errors (404) from real failures (500) and logs the underlying cause
- **Document Mode false "Unsaved" status after LLM edit**: After the LLM edited a document via tool, the status line incorrectly flipped to "Unsaved" because Lexical's post-remount re-serialization of the refreshed content differed trivially from the disk bytes (whitespace/list formatting normalization). The hook now treats the first content change after a server-driven state load as an external sync and adopts Lexical's normalized output as the saved baseline, so the status correctly shows "Saved" until the user actually types.
- **Scriptorium `read_conversation` tool**: Removed 50,000 character truncation limit that was cutting off the end of long conversations when delivered to LLM participants
- **Document Mode `doc_focus` highlight**: Fixed highlight overlay not appearing — overlay was positioned at pre-scroll viewport coordinates (off-screen) because it was created before smooth scroll completed; now defers to `scrollend` event
- **Document Mode `doc_focus` highlight**: Increased default highlight opacity from 0.35 to 0.95 for better visibility during the 2.5s fade
- **Document Mode `doc_focus` targeting**: Fixed eye icon and highlight overlay resolving their target independently (two lookups that could disagree due to DOM/Lexical node index mismatch); now resolves the Lexical node key once and uses `editor.getElementByKey()` for both consumers
- **Document Mode gutter**: Fixed false change markers appearing on document open by comparing block text content against block text content (instead of raw markdown vs. plain text)
- **Document Mode gutter eye**: Eye icon now positions at the exact pixel offset of the highlighted text, not the top of the containing block — fixes misalignment when highlighting text inside lists
- **Document Mode highlight**: Fixed highlight overlay being invisible — Lexical's MutationObserver was removing overlays appended to the editor root. Overlay is now a fixed-position element on document.body, outside Lexical's DOM tree
- **Document Mode highlight**: Fixed highlighted text vanishing (surroundContents corrupting Lexical's managed DOM) by switching to a non-destructive overlay approach
- **Document Mode highlight**: Fixed case-sensitive text matching — highlight search now uses case-insensitive matching, consistent with block resolution
- **Claude 4.6 compatibility**: Fixed multi-character chat identity anchoring for Claude 4.6 models (Sonnet 4.6, Opus 4.6) which no longer support assistant message prefill. When a model doesn't support prefill, the system prompt is used to instruct the model to self-identify instead.
- Fixed document editor checkboxes not rendering: `CHECK_LIST` transformer was ordered after `UNORDERED_LIST` (whose regex consumed the line first), and Lexical's built-in `match[3] === 'x'` comparison was case-sensitive so `[X]` rendered as unchecked
- Fixed document editor tables not converting between markdown source and rich text: added custom multiline-element transformer for GFM pipe-delimited table syntax with column alignment support
- Fixed chat participant status changes (absent/remove) not updating in the UI under Electron due to Chromium caching stale GET responses; added `cache: 'no-store'` to all chat-related fetch calls in the Salon view
- **Embedding generate OOM fix**: The `EMBEDDING_GENERATE` handler for memories now writes directly to the database via `VectorIndicesRepository` instead of loading the entire character vector store into memory. Previously, generating an embedding for a single memory would load *all* vectors for that character (e.g. 12,000+ entries × 1,536 dimensions ≈ 150+ MB) just to insert one row — causing V8 heap exhaustion and crashes in Electron when processing large instances.
- **Docker/Lima/WSL heap limit raised to 4 GB**: `--max-old-space-size` bumped from 2048 to 4096 in `Dockerfile`, `Dockerfile.ci`, and `lima/wsl-init.sh`
- **Background job queue now respects priority**: `claimNextJob()` sorts by `priority DESC, createdAt ASC` instead of arbitrary order — the `priority` column existed but was never consulted
- **Chat-related embeddings prioritized over batch operations**: Memory and conversation chunk embeddings now enqueue at priority 10, while mount chunk and help doc embeddings enqueue at priority 0, preventing large document store scans from starving real-time chat responsiveness
- **Google plugin (1.1.22)**: Fixed tool/function calling with Google Gemini SDK — uppercase schema `type` fields for API compatibility, switched `userAgentExtra` to `httpOptions.headers` for newer SDK versions, re-enabled function calling for Gemini 3 models, and improved function call extraction from raw responses
- **Memory search dimension mismatch fallback**: When the search embedding profile produces different dimensions than the stored vector index, `searchMemoriesSemantic` now detects the mismatch before calling vector search and falls back to text-based search instead of silently returning zero results
- **Text search fallback broadened to per-word matching**: The text-based memory search fallback now searches for individual significant words (filtering stop words) when the full query phrase doesn't match, so multi-word queries find relevant memories even without exact substring matches
- **Removed per-chat embedding profile override**: The `embeddingProfileId` field in `cheapLLMSettings` was removed — the system now always uses the single default embedding profile for all search operations, preventing mismatches between the profile used to build the vector index and the one used at search time
- **Tasks Queue UI**: The paused-jobs count was never shown in the queue stats panel because the API response omitted the `paused` field — it is now included.
- **Tasks Queue UI**: Jobs of type `SCENE_STATE_TRACKING`, `CHARACTER_AVATAR_GENERATION`, and `CONVERSATION_RENDER` appeared as raw type identifiers instead of human-readable names; they now display correctly.
- **Tasks Queue UI**: Non-LLM background jobs (embedding generation, vocabulary refit, re-index, avatar generation, conversation render, and story background generation) were incorrectly contributing 500 estimated tokens each to the queue token estimate; they now correctly contribute 0.
- **Tasks Queue UI**: The `ProcessorStatus` type now includes `embeddingInFlight` and `embeddingConcurrency` to match what the API actually returns.
- **Embedding model swap dimension mismatch**: Full re-embed (EMBEDDING_REINDEX_ALL) now clears each character's vector index before enqueuing new jobs, so switching to a model with different dimensions (e.g. 1536 → 4096) no longer fails every job with "Vector dimension mismatch"
- **Stale embedding jobs on re-embed**: Re-embed now cancels all pending/failed/orphaned EMBEDDING_GENERATE jobs from the previous run before enqueuing fresh ones, preventing zombie jobs from competing for processor slots
- **Slow re-embed enqueue**: Reindex handler now batch-inserts all embedding jobs in chunks of 200 (single SQLite transactions) instead of 3 sequential DB calls per entity — enqueue phase drops from minutes to seconds for large instances
- **Orphaned PROCESSING jobs blocking new work**: On startup, all PROCESSING jobs are now killed (DEAD) instead of reset to PENDING, since no job can legitimately be mid-flight at server start. Prevents stale retries from blocking fresh batch-inserted jobs. Embedding concurrency also guards against over-claiming via early bail when slots are full, with proactive back-fill when a slot frees.
- **Embedding BLOB Registration**: Fixed race condition where memory embeddings could be stored as JSON text instead of Float32 BLOBs, causing dimension mismatches during vector search. BLOB columns for `memories`, `vector_entries`, and `conversation_chunks` are now registered at database initialization time rather than lazily in individual repositories.

#### Database

- Added `documentMode` and `dividerPosition` columns to `chats` table
- Added `chat_documents` table for tracking document associations per chat (inactive records preserved for history)

#### Tests

- Added regression tests for chat document mode metadata (`documentMode`, `dividerPosition`) in chats GET handler responses
- Added unit tests for chat document actions covering recent-document ordering/limits and active-document responses
- Added unit tests for conversation-render background job handler
- Added unit tests for FormattingToolbar source-mode formatting operations
- Added unit tests for useHealthCheck hook (shared polling, lock conflict detection)
- Added unit tests for read-conversation-handler (annotation merging, cross-conversation access control, truncation)
- Added unit tests for search-scriptorium-handler (unified search, graceful memory failure, result formatting)
- Updated builtin-tools tests for help_search/help_settings tools and removed search_memories
- Updated tools-api tests for unified search tool schema and legacy tool removal

#### Build & Infrastructure

- Switched dev server from webpack (`--webpack`) to Turbopack (`--turbopack`) for significantly faster on-demand route compilation
- Reduced Turbopack NFT tracing warnings from 9 to 1 by adding `turbopackIgnore` annotations to dynamic-loader.ts, converting themes route to dynamic imports, and adding `outputFileTracingExcludes` for next.config.js
- Updated `better-sqlite3-multiple-ciphers` ^12.8.0 → ^12.9.0 (root + quilltap package)
- Updated `@openrouter/sdk` ^0.12.2 → ^0.12.8 (root + openrouter plugin)
- Updated `@google/genai` ^1.49.0 → ^1.50.1 (google plugin)
- Updated `autoprefixer` ^10.4.27 → ^10.5.0
- Updated `postcss` ^8.5.9 → ^8.5.10

### 4.2.2

- fix: Image copy button in fullscreen viewers (gallery, image modal, tool messages) produced clipboard data that couldn't be pasted back into the ChatComposer under Electron. The Electron IPC path used native `clipboard.writeImage()` which the renderer's paste handler didn't recognize as `image/*`. Now tries the standard Clipboard API first for in-app round-trip compatibility, falling back to Electron IPC for external-app interop.

### 4.2.1

- fix: System prompt plugin (`qtap-plugin-default-system-prompts` 1.1.4) failed to load in standalone/Electron builds because `@quilltap/plugin-utils` was marked as external in the esbuild config, causing a runtime `Cannot find module 'openai'` error. Bundling plugin-utils (tree-shaken to just `createSystemPromptPlugin`) eliminates the dependency chain. The legacy filesystem fallback (`prompts/` directory) was also gone, so no sample prompts appeared in the Import Template modal.
